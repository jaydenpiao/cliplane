CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
  password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','editor')),
  PRIMARY KEY(user_id, workspace_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS creator_identities (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL, UNIQUE(workspace_id, name), UNIQUE(id, workspace_id)
);
CREATE TABLE IF NOT EXISTS source_assets (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  creator_id uuid NOT NULL, title text NOT NULL, game text NOT NULL,
  source_platform text NOT NULL, capture_time timestamptz NOT NULL,
  authorization_basis text NOT NULL, attestation_version text NOT NULL,
  storage_key text NOT NULL, checksum text NOT NULL, byte_size bigint NOT NULL,
  metadata jsonb NOT NULL, rights jsonb NOT NULL, rights_revision integer NOT NULL DEFAULT 1,
  retention_deadline timestamptz NOT NULL, processing_region text NOT NULL DEFAULT 'local',
  status text NOT NULL CHECK(status IN ('queued','processing','ready','failed','expired','deleting','deleted')),
  error text, analysis jsonb, cleanup_pending boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, workspace_id), FOREIGN KEY(creator_id,workspace_id) REFERENCES creator_identities(id,workspace_id)
);
CREATE TABLE IF NOT EXISTS rights_attestations (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  source_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
  version text NOT NULL, statement text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(source_id,workspace_id) REFERENCES source_assets(id,workspace_id)
);
CREATE TABLE IF NOT EXISTS candidate_moments (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), source_id uuid NOT NULL,
  title text NOT NULL, start_ms integer NOT NULL, end_ms integer NOT NULL CHECK(end_ms > start_ms),
  score integer NOT NULL CHECK(score BETWEEN 0 AND 100), component_scores jsonb NOT NULL,
  reason text NOT NULL, thumbnail_key text NOT NULL, edit_plan jsonb NOT NULL,
  edit_revision integer NOT NULL DEFAULT 1, approved_revision integer, approved_rights_revision integer,
  status text NOT NULL DEFAULT 'needs_review' CHECK(status IN ('needs_review','approved','rejected','rendering','rendered','expired')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,workspace_id),
  FOREIGN KEY(source_id,workspace_id) REFERENCES source_assets(id,workspace_id), UNIQUE(source_id,start_ms,end_ms)
);
CREATE TABLE IF NOT EXISTS processing_jobs (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), source_id uuid NOT NULL,
  candidate_id uuid, kind text NOT NULL CHECK(kind IN ('analyze','render')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','cancelled')),
  idempotency_key text NOT NULL UNIQUE, payload jsonb NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz, lease_owner uuid, error text, telemetry jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  FOREIGN KEY(source_id,workspace_id) REFERENCES source_assets(id,workspace_id),
  FOREIGN KEY(candidate_id,workspace_id) REFERENCES candidate_moments(id,workspace_id)
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON processing_jobs(status,available_at,lease_until);
CREATE TABLE IF NOT EXISTS review_decisions (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), candidate_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id), decision text NOT NULL CHECK(decision IN ('approved','rejected')),
  edit_revision integer NOT NULL, rights_revision integer NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(candidate_id,workspace_id) REFERENCES candidate_moments(id,workspace_id)
);
CREATE TABLE IF NOT EXISTS rendered_clips (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), candidate_id uuid NOT NULL,
  edit_revision integer NOT NULL, storage_key text NOT NULL, checksum text NOT NULL,
  metadata jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(candidate_id,workspace_id) REFERENCES candidate_moments(id,workspace_id),
  UNIQUE(candidate_id,edit_revision)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id uuid REFERENCES users(id),
  kind text NOT NULL, entity_id uuid, data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_workspace_idx ON audit_events(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS source_workspace_idx ON source_assets(workspace_id,created_at DESC);
