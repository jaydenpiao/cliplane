# Decoder controller preflight

Reviewed 2026-11-17 for the next bounded increment of issue #2. This is an
operator check of aggregate resource-controller support. It does not enable a
container media adapter or establish full decoder isolation.

## Fresh runtime evidence

A fresh manual probe at repository HEAD
`d4e871bf80fd2a84c202c9d2d41019cdb357ad86` independently confirmed Docker 29.9.2,
rootless mode, cgroup v2 and `CgroupDriver=none`. The daemon warned that rootless
mode was running without cgroups. Creation nevertheless accepted the requested
resource flags without warning, and selected HostConfig values retained them.

| Controller        | Requested                      | Effective inside the probe |
| ----------------- | ------------------------------ | -------------------------- |
| `memory.max`      | 64 MiB (`67108864`)            | 8 GiB (`8589934592`)       |
| `cpu.max`         | 0.5 CPU equivalent             | `200000 100000` (2 CPUs)   |
| `pids.max`        | `16`                           | `max`                      |
| `memory.swap.max` | No separate swap qualification | `max`                      |

These values fail the requested aggregate bounds. No memory fill, CPU burn or
process-exhaustion test ran after the mismatch was established.

The single disposable container used an existing local `postgres:17-alpine` image
by immutable image ID, with its normal entrypoint replaced by a small shell probe.
It requested no network, a read-only root, UID/GID 65534, dropped capabilities,
no-new-privileges and the `none` log driver. No repository, storage or socket bind
mount was supplied. Bounded tmpfs mounts covered `/work` (8 MiB), `/tmp` (1 MiB)
and the image-declared PostgreSQL volume destination (1 MiB), avoiding an anonymous
persistent data volume.

Observed controls: nonroot UID/GID, zero capability sets, `NoNewPrivs=1`, seccomp
filter mode, read-only root with a failed EROFS write, matching tmpfs capacities
with `noexec,nosuid,nodev`, and a denied direct execution from scratch. Only the
loopback interface was present, with no IPv4 routes; one bounded connection to a
documentation-only address failed. The run had a 20-second host timeout and the
connection attempt a two-second timeout. The exact task container was removed in
`finally`, and identity-specific inspection confirmed absence. No other containers
or their data were accessed.

The sanitized measured report and JSON remain outside Git under
`/workspace/work/decoder-qualification/runtime-report.md` and
`/workspace/work/decoder-qualification/runtime-evidence.json`. This summary contains
no Docker endpoint, hostname, account identifiers, credentials or raw diagnostics.

## Operator preflight increment

The planned command requires an already available, trusted local helper image by
immutable SHA-256 image ID. Replace the quoted placeholder before running:

```sh
npm run decoder:preflight -- --image 'sha256:<local-helper-image-id>'
```

The helper must declare no volumes, and the command must never implicitly pull an
image. The manual PostgreSQL probe handled its declared volume explicitly; that
image is therefore not eligible for this stricter helper contract.

The preflight checks selected daemon support fields first. An unsupported daemon
returns nonzero before creating a container. A supported candidate may proceed to
a short, task-owned, no-network/read-only/nonroot/capability-dropped probe with
bounded scratch and explicit identity cleanup, reading effective in-container
`memory.max`, `cpu.max` and `pids.max`. Accepted CLI flags and HostConfig alone are
insufficient. Missing, unlimited or weaker-than-requested controllers must fail
closed; diagnostics must stay sanitized. Do not run exhaustion tests before
actual bounds are established.

Every result reports `decoderIsolationQualified: false`, including a successful
controller comparison. This increment is necessary runtime evidence, not full
sandbox qualification. Application media execution remains native; the command
does not switch backends or make deployment ready.

## Source-backed decisions and remaining gates

- [Docker rootless resource limits](https://docs.docker.com/engine/security/rootless/tips/#limiting-resources)
  explain that resource flags are ignored when the cgroup driver is `none`.
  Rootless resource control needs cgroup v2, systemd and delegation of the required
  controllers. Rootless mode itself is not the rejection criterion.
- [Linux cgroup v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
  defines `memory.max` as the hard memory limit, `cpu.max` as quota and period, and
  `pids.max` as the task limit; `max` means no configured limit. Compare actual
  controller values rather than assuming the daemon applied requested flags.
- [Docker tmpfs mounts](https://docs.docker.com/engine/storage/tmpfs/)
  are temporary, consume memory, may be written to swap and disappear when the
  container stops. Mount byte capacities do not by themselves qualify inode
  limits, aggregate memory accounting or a bounded artifact-export protocol.

Issue #2 remains open. The full contract still requires a dedicated per-job
filesystem/network/resource boundary on a supported runtime, a dedicated immutable
decoder image, behavioral aggregate-quota qualification, bounded scratch and
artifact export, and container-identity cancellation integrated with existing
lease/COMMIT fencing. Existing native cancellation and transaction fencing remain
required. Per-process `prlimit` or real-UID process accounting cannot substitute
for aggregate per-job quotas. Ordinary output binds and persistent Docker logs
cannot substitute for bounded artifact storage.
