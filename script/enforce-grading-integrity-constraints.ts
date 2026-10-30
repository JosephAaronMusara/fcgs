import "dotenv/config";
import { pool } from "../server/db";

const ACTIVE_PROFILE_KEYS = [
  "SEC_ZIM_A", "SEC_ZIM_O", "SEC_CAM_A", "SEC_CAM_O", "SEC_CAM_IGCSE",
  "PRI_ZIM_ECD", "PRI_ZIM_G12", "PRI_ZIM_G37",
  "PRI_CAM_ECD", "PRI_CAM_G12", "PRI_CAM_G37",
] as const;

async function scalar(client: any, query: string, params: any[] = []): Promise<number> {
  const result = await client.query(query, params);
  return Number(result.rows[0]?.count || 0);
}

async function main() {
  const client = await pool.connect();
  try {
    const checks = {
      dormantLegacyProfiles: await scalar(client, `SELECT count(*) FROM grades WHERE grade_level::text <> ALL($1::text[])`, [ACTIVE_PROFILE_KEYS]),
      missingStatus: await scalar(client, `SELECT count(*) FROM grades WHERE grade_status IS NULL OR upper(trim(grade_status)) NOT IN ('PASS','FAIL')`),
      missingPoints: await scalar(client, `SELECT count(*) FROM grades WHERE grade_points IS NULL`),
      missingRankOrder: await scalar(client, `SELECT count(*) FROM grades WHERE rank_order IS NULL OR rank_order <= 0`),
      missingSettings: await scalar(client, `
        SELECT count(*) FROM (
          SELECT DISTINCT school_id, grade_level FROM grades WHERE grade_level::text = ANY($1::text[])
          EXCEPT
          SELECT school_id, grade_level FROM grade_profile_settings
        ) missing
      `, [ACTIVE_PROFILE_KEYS]),
      duplicateRankOrders: await scalar(client, `
        SELECT count(*) FROM (
          SELECT school_id, grade_level, COALESCE(grade_type::text, ''), rank_order
          FROM grades
          GROUP BY school_id, grade_level, COALESCE(grade_type::text, ''), rank_order
          HAVING count(*) > 1
        ) duplicates
      `),
      invalidCoveragePoints: await scalar(client, `
        WITH grade_groups AS (
          SELECT DISTINCT school_id, grade_level, COALESCE(grade_type::text, '') AS grade_type
          FROM grades
          WHERE grade_level::text = ANY($1::text[])
        ), coverage AS (
          SELECT gg.school_id, gg.grade_level, gg.grade_type, percentage, count(g.id) AS matches
          FROM grade_groups gg
          CROSS JOIN generate_series(0, 100) AS p(percentage)
          LEFT JOIN grades g
            ON g.school_id = gg.school_id
           AND g.grade_level = gg.grade_level
           AND COALESCE(g.grade_type::text, '') = gg.grade_type
           AND percentage BETWEEN g.lower_limit AND g.upper_limit
          GROUP BY gg.school_id, gg.grade_level, gg.grade_type, percentage
        )
        SELECT count(*) FROM coverage WHERE matches <> 1
      `, [ACTIVE_PROFILE_KEYS]),
    };
    const { dormantLegacyProfiles, ...blockingChecks } = checks;
    const blocking = Object.values(blockingChecks).reduce((sum, count) => sum + count, 0);
    if (blocking > 0) {
      console.error(JSON.stringify({ applied: false, checks, message: "Grading integrity constraints were not applied. Repair every reported row and configure every active profile first." }, null, 2));
      process.exitCode = 2;
      return;
    }

    await client.query("BEGIN");
    for (const name of [
      "grades_grade_status_required_chk",
      "grades_grade_points_required_chk",
      "grades_rank_order_required_chk",
    ]) {
      await client.query(`ALTER TABLE grades VALIDATE CONSTRAINT ${name}`);
    }
    await client.query(`ALTER TABLE grade_profile_settings VALIDATE CONSTRAINT grade_profile_settings_exact_profile_chk`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS grades_profile_type_rank_uidx
      ON grades (school_id, grade_level, COALESCE(grade_type::text, ''), rank_order)
    `);
    await client.query(`ALTER TABLE grades ALTER COLUMN grade_status SET NOT NULL`);
    await client.query(`ALTER TABLE grades ALTER COLUMN grade_points SET NOT NULL`);
    await client.query(`ALTER TABLE grades ALTER COLUMN rank_order SET NOT NULL`);
    await client.query("COMMIT");
    console.log(JSON.stringify({ applied: true, checks, changes: ["validated grade status/points/rank checks", "preserved the exact-profile check as NOT VALID so dormant legacy rows can remain", "grade_status NOT NULL", "grade_points NOT NULL", "rank_order NOT NULL"] }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
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
