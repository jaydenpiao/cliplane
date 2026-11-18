# Studio polish and cloud-session preview

The latest user request prioritizes a more modern interface, an updated README,
and the working application in this Codex web cloud session. Decoder research is
parked at `/workspace/work/decoder-runtime/recon.md`; #2 remains unfinished.

## Direction and scope

Use the existing light React/CSS/Geist studio. Make the entry screen show a real
product preview, make the library feel like a focused video workspace, and keep
the upload/edit/review/render workflow intact. No new dependency or auth behavior.

Actual baseline screenshots were inspected at desktop1440 and mobile390 under
`/workspace/work/studio-polish/before`; report `audit.md`. The text-heavy sign-in
panel, competing sidebar permission card and tall card framing dilute the media.
The first mobile clip starts at y417. Existing verified Tella/Clueso/Jitter research
in `docs/research/workbench-ui.md` informs hierarchy; no additional footage was
observed for this pass.

## Approaches

1. Cosmetic token changes only: cheap, but leaves the entry screen without product
   evidence and the redundant sidebar card. Insufficient for this request.
2. Media-led entry, quieter shell and compact video cards: selected by the builder
   under the user's keep-going authorization. Visible improvement without rewriting
   the live editor or adding dependencies.
3. New component framework or editor rewrite: more risk and scope than needed.

Use neutral near-white surfaces, restrained violet actions, clearer type/spacing,
16:9 card frames and fewer stacked dividers. Simplify sidebar permission copy while
keeping its navigation and all review controls. Keep the mobile first card early.
Entry preview must use the already-public original-media product screenshot, label
it as sample/product imagery, and have a useful alternative description; no copied
startup assets or fabricated player controls. Keep mobile sign-in and sample entry
reachable. Preserve busy/error handling, input labels/autocomplete, keyboard focus,
reduced motion, deep links, private media, and exact edit/rights approval.

README should lead with what the product does, actual screenshot/demo and runnable
setup. Correct CI browser guidance, describe current decoder preflight accurately,
and distinguish a local/session server from hosted production or a shareable URL.

## Acceptance and limits

- Inspect auth/register, studio, editor, mobile menu and empty/search/error states;
  verify real loaded media, no overflow at390/768/1440, keyboard and axe checks.
- Existing six real browser workflows plus `npm run check` pass; no new tests that
  mirror CSS. Independent review before current-head checked integration.
- README commands match project configuration; images/links resolve and fresh
  screenshots replace stale library images after final verification.
- Keep server on0.0.0.0:3000 with healthy API4000 and original synthetic samples.
  Environment status currently has no preview portals; shared CUA fails with
  `the gaas-browser node_repl sandbox cannot be disabled`. Use Playwright to verify
  the app, state the viewer limitation honestly, and do not invent a preview URL.
- This is not a deployment or completed decoder sandbox. No GCP changes or external
  tunnels, payments, private-media publication or social actions.
