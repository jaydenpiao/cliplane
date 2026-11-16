# Current handoff

Updated: 2026-11-16 UTC. Verify git status, HEAD and current GitHub checks first.

## Goal

Next implementation increment: #2 decoder isolation, then staging storage/job adapters.
The owner authorizes reviewed passing merges to main and Google Cloud setup/deployment
within a reviewed resource plan. Keep work bounded and resumable. Personal account
information and distribution drafts stay outside public GitHub.

## Delivered increment

- Public Apache-2.0 repository: https://github.com/jaydenpiao/cliplane
- Delivery/review: https://github.com/jaydenpiao/cliplane/pull/31.
  Inspect its actual merge/check state before starting another branch from main.
- Modern **light** media-first library; self-hosted Geist, Lucide, responsive auth/upload/editor.
  Read DESIGN.md before UI changes. Decorative overview hero removed.
- Reserved-demo identity bypass reproduced and fixed with two API regressions.
- Shared modal focus, Tab wrapping, Escape/busy dismissal and focus return.
- Five axe scans in the browser suite: auth, studio, editor, upload and mobile.
- Real 39.2s demo in docs/demos: moving original media, exact edit approval, actual
  FFmpeg render and downloaded eight-second vertical export playback. Import/analysis
  occurs before the visible take. Captures/exports stay under /workspace/work/demo-v2.
- Original fixture now ships with the seed; fresh/repeat seed verified in a disposable
  schema (3 sources, 6 candidates, one explicit seed marker, no failed jobs).
- Portable owner-run native Project setup helper, keyless GCP bootstrap and runbooks.
  Markdown task inventory replaced with the access/setup notice, not a second board.

## Verification

2026-11-16: npm run check passed: 29 TS/API/process/Project-helper tests, 13 Python/media
checks, lint/types, Ruff/mypy and production web build. Two browser workflows passed,
including five axe scans and actual upload/edit/rights/render/download/deletion.
Dependency audit: zero vulnerabilities. Tracked-source Gitleaks: no leaks.
Full logs: /workspace/work/logs/final-check.log and light-e2e-final.log.
Use current GitHub checks for the delivered head; local evidence cannot prove hosted CI.

Independent focused security review covered tenancy, revisions, deletion/retry and
process paths; the new auth finding was fixed and reviewed. Final targeted review found
no concrete new blocker in auth/seed/dialog/cloud access. Visual review found a hidden
mobile-menu shadow; it was fixed and browser evidence refreshed. These checks do not
establish comprehensive security/accessibility certification or public-beta readiness.

## Access / deployment

- Repository writes work as jaydenpiao with verified no-reply commit attribution.
- Native Projects remains blocked: two owner OAuth approvals succeeded, but managed
  api.github.com routing substitutes the app credential (verified with unauthenticated
  and invalid-Authorization read-only requests). Do not repeat OAuth here or claim a board.
  Run scripts/github/setup-project.mjs outside that route; see docs/project/board.md.
- Administration/settings endpoints remain denied; no branch ruleset is claimed.
- Google project identifier was supplied privately. No authenticated gcloud identity,
  cloud workloads, database or deployment exists here. Never publish billing details.
- Reviewed keyless bootstrap: scripts/cloud/bootstrap-access.sh; owner steps:
  docs/runbooks/google-cloud.md. Default command previews only. Explicit --apply creates
  discovery access, no workloads or keys. Cloud SQL 17 is planned; local DB is PostgreSQL 17.
- Current local object storage/background worker require adapters before Cloud Run deploy.
- Decoder isolation (#2), account lifecycle and staging/public-beta gates remain open.

## Resume

```sh
git status --short
git log -3 --oneline
gh pr view 31 --repo jaydenpiao/cliplane
gh run list --repo jaydenpiao/cliplane --limit 5
tail -20 /workspace/work/logs/final-check.log
tail -20 /workspace/work/logs/light-e2e-final.log
```

Preserve private recovery refs under refs/cliplane-* locally; never push them.
The private history scrub script and manifest are outside the repository under
/workspace/work/private. Check whether the rewrite already ran before rerunning.
Next increment after visual/demo integration: #2 decoder isolation, then staging adapters.
If agents are unavailable due to usage limits, resume saved scripts/evidence; do not loop
on blocked dispatch. A daily bounded continuation task is configured outside GitHub;
its future execution environment has not yet been verified.
