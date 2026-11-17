# Verification

Updated: 2026-11-17 (America/Los_Angeles). Use live PR/Actions state for the delivered
revision. A merged source tree does not imply an application deployment.

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
