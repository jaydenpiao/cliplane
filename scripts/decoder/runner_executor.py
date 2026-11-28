"""Fixed decoder operations for the runner's own container runtime."""

import io
import json
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from artifact_protocol import MAX_MANIFEST_BYTES, BundleError, read_bundle
from decoder import read_request
from decoder_container import IMAGE_ID, DecoderExit, container_stream
from pipeline import PROBE_INPUT_REJECTED
from probe_transport import ProbeUnsupported

PROBE_REQUEST = b'{"version":1,"operation":"probe"}'
ANALYSIS_REQUEST = b'{"version":1,"operation":"analyze"}'
MAX_PROBE_BUNDLE_BYTES = 4 + MAX_MANIFEST_BYTES


@dataclass(frozen=True, slots=True)
class DecoderExecutor:
    """Run fixed requests against one immutable decoder image."""

    image: str

    def __post_init__(self) -> None:
        if not IMAGE_ID.fullmatch(self.image):
            raise ValueError("Expected a full decoder image ID")

    def probe(self, source: Path) -> dict:
        output: bytes | None = None
        try:
            with container_stream(self.image, source, PROBE_REQUEST) as decoder:
                output = decoder.stdout.read(MAX_PROBE_BUNDLE_BYTES + 1)
                if len(output) > MAX_PROBE_BUNDLE_BYTES:
                    raise BundleError("Probe bundle exceeds the byte limit")
        except DecoderExit as error:
            if error.status == PROBE_INPUT_REJECTED and output == b"":
                raise ProbeUnsupported() from None
            raise

        if output is None:
            raise BundleError("Missing probe bundle")
        with tempfile.TemporaryDirectory(prefix="probe-reply-", dir=source.parent) as scratch:
            return read_bundle(io.BytesIO(output), Path(scratch) / "bundle", "probe")

    def analyze(self, source: Path, destination: Path) -> dict:
        return self._import_artifacts(source, destination, ANALYSIS_REQUEST, "analyze")

    def render(self, source: Path, destination: Path, request: dict) -> dict:
        try:
            encoded = json.dumps(request, allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            )
        except (TypeError, ValueError, RecursionError):
            raise BundleError("Invalid decoder request") from None
        if read_request(io.BytesIO(encoded))["operation"] != "render":
            raise BundleError("Expected a render request")
        return self._import_artifacts(source, destination, encoded, "render")

    def _import_artifacts(self, source: Path, destination: Path, request: bytes, operation: str) -> dict:
        imported = False
        try:
            with container_stream(self.image, source, request) as decoder:
                result = read_bundle(decoder.stdout, destination, operation)
                imported = True
            return result
        except BaseException:
            # The successful reader exclusively created this directory under trusted staging.
            if imported:
                shutil.rmtree(destination)
            raise
