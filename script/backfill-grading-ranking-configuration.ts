import "dotenv/config";
import { pool } from "../server/db";
import { GRADE_PROFILE_KEYS } from "../shared/academic-profiles";

const APPLY = process.argv.includes("--apply");
const ACTIVE = new Set<string>(GRADE_PROFILE_KEYS as readonly string[]);

type GradeRow = {
  id: number;
  school_id: number;
  grade_name: string;
  grade_level: string;
  grade_type: string | null;
  lower_limit: number;
  upper_limit: number;
  grade_points: string | number | null;
  grade_status: string | null;
  rank_order: number | null;
};

type SettingRow = {
  school_id: number;
  grade_level: string;
  points_direction: "higher_is_better" | "lower_is_better";
};

function expectedDirection(profileKey: string): "higher_is_better" | "lower_is_better" {
  return profileKey.startsWith("PRI_ZIM_") ? "lower_is_better" : "higher_is_better";
}

function keyForGradeGroup(row: GradeRow): string {
  return `${Number(row.school_id)}|${String(row.grade_level)}|${String(row.grade_type || "")}`;
}

async function main() {
  const client = await pool.connect();
  try {
    const [gradesResult, settingsResult] = await Promise.all([
      client.query<GradeRow>(`
        SELECT id, school_id, grade_name, grade_level::text AS grade_level,
               grade_type::text AS grade_type, lower_limit, upper_limit,
               grade_points, grade_status, rank_order
        FROM grades
        ORDER BY school_id, grade_level::text, grade_type::text NULLS FIRST,
                 upper_limit DESC, lower_limit DESC, id
      `),
      client.query<SettingRow>(`
        SELECT school_id, grade_level::text AS grade_level, points_direction::text AS points_direction
        FROM grade_profile_settings
        ORDER BY school_id, grade_level::text
      `),
    ]);

    const grades = gradesResult.rows;
    const settings = settingsResult.rows;
    const settingByKey = new Map(settings.map((row) => [`${Number(row.school_id)}|${row.grade_level}`, row]));

    const activeSchoolProfiles = Array.from(new Set(
      grades
        .filter((row) => ACTIVE.has(row.grade_level))
        .map((row) => `${Number(row.school_id)}|${row.grade_level}`),
    )).sort();

    const settingsToInsert = activeSchoolProfiles
      .filter((key) => !settingByKey.has(key))
      .map((key) => {
        const [schoolId, profileKey] = key.split("|");
        return {
          schoolId: Number(schoolId),
          profileKey,
          pointsDirection: expectedDirection(profileKey),
        };
      });

    const existingDirectionOverrides = activeSchoolProfiles
      .map((key) => {
        const row = settingByKey.get(key);
        if (!row) return null;
        const [schoolId, profileKey] = key.split("|");
        const policyDirection = expectedDirection(profileKey);
        return row.points_direction === policyDirection ? null : {
          schoolId: Number(schoolId),
          profileKey,
          existingDirection: row.points_direction,
          policyDirection,
          action: "preserved_existing_value",
        };
      })
      .filter(Boolean);

    const groups = new Map<string, GradeRow[]>();
    for (const grade of grades) {
      const key = keyForGradeGroup(grade);
      const rows = groups.get(key) || [];
      rows.push(grade);
      groups.set(key, rows);
    }

    const rankConflicts: Array<Record<string, unknown>> = [];
    const invalidRanges: Array<Record<string, unknown>> = [];
    const rankUpdates: Array<{ gradeId: number; schoolId: number; profileKey: string; gradeType: string | null; gradeName: string; expectedRankOrder: number }> = [];

    for (const [key, rows] of groups) {
      const sorted = [...rows].sort((a, b) =>
        Number(b.upper_limit) - Number(a.upper_limit)
        || Number(b.lower_limit) - Number(a.lower_limit)
        || Number(a.id) - Number(b.id),
      );
      for (let index = 0; index < sorted.length; index++) {
        const row = sorted[index];
        const lower = Number(row.lower_limit);
        const upper = Number(row.upper_limit);
        if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
          invalidRanges.push({ key, gradeId: Number(row.id), gradeName: row.grade_name, lower, upper });
          continue;
        }
        if (index > 0) {
          const previous = sorted[index - 1];
          if (Number(previous.lower_limit) <= upper) {
            invalidRanges.push({
              key,
              gradeIds: [Number(previous.id), Number(row.id)],
              gradeNames: [previous.grade_name, row.grade_name],
              reason: "overlapping_or_duplicate_performance_bands",
            });
          }
        }
        const expectedRankOrder = index + 1;
        const existing = Number(row.rank_order);
        if (Number.isInteger(existing) && existing > 0 && existing !== expectedRankOrder) {
          rankConflicts.push({
            key,
            gradeId: Number(row.id),
            gradeName: row.grade_name,
            existingRankOrder: existing,
            expectedRankOrder,
          });
        } else if (!Number.isInteger(existing) || existing <= 0) {
          rankUpdates.push({
            gradeId: Number(row.id),
            schoolId: Number(row.school_id),
            profileKey: row.grade_level,
            gradeType: row.grade_type,
            gradeName: row.grade_name,
            expectedRankOrder,
          });
        }
      }
    }

    const safeToApply = rankConflicts.length === 0 && invalidRanges.length === 0;
    const preview = {
      mode: APPLY ? "APPLY" : "PREVIEW",
      policy: {
        pointsDirection: {
          zimsecPrimary: "lower_is_better",
          allOtherActiveProfiles: "higher_is_better",
          existingConfiguredValues: "preserved",
        },
        rankOrder: "highest percentage band is rank 1, descending to the lowest band",
      },
      summary: {
        gradeRowsExamined: grades.length,
        activeSchoolProfiles: activeSchoolProfiles.length,
        profileSettingsToInsert: settingsToInsert.length,
        existingDirectionOverrides: existingDirectionOverrides.length,
        rankOrdersToBackfill: rankUpdates.length,
        dormantLegacyRankOrdersToBackfill: rankUpdates.filter((row) => !ACTIVE.has(row.profileKey)).length,
        rankConflicts: rankConflicts.length,
        invalidRangeGroups: invalidRanges.length,
        safeToApply,
      },
      profileSettingsToInsert: settingsToInsert,
      existingDirectionOverrides,
      rankOrderExamples: rankUpdates.slice(0, 200),
      rankConflicts: rankConflicts.slice(0, 200),
      invalidRanges: invalidRanges.slice(0, 200),
    };

    if (!APPLY) {
      console.log(JSON.stringify({ ...preview, next: safeToApply ? "Run the apply command after reviewing this preview." : "Resolve the reported conflicts before applying." }, null, 2));
      return;
    }

    if (!safeToApply) {
      console.error(JSON.stringify({ ...preview, applied: false, message: "No rows were changed because rank-order derivation was not unambiguous." }, null, 2));
      process.exitCode = 2;
      return;
    }

    const gradeById = new Map(grades.map((row) => [Number(row.id), row]));
    const requestedConstraintRelaxations = new Set<string>();
    if (rankUpdates.some((row) => !ACTIVE.has(row.profileKey))) {
      requestedConstraintRelaxations.add("grades_exact_profile_required_chk");
    }
    if (rankUpdates.some((row) => gradeById.get(row.gradeId)?.grade_points === null || gradeById.get(row.gradeId)?.grade_points === undefined)) {
      requestedConstraintRelaxations.add("grades_grade_points_required_chk");
    }
    if (rankUpdates.some((row) => !["PASS", "FAIL"].includes(String(gradeById.get(row.gradeId)?.grade_status || "").trim().toUpperCase()))) {
      requestedConstraintRelaxations.add("grades_grade_status_required_chk");
    }
    const existingConstraints = requestedConstraintRelaxations.size
      ? await client.query<{ conname: string }>(`
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'grades'::regclass
            AND conname = ANY($1::text[])
        `, [Array.from(requestedConstraintRelaxations)])
      : { rows: [] as Array<{ conname: string }> };
    const constraintsToRelax = existingConstraints.rows.map((row) => row.conname);

    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('fcgs_grading_ranking_configuration_backfill'))`);

    // NOT VALID checks still apply to rows being updated. Temporarily remove only
    // checks violated by existing data, fill rank order, then restore every check in
    // the same transaction. A failure rolls the DDL and data changes back together.
    for (const constraintName of constraintsToRelax) {
      await client.query(`ALTER TABLE grades DROP CONSTRAINT ${constraintName}`);
    }

    let insertedSettings = 0;
    for (const row of settingsToInsert) {
      const result = await client.query(`
        INSERT INTO grade_profile_settings (school_id, grade_level, points_direction, configuration_version, created_at, updated_at)
        VALUES ($1, $2::grade_level, $3::grade_points_direction, 1, now(), now())
        ON CONFLICT (school_id, grade_level) DO NOTHING
      `, [row.schoolId, row.profileKey, row.pointsDirection]);
      insertedSettings += result.rowCount || 0;
    }

    let updatedRanks = 0;
    const CHUNK_SIZE = 1000;
    for (let offset = 0; offset < rankUpdates.length; offset += CHUNK_SIZE) {
      const chunk = rankUpdates.slice(offset, offset + CHUNK_SIZE);
      if (!chunk.length) continue;
      const values: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((row, index) => {
        const base = index * 2;
        values.push(`($${base + 1}::integer, $${base + 2}::integer)`);
        params.push(row.gradeId, row.expectedRankOrder);
      });
      const result = await client.query(`
        UPDATE grades AS g
        SET rank_order = updates.rank_order
        FROM (VALUES ${values.join(",")}) AS updates(id, rank_order)
        WHERE g.id = updates.id
          AND (g.rank_order IS NULL OR g.rank_order <= 0)
      `, params);
      updatedRanks += result.rowCount || 0;
    }

    const remaining = await client.query(`
      SELECT
        (SELECT count(*)::int FROM grades WHERE rank_order IS NULL OR rank_order <= 0) AS missing_rank_orders,
        (SELECT count(*)::int FROM (
          SELECT DISTINCT school_id, grade_level
          FROM grades
          WHERE grade_level::text = ANY($1::text[])
          EXCEPT
          SELECT school_id, grade_level FROM grade_profile_settings
        ) missing) AS missing_profile_settings
    `, [Array.from(ACTIVE)]);

    const activeKeys = Array.from(ACTIVE).map((key) => `'${key.replace(/'/g, "''")}'`).join(", ");
    const constraintDefinitions: Record<string, string> = {
      grades_exact_profile_required_chk: `CHECK (grade_level::text IN (${activeKeys})) NOT VALID`,
      grades_grade_points_required_chk: `CHECK (grade_points IS NOT NULL) NOT VALID`,
      grades_grade_status_required_chk: `CHECK (grade_status IS NOT NULL AND upper(trim(grade_status)) IN ('PASS', 'FAIL')) NOT VALID`,
    };
    for (const constraintName of constraintsToRelax) {
      await client.query(`ALTER TABLE grades ADD CONSTRAINT ${constraintName} ${constraintDefinitions[constraintName]}`);
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({
      ...preview,
      applied: true,
      changes: {
        insertedProfileSettings: insertedSettings,
        updatedRankOrders: updatedRanks,
        constraintsTemporarilyRelaxedAndRestored: constraintsToRelax,
      },
      remaining: remaining.rows[0],
      next: "Run grades:integrity:audit, then preview the stored-grade-link repair.",
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
