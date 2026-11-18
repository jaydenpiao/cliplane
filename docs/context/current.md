# Current handoff

Updated 2026-11-17 (America/Los_Angeles). Verify live Git/GitHub before relying on this record.

## Goal and current increment

Treat user messages as cumulative unless cancelled. Latest priority: a modern light
UI, updated README and running application in this Codex web cloud session. Issue
[#49](https://github.com/jaydenpiao/cliplane/issues/49) is the selected increment,
branch `feat/studio-polish-preview`, worktree `/workspace/work/cliplane-studio-polish`,
base main `11b3062882ec810aa5544846a3b7b6acb8d8ed96`. Check live issue/linked PR before
acting. If integrated, do not repeat this UI/README increment.

Implementation is complete: media-led entry with a labelled, already-public original
sample-workbench image; quieter sidebar; compact16:9 cards; first390px mobile clip
at y345.8 versus416.8 baseline. README is product-first with current screenshots,
quickstart, uv activation, local/managed browser guidance and separate API/Next
forwarded-origin configuration. No dependency, auth/API or live-editor change.
Three inspected screenshots are refreshed in docs/images. Original45s demo retained;
no new footage, recording or claim about watching other startup demos was needed.

Actual desktop1440/tablet768 screenshots were inspected. Mobile390 login/register,
invalid credentials, studio, empty search, editor and long draft were exercised:
no document overflow; six loaded thumbnails; four focused axe scans0violations.
Axe results are not full conformance. A confirmed mobile drawer focus/Escape and
reduced-motion defect was reproduced in a meaningful browser regression and fixed.
Existing useDialog is reused; background inert, Help handoff and desktop resize
are covered. Source and fix reviews approve; README review findings are resolved.
`.superpowers` is excluded from local Docker build contexts to keep workflow scratch
private. Reports/screens: `/workspace/work/studio-polish/`.

Post-fix npm run check passes168TS/API/helper +13media tests, lint/types/Ruff/mypy
and production build: `/workspace/work/logs/studio-polish-final-check.log`.
Final post-fix six browser workflows pass (1.3m), including drawer/Help/resize/
reduced-motion regression and actual decoded-media export; independent focused
drawer recheck passes with a fifth zero-violation axe scan. Do not repeat these once recorded passing
without a new material change. Plan/spec: `docs/superpowers/{plans,specs}/2026-11-17-studio-polish*.md`.
Private plan ledger: `.superpowers/sdd/studio-polish/progress.md`; cumulative ledger:
`/workspace/work/iteration-ledger.md`. Root owns verification/integration.

App is running from this UI worktree on0.0.0.0:3000 with API loopback4000 and
original synthetic sample data; supervisor668337, recorded in
`/workspace/work/logs/cliplane-dev-supervisor.json`, log studio-polish-dev.log.
Check metadata/process identity and health before lifecycle changes. Stop the actual
supervisor before a build sharing .next. Local HTTP health and real Playwright UI
are verified. This does not establish a user-visible cloud preview.

The matching cloud environment reports running but no preview portals; no
open_cloud_preview/open_in_codex tools are exposed. Shared CUA failed with
`the gaas-browser node_repl sandbox cannot be disabled`. Never invent a preview URL,
use a public tunnel or claim the viewer works from HTTP health. After UI integration,
keep #49 open with the exact platform preview blocker; no production deployment is
claimed. If capability/access/usage remains unchanged, checkpoint and stop rather
than repeat the delivered UI or run another check loop. No purchases/upgrades.

Main PR47 merged as11b3062 with Quality/Secrets/CodeQL green. Controller preflight
and reviewed exact Vitest-only matcher pin are delivered. #48 tracks reviewed official
replacement and documents publisher/semantic/separate-bundled-copy limits. #2 is
Ready while #49 is selected: application decoding is still native and preflight
always reports decoderIsolationQualified:false. Decoder image/artifact research is
parked at `/workspace/work/decoder-runtime/{recon.md,research.md}`; no runtime code
started. Resume this work after the current user priority is resolved or reordered.

The isolated worktree reuses identical installed dependencies via hard links; do not
mutate them. A duplicate install hit disk limits; only a disposable advisory trial's
node_modules was removed, preserving manifests/review evidence. A whole directory
symlink failed Turbopack's workspace boundary; hard-link paths pass HTTP and build.
Python environment and synthetic-data links are local Git exclusions, never staged.

Next: commit/push with verified jaydenpiao attribution, require exact-head quality/
browser/container/Secrets/CodeQL and perform the authorized integration. All local
source/browser/visual review is complete; reuse this evidence for unchanged source. Keep #49's cloud-viewer
limitation explicit and leave the verified application running.

## Previous workbench delivery

Source implementation/review is complete at `026348897cdc265dba52241433f2873407666ab6`;
[PR #46](https://github.com/jaydenpiao/cliplane/pull/46) integrated it plus demo/docs
and the managed-CI-browser fix. Detailed UI research/spec/verification are linked
from DESIGN.md, docs/research/workbench-ui.md and docs/verification.md.

## Workbench implementation and verified evidence

- Live draft canvas for original/crop/blur/facecam, clip-relative captions and mute.
  Actual reviewed rendered output remains separately labelled and authoritative.
- Genuine bounded source-frame sampling, pointer/keyboard scrub and trim, numeric
  alternatives and authenticated `?clip=UUID` links with reload/history support.
- Compact inspector, preserved dialog focus/Escape and corrected mobile auth-entry
  scroll. Mobile composition names remain reachable by normal dialog scrolling.
- Exact edit/rights revision approval, independent rights, immutable masters and
  private media remain intact. Dirty drafts hide old output/download feedback.
- A real regression reproduced transient detail HTTP 500 closing the editor and
  losing drafts. The fix preserves the draft, shows an in-dialog retry warning,
  recovers on 200 and clears private detail on authoritative 401/403/404.
- `npm run check` passes: 105 TS/API/helper tests, 13 Python/media tests, lint/types,
  Ruff/mypy and production build. Dev was stopped during the build.
- Final `npm run test:e2e` passes all six workflows on settled source. Actual downloaded
  output was decoded/probed: 4s, 720×1280, muted, with expected caption timing/pixels.
- Independent task and whole-change source reviews approve; no material finding
  remains. Four viewport reviews and affected follow-up captures verify loaded media,
  eight real frames, no overflow, keyboard/focus and axe scans with zero violations.
  These observations do not establish full accessibility conformance.

Evidence: `/workspace/work/logs/workbench-final-check.log`, `workbench-final-e2e.log`,
`workbench-refresh-failure-{red,green}.log`; accepted screenshots under
`/workspace/work/workbench-v5/after-final`. Reviews are
`/workspace/work/workbench-{task1,final}-review.md`. Fresh unchanged-base checks passed
before implementation; do not repeat unchanged passing evidence without a reason.

## Demo and integration checkpoint

The canonical [45-second demo](../demos/README.md) is complete: 44.733s,
1600×900, H.264/30fps. It opens with the actual result, shows the real editing,
rights/revision review, render and download, and ends with the full eight-second
720×1280 downloaded export. Source/export/demo fully decode and use fast-start;
saved final Chromium playback advanced. The contact sheet and eleven actual final
frames were inspected. Demo is silent; export retains generated original audio.
Poster, sanitized evidence/hashes and the nine-file text replay bundle are consistent.
Raw take02, credentials and browser profiles remain private under
`/workspace/work/workbench-v5/demo`; do not record again without a new reason.

The prescribed projectless output directory is not writable here. Link canonical
public GitHub demo/screenshots. Source, tests, images, research/spec/plan and demo are
integrated by PR #46. Do not repeat #45; continue the bounded #2 increment above. Require verify/browser/container/Secrets/CodeQL and verified
jaydenpiao attribution before the authorized merge. A merge does not imply deployment.

CI browser checkpoint: the initial hosted run selected ambient Chromium 157
instead of the installed Playwright 159 runtime and failed real MP4 playback.
Exact downloaded 159 decodes those same authenticated proxy/export bytes. The
reviewed fix makes the system fallback local-only while preserving `CHROMIUM_PATH`.
The workflow still installs the lockfile-matched managed browser. Inspect current-head
CI for the fix; never merge a failed browser run or weaken its playback assertions.

## Runtime and continuation

Primary checkout `/workspace/work/cliplane` and linked UI worktree
`/workspace/work/cliplane-studio-polish` share Git history. The older environment's
uncommitted worktree/private gameplay/helpers are not recovered. Do not assume old
absolute paths or feature-tip ancestry establish completion; prior integrations were
squash merges. Preserve private recovery refs locally; never mirror/push them.

Task PostgreSQL 17 is healthy on local54329. Current API/web use ports4000/3000 via
`node scripts/dev.mjs` in the UI worktree, recorded supervisor PID668337 in
`/workspace/work/logs/cliplane-dev-supervisor.json`. Check process identity/health
before stopping or restarting. Stop the actual Node supervisor, not only its npm
parent, before a build sharing `.next`. Original synthetic sample data is seeded.

The hourly bounded continuation task is enabled in this thread; the old daily task
was paused. Scheduled prompts resumed this environment; duplicates continue the same
increment rather than create competing work. Scratch ledger:
`/workspace/work/iteration-ledger.md`. Checkpoint partial work if usage/access blocks.
Do not spin, repeat passed checks or buy upgrades.

## Next engineering work and boundaries

After the current user-prioritized UI/session increment, resume #2 decoder isolation: native process cancellation and
lease/COMMIT fencing are delivered, but per-job filesystem/network isolation,
behaviorally qualified aggregate quotas and bounded artifact export remain open.
Older rootless Docker ignored cgroup flags; qualify the current runtime rather than
assuming flags enforce limits. Then storage/job adapters precede managed deployment.
See [decoder lifecycle](../security/decoder-lifecycle.md), the selected issue and
[release workflow](../project/workflow.md). Runtime ASR/model calls and publishing are
not integrated; CPU int8 faster-whisper/VAD research is saved for #4.

Keyless read-only cloud discovery run43974596592 passed main `e603dc6` in staging;
its result was reverified. It established project/API discovery, not provisioned
Cliplane workloads or a full IAM audit. This environment has no direct gcloud/GCP
connector or observed credentials. Do not repeat resolved OAuth/bootstrap/discovery
without a new reason. Use the [cloud runbook](../runbooks/google-cloud.md) and reviewed
resource/IAM/cost/rollback plan; keep account/project/billing identifiers private.

Native Projects #30 and remote repository controls #22 remain owner-configuration
blockers under managed credential routing; no native board/ruleset is claimed.
Use documented owner helpers outside that route, not repeated OAuth or bypasses.
#27 environment separation, #29 broader QA, account lifecycle, restore/rollback and
operator/legal review remain open. Reviewed passing merges are authorized.

Prior private CoD recording permission did not establish underlying game rights;
those files are absent here. Do not stage approval/render/publication for unknown
rights. Public demos use original synthetic media. Keep uploader/account/social
information and private distribution drafts outside this public repository.

## Resume

```sh
git status --short
git log -3 --oneline
gh issue view 49 --repo jaydenpiao/cliplane
gh pr list --repo jaydenpiao/cliplane --state open
cat /workspace/work/iteration-ledger.md
curl -fsS http://localhost:4000/api/health
```
