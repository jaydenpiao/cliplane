import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const fixture = path.resolve("work/workbench-original.mp4");
const origin = process.env.E2E_BASE_URL || "http://localhost:3000";
const mutationHeaders = { Origin: origin };
let candidate: any;
let sourceId: string;

async function register(request: APIRequestContext) {
  const response = await request.post(`${origin}/api/auth/register`, {
    headers: mutationHeaders,
    data: {
      email: `workbench-${randomUUID()}@example.test`,
      password: randomUUID(),
      name: "Original fixture creator",
      workspace: "Workbench regression",
    },
  });
  expect(response.status()).toBe(201);
}

async function openEditor(page: Page) {
  await page.goto("/");
  await page.locator(".moment-image").first().click();
  return page.getByRole("dialog", { name: "Clip editor" });
}

async function seek(slider: Locator, seconds: number) {
  const bounds = await slider.boundingBox();
  if (!bounds) throw new Error("Timeline must be visible for pointer scrubbing");
  const minimum = Number(await slider.getAttribute("min"));
  const maximum = Number(await slider.getAttribute("max"));
  await slider.click({
    position: {
      x: 8 + ((seconds - minimum) / (maximum - minimum)) * (bounds.width - 16),
      y: bounds.height / 2,
    },
  });
}

async function previewCaptionPixels(stage: Locator): Promise<number> {
  return stage.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (!context) throw new Error("Preview canvas must expose its rendered pixels");
    const pixels = context.getImageData(
      0,
      Math.floor(element.height * 0.74),
      element.width,
      Math.floor(element.height * 0.2),
    ).data;
    let white = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) white++;
    return white;
  });
}

test.beforeAll(async () => {
  await mkdir("work", { recursive: true });
  if (existsSync(fixture)) return;
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x802030:s=640x360:r=24:d=12,drawbox=x=320:y=0:w=320:h=360:color=0x203080:t=fill,drawbox=x=0:y=0:w=150:h=100:color=0xf5cf30:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='%{n}':fontcolor=white:fontsize=30:x=(w-tw)/2:y=12",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=12",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    fixture,
  ]);
});

test.beforeEach(async ({ page }) => {
  const request = page.request;
  await register(request);
  const response = await request.post("/api/sources", {
    headers: mutationHeaders,
    multipart: {
      metadata: JSON.stringify({
        title: "Workbench original color panels",
        creator: "Original fixture creator",
        game: "Original synthetic media",
        platform: "local",
        capturedAt: "2026-11-17T00:00:00Z",
        authorizationBasis: "I created these original test patterns and audio",
        attestation: true,
        voiceAuthorized: true,
        embargoed: false,
      }),
      file: { name: "workbench-original.mp4", mimeType: "video/mp4", buffer: await readFile(fixture) },
    },
  });
  expect(response.status()).toBe(201);
  sourceId = (await response.json()).id;
  await expect
    .poll(
      async () => {
        const moments = await (await request.get("/api/candidates")).json();
        candidate = moments.find((moment: any) => moment.source_id === sourceId);
        return !!candidate;
      },
      { timeout: 45000 },
    )
    .toBe(true);
});

test.afterEach(async ({ page }) => {
  const request = page.request;
  if (sourceId) await request.delete(`/api/sources/${sourceId}`, { headers: mutationHeaders });
  sourceId = "";
});

test("editor URL survives reload and history without exposing another workspace", async ({
  page,
  browser,
}) => {
  const editor = await openEditor(page);
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`\\?clip=${candidate.id}$`));
  const editorUrl = page.url();
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Clip title", { exact: true })).toHaveValue(candidate.title);
  await page.goBack();
  await expect(editor).toHaveCount(0);
  await page.goForward();
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(page).not.toHaveURL(/clip=/);
  await expect(editor).toHaveCount(0);
  const anonymous = await browser.newContext();
  try {
    const otherPage = await anonymous.newPage();
    await otherPage.goto(editorUrl);
    await expect(otherPage.getByLabel("Email address", { exact: true })).toBeVisible();
    await expect(otherPage.getByRole("dialog", { name: "Clip editor" })).toHaveCount(0);
    expect((await anonymous.request.get(`${origin}/api/candidates/${candidate.id}`)).status()).toBe(401);
    await register(anonymous.request);
    await otherPage.goto(editorUrl);
    await expect(otherPage.getByRole("dialog", { name: "Clip editor" })).toHaveCount(0);
    for (const endpoint of [
      `candidates/${candidate.id}`,
      `candidates/${candidate.id}/thumbnail`,
      `sources/${sourceId}/media`,
    ]) {
      expect((await anonymous.request.get(`${origin}/api/${endpoint}`)).status()).toBe(404);
    }
  } finally {
    await anonymous.close();
  }
});

test("transient clip refresh preserves drafts until recovery or authoritative access loss", async ({
  page,
}) => {
  const editor = await openEditor(page);
  const title = editor.getByLabel("Clip title", { exact: true });
  await title.fill("An unsaved original draft survives a refresh failure");
  const detailUrl = `**/api/candidates/${candidate.id}`;
  let failedPolls = 0;
  await page.route(detailUrl, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    failedPolls++;
    await route.fulfill({ status: 500, json: { error: "Temporary backend failure" } });
  });
  await expect.poll(() => failedPolls, { timeout: 8000 }).toBeGreaterThan(0);
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(title).toHaveValue("An unsaved original draft survives a refresh failure");
  await expect(editor.getByRole("alert")).toContainText(/temporar|retry|try again/i);
  await page.unroute(detailUrl);
  await page.waitForResponse(
    (response) => response.url().endsWith(`/api/candidates/${candidate.id}`) && response.status() === 200,
    { timeout: 8000 },
  );
  await expect(editor).toBeVisible();
  await expect(title).toHaveValue("An unsaved original draft survives a refresh failure");
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await page.route(detailUrl, (route) => route.fulfill({ status: 404, json: { error: "Moment not found" } }));
  await page.waitForResponse(
    (response) => response.url().endsWith(`/api/candidates/${candidate.id}`) && response.status() === 404,
    { timeout: 8000 },
  );
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Composition preview" })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: /unavailable/i })).toBeVisible();
});

test("draft composition and decoded filmstrip follow real seeking and keyboard trims", async ({ page }) => {
  const editor = await openEditor(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["PATCH", "POST"].includes(request.method())) writes.push(request.url());
  });
  const preview = editor.getByRole("region", { name: "Composition preview" });
  const stage = preview.getByTestId("composition-stage");
  const video = preview.getByLabel("Source video", { exact: true });
  await expect(stage).toBeVisible();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  await editor.getByRole("button", { name: "Original", exact: false }).click();
  await expect
    .poll(() => stage.evaluate((element: HTMLCanvasElement) => element.width / element.height))
    .toBeCloseTo(16 / 9, 2);
  await editor.getByRole("button", { name: "Vertical crop" }).click();
  await editor.getByText("Manual gameplay crop", { exact: true }).click();
  await editor.getByLabel("width %", { exact: true }).first().fill("50");
  await expect
    .poll(() =>
      stage.evaluate((element: HTMLCanvasElement) => {
        const context = element.getContext("2d");
        if (!context) throw new Error("Preview canvas must expose its rendered pixels");
        const pixel = context.getImageData(element.width / 2, element.height / 2, 1, 1).data;
        return pixel[0] > pixel[1] * 2 && pixel[0] > pixel[2] * 2;
      }),
    )
    .toBe(true);
  await editor.getByLabel("x %", { exact: true }).first().fill("50");
  await expect
    .poll(() =>
      stage.evaluate((element: HTMLCanvasElement) => {
        const context = element.getContext("2d");
        if (!context) throw new Error("Preview canvas must expose its rendered pixels");
        const pixel = context.getImageData(element.width / 2, element.height / 2, 1, 1).data;
        return pixel[2] > pixel[0] * 2 && pixel[2] > pixel[1] * 2;
      }),
    )
    .toBe(true);
  await editor.getByLabel("Mute all audio").check();
  await expect(video).toHaveJSProperty("muted", true);
  await editor.getByLabel("Start (seconds)", { exact: true }).fill("2");
  await editor.getByLabel("End (seconds)", { exact: true }).fill("6");
  await expect(editor.locator(".timeline-labels").locator(":scope > *")).toHaveText([
    "0:00",
    "4.0s selected",
    "0:12",
  ]);
  await editor.getByRole("button", { name: "Add cue" }).click();
  await editor.getByLabel("Caption 1", { exact: true }).fill("A live original caption");
  await editor.getByLabel("From", { exact: true }).fill("0.5");
  await editor.getByLabel("To", { exact: true }).fill("1.5");
  const playhead = editor.getByRole("slider", { name: "Playhead", exact: true });
  await seek(playhead, 3);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeCloseTo(3, 0);
  await expect(preview.getByTestId("preview-caption")).toHaveText("A live original caption");
  await expect.poll(() => previewCaptionPixels(stage)).toBeGreaterThan(80);
  await seek(playhead, 4.5);
  await expect(editor.getByText("Source time", { exact: false })).toContainText("0:04");
  await expect(preview.getByTestId("preview-caption")).toHaveCount(0);
  await expect.poll(() => previewCaptionPixels(stage)).toBeLessThan(10);
  const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  await playhead.press("ArrowRight");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(before);
  const frames = editor.getByRole("region", { name: "Timeline filmstrip" }).locator("canvas,img");
  await expect.poll(() => frames.count()).toBeGreaterThanOrEqual(4);
  await expect
    .poll(() =>
      frames.evaluateAll(
        (elements) =>
          new Set(
            elements.map((element) => {
              if (element instanceof HTMLCanvasElement) return element.toDataURL();
              const image = element as HTMLImageElement;
              if (!image.naturalWidth) return "unloaded";
              const canvas = document.createElement("canvas");
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const context = canvas.getContext("2d");
              if (!context) throw new Error("Filmstrip sampling requires a canvas");
              context.drawImage(image, 0, 0);
              return canvas.toDataURL();
            }),
          ).size,
      ),
    )
    .toBeGreaterThanOrEqual(3);
  await editor.getByRole("button", { name: "Seek to 5.3 seconds", exact: true }).click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeCloseTo(5.25, 1);
  await editor.getByRole("button", { name: "Play selection", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(3);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused), { timeout: 7000 })
    .toBe(true);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThanOrEqual(
    5.9,
  );
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(6.25);
  const trimStart = editor.getByRole("slider", { name: "Trim start", exact: true });
  await trimStart.focus();
  await trimStart.press("ArrowRight");
  await expect
    .poll(async () => Number(await editor.getByLabel("Start (seconds)", { exact: true }).inputValue()))
    .toBeGreaterThan(2);
  const trimEnd = editor.getByRole("slider", { name: "Trim end", exact: true });
  await trimEnd.press("Home");
  const start = Number(await editor.getByLabel("Start (seconds)", { exact: true }).inputValue());
  const end = Number(await editor.getByLabel("End (seconds)", { exact: true }).inputValue());
  expect(end - start).toBeGreaterThanOrEqual(0.099);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeLessThanOrEqual(12);
  expect(writes).toEqual([]);
});

test("approved export contains the chosen trim, portrait composition, mute and timed caption", async ({
  page,
}) => {
  const editor = await openEditor(page);
  await editor.getByLabel("Start (seconds)", { exact: true }).fill("2");
  await editor.getByLabel("End (seconds)", { exact: true }).fill("6");
  await editor.getByRole("button", { name: "Vertical crop" }).click();
  await editor.getByLabel("Mute all audio").check();
  await editor.getByRole("button", { name: "Add cue" }).click();
  await editor.getByLabel("Caption 1", { exact: true }).fill("An original test moment.");
  await editor.getByLabel("From", { exact: true }).fill("0.5");
  await editor.getByLabel("To", { exact: true }).fill("1.5");
  await editor.getByRole("button", { name: "Rights & review" }).click();
  const approve = editor.getByRole("button", { name: "Approve & render", exact: true });
  await expect(approve).toBeDisabled();
  await editor.getByLabel("Game / underlying content rights").selectOption("authorized");
  await editor.getByLabel("Music rights").selectOption("removed");
  await editor.getByLabel("Spoiler risk").selectOption("low");
  await approve.click();
  const download = editor.getByRole("link", { name: "Download", exact: true });
  await expect(download).toBeVisible({ timeout: 45000 });
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  const output = path.resolve("work/workbench-export.mp4");
  await file.saveAs(output);
  const result = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height:format=duration",
        "-of",
        "json",
        output,
      ],
      { encoding: "utf8" },
    ),
  );
  expect(result.streams).toEqual([
    expect.objectContaining({ codec_type: "video", width: 720, height: 1280 }),
  ]);
  expect(Number(result.format.duration)).toBeCloseTo(4, 1);
  execFileSync("ffmpeg", ["-v", "error", "-i", output, "-f", "null", "-"]);
  function captionWhitePixels(time: number): number {
    const pixels = execFileSync("ffmpeg", [
      "-v",
      "error",
      "-ss",
      String(time),
      "-i",
      output,
      "-frames:v",
      "1",
      "-vf",
      "crop=720:260:0:950,scale=360:130",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ]);
    let count = 0;
    for (let i = 0; i < pixels.length; i += 3)
      if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) count++;
    return count;
  }
  expect(captionWhitePixels(0.25)).toBeLessThan(10);
  expect(captionWhitePixels(1)).toBeGreaterThan(80);
  expect(captionWhitePixels(2)).toBeLessThan(10);
  await editor.getByRole("button", { name: "Watch rendered output", exact: true }).click();
  const actualOutput = editor.getByLabel("Actual rendered output", { exact: true });
  const sourceVideo = editor.getByLabel("Source video", { exact: true });
  await expect(actualOutput).toBeVisible();
  await actualOutput.evaluate((element: HTMLVideoElement) => element.play());
  await expect
    .poll(() => actualOutput.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.1);
  await editor.getByRole("button", { name: "Play selection", exact: true }).click();
  await expect(actualOutput).toHaveCount(0);
  await expect(editor.getByRole("region", { name: "Composition preview" })).toBeVisible();
  await expect(sourceVideo).toHaveJSProperty("paused", false);
  expect(
    await editor
      .locator("video")
      .evaluateAll((elements: HTMLVideoElement[]) => elements.filter((element) => !element.paused).length),
  ).toBe(1);
  await editor.getByRole("button", { name: "Watch rendered output", exact: true }).click();
  await expect(actualOutput).toBeVisible();
  await expect(sourceVideo).toHaveJSProperty("paused", true);
  await seek(editor.getByRole("slider", { name: "Playhead", exact: true }), 3.5);
  await expect(actualOutput).toHaveCount(0);
  await expect(editor.getByRole("region", { name: "Composition preview" })).toBeVisible();
  await expect
    .poll(() => sourceVideo.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeCloseTo(3.5, 0);
  await editor.getByRole("button", { name: "Watch rendered output", exact: true }).click();
  await expect(actualOutput).toBeVisible();
  await editor.getByRole("button", { name: "Edit clip", exact: true }).click();
  await editor.getByLabel("End (seconds)", { exact: true }).fill("5");
  await expect(editor.getByLabel("Actual rendered output", { exact: true })).toHaveCount(0);
  await expect(editor.getByRole("region", { name: "Composition preview" })).toBeVisible();
  await expect(download).toBeHidden();
  await expect(editor.getByRole("status")).toHaveCount(0);
});
