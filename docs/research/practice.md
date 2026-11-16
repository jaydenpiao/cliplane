# Research and integration decisions

Research the current issue before a major design, security or integration choice.
Use current primary documentation, record the date/links and the decision, then build.
Recheck stale vendor/policy claims; the attached report is context, not a live source.

For an integration, record: required capability, existing alternatives, documented API,
license, cost/usage, permissions, privacy/rights implications, failure modes, evaluation
and rollback. Add a dependency or plugin only when it solves a demonstrated gap.
Do not expand every session into an ecosystem survey or reload irrelevant skills.

## Sources checked — 2026-11-15

- [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md):
  keep root guidance concise, layer scoped instructions and link task-specific context.
- [Codex skills](https://developers.openai.com/codex/skills):
  progressive disclosure reduces context use; project conventions stay in AGENTS.md.
- [GitHub CodeQL starter](https://github.com/actions/starter-workflows/blob/main/code-scanning/codeql.yml):
  current CodeQL action is v4; private analysis also needs actions:read.
- [Gitleaks releases](https://github.com/gitleaks/gitleaks/releases):
  v8.30.1 release archive verified against its checksum; history scan found no leaks.

## Current choices

Keep TypeScript/PostgreSQL/Python/FFmpeg and the tested toolchain. Use existing browser
recording and FFmpeg for real demo capture/editing.
GitHub Projects creation is currently denied; use issues/status labels and a board export.
Public Apache-2.0 source is authorized; public-beta hosting stays behind release gates.

These are dated decisions. Revalidate relevant sources when implementation or access
changes and add a short ADR for a durable architecture change.

## Studio and demo direction — 2026-11-16

Live visual inspection: Linear uses quiet dark surfaces and strong hierarchy; Frame.io
makes footage and the review player dominant; Descript explains editing in plain verbs;
Screen Studio shows real cursor movement with restrained focal zooms. Apply these
principles with original styling and footage. Remove decorative dashboard illustration,
keep the media library in the first viewport, and show the actual exported file moving.
Use existing CSS/React/Lucide rather than adding a library solely for a new appearance.

Sources: https://linear.app/ · https://frame.io/ · https://www.descript.com/ ·
https://screen.studio/

The owner subsequently selected a light theme. Inspected Cal.com and its coss UI
source (Base UI + Tailwind), Vercel Geist colors/type and shadcn components. Applied
light surfaces, semantic color roles, consistent spacing and self-hosted Geist Sans.
Added pinned `geist` and development-only `@axe-core/playwright`; retained existing
React/CSS/Lucide. Axe scans cover auth, studio, editor, upload and mobile; automated
checks supplement keyboard and visual review and do not establish full accessibility
compliance. No paid design service or plugin was required.

Sources: https://github.com/cosscom/ui · https://vercel.com/geist/colors ·
https://vercel.com/font · https://ui.shadcn.com/docs/components ·
https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright
