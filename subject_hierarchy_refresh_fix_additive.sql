DO $$
BEGIN
  CREATE TYPE subject_assignment_mode AS ENUM ('add', 'remove');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE class_subjects
  ADD COLUMN IF NOT EXISTS assignment_mode subject_assignment_mode NOT NULL DEFAULT 'add';

ALTER TABLE student_subjects
  ADD COLUMN IF NOT EXISTS assignment_mode subject_assignment_mode NOT NULL DEFAULT 'add';

UPDATE class_subjects
SET assignment_mode = 'add'
WHERE assignment_mode IS NULL;

UPDATE student_subjects
SET assignment_mode = 'add'
WHERE assignment_mode IS NULL;

-- Remove legacy copied student-subject rows that should now be inherited live from the
-- stream/classroom hierarchy. This allows removals at stream or classroom level to take
-- effect immediately for students without requiring manual cleanup per student.
DELETE FROM student_subjects ss
USING students st, classes c, subjects subj
WHERE ss.student_id = st.id
  AND st.class_id = c.id
  AND ss.subject_id = subj.id
  AND ss.assignment_mode = 'add'
  AND (
    (c.stream_id IS NOT NULL AND subj.stream_id = c.stream_id)
    OR (c.stream_id IS NOT NULL AND subj.stream_ids IS NOT NULL AND c.stream_id = ANY(subj.stream_ids))
    OR EXISTS (
      SELECT 1
      FROM class_subjects cs
      WHERE cs.class_id = c.id
        AND cs.subject_id = ss.subject_id
        AND COALESCE(cs.assignment_mode::text, 'add') = 'add'
    )
  );
