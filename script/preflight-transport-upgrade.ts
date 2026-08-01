import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { RBAC_PERMISSIONS_DATA } from "../server/rbac-config";

type CheckResult = {
  name: string;
  severity: "error" | "warning" | "info";
  count: number;
  details?: unknown[];
};

const postSchema = process.argv.includes("--post-schema");

const requiredPostSchemaTables = [
  "transport_driver_owner_history",
  "transport_document_requirements",
  "transport_documents",
  "transport_compliance_overrides",
  "transport_compliance_notification_log",
];

const requiredPostSchemaColumns: Array<[string, string]> = [
  ["transport_owners", "email"],
  ["transport_owners", "address"],
  ["transport_owners", "alternative_contact_name"],
  ["transport_owners", "alternative_contact_phone"],
  ["transport_owners", "alternative_contact_email"],
  ["transport_owners", "alternative_contact_relationship"],
  ["transport_owners", "is_staff_owner"],
  ["transport_owners", "staff_id"],
  ["transport_drivers", "owner_id"],
  ["transport_drivers", "home_address"],
  ["transport_drivers", "photo"],
  ["transport_drivers", "next_of_kin_name"],
  ["transport_drivers", "compliance_status"],
  ["transport_vehicles", "registration_expiry"],
  ["transport_vehicles", "radio_licence_expiry"],
  ["transport_vehicles", "primary_image"],
  ["transport_vehicles", "compliance_status"],
  ["transport_settings", "attachment_size_limit_mb"],
  ["transport_settings", "compliance_notification_days"],
  ["transport_vehicle_paths", "is_two_way"],
  ["transport_vehicle_paths", "canonical_traversal"],
  ["transport_path_nodes", "reverse_expected_time"],
  ["transport_assignments", "inbound_path_traversal"],
  ["transport_assignments", "outbound_path_traversal"],
  ["transport_incidents", "owner_id"],
  ["transport_incidents", "path_traversal"],
  ["transport_incidents", "assignment_override"],
  ["transport_incidents", "expected_context"],
  ["transport_incidents", "actual_context"],
];

const requiredPermissions = RBAC_PERMISSIONS_DATA
  .filter((permission) => permission.code.startsWith("transport.documents.") || permission.code.startsWith("transport.compliance."))
  .map((permission) => permission.code);

async function tableExists(tableName: string): Promise<boolean> {
  const result = await db.execute(sql`select to_regclass(${`public.${tableName}`}) as table_name`);
  return Boolean(result.rows[0]?.table_name);
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const result = await db.execute(sql`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = ${tableName} and column_name = ${columnName}
    ) as exists
  `);
  return Boolean(result.rows[0]?.exists);
}

async function addQueryCheck(
  checks: CheckResult[],
  name: string,
  severity: CheckResult["severity"],
  query: ReturnType<typeof sql>,
): Promise<void> {
  const result = await db.execute(query);
  checks.push({ name, severity, count: result.rows.length, details: result.rows.slice(0, 50) });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Run through dotenv, for example: npx dotenv -e .env -- npm run transport:preflight");
  }

  const checks: CheckResult[] = [];

  if (await tableExists("transport_assignments")) {
    await addQueryCheck(checks, "Duplicate active learner assignments", "error", sql`
      select school_id as "schoolId", student_id as "studentId", count(*)::int as count,
             array_agg(id order by start_date desc, id desc) as "assignmentIds"
      from transport_assignments
      where is_active = true
      group by school_id, student_id
      having count(*) > 1
      order by school_id, student_id
    `);
  }

  if (await tableExists("transport_vehicles")) {
    await addQueryCheck(checks, "Duplicate active vehicle registrations within a school", "error", sql`
      select school_id as "schoolId", upper(trim(registration_number)) as "registrationNumber",
             count(*)::int as count, array_agg(id order by id) as "vehicleIds"
      from transport_vehicles
      where coalesce(is_active, true) = true
      group by school_id, upper(trim(registration_number))
      having count(*) > 1
      order by school_id, upper(trim(registration_number))
    `);

    if (await columnExists("transport_vehicles", "ownership_type") && await columnExists("transport_owners", "is_staff_owner")) {
      await addQueryCheck(checks, "Staff-owned vehicles linked to non-staff owners", "error", sql`
        select vehicles.id as "vehicleId", vehicles.registration_number as "registrationNumber", vehicles.owner_id as "ownerId"
        from transport_vehicles vehicles
        left join transport_owners owners on owners.id = vehicles.owner_id
        where vehicles.ownership_type = 'staff'
          and (vehicles.owner_id is null or coalesce(owners.is_staff_owner, false) = false)
      `);
      await addQueryCheck(checks, "Contracted vehicles linked to staff owners", "error", sql`
        select vehicles.id as "vehicleId", vehicles.registration_number as "registrationNumber", vehicles.owner_id as "ownerId"
        from transport_vehicles vehicles
        join transport_owners owners on owners.id = vehicles.owner_id
        where vehicles.ownership_type = 'contracted'
          and owners.is_staff_owner = true
      `);
      await addQueryCheck(checks, "School-owned vehicles with external owners", "error", sql`
        select id as "vehicleId", registration_number as "registrationNumber", owner_id as "ownerId"
        from transport_vehicles
        where ownership_type = 'school' and owner_id is not null
      `);
    }

    if (await columnExists("transport_drivers", "owner_id")) {
      await addQueryCheck(checks, "Vehicle and external-driver owner mismatches", "error", sql`
        select vehicles.id as "vehicleId", vehicles.registration_number as "registrationNumber",
               vehicles.owner_id as "vehicleOwnerId", drivers.id as "driverId", drivers.owner_id as "driverOwnerId"
        from transport_vehicles vehicles
        join transport_drivers drivers on drivers.id = vehicles.driver_id
        where drivers.engagement_type <> 'internal'
          and vehicles.owner_id is distinct from drivers.owner_id
      `);
    }
  }

  if (await tableExists("transport_owners") && await columnExists("transport_owners", "staff_id")) {
    await addQueryCheck(checks, "Duplicate staff-owner records within a school", "error", sql`
      select school_id as "schoolId", staff_id as "staffId", count(*)::int as count,
             array_agg(id order by id) as "ownerIds"
      from transport_owners
      where staff_id is not null
      group by school_id, staff_id
      having count(*) > 1
    `);
    await addQueryCheck(checks, "Staff-owner flags without staff linkage", "warning", sql`
      select id as "ownerId", school_id as "schoolId", name
      from transport_owners
      where is_staff_owner = true and staff_id is null
    `);
  }

  if (await tableExists("transport_drivers") && await columnExists("transport_drivers", "owner_id")) {
    await addQueryCheck(checks, "External drivers without an owner/employer", "warning", sql`
      select id as "driverId", school_id as "schoolId", first_name as "firstName", last_name as "lastName"
      from transport_drivers
      where engagement_type <> 'internal' and owner_id is null and coalesce(is_active, true) = true
    `);
  }

  if (await tableExists("transport_payments")) {
    const tokenColumn = await columnExists("transport_payments", "verification_token");
    const snapshotColumn = await columnExists("transport_payments", "receipt_snapshot");
    if (tokenColumn) {
      const missingTokens = await db.execute(sql`select count(*)::int as count from transport_payments where verification_token is null`);
      checks.push({ name: "Legacy receipts awaiting security-token minting", severity: "info", count: Number(missingTokens.rows[0]?.count ?? 0) });
    }
    if (snapshotColumn) {
      const missingSnapshots = await db.execute(sql`select count(*)::int as count from transport_payments where receipt_snapshot is null or receipt_snapshot = '{}'::jsonb`);
      checks.push({ name: "Legacy receipts awaiting immutable snapshot minting", severity: "info", count: Number(missingSnapshots.rows[0]?.count ?? 0) });
    }
  }

  if (await tableExists("transport_claim_allocations")) {
    await addQueryCheck(checks, "Receipt allocations included in more than one claim", "error", sql`
      select allocation_id as "allocationId", count(*)::int as count, array_agg(claim_id order by claim_id) as "claimIds"
      from transport_claim_allocations
      group by allocation_id
      having count(*) > 1
    `);
  }

  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  const missingPermissions: string[] = [];
  if (postSchema) {
    for (const tableName of requiredPostSchemaTables) {
      if (!(await tableExists(tableName))) missingTables.push(tableName);
    }
    for (const [tableName, columnName] of requiredPostSchemaColumns) {
      if (!(await columnExists(tableName, columnName))) missingColumns.push(`${tableName}.${columnName}`);
    }
    if (await tableExists("permissions")) {
      const rows = await db.execute(sql`select code from permissions where code like 'transport.documents.%' or code like 'transport.compliance.%'`);
      const present = new Set((rows.rows as Array<{ code: string }>).map((row) => row.code));
      missingPermissions.push(...requiredPermissions.filter((permission) => !present.has(permission)));
    } else {
      missingPermissions.push(...requiredPermissions);
    }
  }

  console.log(`\nFCGS Transport upgrade preflight (${postSchema ? "post-schema" : "legacy-data"})\n`);
  for (const check of checks) {
    const marker = check.count === 0
      ? "PASS"
      : check.severity === "error"
        ? "FAIL"
        : check.severity === "warning"
          ? "WARN"
          : "INFO";
    console.log(`[${marker}] ${check.name}: ${check.count}`);
    if (check.details?.length) console.table(check.details);
  }
  if (postSchema) {
    console.log(`[${missingTables.length ? "FAIL" : "PASS"}] Missing required tables: ${missingTables.length}`);
    if (missingTables.length) console.log(missingTables.join(", "));
    console.log(`[${missingColumns.length ? "FAIL" : "PASS"}] Missing required columns: ${missingColumns.length}`);
    if (missingColumns.length) console.log(missingColumns.join(", "));
    console.log(`[${missingPermissions.length ? "FAIL" : "PASS"}] Missing required permissions: ${missingPermissions.length}`);
    if (missingPermissions.length) console.log(missingPermissions.join(", "));
  }

  const blockers = checks.filter((check) => check.severity === "error" && check.count > 0);
  if (blockers.length || missingTables.length || missingColumns.length || missingPermissions.length) {
    console.error("\nPreflight failed. Resolve blocking records or missing schema/permission items before deployment.");
    process.exitCode = 1;
  } else {
    console.log("\nPreflight passed. No blocking Transport conditions were found.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
