# Studio Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Improve the light studio's visual clarity, refresh its README and leave the real app running in the Codex cloud session.

**Architecture:** Existing React components and CSS retain the working workflow. A public original-media screenshot supplies entry imagery; documentation explains current verified capabilities and setup.

**Tech Stack:** Next16.4.6, React, existing CSS/Geist/Lucide, PostgreSQL, Python/FFmpeg, Playwright/axe.

**Spec:** `docs/superpowers/specs/2026-11-17-studio-polish-design.md`.

## Global Constraints

- Light UI, no new dependency, no auth/API/editor behavior change.
- Preserve private media, revision approval, real playback and managed CI browser.
- One implementation issue; #2 deferred, full sandbox and deployment remain open.
- Local/session server does not imply a shareable preview URL or deployed service.
- Reuse unchanged passing evidence; full check and affected browser flows required.

## Review Focus

- Long workspace/title strings must truncate or wrap without moving actions away.
- Mobile registration/sample entry must remain reachable with ordinary scrolling.
- Decorative product imagery must be identified as a sample and never imply live authenticated media.
- Hover/focus/disabled colors must keep icon text visible and errors readable.
- Empty/search states, mobile menu dismissal and editor focus must keep working.

### Task 1: Entry and library visual polish

**Files:** `apps/web/components/auth-screen.tsx`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`, one preview image in `apps/web/public/`.
**Interfaces:** Existing auth callbacks, navigation labels and card/editor selectors remain. Public preview uses only the existing authorized docs image.

- [x] Inspect baseline report/screens and installed Next CSS docs.
- [x] Implement the selected media-led entry, quieter shell/sidebar and 16:9 compact cards; edit existing rules rather than add a long competing override layer.
- [x] Run scoped formatting/types. Root runs settled source browser/media workflows once.
- [x] Report changed files and any material limitation; root commits after review.

### Task 1 review correction

- [x] Reproduce mobile menu focus/Escape and reduced-motion failures in a real browser regression.
- [x] Fix drawer focus/return/Escape, prevent overlap with Help and release it on desktop resize; honor reduced motion.
- [x] Run scoped regression, final full/browser checks and independent fix review.

### Task 2: README and preview documentation

**Files:** `README.md`, optional focused `docs/development.md` clarification.
**Interfaces:** Screenshot paths `docs/images/studio-desktop.png` and `editor-review.png`, existing demo path; root refreshes image bytes after UI settles.

- [x] Rewrite around product, real demo, setup and honest current boundaries.
- [x] Correct managed Playwright CI/local CHROMIUM_PATH guidance; include uv requirement and controller preflight distinction.
- [x] Check referenced scripts/files and explain session preview requirements without inventing cloud URLs.
- [x] Report links/commands checked; root reviews and commits.

### Integration and verification (root)

- [x] Run npm run check with app stopped during shared .next build; restart selected revision safely on3000/4000.
- [x] Independent source review and actual desktop/mobile keyboard/axe inspection; fix material findings once scoped.
- [x] Refresh screenshots, DESIGN/verification and docs/context/current.md; update issue and cumulative ledger.
- [ ] Push verified attribution, open focused PR, require exact-head quality/browser/container/Secrets/CodeQL, then authorized merge.
- [ ] Leave the merged app running and record actual local URL, supervisor and cloud viewer/portal limitation.
