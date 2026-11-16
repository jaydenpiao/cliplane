# Verified checkpoint — 2026-11-15

Cliplane implements the supplied report's first-iteration local vertical slice. No
production deployment, real posting, paid inference or third-party purchase occurred.

## Executed checks

| Command / check              | Observed result                                                              |
| ---------------------------- | ---------------------------------------------------------------------------- |
| npm run check                | Passed: formatter/lint, TS typecheck, tests, Python quality and Next build   |
| npm test                     | 22 tests passed across domain, PostgreSQL API and process-lifecycle suites   |
| npm run test:media           | 13 Python tests passed, including real FFmpeg renders and evaluation         |
| npm run test:e2e             | 2 Chromium tests passed: desktop/mobile demo and full new-creator workflow   |
| npm run check:python         | Ruff lint/format passed; mypy passed both worker/evaluator source files      |
| npm run build                | Production Next.js build passed                                              |
| npm run db:migrate           | Passed; repeated application is idempotent                                   |
| npm audit --audit-level=high | Zero vulnerabilities across installed dependencies                           |
| npm sbom --sbom-format=spdx  | SPDX dependency manifest generated locally                                   |
| Container build              | Passed with node:24-alpine, Python, FFmpeg and production web build          |
| npm run evaluate             | Synthetic evaluator completed; these results are not a creator benchmark     |
| Independent reviews          | Requirements, API/security, media correctness and final whole-project review |

Container build needed the managed environment's CA bundle as a BuildKit secret in a
temporary Dockerfile. TLS verification remained enabled and the CA was not persisted
in source or image layers. The initial Debian build exhausted the environment's disk
allocation; the Alpine image passed. Task-created build cache is cleaned afterward.

## Material review findings fixed and regression-tested

- Stale edit/rights forms and unseen-revision approval: preconditions checked under locks.
- Cancelled-render recovery and repeat approval: retry-safe jobs and preserved render access.
- Cleanup failures: deleting/expired storage cleanup remains retryable.
- Retry/deletion race: source/job transitions share one transaction.
- Expired leases: exhausted jobs mark sources failed and allow manual recovery.
- Decoder failures: partial outputs cleaned; final media probed before atomic replacement.
- Delayed audio: RMS bins preserve source timeline; silent fallbacks span the recording.
- Very short trims: minimum 100 ms validated before writing output.
- Worker timeout: whole process group terminated; diagnostics/probe fields bounded.

## Delivery boundaries

Repository access was later enabled. Public source, four milestones, the issue board and
PR #31 are created under jaydenpiao/cliplane. Commits, issues and PR attribution resolve
to jaydenpiao. Native Projects creation and administration/settings access remain denied;
no Project or branch ruleset is claimed. See docs/project/board.md for live task links.

Use current PR/Actions checks for the latest revision. Gitleaks, CodeQL and the
verify/browser/container jobs are configured; inspect their actual result before merge.

Screenshots in docs/images were captured from the running studio. Source packaging
omits credentials, private/raw data, node_modules, build caches and virtualenvs.

## Non-blocking review follow-ups

- Immutable historical rights assessments before live publication provenance.
- Derive displayed upload/retention limits from configuration instead of default text.
- Complete the public-beta controls and later milestones in docs/backlog.md.

## Studio redesign — 2026-11-16

Replaced the decorative overview with a light media-first library, consistent editor
and upload surfaces, larger controls and restrained violet actions. Desktop/mobile
browser verification includes actual upload, trim/caption, rights review, render,
download and source deletion. Hover previews use authenticated source media.

A fresh focused security review reproduced a reserved-demo email registration bypass.
Regression tests first observed registration 201 instead of 400 and unmarked demo
access 200 instead of 503. Registration now reserves the identity; demo login requires
a seed marker bound to the exact user/workspace. Legacy seed upgrades require stored
synthetic attestation provenance. Both regression cases pass.

Keyboard QA observed that opening the editor left focus behind the modal. A shared
dialog lifecycle now manages focus, Tab wrapping, Escape dismissal and focus return;
upload and help use the same behavior. Busy operations block dismissal.

Latest checks and remaining work are recorded in docs/context/current.md.

Final light-studio checks: 29 TypeScript/API/process/Project-helper tests, 13 Python
media tests, lint/types, Ruff/mypy and production build passed. Two browser workflows
include five axe scans with zero WCAG 2/2.1 AA rule violations in the scanned states;
keyboard and visual checks supplement the automated scan. Fresh/repeat sample seeding
passed in an isolated disposable schema. npm audit reports zero vulnerabilities;
tracked-source Gitleaks reports no leaks. Hosted CI is authoritative for the final head.

The refreshed 39.2-second demo ends on an eight-second actual 720 × 1280 export;
both fully decode, use H.264/yuv420p/30fps and have fast-start metadata. See evidence.json.
