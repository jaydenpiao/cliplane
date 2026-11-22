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

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/decoder"))
from probe_transport import ProbeUnsupported, serve_probe

METADATA = {
    "durationMs": 9000,
    "width": 1280,
    "height": 720,
    "hasAudio": True,
    "fps": 30,
    "codec": "h264",
    "audioTracks": [{"index": 1, "role": "mixed"}],
}


def frame(data: bytes) -> bytes:
    return len(data).to_bytes(4, "big") + data


class ProbeTransportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    @contextmanager
    def connection(self, execute, *, intake_timeout=3, send_buffer=None):
        client, server = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        with ThreadPoolExecutor(max_workers=1) as executor, server, client:
            client.settimeout(3)
            if send_buffer is not None:
                server.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, send_buffer)
            worker = executor.submit(serve_probe, server, self.root, execute, intake_timeout=intake_timeout)
            yield client, worker
            worker.result(timeout=3)

    def receive(self, client: socket.socket, *, allow_reset=False) -> dict:
        with client.makefile("rb") as stream:
            header = stream.read(4)
            self.assertEqual(len(header), 4)
            size = int.from_bytes(header, "big")
            self.assertGreater(size, 0)
            self.assertLessEqual(size, 1024 * 1024)
            payload = stream.read(size)
            self.assertEqual(len(payload), size)
            try:
                self.assertEqual(stream.read(1), b"")
            except ConnectionResetError:
                if not allow_reset:
                    raise
            return json.loads(payload)

    def test_streams_exact_bytes_through_exclusive_staging_and_cleans_before_reply(self):
        source_bytes = bytes(range(256)) * 590
        inspections = []
        self.root.joinpath("keep").write_bytes(b"existing")

        def execute(source):
            inspections.append(
                (
                    source.read_bytes(),
                    stat.S_IMODE(source.stat().st_mode),
                    source.parent,
                    source.stat().st_nlink,
                )
            )
            return METADATA

        with self.connection(execute) as (client, _):
            message = frame(source_bytes)
            client.sendall(message[:2])
            client.sendall(message[2:5])
            deadline = time.monotonic() + 2
            while True:
                paths = list(self.root.glob("*/*"))
                if paths or time.monotonic() >= deadline:
                    break
                time.sleep(0.005)
            self.assertEqual(len(paths), 1)
            staged = paths[0]
            self.assertEqual(stat.S_IMODE(staged.parent.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(staged.stat().st_mode), 0o600)
            client.sendall(message[5:])
            client.shutdown(socket.SHUT_WR)
            self.assertEqual(self.receive(client), {"status": "ok", "metadata": METADATA})
            self.assertEqual(
                {path.name: path.read_bytes() for path in self.root.iterdir()}, {"keep": b"existing"}
            )
        self.assertEqual(inspections, [(source_bytes, 0o444, staged.parent, 1)])

    def test_invalid_requests_do_not_call_the_backend_and_remove_partial_staging(self):
        requests = (
            b"",
            b"\x00\x00\x00",
            b"\x00\x00\x00\x00",
            (64 * 1024 * 1024 + 1).to_bytes(4, "big"),
            b"\x00\x00\x00\x04ab",
            frame(b"abcd") + b"extra",
        )
        called = []

        def execute(source):
            called.append(source)
            return METADATA

        for request in requests:
            with self.subTest(request=request), self.connection(execute) as (client, _):
                client.sendall(request)
                client.shutdown(socket.SHUT_WR)
                self.assertEqual(self.receive(client, allow_reset=True), {"status": "invalid_request"})
                self.assertEqual(list(self.root.iterdir()), [])
        self.assertEqual(called, [])

    def test_intake_uses_one_deadline_and_requires_a_write_half_close(self):
        called = []

        def execute(source):
            called.append(source)
            return METADATA

        with self.connection(execute, intake_timeout=0.75) as (client, _):
            started = time.monotonic()
            client.sendall(b"\x00\x00")
            time.sleep(0.25)
            client.sendall(b"\x00\x01")
            time.sleep(0.25)
            client.sendall(b"x")
            self.assertEqual(self.receive(client), {"status": "invalid_request"})
            self.assertLess(time.monotonic() - started, 1.1)
            self.assertEqual(list(self.root.iterdir()), [])
        self.assertEqual(called, [])

    def test_disconnect_during_intake_cleans_staging_without_starting_backend(self):
        called = []

        def execute(source):
            called.append(source)
            return METADATA

        for request in (b"\x00\x00\x00\x04ab", frame(b"complete")):
            with self.subTest(request=request), self.connection(execute) as (client, worker):
                client.sendall(request)
                client.close()
                worker.result(timeout=1)
                self.assertEqual(list(self.root.iterdir()), [])
        self.assertEqual(called, [])

    def test_backend_errors_return_only_the_fixed_status(self):
        cases = (
            (ProbeUnsupported("/host/source decoding details"), "unsupported"),
            (OSError("/host/source runner failure"), "unavailable"),
            (RuntimeError("private error"), "unavailable"),
        )
        for error, status in cases:

            def execute(source, error=error):
                raise error

            with self.subTest(status=status), self.connection(execute) as (client, _):
                client.sendall(frame(b"nonempty"))
                client.shutdown(socket.SHUT_WR)
                self.assertEqual(self.receive(client), {"status": status})
                self.assertEqual(list(self.root.iterdir()), [])

    def test_invalid_and_oversized_metadata_return_only_unavailable(self):
        samples = {
            "nonobject": [],
            "missing field": {key: value for key, value in METADATA.items() if key != "codec"},
            "extra field": {**METADATA, "diagnostics": "/host/source"},
            "invalid duration": {**METADATA, "durationMs": 99},
            "boolean dimension": {**METADATA, "width": True},
            "nonfinite number": {**METADATA, "fps": float("nan")},
            "invalid codec": {**METADATA, "codec": "/host/source"},
            "invalid track": {**METADATA, "audioTracks": [{"index": -1, "role": "game"}]},
            "oversized": {**METADATA, "codec": "x" * (1024 * 1024)},
        }
        for case, metadata in samples.items():
            with (
                self.subTest(case=case),
                self.connection(lambda _, metadata=metadata: metadata) as (client, _),
            ):
                client.sendall(frame(b"nonempty"))
                client.shutdown(socket.SHUT_WR)
                self.assertEqual(self.receive(client), {"status": "unavailable"})
                self.assertEqual(list(self.root.iterdir()), [])

    def test_staging_failure_returns_unavailable_without_calling_the_backend(self):
        self.root = self.root / "absent"
        called = []

        def execute(source):
            called.append(source)
            return METADATA

        with self.connection(execute) as (client, _):
            client.sendall(frame(b"nonempty"))
            client.shutdown(socket.SHUT_WR)
            self.assertEqual(self.receive(client, allow_reset=True), {"status": "unavailable"})
        self.assertEqual(called, [])
        self.assertFalse(self.root.exists())

    def test_response_write_is_bounded_when_peer_does_not_read_body(self):
        def execute(source):
            return {**METADATA, "codec": "x" * 256_000}

        with self.connection(execute, intake_timeout=0.5, send_buffer=4096) as (client, worker):
            client.sendall(frame(b"nonempty"))
            client.shutdown(socket.SHUT_WR)
            with client.makefile("rb") as stream:
                size = int.from_bytes(stream.read(4), "big")
                self.assertGreater(size, 256_000)
                self.assertEqual(list(self.root.iterdir()), [])
                worker.result(timeout=2)
                self.assertLess(len(stream.read()), size)
