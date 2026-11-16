# Studio redesign implementation plan

Goal: make real media and review work the focus of a polished creator studio.

Sources inspected on 2026-11-16: [Linear](https://linear.app/),
[Frame.io](https://frame.io/), [Descript](https://www.descript.com/),
[Screen Studio](https://screen.studio/). Use their hierarchy and recording principles;
do not copy assets or branding.

Direction: light surfaces, restrained violet actions, readable type, larger
media previews, compact navigation and a focused player beside editing controls.
Remove the decorative dashboard hero. Preserve authorization, rights review and
revision-bound rendering. Use existing React, CSS and Lucide dependencies.

- [x] Remove personal posting drafts from public docs and the delivered branch history.
- [x] Replace the dashboard hero with a compact library heading and real media.
- [x] Apply consistent tokens and responsive layouts to auth, upload and editor.
- [x] Verify desktop/mobile workflows and inspect screenshots; address findings.
- [x] Record a continuous real workflow with moving original footage and export playback.
- [x] Run local quality/security checks and independent review; gate integration on hosted checks.

Files: `apps/web/app/page.tsx` owns workspace content; `globals.css` owns visual
tokens/layouts; auth/editor/upload components own their respective flows. Existing
browser tests verify upload, editing, independent rights review, render and download.
Adjust heading expectations deliberately. No new provider or AI capability is implied.

Review focus: narrow viewports, keyboard access, readable secondary text, authenticated
media, rights blockers and stale approval handling. Cloud deployment remains a separate
increment requiring a configured project and explicit resource limits.

Local quality, accessibility and focused independent review pass. Hosted checks and
merge must be verified on the delivered head. Native Projects/cloud access are separate
setup steps recorded in their runbooks.

Integration record: [PR #31](https://github.com/jaydenpiao/cliplane/pull/31).
