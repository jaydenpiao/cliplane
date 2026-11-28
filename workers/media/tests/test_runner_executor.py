import io
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/decoder"))
from artifact_protocol import MAX_MANIFEST_BYTES, BundleError, write_bundle
from decoder import MAX_REQUEST_BYTES, read_request
from decoder_container import DecoderCancelled, DecoderExit
from pipeline import PROBE_INPUT_REJECTED
from probe_transport import ProbeUnsupported
from runner_executor import DecoderExecutor

IMAGE = "sha256:" + "a" * 64
RENDER_REQUEST = {"version": 1, "operation": "render", "plan": {"title": "Café"}}


class RunnerExecutorTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.input = self.root / "input"
        self.input.mkdir()
        self.source = self.input / "source"
        self.source.write_bytes(b"staged original")
        self.destination = self.input / "imported"
        self.output = self.root / "decoder-output"
        self.output.mkdir()
        self.calls = []
        self.cancellations = []

    def bundle(self, operation, result, files):
        for name, content in files.items():
            (self.output / name).write_bytes(content)
        stream = io.BytesIO()
        write_bundle(stream, operation, result, self.output)
        return stream.getvalue()

    def backend(self, output, failure=None):
        @contextmanager
        def attach(image, source, encoded, *, cancelled=None):
            self.calls.append((image, source, read_request(io.BytesIO(encoded))))
            self.cancellations.append(cancelled)
            with io.BytesIO(output) as stdout:
                yield SimpleNamespace(stdout=stdout)
            if failure:
                raise failure

        return patch("runner_executor.container_stream", attach)

    def test_requires_a_full_immutable_image_id(self):
        for invalid in ("cliplane-decoder:latest", "sha256:" + "a" * 63, IMAGE + "x", IMAGE.upper()):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                DecoderExecutor(invalid)

    def test_probe_imports_only_metadata_and_leaves_no_probe_scratch(self):
        result = {"width": 1280, "height": 720}
        output = self.bundle("probe", result, {})
        with self.backend(output):
            self.assertEqual(DecoderExecutor(IMAGE).probe(self.source), result)
        self.assertEqual(self.calls, [(IMAGE, self.source, {"version": 1, "operation": "probe"})])
        self.assertEqual(list(self.input.iterdir()), [self.source])

    def test_probe_maps_only_empty_output_and_the_explicit_input_rejection_exit(self):
        rejection = DecoderExit(PROBE_INPUT_REJECTED)
        for output, failure, expected in (
            (b"", rejection, ProbeUnsupported),
            (b"", DecoderExit(1), DecoderExit),
            (b"nonempty stdout", rejection, DecoderExit),
            (b"", RuntimeError("cleanup failed"), RuntimeError),
        ):
            with self.subTest(output=output, failure=failure), self.backend(output, failure):
                with self.assertRaises(expected):
                    DecoderExecutor(IMAGE).probe(self.source)
                self.assertEqual(list(self.input.iterdir()), [self.source])

    def test_probe_rejects_output_above_the_manifest_bound(self):
        output = b"x" * (4 + MAX_MANIFEST_BYTES + 1)
        with self.backend(output), self.assertRaises(BundleError):
            DecoderExecutor(IMAGE).probe(self.source)
        self.assertEqual(list(self.input.iterdir()), [self.source])

    def test_analysis_and_render_import_actual_bundles_and_use_fixed_decoder_requests(self):
        executor = DecoderExecutor(IMAGE)
        analysis = {"candidates": [{"thumbnail": "thumb-0.jpg"}]}
        files = {"proxy.mp4": b"proxy", "poster.jpg": b"poster", "thumb-0.jpg": b"thumbnail"}
        with self.backend(self.bundle("analyze", analysis, files)):
            self.assertEqual(executor.analyze(self.source, self.destination), analysis)
        self.assertEqual({path.name: path.read_bytes() for path in self.destination.iterdir()}, files)

        render_destination = self.input / "rendered"
        result = {"durationMs": 1000}
        render_bytes = bytes(range(256))
        with self.backend(self.bundle("render", result, {"render.mp4": render_bytes})):
            self.assertEqual(executor.render(self.source, render_destination, RENDER_REQUEST), result)
        self.assertEqual((render_destination / "render.mp4").read_bytes(), render_bytes)
        self.assertEqual(
            self.calls,
            [
                (IMAGE, self.source, {"version": 1, "operation": "analyze"}),
                (IMAGE, self.source, RENDER_REQUEST),
            ],
        )
        self.assertEqual(self.source.read_bytes(), b"staged original")

    def test_invalid_render_request_fails_before_attaching_a_container(self):
        invalid_requests = (
            {"version": 1, "operation": "analyze"},
            {**RENDER_REQUEST, "version": True},
            {**RENDER_REQUEST, "extra": "not a decoder field"},
            {**RENDER_REQUEST, "plan": {"value": float("nan")}},
            {**RENDER_REQUEST, "plan": {"title": "x" * MAX_REQUEST_BYTES}},
        )
        with patch("runner_executor.container_stream") as attach:
            executor = DecoderExecutor(IMAGE)
            for request in invalid_requests:
                with self.subTest(request_keys=request.keys()), self.assertRaises(BundleError):
                    executor.render(self.source, self.destination, request)
            attach.assert_not_called()
        self.assertFalse(self.destination.exists())

    def test_failed_exit_or_cleanup_disposes_the_imported_attempt(self):
        output = self.bundle("render", {"durationMs": 1000}, {"render.mp4": b"artifact"})
        original = self.input / "unrelated"
        original.write_bytes(b"keep")
        executor = DecoderExecutor(IMAGE)
        for failure in (DecoderExit(7), RuntimeError("cleanup failed")):
            with (
                self.subTest(failure=failure),
                self.backend(output, failure),
                self.assertRaises(type(failure)) as cm,
            ):
                executor.render(self.source, self.destination, RENDER_REQUEST)
            self.assertIs(cm.exception, failure)
            self.assertFalse(self.destination.exists())
            self.assertEqual(original.read_bytes(), b"keep")

    def test_failed_import_does_not_remove_a_preexisting_destination(self):
        self.destination.mkdir()
        existing = self.destination / "render.mp4"
        existing.write_bytes(b"keep")
        output = self.bundle("render", {}, {"render.mp4": b"new"})
        with self.backend(output), self.assertRaises(FileExistsError):
            DecoderExecutor(IMAGE).render(self.source, self.destination, RENDER_REQUEST)
        self.assertEqual(existing.read_bytes(), b"keep")

    def test_all_operations_forward_cancellation_and_discard_cancelled_attempts(self):
        def disconnected() -> bool:
            return True

        executor = DecoderExecutor(IMAGE)
        with self.backend(b"", DecoderCancelled()), self.assertRaises(DecoderCancelled):
            executor.probe(self.source, cancelled=disconnected)

        analysis_bundle = self.bundle(
            "analyze", {"candidates": []}, {"proxy.mp4": b"proxy", "poster.jpg": b"poster"}
        )
        with self.backend(analysis_bundle, DecoderCancelled()), self.assertRaises(DecoderCancelled):
            executor.analyze(self.source, self.destination, cancelled=disconnected)
        self.assertFalse(self.destination.exists())

        render_bundle = self.bundle("render", {}, {"render.mp4": b"render"})
        with self.backend(render_bundle, DecoderCancelled()), self.assertRaises(DecoderCancelled):
            executor.render(self.source, self.destination, RENDER_REQUEST, cancelled=disconnected)
        self.assertFalse(self.destination.exists())
        self.assertEqual(self.cancellations, [disconnected] * 3)
        self.assertEqual(list(self.input.iterdir()), [self.source])
