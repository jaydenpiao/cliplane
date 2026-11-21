"""CI smoke for one trusted synthetic fixture and one built decoder image."""

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO, cast

from boundary_probe import BOUNDARY_CHECKS, UNMOUNTED_SOURCE_NAME

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "workers/media"))
from artifact_protocol import read_bundle

FIXTURE = ROOT / "packages/test-fixtures/nightdrift-original.mp4"
IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}")
CONTAINER_ID = re.compile(r"[a-f0-9]{64}")
OWNER_LABEL = "io.cliplane.decoder-smoke"
OWNERSHIP_FORMAT = (
    '{"id":{{json .Id}},"image":{{json .Image}},'
    f'"owner":{{{{json (index .Config.Labels "{OWNER_LABEL}")}}}}}}'
)
PROXY_NAMES = ("HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "ALL_PROXY", "NO_PROXY")


class SmokeError(ValueError):
    """A stable smoke-check failure that can be shown in CI."""


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


@contextmanager
def container_stream(
    image: str,
    source: Path,
    input_data: bytes,
    *,
    entrypoint: str | None = None,
    args: tuple[str, ...] = (),
) -> Iterator[BinaryIO]:
    token = uuid.uuid4().hex
    name = f"cliplane-decoder-smoke-{token}"
    container_id = None
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
                require(process.wait(timeout=5) == 0, "decoder exited unsuccessfully")
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
        # Resolve an ambiguous create by the opaque label, never by name alone.
        target = container_id or owned_container(name, token, image, allow_absent=True)
        if target is not None:
            removed = docker("container", "rm", "--force", target)
            require(removed.returncode == 0, "owned container cleanup failed")
            require(
                owned_container(target, token, image, allow_absent=True) is None, "owned container remains"
            )


def decode(image: str, source: Path, request: dict, destination: Path) -> dict:
    with container_stream(image, source, json.dumps(request).encode("utf-8")) as stream:
        return read_bundle(stream, destination, request["operation"])


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
        metadata = decode(image, source, {"version": 1, "operation": "probe"}, root / "probe")
        require(
            (metadata["width"], metadata["height"], metadata["durationMs"], metadata["codec"])
            == (1280, 720, 24000, "h264")
            and metadata["hasAudio"] is True,
            "container probe does not match the fixture",
        )
        analyze_dir = root / "analyze"
        analyzed = decode(image, source, {"version": 1, "operation": "analyze"}, analyze_dir)
        require(analyzed["metadata"] == metadata, "analysis source metadata differs from probe")
        candidates = analyzed["candidates"]
        require(
            isinstance(candidates, list) and 1 <= len(candidates) <= 8, "invalid analysis candidate count"
        )
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
        render_dir = root / "render"
        rendered = decode(
            image,
            source,
            {
                "version": 1,
                "operation": "render",
                "plan": {
                    "version": 1,
                    "startMs": 800,
                    "endMs": 2800,
                    "layout": "crop",
                    "profile": "standard",
                    "muteAudio": True,
                    "captions": [{"startMs": 200, "endMs": 1500, "text": "Original test footage"}],
                },
            },
            render_dir,
        )
        render_path = render_dir / "render.mp4"
        require(host_probe(render_path) == (720, 1280, 2000, False, "h264"), "render has unexpected metadata")
        require(
            (rendered["width"], rendered["height"], rendered["durationMs"], rendered["codec"])
            == (720, 1280, 2000, "h264")
            and rendered["hasAudio"] is False,
            "container render metadata differs from output",
        )
        check_decode(render_path)
        require(hash_file(source) == initial_hash, "mounted synthetic source bytes changed")
    require(hash_file(FIXTURE) == initial_hash, "synthetic fixture bytes changed")
    print(
        json.dumps(
            {
                "phase": "decoder-image-smoke",
                "verdict": "passed",
                "decoderIsolationQualified": False,
                "boundaryChecks": BOUNDARY_CHECKS,
                "analyzeArtifacts": len(candidates) + 2,
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
