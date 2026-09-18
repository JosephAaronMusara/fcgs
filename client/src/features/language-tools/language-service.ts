import { getLanguageProvider } from "./provider-registry";
import { runStudentContextChecks } from "./context/student-context-checker";
import type {
  LanguageCheckRequest,
  LanguageCheckResult,
  LanguageIssue,
  LanguageToolsSettings,
} from "./types";

export const DEFAULT_LANGUAGE_TOOLS_SETTINGS: LanguageToolsSettings = {
  enabled: true,
  primaryProvider: null,
  fallbackProvider: "harper",
  mode: "balanced",
  dialect: "en-GB",
  studentNamePersonalization: true,
  genderPronounCheck: true,
};

export async function checkLanguage(
  request: LanguageCheckRequest,
  settings: LanguageToolsSettings = DEFAULT_LANGUAGE_TOOLS_SETTINGS,
): Promise<LanguageCheckResult> {
  if (!settings.enabled || !request.text.trim()) {
    return {
      originalText: request.text,
      providerId: null,
      providerName: null,
      fallbackUsed: false,
      issues: [],
      checkedAt: new Date().toISOString(),
    };
  }

  let providerId: string | null = null;
  let providerName: string | null = null;
  let fallbackUsed = false;
  let providerIssues: LanguageIssue[] = [];
  let lastError: unknown = null;

  const candidates = [settings.primaryProvider, settings.fallbackProvider].filter(
    (value, index, all): value is string => !!value && all.indexOf(value) === index,
  );

  for (const candidate of candidates) {
    try {
      const provider = await getLanguageProvider(candidate);
      if (!provider || !(await provider.isAvailable())) continue;
      providerIssues = await provider.check(request);
      providerId = provider.id;
      providerName = provider.name;
      fallbackUsed = !!settings.primaryProvider && candidate !== settings.primaryProvider;
      if (!settings.primaryProvider && candidate === settings.fallbackProvider) fallbackUsed = true;
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!providerId && candidates.length && lastError) {
    throw lastError;
  }

  const contextIssues = runStudentContextChecks(request, settings);
  return {
    originalText: request.text,
    providerId,
    providerName,
    fallbackUsed,
    issues: [...providerIssues, ...contextIssues],
    checkedAt: new Date().toISOString(),
  };
}

function toCodePoints(value: string) {
  return Array.from(value);
}

export function applyLanguageIssue(text: string, issue: LanguageIssue, replacement?: string) {
  const chars = toCodePoints(text);
  const next = replacement ?? issue.replacements[0];
  if (next === undefined) return text;
  chars.splice(issue.start, Math.max(0, issue.end - issue.start), ...toCodePoints(next));
  return chars.join("");
}

export function applySafeLanguageIssues(text: string, issues: LanguageIssue[]) {
  const safe = issues
    .filter((issue) => issue.action === "safe" && issue.replacements.length > 0)
    .sort((a, b) => b.start - a.start || b.end - a.end);
  let result = text;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const issue of safe) {
    if (issue.end > lastStart) continue;
    result = applyLanguageIssue(result, issue, issue.replacements[0]);
    lastStart = issue.start;
  }
  return result;
}
