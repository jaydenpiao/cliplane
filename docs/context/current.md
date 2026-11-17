# Current handoff

Updated 2026-11-17 (America/Los_Angeles). Verify live Git/GitHub before relying on this record.

## Goal and current increment

Treat user messages as cumulative tasks unless cancelled. Keep modern, simple light
UI and genuine startup-informed demos in the backlog. PR #46 is merged as main
`d4e871bf80fd2a84c202c9d2d41019cdb357ad86`; Quality, Secrets and CodeQL on that main
commit passed. #45 is closed Done. Do not repeat the delivered workbench/demo.

Current bounded issue #2 increment: a standalone decoder controller preflight.
Branch `feat/decoder-controller-preflight`, base `d4e871b`. It does not change app
media execution or close full decoder isolation. Spec/plan:
`docs/superpowers/{specs,plans}/2026-11-17-decoder-preflight*.md`.

Fresh safe runtime observation confirmed Docker29.9.2 rootless, cgroup v2, driver
none. Requested64 MiB/0.5 CPU/16 PIDs read back8 GiB/2 CPUs/unlimited PIDs; flags
silently succeeded. No stress ran; exact probe cleanup was verified. Sanitized
private evidence: `/workspace/work/decoder-qualification/runtime-{report.md,evidence.json}`.

Implementation now exists in scripts/decoder and package command decoder:preflight.
62 focused protocol/lifecycle/subprocess cases, scoped lint/types and the actual
current-runtime nonzero rejection pass. The actual command rejects the daemon
before image inspection/container creation, with decoderIsolationQualified:false.
Independent source review and full check pass (167 TS/API/helper tests, 13 Python/media tests, lint/types, Ruff/mypy and production build); never infer full sandbox qualification.

Hosted container CI wiring adds a real positive controller preflight against its
trusted built app image's immutable ID; only the fixed shell probe executes. It is
readback/cleanup evidence, not a dedicated decoder/hostile-media or aggregate-abuse
qualification. This new hosted gate must pass before merge.

Implementation owner: implement_decoder_preflight. CI wiring: wire_decoder_preflight_ci.
Research/runtime docs: qualify_decoder_runtime. Root owns context/development/
verification/spec/plan and integration; keep edits disjoint. Private reports/ledger:
`/workspace/work/decoder-preflight/` and `/workspace/work/iteration-ledger.md`.

Next: independent security/source review, fix concrete findings, run npm run check
with the dev supervisor stopped before build, and open a partial #2 PR. Require all
current-head checks and verified jaydenpiao attribution before authorized merge.
Keep #2 In progress; next phases are a dedicated immutable runtime, bounded live
artifact export, real enforcement tests and fail-closed upload/job integration.
Reuse unchanged UI/demo evidence; no new recording is needed for this operator tool.

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

Only this fresh clone exists at `/workspace/work/cliplane`; the older environment's
uncommitted worktree/private gameplay/helpers are not recovered. Do not assume old
absolute paths or feature-tip ancestry establish completion; prior integrations were
squash merges. Preserve private recovery refs locally; never mirror/push them.

Task PostgreSQL 17 is healthy on local54329. Current API/web use ports4000/3000 via
`node scripts/dev.mjs`, recorded supervisor PID326932 in
`/workspace/work/logs/cliplane-dev-supervisor.json`. Check process identity/health
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
gh pr view 46 --repo jaydenpiao/cliplane --json state,mergedAt,headRefOid
gh pr checks 46 --repo jaydenpiao/cliplane
cat /workspace/work/iteration-ledger.md
curl -fsS http://localhost:4000/api/health
```
