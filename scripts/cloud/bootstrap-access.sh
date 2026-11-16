#!/usr/bin/env bash
# Owner-run, discovery-only GitHub OIDC bootstrap. Default: print, do not mutate.
set -euo pipefail

project_id="${1:-}"
mode="${2:---dry-run}"
if [[ ! "$project_id" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || [[ "$mode" != --dry-run && "$mode" != --apply ]] || (( $# > 2 )); then
  echo 'Usage: bash scripts/cloud/bootstrap-access.sh PROJECT_ID [--dry-run|--apply]' >&2
  exit 2
fi

pool_id=cliplane-github
provider_id=staging
account_id=cliplane-ci-discovery
account_email="$account_id@$project_id.iam.gserviceaccount.com"
mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id'
condition="assertion.repository_id == '1459551943' && assertion.repository_owner_id == '71306047' && assertion.ref == 'refs/heads/main' && assertion.sub == 'repo:jaydenpiao/cliplane:environment:staging'"

run() {
  if [[ "$mode" == --apply ]]; then
    "$@"
  else
    printf '%q ' "$@"
    printf '\n'
  fi
}

# Use explicit --project on every request; do not alter operator defaults.
if [[ "$mode" == --apply ]]; then
  command -v gcloud >/dev/null || { echo 'Run from Google Cloud Shell or install gcloud.' >&2; exit 1; }
  project_number="$(gcloud projects describe "$project_id" --format='value(projectNumber)')"
  [[ "$project_number" =~ ^[0-9]+$ ]] || { echo 'Project lookup failed.' >&2; exit 1; }
else
  project_number=PROJECT_NUMBER
fi

run gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com serviceusage.googleapis.com --project="$project_id"

if [[ "$mode" != --apply ]] || ! gcloud iam service-accounts describe "$account_email" --project="$project_id" >/dev/null 2>&1; then
  run gcloud iam service-accounts create "$account_id" --display-name='Cliplane CI discovery' --project="$project_id"
fi
if [[ "$mode" != --apply ]] || ! gcloud iam workload-identity-pools describe "$pool_id" --location=global --project="$project_id" >/dev/null 2>&1; then
  run gcloud iam workload-identity-pools create "$pool_id" --location=global --display-name='Cliplane GitHub' --project="$project_id"
fi
if [[ "$mode" == --apply ]] && gcloud iam workload-identity-pools providers describe "$provider_id" --workload-identity-pool="$pool_id" --location=global --project="$project_id" >/dev/null 2>&1; then
  run gcloud iam workload-identity-pools providers update-oidc "$provider_id" --workload-identity-pool="$pool_id" --location=global --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping="$mapping" --attribute-condition="$condition" --project="$project_id"
else
  run gcloud iam workload-identity-pools providers create-oidc "$provider_id" --workload-identity-pool="$pool_id" --location=global --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping="$mapping" --attribute-condition="$condition" --project="$project_id"
fi

pool_resource="projects/$project_number/locations/global/workloadIdentityPools/$pool_id"
run gcloud iam service-accounts add-iam-policy-binding "$account_email" --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/$pool_resource/attribute.repository_id/1459551943" --project="$project_id"
for role in roles/browser roles/serviceusage.serviceUsageViewer; do
  run gcloud projects add-iam-policy-binding "$project_id" --member="serviceAccount:$account_email" --role="$role" --condition=None
done

printf '\nConfiguration identifiers (not credentials):\nGCP_PROJECT_ID=%s\nGCP_WORKLOAD_IDENTITY_PROVIDER=%s/providers/%s\nGCP_SERVICE_ACCOUNT=%s\n' "$project_id" "$pool_resource" "$provider_id" "$account_email"
if [[ "$mode" != --apply ]]; then
  echo 'Preview only. No cloud changes made. Re-run with --apply from the owner account to configure access.'
fi
