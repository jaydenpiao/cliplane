import json
import socket
import stat
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/decoder"))
from artifact_protocol import BundleError, read_bundle
from artifact_transport import serve_analysis, serve_render

ARTIFACTS = {
    "proxy.mp4": bytes(range(256)) * 590,
    "poster.jpg": b"poster",
    "thumb-0.jpg": b"thumbnail",
}
RESULT = {"candidates": [{"thumbnail": "thumb-0.jpg", "startMs": 0, "endMs": 1000}]}

RENDER_REQUEST = {
    "version": 1,
    "operation": "render",
    "plan": {
        "version": 1,
        "startMs": 0,
        "endMs": 1000,
        "layout": "crop",
        "captions": [{"startMs": 0, "endMs": 800, "text": "Café recording"}],
    },
}
RENDER_RESULT = {"durationMs": 1000, "width": 720, "height": 1280}


def frame(data: bytes) -> bytes:
    return len(data).to_bytes(4, "big") + data


def write_analysis(output: Path) -> None:
    output.mkdir()
    for name, data in ARTIFACTS.items():
        (output / name).write_bytes(data)
    (output / "analysis.wav").write_bytes(b"scratch")


class ArtifactTransportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.staging = root / "runner"
        self.staging.mkdir(mode=0o700)
        self.destination = root / "receiver"

    @contextmanager
    def connection(
        self, execute, *, handler=serve_analysis, intake_timeout=3.0, response_timeout=3.0, send_buffer=None
    ):
        client, server = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        with ThreadPoolExecutor(max_workers=1) as executor, server, client:
            client.settimeout(3)
            if send_buffer is not None:
                server.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, send_buffer)
            worker = executor.submit(
                handler,
                server,
                self.staging,
                execute,
                intake_timeout=intake_timeout,
                response_timeout=response_timeout,
            )
            yield client, worker
            worker.result(timeout=3)

    def test_imports_only_declared_artifacts_after_runner_staging_is_removed(self):
        source_bytes = b"original synthetic source bytes" * 5000
        seen = []
        keep = self.staging / "keep"
        keep.write_bytes(b"existing")

        def execute(source, output):
            seen.append(
                (
                    source.read_bytes(),
                    stat.S_IMODE(source.stat().st_mode),
                    stat.S_IMODE(source.parent.stat().st_mode),
                    output.exists(),
                )
            )
            write_analysis(output)
            return RESULT

        with self.connection(execute) as (client, _):
            request = frame(source_bytes)
            client.sendall(request[:2])
            client.sendall(request[2:])
            client.shutdown(socket.SHUT_WR)
            self.assertTrue(client.recv(1, socket.MSG_PEEK))
            self.assertEqual(list(self.staging.iterdir()), [keep])
            with client.makefile("rb") as stream:
                self.assertEqual(read_bundle(stream, self.destination, "analyze"), RESULT)
        self.assertEqual(seen, [(source_bytes, 0o444, 0o700, False)])
        self.assertEqual({path.name: path.read_bytes() for path in self.destination.iterdir()}, ARTIFACTS)
        self.assertEqual(keep.read_bytes(), b"existing")

    def test_incomplete_oversized_and_trailing_input_starts_no_analysis(self):
        seen = []

        def execute(source, output):
            seen.append(source)
            write_analysis(output)
            return RESULT

        for request in (
            b"",
            b"\x00\x00\x00\x03ab",
            (64 * 1024 * 1024 + 1).to_bytes(4, "big"),
            frame(b"clip") + b"x",
        ):
            with self.subTest(request=request), self.connection(execute) as (client, _):
                client.sendall(request)
                client.shutdown(socket.SHUT_WR)
                self.assertEqual(client.recv(1), b"")
                self.assertEqual(list(self.staging.iterdir()), [])
        self.assertEqual(seen, [])

    def test_intake_requires_half_close_and_skips_disconnected_peer(self):
        seen = []

        def execute(source, output):
            seen.append(source)
            write_analysis(output)
            return RESULT

        with self.connection(execute, intake_timeout=0.15) as (client, _):
            client.sendall(frame(b"clip"))
            self.assertEqual(client.recv(1), b"")
            self.assertEqual(list(self.staging.iterdir()), [])
        with self.connection(execute) as (client, worker):
            client.sendall(frame(b"clip"))
            client.close()
            worker.result(timeout=1)
            self.assertEqual(list(self.staging.iterdir()), [])
        self.assertEqual(seen, [])

    def test_backend_failure_and_unsafe_artifact_emit_no_success_or_diagnostics(self):
        keep = self.staging / "keep"
        keep.write_bytes(b"other recording")

        def failed(_, output):
            write_analysis(output)
            raise RuntimeError("private path and decoder diagnostics")

        def unsafe(_, output):
            write_analysis(output)
            (output / "proxy.mp4").unlink()
            (output / "proxy.mp4").symlink_to(keep)
            return RESULT

        for execute in (failed, unsafe):
            with self.subTest(execute=execute), self.connection(execute) as (client, _):
                client.sendall(frame(b"clip"))
                client.shutdown(socket.SHUT_WR)
                self.assertEqual(client.recv(1), b"")
                self.assertEqual(list(self.staging.iterdir()), [keep])
        self.assertEqual(keep.read_bytes(), b"other recording")

    def test_stalled_receiver_leaves_no_runner_or_partial_import_files(self):
        def execute(_, output):
            write_analysis(output)
            return RESULT

        with self.connection(execute, response_timeout=0.25, send_buffer=4096) as (client, worker):
            client.sendall(frame(b"clip"))
            client.shutdown(socket.SHUT_WR)
            self.assertTrue(client.recv(1, socket.MSG_PEEK))
            worker.result(timeout=1.5)
            self.assertEqual(list(self.staging.iterdir()), [])
            with client.makefile("rb") as stream, self.assertRaises(BundleError):
                read_bundle(stream, self.destination, "analyze")
            self.assertFalse(self.destination.exists())

    def test_render_preserves_the_plan_and_returns_only_its_private_artifact(self):
        source_bytes = b"original synthetic source bytes" * 5000
        render_bytes = bytes(range(256)) * 590
        seen = []

        def execute(source, output, request):
            seen.append((source.read_bytes(), stat.S_IMODE(source.stat().st_mode), output.exists(), request))
            output.mkdir()
            (output / "render.mp4").write_bytes(render_bytes)
            (output / "other.mp4").write_bytes(b"temporary")
            return RENDER_RESULT

        with self.connection(execute, handler=serve_render) as (client, _):
            request_bytes = json.dumps(RENDER_REQUEST, ensure_ascii=False).encode().ljust(1 << 20, b" ")
            prefix = frame(request_bytes)
            client.sendall(prefix[:2])
            client.sendall(prefix[2:7])
            client.sendall(prefix[7:] + frame(source_bytes))
            client.shutdown(socket.SHUT_WR)
            self.assertTrue(client.recv(1, socket.MSG_PEEK))
            self.assertEqual(list(self.staging.iterdir()), [])
            with client.makefile("rb") as stream:
                self.assertEqual(read_bundle(stream, self.destination, "render"), RENDER_RESULT)
        self.assertEqual(seen, [(source_bytes, 0o444, False, RENDER_REQUEST)])
        self.assertEqual(list(self.destination.iterdir()), [self.destination / "render.mp4"])
        self.assertEqual((self.destination / "render.mp4").read_bytes(), render_bytes)

    def test_rejects_wrong_render_envelopes_before_source_intake(self):
        seen = []

        def execute(*args):
            seen.append(args)
            raise RuntimeError("invalid request started a decoder")

        requests = (
            b"",
            b'{"version":1,"operation":"probe"}',
            b'{"version":1,"operation":"analyze"}',
            b'{"version":1,"operation":"render"}',
            b'{"version":1,"operation":"render","plan":[]}',
            b'{"version":1,"operation":"render","plan":{},"source":"recording.mp4"}',
            b'{"version":1,"operation":"render","plan":{},"output":"render.mp4"}',
            b'{"version":1,"operation":"analyze","operation":"render","plan":{}}',
            b'{"version":1,"operation":"render","plan":{"text":"\xff"}}',
        )
        for prefix in (*(frame(request) for request in requests), ((1 << 20) + 1).to_bytes(4, "big")):
            with self.subTest(prefix=prefix), self.connection(execute, handler=serve_render) as (client, _):
                client.settimeout(1)
                client.sendall(prefix)
                self.assertEqual(client.recv(1), b"")
                self.assertEqual(list(self.staging.iterdir()), [])
        self.assertEqual(seen, [])

    def test_render_rejects_truncated_envelopes_and_incomplete_source_frames(self):
        seen = []

        def execute(*args):
            seen.append(args)
            raise RuntimeError("invalid request started a decoder")

        prefix = frame(json.dumps(RENDER_REQUEST).encode())
        for message in (
            prefix[:2],
            prefix[:-1],
            prefix,
            prefix + b"\x00\x00\x00\x02x",
            prefix + frame(b"clip") + b"x",
        ):
            with self.subTest(message=message), self.connection(execute, handler=serve_render) as (client, _):
                client.sendall(message)
                client.shutdown(socket.SHUT_WR)
                self.assertEqual(client.recv(1), b"")
                self.assertEqual(list(self.staging.iterdir()), [])
        self.assertEqual(seen, [])

    def test_render_options_and_source_share_a_single_intake_deadline(self):
        seen = []

        def execute(*args):
            seen.append(args)
            raise RuntimeError("unfinished request started a decoder")

        prefix = frame(json.dumps(RENDER_REQUEST).encode())
        with self.connection(execute, handler=serve_render, intake_timeout=1.0) as (client, _):
            client.sendall(prefix[:4])
            time.sleep(0.5)
            client.sendall(prefix[4:] + frame(b"clip"))
            # Even the final half-close must arrive within the original deadline.
            client.settimeout(0.75)
            self.assertEqual(client.recv(1), b"")
            self.assertEqual(list(self.staging.iterdir()), [])
        self.assertEqual(seen, [])
