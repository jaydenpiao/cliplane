# Current handoff

Updated: 2026-11-16 UTC. Verify git status, HEAD and current GitHub checks first.
Read only the selected issue and relevant area docs; do not reload the whole report.

## Goal and next increment

Finish the immutable OIDC subject correction, then implement #2 decoder isolation.
Storage/job adapters follow before a Cloud Run deployment. The owner authorizes
reviewed passing merges to main and cloud setup within a reviewed resource plan.
Work one bounded implementation issue at a time. A merge is not a deployment.
Keep personal account information and distribution drafts outside public GitHub.

## Delivered

- Public Apache-2.0 repository: https://github.com/jaydenpiao/cliplane
- PR #31 merged: light, responsive upload/library/editor; PostgreSQL durable jobs;
  actual media analysis; trim/layout/captions/mute; independent rights review;
  revision-bound human approval; FFmpeg preview/download/deletion.
- Reserved-demo auth bypass fixed; modal focus, keyboard and busy-state behavior tested.
- Public 39.2s working demo: docs/demos/cliplane-demo.mp4. It uses original synthetic
  motion footage and shows a real eight-second vertical export. No AI analysis claim.
- PR #40 merged as 4ba8b9e: streaming upload relay, read-only cloud discovery workflow,
  owner configuration helpers, local UI skill and current AI/design research.
- The relay fixes Next's external rewrite body cap: an actual 25 MB web upload changed
  from 500 after 30s to 201 in 0.501s. Four relay regressions and the full browser upload
  above 10 MB pass. Preserve streaming; do not buffer multi-gigabyte files in Next.

## Current cloud correction

Cloud discovery run43968258169 failed with unauthorized_client / attribute condition
rejection. The repository OIDC API reports immutable subjects enabled and prefix
`repo:jaydenpiao@71306047/cliplane@1459551943`. The bootstrap used the legacy name-only
subject. Its corrected condition pins that verified prefix plus staging and retains
repository ID, owner ID and refs/heads/main constraints. IAM roles are unchanged.

The owner has been sent the exact Cloud Shell provider-update command privately;
execution is pending. Do not retry authentication until they confirm it was applied.
The earlier provider-describe request is superseded by this diagnosis. The discovery
account cannot administer IAM. No application deployment or Cloud SQL exists yet.

After owner confirmation, dispatch Cloud discovery through the supported repository
dispatch endpoint using the private configuration file already outside Git. Inspect
the actual run result before claiming verified Google access. Never print JWTs, owner
IAM dumps, billing details or private project configuration in public issues/logs.
See docs/runbooks/google-cloud.md for the owner preview/apply procedure.

## Verification

OIDC correction: npm run check passes with 54 TS/API/helper tests, 13 Python/media
tests, lint/types, Ruff/mypy and production web build. Regression preview failed before
the subject fix and passes afterward. Independent cloud review found no material issue;
repository/owner/main/staging trust boundaries and discovery roles remain unchanged.
Log: /workspace/work/logs/oidc-check.log. Check hosted CI on the delivered head.

PR #40: verify/browser/container, Secrets and CodeQL passed on its head and main.
Two local Chromium workflows pass, including five axe scans, keyboard/responsive checks
and actual upload/edit/rights/render/download/deletion. Product code is unchanged by
the OIDC correction. Prior dependency audit found zero vulnerabilities; tracked-source
Gitleaks found no leaks. These checks do not establish public-beta readiness or a full
security/accessibility certification. Run applicable checks again when their code changes.

## Access and task management

- Repo writes work; commit identity is jaydenpiao's verified no-reply address.
- Managed api.github.com routing substitutes the app credential. Two owner OAuth
  approvals did not grant Projects/settings/Actions-variable writes through that route.
  Do not repeat OAuth or attempt to bypass it.
- No native Project or branch ruleset is claimed. Owner-run helpers outside that route:
  scripts/github/setup-project.mjs and scripts/cloud/configure-github.mjs. Both default
  to preview. See docs/project/board.md and docs/runbooks/google-cloud.md.
- Contents-write repository dispatch works. Staging environment was auto-created;
  its main-only GitHub policy is not configured. WIF independently pins main/staging.
- #39 upload regression is Done. #27 cloud setup awaits verified access. #30 Project
  and #22 repository controls remain blocked on owner configuration. #29 QA is partial.
- #2 decoder isolation is next. Account lifecycle, recovery and release gates remain
  open. Cloud SQL 17 is planned; the local database is PostgreSQL 17.

## Design, media and AI

Read DESIGN.md and .agents/skills/cliplane-ui/SKILL.md before UI work. Current direction
is modern light/violet, with self-hosted Geist and Lucide. Official Anthropic/Vercel
guidance and evaluated libraries are recorded in docs/research/frontend-design-tools.md.
Context7 is callable. Product Design skills are installed, but their dedicated Browser
interface is unavailable here; no plugin audit is claimed. Codex Security is uninstalled.
Existing local browser/axe/security checks continue independently.

Actual Call of Duty: Black Ops II footage was acquired under the recording creator's
CC BY4.0 grant. Private evidence is in /workspace/work/gameplay-v3. Playback/editing
worked; underlying game rights remain unknown, approval is disabled, and no public
gameplay render/publication is claimed. Raw metadata includes uploader contact details;
keep it private. Public demo footage is original synthetic material.

Low-cost ASR research: docs/research/clip-ai-options.md and issue #4. Recommend CPU
int8 faster-whisper plus VAD first. Local tiny/base speech/silence/offset smoke tests ran;
word timing instability and narrow benchmark limits are documented. Runtime ASR is
not integrated. No paid model calls occurred. Gemini credit eligibility depends on
the actual grant/account; do not assume welcome credits cover model charges.

## Resume

```sh
git status --short
git log -3 --oneline
gh pr list --repo jaydenpiao/cliplane --head fix/oidc-subject
gh run list --repo jaydenpiao/cliplane --limit 5
tail -20 /workspace/work/logs/oidc-check.log
```

Preserve private recovery refs under refs/cliplane-* locally; never push/mirror them.
The PostgreSQL Docker container persists. Next was stopped for the production build;
restart npm run start:web when needed and check API/DB health before browser work.
Evidence and private owner configuration live outside Git under /workspace/work.
A daily bounded continuation task is configured; its future execution environment is
not verified. If usage/agents are unavailable, resume saved evidence rather than looping
on blocked work. Update this handoff and issue states after each completed increment.
