export const RECRUITMENT_CATEGORY_LABELS = [
  "High School Teaching",
  "Primary School Teaching",
  "Non-Teaching / Support Staff",
] as const;

export type RecruitmentCategoryLabel = typeof RECRUITMENT_CATEGORY_LABELS[number];
export type RecruitmentCategoryCode = "high_school_teaching" | "primary_teaching" | "non_teaching";

export const RECRUITMENT_CATEGORIES: ReadonlyArray<{ code: RecruitmentCategoryCode; label: RecruitmentCategoryLabel }> = [
  { code: "high_school_teaching", label: "High School Teaching" },
  { code: "primary_teaching", label: "Primary School Teaching" },
  { code: "non_teaching", label: "Non-Teaching / Support Staff" },
];


export const RECRUITMENT_DEPARTMENTS = [
  "Primary School",
  "Sciences",
  "Commercials",
  "Arts",
  "Computer Sciences",
] as const;

export const HIGH_SCHOOL_RECRUITMENT_DEPARTMENTS = [
  "Sciences",
  "Commercials",
  "Arts",
  "Computer Sciences",
] as const;

export const RECRUITMENT_EXAM_BOARDS = ["ZIMSEC", "Cambridge"] as const;
export type RecruitmentExamBoard = typeof RECRUITMENT_EXAM_BOARDS[number];

export type RecruitmentDepartment = typeof RECRUITMENT_DEPARTMENTS[number];

export function normalizeRecruitmentDepartment(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.toLowerCase() === "it") return "Computer Sciences";
  const match = RECRUITMENT_DEPARTMENTS.find((department) => department.toLowerCase() === raw.toLowerCase());
  return match || raw;
}

export function isSupportedRecruitmentDepartment(value: unknown): boolean {
  const normalized = normalizeRecruitmentDepartment(value);
  return RECRUITMENT_DEPARTMENTS.includes(normalized as RecruitmentDepartment);
}

export function normalizeExamBoard(value: unknown): string {
  const original = String(value ?? "").trim().replace(/\s+/g, " ");
  const raw = original.toLowerCase();
  if (!raw) return "";
  if (raw === "zimsec") return "ZIMSEC";
  if (raw === "cambridge") return "Cambridge";
  // Legacy only: historical applications and vacancies may still contain this value.
  if (raw === "both") return "Both";
  return original;
}

export function normalizeExamBoardList(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "").trim()
      ? String(value).split(/[,;]/g)
      : [];
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (board: string) => {
    const normalized = normalizeExamBoard(board);
    if (!normalized) return;
    if (normalized === "Both") {
      // Historical "Both" meant the two original Recruitment boards. Do not expand
      // it to every board that may be configured in future.
      for (const legacyBoard of ["ZIMSEC", "Cambridge"]) add(legacyBoard);
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  };
  for (const item of source) add(String(item ?? ""));
  return result;
}

export function formatExamBoards(value: unknown): string {
  return normalizeExamBoardList(value).join(", ");
}

export function examBoardMatches(candidate: unknown, vacancy: unknown): boolean {
  const candidateBoards = normalizeExamBoardList(candidate).map((board) => board.toLowerCase());
  const vacancyBoards = normalizeExamBoardList(vacancy).map((board) => board.toLowerCase());
  if (!vacancyBoards.length) return true;
  if (!candidateBoards.length) return false;
  // A vacancy normally has one board. For a historical "Both" vacancy, require
  // capability in both original boards rather than treating "Both" as a third board.
  return vacancyBoards.every((board) => candidateBoards.includes(board));
}

export function normalizeSubjectList(values: unknown): string[] {
  const source = Array.isArray(values) ? values : String(values ?? "").split(",");
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of source) {
    const label = String(value ?? "").trim().replace(/\s+/g, " ");
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

export function subjectsOverlap(candidateSubjects: unknown, vacancySubjects: unknown): boolean {
  const vacancy = normalizeSubjectList(vacancySubjects).map((value) => value.toLowerCase());
  if (!vacancy.length) return true;
  const candidate = new Set(normalizeSubjectList(candidateSubjects).map((value) => value.toLowerCase()));
  return vacancy.some((subject) => candidate.has(subject));
}

export const A_LEVEL_GRADE_POINTS = {
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
  U: 0,
} as const;

export type ALevelGrade = keyof typeof A_LEVEL_GRADE_POINTS;
export const A_LEVEL_GRADES = Object.keys(A_LEVEL_GRADE_POINTS) as ALevelGrade[];

export type ALevelResultInput = {
  subject: string;
  grade: ALevelGrade | string;
};

export const O_LEVEL_GRADES = ["A*", "A", "B", "C", "D", "E", "U"] as const;
export type OLevelGrade = typeof O_LEVEL_GRADES[number];

export type OLevelResultInput = {
  subject: string;
  grade: OLevelGrade | string;
  sitting: number;
};

export function recruitmentCategoryCode(value: unknown): RecruitmentCategoryCode | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  const match = RECRUITMENT_CATEGORIES.find((category) => category.label.toLowerCase() === normalized);
  return match?.code ?? null;
}

export function isSupportedRecruitmentCategory(value: unknown): value is RecruitmentCategoryLabel {
  return recruitmentCategoryCode(value) !== null;
}

export function isHighSchoolCoreRequirementDefinition(requirement: { code?: unknown; label?: unknown }): boolean {
  const text = `${String(requirement.code ?? "")} ${String(requirement.label ?? "")}`
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const compact = text.replace(/\s+/g, "");
  const isAgeRule = /(^|\s)age(\s|$)/.test(text)
    || text.includes("years old")
    || /\b\d{1,2}\s*years?\s*(and\s*)?(below|or\s*below|maximum|max)\b/.test(text)
    || compact.includes("maximumage")
    || compact.includes("maxage");
  const isALevelRule = (text.includes("a level") || compact.includes("alevel"))
    && (text.includes("point") || text.includes("grade") || text.includes("result"));
  const isTeachingQualificationRule = text.includes("teaching qualification")
    || text.includes("teacher qualification")
    || compact.includes("teachingqualification")
    || compact.includes("teacherqualification");
  return isAgeRule || isALevelRule || isTeachingQualificationRule;
}

export function isPrimarySchoolCoreRequirementDefinition(requirement: { code?: unknown; label?: unknown }): boolean {
  const text = `${String(requirement.code ?? "")} ${String(requirement.label ?? "")}`
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const compact = text.replace(/\s+/g, "");
  const isTeachingQualificationRule = text.includes("teaching qualification")
    || text.includes("teacher qualification")
    || compact.includes("teachingqualification")
    || compact.includes("teacherqualification");
  const isOLevelRule = text.includes("o level") || compact.includes("olevel");
  const isSittingRule = text.includes("sitting") || compact.includes("sittings");
  const isMandatoryCoreSubject = ["mathematics", "maths", "science", "english"]
    .some((subject) => text.includes(subject));
  return isTeachingQualificationRule || isOLevelRule || isSittingRule || isMandatoryCoreSubject;
}

export type CoreRecruitmentDocumentRequirement = {
  code: string;
  label: string;
  isRequired: boolean;
  allowsMultiple: boolean;
  reasonCode: string;
};

export function coreRecruitmentDocumentRequirements(
  category: RecruitmentCategoryCode | null,
  holdsTeachingQualification = false,
  primaryTeachingQualificationRequired = true,
): CoreRecruitmentDocumentRequirement[] {
  if (category === "high_school_teaching") {
    return [
      { code: "curriculum_vitae", label: "Curriculum Vitae", isRequired: true, allowsMultiple: false, reasonCode: "core:curriculum_vitae_required" },
      { code: "a_level_certificate", label: "A-Level Certificate", isRequired: true, allowsMultiple: false, reasonCode: "core:a_level_certificate_required" },
      { code: "college_transcript", label: "College Transcript", isRequired: true, allowsMultiple: false, reasonCode: "core:college_transcript_required" },
      { code: "teaching_certificate", label: "Teaching Certificate", isRequired: holdsTeachingQualification, allowsMultiple: false, reasonCode: "core:teaching_certificate_required" },
    ];
  }
  if (category === "primary_teaching") {
    return [
      { code: "curriculum_vitae", label: "Curriculum Vitae", isRequired: true, allowsMultiple: false, reasonCode: "core:curriculum_vitae_required" },
      { code: "teaching_certificate", label: "Teaching Certificate / Teaching Qualification", isRequired: primaryTeachingQualificationRequired || holdsTeachingQualification, allowsMultiple: false, reasonCode: "core:teaching_certificate_required" },
    ];
  }
  if (category === "non_teaching") {
    return [
      { code: "curriculum_vitae", label: "Curriculum Vitae", isRequired: true, allowsMultiple: false, reasonCode: "core:curriculum_vitae_required" },
    ];
  }
  return [];
}
