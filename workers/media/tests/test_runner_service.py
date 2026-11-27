import json
import os
import socket
import stat
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor, wait
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/decoder"))
from artifact_protocol import read_bundle
from runner_service import serve_runner

SOCKET_NAMES = ["analyze.sock", "probe.sock", "render.sock"]
METADATA = {
    "durationMs": 1000,
    "width": 320,
    "height": 240,
    "hasAudio": False,
    "fps": 30,
    "codec": "h264",
    "audioTracks": [],
}
RENDER_REQUEST = {"version": 1, "operation": "render", "plan": {"layout": "crop", "muteAudio": True}}


def frame(data: bytes) -> bytes:
    return len(data).to_bytes(4, "big") + data


def send_source(client: socket.socket, data: bytes, request: dict | None = None) -> None:
    if request is not None:
        client.sendall(frame(json.dumps(request).encode("utf-8")))
    client.sendall(frame(data))
    client.shutdown(socket.SHUT_WR)


def read_probe(client: socket.socket) -> dict:
    with client.makefile("rb") as stream:
        length = int.from_bytes(stream.read(4), "big")
        result = json.loads(stream.read(length))
        if stream.read(1):
            raise ValueError("unexpected trailing probe response")
        return result


@unittest.skipUnless(sys.platform == "linux", "Runner service checks Linux peer UID")
class RunnerServiceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.sockets = self.root / "sockets"
        self.staging = self.root / "staging"
        self.sockets.mkdir()
        self.sockets.chmod(0o710)
        self.staging.mkdir(mode=0o700)
        self.calls = []

    def execute_probe(self, source):
        self.calls.append(("probe", source.read_bytes()))
        return METADATA

    def execute_analysis(self, source, output):
        self.calls.append(("analyze", source.read_bytes()))
        output.mkdir()
        (output / "proxy.mp4").write_bytes(b"proxy bytes")
        (output / "poster.jpg").write_bytes(b"poster bytes")
        return {"metadata": METADATA, "candidates": []}

    def execute_render(self, source, output, request):
        self.calls.append(("render", source.read_bytes(), request))
        output.mkdir()
        (output / "render.mp4").write_bytes(b"render bytes")
        return METADATA

    def serve(self, stop, ready, **overrides):
        args = {
            "socket_root": self.sockets,
            "staging_root": self.staging,
            "allowed_uid": os.geteuid(),
            "execute_probe": self.execute_probe,
            "execute_analysis": self.execute_analysis,
            "execute_render": self.execute_render,
            "stop": stop,
            "ready": ready,
        }
        serve_runner(**(args | overrides))

    @contextmanager
    def running(self, **overrides):
        stop = threading.Event()
        ready = threading.Event()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.serve, stop, ready, **overrides)
            try:
                if not ready.wait(timeout=2) and future.done():
                    future.result()
                self.assertTrue(ready.is_set())
                yield stop, ready, future
            finally:
                stop.set()
                future.result(timeout=2)

    def expect_startup_failure(self, error, **overrides):
        stop, ready = threading.Event(), threading.Event()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.serve, stop, ready, **overrides)
            try:
                self.assertTrue(wait([future], timeout=1).done, "invalid configuration started serving")
                with self.assertRaises(error):
                    future.result()
                self.assertFalse(ready.is_set())
            finally:
                stop.set()

    @contextmanager
    def connect(self, operation):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(1)
            client.connect(str(self.sockets / f"{operation}.sock"))
            yield client

    def test_ready_endpoints_dispatch_only_their_fixed_operations(self):
        with self.running():
            self.assertEqual(sorted(path.name for path in self.sockets.iterdir()), SOCKET_NAMES)
            for endpoint in self.sockets.iterdir():
                self.assertTrue(endpoint.is_socket())
                self.assertEqual(stat.S_IMODE(endpoint.lstat().st_mode), 0o660)
            with self.connect("probe") as client:
                send_source(client, b"probe source")
                self.assertEqual(read_probe(client), {"status": "ok", "metadata": METADATA})
            destination = self.root / "received-analysis"
            with self.connect("analyze") as client:
                send_source(client, b"analyze source")
                with client.makefile("rb") as stream:
                    self.assertEqual(
                        read_bundle(stream, destination, "analyze"), {"metadata": METADATA, "candidates": []}
                    )
            self.assertEqual((destination / "proxy.mp4").read_bytes(), b"proxy bytes")
            self.assertEqual((destination / "poster.jpg").read_bytes(), b"poster bytes")
            destination = self.root / "received-render"
            with self.connect("render") as client:
                send_source(client, b"render source", RENDER_REQUEST)
                with client.makefile("rb") as stream:
                    self.assertEqual(read_bundle(stream, destination, "render"), METADATA)
            self.assertEqual((destination / "render.mp4").read_bytes(), b"render bytes")
            with self.connect("probe") as client:
                send_source(client, b"second probe source")
                self.assertEqual(read_probe(client)["status"], "ok")
            self.assertEqual(list(self.staging.iterdir()), [])
        self.assertEqual(list(self.sockets.iterdir()), [])
        self.assertEqual(
            self.calls,
            [
                ("probe", b"probe source"),
                ("analyze", b"analyze source"),
                ("render", b"render source", RENDER_REQUEST),
                ("probe", b"second probe source"),
            ],
        )

    def test_partial_startup_rolls_back_only_created_endpoints(self):
        collision = self.sockets / "render.sock"
        collision.write_bytes(b"existing")
        self.expect_startup_failure(OSError)
        self.assertEqual(list(self.sockets.iterdir()), [collision])
        self.assertEqual(collision.read_bytes(), b"existing")
        self.assertEqual(list(self.staging.iterdir()), [])

    def test_all_endpoints_reject_a_mismatched_uid_before_receiving_bytes(self):
        with self.running(allowed_uid=os.geteuid() ^ 1):
            for operation in ("probe", "analyze", "render"):
                with self.subTest(operation=operation), self.connect(operation) as client:
                    self.assertEqual(client.recv(1), b"")
            self.assertEqual(list(self.staging.iterdir()), [])
        self.assertEqual(self.calls, [])

    def test_shutdown_drains_active_handler_and_never_dispatches_the_queued_one(self):
        active = threading.Event()
        release = threading.Event()

        def hold_probe(source):
            active.set()
            if not release.wait(timeout=2):
                raise TimeoutError("test backend was not released")
            return self.execute_probe(source)

        with self.running(execute_probe=hold_probe) as (stop, ready, future), self.connect("probe") as probe:
            try:
                send_source(probe, b"active source")
                self.assertTrue(active.wait(timeout=1))
                with self.connect("render") as render:
                    send_source(render, b"queued source", RENDER_REQUEST)
                    render.settimeout(0.15)
                    with self.assertRaises(TimeoutError):
                        render.recv(1)
                    stop.set()
                    self.assertFalse(future.done())
                    release.set()
                    self.assertEqual(read_probe(probe), {"status": "ok", "metadata": METADATA})
                    future.result(timeout=1)
                    render.settimeout(0.5)
                    try:
                        self.assertEqual(render.recv(1), b"")
                    except ConnectionResetError:
                        pass  # Closing a Linux listener resets a queued, unread connection.
            finally:
                release.set()
            self.assertFalse(ready.is_set())
        self.assertEqual(self.calls, [("probe", b"active source")])
        self.assertEqual(list(self.staging.iterdir()), [])
        self.assertEqual(list(self.sockets.iterdir()), [])

    def test_idle_stop_finishes_without_waiting_for_a_client(self):
        with self.running() as (stop, ready, future):
            stop.set()
            future.result(timeout=1)
            self.assertFalse(ready.is_set())
        self.assertEqual(list(self.sockets.iterdir()), [])
        self.assertEqual(self.calls, [])

    def test_invalid_uid_and_unsafe_roots_never_create_endpoints(self):
        staging_alias = self.root / "staging-link"
        staging_alias.symlink_to(self.staging, target_is_directory=True)
        staging_file = self.root / "file"
        staging_file.write_text("existing")
        open_stage = self.root / "group-access-stage"
        open_stage.mkdir()
        open_stage.chmod(0o710)

        cases = [({"allowed_uid": uid}, ValueError) for uid in (-1, 1 << 32, (1 << 32) - 1, True)] + [
            ({"staging_root": self.sockets}, ValueError),
            ({"staging_root": self.root / "missing"}, OSError),
            ({"staging_root": staging_alias}, OSError),
            ({"staging_root": staging_file}, OSError),
            ({"staging_root": open_stage}, PermissionError),
        ]
        for overrides, error in cases:
            with self.subTest(overrides=overrides):
                self.expect_startup_failure(error, **overrides)
                self.assertEqual(list(self.sockets.iterdir()), [])
