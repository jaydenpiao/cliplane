"""Trusted container probe sent on stdin by the synthetic decoder smoke."""

import errno
import hashlib
import os
import resource
import signal
import socket
import stat
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

SOURCE_READ_ONLY = "source-read-only"
OTHER_PATHS_ABSENT = "other-host-paths-absent"
UNPRIVILEGED = "unprivileged-process"
LOOPBACK_ONLY = "loopback-only"
ROOT_READ_ONLY = "root-read-only"
FILE_LIMIT = "file-size-limit"
SCRATCH_LIMIT = "scratch-capacity-limit"
BOUNDARY_CHECKS = (
    SOURCE_READ_ONLY,
    OTHER_PATHS_ABSENT,
    UNPRIVILEGED,
    LOOPBACK_ONLY,
    ROOT_READ_ONLY,
    FILE_LIMIT,
    SCRATCH_LIMIT,
)
UNMOUNTED_SOURCE_NAME = "unmounted.mp4"
MIB = 1024 * 1024
FILE_LIMIT_BYTES = 64 * MIB
SCRATCH_LIMIT_BYTES = 192 * MIB
MEMORY_LIMIT_BYTES = 384 * MIB


def require(condition: bool, failure: str) -> None:
    if not condition:
        raise ValueError(failure)


def expect_errno(action: Callable[[], object], code: int) -> None:
    try:
        action()
    except OSError as error:
        if error.errno == code:
            return
        raise
    raise ValueError(f"expected {errno.errorcode[code]}")


def check_source(expected_hash: str) -> None:
    source = Path("/input/source")
    require(stat.S_IMODE(source.stat().st_mode) == 0o666, "expected a writable-mode source fixture")
    with source.open("rb") as stream:
        require(hashlib.file_digest(stream, "sha256").hexdigest() == expected_hash, "unexpected source bytes")

    def open_for_write() -> None:
        with source.open("r+b"):
            pass

    expect_errno(open_for_write, errno.EROFS)


def check_other_paths(staging_root: Path, repository: Path) -> None:
    for path in (
        Path("/input") / UNMOUNTED_SOURCE_NAME,
        staging_root / UNMOUNTED_SOURCE_NAME,
        staging_root,
        repository,
        Path("/var/run/docker.sock"),
        Path("/run/docker.sock"),
        Path("/var/run/containerd/containerd.sock"),
        Path("/run/containerd/containerd.sock"),
    ):
        expect_errno(path.lstat, errno.ENOENT)
    require(os.listdir("/input") == ["source"], "unexpected input directory entries")


def check_privileges() -> None:
    require(os.getresuid() == os.getresgid() == (65534, 65534, 65534), "unexpected process identity")
    status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines())
    require(status["NoNewPrivs"].strip() == "1", "no-new-privileges is disabled")
    for field in ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"):
        require(int(status[field], 16) == 0, "unexpected Linux capabilities")


def check_root(staging_name: str) -> None:
    root_tmp = Path("/tmp")
    require(bool(os.statvfs("/").f_flag & os.ST_RDONLY), "root filesystem is writable")
    tmp_stat = root_tmp.stat()
    require(tmp_stat.st_dev == Path("/").stat().st_dev, "expected /tmp on the image filesystem")
    require(bool(tmp_stat.st_mode & stat.S_IWOTH), "expected writable-mode /tmp")
    expect_errno(lambda: (root_tmp / f"{staging_name}-root-write").touch(exist_ok=False), errno.EROFS)


def fill_file(descriptor: int, chunk: bytes) -> None:
    for _ in range(FILE_LIMIT_BYTES // len(chunk)):
        require(os.write(descriptor, chunk) == len(chunk), "incomplete scratch write")


def check_sizes() -> None:
    scratch_root = Path("/work")
    mounts = Path("/proc/self/mountinfo").read_text().splitlines()
    scratch_types = [line.split(" - ", 1)[1].split()[0] for line in mounts if line.split()[4] == "/work"]
    require(scratch_types == ["tmpfs"], "expected a private scratch tmpfs")
    blocks = os.statvfs(scratch_root)
    require(
        blocks.f_blocks * blocks.f_frsize == SCRATCH_LIMIT_BYTES and blocks.f_bavail == blocks.f_blocks,
        "unexpected scratch capacity",
    )
    require(
        resource.getrlimit(resource.RLIMIT_FSIZE) == (FILE_LIMIT_BYTES, FILE_LIMIT_BYTES),
        "unexpected file size limits",
    )
    # Run the capacity exercise only with the smoke's expected private memory controller setting.
    require(
        Path("/sys/fs/cgroup/memory.max").read_text().strip() == str(MEMORY_LIMIT_BYTES),
        "unexpected memory controller setting",
    )
    signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
    chunk = bytes(MIB)
    with tempfile.TemporaryDirectory(dir=scratch_root) as directory:
        scratch = Path(directory)
        first = scratch / "first"
        with first.open("xb", buffering=0) as trial:
            fill_file(trial.fileno(), chunk)
            expect_errno(lambda: os.write(trial.fileno(), b"x"), errno.EFBIG)
        print(FILE_LIMIT)

        for index in range(1, SCRATCH_LIMIT_BYTES // FILE_LIMIT_BYTES):
            with (scratch / f"fill-{index}").open("xb", buffering=0) as trial:
                fill_file(trial.fileno(), chunk)
        with (scratch / "extra").open("xb", buffering=0) as trial:
            expect_errno(lambda: os.write(trial.fileno(), b"x"), errno.ENOSPC)
            first.unlink()
            require(os.write(trial.fileno(), b"x") == 1, "scratch write failed after freeing space")
    print(SCRATCH_LIMIT)


def run(expected_hash: str, staging_root: Path, repository: Path) -> None:
    check_source(expected_hash)
    print(SOURCE_READ_ONLY)
    check_other_paths(staging_root, repository)
    print(OTHER_PATHS_ABSENT)
    check_privileges()
    print(UNPRIVILEGED)
    require([name for _, name in socket.if_nameindex()] == ["lo"], "unexpected network interfaces")
    print(LOOPBACK_ONLY)
    check_root(staging_root.name)
    print(ROOT_READ_ONLY)
    check_sizes()


if __name__ == "__main__":
    source_hash, staging, checkout = sys.argv[1:]
    run(source_hash, Path(staging), Path(checkout))
