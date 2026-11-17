# Focused editing workbench references

Reviewed 2026-11-17 for #45. The creator task is to see how a selected moment will
look, adjust its timing/framing/captions, then save, review and render it. Keep the
existing light Geist/violet direction and React/CSS/Lucide foundation.

## Four official references

The YC links verify company identity and batch, not product quality. These are four
reference products, with official company pages used only for that verification.

| Reference                                                                                 | Evidence and observed pattern                                                                                                                                                                                                                                                                                          | Cliplane application                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Tella](https://www.tella.com/) — [YC S20](https://www.ycombinator.com/companies/tella)   | Official site describes timeline, transcript and layout controls. Captured desktop page uses a short introduction, one dominant action and use-case pills above large media. Three sampled homepage-video frames show a changing composition with speakers/split framing; they do not establish an editor interaction. | Put the composition in the center; group framing/caption controls in a compact inspector. Show immediate draft feedback, with the actual rendered result clearly identified. |
| [Clueso](https://www.clueso.io/) — [YC W23](https://www.ycombinator.com/companies/clueso) | Official page describes precise timeline controls and in-context canvas/timeline review. Its text positions a rough recording and a finished video as a clear transformation. Direct editor/demo viewing is not established by the text retrieval.                                                                     | Keep timing and editing near the preview. Demonstrate one concrete source-to-export transformation instead of listing every feature. Do not borrow its AI claims.            |
| [Jitter](https://jitter.video/) — [YC W20](https://www.ycombinator.com/companies/jitter)  | Official page leads with example/template outcomes and describes simple controls with detailed adjustment available. The first local browser capture remained an unloaded skeleton; no editor interaction is claimed.                                                                                                  | Use visual layout choices that communicate the resulting frame. Keep advanced adjustments discoverable without overwhelming the initial editing view.                        |
| [Kite](https://kite.video/) — [YC S23](https://www.ycombinator.com/companies/kite)        | This is the screen-recording tool at kite.video. Captured desktop page places feature pills above a numbered record/polish demonstration. Official text describes trim/combine and attention-guiding callouts. The first embedded-media area was still loading.                                                        | In the demo, make the cursor and selected control easy to follow; use restrained close-ups and brief annotations while preserving the real action/result sequence.           |

## Implementation decisions for #45

- Give the live composition preview the strongest visual weight. Place playback and
  exact current time next to it; put the source filmstrip and selection immediately
  below. Layout, crop and caption changes should visibly affect the draft preview.
- Use actual source frames, a seekable playhead and labeled keyboard-operable start
  and end handles. Keep numeric time fields as a precise alternative. An attractive
  strip that cannot seek or change the selection does not satisfy the task.
- Group controls by creator intent: framing/layout, captions and audio. Keep one
  clear save action and concise unsaved feedback. On mobile, show preview and trim
  before the detailed controls; do not squeeze a desktop inspector beside the video.
- Preserve the approval boundary. The editable preview is a draft; a completed
  rendered artifact is the final composition. Changes invalidate prior approval and
  must not leave stale ready/download messaging. Deep links still require the session
  and authorized media access.
- Reuse existing tokens and controls. The references inform hierarchy and interaction;
  no copied assets, logos, typography or brand styling are needed.

## Demonstration and verification

Record real original-media playback, scrub to a visible moment, adjust trim, change
layout/caption, save, review rights, approve the current revision, render and download.
Finish by playing that downloaded file. Keep any callouts short and attach each to an
observable action; a focused crop can clarify a control but must not imply fabricated
results. Include one desktop view and a short mobile/keyboard proof.

Verify pointer and keyboard trim/scrub, advancing media time, draft/save state,
approval invalidation, authenticated deep links, render/download, overflow and focus.
Run the meaningful browser/axe and project checks; automated scans alone do not
establish WCAG conformance. #29's second-engine and interrupted/error-flow work stays
open until exercised. #2 decoder isolation and #27 deployment separation remain
independent release gates; this UI pass does not establish production readiness.

## Evidence limits

Official pages were freshly retrieved with web search/open. Public-page browser
captures used the project's Playwright package and system Chromium; no login,
subscription or external publication occurred. Raw captures stay outside Git at
`/workspace/work/yc-research/`. Tella's 31.2-second embedded homepage video was sampled
at 2, 12 and 22 seconds; metadata reported decoded 960×540 frames and readyState 4.
The images show composition changes, with some rendering artifacts; this was not a
full editor walkthrough. Kite's first capture found its 46-second video advancing,
but its visible area was still loading; a later bounded capture could not obtain the
video element. Jitter remained skeletal and Clueso's browser capture timed out. Do
not claim those demos were watched. Feature descriptions above are attributed text;
Cliplane design choices are our inference. No third-party assets are included in the
product or public demo.
