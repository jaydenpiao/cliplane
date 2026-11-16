# Deployment direction

Updated: 2026-11-16. Status: designed, not deployed. Keyless CI discovery is verified;
no Cliplane workloads are provisioned. Owner/billing configuration stays private.

## Decision

Keep PostgreSQL 17. Use Google Cloud for staging and production, with separate
projects and runtime identities. Keep the existing public GitHub Actions pipeline:
standard hosted runners for public repositories are free. Cloud Build is an option
for a demonstrated build bottleneck, not a second parallel CI system.

Target architecture after the storage/worker work lands:

| Component         | Staging                                                                  | Production direction                                                            |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Web/control plane | Cloud Run service, authenticated/private ingress, min instances 0, max 1 | Same image and configuration contract; measured limits and suitable ingress     |
| Database          | Cloud SQL PostgreSQL 17, zonal, small instance, backups                  | Separate instance; dedicated capacity and HA chosen against recovery objectives |
| Originals/renders | Private regional Cloud Storage buckets, lifecycle rules                  | Separate private buckets, retention/deletion verification                       |
| Media compute     | Explicit isolated job per source/render, concurrency 1                   | Measured job capacity; independent retry, timeout and resource limits           |
| Secrets           | Secret Manager, per-secret access                                        | Separate secrets and service accounts                                           |
| Images/deployment | Artifact Registry; GitHub Actions OIDC                                   | Promote tested image digest, not a rebuild                                      |

Cloud Run Jobs is the first media execution candidate, not a proven security
boundary for this application yet. The job must receive only the required input,
have no database/application secrets, write only its result prefix, and satisfy
the decoder isolation/network/resource contract in issue #2. If that contract
cannot be demonstrated on Cloud Run, use a dedicated isolated Compute Engine
worker rather than weakening the contract. No Kubernetes cluster or GPU is
needed for the current FFmpeg workload.

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

Finish V1, V2 and G3/G4 evidence before public hosting. Add Cloud Storage and job
dispatch adapters before the managed deployment. Benchmark source-hour latency,
memory, storage, concurrency and cost, then size production components.

## Delivery and access

Use GitHub Actions Workload Identity Federation (OIDC), not a downloaded service
account key. Restrict trust to numeric repository/owner IDs, main, and the named
GitHub deployment environment. Keep cloud access out of untrusted PR workflows.
Use separate identities for build push, runtime, migration and deployment.

The reviewed access bootstrap in scripts/cloud/bootstrap-access.sh grants
project/service discovery only. It creates no app, database, bucket, VM or paid
workload. See [Google Cloud setup](../runbooks/google-cloud.md) for owner steps.
Merging reviewed code to main is authorized; a merge does not prove deployment.

## Cost controls

Use one region; us-central1 is a candidate pending user/data-location needs.
Start staging at one web instance and one concurrent media task, min instances 0,
short job timeouts, upload/storage quotas, short synthetic-media retention and
Artifact Registry cleanup. Set alerts at 50/80/100% of a chosen monthly budget.
Cloud SQL has an instance/storage/backup cost even when the web scales to zero.
Shared-core is for small staging experiments and has no SLA. Do not assume free
Cloud SQL or treat available credits as a cost estimate. Calculate a region-specific
estimate before provisioning and report cost per source-hour after a benchmark.
Choose the Cloud SQL edition explicitly: PostgreSQL 17 defaults to Enterprise
Plus in the console; staging should use the reviewed Enterprise configuration.

## Provisioning gate

Before provisioning application resources, record the actual project/region,
resource list, IAM/service identities, environment/secrets mapping, estimate, budgets,
quotas, data retention, TLS/ingress, smoke test and rollback plan. Budget alerts alone
are not a spending cap; constrain scale/concurrency and disable unused resources.
Use separate runtime and migration permissions. Keep staging synthetic and isolated.

The owner has authorized using cloud credits for deployment and supporting work.
Account/billing details and credentials stay outside this public repository.

Public-beta gates: docs/project/workflow.md. Implementation: issues #2, #3, #19, #27 and #28.

## Primary references — reviewed 2026-11-16

- https://cloud.google.com/run/docs/container-contract
- https://cloud.google.com/run/docs/configuring/billing-settings
- https://cloud.google.com/run/docs/create-jobs
- https://cloud.google.com/sql/docs/postgres/backup-recovery/backups
- https://cloud.google.com/storage/docs/access-control/signed-urls
- https://cloud.google.com/sql/pricing
- https://docs.cloud.google.com/sql/docs/postgres/choose-edition
- https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- https://docs.cloud.google.com/billing/docs/how-to/budgets
- https://docs.github.com/en/billing/concepts/product-billing/github-actions

The runtime, identity, pricing and CI references were consulted. Recheck selected
region pricing, storage/database IAM and service quotas before provisioning.
