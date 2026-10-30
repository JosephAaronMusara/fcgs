BEGIN;
ALTER TABLE recruitment_interviews ADD COLUMN IF NOT EXISTS interview_stage_type text;
ALTER TABLE recruitment_interviews ADD COLUMN IF NOT EXISTS outcome_notes text;
ALTER TABLE recruitment_interviews ADD COLUMN IF NOT EXISTS result_recorded_by_user_id integer REFERENCES users(id);
ALTER TABLE recruitment_interviews ADD COLUMN IF NOT EXISTS result_recorded_at timestamp;
ALTER TABLE recruitment_notification_logs ADD COLUMN IF NOT EXISTS rendered_subject text;
ALTER TABLE recruitment_notification_logs ADD COLUMN IF NOT EXISTS rendered_message text;
CREATE INDEX IF NOT EXISTS recruitment_interviews_application_stage_idx ON recruitment_interviews(application_id, interview_stage_type, scheduled_at);
COMMIT;
