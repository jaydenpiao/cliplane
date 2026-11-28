"""CI smoke for one trusted synthetic fixture and one built decoder image."""

import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from threading import Event

from boundary_probe import BOUNDARY_CHECKS, UNMOUNTED_SOURCE_NAME
from cancellation_probe import CANCELLATION_CHILD_PREFIX, CANCELLATION_READY
from probe_transport import MAX_RESPONSE_BYTES
from resource_probe import RESOURCE_CHECKS

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "workers/media"))
from artifact_protocol import CHUNK_BYTES, decode_object
from decoder_container import IMAGE_ID, DecoderCancelled, container_stream, docker
from runner_executor import DecoderExecutor
from runner_service import serve_runner

FIXTURE = ROOT / "packages/test-fixtures/nightdrift-original.mp4"
EXITED_PROCESS_STATES = (b"Z", b"X", b"x")


class SmokeError(ValueError):
    """A stable smoke-check failure that can be shown in CI."""


def require(condition: bool, failure: str) -> None:
    if not condition:
        raise SmokeError(failure)


@dataclass(frozen=True)
class HostProcess:
    state: bytes
    parent: int
    group: int
    session: int
    start_time: int


def host_process(pid: int) -> HostProcess | None:
    try:
        stat = Path(f"/proc/{pid}/stat").read_bytes()
    except (FileNotFoundError, ProcessLookupError):
        return None
    # The parenthesized command can contain spaces and closing parentheses.
    _, separator, remainder = stat.rpartition(b") ")
    fields = remainder.split()
    require(bool(separator) and len(fields) > 19, "host process stat is malformed")
    return HostProcess(fields[0], int(fields[1]), int(fields[2]), int(fields[3]), int(fields[19]))


def find_host_descendant(container_id: str, child_token: bytes) -> tuple[int, int]:
    result = docker("container", "top", container_id, "-eo", "pid")
    rows = result.stdout.split()
    require(result.returncode == 0 and rows[:1] == ["PID"], "owned container process lookup failed")
    require(all(re.fullmatch(r"[1-9][0-9]*", pid) for pid in rows[1:]), "invalid container PID listing")
    pids = {int(pid) for pid in rows[1:]}
    matches = []
    for pid in pids:
        before = host_process(pid)
        if before is None or before.session != pid or before.group != pid or before.parent not in pids:
            continue
        try:
            argv = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        except (FileNotFoundError, ProcessLookupError):
            continue
        after = host_process(pid)
        if (
            argv[-2:] == [child_token, b""]
            and after is not None
            and (after.parent, after.group, after.session, after.start_time)
            == (before.parent, before.group, before.session, before.start_time)
            and after.state not in EXITED_PROCESS_STATES
        ):
            matches.append((pid, after.start_time))
    require(len(matches) == 1, "live cancellation descendant could not be identified")
    return matches[0]


def verify_descendant_gone(pid: int, start_time: int) -> None:
    deadline = time.monotonic() + 5
    while True:
        current = host_process(pid)
        # An exited task can remain visible as a zombie until its parent reaps it.
        if current is None or current.start_time != start_time or current.state in EXITED_PROCESS_STATES:
            return
        require(time.monotonic() < deadline, "cancellation descendant remains")
        time.sleep(0.05)


@contextmanager
def running_service(
    socket_root: Path,
    staging_root: Path,
    allowed_uid: int,
    probe: Callable[[Path, Callable[[], bool]], dict],
    analyze: Callable[[Path, Path, Callable[[], bool]], dict],
    render: Callable[[Path, Path, dict, Callable[[], bool]], dict],
) -> Iterator[None]:
    ready, stop = Event(), Event()
    with ThreadPoolExecutor(max_workers=1) as executor:
        worker = executor.submit(
            serve_runner,
            socket_root,
            staging_root,
            allowed_uid,
            execute_probe=probe,
            execute_analysis=analyze,
            execute_render=render,
            stop=stop,
            ready=ready,
        )
        try:
            require(ready.wait(10), "runner service did not become ready")
            yield
        finally:
            stop.set()
            worker.result(timeout=120)
    require(not any(socket_root.iterdir()), "runner endpoints remain after shutdown")
    require(not any(staging_root.iterdir()), "runner staging remains after shutdown")


def call_runner(socket_path: Path, script: str, args: list[str]) -> dict:
    result = subprocess.run(
        ["node", "--import", "tsx", script, str(socket_path), *args],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=130,
        check=True,
    )
    require(0 < len(result.stdout) <= MAX_RESPONSE_BYTES, "invalid client receipt length")
    return decode_object(result.stdout)


def probe_over_service(endpoint: Path, source: Path) -> dict:
    return call_runner(endpoint, "scripts/decoder/probe-client-smoke.ts", [str(source)])


def check_private_artifact(path: Path) -> None:
    mode = path.lstat().st_mode
    require(stat.S_ISREG(mode) and stat.S_IMODE(mode) == 0o600, "imported artifact is not private")


def check_boundaries(image: str, source: Path, expected_hash: str) -> None:
    script = Path(__file__).with_name("boundary_probe.py").read_bytes()
    with container_stream(
        image,
        source,
        script,
        entrypoint="/usr/bin/python3",
        args=("-I", "-B", "-u", "-", expected_hash, str(source.parent), str(ROOT)),
    ) as run:
        stream = run.stdout
        for check in BOUNDARY_CHECKS:
            expected = f"{check}\n".encode("ascii")
            require(stream.readline(len(expected)) == expected, f"boundary check failed: {check}")
        require(stream.read(1) == b"", "unexpected boundary probe output")


def check_resources(image: str, source: Path) -> None:
    script = Path(__file__).with_name("resource_probe.py").read_bytes()
    for case in RESOURCE_CHECKS:
        with container_stream(
            image, source, script, entrypoint="/usr/bin/python3", args=("-I", "-B", "-u", "-", case)
        ) as run:
            stream = run.stdout
            expected = f"{case}\n".encode("ascii")
            require(stream.readline(len(expected)) == expected, f"resource check failed: {case}")
            require(stream.read(1) == b"", f"unexpected resource probe output: {case}")


def check_cancellation(image: str, source: Path) -> None:
    token = uuid.uuid4().hex
    script = Path(__file__).with_name("cancellation_probe.py").read_bytes()
    with container_stream(
        image,
        source,
        script,
        entrypoint="/usr/bin/python3",
        args=("-I", "-B", "-u", "-", token),
    ) as run:
        ready = f"{CANCELLATION_READY}\n".encode("ascii")
        require(run.stdout.readline(len(ready)) == ready, "cancellation descendant did not start")
        descendant = find_host_descendant(
            run.container_id, (CANCELLATION_CHILD_PREFIX + token).encode("ascii")
        )
        require(run.process.poll() is None, "cancellation container exited before stop")
        run.stop()
        verify_descendant_gone(*descendant)


def hash_file(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def host_probe(path: Path) -> tuple[int, int, int, bool, str]:
    output = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height",
            "-of",
            "json",
            str(path),
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=15,
        check=True,
    )
    data = json.loads(output.stdout)
    videos = [stream for stream in data["streams"] if stream["codec_type"] == "video"]
    require(len(videos) == 1, "expected a single video stream")
    video = videos[0]
    seconds = data["format"].get("duration", 0)
    return (
        video["width"],
        video["height"],
        round(float(seconds) * 1000),
        any(stream["codec_type"] == "audio" for stream in data["streams"]),
        video["codec_name"],
    )


def check_decode(path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-xerror",
            "-nostdin",
            "-threads",
            "2",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            str(path),
            "-f",
            "null",
            "-",
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
        check=True,
    )


def fixture_render_plan() -> dict:
    return {
        "version": 1,
        "startMs": 800,
        "endMs": 2800,
        "layout": "crop",
        "profile": "standard",
        "crop": {"x": 0, "y": 0, "width": 1, "height": 1},
        "facecam": {"x": 0, "y": 0, "width": 1, "height": 1},
        "muteAudio": True,
        "captions": [{"startMs": 200, "endMs": 1500, "text": "Original test footage"}],
    }


def check_runner_service(image: str, root: Path, source: Path) -> int:
    socket_root, staging_root = root / "sockets", root / "runner-staging"
    analysis_receiving_root, render_receiving_root = root / "analyze", root / "render"
    for directory in (socket_root, staging_root, analysis_receiving_root, render_receiving_root):
        directory.mkdir(mode=0o700)
    analyze_dir = analysis_receiving_root / "analysis-attempt"
    render_path = render_receiving_root / "render-attempt.mp4"

    original_hash = hash_file(source)
    invalid = root / "invalid-media"
    invalid.write_bytes(b"not a supported media container")
    decoder = DecoderExecutor(image)
    calls: list[tuple[str, str]] = []
    plan = fixture_render_plan()

    def probe(staged: Path, cancelled: Callable[[], bool]) -> dict:
        calls.append(("probe", hash_file(staged)))
        return decoder.probe(staged, cancelled=cancelled)

    def analyze(staged: Path, output_dir: Path, cancelled: Callable[[], bool]) -> dict:
        calls.append(("analyze", hash_file(staged)))
        return decoder.analyze(staged, output_dir, cancelled=cancelled)

    def render(staged: Path, output_dir: Path, received: dict, cancelled: Callable[[], bool]) -> dict:
        calls.append(("render", hash_file(staged)))
        require(received == {"version": 1, "operation": "render", "plan": plan}, "unexpected render plan")
        return decoder.render(staged, output_dir, received, cancelled=cancelled)

    uid = os.geteuid()
    with running_service(socket_root, staging_root, uid, probe, analyze, render):
        reply = call_runner(
            socket_root,
            "scripts/decoder/isolated-media-executor-smoke.ts",
            [
                str(source),
                str(invalid),
                str(analyze_dir),
                str(render_path),
                json.dumps(plan, allow_nan=False),
            ],
        )

    with running_service(socket_root, staging_root, uid ^ 1, probe, analyze, render):
        require(
            probe_over_service(socket_root / "probe.sock", source) == {"status": "unavailable"},
            "the client did not reject the unauthorized runner exchange",
        )
    require(
        calls
        == [
            ("probe", original_hash),
            ("probe", hash_file(invalid)),
            ("analyze", original_hash),
            ("render", original_hash),
        ],
        "runner did not dispatch exactly the authorized operations and source bytes",
    )
    require(
        reply.keys() == {"metadata", "analysis", "render"}
        and all(isinstance(receipt, dict) for receipt in reply.values()),
        "invalid isolated executor receipt",
    )
    metadata, analyzed, rendered = reply["metadata"], reply["analysis"], reply["render"]
    require(
        (metadata["width"], metadata["height"], metadata["durationMs"], metadata["codec"])
        == (1280, 720, 24000, "h264")
        and metadata["hasAudio"] is True,
        "container probe does not match the fixture",
    )
    require(analyzed["metadata"] == metadata, "analysis source metadata differs from probe")
    candidates = analyzed["candidates"]
    require(isinstance(candidates, list) and 1 <= len(candidates) <= 8, "invalid fixture candidates")
    thumbnails = ["poster.jpg", *(f"thumb-{index}.jpg" for index in range(len(candidates)))]
    directory_mode = analyze_dir.lstat().st_mode
    require(
        stat.S_ISDIR(directory_mode)
        and stat.S_IMODE(directory_mode) == 0o700
        and list(analysis_receiving_root.iterdir()) == [analyze_dir]
        and {path.name for path in analyze_dir.iterdir()} == {"proxy.mp4", *thumbnails}
        and list(render_receiving_root.iterdir()) == [render_path],
        "executor output differs from the private import contract",
    )
    for name in ["proxy.mp4", *thumbnails]:
        check_private_artifact(analyze_dir / name)
    check_private_artifact(render_path)
    proxy = analyze_dir / "proxy.mp4"
    width, height, duration, audio, codec = host_probe(proxy)
    require(
        (width, height, audio, codec) == (640, 360, True, "h264") and abs(duration - 24000) <= 125,
        "analysis proxy has unexpected metadata",
    )
    check_decode(proxy)
    for image_name in thumbnails:
        thumbnail = analyze_dir / image_name
        require(host_probe(thumbnail)[:2] == (640, 360), "analysis image has unexpected dimensions")
        check_decode(thumbnail)
    require(host_probe(render_path) == (720, 1280, 2000, False, "h264"), "render has unexpected metadata")
    require(
        (rendered["width"], rendered["height"], rendered["durationMs"], rendered["codec"])
        == (720, 1280, 2000, "h264")
        and rendered["hasAudio"] is False,
        "container render metadata differs from output",
    )
    check_decode(render_path)
    require(hash_file(source) == original_hash, "service source bytes changed")
    return len(candidates) + 2


def check_post_intake_cancellation(image: str, root: Path, source: Path) -> None:
    socket_root, staging_root = root / "cancel-sockets", root / "cancel-staging"
    socket_root.mkdir(mode=0o700)
    staging_root.mkdir(mode=0o700)
    accepted, verified = Event(), Event()
    source_hash = hash_file(source)
    request = {"version": 1, "operation": "render", "plan": fixture_render_plan()}
    decoder = DecoderExecutor(image)

    def probe(staged: Path, cancelled: Callable[[], bool]) -> dict:
        require(hash_file(staged) == source_hash, "reused service received different source bytes")
        return decoder.probe(staged, cancelled=cancelled)

    def render(staged: Path, output_dir: Path, received: dict, cancelled: Callable[[], bool]) -> dict:
        require(received == request and hash_file(staged) == source_hash, "invalid cancellation fixture")
        token = uuid.uuid4().hex
        script = Path(__file__).with_name("cancellation_probe.py").read_bytes()
        descendant = None
        container_id = None
        try:
            with container_stream(
                image,
                staged,
                script,
                entrypoint="/usr/bin/python3",
                args=("-I", "-B", "-u", "-", token),
                cancelled=cancelled,
            ) as run:
                ready = f"{CANCELLATION_READY}\n".encode("ascii")
                require(run.stdout.readline(len(ready)) == ready, "accepted decoder descendant did not start")
                container_id = run.container_id
                descendant = find_host_descendant(
                    container_id, (CANCELLATION_CHILD_PREFIX + token).encode("ascii")
                )
                require(
                    run.process.poll() is None and not cancelled(), "half-closed client did not stay active"
                )
                output_dir.mkdir(mode=0o700)
                (output_dir / "render.mp4").write_bytes(b"tentative synthetic data")
                accepted.set()
                run.stdout.read(1)
                raise SmokeError("post-intake cancellation did not interrupt the output read")
        except DecoderCancelled:
            if descendant is None or container_id is None:
                raise SmokeError("decoder cancelled before the live witness") from None
            verify_descendant_gone(*descendant)
            inspected = docker("container", "inspect", container_id)
            require(
                inspected.returncode == 1
                and inspected.stdout.strip() in ("", "[]")
                and inspected.stderr.strip()
                in {
                    f"Error: No such container: {container_id}",
                    f"Error response from daemon: No such container: {container_id}",
                },
                "cancelled decoder container still exists",
            )
            verified.set()
            raise

    def analyze(staged: Path, output_dir: Path, cancelled: Callable[[], bool]) -> dict:
        return decoder.analyze(staged, output_dir, cancelled=cancelled)

    with running_service(socket_root, staging_root, os.geteuid(), probe, analyze, render):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(10)
            client.connect(str(socket_root / "render.sock"))
            encoded = json.dumps(request).encode("utf-8")
            client.sendall(len(encoded).to_bytes(4, "big") + encoded)
            with source.open("rb") as content:
                client.sendall(os.fstat(content.fileno()).st_size.to_bytes(4, "big"))
                while chunk := content.read(CHUNK_BYTES):
                    client.sendall(chunk)
            client.shutdown(socket.SHUT_WR)
            require(accepted.wait(15), "render did not reach the post-intake witness")
        require(verified.wait(20), "disconnect did not promptly remove the accepted decoder")
        reply = probe_over_service(socket_root / "probe.sock", source)
        require(
            reply.get("status") == "ok" and reply["metadata"]["durationMs"] == 24000, "runner reuse failed"
        )
        require(not any(staging_root.iterdir()), "cancelled attempt staging remains")
    require(hash_file(source) == source_hash, "cancelled request changed the source")


def run_smoke(image: str) -> None:
    require(IMAGE_ID.fullmatch(image) is not None, "expected a full immutable Docker image ID")
    subprocess.run(
        ["npm", "run", "--silent", "decoder:preflight", "--", "--image", image],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        timeout=40,
        check=True,
    )
    initial_hash = hash_file(FIXTURE)
    source_shape = host_probe(FIXTURE)
    require(source_shape == (1280, 720, 24000, True, "h264"), "unexpected synthetic fixture metadata")
    with tempfile.TemporaryDirectory(prefix="cliplane-decoder-smoke-") as temporary:
        root = Path(temporary)
        # A writable-mode synthetic copy makes EROFS distinguish the mount from POSIX permissions.
        source = root / "original.mp4"
        require(not any(char in str(source) for char in ',\r\n"'), "unsupported fixture staging path")
        shutil.copyfile(FIXTURE, source)
        source.chmod(0o666)
        second_source = root / UNMOUNTED_SOURCE_NAME
        shutil.copyfile(FIXTURE, second_source)
        require(hash_file(second_source) == initial_hash, "unmounted fixture staging failed")
        check_boundaries(image, source, initial_hash)
        check_resources(image, source)
        check_cancellation(image, source)
        analyze_artifacts = check_runner_service(image, root, source)
        check_post_intake_cancellation(image, root, source)
        require(hash_file(source) == initial_hash, "mounted synthetic source bytes changed")
    require(hash_file(FIXTURE) == initial_hash, "synthetic fixture bytes changed")
    print(
        json.dumps(
            {
                "phase": "decoder-image-smoke",
                "verdict": "passed",
                "decoderIsolationQualified": False,
                "boundaryChecks": BOUNDARY_CHECKS,
                "resourceChecks": list(RESOURCE_CHECKS),
                "cancellationVerified": True,
                "probeTransportVerified": True,
                "probeListenerClientVerified": True,
                "analysisTransportVerified": True,
                "analysisClientVerified": True,
                "renderTransportVerified": True,
                "renderClientVerified": True,
                "runnerServiceVerified": True,
                "runnerExecutorVerified": True,
                "isolatedMediaExecutorVerified": True,
                "postIntakeCancellationVerified": True,
                "analyzeArtifacts": analyze_artifacts,
                "render": {"width": 720, "height": 1280, "durationMs": 2000, "hasAudio": False},
                "sourceUnchanged": True,
            }
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="trusted, built decoder image SHA-256 ID")
    args = parser.parse_args()
    try:
        run_smoke(args.image)
    except SmokeError as error:
        print(f"Decoder smoke failed: {error}", file=sys.stderr)
        return 1
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError):
        print("Decoder smoke failed: tool, media or bundle error", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
