"""Bounded decoder transfer: a length-prefixed manifest and its raw artifacts."""

import json
import math
import os
import shutil
import stat
from contextlib import ExitStack
from pathlib import Path
from typing import BinaryIO

MAX_MANIFEST_BYTES = 1 << 20
MAX_ARTIFACT_BYTES = 64 << 20
MAX_BUNDLE_BYTES = 96 << 20
MAX_JSON_DEPTH = 32
CHUNK_BYTES = 64 << 10
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


class BundleError(ValueError):
    """The request or bundle does not fit the protocol contract."""


def _unique_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise BundleError("Duplicate JSON key")
        result[key] = value
    return result


def _finite_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise BundleError("Nonfinite JSON number")
    return number


def _check_json_depth(value: object, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise BundleError("JSON object is too deeply nested")
    if isinstance(value, dict):
        for child in value.values():
            _check_json_depth(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            _check_json_depth(child, depth + 1)


def decode_object(data: bytes) -> dict:
    """Decode one strict UTF-8 JSON object from an already bounded input."""
    try:
        value = json.loads(
            data.decode("utf-8"),
            object_pairs_hook=_unique_keys,
            parse_float=_finite_float,
            parse_constant=_finite_float,
        )
    except BundleError:
        raise
    except (ValueError, RecursionError):
        raise BundleError("Invalid JSON object") from None
    if not isinstance(value, dict):
        raise BundleError("Expected a JSON object")
    _check_json_depth(value)
    return value


def _artifact_names(operation: str, result: dict) -> list[str]:
    if operation == "probe":
        return []
    if operation == "render":
        return ["render.mp4"]
    if operation != "analyze":
        raise BundleError("Unsupported bundle operation")
    candidates = result.get("candidates")
    if not isinstance(candidates, list) or len(candidates) > 8:
        raise BundleError("Invalid analysis candidates")
    names = ["proxy.mp4", "poster.jpg"]
    for index, candidate in enumerate(candidates):
        name = f"thumb-{index}.jpg"
        if not isinstance(candidate, dict) or candidate.get("thumbnail") != name:
            raise BundleError("Invalid candidate thumbnail")
        names.append(name)
    return names


def _validate_manifest(manifest: dict, operation: str) -> tuple[dict, list[tuple[str, int]]]:
    if (
        manifest.keys() != {"version", "operation", "result", "artifacts"}
        or type(manifest["version"]) is not int
        or manifest["version"] != 1
        or manifest["operation"] != operation
        or not isinstance(manifest["result"], dict)
        or not isinstance(manifest["artifacts"], list)
    ):
        raise BundleError("Invalid bundle manifest")
    result = manifest["result"]
    names = _artifact_names(operation, result)
    declarations = manifest["artifacts"]
    if len(declarations) != len(names):
        raise BundleError("Invalid artifact count")
    artifacts: list[tuple[str, int]] = []
    for name, declaration in zip(names, declarations, strict=True):
        if (
            not isinstance(declaration, dict)
            or declaration.keys() != {"name", "bytes"}
            or declaration["name"] != name
            or type(declaration["bytes"]) is not int
            or not 1 <= declaration["bytes"] <= MAX_ARTIFACT_BYTES
        ):
            raise BundleError("Invalid artifact declaration")
        artifacts.append((name, declaration["bytes"]))
    if sum(size for _, size in artifacts) > MAX_BUNDLE_BYTES:
        raise BundleError("Artifact bundle exceeds the byte limit")
    return result, artifacts


def _read_exact(stream: BinaryIO, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            raise BundleError("Incomplete bundle")
        data.extend(chunk)
    return bytes(data)


def _write_all(stream: BinaryIO, data: bytes) -> None:
    remaining = memoryview(data)
    while remaining:
        written = stream.write(remaining)
        if not written or written < 0:
            raise BundleError("Incomplete bundle write")
        remaining = remaining[written:]


def _copy_exact(source: BinaryIO, target: BinaryIO, size: int) -> None:
    remaining = size
    while remaining:
        chunk = source.read(min(CHUNK_BYTES, remaining))
        if not chunk:
            raise BundleError("Incomplete artifact")
        _write_all(target, chunk)
        remaining -= len(chunk)


def write_bundle(stream: BinaryIO, operation: str, result: dict, output_dir: Path) -> None:
    """Transfer only regular artifacts from a decoder's private output directory."""
    names = _artifact_names(operation, result)
    with ExitStack() as stack:
        files: list[tuple[BinaryIO, int]] = []
        if names:
            directory = os.open(output_dir, DIRECTORY_FLAGS)
            stack.callback(os.close, directory)
            for name in names:
                descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
                source = stack.enter_context(os.fdopen(descriptor, "rb"))
                data = os.fstat(descriptor)
                if not stat.S_ISREG(data.st_mode) or data.st_nlink != 1:
                    raise BundleError("Expected a regular unshared artifact")
                files.append((source, data.st_size))
        manifest = {
            "version": 1,
            "operation": operation,
            "result": result,
            "artifacts": [{"name": name, "bytes": item[1]} for name, item in zip(names, files, strict=True)],
        }
        try:
            encoded = json.dumps(manifest, allow_nan=False, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError, RecursionError):
            raise BundleError("Invalid result metadata") from None
        if not 1 <= len(encoded) <= MAX_MANIFEST_BYTES:
            raise BundleError("Manifest exceeds the byte limit")
        _validate_manifest(decode_object(encoded), operation)
        _write_all(stream, len(encoded).to_bytes(4, "big"))
        _write_all(stream, encoded)
        for artifact, size in files:
            _copy_exact(artifact, stream, size)


def read_bundle(stream: BinaryIO, destination: Path, expected_operation: str) -> dict:
    """Stage a decoder stream in a new directory under a trusted parent.

    The caller must enforce a deadline, verify the decoder's exit status, and
    validate the result for its intended use before promoting any artifact.
    """
    size = int.from_bytes(_read_exact(stream, 4), "big")
    if not 1 <= size <= MAX_MANIFEST_BYTES:
        raise BundleError("Invalid manifest byte length")
    result, artifacts = _validate_manifest(decode_object(_read_exact(stream, size)), expected_operation)
    destination.mkdir(mode=0o700)
    succeeded = False
    try:
        with ExitStack() as stack:
            directory = os.open(destination, DIRECTORY_FLAGS)
            stack.callback(os.close, directory)
            for name, length in artifacts:
                flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
                descriptor = os.open(name, flags, 0o600, dir_fd=directory)
                with os.fdopen(descriptor, "wb") as target:
                    _copy_exact(stream, target, length)
            if stream.read(1) != b"":
                raise BundleError("Unexpected trailing bundle bytes")
        succeeded = True
        return result
    finally:
        if not succeeded:
            shutil.rmtree(destination)
