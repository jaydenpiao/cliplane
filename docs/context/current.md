# Current handoff

Updated 2026-11-17 (America/Los_Angeles). Verify live Git/GitHub before relying on this record.

## Goal and current increment

[PR #53](https://github.com/jaydenpiao/cliplane/pull/53) delivered the standalone
decoder image and bounded artifact protocol as `6575ad0`. All 11 checks passed
on reviewed head `95ee682`. Hosted synthetic probe, analyze and render smoke
succeeded. The app still decodes natively and `decoderIsolationQualified: false`
holds. [#2](https://github.com/jaydenpiao/cliplane/issues/2) is ready for later
behavioral enforcement and fail-closed upload and job integration.

The active [#27](https://github.com/jaydenpiao/cliplane/issues/27) increment
prepares a distinct keyless pilot identity in the owner's selected project and
reuses the existing GitHub staging environment. The owner-run bootstrap grants
only identity impersonation. The exact main pilot workflow verifies short-lived
credential exchange without resource writes. Verify live integration, then use
the [cloud runbook](../runbooks/google-cloud.md) for the owner bootstrap and
positive dispatch. Keep project and billing identifiers private. Pilot resources,
production-image validation and the remaining staging and release gates are open.

## Editor design delivery

[PR #52](https://github.com/jaydenpiao/cliplane/pull/52) merged as `79c98c7` after all
11 current checks passed on `1e8550fb476d224c1af727c07d19b503afff6c23`. #51 is Done.
Main Quality, Secrets and CodeQL passed. The editor shows the clip title and draft
status, groups playback and source time by the filmstrip, and stacks the inspector
through 768px. The full recording duration now labels the filmstrip separately from
the selected duration. The old axis bug was reproduced and covered by a regression.
Six browser workflows and real 1440, 768, 390 and 320px inspection passed. The README
has a current editor capture. See `/workspace/work/editor-workspace-design/checkpoint.md`.
Preserve the user's modern light design priority in future UI work.

## Studio entry, README and session preview

[PR #50](https://github.com/jaydenpiao/cliplane/pull/50) merged as `7f88794` after
11 passing checks on `fde55df311c32a643a22291da170ef2164c385eb`. Main Quality,
Secrets and CodeQL passed. It delivered the media-led entry, compact 16:9 cards,
updated README and screenshots. A drawer regression verifies focus, Escape, Help,
resize and reduced motion. Local full check and six browser workflows passed.
Actual 1440px, 768px and 390px captures were inspected. Mobile first card moved
from y416.8 to y345.8. Five focused axe scans reported zero violations. Reports:
`/workspace/work/studio-polish/` and `/workspace/work/logs/studio-polish-final-{check,e2e}.log`.

[#49](https://github.com/jaydenpiao/cliplane/issues/49) stays blocked on an accessible
Codex preview. Inside the session, web runs on port 3000 and API on loopback 4000.
The cloud environment reports no preview portals or preview-opening tools. The
shared viewer failed with `the gaas-browser node_repl sandbox cannot be disabled`.
If supported private preview access appears, verify the real URL in a top-level
browser and apply the exact API origin and Next development hostname settings in the
README. Keep the running app available and preserve its checkout/dependencies/data.

## Decoder checkpoint

[PR #47](https://github.com/jaydenpiao/cliplane/pull/47) merged as `11b3062` with
Quality, Secrets and CodeQL green. Controller preflight and the reviewed temporary
Vitest matcher pin are delivered. #48 tracks official replacement and documents
the pin's compatibility and bundled-copy limits. App decoding remains native, and
preflight reports `decoderIsolationQualified: false`. PR #53 delivered the dedicated image and bounded bundle. The local driver-none Docker remains
unsupported. Keep application integration and behavioral enforcement scoped to
separate increments. The archived research is in `/workspace/work/decoder-runtime/recon.md`.

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
integrated by PR #46. Do not repeat #45 or the merged #2 image and protocol increment. Require verify/browser/container/Secrets/CodeQL and verified
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

Task PostgreSQL 17 is healthy on local port 54329. The API and web use ports 4000
and 3000. The editor pass moved `node scripts/dev.mjs` to the primary checkout.
Find the current supervisor and checkout in
`/workspace/work/logs/cliplane-dev-supervisor.json`. Check process identity/health
before stopping or restarting. Stop the actual Node supervisor, not only its npm
parent, before a build sharing `.next`. Original synthetic sample data is seeded.

The hourly bounded continuation task is enabled in this thread; the old daily task
was paused. Scheduled prompts resumed this environment; duplicates continue the same
increment rather than create competing work. Scratch ledger:
`/workspace/work/iteration-ledger.md`. Checkpoint partial work if usage/access blocks.
Do not spin, repeat passed checks or buy upgrades.

## Next engineering work and boundaries

Continue #2 after the pilot access increment. Native process cancellation
and lease/COMMIT fencing are delivered. Per-job filesystem and network isolation,
aggregate quotas and verified handoff need behavioral qualification and integration.
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
gh issue view 2 --repo jaydenpiao/cliplane
gh pr list --repo jaydenpiao/cliplane --state open
cat /workspace/work/iteration-ledger.md
curl -fsS http://localhost:4000/api/health
```
