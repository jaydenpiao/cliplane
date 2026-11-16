# Studio design and visual QA

Preserve the current restrained visual direction: clear hierarchy, warm neutral
surfaces, consistent spacing, coral actions and readable state indicators.
Use shared CSS tokens and existing React/Lucide components. Add a UI library only
for a demonstrated behavior/accessibility gap; evaluate its maintained official docs,
keyboard/focus behavior, bundle cost, license and integration before adopting it.

## Gate for UI changes

- Primary text and controls remain readable; aim for 14–16 px body and at least 12 px
  meaningful labels. Tiny decorative art text is separate from usable controls.
- Check applicable WCAG 2.2 AA contrast: normally 4.5:1 text, 3:1 large text.
- Preserve visible focus, meaningful labels, keyboard/dialog navigation, loading/error/
  empty states and accessible status announcements. Touch controls need adequate targets.
- Capture desktop and mobile after the change; check overflow, hierarchy, spacing,
  video framing, long titles, validation and disabled states.
- Exercise the real workflow and inspect the actual export. Review visuals at normal
  size; a successful screenshot command is not visual QA by itself.

Current screenshots and recorded demo prove the flow and responsive layout. Full
contrast, keyboard and second-engine audits remain issue #29; do not claim WCAG
conformance from the happy-path browser suite. Improve readability/controls there
before considering a broad redesign or extra design-service dependency.

Primary reference: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
checked 2026-11-15. Research relevant current component guidance during implementation.
