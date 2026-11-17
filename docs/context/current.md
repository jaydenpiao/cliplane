# Current handoff

Updated: 2026-11-16 (America/Los_Angeles). Verify git status, HEAD and GitHub checks first.
Read only the selected issue and relevant area docs; do not reload the whole report.

## Goal and next increment

Current delivery: #43 compact studio UI and export feedback, branch feat/studio-polish.
The user prioritized a modern, simple, aesthetic interface. Inspect the branch's PR
before repeating work. After integration, resume #2's actual decoder sandbox, qualified
resource enforcement and bounded artifact export. The local rootless Docker daemon
does not enforce per-job cgroups; configured flags are not proof of enforcement.
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
- PR #41 merged as e603dc6: verified immutable GitHub OIDC subject correction.
- PR #42 merged as af65a08: process cancellation, lease/COMMIT fencing and shutdown drain.
- The relay fixes Next's external rewrite body cap: an actual 25 MB web upload changed
  from 500 after 30s to 201 in 0.501s. Four relay regressions and the full browser upload
  above 10 MB pass. Preserve streaming; do not buffer multi-gigabyte files in Next.

## Verified cloud discovery

The owner pulled e603dc6 and successfully reran bootstrap --apply. Cloud discovery
run43974596592 passed on main e603dc6 in staging: short-lived federation, ACTIVE
project identity and five required APIs verified. The four explicit provisioning/IAM
permission checks returned absent; this is not a full IAM audit. No workloads were
created and no Cliplane database/deployment is configured. The discovery account
cannot administer IAM or provision the checked resource types.

The earlier legacy-subject failure and provider-update request are resolved. Do not
repeat owner OAuth/bootstrap or create workloads under discovery access. Private
configuration remains outside Git; never publish owner IAM, billing or target details.
See docs/runbooks/google-cloud.md for the supported dispatch/setup procedure.

## Verification

UI pass: npm run check passes 94 TS/API/helper and 13 Python/media tests, lint/types,
Ruff/mypy and production build. Two Chromium workflows pass, with five axe scans and
actual upload/edit/rights/render/download/deletion. Demo review found a stale rendering
notice after completion; a browser regression failed first, then passed after feedback
was derived from current status. Unsaved draft feedback also failed first, then passed
by hiding notices when edits or rights differ from the saved revision. The affected
workflow was replayed.

Independent source/visual review found no material blockers: no overflow at 320, 390,
768 and 1440px, Geist/media loaded, actual source playback advanced, focus/Tab/Escape
behavior and rights-note/footer reachability passed. First mobile thumbnail is y418px
at390px, about147px higher than the earlier screenshot. Long-text stress stayed in browser DOM.
Canonical screenshots use an isolated original-media sample dataset. See docs/verification.md.

Current logs: /workspace/work/logs/studio-polish-check.log, studio-polish-e2e.log,
studio-notice-red.log, studio-notice-draft-red.log and studio-notice-green.log.
Review captures/measurements: /workspace/work/design-v3/after. Demo's final corrected
take: /workspace/work/design-v3/demo-final; canonical hashes/properties are in
docs/demos/evidence.json. Never mix mutable inputs from concurrent captures.
Final hosted verify/browser/container, Secrets and CodeQL must pass before merge.
Use live checks/merge state as authority; full sandbox/public-beta gates remain open.

PR #42's 42 focused process/watcher/job tests are included in the 94 above; they cover
real PostgreSQL lock/expiry/COMMIT races and actual FFmpeg descendant termination.
Its two reproduced review findings were fixed. See docs/security/decoder-lifecycle.md.

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
- #39 upload regression is Done. #27 discovery is verified; environment separation
  remains open. #30 Project and #22 repository controls remain blocked on owner
  configuration. #29 QA is partial.
- #43 is the selected UI increment; #2's remaining sandbox work is Ready afterward.
  Account lifecycle, recovery and release gates remain open. Cloud SQL17 is planned;
  the local database is PostgreSQL17. See docs/security/decoder-lifecycle.md.

## Design, media and AI

Read DESIGN.md and .agents/skills/cliplane-ui/SKILL.md before UI work. Current direction
is modern light/violet, with self-hosted Geist and Lucide. Official Anthropic/Vercel
guidance and evaluated libraries are recorded in docs/research/frontend-design-tools.md.
Studio headings are compact; cards have one provenance line; the editor heading leaves
room for review fields. No new UI dependency was added. README now clones current main.
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
gh pr list --repo jaydenpiao/cliplane --state all --head feat/studio-polish
gh run list --repo jaydenpiao/cliplane --limit 5
tail -20 /workspace/work/logs/studio-polish-check.log
```

Preserve private recovery refs under refs/cliplane-* locally; never push/mirror them.
Implementation worktree: /workspace/work/cliplane-decoder; the original checkout
/workspace/work/cliplane remains on main. Check both and git worktree list before cleanup
or resuming; do not assume an old feature branch is unmerged. The PostgreSQL Docker
container persists. Environment reconnects can stop API/web processes; check health
and restart them when needed. Do not build Next while its server uses the same .next.
Isolated UI preview: localhost3001/API4001; private operator helper
work/studio-polish-run.mjs and /workspace/work/design-v3/preview-env.json. The helper's
check mode uses the default relay port; build restores the preview configuration.
Evidence and private owner configuration live outside Git under /workspace/work.
A daily bounded continuation task is configured; its future execution environment is
not verified. If usage/agents are unavailable, resume saved evidence rather than looping
on blocked work. Update this handoff and issue states after each completed increment.
