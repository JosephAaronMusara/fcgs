BEGIN;

ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS installation_id text;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS machine_name text;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS paired_at timestamp;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS last_service_started_at timestamp;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS last_identity_reconcile_at timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS gate_bridges_installation_uidx
  ON gate_bridges (installation_id)
  WHERE installation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gate_bridge_pairing_codes (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer NOT NULL REFERENCES schools(id),
  bridge_id integer NOT NULL REFERENCES gate_bridges(id),
  code_hash text NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  used_at timestamp,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_bridge_pairing_bridge_idx ON gate_bridge_pairing_codes (bridge_id, created_at);
CREATE INDEX IF NOT EXISTS gate_bridge_pairing_school_idx ON gate_bridge_pairing_codes (school_id, created_at);
CREATE INDEX IF NOT EXISTS gate_bridge_pairing_expiry_idx ON gate_bridge_pairing_codes (expires_at);

ALTER TABLE gate_identity_sync ADD COLUMN IF NOT EXISTS last_attempt_at timestamp;
ALTER TABLE gate_identity_sync ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE gate_identity_sync ADD COLUMN IF NOT EXISTS next_retry_at timestamp;
ALTER TABLE gate_identity_sync ADD COLUMN IF NOT EXISTS last_synced_photo_path text;
CREATE INDEX IF NOT EXISTS gate_identity_sync_retry_idx ON gate_identity_sync (sync_status, next_retry_at);

CREATE TABLE IF NOT EXISTS gate_sync_jobs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  school_id integer NOT NULL REFERENCES schools(id),
  job_type text NOT NULL,
  person_type text,
  status text NOT NULL DEFAULT 'pending',
  phase text,
  cursor_id integer NOT NULL DEFAULT 0,
  total_items integer NOT NULL DEFAULT 0,
  processed_items integer NOT NULL DEFAULT 0,
  succeeded_items integer NOT NULL DEFAULT 0,
  skipped_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  details jsonb,
  error_message text,
  requested_by_user_id integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  started_at timestamp,
  completed_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_sync_jobs_school_status_idx ON gate_sync_jobs (school_id, status, created_at);

COMMIT;
