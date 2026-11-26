import socket
import stat
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/decoder"))
from analysis_transport import serve_analysis
from artifact_protocol import BundleError, read_bundle

ARTIFACTS = {
    "proxy.mp4": bytes(range(256)) * 590,
    "poster.jpg": b"poster",
    "thumb-0.jpg": b"thumbnail",
}
RESULT = {"candidates": [{"thumbnail": "thumb-0.jpg", "startMs": 0, "endMs": 1000}]}


def frame(data: bytes) -> bytes:
    return len(data).to_bytes(4, "big") + data


def write_analysis(output: Path) -> None:
    output.mkdir()
    for name, data in ARTIFACTS.items():
        (output / name).write_bytes(data)
    (output / "analysis.wav").write_bytes(b"scratch")


class AnalysisTransportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.staging = root / "runner"
        self.staging.mkdir(mode=0o700)
        self.destination = root / "receiver"

    @contextmanager
    def connection(self, execute, *, intake_timeout=3.0, response_timeout=3.0, send_buffer=None):
        client, server = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        with ThreadPoolExecutor(max_workers=1) as executor, server, client:
            client.settimeout(3)
            if send_buffer is not None:
                server.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, send_buffer)
            worker = executor.submit(
                serve_analysis,
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
