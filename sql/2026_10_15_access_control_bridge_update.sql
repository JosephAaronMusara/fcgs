-- Additive and fail-closed: automatic updates OFF by default.
BEGIN;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS update_agent_version text;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS update_agent_last_seen_at timestamp;
ALTER TABLE gate_bridges ADD COLUMN IF NOT EXISTS update_agent_error text;
CREATE TABLE IF NOT EXISTS gate_bridge_update_settings (
 bridge_id integer PRIMARY KEY REFERENCES gate_bridges(id),
 school_id integer NOT NULL REFERENCES schools(id),
 auto_enabled boolean NOT NULL DEFAULT false,
 mode text NOT NULL DEFAULT 'scheduled' CHECK (mode IN ('scheduled','as_soon_as_safe')),
 check_interval_hours integer NOT NULL DEFAULT 1 CHECK (check_interval_hours IN (1,3,6,12,24)),
 release_track text NOT NULL DEFAULT 'general' CHECK (release_track IN ('pilot','general')),
 maintenance_from text NOT NULL DEFAULT '02:00',
 maintenance_to text NOT NULL DEFAULT '04:00',
 time_zone text NOT NULL DEFAULT 'Africa/Harare',
 max_deferral_hours integer NOT NULL DEFAULT 24 CHECK (max_deferral_hours BETWEEN 1 AND 168),
 updated_by_user_id integer REFERENCES users(id),
 updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gate_bridge_signed_releases (
 release_id text PRIMARY KEY, version text NOT NULL UNIQUE,
 protocol_version integer NOT NULL DEFAULT 1,
 manifest_sha256 text NOT NULL,
 signed_by_key_id text NOT NULL,
 rollout_stage text NOT NULL DEFAULT 'pilot' CHECK (rollout_stage IN ('pilot','general')),
 approved boolean NOT NULL DEFAULT false,
 approved_at timestamp,
 approved_by text,
 created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gate_bridge_update_requests (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bridge_id integer NOT NULL REFERENCES gate_bridges(id),
 school_id integer NOT NULL REFERENCES schools(id),
 release_id text NOT NULL REFERENCES gate_bridge_signed_releases(release_id),
 origin text NOT NULL CHECK (origin IN ('remote','automatic','local')),
 status text NOT NULL DEFAULT 'queued',
 initiated_by_user_id integer REFERENCES users(id),
 requested_at timestamp NOT NULL DEFAULT now(),
 started_at timestamp,
 completed_at timestamp,
 expires_at timestamp,
 failure_code text,
 failure_reason text,
 rolled_back boolean
);
CREATE UNIQUE INDEX IF NOT EXISTS gate_bridge_one_pending_update_idx ON gate_bridge_update_requests(bridge_id) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS gate_bridge_update_events (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bridge_id integer NOT NULL REFERENCES gate_bridges(id),
 request_id integer REFERENCES gate_bridge_update_requests(id),
 attempt_id text NOT NULL,
 sequence integer NOT NULL,
 stage text NOT NULL,
 origin text NOT NULL DEFAULT 'automatic' CHECK (origin IN ('automatic','remote','local')),
 status text NOT NULL,
 error_code text,
 message text,
 occurred_at timestamp NOT NULL,
 received_at timestamp NOT NULL DEFAULT now(),
 CONSTRAINT gate_bridge_update_event_dedupe_idx UNIQUE(bridge_id,attempt_id,sequence)
);
CREATE INDEX IF NOT EXISTS gate_bridge_update_requests_bridge_idx ON gate_bridge_update_requests(bridge_id,requested_at DESC);
COMMIT;
