import "dotenv/config";
import { pool } from "../server/db";

const APPLY = process.argv.includes("--apply");

const TARGETS = [
  { markId: 3495, subject: "English", percentage: 48 },
  { markId: 3496, subject: "Mathematics", percentage: 15 },
  { markId: 3497, subject: "Shona", percentage: 75 },
] as const;

const EXPECTED = {
  school: "First Choice Group of Schools - Waterfalls Jnr",
  className: "Grade 4 Vacation",
  studentId: 13733,
};

type AnyRow = Record<string, any>;

function normalizeText(value: unknown): string {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function validateRows(rows: AnyRow[]) {
  const expectedById = new Map<number, (typeof TARGETS)[number]>(
    TARGETS.map((target) => [Number(target.markId), target]),
  );
  const issues: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const markId = Number(row.mark_id);
    const expected = expectedById.get(markId);
    if (!expected) {
      issues.push({ markId, reason: "unexpected_mark_id" });
      continue;
    }
    if (normalizeText(row.school_name) !== EXPECTED.school) {
      issues.push({ markId, reason: "school_mismatch", actual: row.school_name, expected: EXPECTED.school });
    }
    if (normalizeText(row.class_name) !== EXPECTED.className) {
      issues.push({ markId, reason: "class_mismatch", actual: row.class_name, expected: EXPECTED.className });
    }
    if (Number(row.student_id) !== EXPECTED.studentId) {
      issues.push({ markId, reason: "student_mismatch", actual: Number(row.student_id), expected: EXPECTED.studentId });
    }
    if (normalizeText(row.subject_name) !== expected.subject) {
      issues.push({ markId, reason: "subject_mismatch", actual: row.subject_name, expected: expected.subject });
    }
    if (Number(row.percentage) !== expected.percentage) {
      issues.push({ markId, reason: "percentage_mismatch", actual: Number(row.percentage), expected: expected.percentage });
    }
    if (row.grade_id !== null && row.grade_id !== undefined) {
      issues.push({ markId, reason: "grade_link_present", actual: Number(row.grade_id), expected: null });
    }
  }

  return issues;
}

async function loadRows(client: any, lock = false): Promise<AnyRow[]> {
  const suffix = lock ? " FOR UPDATE OF am" : "";
  const result = await client.query(`
    SELECT
      am.id AS mark_id,
      am.student_id,
      am.percentage,
      am.grade_id,
      am.assessment_id,
      a.exam_id,
      a.class_id,
      a.subject_id,
      COALESCE(a.school_id, c.school_id) AS school_id,
      sch.name AS school_name,
      c.class_name,
      s.name AS subject_name,
      (SELECT count(*)::int FROM assessment_mark_papers amp WHERE amp.assessment_mark_id = am.id) AS paper_rows
    FROM assessment_marks am
    JOIN assessments a ON a.id = am.assessment_id
    JOIN classes c ON c.id = a.class_id
    JOIN subjects s ON s.id = a.subject_id
    JOIN schools sch ON sch.id = COALESCE(a.school_id, c.school_id)
    WHERE am.id = ANY($1::integer[])
    ORDER BY am.id${suffix}
  `, [TARGETS.map((target) => target.markId)]);
  return result.rows;
}

async function main() {
  const client = await pool.connect();
  try {
    const rows = await loadRows(client);
    const issues = validateRows(rows);
    const presentIds = rows.map((row) => Number(row.mark_id));
    const retiredIds = TARGETS.map((target) => target.markId).filter((id) => !presentIds.includes(id));
    const dependentPaperRows = rows.reduce((sum, row) => sum + Number(row.paper_rows || 0), 0);
    const safeToApply = issues.length === 0;

    const preview = {
      mode: APPLY ? "APPLY" : "PREVIEW",
      policy: "Delete only the three confirmed historical Grade 4 Vacation results.",
      summary: {
        targetRows: TARGETS.length,
        rowsPresent: rows.length,
        rowsAlreadyRetired: retiredIds.length,
        dependentPaperRows,
        safeToApply,
      },
      expectedContext: EXPECTED,
      rows: rows.map((row) => ({
        markId: Number(row.mark_id),
        assessmentId: Number(row.assessment_id),
        examId: row.exam_id === null ? null : Number(row.exam_id),
        schoolId: Number(row.school_id),
        school: row.school_name,
        classId: Number(row.class_id),
        class: row.class_name,
        subjectId: Number(row.subject_id),
        subject: row.subject_name,
        studentId: Number(row.student_id),
        percentage: Number(row.percentage),
        gradeId: row.grade_id === null ? null : Number(row.grade_id),
        dependentPaperRows: Number(row.paper_rows || 0),
      })),
      alreadyRetiredMarkIds: retiredIds,
      validationIssues: issues,
      safety: {
        deletesOnly: [
          "assessment_mark_papers rows belonging to mark IDs 3495, 3496 and 3497",
          "assessment_marks rows 3495, 3496 and 3497",
        ],
        cacheInvalidationOnly: "Bumps publication_version for affected published class/exam reports.",
        unchanged: [
          "students",
          "assessments",
          "assessment papers",
          "other marks",
          "comments",
          "classes",
          "subjects",
          "publication status",
        ],
        transaction: true,
        idempotent: true,
      },
    };

    if (!safeToApply) {
      console.log(JSON.stringify(preview, null, 2));
      throw new Error("Historical mark retirement validation failed. No rows were changed.");
    }

    if (!APPLY) {
      console.log(JSON.stringify({
        ...preview,
        next: rows.length > 0
          ? "Back up the database, then run the apply command."
          : "All three target rows are already retired; no apply action is required.",
      }, null, 2));
      return;
    }

    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('fcgs_grade_4_vacation_history_retirement'))`);
    const lockedRows = await loadRows(client, true);
    const lockedIssues = validateRows(lockedRows);
    if (lockedIssues.length > 0) {
      throw new Error(`Historical mark retirement validation changed before apply: ${JSON.stringify(lockedIssues)}`);
    }

    if (lockedRows.length === 0) {
      await client.query("COMMIT");
      console.log(JSON.stringify({ ...preview, applied: true, noOp: true, deletedMarkPaperRows: 0, deletedMarkRows: 0, invalidatedPublishedClassReports: 0 }, null, 2));
      return;
    }

    const lockedIds = lockedRows.map((row) => Number(row.mark_id));
    const affected = lockedRows
      .filter((row) => row.exam_id !== null && row.exam_id !== undefined)
      .map((row) => ({
        schoolId: Number(row.school_id),
        examId: Number(row.exam_id),
        classId: Number(row.class_id),
      }));

    const paperDelete = await client.query(`
      DELETE FROM assessment_mark_papers
      WHERE assessment_mark_id = ANY($1::integer[])
    `, [lockedIds]);

    const markDelete = await client.query(`
      DELETE FROM assessment_marks
      WHERE id = ANY($1::integer[])
      RETURNING id
    `, [lockedIds]);

    if ((markDelete.rowCount || 0) !== lockedIds.length) {
      throw new Error(`Expected to delete ${lockedIds.length} assessment marks but deleted ${markDelete.rowCount || 0}.`);
    }

    let invalidatedPublishedClassReports = 0;
    if (affected.length > 0) {
      const unique = Array.from(new Map(affected.map((row) => [`${row.schoolId}|${row.examId}|${row.classId}`, row])).values());
      const values: string[] = [];
      const params: number[] = [];
      unique.forEach((row, index) => {
        const base = index * 3;
        values.push(`($${base + 1}::integer, $${base + 2}::integer, $${base + 3}::integer)`);
        params.push(row.schoolId, row.examId, row.classId);
      });
      const invalidation = await client.query(`
        WITH affected(school_id, exam_id, class_id) AS (VALUES ${values.join(",")})
        UPDATE assessment_publications ap
        SET publication_version = ap.publication_version + 1,
            updated_at = now()
        FROM affected
        WHERE ap.school_id = affected.school_id
          AND ap.exam_id = affected.exam_id
          AND ap.class_id = affected.class_id
          AND ap.is_published = true
      `, params);
      invalidatedPublishedClassReports = invalidation.rowCount || 0;
    }

    const remaining = await client.query(`
      SELECT count(*)::int AS count
      FROM assessment_marks
      WHERE id = ANY($1::integer[])
    `, [TARGETS.map((target) => target.markId)]);
    if (Number(remaining.rows[0]?.count || 0) !== 0) {
      throw new Error("Historical mark retirement verification failed: one or more target marks still exist.");
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({
      ...preview,
      applied: true,
      noOp: false,
      deletedMarkPaperRows: paperDelete.rowCount || 0,
      deletedMarkRows: markDelete.rowCount || 0,
      invalidatedPublishedClassReports,
      verification: { remainingTargetMarks: 0 },
      next: "Run the grade-link repair preview, apply it after review, and then rerun the integrity audit.",
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
