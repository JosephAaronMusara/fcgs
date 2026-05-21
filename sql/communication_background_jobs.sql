BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'communication_job_status') THEN
    CREATE TYPE communication_job_status AS ENUM ('queued', 'running', 'completed', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS communication_jobs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id integer REFERENCES schools(id),
  job_type text NOT NULL,
  title text NOT NULL,
  status communication_job_status NOT NULL DEFAULT 'queued',
  requested_by integer REFERENCES users(id),
  total_count integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_summary text,
  metadata jsonb,
  started_at timestamp,
  completed_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communication_jobs_school_id_idx ON communication_jobs(school_id);
CREATE INDEX IF NOT EXISTS communication_jobs_status_idx ON communication_jobs(status);
CREATE INDEX IF NOT EXISTS communication_jobs_requested_by_idx ON communication_jobs(requested_by);
CREATE INDEX IF NOT EXISTS communication_jobs_created_at_idx ON communication_jobs(created_at DESC);

COMMIT;