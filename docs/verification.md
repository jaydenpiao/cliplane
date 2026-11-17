# Verification

Updated: 2026-11-16 (America/Los_Angeles). Use live PR/Actions state for the delivered
revision. A merged source tree does not imply an application deployment.

## Current local UI checkpoint

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
review, approval, rendering and download. Its final shot is the actual downloaded export.
Current media properties, full-decode results and hashes are in [evidence](demos/evidence.json);
avoid duplicating changing hashes or durations here. Original procedural footage/audio is
used; personal account information and distribution drafts remain outside this repository.

Portable source and demo bundles omit credentials, private/raw media, dependencies, caches
and virtual environments. The demo bundle contains only its nine allowlisted text files.

## Remaining release work

Native Projects/settings still require owner setup outside the managed API route; no
Project or branch ruleset is claimed. Issues/milestones and CI exist. See [Project setup](project/board.md).

Public-beta gates remain in [the release workflow](project/workflow.md): enforced decoder isolation, account
lifecycle, storage/job adapters, recovery/rollback and operator/legal review. Historical
rights-assessment provenance and configuration-derived upload/retention text remain follow-ups.
