import { and, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { db, pool } from "../server/db";
import { getProfileAwareGradeCandidates, parseFinitePercentage, resolveGradeForPercentage } from "../server/grade-resolution";
import {
  assessmentMarks,
  assessments,
  classes,
  exams,
  grades,
  schools,
  streams,
  subjects,
} from "../shared/schema";
import { resolveGradeProfileKey } from "../shared/academic-profiles";

type CliOptions = {
  apply: boolean;
  schoolId?: number;
  examId?: number;
  examName?: string;
  limit?: number;
};

function readNumberArg(args: string[], name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function readStringArg(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim();
  return raw || undefined;
}

function parseOptions(argv: string[]): CliOptions {
  return {
    apply: argv.includes("--apply"),
    schoolId: readNumberArg(argv, "school-id"),
    examId: readNumberArg(argv, "exam-id"),
    examName: readStringArg(argv, "exam-name"),
    limit: readNumberArg(argv, "limit"),
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const filters = [isNull(assessmentMarks.gradeId), isNotNull(assessmentMarks.percentage)];
  if (options.schoolId) filters.push(eq(schools.id, options.schoolId));
  if (options.examId) filters.push(eq(assessments.examId, options.examId));
  if (options.examName) filters.push(ilike(exams.examName, options.examName));

  const query = db
    .select({
      markId: assessmentMarks.id,
      percentage: assessmentMarks.percentage,
      markSchoolId: assessmentMarks.schoolId,
      assessmentId: assessments.id,
      assessmentSchoolId: assessments.schoolId,
      examId: assessments.examId,
      examName: exams.examName,
      classId: classes.id,
      classSchoolId: classes.schoolId,
      className: classes.className,
      streamName: streams.name,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectType: subjects.subjectType,
      schoolId: schools.id,
      schoolName: schools.name,
      schoolType: schools.schoolType,
      examinationBoard: schools.examinationBoard,
    })
    .from(assessmentMarks)
    .innerJoin(assessments, eq(assessmentMarks.assessmentId, assessments.id))
    .innerJoin(classes, eq(assessments.classId, classes.id))
    .innerJoin(subjects, eq(assessments.subjectId, subjects.id))
    .innerJoin(schools, eq(classes.schoolId, schools.id))
    .leftJoin(streams, eq(classes.streamId, streams.id))
    .leftJoin(exams, eq(assessments.examId, exams.id))
    .where(and(...filters))
    .orderBy(assessmentMarks.id);

  const allRows = await query;
  const rows = options.limit ? allRows.slice(0, options.limit) : allRows;
  const allGrades = await db.select().from(grades);
  const gradesBySchool = new Map<number, typeof allGrades>();
  for (const grade of allGrades) {
    const bucket = gradesBySchool.get(Number(grade.schoolId)) || [];
    bucket.push(grade);
    gradesBySchool.set(Number(grade.schoolId), bucket);
  }

  const summary = {
    scanned: rows.length,
    repairable: 0,
    updated: 0,
    invalidPercentage: 0,
    unresolvedProfile: 0,
    noMatchingGrade: 0,
    ambiguous: 0,
    inconsistentSchool: 0,
    exactProfileRepairs: 0,
    compatibleProfileRepairs: 0,
  };
  const unresolved: Array<Record<string, unknown>> = [];
  const repairs: Array<{ markId: number; gradeId: number }> = [];

  for (const row of rows) {
    const percentage = parseFinitePercentage(row.percentage);
    if (percentage === null) {
      summary.invalidPercentage++;
      unresolved.push({
        markId: row.markId,
        assessmentId: row.assessmentId,
        className: row.className,
        subjectName: row.subjectName,
        percentage: String(row.percentage),
        reason: "invalid_percentage",
      });
      continue;
    }

    const schoolIds = [row.markSchoolId, row.assessmentSchoolId, row.classSchoolId, row.schoolId]
      .filter((value): value is number => value !== null && value !== undefined)
      .map(Number);
    if (new Set(schoolIds).size > 1) {
      summary.inconsistentSchool++;
      unresolved.push({
        markId: row.markId,
        assessmentId: row.assessmentId,
        schoolIds,
        reason: "inconsistent_school_context",
      });
      continue;
    }

    const schoolId = Number(row.schoolId);
    const profileKey = resolveGradeProfileKey({
      schoolType: row.schoolType,
      examinationBoard: row.examinationBoard,
      streamName: row.streamName,
      subjectType: row.subjectType,
    });
    if (!profileKey) {
      summary.unresolvedProfile++;
      unresolved.push({
        markId: row.markId,
        assessmentId: row.assessmentId,
        schoolName: row.schoolName,
        className: row.className,
        streamName: row.streamName,
        subjectName: row.subjectName,
        percentage,
        reason: "profile_not_resolved",
      });
      continue;
    }

    const schoolGrades = gradesBySchool.get(schoolId) || [];
    const applicableGrades = getProfileAwareGradeCandidates(
      schoolGrades,
      profileKey,
      Number(row.classId),
    );
    const resolution = resolveGradeForPercentage(percentage, applicableGrades, row.subjectType);

    if (!resolution.grade) {
      summary.noMatchingGrade++;
      unresolved.push({
        markId: row.markId,
        assessmentId: row.assessmentId,
        schoolName: row.schoolName,
        className: row.className,
        subjectName: row.subjectName,
        subjectType: row.subjectType,
        percentage,
        profileKey,
        reason: "no_matching_grade",
      });
      continue;
    }

    if (resolution.ambiguous) {
      summary.ambiguous++;
      unresolved.push({
        markId: row.markId,
        assessmentId: row.assessmentId,
        schoolName: row.schoolName,
        className: row.className,
        subjectName: row.subjectName,
        percentage,
        profileKey,
        matchingGradeIds: resolution.matchingGradeIds,
        profileSource: resolution.profileSource,
        reason: "overlapping_grade_ranges",
      });
      continue;
    }

    summary.repairable++;
    if (resolution.profileSource === "compatible") {
      summary.compatibleProfileRepairs++;
    } else {
      summary.exactProfileRepairs++;
    }
    repairs.push({ markId: Number(row.markId), gradeId: Number(resolution.grade.id) });
  }

  if (options.apply && repairs.length > 0) {
    await db.transaction(async (tx) => {
      for (const repair of repairs) {
        const result = await tx
          .update(assessmentMarks)
          .set({ gradeId: repair.gradeId })
          .where(and(eq(assessmentMarks.id, repair.markId), isNull(assessmentMarks.gradeId)))
          .returning({ id: assessmentMarks.id });
        summary.updated += result.length;
      }
    });
  }

  console.log(`Mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Planned repairs: ${repairs.length}`);
  if (!options.apply && repairs.length > 0) {
    console.log("No database rows were changed. Re-run with --apply after reviewing this output.");
  }
  if (unresolved.length > 0) {
    console.log("Unresolved sample (maximum 50 rows):");
    console.table(unresolved.slice(0, 50));
  }
}

main()
  .catch((error) => {
    console.error("Grade backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
