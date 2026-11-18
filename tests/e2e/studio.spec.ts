import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

async function expectAccessible(page: Page, context: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
    context,
  ).toEqual([]);
}

test("sample studio is responsive and uses real media", async ({ page }) => {
  await page.goto("/");
  await expectAccessible(page, "Sign-in accessibility");
  await page.getByRole("button", { name: "Explore the sample studio" }).click();
  await expect(page.getByRole("heading", { name: "Your studio" })).toBeVisible();
  await expect(page.locator(".moment-card").first()).toBeVisible();
  await expect(page.locator(".moment-card img").first()).toHaveJSProperty("naturalWidth", 640);
  await expectAccessible(page, "Studio accessibility");
  const firstMoment = page.locator(".moment-image").first();
  await firstMoment.focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog");
  await expect(editor).toBeVisible();
  await expectAccessible(page, "Editor accessibility");
  await expect.poll(() => editor.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => editor.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(firstMoment).toBeFocused();
  await page.getByRole("button", { name: "Upload recording", exact: true }).click();
  await expectAccessible(page, "Upload accessibility");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await mkdir("work/screenshots", { recursive: true });
  await page.screenshot({ path: "work/screenshots/studio-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Your studio" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page, "Mobile studio accessibility");
  await page.screenshot({ path: "work/screenshots/studio-mobile.png", fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const menuButton = page.getByRole("button", { name: "Open menu" });
  const menu = page.locator(".sidebar");
  const closeMenu = menu.getByRole("button", { name: "Close menu" });
  await menuButton.focus();
  await page.keyboard.press("Enter");
  await expect(closeMenu).toBeVisible();
  const transitionSeconds = await menu.evaluate((drawer) =>
    Math.max(...getComputedStyle(drawer).transitionDuration.split(",").map(Number.parseFloat)),
  );
  expect.soft(transitionSeconds, "Reduced motion removes the drawer animation").toBeLessThan(1 / 60);
  await expect(closeMenu).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(menu.locator(".user-profile")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeMenu).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(closeMenu).toBeHidden();
  await expect(menuButton).toBeFocused();

  await page.keyboard.press("Enter");
  await menu.getByRole("button", { name: "Help & workflow" }).click();
  const help = page.getByRole("dialog", { name: "Make room for the good stuff." });
  await expect(help).toBeVisible();
  await expect(closeMenu).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(menuButton).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(closeMenu).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await expect(closeMenu).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await menuButton.click();
  await page.getByRole("button", { name: "Recordings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your recordings." })).toBeVisible();
});

test("creator uploads, edits, reviews, renders and downloads a real clip", async ({ page }) => {
  const fixture = path.resolve("work/e2e-fixture.mp4");
  await mkdir("work", { recursive: true });
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=24:d=3",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    fixture,
  ]);
  // A valid MP4 free box makes the real upload exceed Next's default 10 MB proxy limit.
  const padding = Buffer.alloc(11 * 1024 * 1024);
  padding.writeUInt32BE(padding.length, 0);
  padding.write("free", 4);
  await appendFile(fixture, padding);
  await page.goto("/");
  await page.getByRole("button", { name: "Create a workspace", exact: true }).click();
  await page.getByLabel("Your name", { exact: true }).fill("E2E Creator");
  await page.getByLabel("Workspace name").fill("Fixture studio");
  await page.getByLabel("Email address").fill(`test-${randomUUID()}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(randomUUID());
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your studio" })).toBeVisible();
  await page.getByRole("button", { name: "Upload recording", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByLabel("Recording title").fill("Browser synthetic fixture");
  await page.getByLabel("Creator", { exact: true }).fill("E2E Creator");
  await page.getByLabel("Game", { exact: true }).fill("Original generated test pattern");
  await page.getByLabel("Authorization basis").fill("I created this synthetic video for testing");
  await page.getByLabel("I own or am authorized").check();
  await page.getByLabel("The creator authorizes").check();
  await page.getByRole("button", { name: "Find my moments" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".moment-card")).toHaveCount(1, { timeout: 30000 });
  await page.locator(".moment-image").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("End (seconds)").fill("2");
  await page.getByRole("button", { name: "Vertical crop" }).click();
  await page.getByRole("button", { name: "Add cue" }).click();
  await page.getByLabel("Caption 1", { exact: true }).fill("An original test moment.");
  await page.getByRole("button", { name: "Rights & review" }).click();
  await page.getByLabel("Game / underlying content rights").selectOption("authorized");
  await page.getByLabel("Music rights").selectOption("removed");
  await page.getByLabel("Spoiler risk").selectOption("low");
  await page.screenshot({ path: "work/screenshots/editor-review.png", fullPage: true });
  await page.getByRole("button", { name: "Approve & render", exact: true }).click();
  const download = page.getByRole("link", { name: "Download", exact: true });
  await expect(download).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText("Your export is ready to download.");
  await page.getByRole("button", { name: "Edit clip", exact: true }).click();
  const clipTitle = page.getByLabel("Clip title", { exact: true });
  const approvedTitle = await clipTitle.inputValue();
  await clipTitle.fill(`${approvedTitle} draft`);
  await expect(download).toBeHidden();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveCount(0);
  await clipTitle.fill(approvedTitle);
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText("Your export is ready to download.");
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(await file.failure()).toBeNull();
  await file.saveAs("work/e2e-output.mp4");
  const result = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=width,height", "-of", "json", "work/e2e-output.mp4"],
      { encoding: "utf8" },
    ),
  );
  expect(result.streams[0]).toMatchObject({ width: 720, height: 1280 });
  await page.getByRole("button", { name: "Close editor" }).click();
  await page.getByRole("button", { name: "Recordings", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Browser synthetic fixture", { exact: true })).toHaveCount(0);
});
