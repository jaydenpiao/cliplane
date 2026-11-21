"""Trusted cancellation workload run inside a disposable decoder container."""

import subprocess
import sys

CANCELLATION_READY = "descendant-ready"
CANCELLATION_CHILD_PREFIX = "cliplane-decoder-smoke-child-"
CHILD_SECONDS = 120


def main() -> int:
    if len(sys.argv) != 2:
        return 1
    child_script = f"import time\nprint({CANCELLATION_READY!r}, flush=True)\ntime.sleep({CHILD_SECONDS})"
    child = subprocess.Popen(
        [sys.executable, "-I", "-B", "-u", "-c", child_script, CANCELLATION_CHILD_PREFIX + sys.argv[1]],
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    return child.wait(timeout=CHILD_SECONDS + 5)


if __name__ == "__main__":
    sys.exit(main())
