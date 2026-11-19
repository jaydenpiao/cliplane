#!/usr/bin/env bash
# Run the exact app image with loopback-only HTTPS and disposable synthetic data.
set -euo pipefail

image="${1:-}"
if [[ ! "$image" =~ ^sha256:[0-9a-f]{64}$ ]] || (( $# != 1 )); then
  echo 'Usage: bash scripts/production-smoke.sh sha256:APP_IMAGE_ID' >&2
  exit 2
fi
if [[ "$(docker image inspect --format '{{.Id}}' "$image")" != "$image" ]]; then
  echo 'The exact app image is required locally before smoke testing.' >&2
  exit 1
fi

# Reserve nothing outside this rehearsal, and fail if another listener owns a port.
python3 - <<'PY'
import socket
for port in (3101, 3443):
    with socket.socket() as listener:
        try:
            listener.bind(("127.0.0.1", port))
        except OSError as error:
            raise SystemExit(f"Loopback smoke port {port} is unavailable") from error
PY

umask 077
checkout="$PWD"
scratch="$(mktemp -d)"
label="cliplane-smoke-$(openssl rand -hex 6)"
origin=https://localhost:3443
app_id=
db_id=
network_id=
db_volume=
media_volume=
proxy_pid=

cleanup() {
  local status=$? cleanup_failed=0
  if [[ -n "$proxy_pid" ]]; then
    kill "$proxy_pid" 2>/dev/null || true
    wait "$proxy_pid" 2>/dev/null || true
  fi
  if [[ -n "$app_id" ]]; then docker rm -f "$app_id" >/dev/null || cleanup_failed=1; fi
  if [[ -n "$db_id" ]]; then docker rm -f "$db_id" >/dev/null || cleanup_failed=1; fi
  if [[ -n "$network_id" ]]; then docker network rm "$network_id" >/dev/null || cleanup_failed=1; fi
  if [[ -n "$db_volume" ]]; then docker volume rm "$db_volume" >/dev/null || cleanup_failed=1; fi
  if [[ -n "$media_volume" ]]; then docker volume rm "$media_volume" >/dev/null || cleanup_failed=1; fi
  rm -rf -- "$scratch" || cleanup_failed=1
  if (( cleanup_failed )); then echo 'Production smoke cleanup was incomplete.' >&2; fi
  if (( status != 0 )); then exit "$status"; fi
  exit "$cleanup_failed"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# These are synthetic, run-local DB credentials and never enter the logs.
password="$(openssl rand -hex 24)"
printf '%s\n' 'POSTGRES_USER=cliplane' 'POSTGRES_DB=cliplane' "POSTGRES_PASSWORD=$password" > "$scratch/db.env"
printf '%s\n' "DATABASE_URL=postgres://cliplane:$password@postgres:5432/cliplane" \
  "APP_ORIGIN=$origin" 'COOKIE_SECURE=1' 'DEMO_ENABLED=0' > "$scratch/app.env"

docker pull postgres:17-alpine
db_image="$(docker image inspect --format '{{.Id}}' postgres:17-alpine)"
network_id="$(docker network create "$label")"
db_volume="$(docker volume create "$label-db")"
media_volume="$(docker volume create "$label-media")"
db_id="$(docker create --network "$network_id" --network-alias postgres \
  --env-file "$scratch/db.env" --mount "source=$db_volume,target=/var/lib/postgresql/data" "$db_image")"
docker start "$db_id" >/dev/null
for _ in {1..45}; do
  if docker exec "$db_id" pg_isready -q -h 127.0.0.1 -U cliplane -d cliplane; then break; fi
  sleep 1
done
docker exec "$db_id" pg_isready -q -h 127.0.0.1 -U cliplane -d cliplane

openssl req -x509 -newkey rsa:2048 -noenc -days 1 -subj /CN=localhost \
  -addext subjectAltName=DNS:localhost -out "$scratch/tls.crt" -keyout "$scratch/tls.key" > "$scratch/openssl.log" 2>&1
pin="$(openssl x509 -in "$scratch/tls.crt" -pubkey -noout | openssl pkey -pubin -outform DER |
  openssl dgst -sha256 -binary | openssl base64 -A)"
node scripts/production-smoke-proxy.mjs "$scratch/tls.crt" "$scratch/tls.key" &
proxy_pid=$!

https() {
  curl --noproxy '*' -sS --cacert "$scratch/tls.crt" --max-time 30 "$@"
}

start_app() {
  app_id="$(docker create --network "$network_id" --env-file "$scratch/app.env" \
    --publish 127.0.0.1:3101:3000 --mount "source=$media_volume,target=/app/data" "$image")"
  docker start "$app_id" >/dev/null
  for _ in {1..60}; do
    if https --max-time 2 -f "$origin/api/health" > /dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo 'The exact app container did not become healthy over HTTPS.' >&2
  docker inspect --format 'App container status={{.State.Status}} exit={{.State.ExitCode}}' "$app_id" >&2
  return 1
}

start_app
printf 'Production smoke checkout=%s app=%s postgres=%s\n' "$(git rev-parse HEAD)" "$image" "$db_image"
[[ "$(https -o /dev/null -w '%{http_code}' -X POST -H "Origin: $origin" "$origin/api/auth/demo")" == 404 ]]
[[ "$(https -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://cross-origin.invalid' "$origin/api/auth/demo")" == 403 ]]

email="smoke-$(openssl rand -hex 8)@example.test"
jq -n --arg email "$email" --arg password "$(openssl rand -hex 24)" \
  '{email:$email,password:$password,name:"Production smoke",workspace:"Synthetic smoke workspace"}' > "$scratch/auth.json"
https -f -D "$scratch/auth-headers" -c "$scratch/cookies" -o /dev/null \
  -H "Origin: $origin" -H 'Content-Type: application/json' --data-binary "@$scratch/auth.json" "$origin/api/auth/register"
grep -i '^set-cookie: cliplane_session=' "$scratch/auth-headers" > "$scratch/session-header"
grep -qi '; secure' "$scratch/session-header"
grep -qi '; httponly' "$scratch/session-header"
https -f -b "$scratch/cookies" "$origin/api/me" | jq -e '.demoEnabled == false' >/dev/null
echo 'Production HTTPS, secure HttpOnly cookie, origin check and disabled demo passed.'

mkdir "$scratch/browser"
(
  cd "$scratch/browser"
  export E2E_BASE_URL="$origin" NODE_EXTRA_CA_CERTS="$scratch/tls.crt" CLIPLANE_SMOKE_TLS_PIN="$pin"
  playwright="$checkout/node_modules/.bin/playwright"
  config="$checkout/playwright.production.config.ts"
  "$playwright" test -c "$config" --output "$scratch/browser/export-results" studio.spec.ts \
    --grep 'creator uploads, edits, reviews, renders and downloads a real clip'
  "$playwright" test -c "$config" --output "$scratch/browser/isolation-results" workbench.spec.ts \
    --grep 'editor URL survives reload and history without exposing another workspace'
)

# Reuse the authorized original pattern produced by the browser test.
media="$scratch/browser/work/e2e-fixture.mp4"
metadata='{"title":"Synthetic restart fixture","creator":"Production smoke","game":"Original generated test pattern","platform":"local","capturedAt":"2026-01-01T00:00:00Z","authorizationBasis":"Original synthetic pattern generated for this smoke test","attestation":true,"voiceAuthorized":true,"embargoed":false}'
source_id="$(https -f -b "$scratch/cookies" -H "Origin: $origin" \
  -F "metadata=$metadata" -F "file=@$media;type=video/mp4" "$origin/api/sources" | jq -er '.id')"
[[ "$source_id" =~ ^[0-9a-fA-F-]{36}$ ]]

for _ in {1..45}; do
  if https --max-time 2 -f -b "$scratch/cookies" "$origin/api/sources/$source_id/poster" -o /dev/null 2>/dev/null; then break; fi
  sleep 1
done
https -f -b "$scratch/cookies" "$origin/api/sources/$source_id/poster" -o /dev/null
https -f -b "$scratch/cookies" "$origin/api/sources/$source_id/media" -o "$scratch/media-before.mp4"
https -f -b "$scratch/cookies" "$origin/api/me" > "$scratch/session-before.json"
workspace_id="$(jq -er .workspaceId "$scratch/session-before.json")"
[[ "$workspace_id" =~ ^[0-9a-fA-F-]{36}$ ]]
expected_master_hash="$(sha256sum "$media" | cut -d ' ' -f 1)"
previous_app_id="$app_id"
docker stop --time 5 "$app_id" >/dev/null
docker rm "$app_id" >/dev/null
app_id=
start_app
[[ "$app_id" != "$previous_app_id" ]]
https -f -b "$scratch/cookies" "$origin/api/me" > "$scratch/session-after.json"
cmp "$scratch/session-before.json" "$scratch/session-after.json"
https -f -b "$scratch/cookies" "$origin/api/sources/$source_id/media" -o "$scratch/media-after.mp4"
cmp "$scratch/media-before.mp4" "$scratch/media-after.mp4"
ffmpeg -v error -xerror -i "$scratch/media-after.mp4" -map 0:v:0 -f null -
master_hash="$(docker exec "$app_id" sha256sum "/app/data/$workspace_id/$source_id/original/master.bin" | cut -d ' ' -f 1)"
[[ "$master_hash" == "$expected_master_hash" ]]
echo 'App container recreation preserved the authenticated session, playable media and original master hash.'

if [[ -n "${CLIPLANE_SMOKE_EVIDENCE:-}" ]]; then
  jq -n --arg commit "$(git rev-parse HEAD)" --arg app "$image" --arg postgres "$db_image" \
    '{commit:$commit,app_image_id:$app,postgres_image_id:$postgres}' > "$CLIPLANE_SMOKE_EVIDENCE"
fi
