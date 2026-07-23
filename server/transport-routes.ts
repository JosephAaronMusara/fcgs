import type { Express, Request, Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { z } from "zod";
import { db } from "./db";
import { requireAuth, requireAnyPermission, requirePermission } from "./auth";
import { storage } from "./storage";
import { createInAppNotifications } from "./communication";
import { renderHtmlPdf, reportPdfFilename } from "./pdf-renderer";
import {
  classes,
  schools,
  staff,
  students,
  transportAccountAdjustments,
  transportAdvances,
  transportAssignments,
  transportAssignmentEvents,
  transportAuditEvents,
  transportCashupPayments,
  transportCashups,
  transportCharges,
  transportClaimAllocations,
  transportClaimDeductions,
  transportClaims,
  transportDrivers,
  transportIncidents,
  transportOwners,
  transportPathNodeLearners,
  transportPathNodes,
  transportPaymentAllocations,
  transportPaymentPlanInstalments,
  transportPaymentPlans,
  transportProviderAdjustments,
  transportPayments,
  transportPenalties,
  transportPeriodLocks,
  transportPickupPoints,
  transportPayouts,
  transportReceiptEvents,
  transportRefunds,
  transportRoutes,
  transportServicePoints,
  transportSettings,
  transportSubscriptionRules,
  transportVehicleDriverHistory,
  transportVehicleOwnerHistory,
  transportVehiclePaths,
  transportVehicles,
} from "@shared/schema";

type AuthedUser = {
  id: number;
  role?: string;
  schoolId?: number | null;
  organizationId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
};

type SchoolRow = typeof schools.$inferSelect;

type DbLike = typeof db;

const userOf = (req: Request) => (req.user as AuthedUser | undefined) ?? null;
const money = z.coerce.number().finite().min(0);
const positiveMoney = z.coerce.number().finite().positive();
const nullablePositiveInt = z.coerce.number().int().positive().optional().nullable();
const optionalText = z.string().trim().optional().nullable();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthInput = z.coerce.number().int().min(1).max(12);

const routeInput = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  direction: z.enum(["pickup", "dropoff", "both"]).default("both"),
  defaultFee: money.default(0),
  billingFrequency: z.literal("monthly").default("monthly"),
  departureTime: optionalText,
  arrivalTime: optionalText,
  notes: optionalText,
  status: z.enum(["draft", "pending_approval", "active", "suspended", "retired"]).default("active"),
  isActive: z.boolean().optional().default(true),
});

const pointInput = z.object({
  routeId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1),
  stopOrder: z.coerce.number().int().positive().default(1),
  pickupTime: optionalText,
  dropoffTime: optionalText,
  feeOverride: money.optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  notes: optionalText,
});

const ownerInput = z.object({
  name: z.string().trim().min(1),
  ownerType: z.enum(["individual", "company"]).default("individual"),
  contactPerson: optionalText,
  phone: optionalText,
  nationalIdOrRegistration: optionalText,
  paymentDetails: optionalText,
  effectiveFrom: dateString.optional().nullable(),
  effectiveTo: dateString.optional().nullable(),
  notes: optionalText,
  isActive: z.boolean().optional().default(true),
});

const driverInput = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: optionalText,
  nationalId: optionalText,
  licenceNumber: optionalText,
  licenceExpiry: dateString.optional().nullable(),
  engagementType: z.enum(["internal", "external"]).default("internal"),
  effectiveFrom: dateString.optional().nullable(),
  effectiveTo: dateString.optional().nullable(),
  notes: optionalText,
  isActive: z.boolean().optional().default(true),
});

const vehicleInput = z.object({
  registrationNumber: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  makeModel: optionalText,
  capacity: z.coerce.number().int().positive(),
  ownershipType: z.enum(["school", "staff", "contracted"]).default("school"),
  ownerId: nullablePositiveInt,
  driverId: nullablePositiveInt,
  insuranceExpiry: dateString.optional().nullable(),
  fitnessExpiry: dateString.optional().nullable(),
  status: z.enum(["draft", "active", "suspended", "retired"]).default("active"),
  notes: optionalText,
  isActive: z.boolean().optional().default(true),
  effectiveDate: dateString.optional(),
  changeReason: optionalText,
});

const servicePointInput = z.object({
  studentId: z.coerce.number().int().positive(),
  pointType: z.enum(["pickup", "dropoff", "both"]).default("both"),
  name: z.string().trim().min(1),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  address: optionalText,
  landmark: optionalText,
  instructions: optionalText,
  privacyClass: z.enum(["private_household", "shared_household", "public_common"]).default("private_household"),
  isTemporary: z.boolean().optional().default(false),
  effectiveFrom: dateString,
  effectiveTo: dateString.optional().nullable(),
});

const pathNodeInput = z.object({
  id: z.coerce.number().int().positive().optional(),
  nodeType: z.enum(["start", "learner_stop", "checkpoint", "destination"]),
  name: z.string().trim().min(1),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  stopOrder: z.coerce.number().int().min(1),
  expectedTime: optionalText,
  checkpointRadiusMeters: z.coerce.number().int().positive().optional().nullable(),
  notes: optionalText,
  learnerLinks: z.array(z.object({
    assignmentId: z.coerce.number().int().positive(),
    servicePointId: z.coerce.number().int().positive(),
    boardsHere: z.boolean().default(false),
    alightsHere: z.boolean().default(false),
    effectiveFrom: dateString,
    effectiveTo: dateString.optional().nullable(),
  })).optional().default([]),
});

const pathInput = z.object({
  routeId: z.coerce.number().int().positive(),
  vehicleId: z.coerce.number().int().positive(),
  direction: z.enum(["pickup", "dropoff"]),
  name: z.string().trim().min(1),
  effectiveFrom: dateString,
  effectiveTo: dateString.optional().nullable(),
  estimatedDistanceKm: money.optional().nullable(),
  estimatedDurationMinutes: z.coerce.number().int().min(0).optional().nullable(),
  geometry: z.any().optional().nullable(),
  notes: optionalText,
  nodes: z.array(pathNodeInput).min(2),
});

const assignmentInput = z.object({
  studentId: z.coerce.number().int().positive(),
  routeId: z.coerce.number().int().positive(),
  vehicleId: nullablePositiveInt,
  outboundVehicleId: nullablePositiveInt,
  driverId: nullablePositiveInt,
  inboundPathId: nullablePositiveInt,
  outboundPathId: nullablePositiveInt,
  pickupServicePointId: nullablePositiveInt,
  dropoffServicePointId: nullablePositiveInt,
  pickupPathNodeId: nullablePositiveInt,
  dropoffPathNodeId: nullablePositiveInt,
  serviceType: z.enum(["pickup", "dropoff", "both"]).default("both"),
  serviceState: z.enum(["pending_start", "active", "active_arrears", "active_payment_plan", "suspension_pending", "suspended", "paused", "terminated", "completed"]).default("pending_start"),
  planningStatus: z.enum(["pending_path_assignment", "provisionally_assigned", "assigned_to_path", "path_confirmed"]).default("pending_path_assignment"),
  financialStatus: z.enum(["pending_first_payment", "paid", "partially_paid", "overdue", "payment_plan", "credit"]).default("pending_first_payment"),
  baseMonthlyFee: money,
  agreedFee: money,
  startDate: dateString,
  endDate: dateString.optional().nullable(),
  notes: optionalText,
  capacityOverrideReason: optionalText,
});

const transferInput = assignmentInput.partial().extend({
  effectiveDate: dateString,
  reason: z.string().trim().min(3),
  transferType: z.enum(["vehicle", "stop", "path", "route", "service_type", "temporary", "permanent"]).default("permanent"),
});

const stateInput = z.object({
  state: z.enum(["active", "active_arrears", "active_payment_plan", "suspension_pending", "suspended", "paused", "terminated", "completed"]),
  effectiveDate: dateString,
  reason: z.string().trim().min(3),
  refundMethod: z.enum(["credit", "cash", "bank_transfer", "mobile_money", "original_method"]).optional(),
});

const chargeInput = z.object({
  academicYear: z.coerce.number().int().min(2020),
  term: z.string().min(1),
  month: monthInput,
  dueDate: dateString.optional().nullable(),
  assignmentIds: z.array(z.coerce.number().int().positive()).optional(),
  description: optionalText,
});

const paymentInput = z.object({
  studentId: z.coerce.number().int().positive(),
  amount: positiveMoney,
  paymentDate: dateString,
  paymentMethod: z.enum(["cash", "bank_transfer", "mobile_money", "card", "cheque", "other"]),
  academicYear: z.coerce.number().int().min(2020),
  term: z.string().min(1),
  month: z.coerce.number().int().min(0).max(12).default(0),
  externalReference: optionalText,
  notes: optionalText,
  allocationMode: z.enum(["oldest_first", "specific", "future_credit"]).default("oldest_first"),
  chargeIds: z.array(z.coerce.number().int().positive()).optional(),
});

const paymentPlanInput = z.object({
  studentId: z.coerce.number().int().positive(),
  assignmentId: z.coerce.number().int().positive(),
  coveredAmount: positiveMoney,
  instalmentAmount: positiveMoney,
  frequency: z.enum(["weekly", "fortnightly", "monthly", "custom"]),
  startDate: dateString,
  finalDueDate: dateString.optional().nullable(),
  graceDays: z.coerce.number().int().min(0).default(0),
  payerAcknowledgement: optionalText,
  notes: optionalText,
  instalments: z.array(z.object({ dueDate: dateString, amount: positiveMoney })).optional(),
});

const refundInput = z.object({
  studentId: z.coerce.number().int().positive(),
  assignmentId: nullablePositiveInt,
  refundType: z.enum(["pause_credit", "termination_refund", "overpayment", "manual_adjustment"]),
  amount: positiveMoney,
  effectiveDate: dateString,
  method: z.enum(["credit", "cash", "bank_transfer", "mobile_money", "original_method"]),
  reason: z.string().trim().min(3),
  calculationSnapshot: z.any().optional(),
});

const cashupInput = z.object({
  cashupDate: dateString,
  paymentIds: z.array(z.coerce.number().int().positive()).min(1),
  actualCash: money,
  actualNonCash: money,
  depositReference: optionalText,
  notes: optionalText,
});

const subscriptionInput = z.object({
  vehicleId: nullablePositiveInt,
  ruleType: z.enum(["fixed", "percentage", "percentage_with_limits"]),
  value: positiveMoney,
  minimumAmount: money.optional().nullable(),
  maximumAmount: money.optional().nullable(),
  effectiveFrom: dateString,
  effectiveTo: dateString.optional().nullable(),
  notes: optionalText,
});

const penaltyInput = z.object({
  vehicleId: z.coerce.number().int().positive(),
  ownerId: nullablePositiveInt,
  category: z.string().trim().min(1),
  incidentDate: dateString,
  amount: positiveMoney,
  reason: z.string().trim().min(3),
  effectiveYear: z.coerce.number().int().min(2020),
  effectiveMonth: monthInput,
});

const advanceInput = z.object({
  vehicleId: z.coerce.number().int().positive(),
  ownerId: nullablePositiveInt,
  amount: positiveMoney,
  purpose: z.string().trim().min(3),
  requestDate: dateString,
  disbursementDate: dateString.optional().nullable(),
  disbursementReference: optionalText,
  recoveryMethod: z.enum(["fixed_instalment", "percentage", "full_available", "manual_schedule"]),
  recoveryValue: positiveMoney,
  recoveryStartYear: z.coerce.number().int().min(2020),
  recoveryStartMonth: monthInput,
  minimumOwnerTakeHome: money.default(0),
  maximumMonthlyRecovery: money.optional().nullable(),
});

const incidentInput = z.object({
  vehicleId: z.coerce.number().int().positive(),
  driverId: nullablePositiveInt,
  routeId: nullablePositiveInt,
  pathId: nullablePositiveInt,
  incidentType: z.string().trim().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  occurredAt: z.string().min(1),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  description: z.string().trim().min(3),
  resolution: optionalText,
  affectedStudentIds: z.array(z.coerce.number().int().positive()).optional().default([]),
});

const claimInput = z.object({
  vehicleId: z.coerce.number().int().positive(),
  serviceYear: z.coerce.number().int().min(2020),
  serviceMonth: monthInput,
  notes: optionalText,
});

const payoutPaymentInput = z.object({
  paymentDate: dateString,
  paymentMethod: z.string().trim().min(1),
  paymentReference: z.string().trim().min(1),
  amount: positiveMoney.optional(),
});

const settingsInput = z.object({
  transportManagerStaffId: nullablePositiveInt,
  stopGroupingDistanceMeters: z.coerce.number().int().min(1).max(500),
  inboundOneWayPercent: z.coerce.number().min(0).max(100),
  outboundOneWayPercent: z.coerce.number().min(0).max(100),
  joiningFullChargeThroughDay: z.coerce.number().int().min(0).max(31),
  refundNoCreditRemainingDays: z.coerce.number().int().min(0).max(31),
  pendingSeatReservationEnabled: z.boolean(),
  pendingSeatReservationDays: z.coerce.number().int().min(0).max(365),
  overdueWarningDays: z.coerce.number().int().min(0).max(365),
  suspensionEligibilityDays: z.coerce.number().int().min(0).max(365),
  suspensionNoticeDays: z.coerce.number().int().min(0).max(365),
  minimumSuspensionBalance: money,
  paymentPlanMissedInstalmentsToDefault: z.coerce.number().int().min(1).max(24),
  receiptPrefix: z.string().trim().min(1).max(20),
  receiptSequenceLength: z.coerce.number().int().min(3).max(12),
  receiptResetYearly: z.boolean(),
  receiptFooter: optionalText,
  printCopiesOnOnePage: z.boolean(),
  requireCashupForClaim: z.boolean(),
  reportWeekStartsOn: z.coerce.number().int().min(0).max(6),
  fortnightAnchorDate: dateString.optional().nullable(),
  mapProvider: z.literal("openstreetmap").default("openstreetmap"),
  defaultCheckpointRadiusMeters: z.coerce.number().int().min(1).max(5000),
  approvalWorkflow: z.any().optional(),
  deductionPriority: z.array(z.string()).optional(),
}).partial();

function clean<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === "" ? null : item])) as T;
}

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayOfMonth(value: string): number {
  return Number(value.slice(8, 10));
}

function periodDates(year: number, month: number): { start: string; end: string; days: number } {
  const days = daysInMonth(year, month);
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(days).padStart(2, "0")}`,
    days,
  };
}

function numberCode(prefix: string, schoolCode: string, id: number | string, date = new Date()): string {
  const year = date.getUTCFullYear();
  return `${schoolCode}-${prefix}-${year}-${String(id).padStart(6, "0")}`;
}

function verificationToken(): string {
  return randomBytes(18).toString("base64url");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function previousDate(value: string): string {
  return isoDate(new Date(new Date(`${value}T00:00:00Z`).getTime() - 86400000));
}

function dateParts(value: string): { year: number; month: number; day: number } {
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) };
}

async function userHasAnyPermission(userId: number, ...codes: string[]): Promise<boolean> {
  const effective = await storage.getUserEffectivePermissions(userId);
  const granted = new Set(effective.filter((entry) => entry.granted).map((entry) => entry.permission.code));
  return codes.some((code) => granted.has(code));
}

async function notifyParentForStudent(studentId: number, schoolId: number, actorUserId: number, title: string, message: string, severity = "info") {
  const [learner] = await db.select({ parentId: students.parentId }).from(students)
    .where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)));
  if (!learner?.parentId) return;
  await createInAppNotifications({
    recipientType: "parent",
    recipientIds: [learner.parentId],
    title,
    message,
    channel: "system",
    schoolId,
    actorUserId,
    link: "/transport",
    severity,
  });
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function schoolContext(req: Request): Promise<SchoolRow | null> {
  const user = userOf(req);
  if (!user) return null;

  const headerValue = Array.isArray(req.headers["x-school-id"])
    ? req.headers["x-school-id"][0]
    : req.headers["x-school-id"];
  const headerSchoolId = positiveInteger(headerValue);
  const querySchoolId = positiveInteger(req.query.schoolId);

  // School-level users are always restricted to the school on their account.
  // Org administrators must supply an active school context. The query value is
  // only a fallback for PDF/browser flows; the selected school is still checked
  // against the administrator's organisation below.
  const schoolId = user.role === "org_admin"
    ? (headerSchoolId ?? querySchoolId)
    : positiveInteger(user.schoolId);

  if (!schoolId) return null;
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId));
  if (!school) return null;
  if (user.role === "org_admin" && user.organizationId && school.organizationId !== user.organizationId) return null;
  return school;
}

async function getOrCreateSettings(schoolId: number, executor: any = db) {
  const [existing] = await executor.select().from(transportSettings).where(eq(transportSettings.schoolId, schoolId));
  if (existing) return existing;
  const [created] = await executor.insert(transportSettings).values({ schoolId }).returning();
  return created;
}

async function writeAudit(
  executor: any,
  schoolId: number,
  userId: number | null,
  entityType: string,
  entityId: number | null,
  action: string,
  previousValues?: unknown,
  newValues?: unknown,
  reason?: string | null,
  metadata?: unknown,
) {
  await executor.insert(transportAuditEvents).values({
    schoolId,
    userId,
    entityType,
    entityId,
    action,
    previousValues: previousValues ?? null,
    newValues: newValues ?? null,
    reason: reason ?? null,
    metadata: metadata ?? null,
  });
}

async function assertSchoolRecord(table: any, id: number, schoolId: number) {
  const [row] = await db.select().from(table).where(and(eq(table.id, id), eq(table.schoolId, schoolId)));
  return row ?? null;
}

async function accountSummary(studentId: number, schoolId: number) {
  const result = await db.execute(sql`
    SELECT
      COALESCE((SELECT SUM(c.amount) FROM transport_charges c WHERE c.school_id=${schoolId} AND c.student_id=${studentId} AND c.status <> 'cancelled'), 0)::text AS charges,
      COALESCE((SELECT SUM(CASE WHEN a.direction='debit' THEN a.amount ELSE -a.amount END) FROM transport_account_adjustments a WHERE a.school_id=${schoolId} AND a.student_id=${studentId} AND a.status='approved'), 0)::text AS adjustments,
      COALESCE((SELECT SUM(pa.amount) FROM transport_payment_allocations pa JOIN transport_payments p ON p.id=pa.payment_id WHERE p.school_id=${schoolId} AND p.student_id=${studentId} AND p.reversed_at IS NULL), 0)::text AS allocated,
      COALESCE((SELECT SUM(p.amount) FROM transport_payments p WHERE p.school_id=${schoolId} AND p.student_id=${studentId} AND p.reversed_at IS NULL), 0)::text AS received
  `);
  const row = (result.rows[0] ?? {}) as any;
  const charges = amount(row.charges);
  const adjustments = amount(row.adjustments);
  const allocated = amount(row.allocated);
  const received = amount(row.received);
  return {
    charges: rounded(charges),
    adjustments: rounded(adjustments),
    allocated: rounded(allocated),
    received: rounded(received),
    balance: rounded(charges + adjustments - allocated),
    credit: rounded(Math.max(0, received - allocated)),
  };
}

async function generateReceiptNumber(executor: any, school: SchoolRow) {
  const settings = await getOrCreateSettings(school.id, executor);
  const currentYear = new Date().getUTCFullYear();
  const result = await executor.execute(sql`
    UPDATE transport_settings
    SET receipt_next_sequence = CASE
          WHEN receipt_reset_yearly = true AND COALESCE(receipt_sequence_year, 0) <> ${currentYear} THEN 2
          ELSE receipt_next_sequence + 1
        END,
        receipt_sequence_year = CASE WHEN receipt_reset_yearly = true THEN ${currentYear} ELSE receipt_sequence_year END,
        updated_at = NOW()
    WHERE id = ${settings.id}
    RETURNING CASE
      WHEN receipt_reset_yearly = true AND COALESCE(receipt_sequence_year, 0) <> ${currentYear} THEN 1
      ELSE receipt_next_sequence - 1
    END AS sequence,
    receipt_prefix AS prefix,
    receipt_sequence_length AS length,
    receipt_reset_yearly AS reset_yearly
  `);
  const row = result.rows[0] as any;
  const sequence = String(Number(row?.sequence ?? 1)).padStart(Number(row?.length ?? settings.receiptSequenceLength ?? 6), "0");
  const yearPart = row?.reset_yearly ? `-${currentYear}` : "";
  return `${school.shortCode}-${row?.prefix ?? settings.receiptPrefix}${yearPart}-${sequence}`;
}

async function ensureReceiptSecurity(payment: any, school: SchoolRow, req: Request) {
  if (payment.verificationToken && payment.receiptSnapshot && Object.keys(payment.receiptSnapshot as object).length > 0) return payment;
  const token = payment.verificationToken || verificationToken();
  let snapshot = payment.receiptSnapshot as any;
  if (!snapshot || Object.keys(snapshot).length === 0) {
    snapshot = await receiptSnapshot(school, payment.studentId, req, {
      studentId: payment.studentId,
      amount: amount(payment.amount),
      paymentDate: payment.paymentDate,
      paymentMethod: payment.paymentMethod,
      academicYear: payment.academicYear,
      term: payment.term,
      month: payment.month,
      externalReference: payment.externalReference,
      notes: payment.notes,
      allocationMode: "oldest_first",
      chargeIds: [],
    });
  }
  const securedSnapshot = {
    ...snapshot,
    receiptNo: payment.receiptNo,
    verificationTokenHash: createHash("sha256").update(token).digest("hex"),
    legacySecurityMintedAt: new Date().toISOString(),
  };
  const [secured] = await db.update(transportPayments)
    .set({ verificationToken: token, receiptSnapshot: securedSnapshot })
    .where(and(eq(transportPayments.id, payment.id), eq(transportPayments.schoolId, school.id)))
    .returning();
  return secured ?? { ...payment, verificationToken: token, receiptSnapshot: securedSnapshot };
}

async function receiptSnapshot(school: SchoolRow, studentId: number, req: Request, paymentData: z.infer<typeof paymentInput>) {
  const [learner] = await db.select({
    id: students.id,
    firstName: students.firstName,
    lastName: students.lastName,
    admissionNo: students.admissionNo,
    className: classes.className,
  }).from(students)
    .leftJoin(classes, eq(classes.id, students.classId))
    .where(and(eq(students.id, studentId), eq(students.schoolId, school.id)));
  if (!learner) throw new Error("Learner not found in selected school");

  const assignmentResult = await db.execute(sql`
    SELECT a.*, r.name AS "routeName", v.registration_number AS "vehicleRegistration",
           ov.registration_number AS "outboundVehicleRegistration",
           CONCAT(d.first_name, ' ', d.last_name) AS "driverName",
           sp.name AS "pickupName", dsp.name AS "dropoffName",
           sp.latitude AS "pickupLatitude", sp.longitude AS "pickupLongitude",
           dsp.latitude AS "dropoffLatitude", dsp.longitude AS "dropoffLongitude"
    FROM transport_assignments a
    JOIN transport_routes r ON r.id=a.route_id
    LEFT JOIN transport_vehicles v ON v.id=a.vehicle_id
    LEFT JOIN transport_vehicles ov ON ov.id=a.outbound_vehicle_id
    LEFT JOIN transport_drivers d ON d.id=a.driver_id
    LEFT JOIN transport_service_points sp ON sp.id=a.pickup_service_point_id
    LEFT JOIN transport_service_points dsp ON dsp.id=a.dropoff_service_point_id
    WHERE a.school_id=${school.id} AND a.student_id=${studentId}
    ORDER BY a.is_active DESC, a.start_date DESC, a.id DESC LIMIT 1
  `);
  const assignment = (assignmentResult.rows[0] ?? null) as any;
  const settings = await getOrCreateSettings(school.id);
  let managerName: string | null = null;
  if (settings.transportManagerStaffId) {
    const [manager] = await db.select({ firstName: staff.firstName, lastName: staff.lastName })
      .from(staff).where(eq(staff.id, settings.transportManagerStaffId));
    if (manager) managerName = `${manager.firstName} ${manager.lastName}`;
  }
  const user = userOf(req);
  return {
    school: {
      id: school.id,
      name: school.name,
      shortCode: school.shortCode,
      address: school.address,
      phone: school.phone,
      email: school.email,
      logo: school.logo,
      motto: school.motto,
    },
    learner,
    assignment,
    payment: {
      amount: rounded(paymentData.amount),
      paymentDate: paymentData.paymentDate,
      paymentMethod: paymentData.paymentMethod,
      academicYear: paymentData.academicYear,
      term: paymentData.term,
      month: paymentData.month,
      externalReference: paymentData.externalReference,
    },
    transportManagerName: managerName,
    receivedBy: user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : user?.username ?? "System user",
    issuedAt: new Date().toISOString(),
    currencyCode: settings.currencyCode,
  };
}

async function allocationCandidates(studentId: number, schoolId: number, specificIds?: number[]) {
  const filters = [
    eq(transportCharges.schoolId, schoolId),
    eq(transportCharges.studentId, studentId),
    ne(transportCharges.status, "cancelled"),
  ];
  if (specificIds?.length) filters.push(inArray(transportCharges.id, specificIds));
  const charges = await db.select().from(transportCharges)
    .where(and(...filters))
    .orderBy(asc(transportCharges.academicYear), asc(transportCharges.month), asc(transportCharges.dueDate), asc(transportCharges.id));
  if (!charges.length) return [];
  const chargeIdsSql = sql.join(charges.map((row) => sql`${row.id}`), sql`,`);
  const paidResult = await db.execute(sql`
    SELECT pa.charge_id AS "chargeId", COALESCE(SUM(pa.amount),0)::text AS paid
    FROM transport_payment_allocations pa
    JOIN transport_payments p ON p.id=pa.payment_id
    WHERE p.reversed_at IS NULL AND pa.charge_id IN (${chargeIdsSql})
    GROUP BY pa.charge_id
  `);
  const adjustmentResult = await db.execute(sql`
    SELECT charge_id AS "chargeId",
      COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END),0)::text AS adjustment
    FROM transport_account_adjustments
    WHERE status='approved' AND charge_id IN (${chargeIdsSql})
    GROUP BY charge_id
  `);
  const paidMap = new Map<number, number>((paidResult.rows as any[]).map((row) => [Number(row.chargeId), amount(row.paid)]));
  const adjustmentMap = new Map<number, number>((adjustmentResult.rows as any[]).map((row) => [Number(row.chargeId), amount(row.adjustment)]));
  return charges.map((charge) => ({
    ...charge,
    outstanding: rounded(Math.max(0, amount(charge.amount) + (adjustmentMap.get(charge.id) ?? 0) - (paidMap.get(charge.id) ?? 0))),
  })).filter((charge) => charge.outstanding > 0);
}

async function validateAssignmentSelection(
  schoolId: number,
  userId: number,
  input: any,
  excludeAssignmentId?: number,
) {
  const [learner, route] = await Promise.all([
    assertSchoolRecord(students, Number(input.studentId), schoolId),
    assertSchoolRecord(transportRoutes, Number(input.routeId), schoolId),
  ]);
  if (!learner || !route) throw Object.assign(new Error("Learner or route not found in the selected school"), { status: 404 });

  const validatePoint = async (id: number | null | undefined, allowed: string[]) => {
    if (!id) return null;
    const point = await assertSchoolRecord(transportServicePoints, Number(id), schoolId);
    if (!point || point.studentId !== Number(input.studentId) || !allowed.includes(point.pointType)) {
      throw Object.assign(new Error("The selected learner service point is not valid for this service leg"), { status: 409 });
    }
    return point;
  };
  await validatePoint(input.pickupServicePointId, ["pickup", "both"]);
  await validatePoint(input.dropoffServicePointId, ["dropoff", "both"]);

  const today = isoDate(new Date());
  const checkedVehicles = new Set<number>();
  const validateVehicle = async (vehicleId: number | null | undefined) => {
    if (!vehicleId || checkedVehicles.has(Number(vehicleId))) return;
    checkedVehicles.add(Number(vehicleId));
    const vehicle = await assertSchoolRecord(transportVehicles, Number(vehicleId), schoolId);
    if (!vehicle || !vehicle.isActive || vehicle.status !== "active") throw Object.assign(new Error("The selected vehicle is not active in this school"), { status: 409 });
    if (vehicle.insuranceExpiry && vehicle.insuranceExpiry < today) throw Object.assign(new Error(`Vehicle ${vehicle.registrationNumber} has expired insurance`), { status: 409 });
    if (vehicle.fitnessExpiry && vehicle.fitnessExpiry < today) throw Object.assign(new Error(`Vehicle ${vehicle.registrationNumber} has expired fitness certification`), { status: 409 });
    const countResult = await db.execute(sql`
      SELECT COUNT(DISTINCT id)::int AS count
      FROM transport_assignments
      WHERE school_id=${schoolId} AND is_active=true
        ${excludeAssignmentId ? sql`AND id <> ${excludeAssignmentId}` : sql``}
        AND (vehicle_id=${Number(vehicleId)} OR outbound_vehicle_id=${Number(vehicleId)})
    `);
    const occupied = Number(countResult.rows[0]?.count ?? 0);
    if (occupied >= vehicle.capacity) {
      const mayOverride = Boolean(input.capacityOverrideReason) && await userHasAnyPermission(userId, "transport.capacity.override", "transport.edit");
      if (!mayOverride) throw Object.assign(new Error(`Vehicle ${vehicle.registrationNumber} is at its configured capacity. Select another vehicle or use an authorised capacity override.`), { status: 409 });
    }
  };
  await validateVehicle(input.vehicleId);
  await validateVehicle(input.outboundVehicleId);

  const validatePath = async (pathId: number | null | undefined, expectedDirection: "pickup" | "dropoff", vehicleId: number | null | undefined) => {
    if (!pathId) return null;
    const path = await assertSchoolRecord(transportVehiclePaths, Number(pathId), schoolId);
    if (!path || path.routeId !== Number(input.routeId) || path.direction !== expectedDirection || (vehicleId && path.vehicleId !== Number(vehicleId))) {
      throw Object.assign(new Error(`The selected ${expectedDirection} path does not match the route and vehicle`), { status: 409 });
    }
    if (!["active", "scheduled", "draft"].includes(path.status)) throw Object.assign(new Error("The selected vehicle path is not available"), { status: 409 });
    return path;
  };
  await validatePath(input.inboundPathId, "pickup", input.vehicleId);
  await validatePath(input.outboundPathId, "dropoff", input.outboundVehicleId || input.vehicleId);
}

async function linkAssignmentNodes(executor: any, schoolId: number, assignment: any) {
  const links = [
    assignment.pickupPathNodeId && assignment.pickupServicePointId ? { nodeId: assignment.pickupPathNodeId, pointId: assignment.pickupServicePointId, boards: true, alights: false } : null,
    assignment.dropoffPathNodeId && assignment.dropoffServicePointId ? { nodeId: assignment.dropoffPathNodeId, pointId: assignment.dropoffServicePointId, boards: false, alights: true } : null,
  ].filter(Boolean) as Array<{ nodeId: number; pointId: number; boards: boolean; alights: boolean }>;
  for (const link of links) {
    const [node] = await executor.select().from(transportPathNodes).where(and(eq(transportPathNodes.id, link.nodeId), eq(transportPathNodes.schoolId, schoolId)));
    if (!node) throw Object.assign(new Error("Selected learner stop does not exist in this school"), { status: 409 });
    await executor.insert(transportPathNodeLearners).values({
      schoolId,
      pathNodeId: link.nodeId,
      assignmentId: assignment.id,
      servicePointId: link.pointId,
      boardsHere: link.boards,
      alightsHere: link.alights,
      effectiveFrom: assignment.startDate,
      effectiveTo: assignment.endDate,
    }).onConflictDoNothing();
  }
}

function unusedServiceRefund(assignment: any, effectiveDate: string, settings: any) {
  const { year, month, day } = dateParts(effectiveDate);
  const period = periodDates(year, month);
  const remainingDays = Math.max(0, period.days - day + 1);
  const threshold = Number(settings.refundNoCreditRemainingDays ?? 0);
  const refundableDays = remainingDays > threshold ? remainingDays : 0;
  const value = refundableDays > 0 ? rounded(amount(assignment.agreedFee) * refundableDays / period.days) : 0;
  return { year, month, effectiveDate, remainingDays, refundableDays, daysInMonth: period.days, threshold, amount: value };
}

async function nextOpenAdjustmentPeriod(schoolId: number, year: number, month: number) {
  const [existingClaim] = await db.select({ id: transportClaims.id }).from(transportClaims).where(and(
    eq(transportClaims.schoolId, schoolId), eq(transportClaims.serviceYear, year), eq(transportClaims.serviceMonth, month),
  ));
  if (!existingClaim) return { year, month };
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

async function applyTransferPolicyB(
  executor: any,
  schoolId: number,
  userId: number,
  previous: any,
  created: any,
  effectiveDate: string,
  reason: string,
) {
  const { year, month, day } = dateParts(effectiveDate);
  const period = periodDates(year, month);
  const [oldCharge] = await executor.select().from(transportCharges).where(and(
    eq(transportCharges.assignmentId, previous.id),
    eq(transportCharges.academicYear, year),
    eq(transportCharges.month, month),
    ne(transportCharges.status, "cancelled"),
  ));
  if (!oldCharge) return { learnerAdjustment: 0, providerShift: 0 };

  const oldServiceEndDay = oldCharge.servicePeriodEnd ? dayOfMonth(oldCharge.servicePeriodEnd) : period.days;
  const remainingDays = Math.max(0, oldServiceEndDay - day + 1);
  if (!remainingDays) return { learnerAdjustment: 0, providerShift: 0 };
  const oldUnused = rounded(Math.min(amount(oldCharge.amount), amount(previous.agreedFee) * remainingDays / period.days));
  const newEndDay = created.endDate && created.endDate <= period.end ? Math.max(day - 1, dayOfMonth(created.endDate)) : period.days;
  const newDays = Math.max(0, newEndDay - day + 1);
  const newAmount = rounded(amount(created.agreedFee) * newDays / period.days);

  if (oldUnused > 0) {
    await executor.insert(transportAccountAdjustments).values({
      schoolId,
      studentId: previous.studentId,
      assignmentId: previous.id,
      chargeId: oldCharge.id,
      adjustmentType: "transfer_unused_service_credit",
      direction: "credit",
      amount: String(oldUnused),
      currencyCode: oldCharge.currencyCode || "USD",
      effectiveDate,
      reason,
      metadata: { policy: "B", remainingDays, daysInMonth: period.days, oldAssignmentId: previous.id, newAssignmentId: created.id },
      approvedByUserId: userId,
      createdByUserId: userId,
    });
  }

  let newCharge: any = null;
  if (newAmount > 0) {
    [newCharge] = await executor.insert(transportCharges).values({
      schoolId,
      studentId: created.studentId,
      assignmentId: created.id,
      routeId: created.routeId,
      vehicleId: created.vehicleId,
      academicYear: year,
      term: oldCharge.term,
      month,
      servicePeriodStart: effectiveDate,
      servicePeriodEnd: `${year}-${String(month).padStart(2, "0")}-${String(newEndDay).padStart(2, "0")}`,
      daysInPeriod: period.days,
      chargeableDays: newDays,
      calculationType: "transfer_prorated",
      calculationSnapshot: { policy: "B", fullFee: amount(created.agreedFee), effectiveDate, serviceDays: newDays, daysInMonth: period.days, previousAssignmentId: previous.id },
      amount: String(newAmount),
      currencyCode: oldCharge.currencyCode || "USD",
      dueDate: oldCharge.dueDate,
      description: `Transfer adjustment from ${effectiveDate}`,
      createdByUserId: userId,
    }).onConflictDoNothing().returning();
  }

  if (!newCharge || !previous.vehicleId || !created.vehicleId || previous.vehicleId === created.vehicleId) {
    return { learnerAdjustment: rounded(newAmount - oldUnused), providerShift: 0 };
  }

  const allocations = await executor.execute(sql`
    SELECT pa.*, ca.claim_id AS "claimId"
    FROM transport_payment_allocations pa
    LEFT JOIN transport_claim_allocations ca ON ca.allocation_id=pa.id
    WHERE pa.charge_id=${oldCharge.id}
    ORDER BY pa.id
  `);
  let toShift = rounded(Math.min(oldUnused, newAmount));
  let claimedShift = 0;
  for (const allocation of allocations.rows as any[]) {
    if (toShift <= 0) break;
    const shift = rounded(Math.min(toShift, amount(allocation.amount)));
    if (allocation.claimId) {
      claimedShift = rounded(claimedShift + shift);
    } else if (shift >= amount(allocation.amount)) {
      await executor.update(transportPaymentAllocations).set({
        chargeId: newCharge.id,
        serviceYear: year,
        serviceMonth: month,
        vehicleId: created.vehicleId,
      }).where(eq(transportPaymentAllocations.id, Number(allocation.id)));
    } else {
      await executor.update(transportPaymentAllocations).set({ amount: String(rounded(amount(allocation.amount) - shift)) }).where(eq(transportPaymentAllocations.id, Number(allocation.id)));
      await executor.insert(transportPaymentAllocations).values({
        paymentId: Number(allocation.paymentId), chargeId: newCharge.id, amount: String(shift),
        serviceYear: year, serviceMonth: month, vehicleId: created.vehicleId,
      });
    }
    toShift = rounded(toShift - shift);
  }

  if (claimedShift > 0) {
    const apply = await nextOpenAdjustmentPeriod(schoolId, year, month);
    await executor.insert(transportProviderAdjustments).values([
      {
        schoolId, vehicleId: previous.vehicleId, ownerId: null, adjustmentType: "transfer_entitlement", direction: "deduction",
        amount: String(claimedShift), currencyCode: oldCharge.currencyCode || "USD", serviceYear: year, serviceMonth: month,
        applyYear: apply.year, applyMonth: apply.month, assignmentId: previous.id, status: "pending", reason,
        metadata: { policy: "B", newAssignmentId: created.id, effectiveDate }, createdByUserId: userId,
      },
      {
        schoolId, vehicleId: created.vehicleId, ownerId: null, adjustmentType: "transfer_entitlement", direction: "addition",
        amount: String(claimedShift), currencyCode: oldCharge.currencyCode || "USD", serviceYear: year, serviceMonth: month,
        applyYear: apply.year, applyMonth: apply.month, assignmentId: created.id, status: "pending", reason,
        metadata: { policy: "B", previousAssignmentId: previous.id, effectiveDate }, createdByUserId: userId,
      },
    ]);
  }
  return { learnerAdjustment: rounded(newAmount - oldUnused), providerShift: claimedShift };
}

async function ensureNotLocked(schoolId: number, year: number, month: number) {
  const [lock] = await db.select().from(transportPeriodLocks).where(and(
    eq(transportPeriodLocks.schoolId, schoolId),
    eq(transportPeriodLocks.periodType, "monthly_settlement"),
    eq(transportPeriodLocks.year, year),
    eq(transportPeriodLocks.month, month),
    eq(transportPeriodLocks.status, "locked"),
  ));
  if (lock) throw Object.assign(new Error("This transport settlement period is locked"), { status: 409 });
}

function deductionPriority(settings: any, type: string): number {
  const configured = Array.isArray(settings?.deductionPriority) ? settings.deductionPriority : [];
  const index = configured.indexOf(type);
  return index >= 0 ? (index + 1) * 10 : (configured.length + 1) * 10;
}

function routeError(res: Response, error: any) {
  const status = Number(error?.status || 400);
  return res.status(Number.isFinite(status) ? status : 400).json({ message: error?.message || "Transport operation failed" });
}

function registerMasterCrud(
  app: Express,
  path: string,
  table: any,
  schema: z.AnyZodObject,
  entityType: string,
  createPermission: string,
  editPermission: string,
) {
  app.post(path, requireAuth, requireAnyPermission(createPermission, "transport.create"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = clean(schema.parse(req.body));
      const values: any = { ...parsed, schoolId: school.id };
      delete values.effectiveDate;
      delete values.changeReason;
      if ("createdByUserId" in table) values.createdByUserId = user.id;
      const returned: any = await (db.insert(table) as any).values(values).returning();
      const created = returned[0];
      await writeAudit(db, school.id, user.id, entityType, created.id, "create", null, created);
      return res.status(201).json(created);
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.put(`${path}/:id`, requireAuth, requireAnyPermission(editPermission, "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(table, id, school.id);
      if (!previous) return res.status(404).json({ message: "Record not found" });
      const parsed: any = clean(schema.partial().parse(req.body));
      const effectiveDate = parsed.effectiveDate || isoDate(new Date());
      const changeReason = parsed.changeReason || "Record updated";
      delete parsed.effectiveDate;
      delete parsed.changeReason;
      parsed.updatedAt = new Date();

      const [updated] = await db.transaction(async (tx) => {
        const [row] = await tx.update(table).set(parsed).where(and(eq(table.id, id), eq(table.schoolId, school.id))).returning();
        if (entityType === "vehicle" && parsed.ownerId && parsed.ownerId !== previous.ownerId) {
          await tx.update(transportVehicleOwnerHistory).set({ effectiveTo: isoDate(new Date(new Date(`${effectiveDate}T00:00:00Z`).getTime() - 86400000)) })
            .where(and(eq(transportVehicleOwnerHistory.vehicleId, id), isNull(transportVehicleOwnerHistory.effectiveTo)));
          await tx.insert(transportVehicleOwnerHistory).values({ schoolId: school.id, vehicleId: id, ownerId: parsed.ownerId, effectiveFrom: effectiveDate, reason: changeReason, createdByUserId: user.id });
        }
        if (entityType === "vehicle" && parsed.driverId && parsed.driverId !== previous.driverId) {
          await tx.update(transportVehicleDriverHistory).set({ effectiveTo: isoDate(new Date(new Date(`${effectiveDate}T00:00:00Z`).getTime() - 86400000)) })
            .where(and(eq(transportVehicleDriverHistory.vehicleId, id), isNull(transportVehicleDriverHistory.effectiveTo)));
          await tx.insert(transportVehicleDriverHistory).values({ schoolId: school.id, vehicleId: id, driverId: parsed.driverId, effectiveFrom: effectiveDate, reason: changeReason, createdByUserId: user.id });
        }
        await writeAudit(tx, school.id, user.id, entityType, id, "update", previous, row, changeReason);
        return [row];
      });
      return res.json(updated);
    } catch (error) {
      return routeError(res, error);
    }
  });
}

async function getTransportPeriodSummary(schoolId: number, from: string, to: string) {
  const summary = await db.execute(sql`
    SELECT
      COALESCE((SELECT SUM(amount) FROM transport_payments WHERE school_id=${schoolId} AND payment_date BETWEEN ${from} AND ${to} AND reversed_at IS NULL),0)::text AS received,
      COALESCE((SELECT SUM(amount) FROM transport_charges WHERE school_id=${schoolId} AND service_period_start <= ${to} AND service_period_end >= ${from} AND status <> 'cancelled'),0)::text AS charged,
      COALESCE((SELECT SUM(amount) FROM transport_refunds WHERE school_id=${schoolId} AND effective_date BETWEEN ${from} AND ${to} AND status IN ('approved','paid')),0)::text AS refunds,
      COALESCE((SELECT SUM(gross_amount) FROM transport_claims WHERE school_id=${schoolId} AND make_date(service_year,service_month,1) BETWEEN date_trunc('month',${from}::date) AND date_trunc('month',${to}::date)),0)::text AS claim_gross,
      COALESCE((SELECT SUM(net_amount) FROM transport_payouts WHERE school_id=${schoolId} AND created_at::date BETWEEN ${from} AND ${to}),0)::text AS payout_net
  `);
  const byMethod = await db.execute(sql`SELECT payment_method AS method, SUM(amount)::text amount, COUNT(*)::int count FROM transport_payments WHERE school_id=${schoolId} AND payment_date BETWEEN ${from} AND ${to} AND reversed_at IS NULL GROUP BY payment_method ORDER BY payment_method`);
  return { from, to, summary: summary.rows[0], byMethod: byMethod.rows };
}

export function registerTransportRoutes(app: Express) {
  app.use("/api/transport", async (req, res, next) => {
    try {
      const current = userOf(req);
      if (!current || current.role !== "org_admin" || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
      const effectivePermissions = await storage.getUserEffectivePermissions(current.id);
      const canManageOrganisationTransport = effectivePermissions.some((entry) => entry.permission.code === "transport.organization.manage" && entry.granted);
      if (!canManageOrganisationTransport) return res.status(403).json({ message: "HQ Transport access is oversight-only" });
      next();
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/transport/bootstrap", requireAuth, requirePermission("transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const schoolId = school.id;
      const settings = await getOrCreateSettings(schoolId);
      const [
        routes,
        points,
        owners,
        drivers,
        vehicles,
        servicePoints,
        paths,
        pathNodes,
        learnerRows,
        staffRows,
        assignmentsResult,
        paymentsResult,
        plans,
        refunds,
        cashups,
        subscriptions,
        penalties,
        advances,
        incidents,
        claims,
        payouts,
        audits,
      ] = await Promise.all([
        db.select().from(transportRoutes).where(eq(transportRoutes.schoolId, schoolId)).orderBy(asc(transportRoutes.name)),
        db.select().from(transportPickupPoints).where(eq(transportPickupPoints.schoolId, schoolId)).orderBy(asc(transportPickupPoints.stopOrder)),
        db.select().from(transportOwners).where(eq(transportOwners.schoolId, schoolId)).orderBy(asc(transportOwners.name)),
        db.select().from(transportDrivers).where(eq(transportDrivers.schoolId, schoolId)).orderBy(asc(transportDrivers.firstName)),
        db.select().from(transportVehicles).where(eq(transportVehicles.schoolId, schoolId)).orderBy(asc(transportVehicles.registrationNumber)),
        db.select().from(transportServicePoints).where(eq(transportServicePoints.schoolId, schoolId)).orderBy(desc(transportServicePoints.createdAt)),
        db.select().from(transportVehiclePaths).where(eq(transportVehiclePaths.schoolId, schoolId)).orderBy(desc(transportVehiclePaths.createdAt)),
        db.select().from(transportPathNodes).where(eq(transportPathNodes.schoolId, schoolId)).orderBy(asc(transportPathNodes.pathId), asc(transportPathNodes.stopOrder)),
        db.select({ id: students.id, firstName: students.firstName, lastName: students.lastName, admissionNo: students.admissionNo, classId: students.classId, className: classes.className })
          .from(students).leftJoin(classes, eq(classes.id, students.classId))
          .where(and(eq(students.schoolId, schoolId), eq(students.status, "active"))).orderBy(asc(students.firstName), asc(students.lastName)),
        db.select({ id: staff.id, firstName: staff.firstName, lastName: staff.lastName, position: staff.role, status: staff.status })
          .from(staff).where(eq(staff.schoolId, schoolId)).orderBy(asc(staff.firstName), asc(staff.lastName)),
        db.execute(sql`
          SELECT a.*, s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo", c.class_name AS "className",
            r.name AS "routeName", v.registration_number AS "vehicleRegistration", ov.registration_number AS "outboundVehicleRegistration",
            CONCAT(d.first_name,' ',d.last_name) AS "driverName", sp.name AS "pickupName", dsp.name AS "dropoffName",
            COALESCE(ch.charged,0)::text AS charged, COALESCE(ad.adjustments,0)::text AS adjustments,
            COALESCE(pa.paid,0)::text AS paid,
            (COALESCE(ch.charged,0)+COALESCE(ad.adjustments,0)-COALESCE(pa.paid,0))::text AS balance
          FROM transport_assignments a
          JOIN students s ON s.id=a.student_id
          LEFT JOIN classes c ON c.id=s.class_id
          JOIN transport_routes r ON r.id=a.route_id
          LEFT JOIN transport_vehicles v ON v.id=a.vehicle_id
          LEFT JOIN transport_vehicles ov ON ov.id=a.outbound_vehicle_id
          LEFT JOIN transport_drivers d ON d.id=a.driver_id
          LEFT JOIN transport_service_points sp ON sp.id=a.pickup_service_point_id
          LEFT JOIN transport_service_points dsp ON dsp.id=a.dropoff_service_point_id
          LEFT JOIN (SELECT assignment_id,SUM(amount) charged FROM transport_charges WHERE status <> 'cancelled' GROUP BY assignment_id) ch ON ch.assignment_id=a.id
          LEFT JOIN (SELECT assignment_id,SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END) adjustments FROM transport_account_adjustments WHERE status='approved' GROUP BY assignment_id) ad ON ad.assignment_id=a.id
          LEFT JOIN (SELECT tc.assignment_id,SUM(tpa.amount) paid FROM transport_payment_allocations tpa JOIN transport_charges tc ON tc.id=tpa.charge_id JOIN transport_payments tp ON tp.id=tpa.payment_id WHERE tp.reversed_at IS NULL GROUP BY tc.assignment_id) pa ON pa.assignment_id=a.id
          WHERE a.school_id=${schoolId} ORDER BY a.is_active DESC,s.first_name,s.last_name
        `),
        db.execute(sql`
          SELECT p.*, s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo",
            COALESCE(SUM(a.amount),0)::text AS "allocatedAmount",
            (p.amount-COALESCE(SUM(a.amount),0))::text AS "unallocatedAmount",
            (SELECT COUNT(*) FROM transport_receipt_events re WHERE re.payment_id=p.id AND re.event_type='reprint')::int AS "reprintCount",
            ca.claim_id AS "claimId", cl.claim_number AS "claimNumber", po.payout_number AS "payoutNumber"
          FROM transport_payments p
          JOIN students s ON s.id=p.student_id
          LEFT JOIN transport_payment_allocations a ON a.payment_id=p.id
          LEFT JOIN transport_claim_allocations ca ON ca.allocation_id=a.id
          LEFT JOIN transport_claims cl ON cl.id=ca.claim_id
          LEFT JOIN transport_payouts po ON po.claim_id=cl.id
          WHERE p.school_id=${schoolId}
          GROUP BY p.id,s.id,ca.claim_id,cl.claim_number,po.payout_number
          ORDER BY p.created_at DESC LIMIT 500
        `),
        db.select().from(transportPaymentPlans).where(eq(transportPaymentPlans.schoolId, schoolId)).orderBy(desc(transportPaymentPlans.createdAt)),
        db.select().from(transportRefunds).where(eq(transportRefunds.schoolId, schoolId)).orderBy(desc(transportRefunds.createdAt)),
        db.select().from(transportCashups).where(eq(transportCashups.schoolId, schoolId)).orderBy(desc(transportCashups.cashupDate)),
        db.select().from(transportSubscriptionRules).where(eq(transportSubscriptionRules.schoolId, schoolId)).orderBy(desc(transportSubscriptionRules.effectiveFrom)),
        db.select().from(transportPenalties).where(eq(transportPenalties.schoolId, schoolId)).orderBy(desc(transportPenalties.incidentDate)),
        db.select().from(transportAdvances).where(eq(transportAdvances.schoolId, schoolId)).orderBy(desc(transportAdvances.requestDate)),
        db.select().from(transportIncidents).where(eq(transportIncidents.schoolId, schoolId)).orderBy(desc(transportIncidents.occurredAt)),
        db.select().from(transportClaims).where(eq(transportClaims.schoolId, schoolId)).orderBy(desc(transportClaims.serviceYear), desc(transportClaims.serviceMonth)),
        db.select().from(transportPayouts).where(eq(transportPayouts.schoolId, schoolId)).orderBy(desc(transportPayouts.createdAt)),
        db.select().from(transportAuditEvents).where(eq(transportAuditEvents.schoolId, schoolId)).orderBy(desc(transportAuditEvents.createdAt)).limit(300),
      ]);

      const totalsResult = await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM transport_assignments WHERE school_id=${schoolId} AND is_active=true)::int AS active_learners,
          (SELECT COUNT(*) FROM transport_assignments WHERE school_id=${schoolId} AND service_state='pending_start')::int AS pending_learners,
          (SELECT COUNT(*) FROM transport_routes WHERE school_id=${schoolId} AND is_active=true)::int AS active_routes,
          (SELECT COUNT(*) FROM transport_vehicles WHERE school_id=${schoolId} AND is_active=true)::int AS active_vehicles,
          COALESCE((SELECT SUM(amount) FROM transport_charges WHERE school_id=${schoolId} AND status <> 'cancelled'),0)::text AS expected,
          COALESCE((SELECT SUM(amount) FROM transport_payments WHERE school_id=${schoolId} AND reversed_at IS NULL),0)::text AS collected,
          COALESCE((SELECT SUM(net_amount-amount_paid) FROM transport_payouts WHERE school_id=${schoolId} AND status <> 'paid'),0)::text AS payouts_due,
          COALESCE((SELECT SUM(outstanding_amount) FROM transport_advances WHERE school_id=${schoolId} AND status NOT IN ('settled','cancelled')),0)::text AS advances_outstanding,
          (SELECT COUNT(*) FROM transport_claims WHERE school_id=${schoolId} AND status IN ('draft','submitted','verified'))::int AS pending_claims,
          (SELECT COUNT(*) FROM transport_refunds WHERE school_id=${schoolId} AND status IN ('requested','approved'))::int AS pending_refunds
      `);

      return res.json({
        school,
        settings,
        routes,
        points,
        owners,
        drivers,
        vehicles,
        servicePoints,
        paths,
        pathNodes,
        students: learnerRows,
        staff: staffRows,
        assignments: assignmentsResult.rows,
        payments: paymentsResult.rows,
        paymentPlans: plans,
        refunds,
        cashups,
        subscriptions,
        penalties,
        advances,
        incidents,
        claims,
        payouts,
        audits,
        dashboard: totalsResult.rows[0],
      });
    } catch (error) {
      return routeError(res, error);
    }
  });

  registerMasterCrud(app, "/api/transport/routes", transportRoutes, routeInput, "route", "transport.routes.create", "transport.routes.edit");
  registerMasterCrud(app, "/api/transport/pickup-points", transportPickupPoints, pointInput, "legacy_pickup_point", "transport.stops.manage", "transport.stops.manage");
  registerMasterCrud(app, "/api/transport/owners", transportOwners, ownerInput, "owner", "transport.owners.manage", "transport.owners.manage");
  registerMasterCrud(app, "/api/transport/drivers", transportDrivers, driverInput, "driver", "transport.drivers.manage", "transport.drivers.manage");
  registerMasterCrud(app, "/api/transport/vehicles", transportVehicles, vehicleInput, "vehicle", "transport.vehicles.create", "transport.vehicles.edit");

  app.put("/api/transport/settings", requireAuth, requireAnyPermission("transport.settings.manage", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = clean(settingsInput.parse(req.body));
      const previous = await getOrCreateSettings(school.id);
      const settingsValues: any = { ...parsed, currencyCode: "USD", updatedAt: new Date() };
      for (const key of ["inboundOneWayPercent", "outboundOneWayPercent", "minimumSuspensionBalance"]) {
        if (settingsValues[key] !== undefined && settingsValues[key] !== null) settingsValues[key] = String(settingsValues[key]);
      }
      const [updated] = await db.update(transportSettings).set(settingsValues)
        .where(eq(transportSettings.schoolId, school.id)).returning();
      await writeAudit(db, school.id, user.id, "settings", updated.id, "update", previous, updated, "Transport settings updated");
      return res.json(updated);
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.post("/api/transport/service-points", requireAuth, requireAnyPermission("transport.learners.enrol", "transport.create"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = clean(servicePointInput.parse(req.body));
      const learner = await assertSchoolRecord(students, parsed.studentId, school.id);
      if (!learner) return res.status(404).json({ message: "Learner not found" });
      const servicePointValues: any = { ...parsed, latitude: String(parsed.latitude), longitude: String(parsed.longitude), schoolId: school.id, createdByUserId: user.id };
      const [created] = await db.insert(transportServicePoints).values(servicePointValues).returning();
      await writeAudit(db, school.id, user.id, "service_point", created.id, "create", null, created);
      return res.status(201).json(created);
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.put("/api/transport/service-points/:id", requireAuth, requireAnyPermission("transport.learners.edit_service", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(transportServicePoints, id, school.id);
      if (!previous) return res.status(404).json({ message: "Service point not found" });
      const parsed = clean(servicePointInput.partial().parse(req.body));
      // Coordinate changes are versioned instead of overwriting historical service locations.
      if ((parsed.latitude && String(parsed.latitude) !== String(previous.latitude)) || (parsed.longitude && String(parsed.longitude) !== String(previous.longitude))) {
        const effectiveFrom = parsed.effectiveFrom || isoDate(new Date());
        const previousEnd = isoDate(new Date(new Date(`${effectiveFrom}T00:00:00Z`).getTime() - 86400000));
        const [created] = await db.transaction(async (tx) => {
          await tx.update(transportServicePoints).set({ effectiveTo: previousEnd, isActive: false }).where(eq(transportServicePoints.id, id));
          const nextValues: any = { ...previous, ...parsed, schoolId: school.id, effectiveFrom, effectiveTo: parsed.effectiveTo ?? null, isActive: true, createdByUserId: user.id };
          delete nextValues.id;
          delete nextValues.createdAt;
          if (nextValues.latitude !== undefined) nextValues.latitude = String(nextValues.latitude);
          if (nextValues.longitude !== undefined) nextValues.longitude = String(nextValues.longitude);
          const [row] = await tx.insert(transportServicePoints).values(nextValues).returning();
          await writeAudit(tx, school.id, user.id, "service_point", id, "supersede", previous, row, "Service point coordinates changed");
          return [row];
        });
        return res.json(created);
      }
      const updateValues: any = { ...parsed };
      if (updateValues.latitude !== undefined) updateValues.latitude = String(updateValues.latitude);
      if (updateValues.longitude !== undefined) updateValues.longitude = String(updateValues.longitude);
      const [updated] = await db.update(transportServicePoints).set(updateValues).where(and(eq(transportServicePoints.id, id), eq(transportServicePoints.schoolId, school.id))).returning();
      await writeAudit(db, school.id, user.id, "service_point", id, "update", previous, updated);
      return res.json(updated);
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.post("/api/transport/maps/route", requireAuth, requireAnyPermission("transport.paths.manage", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const parsed = z.object({ coordinates: z.array(z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180) })).min(2).max(100) }).parse(req.body);
      const baseUrl = (process.env.TRANSPORT_ROUTING_URL || "https://router.project-osrm.org").replace(/\/$/, "");
      const coordinatePath = parsed.coordinates.map((point) => `${point.longitude},${point.latitude}`).join(";");
      const response = await fetch(`${baseUrl}/route/v1/driving/${coordinatePath}?overview=full&geometries=geojson&steps=false`);
      if (!response.ok) throw new Error(`Routing provider returned ${response.status}`);
      const payload: any = await response.json();
      const route = payload?.routes?.[0];
      if (!route?.geometry?.coordinates) throw new Error("No road route was found through the selected points");
      return res.json({
        geometry: route.geometry,
        distanceKm: rounded(Number(route.distance || 0) / 1000),
        durationMinutes: Math.round(Number(route.duration || 0) / 60),
        provider: "osrm-test",
      });
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/paths", requireAuth, requireAnyPermission("transport.paths.manage", "transport.create"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = pathInput.parse(req.body);
      const [route, vehicle] = await Promise.all([
        assertSchoolRecord(transportRoutes, parsed.routeId, school.id),
        assertSchoolRecord(transportVehicles, parsed.vehicleId, school.id),
      ]);
      if (!route || !vehicle) return res.status(404).json({ message: "Route or vehicle not found" });
      const existing = await db.select().from(transportVehiclePaths).where(and(
        eq(transportVehiclePaths.schoolId, school.id),
        eq(transportVehiclePaths.routeId, parsed.routeId),
        eq(transportVehiclePaths.vehicleId, parsed.vehicleId),
        eq(transportVehiclePaths.direction, parsed.direction),
      )).orderBy(desc(transportVehiclePaths.versionNumber)).limit(1);
      const versionNumber = (existing[0]?.versionNumber ?? 0) + 1;
      const created = await db.transaction(async (tx) => {
        const pathValues: any = {
          schoolId: school.id,
          routeId: parsed.routeId,
          vehicleId: parsed.vehicleId,
          direction: parsed.direction,
          name: parsed.name,
          versionNumber,
          status: "draft",
          effectiveFrom: parsed.effectiveFrom,
          effectiveTo: parsed.effectiveTo,
          geometry: parsed.geometry ?? parsed.nodes.map((node) => [node.latitude, node.longitude]),
          estimatedDistanceKm: parsed.estimatedDistanceKm,
          estimatedDurationMinutes: parsed.estimatedDurationMinutes,
          notes: parsed.notes,
          createdByUserId: user.id,
        };
        if (pathValues.estimatedDistanceKm !== undefined && pathValues.estimatedDistanceKm !== null) pathValues.estimatedDistanceKm = String(pathValues.estimatedDistanceKm);
        const [path] = await tx.insert(transportVehiclePaths).values(pathValues).returning();
        for (const nodeInput of [...parsed.nodes].sort((a, b) => a.stopOrder - b.stopOrder)) {
          const [node] = await tx.insert(transportPathNodes).values({
            schoolId: school.id,
            pathId: path.id,
            nodeType: nodeInput.nodeType,
            name: nodeInput.name,
            latitude: String(nodeInput.latitude),
            longitude: String(nodeInput.longitude),
            stopOrder: nodeInput.stopOrder,
            expectedTime: nodeInput.expectedTime,
            checkpointRadiusMeters: nodeInput.checkpointRadiusMeters,
            notes: nodeInput.notes,
          }).returning();
          for (const link of nodeInput.learnerLinks ?? []) {
            await tx.insert(transportPathNodeLearners).values({ ...link, schoolId: school.id, pathNodeId: node.id });
          }
        }
        await writeAudit(tx, school.id, user.id, "vehicle_path", path.id, "create_version", existing[0] ?? null, path, `Created path version ${versionNumber}`);
        return path;
      });
      return res.status(201).json(created);
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.put("/api/transport/paths/:id/activate", requireAuth, requireAnyPermission("transport.paths.manage", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const path = await assertSchoolRecord(transportVehiclePaths, id, school.id);
      if (!path) return res.status(404).json({ message: "Vehicle path not found" });
      const nodes = await db.select().from(transportPathNodes).where(and(eq(transportPathNodes.pathId, id), eq(transportPathNodes.schoolId, school.id))).orderBy(asc(transportPathNodes.stopOrder));
      if (nodes.filter((node) => node.nodeType === "start").length !== 1 || nodes.filter((node) => node.nodeType === "destination").length !== 1) {
        return res.status(409).json({ message: "An active vehicle path must have exactly one starting point and one destination" });
      }
      const linked = await db.execute(sql`
        SELECT pnl.assignment_id AS "assignmentId", pnl.path_node_id AS "pathNodeId", pnl.boards_here AS "boardsHere", pnl.alights_here AS "alightsHere"
        FROM transport_path_node_learners pnl
        JOIN transport_assignments a ON a.id=pnl.assignment_id
        WHERE pnl.school_id=${school.id} AND pnl.path_node_id IN (SELECT id FROM transport_path_nodes WHERE path_id=${id})
          AND a.is_active=true
      `);
      const links = linked.rows as any[];
      const assignmentIds = Array.from(new Set(links.map((link) => Number(link.assignmentId))));
      let occupancy = assignmentIds.filter((assignmentId) => !links.some((link) => Number(link.assignmentId) === assignmentId && link.boardsHere)).length;
      let maximumOccupancy = occupancy;
      for (const node of nodes) {
        const nodeLinks = links.filter((link) => Number(link.pathNodeId) === node.id);
        occupancy += nodeLinks.filter((link) => link.boardsHere).length;
        maximumOccupancy = Math.max(maximumOccupancy, occupancy);
        occupancy = Math.max(0, occupancy - nodeLinks.filter((link) => link.alightsHere).length);
      }
      const vehicle = await assertSchoolRecord(transportVehicles, path.vehicleId, school.id);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      if (maximumOccupancy > vehicle.capacity) {
        return res.status(409).json({ message: `This path reaches ${maximumOccupancy} passengers, above vehicle capacity ${vehicle.capacity}` });
      }
      const [updated] = await db.transaction(async (tx) => {
        await tx.update(transportVehiclePaths).set({ status: "superseded", effectiveTo: isoDate(new Date(new Date(`${path.effectiveFrom}T00:00:00Z`).getTime() - 86400000)), updatedAt: new Date() })
          .where(and(
            eq(transportVehiclePaths.schoolId, school.id),
            eq(transportVehiclePaths.vehicleId, path.vehicleId),
            eq(transportVehiclePaths.routeId, path.routeId),
            eq(transportVehiclePaths.direction, path.direction),
            eq(transportVehiclePaths.status, "active"),
            ne(transportVehiclePaths.id, id),
          ));
        const [row] = await tx.update(transportVehiclePaths).set({ status: "active", activatedByUserId: user.id, activatedAt: new Date(), updatedAt: new Date() }).where(eq(transportVehiclePaths.id, id)).returning();
        await writeAudit(tx, school.id, user.id, "vehicle_path", id, "activate", path, row);
        return [row];
      });
      return res.json(updated);
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.post("/api/transport/assignments", requireAuth, requireAnyPermission("transport.learners.enrol", "transport.create"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed: any = clean(assignmentInput.parse(req.body));
      await validateAssignmentSelection(school.id, user.id, parsed);
      const existing = await db.select().from(transportAssignments).where(and(
        eq(transportAssignments.schoolId, school.id),
        eq(transportAssignments.studentId, parsed.studentId),
        eq(transportAssignments.isActive, true),
      )).limit(1);
      if (existing.length) {
        return res.status(409).json({
          message: "This learner already has an active transport assignment. Use Transfer Learner.",
          code: "TRANSFER_REQUIRED",
          assignment: existing[0],
        });
      }
      const settings = await getOrCreateSettings(school.id);
      const percent = parsed.serviceType === "pickup" ? amount(settings.inboundOneWayPercent) : parsed.serviceType === "dropoff" ? amount(settings.outboundOneWayPercent) : 100;
      const seatReservedUntil = settings.pendingSeatReservationEnabled
        ? isoDate(new Date(new Date(`${parsed.startDate}T00:00:00Z`).getTime() + (settings.pendingSeatReservationDays ?? 0) * 86400000))
        : null;
      const capacityOverrideReason = parsed.capacityOverrideReason;
      delete parsed.capacityOverrideReason;
      const assignmentValues: any = {
        ...parsed,
        schoolId: school.id,
        billingFrequency: "monthly",
        baseMonthlyFee: String(parsed.baseMonthlyFee),
        agreedFee: String(parsed.agreedFee),
        oneWayPercentSnapshot: String(percent),
        seatReservedUntil,
        createdByUserId: user.id,
      };
      const created = await db.transaction(async (tx) => {
        const [row] = await tx.insert(transportAssignments).values(assignmentValues).returning();
        await linkAssignmentNodes(tx, school.id, row);
        await writeAudit(tx, school.id, user.id, "assignment", row.id, "enrol", null, row, capacityOverrideReason || null, capacityOverrideReason ? { capacityOverride: true } : null);
        return row;
      });
      return res.status(201).json(created);
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.post("/api/transport/assignments/:id/transfer", requireAuth, requireAnyPermission("transport.learners.transfer", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(transportAssignments, id, school.id);
      if (!previous || !previous.isActive) return res.status(404).json({ message: "Active assignment not found" });
      const parsed: any = clean(transferInput.parse(req.body));
      const prospective = { ...previous, ...parsed, studentId: previous.studentId };
      await validateAssignmentSelection(school.id, user.id, prospective, previous.id);
      const effectiveDate = parsed.effectiveDate;
      const previousEnd = isoDate(new Date(new Date(`${effectiveDate}T00:00:00Z`).getTime() - 86400000));
      const transferReason = parsed.reason;
      delete (parsed as any).effectiveDate;
      delete (parsed as any).reason;
      delete (parsed as any).transferType;
      const capacityOverrideReason = parsed.capacityOverrideReason;
      delete (parsed as any).capacityOverrideReason;
      const settings = await getOrCreateSettings(school.id);
      const base = { ...previous, ...parsed } as any;
      const serviceType = base.serviceType ?? previous.serviceType;
      const percent = serviceType === "pickup" ? amount(settings.inboundOneWayPercent) : serviceType === "dropoff" ? amount(settings.outboundOneWayPercent) : 100;
      const newAssignment = await db.transaction(async (tx) => {
        await tx.update(transportAssignments).set({ endDate: previousEnd, isActive: false, serviceState: "terminated", updatedAt: new Date() }).where(eq(transportAssignments.id, id));
        const values: any = {
          schoolId: school.id,
          studentId: previous.studentId,
          routeId: base.routeId,
          vehicleId: base.vehicleId,
          outboundVehicleId: base.outboundVehicleId,
          driverId: base.driverId,
          inboundPathId: base.inboundPathId,
          outboundPathId: base.outboundPathId,
          pickupServicePointId: base.pickupServicePointId,
          dropoffServicePointId: base.dropoffServicePointId,
          pickupPathNodeId: base.pickupPathNodeId,
          dropoffPathNodeId: base.dropoffPathNodeId,
          serviceType,
          serviceState: "active",
          planningStatus: base.planningStatus ?? "assigned_to_path",
          financialStatus: previous.financialStatus,
          billingFrequency: "monthly",
          baseMonthlyFee: base.baseMonthlyFee,
          agreedFee: base.agreedFee,
          oneWayPercentSnapshot: String(percent),
          startDate: effectiveDate,
          endDate: base.endDate,
          isActive: true,
          notes: base.notes,
          createdByUserId: user.id,
        };
        const [created] = await tx.insert(transportAssignments).values(values).returning();
        await linkAssignmentNodes(tx, school.id, created);
        await tx.insert(transportAssignmentEvents).values({ schoolId: school.id, assignmentId: id, eventType: "transfer_out", effectiveDate, previousValues: previous, newValues: created, reason: transferReason, createdByUserId: user.id });
        await tx.insert(transportAssignmentEvents).values({ schoolId: school.id, assignmentId: created.id, eventType: "transfer_in", effectiveDate, previousValues: previous, newValues: created, reason: transferReason, createdByUserId: user.id });
        const financialImpact = await applyTransferPolicyB(tx, school.id, user.id, previous, created, effectiveDate, transferReason);
        await writeAudit(tx, school.id, user.id, "assignment", id, "transfer", previous, created, transferReason, { policy: "B", financialImpact, capacityOverrideReason: capacityOverrideReason || null });
        return created;
      });
      return res.status(201).json(newAssignment);
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.post("/api/transport/assignments/:id/state", requireAuth, requireAnyPermission("transport.learners.edit_service", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(transportAssignments, id, school.id);
      if (!previous) return res.status(404).json({ message: "Assignment not found" });
      const parsed = stateInput.parse(req.body);
      const settings = await getOrCreateSettings(school.id);
      const closesService = ["suspended", "paused", "terminated", "completed"].includes(parsed.state);
      const resumesService = parsed.state === "active" && !previous.isActive && ["suspended", "paused"].includes(previous.serviceState);

      const result = await db.transaction(async (tx) => {
        let row: any;
        let refund: any = null;
        if (resumesService) {
          await validateAssignmentSelection(school.id, user.id, previous, previous.id);
          const values: any = { ...previous, id: undefined, startDate: parsed.effectiveDate, endDate: null, isActive: true, serviceState: "active", financialStatus: "pending_first_payment", createdAt: undefined, updatedAt: new Date(), createdByUserId: user.id };
          delete values.id; delete values.createdAt;
          [row] = await tx.insert(transportAssignments).values(values).returning();
          await linkAssignmentNodes(tx, school.id, row);
          await tx.insert(transportAssignmentEvents).values({ schoolId: school.id, assignmentId: row.id, eventType: "resumed", effectiveDate: parsed.effectiveDate, previousValues: previous, newValues: row, reason: parsed.reason, createdByUserId: user.id });
        } else {
          const changes: any = { serviceState: parsed.state, updatedAt: new Date() };
          if (closesService) {
            changes.isActive = false;
            changes.endDate = previousDate(parsed.effectiveDate);
          }
          if (["active_arrears", "suspension_pending"].includes(parsed.state)) changes.financialStatus = "overdue";
          if (parsed.state === "active_payment_plan") changes.financialStatus = "payment_plan";
          [row] = await tx.update(transportAssignments).set(changes).where(eq(transportAssignments.id, id)).returning();
          await tx.insert(transportAssignmentEvents).values({ schoolId: school.id, assignmentId: id, eventType: `state_${parsed.state}`, effectiveDate: parsed.effectiveDate, previousValues: previous, newValues: row, reason: parsed.reason, createdByUserId: user.id });

          if (["suspended", "paused", "terminated"].includes(parsed.state)) {
            const calculation = unusedServiceRefund(previous, parsed.effectiveDate, settings);
            if (calculation.amount > 0) {
              const method = parsed.state === "suspended" ? "credit" : (parsed.refundMethod || "credit");
              [refund] = await tx.insert(transportRefunds).values({
                schoolId: school.id,
                studentId: previous.studentId,
                assignmentId: previous.id,
                refundNumber: numberCode("REF", school.shortCode, Date.now().toString().slice(-6)),
                refundType: parsed.state === "terminated" ? "termination_refund" : "pause_credit",
                amount: String(calculation.amount),
                effectiveDate: parsed.effectiveDate,
                method,
                calculationSnapshot: calculation,
                reason: parsed.reason,
                requestedByUserId: user.id,
              }).returning();
            }
          }
        }
        await writeAudit(tx, school.id, user.id, "assignment", id, resumesService ? "resume" : "state_change", previous, row, parsed.reason, { refundId: refund?.id ?? null });
        return { assignment: row, refund };
      });

      const stateLabel = parsed.state.replaceAll("_", " ");
      await notifyParentForStudent(previous.studentId, school.id, user.id, "Transport service status changed", `The learner's transport service is now ${stateLabel}, effective ${parsed.effectiveDate}.`, parsed.state === "suspended" ? "warning" : "info");
      return res.json(result);
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.post("/api/transport/charges/preview", requireAuth, requireAnyPermission("transport.charges.generate", "transport.create"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const parsed = chargeInput.parse(req.body);
      const settings = await getOrCreateSettings(school.id);
      const period = periodDates(parsed.academicYear, parsed.month);
      const filters = [eq(transportAssignments.schoolId, school.id), lte(transportAssignments.startDate, period.end), or(isNull(transportAssignments.endDate), gte(transportAssignments.endDate, period.start))];
      if (parsed.assignmentIds?.length) filters.push(inArray(transportAssignments.id, parsed.assignmentIds));
      const assignments = await db.select().from(transportAssignments).where(and(...filters));
      const preview = assignments.map((assignment) => {
        const startDay = assignment.startDate >= period.start && assignment.startDate <= period.end ? dayOfMonth(assignment.startDate) : 1;
        const exitDay = assignment.endDate && assignment.endDate >= period.start && assignment.endDate <= period.end ? dayOfMonth(assignment.endDate) : period.days + 1;
        const fullJoin = startDay <= (settings.joiningFullChargeThroughDay ?? 5);
        const serviceStart = fullJoin ? 1 : startDay;
        const serviceEnd = Math.min(period.days, exitDay - 1);
        const serviceDays = Math.max(0, serviceEnd - serviceStart + 1);
        const fee = amount(assignment.agreedFee);
        const calculated = fullJoin && exitDay > period.days ? fee : rounded(fee * serviceDays / period.days);
        return { assignmentId: assignment.id, studentId: assignment.studentId, serviceStartDay: serviceStart, serviceEndDay: serviceEnd, serviceDays, daysInMonth: period.days, amount: calculated, calculationType: calculated === fee ? "full" : "prorated" };
      });
      return res.json({ period, settings: { joiningFullChargeThroughDay: settings.joiningFullChargeThroughDay }, preview, total: rounded(preview.reduce((sum, row) => sum + row.amount, 0)) });
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.post("/api/transport/charges/generate", requireAuth, requireAnyPermission("transport.charges.generate", "transport.create"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = chargeInput.parse(req.body);
      await ensureNotLocked(school.id, parsed.academicYear, parsed.month);
      const settings = await getOrCreateSettings(school.id);
      const period = periodDates(parsed.academicYear, parsed.month);
      const filters = [eq(transportAssignments.schoolId, school.id), lte(transportAssignments.startDate, period.end), or(isNull(transportAssignments.endDate), gte(transportAssignments.endDate, period.start))];
      if (parsed.assignmentIds?.length) filters.push(inArray(transportAssignments.id, parsed.assignmentIds));
      const assignments = await db.select().from(transportAssignments).where(and(...filters));
      let created = 0;
      let skipped = 0;
      await db.transaction(async (tx) => {
        for (const assignment of assignments) {
          const [existing] = await tx.select().from(transportCharges).where(and(
            eq(transportCharges.assignmentId, assignment.id),
            eq(transportCharges.academicYear, parsed.academicYear),
            eq(transportCharges.term, parsed.term),
            eq(transportCharges.month, parsed.month),
          ));
          if (existing) { skipped += 1; continue; }
          const startDay = assignment.startDate >= period.start && assignment.startDate <= period.end ? dayOfMonth(assignment.startDate) : 1;
          const exitDay = assignment.endDate && assignment.endDate >= period.start && assignment.endDate <= period.end ? dayOfMonth(assignment.endDate) : period.days + 1;
          const fullJoin = startDay <= (settings.joiningFullChargeThroughDay ?? 5);
          const serviceStart = fullJoin ? 1 : startDay;
          const serviceEnd = Math.min(period.days, exitDay - 1);
          const serviceDays = Math.max(0, serviceEnd - serviceStart + 1);
          if (!serviceDays) { skipped += 1; continue; }
          const fee = amount(assignment.agreedFee);
          const calculated = fullJoin && exitDay > period.days ? fee : rounded(fee * serviceDays / period.days);
          await tx.insert(transportCharges).values({
            schoolId: school.id,
            studentId: assignment.studentId,
            assignmentId: assignment.id,
            routeId: assignment.routeId,
            vehicleId: assignment.vehicleId,
            academicYear: parsed.academicYear,
            term: parsed.term,
            month: parsed.month,
            servicePeriodStart: `${parsed.academicYear}-${String(parsed.month).padStart(2, "0")}-${String(serviceStart).padStart(2, "0")}`,
            servicePeriodEnd: `${parsed.academicYear}-${String(parsed.month).padStart(2, "0")}-${String(serviceEnd).padStart(2, "0")}`,
            daysInPeriod: period.days,
            chargeableDays: serviceDays,
            calculationType: calculated === fee ? "full" : "prorated",
            calculationSnapshot: { fullFee: fee, serviceStart, serviceEnd, serviceDays, daysInMonth: period.days, joiningFullChargeThroughDay: settings.joiningFullChargeThroughDay, serviceType: assignment.serviceType, oneWayPercent: assignment.oneWayPercentSnapshot },
            amount: String(calculated),
            currencyCode: settings.currencyCode,
            dueDate: parsed.dueDate,
            description: parsed.description || `Transport service for ${period.start.slice(0, 7)}`,
            createdByUserId: user.id,
          });
          created += 1;
        }
        await writeAudit(tx, school.id, user.id, "charge_batch", null, "generate", null, { year: parsed.academicYear, month: parsed.month, created, skipped });
      });
      return res.status(201).json({ created, skipped });
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.post("/api/transport/payments", requireAuth, requireAnyPermission("transport.payments.record", "transport.create"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = paymentInput.parse(req.body);
      const settings = await getOrCreateSettings(school.id);
      const snapshot = await receiptSnapshot(school, parsed.studentId, req, parsed);
      const result = await db.transaction(async (tx) => {
        const receiptNo = await generateReceiptNumber(tx, school);
        const token = verificationToken();
        const [payment] = await tx.insert(transportPayments).values({
          schoolId: school.id,
          studentId: parsed.studentId,
          amount: String(parsed.amount),
          currencyCode: settings.currencyCode,
          paymentDate: parsed.paymentDate,
          paymentMethod: parsed.paymentMethod,
          academicYear: parsed.academicYear,
          term: parsed.term,
          month: parsed.month,
          receiptNo,
          verificationToken: token,
          receiptSnapshot: { ...snapshot, receiptNo, verificationTokenHash: createHash("sha256").update(token).digest("hex") },
          externalReference: parsed.externalReference,
          notes: parsed.notes,
          receivedByUserId: user.id,
        }).returning();
        let remaining = parsed.amount;
        if (parsed.allocationMode !== "future_credit") {
          const candidates = await allocationCandidates(parsed.studentId, school.id, parsed.allocationMode === "specific" ? parsed.chargeIds : undefined);
          for (const charge of candidates) {
            if (remaining <= 0) break;
            const allocated = rounded(Math.min(remaining, charge.outstanding));
            await tx.insert(transportPaymentAllocations).values({
              paymentId: payment.id,
              chargeId: charge.id,
              amount: String(allocated),
              serviceMonth: charge.month,
              serviceYear: charge.academicYear,
              vehicleId: charge.vehicleId,
            });
            remaining = rounded(remaining - allocated);
          }
        }
        await tx.insert(transportReceiptEvents).values({ schoolId: school.id, paymentId: payment.id, eventType: "issued", copyType: "customer_and_service_provider", createdByUserId: user.id, metadata: { receiptNo } });
        const [activeAssignment] = await tx.select().from(transportAssignments).where(and(
          eq(transportAssignments.schoolId, school.id), eq(transportAssignments.studentId, parsed.studentId), eq(transportAssignments.isActive, true),
        )).orderBy(desc(transportAssignments.startDate)).limit(1);
        if (activeAssignment) {
          const financialStatus = remaining > 0 ? "credit" : "paid";
          const serviceState = activeAssignment.serviceState === "pending_start" && activeAssignment.startDate <= isoDate(new Date()) ? "active" : activeAssignment.serviceState;
          await tx.update(transportAssignments).set({ financialStatus, serviceState, updatedAt: new Date() }).where(eq(transportAssignments.id, activeAssignment.id));
        }
        await writeAudit(tx, school.id, user.id, "payment", payment.id, "record", null, { ...payment, unallocatedCredit: remaining });
        return { payment, unallocatedCredit: remaining };
      });
      await notifyParentForStudent(parsed.studentId, school.id, user.id, "Transport payment received", `Transport payment ${result.payment.receiptNo} for ${settings.currencyCode} ${Number(parsed.amount).toFixed(2)} was recorded on ${parsed.paymentDate}.`, "success");
      return res.status(201).json(result);
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.post("/api/transport/payments/:id/verify", requireAuth, requireAnyPermission("transport.payments.verify", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(transportPayments, id, school.id);
      if (!previous || previous.reversedAt) return res.status(404).json({ message: "Active payment not found" });
      if (previous.receivedByUserId === user.id) return res.status(409).json({ message: "The user who recorded a payment cannot also verify it" });
      const [updated] = await db.update(transportPayments).set({ verificationStatus: "verified", verifiedAt: new Date(), verifiedByUserId: user.id }).where(eq(transportPayments.id, id)).returning();
      await writeAudit(db, school.id, user.id, "payment", id, "verify", previous, updated);
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/payments/:id/reverse", requireAuth, requireAnyPermission("transport.payments.reverse", "transport.delete"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const reason = z.object({ reason: z.string().trim().min(3) }).parse(req.body).reason;
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(transportPayments, id, school.id);
      if (!previous || previous.reversedAt) return res.status(404).json({ message: "Active payment not found" });
      const claimUse = await db.select({ id: transportClaimAllocations.id }).from(transportClaimAllocations)
        .innerJoin(transportPaymentAllocations, eq(transportPaymentAllocations.id, transportClaimAllocations.allocationId))
        .where(eq(transportPaymentAllocations.paymentId, id)).limit(1);
      if (claimUse.length) return res.status(409).json({ message: "This receipt has already been included in a claim. Reverse it through a settlement adjustment." });
      const [updated] = await db.transaction(async (tx) => {
        const [row] = await tx.update(transportPayments).set({ status: "reversed", reversedAt: new Date(), reversedByUserId: user.id, reversalReason: reason }).where(eq(transportPayments.id, id)).returning();
        await tx.insert(transportReceiptEvents).values({ schoolId: school.id, paymentId: id, eventType: "reversed", reason, createdByUserId: user.id });
        await writeAudit(tx, school.id, user.id, "payment", id, "reverse", previous, row, reason);
        return [row];
      });
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/receipts/:id", requireAuth, requireAnyPermission("transport.receipts.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      let payment = await assertSchoolRecord(transportPayments, id, school.id);
      if (!payment) return res.status(404).json({ message: "Receipt not found" });
      payment = await ensureReceiptSecurity(payment, school, req);
      const allocatedResult = await db.execute(sql`SELECT COALESCE(SUM(amount),0)::text allocated FROM transport_payment_allocations WHERE payment_id=${id}`);
      const reprints = await db.select().from(transportReceiptEvents).where(and(eq(transportReceiptEvents.paymentId, id), eq(transportReceiptEvents.eventType, "reprint")));
      return res.json({ ...payment, allocatedAmount: allocatedResult.rows[0]?.allocated ?? "0", unallocatedAmount: String(rounded(amount(payment.amount) - amount(allocatedResult.rows[0]?.allocated))), reprintCount: reprints.length });
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/receipts/:id/print", requireAuth, requireAnyPermission("transport.receipts.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).send("Select a school");
      const id = Number(req.params.id);
      let payment = await assertSchoolRecord(transportPayments, id, school.id);
      if (!payment) return res.status(404).send("Receipt not found");
      payment = await ensureReceiptSecurity(payment, school, req);
      const printCountResult = await db.execute(sql`SELECT COUNT(*)::int count FROM transport_receipt_events WHERE payment_id=${id} AND event_type IN ('printed','reprint')`);
      const priorPrintCount = Number(printCountResult.rows[0]?.count ?? 0);
      const eventType = priorPrintCount > 0 ? "reprint" : "printed";
      await db.insert(transportReceiptEvents).values({ schoolId: school.id, paymentId: id, eventType, copyType: "customer_and_service_provider", createdByUserId: user.id, metadata: { printNumber: priorPrintCount + 1 } });
      await writeAudit(db, school.id, user.id, "receipt", id, eventType, null, { receiptNo: payment.receiptNo, printNumber: priorPrintCount + 1 });
      const snapshot = payment.receiptSnapshot as any;
      const verifyUrl = `${req.protocol}://${req.get("host")}/api/public/transport/receipts/${encodeURIComponent(payment.verificationToken)}`;
      const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 150 });
      const allocation = await db.execute(sql`SELECT COALESCE(SUM(amount),0)::text allocated FROM transport_payment_allocations WHERE payment_id=${id}`);
      const allocated = amount(allocation.rows[0]?.allocated);
      const reprint = priorPrintCount > 0;
      const copy = (label: string) => `
        <section class="receipt">
          ${reprint ? '<div class="watermark">REPRINT</div>' : ""}
          <header><div><h1>${escapeHtml(snapshot?.school?.name || school.name)}</h1><div>${escapeHtml(snapshot?.school?.address || school.address || "")}</div><div>${escapeHtml(snapshot?.school?.phone || school.phone || "")}</div></div><div class="copy">${label}</div></header>
          <h2>TRANSPORT RECEIPT</h2>
          <div class="grid">
            <div><b>Receipt No.</b><span>${escapeHtml(payment.receiptNo)}</span></div>
            <div><b>Status</b><span>${escapeHtml(payment.status)}</span></div>
            <div><b>Learner</b><span>${escapeHtml(`${snapshot?.learner?.firstName ?? ""} ${snapshot?.learner?.lastName ?? ""}`)}</span></div>
            <div><b>Admission No.</b><span>${escapeHtml(snapshot?.learner?.admissionNo)}</span></div>
            <div><b>Class</b><span>${escapeHtml(snapshot?.learner?.className)}</span></div>
            <div><b>Payment date</b><span>${escapeHtml(payment.paymentDate)}</span></div>
            <div><b>Route</b><span>${escapeHtml(snapshot?.assignment?.routeName)}</span></div>
            <div><b>Pickup / destination</b><span>${escapeHtml(snapshot?.assignment?.pickupName || snapshot?.assignment?.dropoffName || "—")}</span></div>
            <div><b>Vehicle</b><span>${escapeHtml(snapshot?.assignment?.vehicleRegistration || "—")}</span></div>
            <div><b>Driver</b><span>${escapeHtml(snapshot?.assignment?.driverName || "—")}</span></div>
            <div><b>Service</b><span>${escapeHtml(snapshot?.assignment?.serviceType || "—")}</span></div>
            <div><b>Payment method</b><span>${escapeHtml(payment.paymentMethod)}</span></div>
          </div>
          <div class="amount">USD ${amount(payment.amount).toFixed(2)}</div>
          <div class="small">Allocated: USD ${allocated.toFixed(2)} · Learner credit: USD ${rounded(amount(payment.amount) - allocated).toFixed(2)}</div>
          <footer><div><b>Received by:</b> ${escapeHtml(snapshot?.receivedBy)}<br/><b>Transport Manager:</b> ${escapeHtml(snapshot?.transportManagerName || "Not configured")}<br/><b>Issued:</b> ${escapeHtml(snapshot?.issuedAt)}</div><div class="qr"><img src="${qr}"/><small>Scan to verify</small></div></footer>
          <p class="notice">This copy does not independently authorise a claim or payout. Claim eligibility is verified in the FCGS Portal.</p>
        </section>`;
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(payment.receiptNo)}</title><style>
        @page{size:A4;margin:10mm}body{font-family:Arial,sans-serif;color:#111;margin:0}.receipt{position:relative;border:1.5px solid #222;padding:16px;margin-bottom:12px;min-height:122mm;box-sizing:border-box;overflow:hidden}.receipt:first-child{border-bottom-style:dashed}header{display:flex;justify-content:space-between;gap:20px;font-size:12px}h1{font-size:19px;margin:0 0 4px}h2{text-align:center;font-size:16px;letter-spacing:1.2px;margin:13px 0}.copy{font-weight:bold;border:1px solid #111;padding:7px;height:max-content}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 20px;font-size:12px}.grid div{display:flex;justify-content:space-between;border-bottom:1px dotted #bbb;padding-bottom:3px}.grid span{text-align:right}.amount{text-align:center;font-size:28px;font-weight:bold;margin:14px 0 4px}.small{text-align:center;font-size:11px}footer{display:flex;justify-content:space-between;align-items:end;margin-top:10px;font-size:11px}.qr{text-align:center}.qr img{width:75px;display:block}.notice{font-size:9px;border-top:1px solid #ddd;padding-top:6px}.watermark{position:absolute;transform:rotate(-25deg);font-size:82px;font-weight:bold;color:rgba(180,0,0,.09);top:42%;left:17%}@media print{button{display:none}}</style></head><body>${copy("CUSTOMER COPY")}${copy("SERVICE PROVIDER COPY")}</body></html>`;
      const pdf = await renderHtmlPdf({ html, pdfOptions: { format: "A4", printBackground: true, preferCSSPageSize: true } });
      const filename = reportPdfFilename(`Transport_Receipt_${payment.receiptNo}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`);
      res.send(pdf);
    } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : "Unable to generate receipt PDF" }); }
  });

  app.get("/api/public/transport/receipts/:token", async (req, res) => {
    try {
      const [payment] = await db.select({ id: transportPayments.id, schoolId: transportPayments.schoolId, amount: transportPayments.amount, paymentDate: transportPayments.paymentDate, receiptNo: transportPayments.receiptNo, status: transportPayments.status, receiptSnapshot: transportPayments.receiptSnapshot, reversedAt: transportPayments.reversedAt })
        .from(transportPayments).where(eq(transportPayments.verificationToken, req.params.token));
      if (!payment) return res.status(404).json({ valid: false, message: "Receipt not found" });
      const [school] = await db.select({ name: schools.name }).from(schools).where(eq(schools.id, payment.schoolId));
      const snapshot = payment.receiptSnapshot as any;
      const claims = await db.execute(sql`
        SELECT DISTINCT c.claim_number AS "claimNumber", c.status, p.payout_number AS "payoutNumber", p.payment_date AS "payoutDate"
        FROM transport_payment_allocations pa
        JOIN transport_claim_allocations ca ON ca.allocation_id=pa.id
        JOIN transport_claims c ON c.id=ca.claim_id
        LEFT JOIN transport_payouts p ON p.claim_id=c.id
        WHERE pa.payment_id=${payment.id}
      `);
      return res.json({
        valid: !payment.reversedAt,
        receiptNo: payment.receiptNo,
        school: school?.name,
        learner: snapshot?.learner ? `${String(snapshot.learner.firstName ?? "").slice(0, 1)}*** ${String(snapshot.learner.lastName ?? "").slice(0, 1)}***` : undefined,
        amount: payment.amount,
        paymentDate: payment.paymentDate,
        status: payment.reversedAt ? "reversed" : payment.status,
        claimUsage: claims.rows,
      });
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/payment-plans", requireAuth, requireAnyPermission("transport.payment_plans.manage", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = paymentPlanInput.parse(req.body);
      const previousAssignment = await assertSchoolRecord(transportAssignments, parsed.assignmentId, school.id);
      if (!previousAssignment || previousAssignment.studentId !== parsed.studentId) return res.status(404).json({ message: "Assignment not found" });
      const created = await db.transaction(async (tx) => {
        let assignment = previousAssignment;
        if (!previousAssignment.isActive && ["suspended", "paused"].includes(previousAssignment.serviceState)) {
          const values: any = { ...previousAssignment, id: undefined, startDate: parsed.startDate, endDate: null, isActive: true, serviceState: "active_payment_plan", financialStatus: "payment_plan", createdAt: undefined, updatedAt: new Date(), createdByUserId: user.id };
          delete values.id; delete values.createdAt;
          [assignment] = await tx.insert(transportAssignments).values(values).returning();
          await linkAssignmentNodes(tx, school.id, assignment);
          await tx.insert(transportAssignmentEvents).values({ schoolId: school.id, assignmentId: assignment.id, eventType: "resumed_payment_plan", effectiveDate: parsed.startDate, previousValues: previousAssignment, newValues: assignment, reason: "Approved payment plan", createdByUserId: user.id });
        }
        const [plan] = await tx.insert(transportPaymentPlans).values({
          schoolId: school.id,
          studentId: parsed.studentId,
          assignmentId: assignment.id,
          planNumber: numberCode("TPLAN", school.shortCode, Date.now().toString().slice(-6)),
          coveredAmount: String(parsed.coveredAmount),
          instalmentAmount: String(parsed.instalmentAmount),
          frequency: parsed.frequency,
          startDate: parsed.startDate,
          finalDueDate: parsed.finalDueDate,
          graceDays: parsed.graceDays,
          payerAcknowledgement: parsed.payerAcknowledgement,
          notes: parsed.notes,
          approvedByUserId: user.id,
          createdByUserId: user.id,
        }).returning();
        for (const instalment of parsed.instalments ?? []) {
          await tx.insert(transportPaymentPlanInstalments).values({ planId: plan.id, dueDate: instalment.dueDate, amount: String(instalment.amount) });
        }
        await tx.update(transportAssignments).set({ serviceState: "active_payment_plan", financialStatus: "payment_plan", updatedAt: new Date() }).where(eq(transportAssignments.id, assignment.id));
        await writeAudit(tx, school.id, user.id, "payment_plan", plan.id, "create", null, plan);
        return { plan, assignmentId: assignment.id };
      });
      await notifyParentForStudent(parsed.studentId, school.id, user.id, "Transport payment plan approved", `Payment plan ${created.plan.planNumber} starts on ${parsed.startDate}. Instalments are ${Number(parsed.instalmentAmount).toFixed(2)} ${created.plan.frequency}.`, "info");
      return res.status(201).json(created);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/refunds", requireAuth, requireAnyPermission("transport.refunds.request", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = refundInput.parse(req.body);
      const [created] = await db.insert(transportRefunds).values({ ...parsed, amount: String(parsed.amount), schoolId: school.id, refundNumber: numberCode("REF", school.shortCode, Date.now().toString().slice(-6)), requestedByUserId: user.id }).returning();
      await writeAudit(db, school.id, user.id, "refund", created.id, "request", null, created, parsed.reason);
      return res.status(201).json(created);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/refunds/:id/approve", requireAuth, requireAnyPermission("transport.refunds.approve", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportRefunds, id, school.id);
      if (!previous) return res.status(404).json({ message: "Refund not found" });
      if (previous.status !== "requested") return res.status(409).json({ message: "Only requested refunds can be approved" });
      if (previous.requestedByUserId === user.id) return res.status(409).json({ message: "The refund requester cannot approve the same refund" });
      const [updated] = await db.transaction(async (tx) => {
        const [row] = await tx.update(transportRefunds).set({ status: "approved", approvedByUserId: user.id, approvedAt: new Date() }).where(eq(transportRefunds.id, id)).returning();
        if (row.method === "credit") await tx.insert(transportAccountAdjustments).values({ schoolId: school.id, studentId: row.studentId, assignmentId: row.assignmentId, adjustmentType: row.refundType, direction: "credit", amount: row.amount, effectiveDate: row.effectiveDate, reason: row.reason, approvedByUserId: user.id, createdByUserId: user.id });
        if (row.assignmentId) {
          const [assignment] = await tx.select().from(transportAssignments).where(and(eq(transportAssignments.id, row.assignmentId), eq(transportAssignments.schoolId, school.id)));
          if (assignment?.vehicleId) {
            const paidOut = await tx.execute(sql`
              SELECT COALESCE(SUM(ca.amount),0)::text AS amount
              FROM transport_claim_allocations ca
              JOIN transport_payment_allocations pa ON pa.id=ca.allocation_id
              JOIN transport_charges c ON c.id=pa.charge_id
              JOIN transport_claims cl ON cl.id=ca.claim_id
              JOIN transport_payouts po ON po.claim_id=cl.id AND po.status IN ('partially_paid','paid')
              WHERE c.assignment_id=${row.assignmentId}
            `);
            const recoverable = rounded(Math.min(amount(row.amount), amount(paidOut.rows[0]?.amount)));
            if (recoverable > 0) {
              const effective = dateParts(row.effectiveDate);
              await tx.insert(transportProviderAdjustments).values({
                schoolId: school.id,
                vehicleId: assignment.vehicleId,
                adjustmentType: "refund_recovery",
                direction: "deduction",
                amount: String(recoverable),
                currencyCode: (await getOrCreateSettings(school.id, tx)).currencyCode,
                serviceYear: effective.year,
                serviceMonth: effective.month,
                applyYear: effective.year,
                applyMonth: effective.month,
                assignmentId: assignment.id,
                refundId: row.id,
                reason: `Recovery for refund ${row.refundNumber}: ${row.reason}`,
                metadata: { originalRefundAmount: row.amount, paidOutServiceAmount: paidOut.rows[0]?.amount },
                createdByUserId: user.id,
              });
            }
          }
        }
        await writeAudit(tx, school.id, user.id, "refund", id, "approve", previous, row, row.reason);
        return [row];
      });
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/refunds/:id/pay", requireAuth, requireAnyPermission("transport.refunds.pay", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportRefunds, id, school.id);
      if (!previous || previous.status !== "approved") return res.status(409).json({ message: "Refund must be approved first" });
      const reference = z.object({ externalReference: optionalText }).parse(req.body).externalReference;
      const [updated] = await db.update(transportRefunds).set({ status: "paid", paidByUserId: user.id, paidAt: new Date(), externalReference: reference }).where(eq(transportRefunds.id, id)).returning();
      await writeAudit(db, school.id, user.id, "refund", id, "pay", previous, updated, updated.reason);
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/cashups", requireAuth, requireAnyPermission("transport.cashups.prepare", "transport.create"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = cashupInput.parse(req.body);
      const payments = await db.select().from(transportPayments).where(and(eq(transportPayments.schoolId, school.id), inArray(transportPayments.id, parsed.paymentIds), isNull(transportPayments.reversedAt)));
      if (payments.length !== parsed.paymentIds.length) return res.status(400).json({ message: "One or more payments are invalid or already reversed" });
      const expectedCash = rounded(payments.filter((p) => p.paymentMethod === "cash").reduce((sum, p) => sum + amount(p.amount), 0));
      const expectedNonCash = rounded(payments.filter((p) => p.paymentMethod !== "cash").reduce((sum, p) => sum + amount(p.amount), 0));
      const variance = rounded(parsed.actualCash + parsed.actualNonCash - expectedCash - expectedNonCash);
      const created = await db.transaction(async (tx) => {
        const [cashup] = await tx.insert(transportCashups).values({ schoolId: school.id, cashupNumber: numberCode("CASH", school.shortCode, Date.now().toString().slice(-6)), cashupDate: parsed.cashupDate, cashierUserId: user.id, expectedCash: String(expectedCash), actualCash: String(parsed.actualCash), expectedNonCash: String(expectedNonCash), actualNonCash: String(parsed.actualNonCash), variance: String(variance), depositReference: parsed.depositReference, notes: parsed.notes }).returning();
        for (const payment of payments) await tx.insert(transportCashupPayments).values({ cashupId: cashup.id, paymentId: payment.id });
        await writeAudit(tx, school.id, user.id, "cashup", cashup.id, "create", null, cashup);
        return cashup;
      });
      return res.status(201).json(created);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/cashups/:id/submit", requireAuth, requireAnyPermission("transport.cashups.prepare", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportCashups, id, school.id);
      if (!previous) return res.status(404).json({ message: "Cash-up not found" });
      const [updated] = await db.update(transportCashups).set({ status: "submitted", submittedAt: new Date() }).where(eq(transportCashups.id, id)).returning();
      await writeAudit(db, school.id, user.id, "cashup", id, "submit", previous, updated);
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/cashups/:id/verify", requireAuth, requireAnyPermission("transport.cashups.verify", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportCashups, id, school.id);
      if (!previous || previous.status !== "submitted") return res.status(409).json({ message: "Only submitted cash-ups can be verified" });
      if (previous.cashierUserId === user.id) return res.status(409).json({ message: "The cashier cannot verify their own cash-up" });
      const [updated] = await db.transaction(async (tx) => {
        const [row] = await tx.update(transportCashups).set({ status: "verified", verifiedAt: new Date(), verifiedByUserId: user.id }).where(eq(transportCashups.id, id)).returning();
        const linked = await tx.select({ paymentId: transportCashupPayments.paymentId }).from(transportCashupPayments).where(eq(transportCashupPayments.cashupId, id));
        if (linked.length) await tx.update(transportPayments).set({ verificationStatus: "reconciled", reconciledAt: new Date(), reconciledByUserId: user.id }).where(inArray(transportPayments.id, linked.map((item) => item.paymentId)));
        await writeAudit(tx, school.id, user.id, "cashup", id, "verify", previous, row);
        return [row];
      });
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/cashups/:id/print", requireAuth, requireAnyPermission("transport.cashups.view", "transport.payments.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const cashup = await assertSchoolRecord(transportCashups, Number(req.params.id), school.id);
      if (!cashup) return res.status(404).json({ message: "Cash-up not found" });
      const payments = await db.execute(sql`
        SELECT p.receipt_no AS "receiptNo", p.payment_date AS "paymentDate", p.payment_method AS "paymentMethod", p.amount::text,
               s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo"
        FROM transport_cashup_payments cp
        JOIN transport_payments p ON p.id=cp.payment_id
        LEFT JOIN students s ON s.id=p.student_id
        WHERE cp.cashup_id=${cashup.id}
        ORDER BY p.payment_date, p.receipt_no
      `);
      const people = await db.execute(sql`
        SELECT id, first_name AS "firstName", last_name AS "lastName" FROM users
        WHERE id IN (${cashup.cashierUserId}, ${cashup.verifiedByUserId || -1})
      `);
      const personName = (id: number | null) => {
        const row = people.rows.find((item: any) => Number(item.id) === Number(id));
        return row ? `${row.firstName || ""} ${row.lastName || ""}`.trim() : (id ? `User #${id}` : "—");
      };
      const paymentRows = payments.rows.map((payment: any) => `<tr><td>${escapeHtml(payment.receiptNo)}</td><td>${escapeHtml(`${payment.firstName || ""} ${payment.lastName || ""}`.trim())}<div class="small">${escapeHtml(payment.admissionNo || "")}</div></td><td>${escapeHtml(payment.paymentDate)}</td><td>${escapeHtml(String(payment.paymentMethod || "").replaceAll("_", " "))}</td><td>USD ${amount(payment.amount).toFixed(2)}</td></tr>`).join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(cashup.cashupNumber)}</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;color:#111}h1,h2{text-align:center;margin:0 0 8px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;border:1px solid #bbb;padding:12px;margin:16px 0}.totals{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:15px 0}.box{border:1px solid #bbb;padding:10px}.box b{display:block;font-size:11px;color:#555}.box span{font-size:17px;font-weight:bold}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #bbb;padding:7px;text-align:left}th{background:#eee}.small{font-size:9px;color:#555}.sign{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:45px}.line{border-top:1px solid #111;padding-top:5px}</style></head><body><h1>${escapeHtml(school.name)}</h1><h2>DAILY TRANSPORT CASH-UP & RECONCILIATION</h2><div class="meta"><div><b>Cash-up number:</b> ${escapeHtml(cashup.cashupNumber)}</div><div><b>Status:</b> ${escapeHtml(cashup.status)}</div><div><b>Cash-up date:</b> ${escapeHtml(cashup.cashupDate)}</div><div><b>Cashier:</b> ${escapeHtml(personName(cashup.cashierUserId))}</div><div><b>Deposit / reference:</b> ${escapeHtml(cashup.depositReference || "—")}</div><div><b>Verified by:</b> ${escapeHtml(personName(cashup.verifiedByUserId))}</div></div><div class="totals"><div class="box"><b>Expected total</b><span>USD ${rounded(amount(cashup.expectedCash) + amount(cashup.expectedNonCash)).toFixed(2)}</span></div><div class="box"><b>Actual total</b><span>USD ${rounded(amount(cashup.actualCash) + amount(cashup.actualNonCash)).toFixed(2)}</span></div><div class="box"><b>Variance</b><span>USD ${amount(cashup.variance).toFixed(2)}</span></div></div><table><thead><tr><th>Receipt</th><th>Learner</th><th>Payment date</th><th>Method</th><th>Amount</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="5">No linked payments.</td></tr>'}</tbody></table><p><b>Notes:</b> ${escapeHtml(cashup.notes || "—")}</p><div class="sign"><div class="line">Cashier / preparer</div><div class="line">Accounts verification</div></div></body></html>`;
      const pdf = await renderHtmlPdf({ html, pdfOptions: { format: "A4", printBackground: true, preferCSSPageSize: true } });
      const filename = reportPdfFilename(`Transport_Cashup_${cashup.cashupNumber}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`);
      res.send(pdf);
    } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : "Unable to generate cash-up PDF" }); }
  });

  app.post("/api/transport/subscriptions", requireAuth, requireAnyPermission("transport.settings.manage", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = subscriptionInput.parse(req.body);
      const [created] = await db.insert(transportSubscriptionRules).values({ ...parsed, value: String(parsed.value), minimumAmount: parsed.minimumAmount == null ? null : String(parsed.minimumAmount), maximumAmount: parsed.maximumAmount == null ? null : String(parsed.maximumAmount), schoolId: school.id, createdByUserId: user.id }).returning();
      await writeAudit(db, school.id, user.id, "subscription_rule", created.id, "create", null, created);
      return res.status(201).json(created);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/penalties", requireAuth, requireAnyPermission("transport.penalties.manage", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = penaltyInput.parse(req.body);
      const [created] = await db.insert(transportPenalties).values({ ...parsed, amount: String(parsed.amount), schoolId: school.id, penaltyNumber: numberCode("PEN", school.shortCode, Date.now().toString().slice(-6)), approvedByUserId: user.id, createdByUserId: user.id }).returning();
      await writeAudit(db, school.id, user.id, "penalty", created.id, "create", null, created, created.reason);
      return res.status(201).json(created);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/advances", requireAuth, requireAnyPermission("transport.advances.request", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = advanceInput.parse(req.body);
      const vehicle = await assertSchoolRecord(transportVehicles, parsed.vehicleId, school.id);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      const [created] = await db.insert(transportAdvances).values({ ...parsed, disbursementDate: null, disbursementReference: null, amount: String(parsed.amount), outstandingAmount: String(parsed.amount), recoveryValue: String(parsed.recoveryValue), minimumOwnerTakeHome: String(parsed.minimumOwnerTakeHome), maximumMonthlyRecovery: parsed.maximumMonthlyRecovery == null ? null : String(parsed.maximumMonthlyRecovery), schoolId: school.id, advanceNumber: numberCode("ADV", school.shortCode, Date.now().toString().slice(-6)), status: "requested", createdByUserId: user.id }).returning();
      await writeAudit(db, school.id, user.id, "advance", created.id, "request", null, created, created.purpose);
      return res.status(201).json(created);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/advances/:id/approve", requireAuth, requireAnyPermission("transport.advances.approve", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportAdvances, id, school.id);
      if (!previous || previous.status !== "requested") return res.status(409).json({ message: "Only requested advances can be approved" });
      if (previous.createdByUserId === user.id) return res.status(409).json({ message: "The advance requester cannot approve the same advance" });
      const [updated] = await db.update(transportAdvances).set({ status: "approved", approvedByUserId: user.id, approvedAt: new Date() }).where(eq(transportAdvances.id, id)).returning();
      await writeAudit(db, school.id, user.id, "advance", id, "approve", previous, updated, updated.purpose);
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/advances/:id/reject", requireAuth, requireAnyPermission("transport.advances.approve", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const reason = z.object({ reason: z.string().trim().min(3) }).parse(req.body).reason;
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportAdvances, id, school.id);
      if (!previous || previous.status !== "requested") return res.status(409).json({ message: "Only requested advances can be rejected" });
      const [updated] = await db.update(transportAdvances).set({ status: "rejected", rejectedByUserId: user.id, rejectedAt: new Date(), rejectionReason: reason }).where(eq(transportAdvances.id, id)).returning();
      await writeAudit(db, school.id, user.id, "advance", id, "reject", previous, updated, reason);
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/advances/:id/disburse", requireAuth, requireAnyPermission("transport.advances.disburse", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = z.object({ disbursementDate: dateString, disbursementReference: z.string().trim().min(1) }).parse(req.body);
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportAdvances, id, school.id);
      if (!previous || previous.status !== "approved") return res.status(409).json({ message: "Only approved advances can be disbursed" });
      if (previous.approvedByUserId === user.id) return res.status(409).json({ message: "The advance approver cannot also record disbursement" });
      const [updated] = await db.update(transportAdvances).set({ status: "disbursed", disbursementDate: parsed.disbursementDate, disbursementReference: parsed.disbursementReference, disbursedByUserId: user.id, disbursedAt: new Date() }).where(eq(transportAdvances.id, id)).returning();
      await writeAudit(db, school.id, user.id, "advance", id, "disburse", previous, updated, parsed.disbursementReference);
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/incidents", requireAuth, requireAnyPermission("transport.incidents.manage", "transport.create"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = incidentInput.parse(req.body);
      const incidentValues: any = { ...parsed, occurredAt: new Date(parsed.occurredAt), latitude: parsed.latitude == null ? null : String(parsed.latitude), longitude: parsed.longitude == null ? null : String(parsed.longitude), schoolId: school.id, incidentNumber: numberCode("INC", school.shortCode, Date.now().toString().slice(-6)), reportedByUserId: user.id };
      const [created] = await db.insert(transportIncidents).values(incidentValues).returning();
      await writeAudit(db, school.id, user.id, "incident", created.id, "report", null, created, created.description);
      return res.status(201).json(created);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/claims/generate", requireAuth, requireAnyPermission("transport.claims.generate", "transport.create"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = claimInput.parse(req.body);
      await ensureNotLocked(school.id, parsed.serviceYear, parsed.serviceMonth);
      const vehicle = await assertSchoolRecord(transportVehicles, parsed.vehicleId, school.id);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      const settings = await getOrCreateSettings(school.id);
      const eligibility = settings.requireCashupForClaim
        ? sql`p.verification_status='reconciled'`
        : sql`p.verification_status IN ('verified','reconciled')`;
      const candidatesResult = await db.execute(sql`
        SELECT pa.id, pa.amount, pa.service_year AS "serviceYear", pa.service_month AS "serviceMonth"
        FROM transport_payment_allocations pa
        JOIN transport_payments p ON p.id=pa.payment_id
        LEFT JOIN transport_claim_allocations ca ON ca.allocation_id=pa.id
        WHERE p.school_id=${school.id} AND pa.vehicle_id=${parsed.vehicleId} AND p.reversed_at IS NULL
          AND ${eligibility} AND ca.id IS NULL
          AND (pa.service_year < ${parsed.serviceYear} OR (pa.service_year=${parsed.serviceYear} AND pa.service_month <= ${parsed.serviceMonth}))
      `);
      const candidates = candidatesResult.rows as any[];
      const currentPeriodAmount = rounded(candidates.filter((row) => Number(row.serviceYear) === parsed.serviceYear && Number(row.serviceMonth) === parsed.serviceMonth).reduce((sum, row) => sum + amount(row.amount), 0));
      const priorPeriodAmount = rounded(candidates.reduce((sum, row) => sum + amount(row.amount), 0) - currentPeriodAmount);
      const providerAdjustments = await db.select().from(transportProviderAdjustments).where(and(
        eq(transportProviderAdjustments.schoolId, school.id),
        eq(transportProviderAdjustments.vehicleId, parsed.vehicleId),
        eq(transportProviderAdjustments.status, "pending"),
        or(
          lte(transportProviderAdjustments.applyYear, parsed.serviceYear - 1),
          and(eq(transportProviderAdjustments.applyYear, parsed.serviceYear), lte(transportProviderAdjustments.applyMonth, parsed.serviceMonth)),
        ),
      )).orderBy(asc(transportProviderAdjustments.applyYear), asc(transportProviderAdjustments.applyMonth), asc(transportProviderAdjustments.id));
      const providerAdditions = rounded(providerAdjustments.filter((row) => row.direction === "addition").reduce((sum, row) => sum + amount(row.amount), 0));
      const gross = rounded(currentPeriodAmount + priorPeriodAmount + providerAdditions);
      const subscriptionRules = await db.select().from(transportSubscriptionRules).where(and(
        eq(transportSubscriptionRules.schoolId, school.id),
        eq(transportSubscriptionRules.isActive, true),
        or(isNull(transportSubscriptionRules.vehicleId), eq(transportSubscriptionRules.vehicleId, parsed.vehicleId)),
        lte(transportSubscriptionRules.effectiveFrom, `${parsed.serviceYear}-${String(parsed.serviceMonth).padStart(2, "0")}-01`),
        or(isNull(transportSubscriptionRules.effectiveTo), gte(transportSubscriptionRules.effectiveTo, `${parsed.serviceYear}-${String(parsed.serviceMonth).padStart(2, "0")}-01`)),
      )).orderBy(desc(transportSubscriptionRules.vehicleId), desc(transportSubscriptionRules.effectiveFrom)).limit(1);
      const deductions: Array<{ type: string; sourceId?: number; description: string; amount: number; priority: number }> = [];
      if (subscriptionRules[0]) {
        const rule = subscriptionRules[0];
        let value = rule.ruleType === "fixed" ? amount(rule.value) : rounded(gross * amount(rule.value) / 100);
        if (rule.minimumAmount != null) value = Math.max(value, amount(rule.minimumAmount));
        if (rule.maximumAmount != null) value = Math.min(value, amount(rule.maximumAmount));
        deductions.push({ type: "subscription", sourceId: rule.id, description: "Vehicle subscription fee", amount: rounded(value), priority: deductionPriority(settings, "subscription") });
      }
      const penalties = await db.select().from(transportPenalties).where(and(eq(transportPenalties.schoolId, school.id), eq(transportPenalties.vehicleId, parsed.vehicleId), eq(transportPenalties.effectiveYear, parsed.serviceYear), eq(transportPenalties.effectiveMonth, parsed.serviceMonth), eq(transportPenalties.status, "approved")));
      for (const penalty of penalties) deductions.push({ type: "penalty", sourceId: penalty.id, description: `${penalty.category}: ${penalty.reason}`, amount: amount(penalty.amount), priority: deductionPriority(settings, "penalty") });
      const advances = await db.select().from(transportAdvances).where(and(eq(transportAdvances.schoolId, school.id), eq(transportAdvances.vehicleId, parsed.vehicleId), gtZero(transportAdvances.outstandingAmount), inArray(transportAdvances.status, ["disbursed", "recovering"])));
      let availableAfterMandatory = Math.max(0, gross - deductions.reduce((sum, item) => sum + item.amount, 0));
      for (const advance of advances) {
        if (parsed.serviceYear < advance.recoveryStartYear || (parsed.serviceYear === advance.recoveryStartYear && parsed.serviceMonth < advance.recoveryStartMonth)) continue;
        const outstanding = amount(advance.outstandingAmount);
        const protectedAmount = amount(advance.minimumOwnerTakeHome);
        const recoverablePool = Math.max(0, availableAfterMandatory - protectedAmount);
        let recovery = advance.recoveryMethod === "percentage" ? rounded(gross * amount(advance.recoveryValue) / 100)
          : advance.recoveryMethod === "full_available" ? recoverablePool
            : amount(advance.recoveryValue);
        if (advance.maximumMonthlyRecovery != null) recovery = Math.min(recovery, amount(advance.maximumMonthlyRecovery));
        recovery = rounded(Math.min(recovery, outstanding, recoverablePool));
        if (recovery > 0) {
          deductions.push({ type: "advance", sourceId: advance.id, description: `Advance recovery ${advance.advanceNumber}`, amount: recovery, priority: deductionPriority(settings, "advance") });
          availableAfterMandatory = Math.max(0, availableAfterMandatory - recovery);
        }
      }
      for (const adjustment of providerAdjustments.filter((row) => row.direction === "deduction")) {
        deductions.push({
          type: adjustment.adjustmentType === "refund_recovery" ? "refund" : "other",
          sourceId: adjustment.id,
          description: adjustment.reason,
          amount: amount(adjustment.amount),
          priority: deductionPriority(settings, adjustment.adjustmentType === "refund_recovery" ? "refund" : "other"),
        });
      }
      const deductionAmount = rounded(Math.min(gross, deductions.reduce((sum, item) => sum + item.amount, 0)));
      const net = rounded(Math.max(0, gross - deductionAmount));
      const created = await db.transaction(async (tx) => {
        const [claim] = await tx.insert(transportClaims).values({ schoolId: school.id, vehicleId: parsed.vehicleId, ownerId: vehicle.ownerId, driverId: vehicle.driverId, claimNumber: numberCode("CLM", school.shortCode, Date.now().toString().slice(-6)), serviceYear: parsed.serviceYear, serviceMonth: parsed.serviceMonth, currentPeriodAmount: String(currentPeriodAmount), priorPeriodAmount: String(priorPeriodAmount), grossAmount: String(gross), deductionAmount: String(deductionAmount), netAmount: String(net), notes: parsed.notes, preparedByUserId: user.id }).returning();
        for (const candidate of candidates) await tx.insert(transportClaimAllocations).values({ claimId: claim.id, allocationId: Number(candidate.id), amount: String(candidate.amount) });
        for (const deduction of deductions) await tx.insert(transportClaimDeductions).values({ claimId: claim.id, deductionType: deduction.type, sourceId: deduction.sourceId, description: deduction.description, amount: String(deduction.amount), priority: deduction.priority });
        if (providerAdjustments.length) {
          await tx.update(transportProviderAdjustments).set({ status: "applied", claimId: claim.id }).where(inArray(transportProviderAdjustments.id, providerAdjustments.map((row) => row.id)));
        }
        await writeAudit(tx, school.id, user.id, "claim", claim.id, "generate", null, { claim, allocations: candidates.length, providerAdditions, providerAdjustments: providerAdjustments.length, deductions });
        return claim;
      });
      return res.status(201).json(created);
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/claims/:id/print", requireAuth, requireAnyPermission("transport.claims.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).send("Select a school");
      const claim = await assertSchoolRecord(transportClaims, Number(req.params.id), school.id);
      if (!claim) return res.status(404).send("Claim not found");
      const [vehicle, owner, driver] = await Promise.all([
        assertSchoolRecord(transportVehicles, claim.vehicleId, school.id),
        claim.ownerId ? assertSchoolRecord(transportOwners, claim.ownerId, school.id) : Promise.resolve(null),
        claim.driverId ? assertSchoolRecord(transportDrivers, claim.driverId, school.id) : Promise.resolve(null),
      ]);
      const details = await db.execute(sql`
        SELECT ca.amount, p.receipt_no AS "receiptNo", p.payment_date AS "paymentDate", p.payment_method AS "paymentMethod",
          c.service_period_start AS "serviceStart", c.service_period_end AS "serviceEnd", c.month AS "serviceMonth", c.academic_year AS "serviceYear",
          s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo", cl.class_name AS "className",
          r.name AS "routeName", COALESCE(sp.name,dsp.name,'—') AS "stopName", a.service_type AS "serviceType"
        FROM transport_claim_allocations ca
        JOIN transport_payment_allocations pa ON pa.id=ca.allocation_id
        JOIN transport_payments p ON p.id=pa.payment_id
        JOIN transport_charges c ON c.id=pa.charge_id
        JOIN transport_assignments a ON a.id=c.assignment_id
        JOIN students s ON s.id=c.student_id
        LEFT JOIN classes cl ON cl.id=s.class_id
        JOIN transport_routes r ON r.id=c.route_id
        LEFT JOIN transport_service_points sp ON sp.id=a.pickup_service_point_id
        LEFT JOIN transport_service_points dsp ON dsp.id=a.dropoff_service_point_id
        WHERE ca.claim_id=${claim.id}
        ORDER BY s.last_name, s.first_name, p.payment_date, p.receipt_no
      `);
      const deductions = await db.select().from(transportClaimDeductions).where(eq(transportClaimDeductions.claimId, claim.id)).orderBy(asc(transportClaimDeductions.priority));
      const detailRows = (details.rows as any[]).map((row) => `<tr><td>${escapeHtml(`${row.firstName} ${row.lastName}`)}</td><td>${escapeHtml(row.admissionNo)}</td><td>${escapeHtml(row.className)}</td><td>${escapeHtml(row.routeName)}</td><td>${escapeHtml(row.stopName)}</td><td>${escapeHtml(row.serviceType)}</td><td>${escapeHtml(row.receiptNo)}</td><td>${escapeHtml(row.paymentDate)}</td><td>USD ${amount(row.amount).toFixed(2)}</td></tr>`).join("");
      const deductionRows = deductions.map((row) => `<tr><td>${escapeHtml(row.description)}</td><td>USD ${amount(row.amount).toFixed(2)}</td></tr>`).join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(claim.claimNumber)}</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial;color:#111;font-size:10px}h1,h2{text-align:center;margin:4px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;border:1px solid #222;padding:10px;margin:10px 0}.meta div{border-bottom:1px dotted #aaa;padding:3px}table{width:100%;border-collapse:collapse;margin-top:9px}td,th{border:1px solid #aaa;padding:5px;text-align:left}th{background:#eee}.summary{margin-left:auto;width:42%}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:35px}.line{border-top:1px solid #111;padding-top:4px}.small{font-size:9px}</style></head><body><h1>${escapeHtml(school.name)}</h1><h2>TRANSPORT SERVICE PROVIDER CLAIM FORM</h2><div class="meta"><div><b>Claim:</b> ${escapeHtml(claim.claimNumber)}</div><div><b>Status:</b> ${escapeHtml(claim.status)}</div><div><b>Service month:</b> ${claim.serviceYear}-${String(claim.serviceMonth).padStart(2,"0")}</div><div><b>Vehicle:</b> ${escapeHtml(vehicle?.registrationNumber)}</div><div><b>Owner:</b> ${escapeHtml(owner?.name || "—")}</div><div><b>Driver:</b> ${escapeHtml(driver ? `${driver.firstName} ${driver.lastName}` : "—")}</div><div><b>Current-period collections:</b> USD ${amount(claim.currentPeriodAmount).toFixed(2)}</div><div><b>Prior-period collections:</b> USD ${amount(claim.priorPeriodAmount).toFixed(2)}</div></div><table><thead><tr><th>Learner</th><th>Admission</th><th>Class</th><th>Route</th><th>Stop</th><th>Service</th><th>Receipt</th><th>Payment date</th><th>Eligible amount</th></tr></thead><tbody>${detailRows || '<tr><td colspan="9">No eligible allocations.</td></tr>'}</tbody></table><table class="summary"><tr><th colspan="2">Claim summary</th></tr><tr><td>Gross eligible collections</td><td>USD ${amount(claim.grossAmount).toFixed(2)}</td></tr>${deductionRows}<tr><td><b>Total deductions</b></td><td><b>USD ${amount(claim.deductionAmount).toFixed(2)}</b></td></tr><tr><td><b>NET CLAIM</b></td><td><b>USD ${amount(claim.netAmount).toFixed(2)}</b></td></tr></table><p class="small">Receipt allocations shown here are system-controlled and cannot be included in another claim. Paper receipt possession alone does not authorise payment.</p><div class="sign"><div class="line">Service provider / claimant</div><div class="line">Transport Manager verification</div><div class="line">Accounts / Finance approval</div></div></body></html>`;
      const pdf = await renderHtmlPdf({ html, pdfOptions: { format: "A4", landscape: true, printBackground: true, preferCSSPageSize: true } });
      const filename = reportPdfFilename(`Transport_Claim_${claim.claimNumber}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`);
      res.send(pdf);
    } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : "Unable to generate claim PDF" }); }
  });

  app.post("/api/transport/claims/:id/status", requireAuth, async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportClaims, id, school.id);
      if (!previous) return res.status(404).json({ message: "Claim not found" });
      const { status, reason } = z.object({ status: z.enum(["submitted", "verified", "approved", "rejected", "cancelled"]), reason: optionalText }).parse(req.body);
      const requiredPermission: Record<string, string> = {
        submitted: "transport.claims.submit",
        verified: "transport.claims.verify",
        approved: "transport.claims.approve",
        rejected: previous.status === "submitted" ? "transport.claims.verify" : "transport.claims.approve",
        cancelled: "transport.claims.approve",
      };
      const permitted = await userHasAnyPermission(user.id, requiredPermission[status], "transport.edit");
      if (!permitted) return res.status(403).json({ message: `Missing permission: ${requiredPermission[status]}` });
      const transitions: Record<string, string[]> = {
        draft: ["submitted", "cancelled"],
        submitted: ["verified", "rejected", "cancelled"],
        verified: ["approved", "rejected", "cancelled"],
      };
      if (!(transitions[previous.status] ?? []).includes(status)) {
        return res.status(409).json({ message: `Claim cannot move from ${previous.status} to ${status}` });
      }
      if (["verified", "approved"].includes(status) && previous.preparedByUserId === user.id) {
        return res.status(409).json({ message: "The claim preparer cannot verify or approve the same claim" });
      }
      if (status === "approved" && previous.verifiedByUserId === user.id) {
        return res.status(409).json({ message: "The claim verifier cannot approve the same claim" });
      }
      if (["rejected", "cancelled"].includes(status) && !reason) {
        return res.status(400).json({ message: "A reason is required" });
      }
      const changes: any = { status };
      if (status === "submitted") changes.submittedAt = new Date();
      if (status === "verified") { changes.verifiedAt = new Date(); changes.verifiedByUserId = user.id; }
      if (status === "approved") { changes.approvedAt = new Date(); changes.approvedByUserId = user.id; }
      const [updated] = await db.update(transportClaims).set(changes).where(eq(transportClaims.id, id)).returning();
      await writeAudit(db, school.id, user.id, "claim", id, `status_${status}`, previous, updated, reason);
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/claims/:id/payout", requireAuth, requireAnyPermission("transport.payouts.generate", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id); const claim = await assertSchoolRecord(transportClaims, id, school.id);
      if (!claim || claim.status !== "approved") return res.status(409).json({ message: "Claim must be approved first" });
      const existing = await db.select().from(transportPayouts).where(eq(transportPayouts.claimId, id));
      if (existing.length) return res.status(409).json({ message: "A payout slip already exists for this claim" });
      const deductions = await db.select().from(transportClaimDeductions).where(eq(transportClaimDeductions.claimId, id)).orderBy(asc(transportClaimDeductions.priority));
      const vehicle = await assertSchoolRecord(transportVehicles, claim.vehicleId, school.id);
      const owner = claim.ownerId ? await assertSchoolRecord(transportOwners, claim.ownerId, school.id) : null;
      const token = verificationToken();
      const [payout] = await db.insert(transportPayouts).values({ schoolId: school.id, claimId: id, payoutNumber: numberCode("PAY", school.shortCode, Date.now().toString().slice(-6)), grossAmount: claim.grossAmount, deductionAmount: claim.deductionAmount, netAmount: claim.netAmount, verificationToken: token, snapshot: { claim, deductions, vehicle, owner, generatedAt: new Date().toISOString() }, generatedByUserId: user.id, approvedByUserId: claim.approvedByUserId }).returning();
      await writeAudit(db, school.id, user.id, "payout", payout.id, "generate", null, payout);
      return res.status(201).json(payout);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/payouts/:id/pay", requireAuth, requireAnyPermission("transport.payouts.pay", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportPayouts, id, school.id);
      if (!previous) return res.status(404).json({ message: "Payout not found" });
      const parsed = payoutPaymentInput.parse(req.body);
      const paid = rounded(Math.min(parsed.amount ?? amount(previous.netAmount), amount(previous.netAmount) - amount(previous.amountPaid)));
      const amountPaid = rounded(amount(previous.amountPaid) + paid);
      const status = amountPaid >= amount(previous.netAmount) ? "paid" : "partially_paid";
      const [updated] = await db.transaction(async (tx) => {
        const [row] = await tx.update(transportPayouts).set({ amountPaid: String(amountPaid), status, paymentDate: parsed.paymentDate, paymentMethod: parsed.paymentMethod, paymentReference: parsed.paymentReference, paidByUserId: user.id }).where(eq(transportPayouts.id, id)).returning();
        if (status === "paid") {
          await tx.update(transportClaims).set({ status: "paid" }).where(eq(transportClaims.id, previous.claimId));
          const advanceDeductions = await tx.select().from(transportClaimDeductions).where(and(eq(transportClaimDeductions.claimId, previous.claimId), eq(transportClaimDeductions.deductionType, "advance")));
          for (const deduction of advanceDeductions) {
            if (!deduction.sourceId) continue;
            const [advance] = await tx.select().from(transportAdvances).where(eq(transportAdvances.id, deduction.sourceId));
            if (!advance) continue;
            const remaining = rounded(Math.max(0, amount(advance.outstandingAmount) - amount(deduction.amount)));
            await tx.update(transportAdvances).set({ outstandingAmount: String(remaining), status: remaining === 0 ? "settled" : "recovering" }).where(eq(transportAdvances.id, advance.id));
          }
        }
        await writeAudit(tx, school.id, user.id, "payout", id, "pay", previous, row);
        return [row];
      });
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/payouts/:id/print", requireAuth, requireAnyPermission("transport.payouts.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).send("Select a school");
      const payout = await assertSchoolRecord(transportPayouts, Number(req.params.id), school.id);
      if (!payout) return res.status(404).send("Payout not found");
      const snapshot = payout.snapshot as any;
      const rows = (snapshot?.deductions ?? []).map((item: any) => `<tr><td>${escapeHtml(item.description)}</td><td>USD ${amount(item.amount).toFixed(2)}</td></tr>`).join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(payout.payoutNumber)}</title><style>@page{size:A4;margin:15mm}body{font-family:Arial;color:#111}h1,h2{text-align:center}.box{border:1px solid #222;padding:18px}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border:1px solid #bbb;padding:8px;text-align:left}.total{font-size:20px;font-weight:bold}.sign{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:50px}.line{border-top:1px solid #111;padding-top:5px}</style></head><body><div class="box"><h1>${escapeHtml(school.name)}</h1><h2>TRANSPORT PAYOUT SLIP</h2><p><b>Payout:</b> ${escapeHtml(payout.payoutNumber)}<br/><b>Claim:</b> ${escapeHtml(snapshot?.claim?.claimNumber)}<br/><b>Vehicle:</b> ${escapeHtml(snapshot?.vehicle?.registrationNumber)}<br/><b>Owner:</b> ${escapeHtml(snapshot?.owner?.name || "—")}<br/><b>Service period:</b> ${escapeHtml(`${snapshot?.claim?.serviceYear}-${String(snapshot?.claim?.serviceMonth ?? "").padStart(2, "0")}`)}</p><table><tr><th>Description</th><th>Amount</th></tr><tr><td>Gross eligible collections</td><td>USD ${amount(payout.grossAmount).toFixed(2)}</td></tr>${rows}<tr><td><b>Total deductions</b></td><td><b>USD ${amount(payout.deductionAmount).toFixed(2)}</b></td></tr><tr class="total"><td>NET PAYABLE</td><td>USD ${amount(payout.netAmount).toFixed(2)}</td></tr></table><div class="sign"><div class="line">Prepared / approved by</div><div class="line">Vehicle owner / claimant</div></div></div></body></html>`;
      const pdf = await renderHtmlPdf({ html, pdfOptions: { format: "A4", printBackground: true, preferCSSPageSize: true } });
      const filename = reportPdfFilename(`Transport_Payout_${payout.payoutNumber}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`);
      res.send(pdf);
    } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : "Unable to generate payout PDF" }); }
  });

  app.get("/api/transport/settlements/statement/print", requireAuth, requireAnyPermission("transport.payouts.view", "transport.claims.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const now = new Date();
      const year = z.coerce.number().int().min(2020).max(2100).parse(req.query.year ?? now.getUTCFullYear());
      const month = monthInput.parse(req.query.month ?? now.getUTCMonth() + 1);
      const rows = await db.execute(sql`
        SELECT c.claim_number AS "claimNumber", c.status AS "claimStatus", c.gross_amount::text AS "grossAmount",
               c.deduction_amount::text AS "deductionAmount", c.net_amount::text AS "netAmount",
               v.registration_number AS "registrationNumber", o.name AS "ownerName",
               p.payout_number AS "payoutNumber", p.amount_paid::text AS "amountPaid", p.status AS "payoutStatus"
        FROM transport_claims c
        JOIN transport_vehicles v ON v.id=c.vehicle_id
        LEFT JOIN transport_owners o ON o.id=v.owner_id
        LEFT JOIN transport_payouts p ON p.claim_id=c.id
        WHERE c.school_id=${school.id} AND c.service_year=${year} AND c.service_month=${month}
        ORDER BY v.registration_number, c.claim_number
      `);
      type SettlementTotals = {
        gross: number;
        deductions: number;
        net: number;
        paid: number;
      };
      const totals = rows.rows.reduce<SettlementTotals>((result, row: any) => ({
        gross: rounded(result.gross + amount(row.grossAmount)),
        deductions: rounded(result.deductions + amount(row.deductionAmount)),
        net: rounded(result.net + amount(row.netAmount)),
        paid: rounded(result.paid + amount(row.amountPaid)),
      }), { gross: 0, deductions: 0, net: 0, paid: 0 });
      const detailRows = rows.rows.map((row: any) => `<tr><td>${escapeHtml(row.registrationNumber)}</td><td>${escapeHtml(row.ownerName || "—")}</td><td>${escapeHtml(row.claimNumber)}</td><td>USD ${amount(row.grossAmount).toFixed(2)}</td><td>USD ${amount(row.deductionAmount).toFixed(2)}</td><td>USD ${amount(row.netAmount).toFixed(2)}</td><td>USD ${amount(row.amountPaid).toFixed(2)}</td><td>USD ${rounded(amount(row.netAmount) - amount(row.amountPaid)).toFixed(2)}</td><td>${escapeHtml(row.payoutStatus || row.claimStatus)}</td></tr>`).join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Monthly Transport Settlement Statement</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;color:#111}h1,h2{text-align:center;margin:0 0 8px}.period{text-align:center;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #aaa;padding:6px;text-align:left}th{background:#eee}.totals{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:16px 0}.box{border:1px solid #bbb;padding:9px}.box b{display:block;color:#555;font-size:10px}.box span{font-size:15px;font-weight:bold}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:35px}.line{border-top:1px solid #111;padding-top:5px}</style></head><body><h1>${escapeHtml(school.name)}</h1><h2>MONTHLY TRANSPORT SETTLEMENT STATEMENT</h2><div class="period">${year}-${String(month).padStart(2, "0")}</div><div class="totals"><div class="box"><b>Vehicles / claims</b><span>${rows.rows.length}</span></div><div class="box"><b>Gross entitlement</b><span>USD ${totals.gross.toFixed(2)}</span></div><div class="box"><b>Deductions</b><span>USD ${totals.deductions.toFixed(2)}</span></div><div class="box"><b>Net payable</b><span>USD ${totals.net.toFixed(2)}</span></div><div class="box"><b>Outstanding</b><span>USD ${rounded(totals.net - totals.paid).toFixed(2)}</span></div></div><table><thead><tr><th>Vehicle</th><th>Owner</th><th>Claim</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>${detailRows || '<tr><td colspan="9">No claims for this service month.</td></tr>'}</tbody></table><div class="sign"><div class="line">Prepared by</div><div class="line">Transport Manager</div><div class="line">Finance approval</div></div></body></html>`;
      const pdf = await renderHtmlPdf({ html, pdfOptions: { format: "A4", landscape: true, printBackground: true, preferCSSPageSize: true } });
      const filename = reportPdfFilename(`Transport_Settlement_Statement_${year}_${String(month).padStart(2, "0")}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`);
      res.send(pdf);
    } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : "Unable to generate settlement statement PDF" }); }
  });

  app.post("/api/transport/period-locks", requireAuth, requireAnyPermission("transport.periods.lock", "transport.settings.manage"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = z.object({ year: z.coerce.number().int().min(2020), month: monthInput, reason: optionalText }).parse(req.body);
      const [created] = await db.insert(transportPeriodLocks).values({ schoolId: school.id, periodType: "monthly_settlement", year: parsed.year, month: parsed.month, reason: parsed.reason, lockedByUserId: user.id }).onConflictDoUpdate({ target: [transportPeriodLocks.schoolId, transportPeriodLocks.periodType, transportPeriodLocks.year, transportPeriodLocks.month], set: { status: "locked", reason: parsed.reason, lockedByUserId: user.id, lockedAt: new Date(), reopenedByUserId: null, reopenedAt: null } }).returning();
      await writeAudit(db, school.id, user.id, "period", created.id, "lock", null, created, parsed.reason);
      return res.status(201).json(created);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/period-locks/:id/reopen", requireAuth, requireAnyPermission("transport.periods.reopen", "transport.settings.manage"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const reason = z.object({ reason: z.string().trim().min(3) }).parse(req.body).reason;
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportPeriodLocks, id, school.id);
      if (!previous) return res.status(404).json({ message: "Period lock not found" });
      const [updated] = await db.update(transportPeriodLocks).set({ status: "reopened", reason, reopenedByUserId: user.id, reopenedAt: new Date() }).where(eq(transportPeriodLocks.id, id)).returning();
      await writeAudit(db, school.id, user.id, "period", id, "reopen", previous, updated, reason);
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/reports/summary", requireAuth, requireAnyPermission("transport.reports.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const from = dateString.parse(String(req.query.from || isoDate(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)))));
      const to = dateString.parse(String(req.query.to || isoDate(new Date())));
      return res.json(await getTransportPeriodSummary(school.id, from, to));
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/reports/summary/print", requireAuth, requireAnyPermission("transport.reports.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const from = dateString.parse(String(req.query.from || isoDate(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)))));
      const to = dateString.parse(String(req.query.to || isoDate(new Date())));
      const report = await getTransportPeriodSummary(school.id, from, to);
      const summary = report.summary as any;
      const methodRows = report.byMethod.map((row: any) => `<tr><td>${escapeHtml(String(row.method || "—").replaceAll("_", " "))}</td><td>${Number(row.count || 0)}</td><td>USD ${amount(row.amount).toFixed(2)}</td></tr>`).join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Transport Periodic Summary</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;color:#111}h1,h2{text-align:center;margin:0 0 8px}.period{text-align:center;margin-bottom:18px}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:16px 0}.card{border:1px solid #bbb;padding:10px}.card b{display:block;font-size:11px;color:#555;margin-bottom:5px}.card span{font-size:16px;font-weight:bold}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #bbb;padding:8px;text-align:left}th{background:#eee}.footer{margin-top:28px;font-size:10px;color:#555}</style></head><body><h1>${escapeHtml(school.name)}</h1><h2>TRANSPORT PERIODIC SUMMARY</h2><div class="period">${escapeHtml(from)} to ${escapeHtml(to)}</div><div class="cards"><div class="card"><b>Charged</b><span>USD ${amount(summary?.charged).toFixed(2)}</span></div><div class="card"><b>Received</b><span>USD ${amount(summary?.received).toFixed(2)}</span></div><div class="card"><b>Refunds</b><span>USD ${amount(summary?.refunds).toFixed(2)}</span></div><div class="card"><b>Claim gross</b><span>USD ${amount(summary?.claim_gross).toFixed(2)}</span></div><div class="card"><b>Payout net</b><span>USD ${amount(summary?.payout_net).toFixed(2)}</span></div></div><table><thead><tr><th>Payment method</th><th>Transactions</th><th>Amount</th></tr></thead><tbody>${methodRows || '<tr><td colspan="3">No payments in this period.</td></tr>'}</tbody></table><div class="footer">Generated by FCGS Portal on ${escapeHtml(new Date().toISOString())}</div></body></html>`;
      const pdf = await renderHtmlPdf({ html, pdfOptions: { format: "A4", printBackground: true, preferCSSPageSize: true } });
      const filename = reportPdfFilename(`Transport_Periodic_Summary_${from}_to_${to}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`);
      res.send(pdf);
    } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : "Unable to generate Transport summary PDF" }); }
  });
}

// Drizzle comparison helper for decimal columns represented as strings.
function gtZero(column: any) {
  return sql`${column} > 0`;
}
