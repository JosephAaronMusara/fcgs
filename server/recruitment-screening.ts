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
