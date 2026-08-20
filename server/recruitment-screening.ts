import {
  A_LEVEL_GRADE_POINTS,
  A_LEVEL_GRADES,
  type ALevelGrade,
  type ALevelResultInput,
} from "@shared/recruitment";

export type RecruitmentRequirementForEvaluation = {
  inputType: string;
  acceptedValues: unknown;
  minimumNumber: string | number | null;
  maximumNumber: string | number | null;
  alternativePassKeywords: unknown;
  alternativePassNote: string | null;
};

export type RecruitmentRequirementEvaluation = {
  passed: boolean;
  alternativeAccepted: boolean;
  evaluationNote: string | null;
};

export type HighSchoolEligibilityPolicy = {
  maxAge: number;
  minimumALevelPoints: number;
  teachingQualifiedMinimumALevelPoints: number;
  teachingQualificationExceptionEnabled: boolean;
};

export type HighSchoolEligibilityEvaluation = {
  passed: boolean;
  age: number | null;
  aLevelPoints: number | null;
  route: "standard" | "teaching_qualification_exception" | null;
  failedCodes: string[];
};

function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function evaluateConfiguredRule(requirement: RecruitmentRequirementForEvaluation, answer: unknown): boolean {
  const acceptedValues = Array.isArray(requirement.acceptedValues) ? requirement.acceptedValues : [];

  if (requirement.inputType === "boolean") {
    const booleanValue = answer === true
      || answer === "true"
      || answer === 1
      || answer === "1"
      || String(answer).toLowerCase() === "yes";
    if (acceptedValues.length === 0) return booleanValue;
    return acceptedValues.some((value) => (
      String(value).toLowerCase() === String(booleanValue).toLowerCase()
      || String(value).toLowerCase() === String(answer).toLowerCase()
    ));
  }

  if (requirement.inputType === "number") {
    const numberValue = Number(answer);
    if (!Number.isFinite(numberValue)) return false;
    if (requirement.minimumNumber != null && numberValue < Number(requirement.minimumNumber)) return false;
    if (requirement.maximumNumber != null && numberValue > Number(requirement.maximumNumber)) return false;
    if (acceptedValues.length > 0 && !acceptedValues.some((value) => Number(value) === numberValue)) return false;
    return true;
  }

  const textValue = String(answer ?? "").trim();
  if (!textValue) return false;
  if (acceptedValues.length > 0) {
    return acceptedValues.some((value) => String(value).trim().toLowerCase() === textValue.toLowerCase());
  }
  return true;
}

export function evaluateRecruitmentRequirement(
  requirement: RecruitmentRequirementForEvaluation,
  answer: unknown,
  applicantQualifications: unknown,
): RecruitmentRequirementEvaluation {
  if (evaluateConfiguredRule(requirement, answer)) {
    return { passed: true, alternativeAccepted: false, evaluationNote: null };
  }

  const alternativeKeywords = Array.isArray(requirement.alternativePassKeywords)
    ? requirement.alternativePassKeywords.map((value) => normalizeSearchText(value)).filter(Boolean)
    : [];
  if (alternativeKeywords.length === 0) {
    return { passed: false, alternativeAccepted: false, evaluationNote: null };
  }

  const searchableApplicantText = normalizeSearchText([
    typeof answer === "string" ? answer : JSON.stringify(answer ?? ""),
    applicantQualifications,
  ].join(" "));
  const applicantTokens = searchableApplicantText.split(" ").filter(Boolean);
  const matchedKeyword = alternativeKeywords.find((keyword) => {
    if (searchableApplicantText.includes(keyword)) return true;
    const collapsedKeyword = keyword.replace(/\s+/g, "");
    return collapsedKeyword.length >= 2 && collapsedKeyword.length <= 8 && applicantTokens.includes(collapsedKeyword);
  });
  if (!matchedKeyword) {
    return { passed: false, alternativeAccepted: false, evaluationNote: null };
  }

  return {
    passed: true,
    alternativeAccepted: true,
    evaluationNote: requirement.alternativePassNote?.trim()
      || "Passed through a configured alternative qualification equivalency.",
  };
}

export function calculateAgeOnDate(dateOfBirth: string, asOf = new Date(), timeZone = "Africa/Harare"): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;

  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(asOf)
    .reduce<Record<string, string>>((acc, part) => { if (part.type !== "literal") acc[part.type] = part.value; return acc; }, {});
  const currentYear = Number(parts.year);
  const currentMonth = Number(parts.month);
  const currentDay = Number(parts.day);
  if (!Number.isInteger(currentYear) || !Number.isInteger(currentMonth) || !Number.isInteger(currentDay)) return null;
  if (year > currentYear || (year === currentYear && (month > currentMonth || (month === currentMonth && day > currentDay)))) return null;

  let age = currentYear - year;
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  return age >= 0 ? age : null;
}

function normalizeSubject(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function calculateALevelPoints(results: ALevelResultInput[]): { points: number | null; valid: boolean; reason?: string } {
  if (!Array.isArray(results) || results.length === 0) {
    return { points: null, valid: false, reason: "missing_results" };
  }
  const seenSubjects = new Set<string>();
  let points = 0;
  for (const result of results) {
    const subject = String(result?.subject ?? "").trim();
    const normalizedSubject = normalizeSubject(subject);
    const grade = String(result?.grade ?? "").trim().toUpperCase() as ALevelGrade;
    if (!subject || !normalizedSubject) return { points: null, valid: false, reason: "invalid_subject" };
    if (seenSubjects.has(normalizedSubject)) return { points: null, valid: false, reason: "duplicate_subject" };
    if (!A_LEVEL_GRADES.includes(grade)) return { points: null, valid: false, reason: "invalid_grade" };
    seenSubjects.add(normalizedSubject);
    points += A_LEVEL_GRADE_POINTS[grade];
  }
  return { points, valid: true };
}

export function evaluateHighSchoolEligibility(input: {
  dateOfBirth: string | null | undefined;
  aLevelResults: ALevelResultInput[];
  holdsTeachingQualification: boolean;
  teachingCertificateUploaded: boolean;
  policy: HighSchoolEligibilityPolicy;
  asOf?: Date;
}): HighSchoolEligibilityEvaluation {
  const failedCodes: string[] = [];
  const age = input.dateOfBirth ? calculateAgeOnDate(input.dateOfBirth, input.asOf ?? new Date()) : null;
  if (age == null) failedCodes.push("core:date_of_birth_required");
  else if (age > input.policy.maxAge) failedCodes.push("core:age_over_limit");

  const pointsResult = calculateALevelPoints(input.aLevelResults);
  if (!pointsResult.valid || pointsResult.points == null) {
    failedCodes.push(`core:a_level_${pointsResult.reason || "results_invalid"}`);
    return { passed: false, age, aLevelPoints: null, route: null, failedCodes };
  }

  const aLevelPoints = pointsResult.points;
  if (age == null || age > input.policy.maxAge) {
    return { passed: false, age, aLevelPoints, route: null, failedCodes };
  }

  if (aLevelPoints >= input.policy.minimumALevelPoints) {
    return { passed: true, age, aLevelPoints, route: "standard", failedCodes: [] };
  }

  const exceptionPotentiallyQualifies = input.policy.teachingQualificationExceptionEnabled
    && input.holdsTeachingQualification
    && aLevelPoints >= input.policy.teachingQualifiedMinimumALevelPoints;

  if (exceptionPotentiallyQualifies && input.teachingCertificateUploaded) {
    return {
      passed: true,
      age,
      aLevelPoints,
      route: "teaching_qualification_exception",
      failedCodes: [],
    };
  }

  if (exceptionPotentiallyQualifies && !input.teachingCertificateUploaded) {
    failedCodes.push("core:teaching_certificate_required");
  } else {
    failedCodes.push("core:insufficient_a_level_points");
  }

  return { passed: false, age, aLevelPoints, route: null, failedCodes };
}

export function publicHighSchoolEligibilityPolicy(policy: HighSchoolEligibilityPolicy) {
  return {
    maxAge: policy.maxAge,
    minimumALevelPoints: policy.minimumALevelPoints,
    gradeOptions: A_LEVEL_GRADES,
    gradePoints: A_LEVEL_GRADE_POINTS,
  };
}
