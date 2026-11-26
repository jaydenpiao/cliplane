"""Serve one fixed analysis operation on an already connected private Unix socket."""

import math
import socket
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO

from artifact_protocol import CHUNK_BYTES, write_bundle
from probe_transport import staged_source


def _send_bundle(connection: socket.socket, spool: BinaryIO, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while chunk := spool.read(CHUNK_BYTES):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError
        connection.settimeout(remaining)
        connection.sendall(chunk)


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
    with connection:
        try:
            if not math.isfinite(response_timeout) or response_timeout <= 0:
                raise ValueError
            with tempfile.TemporaryFile(dir=staging_root) as spool:
                with staged_source(
                    connection, staging_root, prefix="analysis-", intake_timeout=intake_timeout
                ) as source:
                    output = source.parent / "output"
                    result = execute_analysis(source, output)
                    write_bundle(spool, "analyze", result, output)
                # Rewind flushes the bounded spool after all named staging is removed.
                spool.seek(0)
                _send_bundle(connection, spool, response_timeout)
        except Exception:  # noqa: BLE001
            # EOF without a complete bundle is failure. Backend details stay private.
            return
