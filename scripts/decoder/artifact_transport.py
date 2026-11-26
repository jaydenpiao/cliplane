"""Serve one fixed analysis or render operation on a connected private Unix socket."""

import io
import math
import socket
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO, Literal

from artifact_protocol import CHUNK_BYTES, BundleError, write_bundle
from decoder import MAX_REQUEST_BYTES, read_request
from probe_transport import receive_exact, staged_source


def _send_bundle(connection: socket.socket, spool: BinaryIO, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while chunk := spool.read(CHUNK_BYTES):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError
        connection.settimeout(remaining)
        connection.sendall(chunk)


def _read_render_request(connection: socket.socket, deadline: float) -> dict:
    length = int.from_bytes(receive_exact(connection, 4, deadline), "big")
    if not 1 <= length <= MAX_REQUEST_BYTES:
        raise BundleError("Invalid render request length")
    request = read_request(io.BytesIO(receive_exact(connection, length, deadline)))
    if request["operation"] != "render":
        raise BundleError("Expected a render request")
    return request


def _serve_artifacts(
    connection: socket.socket,
    staging_root: Path,
    operation: Literal["analyze", "render"],
    execute: Callable[[Path, Path, dict], dict],
    *,
    intake_timeout: float,
    response_timeout: float,
) -> None:
    with connection:
        try:
            if not math.isfinite(response_timeout) or response_timeout <= 0:
                raise ValueError
            deadline = time.monotonic() + intake_timeout
            request = _read_render_request(connection, deadline) if operation == "render" else {}
            with tempfile.TemporaryFile(dir=staging_root) as spool:
                with staged_source(
                    connection, staging_root, prefix=f"{operation}-", deadline=deadline
                ) as source:
                    output = source.parent / "output"
                    result = execute(source, output, request)
                    write_bundle(spool, operation, result, output)
                # Rewind flushes the bounded spool after all named staging is removed.
                spool.seek(0)
                _send_bundle(connection, spool, response_timeout)
        except Exception:  # noqa: BLE001
            # EOF without a complete bundle is failure. Backend details stay private.
            return


def serve_analysis(
    connection: socket.socket,
    staging_root: Path,
    execute_analysis: Callable[[Path, Path], dict],
    *,
    intake_timeout: float = 10.0,
    response_timeout: float = 10.0,
) -> None:
    """Handle one source frame and return one analysis bundle on success.

    The trusted backend owns its execution deadline and cleanup. It imports
    output to the absent destination and returns only after decoder success.
    The receiver must validate the whole bundle and EOF before using its files.
    """
    _serve_artifacts(
        connection,
        staging_root,
        "analyze",
        lambda source, output, _request: execute_analysis(source, output),
        intake_timeout=intake_timeout,
        response_timeout=response_timeout,
    )


def serve_render(
    connection: socket.socket,
    staging_root: Path,
    execute_render: Callable[[Path, Path, dict], dict],
    *,
    intake_timeout: float = 10.0,
    response_timeout: float = 10.0,
) -> None:
    """Handle a render request followed by one source frame and return its bundle.

    The backend receives the parsed request and owns deadline, execution,
    and cleanup as with analysis. Both input frames share the intake deadline.
    """
    _serve_artifacts(
        connection,
        staging_root,
        "render",
        execute_render,
        intake_timeout=intake_timeout,
        response_timeout=response_timeout,
    )
