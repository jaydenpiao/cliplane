# Google Cloud access and staging

Status: the owner executed the keyless bootstrap successfully on 2026-11-16.
Cloud discovery Actions runs are the source of truth for independent connection
verification. Application workloads have not been deployed. Project/account identifiers
and the owner-provided IAM output remain outside public source.

## Owner setup

1. Select or create a dedicated staging project in Google Cloud and attach the
   intended billing account. Keep production in a separate project. Set a monthly
   budget and alerts; do not post billing IDs or credentials here.
2. Open [Cloud Shell](https://shell.cloud.google.com/), which has gcloud and uses
   your Google account. Confirm the project:

   ```sh
   gcloud config get-value project
   gcloud projects describe YOUR_STAGING_PROJECT_ID --format='value(projectNumber)'
   ```

3. Clone this repository and inspect scripts/cloud/bootstrap-access.sh. Preview
   its changes, then apply from the owner session when the project is correct:

   ```sh
   git clone https://github.com/jaydenpiao/cliplane.git
   cd cliplane
   bash scripts/cloud/bootstrap-access.sh YOUR_STAGING_PROJECT_ID
   bash scripts/cloud/bootstrap-access.sh YOUR_STAGING_PROJECT_ID --apply
   ```

   This needs Service Usage Admin, Service Account Admin, Workload Identity Pool
   Admin and permission to change project IAM (for example Project IAM Admin).
   An existing owner can run it; do not grant Owner/Editor or billing admin to CI.
   It enables IAM, IAM Credentials, STS, Resource Manager and Service Usage APIs,
   creates restricted federation and a discovery-only service account. It creates
   no workloads or long-lived keys. IAM changes can take minutes to propagate.
4. Share the project ID, number, region preference, provider resource name and
   service-account email. These are configuration identifiers, not credentials.

This bootstrap does not grant application provisioning/deployment access. After
the resource plan is reviewed, grant only the required resource-scoped roles:
Artifact Registry Writer for the image repository, Cloud Run Developer for the
deployment target and Service Account User for its runtime identity. Runtime
accounts get their database, secret and storage access; migration stays separate.
Do not grant project-wide cloud admin to CI to work around missing permissions.

## GitHub deployment environment

Create a GitHub environment named staging, restricted to main. Set these non-secret
environment variables when the cloud project is known:

| Variable                       | Value                                                     |
| ------------------------------ | --------------------------------------------------------- |
| GCP_PROJECT_ID                 | Dedicated staging project ID                              |
| GCP_REGION                     | Selected region                                           |
| GCP_WORKLOAD_IDENTITY_PROVIDER | Provider resource name printed by bootstrap               |
| GCP_SERVICE_ACCOUNT            | Discovery account initially; scoped deploy identity later |

## Verify the connection

`Cloud discovery` is a fixed, read-only workflow on main using the staging environment.
It obtains a five-minute service-account token through the pinned Google auth action,
checks the target project's ID/number/lifecycle and required enabled APIs, and uses
`testIamPermissions` to check four named provisioning permissions. Those checks are
not a complete IAM audit. It creates no application resources or credential files.

Two supported triggers:

- Owner-configured environment variables: use workflow_dispatch from main.
- A contents-write repository dispatch with type cloud-discovery and validated
  project_id, workload_identity_provider and service_account payload fields.
  This uses the supported repository API permission and requires no proxy bypass.
  Identifiers are validated and masked before authentication; tokens/errors are not logged.

The connected app still cannot write environment policies or Actions variables.
Repository dispatch is available with its existing contents-write permission. A new
staging environment may be created by GitHub when first referenced; do not claim its
main-only deployment policy is enforced until the owner setup below is verified.
Google federation itself restricts the numeric repository/owner, main ref and staging subject.

For persistent variables and GitHub's main-only environment policy, run outside the
managed credential route from the owner-controlled checkout:

```sh
node scripts/cloud/configure-github.mjs --project YOUR_STAGING_PROJECT_ID \
  --provider YOUR_PROVIDER_RESOURCE --service-account YOUR_DISCOVERY_ACCOUNT
# Inspect the preview, then apply:
node scripts/cloud/configure-github.mjs --project YOUR_STAGING_PROJECT_ID \
  --provider YOUR_PROVIDER_RESOURCE --service-account YOUR_DISCOVERY_ACCOUNT --apply
```

This helper needs an owner gh login with repository administration and Actions variable
access. Preview performs no API writes; apply preserves conflicting owner protections
by failing closed, upserts three non-secret environment variables, verifies the main
branch policy and requests discovery. A requested run is not a passing verification.
Never paste credentials into script arguments or source. Review the actual Actions run.

A deployment workflow still requires storage/worker adapters, resource limits, database
and production smoke tests from the deployment design. Do not use this check to imply
that the application is deployed or that inherited IAM permissions were fully audited.

## GitHub Project access

The connected GitHub App can write repository issues and PRs, but Project reads
and createProjectV2 return Resource not accessible by integration (rechecked
2026-11-16). Repository admin does not imply personal Projects permission. No
native Project was created by this session.

The owner can create a board at [personal Projects](https://github.com/users/jaydenpiao/projects/new),
link Cliplane and bulk-add the existing issues. Use Backlog, Ready, In progress,
In review, Blocked and Done; save milestone, bug and release-blocker views.
Preserve issue numbers and acceptance criteria.

For API management, authorize Projects read/write. GitHub documents interactive
CLI login with `gh auth login --scopes project`; an existing CLI OAuth login can
use `gh auth refresh -s project`. These do not upgrade this workspace's separate
App credential. An authorized browser session or separately configured supported
connection is needed here. Never paste a token into chat, issues, logs or source.
Verify read/write access before claiming synchronization.

## Verification and rollback

Inspect the provider's numeric repo/owner, main-ref and staging-subject conditions,
then the account IAM bindings. Only roles/browser and
roles/serviceusage.serviceUsageViewer are granted to the identity. Verify a
feature branch and another repository fail when an OIDC test workflow is added.

To revoke access, disable the WIF provider or remove the account's
roles/iam.workloadIdentityUser binding. Remove its project roles and the pool
after checking for other consumers. Revoke access before deleting staging.
No service-account key needs rotation because none is created.

References: [Google federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines),
[Projects API authentication](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects).

## Reviewed implementation sources

- https://github.com/google-github-actions/auth (pinned v3; no credential file)
- https://github.com/actions/checkout/releases/tag/v7.0.1 (pinned; credential persistence off)
- https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event
- https://docs.cloud.google.com/resource-manager/reference/rest/v1/projects/testIamPermissions

## Immutable GitHub subjects

The first live check failed with unauthorized_client / attribute condition rejection.
The repository OIDC settings report use_immutable_subject=true and the prefix
`repo:jaydenpiao@71306047/cliplane@1459551943`. The original provider condition expected
GitHub's older name-only subject. New repositories use immutable IDs by default.

The corrected bootstrap pins:
`repo:jaydenpiao@71306047/cliplane@1459551943:environment:staging`, while retaining
independent repository ID, owner ID and refs/heads/main checks. It does not change
IAM roles or disable GitHub immutable subjects. Existing providers need the owner to
pull the corrected script and rerun --apply (or apply the exact reviewed condition).
A successful subsequent Cloud discovery run is required before claiming verified access.

References: https://docs.github.com/en/actions/reference/security/oidc and
https://docs.github.com/en/rest/actions/oidc .

Verified: after owner apply, [run 43974596592](https://github.com/jaydenpiao/cliplane/actions/runs/43974596592)
passed on main e603dc6 in staging. Keyless authentication, ACTIVE project identity and
five required APIs were verified. Four explicitly checked provisioning/IAM permissions
were absent; this is not a complete IAM audit. No workload was created. Environment
separation, permanent GitHub policy/variables and deployment remain separate tasks.
