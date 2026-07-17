import {
  getCompatibleGradeProfileKeys,
  isSubjectTypeCompatibleWithGradeType,
} from "@shared/academic-profiles";

export type GradeLike = {
  id: number;
  gradeName?: string | null;
  lowerLimit: number | string;
  upperLimit: number | string;
  gradeType?: string | null;
  gradeLevel?: string | null;
  appliesAll?: boolean | null;
  classIds?: unknown;
  resolutionProfilePriority?: number;
  resolutionProfileSource?: "exact" | "compatible" | "unscoped";
};

export type GradeResolution<T extends GradeLike> = {
  grade: T | null;
  ambiguous: boolean;
  matchingGradeIds: number[];
  source: "typed" | "generic" | "all" | "none";
  profileSource: "exact" | "compatible" | "unscoped" | "none";
};

export function parseFinitePercentage(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function orderGrades<T extends GradeLike>(grades: T[]): T[] {
  return [...grades].sort((a, b) => {
    const priorityDiff = Number(a.resolutionProfilePriority ?? 0) - Number(b.resolutionProfilePriority ?? 0);
    if (priorityDiff !== 0) return priorityDiff;
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

export function isGradeApplicableToClass(grade: GradeLike, classId: number): boolean {
  if (grade?.appliesAll) return true;
  if (!Array.isArray(grade?.classIds) || grade.classIds.length === 0) return true;
  return grade.classIds.map((id: unknown) => Number(id)).includes(Number(classId));
}

/**
 * Builds the profile candidates in the safe order required by assessment grading:
 * 1) remove grades that do not apply to the assessment class;
 * 2) retain exact-profile grades as priority 0;
 * 3) retain compatible legacy/board profile grades as priority 1.
 *
 * Percentage resolution later tries priority 0 first and only falls back to priority 1
 * when the exact profile has no range covering the percentage. This avoids the previous
 * bug where exact grades for unrelated classes suppressed valid compatible class grades.
 */
export function getProfileAwareGradeCandidates<T extends GradeLike>(
  grades: T[],
  profileKey: string | null | undefined,
  classId: number,
): Array<T & {
  resolutionProfilePriority: number;
  resolutionProfileSource: "exact" | "compatible" | "unscoped";
}> {
  const applicable = uniqueGradesById(grades).filter((grade) => isGradeApplicableToClass(grade, classId));

  if (!profileKey) {
    return applicable.map((grade) => ({
      ...grade,
      resolutionProfilePriority: 0,
      resolutionProfileSource: "unscoped" as const,
    }));
  }

  const exact = applicable.filter((grade) => (grade.gradeLevel || null) === profileKey);
  const compatibleKeys = new Set(
    getCompatibleGradeProfileKeys(profileKey).filter((key) => key !== profileKey),
  );
  const compatible = applicable.filter(
    (grade) => !!grade.gradeLevel && compatibleKeys.has(String(grade.gradeLevel)),
  );

  return [
    ...exact.map((grade) => ({
      ...grade,
      resolutionProfilePriority: 0,
      resolutionProfileSource: "exact" as const,
    })),
    ...compatible.map((grade) => ({
      ...grade,
      resolutionProfilePriority: 1,
      resolutionProfileSource: "compatible" as const,
    })),
  ];
}

function resolveWithinProfilePriority<T extends GradeLike>(
  percentage: number,
  grades: T[],
  subjectType?: string | null,
): Omit<GradeResolution<T>, "profileSource"> {
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

/**
 * Resolves a percentage using profile priority first, then the existing subject-type
 * precedence inside each profile: typed grades, generic grades, then the complete set.
 *
 * Exact-profile ranges are authoritative where they cover the percentage. Compatible
 * profile ranges are only considered when the exact profile has no matching range.
 * Ambiguous exact-profile ranges stop resolution rather than falling through and guessing.
 */
export function resolveGradeForPercentage<T extends GradeLike>(
  percentage: number,
  grades: T[],
  subjectType?: string | null,
): GradeResolution<T> {
  if (!Number.isFinite(percentage) || !Array.isArray(grades) || grades.length === 0) {
    return {
      grade: null,
      ambiguous: false,
      matchingGradeIds: [],
      source: "none",
      profileSource: "none",
    };
  }

  const ordered = orderGrades(uniqueGradesById(grades));
  const priorities = Array.from(new Set(
    ordered.map((grade) => Number.isFinite(Number(grade.resolutionProfilePriority))
      ? Number(grade.resolutionProfilePriority)
      : 0),
  )).sort((a, b) => a - b);

  for (const priority of priorities) {
    const profileGrades = ordered.filter((grade) => {
      const gradePriority = Number.isFinite(Number(grade.resolutionProfilePriority))
        ? Number(grade.resolutionProfilePriority)
        : 0;
      return gradePriority === priority;
    });
    const resolution = resolveWithinProfilePriority(percentage, profileGrades, subjectType);
    if (!resolution.grade && !resolution.ambiguous) continue;
    const profileSource = profileGrades[0]?.resolutionProfileSource || "unscoped";
    return { ...resolution, profileSource };
  }

  return {
    grade: null,
    ambiguous: false,
    matchingGradeIds: [],
    source: "none",
    profileSource: "none",
  };
}
