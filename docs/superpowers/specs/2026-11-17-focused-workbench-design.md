# Focused editing workbench

The owner prioritizes a modern, simple light UI and professional product demos,
informed by actual startup websites and demos, especially relevant YC companies.
Messages are cumulative tasks. The owner requests autonomous iteration and subagent
delegation; proceed using the existing React/CSS stack and the #45 acceptance.

## Direction

Make the editable video the center of the editor. Use a quiet near-white workbench,
a large composition stage, a compact contextual inspector, a genuine filmstrip and
one clear review/export path. Preserve the working library, authentication and
dialog keyboard/focus behavior. References inform hierarchy and demonstration,
not copied branding or assets. Record actual observations in
docs/research/workbench-ui.md.

The chosen approach is a client-side canvas composition fed by one authenticated
source video and a bounded browser filmstrip sampler. It reuses current media/API
contracts and adds no UI dependency. CSS-only multiple-video layers would require
synchronizing duplicate playback; server preview renders on every edit would add
latency and job churn. The canvas is an interactive draft approximation; the
separately labelled actual rendered export remains authoritative.

## Required behavior

- Live source composition responds to layout, normalized gameplay/facecam crop,
  timed clip-relative captions and audio mute without saving or rendering.
  Match the existing Python composition geometry, using decoded video dimensions.
- The filmstrip samples real distinct frames from the authenticated source proxy.
  Keep sampling bounded, serial and cancellable. A failed sampler leaves usable
  playback/trim controls and an honest unavailable state.
- Scrubbing updates the actual source video. Keyboard-accessible playhead and trim
  handles expose names, min/max/now/value text; numeric trim fields remain usable.
  Clamp every edit path to source bounds, at least 100 ms and at most 180000 ms;
  remove/clamp caption cues invalidated by a shorter selection.
- Opening a clip writes ?clip=<candidate UUID>. Reload and browser Back/Forward
  restore/close it. Resolve through authenticated candidate detail beyond the
  library limit; signed-out and cross-workspace links reveal no private content.
- Keep independent rights review, source embargo, exact edit/rights revisions and
  approval revocation. Unsaved changes hide stale actual-output/download feedback.
- Use a compact inspector and visible saved/draft/render states. At 320, 390, 768 and
  1440px, controls remain reachable with no horizontal overflow. Keep visible focus,
  Escape/focus return, touch targets and reduced motion. Do not assume axe proves
  full accessibility conformance.

## Demonstration and limits

Record the real working UI with visibly moving original synthetic media. Show a
finished result early, a clear edit, rights review, render, download and actual
export playback. No fabricated outcomes, staged gameplay rights clearance,
unimplemented AI/publishing claims or copied third-party demo assets.

This increment does not deploy the service or close #2 decoder isolation. Cloud
discovery and current CI remain distinct from production readiness. The new hourly
continuation task replaces the old daily task; each run advances one bounded issue
and checkpoints instead of looping on unavailable access or unchanged passing tests.
