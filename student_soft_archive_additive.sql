-- Batch 4: soft-delete support for Student Records.
-- Adds the archive marker used by DELETE /api/students/:id.
-- Historical linked records remain intact because students are no longer hard-deleted.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_students_active_lists
  ON students (school_id, class_id, status, archived_at);

COMMENT ON COLUMN students.archived_at
  IS 'Set when a student is removed from active lists without deleting linked historical records.';
