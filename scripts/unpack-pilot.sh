#!/usr/bin/env bash
# Verify the run's encrypted artifact, then extract only the two expected files.
set -euo pipefail
umask 077

if (( $# != 5 )) || [[ ! "${3:-}" =~ ^[0-9a-f]{64}$ || ! "${4:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Usage: bash scripts/unpack-pilot.sh PACKAGE.cms RECIPIENT.pem PACKAGE_SHA256 COMMIT NEW_DIRECTORY' >&2
  exit 2
fi
package="$1"
recipient="$2"
package_sha="$3"
commit="$4"
output="$5"

if [[ -e "$output" || -L "$output" ]]; then
  echo 'Choose a new output directory.' >&2
  exit 1
fi
actual_sha="$(sha256sum -- "$package" | cut -d ' ' -f 1)"
if [[ "$actual_sha" != "$package_sha" ]]; then
  echo 'Encrypted package hash differs from the reviewed run.' >&2
  exit 1
fi

scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT
openssl cms -decrypt -binary -inform DER -in "$package" -recip "$recipient" -inkey "$recipient" \
  -out "$scratch/bundle.tar"
[[ "$(tar -tf "$scratch/bundle.tar")" == $'manifest.json\nimages.tar.gz' ]]
tar -xOf "$scratch/bundle.tar" manifest.json > "$scratch/manifest.json"
tar -xOf "$scratch/bundle.tar" images.tar.gz > "$scratch/images.tar.gz"

jq -e --arg commit "$commit" \
  '.schema == 1 and .commit == $commit and .platform == "linux/amd64"' "$scratch/manifest.json" >/dev/null
app="$(jq -er .app_image_id "$scratch/manifest.json")"
postgres="$(jq -er .postgres_image_id "$scratch/manifest.json")"
archive_sha="$(jq -er .archive_sha256 "$scratch/manifest.json")"
archive_bytes="$(jq -er .archive_bytes "$scratch/manifest.json")"
[[ "$app" =~ ^sha256:[0-9a-f]{64}$ && "$postgres" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$archive_sha" == "$(sha256sum "$scratch/images.tar.gz" | cut -d ' ' -f 1)" ]]
[[ "$archive_bytes" == "$(stat -c %s "$scratch/images.tar.gz")" ]]
gzip -t "$scratch/images.tar.gz"

mkdir -- "$output"
mv -- "$scratch/manifest.json" "$scratch/images.tar.gz" "$output/"
printf 'Verified archive for %s\nApp image %s\nPostgreSQL image %s\n' "$commit" "$app" "$postgres"
