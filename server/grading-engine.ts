import { isSubjectTypeCompatibleWithGradeType, type PointsDirection } from "@shared/academic-profiles";
import { isGradeApplicableToClass, parseFinitePercentage, resolveGradeForPercentage, type GradeLike } from "./grade-resolution";

export type PassStatus = "PASS" | "FAIL" | "UNRESOLVED";

export type ConfiguredGradeLike = GradeLike & {
  gradePoints?: number | string | null;
  gradeStatus?: string | null;
  rankOrder?: number | null;
};

export type GradeIntegrityIssue =
  | "grade_missing"
  | "grade_profile_mismatch"
  | "grade_not_applicable"
  | "grade_range_mismatch"
  | "grade_status_missing"
  | "grade_points_missing"
  | "grade_rank_order_missing"
  | "grade_resolution_ambiguous";

export function normalizeGradeStatus(value: unknown): PassStatus {
  const status = String(value || "").trim().toUpperCase();
  if (status === "PASS") return "PASS";
  if (status === "FAIL") return "FAIL";
  return "UNRESOLVED";
}

export function parseGradePoints(value: unknown): number | null {
  const parsed = parseFinitePercentage(value);
  return parsed !== null ? parsed : null;
}

export function parseRankOrder(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function validateConfiguredGrade(
  grade: ConfiguredGradeLike | null | undefined,
): GradeIntegrityIssue[] {
  if (!grade) return ["grade_missing"];
  const issues: GradeIntegrityIssue[] = [];
  if (normalizeGradeStatus(grade.gradeStatus) === "UNRESOLVED") issues.push("grade_status_missing");
  if (parseGradePoints(grade.gradePoints) === null) issues.push("grade_points_missing");
  if (parseRankOrder(grade.rankOrder) === null) issues.push("grade_rank_order_missing");
  return issues;
}

export function storedGradeMatchesExactContext(args: {
  grade: ConfiguredGradeLike | null | undefined;
  expectedProfileKey?: string | null;
  classId: number;
  percentage: number;
  subjectType?: string | null;
}): boolean {
  const grade = args.grade;
  if (!grade || !args.expectedProfileKey) return false;
  if ((grade.gradeLevel || null) !== args.expectedProfileKey) return false;
  if (!isGradeApplicableToClass(grade, args.classId)) return false;
  if (grade.gradeType && !isSubjectTypeCompatibleWithGradeType(args.subjectType, grade.gradeType)) return false;
  const lower = Number(grade.lowerLimit);
  const upper = Number(grade.upperLimit);
  return Number.isFinite(lower) && Number.isFinite(upper) && args.percentage >= lower && args.percentage <= upper;
}

export function resolveExactConfiguredGrade<T extends ConfiguredGradeLike>(args: {
  percentage: number | null;
  expectedProfileKey?: string | null;
  classId: number;
  subjectType?: string | null;
  exactProfileGrades: T[];
  storedGrade?: T | null;
}): {
  grade: T | null;
  passStatus: PassStatus;
  issues: GradeIntegrityIssue[];
  usedStoredGrade: boolean;
} {
  if (args.percentage === null || !args.expectedProfileKey) {
    return { grade: null, passStatus: "UNRESOLVED", issues: ["grade_missing"], usedStoredGrade: false };
  }

  if (storedGradeMatchesExactContext({
    grade: args.storedGrade,
    expectedProfileKey: args.expectedProfileKey,
    classId: args.classId,
    percentage: args.percentage,
    subjectType: args.subjectType,
  })) {
    const issues = validateConfiguredGrade(args.storedGrade);
    return {
      grade: args.storedGrade || null,
      passStatus: issues.length ? "UNRESOLVED" : normalizeGradeStatus(args.storedGrade?.gradeStatus),
      issues,
      usedStoredGrade: true,
    };
  }

  const candidates = args.exactProfileGrades.filter((grade) =>
    (grade.gradeLevel || null) === args.expectedProfileKey && isGradeApplicableToClass(grade, args.classId)
  );
  const resolution = resolveGradeForPercentage(args.percentage, candidates, args.subjectType);
  if (resolution.ambiguous) {
    return { grade: null, passStatus: "UNRESOLVED", issues: ["grade_resolution_ambiguous"], usedStoredGrade: false };
  }
  const grade = resolution.grade;
  const issues = validateConfiguredGrade(grade);
  return {
    grade,
    passStatus: issues.length ? "UNRESOLVED" : normalizeGradeStatus(grade?.gradeStatus),
    issues,
    usedStoredGrade: false,
  };
}

export type RankingSubjectResult = {
  subjectId: number;
  percentage: number | null;
  grade: ConfiguredGradeLike | null;
  profileKey: string | null;
};

export type RankingCandidate = {
  id: number;
  results: RankingSubjectResult[];
  expectedSubjectIds: number[];
};

export type PositionRankingMode = "average_percentage" | "average_grade_points";

export type RankingRecord = {
  id: number;
  eligible: boolean;
  reasons: string[];
  totalPoints: number | null;
  averageGradePoints: number | null;
  averagePercentage: number | null;
  resolvedResultCount: number;
  gradeCounts: Map<number, number>;
  profileKeys: string[];
};

export function buildRankingRecord(
  candidate: RankingCandidate,
  rankingMode: PositionRankingMode = "average_grade_points",
): RankingRecord {
  const bySubject = new Map(candidate.results.map((result) => [Number(result.subjectId), result]));
  const reasons: string[] = [];
  const gradeCounts = new Map<number, number>();
  const profileKeys = new Set<string>();
  let totalPoints = 0;
  let percentageTotal = 0;
  let resolvedResultCount = 0;

  // Missing results remain ignored, matching the established report behaviour.
  // The ranking mode only changes the primary comparison measure.
  for (const [subjectId, result] of bySubject) {
    if (result.percentage === null || !Number.isFinite(result.percentage)) continue;
    if (result.profileKey) profileKeys.add(result.profileKey);

    if (rankingMode === "average_percentage") {
      percentageTotal += result.percentage;
      resolvedResultCount++;
      continue;
    }

    const gradeIssues = validateConfiguredGrade(result.grade);
    if (gradeIssues.length) {
      reasons.push(...gradeIssues.map((issue) => `${issue}:${subjectId}`));
      continue;
    }
    const points = parseGradePoints(result.grade?.gradePoints);
    const rankOrder = parseRankOrder(result.grade?.rankOrder);
    if (points === null || rankOrder === null) continue;
    totalPoints += points;
    percentageTotal += result.percentage;
    resolvedResultCount++;
    gradeCounts.set(rankOrder, (gradeCounts.get(rankOrder) || 0) + 1);
  }

  if (resolvedResultCount === 0) reasons.push("no_valid_results");
  const eligible = resolvedResultCount > 0 && reasons.length === 0;
  return {
    id: candidate.id,
    eligible,
    reasons: Array.from(new Set(reasons)),
    totalPoints: eligible && rankingMode === "average_grade_points" ? totalPoints : null,
    averageGradePoints: eligible && rankingMode === "average_grade_points" ? totalPoints / resolvedResultCount : null,
    averagePercentage: eligible ? percentageTotal / resolvedResultCount : null,
    resolvedResultCount,
    gradeCounts,
    profileKeys: Array.from(profileKeys),
  };
}

function compareGradeDistribution(a: RankingRecord, b: RankingRecord): number {
  const rankOrders = Array.from(new Set([...a.gradeCounts.keys(), ...b.gradeCounts.keys()])).sort((x, y) => x - y);
  for (const rankOrder of rankOrders) {
    const diff = (b.gradeCounts.get(rankOrder) || 0) - (a.gradeCounts.get(rankOrder) || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function compareRankingRecords(
  a: RankingRecord,
  b: RankingRecord,
  pointsDirection: PointsDirection,
  rankingMode: PositionRankingMode = "average_grade_points",
): number {
  if (!a.eligible && !b.eligible) return a.id - b.id;
  if (!a.eligible) return 1;
  if (!b.eligible) return -1;

  if (rankingMode === "average_grade_points") {
    const pointsDiff = Number(a.averageGradePoints || 0) - Number(b.averageGradePoints || 0);
    if (Math.abs(pointsDiff) > 1e-9) {
      return pointsDirection === "lower_is_better" ? pointsDiff : -pointsDiff;
    }
    const distributionDiff = compareGradeDistribution(a, b);
    if (distributionDiff !== 0) return distributionDiff;
  }
  const percentageDiff = Number(b.averagePercentage || 0) - Number(a.averagePercentage || 0);
  if (Math.abs(percentageDiff) > 1e-9) return percentageDiff;
  return 0;
}

function rankingRecordsEqual(
  a: RankingRecord,
  b: RankingRecord,
  rankingMode: PositionRankingMode,
): boolean {
  if (!a.eligible || !b.eligible) return false;
  if (rankingMode === "average_grade_points") {
    if (Math.abs(Number(a.averageGradePoints) - Number(b.averageGradePoints)) > 1e-9) return false;
    const keys = new Set([...a.gradeCounts.keys(), ...b.gradeCounts.keys()]);
    for (const key of keys) {
      if ((a.gradeCounts.get(key) || 0) !== (b.gradeCounts.get(key) || 0)) return false;
    }
  }
  return Math.abs(Number(a.averagePercentage) - Number(b.averagePercentage)) <= 1e-9;
}

export function calculateConfiguredPositionMap(args: {
  candidates: RankingCandidate[];
  pointsDirection?: PointsDirection | null;
  rankingMode?: PositionRankingMode;
}): {
  size: number;
  map: Map<number, string>;
  records: Map<number, RankingRecord>;
  unresolved: Map<number, string[]>;
} {
  const rankingMode = args.rankingMode || "average_grade_points";
  const records = args.candidates.map((candidate) => buildRankingRecord(candidate, rankingMode));
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const unresolved = new Map(records.filter((record) => !record.eligible).map((record) => [record.id, record.reasons]));

  if (rankingMode === "average_grade_points" && !args.pointsDirection) {
    for (const record of records.filter((item) => item.eligible)) {
      unresolved.set(record.id, ["points_direction_missing"]);
    }
    return { size: 0, map: new Map(), records: recordsById, unresolved };
  }

  const eligible = records.filter((record) => record.eligible)
    .sort((a, b) => compareRankingRecords(a, b, args.pointsDirection || "higher_is_better", rankingMode));
  const map = new Map<number, string>();
  let position = 0;
  let previous: RankingRecord | null = null;
  eligible.forEach((record, index) => {
    if (!previous || !rankingRecordsEqual(previous, record, rankingMode)) position = index + 1;
    map.set(record.id, `${position}/${eligible.length}`);
    previous = record;
  });
  return { size: eligible.length, map, records: recordsById, unresolved };
}
