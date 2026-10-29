-- Additive, deployment-first migration for the FCGS Transport payment allocation fix.
-- Existing receipts cannot be classified retroactively: preserve their intent as unknown.
BEGIN;
ALTER TABLE transport_payments
  ADD COLUMN IF NOT EXISTS allocation_mode text NOT NULL DEFAULT 'legacy_unclassified';
ALTER TABLE transport_payments
  ADD COLUMN IF NOT EXISTS allocation_charge_ids integer[];
ALTER TABLE transport_payments
  DROP CONSTRAINT IF EXISTS transport_payments_allocation_mode_ck;
ALTER TABLE transport_payments
  ADD CONSTRAINT transport_payments_allocation_mode_ck
  CHECK (allocation_mode IN ('legacy_unclassified','oldest_first','specific','future_credit'));
COMMIT;
