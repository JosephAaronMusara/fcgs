CREATE TABLE IF NOT EXISTS qc_records (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  class_id integer NOT NULL REFERENCES classes(id),
  student_id integer NOT NULL REFERENCES students(id),
  subject_id integer NOT NULL REFERENCES subjects(id),
  academic_year text NOT NULL,
  term text NOT NULL,
  record_date date NOT NULL,
  description_comment text NOT NULL,
  action_taken text,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  updated_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qc_records_lookup_idx
  ON qc_records (school_id, student_id, academic_year, term, subject_id, record_date DESC);

INSERT INTO permissions (code, name, description, category)
VALUES ('qc_reports.delete', 'Delete QC Reports', 'Delete quality control records', 'QC Reports')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category;
