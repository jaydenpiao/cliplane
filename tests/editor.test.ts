import { describe, expect, test } from "vitest";
import {
  compositionGeometry,
  normalizeCrop,
  previewSize,
  trimPlan,
  updateCaption,
  wrapCaption,
} from "../apps/web/lib/editor";
import { defaultEditPlan } from "../packages/domain/src/index";

describe("trim selection", () => {
  test("clamps crossed boundaries to a 100ms interval within the source", () => {
    expect(trimPlan(defaultEditPlan(1000, 5000), 8000, "startMs", 9000)).toMatchObject({
      startMs: 4900,
      endMs: 5000,
    });
    expect(trimPlan(defaultEditPlan(1000, 5000), 8000, "endMs", -300)).toMatchObject({
      startMs: 1000,
      endMs: 1100,
    });
  });
  test("limits long selections to three minutes without losing the moved boundary", () => {
    expect(trimPlan(defaultEditPlan(0, 3000), 600000, "endMs", 500000)).toMatchObject({
      startMs: 320000,
      endMs: 500000,
    });
    expect(trimPlan(defaultEditPlan(400000, 500000), 600000, "startMs", 0)).toMatchObject({
      startMs: 0,
      endMs: 180000,
    });
  });
  test("normalizes initial intervals and ignores non-finite edits", () => {
    expect(trimPlan(defaultEditPlan(-1000, 999999), 250)).toMatchObject({ startMs: 0, endMs: 250 });
    expect(trimPlan(defaultEditPlan(100, 200), 250, "endMs", Number.NaN)).toMatchObject({
      startMs: 100,
      endMs: 200,
    });
    expect(trimPlan(defaultEditPlan(0, 200), 80)).toMatchObject({ startMs: 0, endMs: 80 });
  });
  test("shortening preserves clip-relative cues and drops empty or out-of-range cues", () => {
    const plan = defaultEditPlan(1000, 6000);
    plan.captions = [
      { startMs: 500, endMs: 4000, text: "keep" },
      { startMs: 3000, endMs: 5000, text: "drop" },
    ];
    expect(trimPlan(plan, 8000, "endMs", 3000).captions).toEqual([
      { startMs: 500, endMs: 2000, text: "keep" },
    ]);
  });
  test("caption inputs cannot cross or escape clip duration", () => {
    const plan = defaultEditPlan(2000, 6000);
    plan.captions = [{ startMs: 500, endMs: 2000, text: "cue" }];
    expect(updateCaption(plan, 0, "startMs", 9000).captions[0]).toMatchObject({ startMs: 1999, endMs: 2000 });
    expect(updateCaption(plan, 0, "endMs", -20).captions[0]).toMatchObject({ startMs: 500, endMs: 501 });
  });
});
describe("composition geometry", () => {
  test("uses decoded proxy dimensions for normalized gameplay crop and centered vertical fill", () => {
    const plan = defaultEditPlan(0, 4000);
    plan.layout = "crop";
    plan.crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    const geometry = compositionGeometry(plan, 640, 360);
    expect(geometry.width).toBe(720);
    expect(geometry.height).toBe(1280);
    expect(geometry.layers[0].source).toEqual({ x: 218.75, y: 0, width: 202.5, height: 360 });
    expect(geometry.layers[0].destination).toEqual({ x: 0, y: 0, width: 720, height: 1280 });
  });
  test("facecam occupies the same even upper third as FFmpeg", () => {
    const plan = defaultEditPlan(0, 4000);
    plan.layout = "facecam";
    const geometry = compositionGeometry(plan, 640, 360);
    expect(geometry.layers.map((layer) => layer.destination)).toEqual([
      { x: 0, y: 0, width: 720, height: 426 },
      { x: 0, y: 426, width: 720, height: 854 },
    ]);
    expect(geometry.layers[0].source.x).toBeGreaterThanOrEqual(0);
    expect(geometry.layers[0].source.width).toBeLessThanOrEqual(160);
  });
  test("blur fits the cropped foreground while original ignores crop", () => {
    const plan = defaultEditPlan(0, 4000);
    expect(compositionGeometry(plan, 640, 360).layers[1].destination).toEqual({
      x: 0,
      y: 437.5,
      width: 720,
      height: 405,
    });
    plan.layout = "original";
    expect(compositionGeometry(plan, 640, 360)).toMatchObject({
      width: 640,
      height: 360,
      layers: [{ source: { x: 0, y: 0, width: 640, height: 360 } }],
    });
  });
  test("crop inputs keep a minimum rectangle inside source boundaries", () => {
    const rect = normalizeCrop({ x: 0.99, y: -3, width: 9, height: Number.NaN });
    expect(rect).toMatchObject({ x: 0.98, y: 0, height: 1 });
    expect(rect.width).toBeCloseTo(0.02);
  });
});

test("preview raster bounds large and tall decoded sources without changing their ratio", () => {
  expect(previewSize(3840, 2160)).toEqual({ width: 1280, height: 720 });
  expect(previewSize(720, 1280)).toEqual({ width: 720, height: 1280 });
  expect(previewSize(100, 10000)).toEqual({ width: 13, height: 1280 });
});
test("preview captions preserve manual newlines and wrap long text in readable lines", () => {
  expect(wrapCaption("First line\nSecond line")).toEqual(["First line", "Second line"]);
  expect(wrapCaption("A clear original caption with several more words to wrap")).toEqual([
    "A clear original caption with",
    "several more words to wrap",
  ]);
  expect(wrapCaption("x".repeat(40))).toEqual(["x".repeat(36), "xxxx"]);
});
