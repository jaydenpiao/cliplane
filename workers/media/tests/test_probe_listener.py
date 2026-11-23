import errno
import json
import os
import socket
import stat
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/decoder"))
from probe_listener import probe_listener, serve_probe_once


@unittest.skipUnless(sys.platform == "linux", "Unix listener checks Linux peer UID")
class ProbeListenerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.staging = self.root / "staging"
        self.staging.mkdir(mode=0o700)
        self.endpoint = self.root / "probe.sock"

    def test_authorized_peer_probes_exact_source_and_listener_removes_endpoint(self):
        self.root.chmod(0o710)
        source_bytes = b"example source bytes"
        inspected = []
        metadata = {
            "durationMs": 1000,
            "width": 320,
            "height": 240,
            "hasAudio": False,
            "fps": 30,
            "codec": "h264",
            "audioTracks": [],
        }

        def execute(source):
            inspected.append(source.read_bytes())
            return metadata

        with (
            probe_listener(self.endpoint) as listener,
            ThreadPoolExecutor(max_workers=1) as pool,
            socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client,
        ):
            status = self.endpoint.lstat()
            self.assertTrue(stat.S_ISSOCK(status.st_mode))
            self.assertEqual(status.st_uid, os.geteuid())
            self.assertEqual(stat.S_IMODE(status.st_mode), 0o660)
            client.settimeout(2)
            client.connect(str(self.endpoint))
            served = pool.submit(serve_probe_once, listener, os.geteuid(), self.staging, execute)
            client.sendall(len(source_bytes).to_bytes(4, "big") + source_bytes)
            client.shutdown(socket.SHUT_WR)
            with client.makefile("rb") as stream:
                response_size = int.from_bytes(stream.read(4), "big")
                self.assertEqual(
                    json.loads(stream.read(response_size)), {"status": "ok", "metadata": metadata}
                )
                self.assertEqual(stream.read(1), b"")
            self.assertTrue(served.result(timeout=2))
            self.assertEqual(inspected, [source_bytes])
            self.assertEqual(list(self.staging.iterdir()), [])
        self.assertFalse(os.path.lexists(self.endpoint))

    def test_rejects_wrong_uid_before_waiting_for_any_bytes(self):
        with (
            probe_listener(self.endpoint) as listener,
            ThreadPoolExecutor(max_workers=1) as pool,
            socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client,
        ):
            client.settimeout(1)
            client.connect(str(self.endpoint))
            served = pool.submit(
                serve_probe_once, listener, os.geteuid() ^ 1, self.staging, lambda _: self.fail("probe ran")
            )
            self.assertFalse(served.result(timeout=1))
            self.assertEqual(client.recv(1), b"")
            self.assertEqual(list(self.staging.iterdir()), [])

    def test_accept_without_connection_respects_timeout(self):
        with probe_listener(self.endpoint) as listener:
            started = time.monotonic()
            self.assertFalse(
                serve_probe_once(
                    listener,
                    os.geteuid(),
                    self.staging,
                    lambda _: self.fail("probe ran"),
                    accept_timeout=0.03,
                )
            )
            elapsed = time.monotonic() - started
            self.assertGreaterEqual(elapsed, 0.02)
            self.assertLess(elapsed, 1)
            self.assertIsNone(listener.gettimeout())

    def test_accept_rejects_nonpositive_or_unbounded_timeout(self):
        with probe_listener(self.endpoint) as listener:
            for timeout in (0, -1, float("inf"), float("nan")):
                with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                    serve_probe_once(
                        listener, os.geteuid(), self.staging, lambda _: {}, accept_timeout=timeout
                    )

    def test_refuses_parent_with_group_write_or_other_access(self):
        for mode in (0o720, 0o701, 0o704, 0o702):
            self.root.chmod(mode)
            with (
                self.subTest(mode=oct(mode)),
                self.assertRaises(PermissionError),
                probe_listener(self.endpoint),
            ):
                self.fail("listened in broadly accessible parent")
            self.assertFalse(os.path.lexists(self.endpoint))

    def test_refuses_symlink_as_socket_parent(self):
        alias = self.root / "alias"
        alias.symlink_to(self.staging, target_is_directory=True)
        with self.assertRaises(OSError), probe_listener(alias / self.endpoint.name):
            self.fail("listened through symlink parent")
        self.assertEqual(list(self.staging.iterdir()), [])

    def test_refuses_existing_endpoint_and_preserves_it(self):
        self.endpoint.write_bytes(b"existing file")
        with self.assertRaises(OSError), probe_listener(self.endpoint):
            self.fail("overwrote existing file")
        self.assertEqual(self.endpoint.read_bytes(), b"existing file")
        self.endpoint.unlink()
        self.endpoint.symlink_to("missing")
        with self.assertRaises(OSError), probe_listener(self.endpoint):
            self.fail("overwrote existing symlink")
        self.assertEqual(self.endpoint.readlink(), Path("missing"))
        self.endpoint.unlink()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as existing:
            existing.bind(str(self.endpoint))
        original = self.endpoint.lstat()
        with self.assertRaises(OSError), probe_listener(self.endpoint):
            self.fail("overwrote existing socket")
        self.assertEqual(self.endpoint.lstat().st_ino, original.st_ino)

    def test_cleanup_leaves_a_replacement_socket_at_same_path(self):
        moved = self.endpoint.with_suffix(".moved")
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as replacement, probe_listener(self.endpoint):
            self.endpoint.rename(moved)
            replacement.bind(str(self.endpoint))
            replacement_identity = self.endpoint.lstat()
        self.assertEqual(self.endpoint.lstat().st_ino, replacement_identity.st_ino)
        self.assertTrue(moved.is_socket())

    def test_cleanup_follows_open_parent_when_its_path_is_replaced(self):
        parent = self.root / "listener"
        parent.mkdir(mode=0o700)
        endpoint = parent / self.endpoint.name
        moved = self.root / "moved"
        with probe_listener(endpoint):
            parent.rename(moved)
            parent.mkdir(mode=0o700)
            endpoint.write_text("replacement")
        self.assertEqual(endpoint.read_text(), "replacement")
        self.assertFalse(os.path.lexists(moved / endpoint.name))

    def test_cleanup_removes_created_endpoint_when_pinning_fails(self):
        original_open = os.open

        def open_endpoint(path, flags, mode=0o777, *, dir_fd=None):
            if path == self.endpoint.name and dir_fd is not None:
                raise OSError(errno.EMFILE, "too many open files")
            return original_open(path, flags, mode, dir_fd=dir_fd)

        with (
            patch("probe_listener.os.open", side_effect=open_endpoint),
            self.assertRaises(OSError) as error,
            probe_listener(self.endpoint),
        ):
            self.fail("listened without retaining the endpoint inode")
        self.assertEqual(error.exception.errno, errno.EMFILE)
        self.assertFalse(os.path.lexists(self.endpoint))

    def test_startup_rejects_a_socket_replaced_before_pinning(self):
        moved = self.endpoint.with_suffix(".moved")
        original_open = os.open
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as replacement:

            def open_endpoint(path, flags, mode=0o777, *, dir_fd=None):
                if path == self.endpoint.name and dir_fd is not None:
                    self.endpoint.rename(moved)
                    replacement.bind(str(self.endpoint))
                    self.endpoint.chmod(0o600)
                return original_open(path, flags, mode, dir_fd=dir_fd)

            with (
                patch("probe_listener.os.open", side_effect=open_endpoint),
                self.assertRaises(OSError),
                probe_listener(self.endpoint),
            ):
                self.fail("listened with a replaced endpoint")
            self.assertTrue(self.endpoint.is_socket())
            self.assertEqual(stat.S_IMODE(self.endpoint.lstat().st_mode), 0o600)
            self.assertTrue(moved.is_socket())

    def test_cleanup_removes_created_endpoint_after_serving_scope_raises(self):
        with self.assertRaisesRegex(RuntimeError, "serving failed"), probe_listener(self.endpoint):
            raise RuntimeError("serving failed")
        self.assertFalse(os.path.lexists(self.endpoint))
