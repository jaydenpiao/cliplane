# Verification

Updated: 2026-11-17 (America/Los_Angeles). Use live PR/Actions state for the delivered
revision. A merged source tree does not imply an application deployment.

## Editor context and playback (#51)

The clip title and save state stay visible above the media. Play and the source
clock sit above the filmstrip, whose endpoints describe the full recording. The
selected duration remains separate. The original layout retains the source aspect
ratio. The preview distinguishes the draft composition and actual MP4 output.

- The baseline browser regression reproduced selection timestamps on the source
  axis. The regression now checks the full 12-second source after trimming to 2–6
  seconds and checks the source clock after a real seek.
- `npm run check` passed 168 TypeScript tests, 13 media tests, lint, types, and build.
  All six Playwright workflows passed, including the source timeline regression
  and the decoded export check.
- Inspected a real 65-second sample at 1440, 768, 390 and 320px. Each viewport
  loaded eight source frames, advanced playback and restored focus after Escape.
  No horizontal overflow was measured. Two scoped axe scans found zero violations.
- Independent source review approved. The README's [editor image](images/editor-review.png)
  is the new desktop capture. Logs and private captures are under
  `/workspace/work/editor-workspace-design/`.

## Modern studio and session checkpoint (#49)

Media-led entry uses the authorized original-demo poster; navigation/cards are
quieter and compact16:9 media leads the library. README and three canonical real
screenshots are refreshed. The current app uses the same auth/API/editor/rights
workflow and no new dependency. Drawer keyboard and reduced-motion failures were
reproduced before the fix; focused regression passes, including Help and resize.

- Post-fix npm run check:168TS/API/helper +13media tests, lint/types, Ruff/mypy and
  production build pass. Final six real browser workflows pass
  (1.3m); scoped independent drawer keyboard/motion recheck also passes.
- Inspected actual1440/768 screenshots and390mobile states; first card y345.8 vs
  baseline416.8; no measured mobile overflow; six loaded640px thumbnails. Four
  focused mobile axe scans have zero violations; a fifth open-drawer scan and
  independent focus/return/Escape/Help/reduced-motion checks also pass. This is
  scoped browser evidence, not complete accessibility conformance.
- Independent source and fix reviews approve. README origin and TEST_DATABASE_URL
  findings are resolved; its uv activation and managed-CI-browser instructions match
  actual tooling. Private reports/logs are linked from current.md.
- Current local web3000/API4000 respond and Playwright runs real media. The cloud
  environment provides no preview portal and shared CUA fails a platform sandbox
  error. No external preview URL, accessible viewer or deployment is claimed.
- Exact-head quality/browser/container/Secrets/CodeQL still gate integration. #49
  remains open for the platform viewer limitation after the UI/README increment.

## Decoder controller preflight checkpoint (#2, partial)

Branch `feat/decoder-controller-preflight` starts from main `d4e871b`. A standalone
operator command checks eligible daemon/controller readbacks with bounded execution
and owned immutable-ID cleanup; it always reports `decoderIsolationQualified: false`.
Application media execution remains native; #2 stays open and is Ready while #49 is selected.

- 63 focused fake-engine and real fake-executable protocol/lifecycle cases pass;
  these are not real decoder/aggregate enforcement tests.
- One actual local command exits 2 with `daemon_unsupported` and `cleanup: not_needed`
  before image inspect/create/start. Fresh independent readback evidence confirmed
  the local rootless driver-none runtime ignores per-job quotas; no stress ran.
- Safe real missing-ID inspection verified the Docker not-found protocol without
  creating a container. Raw diagnostics stay outside the report/repository.
- Independent source review passes. Full check passes: 168 TS/API/helper tests,
  13 Python/media tests, lint/types, Ruff/mypy and production build. The hosted
  positive readback/cleanup gate remains a required current-head CI check; hosted
  success is still only controller preflight.
- Hosted controller check passed on Docker29.4.2/systemd/cgroup v2: memory67108864,
  CPU50000/100000, PIDs16, swap0 and owned cleanup removed; the report still says
  `decoderIsolationQualified: false`. Current-head checks remain required after updates.
- The high-severity dependency audit passes with the reviewed exact Vitest-only
  matcher pin; [scope and follow-up](research/test-toolchain-security.md).
- UI, app/media, rights/revision/lease behavior and inspected demo are unchanged;
  reuse their passing evidence and retain all hosted browser/security gates.

## Focused workbench checkpoint (#45)

Source commit `026348897cdc265dba52241433f2873407666ab6` on
`feat/focused-workbench`, based on main `36d70b5e`. The new editor provides
live draft composition, actual decoded filmstrip frames, pointer/keyboard trimming,
authenticated reloadable clip links and a compact inspector. Actual reviewed output
remains separate; draft changes hide stale output/download feedback.

- Helper tests: 11 pass, including interval/cue rules, decoded crop geometry,
  caption wrapping and bounded raster size. Meaningful RED logs preceded the code.
- Browser acceptance: all six workflows pass on the settled source: four workbench
  and two unchanged studio workflows. Downloaded output is decoded and probed: 4s, 720×1280, no audio,
  with caption absent/present/absent at the expected relative times.
- Fault regression: an intercepted detail HTTP 500 reproduced editor unmount and
  draft loss before the fix. The corrected test passes: exact draft retained,
  in-dialog warning, recovery on 200 and private detail cleared on authoritative 404.
- Source review approves the spec and code quality after that fix. A transport
  concern was a reviewer reading error; passing coverage was added without claiming
  a fabricated defect or fix.
- Four viewport reviews at 320, 390, 768 and 1440px verify loaded moving media,
  eight actual frames, no overflow, visible focus, modal wrap, Escape and focus return.
  Four editor axe scans have zero violations in their configured rules; three affected
  scans passed after final polish. Final captures verify the smaller inspector and
  auth-entry scroll reset. Mobile composition names require normal dialog scrolling.
- Full changed-source quality gate passes: 105 TS/API/helper tests, 13 Python/media
  tests, lint/types, Ruff/mypy and production build. Dev was stopped during the build.
- Final genuine demo is complete and inspected; see canonical demo evidence below.
  Hosted current-head checks/merge are live GitHub state. No deployment claim.

Hosted browser diagnosis: the workflow installed Playwright headless shell 159,
but the old system fallback selected ambient Chromium 157. Trace media responses
were complete authenticated 206 MP4s; the selected browser could not decode them.
The exact installed 159 binary decoded and played the same proxy/export bytes.
CI now uses its managed browser; explicit local overrides remain supported.
This is a browser-selection correction, with playback assertions preserved.

Fresh baseline on unchanged `36d70b5e` passed 94 TS/API/helper and 13 Python/media
tests plus lint/types, Ruff/mypy and production build. Do not confuse that baseline
with final changed-source evidence. Logs and inspected captures for this session are
under `/workspace/work/logs/workbench-*` and `/workspace/work/workbench-v5/`.

## Previous compact studio checkpoint (PR #44)

The compact studio pass is on feat/studio-polish, issue #43. Check its PR state before
repeating implementation. The original light/violet tokens, Geist and Lucide are retained.

| Check               | Observed result                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| npm run check       | 94 TS/API/helper tests and 13 Python/media tests pass; lint, types, Ruff/mypy and production build pass |
| npm run test:e2e    | Two Chromium workflows pass: responsive sample and real upload/edit/rights/render/download/deletion     |
| Accessibility scans | Five axe scans have no violations in the scanned WCAG2/2.1 AA rules                                     |
| Responsive review   | No horizontal overflow at 320, 390, 768 and 1440 px; long-text DOM fixtures retain ellipsis             |
| Mobile hierarchy    | First thumbnail at y418px at 390px width; its action footer fits the initial 844px viewport             |
| Fonts/media         | Geist loaded; all six thumbnails loaded; original preview playback advanced                             |
| Keyboard/dialog     | Visible focus, forward/reverse containment, Escape return and rights-note/footer reachability verified  |

Demo review reproduced a stale rendering notice after the Download action appeared.
The browser regression first failed with the old text, then passed after feedback was
derived from current export status. A second failing case covered unsaved draft edits:
feedback now stays hidden while the draft differs from the approved revision and
returns when the saved values are restored. The actual download still passes.

Screenshots in docs/images come from the running production web build with a separate,
original synthetic-media dataset. Stress text was applied only in a review browser DOM;
it was not persisted or used in the demo. Local browser scripts, measurements and logs
remain outside Git under /workspace/work/design-v3 and /workspace/work/logs/studio-polish-*.

Manual review and automated scans cover the observed states; they do not establish full
accessibility conformance. Another browser engine and interrupted/error-flow acceptance
remain #29.
Final hosted verify/browser/container, Secrets and CodeQL checks are required before merge.

## Security and runtime evidence

- PR #31 fixed unseen/stale approval and a reproduced reserved-demo identity bypass.
  Demo access requires an exact user/workspace seed marker; keyboard modal behavior was
  reproduced and fixed. API tests exercise tenancy, review revisions, deletion and retry.
- PR #40 reproduced Next's body-cloning failure with a 25 MB source and an 11 MB browser
  fixture. The streaming relay passed both; the actual 25 MB retry returned201 in0.501s.
- PR #41 corrected the immutable OIDC subject. Owner apply and Cloud discovery run43974596592
  verified keyless identity, ACTIVE project and five required APIs. Four explicit
  provisioning/IAM permissions were absent; this is not a complete IAM audit. No workloads
  were created.
- PR #42 added native process cancellation, serialized lease checks, expiry fencing after
  row locks, COMMIT-dispatch cancellation and shutdown drain. Independent review reproduced
  two transaction races; real PostgreSQL regressions failed before fixes and pass afterward.
  Deferred COMMIT failures remove unpublished files; a dispatched commit keeps its outcome.
  See [decoder lifecycle](security/decoder-lifecycle.md).

Main af65a08 passed Quality, Secrets and CodeQL. Later revisions must be checked independently.
Decoder filesystem/network/resource isolation remains #2: the current rootless Docker daemon
accepts but ignores per-job cgroup flags. Container build success does not prove that contract.

## Demo and packaging

The [product demo](demos/README.md) shows real source playback, editing, independent rights
review, approval, rendering and download. It opens with a real result excerpt and ends with the full actual downloaded export.
Current media properties, full-decode results and hashes are in [evidence](demos/evidence.json);
avoid duplicating changing hashes or durations here. Original procedural footage/audio is
used; personal account information and distribution drafts remain outside this repository.

Portable source and demo bundles omit credentials, private/raw media, dependencies, caches
and virtual environments. The current workbench demo bundle contains only its nine allowlisted text files.

## Remaining release work

Native Projects/settings still require owner setup outside the managed API route; no
Project or branch ruleset is claimed. Issues/milestones and CI exist. See [Project setup](project/board.md).

Public-beta gates remain in [the release workflow](project/workflow.md): enforced decoder isolation, account
lifecycle, storage/job adapters, recovery/rollback and operator/legal review. Historical
rights-assessment provenance and configuration-derived upload/retention text remain follow-ups.
