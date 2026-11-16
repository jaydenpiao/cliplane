# Creator clipping studio implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the report's first end-to-end local clipping workflow.
**Architecture:** Next.js studio and TypeScript modular API with PostgreSQL durable jobs;
stateless Python/FFmpeg media CLI. No external posting or paid inference.
**Tech Stack:** TypeScript, Next.js, React, Fastify, PostgreSQL 17, Python 3.12, FFmpeg.
**Spec:** docs/architecture/overview.md; supplied deep-research-report.md.

## Global constraints

- Authorized creator-owned uploads only; provenance mandatory.
- Every asset/job/edit/render query enforces workspace ownership.
- Declarative EditPlan version 1; human approval binds to revision.
- Original files remain immutable; 7-day raw retention default.
- No real public posting, external scraping or paid API usage in tests.

## Review focus

- Malformed/truncated or misleading media must fail without orphaned files.
- Tenant isolation includes preview ranges, derived files and mutations.
- Stale jobs/retries must not create duplicate candidates or exports.
- Any edit or rights change revokes old approval and rendered downloads.
- Embargoed/leaked footage, invalid crops and caption injection fail safely.

### Task 1: Domain, persistence and media contracts

Files: packages/domain/src/index.ts, packages/db/src/index.ts,
packages/db/migrations/001_initial.sql, workers/media/{pipeline.py,test files}.
Produces: validated EditPlan, approval blockers, deterministic candidate generation,
PostgreSQL schema, Python probe/analyze/render JSON contracts.

- [ ] Write domain boundary, music/embargo and dedup tests; run to see failure.
- [ ] Implement versioned domain schemas and actual SQL migrations.
- [ ] Write Python structural render/probe tests; run to see failure.
- [ ] Implement bounded local-only FFmpeg probe/analysis/render.
- [ ] Verify domain and media tests; commit.

### Task 2: Authorized ingest, queue and review API

Files: apps/api/src/{config,auth,storage,media,jobs,server,main}.ts,
tests/api.test.ts. Consumes domain and Python contracts from Task 1.
Produces authenticated /api/sources, /api/candidates, /api/events and /api/dashboard.

- [ ] Write real Postgres API tests for auth, upload, isolation, approval invalidation,
      invalid media, range requests, job retry and deletion; observe failure.
- [ ] Implement source provenance, streaming upload, sessions, durable leased jobs,
      review/render revisions, retention and audit events.
- [ ] Verify integration suite and static types; commit.

### Task 3: Studio UI and usable sample workflow

Files: apps/web/app/{page,layout,globals.css}, apps/web/components/_.tsx,
scripts/{dev,seed,migrate}, infra/_.
Consumes API from Task 2. Produces responsive studio with upload, queue, editor,
rights review, export, source library and insights.

- [ ] Build loading/error/empty states and accessible form controls.
- [ ] Add clearly labelled synthetic sample media with real persisted candidates.
- [ ] Verify Next.js build, API workflow and responsive styles; commit.

### Task 4: Repository delivery and independent review

Files: docs/{backlog,security,legal,runbooks}, .github/workflows, README, LICENSE.

- [ ] Document setup, limitations, ownership model, adapters and exact next issues.
- [ ] Add CI for real code: format/lint/types/tests/media/build/migrations/security.
- [ ] Run full quality checks, dependency audit and fresh independent code review.
- [ ] Fix material findings, rerun affected checks, package source and verification.

Execution: user requested autonomous implementation of the supplied report. Local
construction and verification proceed without an additional planning approval gate.
