import io
import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import artifact_protocol as protocol


def frame(manifest: dict, payload: bytes = b"") -> bytes:
    encoded = json.dumps(manifest).encode("utf-8")
    return len(encoded).to_bytes(4, "big") + encoded + payload


def manifest(operation: str, result: dict, files: list[tuple[str, int]]) -> dict:
    return {
        "version": 1,
        "operation": operation,
        "result": result,
        "artifacts": [{"name": name, "bytes": size} for name, size in files],
    }


class ArtifactProtocolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / "output"
        self.output.mkdir()
        self.destination = self.root / "staged"

    def test_analyze_round_trip_only_transfers_candidates_and_public_artifacts(self):
        result = {"candidates": [{"thumbnail": "thumb-0.jpg", "startMs": 0, "endMs": 1000}]}
        files = {"proxy.mp4": b"\x00\x01video", "poster.jpg": b"poster", "thumb-0.jpg": b"thumb"}
        for name, data in files.items():
            (self.output / name).write_bytes(data)
        (self.output / "analysis.wav").write_bytes(b"scratch")
        stream = io.BytesIO()
        protocol.write_bundle(stream, "analyze", result, self.output)
        stream.seek(0)
        self.assertEqual(protocol.read_bundle(stream, self.destination, "analyze"), result)
        self.assertEqual({path.name: path.read_bytes() for path in self.destination.iterdir()}, files)
        self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.destination / "proxy.mp4").stat().st_mode), 0o600)

    def test_render_payload_can_contain_arbitrary_binary_bytes(self):
        data = bytes(range(256)) * 500
        (self.output / "render.mp4").write_bytes(data)
        stream = io.BytesIO()
        protocol.write_bundle(stream, "render", {"durationMs": 1000}, self.output)
        stream.seek(0)
        self.assertEqual(protocol.read_bundle(stream, self.destination, "render"), {"durationMs": 1000})
        self.assertEqual((self.destination / "render.mp4").read_bytes(), data)

    def test_probe_can_transfer_metadata_without_an_output_directory(self):
        result = {"width": 1280, "height": 720}
        stream = io.BytesIO()
        protocol.write_bundle(stream, "probe", result, self.root / "unused")
        stream.seek(0)
        self.assertEqual(protocol.read_bundle(stream, self.destination, "probe"), result)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_strict_json_objects_reject_invalid_numbers_and_duplicate_keys(self):
        for encoded in (
            b'{"a":{"b":1,"b":2}}',
            b'{"a":NaN}',
            b'{"a":1e999}',
            b'{"a":"\xff"}',
            b"[]",
            b"{}{}",
            b'{"a":' + b"[" * 40 + b"0" + b"]" * 40 + b"}",
        ):
            with self.subTest(encoded=encoded[:60]), self.assertRaises(protocol.BundleError):
                protocol.decode_object(encoded)

    def test_invalid_manifests_create_no_files(self):
        empty_analysis = {"candidates": []}
        invalid = (
            ("render", manifest("probe", {}, [])),
            ("probe", {**manifest("probe", {}, []), "version": True}),
            ("render", manifest("render", {}, [("render.mp4", True)])),
            ("render", manifest("render", {}, [("render.mp4", 0)])),
            ("render", manifest("render", {}, [("../render.mp4", 1)])),
            ("render", manifest("render", {}, [("render.mp4", 1), ("render.mp4", 1)])),
            ("analyze", manifest("analyze", empty_analysis, [("poster.jpg", 1), ("proxy.mp4", 1)])),
            (
                "analyze",
                manifest(
                    "analyze",
                    {"candidates": [{"thumbnail": "poster.jpg"}]},
                    [("proxy.mp4", 1), ("poster.jpg", 1), ("thumb-0.jpg", 1)],
                ),
            ),
        )
        for expected, record in invalid:
            with self.subTest(record=record):
                with self.assertRaises(protocol.BundleError):
                    protocol.read_bundle(io.BytesIO(frame(record)), self.destination, expected)
                self.assertFalse(self.destination.exists())

    def test_length_caps_reject_before_staging(self):
        for data in (
            (protocol.MAX_MANIFEST_BYTES + 1).to_bytes(4, "big"),
            frame(manifest("analyze", {"candidates": []}, [("proxy.mp4", 1 << 26), ("poster.jpg", 1 << 26)])),
            frame(manifest("analyze", {"candidates": []}, [("proxy.mp4", (1 << 26) + 1), ("poster.jpg", 1)])),
        ):
            with self.subTest(header=data[:100]):
                with self.assertRaises(protocol.BundleError):
                    protocol.read_bundle(io.BytesIO(data), self.destination, "analyze")
                self.assertFalse(self.destination.exists())

    def test_truncation_and_trailing_bytes_remove_partial_staging(self):
        encoded = frame(
            manifest("analyze", {"candidates": []}, [("proxy.mp4", 2), ("poster.jpg", 2)]), b"abcd"
        )
        for invalid in (encoded[:3], encoded[:7], encoded[:-1], encoded + b"x"):
            with self.subTest(length=len(invalid)):
                with self.assertRaises(protocol.BundleError):
                    protocol.read_bundle(io.BytesIO(invalid), self.destination, "analyze")
                self.assertFalse(self.destination.exists())

    def test_receiver_leaves_existing_destinations_alone(self):
        data = frame(manifest("render", {}, [("render.mp4", 3)]), b"new")
        self.destination.mkdir()
        existing = self.destination / "render.mp4"
        existing.write_bytes(b"existing")
        with self.assertRaises(FileExistsError):
            protocol.read_bundle(io.BytesIO(data), self.destination, "render")
        self.assertEqual(existing.read_bytes(), b"existing")

    def test_writer_rejects_nonregular_and_shared_files_before_emitting(self):
        artifact = self.output / "render.mp4"
        other = self.root / "other.mp4"
        other.write_bytes(b"content")
        for create in (
            lambda: artifact.symlink_to(other),
            lambda: os.link(other, artifact),
            lambda: os.mkfifo(artifact),
        ):
            with self.subTest(create=create):
                create()
                stream = io.BytesIO()
                with self.assertRaises((protocol.BundleError, OSError)):
                    protocol.write_bundle(stream, "render", {}, self.output)
                self.assertEqual(stream.getvalue(), b"")
                artifact.unlink()

    def test_writer_caps_aggregate_before_writing_any_header(self):
        for name in ("proxy.mp4", "poster.jpg"):
            (self.output / name).write_bytes(b"0123")
        stream = io.BytesIO()
        with patch.object(protocol, "MAX_BUNDLE_BYTES", 7), self.assertRaises(protocol.BundleError):
            protocol.write_bundle(stream, "analyze", {"candidates": []}, self.output)
        self.assertEqual(stream.getvalue(), b"")
