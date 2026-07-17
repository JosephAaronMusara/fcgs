import {
  getGradeProfileLabel,
  isSubjectTypeCompatibleWithGradeType,
  resolveGradeProfileKey,
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
  | "stream_unresolved";

export type GradeConfigurationProfileStatus = {
  profileKey: GradeProfileKey | null;
  profileLabel: string;
  state: GradeConfigurationState;
  ready: boolean;
  resolutionSource: "exact" | "compatible" | "mixed" | "none";
  subjectType: string | null;
  subjectIds: number[];
  gradeRowIds: number[];
  missingPercentages: number[];
  ambiguousPercentages: number[];
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
  resolutionSources: Set<"exact" | "compatible" | "unscoped">;
} {
  const missing = new Set<number>();
  const ambiguous = new Set<number>();
  const resolutionSources = new Set<"exact" | "compatible" | "unscoped">();

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
  sources: Set<"exact" | "compatible" | "unscoped">,
): "exact" | "compatible" | "mixed" | "none" {
  if (sources.size === 0) return "none";
  if (sources.size > 1) return "mixed";
  const [source] = Array.from(sources);
  return source === "unscoped" ? "exact" : source;
}

function buildCoverageMessage(args: {
  state: GradeConfigurationState;
  profileLabel: string;
  missingPercentages: number[];
  ambiguousPercentages: number[];
  resolutionSource?: "exact" | "compatible" | "mixed" | "none";
}): string {
  if (args.state === "ready") {
    const suffix = args.resolutionSource === "compatible"
      ? " using a compatible configured profile"
      : args.resolutionSource === "mixed"
        ? " using exact and compatible configured ranges"
        : "";
    return `${args.profileLabel} grading is ready${suffix}.`;
  }
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
}): GradeProfileKey | null {
  return resolveGradeProfileKey(args);
}

export function assessClassSubjectGradeConfiguration<T extends GradeLike>(args: {
  grades: T[];
  classId: number;
  schoolType?: string | null;
  examinationBoard?: string | null;
  streamName?: string | null;
  subjectType?: string | null;
  subjectIds?: number[];
}): GradeConfigurationProfileStatus {
  const profileKey = resolveExpectedGradeProfile(args);
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
      message: buildCoverageMessage({ state, profileLabel, missingPercentages: [], ambiguousPercentages: [] }),
    };
  }

  const coverage = evaluateCoverage(candidates, args.subjectType);
  const resolutionSource = summarizeResolutionSource(coverage.resolutionSources);
  const state: GradeConfigurationState = coverage.ambiguousPercentages.length > 0
    ? "profile_ambiguous"
    : coverage.missingPercentages.length > 0
      ? "profile_incomplete"
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
 * Plans an automatic class attachment for an exact profile only. Compatible profiles remain
 * a read-time fallback; they are never mutated automatically. The attachment is allowed only
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
