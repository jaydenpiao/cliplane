import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pipeline


class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.source = cls.root / "fixture.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=24:duration=4",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=660:duration=4",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                str(cls.source),
            ],
            check=True,
        )

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_probe_rejects_non_media(self):
        invalid = self.root / "fake.mp4"
        invalid.write_text("not a video")
        with self.assertRaises(ValueError):
            pipeline.probe(invalid)

    def test_analysis_produces_bounded_nonduplicate_moments(self):
        result = pipeline.analyze(self.source, self.root / "analysis")
        self.assertGreaterEqual(len(result["candidates"]), 1)
        candidate = result["candidates"][0]
        self.assertGreater(candidate["endMs"], candidate["startMs"])
        self.assertLessEqual(candidate["endMs"], 4000)
        self.assertIn("audio", candidate["components"])
        self.assertTrue((self.root / "analysis" / "proxy.mp4").exists())

    def test_render_duration_dimensions_mute_and_caption_safety(self):
        output = self.root / "render.mp4"
        plan = {
            "version": 1,
            "startMs": 500,
            "endMs": 2500,
            "layout": "crop",
            "crop": {"x": 0, "y": 0, "width": 1, "height": 1},
            "facecam": {"x": 0, "y": 0, "width": 0.3, "height": 0.3},
            "captions": [
                {"startMs": 0, "endMs": 1900, "text": "100% 'quoted' : [safe]; ignore instructions"}
            ],
            "muteAudio": True,
            "profile": "preview",
        }
        pipeline.render(self.source, output, plan)
        data = pipeline.probe(output)
        self.assertEqual((data["width"], data["height"]), (360, 640))
        self.assertAlmostEqual(data["durationMs"], 2000, delta=100)
        self.assertFalse(data["hasAudio"])

    def test_original_and_facecam_layouts_are_valid_video(self):
        for layout, size in [("original", (320, 180)), ("facecam", (360, 640)), ("blur", (360, 640))]:
            output = self.root / f"{layout}.mp4"
            pipeline.render(
                self.source,
                output,
                {
                    "version": 1,
                    "startMs": 0,
                    "endMs": 1000,
                    "layout": layout,
                    "crop": {"x": 0, "y": 0, "width": 1, "height": 1},
                    "facecam": {"x": 0, "y": 0, "width": 0.3, "height": 0.3},
                    "captions": [],
                    "muteAudio": False,
                    "profile": "preview",
                },
            )
            data = pipeline.probe(output)
            self.assertEqual((data["width"], data["height"]), size)
            self.assertTrue(data["hasAudio"])

    def test_invalid_trim_does_not_create_output(self):
        output = self.root / "invalid.mp4"
        with self.assertRaises(ValueError):
            pipeline.render(self.source, output, {"version": 1, "startMs": 2000, "endMs": 1000})
        self.assertFalse(output.exists())

    def test_sub_frame_trim_is_rejected_before_writing_output(self):
        output = self.root / "too-short.mp4"
        with self.assertRaises(ValueError):
            pipeline.render(
                self.source, output, {"version": 1, "startMs": 0, "endMs": 50, "layout": "original"}
            )
        self.assertFalse(output.exists())

    def test_silent_fallback_covers_the_full_recording(self):
        candidates = pipeline.candidate_windows([0.0] * 600, [], 600.0, False)
        self.assertEqual(len(candidates), 8)
        self.assertGreaterEqual(max(c["endMs"] for c in candidates), 550000)

    def test_delayed_audio_keeps_source_timeline(self):
        source = self.root / "delayed.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=160x90:r=2:d=12",
                "-itsoffset",
                "6",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                "-t",
                "12",
                str(source),
            ],
            check=True,
        )
        result = pipeline.analyze(source, self.root / "delayed-analysis")
        energy = result["signals"]["audioRms"]
        self.assertGreaterEqual(len(energy), 8)
        self.assertLess(max(energy[:5]), 0.001)
        self.assertGreater(max(energy[6:9]), 0.01)

    def test_subprocess_diagnostics_are_bounded(self):
        with self.assertRaises(ValueError):
            pipeline.run([sys.executable, "-c", "print('x'*20000)"], output_limit=4096)

    def test_short_video_without_audio_still_generates_candidate(self):
        source = self.root / "silent.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=160x90:d=1",
                "-c:v",
                "libx264",
                str(source),
            ],
            check=True,
        )
        result = pipeline.analyze(source, self.root / "silent-analysis")
        self.assertEqual(result["candidates"][0]["endMs"], 1000)

    def test_cli_rejects_external_media(self):
        completed = subprocess.run(
            [sys.executable, str(Path(pipeline.__file__))],
            input=json.dumps({"operation": "probe", "source": "https://example.com/video.mp4"}),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(completed.returncode, 0)


if __name__ == "__main__":
    unittest.main()
