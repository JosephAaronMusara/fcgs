-- FCGS UTC Gate command regression checks (no writes to permanent tables).
-- Run through: psql "$DBURL" -X -v ON_ERROR_STOP=1 -f script/test-access-control-command-clock.sql
-- It creates a temporary test table inside a rolled-back transaction.
BEGIN;
SET LOCAL TIME ZONE 'Africa/Harare';
CREATE TEMP TABLE fcgs_gate_clock_test (
  claimed_at timestamp without time zone,
  lease_expires_at timestamp without time zone,
  expires_at timestamp without time zone,
  status text NOT NULL DEFAULT 'processing'
) ON COMMIT DROP;
INSERT INTO fcgs_gate_clock_test (claimed_at, lease_expires_at, expires_at)
VALUES (
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
  (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '90 seconds',
  (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '15 seconds'
);
DO $$
DECLARE sample fcgs_gate_clock_test%ROWTYPE;
BEGIN
  SELECT * INTO sample FROM fcgs_gate_clock_test LIMIT 1;
  IF sample.lease_expires_at - sample.claimed_at <> INTERVAL '90 seconds' THEN
    RAISE EXCEPTION 'FAIL: 90 second lease was not stored precisely';
  END IF;
  IF sample.expires_at - sample.claimed_at <> INTERVAL '15 seconds' THEN
    RAISE EXCEPTION 'FAIL: manual opening expiry not 15 seconds';
  END IF;
  IF sample.lease_expires_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'FAIL: new lease is prematurely expired';
  END IF;
  IF sample.expires_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'FAIL: new manual opening deadline is prematurely expired';
  END IF;
  IF sample.claimed_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '20 minutes' THEN
    RAISE EXCEPTION 'FAIL: legacy 20 minute claim fallback prematurely fired';
  END IF;
  IF pg_typeof(sample.expires_at AT TIME ZONE 'UTC') <> 'timestamp with time zone'::regtype THEN
    RAISE EXCEPTION 'FAIL: Bridge response expiry is not timestamptz';
  END IF;
  RAISE NOTICE 'PASS: Harare session time zone: UTC claim, 90-second lease, 15-second TTL and Bridge serialisation';
END $$;
SET LOCAL TIME ZONE 'UTC';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fcgs_gate_clock_test
    WHERE lease_expires_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
       OR expires_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  ) THEN
    RAISE EXCEPTION 'FAIL: UTC session misread a fresh deadline';
  END IF;
  RAISE NOTICE 'PASS: UTC session time zone: fresh deadlines remain valid';
END $$;
-- Check real-expiration logic using intentionally old test timestamps.
UPDATE fcgs_gate_clock_test
SET claimed_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '22 minutes',
    lease_expires_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 second',
    expires_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 second';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fcgs_gate_clock_test
    WHERE lease_expires_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      AND expires_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) THEN
    RAISE EXCEPTION 'FAIL: genuinely expired command was not detected';
  END IF;
  RAISE NOTICE 'PASS: expired leases and command deadlines are detected';
END $$;
ROLLBACK;
