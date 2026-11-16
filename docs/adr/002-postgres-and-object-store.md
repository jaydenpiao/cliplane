# ADR 002: PostgreSQL and replaceable local object storage

Accepted for local MVP. PostgreSQL 17 holds all durable workflow state and the queue.
SQL migrations are transactional and checksum-verified, and database constraints bind
source/candidate/job workspace pairs. Query boundaries also enforce workspace ownership.

LocalObjectStore implements opaque keys, restricted path resolution and cleanup. Files
are streamed through authenticated byte-range endpoints, never static/public URLs.
S3/R2 presigned uploads and lifecycle rules are a later adapter, not a hidden dependency.

Raw data defaults to seven days; approved rendered outputs are retained until source
deletion. Failed cleanup remains retryable. Production backups need separate retention.
