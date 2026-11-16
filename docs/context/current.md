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
- Administration/settings and Actions-variable writes remain denied; no branch ruleset
  is claimed. Supported contents-write repository dispatch is available for the read-only
  Cloud discovery workflow. Environment main-only policy needs owner configuration.
- Owner executed the keyless Google bootstrap successfully and supplied configuration
  privately. Cloud discovery Actions runs establish independently verified access;
  inspect their live result. No application deployment or Cloud SQL instance is configured.
  Do not publish the owner IAM output, billing details or private account identifiers.
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

## Cloud and design follow-up

Cloud discovery validates fixed main/staging context, issues a short-lived token without
credential files, checks project identity/APIs and four explicit provisioning permissions.
The result does not establish a complete IAM audit. Owner helper:
`scripts/cloud/configure-github.mjs`; no cloud target IDs are committed.
Focused security review's scope-overclaim finding was regression-tested and fixed.
Zizmor 1.32.0 reports no workflow findings; action pins were resolved from official sources.

Project UI skill: `.agents/skills/cliplane-ui/SKILL.md`, grounded in reviewed official
Anthropic design and Vercel interface guidance. `docs/project/design-qa.md` now matches
DESIGN.md's light/violet direction. No new runtime UI dependencies were added.

Actual 30s Call of Duty: Black Ops II recording acquired locally under a creator CC BY4.0
grant. Provenance, original files, private browser capture and screenshots remain in
/workspace/work/gameplay-v3. Local playback/edit was verified; game rights remain unknown,
approval is disabled, and no gameplay render or public publication is claimed. Keep the
raw source metadata private because it includes uploader contact information.

## Upload regression and clip AI research

The actual 25 MB gameplay import exposed Next's external rewrite 10 MB body clone cap.
Manual web upload returned500 after 30 s; the browser workflow with a valid 11 MB MP4 free
box failed waiting for upload completion. A dedicated /api/sources GET/POST Route
Handler now streams directly to the API, preserving session/CSRF headers and API limits.
Four relay tests and both browser workflows pass; actual 25 MB web upload now returns 201
in 0.501 s. Do not fix this by buffering multi-gigabyte uploads in Next memory.

Cheap AI research: docs/research/clip-ai-options.md. CPU int8 faster-whisper+VAD is the
recommended first ASR path; tiny/base speech/silence/offset smoke tests ran locally.
Word-timing instability and narrow benchmark limits are recorded. No ASR runtime
integration or paid model call is claimed. Gemini credit eligibility is account/grant
specific; never assume welcome credits pay model charges.

Context7 is callable and was used for framework docs. Product Design skills are installed,
but its dedicated Browser interface is unavailable here; no plugin audit is claimed.
Codex Security remains uninstalled per user. The local UI skill and existing QA still work.

Latest local increment checks: 52 TS/API/helper/relay tests, 13 Python media tests,
lint/types/Python quality and production build pass. Two Chromium workflows pass,
including five axe scans and the upload above 10 MB. Current hosted checks must pass
on the delivered head before merge. Independent review found no material upload
relay auth/CSRF/tenancy/streaming issue; cloud scope wording was corrected.
