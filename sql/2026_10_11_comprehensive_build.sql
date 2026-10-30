BEGIN;

ALTER TABLE recruitment_settings
  ADD COLUMN IF NOT EXISTS primary_school_max_age integer NOT NULL DEFAULT 35;

COMMIT;
