import "dotenv/config";
import { pool } from "../server/db";

type DuplicateKind =
  | "principal_pool"
  | "class_teacher_pool"
  | "principal_legacy_pool"
  | "class_teacher_legacy_pool"
  | "report_card_override";

type DuplicateGroup = {
  kind: DuplicateKind;
  schoolId: number;
  gradeId?: number | null;
  gradeLevel?: string | null;
  classId?: number | null;
  commentType?: string;
  commentGrade?: string;
  ids: number[];
  canonicalId: number;
};

const OVERRIDE_PREFIX = "__REPORT_CARD_OVERRIDE__";

function numberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (typeof value !== "string") return [];
  return value
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .split(",")
    .map(Number)
    .filter(Number.isFinite);
}

const UNIQUE_GRADE_CANDIDATES_CTE = `
  WITH unique_grade_candidates AS (
    SELECT rc.id AS report_comment_id,
           MIN(g.id) AS grade_id
    FROM report_comments rc
    JOIN grades g
      ON g.school_id = rc.school_id
     AND g.grade_name = rc.comment_grade
     AND g.grade_level::text IS NOT DISTINCT FROM rc.grade_level::text
    WHERE rc.grade_id IS NULL
      AND rc.comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
    GROUP BY rc.id
    HAVING COUNT(*) = 1
  )
`;

async function loadNormalizableLegacyRows(client: any) {
  const result = await client.query(`
    ${UNIQUE_GRADE_CANDIDATES_CTE}
    SELECT rc.id,
           rc.school_id,
           rc.comment_type,
           rc.class_id,
           rc.comment_grade,
           rc.grade_level,
           ugc.grade_id
    FROM report_comments rc
    JOIN unique_grade_candidates ugc ON ugc.report_comment_id = rc.id
    ORDER BY rc.school_id, rc.id
  `);
  return result.rows.map((row: any) => ({
    id: Number(row.id),
    schoolId: Number(row.school_id),
    commentType: String(row.comment_type),
    classId: row.class_id === null ? null : Number(row.class_id),
    commentGrade: String(row.comment_grade),
    gradeLevel: row.grade_level || null,
    gradeId: Number(row.grade_id),
  }));
}

async function normalizeLegacyRows(client: any): Promise<number> {
  const result = await client.query(`
    ${UNIQUE_GRADE_CANDIDATES_CTE}
    UPDATE report_comments rc
       SET grade_id = ugc.grade_id
      FROM unique_grade_candidates ugc
     WHERE rc.id = ugc.report_comment_id
       AND rc.grade_id IS NULL
    RETURNING rc.id
  `);
  return result.rowCount || 0;
}

async function loadDuplicateGroups(client: any): Promise<DuplicateGroup[]> {
  const principal = await client.query(`
    ${UNIQUE_GRADE_CANDIDATES_CTE}
    SELECT rc.school_id,
           COALESCE(rc.grade_id, ugc.grade_id) AS grade_id,
           array_agg(rc.id ORDER BY rc.id DESC) AS ids
    FROM report_comments rc
    LEFT JOIN unique_grade_candidates ugc ON ugc.report_comment_id = rc.id
    WHERE rc.comment_type = 'principal'
      AND COALESCE(rc.grade_id, ugc.grade_id) IS NOT NULL
      AND rc.class_id IS NULL
      AND rc.comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
    GROUP BY rc.school_id, COALESCE(rc.grade_id, ugc.grade_id)
    HAVING COUNT(*) > 1
    ORDER BY rc.school_id, COALESCE(rc.grade_id, ugc.grade_id)
  `);

  const classTeacher = await client.query(`
    ${UNIQUE_GRADE_CANDIDATES_CTE}
    SELECT rc.school_id,
           rc.class_id,
           COALESCE(rc.grade_id, ugc.grade_id) AS grade_id,
           array_agg(rc.id ORDER BY rc.id DESC) AS ids
    FROM report_comments rc
    LEFT JOIN unique_grade_candidates ugc ON ugc.report_comment_id = rc.id
    WHERE rc.comment_type = 'class_teacher'
      AND COALESCE(rc.grade_id, ugc.grade_id) IS NOT NULL
      AND rc.class_id IS NOT NULL
      AND rc.comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
    GROUP BY rc.school_id, rc.class_id, COALESCE(rc.grade_id, ugc.grade_id)
    HAVING COUNT(*) > 1
    ORDER BY rc.school_id, rc.class_id, COALESCE(rc.grade_id, ugc.grade_id)
  `);

  const principalLegacy = await client.query(`
    ${UNIQUE_GRADE_CANDIDATES_CTE}
    SELECT rc.school_id,
           rc.comment_grade,
           rc.grade_level::text AS grade_level,
           array_agg(rc.id ORDER BY rc.id DESC) AS ids
    FROM report_comments rc
    LEFT JOIN unique_grade_candidates ugc ON ugc.report_comment_id = rc.id
    WHERE rc.comment_type = 'principal'
      AND rc.grade_id IS NULL
      AND ugc.grade_id IS NULL
      AND rc.class_id IS NULL
      AND rc.comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
    GROUP BY rc.school_id, rc.comment_grade, rc.grade_level::text
    HAVING COUNT(*) > 1
    ORDER BY rc.school_id, rc.comment_grade, rc.grade_level::text
  `);

  const classTeacherLegacy = await client.query(`
    ${UNIQUE_GRADE_CANDIDATES_CTE}
    SELECT rc.school_id,
           rc.class_id,
           rc.comment_grade,
           rc.grade_level::text AS grade_level,
           array_agg(rc.id ORDER BY rc.id DESC) AS ids
    FROM report_comments rc
    LEFT JOIN unique_grade_candidates ugc ON ugc.report_comment_id = rc.id
    WHERE rc.comment_type = 'class_teacher'
      AND rc.grade_id IS NULL
      AND ugc.grade_id IS NULL
      AND rc.class_id IS NOT NULL
      AND rc.comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
    GROUP BY rc.school_id, rc.class_id, rc.comment_grade, rc.grade_level::text
    HAVING COUNT(*) > 1
    ORDER BY rc.school_id, rc.class_id, rc.comment_grade, rc.grade_level::text
  `);

  const overrides = await client.query(`
    SELECT school_id,
           comment_type,
           comment_grade,
           array_agg(id ORDER BY id DESC) AS ids
    FROM report_comments
    WHERE comment_grade LIKE '${OVERRIDE_PREFIX}:%'
    GROUP BY school_id, comment_type, comment_grade
    HAVING COUNT(*) > 1
    ORDER BY school_id, comment_grade, comment_type
  `);

  const build = (kind: DuplicateKind, row: any, extra: Record<string, unknown> = {}): DuplicateGroup => {
    const ids = numberArray(row.ids);
    return {
      kind,
      schoolId: Number(row.school_id),
      ids,
      canonicalId: Number(ids[0]),
      ...extra,
    };
  };

  return [
    ...principal.rows.map((row: any) => build("principal_pool", row, {
      gradeId: Number(row.grade_id),
    })),
    ...classTeacher.rows.map((row: any) => build("class_teacher_pool", row, {
      classId: Number(row.class_id),
      gradeId: Number(row.grade_id),
    })),
    ...principalLegacy.rows.map((row: any) => build("principal_legacy_pool", row, {
      commentGrade: String(row.comment_grade),
      gradeLevel: row.grade_level || null,
    })),
    ...classTeacherLegacy.rows.map((row: any) => build("class_teacher_legacy_pool", row, {
      classId: Number(row.class_id),
      commentGrade: String(row.comment_grade),
      gradeLevel: row.grade_level || null,
    })),
    ...overrides.rows.map((row: any) => build("report_card_override", row, {
      commentType: String(row.comment_type),
      commentGrade: String(row.comment_grade),
    })),
  ];
}

async function hasOverallCommentSnapshotColumn(client: any): Promise<boolean> {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'assessment_publications'
        AND column_name = 'overall_comment_rows_snapshot'
    ) AS present
  `);
  return result.rows[0]?.present === true;
}

async function countPublishedSnapshotsMissing(client: any, columnPresent: boolean): Promise<number> {
  const result = columnPresent
    ? await client.query(`
        SELECT COUNT(*)::int AS count
        FROM assessment_publications
        WHERE is_published = true
          AND overall_comment_rows_snapshot IS NULL
      `)
    : await client.query(`
        SELECT COUNT(*)::int AS count
        FROM assessment_publications
        WHERE is_published = true
      `);
  return Number(result.rows[0]?.count || 0);
}

async function backfillPublishedSnapshots(client: any): Promise<number> {
  const result = await client.query(`
    UPDATE assessment_publications ap
       SET overall_comment_rows_snapshot = COALESCE((
         SELECT jsonb_agg(
           jsonb_build_object(
             'id', rc.id,
             'schoolId', rc.school_id,
             'gradeId', rc.grade_id,
             'commentGrade', rc.comment_grade,
             'gradeLevel', rc.grade_level,
             'subjectId', rc.subject_id,
             'classId', rc.class_id,
             'commentText', rc.comment_text,
             'commentType', rc.comment_type,
             'createdAt', rc.created_at
           )
           ORDER BY rc.id DESC
         )
         FROM report_comments rc
         WHERE rc.school_id = ap.school_id
           AND (
             (
               rc.comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
               AND rc.comment_type = 'principal'
               AND rc.class_id IS NULL
             )
             OR (
               rc.comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
               AND rc.comment_type = 'class_teacher'
               AND rc.class_id = ap.class_id
             )
             OR rc.comment_grade ~ ('^${OVERRIDE_PREFIX}:[0-9]+:' || ap.exam_id::text || '$')
           )
       ), '[]'::jsonb)
     WHERE ap.is_published = true
       AND ap.overall_comment_rows_snapshot IS NULL
    RETURNING ap.id
  `);
  return result.rowCount || 0;
}

async function dropIntegrityIndexes(client: any) {
  for (const indexName of [
    "report_comments_principal_pool_uidx",
    "report_comments_class_teacher_pool_uidx",
    "report_comments_principal_legacy_pool_uidx",
    "report_comments_principal_legacy_pool_null_grade_level_uidx",
    "report_comments_class_teacher_legacy_pool_uidx",
    "report_comments_class_teacher_legacy_pool_null_grade_level_uidx",
    "report_comments_override_uidx",
  ]) {
    await client.query(`DROP INDEX IF EXISTS ${indexName}`);
  }
}

async function createIntegrityIndexes(client: any) {
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS report_comments_principal_pool_uidx
    ON report_comments (school_id, grade_id)
    WHERE comment_type = 'principal'
      AND grade_id IS NOT NULL
      AND class_id IS NULL
      AND comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS report_comments_class_teacher_pool_uidx
    ON report_comments (school_id, class_id, grade_id)
    WHERE comment_type = 'class_teacher'
      AND grade_id IS NOT NULL
      AND class_id IS NOT NULL
      AND comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
  `);
  // PostgreSQL enum-to-text casts are STABLE rather than IMMUTABLE, so they
  // cannot be used inside index expressions. Split NULL and non-NULL
  // grade-level cases into separate partial indexes instead.
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS report_comments_principal_legacy_pool_uidx
    ON report_comments (school_id, comment_grade, grade_level)
    WHERE comment_type = 'principal'
      AND grade_id IS NULL
      AND class_id IS NULL
      AND grade_level IS NOT NULL
      AND comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS report_comments_principal_legacy_pool_null_grade_level_uidx
    ON report_comments (school_id, comment_grade)
    WHERE comment_type = 'principal'
      AND grade_id IS NULL
      AND class_id IS NULL
      AND grade_level IS NULL
      AND comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS report_comments_class_teacher_legacy_pool_uidx
    ON report_comments (school_id, class_id, comment_grade, grade_level)
    WHERE comment_type = 'class_teacher'
      AND grade_id IS NULL
      AND class_id IS NOT NULL
      AND grade_level IS NOT NULL
      AND comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS report_comments_class_teacher_legacy_pool_null_grade_level_uidx
    ON report_comments (school_id, class_id, comment_grade)
    WHERE comment_type = 'class_teacher'
      AND grade_id IS NULL
      AND class_id IS NOT NULL
      AND grade_level IS NULL
      AND comment_grade NOT LIKE '${OVERRIDE_PREFIX}:%'
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS report_comments_override_uidx
    ON report_comments (school_id, comment_type, comment_grade)
    WHERE comment_grade LIKE '${OVERRIDE_PREFIX}:%'
  `);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const client = await pool.connect();
  try {
    const columnPresentBefore = await hasOverallCommentSnapshotColumn(client);
    const normalizableLegacyRows = await loadNormalizableLegacyRows(client);
    const publishedSnapshotsMissingBefore = await countPublishedSnapshotsMissing(client, columnPresentBefore);

    if (apply) {
      await client.query("BEGIN");
      await client.query(`
        ALTER TABLE assessment_publications
        ADD COLUMN IF NOT EXISTS overall_comment_rows_snapshot jsonb
      `);
      await client.query("LOCK TABLE report_comments IN ACCESS EXCLUSIVE MODE");
      await dropIntegrityIndexes(client);
    }

    const normalizedLegacyRows = apply ? await normalizeLegacyRows(client) : 0;
    const groups = await loadDuplicateGroups(client);
    const duplicateRows = groups.reduce((total, group) => total + Math.max(group.ids.length - 1, 0), 0);

    let publishedSnapshotsBackfilled = 0;
    if (apply) {
      for (const group of groups) {
        const duplicateIds = group.ids.slice(1);
        if (!duplicateIds.length) continue;
        await client.query("DELETE FROM report_comments WHERE id = ANY($1::int[])", [duplicateIds]);
      }

      await createIntegrityIndexes(client);
      publishedSnapshotsBackfilled = await backfillPublishedSnapshots(client);
      await client.query("COMMIT");
    }

    console.log(`Report comment integrity ${apply ? "repair" : "preflight"}`);
    console.log(`Mode: ${apply ? "APPLY" : "READ ONLY"}`);
    console.log(JSON.stringify({
      normalizableLegacyRows,
      normalizedLegacyRows,
      duplicateGroups: groups,
      duplicateRows,
      canonicalRule: "Newest row (highest id) is preserved for each duplicate logical key.",
      overallCommentSnapshotColumnPresentBefore: columnPresentBefore,
      publishedSnapshotsMissingBefore,
      publishedSnapshotsBackfilled,
      indexes: [
        "report_comments_principal_pool_uidx",
        "report_comments_class_teacher_pool_uidx",
        "report_comments_principal_legacy_pool_uidx",
        "report_comments_principal_legacy_pool_null_grade_level_uidx",
        "report_comments_class_teacher_legacy_pool_uidx",
        "report_comments_class_teacher_legacy_pool_null_grade_level_uidx",
        "report_comments_override_uidx",
      ],
      applied: apply,
      note: apply
        ? "Legacy rows with one exact grade match were linked, duplicate logical rows were retired, uniqueness was enforced, and currently published reports were frozen to the effective overall comments present at deployment."
        : "No data was changed. Apply mode will preserve the newest logical row and freeze currently published reports to the effective overall comments present at deployment.",
    }, null, 2));
  } catch (error) {
    if (apply) await client.query("ROLLBACK").catch(() => undefined);
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
