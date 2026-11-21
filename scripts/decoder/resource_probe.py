"""Trusted cgroup v2 behavior probe sent on stdin to a fresh decoder container."""

import errno
import os
import signal
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

MIB = 1024 * 1024
PIDS_LIMIT = 48
CPU_WORK = """
import time

deadline = time.monotonic() + 8
while time.monotonic() < deadline:
    pass
"""
MEMORY_WORK = """
import os
import sys
import time

page_size = os.sysconf("SC_PAGE_SIZE")
deadline = time.monotonic() + 10
chunks = []
for _ in range(416 // 4):
    if time.monotonic() >= deadline:
        sys.exit(2)
    chunk = bytearray(4 * 1024 * 1024)
    for offset in range(0, len(chunk), page_size):
        chunk[offset] = 1
    chunks.append(chunk)
"""


def require(condition: bool, failure: str) -> None:
    if not condition:
        raise ValueError(failure)


def require_profile(cgroup: Path, proc: Path) -> None:
    require((proc / "cgroup").read_text().strip() == "0::/", "expected a private cgroup v2 root")
    mount_types = []
    for line in (proc / "mountinfo").read_text().splitlines():
        mount, filesystem = line.split(" - ", 1)
        if mount.split()[4] == str(cgroup):
            mount_types.append(filesystem.split()[0])
    require(mount_types == ["cgroup2"], "expected a cgroup v2 mount at the controller path")
    require(
        (cgroup / "cgroup.procs").read_text().split() == [str(os.getpid())],
        "expected only the probe in its cgroup",
    )
    limits = {
        "memory.max": str(384 * MIB),
        "memory.swap.max": "0",
        "cpu.max": "100000 100000",
        "pids.max": str(PIDS_LIMIT),
    }
    for name, expected in limits.items():
        require((cgroup / name).read_text().strip() == expected, f"unexpected {name}")


def counters(path: Path, *names: str) -> tuple[int, ...]:
    values = {}
    for line in path.read_text().splitlines():
        key, value = line.split()
        values[key] = int(value)
    return tuple(values[name] for name in names)


def increased(before: tuple[int, ...], after: tuple[int, ...]) -> bool:
    return all(current > previous for previous, current in zip(before, after, strict=True))


def spawn(*args: str) -> subprocess.Popen[bytes]:
    return subprocess.Popen(
        args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )


@contextmanager
def workloads() -> Iterator[list[subprocess.Popen[bytes]]]:
    children: list[subprocess.Popen[bytes]] = []
    try:
        yield children
    finally:
        cleanup_failed = False
        for child in children:
            try:
                child.kill()
            except OSError:
                cleanup_failed = True
        deadline = time.monotonic() + 2
        for child in children:
            try:
                child.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                cleanup_failed = True
        require(not cleanup_failed, "could not stop and reap all resource workers")


def check_cpu(cgroup: Path) -> None:
    stat = cgroup / "cpu.stat"
    names = ("nr_throttled", "throttled_usec")
    before = counters(stat, *names)
    with workloads() as children:
        for _ in range(2):
            children.append(spawn(sys.executable, "-I", "-B", "-c", CPU_WORK))
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            require(all(child.poll() is None for child in children), "CPU worker exited before throttling")
            if increased(before, counters(stat, *names)):
                return
            time.sleep(0.05)
        raise ValueError("CPU throttling counters did not increase")


def check_memory(cgroup: Path) -> None:
    events = cgroup / "memory.events.local"
    names = ("max", "oom", "oom_kill")
    before = counters(events, *names)
    with workloads() as children:
        child = spawn(sys.executable, "-I", "-B", "-c", MEMORY_WORK)
        children.append(child)
        require(child.wait(timeout=12) == -signal.SIGKILL, "allocator did not receive SIGKILL")
        require(
            increased(before, counters(events, *names)),
            "local memory limit and OOM counters did not increase",
        )


def check_pids(cgroup: Path) -> None:
    current = cgroup / "pids.current"
    events = cgroup / "pids.events"
    require(current.read_text().strip() == "1", "expected only the probe task before the PID exercise")
    before = counters(events, "max")
    with workloads() as children:
        deadline = time.monotonic() + 6
        for _ in range(64):
            require(time.monotonic() < deadline, "PID exercise exceeded its deadline")
            try:
                children.append(spawn("/bin/sleep", "15"))
            except OSError as error:
                if error.errno != errno.EAGAIN:
                    raise
                break
        else:
            raise ValueError("PID ceiling did not reject a worker")
        require(
            len(children) == PIDS_LIMIT - 1
            and current.read_text().strip() == str(PIDS_LIMIT)
            and all(child.poll() is None for child in children),
            "process creation failed without the expected PID population",
        )
        require(increased(before, counters(events, "max")), "PID limit event counter did not increase")


RESOURCE_CHECKS = {"cpu": check_cpu, "memory": check_memory, "pids": check_pids}


def run(case: str) -> None:
    require(case in RESOURCE_CHECKS, "expected resource case cpu, memory or pids")
    cgroup = Path("/sys/fs/cgroup")
    require_profile(cgroup, Path("/proc/self"))
    RESOURCE_CHECKS[case](cgroup)
    print(case)


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 2, "expected a single resource case")
        run(sys.argv[1])
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        sys.exit(str(error))
