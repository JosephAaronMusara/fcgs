import "dotenv/config";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { db, pool } from "../server/db";
import { assessmentMarks, assessments, assessmentTypes, exams } from "@shared/schema";
import {
  ASSESSMENT_CARDINALITY,
  bootstrapLegacyAssessmentTypePolicy,
  selectCanonicalAssessments,
} from "../server/assessment-policy";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Assessment policy ${apply ? "repair" : "preflight"}`);
  console.log(`Mode: ${apply ? "APPLY" : "READ ONLY"}`);

  const typeRows = await db.select().from(assessmentTypes);
  const typeById = new Map(typeRows.map((row) => [Number(row.id), row]));

  const typeChanges = typeRows.map((row) => {
    const inferred = bootstrapLegacyAssessmentTypePolicy(row);
    return {
      id: Number(row.id),
      name: row.name,
      before: {
        code: row.code || null,
        assessmentCardinality: row.assessmentCardinality || null,
        reportAggregationMode: row.reportAggregationMode || null,
      },
      after: inferred,
      changed:
        row.code !== inferred.code ||
        row.assessmentCardinality !== inferred.assessmentCardinality ||
        row.reportAggregationMode !== inferred.reportAggregationMode,
    };
  });

  if (apply) {
    await db.transaction(async (tx) => {
      for (const change of typeChanges) {
        if (!change.changed) continue;
        await tx
          .update(assessmentTypes)
          .set(change.after)
          .where(eq(assessmentTypes.id, change.id));
      }
    });
  }

  const [assessmentRows, examRows] = await Promise.all([
    db
      .select()
      .from(assessments)
      .where(isNotNull(assessments.examId)),
    db.select().from(exams),
  ]);
  const examById = new Map(examRows.map((row) => [Number(row.id), row]));
  const assessmentTypeLinkChanges = assessmentRows
    .map((assessment) => {
      const exam = assessment.examId ? examById.get(Number(assessment.examId)) : undefined;
      const examAssessmentTypeId = exam?.assessmentTypeId ? Number(exam.assessmentTypeId) : null;
      const currentAssessmentTypeId = assessment.assessmentTypeId ? Number(assessment.assessmentTypeId) : null;
      return {
        assessmentId: Number(assessment.id),
        currentAssessmentTypeId,
        examAssessmentTypeId,
        changed: examAssessmentTypeId !== null && examAssessmentTypeId !== currentAssessmentTypeId,
      };
    })
    .filter((change) => change.changed);

  if (apply && assessmentTypeLinkChanges.length > 0) {
    await db.transaction(async (tx) => {
      for (const change of assessmentTypeLinkChanges) {
        await tx
          .update(assessments)
          .set({ assessmentTypeId: change.examAssessmentTypeId })
          .where(eq(assessments.id, change.assessmentId));
      }
    });
  }
  const assessmentIds = assessmentRows.map((row) => Number(row.id));
  const markRows = assessmentIds.length
    ? await db
        .select({
          assessmentId: assessmentMarks.assessmentId,
          percentage: assessmentMarks.percentage,
          attStatus: assessmentMarks.attStatus,
        })
        .from(assessmentMarks)
        .where(inArray(assessmentMarks.assessmentId, assessmentIds))
    : [];

  const singleAssessments = assessmentRows.filter((assessment) => {
    const exam = assessment.examId ? examById.get(Number(assessment.examId)) : undefined;
    const sourceAssessmentTypeId = exam?.assessmentTypeId ?? assessment.assessmentTypeId;
    const type = sourceAssessmentTypeId
      ? typeById.get(Number(sourceAssessmentTypeId))
      : undefined;
    return bootstrapLegacyAssessmentTypePolicy(type).assessmentCardinality === ASSESSMENT_CARDINALITY.SINGLE_PER_EXAM;
  });

  const grouped = new Map<string, typeof singleAssessments>();
  for (const assessment of singleAssessments) {
    const key = `${Number(assessment.examId)}:${Number(assessment.classId)}:${Number(assessment.subjectId)}`;
    const bucket = grouped.get(key) || [];
    bucket.push(assessment);
    grouped.set(key, bucket);
  }

  const duplicateGroups: Array<{
    examId: number;
    classId: number;
    subjectId: number;
    assessmentIds: number[];
    canonicalAssessmentId: number;
  }> = [];
  const canonicalIds = new Set<number>();

  for (const bucket of grouped.values()) {
    const selected = selectCanonicalAssessments(bucket, markRows).assessments[0];
    if (!selected) continue;
    canonicalIds.add(Number(selected.id));
    if (bucket.length > 1) {
      duplicateGroups.push({
        examId: Number(selected.examId),
        classId: Number(selected.classId),
        subjectId: Number(selected.subjectId),
        assessmentIds: bucket.map((row) => Number(row.id)).sort((a, b) => a - b),
        canonicalAssessmentId: Number(selected.id),
      });
    }
  }

  if (apply) {
    await db.transaction(async (tx) => {
      // Clear the derived flag first so existing legacy duplicates cannot make the
      // partial unique index fail while the canonical rows are selected.
      await tx.update(assessments).set({ enforceExamUniqueness: false });
      if (canonicalIds.size > 0) {
        await tx
          .update(assessments)
          .set({ enforceExamUniqueness: true })
          .where(inArray(assessments.id, Array.from(canonicalIds)));
      }
    });
  }

  const result = {
    assessmentTypes: typeRows.length,
    assessmentTypeChanges: typeChanges.filter((change) => change.changed),
    assessmentTypeLinkChanges,
    singlePerExamAssessments: singleAssessments.length,
    canonicalRowsProtected: canonicalIds.size,
    legacyDuplicateGroups: duplicateGroups,
    legacyDuplicateAssessmentCount: duplicateGroups.reduce(
      (total, group) => total + Math.max(0, group.assessmentIds.length - 1),
      0,
    ),
    mode: apply ? "APPLY" : "READ_ONLY",
    note:
      duplicateGroups.length > 0
        ? "Legacy duplicates were not deleted. The best-covered row is protected and the remaining rows require deliberate review."
        : "No legacy duplicate groups were found for single-per-exam assessment types.",
  };

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
