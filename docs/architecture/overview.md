# Cliplane: creator-controlled clipping

The supplied research report specifies a phased product. This implementation completes
its first-iteration vertical slice: authorized upload → probe → durable processing →
explainable ranked moments → edit → rights review → deterministic render → download.
The core is game-agnostic. GTA VI release dates, pricing and policy claims from the
report are research context, not verified product facts or hard-coded behavior.

Next.js/React provides the studio. A TypeScript/Fastify modular monolith owns sessions,
workspace isolation, PostgreSQL records, and a durable queue. Its bounded job loop
invokes a stateless Python CLI over JSON stdin; FFmpeg/ffprobe process local files.
Workers never receive database credentials. There is one active processing job per
API instance. PostgreSQL SKIP LOCKED claims and leases support concurrent instances;
each instance must share the same object-store mount in that configuration.

Local file storage is implemented behind an ObjectStore interface. Originals are
immutable. Uploads use opaque server-generated keys and are never served publicly.
Authenticated range responses provide previews. A signed object-store adapter,
resumable remote ingest, official publishing, transcription, team invitations and
billing are explicit later milestones, not simulated features in this build.

Ranking uses audio RMS peaks and scene changes, context windows and temporal
suppression. This is a deterministic baseline, not a claim of learned gameplay AI.
Silence/no-audio video receives bounded evenly spaced candidates. Component scores
are persisted. Imported manual captions are plain text, never instructions.

Rendering supports original framing, vertical crop, blurred-fit and facecam split,
normalized manual crop controls, plain-text timed captions and complete audio mute.
Export approval binds to edit revision and source rights. Changing either revokes
approval. Unknown game/music rights remain visible; export review does not grant
commercial rights. Leaked/embargoed sources cannot be approved or exported.

Raw retention defaults to seven days. Expiration removes original and analysis
artifacts, expires unfinished candidates, and retains already exported renders until
explicit source deletion. Source deletion removes all derivatives and records an
audit event. Backups and production storage lifecycle policies remain operator work.

## Alternatives and decisions

The report's Next.js/TypeScript + Python/FFmpeg split is adopted. A browser-only mock
would not process footage; a Cloudflare Worker cannot run native FFmpeg. Therefore
this is a local/container application, not a Sites deployment. PostgreSQL is available
through Docker; no second persistence engine or Redis is introduced.

Human review and official provider contracts are designed now. Live posting and AI
providers require separate configuration and are not needed for the first proof of
value. Apache-2.0 is the report's recommended initial core license.
