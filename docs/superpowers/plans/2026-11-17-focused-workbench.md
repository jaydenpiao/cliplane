# Focused Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track each task and preserve passing evidence.

**Goal:** Replace passive source playback and form-heavy editing with a simple live media workbench and an honest product demo.

**Architecture:** Keep existing authenticated APIs and modal focus behavior. Add pure trim/composition helpers, a canvas preview and serial browser filmstrip sampler. Resolve URL-selected clips through candidate detail; preserve revision-bound approval and actual-output separation.

**Tech Stack:** Existing TypeScript, Next.js/React, CSS, Lucide, Playwright/axe, PostgreSQL17, Python/FFmpeg.

**Spec:** docs/superpowers/specs/2026-11-17-focused-workbench-design.md

## Global Constraints

- Modern light/violet, self-hosted Geist; no new UI dependency.
- Original synthetic demo media; authenticated/private media URLs.
- Preserve independent rights review, immutable masters and exact edit/rights revision approval.
- Trim 100–180000 ms within source bounds; captions use clip-relative milliseconds.
- Working preview is a draft approximation; actual rendered output is clearly labelled and authoritative.
- Existing modal focus/escape and desktop/mobile keyboard workflows remain functional.
- One implementation issue active: #45. Decoder isolation and cloud deployment remain open.

## Review Focus

- Very short/long sources and crossed/invalid trim input retain a valid selection.
- Source/candidate switch or unmount cancels sampling and drawing; playback cannot leak.
- Draft edits after export hide stale actual output and download/ready notices.
- URL refresh/back/forward, signed-out login and foreign workspace links remain safe.
- Crop geometry, facecam, caption timing and muted preview agree with real export within documented preview limits.

## Task 1: Workbench implementation

**Files:** apps/web/components/editor-dialog.tsx; new composition-preview.tsx and clip-timeline.tsx; apps/web/lib/editor.ts; apps/web/lib/api.ts; apps/web/app/page.tsx; apps/web/app/globals.css; tests/editor.test.ts.

**Interfaces:** Components consume Moment and EditPlan; pure helpers clamp trim/captions and compute source/destination draw rectangles. Keep existing user-facing labels from studio.spec. New accessible regions: Composition preview, Timeline filmstrip. Sliders: Playhead, Trim start, Trim end. Source video aria-label Source video. Visual evidence IDs: composition-stage and filmstrip-frame. URLs use ?clip=UUID.

- [x] Write focused pure-helper tests for source bounds, 100 ms/180000 ms, non-finite inputs, caption truncation and draw geometry; run red.
- [x] Implement helpers and coherent live composition/timeline/inspector/deep-link UI, preserving save/review fencing and authenticated media. Run helper tests and typecheck/lint.
- [x] Review the diff independently for spec and code quality; fix material findings and run affected checks.

## Task 2: Browser acceptance and polish

**Files:** tests/e2e/workbench.spec.ts; affected Task1 files only for reproduced fixes.

**Interfaces:** Retain Start (seconds), End (seconds), Clip title, Caption 1, layout buttons, Play selection, Rights & review, Save, Approve & render and Download. Use actual authenticated proxy frames and original media fixtures.

- [x] Capture meaningful failing browser tests before implementation: live preview, distinct decoded filmstrip, scrubbing/keyboard trim, reload/back/deep-link and private-link behavior.
- [x] Verify actual muted 4s 720×1280 export from a 2–6s selection and timed caption; check downloaded media with ffprobe/decode/frame evidence.
- [x] Run npm run check and both browser workflows; inspect desktop/mobile screenshots, focus, actual playback, long content, error/loading states and axe results. Fix failures and inspect again.

## Task 3: Demo, checkpoint and integration

**Files:** docs/research/workbench-ui.md; docs/context/current.md; docs/verification.md; demo/evidence files under docs/demos and user-facing output.

- [x] Record a clear real-workflow demo with original moving footage and actual exported playback. Inspect saved screenshots and sample/play back the final video.
- [x] Perform whole-branch independent review; resolve material findings; checkpoint exact revision/checks/limits and next issue.
- [ ] Commit with verified jaydenpiao identity, open concise PR linked to #45; require current-head quality/browser/container/secrets/CodeQL before authorized merge. Do not claim deployment.

Source accepted at `026348897cdc265dba52241433f2873407666ab6`: 105 TS/API/helper,
13 Python/media and six browser workflows pass. Independent source review and
inspected 44.733s demo are complete. Last integration checkbox follows live PR/CI
state; a merged PR is authority and must not trigger repeated implementation.
