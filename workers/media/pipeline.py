"""Stateless media worker. JSON stdin/stdout; local video files only; no network or AI calls."""

import json
import math
import os
import re
import statistics
import subprocess
import sys
import tempfile
import textwrap
import time
import wave
from array import array
from pathlib import Path

FORMATS = "mov,matroska,webm,avi,mpeg,mpegts,ogg"
TIMEOUT = int(os.environ.get("MEDIA_TIMEOUT_SECONDS", "1800"))


def run(
    args: list[str], timeout: int = TIMEOUT, output_limit: int = 8 * 1024 * 1024
) -> subprocess.CompletedProcess:
    # Spool diagnostics to bounded temporary files, never unbounded in-memory pipes.
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(args, stdout=stdout, stderr=stderr)
        deadline = time.monotonic() + timeout
        try:
            while True:
                if stdout.tell() > output_limit or stderr.tell() > output_limit:
                    raise ValueError("Media diagnostics exceeded their size limit")
                if time.monotonic() > deadline:
                    raise ValueError("Media processing exceeded its time limit")
                try:
                    process.wait(timeout=0.1)
                    break
                except subprocess.TimeoutExpired:
                    continue
            if stdout.tell() > output_limit or stderr.tell() > output_limit:
                raise ValueError("Media diagnostics exceeded their size limit")
            if process.returncode:
                raise ValueError("Media could not be processed; check the video encoding")
            stdout.seek(0)
            stderr.seek(0)
            return subprocess.CompletedProcess(
                args,
                process.returncode,
                stdout.read(output_limit).decode("utf-8", errors="replace"),
                stderr.read(output_limit).decode("utf-8", errors="replace"),
            )
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def local_file(value: str | Path) -> Path:
    raw = str(value)
    if "://" in raw or raw.startswith(("pipe:", "concat:", "file:")):
        raise ValueError("Only local media files are supported")
    path = Path(value).resolve(strict=True)
    if not path.is_file():
        raise ValueError("Media must be a regular file")
    return path


def probe(source: str | Path) -> dict:
    path = local_file(source)
    result = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            FORMATS,
            "-show_entries",
            "stream=index,codec_type,codec_name,width,height,duration,avg_frame_rate:stream_disposition=attached_pic:stream_side_data=rotation:format=duration",
            "-of",
            "json",
            str(path),
        ],
        timeout=45,
    )
    data = json.loads(result.stdout)
    videos = [
        s
        for s in data.get("streams", [])
        if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")
    ]
    if not videos:
        raise ValueError("A playable video stream is required")
    video = videos[0]
    duration = float(data.get("format", {}).get("duration", video.get("duration", 0)))
    width, height = int(video.get("width", 0)), int(video.get("height", 0))
    if (
        not math.isfinite(duration)
        or not 0.1 <= duration <= 43200
        or not 16 <= width <= 8192
        or not 16 <= height <= 8192
    ):
        raise ValueError("Video dimensions or duration exceed supported limits")
    for side in video.get("side_data_list", []):
        if abs(int(side.get("rotation", 0))) % 180 == 90:
            width, height = height, width
    num, den = video.get("avg_frame_rate", "0/1").split("/")
    fps = float(num) / max(1, float(den))
    audio = [s for s in data.get("streams", []) if s.get("codec_type") == "audio"]
    return {
        "durationMs": round(duration * 1000),
        "width": width,
        "height": height,
        "hasAudio": bool(audio),
        "fps": round(fps, 3),
        "codec": video.get("codec_name", "unknown"),
        "audioTracks": [{"index": s["index"], "role": "mixed"} for s in audio],
    }


def ffmpeg_input(source: Path, start: float | None = None) -> list[str]:
    args = [
        "ffmpeg",
        "-hide_banner",
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-threads",
        "2",
        "-filter_complex_threads",
        "1",
        "-filter_threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        FORMATS,
    ]
    if start is not None:
        args += ["-ss", str(start)]
    return args + ["-i", str(source)]


def suppress(windows: list[dict], threshold: float = 0.3) -> list[dict]:
    selected: list[dict] = []
    for w in sorted(windows, key=lambda item: (-item["score"], item["startMs"])):
        keep = True
        for s in selected:
            intersection = max(0, min(w["endMs"], s["endMs"]) - max(w["startMs"], s["startMs"]))
            union = max(w["endMs"], s["endMs"]) - min(w["startMs"], s["startMs"])
            if union and intersection / union > threshold:
                keep = False
                break
        if keep:
            selected.append(w)
    return selected[:8]


def candidate_windows(
    energies: list[float], scenes: list[float], duration: float, has_audio: bool
) -> list[dict]:
    if not scenes and (
        not has_audio or max(energies, default=0) < 0.001 or statistics.pstdev(energies) < 0.001
    ):
        count = min(8, max(1, math.ceil(duration / 35)))
        length = min(35.0, duration)
        return [
            {
                "startMs": round((duration - length) * i / max(1, count - 1) * 1000),
                "endMs": round(((duration - length) * i / max(1, count - 1) + length) * 1000),
                "score": 9,
                "components": {"audio": 0, "scene": 0, "boundary": 60},
                "reason": "Evenly spaced fallback; low signal confidence",
            }
            for i in range(count)
        ]
    average = statistics.fmean(energies)
    deviation = statistics.pstdev(energies) or 0.01
    events = (
        sorted(range(len(energies)), key=lambda index: -energies[index])[:120]
        if has_audio and max(energies) > 0.001
        else []
    )
    events += [round(t) for t in scenes[:100]]
    events += list(range(0, math.ceil(duration), 35))
    clip_seconds = min(35.0, duration)
    windows = []
    for event in events:
        start = max(0.0, min(duration - clip_seconds, event - 10.0))
        end = min(duration, start + clip_seconds)
        region = energies[int(start) : max(int(start) + 1, math.ceil(end))]
        z_score = (max(region, default=0) - average) / deviation
        audio_score = max(0, min(100, 40 + z_score * 18)) if has_audio and max(energies) > 0.001 else 0
        scene_score = min(100, sum(1 for s in scenes if start <= s <= end) * 15)
        boundary_score = 85 if clip_seconds >= 15 else 60
        score = round(audio_score * 0.6 + scene_score * 0.25 + boundary_score * 0.15)
        windows.append(
            {
                "startMs": round(start * 1000),
                "endMs": round(end * 1000),
                "score": score,
                "components": {"audio": round(audio_score), "scene": scene_score, "boundary": boundary_score},
                "reason": "Audio energy and scene activity"
                if audio_score > 50 or scene_score > 0
                else "Evenly spaced fallback; low signal confidence",
            }
        )
    return suppress(windows)


def analyze(source: str | Path, output_dir: Path) -> dict:
    started = time.monotonic()
    path = local_file(source)
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata = probe(path)
    duration = metadata["durationMs"] / 1000
    proxy = output_dir / "proxy.mp4"
    run(
        ffmpeg_input(path)
        + [
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            "scale=640:-2,fps=12",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "30",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            "-movflags",
            "+faststart",
            str(proxy),
        ]
    )
    energies: list[float] = []
    if metadata["hasAudio"]:
        audio = output_dir / "analysis.wav"
        run(
            ffmpeg_input(path)
            + [
                "-map",
                "0:a:0",
                "-vn",
                "-ac",
                "1",
                "-ar",
                "8000",
                "-af",
                "aresample=async=1:first_pts=0",
                "-c:a",
                "pcm_s16le",
                str(audio),
            ]
        )
        with wave.open(str(audio), "rb") as wav:
            while chunk := wav.readframes(8000):
                values = array("h", chunk)
                if sys.byteorder != "little":
                    values.byteswap()
                energies.append(math.sqrt(sum(v * v for v in values) / max(1, len(values))) / 32768)
    if not energies:
        energies = [0.0] * max(1, math.ceil(duration))
    # Scene metrics use the small proxy rather than repeatedly decoding the master.
    scenes_result = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostdin",
            "-v",
            "info",
            "-threads",
            "2",
            "-filter_threads",
            "1",
            "-i",
            str(proxy),
            "-vf",
            "fps=1,select='gt(scene,0.22)',showinfo",
            "-an",
            "-f",
            "null",
            "-",
        ]
    )
    scenes = [float(t) for t in re.findall(r"pts_time:([0-9.]+)", scenes_result.stderr)]
    candidates = candidate_windows(energies, scenes, duration, metadata["hasAudio"])
    for index, candidate in enumerate(candidates):
        thumb = output_dir / f"thumb-{index}.jpg"
        run(
            ffmpeg_input(
                path, (candidate["startMs"] + min(1000, candidate["endMs"] - candidate["startMs"]) / 2) / 1000
            )
            + ["-frames:v", "1", "-vf", "scale=640:-2", "-update", "1", str(thumb)]
        )
        candidate["thumbnail"] = thumb.name
    run(
        ffmpeg_input(path, min(0.5, duration / 2))
        + ["-frames:v", "1", "-vf", "scale=640:-2", "-update", "1", str(output_dir / "poster.jpg")]
    )
    elapsed = round(time.monotonic() - started, 3)
    return {
        "metadata": metadata,
        "candidates": candidates,
        "signals": {"audioRms": [round(v, 5) for v in energies], "sceneTimes": scenes[:1000]},
        "telemetry": {
            "wallSeconds": elapsed,
            "sourceHours": duration / 3600,
            "transcriptionCost": 0,
            "method": "deterministic-audio-scene-v1",
        },
    }


def crop_filter(rect: dict, width: int, height: int) -> str:
    values = [float(rect[k]) for k in ("x", "y", "width", "height")]
    x, y, w, h = values
    if (
        not all(math.isfinite(v) for v in values)
        or min(x, y) < 0
        or min(w, h) < 0.02
        or x + w > 1.000001
        or y + h > 1.000001
    ):
        raise ValueError("Invalid normalized crop")
    cw = max(2, int(w * width) // 2 * 2)
    ch = max(2, int(h * height) // 2 * 2)
    cx, cy = min(int(x * width), width - cw), min(int(y * height), height - ch)
    return f"crop={cw}:{ch}:{cx}:{cy}"


def render(source: str | Path, output: Path, plan: dict) -> dict:
    path = local_file(source)
    metadata = probe(path)
    start, end = plan.get("startMs", -1), plan.get("endMs", -1)
    if (
        plan.get("version") != 1
        or not isinstance(start, int)
        or not isinstance(end, int)
        or not 0 <= start < end <= metadata["durationMs"]
        or not 100 <= end - start <= 180000
    ):
        raise ValueError("Invalid edit interval")
    width, height = (360, 640) if plan.get("profile") == "preview" else (720, 1280)
    layout = plan.get("layout")
    if layout not in ("original", "crop", "facecam", "blur"):
        raise ValueError("Unsupported layout")
    full = {"x": 0, "y": 0, "width": 1, "height": 1}
    crop = crop_filter(plan.get("crop", full), metadata["width"], metadata["height"])
    fit = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1"
    if layout == "original":
        filters = "[0:v:0]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[v]"
    elif layout == "crop":
        filters = f"[0:v:0]{crop},{fit}[v]"
    elif layout == "facecam":
        face = crop_filter(plan.get("facecam", full), metadata["width"], metadata["height"])
        top = height // 3 // 2 * 2
        bottom = height - top
        filters = f"[0:v:0]split=2[game][face];[face]{face},scale={width}:{top}:force_original_aspect_ratio=increase,crop={width}:{top},setsar=1[f];[game]{crop},scale={width}:{bottom}:force_original_aspect_ratio=increase,crop={width}:{bottom},setsar=1[g];[f][g]vstack=inputs=2[v]"
    else:
        filters = f"[0:v:0]split=2[bg][fg];[bg]{fit},boxblur=15:2[b];[fg]{crop},scale={width}:{height}:force_original_aspect_ratio=decrease,setsar=1[f];[b][f]overlay=(W-w)/2:(H-h)/2[v]"
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cliplane-caption-") as temp_dir:
        caption_filter = ""
        captions = plan.get("captions", [])
        if len(captions) > 80:
            raise ValueError("Too many captions")
        for index, cue in enumerate(captions):
            if not 0 <= cue["startMs"] < cue["endMs"] <= end - start or len(cue["text"]) > 180:
                raise ValueError("Invalid caption cue")
            text_path = Path(temp_dir) / f"cue-{index}.txt"
            text_path.write_text(
                "\n".join(textwrap.fill(line, width=36) for line in cue["text"].splitlines()),
                encoding="utf-8",
            )
            caption_filter += f",drawtext=textfile='{text_path}':expansion=none:fontcolor=white:fontsize={max(16, width // 23)}:borderw=2:bordercolor=black:box=1:boxcolor=black@0.45:boxborderw=8:x=(w-tw)/2:y=h*0.80:enable='between(t,{cue['startMs'] / 1000},{cue['endMs'] / 1000})'"
        filters += f";[v]fps=30{caption_filter}[out]"
        temporary = output.with_name(output.stem + ".partial.mp4")
        args = ffmpeg_input(path, start / 1000) + [
            "-t",
            str((end - start) / 1000),
            "-filter_complex",
            filters,
            "-map",
            "[out]",
        ]
        if plan.get("muteAudio"):
            args += ["-an"]
        else:
            args += ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k"]
        args += [
            "-map_metadata",
            "-1",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "21",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(temporary),
        ]
        try:
            run(args)
            result = probe(temporary)
            temporary.replace(output)
        finally:
            temporary.unlink(missing_ok=True)
    return result


def main() -> None:
    request = json.loads(sys.stdin.read(1024 * 1024))
    operation = request.get("operation")
    if operation == "probe":
        result = probe(request["source"])
    elif operation == "analyze":
        result = analyze(request["source"], Path(request["outputDir"]))
    elif operation == "render":
        result = render(request["source"], Path(request["output"]), request["plan"])
    else:
        raise ValueError("Unsupported media operation")
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"error": str(error)[:180]}))
        sys.exit(1)
