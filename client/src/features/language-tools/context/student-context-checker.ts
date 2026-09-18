import type { LanguageCheckRequest, LanguageIssue, LanguageToolsSettings } from "../types";

const FEMALE_PRONOUNS: Record<string, string> = {
  he: "she",
  him: "her",
  his: "her",
  himself: "herself",
};
const MALE_PRONOUNS: Record<string, string> = {
  she: "he",
  her: "him",
  hers: "his",
  herself: "himself",
};

function preserveCase(source: string, replacement: string) {
  if (source.toUpperCase() === source) return replacement.toUpperCase();
  if (source[0]?.toUpperCase() === source[0]) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function findPronounIssues(request: LanguageCheckRequest): LanguageIssue[] {
  const gender = request.student?.gender?.trim().toLowerCase();
  const map = gender === "female" ? FEMALE_PRONOUNS : gender === "male" ? MALE_PRONOUNS : null;
  if (!map) return [];

  const issues: LanguageIssue[] = [];
  const regex = /\b(he|him|his|himself|she|her|hers|herself)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(request.text))) {
    const replacement = map[match[0].toLowerCase()];
    if (!replacement) continue;
    const start = Array.from(request.text.slice(0, match.index)).length;
    const length = Array.from(match[0]).length;
    issues.push({
      id: `context:gender:${start}`,
      source: "context",
      category: "context",
      action: "review",
      message: `Possible student gender/pronoun mismatch (${request.student?.gender}).`,
      start,
      end: start + length,
      originalText: match[0],
      replacements: [preserveCase(match[0], replacement)],
      ruleId: "student-gender-pronoun",
    });
  }
  return issues;
}

function findNamePersonalizationIssue(request: LanguageCheckRequest): LanguageIssue[] {
  const firstName = request.student?.firstName?.trim();
  if (!firstName || !request.text.trim()) return [];
  const nameRegex = new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (nameRegex.test(request.text)) return [];

  const leadingPronoun = request.text.match(/^(\s*)(he|she|they)\b/i);
  if (!leadingPronoun) return [];
  const raw = leadingPronoun[2];
  const index = (leadingPronoun[1] || "").length;
  const start = Array.from(request.text.slice(0, index)).length;
  const end = start + Array.from(raw).length;
  return [{
    id: `context:name:${start}`,
    source: "context",
    category: "context",
    action: "review",
    message: `Personalise the opening by using ${firstName}'s name.`,
    start,
    end,
    originalText: raw,
    replacements: [firstName],
    ruleId: "student-name-personalization",
  }];
}

export function runStudentContextChecks(
  request: LanguageCheckRequest,
  settings: LanguageToolsSettings,
): LanguageIssue[] {
  const issues: LanguageIssue[] = [];
  if (settings.genderPronounCheck) issues.push(...findPronounIssues(request));
  if (settings.studentNamePersonalization) issues.push(...findNamePersonalizationIssue(request));
  return issues;
}
