import "dotenv/config";
import { pool } from "../server/db";
import { resolveOperationalGradeProfile } from "../shared/academic-profiles";
import { getProfileAwareGradeCandidates, parseFinitePercentage, resolveGradeForPercentage } from "../server/grade-resolution";
import { isTemporarilyExcludedFromStrictGrading } from "../server/grading-exclusions";

const APPLY = process.argv.includes("--apply");
const EXAMPLE_LIMIT = 200;

type AnyRow = Record<string, any>;

function normalizedGrade(row: AnyRow) {
  return {
    ...row,
    id: Number(row.id),
    schoolId: Number(row.school_id),
    gradeName: row.grade_name,
    gradeLevel: row.grade_level,
    gradeType: row.grade_type,
    lowerLimit: row.lower_limit,
    upperLimit: row.upper_limit,
    gradePoints: row.grade_points,
    gradeStatus: row.grade_status,
    rankOrder: row.rank_order,
    appliesAll: row.applies_all,
    classIds: row.class_ids,
  };
}

async function main() {
  const client = await pool.connect();
  try {
    const [gradesResult, marksResult] = await Promise.all([
      client.query(`SELECT * FROM grades ORDER BY school_id, grade_level, lower_limit, upper_limit, id`),
      client.query(`
        SELECT
          am.id AS mark_id, am.grade_id, am.percentage,
          am.student_id, a.class_id, a.subject_id, a.exam_id,
          COALESCE(a.school_id, c.school_id) AS school_id,
          c.class_name,
          st.name AS stream_name,
          s.name AS subject_name, s.subject_type,
          sch.name AS school_name, sch.school_type, sch.examination_board
        FROM assessment_marks am
        JOIN assessments a ON a.id = am.assessment_id
        JOIN classes c ON c.id = a.class_id
        LEFT JOIN streams st ON st.id = c.stream_id
        JOIN subjects s ON s.id = a.subject_id
        JOIN schools sch ON sch.id = COALESCE(a.school_id, c.school_id)
        WHERE am.percentage IS NOT NULL
        ORDER BY am.id
      `),
    ]);

    const gradesBySchool = new Map<number, ReturnType<typeof normalizedGrade>[]>();
    for (const raw of gradesResult.rows) {
      const grade = normalizedGrade(raw);
      const rows = gradesBySchool.get(grade.schoolId) || [];
      rows.push(grade);
      gradesBySchool.set(grade.schoolId, rows);
    }

    const repairs: Array<{
      markId: number;
      schoolId: number;
      school: string;
      classId: number;
      examId: number | null;
      class: string;
      subjectId: number;
      subject: string;
      studentId: number;
      percentage: number;
      expectedProfile: string;
      gradingProfileSource: string;
      substitutionPolicy: string | null;
      oldGradeId: number | null;
      newGradeId: number;
      newGradeName: string;
    }> = [];
    const skippedCounts = new Map<string, number>();
    const substitutionCounts = new Map<string, number>();
    const skippedExamples: AnyRow[] = [];
    let excludedResults = 0;
    let alreadyCorrect = 0;

    const skip = (reason: string, row: AnyRow, extra: AnyRow = {}) => {
      skippedCounts.set(reason, (skippedCounts.get(reason) || 0) + 1);
      if (skippedExamples.length < EXAMPLE_LIMIT) {
        skippedExamples.push({
          reason,
          markId: Number(row.mark_id),
          school: row.school_name,
          class: row.class_name,
          subject: row.subject_name,
          percentage: row.percentage,
          ...extra,
        });
      }
    };

    for (const row of marksResult.rows) {
      if (isTemporarilyExcludedFromStrictGrading(row.subject_name)) {
        excludedResults++;
        continue;
      }
      const percentage = parseFinitePercentage(row.percentage);
      if (percentage === null) {
        skip("invalid_percentage", row);
        continue;
      }
      const operationalProfile = resolveOperationalGradeProfile({
        schoolType: row.school_type,
        examinationBoard: row.examination_board,
        streamName: row.stream_name,
        subjectType: row.subject_type,
        subjectName: row.subject_name,
      });
      const expectedProfile = operationalProfile.profileKey;
      if (!expectedProfile) {
        skip("exact_profile_missing", row);
        continue;
      }
      if (operationalProfile.substitutionPolicy) {
        const key = [
          operationalProfile.substitutionPolicy,
          Number(row.school_id),
          row.school_name,
          expectedProfile,
        ].join("|");
        substitutionCounts.set(key, (substitutionCounts.get(key) || 0) + 1);
      }
      const schoolGrades = gradesBySchool.get(Number(row.school_id)) || [];
      const candidates = getProfileAwareGradeCandidates(
        schoolGrades,
        expectedProfile,
        Number(row.class_id),
      );
      const resolution = resolveGradeForPercentage(
        percentage,
        candidates,
        operationalProfile.effectiveSubjectType,
      );
      if (resolution.ambiguous) {
        skip("grade_resolution_ambiguous", row, { expectedProfile });
        continue;
      }
      const grade = resolution.grade;
      if (!grade) {
        skip("grade_band_missing", row, { expectedProfile });
        continue;
      }
      const currentGradeId = row.grade_id === null || row.grade_id === undefined ? null : Number(row.grade_id);
      if (currentGradeId === Number(grade.id)) {
        alreadyCorrect++;
        continue;
      }
      repairs.push({
        markId: Number(row.mark_id),
        schoolId: Number(row.school_id),
        school: row.school_name,
        classId: Number(row.class_id),
        examId: row.exam_id === null || row.exam_id === undefined ? null : Number(row.exam_id),
        class: row.class_name,
        subjectId: Number(row.subject_id),
        subject: row.subject_name,
        studentId: Number(row.student_id),
        percentage,
        expectedProfile,
        gradingProfileSource: operationalProfile.source,
        substitutionPolicy: operationalProfile.substitutionPolicy,
        oldGradeId: currentGradeId,
        newGradeId: Number(grade.id),
        newGradeName: String(grade.gradeName || ""),
      });
    }

    const bySchoolProfile = new Map<string, number>();
    for (const repair of repairs) {
      const key = `${repair.schoolId}|${repair.school}|${repair.expectedProfile}`;
      bySchoolProfile.set(key, (bySchoolProfile.get(key) || 0) + 1);
    }
    const groupedRepairs = Array.from(bySchoolProfile.entries()).map(([key, count]) => {
      const [schoolId, school, expectedProfile] = key.split("|");
      return { schoolId: Number(schoolId), school, expectedProfile, count };
    }).sort((a, b) => a.schoolId - b.schoolId || a.expectedProfile.localeCompare(b.expectedProfile));


    const intentionalSubstitutions = Array.from(substitutionCounts.entries()).map(([key, count]) => {
      const [policy, schoolId, school, expectedProfile] = key.split("|");
      return { policy, schoolId: Number(schoolId), school, expectedProfile, count };
    }).sort((a, b) => a.schoolId - b.schoolId || a.policy.localeCompare(b.policy));

    const preview = {
      mode: APPLY ? "APPLY" : "PREVIEW",
      summary: {
        numericResultsExamined: marksResult.rows.length,
        temporarilyExcludedResults: excludedResults,
        alreadyCorrect,
        safelyRepairable: repairs.length,
        intentionalSubstitutionResults: Array.from(substitutionCounts.values()).reduce((sum, value) => sum + value, 0),
        intentionalSubstitutionGroups: intentionalSubstitutions.length,
        skipped: Array.from(skippedCounts.values()).reduce((sum, value) => sum + value, 0),
      },
      repairsBySchoolProfile: groupedRepairs,
      intentionalGradingSubstitutions: intentionalSubstitutions,
      repairExamples: repairs.slice(0, EXAMPLE_LIMIT),
      skippedByReason: Object.fromEntries(Array.from(skippedCounts.entries()).sort(([a], [b]) => a.localeCompare(b))),
      skippedExamples,
      safety: {
        changesOnly: [
          "assessment_marks.grade_id",
          "assessment_publications.publication_version for affected published class/exam reports (cache invalidation only)",
        ],
        unchanged: ["marks", "paper marks", "percentages", "assessments", "comments", "students", "classes", "publication status"],
        transaction: true,
        idempotent: true,
      },
    };

    if (!APPLY) {
      console.log(JSON.stringify({ ...preview, next: "Review this preview, back up the database, then run the apply command." }, null, 2));
      return;
    }

    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('fcgs_assessment_grade_link_repair'))`);
    await client.query(`
      CREATE TEMP TABLE grading_link_repairs (
        mark_id integer PRIMARY KEY,
        grade_id integer NOT NULL,
        school_id integer NOT NULL,
        exam_id integer,
        class_id integer NOT NULL
      ) ON COMMIT DROP
    `);

    const CHUNK_SIZE = 2000;
    for (let offset = 0; offset < repairs.length; offset += CHUNK_SIZE) {
      const chunk = repairs.slice(offset, offset + CHUNK_SIZE);
      if (!chunk.length) continue;
      const values: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((row, index) => {
        const base = index * 5;
        values.push(`($${base + 1}::integer, $${base + 2}::integer, $${base + 3}::integer, $${base + 4}::integer, $${base + 5}::integer)`);
        params.push(row.markId, row.newGradeId, row.schoolId, row.examId, row.classId);
      });
      await client.query(`
        INSERT INTO grading_link_repairs (mark_id, grade_id, school_id, exam_id, class_id)
        VALUES ${values.join(",")}
        ON CONFLICT (mark_id) DO UPDATE SET
          grade_id = EXCLUDED.grade_id,
          school_id = EXCLUDED.school_id,
          exam_id = EXCLUDED.exam_id,
          class_id = EXCLUDED.class_id
      `, params);
    }

    const updateResult = await client.query(`
      UPDATE assessment_marks AS am
      SET grade_id = repairs.grade_id
      FROM grading_link_repairs AS repairs
      WHERE am.id = repairs.mark_id
        AND am.grade_id IS DISTINCT FROM repairs.grade_id
    `);
    const verification = await client.query(`
      SELECT count(*)::int AS remaining
      FROM grading_link_repairs repairs
      JOIN assessment_marks am ON am.id = repairs.mark_id
      WHERE am.grade_id IS DISTINCT FROM repairs.grade_id
    `);
    if (Number(verification.rows[0]?.remaining || 0) !== 0) {
      throw new Error(`Repair verification failed: ${verification.rows[0]?.remaining || 0} planned grade links were not updated.`);
    }

    const publicationInvalidationResult = await client.query(`
      WITH affected AS (
        SELECT DISTINCT school_id, exam_id, class_id
        FROM grading_link_repairs
        WHERE exam_id IS NOT NULL
      )
      UPDATE assessment_publications AS ap
      SET publication_version = ap.publication_version + 1,
          updated_at = now()
      FROM affected
      WHERE ap.school_id = affected.school_id
        AND ap.exam_id = affected.exam_id
        AND ap.class_id = affected.class_id
        AND ap.is_published = true
    `);

    await client.query("COMMIT");
    console.log(JSON.stringify({
      ...preview,
      applied: true,
      updatedRows: updateResult.rowCount || 0,
      invalidatedPublishedClassReports: publicationInvalidationResult.rowCount || 0,
      verification: { remainingPlannedMismatches: 0 },
      next: "Run grades:integrity:audit again. Affected published class reports now have a new publication version and will regenerate.",
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
