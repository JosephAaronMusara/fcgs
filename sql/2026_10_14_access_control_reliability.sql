-- Forward-only additive change: no destructive updates, no permission resets.
BEGIN;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS callback_mode text NOT NULL DEFAULT 'automatic';
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS callback_host text;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS callback_port integer NOT NULL DEFAULT 9191;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS active_callback_url text;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS callback_error text;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS available_callback_hosts jsonb;
ALTER TABLE gate_commands ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 30;
ALTER TABLE gate_commands ADD COLUMN IF NOT EXISTS claim_token text;
ALTER TABLE gate_commands ADD COLUMN IF NOT EXISTS lease_expires_at timestamp;
ALTER TABLE gate_identity_sync ADD COLUMN IF NOT EXISTS confirmed_fingerprint text;
ALTER TABLE gate_identity_sync ADD COLUMN IF NOT EXISTS desired_fingerprint text;
ALTER TABLE gate_identity_sync ADD COLUMN IF NOT EXISTS last_verified_at timestamp;
ALTER TABLE gate_identity_sync ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified';
ALTER TABLE gate_identity_sync ADD COLUMN IF NOT EXISTS verification_details jsonb;
CREATE TABLE IF NOT EXISTS gate_school_settings (
  school_id integer PRIMARY KEY REFERENCES schools(id),
  organization_id integer NOT NULL REFERENCES organizations(id),
  reconciliation_enabled boolean NOT NULL DEFAULT true,
  reconciliation_time text NOT NULL DEFAULT '23:00',
  updated_by_user_id integer REFERENCES users(id),
  updated_at timestamp DEFAULT now(),
  CONSTRAINT gate_school_settings_hm_chk CHECK (reconciliation_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
CREATE INDEX IF NOT EXISTS gate_commands_priority_claim_idx ON gate_commands (bridge_id, status, priority, requested_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS gate_commands_processing_device_idx ON gate_commands (device_id) WHERE status = 'processing';
CREATE TABLE IF NOT EXISTS gate_sync_job_items (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id integer NOT NULL REFERENCES gate_sync_jobs(id),
  person_type text NOT NULL,
  person_id integer NOT NULL,
  identity_id integer REFERENCES access_identities(id),
  person_label text NOT NULL,
  outcome text NOT NULL,
  explanation text,
  device_ids jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT gate_sync_job_items_job_person_uidx UNIQUE (job_id, person_type, person_id)
);
CREATE INDEX IF NOT EXISTS gate_sync_job_items_outcome_idx ON gate_sync_job_items(job_id, outcome);
COMMIT;
