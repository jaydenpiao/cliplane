"""Serve fixed private decoder operations with one active connection."""

import os
import select
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
    execute_probe: Callable[[Path, Callable[[], bool]], dict],
    execute_analysis: Callable[[Path, Path, Callable[[], bool]], dict],
    execute_render: Callable[[Path, Path, dict, Callable[[], bool]], dict],
    stop: Event,
    ready: Event,
) -> None:
    """Open all private sockets, serve one peer at a time, and drain on stop.

    The caller supplies trusted roots and separate lifecycle events. The ready
    event covers the serving scope after startup. Operation handlers keep their
    wire deadlines. Trusted callbacks receive a predicate for their peer's
    disconnect and use it to clean up decoder work. Stop drains active work.
    """
    ready.clear()
    if type(allowed_uid) is not int or not 0 <= allowed_uid <= _MAX_UID:
        raise ValueError("invalid runner peer UID")
    _validate_roots(socket_root, staging_root)
    if stop.is_set():
        return

    def dispatch(
        connection: socket.socket, *, handler: Callable[[socket.socket, Callable[[], bool]], None]
    ) -> None:
        # Stop may have been set while accepting and authenticating this connection.
        if stop.is_set():
            return
        peer = select.poll()
        # A write half-close marks read EOF but leaves the response direction open.
        failure_events = select.POLLHUP | select.POLLERR | select.POLLNVAL
        peer.register(connection, failure_events)

        def cancelled() -> bool:
            return any(events & failure_events for _, events in peer.poll(0))

        handler(connection, cancelled)

    def probe(connection: socket.socket, cancelled: Callable[[], bool]) -> None:
        serve_probe(connection, staging_root, lambda source: execute_probe(source, cancelled))

    def analyze(connection: socket.socket, cancelled: Callable[[], bool]) -> None:
        serve_analysis(
            connection, staging_root, lambda source, output: execute_analysis(source, output, cancelled)
        )

    def render(connection: socket.socket, cancelled: Callable[[], bool]) -> None:
        serve_render(
            connection,
            staging_root,
            lambda source, output, request: execute_render(source, output, request, cancelled),
        )

    endpoints = (
        ("probe.sock", probe),
        ("analyze.sock", analyze),
        ("render.sock", render),
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
