# Delivery ledger and roadmap

The supplied report is a phased strategy. This repository completes its **FIRST ITERATION**
core workflow; later items below are not implied to exist. Management targets in the
report (interviews, paying pilots, retention, acceptance) require actual creator research.
No creator outreach, licensing request or paid vendor purchase was performed.

## Validation & Rights — implemented technical foundation

- [x] Architecture and four major boundaries (language/runtime split is ADR 001).
- [x] Creator-owned file ingest with provenance, SHA-256, probe and retention metadata.
- [x] Explicit rights attestation and independent underlying-rights states.
- [x] Testable deterministic candidate scoring and temporal suppression.
- [x] Versioned renders, creator review, captions/layout/mute, authenticated downloads.
- [x] PostgreSQL durable jobs, isolation tests, audit events and cleanup retry.
- [x] CI, open-source docs, threat model and local synthetic fixtures.

## Vertical MVP — exact next issues

| ID  | Priority / area      | Deliverable and acceptance gate                                                                                                                                              |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | P0 / infra, security | Isolate each decoder job with no network, resource quotas and a per-job mount. Malicious-media fixture cannot read another source or exhaust host resources.                 |
| V2  | P1 / ingest          | Resumable S3/R2 direct upload. Interrupted large fixture resumes with checksum validation; cross-workspace/signature-expiry tests pass.                                      |
| V3  | P1 / detection       | Pluggable timestamped transcription (local first). Delayed/segmented audio remains aligned, provider costs logged, no paid provider default.                                 |
| V4  | P1 / detection       | VAD/speech activity, scene signals, top-candidate semantic reranking behind strict schemas. Labelled precision@5 benchmark must beat deterministic baseline before enabling. |
| V5  | P1 / web, render     | Saved templates, keyframed gameplay crop/tracked facecam, text overlays and separated microphone/game stems. Golden tests cover transforms, timing and stem selection.       |
| V6  | P1 / rights          | Per-span spoiler/music/third-party risk signals. Never convert detection into legal clearance; embargo locks and review gates remain regression-tested.                      |
| V7  | P1 / security        | Verified email, password reset, account export/deletion and workspace roles/invites. All downstream deletion jobs audited; cross-role/tenant tests pass.                     |

## Publishing Beta

| ID  | Priority / area | Deliverable and acceptance gate                                                                                                                                                                                |
| --- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | P1 / ingest     | Authorized Twitch broadcaster/editor ingest using documented APIs/scopes. Reject unauthorized sources; no playback scraping or cookies.                                                                        |
| P2  | P1 / publishing | Durable provider-neutral Publication/PlatformAccount/Connection models. Exact source→rights→edit→approval→account provenance; retries never duplicate posts; ambiguous failures require manual reconciliation. |
| P3  | P1 / publishing | One official Buffer or YouTube adapter with encrypted tokens and least scopes. Sandbox/dry-run tests; real posting only with explicit creator confirmation.                                                    |
| P4  | P1 / publishing | TikTok draft/consent flow. Present creator visibility/caption/consent; respect audit/private restrictions and documented rate limits.                                                                          |
| P5  | P1 / metrics    | MetricsSnapshot sync through documented provider capabilities. Deduplicate request IDs and distinguish unavailable watch-time metrics from zeros.                                                              |
| P6  | P1 / security   | Signed webhook verification and OAuth rotation/revocation. Forged/replayed webhook and cross-account callback tests pass.                                                                                      |
| P7  | P2 / ingest     | Creator-owned storage exports and local watched-folder uploader. Short-lived scoped credentials; import SSRF and provenance tests.                                                                             |

## Open Beta

| ID  | Priority / area | Deliverable and acceptance gate                                                                                                                                                |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O1  | P1 / product    | Usage-based billing with explicit plans/quotas and signed billing webhooks. No invented unlimited allowance or automatic paid purchases.                                       |
| O2  | P1 / detection  | Authorized chat spikes, detector plugin interface and per-game packs from real labels. Evaluate accepted-at-k, duplicates, boundary quality, latency and cost per source hour. |
| O3  | P1 / detection  | Creator-personalized ranking only after sufficient labelled data. Offline suite demonstrates improvement over baseline.                                                        |
| O4  | P1 / infra      | Tracing/correlation IDs, queue/stage latency dashboards, quota alerts, tested restore/rollback and storage observability.                                                      |
| O5  | P1 / rights     | Actual operator privacy/terms/DMCA process and commercial rights review. Human-reviewed documents replace operational drafts before public launch.                             |
| O6  | P2 / api        | Scoped API keys/public API, signed webhooks and rate limits. Cross-tenant and key-revocation tests pass.                                                                       |
| O7  | P2 / infra      | SBOM/license compliance, host-side CodeQL/secret scanning/rulesets and required checks. Confirm actual account support; never claim remote settings exist from YAML alone.     |

## Additional review follow-ups

- O8 / rights: preserve immutable assessment snapshots before implementing publication history.
- O9 / web: expose configured upload/retention limits instead of displaying only defaults.

## Validation work for the operator

Interview ≥20 creators; run ≥5 authorized trials; aim for ≥3 paying pilots. Measure
usable top-five sets, accepted boundaries, operator review time and source-hour latency.
The report's goals are experiments, not observed results. Use a paid concierge vendor
only after operator purchase/configuration; keep creator feedback and rights records here.
