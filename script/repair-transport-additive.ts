import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run through dotenv, for example:\n  npx dotenv -e .env -- npx tsx script/repair-transport-additive.ts");
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });

const repairSql = String.raw`
BEGIN;

-- Prevent two upgrade processes from running against the same database.
SELECT pg_advisory_xact_lock(73426011);

DO $$
DECLARE duplicate_count integer;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT school_id, student_id
    FROM transport_assignments
    WHERE is_active = true
    GROUP BY school_id, student_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Transport repair stopped: % duplicate active learner assignment group(s) exist.', duplicate_count;
  END IF;
END $$;

-- Existing Stage 1 master tables: additive columns only.
ALTER TABLE transport_routes
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS retired_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS created_by_user_id integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT now();

ALTER TABLE transport_routes ALTER COLUMN billing_frequency SET DEFAULT 'monthly';
UPDATE transport_routes
SET status = CASE WHEN is_active THEN 'active' ELSE 'retired' END,
    updated_at = COALESCE(updated_at, created_at, now())
WHERE status IS NULL OR updated_at IS NULL;

ALTER TABLE transport_pickup_points
  ADD COLUMN IF NOT EXISTS latitude numeric(10,7),
  ADD COLUMN IF NOT EXISTS longitude numeric(10,7);

ALTER TABLE transport_owners
  ADD COLUMN IF NOT EXISTS national_id_or_registration text,
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date,
  ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT now();
UPDATE transport_owners SET updated_at = COALESCE(updated_at, created_at, now()) WHERE updated_at IS NULL;

ALTER TABLE transport_drivers
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date,
  ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT now();
UPDATE transport_drivers SET updated_at = COALESCE(updated_at, created_at, now()) WHERE updated_at IS NULL;

ALTER TABLE transport_vehicles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT now();
UPDATE transport_vehicles
SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END,
    updated_at = COALESCE(updated_at, created_at, now())
WHERE status IS NULL OR updated_at IS NULL;

-- Existing learner assignments: preserve records and backfill safe operational states.
ALTER TABLE transport_assignments
  ADD COLUMN IF NOT EXISTS outbound_vehicle_id integer,
  ADD COLUMN IF NOT EXISTS inbound_path_id integer,
  ADD COLUMN IF NOT EXISTS outbound_path_id integer,
  ADD COLUMN IF NOT EXISTS pickup_service_point_id integer,
  ADD COLUMN IF NOT EXISTS dropoff_service_point_id integer,
  ADD COLUMN IF NOT EXISTS pickup_path_node_id integer,
  ADD COLUMN IF NOT EXISTS dropoff_path_node_id integer,
  ADD COLUMN IF NOT EXISTS service_state text NOT NULL DEFAULT 'pending_start',
  ADD COLUMN IF NOT EXISTS planning_status text NOT NULL DEFAULT 'pending_path_assignment',
  ADD COLUMN IF NOT EXISTS financial_status text NOT NULL DEFAULT 'pending_first_payment',
  ADD COLUMN IF NOT EXISTS base_monthly_fee numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS one_way_percent_snapshot numeric(6,2),
  ADD COLUMN IF NOT EXISTS seat_reserved_until date,
  ADD COLUMN IF NOT EXISTS created_by_user_id integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT now();

ALTER TABLE transport_assignments ALTER COLUMN billing_frequency SET DEFAULT 'monthly';
UPDATE transport_assignments
SET service_state = CASE WHEN is_active THEN 'active' ELSE 'terminated' END,
    planning_status = CASE WHEN vehicle_id IS NULL THEN 'pending_path_assignment' ELSE 'assigned' END,
    base_monthly_fee = CASE WHEN base_monthly_fee = 0 THEN agreed_fee ELSE base_monthly_fee END,
    updated_at = COALESCE(updated_at, created_at, now())
WHERE service_state IN ('pending_start', '')
   OR planning_status IN ('pending_path_assignment', '')
   OR base_monthly_fee = 0
   OR updated_at IS NULL;

-- Existing charges: add service-period and immutable calculation metadata.
ALTER TABLE transport_charges
  ADD COLUMN IF NOT EXISTS vehicle_id integer,
  ADD COLUMN IF NOT EXISTS service_period_start date,
  ADD COLUMN IF NOT EXISTS service_period_end date,
  ADD COLUMN IF NOT EXISTS days_in_period integer,
  ADD COLUMN IF NOT EXISTS chargeable_days integer,
  ADD COLUMN IF NOT EXISTS calculation_type text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS calculation_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';

UPDATE transport_charges c
SET vehicle_id = COALESCE(c.vehicle_id, a.vehicle_id),
    service_period_start = COALESCE(c.service_period_start,
      CASE WHEN c.month BETWEEN 1 AND 12 THEN make_date(c.academic_year, c.month, 1) END),
    service_period_end = COALESCE(c.service_period_end,
      CASE WHEN c.month BETWEEN 1 AND 12 THEN (make_date(c.academic_year, c.month, 1) + interval '1 month - 1 day')::date END),
    days_in_period = COALESCE(c.days_in_period,
      CASE WHEN c.month BETWEEN 1 AND 12 THEN EXTRACT(day FROM (make_date(c.academic_year, c.month, 1) + interval '1 month - 1 day'))::integer END),
    chargeable_days = COALESCE(c.chargeable_days,
      CASE WHEN c.month BETWEEN 1 AND 12 THEN EXTRACT(day FROM (make_date(c.academic_year, c.month, 1) + interval '1 month - 1 day'))::integer END)
FROM transport_assignments a
WHERE a.id = c.assignment_id;

-- Existing payments: preserve all three legacy rows and add receipt security fields.
ALTER TABLE transport_payments
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS verification_token text,
  ADD COLUMN IF NOT EXISTS receipt_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'issued',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verified_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS verified_by_user_id integer,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS reconciled_by_user_id integer,
  ADD COLUMN IF NOT EXISTS replacement_payment_id integer;

ALTER TABLE transport_payment_allocations
  ADD COLUMN IF NOT EXISTS service_month integer,
  ADD COLUMN IF NOT EXISTS service_year integer,
  ADD COLUMN IF NOT EXISTS vehicle_id integer,
  ADD COLUMN IF NOT EXISTS claim_eligible_at timestamp without time zone;

UPDATE transport_payment_allocations pa
SET service_month = COALESCE(pa.service_month, c.month),
    service_year = COALESCE(pa.service_year, c.academic_year),
    vehicle_id = COALESCE(pa.vehicle_id, c.vehicle_id)
FROM transport_charges c
WHERE c.id = pa.charge_id;

-- Add the nullable security-token uniqueness rule without removing legacy payments.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transport_payments_verification_token_unique'
      AND conrelid = 'transport_payments'::regclass
  ) THEN
    ALTER TABLE transport_payments
      ADD CONSTRAINT transport_payments_verification_token_unique UNIQUE (verification_token);
  END IF;
END $$;

-- Enforce the already-preflighted one-active-assignment rule.
CREATE UNIQUE INDEX IF NOT EXISTS transport_assignments_active_student_uidx
  ON transport_assignments (school_id, student_id)
  WHERE is_active = true;

-- Add foreign keys for newly-added legacy columns when the referenced additive tables exist.
DO $$
DECLARE spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('transport_routes','created_by_user_id','users','transport_routes_created_by_user_id_users_id_fk'),
      ('transport_assignments','outbound_vehicle_id','transport_vehicles','transport_assignments_outbound_vehicle_id_transport_vehicles_id_fk'),
      ('transport_assignments','inbound_path_id','transport_vehicle_paths','transport_assignments_inbound_path_id_transport_vehicle_paths_id_fk'),
      ('transport_assignments','outbound_path_id','transport_vehicle_paths','transport_assignments_outbound_path_id_transport_vehicle_paths_id_fk'),
      ('transport_assignments','pickup_service_point_id','transport_service_points','transport_assignments_pickup_service_point_id_transport_service_points_id_fk'),
      ('transport_assignments','dropoff_service_point_id','transport_service_points','transport_assignments_dropoff_service_point_id_transport_service_points_id_fk'),
      ('transport_assignments','pickup_path_node_id','transport_path_nodes','transport_assignments_pickup_path_node_id_transport_path_nodes_id_fk'),
      ('transport_assignments','dropoff_path_node_id','transport_path_nodes','transport_assignments_dropoff_path_node_id_transport_path_nodes_id_fk'),
      ('transport_assignments','created_by_user_id','users','transport_assignments_created_by_user_id_users_id_fk'),
      ('transport_charges','vehicle_id','transport_vehicles','transport_charges_vehicle_id_transport_vehicles_id_fk'),
      ('transport_payments','verified_by_user_id','users','transport_payments_verified_by_user_id_users_id_fk'),
      ('transport_payments','reconciled_by_user_id','users','transport_payments_reconciled_by_user_id_users_id_fk'),
      ('transport_payment_allocations','vehicle_id','transport_vehicles','transport_payment_allocations_vehicle_id_transport_vehicles_id_fk')
    ) AS values_list(table_name, column_name, referenced_table, constraint_name)
  LOOP
    IF to_regclass(spec.table_name) IS NOT NULL
       AND to_regclass(spec.referenced_table) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
         WHERE c.contype = 'f'
           AND t.relname = spec.table_name
           AND a.attname = spec.column_name
       ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id)',
        spec.table_name, spec.constraint_name, spec.column_name, spec.referenced_table
      );
    END IF;
  END LOOP;
END $$;


-- Stage 2/3 Transport master-data backfills after the additive schema push.
-- Preserve the legacy contact person as the new alternative contact name.
UPDATE transport_owners
SET alternative_contact_name = contact_person,
    updated_at = COALESCE(updated_at, now())
WHERE alternative_contact_name IS NULL
  AND NULLIF(TRIM(contact_person), '') IS NOT NULL;

-- A linked staff record is the authoritative signal that this is a staff owner.
UPDATE transport_owners
SET is_staff_owner = true,
    updated_at = COALESCE(updated_at, now())
WHERE staff_id IS NOT NULL
  AND COALESCE(is_staff_owner, false) = false;

-- Remove the retired 60-day notification threshold while retaining the approved defaults.
UPDATE transport_settings
SET compliance_notification_days = '[30,14,7,1,0]'::jsonb,
    updated_at = COALESCE(updated_at, now())
WHERE compliance_notification_days IS NULL
   OR compliance_notification_days @> '[60]'::jsonb;

-- Existing incidents did not have immutable relationship snapshots. Capture their stored
-- foreign-key context without rewriting any historical selections.
UPDATE transport_incidents
SET actual_context = jsonb_strip_nulls(jsonb_build_object(
      'vehicleId', vehicle_id,
      'ownerId', owner_id,
      'driverId', driver_id,
      'routeId', route_id,
      'pathId', path_id,
      'pathTraversal', path_traversal
    )),
    expected_context = CASE
      WHEN expected_context IS NULL OR expected_context = '{}'::jsonb
      THEN jsonb_strip_nulls(jsonb_build_object(
        'vehicleId', vehicle_id,
        'ownerId', owner_id,
        'driverId', driver_id,
        'routeId', route_id,
        'pathId', path_id,
        'pathTraversal', path_traversal
      ))
      ELSE expected_context
    END
WHERE actual_context IS NULL OR actual_context = '{}'::jsonb;

COMMIT;
`;

const expectedColumns: Array<[string, string]> = [
  ["transport_routes", "status"],
  ["transport_vehicles", "status"],
  ["transport_assignments", "service_state"],
  ["transport_assignments", "planning_status"],
  ["transport_assignments", "financial_status"],
  ["transport_charges", "status"],
  ["transport_payments", "status"],
  ["transport_payments", "verification_status"],
  ["transport_payments", "verification_token"],
  ["transport_payment_allocations", "service_month"],
  ["transport_owners", "alternative_contact_name"],
  ["transport_owners", "is_staff_owner"],
  ["transport_owners", "staff_id"],
  ["transport_drivers", "owner_id"],
  ["transport_drivers", "home_address"],
  ["transport_drivers", "next_of_kin_name"],
  ["transport_vehicles", "registration_expiry"],
  ["transport_vehicles", "radio_licence_expiry"],
  ["transport_vehicle_paths", "is_two_way"],
  ["transport_path_nodes", "reverse_expected_time"],
  ["transport_incidents", "expected_context"],
  ["transport_incidents", "actual_context"],
];

async function main() {
  await client.connect();
  const dbInfo = await client.query<{ database: string; server: string; port: number }>(
    "select current_database() as database, inet_server_addr()::text as server, inet_server_port() as port",
  );
  console.log("\nFCGS Transport additive database repair");
  console.log(`Database: ${dbInfo.rows[0]?.database}`);
  console.log(`Server:   ${dbInfo.rows[0]?.server ?? "local socket"}:${dbInfo.rows[0]?.port ?? ""}`);
  console.log("Mode:     additive only (no DROP, DELETE or TRUNCATE)\n");

  await client.query(repairSql);

  const valuesSql = expectedColumns
    .map((_, index) => `($${index * 2 + 1}::text, $${index * 2 + 2}::text)`)
    .join(",");
  const params = expectedColumns.flat();
  const verification = await client.query<{ table_name: string; column_name: string; result: string }>(
    `WITH expected(table_name,column_name) AS (VALUES ${valuesSql})
     SELECT e.table_name, e.column_name,
       CASE WHEN c.column_name IS NULL THEN 'MISSING' ELSE 'OK' END AS result
     FROM expected e
     LEFT JOIN information_schema.columns c
       ON c.table_schema='public' AND c.table_name=e.table_name AND c.column_name=e.column_name
     ORDER BY e.table_name,e.column_name`,
    params,
  );

  console.table(verification.rows);
  const missing = verification.rows.filter((row) => row.result !== "OK");
  if (missing.length) {
    throw new Error(`Repair finished but ${missing.length} required column(s) are still missing.`);
  }

  console.log("\nRepair completed successfully. All required legacy Transport columns are present.");
  console.log("Restart the development server, then hard-refresh the Transport page.\n");
}

main()
  .catch((error) => {
    console.error("\nTransport repair failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => undefined);
  });
