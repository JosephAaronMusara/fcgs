import { isSubjectTypeCompatibleWithGradeType } from "@shared/academic-profiles";

export type GradeLike = {
  id: number;
  gradeName?: string | null;
  lowerLimit: number | string;
  upperLimit: number | string;
  gradeType?: string | null;
};

export type GradeResolution<T extends GradeLike> = {
  grade: T | null;
  ambiguous: boolean;
  matchingGradeIds: number[];
  source: "typed" | "generic" | "all" | "none";
};

export function parseFinitePercentage(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function orderGrades<T extends GradeLike>(grades: T[]): T[] {
  return [...grades].sort((a, b) => {
    const upperDiff = Number(b.upperLimit) - Number(a.upperLimit);
    if (upperDiff !== 0) return upperDiff;
    const lowerDiff = Number(b.lowerLimit) - Number(a.lowerLimit);
    if (lowerDiff !== 0) return lowerDiff;
    return Number(a.id) - Number(b.id);
  });
}

function uniqueGradesById<T extends GradeLike>(grades: T[]): T[] {
  const seen = new Set<number>();
  const unique: T[] = [];
  for (const grade of grades) {
    const id = Number(grade.id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    unique.push(grade);
  }
  return unique;
}

function matchingGrades<T extends GradeLike>(percentage: number, grades: T[]): T[] {
  return grades.filter((grade) => {
    const lower = Number(grade.lowerLimit);
    const upper = Number(grade.upperLimit);
    return Number.isFinite(lower) && Number.isFinite(upper) && percentage >= lower && percentage <= upper;
  });
}

/**
 * Resolves a percentage using the same grade precedence used by marks entry:
 * subject-type grades first, then generic grades, then the complete applicable set.
 * The ambiguity flag lets data repair jobs avoid guessing when configured ranges overlap.
 */
export function resolveGradeForPercentage<T extends GradeLike>(
  percentage: number,
  grades: T[],
  subjectType?: string | null,
): GradeResolution<T> {
  if (!Number.isFinite(percentage) || !Array.isArray(grades) || grades.length === 0) {
    return { grade: null, ambiguous: false, matchingGradeIds: [], source: "none" };
  }

  const ordered = orderGrades(uniqueGradesById(grades));
  const compatibleTyped = ordered.filter(
    (grade) => grade.gradeType && isSubjectTypeCompatibleWithGradeType(subjectType, grade.gradeType),
  );
  const genericGrades = ordered.filter((grade) => !grade.gradeType);
  const candidateSets: Array<{ source: GradeResolution<T>["source"]; grades: T[] }> = compatibleTyped.length > 0
    ? [
        { source: "typed", grades: compatibleTyped },
        { source: "generic", grades: genericGrades },
        { source: "all", grades: ordered },
      ]
    : genericGrades.length > 0
      ? [
          { source: "generic", grades: genericGrades },
          { source: "all", grades: ordered },
        ]
      : [{ source: "all", grades: ordered }];

  for (const candidateSet of candidateSets) {
    if (candidateSet.grades.length === 0) continue;
    const matches = matchingGrades(percentage, candidateSet.grades);
    if (matches.length === 0) continue;
    return {
      grade: matches[0],
      ambiguous: matches.length > 1,
      matchingGradeIds: matches.map((grade) => Number(grade.id)),
      source: candidateSet.source,
    };
  }

  return { grade: null, ambiguous: false, matchingGradeIds: [], source: "none" };
}
