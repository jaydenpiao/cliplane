import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MEDIA = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MEDIA))

import decoder
from artifact_protocol import BundleError, read_bundle


class DecoderTests(unittest.TestCase):
    def test_request_contract(self):
        request = b'{"version":1,"operation":"probe"}'
        self.assertEqual(decoder.read_request(io.BytesIO(request)), {"operation": "probe", "version": 1})
        plan = b'{"version":1,"operation":"render","plan":{"layout":"original"}}'
        self.assertEqual(decoder.read_request(io.BytesIO(plan))["plan"], {"layout": "original"})

        for invalid in (
            b'{"version":true,"operation":"probe"}',
            b'{"version":1.0,"operation":"probe"}',
            b'{"version":2,"operation":"probe"}',
            b'{"version":1,"operation":[]}',
            b'{"version":1,"operation":"unknown"}',
            b'{"version":1,"operation":"probe","source":"elsewhere"}',
            b'{"version":1,"operation":"analyze","outputDir":"elsewhere"}',
            b'{"version":1,"operation":"probe","plan":{}}',
            b'{"version":1,"operation":"render"}',
            b'{"version":1,"operation":"render","plan":[]}',
            request + b"{}",
        ):
            with self.subTest(request=invalid), self.assertRaises(BundleError):
                decoder.read_request(io.BytesIO(invalid))

    def test_request_byte_limit_includes_trailing_whitespace(self):
        request = b'{"version":1,"operation":"probe"}'
        at_limit = request.ljust(1024 * 1024, b" ")
        self.assertEqual(decoder.read_request(io.BytesIO(at_limit))["operation"], "probe")
        stream = io.BytesIO(at_limit + b"  ")
        with self.assertRaises(BundleError):
            decoder.read_request(stream)
        self.assertEqual(stream.tell(), 1024 * 1024 + 1)

    def test_probe_of_original_fixture_returns_bundle_and_removes_scratch(self):
        fixture = MEDIA.parents[1] / "packages" / "test-fixtures" / "nightdrift-original.mp4"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scratch = root / "work"
            scratch.mkdir()
            output = io.BytesIO()
            with patch.object(decoder, "SOURCE", fixture), patch.object(decoder, "WORK", scratch):
                decoder.run_job(io.BytesIO(b'{"version":1,"operation":"probe"}'), output)
            self.assertEqual(list(scratch.iterdir()), [])
            output.seek(0)
            result = read_bundle(output, root / "received", "probe")
            self.assertEqual((result["width"], result["height"], result["durationMs"]), (1280, 720, 24000))
            self.assertTrue(result["hasAudio"])

    def test_cli_failure_outputs_only_a_generic_diagnostic(self):
        result = subprocess.run(
            [sys.executable, "-B", str(MEDIA / "decoder.py")],
            input=b'{"version":1,"operation":"probe","source":"private-recording.mp4"}',
            capture_output=True,
            check=False,
            timeout=5,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"decoder_failed\n")
