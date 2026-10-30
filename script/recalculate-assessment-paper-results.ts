import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { assessmentPapers, assessments } from "@shared/schema";
import {
  analyzeAssessmentPaperState,
  AssessmentPaperReconciliationError,
  reconcileAssessmentPapersAndMarks,
} from "../server/assessment-paper-reconciliation";

function parseAssessmentId(): number | null {
  const argument = process.argv.find((item) => item.startsWith("--assessment-id="));
  if (!argument) return null;
  const value = Number(argument.split("=")[1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("--assessment-id must be a positive integer");
  }
  return value;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const allowAll = process.argv.includes("--all");
  const assessmentId = parseAssessmentId();

  if (apply && !assessmentId && !allowAll) {
    throw new Error("Apply mode requires --assessment-id=<id> or the explicit --all flag");
  }

  const rows = assessmentId
    ? await db.select().from(assessments).where(eq(assessments.id, assessmentId))
    : await db.select().from(assessments);

  console.log(`Assessment paper result ${apply ? "repair" : "preflight"}`);
  console.log(`Mode: ${apply ? "APPLY" : "READ ONLY"}`);
  console.log(`Assessments selected: ${rows.length}`);

  let staleAssessments = 0;
  let failedAssessments = 0;
  let repairedAssessments = 0;

  for (const assessment of rows) {
    try {
      const state = await analyzeAssessmentPaperState(Number(assessment.id));
      const staleCount = state.stalePercentageCount + state.incompleteWithStoredResultCount;
      const hasIssues = staleCount > 0 || state.invalidPaperMarkCount > 0 || state.invalidPaperConfiguration;
      if (hasIssues) staleAssessments += 1;

      console.log(JSON.stringify({
        assessmentId: assessment.id,
        topic: assessment.topic,
        markCount: state.markCount,
        stalePercentageCount: state.stalePercentageCount,
        incompleteWithStoredResultCount: state.incompleteWithStoredResultCount,
        invalidPaperMarkCount: state.invalidPaperMarkCount,
        invalidPaperConfiguration: state.invalidPaperConfiguration,
        status: hasIssues ? "ATTENTION" : "OK",
      }));

      if (!apply || !hasIssues) continue;
      if (state.invalidPaperMarkCount > 0 || state.invalidPaperConfiguration) {
        console.error(`Assessment ${assessment.id} was not repaired because invalid paper configuration or mark rows require manual review.`);
        failedAssessments += 1;
        continue;
      }
      if (!assessment.schoolId) {
        console.error(`Assessment ${assessment.id} was not repaired because it has no school ID.`);
        failedAssessments += 1;
        continue;
      }

      const papers = await db.select().from(assessmentPapers).where(eq(assessmentPapers.assessmentId, assessment.id));
      const result = await reconcileAssessmentPapersAndMarks({
        assessmentId: Number(assessment.id),
        papers: papers.map((paper) => ({
          id: Number(paper.id),
          paperName: paper.paperName,
          paperMarks: Number(paper.paperMarks),
          paperWeightPct: String(paper.paperWeightPct),
          sortOrder: paper.sortOrder || 0,
        })),
        schoolId: Number(assessment.schoolId),
        classId: Number(assessment.classId),
        subjectId: Number(assessment.subjectId),
        forceRecalculate: true,
      });
      repairedAssessments += 1;
      console.log(`Repaired assessment ${assessment.id}: ${JSON.stringify(result.summary)}`);
    } catch (error) {
      failedAssessments += 1;
      if (error instanceof AssessmentPaperReconciliationError) {
        console.error(`Assessment ${assessment.id} failed [${error.code}]: ${error.message}`);
      } else {
        console.error(`Assessment ${assessment.id} failed:`, error);
      }
    }
  }

  console.log(JSON.stringify({
    selectedAssessments: rows.length,
    staleAssessments,
    repairedAssessments,
    failedAssessments,
    mode: apply ? "APPLY" : "READ_ONLY",
  }, null, 2));

  if (failedAssessments > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
