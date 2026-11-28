import io
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/decoder"))
from decoder_container import DecoderCancelled, DecoderExit, container_stream

IMAGE = "sha256:" + "a" * 64
ID = "b" * 64


class FakeProcess:
    def __init__(self):
        self.stdout = io.BytesIO(b"decoder output")
        self.returncode = None
        self.exit_status = 0
        self.pid = 4321
        self.wait_timeouts = []

    def poll(self):
        return self.returncode

    def wait(self, *, timeout):
        self.wait_timeouts.append(timeout)
        self.returncode = self.exit_status
        return self.returncode


class FakeDocker:
    def __init__(self):
        self.commands = []
        self.create_error = None
        self.preserves_container = False
        self.present = False
        self.name = None
        self.identity = {}
        self.process = FakeProcess()
        self.attach_argv = None
        self.attach_options = None
        self.request = None

    def docker(self, *args):
        self.commands.append(args)
        if args[0] != "container":
            raise AssertionError(f"unexpected command: {args}")
        if args[1] == "create":
            self.name = args[args.index("--name") + 1]
            label = args[args.index("--label") + 1]
            token = label.partition("=")[2]
            self.identity = {"id": ID, "owner": token, "image": IMAGE}
            self.present = True
            if self.create_error:
                raise self.create_error
            return subprocess.CompletedProcess(args, 0, f"{ID}\n", "")
        if args[1] == "inspect":
            target = args[-1]
            if target not in (self.name, ID):
                raise AssertionError(f"unexpected inspect target: {target}")
            if not self.present:
                return subprocess.CompletedProcess(args, 1, "", f"Error: No such container: {target}")
            return subprocess.CompletedProcess(args, 0, json.dumps(self.identity), "")
        if args[1] == "rm" and args[2:] == ("--force", ID):
            self.present = self.preserves_container
            return subprocess.CompletedProcess(args, 0, f"{ID}\n", "")
        raise AssertionError(f"unexpected docker command: {args}")

    def popen(self, argv, **kwargs):
        self.attach_argv = argv
        self.attach_options = kwargs
        self.request = kwargs["stdin"].read()
        self.process.args = argv
        return self.process


class DecoderContainerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source"
        self.source.write_bytes(b"original source data")
        self.start_fakes()

    def start_fakes(self):
        self.fake = FakeDocker()
        self.docker = self.enterContext(patch("decoder_container.docker", side_effect=self.fake.docker))
        self.enterContext(patch("decoder_container.subprocess.Popen", side_effect=self.fake.popen))
        self.killpg = self.enterContext(patch("decoder_container.os.killpg"))

    def test_uses_the_existing_isolated_profile_and_verifies_cleanup(self):
        with container_stream(
            IMAGE, self.source, b"request", entrypoint="trusted", args=("debug",)
        ) as attached:
            self.assertEqual(attached.stdout.read(), b"decoder output")
            self.assertEqual(attached.container_id, ID)
            self.assertIs(attached.process, self.fake.process)
        create, before_start, before_remove, remove, after_remove = self.fake.commands
        self.assertEqual(create[:2], ("container", "create"))
        self.assertTrue(self.fake.name.startswith("cliplane-decoder-smoke-"))
        token = self.fake.name.rsplit("-", 1)[1]
        self.assertRegex(token, "^[a-f0-9]{32}$")
        self.assertIn(f"io.cliplane.decoder-smoke={token}", create)
        for option in (
            "--pull=never",
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
            f"type=bind,src={self.source},dst=/input/source,readonly",
        ):
            self.assertIn(option, create)
        self.assertEqual(create[-4:], ("--entrypoint", "trusted", IMAGE, "debug"))
        self.assertEqual(before_start[-1], ID)
        self.assertEqual(before_remove, before_start)
        self.assertEqual(remove, ("container", "rm", "--force", ID))
        self.assertEqual(after_remove, before_start)
        self.assertEqual(
            self.fake.attach_argv,
            ["timeout", "--signal=KILL", "75s", "docker", "container", "start", "-ai", ID],
        )
        self.assertEqual(self.fake.request, b"request")
        self.assertTrue(self.fake.attach_options["start_new_session"])
        self.assertIs(self.fake.attach_options["stderr"], subprocess.DEVNULL)
        self.assertEqual(self.fake.process.wait_timeouts, [5])
        self.assertTrue(self.fake.process.stdout.closed)
        self.assertFalse(self.fake.present)
        self.killpg.assert_not_called()

    def test_rejects_invalid_images_and_unsafe_sources_before_docker(self):
        linked = self.root / "link"
        linked.symlink_to(self.source)
        fifo = self.root / "fifo"
        os.mkfifo(fifo)
        bad_names = [self.root / f"bad{character}name" for character in (",", '"', "'", "\r", "\n")]
        for bad_name in bad_names:
            bad_name.write_bytes(b"untouched")
        for image, source in (
            ("decoder:latest", self.source),
            (IMAGE, self.root),
            (IMAGE, linked),
            (IMAGE, fifo),
            (IMAGE, Path("relative-source")),
            *((IMAGE, path) for path in bad_names),
        ):
            with (
                self.subTest(image=image, source=source),
                self.assertRaises(ValueError),
                container_stream(image, source, b""),
            ):
                self.fail("started an invalid decoder")
        self.docker.assert_not_called()
        self.assertEqual(self.source.read_bytes(), b"original source data")

    def test_context_cleanup_refuses_changed_identity_image_or_label(self):
        cases = (("id", "c" * 64), ("image", "sha256:" + "d" * 64), ("owner", "unrelated"))
        for number, (key, wrong) in enumerate(cases):
            if number:
                self.start_fakes()
            with (
                self.subTest(field=key),
                self.assertRaisesRegex(ValueError, "ownership"),
                container_stream(IMAGE, self.source, b""),
            ):
                self.fake.identity[key] = wrong
            self.assertTrue(self.fake.present)
            self.assertTrue(self.fake.process.stdout.closed)
            self.assertEqual([command[1] for command in self.fake.commands], ["create", "inspect", "inspect"])

    def test_uncertain_create_reconciles_opaque_name_and_rechecks_id(self):
        self.fake.create_error = subprocess.TimeoutExpired("docker create", 8)
        with self.assertRaises(subprocess.TimeoutExpired), container_stream(IMAGE, self.source, b""):
            self.fail("started without a confirmed create")
        create, by_name, by_id, remove, absent = self.fake.commands
        self.assertEqual(create[:2], ("container", "create"))
        self.assertEqual(by_name[-1], self.fake.name)
        self.assertEqual(by_id[-1], ID)
        self.assertEqual(remove, ("container", "rm", "--force", ID))
        self.assertEqual(absent[-1], ID)
        self.assertFalse(self.fake.present)
        self.assertIsNone(self.fake.attach_argv)

    def test_explicit_stop_removes_once_and_reaps_nonzero_attached_process(self):
        self.fake.process.exit_status = -signal.SIGKILL
        with container_stream(IMAGE, self.source, b"") as attached:
            attached.stop()
            attached.stop()
            self.assertFalse(self.fake.present)
        self.assertEqual(
            [command[1] for command in self.fake.commands], ["create", "inspect", "inspect", "rm", "inspect"]
        )
        self.killpg.assert_called_once_with(self.fake.process.pid, signal.SIGKILL)
        self.assertEqual(self.fake.process.wait_timeouts, [5])
        self.assertTrue(self.fake.process.stdout.closed)

    def test_termination_and_cleanup_still_run_when_consumer_raises(self):
        with (
            self.assertRaisesRegex(RuntimeError, "consumer failed"),
            container_stream(IMAGE, self.source, b""),
        ):
            raise RuntimeError("consumer failed")
        self.killpg.assert_called_once_with(self.fake.process.pid, signal.SIGKILL)
        self.assertEqual(self.fake.process.wait_timeouts, [5])
        self.assertTrue(self.fake.process.stdout.closed)
        self.assertFalse(self.fake.present)

    def test_returns_nonzero_exit_only_after_successful_owned_cleanup(self):
        self.fake.process.exit_status = 65
        with self.assertRaises(DecoderExit) as error, container_stream(IMAGE, self.source, b""):
            pass
        self.assertEqual(error.exception.status, 65)
        self.assertFalse(self.fake.present)

    def test_requires_confirmed_absence_even_if_docker_rm_succeeds(self):
        self.fake.preserves_container = True
        self.fake.process.exit_status = 65
        with (
            self.assertRaisesRegex(ValueError, "container remains") as error,
            container_stream(IMAGE, self.source, b""),
        ):
            pass
        self.assertNotIsInstance(error.exception, DecoderExit)
        self.assertTrue(self.fake.present)

    def output_pipe(self):
        reader, writer = os.pipe()
        self.fake.process.stdout.close()
        self.fake.process.stdout = os.fdopen(reader, "rb")
        self.addCleanup(self.fake.process.stdout.close)
        return os.fdopen(writer, "wb", buffering=0)

    def test_disconnect_before_create_never_calls_docker(self):
        with (
            self.assertRaises(DecoderCancelled),
            container_stream(IMAGE, self.source, b"", cancelled=lambda: True),
        ):
            self.fail("launched after initial cancellation")
        self.docker.assert_not_called()

    def test_disconnect_during_create_cleans_up_without_attaching(self):
        with (
            self.assertRaises(DecoderCancelled),
            container_stream(IMAGE, self.source, b"", cancelled=lambda: self.fake.present),
        ):
            self.fail("attached after cancellation")
        self.assertIsNone(self.fake.attach_argv)
        self.assertEqual(
            [command[1] for command in self.fake.commands], ["create", "inspect", "inspect", "rm", "inspect"]
        )
        self.assertFalse(self.fake.present)

    def test_cancellable_reader_preserves_buffered_reads_and_normal_eof(self):
        with self.output_pipe() as writer:
            writer.write(b"ready\nsome decoder bytes")
        with container_stream(IMAGE, self.source, b"", cancelled=lambda: False) as attached:
            self.assertEqual(attached.stdout.readline(6), b"ready\n")
            self.assertEqual(attached.stdout.read(4), b"some")
            self.assertEqual(attached.stdout.read(), b" decoder bytes")
            self.assertEqual(attached.stdout.read(1), b"")
        self.assertFalse(self.fake.present)

    def test_disconnect_interrupts_stalled_read_and_readline(self):
        def assert_read_stops(method):
            cancelled = threading.Event()
            reading = threading.Event()
            checked_while_reading = threading.Event()

            def peer_closed():
                closed = cancelled.is_set()
                if reading.is_set():
                    checked_while_reading.set()
                return closed

            def read_stdout():
                with container_stream(IMAGE, self.source, b"", cancelled=peer_closed) as attached:
                    reading.set()
                    getattr(attached.stdout, method)(128)

            # Closing the writer before joining avoids an indefinite wait on regression.
            with ThreadPoolExecutor(max_workers=1) as executor, self.output_pipe():
                future = executor.submit(read_stdout)
                self.assertTrue(checked_while_reading.wait(timeout=1))
                self.assertFalse(future.done())
                cancelled.set()
                with self.assertRaises(DecoderCancelled):
                    future.result(timeout=1)
            self.assertFalse(self.fake.present)
            self.assertTrue(self.fake.process.stdout.closed)
            self.killpg.assert_called_once_with(self.fake.process.pid, signal.SIGKILL)

        for number, method in enumerate(("read", "readline")):
            if number:
                self.start_fakes()
            with self.subTest(method=method):
                assert_read_stops(method)

    def test_disconnect_interrupts_process_exit_wait(self):
        cancelled = threading.Event()
        waiting = threading.Event()
        wait_timeout = []
        original_wait = self.fake.process.wait

        def hold_exit(*, timeout):
            if self.killpg.called:
                return original_wait(timeout=timeout)
            wait_timeout.append(timeout)
            waiting.set()
            time.sleep(min(timeout, 0.2))
            raise subprocess.TimeoutExpired("docker attach", timeout)

        def wait_for_exit():
            with container_stream(IMAGE, self.source, b"", cancelled=cancelled.is_set):
                pass

        with (
            self.output_pipe(),
            patch.object(self.fake.process, "wait", side_effect=hold_exit),
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            future = executor.submit(wait_for_exit)
            self.assertTrue(waiting.wait(timeout=1))
            cancelled.set()
            with self.assertRaises(DecoderCancelled):
                future.result(timeout=1)
        self.assertTrue(all(0 < timeout <= 0.1 for timeout in wait_timeout))
        self.assertFalse(self.fake.present)
        self.assertTrue(self.fake.process.stdout.closed)
        self.assertEqual(self.fake.process.wait_timeouts, [5])

    def test_cancellable_exit_wait_keeps_the_original_total_deadline(self):
        observed = []
        original_wait = self.fake.process.wait

        def hold_exit(*, timeout):
            if self.killpg.called:
                return original_wait(timeout=timeout)
            observed.append(timeout)
            raise subprocess.TimeoutExpired("docker attach", timeout)

        with (
            self.output_pipe(),
            patch.object(self.fake.process, "wait", side_effect=hold_exit),
            patch("decoder_container.monotonic", side_effect=(100.0, 100.0, 104.96, 105.0)),
            self.assertRaises(subprocess.TimeoutExpired) as error,
            container_stream(IMAGE, self.source, b"", cancelled=lambda: False),
        ):
            pass
        self.assertEqual(error.exception.timeout, 5)
        self.assertEqual(len(observed), 2)
        self.assertAlmostEqual(observed[0], 0.1)
        self.assertAlmostEqual(observed[1], 0.04)
        self.assertEqual(self.fake.process.wait_timeouts, [5])
        self.assertFalse(self.fake.present)
