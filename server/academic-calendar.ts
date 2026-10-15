import { eq } from "drizzle-orm";
import { db } from "./db";
import { organizations, schools } from "@shared/schema";
import { academicDateKey, resolveAcademicCalendar, SCHOOL_CALENDAR_FIELDS, type CalendarDates } from "@shared/academic-calendar";

/** HQ is authoritative, independent of legacy per-school term defaults. */
export async function getSchoolAcademicCalendar(schoolId: number, date = new Date()) {
  const [school] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error("School not found");
  if (!school.organizationId) return resolveAcademicCalendar(null, academicDateKey(date));
  const [org] = await db.select().from(organizations).where(eq(organizations.id, school.organizationId)).limit(1);
  return resolveAcademicCalendar(org as CalendarDates | undefined, academicDateKey(date));
}

/** Used for calendar-aware API views; does not rewrite legacy school data. */
export function applyHeadquartersCalendar<T extends { currentAcademicYear?: string | null; currentTerm?: string | null }>(school: T, org: CalendarDates | undefined | null, date = new Date()): T {
  const effective = resolveAcademicCalendar(org, academicDateKey(date));
  const academicFields: Record<string, unknown> = {};
  for (const name of SCHOOL_CALENDAR_FIELDS) academicFields[name] = name === "currentTerm" ? null : org?.[name] ?? null;
  return { ...school, ...academicFields, currentAcademicYear: effective.academicYear, currentTerm: effective.period } as T;
}
