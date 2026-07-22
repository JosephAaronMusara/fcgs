import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";

type CheckResult = {
  name: string;
  severity: "error" | "warning" | "info";
  count: number;
  details?: unknown[];
};

async function tableExists(tableName: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) AS table_name`);
  return Boolean(result.rows[0]?.table_name);
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=${tableName} AND column_name=${columnName}
    ) AS exists
  `);
  return Boolean(result.rows[0]?.exists);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required. Run through dotenv, for example: npx dotenv -e .env -- npm run transport:preflight");

  const checks: CheckResult[] = [];

  if (await tableExists("transport_assignments")) {
    const duplicates = await db.execute(sql`
      SELECT school_id AS "schoolId", student_id AS "studentId", COUNT(*)::int AS count,
             ARRAY_AGG(id ORDER BY start_date DESC, id DESC) AS "assignmentIds"
      FROM transport_assignments
      WHERE is_active=true
      GROUP BY school_id, student_id
      HAVING COUNT(*) > 1
      ORDER BY school_id, student_id
    `);
    checks.push({
      name: "Duplicate active learner assignments",
      severity: "error",
      count: duplicates.rows.length,
      details: duplicates.rows.slice(0, 50),
    });
  }

  if (await tableExists("transport_vehicles")) {
    const duplicates = await db.execute(sql`
      SELECT school_id AS "schoolId", UPPER(TRIM(registration_number)) AS "registrationNumber",
             COUNT(*)::int AS count, ARRAY_AGG(id ORDER BY id) AS "vehicleIds"
      FROM transport_vehicles
      WHERE COALESCE(is_active,true)=true
      GROUP BY school_id, UPPER(TRIM(registration_number))
      HAVING COUNT(*) > 1
      ORDER BY school_id, UPPER(TRIM(registration_number))
    `);
    checks.push({
      name: "Duplicate active vehicle registrations within a school",
      severity: "warning",
      count: duplicates.rows.length,
      details: duplicates.rows.slice(0, 50),
    });
  }

  if (await tableExists("transport_payments")) {
    const tokenColumn = await columnExists("transport_payments", "verification_token");
    const snapshotColumn = await columnExists("transport_payments", "receipt_snapshot");
    if (tokenColumn) {
      const missingTokens = await db.execute(sql`SELECT COUNT(*)::int AS count FROM transport_payments WHERE verification_token IS NULL`);
      checks.push({ name: "Legacy receipts awaiting security-token minting", severity: "info", count: Number(missingTokens.rows[0]?.count ?? 0) });
    }
    if (snapshotColumn) {
      const missingSnapshots = await db.execute(sql`SELECT COUNT(*)::int AS count FROM transport_payments WHERE receipt_snapshot IS NULL OR receipt_snapshot='{}'::jsonb`);
      checks.push({ name: "Legacy receipts awaiting immutable snapshot minting", severity: "info", count: Number(missingSnapshots.rows[0]?.count ?? 0) });
    }
  }

  if (await tableExists("transport_claim_allocations")) {
    const duplicateAllocations = await db.execute(sql`
      SELECT allocation_id AS "allocationId", COUNT(*)::int AS count, ARRAY_AGG(claim_id ORDER BY claim_id) AS "claimIds"
      FROM transport_claim_allocations
      GROUP BY allocation_id
      HAVING COUNT(*) > 1
    `);
    checks.push({ name: "Receipt allocations included in more than one claim", severity: "error", count: duplicateAllocations.rows.length, details: duplicateAllocations.rows.slice(0, 50) });
  }

  console.log("\nFCGS Transport upgrade preflight\n");
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

  const blockers = checks.filter((check) => check.severity === "error" && check.count > 0);
  if (blockers.length) {
    console.error("\nPreflight failed. Resolve blocking records before running db:push.");
    process.exitCode = 1;
  } else {
    console.log("\nPreflight passed. No blocking legacy Transport records were found.");
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
