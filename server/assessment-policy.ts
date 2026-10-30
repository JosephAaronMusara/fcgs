export const ASSESSMENT_CARDINALITY = {
  SINGLE_PER_EXAM: "single_per_exam",
  MULTIPLE_PER_EXAM: "multiple_per_exam",
} as const;

export const REPORT_AGGREGATION_MODE = {
  SINGLE: "single",
  BEST_COVERAGE: "best_coverage",
} as const;

export type AssessmentCardinality =
  (typeof ASSESSMENT_CARDINALITY)[keyof typeof ASSESSMENT_CARDINALITY];

export type ReportAggregationMode =
  (typeof REPORT_AGGREGATION_MODE)[keyof typeof REPORT_AGGREGATION_MODE];

const SINGLE_ASSESSMENT_TYPE_CODE_BY_NAME = new Map<string, string>([
  ["end of term exam", "END_OF_TERM_EXAM"],
  ["mock exam", "MOCK_EXAM"],
  ["monthly test", "MONTHLY_TEST"],
  ["fortnight test", "FORTNIGHT_TEST"],
  ["end of vacation exam", "END_OF_VACATION_EXAM"],
]);

export function normalizeAssessmentTypeName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ");
}

export function assessmentTypeCodeFromName(value: unknown): string {
  const normalized = normalizeAssessmentTypeName(value);
  if (!normalized) return "ASSESSMENT";
  return normalized.replace(/\s+/g, "_").toUpperCase();
}

export function inferAssessmentTypePolicy(type: {
  name?: string | null;
  code?: string | null;
  assessmentCardinality?: string | null;
  reportAggregationMode?: string | null;
} | null | undefined): {
  code: string;
  assessmentCardinality: AssessmentCardinality;
  reportAggregationMode: ReportAggregationMode;
} {
  const code = String(type?.code || assessmentTypeCodeFromName(type?.name)).trim().toUpperCase();
  const explicitCardinality = String(type?.assessmentCardinality || "").trim();
  const assessmentCardinality: AssessmentCardinality =
    explicitCardinality === ASSESSMENT_CARDINALITY.SINGLE_PER_EXAM
      ? ASSESSMENT_CARDINALITY.SINGLE_PER_EXAM
      : ASSESSMENT_CARDINALITY.MULTIPLE_PER_EXAM;

  const explicitAggregation = String(type?.reportAggregationMode || "").trim();
  const reportAggregationMode: ReportAggregationMode =
    assessmentCardinality === ASSESSMENT_CARDINALITY.SINGLE_PER_EXAM
      ? REPORT_AGGREGATION_MODE.SINGLE
      : explicitAggregation === REPORT_AGGREGATION_MODE.SINGLE
        ? REPORT_AGGREGATION_MODE.SINGLE
        : REPORT_AGGREGATION_MODE.BEST_COVERAGE;

  return { code, assessmentCardinality, reportAggregationMode };
}

/**
 * One-time compatibility mapping for databases created before assessment type
 * cardinality was stored explicitly. Runtime creation and validation do not
 * depend on assessment type names; the repair script persists this result.
 */
export function bootstrapLegacyAssessmentTypePolicy(type: {
  name?: string | null;
  code?: string | null;
  assessmentCardinality?: string | null;
  reportAggregationMode?: string | null;
} | null | undefined): ReturnType<typeof inferAssessmentTypePolicy> {
  if (type?.assessmentCardinality) return inferAssessmentTypePolicy(type);

  const normalizedName = normalizeAssessmentTypeName(type?.name);
  const knownSingleCode = SINGLE_ASSESSMENT_TYPE_CODE_BY_NAME.get(normalizedName);
  if (!knownSingleCode) return inferAssessmentTypePolicy(type);

  return {
    code: String(type?.code || knownSingleCode).trim().toUpperCase(),
    assessmentCardinality: ASSESSMENT_CARDINALITY.SINGLE_PER_EXAM,
    reportAggregationMode: REPORT_AGGREGATION_MODE.SINGLE,
  };
}

export function isSinglePerExamAssessmentType(type: {
  name?: string | null;
  code?: string | null;
  assessmentCardinality?: string | null;
} | null | undefined): boolean {
  return inferAssessmentTypePolicy(type).assessmentCardinality === ASSESSMENT_CARDINALITY.SINGLE_PER_EXAM;
}

export type CanonicalAssessment = {
  id: number;
  classId: number | null;
  subjectId: number;
  examId?: number | null;
};

export type AssessmentMarkCoverage = {
  assessmentId: number;
  percentage?: unknown;
  attStatus?: unknown;
};

function markCountsAsCoverage(mark: AssessmentMarkCoverage): boolean {
  if (mark.percentage !== null && mark.percentage !== undefined && String(mark.percentage).trim() !== "") {
    return true;
  }
  const status = String(mark.attStatus || "").trim().toLowerCase();
  return status === "absent" || status === "sick" || status === "excused";
}

export function selectCanonicalAssessments<T extends CanonicalAssessment>(
  assessments: T[],
  marks: AssessmentMarkCoverage[],
): {
  assessments: T[];
  duplicatesByClassSubject: Map<string, T[]>;
} {
  const coverageByAssessment = new Map<number, number>();
  for (const mark of marks) {
    if (!markCountsAsCoverage(mark)) continue;
    const assessmentId = Number(mark.assessmentId);
    coverageByAssessment.set(assessmentId, (coverageByAssessment.get(assessmentId) || 0) + 1);
  }

  const grouped = new Map<string, T[]>();
  for (const assessment of assessments) {
    const key = `${Number(assessment.classId || 0)}:${Number(assessment.subjectId)}`;
    const bucket = grouped.get(key) || [];
    bucket.push(assessment);
    grouped.set(key, bucket);
  }

  const selected: T[] = [];
  const duplicatesByClassSubject = new Map<string, T[]>();

  for (const [key, bucket] of grouped) {
    const ordered = [...bucket].sort((a, b) => {
      const coverageDifference =
        (coverageByAssessment.get(Number(b.id)) || 0) -
        (coverageByAssessment.get(Number(a.id)) || 0);
      if (coverageDifference !== 0) return coverageDifference;
      return Number(b.id) - Number(a.id);
    });
    selected.push(ordered[0]);
    if (ordered.length > 1) duplicatesByClassSubject.set(key, ordered);
  }

  return {
    assessments: selected.sort((a, b) => {
      const classDifference = Number(a.classId || 0) - Number(b.classId || 0);
      if (classDifference !== 0) return classDifference;
      const subjectDifference = Number(a.subjectId) - Number(b.subjectId);
      if (subjectDifference !== 0) return subjectDifference;
      return Number(a.id) - Number(b.id);
    }),
    duplicatesByClassSubject,
  };
}
