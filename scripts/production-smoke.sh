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
render_gate_client=

cleanup() {
  local status=$? cleanup_failed=0
  if [[ -n "$proxy_pid" ]]; then
    kill "$proxy_pid" 2>/dev/null || true
    wait "$proxy_pid" 2>/dev/null || true
  fi
  if [[ -n "$app_id" ]]; then docker rm -f "$app_id" >/dev/null || cleanup_failed=1; fi
  if [[ -n "$db_id" ]]; then docker rm -f "$db_id" >/dev/null || cleanup_failed=1; fi
  if [[ -n "$render_gate_client" ]]; then
    kill "$render_gate_client" 2>/dev/null || true
    wait "$render_gate_client" 2>/dev/null || true
  fi
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
  --env-file "$scratch/db.env" --mount "source=$db_volume,target=/var/lib/postgresql/data" \
  "$db_image" -c client_connection_check_interval=1000)"
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

api() {
  https -f -b "$scratch/cookies" -H "Origin: $origin" "$@"
}

db() {
  timeout 12 docker exec -i "$db_id" psql -XqAt -v ON_ERROR_STOP=1 -U cliplane -d cliplane "$@"
}

fail() {
  printf 'Production render recovery failed. %s\n' "$*" >&2
  exit 1
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
ffmpeg -v error -xerror -i "$scratch/media-before.mp4" -map 0:v:0 -f null -
https -f -b "$scratch/cookies" "$origin/api/me" > "$scratch/session-before.json"
workspace_id="$(jq -er .workspaceId "$scratch/session-before.json")"
[[ "$workspace_id" =~ ^[0-9a-fA-F-]{36}$ ]]
expected_master_hash="$(sha256sum "$media" | cut -d ' ' -f 1)"
master_hash() {
  docker exec "$app_id" sha256sum "/app/data/$workspace_id/$source_id/original/master.bin" | cut -d ' ' -f 1
}
[[ "$(master_hash)" == "$expected_master_hash" ]] || fail 'The original master did not match the uploaded bytes.'

# Save and review the actual synthetic edit through the same API as the editor.
moment="$(api "$origin/api/candidates" | jq -ec --arg source "$source_id" '[.[] | select(.source_id == $source)] | first')"
candidate_id="$(jq -er '.id | select(test("^[0-9a-f-]{36}$"))' <<< "$moment")"
candidate_url="$origin/api/candidates/$candidate_id"
edit="$(jq -c '{title:"Interrupted render smoke",expectedRevision:.edit_revision,
  editPlan:(.edit_plan+{startMs:0,endMs:2000,layout:"crop",muteAudio:true})}' <<< "$moment")"
rights="$(jq -c '.rights+{gameRights:"authorized",musicRights:"removed",spoilerRisk:"low",expectedRevision:.rights_revision}' <<< "$moment")"
json=(-H 'Content-Type: application/json')
api -X PATCH "${json[@]}" --data-binary "$edit" "$candidate_url" >/dev/null
api -X PATCH "${json[@]}" --data-binary "$rights" "$origin/api/sources/$source_id/rights" >/dev/null
review="$(api "$candidate_url" | jq -c '{decision:"approved",reason:"Reviewed original synthetic recovery fixture",
  expectedRevision:.edit_revision,expectedRightsRevision:.rights_revision}')"
edit_revision="$(jq -er '.expectedRevision' <<< "$review")"
rights_revision="$(jq -er '.expectedRightsRevision' <<< "$review")"
api "${json[@]}" --data-binary "$review" "$candidate_url/review" >/dev/null

# A barrier in the disposable DB stops this candidate's first publish after encoding
# and hashing, before the worker can dispatch COMMIT. The persisted lease is untouched.
db -v candidate="$candidate_id" <<'SQL'
CREATE FUNCTION cliplane_smoke_hold_render() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(721284, 1);
  RETURN NEW;
END;
$$;
CREATE TRIGGER cliplane_smoke_hold_render BEFORE INSERT ON rendered_clips
  FOR EACH ROW WHEN (NEW.candidate_id = :'candidate'::uuid)
  EXECUTE FUNCTION cliplane_smoke_hold_render();

-- Witness the claim in the same transaction without altering or rejecting it.
CREATE TABLE cliplane_smoke_reclaims (job_id uuid, owner uuid, prior_lease timestamptz, claimed_at timestamptz);
CREATE FUNCTION cliplane_smoke_record_reclaim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cliplane_smoke_reclaims VALUES (NEW.id, NEW.lease_owner, OLD.lease_until, statement_timestamp());
  RETURN NULL;
END;
$$;
CREATE TRIGGER cliplane_smoke_record_reclaim AFTER UPDATE OF attempts ON processing_jobs
  FOR EACH ROW WHEN (OLD.attempts = 1 AND NEW.attempts = 2
    AND NEW.kind = 'render' AND NEW.candidate_id = :'candidate'::uuid)
  EXECUTE FUNCTION cliplane_smoke_record_reclaim();
SQL
holder_sql='SELECT pg_advisory_lock(721284, 1); SELECT pg_sleep(240);'
docker exec -e PGAPPNAME=cliplane-smoke-render-gate "$db_id" psql -XqAt -v ON_ERROR_STOP=1 \
  -U cliplane -d cliplane -c "$holder_sql" > "$scratch/render-gate.log" 2>&1 &
render_gate_client=$!
holder_pid=
for _ in {1..12}; do
  holder_pid="$(db <<'SQL'
SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid
WHERE a.datname=current_database() AND a.application_name='cliplane-smoke-render-gate'
  AND l.locktype='advisory' AND l.classid=721284 AND l.objid=1 AND l.objsubid=2 AND l.granted;
SQL
)"
  if [[ "$holder_pid" =~ ^[1-9][0-9]*$ ]]; then break; fi
  sleep 1
done
[[ "$holder_pid" =~ ^[1-9][0-9]*$ ]] || fail 'The publication barrier did not acquire its lock.'

code="$(api "${json[@]}" --data-binary '{}' -o "$scratch/render-job.json" -w '%{http_code}' "$candidate_url/render")"
[[ "$code" == 202 ]] || fail 'The approved render was not queued.'
job_id="$(jq -er '.id | select(test("^[0-9a-f-]{36}$"))' "$scratch/render-job.json")"
first_blocked() {
  db -v holder="$holder_pid" <<'SQL'
SELECT pid FROM pg_stat_activity
WHERE datname=current_database() AND wait_event_type='Lock' AND wait_event='advisory'
  AND query LIKE 'INSERT INTO rendered_clips%'
  AND :'holder'::integer=ANY(pg_blocking_pids(pid));
SQL
}
worker_pid=
for _ in {1..45}; do
  worker_pid="$(first_blocked)"
  if [[ "$worker_pid" =~ ^[1-9][0-9]*$ ]]; then break; fi
  sleep 1
done
[[ "$worker_pid" =~ ^[1-9][0-9]*$ ]] || fail 'The first render did not reach publication.'

job_state() {
  db -v job="$job_id" -v workspace="$workspace_id" -v cutoff="${first_lease:-}" <<'SQL'
SELECT json_build_object('status',status,'attempts',attempts,'owner',lease_owner,'lease',lease_until,
  'key',idempotency_key,'revision',payload->>'revision',
  'lease_active',lease_until>clock_timestamp(),
  'past_cutoff',clock_timestamp()>=NULLIF(:'cutoff','')::timestamptz,
  'finished_after_cutoff',finished_at>=NULLIF(:'cutoff','')::timestamptz)
FROM processing_jobs WHERE id=:'job'::uuid AND workspace_id=:'workspace'::uuid AND kind='render';
SQL
}
first_job="$(job_state)"
first_owner="$(jq -er '.owner | select(test("^[0-9a-f-]{36}$"))' <<< "$first_job")"
first_lease="$(jq -er '.lease' <<< "$first_job")"
expected_key="render:$candidate_id:$edit_revision:$rights_revision"
jq -e --arg key "$expected_key" --arg revision "$edit_revision" \
  '.status=="running" and .attempts==1 and .lease_active and .key==$key and .revision==$revision' \
  <<< "$first_job" >/dev/null || fail 'The blocked worker did not own the expected first lease.'
first_artifact="$workspace_id/$source_id/renders/$candidate_id-r$edit_revision-$job_id-$first_owner.mp4"
docker exec "$app_id" test -s "/app/data/$first_artifact" || fail 'The first worker had not encoded its media.'
[[ "$(https -b "$scratch/cookies" -o /dev/null -w '%{http_code}' "$candidate_url/download")" == 404 ]] ||
  fail 'The blocked attempt exposed an export.'

previous_app_id="$app_id"
docker kill --signal=KILL "$previous_app_id" >/dev/null
[[ "$(docker inspect --format '{{.State.ExitCode}} {{.State.OOMKilled}}' "$previous_app_id")" == '137 false' ]] ||
  fail 'The exact app did not exit from the deliberate kill.'

# The disposable DB checks client connections while queries wait. Keep the barrier
# locked until the dead client's backend exits and its uncommitted work rolls back.
worker_present() {
  db -v worker="$worker_pid" <<'SQL'
SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=:'worker'::integer);
SQL
}
for _ in {1..10}; do
  if [[ "$(worker_present)" == f ]]; then break; fi
  sleep 1
done
[[ "$(worker_present)" == f ]] || fail 'The blocked transaction did not exit.'

assert_original_lease() {
  jq -e --arg owner "$first_owner" --arg lease "$first_lease" \
    '.status=="running" and .attempts==1 and .owner==$owner and .lease==$lease' <<< "$1" >/dev/null ||
    fail 'The first lease changed before recovery.'
}
assert_original_lease "$(job_state)"
published="$(db -v candidate="$candidate_id" <<'SQL'
SELECT count(*) FROM rendered_clips WHERE candidate_id=:'candidate'::uuid;
SQL
)"
[[ "$published" == 0 ]] || fail 'The killed attempt published a render.'
[[ "$(db -v holder="$holder_pid" <<'SQL'
SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity
WHERE pid=:'holder'::integer AND datname=current_database() AND application_name='cliplane-smoke-render-gate';
SQL
)" == t ]] || fail 'Could not close the disposable lock holder.'
wait "$render_gate_client" || true
render_gate_client=
db <<'SQL'
DROP TRIGGER cliplane_smoke_hold_render ON rendered_clips;
DROP FUNCTION cliplane_smoke_hold_render();
SQL

docker rm "$previous_app_id" >/dev/null
app_id=
start_app
[[ "$app_id" != "$previous_app_id" ]]
assert_original_lease "$(job_state)"
https -f -b "$scratch/cookies" "$origin/api/me" > "$scratch/session-after.json"
cmp "$scratch/session-before.json" "$scratch/session-after.json"
https -f -b "$scratch/cookies" "$origin/api/sources/$source_id/media" -o "$scratch/media-after.mp4"
cmp "$scratch/media-before.mp4" "$scratch/media-after.mp4"
ffmpeg -v error -xerror -i "$scratch/media-after.mp4" -map 0:v:0 -f null -
[[ "$(master_hash)" == "$expected_master_hash" ]] || fail 'The original master changed across recreation.'

deadline=$((SECONDS + 150))
while (( SECONDS < deadline )); do
  current_job="$(job_state)"
  if jq -e '.attempts==1' <<< "$current_job" >/dev/null; then
    assert_original_lease "$current_job"
  else
    jq -e --arg owner "$first_owner" --arg key "$expected_key" --arg revision "$edit_revision" \
      '.attempts==2 and .owner!=$owner and .past_cutoff and .key==$key and .revision==$revision
        and (.status=="running" or .status=="succeeded")' <<< "$current_job" >/dev/null ||
      fail 'Recovery did not reclaim the same job after the original lease expired.'
    if jq -e '.status=="succeeded" and .finished_after_cutoff' <<< "$current_job" >/dev/null; then break; fi
  fi
  sleep 1
done
jq -e '.status=="succeeded" and .finished_after_cutoff' <<< "${current_job:-null}" >/dev/null ||
  fail 'The second attempt did not complete within the real lease deadline.'
second_owner="$(jq -er '.owner | select(test("^[0-9a-f-]{36}$"))' <<< "$current_job")"
second_artifact="$workspace_id/$source_id/renders/$candidate_id-r$edit_revision-$job_id-$second_owner.mp4"
claim="$(db -v job="$job_id" -v owner="$second_owner" -v lease="$first_lease" <<'SQL'
SELECT count(*)=1 AND bool_and(job_id=:'job'::uuid AND owner=:'owner'::uuid
  AND prior_lease=:'lease'::timestamptz AND claimed_at>prior_lease)
FROM cliplane_smoke_reclaims;
SQL
)"
[[ "$claim" == t ]] || fail 'The replacement did not claim the same job strictly after its original lease.'
api "$candidate_url" | jq -e --argjson edit "$edit_revision" --argjson rights "$rights_revision" \
  '.status=="rendered" and .edit_revision==$edit and .approved_revision==$edit
   and .rights_revision==$rights and .approved_rights_revision==$rights' >/dev/null ||
  fail 'The recovered export did not preserve the approved edit and rights revisions.'

publication="$(db -v candidate="$candidate_id" -v workspace="$workspace_id" -v edit="$edit_revision" -v rights="$rights_revision" <<'SQL'
SELECT json_build_object(
  'renders',(SELECT count(*) FROM rendered_clips WHERE candidate_id=:'candidate'::uuid),
  'key',(SELECT storage_key FROM rendered_clips WHERE candidate_id=:'candidate'::uuid
    AND workspace_id=:'workspace'::uuid AND edit_revision=:'edit'::integer),
  'reviews',(SELECT count(*) FROM review_decisions WHERE candidate_id=:'candidate'::uuid),
  'exact_approval',(SELECT count(*) FROM review_decisions WHERE candidate_id=:'candidate'::uuid
    AND workspace_id=:'workspace'::uuid AND decision='approved'
    AND edit_revision=:'edit'::integer AND rights_revision=:'rights'::integer),
  'completions',(SELECT count(*) FROM audit_events WHERE entity_id=:'candidate'::uuid AND kind='render.completed'));
SQL
)"
jq -e --arg key "$second_artifact" \
  '.renders==1 and .key==$key and .reviews==1 and .exact_approval==1 and .completions==1' \
  <<< "$publication" >/dev/null || fail 'Recovery did not publish exactly one previously approved render.'

[[ "$(api -H 'Range: bytes=0-511' -o "$scratch/render-prefix" -w '%{http_code}' "$candidate_url/rendered")" == 206 ]]
api -o "$scratch/recovered.mp4" "$candidate_url/download"
head -c 512 "$scratch/recovered.mp4" > "$scratch/download-prefix"
cmp "$scratch/render-prefix" "$scratch/download-prefix"
ffprobe -v error -show_entries stream=codec_name,codec_type,width,height:format=duration -of json "$scratch/recovered.mp4" |
  jq -e '.streams==[{codec_name:"h264",codec_type:"video",width:720,height:1280}] and
    (.format.duration|tonumber|.>=1.9 and .<=2.1)' >/dev/null
ffmpeg -v error -xerror -i "$scratch/recovered.mp4" -map 0:v:0 -f null -
[[ "$(master_hash)" == "$expected_master_hash" ]] || fail 'Recovery changed the original master.'
echo 'The same render recovered after its real lease expired. Approved revisions, playback, session and master hash passed.'

if [[ -n "${CLIPLANE_SMOKE_EVIDENCE:-}" ]]; then
  jq -n --arg commit "$(git rev-parse HEAD)" --arg app "$image" --arg postgres "$db_image" \
    '{commit:$commit,app_image_id:$app,postgres_image_id:$postgres}' > "$CLIPLANE_SMOKE_EVIDENCE"
fi
