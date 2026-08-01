export type WeightedPaperDefinition = {
  id: number;
  paperName?: string | null;
  paperMarks: number;
  paperWeightPct: number | string;
};

export type WeightedPaperMark = {
  assessmentPaperId: number;
  markObtained: number | string | null;
};

export type WeightedAssessmentResult = {
  complete: boolean;
  hasAnyMark: boolean;
  percentage: number | null;
  duplicatePaperIds: number[];
  unknownPaperIds: number[];
  marksOverMaximum: Array<{
    paperId: number;
    paperName: string;
    markObtained: number;
    paperMarks: number;
  }>;
};

function parseMark(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateWeightedAssessmentResult(
  papers: WeightedPaperDefinition[],
  markRows: WeightedPaperMark[],
): WeightedAssessmentResult {
  const paperById = new Map(papers.map((paper) => [Number(paper.id), paper]));
  const markByPaperId = new Map<number, number | null>();
  const duplicatePaperIds = new Set<number>();
  const unknownPaperIds = new Set<number>();

  for (const row of markRows) {
    const paperId = Number(row.assessmentPaperId);
    if (!paperById.has(paperId)) {
      unknownPaperIds.add(paperId);
      continue;
    }
    if (markByPaperId.has(paperId)) duplicatePaperIds.add(paperId);
    markByPaperId.set(paperId, parseMark(row.markObtained));
  }

  const marksOverMaximum: WeightedAssessmentResult["marksOverMaximum"] = [];
  let totalWeightedScore = 0;
  let hasAnyMark = false;
  let complete = papers.length > 0;

  for (const paper of papers) {
    const paperId = Number(paper.id);
    const maximum = Number(paper.paperMarks);
    const weight = Number(paper.paperWeightPct);
    const mark = markByPaperId.get(paperId) ?? null;

    if (mark === null) {
      complete = false;
      continue;
    }

    hasAnyMark = true;
    if (mark < 0 || mark > maximum) {
      marksOverMaximum.push({
        paperId,
        paperName: String(paper.paperName || `Paper ${paperId}`),
        markObtained: mark,
        paperMarks: maximum,
      });
      continue;
    }

    totalWeightedScore += ((mark / maximum) * 100 * weight) / 100;
  }

  if (duplicatePaperIds.size > 0 || unknownPaperIds.size > 0 || marksOverMaximum.length > 0) {
    complete = false;
  }

  return {
    complete,
    hasAnyMark,
    percentage: complete ? Math.round(totalWeightedScore) : null,
    duplicatePaperIds: Array.from(duplicatePaperIds),
    unknownPaperIds: Array.from(unknownPaperIds),
    marksOverMaximum,
  };
}
