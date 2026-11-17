# Decoder execution lifecycle

Scope: the cancellation and lease-liveness part of issue #2. Full filesystem,
network and aggregate resource isolation remains open. The user authorizes bounded,
reviewed implementation; these implementation choices are the builder's decisions.

## Decision

Propagate one AbortSignal from each claimed job to its media process group. Renew
the two-minute database lease every five seconds, serially. An empty renewal result,
renewal failure, runner shutdown or a conservative 90-second local ownership budget
aborts execution. The budget starts before each database claim/renewal request, so
a slow response cannot grant the worker extra execution time. An expired lease may
not be renewed or publish completion. Normal cancellation and a new owner's state
must never be overwritten by stale cleanup/retry.

Renewal, retry and early render cancellation acquire the matching job row lock before
checking its clock-based expiry. A predicate evaluated before a lock wait can become
stale even without a changed row. Completion performs its final expiry check after
audit writes; Database.transaction checks AbortSignal immediately before COMMIT
dispatch. Cancellation before that boundary rolls back; after dispatch the database
outcome decides success. Artifacts become valid only after COMMIT succeeds, and
definite commit failures remove the unpublished attempt's files.

Use PostgreSQL as cancellation authority, including changes made by another API
instance. A local-only cancellation registry would miss those changes. Database
cancellation is observed on the next renewal (normally within five seconds); a
stalled database is bounded by the ownership budget. Clear timers/listeners after
completion and prevent stopped runners from claiming work. Existing owner-qualified
artifact paths, revision checks, retries and transactional fencing remain required.
Shutdown waits for the runner and request cleanup before closing the database.

The native backend must kill its POSIX process group, including FFmpeg descendants.
A future container backend must terminate its container identity explicitly; killing
the Docker CLI group is insufficient. This change adds no sandbox or deployment.

## Runtime evidence and alternatives

Fresh bounded evidence on 2026-11-17 independently confirmed Docker 29.9.2 rootless,
cgroup v2 and `CgroupDriver=none`. The daemon warned that cgroups were unavailable,
but container creation accepted 64 MiB memory, 0.5 CPU and 16 PID flags without a
warning. Actual in-container values were `memory.max=8589934592` (8 GiB),
`cpu.max=200000 100000` (2 CPUs), `pids.max=max` and `memory.swap.max=max`.
Command success and HostConfig are insufficient; this runtime fails the requested
aggregate bounds. No resource-exhaustion test ran.

The one disposable, immutable-ID probe had a read-only root, no external network,
nonroot UID/GID, zero capabilities, no-new-privileges and sized
`noexec,nosuid,nodev` tmpfs mounts. Those controls were observed to work; the root
write returned EROFS and only loopback/no IPv4 routes were present. No host
repository/storage/socket bind was supplied. The existing probe image's declared
volume destination was covered by bounded tmpfs. Explicit `finally` cleanup
removed the exact container, and an identity-specific check confirmed absence.
See [the scoped evidence and preflight decision](../research/decoder-controller-preflight.md).

The next increment is an operator command,
`npm run decoder:preflight -- --image 'sha256:<local-helper-image-id>'`, requiring
a trusted immutable local helper with no declared volumes and no implicit pull.
An unsupported daemon must return nonzero before container creation. Supported
candidates must compare effective controller values inside the bounded probe.
Every result retains `decoderIsolationQualified: false`; this controller preflight
does not enable a sandbox. Application media execution remains native.

Full issue #2 gates remain open: dedicated per-job filesystem/network/resource
isolation, behaviorally qualified aggregate quotas, a dedicated immutable decoder
image, bounded scratch/artifact export and container-identity cancellation tied to
existing lease/COMMIT fencing. Per-process address/CPU/file limits and real-UID
NPROC accounting do not prove per-job aggregate limits. Tmpfs consumes memory, can
swap and disappears when its container stops; ordinary bind output directories
and persistent Docker logs are not bounded storage.

Current primary references reviewed 2026-11-17:

- https://docs.docker.com/engine/security/rootless/tips/#limiting-resources
- https://docs.docker.com/engine/storage/tmpfs/
- https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html

## Acceptance

- Pre-aborted execution never starts a process; active abort kills descendants.
- Database cancellation and owner replacement stop active media without publication
  or changes to the cancelled/new owner's job state; unpublished artifacts are removed.
- Renewal errors/stalls abort; renewals do not overlap or revive an expired lease.
- Shutdown stops active work and prevents new claims. Successful work still completes.
- Audit-lock shutdown, retry-lock expiry and deferred COMMIT-failure tests use real
  PostgreSQL transactions. A deferred-trigger test also verifies success after an
  already-dispatched COMMIT, despite a later signal.
- Full checks and affected browser/media workflows pass; independent review precedes merge.
