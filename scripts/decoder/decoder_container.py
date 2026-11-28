"""Runner-only lifecycle for one owned, isolated decoder container."""

import json
import os
import re
import signal
import stat
import subprocess
import tempfile
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO, cast

IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}")
_CONTAINER_ID = re.compile(r"[a-f0-9]{64}")
_OWNER_LABEL = "io.cliplane.decoder-smoke"
_OWNERSHIP_FORMAT = (
    '{"id":{{json .Id}},"image":{{json .Image}},'
    f'"owner":{{{{json (index .Config.Labels "{_OWNER_LABEL}")}}}}}}'
)
_PROXY_NAMES = ("HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "ALL_PROXY", "NO_PROXY")


class DecoderExit(ValueError):
    """The attached decoder completed with a nonzero status."""

    def __init__(self, status: int) -> None:
        super().__init__("decoder exited unsuccessfully")
        self.status = status


class DecoderContainerError(ValueError):
    """The runner could not safely start or clean up its container."""


def docker(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", *args], timeout=8, stdin=subprocess.DEVNULL, capture_output=True, text=True, check=False
    )


def _owned_container(target: str, token: str, image: str, *, allow_absent: bool = False) -> str | None:
    result = docker("container", "inspect", "--format", _OWNERSHIP_FORMAT, target)
    if (
        allow_absent
        and result.returncode == 1
        and not result.stdout.strip()
        and result.stderr.strip()
        in {f"Error: No such container: {target}", f"Error response from daemon: No such container: {target}"}
    ):
        return None
    if result.returncode != 0:
        raise DecoderContainerError("container identity lookup failed")
    try:
        record = json.loads(result.stdout)
    except ValueError:
        raise DecoderContainerError("container identity lookup failed") from None
    identity = record.get("id") if isinstance(record, dict) else None
    if (
        not isinstance(identity, str)
        or not _CONTAINER_ID.fullmatch(identity)
        or (_CONTAINER_ID.fullmatch(target) and target != identity)
        or record.get("owner") != token
        or record.get("image") != image
    ):
        raise DecoderContainerError("container ownership could not be verified")
    return identity


def _remove_owned_container(container_id: str, token: str, image: str) -> None:
    if (
        not _CONTAINER_ID.fullmatch(container_id)
        or _owned_container(container_id, token, image) != container_id
    ):
        raise DecoderContainerError("container ownership could not be verified")
    removed = docker("container", "rm", "--force", container_id)
    if removed.returncode != 0:
        raise DecoderContainerError("owned container cleanup failed")
    if _owned_container(container_id, token, image, allow_absent=True) is not None:
        raise DecoderContainerError("owned container remains")


@dataclass
class AttachedDecoder:
    stdout: BinaryIO
    container_id: str
    process: subprocess.Popen[bytes]
    _token: str
    _image: str
    _stopped: bool = field(init=False, default=False)

    def stop(self) -> None:
        """Force removal of the reverified owned container for trusted diagnostics."""
        if not self._stopped:
            _remove_owned_container(self.container_id, self._token, self._image)
            self._stopped = True


@contextmanager
def container_stream(
    image: str,
    source: Path,
    input_data: bytes,
    *,
    entrypoint: str | None = None,
    args: tuple[str, ...] = (),
) -> Iterator[AttachedDecoder]:
    """Attach to one fixed-profile decoder using a file under trusted staging.

    Only runner-controlled diagnostics may override the image entrypoint or arguments.
    """
    if not IMAGE_ID.fullmatch(image):
        raise DecoderContainerError("expected a full immutable Docker image ID")
    if not source.is_absolute() or any(character in str(source) for character in ",'\"\r\n\0"):
        raise DecoderContainerError("unsafe decoder source path")
    if not stat.S_ISREG(source.lstat().st_mode):
        raise DecoderContainerError("decoder source must be a regular file")

    token = uuid.uuid4().hex
    name = f"cliplane-decoder-smoke-{token}"
    container_id = None
    attached = None
    try:
        created = docker(
            "container",
            "create",
            "--name",
            name,
            "--label",
            f"{_OWNER_LABEL}={token}",
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
            *(f"--env={key}=" for name in _PROXY_NAMES for key in (name, name.lower())),
            *(("--entrypoint", entrypoint) if entrypoint is not None else ()),
            image,
            *args,
        )
        candidate_id = created.stdout.strip()
        if created.returncode != 0 or not _CONTAINER_ID.fullmatch(candidate_id):
            raise DecoderContainerError("container create failed")
        container_id = _owned_container(candidate_id, token, image)
        if container_id is None:
            raise DecoderContainerError("container identity unavailable")
        with tempfile.TemporaryFile(dir=source.parent) as request_file:
            request_file.write(input_data)
            request_file.seek(0)
            # A separate process group and an external deadline keep a stalled pipe read bounded.
            process = subprocess.Popen(
                ["timeout", "--signal=KILL", "75s", "docker", "container", "start", "-ai", container_id],
                stdin=request_file,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            try:
                if process.stdout is None:
                    raise DecoderContainerError("decoder output stream missing")
                attached = AttachedDecoder(
                    cast(BinaryIO, process.stdout), container_id, process, token, image
                )
                yield attached
                if not attached._stopped:
                    status = process.wait(timeout=5)
                    if status != 0:
                        raise DecoderExit(status)
            finally:
                try:
                    if process.poll() is None:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        process.wait(timeout=5)
                finally:
                    if process.stdout is not None:
                        process.stdout.close()
    finally:
        if attached is None or not attached._stopped:
            # Resolve an ambiguous create by the opaque label, never by name alone.
            target = container_id or _owned_container(name, token, image, allow_absent=True)
            if target is not None:
                _remove_owned_container(target, token, image)
