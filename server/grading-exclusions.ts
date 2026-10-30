const DEFAULT_TEMPORARY_EXCLUDED_SUBJECT_NAMES = [
  "Computing - Lower Secondary",
] as const;

function normalizeSubjectName(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function loadConfiguredExcludedSubjectNames(): Set<string> {
  const raw = process.env.GRADING_STRICT_EXCLUDED_SUBJECT_NAMES;
  const names = raw === undefined
    ? [...DEFAULT_TEMPORARY_EXCLUDED_SUBJECT_NAMES]
    : raw.split(/[;,\n]/g).map((value) => value.trim()).filter(Boolean);
  return new Set(names.map(normalizeSubjectName).filter(Boolean));
}

const CONFIGURED_EXCLUDED_SUBJECT_NAMES = loadConfiguredExcludedSubjectNames();

/**
 * Temporary, explicit opt-out from the new exact-grading pipeline.
 *
 * This does not delete the subject, alter marks, or map it to another profile.
 * It only excludes the named subject from strict grade resolution, points,
 * pass/fail summaries, positions, publication blockers, audits, and link repair.
 *
 * Set GRADING_STRICT_EXCLUDED_SUBJECT_NAMES to a comma/semicolon-separated list.
 * Set it to an empty string once the proper profile exists to disable exclusions.
 */
export function isTemporarilyExcludedFromStrictGrading(subjectOrName: unknown): boolean {
  const name = typeof subjectOrName === "object" && subjectOrName !== null
    ? (subjectOrName as { name?: unknown; subjectName?: unknown }).name
      ?? (subjectOrName as { subjectName?: unknown }).subjectName
    : subjectOrName;
  const normalized = normalizeSubjectName(name);
  return !!normalized && CONFIGURED_EXCLUDED_SUBJECT_NAMES.has(normalized);
}

export function getTemporaryStrictGradingExclusions(): string[] {
  return Array.from(CONFIGURED_EXCLUDED_SUBJECT_NAMES).sort();
}
