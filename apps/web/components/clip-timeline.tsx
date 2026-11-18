"use client";
import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { EditPlan } from "../../../packages/domain/src/index";
import { time } from "../lib/api";

interface Frame {
  image: string;
  ms: number;
}

/** Sampling has a separate muted decoder; never seek the user's playback video. */
function useFilmstrip(sourceId: string, durationMs: number) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [state, setState] = useState("loading");
  useEffect(() => {
    const controller = new AbortController();
    const expiresAt = Date.now() + 12000;
    const media = document.createElement("video");
    media.muted = true;
    media.playsInline = true;
    media.preload = "auto";
    const waitFor = (event: string) =>
      new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          media.removeEventListener(event, ready);
          media.removeEventListener("error", failed);
          controller.signal.removeEventListener("abort", aborted);
          if (error) reject(error);
          else resolve();
        };
        const ready = () => finish();
        const failed = () => finish(new Error("Media unavailable"));
        const aborted = () => finish(new Error("Sampling cancelled"));
        const timer = setTimeout(
          () => finish(new Error("Sampling timed out")),
          Math.max(1, Math.min(4000, expiresAt - Date.now())),
        );
        media.addEventListener(event, ready, { once: true });
        media.addEventListener("error", failed, { once: true });
        controller.signal.addEventListener("abort", aborted, { once: true });
      });
    setFrames([]);
    setState("loading");
    const sample = async () => {
      try {
        const loaded = waitFor("loadeddata");
        media.src = `/api/sources/${sourceId}/media`;
        media.load();
        await loaded;
        if (controller.signal.aborted || !media.videoWidth) return;
        const canvas = document.createElement("canvas");
        const scale = 160 / Math.max(media.videoWidth, media.videoHeight);
        canvas.width = Math.max(1, Math.round(media.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(media.videoHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        const availableMs = Math.min(
          durationMs,
          Number.isFinite(media.duration) ? media.duration * 1000 : durationMs,
        );
        if (availableMs <= 0) throw new Error("Media duration unavailable");
        const count = Math.min(8, Math.max(1, Math.floor(availableMs / 100)));
        const sampled: Frame[] = [];
        for (let i = 0; i < count; i++) {
          if (controller.signal.aborted) return;
          const ms = Math.round(((i + 0.5) / count) * availableMs);
          const seeked = waitFor("seeked");
          media.currentTime = ms / 1000;
          await seeked;
          if (controller.signal.aborted) return;
          ctx.drawImage(media, 0, 0, canvas.width, canvas.height);
          sampled.push({ ms, image: canvas.toDataURL("image/jpeg", 0.7) });
        }
        setFrames(sampled);
        setState("ready");
      } catch {
        if (!controller.signal.aborted) setState("unavailable");
      } finally {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
    };
    void sample();
    return () => {
      controller.abort();
      media.pause();
      media.removeAttribute("src");
      media.load();
    };
  }, [sourceId, durationMs]);
  return { frames, state };
}

export function ClipTimeline({
  sourceId,
  durationMs,
  plan,
  playheadMs,
  playing,
  onSeek,
  onBoundary,
  onPlay,
}: {
  sourceId: string;
  durationMs: number;
  plan: EditPlan;
  playheadMs: number;
  playing: boolean;
  onSeek: (ms: number) => void;
  onBoundary: (boundary: "startMs" | "endMs", seconds: number) => void;
  onPlay: () => void;
}) {
  const { frames, state } = useFilmstrip(sourceId, durationMs);
  const duration = Math.max(1, durationMs);
  const secondsText = (ms: number) => `${(ms / 1000).toFixed(1)} seconds`;
  const startMax = Math.max(0, plan.endMs - Math.min(100, durationMs));
  const endMin = plan.startMs + Math.min(100, durationMs);
  return (
    <div className="clip-timeline">
      <div className="clip-transport">
        <button type="button" className="button secondary" onClick={onPlay}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? "Pause selection" : "Play selection"}
        </button>
        <span className="source-clock">
          Source time <strong>{time(playheadMs)}</strong>
        </span>
      </div>
      <div className="timeline-labels">
        <span>{time(0)}</span>
        <strong>{((plan.endMs - plan.startMs) / 1000).toFixed(1)}s selected</strong>
        <span>{time(durationMs)}</span>
      </div>
      <section
        className="filmstrip"
        aria-label="Timeline filmstrip"
        onPointerDown={(event) => {
          if (event.target instanceof HTMLInputElement) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const bounds = event.currentTarget.getBoundingClientRect();
          onSeek(
            Math.min(durationMs, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * durationMs)),
          );
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          onSeek(
            Math.min(durationMs, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * durationMs)),
          );
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <div className="filmstrip-images">
          {frames.map((frame) => (
            <button
              type="button"
              key={frame.ms}
              aria-label={`Seek to ${(frame.ms / 1000).toFixed(1)} seconds`}
              onClick={() => onSeek(frame.ms)}
            >
              {/* biome-ignore lint/performance/noImgElement: Local bounded decoded-frame data URLs need no network optimizer. */}
              <img
                data-testid="filmstrip-frame"
                src={frame.image}
                alt={`Source frame at ${(frame.ms / 1000).toFixed(1)} seconds`}
              />
            </button>
          ))}
        </div>
        {state !== "ready" && (
          <span className="filmstrip-message" role="status">
            {state === "loading"
              ? "Loading source frames…"
              : "Filmstrip unavailable · playback and trim are ready"}
          </span>
        )}
        <div
          className="filmstrip-selection"
          style={{
            left: `${(plan.startMs / duration) * 100}%`,
            width: `${((plan.endMs - plan.startMs) / duration) * 100}%`,
          }}
        />
        <div
          className="filmstrip-playhead"
          style={{ left: `${(Math.min(duration, Math.max(0, playheadMs)) / duration) * 100}%` }}
        />
        <input
          className="trim-handle trim-start"
          type="range"
          aria-label="Trim start"
          min={0}
          max={startMax / 1000}
          step={0.01}
          value={plan.startMs / 1000}
          style={{ width: `${(startMax / duration) * 100}%` }}
          aria-valuetext={secondsText(plan.startMs)}
          onChange={(e) => onBoundary("startMs", Number(e.target.value))}
        />
        <input
          className="trim-handle trim-end"
          type="range"
          aria-label="Trim end"
          min={endMin / 1000}
          max={durationMs / 1000}
          step={0.01}
          value={plan.endMs / 1000}
          style={{
            left: `${(endMin / duration) * 100}%`,
            width: `${((durationMs - endMin) / duration) * 100}%`,
          }}
          aria-valuetext={secondsText(plan.endMs)}
          onChange={(e) => onBoundary("endMs", Number(e.target.value))}
        />
      </section>
      <label className="playhead-control">
        <span className="visually-hidden">Playhead</span>
        <input
          type="range"
          aria-label="Playhead"
          min={0}
          max={durationMs / 1000}
          step={0.01}
          value={Math.min(durationMs, Math.max(0, playheadMs)) / 1000}
          aria-valuetext={secondsText(playheadMs)}
          onChange={(e) => onSeek(Number(e.target.value) * 1000)}
        />
      </label>
      <div className="trim-fields">
        <label>
          Start (seconds)
          <input
            type="number"
            min={0}
            max={durationMs / 1000}
            step={0.1}
            value={plan.startMs / 1000}
            onChange={(e) => onBoundary("startMs", Number(e.target.value))}
          />
        </label>
        <label>
          End (seconds)
          <input
            type="number"
            min={0}
            max={durationMs / 1000}
            step={0.1}
            value={plan.endMs / 1000}
            onChange={(e) => onBoundary("endMs", Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
