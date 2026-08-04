import {
  getGradeProfileLabel,
  isSubjectTypeCompatibleWithGradeType,
  resolveOperationalGradeProfile,
  resolveOperationalGradeProfileKey,
  type GradeProfileKey,
} from "@shared/academic-profiles";
import {
  getProfileAwareGradeCandidates,
  isGradeApplicableToClass,
  resolveGradeForPercentage,
  type GradeLike,
} from "./grade-resolution";

export type GradeConfigurationState =
  | "ready"
  | "profile_missing"
  | "profile_incomplete"
  | "profile_ambiguous"
  | "profile_metadata_incomplete"
  | "profile_settings_missing"
  | "stream_unresolved";

export type GradeConfigurationProfileStatus = {
  profileKey: GradeProfileKey | null;
  profileLabel: string;
  state: GradeConfigurationState;
  ready: boolean;
  resolutionSource: "exact" | "none";
  subjectType: string | null;
  subjectIds: number[];
  gradeRowIds: number[];
  missingPercentages: number[];
  ambiguousPercentages: number[];
  missingStatusGradeIds: number[];
  missingPointsGradeIds: number[];
  missingRankOrderGradeIds: number[];
  duplicateRankOrders: number[];
  pointsDirection: "higher_is_better" | "lower_is_better" | null;
  message: string;
};

export type GradeAttachmentPlan = {
  profileKey: GradeProfileKey | null;
  profileLabel: string;
  safe: boolean;
  state: GradeConfigurationState;
  gradeRowIds: number[];
  rowsToAttach: number[];
  missingPercentages: number[];
  ambiguousPercentages: number[];
  message: string;
};

function uniqueNumbers(values: unknown[]): number[] {
  return Array.from(new Set(values.map(Number).filter(Number.isFinite)));
}

function profileRowsForSubject<T extends GradeLike>(rows: T[], subjectType?: string | null): T[] {
  if (!subjectType) return rows;

  const typed = rows.filter(
    (grade) => !!grade.gradeType && isSubjectTypeCompatibleWithGradeType(subjectType, grade.gradeType),
  );
  const generic = rows.filter((grade) => !grade.gradeType);
  return typed.length > 0 ? [...typed, ...generic] : generic;
}

function coverageScenarios<T extends GradeLike>(rows: T[], subjectType?: string | null): Array<string | null> {
  if (subjectType) return [subjectType];
  const typed = Array.from(
    new Set(rows.map((row) => row.gradeType || null).filter((value): value is string => !!value)),
  );
  return typed.length > 0 ? typed : [null];
}

function evaluateCoverage<T extends GradeLike>(
  rows: T[],
  subjectType?: string | null,
): {
  missingPercentages: number[];
  ambiguousPercentages: number[];
  resolutionSources: Set<"exact" | "unscoped">;
} {
  const missing = new Set<number>();
  const ambiguous = new Set<number>();
  const resolutionSources = new Set<"exact" | "unscoped">();

  for (const scenarioSubjectType of coverageScenarios(rows, subjectType)) {
    for (let percentage = 0; percentage <= 100; percentage += 1) {
      const resolution = resolveGradeForPercentage(percentage, rows, scenarioSubjectType);
      if (resolution.ambiguous) {
        ambiguous.add(percentage);
        continue;
      }
      if (!resolution.grade) {
        missing.add(percentage);
        continue;
      }
      if (resolution.profileSource !== "none") {
        resolutionSources.add(resolution.profileSource);
      }
    }
  }

  return {
    missingPercentages: Array.from(missing).sort((a, b) => a - b),
    ambiguousPercentages: Array.from(ambiguous).sort((a, b) => a - b),
    resolutionSources,
  };
}

function summarizeResolutionSource(
  sources: Set<"exact" | "unscoped">,
): "exact" | "none" {
  return sources.size > 0 ? "exact" : "none";
}

function buildCoverageMessage(args: {
  state: GradeConfigurationState;
  profileLabel: string;
  missingPercentages: number[];
  ambiguousPercentages: number[];
  resolutionSource?: "exact" | "none";
}): string {
  if (args.state === "ready") return `${args.profileLabel} grading is ready.`;
  if (args.state === "profile_settings_missing") return `${args.profileLabel} ranking settings have not been configured.`;
  if (args.state === "profile_metadata_incomplete") return `${args.profileLabel} requires PASS/FAIL status, grade points and a unique rank order for every grade band.`;
  if (args.state === "stream_unresolved") {
    return "The selected stream does not map to a grading profile.";
  }
  if (args.state === "profile_missing") {
    return `${args.profileLabel} grading ranges have not been configured for this class.`;
  }
  if (args.state === "profile_ambiguous") {
    const sample = args.ambiguousPercentages.slice(0, 6).join(", ");
    return `${args.profileLabel} has overlapping grade ranges${sample ? ` around ${sample}%` : ""}.`;
  }
  const first = args.missingPercentages[0];
  const last = args.missingPercentages[args.missingPercentages.length - 1];
  const range = first === undefined ? "" : first === last ? ` at ${first}%` : ` between ${first}% and ${last}%`;
  return `${args.profileLabel} does not provide complete 0–100 grading coverage${range}.`;
}

export function resolveExpectedGradeProfile(args: {
  schoolType?: string | null;
  examinationBoard?: string | null;
  streamName?: string | null;
  subjectType?: string | null;
  subjectName?: string | null;
}): GradeProfileKey | null {
  return resolveOperationalGradeProfileKey(args);
}

export function assessClassSubjectGradeConfiguration<T extends GradeLike>(args: {
  grades: T[];
  classId: number;
  schoolType?: string | null;
  examinationBoard?: string | null;
  streamName?: string | null;
  subjectType?: string | null;
  subjectName?: string | null;
  subjectIds?: number[];
  profileSetting?: { pointsDirection?: "higher_is_better" | "lower_is_better" | null } | null;
}): GradeConfigurationProfileStatus {
  const operationalProfile = resolveOperationalGradeProfile(args);
  const profileKey = operationalProfile.profileKey;
  const gradingSubjectType = operationalProfile.effectiveSubjectType;
  const profileLabel = getGradeProfileLabel(profileKey);

  if (!profileKey) {
    const state: GradeConfigurationState = "stream_unresolved";
    return {
      profileKey: null,
      profileLabel,
      state,
      ready: false,
      resolutionSource: "none",
      subjectType: args.subjectType || null,
      subjectIds: uniqueNumbers(args.subjectIds || []),
      gradeRowIds: [],
      missingPercentages: [],
      ambiguousPercentages: [],
      missingStatusGradeIds: [],
      missingPointsGradeIds: [],
      missingRankOrderGradeIds: [],
      duplicateRankOrders: [],
      pointsDirection: args.profileSetting?.pointsDirection || null,
      message: buildCoverageMessage({ state, profileLabel, missingPercentages: [], ambiguousPercentages: [] }),
    };
  }

  const candidates = getProfileAwareGradeCandidates(args.grades, profileKey, args.classId);
  if (candidates.length === 0) {
    const state: GradeConfigurationState = "profile_missing";
    return {
      profileKey,
      profileLabel,
      state,
      ready: false,
      resolutionSource: "none",
      subjectType: args.subjectType || null,
      subjectIds: uniqueNumbers(args.subjectIds || []),
      gradeRowIds: [],
      missingPercentages: Array.from({ length: 101 }, (_, index) => index),
      ambiguousPercentages: [],
      missingStatusGradeIds: [],
      missingPointsGradeIds: [],
      missingRankOrderGradeIds: [],
      duplicateRankOrders: [],
      pointsDirection: args.profileSetting?.pointsDirection || null,
      message: buildCoverageMessage({ state, profileLabel, missingPercentages: [], ambiguousPercentages: [] }),
    };
  }

  const coverage = evaluateCoverage(candidates, gradingSubjectType);
  const resolutionSource = summarizeResolutionSource(coverage.resolutionSources);
  const relevantRows = profileRowsForSubject(candidates, gradingSubjectType);
  const missingStatusGradeIds = uniqueNumbers(relevantRows
    .filter((grade: any) => !["PASS", "FAIL"].includes(String(grade.gradeStatus || "").trim().toUpperCase()))
    .map((grade) => grade.id));
  const missingPointsGradeIds = uniqueNumbers(relevantRows
    .filter((grade: any) => grade.gradePoints === null || grade.gradePoints === undefined || grade.gradePoints === "" || !Number.isFinite(Number(grade.gradePoints)))
    .map((grade) => grade.id));
  const missingRankOrderGradeIds = uniqueNumbers(relevantRows
    .filter((grade: any) => !Number.isInteger(Number(grade.rankOrder)) || Number(grade.rankOrder) <= 0)
    .map((grade) => grade.id));
  const rankCounts = new Map<string, { rank: number; count: number }>();
  relevantRows.forEach((grade: any) => {
    const rank = Number(grade.rankOrder);
    if (!Number.isInteger(rank) || rank <= 0) return;
    const key = `${String(grade.gradeType || "")}|${rank}`;
    const current = rankCounts.get(key) || { rank, count: 0 };
    current.count += 1;
    rankCounts.set(key, current);
  });
  const duplicateRankOrders = Array.from(new Set(
    Array.from(rankCounts.values()).filter(({ count }) => count > 1).map(({ rank }) => rank),
  )).sort((a, b) => a - b);
  const metadataIncomplete = missingStatusGradeIds.length > 0 || missingPointsGradeIds.length > 0 || missingRankOrderGradeIds.length > 0 || duplicateRankOrders.length > 0;
  const state: GradeConfigurationState = coverage.ambiguousPercentages.length > 0
    ? "profile_ambiguous"
    : coverage.missingPercentages.length > 0
      ? "profile_incomplete"
      : metadataIncomplete
        ? "profile_metadata_incomplete"
        : !args.profileSetting?.pointsDirection
          ? "profile_settings_missing"
          : "ready";

  return {
    profileKey,
    profileLabel,
    state,
    ready: state === "ready",
    resolutionSource,
    subjectType: args.subjectType || null,
    subjectIds: uniqueNumbers(args.subjectIds || []),
    gradeRowIds: uniqueNumbers(candidates.map((grade) => grade.id)),
    missingPercentages: coverage.missingPercentages,
    ambiguousPercentages: coverage.ambiguousPercentages,
    missingStatusGradeIds,
    missingPointsGradeIds,
    missingRankOrderGradeIds,
    duplicateRankOrders,
    pointsDirection: args.profileSetting?.pointsDirection || null,
    message: buildCoverageMessage({
      state,
      profileLabel,
      missingPercentages: coverage.missingPercentages,
      ambiguousPercentages: coverage.ambiguousPercentages,
      resolutionSource,
    }),
  };
}

/**
 * Plans an automatic class attachment for an exact profile only. The attachment is allowed only
 * when the exact profile already contains a complete, non-overlapping 0–100 range set.
 */
export function planExactProfileClassAttachment<T extends GradeLike>(args: {
  grades: T[];
  profileKey: GradeProfileKey | null;
  classId: number;
  subjectType?: string | null;
}): GradeAttachmentPlan {
  const profileLabel = getGradeProfileLabel(args.profileKey);
  if (!args.profileKey) {
    const state: GradeConfigurationState = "stream_unresolved";
    return {
      profileKey: null,
      profileLabel,
      safe: false,
      state,
      gradeRowIds: [],
      rowsToAttach: [],
      missingPercentages: [],
      ambiguousPercentages: [],
      message: buildCoverageMessage({ state, profileLabel, missingPercentages: [], ambiguousPercentages: [] }),
    };
  }

  const exactRows = args.grades.filter((grade) => (grade.gradeLevel || null) === args.profileKey);
  const relevantRows = profileRowsForSubject(exactRows, args.subjectType);
  if (relevantRows.length === 0) {
    const state: GradeConfigurationState = "profile_missing";
    return {
      profileKey: args.profileKey,
      profileLabel,
      safe: false,
      state,
      gradeRowIds: [],
      rowsToAttach: [],
      missingPercentages: Array.from({ length: 101 }, (_, index) => index),
      ambiguousPercentages: [],
      message: buildCoverageMessage({ state, profileLabel, missingPercentages: [], ambiguousPercentages: [] }),
    };
  }

  const simulatedRows = relevantRows.map((grade) => ({
    ...grade,
    classIds: Array.from(new Set([
      ...(Array.isArray(grade.classIds) ? grade.classIds.map(Number).filter(Number.isFinite) : []),
      args.classId,
    ])),
    resolutionProfilePriority: 0,
    resolutionProfileSource: "exact" as const,
  }));
  const coverage = evaluateCoverage(simulatedRows, args.subjectType);
  const state: GradeConfigurationState = coverage.ambiguousPercentages.length > 0
    ? "profile_ambiguous"
    : coverage.missingPercentages.length > 0
      ? "profile_incomplete"
      : "ready";
  const rowsToAttach = relevantRows
    .filter((grade) => !isGradeApplicableToClass(grade, args.classId))
    .map((grade) => Number(grade.id));

  return {
    profileKey: args.profileKey,
    profileLabel,
    safe: state === "ready",
    state,
    gradeRowIds: uniqueNumbers(relevantRows.map((grade) => grade.id)),
    rowsToAttach: uniqueNumbers(rowsToAttach),
    missingPercentages: coverage.missingPercentages,
    ambiguousPercentages: coverage.ambiguousPercentages,
    message: state === "ready"
      ? rowsToAttach.length > 0
        ? `${profileLabel} can be attached automatically.`
        : `${profileLabel} is already attached to this class.`
      : buildCoverageMessage({
          state,
          profileLabel,
          missingPercentages: coverage.missingPercentages,
          ambiguousPercentages: coverage.ambiguousPercentages,
        }),
  };
}
