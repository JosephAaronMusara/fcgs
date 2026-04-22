BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS national_id_number text,
  ADD COLUMN IF NOT EXISTS passport_number text;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS national_id_number text,
  ADD COLUMN IF NOT EXISTS passport_number text;

UPDATE staff
SET national_id_number = NULL
WHERE national_id_number IS NOT NULL AND btrim(national_id_number) = '';

UPDATE staff
SET passport_number = NULL
WHERE passport_number IS NOT NULL AND btrim(passport_number) = '';

UPDATE students
SET national_id_number = NULL
WHERE national_id_number IS NOT NULL AND btrim(national_id_number) = '';

UPDATE students
SET passport_number = NULL
WHERE passport_number IS NOT NULL AND btrim(passport_number) = '';

CREATE OR REPLACE FUNCTION fcgs_sequence_school_code(input_school_id integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n integer := COALESCE(input_school_id, 0);
  result text := '';
  offset_value integer;
BEGIN
  IF n <= 0 THEN
    RETURN 'A';
  END IF;

  WHILE n > 0 LOOP
    offset_value := (n - 1) % 26;
    result := chr(65 + offset_value) || result;
    n := (n - 1) / 26;
  END LOOP;

  RETURN result;
END;
$$;

WITH ordered_staff AS (
  SELECT
    s.id,
    COALESCE(s.school_id, 0) AS school_id,
    COALESCE(s.created_at::date, CURRENT_DATE) AS ref_date,
    ROW_NUMBER() OVER (
      PARTITION BY EXTRACT(YEAR FROM COALESCE(s.created_at, NOW())), COALESCE(s.school_id, 0)
      ORDER BY COALESCE(s.created_at, NOW()), s.id
    ) AS seq
  FROM staff s
)
UPDATE staff s
SET staff_no = (
  'FCGS'
  || RIGHT(EXTRACT(YEAR FROM o.ref_date)::text, 2)
  || 'E'
  || LPAD(o.seq::text, 4, '0')
  || fcgs_sequence_school_code(NULLIF(o.school_id, 0))
)
FROM ordered_staff o
WHERE s.id = o.id;

WITH ordered_students AS (
  SELECT
    st.id,
    COALESCE(st.school_id, 0) AS school_id,
    COALESCE(st.enrollment_date, st.created_at::date, CURRENT_DATE) AS ref_date,
    ROW_NUMBER() OVER (
      PARTITION BY EXTRACT(YEAR FROM COALESCE(st.enrollment_date::timestamp, st.created_at, NOW())), COALESCE(st.school_id, 0)
      ORDER BY COALESCE(st.enrollment_date::timestamp, st.created_at, NOW()), st.id
    ) AS seq
  FROM students st
)
UPDATE students st
SET admission_no = (
  'FCGS'
  || RIGHT(EXTRACT(YEAR FROM o.ref_date)::text, 2)
  || 'S'
  || LPAD(o.seq::text, 4, '0')
  || fcgs_sequence_school_code(NULLIF(o.school_id, 0))
)
FROM ordered_students o
WHERE st.id = o.id;

CREATE UNIQUE INDEX IF NOT EXISTS staff_national_id_number_unique_idx
  ON staff (upper(btrim(national_id_number)))
  WHERE national_id_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_passport_number_unique_idx
  ON staff (upper(btrim(passport_number)))
  WHERE passport_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS students_national_id_number_unique_idx
  ON students (upper(btrim(national_id_number)))
  WHERE national_id_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS students_passport_number_unique_idx
  ON students (upper(btrim(passport_number)))
  WHERE passport_number IS NOT NULL;

COMMIT;
