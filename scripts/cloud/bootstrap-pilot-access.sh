#!/usr/bin/env bash
# Owner-run pilot authentication setup. Default: preview only.
set -euo pipefail

project_id="${1:-}"
reviewed_sha="${2:-}"
mode="${3:---dry-run}"
if [[ ! "$project_id" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || [[ ! "$reviewed_sha" =~ ^[0-9a-f]{40}$ ]] || [[ "$mode" != --dry-run && "$mode" != --apply ]] || (( $# > 3 )); then
  echo 'Usage: bash scripts/cloud/bootstrap-pilot-access.sh PROJECT_ID REVIEWED_MAIN_SHA [--dry-run|--apply]' >&2
  exit 2
fi

pool=cliplane-pilot-ci
provider=github
account=cliplane-ci-pilot
email="$account@$project_id.iam.gserviceaccount.com"
subject='repo:jaydenpiao@71306047/cliplane@1459551943:environment:staging'
repo_condition="assertion.repository_id == '1459551943' && assertion.repository_owner_id == '71306047'"
workflow_condition="assertion.ref == 'refs/heads/main' && assertion.event_name == 'repository_dispatch' && assertion.workflow_ref == 'jaydenpiao/cliplane/.github/workflows/pilot-gcloud.yml@refs/heads/main'"
condition="$repo_condition && $workflow_condition && assertion.sub == '$subject' && assertion.sha == '$reviewed_sha' && assertion.workflow_sha == '$reviewed_sha'"

run() {
  if [[ "$mode" == --apply ]]; then
    "$@"
  else
    printf '%q ' "$@"
    printf '\n'
  fi
}

if [[ "$mode" == --apply ]]; then
  command -v gcloud >/dev/null || { echo 'Run this in signed-in Google Cloud Shell.' >&2; exit 1; }
  export CLOUDSDK_CORE_DISABLE_PROMPTS=1
  project_record="$(gcloud projects describe "$project_id" --format='value(projectId,projectNumber,lifecycleState)')"
  read -r resolved_project project_number state extra <<< "$project_record"
  if [[ "$resolved_project" != "$project_id" || ! "$project_number" =~ ^[0-9]+$ || "$state" != ACTIVE || -n "$extra" ]]; then
    echo 'Expected an exact active project match. Stopped before creating resources.' >&2
    exit 1
  fi

  enabled_apis="$(gcloud services list --enabled --project="$project_id" --format='value(config.name)')"
  for api in iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com; do
    if [[ $'\n'"$enabled_apis"$'\n' != *$'\n'"$api"$'\n'* ]]; then
      printf 'Required API is not enabled: %s\n' "$api" >&2
      exit 1
    fi
  done

  accounts="$(gcloud iam service-accounts list --project="$project_id" --format='value(email)')"
  pools="$(gcloud iam workload-identity-pools list --location=global --project="$project_id" --format='value(name)')"
  if [[ $'\n'"$accounts"$'\n' == *$'\n'"$email"$'\n'* || $'\n'"$pools"$'\n' == *"/workloadIdentityPools/$pool"$'\n'* ]]; then
    echo 'A pilot identity or pool already exists. Review its policy before proceeding.' >&2
    exit 1
  fi
else
  project_number=PROJECT_NUMBER
fi

pool_path="projects/$project_number/locations/global/workloadIdentityPools/$pool"
run gcloud iam workload-identity-pools create "$pool" --location=global --display-name='Cliplane pilot GitHub' --project="$project_id"
run gcloud iam service-accounts create "$account" --display-name='Cliplane pilot CI' --project="$project_id"
run gcloud iam workload-identity-pools providers create-oidc "$provider" --location=global --workload-identity-pool="$pool" --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping=google.subject=assertion.sub --attribute-condition="$condition" --project="$project_id"
if [[ "$mode" == --apply ]]; then
  # A new account can take a minute or more to become visible to the IAM API.
  visible=
  for delay in 0 2 4 8 15 30 45; do
    sleep "$delay"
    if reply="$(gcloud iam service-accounts describe "$email" --project="$project_id" --format='value(email)' 2>/dev/null)" && [[ "$reply" == "$email" ]]; then
      visible=1
      break
    fi
  done
  if [[ -z "$visible" ]]; then
    echo 'Pilot account is not visible yet. Inspect the pilot resources before resuming the binding.' >&2
    exit 1
  fi
fi
run gcloud iam service-accounts add-iam-policy-binding "$email" --member="principal://iam.googleapis.com/$pool_path/subject/$subject" --role=roles/iam.workloadIdentityUser --condition=None --project="$project_id"

if [[ "$mode" == --apply ]]; then
  printf '\nPILOT_PROJECT_NUMBER=%s\n' "$project_number"
  echo 'Pilot credential exchange is configured. No cloud resource roles were granted.'
else
  printf '\nPreview only. Re-run with --apply from your authenticated Cloud Shell to create the pilot identity.\n'
fi
