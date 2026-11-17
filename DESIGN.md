# Cliplane visual direction

The product uses a **light theme**. Keep the studio media-first: real recordings,
clear review controls and useful workspace content in the first viewport.

- White panels on a cool near-white canvas. Quiet gray borders and soft shadows.
- Restrained violet for primary actions, selection and brand; green/amber/red convey state.
- Self-hosted Geist Sans through `geist/font/sans`. Readable labels and metadata;
  clear heading hierarchy, consistent spacing and limited decorative copy.
- Media cards lead into a focused player with contextual editing and rights controls.
  Source framing is preserved; only a rendered export shows final composition.
- Use compact task headings and one quiet provenance line per card. Keep the first
  clip visible early on mobile; editor headings leave room for the actual controls.
- Desktop has a compact sidebar and three-column library; mobile uses one column
  and a dismissible menu. Hidden navigation must not paint shadows across content.
- Preserve keyboard focus, Escape dismissal, busy state and focus return in dialogs.
  Respect reduced motion. Use authenticated media URLs, never public caches for private footage.

Tokens live in `apps/web/app/globals.css`. Existing React/CSS/Lucide remain the UI
foundation. Geist provides the font; Playwright and axe provide browser/accessibility QA.
Evaluate a component dependency against a concrete need before introducing it.

The repository-local [cliplane-ui skill](.agents/skills/cliplane-ui/SKILL.md) maps
frontend design and interface-review references to the existing implementation and
verification commands. Read it when changing or reviewing frontend screens. Tool
selection and adoption status: [frontend design tools](docs/research/frontend-design-tools.md).

References inspected: [Cal.com](https://cal.com/),
[Cal.com coss UI](https://github.com/cosscom/ui) (Base UI + Tailwind),
[Vercel Geist](https://vercel.com/geist/introduction),
[Geist colors](https://vercel.com/geist/colors), [Frame.io](https://frame.io/),
[Linear](https://linear.app/), [Screen Studio](https://screen.studio/).
These inform hierarchy and workflows; assets and branding remain original.

For demos, record real interactions with visibly moving original footage, restrained
focal zooms and concise annotations. Finish by playing the actual downloaded export.
No slide sequences, fabricated app results or unsupported AI/publishing claims.
