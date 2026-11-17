import type { EditPlan } from "../../../packages/domain/src/index";

const finite = (value: number, fallback: number) => (Number.isFinite(value) ? Math.round(value) : fallback);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** All editor entry points share the same interval and clip-relative cue rules. */
export function trimPlan(
  plan: EditPlan,
  durationMs: number,
  boundary?: "startMs" | "endMs",
  value?: number,
): EditPlan {
  const duration = Math.max(0, finite(durationMs, 0));
  const minimum = Math.min(100, duration);
  let startMs = clamp(finite(plan.startMs, 0), 0, Math.max(0, duration - minimum));
  let endMs = clamp(finite(plan.endMs, duration), startMs + minimum, duration);
  if (boundary === "startMs") {
    startMs = clamp(finite(value ?? plan.startMs, startMs), 0, endMs - minimum);
    endMs = Math.min(endMs, startMs + 180000);
  } else if (boundary === "endMs") {
    endMs = clamp(finite(value ?? plan.endMs, endMs), startMs + minimum, duration);
    startMs = Math.max(startMs, endMs - 180000);
  } else endMs = Math.min(endMs, startMs + 180000);
  const length = endMs - startMs;
  return {
    ...plan,
    startMs,
    endMs,
    captions: plan.captions
      .map((cue) => ({
        ...cue,
        startMs: Math.max(0, finite(cue.startMs, 0)),
        endMs: Math.min(length, finite(cue.endMs, length)),
      }))
      .filter((cue) => cue.startMs < cue.endMs),
  };
}

export function updateCaption(
  plan: EditPlan,
  index: number,
  boundary: "startMs" | "endMs",
  value: number,
): EditPlan {
  const length = plan.endMs - plan.startMs;
  return {
    ...plan,
    captions: plan.captions.map((cue, i) =>
      i !== index
        ? cue
        : {
            ...cue,
            [boundary]:
              boundary === "startMs"
                ? clamp(finite(value, cue.startMs), 0, cue.endMs - 1)
                : clamp(finite(value, cue.endMs), cue.startMs + 1, length),
          },
    ),
  };
}

export function normalizeCrop(rect: EditPlan["crop"]): EditPlan["crop"] {
  const number = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  const x = clamp(number(rect.x, 0), 0, 0.98),
    y = clamp(number(rect.y, 0), 0, 0.98);
  return {
    x,
    y,
    width: Math.min(clamp(number(rect.width, 1), 0.02, 1), 1 - x),
    height: Math.min(clamp(number(rect.height, 1), 0.02, 1), 1 - y),
  };
}

type Rect = { x: number; y: number; width: number; height: number };
export interface CompositionGeometry {
  width: number;
  height: number;
  layers: { source: Rect; destination: Rect; blur?: boolean }[];
}

/** FFmpeg's even-pixel crop and centered fit, evaluated against decoded proxy dimensions. */
export function compositionGeometry(
  plan: EditPlan,
  decodedWidth: number,
  decodedHeight: number,
): CompositionGeometry {
  const width = Math.max(2, Math.floor(decodedWidth / 2) * 2),
    height = Math.max(2, Math.floor(decodedHeight / 2) * 2);
  const full = { x: 0, y: 0, width, height };
  const crop = (input: EditPlan["crop"]): Rect => {
    const r = normalizeCrop(input);
    const w = Math.max(2, Math.floor((r.width * width) / 2) * 2),
      h = Math.max(2, Math.floor((r.height * height) / 2) * 2);
    return {
      x: Math.min(Math.floor(r.x * width), width - w),
      y: Math.min(Math.floor(r.y * height), height - h),
      width: w,
      height: h,
    };
  };
  const fill = (source: Rect, destination: Rect) => {
    const ratio = destination.width / destination.height;
    const w = Math.min(source.width, source.height * ratio),
      h = Math.min(source.height, source.width / ratio);
    return {
      source: {
        x: source.x + (source.width - w) / 2,
        y: source.y + (source.height - h) / 2,
        width: w,
        height: h,
      },
      destination,
    };
  };
  if (plan.layout === "original") return { width, height, layers: [{ source: full, destination: full }] };
  const output = { x: 0, y: 0, width: 720, height: 1280 };
  const game = crop(plan.crop);
  if (plan.layout === "crop") return { width: 720, height: 1280, layers: [fill(game, output)] };
  if (plan.layout === "facecam")
    return {
      width: 720,
      height: 1280,
      layers: [
        fill(crop(plan.facecam), { ...output, height: 426 }),
        fill(game, { ...output, y: 426, height: 854 }),
      ],
    };
  const scale = Math.min(720 / game.width, 1280 / game.height);
  const w = game.width * scale,
    h = game.height * scale;
  return {
    width: 720,
    height: 1280,
    layers: [
      { ...fill(full, output), blur: true },
      { source: game, destination: { x: (720 - w) / 2, y: (1280 - h) / 2, width: w, height: h } },
    ],
  };
}

export function previewSize(width: number, height: number, maxEdge = 1280) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function wrapCaption(text: string): string[] {
  return text.split(/\r?\n/).flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      if (line && line.length + word.length + 1 > 36) {
        lines.push(line);
        line = "";
      }
      let rest = word;
      while (rest.length > 36) {
        lines.push(rest.slice(0, 36));
        rest = rest.slice(36);
      }
      if (rest) line = line ? `${line} ${rest}` : rest;
    }
    lines.push(line);
    return lines;
  });
}
