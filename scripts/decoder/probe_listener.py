"""Accept local probe connections from one configured Linux UID."""

import math
import os
import socket
import stat
import struct
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager
from pathlib import Path

from probe_transport import serve_probe

# Linux struct ucred contains a signed PID and unsigned UID and GID.
_PEER_CREDENTIALS = struct.Struct("=iII")
_UNIX_PATH_MAX_BYTES = 107  # sockaddr_un.sun_path reserves one byte for the terminator.


def _remove_endpoint(parent: int, name: str, created: os.stat_result) -> None:
    try:
        current = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if os.path.samestat(created, current):
            os.unlink(name, dir_fd=parent)
    except FileNotFoundError:
        pass


@contextmanager
def probe_listener(socket_path: Path) -> Iterator[socket.socket]:
    """Open one private listener in an existing runner-owned directory.

    The operator supplies a trusted pathname and can grant the socket's group
    search access to the parent. Only the runner may write to the parent.
    """
    if len(os.fsencode(socket_path)) > _UNIX_PATH_MAX_BYTES:
        raise ValueError("Unix socket path is too long")
    with ExitStack() as resources:
        parent = os.open(socket_path.parent, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW)
        resources.callback(os.close, parent)
        directory = os.fstat(parent)
        if directory.st_uid != os.geteuid() or directory.st_mode & (stat.S_IWGRP | stat.S_IRWXO):
            raise PermissionError("probe socket parent must be runner-owned and private")

        listener = resources.enter_context(socket.socket(socket.AF_UNIX, socket.SOCK_STREAM))
        # Resolve bind against the same directory checked above, even if its name moves.
        name = socket_path.name
        listener.bind(f"/proc/self/fd/{parent}/{name}")
        created = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if not stat.S_ISSOCK(created.st_mode):
            raise OSError("probe socket endpoint changed during setup")
        try:
            # Pin the inode until cleanup so its identity cannot be reused.
            endpoint = os.open(name, os.O_PATH | os.O_NOFOLLOW, dir_fd=parent)
            resources.callback(os.close, endpoint)
            if not os.path.samestat(created, os.fstat(endpoint)):
                raise OSError("probe socket endpoint changed during setup")
            os.chmod(f"/proc/self/fd/{endpoint}", 0o660)
            listener.listen(1)
            yield listener
        finally:
            _remove_endpoint(parent, name, created)


def serve_probe_once(
    listener: socket.socket,
    allowed_uid: int,
    staging_root: Path,
    execute_probe: Callable[[Path], dict],
    *,
    accept_timeout: float = 5.0,
) -> bool:
    """Serve one authorized connection synchronously, or return False for no authorized peer.

    Use one accept caller per listener. A True result means the peer was
    authorized and the transport handled the connection, including error replies.
    """
    if not math.isfinite(accept_timeout) or accept_timeout <= 0:
        raise ValueError("accept timeout must be positive and finite")
    previous_timeout = listener.gettimeout()
    listener.settimeout(accept_timeout)
    try:
        connection, _ = listener.accept()
    except TimeoutError:
        return False
    finally:
        listener.settimeout(previous_timeout)

    with connection:
        credentials = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, _PEER_CREDENTIALS.size)
        _, uid, _ = _PEER_CREDENTIALS.unpack(credentials)
        if uid != allowed_uid:
            return False
        serve_probe(connection, staging_root, execute_probe)
    return True
