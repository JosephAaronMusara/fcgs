-- FCGS Transport: settlement working-day policy, source-cycle attribution and direct advance repayments.
-- ADDITIVE ONLY. Apply after the October 27/28 Transport migrations; backup and verify the LOCAL test database first.
BEGIN;
ALTER TABLE transport_organization_settings ADD COLUMN IF NOT EXISTS payment_cutoff_working_days_before_end integer NOT NULL DEFAULT 1;
ALTER TABLE transport_organization_settings ADD COLUMN IF NOT EXISTS claim_cutoff_working_days_before_end integer NOT NULL DEFAULT 0;
ALTER TABLE transport_organization_settings ADD COLUMN IF NOT EXISTS payment_cutoff_time text NOT NULL DEFAULT '23:59';
ALTER TABLE transport_organization_settings ADD COLUMN IF NOT EXISTS claim_cutoff_time text NOT NULL DEFAULT '23:59';
ALTER TABLE transport_organization_settings ADD COLUMN IF NOT EXISTS settlement_rules_effective_from date NOT NULL DEFAULT '2026-11-01';
ALTER TABLE transport_claims ADD COLUMN IF NOT EXISTS settlement_year integer;
ALTER TABLE transport_claims ADD COLUMN IF NOT EXISTS settlement_month integer;
ALTER TABLE transport_claims ADD COLUMN IF NOT EXISTS settlement_policy_snapshot jsonb;
CREATE TABLE IF NOT EXISTS transport_advance_repayments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  advance_id integer NOT NULL REFERENCES transport_advances(id),
  school_id integer NOT NULL REFERENCES schools(id),
  cashup_id integer REFERENCES transport_cashups(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('cash','bank_transfer','mobile_money','other')),
  payment_reference text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  notes text,
  recorded_by_user_id integer NOT NULL REFERENCES users(id),
  recorded_at timestamp DEFAULT now(),
  verified_by_user_id integer REFERENCES users(id),
  verified_at timestamp,
  rejection_reason text,
  CONSTRAINT transport_advance_repayment_reference_uidx UNIQUE (school_id,payment_reference)
);
CREATE INDEX IF NOT EXISTS transport_advance_repayments_advance_idx ON transport_advance_repayments(advance_id,status);
CREATE TABLE IF NOT EXISTS transport_hq_settlement_requests (
  request_id text PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  user_id integer NOT NULL REFERENCES users(id),
  request_hash text NOT NULL,
  result jsonb,
  created_at timestamp DEFAULT now()
);
CREATE TABLE IF NOT EXISTS transport_hq_advance_recoveries (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  advance_id integer NOT NULL REFERENCES transport_advances(id),
  claim_deduction_id integer NOT NULL REFERENCES transport_claim_deductions(id) UNIQUE,
  hq_claim_id integer NOT NULL REFERENCES transport_hq_claims(id),
  amount numeric(12,2) NOT NULL CHECK (amount>0),
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transport_hq_advance_recoveries_advance_idx ON transport_hq_advance_recoveries(advance_id);
-- Enforce policy limits for ALL organisation rows, including future updates.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transport_settlement_policy_limits_ck') THEN
    ALTER TABLE transport_organization_settings ADD CONSTRAINT transport_settlement_policy_limits_ck
      CHECK (payment_cutoff_working_days_before_end BETWEEN 0 AND 10 AND
             claim_cutoff_working_days_before_end BETWEEN 0 AND 10 AND
             payment_cutoff_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
             claim_cutoff_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;
COMMIT;
