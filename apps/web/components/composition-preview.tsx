"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { EditPlan } from "../../../packages/domain/src/index";
import type { Moment } from "../lib/api";
import { compositionGeometry, previewSize, wrapCaption } from "../lib/editor";

export function CompositionPreview({
  moment,
  plan,
  videoRef,
  onTimeChange,
  onPlayingChange,
}: {
  moment: Moment;
  plan: EditPlan;
  videoRef: RefObject<HTMLVideoElement | null>;
  onTimeChange: (ms: number) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const draw = useRef<() => void>(() => {});
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [displayTime, setDisplayTime] = useState(plan.startMs);
  const [ratio, setRatio] = useState(720 / 1280);
  draw.current = () => {
    const media = videoRef.current,
      surface = canvas.current;
    if (!media || !surface || media.readyState < 2 || !media.videoWidth) return;
    try {
      const geometry = compositionGeometry(plan, media.videoWidth, media.videoHeight);
      const raster = previewSize(geometry.width, geometry.height);
      if (surface.width !== raster.width || surface.height !== raster.height) {
        surface.width = raster.width;
        surface.height = raster.height;
      }
      setRatio(geometry.width / geometry.height);
      const ctx = surface.getContext("2d");
      if (!ctx) {
        setState("unavailable");
        return;
      }
      ctx.setTransform(raster.width / geometry.width, 0, 0, raster.height / geometry.height, 0, 0);
      ctx.clearRect(0, 0, geometry.width, geometry.height);
      for (const layer of geometry.layers) {
        const s = layer.source,
          d = layer.destination;
        ctx.save();
        ctx.filter = layer.blur ? "blur(15px)" : "none";
        ctx.drawImage(media, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height);
        ctx.restore();
      }
      const relativeMs = media.currentTime * 1000 - plan.startMs;
      for (const cue of plan.captions) {
        if (relativeMs < cue.startMs || relativeMs > cue.endMs) continue;
        const fontSize = Math.max(16, Math.floor(geometry.width / 23));
        ctx.font = `600 ${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const maxWidth = geometry.width - 32;
        const lines = wrapCaption(cue.text);
        const textWidth = Math.min(maxWidth, Math.max(...lines.map((line) => ctx.measureText(line).width)));
        const y = geometry.height * 0.8,
          lineHeight = fontSize * 1.15;
        ctx.fillStyle = "rgba(0,0,0,.45)";
        ctx.fillRect(
          (geometry.width - textWidth) / 2 - 8,
          y - 8,
          textWidth + 16,
          lines.length * lineHeight + 16,
        );
        ctx.strokeStyle = "black";
        ctx.lineWidth = 2;
        lines.forEach((line, index) => {
          ctx.strokeText(line, geometry.width / 2, y + index * lineHeight, maxWidth);
          ctx.fillStyle = "white";
          ctx.fillText(line, geometry.width / 2, y + index * lineHeight, maxWidth);
        });
      }
      setState("ready");
    } catch {
      setState("unavailable");
    }
  };
  const current = useRef({ plan, onTimeChange, onPlayingChange });
  current.current = { plan, onTimeChange, onPlayingChange };
  useEffect(() => {
    const media = videoRef.current;
    if (!media) return;
    const source = `/api/sources/${moment.source_id}/media`;
    if (media.getAttribute("src") !== source) {
      media.src = source;
      media.load();
    }
    let frame = 0;
    const update = () => {
      setDisplayTime(media.currentTime * 1000);
      current.current.onTimeChange(media.currentTime * 1000);
      draw.current();
    };
    const tick = () => {
      if (media.currentTime * 1000 >= current.current.plan.endMs) media.pause();
      draw.current();
      if (!media.paused) frame = requestAnimationFrame(tick);
    };
    const play = () => {
      current.current.onPlayingChange(true);
      cancelAnimationFrame(frame);
      tick();
    };
    const pause = () => {
      current.current.onPlayingChange(false);
      cancelAnimationFrame(frame);
      update();
    };
    const metadata = () => {
      media.currentTime = current.current.plan.startMs / 1000;
    };
    const failed = () => setState("unavailable");
    media.addEventListener("loadedmetadata", metadata);
    media.addEventListener("loadeddata", update);
    media.addEventListener("seeked", update);
    media.addEventListener("timeupdate", update);
    media.addEventListener("play", play);
    media.addEventListener("pause", pause);
    media.addEventListener("error", failed);
    if (media.readyState >= 1) metadata();
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("loadedmetadata", metadata);
      media.removeEventListener("loadeddata", update);
      media.removeEventListener("seeked", update);
      media.removeEventListener("timeupdate", update);
      media.removeEventListener("play", play);
      media.removeEventListener("pause", pause);
      media.removeEventListener("error", failed);
      media.pause();
      media.removeAttribute("src");
      media.load();
    };
  }, [videoRef, moment.source_id]);
  useEffect(() => {
    const media = videoRef.current;
    if (!media) return;
    media.muted = plan.muteAudio;
    if (
      media.readyState >= 1 &&
      (media.currentTime * 1000 < plan.startMs || media.currentTime * 1000 > plan.endMs)
    )
      media.currentTime = plan.startMs / 1000;
    draw.current();
  }, [plan, videoRef]);
  return (
    <section
      className={`composition-stage ${state === "unavailable" ? "preview-unavailable" : ""}`}
      aria-label="Composition preview"
    >
      <canvas
        data-testid="composition-stage"
        ref={canvas}
        style={{ aspectRatio: ratio }}
        aria-label="Live draft composition"
        role="img"
      />
      <video
        ref={videoRef}
        className="composition-source"
        aria-label="Source video"
        playsInline
        preload="auto"
        controls={state === "unavailable"}
        src={`/api/sources/${moment.source_id}/media`}
      />
      {plan.captions
        .filter((cue) => displayTime - plan.startMs >= cue.startMs && displayTime - plan.startMs <= cue.endMs)
        .map((cue, index) => (
          <span className="visually-hidden" data-testid="preview-caption" key={cue.id || index}>
            {cue.text}
          </span>
        ))}
      {state === "loading" && (
        <span className="stage-message" role="status">
          Loading composition…
        </span>
      )}
      {state === "unavailable" && (
        <span className="stage-message" role="status">
          Composition unavailable. Source playback and trim remain available.
        </span>
      )}
    </section>
  );
}
