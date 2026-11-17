# Current handoff

Updated 2026-11-17 (America/Los_Angeles). Verify live Git/GitHub before relying on this record.

## Goal and current increment

The owner prioritizes modern, simple light UI and professional demos informed by
actual startup websites/product footage, especially relevant YC companies. Treat
messages as cumulative tasks unless explicitly cancelled. Continue autonomously,
delegate independent work and keep one implementation issue active.

Issue #45: focused editing workbench. Branch `feat/focused-workbench` is based on
main `36d70b5e107c5acba0cc9f50e0dda4d5ccd84367`. The prior #43/PR #44 compact pass is
merged; it was not final design acceptance. Source implementation, local acceptance, independent review and the final demo are
complete. Reviewed source commit: `026348897cdc265dba52241433f2873407666ab6`.
Use live PR metadata for subsequent docs-only commits and integration state.

Read [the spec](../superpowers/specs/2026-11-17-focused-workbench-design.md),
[plan](../superpowers/plans/2026-11-17-focused-workbench.md), DESIGN.md and the local
cliplane-ui skill for UI changes. [Reference research](../research/workbench-ui.md)
distinguishes verified YC identity, observed pages, sampled Tella footage and capture
limits. No third-party assets or unsupported AI claims are used.

## Implemented and verified in this session

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
ready for integration. Inspect the live PR for `feat/focused-workbench`: if absent,
open it linked to #45; if pending, inspect current-head checks; if merged, do not
repeat #45 and resume #2. Require verify/browser/container/Secrets/CodeQL and verified
jaydenpiao attribution before the authorized merge. A merge does not imply deployment.

## Runtime and continuation

Only this fresh clone exists at `/workspace/work/cliplane`; the older environment's
uncommitted worktree/private gameplay/helpers are not recovered. Do not assume old
absolute paths or feature-tip ancestry establish completion; prior integrations were
squash merges. Preserve private recovery refs locally; never mirror/push them.

Task PostgreSQL 17 is healthy on local54329. Current API/web use ports4000/3000 via
`node scripts/dev.mjs`, recorded supervisor PID87186 in
`/workspace/work/logs/workbench-dev-supervisor.json`. Check process identity/health
before stopping or restarting. Stop the actual Node supervisor, not only its npm
parent, before a build sharing `.next`. Original synthetic sample data is seeded.

The hourly bounded continuation task is enabled in this thread; the old daily task
was paused. Scheduled prompts resumed this environment; duplicates continue the same
increment rather than create competing work. Scratch ledger:
`/workspace/work/iteration-ledger.md`. Checkpoint partial work if usage/access blocks.
Do not spin, repeat passed checks or buy upgrades.

## Next engineering work and boundaries

After #45 integration, resume #2 decoder isolation: native process cancellation and
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
gh pr list --repo jaydenpiao/cliplane --state all --head feat/focused-workbench
cat /workspace/work/iteration-ledger.md
curl -fsS http://localhost:4000/api/health
```
