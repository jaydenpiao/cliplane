"""CI smoke for one trusted synthetic fixture and one built decoder image."""

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import signal
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
from typing import BinaryIO, cast

from boundary_probe import BOUNDARY_CHECKS, UNMOUNTED_SOURCE_NAME
from cancellation_probe import CANCELLATION_CHILD_PREFIX, CANCELLATION_READY
from probe_transport import MAX_RESPONSE_BYTES, ProbeUnsupported
from resource_probe import RESOURCE_CHECKS

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "workers/media"))
from artifact_protocol import MAX_MANIFEST_BYTES, decode_object, read_bundle
from pipeline import PROBE_INPUT_REJECTED
from runner_service import serve_runner

FIXTURE = ROOT / "packages/test-fixtures/nightdrift-original.mp4"
IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}")
CONTAINER_ID = re.compile(r"[a-f0-9]{64}")
OWNER_LABEL = "io.cliplane.decoder-smoke"
OWNERSHIP_FORMAT = (
    '{"id":{{json .Id}},"image":{{json .Image}},'
    f'"owner":{{{{json (index .Config.Labels "{OWNER_LABEL}")}}}}}}'
)
PROXY_NAMES = ("HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "ALL_PROXY", "NO_PROXY")
EXITED_PROCESS_STATES = (b"Z", b"X", b"x")


class SmokeError(ValueError):
    """A stable smoke-check failure that can be shown in CI."""


class DecoderExit(SmokeError):
    def __init__(self, status: int) -> None:
        super().__init__("decoder exited unsuccessfully")
        self.status = status


def require(condition: bool, failure: str) -> None:
    if not condition:
        raise SmokeError(failure)


def docker(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", *args], timeout=8, stdin=subprocess.DEVNULL, capture_output=True, text=True, check=False
    )


def owned_container(target: str, token: str, image: str, *, allow_absent: bool = False) -> str | None:
    result = docker("container", "inspect", "--format", OWNERSHIP_FORMAT, target)
    if (
        allow_absent
        and result.returncode == 1
        and not result.stdout.strip()
        and result.stderr.strip()
        in {f"Error: No such container: {target}", f"Error response from daemon: No such container: {target}"}
    ):
        return None
    require(result.returncode == 0, "container identity lookup failed")
    record = json.loads(result.stdout)
    identity = record.get("id")
    if (
        not isinstance(identity, str)
        or not CONTAINER_ID.fullmatch(identity)
        or (CONTAINER_ID.fullmatch(target) and target != identity)
        or record.get("owner") != token
        or record.get("image") != image
    ):
        raise SmokeError("container ownership could not be verified")
    return identity


def remove_owned_container(container_id: str, token: str, image: str) -> None:
    removed = docker("container", "rm", "--force", container_id)
    require(removed.returncode == 0, "owned container cleanup failed")
    require(owned_container(container_id, token, image, allow_absent=True) is None, "owned container remains")


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
def container_stream(
    image: str,
    source: Path,
    input_data: bytes,
    *,
    entrypoint: str | None = None,
    args: tuple[str, ...] = (),
    cancellation_token: bytes | None = None,
) -> Iterator[BinaryIO]:
    token = uuid.uuid4().hex
    name = f"cliplane-decoder-smoke-{token}"
    container_id = None
    removed = False
    try:
        created = docker(
            "container",
            "create",
            "--name",
            name,
            "--label",
            f"{OWNER_LABEL}={token}",
            "--pull=never",
            "--interactive",
            # OpenStdin + AttachStdin enables Docker's StdinOnce behavior on disconnect.
            "--attach=stdin",
            "--attach=stdout",
            "--attach=stderr",
            "--read-only",
            "--user=65534:65534",
            "--network=none",
            "--ipc=none",
            "--log-driver=none",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--cgroupns=private",
            "--memory=384m",
            "--memory-swap=384m",
            "--cpus=1",
            "--pids-limit=48",
            "--ulimit=fsize=67108864:67108864",
            "--tmpfs=/work:rw,noexec,nosuid,nodev,size=192m,uid=65534,gid=65534,mode=0700",
            "--mount",
            f"type=bind,src={source},dst=/input/source,readonly",
            # Explicit empty values override proxy configuration from Docker CLI defaults.
            *(f"--env={key}=" for name in PROXY_NAMES for key in (name, name.lower())),
            *(("--entrypoint", entrypoint) if entrypoint is not None else ()),
            image,
            *args,
        )
        candidate_id = created.stdout.strip()
        require(
            created.returncode == 0 and bool(CONTAINER_ID.fullmatch(candidate_id)), "container create failed"
        )
        container_id = owned_container(candidate_id, token, image)
        if container_id is None:
            raise SmokeError("container identity unavailable")
        with tempfile.TemporaryFile(dir=source.parent) as request_file:
            request_file.write(input_data)
            request_file.seek(0)
            # A separate process group and an external deadline keep even a stalled pipe read bounded.
            process = subprocess.Popen(
                ["timeout", "--signal=KILL", "75s", "docker", "container", "start", "-ai", container_id],
                stdin=request_file,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            try:
                if process.stdout is None:
                    raise SmokeError("decoder output stream missing")
                yield cast(BinaryIO, process.stdout)
                if cancellation_token is None:
                    status = process.wait(timeout=5)
                    if status != 0:
                        raise DecoderExit(status)
                else:
                    descendant = find_host_descendant(container_id, cancellation_token)
                    require(process.poll() is None, "cancellation container exited before stop")
                    # Force removal stops the identified container while its client is still attached.
                    remove_owned_container(container_id, token, image)
                    removed = True
                    verify_descendant_gone(*descendant)
            finally:
                if process.poll() is None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=5)
                if process.stdout is not None:
                    process.stdout.close()
    finally:
        if not removed:
            # Resolve an ambiguous create by the opaque label, never by name alone.
            target = container_id or owned_container(name, token, image, allow_absent=True)
            if target is not None:
                remove_owned_container(target, token, image)


def decode(image: str, source: Path, request: dict, destination: Path) -> dict:
    with container_stream(image, source, json.dumps(request).encode("utf-8")) as stream:
        return read_bundle(stream, destination, request["operation"])


def execute_container_probe(image: str, source: Path) -> dict:
    output = None
    try:
        with container_stream(image, source, b'{"version":1,"operation":"probe"}') as stream:
            output = stream.read(4 + MAX_MANIFEST_BYTES + 1)
    except DecoderExit as error:
        if error.status == PROBE_INPUT_REJECTED and output == b"":
            raise ProbeUnsupported() from None
        raise
    return read_bundle(io.BytesIO(output), source.parent / "bundle", "probe")


@contextmanager
def running_service(
    socket_root: Path,
    staging_root: Path,
    allowed_uid: int,
    probe: Callable[[Path], dict],
    analyze: Callable[[Path, Path], dict],
    render: Callable[[Path, Path, dict], dict],
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


def call_runner(endpoint: Path, script: str, args: list[str]) -> dict:
    result = subprocess.run(
        ["node", "--import", "tsx", script, str(endpoint), *args],
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


def private_receipt(receiving_root: Path, attempt: object, prefix: str, names: list[str]) -> Path:
    if not isinstance(attempt, str) or re.fullmatch(rf"{prefix}-[A-Za-z0-9]+", attempt) is None:
        raise SmokeError("invalid artifact attempt name")
    directory = receiving_root / attempt
    directory_mode = directory.lstat().st_mode
    require(
        stat.S_ISDIR(directory_mode)
        and stat.S_IMODE(directory_mode) == 0o700
        and list(receiving_root.iterdir()) == [directory]
        and {path.name for path in directory.iterdir()} == set(names),
        "client staging differs from the private import contract",
    )
    for name in names:
        mode = (directory / name).lstat().st_mode
        require(stat.S_ISREG(mode) and stat.S_IMODE(mode) == 0o600, "imported artifact is not private")
    return directory


def analyze_over_service(endpoint: Path, source: Path, receiving_root: Path) -> tuple[dict, Path]:
    reply = call_runner(
        endpoint,
        "scripts/decoder/analysis-client-smoke.ts",
        [str(source), str(receiving_root)],
    )
    require(
        reply.keys() == {"attempt", "result"} and isinstance(reply["result"], dict),
        "invalid analysis receipt",
    )
    result = reply["result"]
    candidates = result["candidates"]
    require(isinstance(candidates, list) and 1 <= len(candidates) <= 8, "invalid fixture candidates")
    names = ["proxy.mp4", "poster.jpg", *(f"thumb-{index}.jpg" for index in range(len(candidates)))]
    directory = private_receipt(receiving_root, reply["attempt"], "analysis", names)
    return result, directory


def render_over_service(endpoint: Path, source: Path, receiving_root: Path, plan: dict) -> tuple[dict, Path]:
    reply = call_runner(
        endpoint,
        "scripts/decoder/render-client-smoke.ts",
        [str(source), str(receiving_root), json.dumps(plan, allow_nan=False)],
    )
    require(
        reply.keys() == {"attempt", "metadata"} and isinstance(reply["metadata"], dict),
        "invalid render import receipt",
    )
    directory = private_receipt(receiving_root, reply["attempt"], "render", ["render.mp4"])
    return reply["metadata"], directory / "render.mp4"


def check_boundaries(image: str, source: Path, expected_hash: str) -> None:
    script = Path(__file__).with_name("boundary_probe.py").read_bytes()
    with container_stream(
        image,
        source,
        script,
        entrypoint="/usr/bin/python3",
        args=("-I", "-B", "-u", "-", expected_hash, str(source.parent), str(ROOT)),
    ) as stream:
        for check in BOUNDARY_CHECKS:
            expected = f"{check}\n".encode("ascii")
            require(stream.readline(len(expected)) == expected, f"boundary check failed: {check}")
        require(stream.read(1) == b"", "unexpected boundary probe output")


def check_resources(image: str, source: Path) -> None:
    script = Path(__file__).with_name("resource_probe.py").read_bytes()
    for case in RESOURCE_CHECKS:
        with container_stream(
            image, source, script, entrypoint="/usr/bin/python3", args=("-I", "-B", "-u", "-", case)
        ) as stream:
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
        cancellation_token=(CANCELLATION_CHILD_PREFIX + token).encode("ascii"),
    ) as stream:
        ready = f"{CANCELLATION_READY}\n".encode("ascii")
        require(stream.readline(len(ready)) == ready, "cancellation descendant did not start")


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


def check_runner_service(image: str, root: Path, source: Path) -> int:
    socket_root, staging_root = root / "sockets", root / "runner-staging"
    analysis_receiving_root, render_receiving_root = root / "analyze", root / "render"
    for directory in (socket_root, staging_root, analysis_receiving_root, render_receiving_root):
        directory.mkdir(mode=0o700)

    original_hash = hash_file(source)
    invalid = root / "invalid-media"
    invalid.write_bytes(b"not a supported media container")
    calls: list[tuple[str, str]] = []
    plan = {
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

    def probe(staged: Path) -> dict:
        calls.append(("probe", hash_file(staged)))
        return execute_container_probe(image, staged)

    def analyze(staged: Path, output_dir: Path) -> dict:
        calls.append(("analyze", hash_file(staged)))
        return decode(image, staged, {"version": 1, "operation": "analyze"}, output_dir)

    def render(staged: Path, output_dir: Path, received: dict) -> dict:
        calls.append(("render", hash_file(staged)))
        require(received == {"version": 1, "operation": "render", "plan": plan}, "unexpected render plan")
        return decode(image, staged, received, output_dir)

    uid = os.geteuid()
    with running_service(socket_root, staging_root, uid, probe, analyze, render):
        reply = probe_over_service(socket_root / "probe.sock", source)
        require(
            reply.keys() == {"status", "metadata"}
            and reply["status"] == "ok"
            and isinstance(reply["metadata"], dict),
            "valid fixture probe did not return metadata",
        )
        metadata = reply["metadata"]
        require(
            probe_over_service(socket_root / "probe.sock", invalid) == {"status": "unsupported"},
            "invalid media did not return an unsupported probe response",
        )
        analyzed, analyze_dir = analyze_over_service(
            socket_root / "analyze.sock", source, analysis_receiving_root
        )
        rendered, render_path = render_over_service(
            socket_root / "render.sock", source, render_receiving_root, plan
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
        (metadata["width"], metadata["height"], metadata["durationMs"], metadata["codec"])
        == (1280, 720, 24000, "h264")
        and metadata["hasAudio"] is True,
        "container probe does not match the fixture",
    )
    require(analyzed["metadata"] == metadata, "analysis source metadata differs from probe")
    candidates = analyzed["candidates"]
    proxy = analyze_dir / "proxy.mp4"
    width, height, duration, audio, codec = host_probe(proxy)
    require(
        (width, height, audio, codec) == (640, 360, True, "h264") and abs(duration - 24000) <= 125,
        "analysis proxy has unexpected metadata",
    )
    check_decode(proxy)
    for image_name in ["poster.jpg", *(f"thumb-{index}.jpg" for index in range(len(candidates)))]:
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
