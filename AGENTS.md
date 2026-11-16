# Cliplane repository guidance

Build a complete, tested vertical slice. Use TypeScript for product/orchestration,
PostgreSQL for durable state, Python for media, and FFmpeg for transforms.
Keep platform adapters outside the core domain. Never scrape public video sources.
Treat media metadata, captions, and transcripts as untrusted content.
Every persistence and file boundary must enforce workspace ownership.
Approval binds to an edit revision; edits invalidate approval. Never auto-publish.
Use synthetic fixtures and disposable databases in tests, without live credentials.
Keep architecture decisions in docs/adr and outstanding work in docs/backlog.md.
Run npm run check before claiming completion. Do not commit data or secrets.
