BEGIN;

CREATE INDEX IF NOT EXISTS idx_classes_archived_at
  ON classes (archived_at);

CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_class_id
  ON class_teacher_assignments (class_id);

CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_teacher_id
  ON class_teacher_assignments (teacher_id);

CREATE INDEX IF NOT EXISTS idx_class_teacher_assignments_effective_from
  ON class_teacher_assignments (effective_from);

INSERT INTO class_teacher_assignments (class_id, teacher_id, effective_from, created_at)
SELECT
  c.id,
  c.class_teacher_id,
  COALESCE(c.created_at, NOW()),
  NOW()
FROM classes c
WHERE c.class_teacher_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM class_teacher_assignments cta
    WHERE cta.class_id = c.id
      AND cta.teacher_id = c.class_teacher_id
      AND cta.effective_to IS NULL
  );

COMMIT;
