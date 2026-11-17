# Decoder Controller Preflight Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans; preserve evidence and resume exact partial work.

**Goal:** Provide an operator command that rejects unsupported resource controllers without claiming a complete decoder sandbox.

**Architecture:** A standalone TypeScript preflight owns Docker argv execution, strict report parsing and opaque container cleanup. A small CLI parses explicit image input and prints sanitized JSON. Existing media execution remains unchanged.

**Tech Stack:** Existing TypeScript, tsx, Node 24, Vitest and Docker CLI.

**Spec:** docs/superpowers/specs/2026-11-17-decoder-preflight-design.md

## Global Constraints

- No application decoder change, native fallback claim, dependency, cloud resource or host reconfiguration.
- Explicit trusted local immutable image; `--pull=never`; reject declared image volumes.
- No host bind, repository, storage-root, socket or named-volume mounts.
- Override entrypoint/workdir/healthchecks; recover owned names to immutable IDs before removal.
- Fixed 64 MiB/0.5 CPU/16 PID/no-swap profile; actual in-container readbacks required.
- Sanitized JSON and bounded execution/diagnostics; abort/failure must attempt owned cleanup.
- Exit 0 is controller preflight only; `decoderIsolationQualified: false` always.
- Keep #2 open; no real abuse on an unqualified runtime.

## Review Focus

- Missing/shared/unlimited/malformed controller values must not pass.
- Create ambiguity, timeout, abort and failed cleanup must not leave a passing verdict.
- A name collision or failed ownership check must never remove another container.
- Declared image volumes, mutable/missing images and invalid args must be rejected safely.
- Raw stderr/endpoint/account data and unknown response fields must not reach the report.

## Task 1: Operator implementation and tests

**Files:** scripts/decoder/runtime-preflight.ts, scripts/decoder/preflight-cli.ts, tests/decoder-preflight.test.ts, package.json.

**Interfaces:** Export a typed preflight function with an injected Docker command runner for deterministic faults; a CLI invokes the real runner. The CLI accepts only help or explicit `--image sha256:<64 hex>`, uses the fixed profile and returns the report/exit status defined in the spec.

- [x] Write failing tests for exact/equivalent controller readbacks, weaker/unlimited/missing values, daemon rejection, invalid/mutable images and declared volumes.
- [x] Add lifecycle tests for create/start faults, malformed/oversized output, timeout, pre-abort/active abort, owned cleanup failure and unrelated identity protection.
- [x] Implement the minimal typed runner/report/CLI, run focused tests, lint/types and actual current-runtime nonzero rejection without creating a container.
- [x] Independently review spec/security/code quality; fix verified material findings and rerun affected checks.

## Task 2: Checkpoint and integration

**Files:** .github/workflows/quality.yml, docs/security/decoder-lifecycle.md, docs/development.md, docs/context/current.md and relevant verification/research notes.

- [x] Record current measured rejection, command prerequisites and exact limits of fake-engine/readback evidence; cite current primary Docker/kernel sources.
- [x] Require a real controller preflight in hosted container CI using the built trusted app image's immutable ID, without executing the application/media or adding stress tests.
- [x] Run npm run check with dev stopped before build. Reuse unchanged UI/demo evidence; hosted browser checks still gate the new head.
- [ ] Commit with verified jaydenpiao attribution, open a partial #2 PR and require current-head quality/browser/container/Secrets/CodeQL before authorized merge. Keep #2 In progress and leave the next bounded adapter/qualification step explicit.

Local acceptance: 62 focused cases and full check (167 TS/API/helper, 13 Python/media) pass; independent review approved. Hosted readback/cleanup and all other current-head gates remain required before integration. Keep #2 In progress.
