# Operator runbook

## Local readiness

1. `npm ci`, `cp .env.example .env`, `npm run db:up`, `npm run db:migrate`.
2. Verify `ffmpeg -version`, `ffprobe -version`, `python3 --version`.
3. Optionally `npm run seed`; run `npm run dev`.
4. Visit localhost:3000 and verify `/api/health` responds with `status: ok`.
5. Create a workspace, upload your own authorized clip, review rights, approve/render,
   download and inspect the resulting video. Demo data is explicitly synthetic.

## Jobs and failures

Activity shows stage, attempt count, state and safe error text. Transient failures retry
after 10 seconds, up to three attempts. Failed jobs can be retried manually. Expired
leases are reclaimed; lease-owner fencing prevents stale workers committing results.
Stop with Ctrl-C: the supervisor terminates API/web processes and native media groups.
After an abrupt machine kill, wait for the two-minute lease to expire or inspect it
manually. Do not reset job states while an encoder is still running.

## Retention and deletion

The API sweeps every minute. Cleanup failures produce `retention.failed` events and
remain eligible for retry. Sources in deleting/expired states cannot be newly exported.
Check available disk space and permissions when cleanup fails. Restored backups must
respect deletion records. Source deletion is permanent for local files; backup policy is separate.

## Backup and restore

Back up PostgreSQL and the data directory together, respecting approved storage and
retention policy. Use `pg_dump` against an operator-controlled connection, without
putting credentials into shell history. Restore to a separate database/storage path,
run migration validation and test tenant-isolated read access before switching traffic.
The development Compose password is not suitable for hosted services.

## Release and rollback

Run the complete quality suite. Build the image and web assets, run a synthetic smoke
test, verify environment requirements and take a consistent backup. Version the image
and migrations. For this initial additive schema, rollback means restoring the previous
application image against the unchanged schema; never drop production data to roll back.
Applied migrations are immutable and checksum-checked. Add a forward migration for changes.

No infrastructure, billing, OAuth applications, production deployment, public posts,
legal-policy publication or production data deletion is performed by repository setup.
