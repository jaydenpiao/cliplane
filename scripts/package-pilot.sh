#!/usr/bin/env bash
# Seal only the image pair recorded by the passing production smoke.
set -euo pipefail

if (( $# != 3 )); then
  echo 'Usage: bash scripts/package-pilot.sh SMOKE_JSON RECIPIENT_PEM OUTPUT_CMS' >&2
  exit 2
fi
evidence="$1"
recipient="$2"
output="$3"
limit=$((640 * 1024 * 1024))

if [[ ! "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ || ! "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]]; then
  echo 'A recorded GitHub workflow run and attempt are required.' >&2
  exit 1
fi
if [[ ! -f "$recipient" || -e "$output" || -L "$output" ]]; then
  echo 'Provide a recipient file and a new output path.' >&2
  exit 1
fi

if ! jq -es '
  length == 1 and (.[0] |
    type == "object" and keys == ["app_image_id", "commit", "postgres_image_id"] and
    (.commit | type == "string" and test("\\A[0-9a-f]{40}\\z")) and
    (.app_image_id | type == "string" and test("\\Asha256:[0-9a-f]{64}\\z")) and
    (.postgres_image_id | type == "string" and test("\\Asha256:[0-9a-f]{64}\\z")) and
    .app_image_id != .postgres_image_id
  )' "$evidence" >/dev/null; then
  echo 'Expected exact commit and two image IDs from the completed production smoke.' >&2
  exit 1
fi
ids="$(jq -r '[.commit, .app_image_id, .postgres_image_id] | @tsv' "$evidence")"
IFS=$'\t' read -r commit app_image postgres_image <<< "$ids"
if [[ "$commit" != "$(git rev-parse HEAD)" || "$commit" != "${GITHUB_SHA:-}" ]]; then
  echo 'Smoke evidence does not match this workflow checkout.' >&2
  exit 1
fi
for image in "$app_image" "$postgres_image"; do
  if [[ "$(docker image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}}' "$image")" != "$image linux/amd64" ]]; then
    echo 'Both tested linux/amd64 images must remain available by exact ID.' >&2
    exit 1
  fi
done

umask 077
scratch="$(mktemp -d -- "$(dirname -- "$output")/.cliplane-package.XXXXXX")"
trap 'rm -rf -- "$scratch"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker image save "$app_image" "$postgres_image" | gzip -n > "$scratch/images.tar.gz"
archive_bytes="$(stat -c '%s' "$scratch/images.tar.gz")"
if (( archive_bytes >= limit )); then
  printf 'Compressed images are %s bytes and exceed the private package size limit.\n' "$archive_bytes" >&2
  exit 1
fi
archive_hash="$(sha256sum -- "$scratch/images.tar.gz")"
jq -n --arg commit "$commit" --arg run_id "$GITHUB_RUN_ID" --arg run_attempt "$GITHUB_RUN_ATTEMPT" \
  --arg app_image_id "$app_image" --arg postgres_image_id "$postgres_image" \
  --arg archive_sha256 "${archive_hash%% *}" --argjson archive_bytes "$archive_bytes" \
  '{schema:1,commit:$commit,platform:"linux/amd64",run_id:$run_id,run_attempt:$run_attempt,
    app_image_id:$app_image_id,postgres_image_id:$postgres_image_id,
    archive_sha256:$archive_sha256,archive_bytes:$archive_bytes}' > "$scratch/manifest.json"

tar -C "$scratch" -cf - manifest.json images.tar.gz |
  openssl cms -encrypt -binary -stream -aes-256-gcm -outform DER \
    -recip "$recipient" -out "$scratch/package.cms"
sealed_bytes="$(stat -c '%s' "$scratch/package.cms")"
if (( sealed_bytes > limit )); then
  echo 'Encrypted package exceeds the 640 MiB draft transfer limit.' >&2
  exit 1
fi
sealed_hash="$(sha256sum -- "$scratch/package.cms")"
ln -T -- "$scratch/package.cms" "$output"
printf 'Private pilot package bytes=%s sha256=%s\n' "$sealed_bytes" "${sealed_hash%% *}"
