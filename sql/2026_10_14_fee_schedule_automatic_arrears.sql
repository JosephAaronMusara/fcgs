BEGIN;

CREATE TABLE IF NOT EXISTS fee_term_schedules (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  organization_id integer REFERENCES organizations(id),
  academic_year text NOT NULL,
  term text NOT NULL,
  created_by_user_id integer REFERENCES users(id),
  updated_by_user_id integer REFERENCES users(id),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  CONSTRAINT fee_term_schedules_term_chk CHECK (term IN ('term1', 'term2', 'term3')),
  CONSTRAINT fee_term_schedules_school_year_term_uidx UNIQUE (school_id, academic_year, term)
);

CREATE INDEX IF NOT EXISTS fee_term_schedules_school_idx
  ON fee_term_schedules (school_id);

CREATE TABLE IF NOT EXISTS fee_term_installments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id integer NOT NULL REFERENCES fee_term_schedules(id) ON DELETE CASCADE,
  installment_number integer NOT NULL,
  amount numeric(10,2) NOT NULL,
  arrears_effective_date date NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  CONSTRAINT fee_term_installments_schedule_number_uidx UNIQUE (schedule_id, installment_number),
  CONSTRAINT fee_term_installments_amount_positive_chk CHECK (amount > 0),
  CONSTRAINT fee_term_installments_number_chk CHECK (installment_number BETWEEN 1 AND 3)
);

CREATE INDEX IF NOT EXISTS fee_term_installments_schedule_idx
  ON fee_term_installments (schedule_id);

ALTER TABLE fees_import_batches
  ADD COLUMN IF NOT EXISTS academic_year text,
  ADD COLUMN IF NOT EXISTS term text,
  ADD COLUMN IF NOT EXISTS fee_schedule_id integer,
  ADD COLUMN IF NOT EXISTS fee_position_date date,
  ADD COLUMN IF NOT EXISTS amount_due_to_date numeric(10,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fees_import_batches_fee_schedule_id_fkey'
  ) THEN
    ALTER TABLE fees_import_batches
      ADD CONSTRAINT fees_import_batches_fee_schedule_id_fkey
      FOREIGN KEY (fee_schedule_id) REFERENCES fee_term_schedules(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fees_import_batches_fee_schedule_idx
  ON fees_import_batches (fee_schedule_id);

COMMIT;
