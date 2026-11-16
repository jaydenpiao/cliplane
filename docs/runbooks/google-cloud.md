# Google Cloud access and staging

Status: setup prepared, not executed. This workspace has no gcloud installation,
authenticated cloud identity or selected cloud project. No resources were created.

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

An eventual deploy job uses environment: staging, contents: read and id-token:
write; it authenticates with google-github-actions/auth pinned to a reviewed
commit. No cloud credentials go to PR test jobs. A deployment workflow must wait
for the storage, worker, database and smoke-test requirements in the deployment
design. No live OIDC verification or application deployment has run yet.

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
