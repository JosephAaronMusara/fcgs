import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  assessmentComments,
  assessmentMarkPapers,
  assessmentMarks,
  assessmentPapers,
  assessments,
  classes,
  grades,
  schools,
  streams,
  subjects,
} from "@shared/schema";
import { getProfileAwareGradeCandidates, resolveGradeForPercentage } from "./grade-resolution";
import { resolveOperationalGradeProfile } from "@shared/academic-profiles";
import { isTemporarilyExcludedFromStrictGrading } from "./grading-exclusions";
import { calculateWeightedAssessmentResult } from "./assessment-paper-calculation";
import { acquireAssessmentMutationLock } from "./assessment-mutation-lock";

export type AssessmentPaperInput = {
  id?: number;
  paperName: string;
  paperMarks: number;
  paperWeightPct: string;
  sortOrder?: number;
};

export type AssessmentPaperRecalculationSummary = {
  totalMarks: number;
  recalculatedMarks: number;
  incompleteMarks: number;
  unchangedMarks: number;
  addedPaperIds: number[];
  removedPaperIds: number[];
  removedPaperMarkCount: number;
  configurationChanged: boolean;
  resultAffectingChange: boolean;
  recalculationPerformed: boolean;
};

export type AssessmentPaperReconciliationResult = {
  assessment: typeof assessments.$inferSelect;
  papers: Array<typeof assessmentPapers.$inferSelect>;
  summary: AssessmentPaperRecalculationSummary;
  beforePapers: Array<typeof assessmentPapers.$inferSelect>;
};

export class AssessmentPaperReconciliationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AssessmentPaperReconciliationError";
  }
}

function validatePaperInputs(papers: AssessmentPaperInput[]) {
  if (!Array.isArray(papers) || papers.length === 0) {
    throw new AssessmentPaperReconciliationError(
      400,
      "ASSESSMENT_PAPERS_INVALID",
      "At least one paper is required.",
    );
  }

  const names = new Set<string>();
  let totalWeight = 0;
  for (let index = 0; index < papers.length; index += 1) {
    const paper = papers[index];
    const name = String(paper.paperName || "").trim();
    const maximum = Number(paper.paperMarks);
    const weight = Number(paper.paperWeightPct);
    const normalizedName = name.toLowerCase();

    if (!name) {
      throw new AssessmentPaperReconciliationError(400, "ASSESSMENT_PAPERS_INVALID", `Paper ${index + 1} requires a name.`);
    }
    if (names.has(normalizedName)) {
      throw new AssessmentPaperReconciliationError(400, "ASSESSMENT_PAPERS_INVALID", `Paper names must be unique. "${name}" is repeated.`);
    }
    names.add(normalizedName);
    if (!Number.isInteger(maximum) || maximum <= 0) {
      throw new AssessmentPaperReconciliationError(400, "ASSESSMENT_PAPERS_INVALID", `${name} must have a positive whole-number maximum mark.`);
    }
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
      throw new AssessmentPaperReconciliationError(400, "ASSESSMENT_PAPERS_INVALID", `${name} must have a weight greater than 0% and not more than 100%.`);
    }
    totalWeight += weight;
  }

  if (Math.abs(totalWeight - 100) >= 0.01) {
    throw new AssessmentPaperReconciliationError(
      400,
      "ASSESSMENT_PAPERS_INVALID",
      `Paper weights must total exactly 100% (currently ${totalWeight.toFixed(2)}%).`,
    );
  }
}


function statusOnlyComment(status: unknown): string | null {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "absent") return "Absent";
  if (normalized === "sick") return "Sick";
  if (normalized === "excused") return "Excused";
  return null;
}

function paperConfigurationChanged(
  before: Array<typeof assessmentPapers.$inferSelect>,
  after: Array<typeof assessmentPapers.$inferSelect>,
): boolean {
  if (before.length !== after.length) return true;
  const beforeById = new Map(before.map((paper) => [Number(paper.id), paper]));
  return after.some((paper) => {
    const previous = beforeById.get(Number(paper.id));
    if (!previous) return true;
    return (
      String(previous.paperName) !== String(paper.paperName) ||
      Number(previous.paperMarks) !== Number(paper.paperMarks) ||
      Number(previous.paperWeightPct) !== Number(paper.paperWeightPct) ||
      Number(previous.sortOrder || 0) !== Number(paper.sortOrder || 0)
    );
  });
}

async function loadGradingContext(
  tx: any,
  args: { schoolId: number; classId: number; subjectId: number },
) {
  const [[school], [classInfo], [subject], allGrades, comments] = await Promise.all([
    tx.select().from(schools).where(eq(schools.id, args.schoolId)).limit(1),
    tx.select().from(classes).where(eq(classes.id, args.classId)).limit(1),
    tx.select().from(subjects).where(eq(subjects.id, args.subjectId)).limit(1),
    tx.select().from(grades).where(eq(grades.schoolId, args.schoolId)),
    tx.select().from(assessmentComments).where(and(
      eq(assessmentComments.classId, args.classId),
      eq(assessmentComments.subjectId, args.subjectId),
    )),
  ]);

  if (!school || !classInfo || !subject) {
    throw new AssessmentPaperReconciliationError(
      422,
      "ASSESSMENT_GRADING_CONTEXT_MISSING",
      "The school, class, or subject grading context could not be loaded.",
    );
  }

  const [stream] = classInfo.streamId
    ? await tx.select().from(streams).where(eq(streams.id, classInfo.streamId)).limit(1)
    : [];
  const excluded = isTemporarilyExcludedFromStrictGrading(subject);
  const operationalProfile = excluded
    ? { profileKey: null, effectiveSubjectType: null, substitutionPolicy: null }
    : resolveOperationalGradeProfile({
        schoolType: school.schoolType,
        examinationBoard: school.examinationBoard,
        streamName: stream?.name || null,
        subjectType: subject.subjectType,
        subjectName: subject.name,
      });
  const applicableGrades = operationalProfile.profileKey
    ? getProfileAwareGradeCandidates(allGrades, operationalProfile.profileKey, args.classId)
    : [];
  const commentByGradeId = new Map(comments.map((comment: any) => [Number(comment.gradeId), comment]));

  return {
    profileKey: operationalProfile.profileKey,
    gradingSubjectType: operationalProfile.effectiveSubjectType,
    substitutionPolicy: operationalProfile.substitutionPolicy,
    subject,
    applicableGrades,
    commentByGradeId,
    excluded,
  };
}

export async function reconcileAssessmentPapersAndMarks(args: {
  assessmentId: number;
  papers: AssessmentPaperInput[];
  assessmentPatch?: Record<string, unknown>;
  schoolId: number;
  classId: number;
  subjectId: number;
  confirmPaperRemoval?: boolean;
  forceRecalculate?: boolean;
}): Promise<AssessmentPaperReconciliationResult> {
  validatePaperInputs(args.papers);
  const releaseMutationLock = await acquireAssessmentMutationLock(args.assessmentId);
  try {
    return await db.transaction(async (tx) => {
      const [currentAssessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, args.assessmentId))
      .limit(1);

    if (!currentAssessment || Number(currentAssessment.schoolId) !== Number(args.schoolId)) {
      throw new AssessmentPaperReconciliationError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
    }

    const beforePapers = await tx
      .select()
      .from(assessmentPapers)
      .where(eq(assessmentPapers.assessmentId, args.assessmentId));
    const existingById = new Map(beforePapers.map((paper) => [Number(paper.id), paper]));
    const incomingIds = new Set<number>();

    for (const paper of args.papers) {
      if (paper.id === undefined) continue;
      const paperId = Number(paper.id);
      if (!Number.isInteger(paperId) || paperId <= 0 || !existingById.has(paperId)) {
        throw new AssessmentPaperReconciliationError(
          400,
          "ASSESSMENT_PAPER_ID_INVALID",
          "One or more paper IDs do not belong to this assessment.",
          { paperId },
        );
      }
      if (incomingIds.has(paperId)) {
        throw new AssessmentPaperReconciliationError(
          400,
          "ASSESSMENT_PAPER_ID_DUPLICATE",
          "The same paper was submitted more than once.",
          { paperId },
        );
      }
      incomingIds.add(paperId);
    }

    const existingMarks = await tx
      .select()
      .from(assessmentMarks)
      .where(eq(assessmentMarks.assessmentId, args.assessmentId));

    if (existingMarks.length > 0 && (
      Number(currentAssessment.classId) !== Number(args.classId) ||
      Number(currentAssessment.subjectId) !== Number(args.subjectId)
    )) {
      throw new AssessmentPaperReconciliationError(
        409,
        "ASSESSMENT_CONTEXT_CHANGE_BLOCKED",
        "The class or subject cannot be changed after learner marks have been entered. Create a new assessment instead.",
        { markCount: existingMarks.length },
      );
    }

    const removedPapers = beforePapers.filter((paper) => !incomingIds.has(Number(paper.id)));
    const removedPaperIds = removedPapers.map((paper) => Number(paper.id));
    let removedPaperMarkCount = 0;

    if (removedPaperIds.length > 0) {
      const removedRows = await tx
        .select({ id: assessmentMarkPapers.id })
        .from(assessmentMarkPapers)
        .where(inArray(assessmentMarkPapers.assessmentPaperId, removedPaperIds));
      removedPaperMarkCount = removedRows.length;

      if (removedPaperMarkCount > 0 && !args.confirmPaperRemoval) {
        throw new AssessmentPaperReconciliationError(
          409,
          "ASSESSMENT_PAPER_REMOVAL_CONFIRMATION_REQUIRED",
          `Removing ${removedPapers.length} paper(s) will permanently remove ${removedPaperMarkCount} saved learner paper mark(s). Confirm the removal to continue.`,
          {
            removedPaperIds,
            removedPaperNames: removedPapers.map((paper) => paper.paperName),
            removedPaperMarkCount,
          },
        );
      }
    }

    const resultAffectingChange = removedPaperIds.length > 0
      || args.papers.some((paper) => {
        if (paper.id === undefined) return true;
        const previous = existingById.get(Number(paper.id));
        return !previous
          || Number(previous.paperMarks) !== Number(paper.paperMarks)
          || Number(previous.paperWeightPct) !== Number(paper.paperWeightPct);
      });

    for (let index = 0; index < args.papers.length; index += 1) {
      const paper = args.papers[index];
      if (paper.id === undefined) continue;
      await tx
        .update(assessmentPapers)
        .set({
          paperName: paper.paperName,
          paperMarks: paper.paperMarks,
          paperWeightPct: paper.paperWeightPct,
          sortOrder: index,
        })
        .where(and(
          eq(assessmentPapers.id, Number(paper.id)),
          eq(assessmentPapers.assessmentId, args.assessmentId),
        ));
    }

    const newPapers = args.papers
      .map((paper, index) => ({ paper, index }))
      .filter(({ paper }) => paper.id === undefined);
    const insertedPapers = newPapers.length > 0
      ? await tx.insert(assessmentPapers).values(newPapers.map(({ paper, index }) => ({
          assessmentId: args.assessmentId,
          paperName: paper.paperName,
          paperMarks: paper.paperMarks,
          paperWeightPct: paper.paperWeightPct,
          sortOrder: index,
        }))).returning()
      : [];

    if (removedPaperIds.length > 0) {
      await tx.delete(assessmentMarkPapers).where(inArray(assessmentMarkPapers.assessmentPaperId, removedPaperIds));
      await tx.delete(assessmentPapers).where(and(
        eq(assessmentPapers.assessmentId, args.assessmentId),
        inArray(assessmentPapers.id, removedPaperIds),
      ));
    }

    const currentPapers = await tx
      .select()
      .from(assessmentPapers)
      .where(eq(assessmentPapers.assessmentId, args.assessmentId))
      .orderBy(assessmentPapers.sortOrder, assessmentPapers.id);

    const recalculationPerformed = (resultAffectingChange || args.forceRecalculate === true) && existingMarks.length > 0;
    let recalculatedMarks = 0;
    let incompleteMarks = 0;
    let unchangedMarks = existingMarks.length;

    if (recalculationPerformed) {
      unchangedMarks = 0;
      const gradingContext = await loadGradingContext(tx, {
        schoolId: args.schoolId,
        classId: args.classId,
        subjectId: args.subjectId,
      });
  
      const markIds = existingMarks.map((mark) => Number(mark.id));
      const allPaperMarks = markIds.length > 0
        ? await tx
            .select()
            .from(assessmentMarkPapers)
            .where(inArray(assessmentMarkPapers.assessmentMarkId, markIds))
        : [];
      const paperMarksByMarkId = new Map<number, Array<typeof assessmentMarkPapers.$inferSelect>>();
      for (const row of allPaperMarks) {
        const markId = Number(row.assessmentMarkId);
        const rows = paperMarksByMarkId.get(markId) || [];
        rows.push(row);
        paperMarksByMarkId.set(markId, rows);
      }
  
      for (const mark of existingMarks) {
        const calculation = calculateWeightedAssessmentResult(
          currentPapers.map((paper) => ({
            id: Number(paper.id),
            paperName: paper.paperName,
            paperMarks: Number(paper.paperMarks),
            paperWeightPct: paper.paperWeightPct,
          })),
          (paperMarksByMarkId.get(Number(mark.id)) || []).map((paperMark) => ({
            assessmentPaperId: Number(paperMark.assessmentPaperId),
            markObtained: paperMark.markObtained,
          })),
        );
  
        if (calculation.duplicatePaperIds.length > 0) {
          throw new AssessmentPaperReconciliationError(
            409,
            "ASSESSMENT_PAPER_MARK_DUPLICATES",
            "Duplicate paper marks were found for a learner. Repair the duplicate rows before changing paper configuration.",
            { assessmentMarkId: mark.id, paperIds: calculation.duplicatePaperIds },
          );
        }
        if (calculation.unknownPaperIds.length > 0) {
          throw new AssessmentPaperReconciliationError(
            409,
            "ASSESSMENT_PAPER_MARK_ORPHANS",
            "Paper marks linked to an unknown assessment paper were found.",
            { assessmentMarkId: mark.id, paperIds: calculation.unknownPaperIds },
          );
        }
        if (calculation.marksOverMaximum.length > 0) {
          throw new AssessmentPaperReconciliationError(
            409,
            "ASSESSMENT_PAPER_MAXIMUM_TOO_LOW",
            "A paper maximum cannot be reduced below a learner mark that has already been entered.",
            { assessmentMarkId: mark.id, invalidMarks: calculation.marksOverMaximum },
          );
        }
  
        const statusComment = statusOnlyComment(mark.attStatus);
        const effectivePercentage = statusComment ? null : calculation.percentage;
        let gradeId: number | null = null;
        let commentId: number | null = null;
        let autoCommentSnapshot: string | null = null;
        let customCommentText = mark.customCommentText;
        let commentSource: "pool" | "custom" = mark.commentSource === "custom" && !!String(mark.customCommentText || "").trim()
          ? "custom"
          : "pool";
  
        if (statusComment) {
          autoCommentSnapshot = statusComment;
          customCommentText = null;
          commentSource = "pool";
          incompleteMarks += 1;
        } else if (effectivePercentage !== null && gradingContext.excluded) {
          gradeId = mark.gradeId === null ? null : Number(mark.gradeId);
          commentId = mark.commentId === null ? null : Number(mark.commentId);
          autoCommentSnapshot = mark.autoCommentSnapshot;
          customCommentText = mark.customCommentText;
          commentSource = mark.commentSource === "custom" && !!String(mark.customCommentText || "").trim()
            ? "custom"
            : "pool";
          recalculatedMarks += 1;
        } else if (effectivePercentage !== null) {
          const gradeResolution = resolveGradeForPercentage(
            effectivePercentage,
            gradingContext.applicableGrades,
            gradingContext.gradingSubjectType || gradingContext.subject.subjectType,
          );
          if (!gradeResolution.grade || gradeResolution.ambiguous) {
            throw new AssessmentPaperReconciliationError(
              422,
              "GRADE_CONFIGURATION_INVALID",
              gradeResolution.ambiguous
                ? `The recalculated mark ${calculation.percentage}% matches overlapping grade ranges.`
                : `No grade is configured for the recalculated mark ${calculation.percentage}%.`,
              {
                assessmentMarkId: mark.id,
                studentId: mark.studentId,
                percentage: effectivePercentage,
                profileKey: gradingContext.profileKey,
                matchingGradeIds: gradeResolution.matchingGradeIds,
              },
            );
          }
          gradeId = Number(gradeResolution.grade.id);
          const poolComment = gradingContext.commentByGradeId.get(gradeId);
          autoCommentSnapshot = poolComment?.commentText || null;
          if (commentSource === "pool") {
            commentId = poolComment?.id || null;
            customCommentText = null;
          }
          recalculatedMarks += 1;
        } else {
          if (commentSource === "pool") customCommentText = null;
          incompleteMarks += 1;
        }
  
        const nextPercentage = effectivePercentage === null ? null : String(effectivePercentage);
        const changed = (
          (mark.percentage === null ? null : Number(mark.percentage)) !== effectivePercentage ||
          (mark.gradeId === null ? null : Number(mark.gradeId)) !== gradeId ||
          (mark.commentId === null ? null : Number(mark.commentId)) !== commentId ||
          String(mark.autoCommentSnapshot || "") !== String(autoCommentSnapshot || "") ||
          String(mark.customCommentText || "") !== String(customCommentText || "") ||
          String(mark.commentSource || "pool") !== commentSource
        );
        if (!changed) unchangedMarks += 1;
  
        await tx
          .update(assessmentMarks)
          .set({
            schoolId: args.schoolId,
            classId: args.classId,
            subjectId: args.subjectId,
            percentage: nextPercentage,
            gradeId,
            commentId,
            customCommentText,
            autoCommentSnapshot,
            commentSource,
          })
          .where(eq(assessmentMarks.id, mark.id));
      }
    }
    const [updatedAssessment] = args.assessmentPatch
      ? await tx
          .update(assessments)
          .set(args.assessmentPatch as any)
          .where(eq(assessments.id, args.assessmentId))
          .returning()
      : [currentAssessment];

    if (!updatedAssessment) {
      throw new AssessmentPaperReconciliationError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
    }

    return {
      assessment: updatedAssessment,
      papers: currentPapers,
      beforePapers,
      summary: {
        totalMarks: existingMarks.length,
        recalculatedMarks,
        incompleteMarks,
        unchangedMarks,
        addedPaperIds: insertedPapers.map((paper) => Number(paper.id)),
        removedPaperIds,
        removedPaperMarkCount,
        configurationChanged: paperConfigurationChanged(beforePapers, currentPapers),
        resultAffectingChange,
        recalculationPerformed,
      },
      };
    });
  } finally {
    releaseMutationLock();
  }
}

export async function analyzeAssessmentPaperState(assessmentId: number) {
  const [assessment] = await db.select().from(assessments).where(eq(assessments.id, assessmentId)).limit(1);
  if (!assessment) {
    throw new AssessmentPaperReconciliationError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
  }
  const papers = await db.select().from(assessmentPapers).where(eq(assessmentPapers.assessmentId, assessmentId));
  const marks = await db.select().from(assessmentMarks).where(eq(assessmentMarks.assessmentId, assessmentId));
  const markIds = marks.map((mark) => Number(mark.id));
  const paperMarks = markIds.length > 0
    ? await db.select().from(assessmentMarkPapers).where(inArray(assessmentMarkPapers.assessmentMarkId, markIds))
    : [];
  const byMarkId = new Map<number, Array<typeof assessmentMarkPapers.$inferSelect>>();
  for (const row of paperMarks) {
    const rows = byMarkId.get(Number(row.assessmentMarkId)) || [];
    rows.push(row);
    byMarkId.set(Number(row.assessmentMarkId), rows);
  }

  const totalWeight = papers.reduce((sum, paper) => sum + Number(paper.paperWeightPct), 0);
  const invalidPaperConfiguration = papers.length === 0
    || papers.some((paper) => !Number.isInteger(Number(paper.paperMarks)) || Number(paper.paperMarks) <= 0 || !Number.isFinite(Number(paper.paperWeightPct)) || Number(paper.paperWeightPct) <= 0)
    || Math.abs(totalWeight - 100) >= 0.01;
  let stalePercentageCount = 0;
  let incompleteWithStoredResultCount = 0;
  let invalidPaperMarkCount = 0;
  for (const mark of marks) {
    const result = calculateWeightedAssessmentResult(
      papers.map((paper) => ({
        id: Number(paper.id),
        paperName: paper.paperName,
        paperMarks: Number(paper.paperMarks),
        paperWeightPct: paper.paperWeightPct,
      })),
      (byMarkId.get(Number(mark.id)) || []).map((row) => ({
        assessmentPaperId: Number(row.assessmentPaperId),
        markObtained: row.markObtained,
      })),
    );
    if (result.marksOverMaximum.length > 0 || result.duplicatePaperIds.length > 0 || result.unknownPaperIds.length > 0) {
      invalidPaperMarkCount += 1;
    }
    const stored = mark.percentage === null ? null : Number(mark.percentage);
    if (result.percentage === null && stored !== null) incompleteWithStoredResultCount += 1;
    if (result.percentage !== null && stored !== result.percentage) stalePercentageCount += 1;
  }

  return {
    assessment,
    papers,
    markCount: marks.length,
    stalePercentageCount,
    incompleteWithStoredResultCount,
    invalidPaperMarkCount,
    invalidPaperConfiguration,
  };
}
