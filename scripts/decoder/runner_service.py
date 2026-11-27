"""Serve fixed private decoder operations with one active connection."""

import os
import socket
import stat
from collections.abc import Callable
from contextlib import ExitStack
from functools import partial
from pathlib import Path
from selectors import EVENT_READ, DefaultSelector
from threading import Event

from artifact_transport import serve_analysis, serve_render
from probe_listener import probe_listener, serve_peer_once
from probe_transport import serve_probe

_POLL_SECONDS = 0.1
# Linux reserves the largest uid_t value to mean an invalid UID.
_MAX_UID = (1 << 32) - 2


def _validate_roots(socket_root: Path, staging_root: Path) -> None:
    sockets = socket_root.stat(follow_symlinks=False)
    staging = staging_root.stat(follow_symlinks=False)
    if not stat.S_ISDIR(sockets.st_mode) or not stat.S_ISDIR(staging.st_mode):
        raise NotADirectoryError("runner roots must be existing directories")
    if os.path.samestat(sockets, staging):
        raise ValueError("runner socket and staging roots must be distinct")
    owner = os.geteuid()
    if sockets.st_uid != owner or sockets.st_mode & (stat.S_IWGRP | stat.S_IRWXO):
        raise PermissionError("runner socket root must be runner-owned and private")
    if staging.st_uid != owner or staging.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise PermissionError("runner staging root must be accessible only to the runner")


def serve_runner(
    socket_root: Path,
    staging_root: Path,
    allowed_uid: int,
    *,
    execute_probe: Callable[[Path], dict],
    execute_analysis: Callable[[Path, Path], dict],
    execute_render: Callable[[Path, Path, dict], dict],
    stop: Event,
    ready: Event,
) -> None:
    """Open all private sockets, serve one peer at a time, and drain on stop.

    The caller supplies trusted roots and separate lifecycle events. The ready
    event covers the serving scope after startup. Operation handlers keep their
    wire deadlines and the trusted callbacks bound and clean up decoder work.
    """
    ready.clear()
    if type(allowed_uid) is not int or not 0 <= allowed_uid <= _MAX_UID:
        raise ValueError("invalid runner peer UID")
    _validate_roots(socket_root, staging_root)
    if stop.is_set():
        return

    def dispatch(connection: socket.socket, *, handler: Callable[[socket.socket], None]) -> None:
        # Stop may have been set while accepting and authenticating this connection.
        if not stop.is_set():
            handler(connection)

    endpoints = (
        ("probe.sock", partial(serve_probe, staging_root=staging_root, execute_probe=execute_probe)),
        (
            "analyze.sock",
            partial(serve_analysis, staging_root=staging_root, execute_analysis=execute_analysis),
        ),
        ("render.sock", partial(serve_render, staging_root=staging_root, execute_render=execute_render)),
    )
    with ExitStack() as resources:
        selector = resources.enter_context(DefaultSelector())
        for name, handler in endpoints:
            listener = resources.enter_context(probe_listener(socket_root / name))
            selector.register(listener, EVENT_READ, (listener, handler))
        if stop.is_set():
            return

        ready.set()
        try:
            while not stop.is_set():
                for key, _ in selector.select(_POLL_SECONDS):
                    if stop.is_set():
                        return
                    listener, handler = key.data
                    serve_peer_once(
                        listener,
                        allowed_uid,
                        partial(dispatch, handler=handler),
                        accept_timeout=_POLL_SECONDS,
                    )
        finally:
            ready.clear()
