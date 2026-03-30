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

export const LEGACY_SUBJECT_TYPES = ["ZIMSEC", "Cambridge", "HEXCO", "DELF", "HSK"] as const;

export const GRADE_PROFILE_KEYS = [
  "A_Level",
  "O_Level",
  "IGCSE",
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


const PROFILE_KEY_COMPATIBILITY: Partial<Record<GradeProfileKey, GradeProfileKey[]>> = {
  SEC_ZIM_A: ["A_Level", "SEC_CAM_A"],
  SEC_CAM_A: ["A_Level", "SEC_ZIM_A"],
  SEC_ZIM_O: ["O_Level", "SEC_CAM_O", "SEC_CAM_IGCSE"],
  SEC_CAM_O: ["O_Level", "SEC_ZIM_O"],
  SEC_CAM_IGCSE: ["IGCSE", "SEC_CAM_O", "SEC_ZIM_O"],
  PRI_ZIM_ECD: ["PRI_CAM_ECD"],
  PRI_CAM_ECD: ["PRI_ZIM_ECD"],
  PRI_ZIM_G12: ["PRI_CAM_G12"],
  PRI_CAM_G12: ["PRI_ZIM_G12"],
  PRI_ZIM_G37: ["PRI_CAM_G37"],
  PRI_CAM_G37: ["PRI_ZIM_G37"],
};

export function getCompatibleGradeProfileKeys(profileKey?: string | null): string[] {
  if (!profileKey) return [];
  const key = profileKey as GradeProfileKey;
  return Array.from(new Set([profileKey, ...(PROFILE_KEY_COMPATIBILITY[key] || [])]));
}

export function filterItemsByGradeProfileKey<T extends { gradeLevel?: string | null }>(
  items: T[],
  profileKey?: string | null,
): T[] {
  if (!profileKey) return items;
  const exact = items.filter((item) => (item.gradeLevel || null) === profileKey);
  if (exact.length > 0) return exact;
  const compatibleKeys = new Set(getCompatibleGradeProfileKeys(profileKey).filter((key) => key !== profileKey));
  if (compatibleKeys.size === 0) return exact;
  return items.filter((item) => !!item.gradeLevel && compatibleKeys.has(item.gradeLevel));
}

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
  if (key === "A_Level") return "Advanced Level";
  if (key === "O_Level") return "Ordinary Level";
  if (key === "IGCSE") return "IGCSE";
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

export function resolveGradeProfileKey(args: {
  schoolType?: string | null;
  examinationBoard?: string | null;
  streamName?: string | null;
  subjectType?: string | null;
}): GradeProfileKey | null {
  const schoolType = normalizeSchoolType(args.schoolType);
  const board = normalizeExamBoard(args.examinationBoard);
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
    if (
      subjectType === "Cambridge Advanced Level" ||
      subjectType === "DELF" ||
      subjectType === "HEXCO" ||
      subjectType === "HSK"
    ) {
      return "SEC_CAM_A";
    }
    if (subjectType === "ZIMSEC Advanced Level") {
      return "SEC_ZIM_A";
    }
    return board === "Cambridge" ? "SEC_CAM_A" : "SEC_ZIM_A";
  }

  if (subjectType === "Cambridge IGCSE") return "SEC_CAM_IGCSE";
  if (subjectType === "Cambridge Ordinary Level") return "SEC_CAM_O";
  if (subjectType === "ZIMSEC Ordinary Level") return "SEC_ZIM_O";
  if (subjectType === "DELF" || subjectType === "HEXCO" || subjectType === "HSK") return "SEC_CAM_O";
  return board === "Cambridge" ? "SEC_CAM_O" : "SEC_ZIM_O";
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
    case "A_Level":
      return ["ZIMSEC Advanced Level", ...universal];
    case "SEC_ZIM_O":
    case "O_Level":
      return ["ZIMSEC Ordinary Level", ...universal];
    case "SEC_CAM_A":
      return ["Cambridge Advanced Level", ...universal];
    case "SEC_CAM_O":
      return ["Cambridge Ordinary Level", ...universal];
    case "SEC_CAM_IGCSE":
    case "IGCSE":
      return ["Cambridge IGCSE"];
    default:
      return resolvedBoard === "Cambridge"
        ? ["Cambridge Advanced Level", "Cambridge Ordinary Level", "Cambridge IGCSE", ...universal]
        : ["ZIMSEC Advanced Level", "ZIMSEC Ordinary Level", ...universal];
  }
}

export function isSubjectTypeCompatibleWithGradeType(subjectType?: string | null, gradeType?: string | null): boolean {
  if (!gradeType) return true;
  if (!subjectType) return true;
  if (subjectType === gradeType) return true;

  const universal = new Set(["DELF", "HEXCO", "HSK"]);
  if (universal.has(subjectType) && universal.has(gradeType)) return true;
  if (universal.has(subjectType)) {
    if (gradeType === "Cambridge Advanced Level") return true;
    if (gradeType === "Cambridge Ordinary Level") return true;
    if (gradeType === "Cambridge") return true;
  }
  return false;
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
  if (profileKey.endsWith("_A") || profileKey === "A_Level") return grouping === "ADVANCED";
  if (profileKey.endsWith("_O") || profileKey === "O_Level" || profileKey === "IGCSE" || profileKey.endsWith("_IGCSE")) return grouping === "LOWER";
  return false;
}
