BEGIN;

-- Fee-balance imports remain on the existing fees_import_* tables. These
-- columns add file-format metadata, row review metadata and durable background
-- processing progress without changing historical import rows.
ALTER TABLE fees_import_batches
  ADD COLUMN IF NOT EXISTS detected_format text,
  ADD COLUMN IF NOT EXISTS file_hash text,
  ADD COLUMN IF NOT EXISTS sheet_name text,
  ADD COLUMN IF NOT EXISTS skipped_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invalid_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_message text,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamp,
  ADD COLUMN IF NOT EXISTS last_progress_at timestamp,
  ADD COLUMN IF NOT EXISTS processing_completed_at timestamp;

ALTER TABLE fees_import_items
  ADD COLUMN IF NOT EXISTS source_sheet text,
  ADD COLUMN IF NOT EXISTS row_disposition text NOT NULL DEFAULT 'data',
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS validation_error text;

CREATE INDEX IF NOT EXISTS fees_import_batches_school_hash_idx
  ON fees_import_batches (school_id, file_hash);
CREATE INDEX IF NOT EXISTS fees_import_batches_status_idx
  ON fees_import_batches (status);

-- Parents With Arrears has been explicitly retired. Remove only that retired
-- permission and its direct assignments/overrides; no other RBAC assignment is
-- changed.
DELETE FROM user_permission_overrides
WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'arrears.view');

DELETE FROM access_group_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'arrears.view');

DELETE FROM permissions WHERE code = 'arrears.view';

COMMIT;
