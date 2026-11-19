"""Fixed-path decoder entry point. One request on stdin, one binary bundle on stdout."""

import sys
import tempfile
from pathlib import Path
from typing import BinaryIO

from artifact_protocol import BundleError, decode_object, write_bundle
from pipeline import analyze, probe, render

SOURCE = Path("/input/source")
WORK = Path("/work")
MAX_REQUEST_BYTES = 1024 * 1024


def read_request(stream: BinaryIO) -> dict:
    data = stream.read(MAX_REQUEST_BYTES + 1)
    if len(data) > MAX_REQUEST_BYTES:
        raise BundleError("Decoder request is too large")
    request = decode_object(data)
    version = request.get("version")
    operation = request.get("operation")
    if type(version) is not int or version != 1 or operation not in ("probe", "analyze", "render"):
        raise BundleError("Invalid decoder request")
    expected_keys = {"version", "operation"}
    if operation == "render":
        expected_keys.add("plan")
        if not isinstance(request.get("plan"), dict):
            raise BundleError("Invalid render plan")
    if request.keys() != expected_keys:
        raise BundleError("Invalid decoder request keys")
    return request


def run_job(request_stream: BinaryIO, bundle_stream: BinaryIO) -> None:
    request = read_request(request_stream)
    operation = request["operation"]
    with tempfile.TemporaryDirectory(prefix="decoder-", dir=WORK) as job:
        output_dir = Path(job)
        if operation == "probe":
            result = probe(SOURCE)
        elif operation == "analyze":
            result = analyze(SOURCE, output_dir)
        else:
            result = render(SOURCE, output_dir / "render.mp4", request["plan"])
        write_bundle(bundle_stream, operation, result, output_dir)


def main() -> int:
    try:
        if len(sys.argv) != 1:
            raise BundleError("Unexpected decoder arguments")
        run_job(sys.stdin.buffer, sys.stdout.buffer)
        sys.stdout.buffer.flush()
        return 0
    except Exception:  # noqa: BLE001
        # This is the process boundary. Even unexpected failures must omit private details.
        print("decoder_failed", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
