import { asc, sql } from "drizzle-orm";
import { students } from "@shared/schema";

export type StudentNameRecord = {
  id?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  admissionNo?: string | null;
};

const studentNameCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function normalizedNamePart(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Default ordering for ordinary student lists and rosters.
 * Business-specific rankings (merit, arrears, performance, chronology, etc.)
 * should continue to apply their own explicit ordering instead.
 */
export function compareStudentsByFirstName(
  left: StudentNameRecord,
  right: StudentNameRecord,
): number {
  return (
    studentNameCollator.compare(
      normalizedNamePart(left.firstName),
      normalizedNamePart(right.firstName),
    ) ||
    studentNameCollator.compare(
      normalizedNamePart(left.lastName),
      normalizedNamePart(right.lastName),
    ) ||
    studentNameCollator.compare(
      normalizedNamePart(left.admissionNo),
      normalizedNamePart(right.admissionNo),
    ) ||
    Number(left.id ?? 0) - Number(right.id ?? 0)
  );
}

export function sortStudentsByFirstName<T extends StudentNameRecord>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(compareStudentsByFirstName);
}

/**
 * Database equivalent of compareStudentsByFirstName. This must be applied
 * before LIMIT/OFFSET so pagination is alphabetically stable across pages.
 */
export const studentFirstNameOrder = [
  asc(sql`lower(trim(coalesce(${students.firstName}, '')))`),
  asc(sql`lower(trim(coalesce(${students.lastName}, '')))`),
  asc(sql`lower(trim(coalesce(${students.admissionNo}, '')))`),
  asc(students.id),
] as const;
