# Decoder controller preflight

Issue #2 requires a fail-closed decoder runtime. The current app still launches
native Python, including upload probing before a durable job exists. Do not switch
that backend in this increment. Add a useful operator command that rejects known
unsupported Docker runtimes and checks real controller values on a candidate runtime.

The owner authorizes autonomous bounded work. Use existing TypeScript/tsx tooling,
no new dependencies, cloud resources, host reconfiguration or implicit image pulls.

## Scope and result

`npm run --silent decoder:preflight -- --image sha256:<64 lowercase hex>` requires an explicit
trusted immutable local helper image with `/bin/sh` and `cat`. Reject malformed args
before any Docker operation. Inspect safe daemon fields; reject missing/non-v2 or
`none`/unknown cgroup drivers before launching a container. Do not reject rootless
mode by itself: actual delegation and controller readbacks are the relevant gates.

On a potentially supported daemon, inspect the exact local image without pulling.
Reject image ID mismatch or declared volumes, which could create writable anonymous
volumes despite read-only root. No repository, storage, socket, host bind or named
volume mount is allowed. No app credentials/environment are passed into the helper.

Use an opaque generated container identity and a matching unique ownership label.
Override image hooks with `--entrypoint /bin/sh`, `--workdir /tmp` and
`--no-healthcheck`. Run a fixed trusted read-only probe with network none, nonroot 65534:65534, all
capabilities dropped, no-new-privileges, read-only root, IPC none, log driver none,
one 1 MiB noexec/nosuid/nodev `/tmp` tmpfs and no core dumps. Request 64 MiB RAM,
0.5 CPU, 16 PIDs and no swap. Read actual `memory.max`, `cpu.max`, `pids.max` and
`memory.swap.max` from inside that container. Missing, malformed, unlimited or
nonmatching values fail. Equivalent quota/period pairs representing 0.5 CPU are valid.

Use bounded argv subprocesses, no shell interpolation of operator inputs. Cap
diagnostics at 16 KiB per command and total normal work at 30s; give cleanup its own
bounded attempt after abort/timeout. SIGINT/SIGTERM and every failure must reach
cleanup. Target only the created container/owned identity, never prune/enumerate or
delete an unrelated name collision. Recovery may inspect the generated name, but
must read its ownership label and immutable ID together, validate both, then remove
and verify disappearance by that ID. Never inspect a name then delete by name:
it could be rebound. Failed/uncertain cleanup cannot yield success.

Print one sanitized JSON report: schema version, phase `controller-preflight`,
verdict `preflight_passed` or `unsupported`, fixed requested limits, safe observed
controller/daemon fields, stable reason codes and cleanup outcome. Never emit raw
Docker stderr, host/account/context identifiers or credentials. Always report
`decoderIsolationQualified: false`: controller readback is not full isolation or
behavioral aggregate-enforcement qualification. Exit 0 only after all preflight
checks and owned cleanup pass; exit 2 for unsupported/errors/cancellation. Help may
exit 0 without Docker operations.

## Evidence and remaining work

Fresh bounded observation on main d4e871b confirmed Docker 29.9.2 rootless,
cgroup v2 and driver none. A disposable no-network/read-only probe requested
64 MiB/0.5 CPU/16 PIDs but read 8 GiB/2 CPUs/unlimited PIDs. Flags silently succeeded.
No exhaustion ran; exact container removal was verified. The new command must
reject that daemon and must not start native media or silently fall back.

Tests use a fake engine for deterministic protocol/lifecycle faults; label this
evidence honestly. Run the actual command once here to verify nonzero rejection
without creating resources. Full dedicated image, upload/worker adapter, behavioral
CPU/memory/PID/disk abuse, sibling-source/socket denial, bounded live artifact export
and cancellation/publication races remain open in #2. Keep its status In progress.

The hosted container job also runs the same controller preflight against the exact
immutable ID of its trusted locally built app image. Only the fixed shell probe runs;
this is real positive readback/cleanup evidence, not a dedicated decoder image or
hostile-media qualification. Unsupported readbacks must fail that job.
