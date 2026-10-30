import "dotenv/config";
import { pool } from "../server/db";
import { GRADE_PROFILE_KEYS, OPERATIONAL_GRADING_POLICY_VERSION, resolveOperationalGradeProfile } from "../shared/academic-profiles";
import { resolveExactConfiguredGrade } from "../server/grading-engine";
import { getTemporaryStrictGradingExclusions, isTemporarilyExcludedFromStrictGrading } from "../server/grading-exclusions";

const ACTIVE = new Set<string>(GRADE_PROFILE_KEYS as readonly string[]);
const EXAMPLE_LIMIT = 200;

type AnyRow = Record<string, any>;

function coverageIssues(rows: AnyRow[]) {
  const sorted = [...rows].sort((a, b) => Number(a.lower_limit) - Number(b.lower_limit) || Number(a.upper_limit) - Number(b.upper_limit));
  const gaps: Array<{ from: number; to: number }> = [];
  const overlaps: Array<{ gradeIds: number[]; from: number; to: number }> = [];
  let cursor = 0;
  for (let index = 0; index < sorted.length; index++) {
    const row = sorted[index];
    const lower = Number(row.lower_limit);
    const upper = Number(row.upper_limit);
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) continue;
    if (lower > cursor) gaps.push({ from: cursor, to: lower - 1 });
    if (lower < cursor) {
      const previous = sorted.slice(0, index).filter((candidate) => Number(candidate.upper_limit) >= lower);
      overlaps.push({ gradeIds: [...previous.map((candidate) => Number(candidate.id)), Number(row.id)], from: lower, to: Math.min(cursor - 1, upper) });
    }
    cursor = Math.max(cursor, upper + 1);
  }
  if (cursor <= 100) gaps.push({ from: cursor, to: 100 });
  return { gaps, overlaps };
}

async function main() {
  const client = await pool.connect();
  try {
    const [gradesResult, settingsResult, resultRows, assessmentGroupsResult] = await Promise.all([
      client.query(`SELECT * FROM grades ORDER BY school_id, grade_level, grade_type NULLS FIRST, lower_limit, upper_limit, id`),
      client.query(`SELECT * FROM grade_profile_settings ORDER BY school_id, grade_level`),
      client.query(`
        SELECT
          am.id AS mark_id, am.student_id, am.assessment_id, am.percentage, am.grade_id,
          a.school_id, a.class_id, a.subject_id, a.exam_id,
          c.class_name AS class_name, c.stream_id,
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
      client.query(`
        SELECT DISTINCT
          COALESCE(a.school_id, c.school_id) AS school_id,
          a.exam_id, a.class_id, a.subject_id,
          c.class_name AS class_name,
          st.name AS stream_name,
          s.name AS subject_name, s.subject_type,
          sch.name AS school_name, sch.school_type, sch.examination_board
        FROM assessments a
        JOIN classes c ON c.id = a.class_id
        LEFT JOIN streams st ON st.id = c.stream_id
        JOIN subjects s ON s.id = a.subject_id
        JOIN schools sch ON sch.id = COALESCE(a.school_id, c.school_id)
        WHERE a.exam_id IS NOT NULL
        ORDER BY COALESCE(a.school_id, c.school_id), a.exam_id, a.class_id, a.subject_id
      `),
    ]);

    const grades: AnyRow[] = gradesResult.rows;
    const settings: AnyRow[] = settingsResult.rows;
    const excludedMarks = resultRows.rows.filter((row: AnyRow) => isTemporarilyExcludedFromStrictGrading(row.subject_name));
    const marks: AnyRow[] = resultRows.rows.filter((row: AnyRow) => !isTemporarilyExcludedFromStrictGrading(row.subject_name));
    const excludedAssessmentGroups = assessmentGroupsResult.rows.filter((row: AnyRow) => isTemporarilyExcludedFromStrictGrading(row.subject_name));
    const assessmentGroups: AnyRow[] = assessmentGroupsResult.rows.filter((row: AnyRow) => !isTemporarilyExcludedFromStrictGrading(row.subject_name));
    const gradesBySchoolProfile = new Map<string, AnyRow[]>();
    const gradesById = new Map(grades.map((row) => [Number(row.id), row]));
    for (const grade of grades) {
      const key = `${Number(grade.school_id)}|${String(grade.grade_level)}`;
      const rows = gradesBySchoolProfile.get(key) || [];
      rows.push(grade);
      gradesBySchoolProfile.set(key, rows);
    }
    const settingKeys = new Set(settings.map((row) => `${Number(row.school_id)}|${String(row.grade_level)}`));

    const legacyProfiles = grades.filter((grade) => !ACTIVE.has(String(grade.grade_level)));
    const missingStatus = grades.filter((grade) => !["PASS", "FAIL"].includes(String(grade.grade_status || "").trim().toUpperCase()));
    const missingPoints = grades.filter((grade) => grade.grade_points === null || grade.grade_points === undefined || !Number.isFinite(Number(grade.grade_points)));
    const missingRankOrder = grades.filter((grade) => !Number.isInteger(Number(grade.rank_order)) || Number(grade.rank_order) <= 0);

    const duplicateRankOrders: AnyRow[] = [];
    const rankGroups = new Map<string, AnyRow[]>();
    for (const grade of grades.filter((row) => ACTIVE.has(String(row.grade_level)) && Number(row.rank_order) > 0)) {
      const key = `${grade.school_id}|${grade.grade_level}|${grade.grade_type || ""}|${grade.rank_order}`;
      const rows = rankGroups.get(key) || [];
      rows.push(grade);
      rankGroups.set(key, rows);
    }
    for (const [key, rows] of rankGroups) {
      if (rows.length > 1) duplicateRankOrders.push({ key, gradeIds: rows.map((row) => Number(row.id)), gradeNames: rows.map((row) => row.grade_name) });
    }

    const profileCoverage: AnyRow[] = [];
    for (const [key, rows] of gradesBySchoolProfile) {
      if (!ACTIVE.has(String(rows[0]?.grade_level))) continue;
      const byType = new Map<string, AnyRow[]>();
      for (const row of rows) {
        const typeKey = String(row.grade_type || "ALL");
        const typed = byType.get(typeKey) || [];
        typed.push(row);
        byType.set(typeKey, typed);
      }
      for (const [gradeType, typed] of byType) {
        const issues = coverageIssues(typed);
        if (issues.gaps.length || issues.overlaps.length) profileCoverage.push({ key, gradeType, ...issues });
      }
    }

    const requiredProfileKeys = new Set<string>();
    const unresolvedResults: AnyRow[] = [];
    const wrongStoredGrades: AnyRow[] = [];
    const intentionalSubstitutionMap = new Map<string, {
      policy: string;
      schoolId: number;
      school: string;
      expectedProfile: string;
      resultCount: number;
      classIds: Set<number>;
      classes: Set<string>;
      subjectIds: Set<number>;
      subjects: Set<string>;
    }>();
    let passCount = 0;
    let failCount = 0;
    let unresolvedCount = 0;
    let old50PassCount = 0;
    let old60PassCount = 0;

    for (const mark of marks) {
      const operationalProfile = resolveOperationalGradeProfile({
        schoolType: mark.school_type,
        examinationBoard: mark.examination_board,
        streamName: mark.stream_name,
        subjectType: mark.subject_type,
        subjectName: mark.subject_name,
      });
      const expectedProfileKey = operationalProfile.profileKey;
      if (expectedProfileKey) requiredProfileKeys.add(`${Number(mark.school_id)}|${expectedProfileKey}`);
      if (operationalProfile.substitutionPolicy && expectedProfileKey) {
        const key = `${operationalProfile.substitutionPolicy}|${Number(mark.school_id)}|${expectedProfileKey}`;
        const current = intentionalSubstitutionMap.get(key) || {
          policy: operationalProfile.substitutionPolicy,
          schoolId: Number(mark.school_id),
          school: String(mark.school_name || ""),
          expectedProfile: expectedProfileKey,
          resultCount: 0,
          classIds: new Set<number>(),
          classes: new Set<string>(),
          subjectIds: new Set<number>(),
          subjects: new Set<string>(),
        };
        current.resultCount += 1;
        current.classIds.add(Number(mark.class_id));
        current.classes.add(String(mark.class_name || ""));
        current.subjectIds.add(Number(mark.subject_id));
        current.subjects.add(String(mark.subject_name || ""));
        intentionalSubstitutionMap.set(key, current);
      }
      const percentage = Number(mark.percentage);
      if (percentage >= 50) old50PassCount++;
      if (percentage >= 60) old60PassCount++;
      const exactGrades = expectedProfileKey ? gradesBySchoolProfile.get(`${Number(mark.school_id)}|${expectedProfileKey}`) || [] : [];
      const storedGrade = mark.grade_id ? gradesById.get(Number(mark.grade_id)) : null;
      const resolution = resolveExactConfiguredGrade({
        percentage: Number.isFinite(percentage) ? percentage : null,
        expectedProfileKey,
        classId: Number(mark.class_id),
        subjectType: operationalProfile.effectiveSubjectType,
        exactProfileGrades: exactGrades.map((grade) => ({
          ...grade,
          gradeLevel: grade.grade_level,
          gradeType: grade.grade_type,
          lowerLimit: grade.lower_limit,
          upperLimit: grade.upper_limit,
          gradePoints: grade.grade_points,
          gradeStatus: grade.grade_status,
          rankOrder: grade.rank_order,
          appliesAll: grade.applies_all,
          classIds: grade.class_ids,
        })),
        storedGrade: storedGrade ? {
          ...storedGrade,
          gradeLevel: storedGrade.grade_level,
          gradeType: storedGrade.grade_type,
          lowerLimit: storedGrade.lower_limit,
          upperLimit: storedGrade.upper_limit,
          gradePoints: storedGrade.grade_points,
          gradeStatus: storedGrade.grade_status,
          rankOrder: storedGrade.rank_order,
          appliesAll: storedGrade.applies_all,
          classIds: storedGrade.class_ids,
        } : null,
      });
      if (storedGrade && expectedProfileKey && String(storedGrade.grade_level) !== expectedProfileKey) {
        wrongStoredGrades.push({
          markId: Number(mark.mark_id), studentId: Number(mark.student_id), school: mark.school_name,
          class: mark.class_name, subject: mark.subject_name, percentage,
          expectedProfile: expectedProfileKey, storedGradeId: Number(storedGrade.id), storedProfile: storedGrade.grade_level,
        });
      }
      if (resolution.passStatus === "PASS") passCount++;
      else if (resolution.passStatus === "FAIL") failCount++;
      else {
        unresolvedCount++;
        if (unresolvedResults.length < EXAMPLE_LIMIT) unresolvedResults.push({
          markId: Number(mark.mark_id), studentId: Number(mark.student_id), school: mark.school_name,
          class: mark.class_name, subject: mark.subject_name, percentage,
          expectedProfile: expectedProfileKey, storedGradeId: mark.grade_id ? Number(mark.grade_id) : null,
          profileSource: operationalProfile.source,
          substitutionPolicy: operationalProfile.substitutionPolicy,
          issues: resolution.issues,
        });
      }
    }

    const missingSettings = Array.from(requiredProfileKeys).filter((key) => !settingKeys.has(key)).map((key) => {
      const [schoolId, profileKey] = key.split("|");
      return { schoolId: Number(schoolId), profileKey };
    });

    const settingsDirection = new Map(settings.map((row) => [
      `${Number(row.school_id)}|${String(row.grade_level)}`,
      String(row.points_direction || ""),
    ]));
    const reportGroups = new Map<string, AnyRow[]>();
    for (const row of assessmentGroups) {
      const key = `${Number(row.school_id)}|${Number(row.exam_id)}|${Number(row.class_id)}`;
      const rows = reportGroups.get(key) || [];
      rows.push(row);
      reportGroups.set(key, rows);
    }
    const rankingConfigurationWarnings: AnyRow[] = [];
    for (const [key, rows] of reportGroups) {
      const first = rows[0];
      const profileKeys = new Set<string>();
      const unresolvedSubjects: AnyRow[] = [];
      for (const row of rows) {
        const operationalProfile = resolveOperationalGradeProfile({
          schoolType: row.school_type,
          examinationBoard: row.examination_board,
          streamName: row.stream_name,
          subjectType: row.subject_type,
          subjectName: row.subject_name,
        });
        const profileKey = operationalProfile.profileKey;
        if (profileKey) profileKeys.add(profileKey);
        else unresolvedSubjects.push({ subjectId: Number(row.subject_id), subjectName: row.subject_name, subjectType: row.subject_type });
      }
      const directions = Array.from(profileKeys).map((profileKey) => settingsDirection.get(`${Number(first.school_id)}|${profileKey}`) || null);
      const uniqueDirections = new Set(directions.filter(Boolean));
      const reasons: string[] = [];
      if (unresolvedSubjects.length) reasons.push("subjects_without_exact_profile");
      if (directions.some((direction) => !direction)) reasons.push("points_direction_missing");
      if (uniqueDirections.size > 1) reasons.push("mixed_points_directions");
      if (reasons.length) {
        rankingConfigurationWarnings.push({
          key,
          schoolId: Number(first.school_id),
          school: first.school_name,
          examId: Number(first.exam_id),
          classId: Number(first.class_id),
          class: first.class_name,
          profileKeys: Array.from(profileKeys),
          pointsDirections: directions,
          unresolvedSubjects,
          reasons,
        });
      }
    }

    const intentionalGradingSubstitutions = Array.from(intentionalSubstitutionMap.values())
      .map((row) => ({
        policy: row.policy,
        schoolId: row.schoolId,
        school: row.school,
        expectedProfile: row.expectedProfile,
        resultCount: row.resultCount,
        classIds: Array.from(row.classIds).sort((a, b) => a - b),
        classes: Array.from(row.classes).filter(Boolean).sort((a, b) => a.localeCompare(b)),
        subjectIds: Array.from(row.subjectIds).sort((a, b) => a - b),
        subjects: Array.from(row.subjects).filter(Boolean).sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.schoolId - b.schoolId || a.policy.localeCompare(b.policy));
    const intentionalSubstitutionResults = intentionalGradingSubstitutions
      .reduce((sum, row) => sum + row.resultCount, 0);

    // Legacy grade rows are allowed to remain physically present as dormant history.
    // They are not operationally consumed once stored grade links are repaired.
    const blockingIssueCount = missingStatus.length + missingPoints.length + missingRankOrder.length + duplicateRankOrders.length + profileCoverage.length + missingSettings.length + unresolvedCount + wrongStoredGrades.length;
    const report = {
      mode: "READ_ONLY",
      generatedAt: new Date().toISOString(),
      summary: {
        gradeRows: grades.length,
        gradeProfileSettings: settings.length,
        numericAssessmentResults: marks.length,
        temporarilyExcludedNumericResults: excludedMarks.length,
        temporarilyExcludedAssessmentSubjects: excludedAssessmentGroups.length,
        legacyProfileRows: legacyProfiles.length,
        missingStatusRows: missingStatus.length,
        missingPointsRows: missingPoints.length,
        missingRankOrderRows: missingRankOrder.length,
        duplicateRankOrderGroups: duplicateRankOrders.length,
        profileCoverageIssueGroups: profileCoverage.length,
        missingProfileSettings: missingSettings.length,
        wrongStoredGradeLinks: wrongStoredGrades.length,
        unresolvedResults: unresolvedCount,
        intentionalGradingSubstitutionResults: intentionalSubstitutionResults,
        intentionalGradingSubstitutionGroups: intentionalGradingSubstitutions.length,
        operationalGradingPolicyVersion: OPERATIONAL_GRADING_POLICY_VERSION,
        resolvedPasses: passCount,
        resolvedFails: failCount,
        oldHardcoded50Passes: old50PassCount,
        oldHardcoded60Passes: old60PassCount,
        blockingIssueCount,
        rankingConfigurationWarningGroups: rankingConfigurationWarnings.length,
        readyForConstraints: blockingIssueCount === 0,
        readyForDeployment: blockingIssueCount === 0 && rankingConfigurationWarnings.length === 0,
        temporaryStrictGradingExclusions: getTemporaryStrictGradingExclusions(),
      },
      issues: {
        legacyProfiles: legacyProfiles.slice(0, EXAMPLE_LIMIT).map((row) => ({ id: row.id, schoolId: row.school_id, gradeName: row.grade_name, gradeLevel: row.grade_level })),
        missingStatus: missingStatus.slice(0, EXAMPLE_LIMIT).map((row) => ({ id: row.id, schoolId: row.school_id, gradeName: row.grade_name, gradeLevel: row.grade_level })),
        missingPoints: missingPoints.slice(0, EXAMPLE_LIMIT).map((row) => ({ id: row.id, schoolId: row.school_id, gradeName: row.grade_name, gradeLevel: row.grade_level })),
        missingRankOrder: missingRankOrder.slice(0, EXAMPLE_LIMIT).map((row) => ({ id: row.id, schoolId: row.school_id, gradeName: row.grade_name, gradeLevel: row.grade_level })),
        duplicateRankOrders: duplicateRankOrders.slice(0, EXAMPLE_LIMIT),
        profileCoverage: profileCoverage.slice(0, EXAMPLE_LIMIT),
        missingProfileSettings: missingSettings.slice(0, EXAMPLE_LIMIT),
        wrongStoredGrades: wrongStoredGrades.slice(0, EXAMPLE_LIMIT),
        unresolvedResults,
        intentionalGradingSubstitutions: intentionalGradingSubstitutions.slice(0, EXAMPLE_LIMIT),
        rankingConfigurationWarnings: rankingConfigurationWarnings.slice(0, EXAMPLE_LIMIT),
      },
      note: "No rows were changed. Dormant legacy profile rows are informational and do not block readiness. Temporarily excluded subjects are omitted from strict grading. Confirmed intentional grading substitutions are resolved explicitly and reported separately. Do not run the constraint-enforcement command until readyForConstraints is true, and do not deploy strict publication/ranking behavior until readyForDeployment is true.",
    };
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes("--fail-on-issues") && blockingIssueCount > 0) process.exitCode = 2;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
