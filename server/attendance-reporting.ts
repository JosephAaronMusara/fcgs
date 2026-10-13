import type { Express, Request, Response } from "express";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requirePermission } from "./auth";
import { storage } from "./storage";
import {
  attendanceRecords,
  classes,
  classTeacherAssignments,
  internalTransfers,
  schoolDayOverrides,
  schoolDaySchedules,
  schools,
  staff,
  staffSubjects,
  studentEnrollmentEvents,
  students,
  type User,
} from "@shared/schema";

const PRESENT_STATUSES = new Set(["present", "late"]);
const ABSENT_STATUSES = new Set(["absent", "sick", "fees", "suspended", "absconding", "excused"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 370;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

type AttendanceReportFilters = {
  schoolId: number;
  classId?: number | null;
  from: string;
  to: string;
  search?: string;
  status?: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  minAbsentDays: number;
  minConsecutiveDays: number;
  minStoppedDays: number;
};

type AuthoritativeAttendance = {
  id: number;
  studentId: number;
  classId: number;
  date: string;
  status: string;
  reason: string | null;
  source: string | null;
  gateEvidenceLocked: boolean;
};

type StudentSummary = {
  studentId: number;
  admissionNo: string;
  studentName: string;
  classId: number | null;
  className: string;
  currentStatus: string;
  expectedDays: number;
  recordedDays: number;
  presentDays: number;
  absentDays: number;
  notRecordedDays: number;
  attendancePercentage: number | null;
  dataCompletenessPercentage: number | null;
  perfectAttendance: boolean;
  lastPresent: string | null;
  consecutiveAbsentDays: number;
  absentDaysSinceLastPresent: number;
  conflictingDays: number;
  attendanceIncomplete: boolean;
  historicalClassUncertain: boolean;
  reasons: Record<string, number>;
  reviewIndicator?: string;
};

type ReportingContext = {
  filters: AttendanceReportFilters;
  school: typeof schools.$inferSelect;
  schoolDays: string[];
  classRows: Array<typeof classes.$inferSelect>;
  summaries: StudentSummary[];
  historyByStudent: Map<number, Array<AuthoritativeAttendance>>;
  enrollmentWindows: Map<number, { start: string; end: string; uncertain: boolean }>;
  calendarConfidence: "configured" | "weekly_only";
};

function asDateOnly(value: unknown): string | null {
  const text = String(value || "").trim();
  return DATE_RE.test(text) ? text : null;
}

function parsePositiveInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function compareIso(a: string, b: string) { return a.localeCompare(b); }
function minIso(a: string, b: string) { return compareIso(a, b) <= 0 ? a : b; }
function maxIso(a: string, b: string) { return compareIso(a, b) >= 0 ? a : b; }

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function datesBetween(from: string, to: string) {
  const dates: string[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

function reportDateRangeDays(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1;
}

async function resolveSchoolScope(req: Request, res: Response): Promise<number | null> {
  const user = req.user as User;
  let schoolId: number | null = user.schoolId || null;
  if (user.role === "org_admin") {
    const raw = req.headers["x-school-id"];
    const parsed = Number.parseInt(Array.isArray(raw) ? raw[0] : String(raw || ""), 10);
    schoolId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (!schoolId) {
    res.status(400).json({ message: "School context required" });
    return null;
  }
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) {
    res.status(404).json({ message: "School not found" });
    return null;
  }
  if (user.role === "org_admin") {
    if (user.organizationId !== null && user.organizationId !== undefined) {
      if (school.organizationId !== user.organizationId) {
        res.status(403).json({ message: "School is outside your organisation context" });
        return null;
      }
    } else {
      const allowed = await storage.getUserSchoolAccess(user.id);
      if (!allowed.includes(schoolId)) {
        res.status(403).json({ message: "School is outside your authorised scope" });
        return null;
      }
    }
  }
  return schoolId;
}

async function resolveAllowedClassIds(user: User, schoolId: number): Promise<number[]> {
  const schoolClasses = await db.select().from(classes).where(and(eq(classes.schoolId, schoolId), isNull(classes.archivedAt)));
  const allIds = schoolClasses.map((row) => row.id);
  if (!["teacher", "assistant_teacher"].includes(user.role)) return allIds;

  const [staffRow] = await db.select({ id: staff.id }).from(staff).where(and(eq(staff.userId, user.id), eq(staff.schoolId, schoolId))).limit(1);
  if (!staffRow) return [];
  const now = new Date();
  const [teacherAssignments, subjectAssignments] = await Promise.all([
    db.select({ classId: classTeacherAssignments.classId }).from(classTeacherAssignments).where(and(
      eq(classTeacherAssignments.teacherId, staffRow.id),
      lte(classTeacherAssignments.effectiveFrom, now),
      or(isNull(classTeacherAssignments.effectiveTo), gte(classTeacherAssignments.effectiveTo, now)),
    )),
    db.select({ classId: staffSubjects.classId }).from(staffSubjects).where(eq(staffSubjects.staffId, staffRow.id)),
  ]);
  const allowed = new Set<number>();
  teacherAssignments.forEach((row) => allowed.add(row.classId));
  subjectAssignments.forEach((row) => { if (row.classId) allowed.add(row.classId); });
  return allIds.filter((id) => allowed.has(id));
}

async function parseFilters(req: Request, res: Response): Promise<AttendanceReportFilters | null> {
  const schoolId = await resolveSchoolScope(req, res);
  if (!schoolId) return null;
  const from = asDateOnly(req.query.from);
  const to = asDateOnly(req.query.to);
  if (!from || !to) {
    res.status(400).json({ message: "A valid from and to date are required" });
    return null;
  }
  if (from > to) {
    res.status(400).json({ message: "Start date cannot be after end date" });
    return null;
  }
  if (reportDateRangeDays(from, to) > MAX_RANGE_DAYS) {
    res.status(400).json({ message: `Attendance report ranges cannot exceed ${MAX_RANGE_DAYS} days` });
    return null;
  }

  const user = req.user as User;
  const allowedClassIds = await resolveAllowedClassIds(user, schoolId);
  const requestedClassId = req.query.classId && req.query.classId !== "all" ? Number.parseInt(String(req.query.classId), 10) : null;
  if (requestedClassId && !allowedClassIds.includes(requestedClassId)) {
    res.status(403).json({ message: "Class is outside your authorised reporting scope" });
    return null;
  }
  if (!requestedClassId && allowedClassIds.length === 0) {
    res.status(403).json({ message: "You do not have an authorised class reporting scope" });
    return null;
  }

  return {
    schoolId,
    classId: requestedClassId,
    from,
    to,
    search: String(req.query.search || "").trim(),
    status: String(req.query.status || "").trim(),
    page: parsePositiveInt(req.query.page, 1),
    pageSize: parsePositiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    sortBy: String(req.query.sortBy || "studentName"),
    sortDir: req.query.sortDir === "desc" ? "desc" : "asc",
    minAbsentDays: parsePositiveInt(req.query.minAbsentDays, 5),
    minConsecutiveDays: parsePositiveInt(req.query.minConsecutiveDays, 3),
    minStoppedDays: parsePositiveInt(req.query.minStoppedDays, 10),
  };
}

async function resolveSchoolDays(school: typeof schools.$inferSelect, from: string, to: string) {
  const [schedules, overrides] = await Promise.all([
    db.select().from(schoolDaySchedules).where(eq(schoolDaySchedules.schoolId, school.id)),
    db.select().from(schoolDayOverrides).where(and(
      eq(schoolDayOverrides.schoolId, school.id),
      gte(schoolDayOverrides.overrideDate, from),
      lte(schoolDayOverrides.overrideDate, to),
    )),
  ]);
  const scheduleByDay = new Map(schedules.map((row) => [row.dayOfWeek, row.isSchoolDay]));
  const overrideByDate = new Map(overrides.map((row) => [row.overrideDate, row.isSchoolDay]));
  const termRanges = [
    [school.term1StartDate, school.term1EndDate],
    [school.term2StartDate, school.term2EndDate],
    [school.term3StartDate, school.term3EndDate],
  ].filter((pair): pair is [string, string] => Boolean(pair[0] && pair[1]));
  const relevantTermRanges = termRanges.filter(([start, end]) => start <= to && end >= from);
  const enforceConfiguredTermBoundaries = relevantTermRanges.length > 0;

  const output: string[] = [];
  for (const date of datesBetween(from, to)) {
    if (overrideByDate.has(date)) {
      if (overrideByDate.get(date)) output.push(date);
      continue;
    }
    if (enforceConfiguredTermBoundaries && !relevantTermRanges.some(([start, end]) => date >= start && date <= end)) continue;
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const configured = scheduleByDay.get(day);
    if (configured === true || (configured === undefined && day >= 1 && day <= 5)) output.push(date);
  }
  return { schoolDays: output, confidence: enforceConfiguredTermBoundaries ? "configured" as const : "weekly_only" as const };
}

function chooseAuthoritative(records: Array<typeof attendanceRecords.$inferSelect>) {
  const sorted = [...records].sort((a, b) => {
    const gate = Number(Boolean(b.gateEvidenceLocked)) - Number(Boolean(a.gateEvidenceLocked));
    if (gate) return gate;
    const present = Number(PRESENT_STATUSES.has(b.status)) - Number(PRESENT_STATUSES.has(a.status));
    if (present) return present;
    return b.id - a.id;
  });
  return sorted[0];
}

async function buildContext(filters: AttendanceReportFilters, user: User): Promise<ReportingContext> {
  const [school] = await db.select().from(schools).where(eq(schools.id, filters.schoolId)).limit(1);
  if (!school) throw new Error("School not found");
  const allowedClassIds = await resolveAllowedClassIds(user, filters.schoolId);
  const scopedClassIds = filters.classId ? [filters.classId] : allowedClassIds;
  const classRows = scopedClassIds.length
    ? await db.select().from(classes).where(inArray(classes.id, scopedClassIds))
    : [];
  const classById = new Map(classRows.map((row) => [row.id, row]));
  const { schoolDays, confidence } = await resolveSchoolDays(school, filters.from, filters.to);

  const rawRecords = scopedClassIds.length ? await db.select().from(attendanceRecords).where(and(
    inArray(attendanceRecords.classId, scopedClassIds),
    gte(attendanceRecords.date, filters.from),
    lte(attendanceRecords.date, filters.to),
  )).orderBy(asc(attendanceRecords.date), asc(attendanceRecords.id)) : [];

  const currentStudents = scopedClassIds.length
    ? await db.select().from(students).where(and(eq(students.schoolId, filters.schoolId), inArray(students.classId, scopedClassIds)))
    : [];
  const recordStudentIds = Array.from(new Set(rawRecords.map((row) => row.studentId)));
  const recordStudents = recordStudentIds.length
    ? await db.select().from(students).where(inArray(students.id, recordStudentIds))
    : [];

  const transferRows = scopedClassIds.length ? await db.select().from(internalTransfers).where(and(
    eq(internalTransfers.personType, "student"),
    lte(internalTransfers.effectiveDate, filters.to),
    or(
      and(eq(internalTransfers.sourceSchoolId, filters.schoolId), inArray(internalTransfers.sourceClassId, scopedClassIds)),
      and(eq(internalTransfers.destinationSchoolId, filters.schoolId), inArray(internalTransfers.destinationClassId, scopedClassIds)),
    ),
  )) : [];
  const transferStudentIds = Array.from(new Set(transferRows.flatMap((row) => [row.sourceStudentId, row.destinationStudentId].filter((id): id is number => Boolean(id)))));
  const transferStudents = transferStudentIds.length
    ? await db.select().from(students).where(inArray(students.id, transferStudentIds))
    : [];

  const studentMap = new Map<number, typeof students.$inferSelect>();
  [...currentStudents, ...recordStudents, ...transferStudents].forEach((row) => studentMap.set(row.id, row));
  const population = Array.from(studentMap.values());
  const populationIds = population.map((row) => row.id);
  const enrollmentEvents = populationIds.length ? await db.select().from(studentEnrollmentEvents).where(and(
    inArray(studentEnrollmentEvents.studentId, populationIds),
    lte(studentEnrollmentEvents.effectiveDate, filters.to),
  )).orderBy(asc(studentEnrollmentEvents.effectiveDate), asc(studentEnrollmentEvents.id)) : [];
  const eventsByStudent = new Map<number, Array<typeof studentEnrollmentEvents.$inferSelect>>();
  enrollmentEvents.forEach((row) => {
    const list = eventsByStudent.get(row.studentId) || [];
    list.push(row);
    eventsByStudent.set(row.studentId, list);
  });

  const transferBySourceStudent = new Map<number, Array<typeof internalTransfers.$inferSelect>>();
  const transferByDestinationStudent = new Map<number, Array<typeof internalTransfers.$inferSelect>>();
  transferRows.forEach((row) => {
    if (row.sourceStudentId) transferBySourceStudent.set(row.sourceStudentId, [...(transferBySourceStudent.get(row.sourceStudentId) || []), row]);
    if (row.destinationStudentId) transferByDestinationStudent.set(row.destinationStudentId, [...(transferByDestinationStudent.get(row.destinationStudentId) || []), row]);
  });

  const enrollmentWindows = new Map<number, { start: string; end: string; uncertain: boolean }>();
  for (const student of population) {
    let start = maxIso(filters.from, student.enrollmentDate || filters.from);
    let end = filters.to;
    let uncertain = false;
    const inbound = transferByDestinationStudent.get(student.id) || [];
    const outbound = transferBySourceStudent.get(student.id) || [];
    inbound.filter((row) => row.destinationSchoolId === filters.schoolId).forEach((row) => { start = maxIso(start, row.joiningDate || row.effectiveDate); });
    outbound.filter((row) => row.sourceSchoolId === filters.schoolId).forEach((row) => { end = minIso(end, addDays(row.effectiveDate, -1)); });
    for (const event of eventsByStudent.get(student.id) || []) {
      if (event.schoolId && event.schoolId !== filters.schoolId) continue;
      if (["enrolled", "restored", "internal_transfer_in"].includes(event.eventType)) start = maxIso(start, event.effectiveDate);
      if (["transfer_out", "internal_transfer_out"].includes(event.eventType)) end = minIso(end, addDays(event.effectiveDate, -1));
      if (event.eventType === "status_changed" && event.newStatus && event.newStatus !== "active") end = minIso(end, event.effectiveDate);
    }
    if (student.schoolId !== filters.schoolId && !inbound.length && !outbound.length && !rawRecords.some((row) => row.studentId === student.id)) uncertain = true;
    enrollmentWindows.set(student.id, { start, end, uncertain });
  }

  const grouped = new Map<string, Array<typeof attendanceRecords.$inferSelect>>();
  rawRecords.forEach((row) => {
    const key = `${row.studentId}:${row.date}`;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  });
  const historyByStudent = new Map<number, AuthoritativeAttendance[]>();
  const conflictByStudent = new Map<number, number>();
  grouped.forEach((rows) => {
    const selected = chooseAuthoritative(rows);
    if (rows.length > 1) conflictByStudent.set(selected.studentId, (conflictByStudent.get(selected.studentId) || 0) + 1);
    const history = historyByStudent.get(selected.studentId) || [];
    history.push({
      id: selected.id,
      studentId: selected.studentId,
      classId: selected.classId,
      date: selected.date,
      status: selected.status,
      reason: selected.reason,
      source: selected.source,
      gateEvidenceLocked: selected.gateEvidenceLocked,
    });
    historyByStudent.set(selected.studentId, history);
  });
  historyByStudent.forEach((rows) => rows.sort((a, b) => a.date.localeCompare(b.date)));

  const summaries: StudentSummary[] = [];
  for (const student of population) {
    const window = enrollmentWindows.get(student.id) || { start: filters.from, end: filters.to, uncertain: true };
    if (window.start > filters.to || window.end < filters.from || window.start > window.end) continue;
    const applicableSchoolDays = schoolDays.filter((date) => date >= window.start && date <= window.end);
    const history = (historyByStudent.get(student.id) || []).filter((row) => row.date >= window.start && row.date <= window.end);
    if (filters.classId && !history.some((row) => row.classId === filters.classId) && student.classId !== filters.classId) continue;
    const byDate = new Map(history.map((row) => [row.date, row]));
    let presentDays = 0;
    let absentDays = 0;
    const reasons: Record<string, number> = {};
    let lastPresent: string | null = null;
    for (const date of applicableSchoolDays) {
      const record = byDate.get(date);
      if (!record) continue;
      if (PRESENT_STATUSES.has(record.status)) {
        presentDays++;
        lastPresent = date;
      } else if (ABSENT_STATUSES.has(record.status)) {
        absentDays++;
        const reasonKey = record.reason?.trim() || record.status;
        reasons[reasonKey] = (reasons[reasonKey] || 0) + 1;
      }
    }
    const recordedDays = presentDays + absentDays;
    const notRecordedDays = Math.max(0, applicableSchoolDays.length - recordedDays);
    const attendancePercentage = recordedDays ? Math.round((presentDays / recordedDays) * 1000) / 10 : null;
    const completeness = applicableSchoolDays.length ? Math.round((recordedDays / applicableSchoolDays.length) * 1000) / 10 : null;

    let consecutiveAbsentDays = 0;
    let currentStreak = 0;
    for (const date of applicableSchoolDays) {
      const record = byDate.get(date);
      if (!record) { currentStreak = 0; continue; }
      if (ABSENT_STATUSES.has(record.status)) {
        currentStreak++;
        consecutiveAbsentDays = Math.max(consecutiveAbsentDays, currentStreak);
      } else currentStreak = 0;
    }

    let absentDaysSinceLastPresent = 0;
    if (lastPresent) {
      for (const date of applicableSchoolDays) {
        if (date <= lastPresent) continue;
        const record = byDate.get(date);
        if (record && ABSENT_STATUSES.has(record.status)) absentDaysSinceLastPresent++;
      }
    }

    const latestRecord = history.length ? history[history.length - 1] : null;
    const classId = latestRecord?.classId || student.classId || null;
    const classInfo = classId ? classById.get(classId) : null;
    const className = classInfo?.className || classInfo?.shortCode || (classId ? `Class #${classId}` : "Uncertain / historical");
    summaries.push({
      studentId: student.id,
      admissionNo: student.admissionNo,
      studentName: `${student.firstName} ${student.lastName}`.trim(),
      classId,
      className,
      currentStatus: student.status || "unknown",
      expectedDays: applicableSchoolDays.length,
      recordedDays,
      presentDays,
      absentDays,
      notRecordedDays,
      attendancePercentage,
      dataCompletenessPercentage: completeness,
      perfectAttendance: applicableSchoolDays.length > 0 && presentDays === applicableSchoolDays.length && notRecordedDays === 0,
      lastPresent,
      consecutiveAbsentDays,
      absentDaysSinceLastPresent,
      conflictingDays: conflictByStudent.get(student.id) || 0,
      attendanceIncomplete: notRecordedDays > 0,
      historicalClassUncertain: !classInfo || window.uncertain,
      reasons,
    });
  }

  return { filters, school, schoolDays, classRows, summaries, historyByStudent, enrollmentWindows, calendarConfidence: confidence };
}

function applySearchAndStatus(rows: StudentSummary[], filters: AttendanceReportFilters) {
  const needle = filters.search?.toLowerCase();
  return rows.filter((row) => {
    if (needle && ![row.studentName, row.admissionNo, row.className].some((value) => value.toLowerCase().includes(needle))) return false;
    if (filters.status && filters.status !== "all") {
      if (filters.status === "present" && row.presentDays === 0) return false;
      if (filters.status === "absent" && row.absentDays === 0) return false;
      if (filters.status === "not_recorded" && row.notRecordedDays === 0) return false;
      if (filters.status === "perfect" && !row.perfectAttendance) return false;
    }
    return true;
  });
}

function sortRows(rows: StudentSummary[], filters: AttendanceReportFilters) {
  const direction = filters.sortDir === "desc" ? -1 : 1;
  const value = (row: StudentSummary) => {
    switch (filters.sortBy) {
      case "presentDays": return row.presentDays;
      case "absentDays": return row.absentDays;
      case "attendancePercentage": return row.attendancePercentage ?? -1;
      case "lastPresent": return row.lastPresent || "";
      case "className": return row.className.toLowerCase();
      default: return row.studentName.toLowerCase();
    }
  };
  return [...rows].sort((a, b) => {
    const av = value(a); const bv = value(b);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * direction;
  });
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  return { rows: rows.slice((safePage - 1) * pageSize, safePage * pageSize), pagination: { page: safePage, pageSize, total, totalPages } };
}

function overviewPayload(ctx: ReportingContext, allRows = false) {
  const rows = sortRows(applySearchAndStatus(ctx.summaries, ctx.filters), ctx.filters);
  const summary = {
    studentsIncluded: rows.length,
    studentsPresentAtLeastOnce: rows.filter((row) => row.presentDays > 0).length,
    studentsAbsentAtLeastOnce: rows.filter((row) => row.absentDays > 0).length,
    studentsWithPerfectAttendance: rows.filter((row) => row.perfectAttendance).length,
    totalPresentDays: rows.reduce((sum, row) => sum + row.presentDays, 0),
    totalAbsentDays: rows.reduce((sum, row) => sum + row.absentDays, 0),
    unrecordedStudentDays: rows.reduce((sum, row) => sum + row.notRecordedDays, 0),
    expectedSchoolDays: ctx.schoolDays.length,
    calendarConfidence: ctx.calendarConfidence,
  };
  return allRows ? { summary, students: rows } : { summary, students: paginate(rows, ctx.filters.page, ctx.filters.pageSize) };
}

function absenteeismPayload(ctx: ReportingContext, allRows = false) {
  const filtered = applySearchAndStatus(ctx.summaries, ctx.filters);
  const frequent = sortRows(filtered.filter((row) => row.absentDays >= ctx.filters.minAbsentDays), { ...ctx.filters, sortBy: "absentDays", sortDir: "desc" });
  const consecutive = sortRows(filtered.filter((row) => row.consecutiveAbsentDays >= ctx.filters.minConsecutiveDays), { ...ctx.filters, sortBy: "absentDays", sortDir: "desc" });
  return allRows
    ? { frequent, consecutive }
    : { frequent: paginate(frequent, ctx.filters.page, ctx.filters.pageSize), consecutive: paginate(consecutive, ctx.filters.page, ctx.filters.pageSize) };
}

function nonAttendancePayload(ctx: ReportingContext, allRows = false) {
  const rows = applySearchAndStatus(ctx.summaries, ctx.filters).filter((row) => {
    const window = ctx.enrollmentWindows.get(row.studentId);
    return row.presentDays === 0 && Boolean(window && window.start <= ctx.filters.from);
  }).map((row) => {
    let reviewIndicator = "Insufficient Attendance Data";
    if (row.currentStatus !== "active") reviewIndicator = "Accounts Review";
    else if (row.absentDays > 0 && row.notRecordedDays === 0) reviewIndicator = "Possible Non-Return";
    else if (row.absentDays > 0 && row.notRecordedDays > 0) reviewIndicator = "Attendance Incomplete";
    return { ...row, reviewIndicator };
  });
  const sorted = sortRows(rows, { ...ctx.filters, sortBy: "absentDays", sortDir: "desc" });
  return allRows ? { students: sorted } : { students: paginate(sorted, ctx.filters.page, ctx.filters.pageSize) };
}

function stoppedAttendingPayload(ctx: ReportingContext, allRows = false) {
  const rows = applySearchAndStatus(ctx.summaries, ctx.filters).filter((row) => row.presentDays > 0 && row.absentDaysSinceLastPresent >= ctx.filters.minStoppedDays);
  const sorted = sortRows(rows, { ...ctx.filters, sortBy: "lastPresent", sortDir: "asc" });
  return allRows ? { students: sorted } : { students: paginate(sorted, ctx.filters.page, ctx.filters.pageSize) };
}

function classSummaryPayload(ctx: ReportingContext) {
  type ClassAggregate = {
    classId: number;
    className: string;
    studentIds: Set<number>;
    presentDays: number;
    absentDays: number;
    notRecordedDays: number;
    incompleteStudents: Set<number>;
    historicalUncertaintyStudents: Set<number>;
  };
  const classById = new Map(ctx.classRows.map((row) => [row.id, row]));
  const schoolDaySet = new Set(ctx.schoolDays);
  const byClass = new Map<number, ClassAggregate>();
  const ensure = (classId: number) => {
    const row = classById.get(classId);
    const current = byClass.get(classId) || {
      classId,
      className: row?.className || row?.shortCode || `Class #${classId}`,
      studentIds: new Set<number>(),
      presentDays: 0,
      absentDays: 0,
      notRecordedDays: 0,
      incompleteStudents: new Set<number>(),
      historicalUncertaintyStudents: new Set<number>(),
    };
    byClass.set(classId, current);
    return current;
  };

  for (const summary of ctx.summaries) {
    const window = ctx.enrollmentWindows.get(summary.studentId);
    if (!window) continue;
    const applicableDays = ctx.schoolDays.filter((date) => date >= window.start && date <= window.end);
    const history = (ctx.historyByStudent.get(summary.studentId) || []).filter((row) =>
      schoolDaySet.has(row.date) && row.date >= window.start && row.date <= window.end && classById.has(row.classId)
    );
    const recordedClassIds = new Set<number>();
    for (const record of history) {
      recordedClassIds.add(record.classId);
      const aggregate = ensure(record.classId);
      aggregate.studentIds.add(summary.studentId);
      if (PRESENT_STATUSES.has(record.status)) aggregate.presentDays++;
      else if (ABSENT_STATUSES.has(record.status)) aggregate.absentDays++;
    }

    const recordedDates = new Set(history.map((row) => row.date));
    const missingDays = applicableDays.filter((date) => !recordedDates.has(date)).length;
    if (!missingDays) continue;

    // Missing days are assigned to a class only when the available evidence gives a
    // single defensible class for the period. When class history is ambiguous, keep
    // the uncertainty visible rather than assigning old days to the student's current class.
    let inferredClassId: number | null = null;
    if (recordedClassIds.size === 1) inferredClassId = Array.from(recordedClassIds)[0];
    else if (recordedClassIds.size === 0 && summary.classId && classById.has(summary.classId) && !summary.historicalClassUncertain) inferredClassId = summary.classId;

    if (inferredClassId) {
      const aggregate = ensure(inferredClassId);
      aggregate.studentIds.add(summary.studentId);
      aggregate.notRecordedDays += missingDays;
      aggregate.incompleteStudents.add(summary.studentId);
    } else {
      recordedClassIds.forEach((classId) => ensure(classId).historicalUncertaintyStudents.add(summary.studentId));
    }
  }

  return Array.from(byClass.values()).map((row) => ({
    classId: row.classId,
    className: row.className,
    students: row.studentIds.size,
    presentDays: row.presentDays,
    absentDays: row.absentDays,
    notRecordedDays: row.notRecordedDays,
    attendanceRate: row.presentDays + row.absentDays ? Math.round((row.presentDays / (row.presentDays + row.absentDays)) * 1000) / 10 : null,
    incompleteStudents: row.incompleteStudents.size,
    historicalUncertainty: row.historicalUncertaintyStudents.size,
  })).sort((a, b) => (b.attendanceRate ?? -1) - (a.attendanceRate ?? -1));
}

async function contextForRequest(req: Request, res: Response) {
  const filters = await parseFilters(req, res);
  if (!filters) return null;
  return buildContext(filters, req.user as User);
}

function sendReportMeta(ctx: ReportingContext) {
  return { schoolId: ctx.school.id, schoolName: ctx.school.name, from: ctx.filters.from, to: ctx.filters.to, generatedAt: new Date().toISOString(), calendarConfidence: ctx.calendarConfidence };
}

function reportRowsForExport(report: string, ctx: ReportingContext): { title: string; headers: string[]; rows: Array<Array<string | number | null>> } {
  if (report === "absenteeism") {
    const payload = absenteeismPayload(ctx, true);
    return { title: "Frequent Absenteeism", headers: ["Admission No.", "Student", "Class", "Absent Days", "Present Days", "Consecutive Absences", "Attendance %", "Not Recorded"], rows: payload.frequent.map((row) => [row.admissionNo, row.studentName, row.className, row.absentDays, row.presentDays, row.consecutiveAbsentDays, row.attendancePercentage, row.notRecordedDays]) };
  }
  if (report === "consecutive") {
    const payload = absenteeismPayload(ctx, true);
    return { title: "Consecutive Absences", headers: ["Admission No.", "Student", "Class", "Consecutive Absences", "Last Present", "Absent Days", "Attendance %", "Not Recorded"], rows: payload.consecutive.map((row) => [row.admissionNo, row.studentName, row.className, row.consecutiveAbsentDays, row.lastPresent, row.absentDays, row.attendancePercentage, row.notRecordedDays]) };
  }
  if (report === "non-attendance") {
    const payload = nonAttendancePayload(ctx, true);
    return { title: "Term Non-Attendance", headers: ["Admission No.", "Student", "Class", "Present", "Absent", "Not Recorded", "Student Status", "Review Indicator"], rows: payload.students.map((row) => [row.admissionNo, row.studentName, row.className, row.presentDays, row.absentDays, row.notRecordedDays, row.currentStatus, row.reviewIndicator || ""]) };
  }
  if (report === "stopped-attending") {
    const payload = stoppedAttendingPayload(ctx, true);
    return { title: "Students Who Stopped Attending", headers: ["Admission No.", "Student", "Class", "Last Present", "Absent Days Since", "Student Status", "Not Recorded"], rows: payload.students.map((row) => [row.admissionNo, row.studentName, row.className, row.lastPresent, row.absentDaysSinceLastPresent, row.currentStatus, row.notRecordedDays]) };
  }
  if (report === "classes") {
    const rows = classSummaryPayload(ctx);
    return { title: "Class Attendance Summary", headers: ["Class", "Students", "Present Days", "Absent Days", "Not Recorded", "Attendance Rate %", "Incomplete Students"], rows: rows.map((row) => [row.className, row.students, row.presentDays, row.absentDays, row.notRecordedDays, row.attendanceRate, row.incompleteStudents]) };
  }
  const payload = overviewPayload(ctx, true);
  return { title: "Attendance Overview", headers: ["Admission No.", "Student", "Class", "Present", "Absent", "Not Recorded", "Attendance %", "Completeness %", "Student Status"], rows: payload.students.map((row) => [row.admissionNo, row.studentName, row.className, row.presentDays, row.absentDays, row.notRecordedDays, row.attendancePercentage, row.dataCompletenessPercentage, row.currentStatus]) };
}

export function registerAttendanceReportingRoutes(app: Express) {
  app.get("/api/attendance/reports/overview", requireAuth, requirePermission("attendance.reports.view"), async (req, res, next) => {
    try { const ctx = await contextForRequest(req, res); if (!ctx) return; res.json({ meta: sendReportMeta(ctx), ...overviewPayload(ctx) }); } catch (error) { next(error); }
  });

  app.get("/api/attendance/reports/students", requireAuth, requirePermission("attendance.reports.view"), async (req, res, next) => {
    try { const ctx = await contextForRequest(req, res); if (!ctx) return; res.json({ meta: sendReportMeta(ctx), ...overviewPayload(ctx) }); } catch (error) { next(error); }
  });

  app.get("/api/attendance/reports/absenteeism", requireAuth, requirePermission("attendance.reports.view"), async (req, res, next) => {
    try { const ctx = await contextForRequest(req, res); if (!ctx) return; res.json({ meta: sendReportMeta(ctx), ...absenteeismPayload(ctx) }); } catch (error) { next(error); }
  });

  app.get("/api/attendance/reports/non-attendance", requireAuth, requirePermission("attendance.reports.view"), async (req, res, next) => {
    try { const ctx = await contextForRequest(req, res); if (!ctx) return; res.json({ meta: sendReportMeta(ctx), ...nonAttendancePayload(ctx) }); } catch (error) { next(error); }
  });

  app.get("/api/attendance/reports/stopped-attending", requireAuth, requirePermission("attendance.reports.view"), async (req, res, next) => {
    try { const ctx = await contextForRequest(req, res); if (!ctx) return; res.json({ meta: sendReportMeta(ctx), ...stoppedAttendingPayload(ctx) }); } catch (error) { next(error); }
  });

  app.get("/api/attendance/reports/classes", requireAuth, requirePermission("attendance.reports.view"), async (req, res, next) => {
    try { const ctx = await contextForRequest(req, res); if (!ctx) return; res.json({ meta: sendReportMeta(ctx), classes: classSummaryPayload(ctx) }); } catch (error) { next(error); }
  });

  app.get("/api/attendance/reports/student/:id", requireAuth, requirePermission("attendance.reports.view"), async (req, res, next) => {
    try {
      const ctx = await contextForRequest(req, res); if (!ctx) return;
      const studentId = Number.parseInt(String(req.params.id), 10);
      const summary = ctx.summaries.find((row) => row.studentId === studentId);
      if (!summary) return res.status(404).json({ message: "Student is not in the authorised reporting population for this period" });
      const history = ctx.historyByStudent.get(studentId) || [];
      const historyByDate = new Map(history.map((row) => [row.date, row]));
      const window = ctx.enrollmentWindows.get(studentId)!;
      const days = ctx.schoolDays.filter((date) => date >= window.start && date <= window.end).map((date) => {
        const record = historyByDate.get(date);
        return { date, status: record?.status || "not_recorded", reason: record?.reason || null, source: record?.source || null, gateEvidenceLocked: record?.gateEvidenceLocked || false, classId: record?.classId || summary.classId };
      });
      res.json({ meta: sendReportMeta(ctx), student: summary, days });
    } catch (error) { next(error); }
  });

  app.get("/api/attendance/reports/export", requireAuth, requirePermission("attendance.reports.export"), async (req, res, next) => {
    try {
      const ctx = await contextForRequest(req, res); if (!ctx) return;
      const report = String(req.query.report || "overview");
      const format = String(req.query.format || "xlsx").toLowerCase();
      const data = reportRowsForExport(report, ctx);
      const safeName = data.title.replace(/[^a-z0-9]+/gi, "_");
      if (format === "pdf") {
        const PDFDocument = (await import("pdfkit")).default;
        const doc = new PDFDocument({ size: "A4", margin: 36, layout: data.headers.length > 7 ? "landscape" : "portrait" });
        const chunks: Buffer[] = [];
        doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
        doc.fontSize(16).text(data.title, { align: "center" });
        doc.moveDown(0.4).fontSize(9).text(`${ctx.school.name} · ${ctx.filters.from} to ${ctx.filters.to}`, { align: "center" });
        doc.moveDown(0.2).fontSize(7).text(`Generated ${new Date().toISOString()}`, { align: "center" });
        doc.moveDown();
        const writeHeader = () => {
          const line = data.headers.map((value) => String(value).replace(/\s+/g, " ")).join(" | ");
          doc.font("Helvetica-Bold").fontSize(7).text(line, { width: doc.page.width - 72 });
          doc.font("Helvetica").moveDown(0.3);
        };
        writeHeader();
        for (const row of data.rows) {
          if (doc.y > doc.page.height - 55) {
            doc.addPage();
            writeHeader();
          }
          const line = row.map((value) => String(value ?? "").replace(/\s+/g, " ")).join(" | ");
          doc.fontSize(7).text(line, { width: doc.page.width - 72 });
          doc.moveDown(0.2);
        }
        doc.end();
        const buffer = await done;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=\"${safeName}_${ctx.filters.from}_to_${ctx.filters.to}.pdf\"`);
        return res.send(buffer);
      }
      const XLSX = await import("xlsx");
      const rows = [
        [data.title],
        ["School", ctx.school.name],
        ["Reporting Period", `${ctx.filters.from} to ${ctx.filters.to}`],
        ["Generated", new Date().toISOString()],
        [],
        data.headers,
        ...data.rows,
      ];
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, sheet, "Attendance Report");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=\"${safeName}_${ctx.filters.from}_to_${ctx.filters.to}.xlsx\"`);
      return res.send(buffer);
    } catch (error) { next(error); }
  });
}
