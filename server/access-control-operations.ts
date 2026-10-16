import { gateBridgeSupports } from "@shared/gate-bridge-capabilities";
import type { Express, Request, Response } from "express";
import { createHash } from "crypto";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";
import { and, asc, desc, eq, gte, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { GATE_UTC_NOW, gateUtcDeadlineAfterMs } from "./access-control-command-clock";
import { requireAuth, requirePermission } from "./auth";
import { communicationService } from "./communication";
import { resolveStudentFeePosition } from "./fees-schedule";
import {
  accessEvents,
  accessGates,
  accessIdentities,
  attendanceGateEvidenceCorrections,
  attendanceMessageTemplateVersions,
  attendanceMessageTemplates,
  organizationAttendanceMessageTemplateVersions,
  organizationAttendanceMessageTemplates,
  attendanceRecords,
  financialAccessOverrides,
  gateBridges,
  gateCommands,
  gateDevices,
  gateIdentitySync,
  gateSchoolSettings,
  gateSyncJobs,
  gateSyncJobItems,
  schools,
  schoolDayOverrides,
  schoolDaySchedules,
  staff,
  staffAttendanceLogs,
  staffEarlyDepartureApprovals,
  studentEarlyReleaseAuthorizations,
  students,
  parents,
  classes,
  users,
  type SchoolDaySchedule,
} from "@shared/schema";

const TZ = "Africa/Harare";
const FINANCIAL_STALE_MS = 36 * 60 * 60 * 1000;
const IDENTITY_COMMAND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Full reconciliation follows the school-configured 23:00 local schedule.
const GATE_SYNC_JOB_CHUNK = Math.max(10, Math.min(100, Number.parseInt(process.env.FCGS_GATE_SYNC_JOB_CHUNK || "40", 10) || 40));
const GATE_SYNC_JOB_CONCURRENCY = Math.max(1, Math.min(8, Number.parseInt(process.env.FCGS_GATE_SYNC_JOB_CONCURRENCY || "4", 10) || 4));
const FACE_TARGET_MAX_BYTES = 220_000;
const FACE_MAX_WIDTH = 720;
const FACE_MAX_HEIGHT = 960;
const EXIT_TIME_GROUP_ID = 90;
const STANDARD_4_LANE = ["entry_lane_1", "entry_lane_2", "exit_lane_1", "exit_lane_2"] as const;
const MESSAGE_TEMPLATE_PLACEHOLDERS = ["student_name","admission_no","date","class_name","reason","reason_upper","attendance_status","attendance_status_upper","school_name","school_phone","school_call_centre_phone","school_whatsapp","class_teacher_name","class_teacher_phone","class_teacher_email","contact_line","arrival_time","admission_time","reconciliation_time","absence_detail"] as const;
const MESSAGE_TEMPLATE_PLACEHOLDER_SET = new Set<string>(MESSAGE_TEMPLATE_PLACEHOLDERS);
const MESSAGE_TEMPLATE_PREVIEW_VALUES: Record<string, string> = {
  student_name: "Tariro Moyo",
  admission_no: "FCGS26S0001H",
  date: "2026-09-14",
  class_name: "Grade 6A",
  reason: "Medical appointment",
  reason_upper: "MEDICAL APPOINTMENT",
  attendance_status: "absent",
  attendance_status_upper: "ABSENT",
  school_name: "First Choice School",
  school_phone: "+263 00 000 0000",
  school_call_centre_phone: "+263 00 000 0000",
  school_whatsapp: "+263 00 000 0000",
  class_teacher_name: "Ms. Ncube",
  class_teacher_phone: "+263 00 000 0000",
  class_teacher_email: "teacher@example.com",
  contact_line: "Contact: Ms. Ncube | Phone: +263 00 000 0000 | Email: teacher@example.com",
  arrival_time: "07:42",
  admission_time: "09:18",
  reconciliation_time: "09:00",
  absence_detail: "Reason: MEDICAL APPOINTMENT. Please contact us for any enquiries you may have.",
};

type AuthedUser = { id: number; role?: string; schoolId?: number | null; organizationId?: number | null; firstName?: string | null; lastName?: string | null };
type Scope = { organizationId: number; schoolId: number; userId: number };

const DEFAULT_SCHEDULES: Array<Omit<SchoolDaySchedule, "id" | "schoolId" | "createdAt" | "updatedAt">> = [
  { dayOfWeek: 0, isSchoolDay: false, studentStartTime: "07:30", studentLateGraceMinutes: 0, studentEndTime: "15:30", studentDismissalGraceMinutes: 0, staffStartTime: "08:00", staffLateGraceMinutes: 0, staffEndTime: "16:00", breakStartTime: null, breakEndTime: null, lunchStartTime: null, lunchEndTime: null, reconciliationTime: "09:00" },
  { dayOfWeek: 1, isSchoolDay: true, studentStartTime: "07:30", studentLateGraceMinutes: 0, studentEndTime: "15:30", studentDismissalGraceMinutes: 0, staffStartTime: "07:20", staffLateGraceMinutes: 0, staffEndTime: "16:00", breakStartTime: "10:00", breakEndTime: "10:30", lunchStartTime: "13:00", lunchEndTime: "14:00", reconciliationTime: "09:00" },
  { dayOfWeek: 2, isSchoolDay: true, studentStartTime: "07:30", studentLateGraceMinutes: 0, studentEndTime: "15:30", studentDismissalGraceMinutes: 0, staffStartTime: "07:20", staffLateGraceMinutes: 0, staffEndTime: "16:00", breakStartTime: "10:00", breakEndTime: "10:30", lunchStartTime: "13:00", lunchEndTime: "14:00", reconciliationTime: "09:00" },
  { dayOfWeek: 3, isSchoolDay: true, studentStartTime: "07:30", studentLateGraceMinutes: 0, studentEndTime: "15:30", studentDismissalGraceMinutes: 0, staffStartTime: "07:20", staffLateGraceMinutes: 0, staffEndTime: "16:00", breakStartTime: "10:00", breakEndTime: "10:30", lunchStartTime: "13:00", lunchEndTime: "14:00", reconciliationTime: "09:00" },
  { dayOfWeek: 4, isSchoolDay: true, studentStartTime: "07:30", studentLateGraceMinutes: 0, studentEndTime: "15:30", studentDismissalGraceMinutes: 0, staffStartTime: "07:20", staffLateGraceMinutes: 0, staffEndTime: "16:00", breakStartTime: "10:00", breakEndTime: "10:30", lunchStartTime: "13:00", lunchEndTime: "14:00", reconciliationTime: "09:00" },
  { dayOfWeek: 5, isSchoolDay: true, studentStartTime: "07:30", studentLateGraceMinutes: 0, studentEndTime: "15:30", studentDismissalGraceMinutes: 0, staffStartTime: "07:20", staffLateGraceMinutes: 0, staffEndTime: "16:00", breakStartTime: "10:00", breakEndTime: "10:30", lunchStartTime: "13:00", lunchEndTime: "14:00", reconciliationTime: "09:00" },
  { dayOfWeek: 6, isSchoolDay: false, studentStartTime: "07:30", studentLateGraceMinutes: 0, studentEndTime: "15:30", studentDismissalGraceMinutes: 0, staffStartTime: "08:00", staffLateGraceMinutes: 0, staffEndTime: "16:00", breakStartTime: null, breakEndTime: null, lunchStartTime: null, lunchEndTime: null, reconciliationTime: "09:00" },
];

const DEFAULT_TEMPLATE_MAP: Record<string, { sms: string; subject: string }> = {
  absence_initial: {
    sms: "FCGS Attendance: {{student_name}} was marked ABSENT on {{date}} ({{class_name}}).\n{{absence_detail}}\n{{contact_line}}",
    subject: "FCGS Attendance Notification",
  },
  absence_reason_updated: {
    sms: "FCGS Attendance: {{student_name}} reason for absence has been updated; reason: {{reason_upper}}. Please contact our Call Centre for any enquiries you may have.",
    subject: "FCGS Attendance Notification",
  },
  absence_amended_present: {
    sms: "FCGS Attendance: {{student_name}} was initially marked ABSENT, this has been amended to PRESENT. We apologise for any inconvenience caused. Thank you.",
    subject: "FCGS Attendance Notification",
  },
  fees_denial_reconciliation: {
    sms: "FCGS Attendance: {{student_name}} arrived at school at {{arrival_time}} on {{date}}, but school entry was not granted due to the current fees status. As of {{reconciliation_time}} no successful entry has been recorded. Please contact the school for assistance.\n{{contact_line}}",
    subject: "FCGS Attendance Notification",
  },
  fees_denial_later_admitted: {
    sms: "FCGS Attendance Update: {{student_name}} was admitted to school at {{admission_time}} on {{date}}. Today's attendance has been updated to {{attendance_status_upper}}. Thank you.",
    subject: "FCGS Attendance Update",
  },
};

function fail(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected Access Control operation error";
  const status = /not found/i.test(message) ? 404 : /permission|denied|outside|context/i.test(message) ? 403 : /maximum|already|conflict|stale|cannot/i.test(message) ? 409 : 400;
  return res.status(status).json({ message });
}

function hashBridgeToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function bridgeFromRequest(req: Request, res: Response) {
  const auth = req.header("Authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const token = String(req.header("X-FCGS-Bridge-Key") || bearer || "").trim();
  if (!token) { res.status(401).json({ message: "Gate Bridge authentication required" }); return null; }
  const [bridge] = await db.select().from(gateBridges).where(and(eq(gateBridges.bridgeKeyHash, hashBridgeToken(token)), eq(gateBridges.isActive, true))).limit(1);
  if (!bridge) { res.status(401).json({ message: "Invalid Gate Bridge credential" }); return null; }
  return bridge;
}

async function scopeOf(req: Request): Promise<Scope> {
  const u = req.user as AuthedUser;
  let schoolId = u.schoolId ?? null;
  if (u.role === "org_admin") {
    const requested = Number(req.header("X-School-Id") || "");
    if (Number.isFinite(requested) && requested > 0) schoolId = requested;
  }
  if (!schoolId) throw new Error("School context is required");
  const [school] = await db.select({ id: schools.id, organizationId: schools.organizationId }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school?.organizationId) throw new Error("School context was not found");
  if (u.organizationId && school.organizationId !== u.organizationId) throw new Error("Access denied outside your organisation");
  return { organizationId: school.organizationId, schoolId, userId: u.id };
}

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value || "";
  const y = get("year"), m = get("month"), d = get("day"), hh = get("hour"), mm = get("minute");
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}`, minutes: Number(hh) * 60 + Number(mm), dayOfWeek: weekdayMap[get("weekday")] ?? date.getDay() };
}

function parseHm(value: string | null | undefined, fallback = "00:00") {
  const m = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return Math.max(0, Math.min(1439, Number(m[1]) * 60 + Number(m[2])));
}

function hmFromMinutes(value: number) {
  const minutes = ((Math.trunc(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

async function ensureSchedules(schoolId: number) {
  const existing = await db.select().from(schoolDaySchedules).where(eq(schoolDaySchedules.schoolId, schoolId));
  const byDay = new Map(existing.map(row => [row.dayOfWeek, row]));
  for (const def of DEFAULT_SCHEDULES) {
    if (!byDay.has(def.dayOfWeek)) {
      const [created] = await db.insert(schoolDaySchedules).values({ schoolId, ...def }).returning();
      byDay.set(def.dayOfWeek, created);
    }
  }
  return Array.from(byDay.values()).sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

export async function getSchoolDaySchedule(schoolId: number, at = new Date()) {
  const parts = localParts(at);
  const schedules = await ensureSchedules(schoolId);
  return schedules.find(row => row.dayOfWeek === parts.dayOfWeek) || schedules[0];
}

async function isAcademicOpenDay(schoolId: number, dateText: string) {
  const [override] = await db.select().from(schoolDayOverrides).where(and(
    eq(schoolDayOverrides.schoolId, schoolId),
    eq(schoolDayOverrides.overrideDate, dateText),
  )).limit(1);
  if (override) return override.isSchoolDay;
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) return false;
  const inRange = (start?: string | null, end?: string | null) => !!start && !!end && dateText >= start && dateText <= end;
  // If term dates are configured, only term dates are school days. If not configured, use weekly schedule alone.
  const configured = !!(school.term1StartDate || school.term2StartDate || school.term3StartDate);
  if (!configured) return true;
  return inRange(school.term1StartDate, school.term1EndDate) || inRange(school.term2StartDate, school.term2EndDate) || inRange(school.term3StartDate, school.term3EndDate);
}

function extractTemplatePlaceholders(value: string | null | undefined) {
  const found = new Set<string>();
  const pattern = /\{\{([a-z0-9_]+)\}\}/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(value || "")))) found.add(String(match[1]).toLowerCase());
  return Array.from(found).sort();
}

function unsupportedTemplatePlaceholders(...values: Array<string | null | undefined>) {
  return Array.from(new Set(values.flatMap(extractTemplatePlaceholders).filter((key) => !MESSAGE_TEMPLATE_PLACEHOLDER_SET.has(key)))).sort();
}

function isFreshFinancialSnapshot(student: typeof students.$inferSelect, now = new Date()) {
  return !!student.feesSnapshotAt && now.getTime() - new Date(student.feesSnapshotAt).getTime() <= FINANCIAL_STALE_MS;
}

async function activeOverride(studentId: number, now = new Date()) {
  const [row] = await db.select().from(financialAccessOverrides).where(and(
    eq(financialAccessOverrides.studentId, studentId),
    inArray(financialAccessOverrides.status, ["active", "scheduled"]),
    lte(financialAccessOverrides.effectiveFrom, now),
    gtDate(financialAccessOverrides.expiresAt, now),
  )).orderBy(desc(financialAccessOverrides.createdAt)).limit(1);
  return row || null;
}

function gtDate(column: any, date: Date) { return sql`${column} > ${date}`; }

export async function evaluateStudentFinancialAccess(student: typeof students.$inferSelect, now = new Date()) {
  const feeSnapshot = await resolveStudentFeePosition(student, now);
  const status = String(feeSnapshot.feesStatus || "n/a").toLowerCase();
  const override = await activeOverride(student.id, now);
  if (override) return { allowed: true, reason: "Temporary financial access override", override, stale: false, status };
  if (!student.feesSnapshotAt || !isFreshFinancialSnapshot(student, now)) {
    return { allowed: true, reason: "Financial data missing or older than 36 hours; fail-open", override: null, stale: true, status };
  }
  if (status === "in_arrears") return { allowed: false, reason: "Financial restriction", override: null, stale: false, status };
  return { allowed: true, reason: status === "fully_paid" ? "Fully paid" : status === "up_to_date" ? "Up to date" : "Financial status does not restrict access", override: null, stale: false, status };
}

async function ensureIdentityForStudent(student: typeof students.$inferSelect, organizationId: number, explicitEnrollment = false) {
  let [identity] = await db.select().from(accessIdentities).where(eq(accessIdentities.studentId, student.id)).limit(1);
  const desired = await evaluateStudentFinancialAccess(student);
  const manuallyRestricted = identity?.manualRestrictionActive === true;
  const enrollmentRemoved = !!identity?.enrollmentRemovedAt && !explicitEnrollment;
  const values = {
    organizationId,
    schoolId: student.schoolId!,
    personType: "student",
    studentId: student.id,
    staffId: null,
    identityNo: student.admissionNo,
    displayName: `${student.firstName} ${student.lastName}`.trim(),
    photoPath: student.photo,
    isActive: student.status === "active" && !student.archivedAt && !enrollmentRemoved,
    enrollmentRemovedAt: explicitEnrollment ? null : identity?.enrollmentRemovedAt || null,
    enrollmentRemovalReason: explicitEnrollment ? null : identity?.enrollmentRemovalReason || null,
    enrollmentRemovedByUserId: explicitEnrollment ? null : identity?.enrollmentRemovedByUserId || null,
    desiredEntryAccess: manuallyRestricted ? "deny" : desired.allowed ? "allow" : "deny",
    lastPolicyReason: manuallyRestricted ? `Manual restriction: ${identity?.manualRestrictionReason || "Restricted by school"}` : desired.reason,
    lastPolicyEvaluatedAt: new Date(),
    updatedAt: new Date(),
  };
  if (!identity) {
    [identity] = await db.insert(accessIdentities).values(values).returning();
  } else {
    [identity] = await db.update(accessIdentities).set(values).where(eq(accessIdentities.id, identity.id)).returning();
  }
  return identity;
}

async function ensureIdentityForStaff(person: typeof staff.$inferSelect, organizationId: number, explicitEnrollment = false) {
  let [identity] = await db.select().from(accessIdentities).where(eq(accessIdentities.staffId, person.id)).limit(1);
  const manuallyRestricted = identity?.manualRestrictionActive === true;
  const enrollmentRemoved = !!identity?.enrollmentRemovedAt && !explicitEnrollment;
  const values = {
    organizationId,
    schoolId: person.schoolId!,
    personType: "staff",
    studentId: null,
    staffId: person.id,
    identityNo: person.staffNo,
    displayName: `${person.firstName} ${person.lastName}`.trim(),
    photoPath: person.photo,
    isActive: person.status === "active" && !enrollmentRemoved,
    enrollmentRemovedAt: explicitEnrollment ? null : identity?.enrollmentRemovedAt || null,
    enrollmentRemovalReason: explicitEnrollment ? null : identity?.enrollmentRemovalReason || null,
    enrollmentRemovedByUserId: explicitEnrollment ? null : identity?.enrollmentRemovedByUserId || null,
    desiredEntryAccess: manuallyRestricted ? "deny" : "allow",
    lastPolicyReason: manuallyRestricted ? `Manual restriction: ${identity?.manualRestrictionReason || "Restricted by school"}` : person.status === "active" ? "Active staff" : "Inactive staff",
    lastPolicyEvaluatedAt: new Date(),
    updatedAt: new Date(),
  };
  if (!identity) [identity] = await db.insert(accessIdentities).values(values).returning();
  else [identity] = await db.update(accessIdentities).set(values).where(eq(accessIdentities.id, identity.id)).returning();
  return identity;
}

async function readPhotoAsBase64(photoPath: string | null) {
  if (!photoPath || !photoPath.startsWith("/objects/")) return null;
  const objectRoot = path.resolve(process.env.LOCAL_OBJECT_DIR || "/var/lib/fcgs/object_storage");
  const relative = photoPath.replace(/^\/objects\//, "");
  const absolute = path.resolve(objectRoot, relative);
  if (!absolute.startsWith(`${objectRoot}${path.sep}`)) return null;
  try {
    const source = await fs.readFile(absolute);
    if (!source.length) return null;
    const attempts = [
      { width: FACE_MAX_WIDTH, height: FACE_MAX_HEIGHT, quality: 84 },
      { width: 640, height: 854, quality: 80 },
      { width: 560, height: 746, quality: 76 },
      { width: 480, height: 640, quality: 72 },
    ];
    let output: Buffer | null = null;
    for (const attempt of attempts) {
      const candidate = await sharp(source, { failOn: "error" })
        .rotate()
        .resize({ width: attempt.width, height: attempt.height, fit: "inside", withoutEnlargement: true })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .toColorspace("srgb")
        .jpeg({ quality: attempt.quality, chromaSubsampling: "4:2:0", progressive: false })
        .toBuffer();
      output = candidate;
      if (candidate.length <= FACE_TARGET_MAX_BYTES) break;
    }
    if (!output) return null;
    let finalOutput: Buffer = output;
    if (finalOutput.length > FACE_TARGET_MAX_BYTES) {
      finalOutput = await sharp(finalOutput).jpeg({ quality: 62, chromaSubsampling: "4:2:0", progressive: false }).toBuffer();
    }
    return finalOutput.toString("base64");
  } catch {
    return null;
  }
}

async function currentEarlyRelease(studentId: number, now = new Date()) {
  const [row] = await db.select().from(studentEarlyReleaseAuthorizations).where(and(
    eq(studentEarlyReleaseAuthorizations.studentId, studentId),
    inArray(studentEarlyReleaseAuthorizations.status, ["active", "scheduled"]),
    lte(studentEarlyReleaseAuthorizations.validFrom, now),
    gtDate(studentEarlyReleaseAuthorizations.validUntil, now),
  )).orderBy(desc(studentEarlyReleaseAuthorizations.createdAt)).limit(1);
  return row || null;
}

async function queueCommand(device: typeof gateDevices.$inferSelect, commandType: string, payload: Record<string, unknown>, reason: string, requestedByUserId?: number | null, ttlMs = IDENTITY_COMMAND_TTL_MS) {
  const now = new Date();
  const [command] = await db.insert(gateCommands).values({
    organizationId: device.organizationId,
    schoolId: device.schoolId,
    bridgeId: device.bridgeId,
    deviceId: device.id,
    commandType,
    status: "pending",
    priority: commandType === "set_time_groups" ? 10 : commandType === "verify_identity" ? 40 :
      /reconcil|bulk/i.test(reason) ? 40 : requestedByUserId ? 20 :
      /retry/i.test(reason) ? 30 : 10,
    requestedByUserId: requestedByUserId || null,
    requestReason: reason,
    payload,
    requestedAt: now,
    expiresAt: gateUtcDeadlineAfterMs(ttlMs),
  }).returning();
  return command;
}

async function configureExitScheduleForDevice(device: typeof gateDevices.$inferSelect) {
  if (device.direction !== "exit") return null;
  const schedules = await ensureSchedules(device.schoolId);
  const week = schedules.map(row => {
    // Terminal week index is Monday=0 ... Sunday=6; DB uses Sunday=0 ... Saturday=6.
    const terminalWeekIndex = row.dayOfWeek === 0 ? 6 : row.dayOfWeek - 1;
    if (!row.isSchoolDay) return { WeekIndex: String(terminalWeekIndex), Times: [] };
    const end = Math.min(1439, parseHm(row.studentEndTime) + Number(row.studentDismissalGraceMinutes || 0));
    return { WeekIndex: String(terminalWeekIndex), Times: [{ Start: hmFromMinutes(end), End: "23:59" }] };
  });
  return queueCommand(device, "set_time_groups", {
    TimeGroup: [{ TimeGroupId: String(EXIT_TIME_GROUP_ID), TimeGroupName: "FCGS Student Normal Dismissal", TimeGroup: week }],
  }, "Synchronize configured student dismissal schedule", null);
}

export async function configureExitScheduleForTerminal(deviceId: number) {
  const [device] = await db.select().from(gateDevices).where(eq(gateDevices.id, deviceId)).limit(1);
  if (!device || !device.isActive || device.direction !== "exit") return null;
  return configureExitScheduleForDevice(device);
}

async function desiredIdentityForDevice(identity: typeof accessIdentities.$inferSelect, device: typeof gateDevices.$inferSelect, photoBase64: string | null, now = new Date()) {
  let usertype: "white" | "black" = "white";
  let timeGroupId = 0;
  let enabled = identity.isActive;
  if (identity.manualRestrictionActive && device.direction === "entry") {
    usertype = "black";
  } else if (identity.personType === "student") {
    if (device.direction === "entry") usertype = identity.desiredEntryAccess === "deny" ? "black" : "white";
    else {
      usertype = "white";
      const release = identity.studentId ? await currentEarlyRelease(identity.studentId, now) : null;
      timeGroupId = release ? 0 : EXIT_TIME_GROUP_ID;
    }
  }
  return { enabled, usertype, timeGroupId, photoBase64 };
}

export async function queueIdentitySync(identityId: number, requestedByUserId?: number | null, reason = "Synchronize access identity", onlyDeviceIds?: number[]) {
  const [identity] = await db.select().from(accessIdentities).where(eq(accessIdentities.id, identityId)).limit(1);
  if (!identity) throw new Error("Access identity not found");
  const [school] = await db.select({ enableAccessControl: schools.enableAccessControl }).from(schools).where(eq(schools.id, identity.schoolId)).limit(1);
  let devices = await db.select().from(gateDevices).where(and(eq(gateDevices.schoolId, identity.schoolId), eq(gateDevices.isActive, true)));
  if (onlyDeviceIds?.length) {
    const allowed = new Set(onlyDeviceIds);
    devices = devices.filter((device) => allowed.has(device.id));
  }
  const photoBase64 = identity.isActive ? await readPhotoAsBase64(identity.photoPath) : null;
  if (identity.isActive && !photoBase64 && !identity.photoPath) {
    // A profile with no photo is ineligible for terminal facial recognition.
    // Keep the identity row and explanation for operators; never enqueue an upload.
    for (const device of devices) {
      const [existing] = await db.select().from(gateIdentitySync).where(and(eq(gateIdentitySync.identityId, identity.id), eq(gateIdentitySync.deviceId, device.id))).limit(1);
      if (existing && existing.syncStatus !== "deleted" && existing.syncStatus !== "pending") {
        const command = await queueCommand(device, "delete_identity", { identityId: identity.id, idno: identity.identityNo }, "Profile photograph removed; revoke facial enrollment", requestedByUserId);
        await db.update(gateIdentitySync).set({ desiredEnabled: false, syncStatus: "pending", lastCommandId: command.id, lastError: "Profile photograph unavailable; terminal face removal requested", nextRetryAt: null, updatedAt: new Date() }).where(eq(gateIdentitySync.id, existing.id));
      } else if (!existing) {
        await db.insert(gateIdentitySync).values({ identityId: identity.id, deviceId: device.id, desiredEnabled: false, syncStatus: "failed", lastError: "Profile photograph required before enrollment" });
      }
    }
    return [];
  }
  if (identity.isActive && !photoBase64) {
    // Photo file inaccessible/invalid: preserve existing terminal access and flag
    // the data defect; do not delete a working face because of storage failure.
    for (const device of devices) {
      const [existing] = await db.select().from(gateIdentitySync).where(and(eq(gateIdentitySync.identityId, identity.id), eq(gateIdentitySync.deviceId, device.id))).limit(1);
      if (existing && existing.syncStatus !== "synced") await db.update(gateIdentitySync).set({ syncStatus: "failed", lastError: "A usable FCGS profile photograph is required before enrollment", nextRetryAt: null, updatedAt: new Date() }).where(eq(gateIdentitySync.id, existing.id));
    }
    return []; // Never create a command that cannot succeed.
  }
  const photoHash = photoBase64 ? createHash("sha256").update(photoBase64).digest("hex") : "";
  const commands = [];
  for (const device of devices) {
    const desired = await desiredIdentityForDevice(identity, device, photoBase64);
    // If Access Control is disabled, enrolled active people remain locally allowed, with students still using normal exit timetable.
    if (school?.enableAccessControl === false && identity.isActive) {
      desired.usertype = "white";
      if (device.direction === "entry") desired.timeGroupId = 0;
    }
    const [existingSync] = await db.select().from(gateIdentitySync).where(and(eq(gateIdentitySync.identityId, identity.id), eq(gateIdentitySync.deviceId, device.id))).limit(1);
    // Content-address the *terminal-relevant* state: fee balance updates that do not
    // change access policy do not re-enroll an unchanged face.
    const fingerprint = createHash("sha256").update(JSON.stringify({
      idno: identity.identityNo, name: identity.displayName, enabled: desired.enabled,
      usertype: desired.usertype, timeGroupId: desired.timeGroupId, photoHash,
    })).digest("hex");
    const lastCommand = existingSync?.lastCommandId
      ? (await db.select().from(gateCommands).where(eq(gateCommands.id, existingSync.lastCommandId)).limit(1))[0]
      : null;
    const samePending = existingSync?.desiredFingerprint === fingerprint && lastCommand && ["pending", "processing"].includes(lastCommand.status);
    const sameConfirmed = existingSync?.syncStatus === "synced" &&
      (existingSync.confirmedFingerprint === fingerprint ||
       (!existingSync.confirmedFingerprint && existingSync.lastSyncedPhotoPath === identity.photoPath &&
        existingSync.desiredListType === desired.usertype && existingSync.desiredEnabled === desired.enabled &&
        existingSync.desiredTimeGroup === desired.timeGroupId));
    const sameDeleted = !desired.enabled && existingSync?.syncStatus === "deleted";
    if (sameConfirmed && existingSync && !existingSync.confirmedFingerprint) {
      // Preserve the last acknowledged deployment on upgrade, while establishing
      // the baseline needed to detect subsequent changes to name/photo/policy.
      // This is a migration baseline, NOT an independent terminal read-back.
      await db.update(gateIdentitySync).set({ confirmedFingerprint: fingerprint, desiredFingerprint: fingerprint, updatedAt: new Date() }).where(eq(gateIdentitySync.id, existingSync.id));
    }
    if (samePending || sameConfirmed || sameDeleted) continue;
    // Supersede only pending commands. An executing command cannot be preempted;
    // the latest desired state is re-checked once that execution acknowledges.
    await db.update(gateCommands).set({ status: "superseded", completedAt: new Date(), errorMessage: "Superseded by newer identity policy" }).where(and(
      eq(gateCommands.deviceId, device.id), eq(gateCommands.status, "pending"), sql`${gateCommands.payload}->>'identityId' = ${String(identity.id)}`,
    )).catch(() => undefined);
    const command = await queueCommand(device, desired.enabled ? "sync_identity" : "delete_identity", desired.enabled ? {
      identityId: identity.id,
      idno: identity.identityNo,
      name: identity.displayName,
      usertype: desired.usertype,
      TimeGroupId: desired.timeGroupId,
      passAlgo: false,
      picData1: desired.photoBase64,
      policyVersion: Date.now(),
      stateFingerprint: fingerprint,
    } : { identityId: identity.id, idno: identity.identityNo, stateFingerprint: fingerprint, policyVersion: Date.now() }, reason, requestedByUserId);
    const syncValues = {
      identityId: identity.id,
      deviceId: device.id,
      desiredListType: desired.usertype,
      desiredEnabled: desired.enabled,
      desiredTimeGroup: desired.timeGroupId,
      desiredFingerprint: fingerprint,
      terminalReportedIdentityNo: null,
      syncStatus: "pending",
      lastCommandId: command.id,
      lastAttemptAt: new Date(),
      retryCount: existingSync?.retryCount || 0,
      nextRetryAt: null,
      lastError: null,
      updatedAt: new Date(),
    };
    if (existingSync) await db.update(gateIdentitySync).set(syncValues).where(eq(gateIdentitySync.id, existingSync.id));
    else await db.insert(gateIdentitySync).values(syncValues);
    commands.push(command);
  }
  return commands;
}


async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function mergeJobDetails(current: unknown, patch: Record<string, unknown>) {
  const base = current && typeof current === "object" ? current as Record<string, unknown> : {};
  return { ...base, ...patch };
}

type GateJobResult = {
  status: "succeeded" | "skipped" | "failed";
  id: number;
  label?: string;
  error?: string;
  explanation?: string;
  identityId?: number;
  deviceIds?: number[];
};
async function recordJobItems(jobId: number, personType: "student" | "staff", results: GateJobResult[], identities = false) {
  if (!results.length) return;
  await db.insert(gateSyncJobItems).values(results.map((row) => ({
    jobId, personType, personId: row.id, identityId: identities ? row.id : row.identityId || null,
    personLabel: row.label || `${personType === "student" ? "Student" : "Staff"} #${row.id}`,
    outcome: row.status === "succeeded" ? "queued" : row.status === "failed" ? "failed" : "skipped",
    explanation: row.error || row.explanation || (row.status === "succeeded" ? "Terminal work was requested, not yet confirmed" : "Already correct or not applicable"),
    deviceIds: row.deviceIds || null,
  }))).onConflictDoNothing();
}

async function gateSyncJobTotal(schoolId: number, personType: "student" | "staff" | "all") {
  const [studentRows, staffRows] = await Promise.all([
    personType === "staff" ? Promise.resolve([]) : db.select({ id: students.id }).from(students).where(eq(students.schoolId, schoolId)),
    personType === "student" ? Promise.resolve([]) : db.select({ id: staff.id }).from(staff).where(eq(staff.schoolId, schoolId)),
  ]);
  return studentRows.length + staffRows.length;
}

async function finishGateSyncJob(jobId: number, status: "completed" | "failed", errorMessage?: string | null) {
  await db.update(gateSyncJobs).set({
    status,
    errorMessage: errorMessage || null,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(gateSyncJobs.id, jobId));
}

async function processBulkEnrollJob(job: typeof gateSyncJobs.$inferSelect) {
  const personType = (job.personType || "all") as "student" | "staff" | "all";
  let phase = (job.phase || (personType === "staff" ? "staff" : "student")) as "student" | "staff";
  let cursorId = job.cursorId || 0;
  let processed = job.processedItems || 0;
  let succeeded = job.succeededItems || 0;
  let skipped = job.skippedItems || 0;
  let failed = job.failedItems || 0;
  const chunkStartedAt = Date.now();

  const processStudentChunk = async () => {
    const rows = await db.select().from(students).where(and(eq(students.schoolId, job.schoolId), gt(students.id, cursorId))).orderBy(asc(students.id)).limit(GATE_SYNC_JOB_CHUNK);
    const results = await mapWithConcurrency(rows, GATE_SYNC_JOB_CONCURRENCY, async (student) => {
      try {
        if (student.status !== "active" || student.archivedAt) return { status: "skipped" as const, id: student.id, explanation: "Inactive or archived" };
        if (!student.photo) return { status: "skipped" as const, id: student.id, explanation: "Profile photograph missing" };
        const [existing] = await db.select().from(accessIdentities).where(eq(accessIdentities.studentId, student.id)).limit(1);
        if (existing?.enrollmentRemovedAt) return { status: "skipped" as const, id: student.id, explanation: "Enrollment intentionally removed" };
        const identity = await ensureIdentityForStudent(student, job.organizationId);
        if (!identity.isActive || !identity.photoPath) return { status: "skipped" as const, id: student.id, explanation: "Inactive or missing photograph" };
        const commands = await queueIdentitySync(identity.id, job.requestedByUserId, `Bulk student enrollment job #${job.id}`);
        return commands.length ? { status: "succeeded" as const, id: student.id, identityId: identity.id, deviceIds: commands.map(c => c.deviceId) } : { status: "skipped" as const, id: student.id, explanation: "No terminal state changes required" };
      } catch (error) {
        return { status: "failed" as const, id: student.id, label: `${student.firstName} ${student.lastName} · ${student.admissionNo}`, error: error instanceof Error ? error.message : String(error) };
      }
    });
    return { rows, results };
  };

  const processStaffChunk = async () => {
    const rows = await db.select().from(staff).where(and(eq(staff.schoolId, job.schoolId), gt(staff.id, cursorId))).orderBy(asc(staff.id)).limit(GATE_SYNC_JOB_CHUNK);
    const results = await mapWithConcurrency(rows, GATE_SYNC_JOB_CONCURRENCY, async (person) => {
      try {
        if (person.status !== "active") return { status: "skipped" as const, id: person.id, explanation: "Inactive" };
        if (!person.photo) return { status: "skipped" as const, id: person.id, explanation: "Profile photograph missing" };
        const [existing] = await db.select().from(accessIdentities).where(eq(accessIdentities.staffId, person.id)).limit(1);
        if (existing?.enrollmentRemovedAt) return { status: "skipped" as const, id: person.id, explanation: "Enrollment intentionally removed" };
        const identity = await ensureIdentityForStaff(person, job.organizationId);
        if (!identity.isActive || !identity.photoPath) return { status: "skipped" as const, id: person.id, explanation: "Inactive or missing photograph" };
        const commands = await queueIdentitySync(identity.id, job.requestedByUserId, `Bulk staff enrollment job #${job.id}`);
        return commands.length ? { status: "succeeded" as const, id: person.id, identityId: identity.id, deviceIds: commands.map(c => c.deviceId) } : { status: "skipped" as const, id: person.id, explanation: "No terminal state changes required" };
      } catch (error) {
        return { status: "failed" as const, id: person.id, label: `${person.firstName} ${person.lastName} · ${person.staffNo}`, error: error instanceof Error ? error.message : String(error) };
      }
    });
    return { rows, results };
  };

  const chunk = phase === "student" ? await processStudentChunk() : await processStaffChunk();
  const rows = chunk.rows;
  const results = chunk.results;
  await recordJobItems(job.id, phase, results);
  if (rows.length) cursorId = rows[rows.length - 1].id;
  processed += results.length;
  succeeded += results.filter((result) => result.status === "succeeded").length;
  skipped += results.filter((result) => result.status === "skipped").length;
  failed += results.filter((result) => result.status === "failed").length;
  const recentFailures = results.filter((result): result is Extract<typeof result, { status: "failed" }> => result.status === "failed")
    .map((result) => ({ personId: result.id, person: result.label, error: result.error }));
  const durationMs = Math.max(1, Date.now() - chunkStartedAt);
  const details = mergeJobDetails(job.details, {
    chunkSize: GATE_SYNC_JOB_CHUNK,
    concurrency: GATE_SYNC_JOB_CONCURRENCY,
    lastChunkDurationMs: durationMs,
    lastChunkItems: results.length,
    lastChunkItemsPerSecond: Number(((results.length * 1000) / durationMs).toFixed(2)),
    ...(recentFailures.length ? { recentFailures: recentFailures.slice(-20) } : {}),
  });

  if (rows.length < GATE_SYNC_JOB_CHUNK) {
    if (personType === "all" && phase === "student") {
      phase = "staff";
      cursorId = 0;
    } else {
      await db.update(gateSyncJobs).set({ processedItems: processed, succeededItems: succeeded, skippedItems: skipped, failedItems: failed, cursorId, phase, details, updatedAt: new Date() }).where(eq(gateSyncJobs.id, job.id));
      await finishGateSyncJob(job.id, "completed");
      return;
    }
  }

  await db.update(gateSyncJobs).set({
    status: "running",
    startedAt: job.startedAt || new Date(),
    phase,
    cursorId,
    processedItems: processed,
    succeededItems: succeeded,
    skippedItems: skipped,
    failedItems: failed,
    details,
    updatedAt: new Date(),
  }).where(eq(gateSyncJobs.id, job.id));
}

async function processReconcileJob(job: typeof gateSyncJobs.$inferSelect) {
  const devices = await db.select().from(gateDevices).where(and(eq(gateDevices.schoolId, job.schoolId), eq(gateDevices.isActive, true)));
  const phase = String(job.phase || "inventory");

  // Installed F550 terminals return HTTP 404 for /getPersonnelIDList.
  // Do not call this unsupported API. Reconcile known Portal state here; terminal
  // presence is independently verified via per-identity read commands below.
  if (phase === "inventory") {
    const details = mergeJobDetails(job.details, {
      inventoryMethod: "individual_lookup",
      inventoryCapability: "bulk_inventory_unsupported",
      verificationScope: "known_portal_identities_only",
    });
    await db.update(gateSyncJobs).set({ status: "running", phase: "identities", startedAt: job.startedAt || new Date(), details, updatedAt: new Date() }).where(eq(gateSyncJobs.id, job.id));
    return;
  }
  const actualIdsByDevice = new Map<number, Set<string>>();
  if (phase === "verification") {
    const relevant = await db.execute(sql`SELECT status, count(*)::int AS count FROM gate_commands WHERE school_id=${job.schoolId} AND command_type='verify_identity' AND request_reason=${`Nightly verification job #${job.id}`} GROUP BY status`);
    const statuses = new Map(relevant.rows.map((row: any) => [String(row.status), Number(row.count)]));
    const unfinished = (statuses.get("pending") || 0) + (statuses.get("processing") || 0);
    if (unfinished) return;
    const failed = (statuses.get("failed") || 0) + (statuses.get("expired") || 0) + (statuses.get("uncertain") || 0);
    const completed = statuses.get("succeeded") || 0;
    const verificationMode = "known_portal_identities_only";
    await db.update(gateSyncJobs).set({
      status: "completed_with_exceptions", completedAt: new Date(), phase: "complete",
      details: mergeJobDetails(job.details, { verificationScope: verificationMode, verificationSucceeded: completed, verificationFailed: failed,
        disclaimer: "Full terminal inventory enumeration is unsupported on this firmware; unknown terminal-only identities are not verified." }), updatedAt: new Date(),
    }).where(eq(gateSyncJobs.id, job.id));
    await db.update(gateBridges).set({ lastIdentityReconcileAt: new Date(), updatedAt: new Date() }).where(eq(gateBridges.schoolId, job.schoolId));
    return;
  }

  const rows = await db.select().from(accessIdentities).where(and(eq(accessIdentities.schoolId, job.schoolId), gt(accessIdentities.id, job.cursorId || 0))).orderBy(asc(accessIdentities.id)).limit(GATE_SYNC_JOB_CHUNK);
  let processed = job.processedItems || 0;
  let succeeded = job.succeededItems || 0;
  let skipped = job.skippedItems || 0;
  let failed = job.failedItems || 0;
  let cursorId = job.cursorId || 0;

  const reconcileChunkStartedAt = Date.now();
  const reconcileResults = await mapWithConcurrency(rows, GATE_SYNC_JOB_CONCURRENCY, async (identity) => {
    try {
      const previous = identity;
      let refreshed = identity;
      if (identity.personType === "student" && identity.studentId) {
        const [student] = await db.select().from(students).where(eq(students.id, identity.studentId)).limit(1);
        if (!student) return { status: "skipped" as const, id: identity.id, explanation: "Student profile no longer exists" };
        refreshed = await ensureIdentityForStudent(student, identity.organizationId);
      } else if (identity.personType === "staff" && identity.staffId) {
        const [person] = await db.select().from(staff).where(eq(staff.id, identity.staffId)).limit(1);
        if (!person) return { status: "skipped" as const, id: identity.id, explanation: "Staff profile no longer exists" };
        refreshed = await ensureIdentityForStaff(person, identity.organizationId);
      }

      const syncRows = await db.select().from(gateIdentitySync).where(eq(gateIdentitySync.identityId, refreshed.id));
      const syncByDevice = new Map(syncRows.map((row) => [row.deviceId, row]));
      const desiredDeviceIds: number[] = [];
      for (const device of devices) {
        const sync = syncByDevice.get(device.id);
        const actualIds = actualIdsByDevice.get(device.id);
        const terminalPresenceKnown = !!actualIds;
        const terminalHasIdentity = actualIds?.has(refreshed.identityNo) === true;

        if (!refreshed.isActive) {
          if ((terminalPresenceKnown && terminalHasIdentity) || (!terminalPresenceKnown && sync && (sync.desiredEnabled || sync.syncStatus !== "deleted"))) desiredDeviceIds.push(device.id);
          continue;
        }
        if (!refreshed.photoPath) continue;

        const missingOnTerminal = terminalPresenceKnown && !terminalHasIdentity;
        // Targeted verification is safe and read-only. Keep it below bulk priority.
        if (refreshed.isActive && refreshed.photoPath && sync?.syncStatus === "synced" &&
            (!sync.lastVerifiedAt || (Date.now() - new Date(sync.lastVerifiedAt).getTime() > 24 * 60 * 60 * 1000))) {
          await queueCommand(device, "verify_identity", { identityId: refreshed.id, idno: refreshed.identityNo, expectedTimeGroup: sync.desiredTimeGroup }, `Nightly verification job #${job.id}`, job.requestedByUserId, 24 * 60 * 60_000);
        }
        const photoChanged = !!sync && sync.lastSyncedPhotoPath !== refreshed.photoPath;
        const stateChanged = previous.isActive !== refreshed.isActive || previous.desiredEntryAccess !== refreshed.desiredEntryAccess || previous.manualRestrictionActive !== refreshed.manualRestrictionActive;
        if (!sync || missingOnTerminal || photoChanged || stateChanged || ["failed", "retry_pending"].includes(sync.syncStatus)) desiredDeviceIds.push(device.id);
      }
      if (desiredDeviceIds.length) {
        const commands = await queueIdentitySync(refreshed.id, job.requestedByUserId, `Enrollment reconciliation job #${job.id}`, desiredDeviceIds);
        if (commands.length) return { status: "succeeded" as const, id: identity.id, deviceIds: commands.map(c => c.deviceId) };
      }
      return { status: "skipped" as const, id: identity.id,
        explanation: !refreshed.isActive ? "Inactive identity; no terminal update needed" :
          !refreshed.photoPath ? "Profile photograph missing" : "Already correct, pending, or awaiting terminal verification" };
    } catch (error) {
      return { status: "failed" as const, id: identity.id, label: `${identity.displayName} · ${identity.identityNo}`, error: error instanceof Error ? error.message : String(error) };
    }
  });
  for (const personType of ["student", "staff"] as const) {
    await recordJobItems(job.id, personType, reconcileResults.filter((row) => rows.find((identity) => identity.id === row.id)?.personType === personType).map((row) => {
      const item: GateJobResult = row;
      return { ...item, label: item.label || rows.find((identity) => identity.id === item.id)?.displayName };
    }), true);
  }
  if (rows.length) cursorId = rows[rows.length - 1].id;
  processed += reconcileResults.length;
  succeeded += reconcileResults.filter((result) => result.status === "succeeded").length;
  skipped += reconcileResults.filter((result) => result.status === "skipped").length;
  failed += reconcileResults.filter((result) => result.status === "failed").length;
  const reconcileDurationMs = Math.max(1, Date.now() - reconcileChunkStartedAt);
  const reconcileFailures = reconcileResults.filter((result): result is Extract<typeof result, { status: "failed" }> => result.status === "failed")
    .map((result) => ({ identityId: result.id, person: result.label, error: result.error }));
  const reconcileDetails = mergeJobDetails(job.details, {
    chunkSize: GATE_SYNC_JOB_CHUNK,
    concurrency: GATE_SYNC_JOB_CONCURRENCY,
    lastChunkDurationMs: reconcileDurationMs,
    lastChunkItems: reconcileResults.length,
    lastChunkItemsPerSecond: Number(((reconcileResults.length * 1000) / reconcileDurationMs).toFixed(2)),
    ...(reconcileFailures.length ? { recentFailures: reconcileFailures.slice(-20) } : {}),
  });

  await db.update(gateSyncJobs).set({
    status: "running",
    startedAt: job.startedAt || new Date(),
    phase: "identities",
    cursorId,
    processedItems: processed,
    succeededItems: succeeded,
    skippedItems: skipped,
    failedItems: failed,
    details: reconcileDetails,
    updatedAt: new Date(),
  }).where(eq(gateSyncJobs.id, job.id));

  if (rows.length < GATE_SYNC_JOB_CHUNK) {
    await db.update(gateSyncJobs).set({ phase: "verification", details: mergeJobDetails(reconcileDetails, { verificationScope: "known_portal_identities_only", inventoryMethod: "individual_lookup" }), updatedAt: new Date() }).where(eq(gateSyncJobs.id, job.id));
  }

}

async function processGateSyncJobs() {
  const jobs = await db.select().from(gateSyncJobs).where(inArray(gateSyncJobs.status, ["pending", "running"])).orderBy(asc(gateSyncJobs.createdAt)).limit(3);
  for (const job of jobs) {
    try {
      if (job.jobType === "bulk_enroll") await processBulkEnrollJob(job);
      else if (job.jobType === "reconcile") await processReconcileJob(job);
      else await finishGateSyncJob(job.id, "failed", `Unsupported Gate synchronization job type: ${job.jobType}`);
    } catch (error) {
      await finishGateSyncJob(job.id, "failed", error instanceof Error ? error.message : String(error));
    }
  }
}

function retryDelayMs(retryCount: number) {
  const schedule = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
  return schedule[Math.min(Math.max(0, retryCount - 1), schedule.length - 1)];
}

async function processIdentityRetryQueue(now: Date) {
  await db.update(gateCommands).set({ status: "uncertain", completedAt: GATE_UTC_NOW, errorMessage: "Execution acknowledgement lost or lease expired; verify terminal state before retrying." }).where(and(
    eq(gateCommands.status, "processing"),
    // Also unblock a terminal when an urgent open, read-only verification, or
    // configuration command loses its lease. Never automatically replay an open.
    // The two columns and the reference clock MUST all be UTC wall-clock values.
    sql`(${gateCommands.leaseExpiresAt} < ${GATE_UTC_NOW} OR (${gateCommands.leaseExpiresAt} IS NULL AND ${gateCommands.claimedAt} < ${GATE_UTC_NOW} - INTERVAL '20 minutes'))`,
  ));

  const pending = await db.select().from(gateIdentitySync).where(eq(gateIdentitySync.syncStatus, "pending")).limit(200);
  const commandIds = pending.map((row) => row.lastCommandId).filter((id): id is number => !!id);
  if (commandIds.length) {
    const commands = await db.select({ id: gateCommands.id, status: gateCommands.status }).from(gateCommands).where(inArray(gateCommands.id, commandIds));
    const statusById = new Map(commands.map((row) => [row.id, row.status]));
    for (const sync of pending) {
      const status = sync.lastCommandId ? statusById.get(sync.lastCommandId) : null;
      if (status && ["failed", "expired", "uncertain"].includes(status)) {
        const [command] = await db.select({ errorMessage: gateCommands.errorMessage }).from(gateCommands).where(eq(gateCommands.id, sync.lastCommandId!)).limit(1);
        const permanent = status === "uncertain" || /photo|unsupported|HTTP 404|authenticat|storage full|invalid image/i.test(command?.errorMessage || "");
        if (permanent || (sync.retryCount || 0) >= 5) {
          await db.update(gateIdentitySync).set({ syncStatus: "failed", nextRetryAt: null, lastError: command?.errorMessage || "Retry requires administrator review", updatedAt: now }).where(eq(gateIdentitySync.id, sync.id));
          continue;
        }
        const retries = (sync.retryCount || 0) + 1;
        await db.update(gateIdentitySync).set({
          syncStatus: "retry_pending",
          retryCount: retries,
          nextRetryAt: new Date(now.getTime() + retryDelayMs(retries)),
          lastError: status === "expired" ? "Synchronization command expired before completion" : sync.lastError,
          updatedAt: now,
        }).where(eq(gateIdentitySync.id, sync.id));
      }
    }
  }

  const due = await db.select().from(gateIdentitySync).where(and(eq(gateIdentitySync.syncStatus, "retry_pending"), lte(gateIdentitySync.nextRetryAt, now))).limit(50);
  for (const sync of due) {
    try {
      await queueIdentitySync(sync.identityId, null, `Automatic Gate synchronization retry #${(sync.retryCount || 0) + 1}`, [sync.deviceId]);
    } catch (error) {
      const retries = (sync.retryCount || 0) + 1;
      await db.update(gateIdentitySync).set({
        retryCount: retries,
        nextRetryAt: new Date(now.getTime() + retryDelayMs(retries)),
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: now,
      }).where(eq(gateIdentitySync.id, sync.id));
    }
  }
}

async function ensureAutomaticReconciliationJobs(now: Date) {
  const bridges = await db.select().from(gateBridges).where(eq(gateBridges.isActive, true));
  const schoolIds = Array.from(new Set(bridges.map((row) => row.schoolId)));
  const zimbabweClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Harare", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const dayParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => dayParts.find((item) => item.type === name)?.value || "";
  const zimbabweDay = `${part("year")}-${part("month")}-${part("day")}`;
  for (const schoolId of schoolIds) {
    // Prevent unsupported verification commands while the installed Bridge is
    // still on the legacy release during a staggered deployment.
    const schoolBridges = bridges.filter((bridge) => bridge.schoolId === schoolId);
    if (schoolBridges.some((bridge) => !gateBridgeSupports(bridge.softwareVersion, "1.1.0"))) continue;
    const [settings] = await db.select().from(gateSchoolSettings).where(eq(gateSchoolSettings.schoolId, schoolId)).limit(1);
    if (settings?.reconciliationEnabled === false || zimbabweClock < (settings?.reconciliationTime || "23:00")) continue;
    const todaysJobs = await db.select({ id: gateSyncJobs.id }).from(gateSyncJobs).where(and(
      eq(gateSyncJobs.schoolId, schoolId), eq(gateSyncJobs.jobType, "reconcile"),
      sql`(${gateSyncJobs.details}->>'automatic') = 'true'`,
      sql`to_char(${gateSyncJobs.createdAt} + INTERVAL '2 hours', 'YYYY-MM-DD') = ${zimbabweDay}`,
    )).limit(1);
    if (todaysJobs.length) continue;
    const active = await db.select({ id: gateSyncJobs.id }).from(gateSyncJobs).where(and(eq(gateSyncJobs.schoolId, schoolId), eq(gateSyncJobs.jobType, "reconcile"), inArray(gateSyncJobs.status, ["pending", "running"]))).limit(1);
    if (active.length) continue;
    const bridge = bridges.find((row) => row.schoolId === schoolId)!;
    const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(accessIdentities).where(eq(accessIdentities.schoolId, schoolId));
    await db.insert(gateSyncJobs).values({ organizationId: bridge.organizationId, schoolId, jobType: "reconcile", personType: "all", totalItems: total?.count || 0, status: "pending", details: { automatic: true, scheduledDay: zimbabweDay } });
  }
}

export async function syncStudentPolicy(studentId: number, requestedByUserId?: number | null, reason = "Student access policy changed") {
  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!student?.schoolId) return null;
  const [school] = await db.select().from(schools).where(eq(schools.id, student.schoolId)).limit(1);
  if (!school?.organizationId) return null;
  const identity = await ensureIdentityForStudent(student, school.organizationId);
  await queueIdentitySync(identity.id, requestedByUserId, reason);
  return identity;
}

export async function syncSchoolAccessPolicies(schoolId: number, requestedByUserId?: number | null, reason = "School access policy refresh") {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school?.organizationId) return { students: 0, staff: 0 };
  const [studentRows, staffRows, devices] = await Promise.all([
    db.select().from(students).where(eq(students.schoolId, schoolId)),
    db.select().from(staff).where(eq(staff.schoolId, schoolId)),
    db.select().from(gateDevices).where(and(eq(gateDevices.schoolId, schoolId), eq(gateDevices.isActive, true))),
  ]);
  for (const device of devices.filter(d => d.direction === "exit")) await configureExitScheduleForDevice(device);
  for (const student of studentRows) {
    const identity = await ensureIdentityForStudent(student, school.organizationId);
    if (identity.photoPath) await queueIdentitySync(identity.id, requestedByUserId, reason);
  }
  for (const person of staffRows) {
    const identity = await ensureIdentityForStaff(person, school.organizationId);
    if (identity.photoPath) await queueIdentitySync(identity.id, requestedByUserId, reason);
  }
  return { students: studentRows.length, staff: staffRows.length };
}

function renderTemplate(template: string, values: Record<string, string | number | null | undefined>) {
  return template.replace(/\{\{([a-z0-9_]+)\}\}/gi, (_full, key) => String(values[key] ?? ""));
}

async function organizationIdForSchool(schoolId: number) {
  const [school] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  return school?.organizationId ?? null;
}

async function organizationScopeOf(req: Request) {
  const u = req.user as AuthedUser;
  const direct = Number(u?.organizationId || 0);
  if (direct > 0) return { organizationId: direct, userId: u.id };
  const schoolId = Number(u?.schoolId || req.header("X-School-Id") || 0);
  if (!schoolId) throw new Error("Organisation context is required");
  const organizationId = await organizationIdForSchool(schoolId);
  if (!organizationId) throw new Error("Organisation context was not found");
  return { organizationId, userId: u.id };
}

async function ensureOrganizationMessageTemplates(organizationId: number) {
  const existing = await db.select().from(organizationAttendanceMessageTemplates).where(eq(organizationAttendanceMessageTemplates.organizationId, organizationId));
  const map = new Map(existing.map(row => [row.templateKey, row]));
  for (const [key, def] of Object.entries(DEFAULT_TEMPLATE_MAP)) {
    if (!map.has(key)) {
      const [row] = await db.insert(organizationAttendanceMessageTemplates).values({ organizationId, templateKey: key, smsTemplate: def.sms, emailSubjectTemplate: def.subject, emailBodyTemplate: def.sms }).returning();
      map.set(key, row);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.templateKey.localeCompare(b.templateKey));
}

async function ensureMessageTemplates(schoolId: number) {
  const organizationId = await organizationIdForSchool(schoolId);
  if (!organizationId) return [];
  return ensureOrganizationMessageTemplates(organizationId);
}

async function notificationValues(student: typeof students.$inferSelect, attendance: typeof attendanceRecords.$inferSelect | null, schedule: SchoolDaySchedule, extra: Record<string, string> = {}) {
  const [school, classInfo, parent, teacher] = await Promise.all([
    student.schoolId ? db.select().from(schools).where(eq(schools.id, student.schoolId)).limit(1).then(r => r[0]) : null,
    student.classId ? db.select().from(classes).where(eq(classes.id, student.classId)).limit(1).then(r => r[0]) : null,
    student.parentId ? db.select().from(parents).where(eq(parents.id, student.parentId)).limit(1).then(r => r[0]) : null,
    student.classId ? db.select().from(classes).where(eq(classes.id, student.classId)).limit(1).then(async r => r[0]?.classTeacherId ? (await db.select().from(staff).where(eq(staff.id, r[0].classTeacherId)).limit(1))[0] : null) : null,
  ]);
  const teacherName = teacher ? `${teacher.firstName} ${teacher.lastName}`.trim() : "";
  const teacherContactBits = [teacher?.phone ? `Phone: ${teacher.phone}` : "", teacher?.email ? `Email: ${teacher.email}` : ""].filter(Boolean);
  const contactLine = teacherName ? `Contact: ${teacherName}${teacherContactBits.length ? ` | ${teacherContactBits.join(" | ")}` : ""}` : school?.callCentrePhone || school?.callCentreWhatsApp ? `Phone: ${school?.callCentrePhone || ""}${school?.callCentreWhatsApp ? ` or WhatsApp: ${school.callCentreWhatsApp}` : ""}` : "";
  const reason = attendance?.reason || "No Reason";
  return {
    student_name: `${student.firstName} ${student.lastName}`,
    admission_no: student.admissionNo,
    date: attendance?.date || localParts().date,
    class_name: classInfo?.shortCode || classInfo?.className || "Class",
    reason,
    reason_upper: reason.toUpperCase(),
    attendance_status: attendance?.status || "",
    attendance_status_upper: String(attendance?.status || "").toUpperCase(),
    school_name: school?.name || "FCGS",
    school_phone: school?.phone || "",
    school_call_centre_phone: school?.callCentrePhone || "",
    school_whatsapp: school?.callCentreWhatsApp || "",
    class_teacher_name: teacherName,
    class_teacher_phone: teacher?.phone || "",
    class_teacher_email: teacher?.email || "",
    contact_line: contactLine,
    reconciliation_time: schedule.reconciliationTime,
    arrival_time: attendance?.firstGateArrivalAt ? new Intl.DateTimeFormat("en-ZW", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(attendance.firstGateArrivalAt)) : "",
    admission_time: attendance?.admittedAt ? new Intl.DateTimeFormat("en-ZW", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(attendance.admittedAt)) : "",
    absence_detail: reason.toLowerCase() === "no reason" || !reason.trim() ? "Please contact us with a reason for the absence." : `Reason: ${reason.toUpperCase()}. Please contact us for any enquiries you may have.`,
    ...extra,
  };
}

export async function sendAttendanceTemplate(studentId: number, templateKey: string, attendance: typeof attendanceRecords.$inferSelect | null, sentBy?: number | null) {
  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!student?.schoolId || !student.parentId) return false;
  const [parent] = await db.select().from(parents).where(eq(parents.id, student.parentId)).limit(1);
  if (!parent || (!parent.phone && !parent.email)) return false;
  const schedule = await getSchoolDaySchedule(student.schoolId, attendance?.date ? new Date(`${attendance.date}T12:00:00+02:00`) : new Date());
  const templates = await ensureMessageTemplates(student.schoolId);
  const template = templates.find(t => t.templateKey === templateKey);
  if (!template) return false;
  const values = await notificationValues(student, attendance, schedule);
  const text = renderTemplate(template.smsTemplate, values);
  const subject = renderTemplate(template.emailSubjectTemplate || "FCGS Attendance Notification", values);
  const recipientName = `${parent.firstName} ${parent.lastName}`;
  if (parent.phone) await communicationService.sendSms({ to: parent.phone, message: text, schoolId: student.schoolId, recipientType: "parent", recipientId: parent.id, recipientName, category: "attendance", sentBy: sentBy || undefined });
  if (parent.email) await communicationService.sendEmail({ to: parent.email, subject, text, html: renderTemplate(template.emailBodyTemplate || template.smsTemplate, values).replace(/\n/g, "<br>"), schoolId: student.schoolId, recipientType: "parent", recipientId: parent.id, recipientName, category: "attendance", sentBy: sentBy || undefined });
  return true;
}

async function upsertStudentGateAttendance(student: typeof students.$inferSelect, device: typeof gateDevices.$inferSelect, occurredAt: Date, allowed: boolean, decisionReason: string) {
  if (!student.classId || !student.schoolId) return null;
  const parts = localParts(occurredAt);
  const schedule = await getSchoolDaySchedule(student.schoolId, occurredAt);
  if (!schedule.isSchoolDay || !(await isAcademicOpenDay(student.schoolId, parts.date))) return null;
  const existing = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.studentId, student.id), eq(attendanceRecords.classId, student.classId), eq(attendanceRecords.date, parts.date))).limit(1).then(r => r[0]);
  const firstArrival = existing?.firstGateArrivalAt && new Date(existing.firstGateArrivalAt) < occurredAt ? existing.firstGateArrivalAt : occurredAt;
  if (!allowed) {
    if (existing) {
      const [updated] = await db.update(attendanceRecords).set({ firstGateArrivalAt: firstArrival, gateId: device.gateId, gateDeviceId: device.id, source: existing.source === "teacher" ? "teacher+gate" : existing.source }).where(eq(attendanceRecords.id, existing.id)).returning();
      return updated;
    }
    // A denied learner is not yet Present/Absent/Fees. Preserve arrival evidence in Access Events only until reconciliation.
    return null;
  }
  const lateCutoff = parseHm(schedule.studentStartTime) + Number(schedule.studentLateGraceMinutes || 0);
  const status = parts.minutes > lateCutoff ? "late" : "present";
  const values = {
    studentId: student.id,
    classId: student.classId,
    date: parts.date,
    status: status as any,
    reason: status === "late" ? "Late arrival" : null,
    source: "gate",
    gateEvidenceLocked: true,
    firstGateArrivalAt: firstArrival,
    admittedAt: occurredAt,
    gateId: device.gateId,
    gateDeviceId: device.id,
  };
  const [record] = await db.insert(attendanceRecords).values(values).onConflictDoUpdate({
    target: [attendanceRecords.studentId, attendanceRecords.classId, attendanceRecords.date],
    set: {
      status: status as any,
      reason: status === "late" ? "Late arrival" : null,
      source: existing?.source === "teacher" ? "teacher+gate" : "gate",
      gateEvidenceLocked: true,
      firstGateArrivalAt: firstArrival,
      admittedAt: existing?.admittedAt && new Date(existing.admittedAt) < occurredAt ? existing.admittedAt : occurredAt,
      gateId: device.gateId,
      gateDeviceId: device.id,
    },
  }).returning();
  if (existing?.status === "fees" && existing.notifiedStatus === "fees") {
    await sendAttendanceTemplate(student.id, "fees_denial_later_admitted", record, null).catch(() => undefined);
    await db.update(attendanceRecords).set({ notifiedStatus: status, notifiedReason: record.reason || null }).where(eq(attendanceRecords.id, record.id));
  }
  return record;
}

async function recordStudentExit(student: typeof students.$inferSelect, device: typeof gateDevices.$inferSelect, occurredAt: Date) {
  if (!student.classId || !student.schoolId) return null;
  const parts = localParts(occurredAt);
  const [record] = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.studentId, student.id), eq(attendanceRecords.classId, student.classId), eq(attendanceRecords.date, parts.date))).limit(1);
  if (!record) return null;
  const [updated] = await db.update(attendanceRecords).set({ lastGateExitAt: occurredAt, gateId: device.gateId, gateDeviceId: device.id }).where(eq(attendanceRecords.id, record.id)).returning();
  return updated || record;
}

async function recordStaffMovement(person: typeof staff.$inferSelect, device: typeof gateDevices.$inferSelect, occurredAt: Date) {
  const effectiveSchoolId = person.schoolId || device.schoolId;
  if (!effectiveSchoolId) return { log: null, effect: "staff_no_school" };
  const parts = localParts(occurredAt);
  const schedule = await getSchoolDaySchedule(effectiveSchoolId, occurredAt);
  let [log] = await db.select().from(staffAttendanceLogs).where(and(eq(staffAttendanceLogs.schoolId, effectiveSchoolId), eq(staffAttendanceLogs.staffId, person.id), eq(staffAttendanceLogs.date, parts.date))).limit(1);

  if (device.direction === "entry") {
    const regularAttendanceExpected = schedule.isSchoolDay && await isAcademicOpenDay(effectiveSchoolId, parts.date);
    if (!regularAttendanceExpected) {
      return { log: null, effect: "staff_non_school_day_access_event_only" };
    }
    if (!log) {
      const cutoff = parseHm(schedule.staffStartTime) + Number(schedule.staffLateGraceMinutes || 0);
      const status = parts.minutes > cutoff ? "late" : "on_time";
      [log] = await db.insert(staffAttendanceLogs).values({
        schoolId: effectiveSchoolId,
        staffId: person.id,
        userId: person.userId,
        date: parts.date,
        clockIn: occurredAt,
        status,
        source: "gate",
        firstGateEntryAt: occurredAt,
        currentlyOnCampus: true,
        missingClockOut: false,
        reasonRequired: status === "late",
        reasonType: status === "late" ? "late_clock_in" : null,
      }).returning();
      return { log, effect: status === "late" ? "staff_gate_entry_late" : "staff_gate_entry_on_time" };
    }
    [log] = await db.update(staffAttendanceLogs).set({
      firstGateEntryAt: log.firstGateEntryAt || occurredAt,
      clockOut: null,
      autoClockedOut: false,
      currentlyOnCampus: true,
      missingClockOut: false,
      source: log.source === "manual" ? "manual+gate" : log.source,
    }).where(eq(staffAttendanceLogs.id, log.id)).returning();
    return { log, effect: "staff_gate_reentry" };
  }

  // Exit: prefer today's attendance. If there is no record for today, close the
  // latest prior open shift immediately with this real after-midnight Exit.
  if (!log) {
    [log] = await db.select().from(staffAttendanceLogs).where(and(
      eq(staffAttendanceLogs.schoolId, effectiveSchoolId),
      eq(staffAttendanceLogs.staffId, person.id),
      isNull(staffAttendanceLogs.clockOut),
    )).orderBy(desc(staffAttendanceLogs.date)).limit(1);
  }
  if (!log) return { log: null, effect: "staff_exit_without_open_shift" };

  const crossMidnight = log.date < parts.date;
  if (crossMidnight) {
    [log] = await db.update(staffAttendanceLogs).set({
      lastGateExitAt: occurredAt,
      clockOut: occurredAt,
      currentlyOnCampus: false,
      missingClockOut: false,
      autoClockedOut: false,
      source: log.source === "manual" ? "manual+gate" : "gate",
    }).where(eq(staffAttendanceLogs.id, log.id)).returning();
    return { log, effect: "staff_prior_day_closed_after_midnight" };
  }

  [log] = await db.update(staffAttendanceLogs).set({
    lastGateExitAt: occurredAt,
    clockOut: occurredAt,
    autoClockedOut: false,
    currentlyOnCampus: false,
    missingClockOut: false,
    source: log.source === "manual" ? "manual+gate" : "gate",
  }).where(eq(staffAttendanceLogs.id, log.id)).returning();
  return { log, effect: "staff_exit_candidate" };
}

function normalizeIdentityValue(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePersonName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

async function rememberTerminalIdentityAlias(deviceId: number, identityId: number, terminalIdentityNo: string | null | undefined) {
  const alias = normalizeIdentityValue(terminalIdentityNo);
  if (!alias) return;
  await db.update(gateIdentitySync).set({ terminalReportedIdentityNo: alias, updatedAt: new Date() }).where(and(
    eq(gateIdentitySync.deviceId, deviceId),
    eq(gateIdentitySync.identityId, identityId),
  ));
}

async function resolveRecognitionIdentity(device: typeof gateDevices.$inferSelect, raw: Record<string, any>) {
  const fields: Array<[string, unknown]> = [
    ["idNum", raw.idNum],
    ["idno", raw.idno],
    ["identityNo", raw.identityNo],
    ["personnelId", raw.personnelId],
    ["employeeId", raw.employeeId],
    ["personId", raw.personId],
  ];
  const ordered = fields
    .map(([field, value]) => ({ field, value: normalizeIdentityValue(value) }))
    .filter((entry) => entry.value.length > 0);
  const uniqueValues = Array.from(new Set(ordered.map((entry) => entry.value)));

  if (uniqueValues.length) {
    const identities = await db.select().from(accessIdentities).where(and(
      eq(accessIdentities.schoolId, device.schoolId),
      inArray(accessIdentities.identityNo, uniqueValues),
    ));
    for (const candidate of ordered) {
      const exact = identities.find((row) => row.identityNo === candidate.value);
      if (exact) {
        const terminalIdentityNo = ordered[0]?.value || candidate.value;
        if (terminalIdentityNo !== exact.identityNo) await rememberTerminalIdentityAlias(device.id, exact.id, terminalIdentityNo);
        return { identity: exact, terminalIdentityNo, mappingSource: `terminal.${candidate.field}`, candidates: ordered };
      }
      const ci = identities.find((row) => row.identityNo.toLowerCase() === candidate.value.toLowerCase());
      if (ci) {
        const terminalIdentityNo = ordered[0]?.value || candidate.value;
        if (terminalIdentityNo.toLowerCase() !== ci.identityNo.toLowerCase()) await rememberTerminalIdentityAlias(device.id, ci.id, terminalIdentityNo);
        return { identity: ci, terminalIdentityNo, mappingSource: `terminal.${candidate.field}:case_insensitive`, candidates: ordered };
      }
    }

    const aliases = await db.select({ identityId: gateIdentitySync.identityId, terminalReportedIdentityNo: gateIdentitySync.terminalReportedIdentityNo }).from(gateIdentitySync).where(and(
      eq(gateIdentitySync.deviceId, device.id),
      inArray(gateIdentitySync.terminalReportedIdentityNo, uniqueValues),
    ));
    const aliasIdentityIds = Array.from(new Set(aliases.map((row) => row.identityId)));
    if (aliasIdentityIds.length === 1) {
      const [aliasedIdentity] = await db.select().from(accessIdentities).where(and(
        eq(accessIdentities.id, aliasIdentityIds[0]),
        eq(accessIdentities.schoolId, device.schoolId),
        eq(accessIdentities.isActive, true),
      )).limit(1);
      if (aliasedIdentity) return { identity: aliasedIdentity, terminalIdentityNo: ordered[0]?.value || null, mappingSource: "terminal.learned_alias", candidates: ordered };
    }
  }

  const callbackNames = [raw.name, raw.personName, raw.userName, raw.displayName]
    .map(normalizePersonName)
    .filter(Boolean);
  const uniqueCallbackNames = Array.from(new Set(callbackNames));
  if (uniqueCallbackNames.length) {
    const synced = await db.select({ identityId: gateIdentitySync.identityId }).from(gateIdentitySync).where(and(
      eq(gateIdentitySync.deviceId, device.id),
      eq(gateIdentitySync.syncStatus, "synced"),
    ));
    const syncedIds = Array.from(new Set(synced.map((row) => row.identityId)));
    if (syncedIds.length) {
      const enrolled = await db.select().from(accessIdentities).where(and(
        eq(accessIdentities.schoolId, device.schoolId),
        eq(accessIdentities.isActive, true),
        inArray(accessIdentities.id, syncedIds),
      ));
      const nameMatches = enrolled.filter((row) => uniqueCallbackNames.includes(normalizePersonName(row.displayName)));
      if (nameMatches.length === 1) {
        const terminalIdentityNo = ordered[0]?.value || null;
        if (terminalIdentityNo) await rememberTerminalIdentityAlias(device.id, nameMatches[0].id, terminalIdentityNo);
        return { identity: nameMatches[0], terminalIdentityNo, mappingSource: "synced_terminal_unique_name", candidates: ordered };
      }
    }
  }

  return { identity: undefined, terminalIdentityNo: ordered[0]?.value || null, mappingSource: "unmapped", candidates: ordered };
}

function parseRecognitionTimestamp(value: unknown, fallback?: string | null) {
  const raw = normalizeIdentityValue(value);
  if (raw) {
    const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
    const parsed = new Date(hasZone ? normalized : `${normalized}+02:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const parsedFallback = fallback ? new Date(fallback) : new Date();
  return Number.isNaN(parsedFallback.getTime()) ? new Date() : parsedFallback;
}

async function processRecognition(bridge: typeof gateBridges.$inferSelect, input: { deviceKey: string; record: Record<string, any>; receivedAt?: string | null }) {
  const [device] = await db.select().from(gateDevices).where(and(eq(gateDevices.bridgeId, bridge.id), eq(gateDevices.deviceKey, input.deviceKey))).limit(1);
  if (!device) throw new Error(`Unknown terminal ${input.deviceKey}`);

  const originalRaw = input.record || {};
  const nested = originalRaw?.data && typeof originalRaw.data === "object" && !Array.isArray(originalRaw.data) ? originalRaw.data : null;
  const raw = nested ? { ...originalRaw, ...nested } : originalRaw;
  const eventUuid = String(raw.id || raw.uuid || `${raw.time || Date.now()}-${raw.idNum || raw.identityNo || raw.name || "unknown"}`);
  const existing = await db.select({ id: accessEvents.id }).from(accessEvents).where(and(eq(accessEvents.deviceId, device.id), eq(accessEvents.eventUuid, eventUuid))).limit(1);
  if (existing.length) return { duplicate: true, id: existing[0].id };

  const resolution = await resolveRecognitionIdentity(device, raw);
  const identity = resolution.identity;
  const terminalComparedSuccessfully = Number(raw.resultStatus) === 0;
  const recognized = terminalComparedSuccessfully && !!identity;
  const occurredAt = parseRecognitionTimestamp(raw.time, input.receivedAt);
  const [schoolAccessState] = await db.select({ enableAccessControl: schools.enableAccessControl })
    .from(schools).where(eq(schools.id, device.schoolId)).limit(1);
  const accessControlEnabled = schoolAccessState?.enableAccessControl !== false;
  let decision = recognized ? "allowed" : "unknown";
  let reason = recognized
    ? "Recognised enrolled person"
    : terminalComparedSuccessfully
      ? "Terminal recognised a face but FCGS could not map the terminal identity"
      : "Unknown or failed recognition";
  let student: typeof students.$inferSelect | undefined;
  let person: typeof staff.$inferSelect | undefined;
  let financial: Awaited<ReturnType<typeof evaluateStudentFinancialAccess>> | null = null;
  let attendanceRecordId: number | null = null;
  let staffAttendanceLogId: number | null = null;
  let attendanceEffect: string | null = null;

  if (identity?.personType === "student" && identity.studentId) {
    [student] = await db.select().from(students).where(eq(students.id, identity.studentId)).limit(1);
    if (student) {
      financial = await evaluateStudentFinancialAccess(student, occurredAt);
      if (device.direction === "entry") {
        if (!identity.isActive) {
          decision = "denied";
          reason = identity.enrollmentRemovedAt ? "Access enrollment removed" : "Inactive access identity";
        } else if (!accessControlEnabled) {
          decision = "allowed";
          reason = "Access Control disabled; fail-open";
        } else if (identity.manualRestrictionActive) {
          decision = "denied";
          reason = `Manual restriction: ${identity.manualRestrictionReason || "Restricted by school"}`;
        } else {
          decision = financial.allowed ? "allowed" : "denied";
          reason = financial.reason;
        }
        const record = await upsertStudentGateAttendance(student, device, occurredAt, decision === "allowed", reason);
        attendanceRecordId = record?.id || null;
        attendanceEffect = decision === "allowed"
          ? `student_attendance_${record?.status || "present"}`
          : record
            ? "student_arrival_evidence_updated"
            : "student_arrival_access_event_only";
      } else {
        const schedule = await getSchoolDaySchedule(student.schoolId!, occurredAt);
        const normalExitFrom = Math.min(1439, parseHm(schedule.studentEndTime) + Number(schedule.studentDismissalGraceMinutes || 0));
        const release = await currentEarlyRelease(student.id, occurredAt);
        const parts = localParts(occurredAt);
        const academicOpenDay = schedule.isSchoolDay && await isAcademicOpenDay(student.schoolId!, parts.date);
        const exitAllowed = !academicOpenDay || !accessControlEnabled || parts.minutes >= normalExitFrom || !!release;
        decision = exitAllowed ? "allowed" : "denied";
        reason = exitAllowed
          ? !academicOpenDay ? "Non-school day" : !accessControlEnabled ? "Access Control disabled; fail-open" : release ? `Authorised ${release.releaseType}` : "Normal dismissal"
          : "Early exit not authorised";
        if (decision === "allowed") {
          const record = await recordStudentExit(student, device, occurredAt);
          attendanceRecordId = record?.id || null;
          attendanceEffect = record ? "student_gate_exit_recorded" : "student_exit_without_daily_attendance";
        } else {
          attendanceEffect = "student_early_exit_denied";
        }
      }
    }
  } else if (identity?.personType === "staff" && identity.staffId) {
    [person] = await db.select().from(staff).where(eq(staff.id, identity.staffId)).limit(1);
    if (!identity.isActive) {
      decision = "denied";
      reason = identity.enrollmentRemovedAt ? "Access enrollment removed" : "Inactive access identity";
    } else if (device.direction === "entry" && !accessControlEnabled) {
      decision = "allowed";
      reason = "Access Control disabled; fail-open";
    } else if (device.direction === "entry" && identity.manualRestrictionActive) {
      decision = "denied";
      reason = `Manual restriction: ${identity.manualRestrictionReason || "Restricted by school"}`;
    } else {
      decision = person?.status === "active" ? "allowed" : "denied";
      reason = person?.status === "active" ? "Active staff" : "Inactive staff";
    }
    if (person && decision === "allowed") {
      const movement = await recordStaffMovement(person, device, occurredAt);
      staffAttendanceLogId = movement.log?.id || null;
      attendanceEffect = movement.effect;
    }
  }

  const mappingMeta = {
    source: resolution.mappingSource,
    terminalCandidates: resolution.candidates,
    terminalName: normalizeIdentityValue(raw.name) || null,
    mappedIdentityNo: identity?.identityNo || null,
  };

  const [event] = await db.insert(accessEvents).values({
    organizationId: bridge.organizationId,
    schoolId: bridge.schoolId,
    bridgeId: bridge.id,
    gateId: device.gateId,
    deviceId: device.id,
    identityId: identity?.id || null,
    eventUuid,
    terminalIdentityNo: resolution.terminalIdentityNo,
    identityNo: identity?.identityNo || resolution.terminalIdentityNo || null,
    identityMappingSource: resolution.mappingSource,
    personType: identity?.personType || null,
    studentId: identity?.studentId || null,
    staffId: identity?.staffId || null,
    direction: device.direction,
    recognized,
    accessDecision: decision,
    decisionReason: reason,
    financialStatus: financial?.status || student?.feesStatus || null,
    financialSource: student?.feesSource || null,
    financialSnapshotAt: student?.feesSnapshotAt || null,
    financialImportBatchId: student?.feesImportBatchId || null,
    overrideId: financial?.override?.id || null,
    attendanceRecordId,
    staffAttendanceLogId,
    attendanceEffect,
    occurredAt,
    rawData: { ...originalRaw, _fcgsMapping: mappingMeta },
  }).returning();

  return { duplicate: false, id: event.id, decision, reason, identityNo: identity?.identityNo || null, mappingSource: resolution.mappingSource, attendanceEffect };
}

const scheduleRowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6), isSchoolDay: z.boolean(),
  studentStartTime: z.string().regex(/^\d{2}:\d{2}$/), studentLateGraceMinutes: z.number().int().min(0).max(240), studentEndTime: z.string().regex(/^\d{2}:\d{2}$/), studentDismissalGraceMinutes: z.number().int().min(0).max(240),
  staffStartTime: z.string().regex(/^\d{2}:\d{2}$/), staffLateGraceMinutes: z.number().int().min(0).max(240), staffEndTime: z.string().regex(/^\d{2}:\d{2}$/),
  breakStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), breakEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), lunchStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), lunchEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), reconciliationTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export function registerAccessControlOperations(app: Express) {
  app.get("/api/access-control/school-day", requireAuth, requirePermission("settings.view"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const overrides = await db.select().from(schoolDayOverrides).where(eq(schoolDayOverrides.schoolId, scope.schoolId)).orderBy(desc(schoolDayOverrides.overrideDate));
      res.json({ schedules: await ensureSchedules(scope.schoolId), overrides });
    } catch (error) { fail(res, error); }
  });

  app.put("/api/access-control/school-day", requireAuth, requirePermission("settings.edit"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const rows = z.array(scheduleRowSchema).length(7).parse(req.body?.schedules);
      for (const row of rows) {
        const [existing] = await db.select().from(schoolDaySchedules).where(and(eq(schoolDaySchedules.schoolId, scope.schoolId), eq(schoolDaySchedules.dayOfWeek, row.dayOfWeek))).limit(1);
        if (existing) await db.update(schoolDaySchedules).set({ ...row, updatedAt: new Date() }).where(eq(schoolDaySchedules.id, existing.id));
        else await db.insert(schoolDaySchedules).values({ schoolId: scope.schoolId, ...row });
      }
      const exitDevices = await db.select().from(gateDevices).where(and(eq(gateDevices.schoolId, scope.schoolId), eq(gateDevices.direction, "exit"), eq(gateDevices.isActive, true)));
      for (const device of exitDevices) await configureExitScheduleForDevice(device);
      const overrides = await db.select().from(schoolDayOverrides).where(eq(schoolDayOverrides.schoolId, scope.schoolId)).orderBy(desc(schoolDayOverrides.overrideDate));
      res.json({ schedules: await ensureSchedules(scope.schoolId), overrides });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/school-day/overrides", requireAuth, requirePermission("settings.edit"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const input = z.object({ overrideDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), isSchoolDay: z.boolean(), reason: z.string().trim().min(3).max(500) }).parse(req.body);
      const [row] = await db.insert(schoolDayOverrides).values({ schoolId: scope.schoolId, ...input, createdByUserId: scope.userId }).onConflictDoUpdate({
        target: [schoolDayOverrides.schoolId, schoolDayOverrides.overrideDate],
        set: { isSchoolDay: input.isSchoolDay, reason: input.reason, createdByUserId: scope.userId, updatedAt: new Date() },
      }).returning();
      res.status(201).json(row);
    } catch (error) { fail(res, error); }
  });

  app.delete("/api/access-control/school-day/overrides/:id", requireAuth, requirePermission("settings.edit"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const id = Number(req.params.id);
      const [row] = await db.select().from(schoolDayOverrides).where(and(eq(schoolDayOverrides.id, id), eq(schoolDayOverrides.schoolId, scope.schoolId))).limit(1);
      if (!row) throw new Error("School-day override not found");
      await db.delete(schoolDayOverrides).where(eq(schoolDayOverrides.id, row.id));
      res.json({ message: "School-day override removed" });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/access-control/identities", requireAuth, requirePermission("access_control.view"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const query = z.object({
        personType: z.enum(["student", "staff", "all"]).default("all"),
        search: z.string().trim().max(120).optional().default(""),
        status: z.enum(["all", "synced", "pending", "failed", "inactive"]).default("all"),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().refine((value) => [25, 50, 100].includes(value), "Page size must be 25, 50 or 100").default(25),
      }).parse(req.query);
      const activeDevices = await db.select({ id: gateDevices.id }).from(gateDevices).where(and(
        eq(gateDevices.schoolId, scope.schoolId),
        eq(gateDevices.isActive, true),
      ));
      const activeDeviceIds = activeDevices.map((row) => row.id);
      const activeTerminalCount = activeDeviceIds.length;
      const activeDeviceList = activeDeviceIds.length
        ? sql.join(activeDeviceIds.map((id) => sql`${id}`), sql`, `)
        : sql`NULL`;
      const failedOnActiveTerminal = activeTerminalCount > 0
        ? sql`EXISTS (SELECT 1 FROM gate_identity_sync gis WHERE gis.identity_id = ${accessIdentities.id} AND gis.device_id IN (${activeDeviceList}) AND gis.sync_status IN ('failed','retry_pending'))`
        : sql`FALSE`;
      const fullySyncedToActiveTerminals = activeTerminalCount > 0
        ? sql`(SELECT COUNT(DISTINCT gis.device_id)::int FROM gate_identity_sync gis WHERE gis.identity_id = ${accessIdentities.id} AND gis.device_id IN (${activeDeviceList}) AND gis.sync_status = 'synced') = ${activeTerminalCount}`
        : sql`FALSE`;

      const conditions: any[] = [eq(accessIdentities.schoolId, scope.schoolId)];
      if (query.personType !== "all") conditions.push(eq(accessIdentities.personType, query.personType));
      if (query.search) {
        const pattern = `%${query.search.toLowerCase().replace(/[%_]/g, "\\$&")}%`;
        conditions.push(sql`(LOWER(${accessIdentities.displayName}) LIKE ${pattern} ESCAPE '\\' OR LOWER(${accessIdentities.identityNo}) LIKE ${pattern} ESCAPE '\\')`);
      }
      if (query.status === "inactive") conditions.push(eq(accessIdentities.isActive, false));
      if (query.status === "failed") conditions.push(and(eq(accessIdentities.isActive, true), failedOnActiveTerminal));
      if (query.status === "pending") conditions.push(and(
        eq(accessIdentities.isActive, true),
        sql`NOT (${failedOnActiveTerminal})`,
        sql`NOT (${fullySyncedToActiveTerminals})`,
      ));
      if (query.status === "synced") conditions.push(and(eq(accessIdentities.isActive, true), fullySyncedToActiveTerminals));
      const where = and(...conditions)!;
      const [{ count: total }] = await db.select({ count: sql<number>`count(*)::int` }).from(accessIdentities).where(where);
      const pageCount = Math.max(1, Math.ceil(Number(total || 0) / query.pageSize));
      const page = Math.min(query.page, pageCount);
      const identityRows = await db.select().from(accessIdentities).where(where).orderBy(asc(accessIdentities.displayName), asc(accessIdentities.id)).limit(query.pageSize).offset((page - 1) * query.pageSize);
      const ids = identityRows.map((row) => row.id);
      const syncRows = ids.length && activeDeviceIds.length
        ? await db.select().from(gateIdentitySync).where(and(
          inArray(gateIdentitySync.identityId, ids),
          inArray(gateIdentitySync.deviceId, activeDeviceIds),
        ))
        : [];
      res.json({
        identities: identityRows.map((row) => ({ ...row, sync: syncRows.filter((sync) => sync.identityId === row.id) })),
        activeTerminalCount,
        pagination: { page, pageSize: query.pageSize, total: Number(total || 0), pageCount },
      });
    } catch (error) { fail(res, error); }
  });


  app.get("/api/access-control/sync-jobs", requireAuth, requirePermission("access_control.view"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const jobs = await db.select().from(gateSyncJobs).where(eq(gateSyncJobs.schoolId, scope.schoolId)).orderBy(desc(gateSyncJobs.createdAt)).limit(25);
      res.json({ jobs });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/access-control/sync-jobs/:id/items", requireAuth, requirePermission("access_control.view"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const jobId = Number(req.params.id);
      const [job] = await db.select({ id: gateSyncJobs.id }).from(gateSyncJobs).where(and(eq(gateSyncJobs.id, jobId), eq(gateSyncJobs.schoolId, scope.schoolId))).limit(1);
      if (!job) return res.status(404).json({ message: "Job not found" });
      const status = String(req.query.status || "all");
      const page = Math.max(1, Math.min(100_000, Number(req.query.page || 1)));
      const conditions = and(eq(gateSyncJobItems.jobId, jobId), ...(status === "all" ? [] : [eq(gateSyncJobItems.outcome, status)]));
      const [items, countRows] = await Promise.all([
        db.select().from(gateSyncJobItems).where(conditions).orderBy(asc(gateSyncJobItems.id)).limit(50).offset((page - 1) * 50),
        db.select({ count: sql<number>`count(*)::int` }).from(gateSyncJobItems).where(conditions),
      ]);
      res.json({ items, page, total: Number(countRows[0]?.count || 0) });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/sync-jobs/bulk-enroll", requireAuth, requirePermission("access_control.identities.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const input = z.object({ personType: z.enum(["student", "staff", "all"]).default("all") }).parse(req.body || {});
      const existing = await db.select().from(gateSyncJobs).where(and(
        eq(gateSyncJobs.schoolId, scope.schoolId),
        eq(gateSyncJobs.jobType, "bulk_enroll"),
        inArray(gateSyncJobs.status, ["pending", "running"]),
      )).orderBy(desc(gateSyncJobs.createdAt)).limit(1);
      if (existing.length) return res.status(409).json({ message: "A bulk Gate enrollment job is already running for this school", job: existing[0] });
      const totalItems = await gateSyncJobTotal(scope.schoolId, input.personType);
      const [job] = await db.insert(gateSyncJobs).values({
        organizationId: scope.organizationId,
        schoolId: scope.schoolId,
        jobType: "bulk_enroll",
        personType: input.personType,
        phase: input.personType === "staff" ? "staff" : "student",
        totalItems,
        requestedByUserId: scope.userId,
        details: { note: "Manually removed enrollments are preserved and skipped." },
      }).returning();
      res.status(202).json({ job });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/sync-jobs/reconcile", requireAuth, requirePermission("access_control.identities.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const existing = await db.select().from(gateSyncJobs).where(and(
        eq(gateSyncJobs.schoolId, scope.schoolId),
        eq(gateSyncJobs.jobType, "reconcile"),
        inArray(gateSyncJobs.status, ["pending", "running"]),
      )).orderBy(desc(gateSyncJobs.createdAt)).limit(1);
      if (existing.length) return res.status(409).json({ message: "An enrollment reconciliation job is already running for this school", job: existing[0] });
      const totalItems = (await db.select({ id: accessIdentities.id }).from(accessIdentities).where(eq(accessIdentities.schoolId, scope.schoolId))).length;
      const [job] = await db.insert(gateSyncJobs).values({
        organizationId: scope.organizationId,
        schoolId: scope.schoolId,
        jobType: "reconcile",
        personType: "all",
        totalItems,
        requestedByUserId: scope.userId,
        details: { automatic: false },
      }).returning();
      res.status(202).json({ job });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/identities/enroll", requireAuth, requirePermission("access_control.identities.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const input = z.object({ personType: z.enum(["student", "staff"]), personId: z.number().int().positive() }).parse(req.body);
      let identity;
      if (input.personType === "student") {
        const [student] = await db.select().from(students).where(and(eq(students.id, input.personId), eq(students.schoolId, scope.schoolId))).limit(1);
        if (!student) throw new Error("Student not found");
        if (!student.photo) throw new Error("The student does not have an FCGS profile photo to enroll");
        identity = await ensureIdentityForStudent(student, scope.organizationId, true);
      } else {
        const [person] = await db.select().from(staff).where(and(eq(staff.id, input.personId), eq(staff.schoolId, scope.schoolId))).limit(1);
        if (!person) throw new Error("Staff member not found");
        if (!person.photo) throw new Error("The staff member does not have an FCGS profile photo to enroll");
        identity = await ensureIdentityForStaff(person, scope.organizationId, true);
      }
      const commands = await queueIdentitySync(identity.id, scope.userId, "Enroll/update FCGS profile photo on face terminals");
      res.status(201).json({ identity, commandsQueued: commands.length });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/identities/:id/resync", requireAuth, requirePermission("access_control.identities.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); const [identity] = await db.select().from(accessIdentities).where(and(eq(accessIdentities.id, id), eq(accessIdentities.schoolId, scope.schoolId))).limit(1); if (!identity) throw new Error("Access identity not found"); const commands = await queueIdentitySync(id, scope.userId, "Manual access identity resynchronization"); res.json({ commandsQueued: commands.length }); } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/identities/:id/remove-enrollment", requireAuth, requirePermission("access_control.identities.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const id = Number(req.params.id);
      const input = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
      const [identity] = await db.select().from(accessIdentities).where(and(eq(accessIdentities.id, id), eq(accessIdentities.schoolId, scope.schoolId))).limit(1);
      if (!identity) throw new Error("Access identity not found");
      const [updated] = await db.update(accessIdentities).set({
        isActive: false,
        enrollmentRemovedAt: new Date(),
        enrollmentRemovalReason: input.reason,
        enrollmentRemovedByUserId: scope.userId,
        lastPolicyReason: `Enrollment removed: ${input.reason}`,
        lastPolicyEvaluatedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(accessIdentities.id, identity.id)).returning();
      const commands = await queueIdentitySync(identity.id, scope.userId, `Enrollment removed: ${input.reason}`);
      res.json({ identity: updated, commandsQueued: commands.length });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/identities/:id/restriction", requireAuth, requirePermission("access_control.identities.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const id = Number(req.params.id);
      const input = z.object({ restricted: z.boolean(), reason: z.string().trim().min(3).max(500) }).parse(req.body);
      const [identity] = await db.select().from(accessIdentities).where(and(eq(accessIdentities.id, id), eq(accessIdentities.schoolId, scope.schoolId))).limit(1);
      if (!identity) throw new Error("Access identity not found");
      await db.update(accessIdentities).set({
        manualRestrictionActive: input.restricted,
        manualRestrictionReason: input.restricted ? input.reason : null,
        manualRestrictedByUserId: input.restricted ? scope.userId : null,
        manualRestrictedAt: input.restricted ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(accessIdentities.id, identity.id));
      let refreshed;
      if (identity.personType === "student" && identity.studentId) refreshed = await syncStudentPolicy(identity.studentId, scope.userId, input.restricted ? `Manual restriction: ${input.reason}` : `Manual restriction removed: ${input.reason}`);
      else if (identity.personType === "staff" && identity.staffId) {
        const [person] = await db.select().from(staff).where(eq(staff.id, identity.staffId)).limit(1);
        if (person) {
          refreshed = await ensureIdentityForStaff(person, identity.organizationId);
          await queueIdentitySync(refreshed.id, scope.userId, input.restricted ? `Manual restriction: ${input.reason}` : `Manual restriction removed: ${input.reason}`);
        }
      }
      res.json({ identity: refreshed || identity });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/access-control/events", requireAuth, requirePermission("access_control.audit.view"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const rows = await db.select().from(accessEvents).where(eq(accessEvents.schoolId, scope.schoolId)).orderBy(desc(accessEvents.occurredAt)).limit(Math.min(1000, Math.max(1, Number(req.query.limit || 250))));
      const deviceIds = Array.from(new Set(rows.map((row) => row.deviceId)));
      const gateIds = Array.from(new Set(rows.map((row) => row.gateId).filter((id): id is number => !!id)));
      const identityIds = Array.from(new Set(rows.map((row) => row.identityId).filter((id): id is number => !!id)));
      const [deviceRows, gateRows, identityRows] = await Promise.all([
        deviceIds.length ? db.select().from(gateDevices).where(inArray(gateDevices.id, deviceIds)) : [],
        gateIds.length ? db.select().from(accessGates).where(inArray(accessGates.id, gateIds)) : [],
        identityIds.length ? db.select().from(accessIdentities).where(inArray(accessIdentities.id, identityIds)) : [],
      ]);
      const devicesById = new Map(deviceRows.map((row) => [row.id, row]));
      const gatesById = new Map(gateRows.map((row) => [row.id, row]));
      const identitiesById = new Map(identityRows.map((row) => [row.id, row]));
      res.json({ events: rows.map((row) => ({
        ...row,
        deviceName: devicesById.get(row.deviceId)?.name || null,
        gateName: row.gateId ? gatesById.get(row.gateId)?.name || null : null,
        personName: row.identityId ? identitiesById.get(row.identityId)?.displayName || null : null,
      })) });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/access-control/financial-overrides", requireAuth, requirePermission("access_control.financial_override.view"), async (req, res) => {
    try { const scope = await scopeOf(req); const rows = await db.select().from(financialAccessOverrides).where(eq(financialAccessOverrides.schoolId, scope.schoolId)).orderBy(desc(financialAccessOverrides.createdAt)); res.json({ overrides: rows }); } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/financial-overrides", requireAuth, requirePermission("access_control.financial_override.create"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const input = z.object({ studentId: z.number().int().positive(), reason: z.string().trim().min(3).max(500), effectiveFrom: z.coerce.date(), expiresAt: z.coerce.date() }).parse(req.body);
      if (input.expiresAt <= input.effectiveFrom) throw new Error("Override expiry must be after its effective start");
      const [student] = await db.select().from(students).where(and(eq(students.id, input.studentId), eq(students.schoolId, scope.schoolId))).limit(1);
      if (!student) throw new Error("Student not found");
      const [school] = await db.select().from(schools).where(eq(schools.id, scope.schoolId)).limit(1);
      const academicYear = school?.currentAcademicYear || String(new Date().getFullYear());
      const term = school?.currentTerm || "term1";
      const prior = await db.select({ id: financialAccessOverrides.id }).from(financialAccessOverrides).where(and(eq(financialAccessOverrides.studentId, student.id), eq(financialAccessOverrides.academicYear, academicYear), eq(financialAccessOverrides.term, term), sql`${financialAccessOverrides.status} IN ('active','expired','revoked','scheduled')`, sql`${financialAccessOverrides.activatedAt} IS NOT NULL OR ${financialAccessOverrides.effectiveFrom} <= now()`));
      if (prior.length >= 2) throw new Error("Maximum two activated financial access overrides are allowed per student per academic term");
      const now = new Date();
      const status = input.effectiveFrom <= now && input.expiresAt > now ? "active" : "scheduled";
      const [row] = await db.insert(financialAccessOverrides).values({ organizationId: scope.organizationId, schoolId: scope.schoolId, studentId: student.id, academicYear, term, reason: input.reason, effectiveFrom: input.effectiveFrom, expiresAt: input.expiresAt, status, activatedAt: status === "active" ? now : null, grantedByUserId: scope.userId }).returning();
      if (status === "active") await syncStudentPolicy(student.id, scope.userId, `Financial override #${row.id} activated`);
      res.status(201).json(row);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/financial-overrides/:id/revoke", requireAuth, requirePermission("access_control.financial_override.revoke"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); const input = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body); const [row] = await db.select().from(financialAccessOverrides).where(and(eq(financialAccessOverrides.id, id), eq(financialAccessOverrides.schoolId, scope.schoolId))).limit(1); if (!row) throw new Error("Financial access override not found"); const [updated] = await db.update(financialAccessOverrides).set({ status: "revoked", revokedByUserId: scope.userId, revokedAt: new Date(), revocationReason: input.reason, updatedAt: new Date() }).where(eq(financialAccessOverrides.id, id)).returning(); await syncStudentPolicy(row.studentId, scope.userId, `Financial override #${row.id} revoked`); res.json(updated); } catch (error) { fail(res, error); }
  });

  app.get("/api/access-control/early-releases", requireAuth, requirePermission("access_control.early_release.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const rows = await db.select().from(studentEarlyReleaseAuthorizations).where(eq(studentEarlyReleaseAuthorizations.schoolId, scope.schoolId)).orderBy(desc(studentEarlyReleaseAuthorizations.createdAt)); res.json({ authorizations: rows }); } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/early-releases", requireAuth, requirePermission("access_control.early_release.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const input = z.object({ studentId: z.number().int().positive(), releaseType: z.enum(["early_dismissal", "temporary_off_campus"]), validFrom: z.coerce.date(), validUntil: z.coerce.date(), returnExpected: z.boolean().optional(), reason: z.string().trim().min(3).max(500) }).parse(req.body);
      if (input.validUntil <= input.validFrom) throw new Error("Early release end must be after its start");
      const [student] = await db.select().from(students).where(and(eq(students.id, input.studentId), eq(students.schoolId, scope.schoolId))).limit(1); if (!student) throw new Error("Student not found");
      const now = new Date(); const status = input.validFrom <= now && input.validUntil > now ? "active" : "scheduled";
      const [row] = await db.insert(studentEarlyReleaseAuthorizations).values({ organizationId: scope.organizationId, schoolId: scope.schoolId, studentId: input.studentId, releaseType: input.releaseType, validFrom: input.validFrom, validUntil: input.validUntil, returnExpected: input.returnExpected ?? input.releaseType === "temporary_off_campus", reason: input.reason, status, approvedByUserId: scope.userId }).returning();
      if (status === "active") await syncStudentPolicy(student.id, scope.userId, `Student early release #${row.id} activated`);
      res.status(201).json(row);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/early-releases/:id/revoke", requireAuth, requirePermission("access_control.early_release.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); const [row] = await db.select().from(studentEarlyReleaseAuthorizations).where(and(eq(studentEarlyReleaseAuthorizations.id, id), eq(studentEarlyReleaseAuthorizations.schoolId, scope.schoolId))).limit(1); if (!row) throw new Error("Early release authorization not found"); const [updated] = await db.update(studentEarlyReleaseAuthorizations).set({ status: "revoked", revokedByUserId: scope.userId, revokedAt: new Date(), updatedAt: new Date() }).where(eq(studentEarlyReleaseAuthorizations.id, id)).returning(); await syncStudentPolicy(row.studentId, scope.userId, `Student early release #${row.id} revoked`); res.json(updated); } catch (error) { fail(res, error); }
  });

  app.get("/api/access-control/staff-departure-approvals", requireAuth, requirePermission("access_control.staff_departure.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const rows = await db.select().from(staffEarlyDepartureApprovals).where(eq(staffEarlyDepartureApprovals.schoolId, scope.schoolId)).orderBy(desc(staffEarlyDepartureApprovals.createdAt)); res.json({ approvals: rows }); } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/staff-departure-approvals", requireAuth, requirePermission("access_control.staff_departure.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ staffId: z.number().int().positive(), attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), allowedFrom: z.coerce.date(), validUntil: z.coerce.date().optional().nullable(), returnExpected: z.boolean().default(false), reason: z.string().trim().min(3).max(500) }).parse(req.body); const [person] = await db.select().from(staff).where(and(eq(staff.id, input.staffId), eq(staff.schoolId, scope.schoolId))).limit(1); if (!person) throw new Error("Staff member not found"); const [row] = await db.insert(staffEarlyDepartureApprovals).values({ organizationId: scope.organizationId, schoolId: scope.schoolId, ...input, status: "active", approvedByUserId: scope.userId }).returning(); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.get("/api/access-control/message-templates", requireAuth, requirePermission("settings.view"), async (req, res) => {
    try {
      const scope = await organizationScopeOf(req);
      res.json({ templates: await ensureOrganizationMessageTemplates(scope.organizationId), placeholders: MESSAGE_TEMPLATE_PLACEHOLDERS });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/message-templates/preview", requireAuth, requirePermission("settings.view"), async (req, res) => {
    try {
      await organizationScopeOf(req);
      const input = z.object({ smsTemplate: z.string().max(4000).default(""), emailSubjectTemplate: z.string().max(500).nullable().optional(), emailBodyTemplate: z.string().max(10000).nullable().optional() }).parse(req.body || {});
      const unsupported = unsupportedTemplatePlaceholders(input.smsTemplate, input.emailSubjectTemplate, input.emailBodyTemplate);
      res.json({
        unsupportedPlaceholders: unsupported,
        preview: {
          sms: renderTemplate(input.smsTemplate, MESSAGE_TEMPLATE_PREVIEW_VALUES),
          emailSubject: renderTemplate(input.emailSubjectTemplate || "FCGS Attendance Notification", MESSAGE_TEMPLATE_PREVIEW_VALUES),
          emailBody: renderTemplate(input.emailBodyTemplate || input.smsTemplate, MESSAGE_TEMPLATE_PREVIEW_VALUES),
        },
      });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/access-control/message-templates/:key/history", requireAuth, requirePermission("settings.view"), async (req, res) => {
    try {
      const scope = await organizationScopeOf(req);
      const key = String(req.params.key);
      const history = await db.select().from(organizationAttendanceMessageTemplateVersions).where(and(eq(organizationAttendanceMessageTemplateVersions.organizationId, scope.organizationId), eq(organizationAttendanceMessageTemplateVersions.templateKey, key))).orderBy(desc(organizationAttendanceMessageTemplateVersions.createdAt));
      res.json({ history });
    } catch (error) { fail(res, error); }
  });

  app.put("/api/access-control/message-templates/:key", requireAuth, requirePermission("settings.edit"), async (req, res) => {
    try {
      const scope = await organizationScopeOf(req);
      const key = String(req.params.key);
      const input = z.object({ smsTemplate: z.string().min(1).max(4000), emailSubjectTemplate: z.string().max(500).nullable().optional(), emailBodyTemplate: z.string().max(10000).nullable().optional() }).parse(req.body);
      const unsupported = unsupportedTemplatePlaceholders(input.smsTemplate, input.emailSubjectTemplate, input.emailBodyTemplate);
      if (unsupported.length) throw new Error(`Unsupported template placeholder${unsupported.length > 1 ? "s" : ""}: ${unsupported.map((key) => `{{${key}}}`).join(", ")}`);
      await ensureOrganizationMessageTemplates(scope.organizationId);
      const [before] = await db.select().from(organizationAttendanceMessageTemplates).where(and(eq(organizationAttendanceMessageTemplates.organizationId, scope.organizationId), eq(organizationAttendanceMessageTemplates.templateKey, key))).limit(1);
      if (!before) throw new Error("Attendance message template not found");
      const nextBody = input.emailBodyTemplate || input.smsTemplate;
      const [row] = await db.transaction(async (tx) => {
        const [updated] = await tx.update(organizationAttendanceMessageTemplates).set({ ...input, emailBodyTemplate: nextBody, isDefaultCustomized: true, updatedByUserId: scope.userId, updatedAt: new Date() }).where(eq(organizationAttendanceMessageTemplates.id, before.id)).returning();
        await tx.insert(organizationAttendanceMessageTemplateVersions).values({
          templateId: before.id, organizationId: scope.organizationId, templateKey: key, action: "updated",
          previousSmsTemplate: before.smsTemplate, previousEmailSubjectTemplate: before.emailSubjectTemplate, previousEmailBodyTemplate: before.emailBodyTemplate,
          newSmsTemplate: updated.smsTemplate, newEmailSubjectTemplate: updated.emailSubjectTemplate, newEmailBodyTemplate: updated.emailBodyTemplate,
          changedByUserId: scope.userId,
        });
        return [updated];
      });
      res.json(row);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/message-templates/:key/restore-default", requireAuth, requirePermission("settings.edit"), async (req, res) => {
    try {
      const scope = await organizationScopeOf(req);
      const key = String(req.params.key);
      const def = DEFAULT_TEMPLATE_MAP[key]; if (!def) throw new Error("Default template not found");
      await ensureOrganizationMessageTemplates(scope.organizationId);
      const [before] = await db.select().from(organizationAttendanceMessageTemplates).where(and(eq(organizationAttendanceMessageTemplates.organizationId, scope.organizationId), eq(organizationAttendanceMessageTemplates.templateKey, key))).limit(1);
      if (!before) throw new Error("Attendance message template not found");
      const [row] = await db.transaction(async (tx) => {
        const [updated] = await tx.update(organizationAttendanceMessageTemplates).set({ smsTemplate: def.sms, emailSubjectTemplate: def.subject, emailBodyTemplate: def.sms, isDefaultCustomized: false, updatedByUserId: scope.userId, updatedAt: new Date() }).where(eq(organizationAttendanceMessageTemplates.id, before.id)).returning();
        await tx.insert(organizationAttendanceMessageTemplateVersions).values({
          templateId: before.id, organizationId: scope.organizationId, templateKey: key, action: "restored_default",
          previousSmsTemplate: before.smsTemplate, previousEmailSubjectTemplate: before.emailSubjectTemplate, previousEmailBodyTemplate: before.emailBodyTemplate,
          newSmsTemplate: updated.smsTemplate, newEmailSubjectTemplate: updated.emailSubjectTemplate, newEmailBodyTemplate: updated.emailBodyTemplate,
          changedByUserId: scope.userId,
        });
        return [updated];
      });
      res.json(row);
    } catch (error) { fail(res, error); }
  });

  app.get("/api/access-control/attendance/:id/gate-corrections", requireAuth, requirePermission("access_control.audit.view"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const id = Number(req.params.id);
      const [record] = await db.select().from(attendanceRecords).where(eq(attendanceRecords.id, id)).limit(1);
      if (!record) throw new Error("Attendance record not found");
      const [student] = await db.select().from(students).where(and(eq(students.id, record.studentId), eq(students.schoolId, scope.schoolId))).limit(1);
      if (!student) throw new Error("Attendance record is outside your school context");
      const rows = await db.select().from(attendanceGateEvidenceCorrections).where(eq(attendanceGateEvidenceCorrections.attendanceRecordId, id)).orderBy(desc(attendanceGateEvidenceCorrections.createdAt));
      const userIds = Array.from(new Set(rows.map((row) => row.correctedByUserId)));
      const actorRows = userIds.length ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(inArray(users.id, userIds)) : [];
      const actors = new Map(actorRows.map((row) => [row.id, row]));
      res.json({ corrections: rows.map((row) => ({ ...row, correctedBy: actors.get(row.correctedByUserId) || null })) });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/attendance/:id/correct-gate-evidence", requireAuth, requirePermission("access_control.attendance_correction"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const id = Number(req.params.id);
      const input = z.object({ status: z.enum(["present","absent","sick","fees","suspended","absconding","excused","late"]), reason: z.string().trim().min(3).max(500) }).parse(req.body);
      const [record] = await db.select().from(attendanceRecords).where(eq(attendanceRecords.id, id)).limit(1);
      if (!record) throw new Error("Attendance record not found");
      const [student] = await db.select().from(students).where(and(eq(students.id, record.studentId), eq(students.schoolId, scope.schoolId))).limit(1);
      if (!student) throw new Error("Attendance record is outside your school context");
      const now = new Date();
      await db.insert(attendanceGateEvidenceCorrections).values({
        attendanceRecordId: record.id,
        schoolId: scope.schoolId,
        studentId: record.studentId,
        previousStatus: record.status,
        newStatus: input.status,
        previousReason: record.reason,
        correctionReason: input.reason,
        previousSource: record.source,
        correctedByUserId: scope.userId,
        createdAt: now,
      });
      const [updated] = await db.update(attendanceRecords).set({
        status: input.status as any,
        reason: input.reason,
        gateEvidenceLocked: true,
        gateCorrectionReason: input.reason,
        gateCorrectedByUserId: scope.userId,
        gateCorrectedAt: now,
        source: "gate_corrected",
      }).where(eq(attendanceRecords.id, id)).returning();
      const [correctedBy] = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(eq(users.id, scope.userId)).limit(1);
      res.json({ ...updated, correctedBy: correctedBy || null });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/gate-bridge/recognition-events", async (req, res) => {
    const bridge = await bridgeFromRequest(req, res); if (!bridge) return;
    try { const input = z.object({ events: z.array(z.object({ deviceKey: z.string().uuid(), record: z.record(z.any()), receivedAt: z.string().optional().nullable() })).min(1).max(100) }).parse(req.body); const results = []; for (const event of input.events) results.push(await processRecognition(bridge, event)); res.json({ message: "Success", result: 0, results }); } catch (error) { fail(res, error); }
  });
}

export async function runAccessControlSchedulers() {
  const now = new Date();
  // Build 2 production operations: durable retries and incremental enrollment reconciliation.
  await processIdentityRetryQueue(now).catch((error) => console.error("Gate identity retry scheduler error:", error));
  await ensureAutomaticReconciliationJobs(now).catch((error) => console.error("Gate reconciliation scheduler error:", error));
  await processGateSyncJobs().catch((error) => console.error("Gate synchronization job error:", error));
  // Scheduler fix #1: activate future overrides and expire active/scheduled ones without portal interaction.
  const scheduledOverrides = await db.select().from(financialAccessOverrides).where(and(eq(financialAccessOverrides.status, "scheduled"), lte(financialAccessOverrides.effectiveFrom, now), gtDate(financialAccessOverrides.expiresAt, now)));
  for (const row of scheduledOverrides) {
    const previouslyActivated = await db.select({ id: financialAccessOverrides.id }).from(financialAccessOverrides).where(and(
      eq(financialAccessOverrides.studentId, row.studentId),
      eq(financialAccessOverrides.academicYear, row.academicYear),
      eq(financialAccessOverrides.term, row.term),
      sql`${financialAccessOverrides.id} <> ${row.id}`,
      sql`${financialAccessOverrides.activatedAt} IS NOT NULL`,
    ));
    if (previouslyActivated.length >= 2) {
      await db.update(financialAccessOverrides).set({
        status: "blocked",
        revocationReason: "Activation blocked automatically because the two-activated-overrides term limit has already been reached",
        updatedAt: now,
      }).where(eq(financialAccessOverrides.id, row.id));
      continue;
    }
    await db.update(financialAccessOverrides).set({ status: "active", activatedAt: row.activatedAt || now, updatedAt: now }).where(eq(financialAccessOverrides.id, row.id));
    await syncStudentPolicy(row.studentId, null, `Scheduled financial override #${row.id} activated`).catch(() => undefined);
  }
  const expiredOverrides = await db.select().from(financialAccessOverrides).where(and(inArray(financialAccessOverrides.status, ["active", "scheduled"]), lte(financialAccessOverrides.expiresAt, now)));
  for (const row of expiredOverrides) {
    await db.update(financialAccessOverrides).set({ status: "expired", updatedAt: now }).where(eq(financialAccessOverrides.id, row.id));
    await syncStudentPolicy(row.studentId, null, `Financial override #${row.id} expired`).catch(() => undefined);
  }

  // Scheduler fix #2: early-release windows automatically activate and restore normal exit restriction on expiry.
  const scheduledReleases = await db.select().from(studentEarlyReleaseAuthorizations).where(and(eq(studentEarlyReleaseAuthorizations.status, "scheduled"), lte(studentEarlyReleaseAuthorizations.validFrom, now), gtDate(studentEarlyReleaseAuthorizations.validUntil, now)));
  for (const row of scheduledReleases) {
    await db.update(studentEarlyReleaseAuthorizations).set({ status: "active", updatedAt: now }).where(eq(studentEarlyReleaseAuthorizations.id, row.id));
    await syncStudentPolicy(row.studentId, null, `Student early release #${row.id} activated`).catch(() => undefined);
  }
  const expiredReleases = await db.select().from(studentEarlyReleaseAuthorizations).where(and(inArray(studentEarlyReleaseAuthorizations.status, ["active", "scheduled"]), lte(studentEarlyReleaseAuthorizations.validUntil, now)));
  for (const row of expiredReleases) {
    await db.update(studentEarlyReleaseAuthorizations).set({ status: "expired", updatedAt: now }).where(eq(studentEarlyReleaseAuthorizations.id, row.id));
    await syncStudentPolicy(row.studentId, null, `Student early release #${row.id} expired`).catch(() => undefined);
  }

  // Financial status is intentionally fail-open when its snapshot ages beyond
  // 36 hours. Re-synchronise only identities whose currently stored terminal
  // policy is still a financial denial; once refreshed they become allow and
  // will not be queued again on every scheduler pass.
  const staleCutoff = new Date(now.getTime() - FINANCIAL_STALE_MS);
  const staleFinanciallyDenied = await db.select({
    identityId: accessIdentities.id,
    studentId: accessIdentities.studentId,
    feesSnapshotAt: students.feesSnapshotAt,
    manualRestrictionActive: accessIdentities.manualRestrictionActive,
  }).from(accessIdentities).innerJoin(students, eq(students.id, accessIdentities.studentId)).where(and(
    eq(accessIdentities.personType, "student"),
    eq(accessIdentities.isActive, true),
    eq(accessIdentities.desiredEntryAccess, "deny"),
    eq(accessIdentities.manualRestrictionActive, false),
    or(isNull(students.feesSnapshotAt), lt(students.feesSnapshotAt, staleCutoff)),
  ));
  for (const row of staleFinanciallyDenied) {
    if (row.studentId) await syncStudentPolicy(row.studentId, null, "Financial snapshot exceeded 36 hours; fail-open policy refresh").catch(() => undefined);
  }

  // Morning reconciliation: confirmed fees denial + no successful entry by configured time => Fees + notify parent once.
  const parts = localParts(now);
  const activeSchools = await db.select().from(schools).where(eq(schools.enableAccessControl, true));
  for (const school of activeSchools) {
    const schedules = await ensureSchedules(school.id);
    const schedule = schedules.find(s => s.dayOfWeek === parts.dayOfWeek);
    if (!schedule?.isSchoolDay || parts.time < schedule.reconciliationTime || !(await isAcademicOpenDay(school.id, parts.date))) continue;
    const dayStart = new Date(`${parts.date}T00:00:00+02:00`);
    const dayEnd = new Date(`${parts.date}T23:59:59+02:00`);
    const denied = await db.select().from(accessEvents).where(and(eq(accessEvents.schoolId, school.id), eq(accessEvents.direction, "entry"), eq(accessEvents.accessDecision, "denied"), eq(accessEvents.decisionReason, "Financial restriction"), gte(accessEvents.occurredAt, dayStart), lte(accessEvents.occurredAt, dayEnd)));
    const studentIds = Array.from(new Set(denied.map(e => e.studentId).filter((id): id is number => !!id)));
    for (const studentId of studentIds) {
      const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1); if (!student?.classId) continue;
      const allowedLater = await db.select({ id: accessEvents.id }).from(accessEvents).where(and(eq(accessEvents.studentId, student.id), eq(accessEvents.direction, "entry"), eq(accessEvents.accessDecision, "allowed"), gte(accessEvents.occurredAt, dayStart), lte(accessEvents.occurredAt, dayEnd))).limit(1);
      if (allowedLater.length) continue;
      const firstDenied = denied.filter(e => e.studentId === student.id).sort((a,b) => +new Date(a.occurredAt) - +new Date(b.occurredAt))[0];
      let [record] = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.studentId, student.id), eq(attendanceRecords.classId, student.classId), eq(attendanceRecords.date, parts.date))).limit(1);
      if (record?.gateEvidenceLocked && ["present", "late"].includes(record.status)) continue;
      if (!record) {
        [record] = await db.insert(attendanceRecords).values({ studentId: student.id, classId: student.classId, date: parts.date, status: "fees", reason: "Fees", source: "gate_reconciliation", firstGateArrivalAt: firstDenied.occurredAt, reconciliationAt: now, notifiedStatus: "fees", notifiedReason: "Fees" }).returning();
        await sendAttendanceTemplate(student.id, "fees_denial_reconciliation", record, null).catch(() => undefined);
      } else if (record.status !== "fees" || record.notifiedStatus !== "fees") {
        [record] = await db.update(attendanceRecords).set({ status: "fees", reason: "Fees", source: record.source === "teacher" ? "teacher+gate_reconciliation" : "gate_reconciliation", firstGateArrivalAt: record.firstGateArrivalAt || firstDenied.occurredAt, reconciliationAt: now, notifiedStatus: "fees", notifiedReason: "Fees" }).where(eq(attendanceRecords.id, record.id)).returning();
        await sendAttendanceTemplate(student.id, "fees_denial_reconciliation", record, null).catch(() => undefined);
      }
    }
  }

  // Staff day-end reconciliation. Never fabricate a 23:59 departure. The scheduler also
  // catches up prior open days after a restart, while today's row is only reconciled at 23:59.
  const openLogs = await db.select().from(staffAttendanceLogs).where(and(
    lte(staffAttendanceLogs.date, parts.date),
    isNull(staffAttendanceLogs.clockOut),
  ));
  for (const log of openLogs) {
    const isPriorDay = log.date < parts.date;
    if (!isPriorDay && parts.time < "23:59") continue;
    if (log.currentlyOnCampus === false && log.lastGateExitAt) {
      const schedule = await getSchoolDaySchedule(log.schoolId, new Date(`${log.date}T12:00:00+02:00`));
      const exit = new Date(log.lastGateExitAt);
      const exitParts = localParts(exit);
      const early = exitParts.minutes < parseHm(schedule.staffEndTime);
      let approved = false;
      if (early) {
        const approval = await db.select({ id: staffEarlyDepartureApprovals.id }).from(staffEarlyDepartureApprovals).where(and(
          eq(staffEarlyDepartureApprovals.staffId, log.staffId),
          eq(staffEarlyDepartureApprovals.attendanceDate, log.date),
          eq(staffEarlyDepartureApprovals.status, "active"),
          lte(staffEarlyDepartureApprovals.allowedFrom, exit),
          or(isNull(staffEarlyDepartureApprovals.validUntil), gte(staffEarlyDepartureApprovals.validUntil, exit)),
        )).limit(1);
        approved = approval.length > 0;
      }
      await db.update(staffAttendanceLogs).set({
        clockOut: exit,
        autoClockedOut: false,
        reasonRequired: early && !approved,
        reasonType: early && !approved ? "early_clock_out" : log.reasonType,
        missingClockOut: false,
      }).where(eq(staffAttendanceLogs.id, log.id));
    } else if (log.currentlyOnCampus !== false && !log.missingClockOut) {
      await db.update(staffAttendanceLogs).set({ missingClockOut: true }).where(eq(staffAttendanceLogs.id, log.id));
    }
  }
}
