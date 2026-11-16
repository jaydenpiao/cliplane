# Media cancellation implementation plan

> For agentic workers: use executing-plans or subagent-driven-development. Checkboxes
> track this bounded increment, not completion of the full decoder-isolation issue.

**Goal:** Stop obsolete media execution after cancellation, lease loss or shutdown.
**Architecture:** A serialized lease watcher supplies AbortSignal to the existing
native JSON process boundary. PostgreSQL remains the cancellation authority and
completion remains fenced by active, unexpired lease ownership.
**Tech stack:** TypeScript, Node 24, PostgreSQL 17, Vitest, Python/FFmpeg fixtures.
**Spec:** docs/security/decoder-lifecycle.md.

## Global constraints

Five-second renewals; two-minute database lease; conservative 90-second local budget.
No sandbox claim, daemon changes, cloud provisioning or new dependencies.
Keep retry, rights/revision and owner-qualified artifact cleanup semantics.

## Review focus

- Pre-abort and late abort: no launch/publication after cancellation.
- A replaced/expired owner: no lease revival or stale completion.
- Hanging or overlapping renewals: bounded execution and no late rescheduling.
- Shutdown during claim or execution: no new process and no further claims.
- Failed/cancelled work: remove only its own unpublished artifacts.

## Interfaces and task

Create apps/api/src/job-lease.ts:
`watchJobLease(renew: () => Promise<boolean>, options?: { intervalMs?: number;
budgetMs?: number; startedAt?: number }): { signal: AbortSignal; abort(): void;
stop(): void }`. Defaults are 5000/90000 ms and performance.now(). Budget is measured
from request start, not response receipt. stop clears timers without changing a
successful result; abort also aborts the signal. Renewals never overlap; late results
after stop/abort cannot schedule more work. Timings are injectable for deterministic tests.

Keep worker-process.ts's timeout/output positional arguments and add an optional sixth
AbortSignal. media.ts accepts an optional AbortSignal. JobRunner owns one watcher per
claim, renews only a still-running/unexpired matching owner with RETURNING id, stops
it in finally, aborts it on stop and passes its signal to analyze/render. Completion
updates require running, matching owner and unexpired lease, returning a row or
rolling back publication. JobRunner may accept an optional media executor/timings for
testing and the future execution adapter; defaults retain the existing backend.
stop() returns Promise<void> after aborting and draining active work; main.ts awaits
runner/request shutdown before closing the database. It must not claim work after stop.
packages/db/src/index.ts accepts an optional transaction AbortSignal and checks it
immediately before COMMIT dispatch. Lock ownership before evaluating expiry on renewal,
retry and early cancellation; make the success UPDATE the final publication statement.

- [x] Inspect current boundaries and run baseline: 54 tests pass.
- [x] Write process/lease/job regressions; run each before its implementation and
      confirm the failure is the missing cancellation behavior.
- [x] Implement the process signal, serialized watcher and runner integration in
      worker-process.ts, media.ts, job-lease.ts and jobs.ts. Tests: process.test.ts,
      job-lease.test.ts and job-cancellation.test.ts (real PostgreSQL, isolated schema).
- [x] Run focused tests, then npm run check and affected browser workflow. Expected:
      all pass; no worker/timer leaks. Record RED/GREEN and full logs outside Git.
- [x] Obtain one independent whole-change security/quality review; fix verified
      material findings and rerun their affected checks.
- [x] Prepare context, threat model, cloud evidence and issue #2 checkpoint.

Delivery state is authoritative on the branch's GitHub PR. Commit the reviewed change;
require hosted checks and merge only its passing head. Keep #2 open for sandbox work.

Review fixes: audit-lock cancellation and retry-lock expiry were reproduced RED and
fixed. The focused suite passes 42 tests; full checks pass 94 TS plus 13 Python tests.
Cancellation is checked at COMMIT dispatch and a dispatched commit retains its outcome.

Pre-flight: watcher.signal -> media -> process options is the shared abort interface;
all consumers use AbortSignal. Ownership budget is independent of backend timeout.
