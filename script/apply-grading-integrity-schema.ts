import "dotenv/config";
import { pool } from "../server/db";

const ACTIVE_PROFILE_KEYS = [
  "SEC_ZIM_A", "SEC_ZIM_O", "SEC_CAM_A", "SEC_CAM_O", "SEC_CAM_IGCSE",
  "PRI_ZIM_ECD", "PRI_ZIM_G12", "PRI_ZIM_G37",
  "PRI_CAM_ECD", "PRI_CAM_G12", "PRI_CAM_G37",
] as const;

async function addConstraintIfMissing(client: any, name: string, definition: string) {
  const result = await client.query(`SELECT 1 FROM pg_constraint WHERE conname = $1 LIMIT 1`, [name]);
  if (!result.rowCount) await client.query(`ALTER TABLE grades ADD CONSTRAINT ${name} ${definition} NOT VALID`);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE grade_points_direction AS ENUM ('higher_is_better', 'lower_is_better');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await client.query(`ALTER TABLE grades ADD COLUMN IF NOT EXISTS rank_order integer`);
    await client.query(`ALTER TABLE grades ALTER COLUMN grade_points TYPE numeric(6,2) USING grade_points::numeric(6,2)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS grade_profile_settings (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        school_id integer NOT NULL REFERENCES schools(id),
        grade_level grade_level NOT NULL,
        points_direction grade_points_direction NOT NULL,
        configuration_version integer NOT NULL DEFAULT 1,
        updated_by_user_id integer REFERENCES users(id),
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS grade_profile_settings_school_profile_uidx
      ON grade_profile_settings (school_id, grade_level)
    `);

    await addConstraintIfMissing(client, "grades_grade_status_required_chk", `CHECK (grade_status IS NOT NULL AND upper(trim(grade_status)) IN ('PASS', 'FAIL'))`);
    await addConstraintIfMissing(client, "grades_grade_points_required_chk", `CHECK (grade_points IS NOT NULL)`);
    await addConstraintIfMissing(client, "grades_rank_order_required_chk", `CHECK (rank_order IS NOT NULL AND rank_order > 0)`);
    await addConstraintIfMissing(client, "grades_exact_profile_required_chk", `CHECK (grade_level::text IN (${ACTIVE_PROFILE_KEYS.map((key) => `'${key}'`).join(", ")}))`);
    const profileSettingConstraint = await client.query(`SELECT 1 FROM pg_constraint WHERE conname = 'grade_profile_settings_exact_profile_chk' LIMIT 1`);
    if (!profileSettingConstraint.rowCount) {
      await client.query(`ALTER TABLE grade_profile_settings ADD CONSTRAINT grade_profile_settings_exact_profile_chk CHECK (grade_level::text IN (${ACTIVE_PROFILE_KEYS.map((key) => `'${key}'`).join(", ")})) NOT VALID`);
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({
      applied: true,
      changes: [
        "grade_points_direction enum",
        "grade_profile_settings table and unique index",
        "grades.rank_order column",
        "grades.grade_points numeric(6,2)",
        "NOT VALID integrity constraints that protect new and updated rows",
      ],
      next: "Run grades:integrity:audit. Configure and repair every reported issue before running grades:integrity:constraints.",
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
