/** Headquarters academic calendar is authoritative for every campus.
 * Date-only comparisons avoid server/browser UTC boundary disagreements.
 * School calendar columns are legacy and must not be used as overrides.
 */
export const ACADEMIC_PERIODS = ["term1", "vac1", "term2", "vac2", "term3"] as const;
export type AcademicPeriod = (typeof ACADEMIC_PERIODS)[number];
export type AcademicTerm = "term1" | "term2" | "term3";
export type CalendarDates = {
  currentAcademicYear?: string | null;
  term1StartDate?: string | null; term1EndDate?: string | null;
  vac1StartDate?: string | null; vac1EndDate?: string | null;
  term2StartDate?: string | null; term2EndDate?: string | null;
  vac2StartDate?: string | null; vac2EndDate?: string | null;
  term3StartDate?: string | null; term3EndDate?: string | null;
};
export type ResolvedAcademicPeriod = {
  academicYear: string | null;
  period: AcademicPeriod | null;
  term: AcademicTerm | null;
  label: string;
  start: string | null;
  end: string | null;
  error: string | null;
  ranges: Partial<Record<AcademicPeriod, { start: string; end: string }>>;
};

const PERIOD_LABELS: Record<AcademicPeriod, string> = {
  term1: "Term 1", vac1: "Vacation 1", term2: "Term 2", vac2: "Vacation 2", term3: "Term 3",
};
const validDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
function adjacentDay(key: string, direction: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + direction);
  return date.toISOString().slice(0, 10);
}
export function academicDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function resolveAcademicCalendar(calendar: CalendarDates | null | undefined, dateKey = academicDateKey()): ResolvedAcademicPeriod {
  const academicYear = String(calendar?.currentAcademicYear ?? "").trim() || null;
  const base: ResolvedAcademicPeriod = { academicYear, period: null, term: null, label: "No active academic period", start: null, end: null, error: null, ranges: {} };
  if (!calendar) return { ...base, error: "Headquarters academic calendar is not configured." };
  if (!academicYear || !/^\d{4}$/.test(academicYear)) return { ...base, error: "Configure the academic year in Headquarters Global Settings." };
  if (!validDay(dateKey)) return { ...base, error: "Invalid calendar reference date." };
  const range = (period: AcademicPeriod) => ({
    start: (calendar[`${period}StartDate` as keyof CalendarDates] || "").trim(),
    end: (calendar[`${period}EndDate` as keyof CalendarDates] || "").trim(),
  });
  for (const term of ["term1", "term2", "term3"] as const) {
    const { start, end } = range(term);
    if (!start || !end || !validDay(start) || !validDay(end) || start > end) {
      return { ...base, error: `Configure valid start and end dates for ${PERIOD_LABELS[term]} in Headquarters Global Settings.` };
    }
    base.ranges[term] = { start, end };
  }
  for (const [vacation, before, after] of [["vac1", "term1", "term2"], ["vac2", "term2", "term3"]] as const) {
    const { start, end } = range(vacation);
    if (Boolean(start) !== Boolean(end)) return { ...base, error: `${PERIOD_LABELS[vacation]} needs both dates or neither date.` };
    // The existing UI promises to derive vacation boundaries when both are blank.
    const inferred = !start && !end;
    const actualStart = inferred ? adjacentDay(base.ranges[before]!.end, 1) : start;
    const actualEnd = inferred ? adjacentDay(base.ranges[after]!.start, -1) : end;
    if (!validDay(actualStart) || !validDay(actualEnd)) return { ...base, error: `Invalid ${PERIOD_LABELS[vacation]} dates.` };
    if (actualStart <= actualEnd) base.ranges[vacation] = { start: actualStart, end: actualEnd };
    else if (!inferred) return { ...base, error: `${PERIOD_LABELS[vacation]} ends before it starts.` };
  }
  const ordered = ACADEMIC_PERIODS.flatMap(period => base.ranges[period] ? [{ period, ...base.ranges[period]! }] : []);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].start <= ordered[index - 1].end) {
      return { ...base, error: `Headquarters academic periods overlap (${PERIOD_LABELS[ordered[index - 1].period]} and ${PERIOD_LABELS[ordered[index].period]}).` };
    }
  }
  const active = ordered.find(row => row.start <= dateKey && dateKey <= row.end);
  if (!active) return base; // No forced Term 1 during gaps or next year's rollover.
  return { ...base, period: active.period, term: active.period.startsWith("term") ? active.period as AcademicTerm : null,
    label: PERIOD_LABELS[active.period], start: active.start, end: active.end };
}

export const SCHOOL_CALENDAR_FIELDS = [
  "currentAcademicYear", "currentTerm", "term1StartDate", "term1EndDate", "vac1StartDate", "vac1EndDate",
  "term2StartDate", "term2EndDate", "vac2StartDate", "vac2EndDate", "term3StartDate", "term3EndDate",
] as const;
