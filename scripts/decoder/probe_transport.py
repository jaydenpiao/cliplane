"""Serve one source-byte probe on an already connected Unix stream socket."""

import json
import math
import os
import re
import select
import socket
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024
CHUNK_BYTES = 64 * 1024
RESPONSE_TIMEOUT = 1.0
PROBE_FIELDS = {"durationMs", "width", "height", "hasAudio", "fps", "codec", "audioTracks"}
TRACK_ROLES = ("mixed", "microphone", "game")
CODEC_NAME = re.compile(r"[A-Za-z0-9_-]+")


class ProbeUnsupported(ValueError):
    """The backend confirmed that the source is unsupported."""


class _InvalidRequest(ValueError):
    """The caller failed to supply a complete source within the intake limits."""


def _receive(connection: socket.socket, size: int, deadline: float) -> bytes:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise _InvalidRequest
    try:
        connection.settimeout(remaining)
        chunk = connection.recv(size)
    except OSError:
        raise _InvalidRequest from None
    if time.monotonic() >= deadline:
        raise _InvalidRequest
    return chunk


def _source_length(connection: socket.socket, deadline: float) -> int:
    header = bytearray()
    while len(header) < 4:
        chunk = _receive(connection, 4 - len(header), deadline)
        if not chunk:
            raise _InvalidRequest
        header.extend(chunk)
    length = int.from_bytes(header, "big")
    if not 1 <= length <= MAX_SOURCE_BYTES:
        raise _InvalidRequest
    return length


def _stage_source(connection: socket.socket, path: Path, length: int, deadline: float) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    with os.fdopen(os.open(path, flags, 0o600), "wb") as target:
        os.fchmod(target.fileno(), 0o600)
        remaining = length
        while remaining:
            chunk = _receive(connection, min(remaining, CHUNK_BYTES), deadline)
            if not chunk:
                raise _InvalidRequest
            target.write(chunk)
            remaining -= len(chunk)
        if _receive(connection, CHUNK_BYTES, deadline):
            raise _InvalidRequest
        target.flush()
        os.fchmod(target.fileno(), 0o444)


def _metadata_payload(metadata: object) -> bytearray:
    if not isinstance(metadata, dict) or metadata.keys() != PROBE_FIELDS:
        raise ValueError
    duration = metadata["durationMs"]
    width = metadata["width"]
    height = metadata["height"]
    fps = metadata["fps"]
    codec = metadata["codec"]
    tracks = metadata["audioTracks"]
    if (
        type(duration) is not int
        or not 100 <= duration <= 43_200_000
        or type(width) is not int
        or not 16 <= width <= 8192
        or type(height) is not int
        or not 16 <= height <= 8192
        or type(metadata["hasAudio"]) is not bool
        or type(fps) not in (int, float)
        or not math.isfinite(fps)
        or fps < 0
        or not isinstance(codec, str)
        or len(codec) > MAX_RESPONSE_BYTES
        or not CODEC_NAME.fullmatch(codec)
        or not isinstance(tracks, list)
    ):
        raise ValueError
    for track in tracks:
        if (
            not isinstance(track, dict)
            or track.keys() != {"index", "role"}
            or type(track["index"]) is not int
            or not 0 <= track["index"] <= (1 << 53) - 1
            or track["role"] not in TRACK_ROLES
        ):
            raise ValueError
    payload = bytearray()
    encoder = json.JSONEncoder(allow_nan=False, separators=(",", ":"))
    for component in encoder.iterencode({"status": "ok", "metadata": metadata}):
        encoded = component.encode("utf-8")
        if len(payload) + len(encoded) > MAX_RESPONSE_BYTES:
            raise ValueError
        payload.extend(encoded)
    return payload


def serve_probe(
    connection: socket.socket,
    staging_root: Path,
    execute_probe: Callable[[Path], dict],
    *,
    intake_timeout: float = 10.0,
) -> None:
    """Own the connection, clean private staging, then send at most one response.

    The caller supplies the trusted staging parent and a backend responsible for
    bounding its own execution and cleaning any resources it starts.
    """
    payload: bytes | bytearray
    with connection:
        try:
            deadline = time.monotonic() + intake_timeout
            length = _source_length(connection, deadline)
            with tempfile.TemporaryDirectory(prefix="probe-", dir=staging_root) as directory:
                staging = Path(directory)
                staging.chmod(0o700)
                source = staging / "source"
                _stage_source(connection, source, length, deadline)
                # A full peer close also produces EOF. Require its response side to remain open.
                peer = select.poll()
                peer.register(connection, select.POLLHUP)
                if peer.poll(0):
                    raise _InvalidRequest
                payload = _metadata_payload(execute_probe(source))
        except _InvalidRequest:
            payload = b'{"status":"invalid_request"}'
        except ProbeUnsupported:
            payload = b'{"status":"unsupported"}'
        except Exception:  # noqa: BLE001
            # The response boundary never forwards backend, filesystem or encoding diagnostics.
            payload = b'{"status":"unavailable"}'
        try:
            # sendall applies one timeout to the entire send, independently of intake.
            connection.settimeout(RESPONSE_TIMEOUT)
            connection.sendall(len(payload).to_bytes(4, "big") + payload)
        except OSError:
            # The peer may have disconnected or stopped reading.
            pass
