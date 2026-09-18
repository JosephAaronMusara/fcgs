BEGIN;

ALTER TABLE access_identities
  ADD COLUMN IF NOT EXISTS enrollment_removed_at timestamp,
  ADD COLUMN IF NOT EXISTS enrollment_removal_reason text,
  ADD COLUMN IF NOT EXISTS enrollment_removed_by_user_id integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS manual_restriction_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_restriction_reason text,
  ADD COLUMN IF NOT EXISTS manual_restricted_by_user_id integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS manual_restricted_at timestamp;

CREATE TABLE IF NOT EXISTS school_day_overrides (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  override_date date NOT NULL,
  is_school_day boolean NOT NULL,
  reason text NOT NULL,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_day_overrides_school_date_uidx ON school_day_overrides (school_id, override_date);
CREATE INDEX IF NOT EXISTS school_day_overrides_school_date_idx ON school_day_overrides (school_id, override_date);

CREATE TABLE IF NOT EXISTS attendance_message_template_versions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id integer NOT NULL REFERENCES attendance_message_templates(id),
  school_id integer NOT NULL REFERENCES schools(id),
  template_key text NOT NULL,
  action text NOT NULL DEFAULT 'updated',
  previous_sms_template text NOT NULL,
  previous_email_subject_template text,
  previous_email_body_template text,
  new_sms_template text NOT NULL,
  new_email_subject_template text,
  new_email_body_template text,
  changed_by_user_id integer REFERENCES users(id),
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_message_template_versions_template_idx ON attendance_message_template_versions (template_id, created_at);
CREATE INDEX IF NOT EXISTS attendance_message_template_versions_school_idx ON attendance_message_template_versions (school_id, created_at);

COMMIT;
