# Deployment direction

Status: planning only. No GCP access, resources, credentials or spending configured.

Deploy private staging before public production. Promote the same tested commit/image
with separate secrets, databases and storage; avoid staging/production code forks.

## Current constraints

- LocalObjectStore uses local files. Cloud Run's writable filesystem is ephemeral and
  memory-backed; originals/renders need durable object storage before that deployment.
- The API owns a polling job loop. Request-based CPU allocation is not a reliable host
  for idle background processing. Use an explicit worker/job execution model.
- Native media is untrusted. Prove the V1 per-job isolation/network/resource contract
  on the selected platform; a container build alone is not that proof.
- PostgreSQL and media need backups, retention/deletion verification and recovery drills.

## Staging options

| Option                                                                               | Fit / tradeoff                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private Compute Engine VM with rootless containers and persistent disk               | Closest to the current monolith/local storage. Use synthetic data and private/IAP access. Requires OS patching, backup and capacity ownership. Useful for an early isolated staging experiment. |
| Cloud Run control plane, Cloud SQL PostgreSQL, Cloud Storage and explicit media jobs | Managed services and independent scaling. Requires storage/worker adapters and a proven least-privilege media sandbox. Database and minimum-instance costs need explicit estimates.             |

Recommendation: finish V1, V2 and G3/G4 evidence before choosing public hosting.
For an early private staging test, prefer the smallest setup that preserves the actual
workflow and isolation contract. Choose managed production components after benchmarked
source-hour latency, memory, storage, concurrency and cost measurements.

## Provisioning gate

Before asking for access/deployment approval, prepare the actual project/region,
resource list, IAM/service identities, environment/secrets mapping, estimate, budgets,
quotas, data retention, TLS/ingress, smoke test and rollback plan. Budget alerts alone
are not a spending cap; constrain scale/concurrency and disable unused resources.
Use separate runtime and migration permissions. Keep staging synthetic and isolated.

Operator-provided cloud credits may be evaluated then. Account/billing details and
credentials stay outside this public repository. No paid resource is implicit approval.

Public-beta gates: docs/project/workflow.md. Implementation: issues #2, #3, #19, #27 and #28.

## Primary references — reviewed 2026-11-15

- https://cloud.google.com/run/docs/container-contract
- https://cloud.google.com/run/docs/configuring/billing-settings
- https://cloud.google.com/run/docs/create-jobs
- https://cloud.google.com/sql/docs/postgres/backup-recovery/backups
- https://cloud.google.com/storage/docs/access-control/signed-urls

The first three were consulted for runtime constraints. Recheck storage/database IAM,
pricing and service quotas during the actual deployment design.
