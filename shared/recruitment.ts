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
      { code: "teaching_certificate", label: "Teaching Certificate / Teaching Qualification", isRequired: true, allowsMultiple: false, reasonCode: "core:teaching_certificate_required" },
    ];
  }
  if (category === "non_teaching") {
    return [
      { code: "curriculum_vitae", label: "Curriculum Vitae", isRequired: true, allowsMultiple: false, reasonCode: "core:curriculum_vitae_required" },
    ];
  }
  return [];
}
