-- FCGS Portal additive upgrade for the 2026-09-21 Transport/RBAC/Student Transfer/Parent Finance build.
-- Safe to re-run. Historical internal-transfer reconstruction is intentionally handled by
-- `npm run internal-transfers:preflight` / `npm run internal-transfers:backfill` after this schema upgrade.

ALTER TYPE student_status ADD VALUE IF NOT EXISTS 'internally_transferred';

BEGIN;
SELECT pg_advisory_xact_lock(921202601);

-- Parent-facing school finance feature: existing schools keep today's behaviour.
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS enable_parent_fees_payments boolean;
UPDATE schools SET enable_parent_fees_payments = true WHERE enable_parent_fees_payments IS NULL;
ALTER TABLE schools ALTER COLUMN enable_parent_fees_payments SET DEFAULT true;
ALTER TABLE schools ALTER COLUMN enable_parent_fees_payments SET NOT NULL;

-- Student lifecycle support.
CREATE TABLE IF NOT EXISTS student_enrollment_events (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id integer NOT NULL REFERENCES students(id),
  school_id integer REFERENCES schools(id),
  event_type text NOT NULL,
  effective_date date NOT NULL,
  reason text,
  notes text,
  previous_status text,
  new_status text,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp without time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_enrollment_events_student_idx ON student_enrollment_events(student_id);
CREATE INDEX IF NOT EXISTS student_enrollment_events_school_idx ON student_enrollment_events(school_id);
CREATE INDEX IF NOT EXISTS student_enrollment_events_effective_date_idx ON student_enrollment_events(effective_date);

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS status_date date;
UPDATE students
SET status_date = enrollment_date
WHERE status_date IS NULL
  AND status = 'active'
  AND enrollment_date IS NOT NULL;

-- Backfill only factual enrollment history already present on the learner row.
INSERT INTO student_enrollment_events (student_id, school_id, event_type, effective_date, reason, previous_status, new_status)
SELECT s.id, s.school_id, 'enrolled', s.enrollment_date, 'Historical enrollment date backfill', NULL, COALESCE(s.status::text, 'active')
FROM students s
WHERE s.enrollment_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM student_enrollment_events e
    WHERE e.student_id = s.id
      AND e.event_type = 'enrolled'
  );

-- Admission numbers are permanent across internal transfers, therefore historical source and
-- active destination rows may share the same number at different schools. Remove only the
-- old global admission-number uniqueness rules and replace them with school-scoped uniqueness.
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'students'::regclass
      AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1
      AND EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = c.conrelid
          AND a.attnum = c.conkey[1]
          AND a.attname = 'admission_no'
      )
  LOOP
    EXECUTE format('ALTER TABLE students DROP CONSTRAINT %I', item.conname);
  END LOOP;
END $$;

DROP INDEX IF EXISTS students_admission_no_normalized_uidx;

DO $$
DECLARE duplicate_count integer;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT school_id, upper(btrim(admission_no)) AS normalized_admission_no
    FROM students
    GROUP BY school_id, upper(btrim(admission_no))
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Upgrade stopped: % duplicate school/admission-number group(s) already exist. Resolve them before retrying.', duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS students_school_admission_no_normalized_uidx
  ON students (school_id, upper(btrim(admission_no)));

-- Explicit source/destination learner linkage and joining date for internal transfers.
ALTER TABLE internal_transfers
  ADD COLUMN IF NOT EXISTS source_student_id integer,
  ADD COLUMN IF NOT EXISTS destination_student_id integer,
  ADD COLUMN IF NOT EXISTS joining_date date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'internal_transfers_source_student_id_students_id_fk') THEN
    ALTER TABLE internal_transfers
      ADD CONSTRAINT internal_transfers_source_student_id_students_id_fk
      FOREIGN KEY (source_student_id) REFERENCES students(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'internal_transfers_destination_student_id_students_id_fk') THEN
    ALTER TABLE internal_transfers
      ADD CONSTRAINT internal_transfers_destination_student_id_students_id_fk
      FOREIGN KEY (destination_student_id) REFERENCES students(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS internal_transfers_source_student_idx ON internal_transfers(source_student_id);
CREATE INDEX IF NOT EXISTS internal_transfers_destination_student_idx ON internal_transfers(destination_student_id);

-- Transport one-way pricing: preserve percentage mode/configuration and store fixed additions separately.
ALTER TABLE transport_settings
  ADD COLUMN IF NOT EXISTS one_way_pricing_mode text,
  ADD COLUMN IF NOT EXISTS inbound_one_way_fixed_addition numeric(12,2),
  ADD COLUMN IF NOT EXISTS outbound_one_way_fixed_addition numeric(12,2);
UPDATE transport_settings
SET one_way_pricing_mode = COALESCE(one_way_pricing_mode, 'percentage'),
    inbound_one_way_fixed_addition = COALESCE(inbound_one_way_fixed_addition, 0),
    outbound_one_way_fixed_addition = COALESCE(outbound_one_way_fixed_addition, 0);
ALTER TABLE transport_settings ALTER COLUMN one_way_pricing_mode SET DEFAULT 'percentage';
ALTER TABLE transport_settings ALTER COLUMN one_way_pricing_mode SET NOT NULL;
ALTER TABLE transport_settings ALTER COLUMN inbound_one_way_fixed_addition SET DEFAULT 0;
ALTER TABLE transport_settings ALTER COLUMN inbound_one_way_fixed_addition SET NOT NULL;
ALTER TABLE transport_settings ALTER COLUMN outbound_one_way_fixed_addition SET DEFAULT 0;
ALTER TABLE transport_settings ALTER COLUMN outbound_one_way_fixed_addition SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_settings_one_way_pricing_mode_chk') THEN
    ALTER TABLE transport_settings
      ADD CONSTRAINT transport_settings_one_way_pricing_mode_chk
      CHECK (one_way_pricing_mode IN ('percentage', 'fixed_addition'));
  END IF;
END $$;

-- Refund accounting: drafts may reference a refund, but only a verified cash-up consumes it.
ALTER TABLE transport_refunds
  ADD COLUMN IF NOT EXISTS accounted_cashup_id integer,
  ADD COLUMN IF NOT EXISTS accounted_at timestamp without time zone;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_refunds_accounted_cashup_id_transport_cashups_id_fk') THEN
    ALTER TABLE transport_refunds
      ADD CONSTRAINT transport_refunds_accounted_cashup_id_transport_cashups_id_fk
      FOREIGN KEY (accounted_cashup_id) REFERENCES transport_cashups(id);
  END IF;
END $$;

DROP INDEX IF EXISTS transport_cashup_refund_uidx;
CREATE INDEX IF NOT EXISTS transport_cashup_refund_idx ON transport_cashup_refunds(refund_id);

-- Backfill only from successfully completed/verified historical cash-ups. Draft/abandoned links do not consume refunds.
WITH completed AS (
  SELECT DISTINCT ON (cr.refund_id)
    cr.refund_id,
    cr.cashup_id,
    c.verified_at
  FROM transport_cashup_refunds cr
  JOIN transport_cashups c ON c.id = cr.cashup_id
  WHERE c.status = 'verified'
  ORDER BY cr.refund_id, c.verified_at DESC NULLS LAST, c.id DESC
)
UPDATE transport_refunds r
SET accounted_cashup_id = completed.cashup_id,
    accounted_at = COALESCE(completed.verified_at, r.accounted_at, now())
FROM completed
WHERE r.id = completed.refund_id
  AND r.accounted_cashup_id IS NULL;

COMMIT;
