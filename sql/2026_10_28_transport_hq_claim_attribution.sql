-- Apply after backup, and only after transport credit allocation migration.
-- Additive only. Historical disbursements remain unchanged and are identified as legacy-unattributed.
BEGIN;
CREATE TABLE IF NOT EXISTS transport_hq_disbursement_claim_allocations (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  disbursement_id integer NOT NULL REFERENCES transport_provider_disbursements(id),
  school_claim_id integer NOT NULL REFERENCES transport_claims(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at timestamp DEFAULT now(),
  CONSTRAINT transport_hq_disbursement_claim_uidx UNIQUE (disbursement_id, school_claim_id)
);
CREATE INDEX IF NOT EXISTS transport_hq_disbursement_school_claim_idx
ON transport_hq_disbursement_claim_allocations(school_claim_id);
COMMIT;
