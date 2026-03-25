BEGIN;

ALTER TYPE subject_type ADD VALUE IF NOT EXISTS 'ZIMSEC Advanced Level';
ALTER TYPE subject_type ADD VALUE IF NOT EXISTS 'ZIMSEC Ordinary Level';
ALTER TYPE subject_type ADD VALUE IF NOT EXISTS 'Cambridge Advanced Level';
ALTER TYPE subject_type ADD VALUE IF NOT EXISTS 'Cambridge Ordinary Level';
ALTER TYPE subject_type ADD VALUE IF NOT EXISTS 'Cambridge IGCSE';
ALTER TYPE subject_type ADD VALUE IF NOT EXISTS 'DELF';

ALTER TYPE grade_level ADD VALUE IF NOT EXISTS 'SEC_ZIM_A';
ALTER TYPE grade_level ADD VALUE IF NOT EXISTS 'SEC_ZIM_O';
ALTER TYPE grade_level ADD VALUE IF NOT EXISTS 'SEC_CAM_A';
ALTER TYPE grade_level ADD VALUE IF NOT EXISTS 'SEC_CAM_O';
ALTER TYPE grade_level ADD VALUE IF NOT EXISTS 'SEC_CAM_IGCSE';
ALTER TYPE grade_level ADD VALUE IF NOT EXISTS 'PRI_ZIM_ECD';
ALTER TYPE grade_level ADD VALUE IF NOT EXISTS 'PRI_ZIM_G12';
ALTER TYPE grade_level ADD VALUE IF NOT EXISTS 'PRI_ZIM_G37';
ALTER TYPE grade_level ADD VALUE IF NOT EXISTS 'PRI_CAM_ECD';
ALTER TYPE grade_level ADD VALUE IF NOT EXISTS 'PRI_CAM_G12';
ALTER TYPE grade_level ADD VALUE IF NOT EXISTS 'PRI_CAM_G37';

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS show_class_position_on_reports boolean DEFAULT false;

ALTER TABLE report_comments
  ADD COLUMN IF NOT EXISTS grade_level grade_level,
  ADD COLUMN IF NOT EXISTS subject_id integer REFERENCES subjects(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ecd_rating') THEN
    CREATE TYPE ecd_rating AS ENUM ('YES', 'NO', 'ALMOST');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ecd_assessment_domains (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS ecd_assessment_domains_code_idx
  ON ecd_assessment_domains(code);

CREATE TABLE IF NOT EXISTS ecd_assessment_items (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  domain_id integer NOT NULL REFERENCES ecd_assessment_domains(id),
  item_text text NOT NULL,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS ecd_assessment_records (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  student_id integer NOT NULL REFERENCES students(id),
  class_id integer NOT NULL REFERENCES classes(id),
  stream_id integer REFERENCES streams(id),
  exam_id integer NOT NULL REFERENCES exams(id),
  term_id integer,
  year integer,
  status text DEFAULT 'draft',
  teacher_id integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  published_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ecd_assessment_records_student_exam_idx
  ON ecd_assessment_records(student_id, exam_id);

CREATE TABLE IF NOT EXISTS ecd_assessment_responses (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id integer NOT NULL REFERENCES ecd_assessment_records(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES ecd_assessment_items(id),
  rating ecd_rating,
  notes text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ecd_assessment_responses_record_item_idx
  ON ecd_assessment_responses(record_id, item_id);

INSERT INTO ecd_assessment_domains (code, name, sort_order, is_active)
SELECT 'A', 'Emotional and Social Development', 10, true
WHERE NOT EXISTS (SELECT 1 FROM ecd_assessment_domains WHERE code = 'A');
INSERT INTO ecd_assessment_domains (code, name, sort_order, is_active)
SELECT 'B', 'Gross Motor Co-ordination', 20, true
WHERE NOT EXISTS (SELECT 1 FROM ecd_assessment_domains WHERE code = 'B');
INSERT INTO ecd_assessment_domains (code, name, sort_order, is_active)
SELECT 'C', 'Fine Motor Co-ordination', 30, true
WHERE NOT EXISTS (SELECT 1 FROM ecd_assessment_domains WHERE code = 'C');
INSERT INTO ecd_assessment_domains (code, name, sort_order, is_active)
SELECT 'D', 'Auditory Perception', 40, true
WHERE NOT EXISTS (SELECT 1 FROM ecd_assessment_domains WHERE code = 'D');
INSERT INTO ecd_assessment_domains (code, name, sort_order, is_active)
SELECT 'E', 'Oral Language Development', 50, true
WHERE NOT EXISTS (SELECT 1 FROM ecd_assessment_domains WHERE code = 'E');
INSERT INTO ecd_assessment_domains (code, name, sort_order, is_active)
SELECT 'F', 'Pre-number Concepts', 60, true
WHERE NOT EXISTS (SELECT 1 FROM ecd_assessment_domains WHERE code = 'F');

INSERT INTO ecd_assessment_items (domain_id, item_text, sort_order, is_active)
SELECT d.id, v.item_text, v.sort_order, true
FROM ecd_assessment_domains d
JOIN (VALUES
  ('A','Can play with others',1),
  ('A','Can share',2),
  ('A','Can control his or her feelings',3),
  ('A','Pride in his or her achievements',4),
  ('A','Can relate to a group',5),
  ('A','Can finish his or her food',6),
  ('A','Can take good care of his or her possessions',7),
  ('A','Can concentrate during lessons',8),
  ('A','Can complete a task',9),
  ('A','Knows his or her full name and age',10),
  ('A','Knows his or her telephone number',11),
  ('A','Knows his or her address',12),
  ('B','Can balance',1),
  ('B','Can skip',2),
  ('B','Can hop on alternate legs',3),
  ('B','Can catch with both hands',4),
  ('B','Can throw',5),
  ('B','Can jump',6),
  ('B','Can name the parts of his or her body',7),
  ('B','Is confident in water',8),
  ('C','Can cut and paste',1),
  ('C','Can thread beads according to pattern',2),
  ('C','Can tie his or her own shoelaces',3),
  ('C','Can dress himself or herself',4),
  ('C','Can hold his or her pencil the correct way',5),
  ('C','Can copy a shape',6),
  ('C','Can write patterns',7),
  ('C','Can trace around a template',8),
  ('C','Can write his or her name',9),
  ('C','Can draw a picture',10),
  ('C','Can draw a shape',11),
  ('D','Can match colour, shape and size',1),
  ('D','Can copy shapes',2),
  ('D','Can reproduce a pattern in sequence',3),
  ('D','Can see differences and similarities between shapes and pictures',4),
  ('D','Is aware of his or her position in space',5),
  ('D','Knows his or her left from his or her right',6),
  ('E','Can listen and understand',1),
  ('E','Can speak in sentences',2),
  ('E','Can retell a simple story in sequence',3),
  ('E','Can learn and enjoy rhymes and songs easily',4),
  ('E','Enjoys story time',5),
  ('E','Shows interest in books',6),
  ('E','Can interpret a picture',7),
  ('E','Can take a message',8),
  ('F','Knows his or her colours',1),
  ('F','Knows his or her shapes',2),
  ('F','Recognises numbers up to 5',3),
  ('F','Can write numbers up to 5',4),
  ('F','Can count up to 10',5),
  ('F','Can group to quantity up to 5',6),
  ('F','Can sort by size, colour, shapes',7)
) AS v(code, item_text, sort_order) ON d.code = v.code
WHERE NOT EXISTS (
  SELECT 1 FROM ecd_assessment_items i
  WHERE i.domain_id = d.id AND i.item_text = v.item_text
);

COMMIT;
