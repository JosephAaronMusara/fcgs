export type SupportedSchoolType = "primary" | "secondary";
export type SupportedExamBoard = "ZIMSEC" | "Cambridge";

export const SECONDARY_SUBJECT_TYPES = [
  "ZIMSEC Advanced Level",
  "ZIMSEC Ordinary Level",
  "Cambridge Advanced Level",
  "Cambridge Ordinary Level",
  "Cambridge IGCSE",
  "DELF",
  "HEXCO",
  "HSK",
] as const;

export type SecondarySubjectType = (typeof SECONDARY_SUBJECT_TYPES)[number];

export const GRADE_PROFILE_KEYS = [
  "SEC_ZIM_A",
  "SEC_ZIM_O",
  "SEC_CAM_A",
  "SEC_CAM_O",
  "SEC_CAM_IGCSE",
  "PRI_ZIM_ECD",
  "PRI_ZIM_G12",
  "PRI_ZIM_G37",
  "PRI_CAM_ECD",
  "PRI_CAM_G12",
  "PRI_CAM_G37",
] as const;

export type GradeProfileKey = (typeof GRADE_PROFILE_KEYS)[number];

export interface GradingProfileDefinition {
  key: GradeProfileKey;
  label: string;
  schoolType: SupportedSchoolType;
  board: SupportedExamBoard;
  sortOrder: number;
}

export const GRADING_PROFILES: GradingProfileDefinition[] = [
  { key: "SEC_ZIM_A", label: "Advanced Level", schoolType: "secondary", board: "ZIMSEC", sortOrder: 10 },
  { key: "SEC_ZIM_O", label: "Ordinary Level", schoolType: "secondary", board: "ZIMSEC", sortOrder: 20 },
  { key: "SEC_CAM_A", label: "Advanced Level", schoolType: "secondary", board: "Cambridge", sortOrder: 10 },
  { key: "SEC_CAM_O", label: "Ordinary Level", schoolType: "secondary", board: "Cambridge", sortOrder: 20 },
  { key: "SEC_CAM_IGCSE", label: "IGCSE", schoolType: "secondary", board: "Cambridge", sortOrder: 30 },
  { key: "PRI_ZIM_ECD", label: "ECD A - B Level", schoolType: "primary", board: "ZIMSEC", sortOrder: 10 },
  { key: "PRI_ZIM_G12", label: "Grade 1 - 2 Level", schoolType: "primary", board: "ZIMSEC", sortOrder: 20 },
  { key: "PRI_ZIM_G37", label: "Grade 3 - 7 Level", schoolType: "primary", board: "ZIMSEC", sortOrder: 30 },
  { key: "PRI_CAM_ECD", label: "ECD A - B Level", schoolType: "primary", board: "Cambridge", sortOrder: 10 },
  { key: "PRI_CAM_G12", label: "Grade 1 - 2 Level", schoolType: "primary", board: "Cambridge", sortOrder: 20 },
  { key: "PRI_CAM_G37", label: "Grade 3 - 7 Level", schoolType: "primary", board: "Cambridge", sortOrder: 30 },
];


export function filterItemsByGradeProfileKey<T extends { gradeLevel?: string | null }>(
  items: T[],
  profileKey?: string | null,
): T[] {
  if (!profileKey) return items;
  return items.filter((item) => (item.gradeLevel || null) === profileKey);
}

export function getStrictGradeProfileKeys(profileKey?: string | null): string[] {
  return profileKey ? [profileKey] : [];
}

export function gradeProfileMatchesStrict(
  candidateProfileKey?: string | null,
  selectedProfileKey?: string | null,
): boolean {
  if (!selectedProfileKey) return true;
  return !!candidateProfileKey && candidateProfileKey === selectedProfileKey;
}

export function filterItemsByStrictGradeProfileKey<T extends { gradeLevel?: string | null }>(
  items: T[],
  profileKey?: string | null,
): T[] {
  return filterItemsByGradeProfileKey(items, profileKey);
}

export type PointsDirection = "higher_is_better" | "lower_is_better";

export const ECD_RATINGS = ["YES", "NO", "ALMOST"] as const;
export type EcdRating = (typeof ECD_RATINGS)[number];

export interface EcdDomainSeed {
  code: string;
  name: string;
  sortOrder: number;
  items: string[];
}

export const ECD_DOMAIN_SEEDS: EcdDomainSeed[] = [
  {
    code: "A",
    name: "Emotional and Social Development",
    sortOrder: 10,
    items: [
      "Can play with others",
      "Can share with others",
      "Can control his or her feelings",
      "Pride in his or her achievements",
      "Can relate to a group",
      "Can take good care of his or her possessions",
      "Can concentrate during lessons",
      "Can complete a task",
      "Knows his or her full name and age",
      "Knows his or her telephone number",
      "Knows his or her address",
      "Shows interest in books",
      "Can interpret a picture",
    ],
  },
  {
    code: "B",
    name: "Gross Motor Co-ordination",
    sortOrder: 20,
    items: [
      "Can balance",
      "Can skip",
      "Can hop on alternate legs",
      "Can catch with both hands",
      "Can throw",
      "Can jump",
      "Can name the parts of his or her body",
    ],
  },
  {
    code: "C",
    name: "Fine Motor Co-ordination",
    sortOrder: 30,
    items: [
      "Can cut and paste",
      "Can thread beads according to pattern",
      "Can tie his or her own shoelaces",
      "Can dress himself or herself",
      "Can hold his or her pencil the correct way",
      "Can copy a shape",
      "Can write patterns",
      "Can trace around a template",
      "Can write his or her name",
      "Can draw a picture",
      "Can draw a shape",
    ],
  },
  {
    code: "D",
    name: "Visual Perception",
    sortOrder: 40,
    items: [
      "Can match colour, shape and size",
      "Can reproduce a pattern in sequence",
      "Can see differences and similarities between shapes and pictures",
      "Is aware of his or her position in space",
      "Knows his or her left from his or her right",
    ],
  },
  {
    code: "E",
    name: "Oral Language Development",
    sortOrder: 50,
    items: [
      "Can listen and understand",
      "Can speak in sentences",
      "Can retell a simple story in sequence",
      "Can learn and enjoy rhymes and songs easily",
      "Enjoys story time",
      "Can take a message",
    ],
  },
  {
    code: "F",
    name: "Pre-number Concepts",
    sortOrder: 60,
    items: [
      "Knows his or her colours",
      "Knows his or her shapes",
      "Recognises numbers up to 5",
      "Can write numbers up to 5",
      "Can count up to 10",
      "Can group to quantity up to 5",
      "Can sort by size, colour, shapes",
    ],
  },
];

export function normalizeSchoolType(value?: string | null): SupportedSchoolType {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "primary" || normalized === "primary school") return "primary";
  return "secondary";
}

export function normalizeExamBoard(value?: string | null): SupportedExamBoard {
  return value === "Cambridge" ? "Cambridge" : "ZIMSEC";
}

export function getGradingProfilesForSchool(
  schoolType?: string | null,
  examinationBoard?: string | null,
): GradingProfileDefinition[] {
  const resolvedSchoolType = normalizeSchoolType(schoolType);
  const resolvedBoard = normalizeExamBoard(examinationBoard);
  return GRADING_PROFILES.filter(
    (profile) => profile.schoolType === resolvedSchoolType && profile.board === resolvedBoard,
  ).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getGradeProfileLabel(key?: string | null): string {
  const direct = GRADING_PROFILES.find((profile) => profile.key === key);
  if (direct) return direct.label;
  return key || "Unknown";
}

function normalizeStreamName(streamName?: string | null): string {
  return (streamName || "").trim().toLowerCase();
}

export function isEcdStream(streamName?: string | null): boolean {
  const value = normalizeStreamName(streamName);
  return /^ecd\s*a(?:\b|\s|-)/.test(value) || /^ecd\s*b(?:\b|\s|-)/.test(value) || value === "ecd a" || value === "ecd b";
}

export function resolvePrimaryGroupingFromStream(streamName?: string | null): "ECD" | "G12" | "G37" | null {
  const value = normalizeStreamName(streamName);
  if (!value) return null;
  if (isEcdStream(value)) return "ECD";
  if (/^grade\s*[12](?:\b|\s|-)/.test(value)) return "G12";
  if (/^grade\s*[3-7](?:\b|\s|-)/.test(value)) return "G37";
  return null;
}

export function resolveSecondaryGroupingFromStream(streamName?: string | null): "LOWER" | "ADVANCED" | null {
  const value = normalizeStreamName(streamName);
  if (!value) return null;
  if (["form 5", "form 6", "lower 6", "upper 6", "l6", "u6"].includes(value) || /^(form\s*[56]|lower\s*6|upper\s*6|l6|u6)(?:\b|\s|-)/.test(value)) return "ADVANCED";
  if (/^form\s*[1-4](?:\b|\s|-)/.test(value)) return "LOWER";
  return null;
}

export type AcademicPositionRankingMode = "none" | "average_percentage" | "average_grade_points";

export function resolveSecondaryFormNumberFromStream(streamName?: string | null): 1 | 2 | 3 | 4 | 5 | 6 | null {
  const value = normalizeStreamName(streamName);
  if (!value) return null;
  if (/^(lower\s*(?:6|six|sixth)|l6)(?:\b|\s|-)/.test(value)) return 5;
  if (/^(upper\s*(?:6|six|sixth)|u6)(?:\b|\s|-)/.test(value)) return 6;
  const match = value.match(/^form\s*([1-6])(?:\b|\s|-)/);
  if (!match) return null;
  return Number(match[1]) as 1 | 2 | 3 | 4 | 5 | 6;
}

export function resolveAcademicPositionRankingMode(args: {
  schoolType?: string | null;
  streamName?: string | null;
}): AcademicPositionRankingMode | null {
  const schoolType = normalizeSchoolType(args.schoolType);
  if (schoolType === "primary") {
    return isEcdStream(args.streamName) ? "none" : "average_percentage";
  }

  const form = resolveSecondaryFormNumberFromStream(args.streamName);
  if (!form) return null;
  return form <= 2 ? "average_percentage" : "average_grade_points";
}

export function resolveGradeProfileKey(args: {
  schoolType?: string | null;
  examinationBoard?: string | null;
  streamName?: string | null;
  subjectType?: string | null;
}): GradeProfileKey | null {
  const rawSchoolType = String(args.schoolType || "").trim().toLowerCase();
  const schoolType: SupportedSchoolType | null =
    rawSchoolType === "primary" || rawSchoolType === "primary school"
      ? "primary"
      : rawSchoolType === "secondary" || rawSchoolType === "secondary school"
        ? "secondary"
        : null;
  const rawBoard = String(args.examinationBoard || "").trim().toLowerCase();
  const board: SupportedExamBoard | null =
    rawBoard === "cambridge"
      ? "Cambridge"
      : rawBoard === "zimsec"
        ? "ZIMSEC"
        : null;
  if (!schoolType || !board) return null;
  const subjectType = args.subjectType || null;

  if (schoolType === "primary") {
    const grouping = resolvePrimaryGroupingFromStream(args.streamName);
    if (!grouping) return null;
    if (board === "Cambridge") {
      if (grouping === "ECD") return "PRI_CAM_ECD";
      if (grouping === "G12") return "PRI_CAM_G12";
      return "PRI_CAM_G37";
    }
    if (grouping === "ECD") return "PRI_ZIM_ECD";
    if (grouping === "G12") return "PRI_ZIM_G12";
    return "PRI_ZIM_G37";
  }

  const secondaryGrouping = resolveSecondaryGroupingFromStream(args.streamName);
  if (!secondaryGrouping) return null;

  if (secondaryGrouping === "ADVANCED") {
    if (board === "Cambridge" && subjectType === "Cambridge Advanced Level") return "SEC_CAM_A";
    if (board === "ZIMSEC" && subjectType === "ZIMSEC Advanced Level") return "SEC_ZIM_A";
    if (subjectType === "DELF" || subjectType === "HEXCO" || subjectType === "HSK") {
      return board === "Cambridge" ? "SEC_CAM_A" : "SEC_ZIM_A";
    }
    return null;
  }

  if (board === "Cambridge" && subjectType === "Cambridge IGCSE") return "SEC_CAM_IGCSE";
  if (board === "Cambridge" && subjectType === "Cambridge Ordinary Level") return "SEC_CAM_O";
  if (board === "ZIMSEC" && subjectType === "ZIMSEC Ordinary Level") return "SEC_ZIM_O";
  if (subjectType === "DELF" || subjectType === "HEXCO" || subjectType === "HSK") {
    return board === "Cambridge" ? "SEC_CAM_O" : "SEC_ZIM_O";
  }
  return null;
}

export const OPERATIONAL_GRADING_POLICY_VERSION = "2026-08-04-intentional-substitutions-v1";

export type OperationalGradeProfileSource =
  | "exact"
  | "intentional_substitution"
  | "none";

export type IntentionalGradingSubstitutionPolicy =
  | "zimsec_advanced_class_uses_ordinary_subject_record"
  | "cambridge_advanced_language_uses_igcse_grading";

export type OperationalGradeProfileResolution = {
  profileKey: GradeProfileKey | null;
  effectiveSubjectType: string | null;
  source: OperationalGradeProfileSource;
  substitutionPolicy: IntentionalGradingSubstitutionPolicy | null;
};

function normalizeOperationalSubjectName(value?: string | null): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Resolves the grading profile actually used by the portal. The normal exact
 * resolver remains strict. These two substitutions are explicit temporary
 * operational policies confirmed by the organisation:
 *
 * 1. ZIMSEC Advanced Level classes may temporarily use Ordinary Level subject
 *    records, while grading with the configured SEC_ZIM_A profile.
 * 2. Cambridge Advanced Level Chinese and French may intentionally use the
 *    configured IGCSE grading profile.
 *
 * No other profile fallback is permitted.
 */
export function resolveOperationalGradeProfile(args: {
  schoolType?: string | null;
  examinationBoard?: string | null;
  streamName?: string | null;
  subjectType?: string | null;
  subjectName?: string | null;
}): OperationalGradeProfileResolution {
  const exactProfile = resolveGradeProfileKey(args);
  if (exactProfile) {
    return {
      profileKey: exactProfile,
      effectiveSubjectType: args.subjectType || null,
      source: "exact",
      substitutionPolicy: null,
    };
  }

  const schoolType = String(args.schoolType || "").trim().toLowerCase();
  const board = String(args.examinationBoard || "").trim().toLowerCase();
  const grouping = resolveSecondaryGroupingFromStream(args.streamName);
  const subjectType = String(args.subjectType || "").trim();

  if (
    (schoolType === "secondary" || schoolType === "secondary school")
    && board === "zimsec"
    && grouping === "ADVANCED"
    && subjectType === "ZIMSEC Ordinary Level"
  ) {
    return {
      profileKey: "SEC_ZIM_A",
      effectiveSubjectType: "ZIMSEC Advanced Level",
      source: "intentional_substitution",
      substitutionPolicy: "zimsec_advanced_class_uses_ordinary_subject_record",
    };
  }

  const subjectName = normalizeOperationalSubjectName(args.subjectName);
  if (
    (schoolType === "secondary" || schoolType === "secondary school")
    && board === "cambridge"
    && grouping === "ADVANCED"
    && subjectType === "Cambridge IGCSE"
    && (subjectName === "chinese" || subjectName === "french")
  ) {
    return {
      profileKey: "SEC_CAM_IGCSE",
      effectiveSubjectType: "Cambridge IGCSE",
      source: "intentional_substitution",
      substitutionPolicy: "cambridge_advanced_language_uses_igcse_grading",
    };
  }

  return {
    profileKey: null,
    effectiveSubjectType: args.subjectType || null,
    source: "none",
    substitutionPolicy: null,
  };
}

export function resolveOperationalGradeProfileKey(args: {
  schoolType?: string | null;
  examinationBoard?: string | null;
  streamName?: string | null;
  subjectType?: string | null;
  subjectName?: string | null;
}): GradeProfileKey | null {
  return resolveOperationalGradeProfile(args).profileKey;
}

export function profileMatchesSchool(
  profileKey: string | null | undefined,
  schoolType?: string | null,
  board?: string | null,
): boolean {
  const valid = getGradingProfilesForSchool(schoolType, board).map((profile) => profile.key);
  return !!profileKey && valid.includes(profileKey as GradeProfileKey);
}


export function getSubjectTypeOptionsForSchool(schoolType?: string | null, examinationBoard?: string | null): string[] {
  const resolvedSchoolType = normalizeSchoolType(schoolType);
  const resolvedBoard = normalizeExamBoard(examinationBoard);
  const universal = ["DELF", "HEXCO", "HSK"];
  if (resolvedSchoolType === "primary") {
    return [resolvedBoard === "Cambridge" ? "Cambridge" : "ZIMSEC", ...universal];
  }
  if (resolvedBoard === "Cambridge") {
    return ["Cambridge Advanced Level", "Cambridge Ordinary Level", "Cambridge IGCSE", ...universal];
  }
  return ["ZIMSEC Advanced Level", "ZIMSEC Ordinary Level", ...universal];
}

export function getGradeTypeOptionsForProfile(profileKey: string, schoolType?: string | null, examinationBoard?: string | null): string[] {
  const resolvedSchoolType = normalizeSchoolType(schoolType);
  const resolvedBoard = normalizeExamBoard(examinationBoard);
  const universal = ["DELF", "HEXCO", "HSK"];

  if (resolvedSchoolType === "primary") {
    return [resolvedBoard === "Cambridge" ? "Cambridge" : "ZIMSEC", ...universal];
  }

  switch (profileKey) {
    case "SEC_ZIM_A":
      return ["ZIMSEC Advanced Level", ...universal];
    case "SEC_ZIM_O":
      return ["ZIMSEC Ordinary Level", ...universal];
    case "SEC_CAM_A":
      return ["Cambridge Advanced Level", ...universal];
    case "SEC_CAM_O":
      return ["Cambridge Ordinary Level", ...universal];
    case "SEC_CAM_IGCSE":
      return ["Cambridge IGCSE"];
    default:
      return resolvedBoard === "Cambridge"
        ? ["Cambridge Advanced Level", "Cambridge Ordinary Level", "Cambridge IGCSE", ...universal]
        : ["ZIMSEC Advanced Level", "ZIMSEC Ordinary Level", ...universal];
  }
}

export function subjectMatchesGradeProfile(args: {
  profileKey?: string | null;
  schoolType?: string | null;
  examinationBoard?: string | null;
  streamName?: string | null;
  subjectType?: string | null;
}): boolean {
  if (!args.profileKey) return true;
  if (!args.subjectType) return false;

  const schoolType = normalizeSchoolType(args.schoolType);
  const universalSecondaryTypes = new Set(["DELF", "HEXCO", "HSK"]);
  if (schoolType === "secondary" && universalSecondaryTypes.has(args.subjectType)) {
    if (args.profileKey.endsWith("_IGCSE")) return false;
    if (!args.streamName) {
      return args.profileKey.endsWith("_A") || args.profileKey.endsWith("_O");
    }
    const grouping = resolveSecondaryGroupingFromStream(args.streamName);
    if (grouping === "ADVANCED") {
      return args.profileKey.endsWith("_A");
    }
    if (grouping === "LOWER") {
      return args.profileKey.endsWith("_O");
    }
    return false;
  }

  if (args.streamName) {
    const resolvedProfile = resolveGradeProfileKey({
      schoolType: args.schoolType,
      examinationBoard: args.examinationBoard,
      streamName: args.streamName,
      subjectType: args.subjectType,
    });
    return gradeProfileMatchesStrict(resolvedProfile, args.profileKey);
  }

  return getGradeTypeOptionsForProfile(
    args.profileKey,
    args.schoolType,
    args.examinationBoard,
  ).includes(args.subjectType);
}

export function isSubjectTypeCompatibleWithGradeType(subjectType?: string | null, gradeType?: string | null): boolean {
  if (!gradeType) return true;
  if (!subjectType) return false;
  return subjectType === gradeType;
}

export function profileMatchesStreamName(profileKey: string, streamName?: string | null): boolean {
  if (!streamName) return false;
  if (profileKey.startsWith("PRI_")) {
    const grouping = resolvePrimaryGroupingFromStream(streamName);
    if (!grouping) return false;
    if (profileKey.endsWith("_ECD")) return grouping === "ECD";
    if (profileKey.endsWith("_G12")) return grouping === "G12";
    if (profileKey.endsWith("_G37")) return grouping === "G37";
    return false;
  }

  const grouping = resolveSecondaryGroupingFromStream(streamName);
  if (!grouping) return false;
  if (profileKey.endsWith("_A")) return grouping === "ADVANCED";
  if (profileKey.endsWith("_O") || profileKey.endsWith("_IGCSE")) return grouping === "LOWER";
  return false;
}
