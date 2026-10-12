import type { Express, Request, Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcrypt";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { z } from "zod";
import { db } from "./db";
import { requireAuth, requireAnyPermission, requirePermission } from "./auth";
import { storage } from "./storage";
import { createInAppNotifications } from "./communication";
import { renderHtmlPdf, reportPdfFilename } from "./pdf-renderer";
import {
  assetRegister,
  assetVehicleDetails,
  classes,
  electronicSignatures,
  parents,
  fleetVehicleProfiles,
  fleetVehicleOccupants,
  schools,
  staff,
  students,
  users,
  transportAccountAdjustments,
  transportAdvances,
  transportAssignments,
  transportAssignmentEvents,
  transportAuditEvents,
  transportCashupPayments,
  transportCashupRefunds,
  transportCashups,
  transportCharges,
  transportBillingRuns,
  transportClaimAllocations,
  transportClaimDeductions,
  transportClaims,
  transportHqClaimItems,
  transportHqClaims,
  transportHqPayouts,
  transportDrivers,
  transportDriverSchools,
  transportDestinationMasters,
  transportDriverOwnerHistory,
  transportIncidents,
  transportOwners,
  transportOwnerSchools,
  transportOrganizationSettings,
  transportVehicleAlternativeDrivers,
  transportVehicleOperatingDriverHistory,
  transportVehicleReplacements,
  transportPathNodeLearners,
  transportPathNodes,
  transportPaymentAllocations,
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
  transportSubscriptionPolicies,
  transportVehicleDestinations,
  transportVehicleDriverHistory,
  transportVehicleOwnerHistory,
  transportVehiclePaths,
  transportVehicles,
  transportVehicleSchools,
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
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const routeInput = z.object({
  destinationMasterId: nullablePositiveInt,
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
  email: z.string().trim().email().optional().nullable().or(z.literal("")),
  address: optionalText,
  alternativeContactName: optionalText,
  alternativeContactPhone: optionalText,
  alternativeContactEmail: z.string().trim().email().optional().nullable().or(z.literal("")),
  alternativeContactRelationship: optionalText,
  isStaffOwner: z.boolean().optional().default(false),
  staffId: nullablePositiveInt,
  nationalIdOrRegistration: optionalText,
  paymentDetails: optionalText,
  effectiveFrom: dateString.optional().nullable(),
  effectiveTo: dateString.optional().nullable(),
  notes: optionalText,
  isActive: z.boolean().optional().default(true),
});

const driverInput = z.object({
  ownerId: nullablePositiveInt,
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: optionalText,
  homeAddress: optionalText,
  photo: optionalText,
  nationalId: optionalText,
  licenceNumber: optionalText,
  licenceExpiry: dateString.optional().nullable(),
  engagementType: z.enum(["internal", "external"]).default("internal"),
  nextOfKinName: optionalText,
  nextOfKinRelationship: optionalText,
  nextOfKinPhone: optionalText,
  nextOfKinAlternativePhone: optionalText,
  nextOfKinEmail: z.string().trim().email().optional().nullable().or(z.literal("")),
  nextOfKinAddress: optionalText,
  effectiveFrom: dateString.optional().nullable(),
  effectiveTo: dateString.optional().nullable(),
  notes: optionalText,
  isActive: z.boolean().optional().default(true),
  effectiveDate: dateString.optional(),
  changeReason: optionalText,
});

const vehicleInput = z.object({
  registrationNumber: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9 ]+$/, "Vehicle registration may contain letters, numbers and spaces only").transform((value) => value.replace(/\s+/g, " ").toUpperCase()),
  makeModel: optionalText,
  capacity: z.coerce.number().int().positive(),
  ownershipType: z.enum(["school", "staff", "contracted"]).default("school"),
  ownerId: nullablePositiveInt,
  driverId: nullablePositiveInt,
  alternativeDriverIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  registrationExpiry: dateString.optional().nullable(),
  insuranceExpiry: dateString.optional().nullable(),
  fitnessExpiry: dateString.optional().nullable(),
  radioLicenceExpiry: dateString.optional().nullable(),
  primaryImage: optionalText,
  status: z.enum(["draft", "active", "suspended", "retired"]).default("active"),
  notes: optionalText,
  routeNotes: optionalText,
  isActive: z.boolean().optional().default(true),
  effectiveDate: dateString.optional(),
  changeReason: optionalText,
});

const servicePointInput = z.object({
  studentId: nullablePositiveInt,
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
  reverseExpectedTime: optionalText,
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
  isTwoWay: z.boolean().optional().default(false),
  canonicalTraversal: z.enum(["forward", "reverse"]).optional().default("forward"),
  name: z.string().trim().min(1),
  effectiveFrom: dateString,
  effectiveTo: dateString.optional().nullable(),
  estimatedDistanceKm: money.optional().nullable(),
  estimatedDurationMinutes: z.coerce.number().int().min(0).optional().nullable(),
  geometry: z.any().optional().nullable(),
  notes: optionalText,
  nodes: z.array(pathNodeInput).min(2),
});

const organizationTransportSettingsInput = z.object({
  minimumArrearsSuspensionBalance: money,
  suspendedSeatPolicy: z.enum(["reserve_indefinitely", "release_immediately", "release_after_days"]),
  suspendedSeatReleaseDays: z.coerce.number().int().min(0).max(3650),
  automaticArrearsReinstatement: z.boolean(),
  arrearsWarningEnabled: z.boolean(),
});

const assignmentInput = z.object({
  studentId: z.coerce.number().int().positive(),
  routeId: z.coerce.number().int().positive(),
  vehicleId: nullablePositiveInt,
  outboundVehicleId: nullablePositiveInt,
  driverId: nullablePositiveInt,
  inboundPathId: nullablePositiveInt,
  inboundPathTraversal: z.enum(["forward", "reverse"]).optional().default("forward"),
  outboundPathId: nullablePositiveInt,
  outboundPathTraversal: z.enum(["forward", "reverse"]).optional().default("forward"),
  pickupServicePointId: nullablePositiveInt,
  dropoffServicePointId: nullablePositiveInt,
  pickupPathNodeId: nullablePositiveInt,
  dropoffPathNodeId: nullablePositiveInt,
  serviceType: z.enum(["pickup", "dropoff", "both"]).default("both"),
  serviceState: z.enum(["pending_start", "active", "active_arrears", "suspension_pending", "suspended", "suspended_arrears", "pending_vehicle_reassignment", "paused", "terminated", "completed"]).default("pending_start"),
  planningStatus: z.enum(["pending_path_assignment", "provisionally_assigned", "assigned_to_path", "path_confirmed"]).default("pending_path_assignment"),
  financialStatus: z.enum(["pending_first_payment", "paid", "partially_paid", "overdue", "credit"]).default("pending_first_payment"),
  baseMonthlyFee: money,
  agreedFee: money,
  startDate: dateString,
  endDate: dateString.optional().nullable(),
  notes: optionalText,
  capacityOverrideReason: optionalText,
});

const assignmentServicePointsInput = z.object({
  pickupServicePointId: nullablePositiveInt,
  dropoffServicePointId: nullablePositiveInt,
});

const transferInput = assignmentInput.partial().extend({
  effectiveDate: dateString,
  reason: z.string().trim().min(3),
  transferType: z.enum(["vehicle", "stop", "path", "route", "service_type", "temporary", "permanent"]).default("permanent"),
});

const stateInput = z.object({
  state: z.enum(["active", "suspended", "paused", "terminated", "completed"]),
  effectiveDate: dateString,
  reason: z.string().trim().min(3),
  refundMethod: z.enum(["credit", "cash", "bank_transfer", "mobile_money", "original_method"]).optional(),
});

const chargeInput = z.object({
  academicYear: z.coerce.number().int().min(2020),
  term: z.string().optional().default("Monthly"),
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
  term: z.string().optional().default("Monthly"),
  month: z.coerce.number().int().min(0).max(12).default(0),
  externalReference: optionalText,
  notes: optionalText,
  allocationMode: z.enum(["oldest_first", "specific", "future_credit"]).default("oldest_first"),
  chargeIds: z.array(z.coerce.number().int().positive()).optional(),
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
  paymentIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  refundIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  // Handover totals are always calculated by the server from the selected
  // payments/refunds. Any legacy/manipulated amount fields sent by a client are ignored.
  depositReference: optionalText,
  notes: optionalText,
});

const cashupSignInput = z.object({ password: z.string().min(1) });

const cashupVerifyInput = z.object({
  notes: optionalText,
  password: z.string().min(1),
});

const cashupDiscrepancyInput = z.object({
  discrepancyReason: z.string().trim().min(3).max(1000),
  notes: optionalText,
  password: z.string().min(1),
});

const claimReconciliationInput = z.object({
  manualClaimReference: z.string().trim().min(1),
  manualClaimDocument: optionalText,
  outcome: z.enum(["matched", "disputed"]),
  notes: optionalText,
  disputeReason: optionalText,
}).superRefine((value, ctx) => {
  if (value.outcome === "disputed" && !value.disputeReason?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["disputeReason"], message: "Enter the reason for the dispute" });
  }
});

const claimDisputeResolutionInput = z.object({
  resolution: z.string().trim().min(3),
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
  ownerId: nullablePositiveInt,
  driverId: nullablePositiveInt,
  routeId: nullablePositiveInt,
  pathId: nullablePositiveInt,
  pathTraversal: z.enum(["forward", "reverse"]).optional().default("forward"),
  assignmentOverride: z.boolean().optional().default(false),
  overrideReason: optionalText,
  incidentType: z.string().trim().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  occurredAt: z.string().min(1),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  description: z.string().trim().min(3),
  resolution: optionalText,
  affectedStudentIds: z.array(z.coerce.number().int().positive()).optional().default([]),
}).superRefine((value, context) => {
  if (value.assignmentOverride && !String(value.overrideReason || "").trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["overrideReason"], message: "Explain why the normal driver, route or path was overridden." });
  }
});

const claimInput = z.object({
  vehicleId: z.coerce.number().int().positive().optional().nullable(),
  allVehicles: z.boolean().optional().default(false),
  serviceYear: z.coerce.number().int().min(2020),
  serviceMonth: monthInput,
  notes: optionalText,
}).refine((value) => value.allVehicles || Boolean(value.vehicleId), { message: "Select a vehicle or choose All vehicles" });

const payoutPaymentInput = z.object({
  paymentDate: dateString,
  paymentMethod: z.string().trim().min(1),
  paymentReference: z.string().trim().min(1),
  amount: positiveMoney.optional(),
});

const settingsInput = z.object({
  transportManagerStaffId: nullablePositiveInt,
  stopGroupingDistanceMeters: z.coerce.number().int().min(1).max(500),
  oneWayPricingMode: z.enum(["percentage", "fixed_addition"]),
  inboundOneWayPercent: z.coerce.number().min(0).max(100),
  outboundOneWayPercent: z.coerce.number().min(0).max(100),
  inboundOneWayFixedAddition: z.coerce.number().min(0),
  outboundOneWayFixedAddition: z.coerce.number().min(0),
  joiningFullChargeThroughDay: z.coerce.number().int().min(0).max(31),
  refundNoCreditRemainingDays: z.coerce.number().int().min(0).max(31),
  pendingSeatReservationEnabled: z.boolean(),
  pendingSeatReservationDays: z.coerce.number().int().min(0).max(365),
  receiptPrefix: z.string().trim().min(1).max(20),
  receiptSequenceLength: z.coerce.number().int().min(3).max(12),
  receiptResetYearly: z.boolean(),
  receiptFooter: optionalText,
  receiptPrintFormat: z.enum(["a4", "thermal80"]),
  printCopiesOnOnePage: z.boolean(),
  requireCashupForClaim: z.boolean(),
  reportWeekStartsOn: z.coerce.number().int().min(0).max(6),
  fortnightAnchorDate: dateString.optional().nullable(),
  mapProvider: z.literal("openstreetmap").default("openstreetmap"),
  defaultCheckpointRadiusMeters: z.coerce.number().int().min(1).max(5000),
  savedPointSuggestionRadiusMeters: z.coerce.number().int().min(1).max(5000),
  attachmentSizeLimitMB: z.coerce.number().int().refine((value) => [5, 10, 15, 20, 25, 50].includes(value), "Choose a supported Transport attachment limit"),
  complianceNotificationDays: z.array(z.coerce.number().int()).transform((values) => Array.from(new Set(values.filter((value) => [30, 14, 7, 1, 0].includes(value))))),
  complianceNotificationRecipients: z.array(z.string()).optional(),
  approvalWorkflow: z.any().optional(),
  deductionPriority: z.array(z.string()).optional(),
}).partial().superRefine((value, ctx) => {
  if (value.oneWayPricingMode !== "percentage") return;
  if (value.inboundOneWayPercent !== undefined && value.inboundOneWayPercent < 50) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inboundOneWayPercent"], message: "School-bound percentage must be at least 50%." });
  }
  if (value.outboundOneWayPercent !== undefined && value.outboundOneWayPercent < 50) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["outboundOneWayPercent"], message: "Home-bound percentage must be at least 50%." });
  }
});

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

const receiptPrintFormatInput = z.enum(["a4", "thermal80"]);

function imageMimeType(buffer: Buffer, reference: string): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  const lower = reference.toLowerCase();
  if (lower.includes(".svg")) return "image/svg+xml";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  return "image/png";
}

async function imageDataUrl(reference: unknown): Promise<string | null> {
  const value = String(reference || "").trim();
  if (!value) return null;
  if (value.startsWith("data:image/")) return value;
  try {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      const response = await fetch(value);
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      const mime = response.headers.get("content-type")?.split(";")[0] || imageMimeType(buffer, value);
      return `data:${mime};base64,${buffer.toString("base64")}`;
    }
    let buffer: Buffer | null = null;
    if (value.startsWith("/objects/")) {
      const roots = process.env.LOCAL_OBJECT_DIR
        ? [path.resolve(process.env.LOCAL_OBJECT_DIR)]
        : [path.resolve(process.cwd(), "object_storage"), path.resolve("/var/lib/fcgs/object_storage")];
      for (const root of roots) {
        const candidate = path.resolve(root, value.slice("/objects/".length));
        if (!candidate.startsWith(root + path.sep)) continue;
        try { buffer = await fs.readFile(candidate); break; } catch { /* try next root */ }
      }
    } else {
      const relative = value.replace(/^\/+/, "");
      for (const candidate of [path.resolve(process.cwd(), relative), path.resolve(process.cwd(), "client/public", relative)]) {
        try { buffer = await fs.readFile(candidate); break; } catch { /* try next */ }
      }
    }
    if (!buffer) return null;
    return `data:${imageMimeType(buffer, value)};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
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

async function preparedElectronicSignature(userId: number, password: string, entityType: string, entityId: number, signatureRole: string, statement: string, metadata: Record<string, unknown> = {}) {
  const [account] = await db.select({ id: users.id, password: users.password, firstName: users.firstName, lastName: users.lastName })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!account || !(await bcrypt.compare(password, account.password))) {
    const error = new Error("Your account password is incorrect");
    (error as any).status = 401;
    throw error;
  }
  const [staffRow] = await db.select({ id: staff.id, firstName: staff.firstName, lastName: staff.lastName, signatureData: staff.signatureData, signatureUpdatedAt: staff.signatureUpdatedAt })
    .from(staff).where(eq(staff.userId, userId)).limit(1);
  if (!staffRow?.signatureData) {
    const error = new Error("Register your handwritten signature in your staff profile before signing this record");
    (error as any).status = 409;
    throw error;
  }
  const [existing] = await db.select({ id: electronicSignatures.id }).from(electronicSignatures)
    .where(and(eq(electronicSignatures.entityType, entityType), eq(electronicSignatures.entityId, entityId), eq(electronicSignatures.signatureRole, signatureRole))).limit(1);
  if (existing) {
    const error = new Error("This acknowledgement has already been signed");
    (error as any).status = 409;
    throw error;
  }
  return {
    entityType,
    entityId,
    signatureRole,
    signerUserId: userId,
    signerStaffId: staffRow.id,
    signerName: `${staffRow.firstName || account.firstName || ""} ${staffRow.lastName || account.lastName || ""}`.trim() || `User #${userId}`,
    statement,
    signatureSnapshot: staffRow.signatureData,
    specimenUpdatedAt: staffRow.signatureUpdatedAt,
    metadata,
  };
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

async function getOrCreateOrganizationTransportSettings(organizationId: number, executor: any = db) {
  const [existing] = await executor.select().from(transportOrganizationSettings).where(eq(transportOrganizationSettings.organizationId, organizationId));
  if (existing) return existing;
  const [created] = await executor.insert(transportOrganizationSettings).values({ organizationId }).returning();
  return created;
}

async function qualifyingTransportArrears(executor: any, schoolId: number, studentId: number, beforeDate: string): Promise<{ balance: number; oldestMonth: string | null }> {
  const rows = await executor.execute(sql`
    SELECT c.id, c.amount, c.academic_year, c.month, c.service_period_end,
           COALESCE((SELECT SUM(pa.amount) FROM transport_payment_allocations pa JOIN transport_payments p ON p.id=pa.payment_id WHERE pa.charge_id=c.id AND p.reversed_at IS NULL),0) AS allocated
    FROM transport_charges c
    WHERE c.school_id=${schoolId} AND c.student_id=${studentId} AND c.status NOT IN ('cancelled','void')
      AND COALESCE(c.service_period_end, (date_trunc('month',make_date(c.academic_year,GREATEST(c.month,1),1))+interval '1 month - 1 day')::date) < ${beforeDate}
    ORDER BY c.academic_year, c.month, c.id
  `);
  let balance = 0; let oldestMonth: string | null = null;
  for (const row of rows.rows as any[]) {
    const outstanding = Math.max(0, rounded(amount(row.amount) - amount(row.allocated)));
    if (outstanding > 0) { balance = rounded(balance + outstanding); if (!oldestMonth) oldestMonth = `${row.academic_year}-${String(row.month).padStart(2,'0')}`; }
  }
  const credits = await executor.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0)::text AS net_credit
    FROM transport_account_adjustments
    WHERE school_id=${schoolId} AND student_id=${studentId} AND status='approved' AND effective_date < ${beforeDate}
  `);
  balance = Math.max(0, rounded(balance - Math.max(0, amount((credits.rows as any[])[0]?.net_credit))));
  return { balance, oldestMonth };
}

function addDaysIso(dateValue: string, days: number): string {
  const d = new Date(`${dateValue}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return isoDate(d);
}

async function reconcileArrearsSeatReleases(schoolId: number, executor: any = db) {
  const today = isoDate(new Date());
  const due = await executor.select().from(transportAssignments).where(and(
    eq(transportAssignments.schoolId, schoolId),
    eq(transportAssignments.serviceState, 'suspended_arrears'),
    eq(transportAssignments.isActive, true),
    sql`${transportAssignments.seatReservedUntil} IS NOT NULL AND ${transportAssignments.seatReservedUntil} < ${today}`
  ));
  for (const assignment of due) {
    await executor.update(transportAssignments).set({ isActive: false, seatReleasedAt: new Date(), updatedAt: new Date() }).where(eq(transportAssignments.id, assignment.id));
    await executor.insert(transportAssignmentEvents).values({ schoolId, assignmentId: assignment.id, eventType: 'arrears_seat_released', effectiveDate: today, previousValues: assignment, newValues: { ...assignment, isActive: false }, reason: 'Seat reservation grace period expired while Transport arrears remained outstanding', createdByUserId: assignment.createdByUserId || null });
  }
  return due.length;
}

async function reconcileArrearsAfterPayment(executor: any, school: SchoolRow, studentId: number, userId: number) {
  if (!school.organizationId) return null;
  const policy = await getOrCreateOrganizationTransportSettings(school.organizationId, executor);
  if (!policy.automaticArrearsReinstatement) return null;
  const [assignment] = await executor.select().from(transportAssignments).where(and(eq(transportAssignments.schoolId, school.id), eq(transportAssignments.studentId, studentId), eq(transportAssignments.suspensionReason, 'arrears'))).orderBy(desc(transportAssignments.startDate), desc(transportAssignments.id)).limit(1);
  if (!assignment) return null;
  const arrears = await qualifyingTransportArrears(executor, school.id, studentId, isoDate(new Date()));
  if (arrears.balance > amount(policy.minimumArrearsSuspensionBalance)) return null;
  const seatReleased = Boolean(assignment.seatReleasedAt) || !assignment.isActive;
  const nextState = seatReleased ? 'pending_vehicle_reassignment' : 'active';
  const [updated] = await executor.update(transportAssignments).set({ serviceState: nextState, suspensionReason: null, financialStatus: arrears.balance > 0 ? 'partially_paid' : 'paid', isActive: seatReleased ? false : true, seatReservedUntil: null, updatedAt: new Date() }).where(eq(transportAssignments.id, assignment.id)).returning();
  await executor.insert(transportAssignmentEvents).values({ schoolId: school.id, assignmentId: assignment.id, eventType: seatReleased ? 'arrears_cleared_reassignment_required' : 'arrears_auto_reinstated', effectiveDate: isoDate(new Date()), previousValues: assignment, newValues: updated, reason: seatReleased ? 'Arrears cleared after reserved seat had been released' : 'Qualifying Transport arrears cleared', createdByUserId: userId });
  return updated;
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

async function organizationSchoolIds(school: SchoolRow): Promise<number[]> {
  if (!school.organizationId) return [school.id];
  const rows = await db.select({ id: schools.id }).from(schools).where(eq(schools.organizationId, school.organizationId));
  return rows.map((row) => Number(row.id));
}

async function assertOrganizationRecord(table: any, id: number, school: SchoolRow) {
  const [row] = await db.select().from(table).where(eq(table.id, id));
  if (!row) return null;
  if (Number(row.schoolId) === Number(school.id)) return row;
  if (!school.organizationId) return null;
  const [origin] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, Number(row.schoolId)));
  return origin?.organizationId === school.organizationId ? row : null;
}

async function reconcileTransportAssignmentDates(schoolId: number) {
  const today = isoDate(new Date());
  await db.transaction(async (tx) => {
    await tx.update(transportAssignments).set({ isActive: false, serviceState: "terminated", updatedAt: new Date() }).where(and(
      eq(transportAssignments.schoolId, schoolId), eq(transportAssignments.isActive, true), lte(transportAssignments.endDate, previousDay(today)),
    ));
    const due = await tx.select().from(transportAssignments).where(and(
      eq(transportAssignments.schoolId, schoolId), eq(transportAssignments.isActive, false), eq(transportAssignments.serviceState, "pending_start"), lte(transportAssignments.startDate, today),
    ));
    for (const row of due) {
      if (row.financialStatus === "pending_first_payment") continue;
      await tx.update(transportAssignments).set({ isActive: false, serviceState: "terminated", updatedAt: new Date() }).where(and(
        eq(transportAssignments.schoolId, schoolId), eq(transportAssignments.studentId, row.studentId), eq(transportAssignments.isActive, true), ne(transportAssignments.id, row.id),
      ));
      await tx.update(transportAssignments).set({ isActive: true, serviceState: "active", updatedAt: new Date() }).where(eq(transportAssignments.id, row.id));
    }
  });
}

function registrationKey(value: unknown): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function displayRegistration(value: unknown): string {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  const key = registrationKey(raw);
  return /^[A-Z]{3}[0-9]{4}$/.test(key) ? `${key.slice(0, 3)} ${key.slice(3)}` : raw;
}

async function accountSummary(studentId: number, schoolId: number) {
  const result = await db.execute(sql`
    SELECT
      COALESCE((SELECT SUM(c.amount) FROM transport_charges c WHERE c.school_id=${schoolId} AND c.student_id=${studentId} AND c.status <> 'cancelled'), 0)::text AS charges,
      COALESCE((SELECT SUM(CASE WHEN a.direction='debit' THEN a.amount ELSE -a.amount END) FROM transport_account_adjustments a WHERE a.school_id=${schoolId} AND a.student_id=${studentId} AND a.status='approved'), 0)::text AS adjustments,
      COALESCE((SELECT SUM(pa.amount) FROM transport_payment_allocations pa JOIN transport_payments p ON p.id=pa.payment_id WHERE p.school_id=${schoolId} AND p.student_id=${studentId} AND p.reversed_at IS NULL), 0)::text AS allocated,
      COALESCE((SELECT SUM(p.amount) FROM transport_payments p WHERE p.school_id=${schoolId} AND p.student_id=${studentId} AND p.reversed_at IS NULL), 0)::text AS received,
      COALESCE((SELECT SUM(r.amount) FROM transport_refunds r WHERE r.school_id=${schoolId} AND r.student_id=${studentId} AND r.status='paid' AND r.method <> 'credit'), 0)::text AS external_refunds_paid
  `);
  const row = (result.rows[0] ?? {}) as any;
  const charges = amount(row.charges);
  const adjustments = amount(row.adjustments);
  const allocated = amount(row.allocated);
  const received = amount(row.received);
  const externalRefundsPaid = amount(row.external_refunds_paid);
  const ledgerBalance = rounded(charges + adjustments + externalRefundsPaid - received);
  return {
    charges: rounded(charges),
    adjustments: rounded(adjustments),
    allocated: rounded(allocated),
    received: rounded(received),
    externalRefundsPaid: rounded(externalRefundsPaid),
    // Learner account balance uses every valid payment, including unallocated credit.
    // Payment allocation remains separate because provider claims may only use allocated money.
    balance: ledgerBalance,
    credit: rounded(Math.max(0, -ledgerBalance)),
    unallocatedCredit: rounded(Math.max(0, received - allocated)),
  };
}

async function transportPaymentEligibility(schoolId: number, studentId: number) {
  const [learner] = await db.select({
    id: students.id, schoolId: students.schoolId, firstName: students.firstName, lastName: students.lastName,
    admissionNo: students.admissionNo, status: students.status, archivedAt: students.archivedAt,
  }).from(students).where(and(eq(students.id, studentId), eq(students.schoolId, schoolId))).limit(1);
  if (!learner || learner.archivedAt) return { eligible: false, reason: "Learner is deleted/archived or is not in the selected school", learner, balance: 0, activeAssignment: null };
  const [activeAssignment] = await db.select({ id: transportAssignments.id, serviceState: transportAssignments.serviceState, startDate: transportAssignments.startDate, endDate: transportAssignments.endDate })
    .from(transportAssignments).where(and(
      eq(transportAssignments.schoolId, schoolId), eq(transportAssignments.studentId, studentId), eq(transportAssignments.isActive, true),
      sql`${transportAssignments.serviceState} NOT IN ('terminated','completed')`,
    )).orderBy(desc(transportAssignments.startDate), desc(transportAssignments.id)).limit(1);
  const summary = await accountSummary(studentId, schoolId);
  const payableBalance = Math.max(0, Number(summary.balance || 0));
  const eligible = Boolean(activeAssignment) || payableBalance > 0.00001;
  return { eligible, reason: eligible ? null : "Learner has no current Transport service and no outstanding Transport balance", learner, balance: payableBalance, activeAssignment: activeAssignment || null };
}

async function pendingCancellationForAssignment(assignmentId: number) {
  const [event] = await db.select({ id: transportAssignmentEvents.id, effectiveDate: transportAssignmentEvents.effectiveDate, createdAt: transportAssignmentEvents.createdAt })
    .from(transportAssignmentEvents).where(and(eq(transportAssignmentEvents.assignmentId, assignmentId), eq(transportAssignmentEvents.eventType, "service_cancelled")))
    .orderBy(desc(transportAssignmentEvents.createdAt)).limit(1);
  return event || null;
}

async function learnerStatementData(schoolId: number, studentId: number, from: string, to: string) {
  const [learner] = await db.select({ id: students.id, firstName: students.firstName, lastName: students.lastName, admissionNo: students.admissionNo, className: classes.className })
    .from(students).leftJoin(classes, eq(classes.id, students.classId)).where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)));
  if (!learner) throw Object.assign(new Error("Learner not found"), { status: 404 });
  const [charges, payments, adjustments, refunds] = await Promise.all([
    db.execute(sql`SELECT c.id,c.amount::text,COALESCE(c.service_period_start,make_date(c.academic_year,GREATEST(c.month,1),1)) AS date,c.description,r.name AS "routeName",c.academic_year AS "academicYear",c.month FROM transport_charges c LEFT JOIN transport_routes r ON r.id=c.route_id WHERE c.school_id=${schoolId} AND c.student_id=${studentId} AND c.status <> 'cancelled' AND COALESCE(c.service_period_start,make_date(c.academic_year,GREATEST(c.month,1),1)) <= ${to} ORDER BY date,c.id`),
    db.execute(sql`SELECT p.id,p.amount::text,p.payment_date AS date,p.receipt_no AS "receiptNo",p.payment_method AS "paymentMethod",p.external_reference AS "externalReference" FROM transport_payments p WHERE p.school_id=${schoolId} AND p.student_id=${studentId} AND p.reversed_at IS NULL AND p.payment_date <= ${to} ORDER BY p.payment_date,p.id`),
    db.execute(sql`SELECT a.id,a.amount::text,a.effective_date AS date,a.direction,a.adjustment_type AS "adjustmentType",a.reason FROM transport_account_adjustments a WHERE a.school_id=${schoolId} AND a.student_id=${studentId} AND a.status='approved' AND a.effective_date <= ${to} ORDER BY a.effective_date,a.id`),
    db.execute(sql`SELECT r.id,r.amount::text,COALESCE(r.paid_at::date,r.effective_date) AS date,r.refund_number AS "refundNumber",r.method,r.reason FROM transport_refunds r WHERE r.school_id=${schoolId} AND r.student_id=${studentId} AND r.status='paid' AND r.method <> 'credit' AND COALESCE(r.paid_at::date,r.effective_date) <= ${to} ORDER BY date,r.id`),
  ]);
  const all: any[] = [];
  for (const row of charges.rows as any[]) all.push({ kind: "charge", date: String(row.date), reference: `Charge #${row.id}`, description: row.description || `${row.routeName || "Transport"} · ${MONTH_NAMES[Number(row.month)-1] || row.month} ${row.academicYear}`, debit: amount(row.amount), credit: 0, recordId: row.id });
  for (const row of payments.rows as any[]) all.push({ kind: "payment", date: String(row.date), reference: row.receiptNo, description: `Payment · ${String(row.paymentMethod || "").replaceAll("_", " ")}`, debit: 0, credit: amount(row.amount), recordId: row.id, receiptNo: row.receiptNo });
  for (const row of adjustments.rows as any[]) all.push({ kind: "adjustment", date: String(row.date), reference: `Adjustment #${row.id}`, description: row.reason || row.adjustmentType, debit: row.direction === "debit" ? amount(row.amount) : 0, credit: row.direction === "credit" ? amount(row.amount) : 0, recordId: row.id });
  for (const row of refunds.rows as any[]) all.push({ kind: "refund", date: String(row.date), reference: row.refundNumber, description: `External refund · ${String(row.method || "").replaceAll("_", " ")}${row.reason ? ` · ${row.reason}` : ""}`, debit: amount(row.amount), credit: 0, recordId: row.id });
  all.sort((a,b) => String(a.date).localeCompare(String(b.date)) || String(a.reference).localeCompare(String(b.reference)));
  let running = 0; let openingBalance = 0; const transactions: any[] = [];
  for (const line of all) {
    if (line.date < from) { running = rounded(running + line.debit - line.credit); openingBalance = running; continue; }
    running = rounded(running + line.debit - line.credit); transactions.push({ ...line, balance: running });
  }
  return {
    learner, period: { from, to }, openingBalance, closingBalance: running,
    totalCharges: rounded(transactions.reduce((sum,row) => sum + Number(row.debit || 0), 0)),
    totalCredits: rounded(transactions.reduce((sum,row) => sum + Number(row.credit || 0), 0)),
    transactions,
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

async function validateLearnerServicePoint(
  school: any,
  studentId: number,
  pointId: number | null | undefined,
  allowedPointTypes: string[],
) {
  if (!pointId) return null;
  const point = await assertOrganizationRecord(transportServicePoints, Number(pointId), school);
  if (!point || (point.studentId && Number(point.studentId) !== Number(studentId)) || !allowedPointTypes.includes(point.pointType)) {
    throw Object.assign(new Error("The selected learner service point is not valid for this service leg"), { status: 409 });
  }
  return point;
}

async function validateAssignmentSelection(
  schoolId: number,
  userId: number,
  input: any,
  excludeAssignmentId?: number,
) {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId));
  if (!school) throw Object.assign(new Error("School not found"), { status: 404 });
  const orgSchoolIds = await organizationSchoolIds(school);
  const [learner, route] = await Promise.all([
    assertSchoolRecord(students, Number(input.studentId), schoolId),
    assertSchoolRecord(transportRoutes, Number(input.routeId), schoolId),
  ]);
  if (!learner || !route) throw Object.assign(new Error("Learner or route not found in the selected school"), { status: 404 });
  if (input.serviceType === "both" && input.vehicleId && input.outboundVehicleId && Number(input.vehicleId) !== Number(input.outboundVehicleId)) {
    throw Object.assign(new Error("Two-way service must use the same vehicle for School-bound and Home-bound journeys."), { status: 409 });
  }
  if ((input.serviceType === "pickup" || input.serviceType === "both") && !input.vehicleId) {
    throw Object.assign(new Error("Select a vehicle serving the learner's destination."), { status: 400 });
  }
  if (input.serviceType === "dropoff" && !(input.outboundVehicleId || input.vehicleId)) {
    throw Object.assign(new Error("Select a vehicle serving the learner's destination."), { status: 400 });
  }

  await validateLearnerServicePoint(school, Number(input.studentId), input.pickupServicePointId, ["pickup", "both"]);
  await validateLearnerServicePoint(school, Number(input.studentId), input.dropoffServicePointId, ["dropoff", "both"]);

  const today = isoDate(new Date());
  const checkedVehicles = new Set<string>();
  const validateVehicle = async (vehicleId: number | null | undefined, direction: "schoolbound" | "homebound") => {
    if (!vehicleId) return;
    const checkKey = `${Number(vehicleId)}:${direction}`;
    if (checkedVehicles.has(checkKey)) return;
    checkedVehicles.add(checkKey);
    const vehicle = await assertOrganizationRecord(transportVehicles, Number(vehicleId), school);
    if (!vehicle || !vehicle.isActive || vehicle.status !== "active") throw Object.assign(new Error("The selected vehicle is not active in this organization"), { status: 409 });
    const routeMasterId = Number(route.destinationMasterId || 0);
    const [destinationLink] = routeMasterId > 0
      ? await db.select({ id: transportVehicleDestinations.id }).from(transportVehicleDestinations).where(and(
          eq(transportVehicleDestinations.vehicleId, Number(vehicleId)), eq(transportVehicleDestinations.destinationMasterId, routeMasterId),
        )).limit(1)
      : await db.select({ id: transportVehicleDestinations.id }).from(transportVehicleDestinations).where(and(
          eq(transportVehicleDestinations.vehicleId, Number(vehicleId)), eq(transportVehicleDestinations.routeId, Number(input.routeId)),
        )).limit(1);
    if (!destinationLink) throw Object.assign(new Error(`Vehicle ${vehicle.registrationNumber} is not configured to serve the selected destination.`), { status: 409 });
    if (vehicle.registrationExpiry && vehicle.registrationExpiry < today) throw Object.assign(new Error(`Vehicle ${vehicle.registrationNumber} has expired registration`), { status: 409 });
    if (vehicle.insuranceExpiry && vehicle.insuranceExpiry < today) throw Object.assign(new Error(`Vehicle ${vehicle.registrationNumber} has expired insurance`), { status: 409 });
    if (vehicle.fitnessExpiry && vehicle.fitnessExpiry < today) throw Object.assign(new Error(`Vehicle ${vehicle.registrationNumber} has expired fitness certification`), { status: 409 });
    if (vehicle.radioLicenceExpiry && vehicle.radioLicenceExpiry < today) throw Object.assign(new Error(`Vehicle ${vehicle.registrationNumber} has an expired radio licence`), { status: 409 });
    if (["expired", "missing"].includes(vehicle.complianceStatus)) {
      const mayOverrideCompliance = await userHasAnyPermission(userId, "transport.vehicles.override_compliance", "transport.compliance.manage");
      if (!mayOverrideCompliance) throw Object.assign(new Error(`Vehicle ${vehicle.registrationNumber} is non-compliant and cannot receive a new assignment.`), { status: 409 });
    }
    const directionPredicate = direction === "schoolbound"
      ? sql`((service_type IN ('pickup','both') AND vehicle_id=${Number(vehicleId)}))`
      : sql`((service_type='both' AND vehicle_id=${Number(vehicleId)}) OR (service_type='dropoff' AND COALESCE(outbound_vehicle_id,vehicle_id)=${Number(vehicleId)}))`;
    const countResult = await db.execute(sql`
      SELECT COUNT(DISTINCT student_id)::int AS count
      FROM transport_assignments
      WHERE school_id IN (${sql.join(orgSchoolIds.map((id) => sql`${id}`), sql`,`)})
        AND (is_active=true OR (service_state='pending_start' AND financial_status <> 'pending_first_payment'))
        ${excludeAssignmentId ? sql`AND id <> ${excludeAssignmentId}` : sql``}
        AND ${directionPredicate}
    `);
    const occupied = Number(countResult.rows[0]?.count ?? 0);
    if (occupied >= vehicle.capacity) {
      const mayOverride = Boolean(input.capacityOverrideReason) && await userHasAnyPermission(userId, "transport.capacity.override", "transport.edit");
      if (!mayOverride) throw Object.assign(new Error(`Vehicle ${vehicle.registrationNumber} has no ${direction === "schoolbound" ? "School-bound" : "Home-bound"} seats available. Select another vehicle or use an authorised capacity override.`), { status: 409 });
    }
  };
  if (input.serviceType === "pickup" || input.serviceType === "both") await validateVehicle(input.vehicleId, "schoolbound");
  if (input.serviceType === "dropoff" || input.serviceType === "both") await validateVehicle(input.outboundVehicleId || input.vehicleId, "homebound");

  const validatePath = async (pathId: number | null | undefined, expectedDirection: "pickup" | "dropoff", vehicleId: number | null | undefined, traversal: string | null | undefined) => {
    if (!pathId) return null;
    const path = await assertSchoolRecord(transportVehiclePaths, Number(pathId), schoolId);
    const directionMatches = path && (path.direction === expectedDirection || path.isTwoWay);
    if (!path || path.routeId !== Number(input.routeId) || !directionMatches || (vehicleId && path.vehicleId !== Number(vehicleId))) {
      throw Object.assign(new Error(`The selected ${expectedDirection} path does not match the route and vehicle`), { status: 409 });
    }
    if (traversal === "reverse" && !path.isTwoWay) throw Object.assign(new Error("Reverse traversal is only available for a two-way vehicle path"), { status: 409 });
    if (!["active", "scheduled", "draft"].includes(path.status)) throw Object.assign(new Error("The selected vehicle path is not available"), { status: 409 });
    return path;
  };
  await validatePath(input.inboundPathId, "pickup", input.vehicleId, input.inboundPathTraversal);
  await validatePath(input.outboundPathId, "dropoff", input.outboundVehicleId || input.vehicleId, input.outboundPathTraversal);
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

function schoolCashupView(row: any) {
  if (!row) return row;
  // Blind cash-up control: expected system totals and derived expected variance
  // never leave the server in school-stage responses. HQ has a separate endpoint.
  const { expectedCash: _expectedCash, expectedNonCash: _expectedNonCash, variance: _variance, hqVariance: _hqVariance, ...safe } = row;
  return safe;
}

function calculateCashupHandover(payments: any[], refunds: any[]) {
  const cashReceipts = payments.filter((row) => row.paymentMethod === "cash").reduce((sum, row) => sum + amount(row.amount), 0);
  const nonCashReceipts = payments.filter((row) => row.paymentMethod !== "cash").reduce((sum, row) => sum + amount(row.amount), 0);
  const cashRefunds = refunds.filter((row) => row.method === "cash").reduce((sum, row) => sum + amount(row.amount), 0);
  const nonCashRefunds = refunds.filter((row) => row.method !== "cash").reduce((sum, row) => sum + amount(row.amount), 0);
  const cash = rounded(cashReceipts - cashRefunds);
  const nonCash = rounded(nonCashReceipts - nonCashRefunds);
  if (cash < -0.009 || nonCash < -0.009) {
    const error: any = new Error("Selected refunds would make a cash-up handover amount negative. Adjust the selected transactions before continuing.");
    error.status = 409;
    throw error;
  }
  return { cash: Math.max(0, cash), nonCash: Math.max(0, nonCash) };
}


const canonicalDestinationKey = (value: unknown) => String(value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");

async function ensureTransportScopeFoundation(school: SchoolRow, userId?: number | null) {
  if (!school.organizationId) return;
  const orgSchoolIds = await organizationSchoolIds(school);
  const [orgVehicles, orgDrivers, orgOwners, orgRoutes] = await Promise.all([
    db.select({ id: transportVehicles.id, schoolId: transportVehicles.schoolId }).from(transportVehicles).where(inArray(transportVehicles.schoolId, orgSchoolIds)),
    db.select({ id: transportDrivers.id, schoolId: transportDrivers.schoolId }).from(transportDrivers).where(inArray(transportDrivers.schoolId, orgSchoolIds)),
    db.select({ id: transportOwners.id, schoolId: transportOwners.schoolId }).from(transportOwners).where(inArray(transportOwners.schoolId, orgSchoolIds)),
    db.select().from(transportRoutes).where(inArray(transportRoutes.schoolId, orgSchoolIds)),
  ]);
  if (orgVehicles.length) await db.insert(transportVehicleSchools).values(orgVehicles.map((row) => ({ vehicleId: row.id, schoolId: row.schoolId, isActive: true, associatedByUserId: userId || null }))).onConflictDoNothing();
  if (orgDrivers.length) await db.insert(transportDriverSchools).values(orgDrivers.map((row) => ({ driverId: row.id, schoolId: row.schoolId, isActive: true, associatedByUserId: userId || null }))).onConflictDoNothing();
  if (orgOwners.length) await db.insert(transportOwnerSchools).values(orgOwners.map((row) => ({ ownerId: row.id, schoolId: row.schoolId, isActive: true, associatedByUserId: userId || null }))).onConflictDoNothing();

  const masters = await db.select().from(transportDestinationMasters).where(eq(transportDestinationMasters.organizationId, school.organizationId));
  const masterByKey = new Map(masters.map((row) => [row.canonicalKey, row]));
  for (const route of orgRoutes as any[]) {
    let master = route.destinationMasterId ? masters.find((row) => Number(row.id) === Number(route.destinationMasterId)) : undefined;
    const key = canonicalDestinationKey(route.name);
    if (!master) master = masterByKey.get(key);
    if (!master) {
      const [created] = await db.insert(transportDestinationMasters).values({ organizationId: school.organizationId, name: route.name, canonicalKey: key, isActive: true }).onConflictDoNothing().returning();
      master = created || (await db.select().from(transportDestinationMasters).where(and(eq(transportDestinationMasters.organizationId, school.organizationId), eq(transportDestinationMasters.canonicalKey, key))).limit(1))[0];
      if (master) masterByKey.set(key, master);
    }
    if (master && Number(route.destinationMasterId || 0) !== Number(master.id)) await db.update(transportRoutes).set({ destinationMasterId: master.id }).where(eq(transportRoutes.id, route.id));
  }
  const vehicleDestinations = await db.select({ id: transportVehicleDestinations.id, routeId: transportVehicleDestinations.routeId, destinationMasterId: transportVehicleDestinations.destinationMasterId, routeMasterId: transportRoutes.destinationMasterId })
    .from(transportVehicleDestinations).innerJoin(transportRoutes, eq(transportRoutes.id, transportVehicleDestinations.routeId));
  for (const row of vehicleDestinations) if (!row.destinationMasterId && row.routeMasterId) await db.update(transportVehicleDestinations).set({ destinationMasterId: row.routeMasterId }).where(eq(transportVehicleDestinations.id, row.id));
}

async function ensureMasterAssociation(entityType: "vehicle" | "driver" | "owner", entityId: number, schoolId: number, userId?: number | null) {
  if (entityType === "vehicle") {
    await db.insert(transportVehicleSchools).values({ vehicleId: entityId, schoolId, isActive: true, associatedByUserId: userId || null }).onConflictDoUpdate({ target: [transportVehicleSchools.vehicleId, transportVehicleSchools.schoolId], set: { isActive: true, associatedByUserId: userId || null } });
    const [vehicle] = await db.select({ ownerId: transportVehicles.ownerId, driverId: transportVehicles.driverId }).from(transportVehicles).where(eq(transportVehicles.id, entityId)).limit(1);
    if (vehicle?.ownerId) await ensureMasterAssociation("owner", Number(vehicle.ownerId), schoolId, userId);
    if (vehicle?.driverId) await ensureMasterAssociation("driver", Number(vehicle.driverId), schoolId, userId);
  }
  if (entityType === "driver") {
    await db.insert(transportDriverSchools).values({ driverId: entityId, schoolId, isActive: true, associatedByUserId: userId || null }).onConflictDoUpdate({ target: [transportDriverSchools.driverId, transportDriverSchools.schoolId], set: { isActive: true, associatedByUserId: userId || null } });
    const [driver] = await db.select({ ownerId: transportDrivers.ownerId }).from(transportDrivers).where(eq(transportDrivers.id, entityId)).limit(1);
    if (driver?.ownerId) await ensureMasterAssociation("owner", Number(driver.ownerId), schoolId, userId);
  }
  if (entityType === "owner") await db.insert(transportOwnerSchools).values({ ownerId: entityId, schoolId, isActive: true, associatedByUserId: userId || null }).onConflictDoUpdate({ target: [transportOwnerSchools.ownerId, transportOwnerSchools.schoolId], set: { isActive: true, associatedByUserId: userId || null } });
}

async function associateVehicleWithSchoolAndDestination(vehicleId: number | null | undefined, routeId: number | null | undefined, schoolId: number, userId?: number | null) {
  if (!vehicleId) return;
  await ensureMasterAssociation("vehicle", Number(vehicleId), schoolId, userId);
  if (!routeId) return;
  const masterId = await destinationMasterForRoute(Number(routeId));
  const [existing] = await db.select({ id: transportVehicleDestinations.id }).from(transportVehicleDestinations).where(and(eq(transportVehicleDestinations.vehicleId, Number(vehicleId)), eq(transportVehicleDestinations.routeId, Number(routeId)))).limit(1);
  if (!existing) await db.insert(transportVehicleDestinations).values({ vehicleId: Number(vehicleId), routeId: Number(routeId), destinationMasterId: masterId, createdByUserId: userId || null });
}

async function destinationMasterForRoute(routeId: number) {
  const [row] = await db.select({ destinationMasterId: transportRoutes.destinationMasterId }).from(transportRoutes).where(eq(transportRoutes.id, routeId)).limit(1);
  return row?.destinationMasterId ? Number(row.destinationMasterId) : null;
}

async function validateTransportMasterValues(args: {
  entityType: string;
  values: any;
  school: SchoolRow;
  previous?: any;
}): Promise<any> {
  const values = { ...args.values };
  if (args.entityType === "owner") {
    if (!values.isStaffOwner) values.staffId = null;
    if (values.isStaffOwner && !values.staffId) throw Object.assign(new Error("Select the staff member linked to this Staff Owner."), { status: 400 });
    if (values.staffId) {
      const [linkedStaff] = await db.select({ id: staff.id, organizationId: schools.organizationId }).from(staff)
        .innerJoin(schools, eq(schools.id, staff.schoolId))
        .where(eq(staff.id, Number(values.staffId))).limit(1);
      if (!linkedStaff || linkedStaff.organizationId !== args.school.organizationId) {
        throw Object.assign(new Error("The selected staff member must belong to this organization."), { status: 400 });
      }
    }
  }
  if (args.entityType === "driver") {
    if (values.engagementType === "internal") values.ownerId = null;
    if (values.engagementType === "external" && !values.ownerId) {
      throw Object.assign(new Error("Select the vehicle owner who employs this external driver."), { status: 400 });
    }
    if (values.ownerId) {
      const owner = await assertOrganizationRecord(transportOwners, Number(values.ownerId), args.school);
      if (!owner || !owner.isActive) throw Object.assign(new Error("The selected owner is unavailable in this organization."), { status: 400 });
    }
    if (args.previous) {
      const relationshipChanged = String(values.engagementType || "") !== String(args.previous.engagementType || "")
        || Number(values.ownerId || 0) !== Number(args.previous.ownerId || 0)
        || Boolean(values.isActive) !== Boolean(args.previous.isActive);
      if (relationshipChanged) {
        const orgSchoolIds = await organizationSchoolIds(args.school);
        const assignedVehicles = await db.select().from(transportVehicles).where(and(
          inArray(transportVehicles.schoolId, orgSchoolIds),
          eq(transportVehicles.driverId, Number(args.previous.id)),
          eq(transportVehicles.isActive, true),
        ));
        if (assignedVehicles.length && !values.isActive) {
          throw Object.assign(new Error(`This driver is assigned to active vehicle ${assignedVehicles[0].registrationNumber}. Remove the vehicle assignment before making the driver inactive.`), { status: 409 });
        }
        for (const vehicle of assignedVehicles) {
          if (vehicle.ownershipType === "school") {
            if (values.engagementType !== "internal") {
              throw Object.assign(new Error(`This driver is assigned to school-owned vehicle ${vehicle.registrationNumber} and must remain an Internal / school driver.`), { status: 409 });
            }
          } else if (values.engagementType !== "external" || Number(values.ownerId || 0) !== Number(vehicle.ownerId || 0)) {
            throw Object.assign(new Error(`This driver is assigned to vehicle ${vehicle.registrationNumber}. The driver's employer must match that vehicle's owner.`), { status: 409 });
          }
        }
      }
    }
  }
  if (args.entityType === "vehicle") {
    if (values.ownershipType === "school") values.ownerId = null;
    if (values.ownershipType !== "school" && !values.ownerId) {
      throw Object.assign(new Error("Select the owner of this vehicle."), { status: 400 });
    }
    let owner: any = null;
    if (values.ownerId) {
      owner = await assertOrganizationRecord(transportOwners, Number(values.ownerId), args.school);
      if (!owner || !owner.isActive) throw Object.assign(new Error("The selected owner is unavailable in this organization."), { status: 400 });
      if (values.ownershipType === "staff" && !owner.isStaffOwner) throw Object.assign(new Error("Staff-owned vehicles can only be linked to a Staff Owner."), { status: 400 });
      if (values.ownershipType === "contracted" && owner.isStaffOwner) throw Object.assign(new Error("Contracted vehicles can only be linked to a non-staff owner."), { status: 400 });
    }
    values.registrationNumber = displayRegistration(values.registrationNumber);
    values.registrationKey = registrationKey(values.registrationNumber);
    if (!values.registrationKey) throw Object.assign(new Error("Enter a valid vehicle registration."), { status: 400 });
    const orgSchoolIds = await organizationSchoolIds(args.school);
    const orgVehicles = await db.select().from(transportVehicles).where(inArray(transportVehicles.schoolId, orgSchoolIds));
    const duplicate = orgVehicles.find((vehicle: any) => Number(vehicle.id) !== Number(args.previous?.id || 0) && registrationKey(vehicle.registrationNumber) === values.registrationKey);
    if (duplicate) throw Object.assign(new Error(`Vehicle registration ${values.registrationNumber} already exists in Transport.`), { status: 409 });
    if (values.driverId) {
      const driver = await assertOrganizationRecord(transportDrivers, Number(values.driverId), args.school);
      if (!driver) throw Object.assign(new Error("The selected driver is unavailable in this organization."), { status: 400 });
      const previousDriverId = Number(args.previous?.driverId || 0);
      const selectedDriverId = Number(values.driverId || 0);
      const driverChanged = !args.previous || previousDriverId !== selectedDriverId;
      const ownerRelationshipChanged = Boolean(args.previous) && (
        String(values.ownershipType || "") !== String(args.previous.ownershipType || "")
        || Number(values.ownerId || 0) !== Number(args.previous.ownerId || 0)
      );
      const vehicleReactivated = Boolean(args.previous) && !args.previous.isActive && Boolean(values.isActive);
      const mustValidateEligibility = driverChanged || ownerRelationshipChanged || vehicleReactivated;
      if (mustValidateEligibility) {
        if (!driver.isActive) throw Object.assign(new Error("The selected driver is inactive and cannot be assigned to an active vehicle."), { status: 400 });
        if (values.ownershipType === "school") {
          if (driver.engagementType !== "internal") {
            throw Object.assign(new Error("School-owned vehicles can only be assigned to active Internal / school drivers."), { status: 400 });
          }
        } else if (driver.engagementType !== "external" || Number(driver.ownerId || 0) !== Number(values.ownerId || 0)) {
          throw Object.assign(new Error("The selected driver does not work for this vehicle owner."), { status: 400 });
        }
        const driverVehicle = orgVehicles.find((vehicle: any) => Number(vehicle.id) !== Number(args.previous?.id || 0) && vehicle.isActive && Number(vehicle.driverId || 0) === selectedDriverId);
        if (driverVehicle) throw Object.assign(new Error(`This driver is already assigned to vehicle ${driverVehicle.registrationNumber}. A driver cannot be assigned to multiple active vehicles.`), { status: 409 });
        const today = isoDate(new Date());
        const [alternativeElsewhere] = await db.select().from(transportVehicleAlternativeDrivers).where(and(
          eq(transportVehicleAlternativeDrivers.driverId, selectedDriverId),
          ne(transportVehicleAlternativeDrivers.vehicleId, Number(args.previous?.id || 0)),
          lte(transportVehicleAlternativeDrivers.effectiveFrom, today),
          or(isNull(transportVehicleAlternativeDrivers.effectiveTo), gte(transportVehicleAlternativeDrivers.effectiveTo, today)),
        )).limit(1);
        if (alternativeElsewhere) {
          const [alternativeVehicle] = await db.select().from(transportVehicles).where(eq(transportVehicles.id, alternativeElsewhere.vehicleId)).limit(1);
          throw Object.assign(new Error(`This driver is an Alternative Driver for ${alternativeVehicle?.registrationNumber || `vehicle #${alternativeElsewhere.vehicleId}`} and cannot become a Primary Driver while that relationship is active.`), { status: 409 });
        }
      }
    }
  }
  return values;
}

async function validateAlternativeDriverIds(args: { school: SchoolRow; vehicleId?: number | null; primaryDriverId?: number | null; ownerId?: number | null; ownershipType: string; alternativeDriverIds: number[] }) {
  const ids = Array.from(new Set(args.alternativeDriverIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  if (args.primaryDriverId && ids.includes(Number(args.primaryDriverId))) throw Object.assign(new Error("The Primary Driver cannot also be an Alternative Driver for the same vehicle."), { status: 400 });
  if (!ids.length) return ids;
  const orgSchoolIds = await organizationSchoolIds(args.school);
  const drivers = await db.select().from(transportDrivers).where(inArray(transportDrivers.id, ids));
  if (drivers.length !== ids.length) throw Object.assign(new Error("One or more selected Alternative Drivers could not be found."), { status: 400 });
  const orgVehicles = await db.select().from(transportVehicles).where(and(inArray(transportVehicles.schoolId, orgSchoolIds), eq(transportVehicles.isActive, true)));
  for (const driver of drivers) {
    if (!driver.isActive) throw Object.assign(new Error(`${driver.firstName} ${driver.lastName} is inactive and cannot be an Alternative Driver.`), { status: 400 });
    if (args.ownershipType === "school") {
      if (driver.engagementType !== "internal") throw Object.assign(new Error(`${driver.firstName} ${driver.lastName} is not an Internal / school driver.`), { status: 400 });
    } else if (driver.engagementType !== "external" || Number(driver.ownerId || 0) !== Number(args.ownerId || 0)) {
      throw Object.assign(new Error(`${driver.firstName} ${driver.lastName} does not work for this vehicle owner.`), { status: 400 });
    }
    const primaryElsewhere = orgVehicles.find((vehicle: any) => Number(vehicle.id) !== Number(args.vehicleId || 0) && Number(vehicle.driverId || 0) === Number(driver.id));
    if (primaryElsewhere) throw Object.assign(new Error(`${driver.firstName} ${driver.lastName} is Primary Driver of ${primaryElsewhere.registrationNumber} and cannot be an Alternative Driver on another active vehicle.`), { status: 409 });
  }
  return ids;
}

function previousDay(dateValue: string): string {
  return isoDate(new Date(new Date(`${dateValue}T00:00:00Z`).getTime() - 86_400_000));
}

function monthEndDate(year: number, month: number): string {
  return isoDate(new Date(Date.UTC(year, month, 0)));
}

async function effectiveVehicleOwnerId(vehicle: any, atDate: string): Promise<number | null> {
  const [history] = await db.select().from(transportVehicleOwnerHistory).where(and(
    eq(transportVehicleOwnerHistory.vehicleId, Number(vehicle.id)),
    lte(transportVehicleOwnerHistory.effectiveFrom, atDate),
    or(isNull(transportVehicleOwnerHistory.effectiveTo), gte(transportVehicleOwnerHistory.effectiveTo, atDate)),
  )).orderBy(desc(transportVehicleOwnerHistory.effectiveFrom), desc(transportVehicleOwnerHistory.id)).limit(1);
  return history?.ownerId ? Number(history.ownerId) : (vehicle.ownerId ? Number(vehicle.ownerId) : null);
}

async function effectivePrimaryDriverId(vehicle: any, atDate: string): Promise<number | null> {
  const [history] = await db.select().from(transportVehicleDriverHistory).where(and(
    eq(transportVehicleDriverHistory.vehicleId, Number(vehicle.id)),
    lte(transportVehicleDriverHistory.effectiveFrom, atDate),
    or(isNull(transportVehicleDriverHistory.effectiveTo), gte(transportVehicleDriverHistory.effectiveTo, atDate)),
  )).orderBy(desc(transportVehicleDriverHistory.effectiveFrom), desc(transportVehicleDriverHistory.id)).limit(1);
  return history?.driverId ? Number(history.driverId) : (vehicle.driverId ? Number(vehicle.driverId) : null);
}

async function effectiveOperatingDriverId(vehicle: any, at: Date): Promise<number | null> {
  const [history] = await db.select().from(transportVehicleOperatingDriverHistory).where(and(
    eq(transportVehicleOperatingDriverHistory.vehicleId, Number(vehicle.id)),
    lte(transportVehicleOperatingDriverHistory.effectiveFrom, at),
    or(isNull(transportVehicleOperatingDriverHistory.effectiveTo), gte(transportVehicleOperatingDriverHistory.effectiveTo, at)),
  )).orderBy(desc(transportVehicleOperatingDriverHistory.effectiveFrom), desc(transportVehicleOperatingDriverHistory.id)).limit(1);
  if (history?.driverId) return Number(history.driverId);
  return effectivePrimaryDriverId(vehicle, isoDate(at));
}

async function reconcileVehicleEffectiveRelationships(schoolId: number) {
  const now = new Date();
  const today = isoDate(now);
  const vehicleLinks = await db.select({ vehicleId: transportVehicleSchools.vehicleId }).from(transportVehicleSchools).where(and(
    eq(transportVehicleSchools.schoolId, schoolId),
    eq(transportVehicleSchools.isActive, true),
  ));
  const vehicleIds = Array.from(new Set(vehicleLinks.map((row) => Number(row.vehicleId)).filter(Boolean)));
  for (const vehicleId of vehicleIds) {
    const [vehicle] = await db.select().from(transportVehicles).where(eq(transportVehicles.id, vehicleId)).limit(1);
    if (!vehicle) continue;
    const ownerId = await effectiveVehicleOwnerId(vehicle, today);
    const driverId = await effectivePrimaryDriverId(vehicle, today);
    const operatingDriverId = await effectiveOperatingDriverId({ ...vehicle, driverId }, now);
    const updates: any = {};
    if (Number(vehicle.ownerId || 0) !== Number(ownerId || 0)) updates.ownerId = ownerId;
    if (Number(vehicle.driverId || 0) !== Number(driverId || 0)) updates.driverId = driverId;
    if (Number(vehicle.currentOperatingDriverId || 0) !== Number(operatingDriverId || 0)) updates.currentOperatingDriverId = operatingDriverId;
    if (Object.keys(updates).length) {
      updates.updatedAt = new Date();
      await db.update(transportVehicles).set(updates).where(eq(transportVehicles.id, vehicleId));
    }
  }
}

async function applyDueVehicleReplacements(schoolId: number) {
  const now = new Date();
  const replacements = await db.select().from(transportVehicleReplacements).where(and(
    eq(transportVehicleReplacements.schoolId, schoolId),
    lte(transportVehicleReplacements.effectiveFrom, now),
    or(isNull(transportVehicleReplacements.effectiveTo), gte(transportVehicleReplacements.effectiveTo, now)),
  )).orderBy(asc(transportVehicleReplacements.effectiveFrom), asc(transportVehicleReplacements.id));
  for (const record of replacements) {
    const assignments = await db.select().from(transportAssignments).where(and(
      eq(transportAssignments.schoolId, schoolId),
      eq(transportAssignments.isActive, true),
      or(eq(transportAssignments.vehicleId, record.originalVehicleId), eq(transportAssignments.outboundVehicleId, record.originalVehicleId)),
    ));
    for (const assignment of assignments) {
      const changes: any = { updatedAt: new Date() };
      if (Number(assignment.vehicleId || 0) === Number(record.originalVehicleId)) changes.vehicleId = record.replacementVehicleId;
      if (Number(assignment.outboundVehicleId || 0) === Number(record.originalVehicleId)) changes.outboundVehicleId = record.replacementVehicleId;
      const [updated] = await db.update(transportAssignments).set(changes).where(eq(transportAssignments.id, assignment.id)).returning();
      await db.insert(transportAssignmentEvents).values({
        schoolId,
        assignmentId: assignment.id,
        eventType: record.replacementType === "temporary" ? "temporary_vehicle_replacement" : "vehicle_replaced",
        effectiveDate: isoDate(record.effectiveFrom),
        previousValues: assignment,
        newValues: updated,
        reason: record.reason,
        createdByUserId: record.createdByUserId,
      });
    }
  }
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
      const requestedDestinationIds = entityType === "vehicle"
        ? Array.from(new Set<number>((Array.isArray(req.body?.destinationIds) ? req.body.destinationIds : []).map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0)))
        : [];
      const requestedAlternativeDriverIds = entityType === "vehicle"
        ? Array.from(new Set<number>((Array.isArray(req.body?.alternativeDriverIds) ? req.body.alternativeDriverIds : []).map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0)))
        : [];
      const raw = clean(schema.parse(req.body));
      if (entityType === "vehicle") delete (raw as any).alternativeDriverIds;
      if (entityType === "vehicle" && String((raw as any).status || "active") === "active" && requestedDestinationIds.length === 0) {
        throw Object.assign(new Error("Select at least one Destination before saving an active Transport vehicle."), { status: 400 });
      }
      const effectiveDate = (raw as any).effectiveDate || (raw as any).effectiveFrom || isoDate(new Date());
      const changeReason = (raw as any).changeReason || "Initial assignment";
      delete (raw as any).effectiveDate;
      delete (raw as any).changeReason;

      if (["vehicle", "driver", "owner"].includes(entityType)) {
        await ensureTransportScopeFoundation(school, user.id);
        const orgSchoolIds = await organizationSchoolIds(school);
        let existing: any = null;
        if (entityType === "vehicle") {
          const key = registrationKey((raw as any).registrationNumber);
          const rows = await db.select().from(transportVehicles).where(inArray(transportVehicles.schoolId, orgSchoolIds));
          existing = rows.find((row: any) => registrationKey(row.registrationNumber) === key) || null;
        } else if (entityType === "driver") {
          const rows = await db.select().from(transportDrivers).where(inArray(transportDrivers.schoolId, orgSchoolIds));
          const nationalId = String((raw as any).nationalId || "").trim().toLowerCase();
          const licence = String((raw as any).licenceNumber || "").trim().toLowerCase();
          const phone = String((raw as any).phone || "").replace(/\s+/g, "");
          const fullName = `${String((raw as any).firstName || "").trim().toLowerCase()} ${String((raw as any).lastName || "").trim().toLowerCase()}`;
          existing = rows.find((row: any) => (nationalId && String(row.nationalId || "").trim().toLowerCase() === nationalId) || (licence && String(row.licenceNumber || "").trim().toLowerCase() === licence) || (phone && `${String(row.firstName || "").trim().toLowerCase()} ${String(row.lastName || "").trim().toLowerCase()}` === fullName && String(row.phone || "").replace(/\s+/g, "") === phone)) || null;
        } else if (entityType === "owner") {
          const rows = await db.select().from(transportOwners).where(inArray(transportOwners.schoolId, orgSchoolIds));
          const staffId = Number((raw as any).staffId || 0);
          const nationalId = String((raw as any).nationalIdOrRegistration || "").trim().toLowerCase();
          const phone = String((raw as any).phone || "").replace(/\s+/g, "");
          const name = String((raw as any).name || "").trim().toLowerCase();
          existing = rows.find((row: any) => (staffId && Number(row.staffId || 0) === staffId) || (nationalId && String(row.nationalIdOrRegistration || "").trim().toLowerCase() === nationalId) || (phone && name && String(row.name || "").trim().toLowerCase() === name && String(row.phone || "").replace(/\s+/g, "") === phone)) || null;
        }
        if (existing) {
          await ensureMasterAssociation(entityType as "vehicle" | "driver" | "owner", Number(existing.id), school.id, user.id);
          if (entityType === "vehicle" && requestedDestinationIds.length) {
            const destinationRows = await db.select({ id: transportRoutes.id, destinationMasterId: transportRoutes.destinationMasterId }).from(transportRoutes).where(and(inArray(transportRoutes.id, requestedDestinationIds), inArray(transportRoutes.schoolId, orgSchoolIds)));
            for (const destination of destinationRows) {
              await db.insert(transportVehicleDestinations).values({ vehicleId: existing.id, routeId: destination.id, destinationMasterId: destination.destinationMasterId || null, createdByUserId: user.id }).onConflictDoNothing();
            }
          }
          if (entityType === "vehicle" && requestedAlternativeDriverIds.length) {
            const altIds = await validateAlternativeDriverIds({ school, vehicleId: existing.id, primaryDriverId: existing.driverId, ownerId: existing.ownerId, ownershipType: existing.ownershipType, alternativeDriverIds: requestedAlternativeDriverIds });
            const active = await db.select().from(transportVehicleAlternativeDrivers).where(and(eq(transportVehicleAlternativeDrivers.vehicleId, existing.id), isNull(transportVehicleAlternativeDrivers.effectiveTo)));
            const activeIds = new Set(active.map((row:any)=>Number(row.driverId)));
            for (const driverId of altIds) if (!activeIds.has(driverId)) await db.insert(transportVehicleAlternativeDrivers).values({ vehicleId: existing.id, driverId, effectiveFrom: effectiveDate, reason: changeReason, createdByUserId: user.id });
          }
          await writeAudit(db, school.id, user.id, entityType, existing.id, "associate_school", null, existing, `Existing organisation ${entityType} associated with ${school.name}`);
          return res.status(200).json({ ...existing, associatedExisting: true });
        }
      }

      if (entityType === "route" && school.organizationId) {
        let master: any = null;
        if ((raw as any).destinationMasterId) [master] = await db.select().from(transportDestinationMasters).where(and(eq(transportDestinationMasters.id, Number((raw as any).destinationMasterId)), eq(transportDestinationMasters.organizationId, school.organizationId))).limit(1);
        if (!master) {
          const key = canonicalDestinationKey((raw as any).name);
          [master] = await db.select().from(transportDestinationMasters).where(and(eq(transportDestinationMasters.organizationId, school.organizationId), eq(transportDestinationMasters.canonicalKey, key))).limit(1);
          if (!master) [master] = await db.insert(transportDestinationMasters).values({ organizationId: school.organizationId, name: (raw as any).name, canonicalKey: key, isActive: true }).returning();
        }
        (raw as any).destinationMasterId = master.id;
      }
      const parsed = await validateTransportMasterValues({ entityType, values: raw, school });
      const created = await db.transaction(async (tx) => {
        const values: any = { ...parsed, schoolId: school.id };
        if ("createdByUserId" in table) values.createdByUserId = user.id;
        const [row] = await (tx.insert(table) as any).values(values).returning();
        if (entityType === "vehicle" && row.ownerId) {
          await tx.insert(transportVehicleOwnerHistory).values({ schoolId: school.id, vehicleId: row.id, ownerId: row.ownerId, effectiveFrom: effectiveDate, reason: changeReason, createdByUserId: user.id });
        }
        if (entityType === "vehicle" && row.driverId) {
          await tx.insert(transportVehicleDriverHistory).values({ schoolId: school.id, vehicleId: row.id, driverId: row.driverId, effectiveFrom: effectiveDate, reason: changeReason, createdByUserId: user.id });
        }
        if (entityType === "vehicle" && row.driverId) {
          await tx.update(transportVehicles).set({ currentOperatingDriverId: row.driverId }).where(eq(transportVehicles.id, row.id));
          await tx.insert(transportVehicleOperatingDriverHistory).values({ schoolId: school.id, vehicleId: row.id, driverId: row.driverId, operatingMode: "primary", effectiveFrom: new Date(`${effectiveDate}T00:00:00Z`), reason: changeReason, createdByUserId: user.id });
        }
        if (entityType === "vehicle" && requestedAlternativeDriverIds.length) {
          const altIds = await validateAlternativeDriverIds({ school, vehicleId: row.id, primaryDriverId: row.driverId, ownerId: row.ownerId, ownershipType: row.ownershipType, alternativeDriverIds: requestedAlternativeDriverIds });
          await tx.insert(transportVehicleAlternativeDrivers).values(altIds.map((driverId) => ({ vehicleId: row.id, driverId, effectiveFrom: effectiveDate, reason: changeReason, createdByUserId: user.id })));
        }
        if (entityType === "driver") {
          await tx.insert(transportDriverOwnerHistory).values({ schoolId: school.id, driverId: row.id, ownerId: row.ownerId || null, effectiveFrom: effectiveDate, reason: changeReason, createdByUserId: user.id });
        }
        if (entityType === "vehicle" && requestedDestinationIds.length) {
          const orgSchoolIds = await organizationSchoolIds(school);
          const destinationRows = await tx.select({ id: transportRoutes.id, destinationMasterId: transportRoutes.destinationMasterId }).from(transportRoutes).where(and(inArray(transportRoutes.id, requestedDestinationIds), inArray(transportRoutes.schoolId, orgSchoolIds)));
          if (destinationRows.length !== requestedDestinationIds.length) throw Object.assign(new Error("One or more selected destinations are not available in this organisation."), { status: 400 });
          await tx.insert(transportVehicleDestinations).values(destinationRows.map((destination: any) => ({ vehicleId: row.id, routeId: destination.id, destinationMasterId: destination.destinationMasterId || null, createdByUserId: user.id })));
        }
        await writeAudit(tx, school.id, user.id, entityType, row.id, "create", null, row, changeReason, entityType === "vehicle" ? { destinationIds: requestedDestinationIds } : null);
        return row;
      });
      if (["vehicle", "driver", "owner"].includes(entityType)) await ensureMasterAssociation(entityType as "vehicle" | "driver" | "owner", Number(created.id), school.id, user.id);
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
      const isOrganizationMaster = ["owner", "driver", "vehicle"].includes(entityType);
      const previous = isOrganizationMaster ? await assertOrganizationRecord(table, id, school) : await assertSchoolRecord(table, id, school.id);
      if (!previous) return res.status(404).json({ message: "Record not found" });
      const destinationIdsProvided = entityType === "vehicle" && Array.isArray(req.body?.destinationIds);
      const requestedDestinationIds = destinationIdsProvided
        ? Array.from(new Set<number>(req.body.destinationIds.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0)))
        : [];
      const alternativeDriverIdsProvided = entityType === "vehicle" && Array.isArray(req.body?.alternativeDriverIds);
      const requestedAlternativeDriverIds = alternativeDriverIdsProvided
        ? Array.from(new Set<number>(req.body.alternativeDriverIds.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0)))
        : [];
      const partial: any = clean(schema.partial().parse(req.body));
      if (entityType === "vehicle") delete partial.alternativeDriverIds;
      const effectiveVehicleStatus = String(partial.status || previous.status || "active");
      if (entityType === "vehicle" && destinationIdsProvided && effectiveVehicleStatus === "active" && requestedDestinationIds.length === 0) {
        throw Object.assign(new Error("Select at least one Destination before saving an active Transport vehicle."), { status: 400 });
      }
      const effectiveDate = partial.effectiveDate || isoDate(new Date());
      const changeReason = partial.changeReason || "Record updated";
      delete partial.effectiveDate;
      delete partial.changeReason;
      if (entityType === "route" && partial.name && school.organizationId) {
        const key = canonicalDestinationKey(partial.name);
        let [master] = await db.select().from(transportDestinationMasters).where(and(eq(transportDestinationMasters.organizationId, school.organizationId), eq(transportDestinationMasters.canonicalKey, key))).limit(1);
        if (!master) [master] = await db.insert(transportDestinationMasters).values({ organizationId: school.organizationId, name: partial.name, canonicalKey: key, isActive: true }).returning();
        partial.destinationMasterId = master.id;
      }
      const mergedForValidation = { ...previous, ...partial };
      const validated = await validateTransportMasterValues({ entityType, values: mergedForValidation, school, previous });
      const parsed: any = {};
      for (const key of Object.keys(partial)) parsed[key] = validated[key];
      // Business rules can clear a field even when the browser did not explicitly submit it.
      if (entityType === "owner" && !validated.isStaffOwner) parsed.staffId = null;
      if (entityType === "driver" && validated.engagementType === "internal") parsed.ownerId = null;
      if (entityType === "vehicle" && validated.ownershipType === "school") parsed.ownerId = null;
      parsed.updatedAt = new Date();

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(table).set(parsed).where(eq(table.id, id)).returning();
        if (entityType === "vehicle" && Number(row.ownerId || 0) !== Number(previous.ownerId || 0)) {
          await tx.update(transportVehicleOwnerHistory).set({ effectiveTo: previousDay(effectiveDate) })
            .where(and(eq(transportVehicleOwnerHistory.vehicleId, id), isNull(transportVehicleOwnerHistory.effectiveTo)));
          if (row.ownerId) await tx.insert(transportVehicleOwnerHistory).values({ schoolId: school.id, vehicleId: id, ownerId: row.ownerId, effectiveFrom: effectiveDate, reason: changeReason, createdByUserId: user.id });
        }
        if (entityType === "vehicle" && Number(row.driverId || 0) !== Number(previous.driverId || 0)) {
          await tx.update(transportVehicleDriverHistory).set({ effectiveTo: previousDay(effectiveDate) })
            .where(and(eq(transportVehicleDriverHistory.vehicleId, id), isNull(transportVehicleDriverHistory.effectiveTo)));
          if (row.driverId) await tx.insert(transportVehicleDriverHistory).values({ schoolId: school.id, vehicleId: id, driverId: row.driverId, effectiveFrom: effectiveDate, reason: changeReason, createdByUserId: user.id });
        }
        if (entityType === "vehicle" && Number(row.driverId || 0) !== Number(previous.driverId || 0) && row.driverId) {
          const [activeCover] = await tx.select().from(transportVehicleOperatingDriverHistory).where(and(eq(transportVehicleOperatingDriverHistory.vehicleId, id), eq(transportVehicleOperatingDriverHistory.operatingMode, "alternative"), isNull(transportVehicleOperatingDriverHistory.effectiveTo))).limit(1);
          if (!activeCover) {
            await tx.update(transportVehicleOperatingDriverHistory).set({ effectiveTo: new Date(`${effectiveDate}T00:00:00Z`) }).where(and(eq(transportVehicleOperatingDriverHistory.vehicleId, id), isNull(transportVehicleOperatingDriverHistory.effectiveTo)));
            await tx.insert(transportVehicleOperatingDriverHistory).values({ schoolId: school.id, vehicleId: id, driverId: row.driverId, operatingMode: "primary", effectiveFrom: new Date(`${effectiveDate}T00:00:00Z`), reason: changeReason, createdByUserId: user.id });
            await tx.update(transportVehicles).set({ currentOperatingDriverId: row.driverId }).where(eq(transportVehicles.id, id));
          }
        }
        if (entityType === "vehicle" && alternativeDriverIdsProvided) {
          const altIds = await validateAlternativeDriverIds({ school, vehicleId: id, primaryDriverId: row.driverId, ownerId: row.ownerId, ownershipType: row.ownershipType, alternativeDriverIds: requestedAlternativeDriverIds });
          const activeRows = await tx.select().from(transportVehicleAlternativeDrivers).where(and(eq(transportVehicleAlternativeDrivers.vehicleId, id), isNull(transportVehicleAlternativeDrivers.effectiveTo)));
          const requested = new Set(altIds);
          for (const alt of activeRows) if (!requested.has(Number(alt.driverId))) await tx.update(transportVehicleAlternativeDrivers).set({ effectiveTo: previousDay(effectiveDate), reason: changeReason }).where(eq(transportVehicleAlternativeDrivers.id, alt.id));
          const activeIds = new Set(activeRows.map((row:any)=>Number(row.driverId)));
          for (const driverId of altIds) if (!activeIds.has(driverId)) await tx.insert(transportVehicleAlternativeDrivers).values({ vehicleId: id, driverId, effectiveFrom: effectiveDate, reason: changeReason, createdByUserId: user.id });
        }
        if (entityType === "driver" && Number(row.ownerId || 0) !== Number(previous.ownerId || 0)) {
          await tx.update(transportDriverOwnerHistory).set({ effectiveTo: previousDay(effectiveDate) })
            .where(and(eq(transportDriverOwnerHistory.driverId, id), isNull(transportDriverOwnerHistory.effectiveTo)));
          await tx.insert(transportDriverOwnerHistory).values({ schoolId: school.id, driverId: id, ownerId: row.ownerId || null, effectiveFrom: effectiveDate, reason: changeReason, createdByUserId: user.id });
        }
        if (entityType === "vehicle" && destinationIdsProvided) {
          const orgSchoolIds = await organizationSchoolIds(school);
          if (requestedDestinationIds.length) {
            const destinationRows = await tx.select({ id: transportRoutes.id, destinationMasterId: transportRoutes.destinationMasterId }).from(transportRoutes).where(and(inArray(transportRoutes.id, requestedDestinationIds), inArray(transportRoutes.schoolId, orgSchoolIds)));
            if (destinationRows.length !== requestedDestinationIds.length) throw Object.assign(new Error("One or more selected destinations are not available in this organisation."), { status: 400 });
          }
          await tx.delete(transportVehicleDestinations).where(eq(transportVehicleDestinations.vehicleId, id));
          if (requestedDestinationIds.length) { const destinationRows = await tx.select({ id: transportRoutes.id, destinationMasterId: transportRoutes.destinationMasterId }).from(transportRoutes).where(inArray(transportRoutes.id, requestedDestinationIds)); await tx.insert(transportVehicleDestinations).values(destinationRows.map((destination: any) => ({ vehicleId: id, routeId: destination.id, destinationMasterId: destination.destinationMasterId || null, createdByUserId: user.id }))); }
        }
        await writeAudit(tx, school.id, user.id, entityType, id, "update", previous, row, changeReason, entityType === "vehicle" ? { destinationIds: requestedDestinationIds } : null);
        return row;
      });
      return res.json(updated);
    } catch (error) {
      return routeError(res, error);
    }
  });
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => value * Math.PI / 180;
  const earth = 6371000;
  const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type RouteCoordinate = { latitude: number; longitude: number; name?: string; type?: string; schoolId?: number | null; servicePointId?: number | null };

function nearestNeighborOrder(points: RouteCoordinate[], start?: RouteCoordinate): RouteCoordinate[] {
  if (!points.length) return [];
  const remaining = [...points];
  let current = start || remaining.shift()!;
  const ordered = start ? [start] : [current];
  if (start) {
    const index = remaining.findIndex((point) => point === start || (point.latitude === start.latitude && point.longitude === start.longitude && point.name === start.name));
    if (index >= 0) remaining.splice(index, 1);
  }
  while (remaining.length) {
    let bestIndex = 0; let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const point = remaining[index];
      const distance = haversineMeters(current.latitude, current.longitude, point.latitude, point.longitude);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    }
    current = remaining.splice(bestIndex, 1)[0]; ordered.push(current);
  }
  return ordered;
}

async function roadRoute(coordinates: RouteCoordinate[]) {
  if (coordinates.length < 2) return { geometry: coordinates.map((point) => [point.longitude, point.latitude]), distanceKm: 0, durationMinutes: 0, provider: "derived" };
  try {
    const baseUrl = (process.env.TRANSPORT_ROUTING_URL || "https://router.project-osrm.org").replace(/\/$/, "");
    const coordinatePath = coordinates.map((point) => `${point.longitude},${point.latitude}`).join(";");
    const response = await fetch(`${baseUrl}/route/v1/driving/${coordinatePath}?overview=full&geometries=geojson&steps=false`);
    if (!response.ok) throw new Error(`Routing provider returned ${response.status}`);
    const payload: any = await response.json(); const route = payload?.routes?.[0];
    if (!route?.geometry?.coordinates) throw new Error("No road route returned");
    return { geometry: route.geometry.coordinates, distanceKm: rounded(Number(route.distance || 0) / 1000), durationMinutes: Math.round(Number(route.duration || 0) / 60), provider: "osrm" };
  } catch {
    let meters = 0;
    for (let index=1; index<coordinates.length; index += 1) meters += haversineMeters(coordinates[index-1].latitude, coordinates[index-1].longitude, coordinates[index].latitude, coordinates[index].longitude);
    return { geometry: coordinates.map((point) => [point.longitude, point.latitude]), distanceKm: rounded(meters/1000), durationMinutes: Math.round((meters/1000)/30*60), provider: "straight-line-fallback" };
  }
}

async function getTransportPeriodSummary(schoolId: number, from: string, to: string) {
  const summary = await db.execute(sql`
    SELECT
      COALESCE((SELECT SUM(amount) FROM transport_payments WHERE school_id=${schoolId} AND payment_date BETWEEN ${from} AND ${to} AND reversed_at IS NULL),0)::text AS received,
      COALESCE((SELECT SUM(amount) FROM transport_charges WHERE school_id=${schoolId} AND service_period_start <= ${to} AND service_period_end >= ${from} AND status NOT IN ('cancelled','void')),0)::text AS charged,
      COALESCE((SELECT SUM(amount) FROM transport_refunds WHERE school_id=${schoolId} AND effective_date BETWEEN ${from} AND ${to} AND status='paid' AND method <> 'credit'),0)::text AS external_refunds_paid,
      COALESCE((SELECT SUM(amount) FROM transport_refunds WHERE school_id=${schoolId} AND effective_date BETWEEN ${from} AND ${to} AND status='credited' AND method='credit'),0)::text AS account_credits,
      COALESCE((SELECT SUM(gross_amount) FROM transport_claims WHERE school_id=${schoolId} AND make_date(service_year,service_month,1) BETWEEN date_trunc('month',${from}::date) AND date_trunc('month',${to}::date)),0)::text AS claim_gross
  `);
  const row: any = summary.rows[0] || {};
  const grossReceived = amount(row.received); const refundsPaid = amount(row.external_refunds_paid);
  const normalized = { ...row, refunds: String(refundsPaid), net_collections: String(rounded(grossReceived - refundsPaid)), payout_net: "0" };
  const byMethod = await db.execute(sql`SELECT payment_method AS method, SUM(amount)::text amount, COUNT(*)::int count FROM transport_payments WHERE school_id=${schoolId} AND payment_date BETWEEN ${from} AND ${to} AND reversed_at IS NULL GROUP BY payment_method ORDER BY payment_method`);
  const refundByMethod = await db.execute(sql`SELECT method, SUM(amount)::text amount, COUNT(*)::int count FROM transport_refunds WHERE school_id=${schoolId} AND effective_date BETWEEN ${from} AND ${to} AND status='paid' AND method <> 'credit' GROUP BY method ORDER BY method`);
  return { from, to, summary: normalized, byMethod: byMethod.rows, refundsByMethod: refundByMethod.rows };
}


type SchoolClaimComputation = {
  vehicle: any;
  candidates: any[];
  excluded: Array<{ allocationId: number; receiptNo: string; amount: number; reason: string }>;
  currentPeriodAmount: number;
  priorPeriodAmount: number;
  providerAdditions: number;
  gross: number;
  deductions: Array<{ type: string; sourceId?: number; description: string; amount: number; priority: number }>;
  deductionAmount: number;
  net: number;
  providerAdjustments: any[];
};

async function computeSchoolClaim(school: SchoolRow, vehicleId: number, serviceYear: number, serviceMonth: number, existingDraftId?: number | null): Promise<SchoolClaimComputation> {
  const vehicle = await assertOrganizationRecord(transportVehicles, vehicleId, school);
  if (!vehicle) throw Object.assign(new Error("Vehicle not found"), { status: 404 });
  const settings = await getOrCreateSettings(school.id);
  const allocationRows = await db.execute(sql`
    SELECT pa.id, pa.amount, pa.service_year AS "serviceYear", pa.service_month AS "serviceMonth",
      p.receipt_no AS "receiptNo", p.verification_status AS "verificationStatus", p.reversed_at AS "reversedAt",
      ca.claim_id AS "claimId"
    FROM transport_payment_allocations pa
    JOIN transport_payments p ON p.id=pa.payment_id
    LEFT JOIN transport_claim_allocations ca ON ca.allocation_id=pa.id
    WHERE p.school_id=${school.id} AND pa.vehicle_id=${vehicleId}
      AND (pa.service_year < ${serviceYear} OR (pa.service_year=${serviceYear} AND pa.service_month <= ${serviceMonth}))
    ORDER BY p.payment_date, p.id, pa.id
  `);
  const excluded: SchoolClaimComputation["excluded"] = [];
  const candidates = (allocationRows.rows as any[]).filter((row) => {
    let reason = "";
    if (row.reversedAt) reason = "Payment reversed";
    else if (row.claimId && Number(row.claimId) !== Number(existingDraftId || 0)) reason = "Already included in another claim";
    else if (settings.requireCashupForClaim && row.verificationStatus !== "reconciled") reason = "Payment has not been reconciled in a verified cash-up";
    else if (!settings.requireCashupForClaim && !["verified", "reconciled"].includes(String(row.verificationStatus))) reason = "Payment has not been verified";
    if (reason) excluded.push({ allocationId: Number(row.id), receiptNo: String(row.receiptNo || "—"), amount: amount(row.amount), reason });
    return !reason;
  });
  const currentPeriodAmount = rounded(candidates.filter((row) => Number(row.serviceYear) === serviceYear && Number(row.serviceMonth) === serviceMonth).reduce((sum, row) => sum + amount(row.amount), 0));
  const priorPeriodAmount = rounded(candidates.reduce((sum, row) => sum + amount(row.amount), 0) - currentPeriodAmount);
  const providerAdjustmentPredicate = existingDraftId
    ? or(eq(transportProviderAdjustments.status, "pending"), eq(transportProviderAdjustments.claimId, existingDraftId))
    : eq(transportProviderAdjustments.status, "pending");
  const providerAdjustments = await db.select().from(transportProviderAdjustments).where(and(
    eq(transportProviderAdjustments.schoolId, school.id), eq(transportProviderAdjustments.vehicleId, vehicleId), providerAdjustmentPredicate,
    or(lte(transportProviderAdjustments.applyYear, serviceYear - 1), and(eq(transportProviderAdjustments.applyYear, serviceYear), lte(transportProviderAdjustments.applyMonth, serviceMonth))),
  )).orderBy(asc(transportProviderAdjustments.applyYear), asc(transportProviderAdjustments.applyMonth), asc(transportProviderAdjustments.id));
  const providerAdditions = rounded(providerAdjustments.filter((row) => row.direction === "addition").reduce((sum, row) => sum + amount(row.amount), 0));
  const gross = rounded(currentPeriodAmount + priorPeriodAmount + providerAdditions);

  let policy: any = null;
  if (school.organizationId) {
    const policies = await db.select().from(transportSubscriptionPolicies).where(and(
      eq(transportSubscriptionPolicies.organizationId, school.organizationId),
      ne(transportSubscriptionPolicies.status, "replaced_before_posting"),
      or(isNull(transportSubscriptionPolicies.vehicleId), eq(transportSubscriptionPolicies.vehicleId, vehicleId)),
      or(lt(transportSubscriptionPolicies.startYear, serviceYear), and(eq(transportSubscriptionPolicies.startYear, serviceYear), lte(transportSubscriptionPolicies.startMonth, serviceMonth))),
    ));
    policies.sort((a, b) => Number(Boolean(b.vehicleId)) - Number(Boolean(a.vehicleId)) || periodKeyForTransport(b.startYear, b.startMonth) - periodKeyForTransport(a.startYear, a.startMonth) || Number(b.id) - Number(a.id));
    policy = policies[0] || null;
  }
  let legacyRule: any = null;
  if (!policy) {
    const legacyRules = await db.select().from(transportSubscriptionRules).where(and(
      eq(transportSubscriptionRules.schoolId, school.id), eq(transportSubscriptionRules.isActive, true),
      or(isNull(transportSubscriptionRules.vehicleId), eq(transportSubscriptionRules.vehicleId, vehicleId)),
      lte(transportSubscriptionRules.effectiveFrom, `${serviceYear}-${String(serviceMonth).padStart(2, "0")}-01`),
      or(isNull(transportSubscriptionRules.effectiveTo), gte(transportSubscriptionRules.effectiveTo, `${serviceYear}-${String(serviceMonth).padStart(2, "0")}-01`)),
    )).orderBy(desc(transportSubscriptionRules.vehicleId), desc(transportSubscriptionRules.effectiveFrom)).limit(1);
    legacyRule = legacyRules[0] || null;
  }
  const deductions: SchoolClaimComputation["deductions"] = [];
  const subscriptionRule = policy || legacyRule;
  if (subscriptionRule) {
    let value = subscriptionRule.ruleType === "fixed" ? amount(subscriptionRule.value) : rounded(gross * amount(subscriptionRule.value) / 100);
    if (subscriptionRule.minimumAmount != null) value = Math.max(value, amount(subscriptionRule.minimumAmount));
    if (subscriptionRule.maximumAmount != null) value = Math.min(value, amount(subscriptionRule.maximumAmount));
    deductions.push({ type: "subscription", sourceId: subscriptionRule.id, description: policy ? `HQ subscription policy (${MONTH_NAMES[serviceMonth - 1]} ${serviceYear})` : "Vehicle subscription fee", amount: rounded(value), priority: deductionPriority(settings, "subscription") });
  }
  const penalties = await db.select().from(transportPenalties).where(and(eq(transportPenalties.schoolId, school.id), eq(transportPenalties.vehicleId, vehicleId), eq(transportPenalties.effectiveYear, serviceYear), eq(transportPenalties.effectiveMonth, serviceMonth), eq(transportPenalties.status, "approved")));
  for (const penalty of penalties) deductions.push({ type: "penalty", sourceId: penalty.id, description: `${penalty.category}: ${penalty.reason}`, amount: amount(penalty.amount), priority: deductionPriority(settings, "penalty") });
  const advances = await db.select().from(transportAdvances).where(and(eq(transportAdvances.schoolId, school.id), eq(transportAdvances.vehicleId, vehicleId), gtZero(transportAdvances.outstandingAmount), inArray(transportAdvances.status, ["disbursed", "recovering"])));
  let availableAfterMandatory = Math.max(0, gross - deductions.reduce((sum, item) => sum + item.amount, 0));
  for (const advance of advances) {
    if (serviceYear < advance.recoveryStartYear || (serviceYear === advance.recoveryStartYear && serviceMonth < advance.recoveryStartMonth)) continue;
    const outstanding = amount(advance.outstandingAmount); const protectedAmount = amount(advance.minimumOwnerTakeHome); const recoverablePool = Math.max(0, availableAfterMandatory - protectedAmount);
    let recovery = advance.recoveryMethod === "percentage" ? rounded(gross * amount(advance.recoveryValue) / 100) : advance.recoveryMethod === "full_available" ? recoverablePool : amount(advance.recoveryValue);
    if (advance.maximumMonthlyRecovery != null) recovery = Math.min(recovery, amount(advance.maximumMonthlyRecovery));
    recovery = rounded(Math.min(recovery, outstanding, recoverablePool));
    if (recovery > 0) { deductions.push({ type: "advance", sourceId: advance.id, description: `Advance recovery ${advance.advanceNumber}`, amount: recovery, priority: deductionPriority(settings, "advance") }); availableAfterMandatory = Math.max(0, availableAfterMandatory - recovery); }
  }
  for (const adjustment of providerAdjustments.filter((row) => row.direction === "deduction")) deductions.push({ type: adjustment.adjustmentType === "refund_recovery" ? "refund" : "other", sourceId: adjustment.id, description: adjustment.reason, amount: amount(adjustment.amount), priority: deductionPriority(settings, adjustment.adjustmentType === "refund_recovery" ? "refund" : "other") });
  const deductionAmount = rounded(Math.min(gross, deductions.reduce((sum, item) => sum + item.amount, 0))); const net = rounded(Math.max(0, gross - deductionAmount));
  return { vehicle, candidates, excluded, currentPeriodAmount, priorPeriodAmount, providerAdditions, gross, deductions, deductionAmount, net, providerAdjustments };
}

function periodKeyForTransport(year: number, month: number) { return year * 100 + month; }

async function saveSchoolClaim(school: SchoolRow, userId: number, serviceYear: number, serviceMonth: number, vehicleId: number, notes?: string | null) {
  await ensureNotLocked(school.id, serviceYear, serviceMonth);
  const existingRows = await db.select().from(transportClaims).where(and(eq(transportClaims.schoolId, school.id), eq(transportClaims.vehicleId, vehicleId), eq(transportClaims.serviceYear, serviceYear), eq(transportClaims.serviceMonth, serviceMonth)));
  const existing = existingRows[0] || null;
  if (existing && existing.status !== "draft") throw Object.assign(new Error(`Claim ${existing.claimNumber} is already ${existing.status} and is frozen. Only Draft claims can be recalculated.`), { status: 409 });
  const computed = await computeSchoolClaim(school, vehicleId, serviceYear, serviceMonth, existing?.id || null);
  const claimEffectiveDate = monthEndDate(serviceYear, serviceMonth);
  const claimOwnerId = await effectiveVehicleOwnerId(computed.vehicle, claimEffectiveDate);
  const claimDriverId = await effectivePrimaryDriverId(computed.vehicle, claimEffectiveDate);
  if (computed.gross <= 0 && computed.providerAdditions <= 0) {
    const reasonSummary = computed.excluded.length ? Array.from(new Set(computed.excluded.map((row) => row.reason))).join("; ") : "No eligible payment allocations were found";
    throw Object.assign(new Error(`No claimable amount exists for ${computed.vehicle.registrationNumber}. ${reasonSummary}.`), { status: 409, preview: computed });
  }
  const claim = await db.transaction(async (tx) => {
    let row: any;
    if (existing) {
      await tx.delete(transportClaimAllocations).where(eq(transportClaimAllocations.claimId, existing.id));
      await tx.delete(transportClaimDeductions).where(eq(transportClaimDeductions.claimId, existing.id));
      await tx.update(transportProviderAdjustments).set({ status: "pending", claimId: null }).where(eq(transportProviderAdjustments.claimId, existing.id));
      [row] = await tx.update(transportClaims).set({ ownerId: claimOwnerId, driverId: claimDriverId, currentPeriodAmount: String(computed.currentPeriodAmount), priorPeriodAmount: String(computed.priorPeriodAmount), grossAmount: String(computed.gross), deductionAmount: String(computed.deductionAmount), netAmount: String(computed.net), notes: notes ?? existing.notes, preparedByUserId: userId }).where(eq(transportClaims.id, existing.id)).returning();
    } else {
      [row] = await tx.insert(transportClaims).values({ schoolId: school.id, vehicleId, ownerId: claimOwnerId, driverId: claimDriverId, claimNumber: numberCode("CLM", school.shortCode, Date.now().toString().slice(-6)), serviceYear, serviceMonth, currentPeriodAmount: String(computed.currentPeriodAmount), priorPeriodAmount: String(computed.priorPeriodAmount), grossAmount: String(computed.gross), deductionAmount: String(computed.deductionAmount), netAmount: String(computed.net), notes, preparedByUserId: userId }).returning();
    }
    for (const candidate of computed.candidates) await tx.insert(transportClaimAllocations).values({ claimId: row.id, allocationId: Number(candidate.id), amount: String(candidate.amount) });
    for (const deduction of computed.deductions) await tx.insert(transportClaimDeductions).values({ claimId: row.id, deductionType: deduction.type, sourceId: deduction.sourceId, description: deduction.description, amount: String(deduction.amount), priority: deduction.priority });
    if (computed.providerAdjustments.length) await tx.update(transportProviderAdjustments).set({ status: "applied", claimId: row.id }).where(inArray(transportProviderAdjustments.id, computed.providerAdjustments.map((item) => item.id)));
    await writeAudit(tx, school.id, userId, "claim", row.id, existing ? "recalculate_draft" : "generate", existing, { claim: row, allocations: computed.candidates.length, excluded: computed.excluded, deductions: computed.deductions });
    return row;
  });
  return { claim, preview: computed };
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
  app.get("/api/transport/payments", requireAuth, requirePermission("transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const query = z.object({
        from: dateString.optional(),
        to: dateString.optional(),
      }).refine((value) => !value.from || !value.to || value.from <= value.to, {
        message: "The From date cannot be after the To date.",
      }).parse(req.query);
      if (!query.from && !query.to) return res.status(400).json({ message: "Select a From date, To date, or both." });
      const dateConditions = [sql`p.school_id=${school.id}`];
      if (query.from) dateConditions.push(sql`p.payment_date >= ${query.from}`);
      if (query.to) dateConditions.push(sql`p.payment_date <= ${query.to}`);
      const payments = await db.execute(sql`
        SELECT p.*,
          p.student_id AS "studentId", p.payment_date AS "paymentDate", p.payment_method AS "paymentMethod",
          p.academic_year AS "academicYear", p.receipt_no AS "receiptNo", p.verification_status AS "verificationStatus",
          p.external_reference AS "externalReference", p.received_by_user_id AS "receivedByUserId", p.verified_at AS "verifiedAt",
          p.verified_by_user_id AS "verifiedByUserId", p.reconciled_at AS "reconciledAt", p.reconciled_by_user_id AS "reconciledByUserId",
          p.reversed_at AS "reversedAt", p.reversed_by_user_id AS "reversedByUserId", p.reversal_reason AS "reversalReason",
          s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo",
          COALESCE(SUM(a.amount),0)::text AS "allocatedAmount",
          (p.amount-COALESCE(SUM(a.amount),0))::text AS "unallocatedAmount",
          (SELECT COUNT(*) FROM transport_receipt_events re WHERE re.payment_id=p.id AND re.event_type='reprint')::int AS "reprintCount",
          ca.claim_id AS "claimId", cl.claim_number AS "claimNumber", po.payout_number AS "payoutNumber",
          cp.cashup_id AS "cashupId", cu.status AS "cashupStatus"
        FROM transport_payments p
        JOIN students s ON s.id=p.student_id
        LEFT JOIN transport_payment_allocations a ON a.payment_id=p.id
        LEFT JOIN transport_claim_allocations ca ON ca.allocation_id=a.id
        LEFT JOIN transport_claims cl ON cl.id=ca.claim_id
        LEFT JOIN transport_payouts po ON po.claim_id=cl.id
        LEFT JOIN transport_cashup_payments cp ON cp.payment_id=p.id
        LEFT JOIN transport_cashups cu ON cu.id=cp.cashup_id
        WHERE ${sql.join(dateConditions, sql` AND `)}
        GROUP BY p.id,s.id,ca.claim_id,cl.claim_number,po.payout_number,cp.cashup_id,cu.status
        ORDER BY p.created_at DESC
      `);
      res.json({ payments: payments.rows });
    } catch (error) { routeError(res, error); }
  });

  app.get("/api/transport/bootstrap", requireAuth, requirePermission("transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const schoolId = school.id;
      const orgSchoolIds = await organizationSchoolIds(school);
      await ensureTransportScopeFoundation(school, userOf(req)?.id || null);
      await reconcileVehicleEffectiveRelationships(schoolId);
      await applyDueVehicleReplacements(schoolId);
      await reconcileTransportAssignmentDates(schoolId);
      await reconcileArrearsSeatReleases(schoolId);
      const settings = await getOrCreateSettings(schoolId);
      const destinationMasters = school.organizationId ? await db.select().from(transportDestinationMasters).where(and(eq(transportDestinationMasters.organizationId, school.organizationId), eq(transportDestinationMasters.isActive, true))).orderBy(asc(transportDestinationMasters.name)) : [];
      const [
        routes,
        points,
        allOwners,
        allDrivers,
        allVehicles,
        servicePoints,
        paths,
        pathNodes,
        pathNodeLearners,
        learnerRows,
        staffRows,
        assignmentsResult,
        paymentsResult,
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
        db.select().from(transportOwners).where(inArray(transportOwners.schoolId, orgSchoolIds)).orderBy(asc(transportOwners.name)),
        db.select().from(transportDrivers).where(inArray(transportDrivers.schoolId, orgSchoolIds)).orderBy(asc(transportDrivers.firstName)),
        db.select().from(transportVehicles).where(inArray(transportVehicles.schoolId, orgSchoolIds)).orderBy(asc(transportVehicles.registrationNumber)),
        db.select().from(transportServicePoints).where(inArray(transportServicePoints.schoolId, orgSchoolIds)).orderBy(desc(transportServicePoints.createdAt)),
        db.select().from(transportVehiclePaths).where(eq(transportVehiclePaths.schoolId, schoolId)).orderBy(desc(transportVehiclePaths.createdAt)),
        db.select().from(transportPathNodes).where(eq(transportPathNodes.schoolId, schoolId)).orderBy(asc(transportPathNodes.pathId), asc(transportPathNodes.stopOrder)),
        db.select().from(transportPathNodeLearners).where(eq(transportPathNodeLearners.schoolId, schoolId)),
        db.select({ id: students.id, firstName: students.firstName, lastName: students.lastName, admissionNo: students.admissionNo, classId: students.classId, className: classes.className, status: students.status })
          .from(students).leftJoin(classes, eq(classes.id, students.classId))
          .where(eq(students.schoolId, schoolId)).orderBy(asc(students.firstName), asc(students.lastName)),
        db.select({ id: staff.id, firstName: staff.firstName, lastName: staff.lastName, position: staff.role, status: staff.status })
          .from(staff).where(eq(staff.schoolId, schoolId)).orderBy(asc(staff.firstName), asc(staff.lastName)),
        db.execute(sql`
          SELECT a.*,
            a.student_id AS "studentId", a.route_id AS "routeId", a.service_type AS "serviceType",
            a.start_date AS "startDate", a.end_date AS "endDate", a.is_active AS "isActive",
            a.service_state AS "serviceState", a.financial_status AS "financialStatus", a.planning_status AS "planningStatus",
            a.seat_reserved_until AS "seatReservedUntil", a.suspension_reason AS "suspensionReason", a.seat_released_at AS "seatReleasedAt",
            (SELECT e.effective_date FROM transport_assignment_events e WHERE e.assignment_id=a.id AND e.event_type='service_cancelled' ORDER BY e.created_at DESC LIMIT 1) AS "cancellationEffectiveDate",
            a.agreed_fee AS "agreedFee", a.base_monthly_fee AS "fullFee", a.vehicle_id AS "vehicleId", a.outbound_vehicle_id AS "outboundVehicleId",
            a.driver_id AS "driverId", a.pickup_service_point_id AS "pickupServicePointId", a.dropoff_service_point_id AS "dropoffServicePointId",
            s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo", c.class_name AS "className",
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
          SELECT p.*,
            p.student_id AS "studentId", p.payment_date AS "paymentDate", p.payment_method AS "paymentMethod",
            p.academic_year AS "academicYear", p.receipt_no AS "receiptNo", p.verification_status AS "verificationStatus",
            p.external_reference AS "externalReference", p.received_by_user_id AS "receivedByUserId", p.verified_at AS "verifiedAt",
            p.verified_by_user_id AS "verifiedByUserId", p.reconciled_at AS "reconciledAt", p.reconciled_by_user_id AS "reconciledByUserId",
            p.reversed_at AS "reversedAt", p.reversed_by_user_id AS "reversedByUserId", p.reversal_reason AS "reversalReason",
            s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo",
            COALESCE(SUM(a.amount),0)::text AS "allocatedAmount",
            (p.amount-COALESCE(SUM(a.amount),0))::text AS "unallocatedAmount",
            (SELECT COUNT(*) FROM transport_receipt_events re WHERE re.payment_id=p.id AND re.event_type='reprint')::int AS "reprintCount",
            ca.claim_id AS "claimId", cl.claim_number AS "claimNumber", po.payout_number AS "payoutNumber",
            cp.cashup_id AS "cashupId", cu.status AS "cashupStatus"
          FROM transport_payments p
          JOIN students s ON s.id=p.student_id
          LEFT JOIN transport_payment_allocations a ON a.payment_id=p.id
          LEFT JOIN transport_claim_allocations ca ON ca.allocation_id=a.id
          LEFT JOIN transport_claims cl ON cl.id=ca.claim_id
          LEFT JOIN transport_payouts po ON po.claim_id=cl.id
          LEFT JOIN transport_cashup_payments cp ON cp.payment_id=p.id
          LEFT JOIN transport_cashups cu ON cu.id=cp.cashup_id
          WHERE p.school_id=${schoolId}
          GROUP BY p.id,s.id,ca.claim_id,cl.claim_number,po.payout_number,cp.cashup_id,cu.status
          ORDER BY p.created_at DESC LIMIT 500
        `),
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

      const legacyAccountedRefundRows = refunds.length ? await db.select({
        refundId: transportCashupRefunds.refundId,
        cashupId: transportCashupRefunds.cashupId,
        verifiedAt: transportCashups.verifiedAt,
      }).from(transportCashupRefunds)
        .innerJoin(transportCashups, eq(transportCashups.id, transportCashupRefunds.cashupId))
        .where(and(inArray(transportCashupRefunds.refundId, refunds.map((row) => row.id)), eq(transportCashups.status, "verified"))) : [];
      const legacyAccountedRefundById = new Map(legacyAccountedRefundRows.map((row) => [Number(row.refundId), row]));
      const refundsForView = refunds.map((refund: any) => {
        const legacy = legacyAccountedRefundById.get(Number(refund.id));
        return legacy && !refund.accountedCashupId
          ? { ...refund, accountedCashupId: Number(legacy.cashupId), accountedAt: legacy.verifiedAt || refund.accountedAt || null }
          : refund;
      });

      const [organizationRoutes, vehicleDestinationRows, billingRuns, learnerAccountsResult] = await Promise.all([
        db.select({ id: transportRoutes.id, schoolId: transportRoutes.schoolId, destinationMasterId: transportRoutes.destinationMasterId, name: transportRoutes.name, code: transportRoutes.code, direction: transportRoutes.direction, defaultFee: transportRoutes.defaultFee, isActive: transportRoutes.isActive, status: transportRoutes.status })
          .from(transportRoutes).where(inArray(transportRoutes.schoolId, orgSchoolIds)).orderBy(asc(transportRoutes.name)),
        db.select({ vehicleId: transportVehicleDestinations.vehicleId, routeId: transportVehicleDestinations.routeId, destinationMasterId: transportVehicleDestinations.destinationMasterId })
          .from(transportVehicleDestinations)
          .innerJoin(transportRoutes, eq(transportRoutes.id, transportVehicleDestinations.routeId))
          .where(inArray(transportRoutes.schoolId, orgSchoolIds)),
        db.select().from(transportBillingRuns).where(eq(transportBillingRuns.schoolId, schoolId)).orderBy(desc(transportBillingRuns.createdAt)).limit(100),
        db.execute(sql`
          WITH learner_ids AS (
            SELECT DISTINCT a.student_id
            FROM transport_assignments a
            WHERE a.school_id=${schoolId}
          ), charge_totals AS (
            SELECT student_id, COALESCE(SUM(amount),0) AS charges
            FROM transport_charges WHERE school_id=${schoolId} AND status <> 'cancelled' GROUP BY student_id
          ), adjustment_totals AS (
            SELECT student_id, COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END),0) AS adjustments
            FROM transport_account_adjustments WHERE school_id=${schoolId} AND status='approved' GROUP BY student_id
          ), payment_totals AS (
            SELECT student_id, COALESCE(SUM(amount),0) AS received
            FROM transport_payments WHERE school_id=${schoolId} AND reversed_at IS NULL GROUP BY student_id
          ), refund_totals AS (
            SELECT student_id, COALESCE(SUM(amount),0) AS external_refunds_paid
            FROM transport_refunds WHERE school_id=${schoolId} AND status='paid' AND method <> 'credit' GROUP BY student_id
          ), current_assignment AS (
            SELECT DISTINCT ON (student_id) student_id, id AS assignment_id, route_id, vehicle_id, service_state, financial_status, start_date, end_date,
                   seat_reserved_until, suspension_reason, seat_released_at, is_active
            FROM transport_assignments WHERE school_id=${schoolId}
            ORDER BY student_id, is_active DESC, start_date DESC, id DESC
          )
          SELECT s.id AS "studentId", s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo", c.class_name AS "className", s.status AS "studentStatus", s.archived_at AS "archivedAt",
                 ca.assignment_id AS "assignmentId", ca.service_state AS "serviceState", ca.financial_status AS "financialStatus", ca.start_date AS "startDate", ca.end_date AS "endDate",
                 ca.seat_reserved_until AS "seatReservedUntil", ca.suspension_reason AS "suspensionReason", ca.seat_released_at AS "seatReleasedAt", ca.is_active AS "isActive",
                 r.name AS "destinationName", v.registration_number AS "vehicleRegistration",
                 COALESCE(ct.charges,0)::text AS charges, COALESCE(at.adjustments,0)::text AS adjustments, COALESCE(pt.received,0)::text AS received,
                 COALESCE(rt.external_refunds_paid,0)::text AS "externalRefundsPaid",
                 (COALESCE(ct.charges,0)+COALESCE(at.adjustments,0)+COALESCE(rt.external_refunds_paid,0)-COALESCE(pt.received,0))::text AS balance
          FROM learner_ids li
          JOIN students s ON s.id=li.student_id
          LEFT JOIN classes c ON c.id=s.class_id
          LEFT JOIN charge_totals ct ON ct.student_id=s.id
          LEFT JOIN adjustment_totals at ON at.student_id=s.id
          LEFT JOIN payment_totals pt ON pt.student_id=s.id
          LEFT JOIN refund_totals rt ON rt.student_id=s.id
          LEFT JOIN current_assignment ca ON ca.student_id=s.id
          LEFT JOIN transport_routes r ON r.id=ca.route_id
          LEFT JOIN transport_vehicles v ON v.id=ca.vehicle_id
          ORDER BY s.first_name,s.last_name,s.admission_no
        `),
      ]);

      const [vehicleSchoolLinks, organizationVehicleSchoolLinks, driverSchoolLinks, ownerSchoolLinks, alternativeDriverLinks, operatingDriverHistory, vehicleReplacementHistory, organizationSettings] = await Promise.all([
        db.select().from(transportVehicleSchools).where(and(eq(transportVehicleSchools.schoolId, schoolId), eq(transportVehicleSchools.isActive, true))),
        db.select().from(transportVehicleSchools).where(and(inArray(transportVehicleSchools.schoolId, orgSchoolIds), eq(transportVehicleSchools.isActive, true))),
        db.select().from(transportDriverSchools).where(and(eq(transportDriverSchools.schoolId, schoolId), eq(transportDriverSchools.isActive, true))),
        db.select().from(transportOwnerSchools).where(and(eq(transportOwnerSchools.schoolId, schoolId), eq(transportOwnerSchools.isActive, true))),
        db.select().from(transportVehicleAlternativeDrivers).where(and(
          lte(transportVehicleAlternativeDrivers.effectiveFrom, isoDate(new Date())),
          or(isNull(transportVehicleAlternativeDrivers.effectiveTo), gte(transportVehicleAlternativeDrivers.effectiveTo, isoDate(new Date()))),
        )),
        db.select().from(transportVehicleOperatingDriverHistory).where(eq(transportVehicleOperatingDriverHistory.schoolId, schoolId)).orderBy(desc(transportVehicleOperatingDriverHistory.effectiveFrom)),
        db.select().from(transportVehicleReplacements).where(eq(transportVehicleReplacements.schoolId, schoolId)).orderBy(desc(transportVehicleReplacements.effectiveFrom)),
        school.organizationId ? getOrCreateOrganizationTransportSettings(school.organizationId) : Promise.resolve(null),
      ]);
      const associatedVehicleIds = new Set(vehicleSchoolLinks.map((row: any) => Number(row.vehicleId)));
      const associatedDriverIds = new Set(driverSchoolLinks.map((row: any) => Number(row.driverId)));
      const associatedOwnerIds = new Set(ownerSchoolLinks.map((row: any) => Number(row.ownerId)));
      const owners = allOwners.filter((row: any) => associatedOwnerIds.has(Number(row.id)));
      const drivers = allDrivers.filter((row: any) => associatedDriverIds.has(Number(row.id)));
      const vehicles = allVehicles.filter((row: any) => associatedVehicleIds.has(Number(row.id)));

      const fleetLinks = allVehicles.length
        ? await db.select({
            transportVehicleId: fleetVehicleProfiles.transportVehicleId,
            fleetVehicleId: fleetVehicleProfiles.id,
            assetId: fleetVehicleProfiles.assetId,
            assetNumber: assetRegister.assetNumber,
            assetName: assetRegister.name,
            assetRegistrationNumber: assetVehicleDetails.registrationNumber,
          }).from(fleetVehicleProfiles)
            .innerJoin(assetRegister, eq(assetRegister.id, fleetVehicleProfiles.assetId))
            .leftJoin(assetVehicleDetails, eq(assetVehicleDetails.assetId, assetRegister.id))
            .where(inArray(fleetVehicleProfiles.transportVehicleId, allVehicles.map((vehicle) => vehicle.id)))
        : [];
      const fleetLinkByTransportVehicle = new Map(fleetLinks.filter((link) => link.transportVehicleId != null).map((link) => [Number(link.transportVehicleId), link]));
      const driverByIdForVehicle = new Map(allDrivers.map((driver:any)=>[Number(driver.id),driver]));
      const alternativesByVehicle = new Map<number, any[]>();
      for (const link of alternativeDriverLinks as any[]) { const driver=driverByIdForVehicle.get(Number(link.driverId)); if (!driver) continue; const bucket=alternativesByVehicle.get(Number(link.vehicleId))||[]; bucket.push(driver); alternativesByVehicle.set(Number(link.vehicleId),bucket); }
      const transportVehiclesWithSource = allVehicles.map((vehicle) => {
        const link = fleetLinkByTransportVehicle.get(vehicle.id);
        const operatingDriver = driverByIdForVehicle.get(Number(vehicle.currentOperatingDriverId || vehicle.driverId || 0)) || null;
        return { ...vehicle, sourceType: link ? "fcgs_asset" : "transport_only", fleetVehicleId: link?.fleetVehicleId ?? null, assetId: link?.assetId ?? null, assetNumber: link?.assetNumber ?? null, assetName: link?.assetName ?? null, alternativeDrivers: alternativesByVehicle.get(Number(vehicle.id)) || [], alternativeDriverIds: (alternativesByVehicle.get(Number(vehicle.id)) || []).map((driver:any)=>driver.id), currentOperatingDriver: operatingDriver };
      });

      const [assignmentPointRefs, fleetPointRefs, orgSchoolRows] = await Promise.all([
        db.select({ schoolId: transportAssignments.schoolId, studentId: transportAssignments.studentId, routeId: transportAssignments.routeId, serviceType: transportAssignments.serviceType, serviceState: transportAssignments.serviceState, financialStatus: transportAssignments.financialStatus, startDate: transportAssignments.startDate, endDate: transportAssignments.endDate, isActive: transportAssignments.isActive, pickupServicePointId: transportAssignments.pickupServicePointId, dropoffServicePointId: transportAssignments.dropoffServicePointId, vehicleId: transportAssignments.vehicleId, outboundVehicleId: transportAssignments.outboundVehicleId })
          .from(transportAssignments).where(and(inArray(transportAssignments.schoolId, orgSchoolIds), or(eq(transportAssignments.isActive, true), and(eq(transportAssignments.serviceState, "pending_start"), ne(transportAssignments.financialStatus, "pending_first_payment"))))),
        school.organizationId
          ? db.select({ schoolId: fleetVehicleOccupants.schoolId, studentId: fleetVehicleOccupants.studentId, routeId: fleetVehicleOccupants.routeId, serviceType: fleetVehicleOccupants.serviceType, pickupServicePointId: fleetVehicleOccupants.pickupServicePointId, dropoffServicePointId: fleetVehicleOccupants.dropoffServicePointId, vehicleId: fleetVehicleOccupants.vehicleId })
              .from(fleetVehicleOccupants).where(and(eq(fleetVehicleOccupants.organizationId, school.organizationId), eq(fleetVehicleOccupants.isActive, true)))
          : Promise.resolve([] as any[]),
        db.select({ id: schools.id, name: schools.name }).from(schools).where(inArray(schools.id, orgSchoolIds)),
      ]);
      const schoolNameById = new Map(orgSchoolRows.map((row) => [Number(row.id), row.name]));
      const studentUsage = new Map<number, Set<number>>();
      const vehicleUsage = new Map<number, Set<string>>();
      const directionUsage = new Map<number, Set<string>>();
      const addUsage = (pointId: unknown, studentId: unknown, vehicleKeys: Array<unknown>) => {
        const point = Number(pointId || 0);
        if (!point) return;
        if (studentId) {
          if (!studentUsage.has(point)) studentUsage.set(point, new Set());
          studentUsage.get(point)!.add(Number(studentId));
        }
        if (!vehicleUsage.has(point)) vehicleUsage.set(point, new Set());
        const bucket = vehicleUsage.get(point)!;
        for (const key of vehicleKeys) if (key) bucket.add(String(key));
      };
      for (const row of assignmentPointRefs) {
        if (row.serviceType === "pickup" || row.serviceType === "both") {
          addUsage(row.pickupServicePointId, row.studentId, [row.vehicleId ? `transport:${row.vehicleId}` : null]);
          const pointId = Number(row.pickupServicePointId || 0); if (pointId) { if (!directionUsage.has(pointId)) directionUsage.set(pointId, new Set()); directionUsage.get(pointId)!.add("schoolbound"); }
        }
        if (row.serviceType === "dropoff" || row.serviceType === "both") {
          const pointId = Number(row.dropoffServicePointId || row.pickupServicePointId || 0);
          addUsage(pointId, row.studentId, [row.outboundVehicleId ? `transport:${row.outboundVehicleId}` : row.vehicleId ? `transport:${row.vehicleId}` : null]);
          if (pointId) { if (!directionUsage.has(pointId)) directionUsage.set(pointId, new Set()); directionUsage.get(pointId)!.add("homebound"); }
        }
      }
      for (const row of fleetPointRefs as any[]) {
        addUsage(row.pickupServicePointId, row.studentId, [row.vehicleId ? `fleet:${row.vehicleId}` : null]);
        addUsage(row.dropoffServicePointId, row.studentId, [row.vehicleId ? `fleet:${row.vehicleId}` : null]);
      }

      const routeByIdForUsage = new Map(organizationRoutes.map((route: any) => [Number(route.id), route]));
      const routeIdsByDestinationMaster = new Map<string, number[]>();
      for (const route of organizationRoutes as any[]) {
        const key = route.destinationMasterId ? `master:${route.destinationMasterId}` : `legacy:${canonicalDestinationKey(route.name)}`;
        routeIdsByDestinationMaster.set(key, [...(routeIdsByDestinationMaster.get(key) || []), Number(route.id)]);
      }
      const destinationStudentIds = new Map<number, Set<number>>();
      const destinationVehicleKeys = new Map<number, Set<string>>();
      const destinationPointIds = new Map<number, Set<number>>();
      const touchDestination = (routeId: unknown, studentId: unknown, vehicleKeys: Array<unknown>, pointIds: Array<unknown>) => {
        const id = Number(routeId || 0); if (!id) return;
        if (!destinationStudentIds.has(id)) destinationStudentIds.set(id, new Set());
        if (studentId) destinationStudentIds.get(id)!.add(Number(studentId));
        if (!destinationVehicleKeys.has(id)) destinationVehicleKeys.set(id, new Set());
        for (const key of vehicleKeys) if (key) destinationVehicleKeys.get(id)!.add(String(key));
        if (!destinationPointIds.has(id)) destinationPointIds.set(id, new Set());
        for (const pointId of pointIds) if (pointId) destinationPointIds.get(id)!.add(Number(pointId));
      };
      for (const row of assignmentPointRefs) {
        touchDestination(row.routeId, row.studentId, [row.vehicleId ? `transport:${row.vehicleId}` : null, row.outboundVehicleId ? `transport:${row.outboundVehicleId}` : null], [row.pickupServicePointId, row.dropoffServicePointId]);
      }
      for (const row of fleetPointRefs as any[]) {
        touchDestination(row.routeId, row.studentId, [row.vehicleId ? `fleet:${row.vehicleId}` : null], [row.pickupServicePointId, row.dropoffServicePointId]);
      }
      for (const row of vehicleDestinationRows) touchDestination(row.routeId, null, [`transport:${row.vehicleId}`], []);
      const destinationUsageForRoute = (route: any) => {
        const destinationKey = route.destinationMasterId ? `master:${route.destinationMasterId}` : `legacy:${canonicalDestinationKey(route.name)}`;
        const peerIds = routeIdsByDestinationMaster.get(destinationKey) || [Number(route.id)];
        const studentsBucket = new Set<number>(); const vehiclesBucket = new Set<string>(); const pointsBucket = new Set<number>();
        for (const peerId of peerIds) {
          for (const studentId of destinationStudentIds.get(peerId) || []) studentsBucket.add(studentId);
          for (const vehicleKey of destinationVehicleKeys.get(peerId) || []) vehiclesBucket.add(vehicleKey);
          for (const pointId of destinationPointIds.get(peerId) || []) pointsBucket.add(pointId);
        }
        return { studentUsageCount: studentsBucket.size, vehicleUsageCount: vehiclesBucket.size, servicePointUsageCount: pointsBucket.size };
      };
      const routesWithUsage = routes.map((route: any) => ({ ...route, ...destinationUsageForRoute(route) }));
      const organizationRoutesWithUsage = organizationRoutes.map((route: any) => ({ ...route, ...destinationUsageForRoute(route) }));
      const servicePointsWithUsage = servicePoints.map((point: any) => ({
        ...point,
        originSchoolName: schoolNameById.get(Number(point.schoolId)) || null,
        studentUsageCount: studentUsage.get(Number(point.id))?.size || 0,
        vehicleUsageCount: vehicleUsage.get(Number(point.id))?.size || 0,
        usageDirections: Array.from(directionUsage.get(Number(point.id)) || []),
      }));
      const destinationIdsByVehicle = new Map<number, number[]>();
      const destinationMasterIdsByVehicle = new Map<number, number[]>();
      for (const row of vehicleDestinationRows) {
        const vehicleId = Number(row.vehicleId);
        if (!destinationIdsByVehicle.has(vehicleId)) destinationIdsByVehicle.set(vehicleId, []);
        destinationIdsByVehicle.get(vehicleId)!.push(Number(row.routeId));
        const masterId = Number(row.destinationMasterId || routeByIdForUsage.get(Number(row.routeId))?.destinationMasterId || 0);
        if (masterId) { if (!destinationMasterIdsByVehicle.has(vehicleId)) destinationMasterIdsByVehicle.set(vehicleId, []); if (!destinationMasterIdsByVehicle.get(vehicleId)!.includes(masterId)) destinationMasterIdsByVehicle.get(vehicleId)!.push(masterId); }
      }
      const destinationById = new Map(organizationRoutesWithUsage.map((route: any) => [Number(route.id), route]));
      const vehicleStudents = new Map<number, Set<number>>();
      const schoolboundStudents = new Map<number, Set<number>>();
      const homeboundStudents = new Map<number, Set<number>>();
      const schoolsByVehicle = new Map<number, Set<number>>();
      const servingSchoolVehicleIds = new Set<number>();
      for (const row of assignmentPointRefs) {
        const primaryVehicleId = row.vehicleId ? Number(row.vehicleId) : null;
        const homeVehicleId = row.outboundVehicleId ? Number(row.outboundVehicleId) : primaryVehicleId;
        const touchVehicle = (vehicleId: number | null, direction: "schoolbound" | "homebound") => {
          if (!vehicleId) return;
          if (!vehicleStudents.has(vehicleId)) vehicleStudents.set(vehicleId, new Set());
          vehicleStudents.get(vehicleId)!.add(Number(row.studentId));
          const directionMap = direction === "schoolbound" ? schoolboundStudents : homeboundStudents;
          if (!directionMap.has(vehicleId)) directionMap.set(vehicleId, new Set());
          directionMap.get(vehicleId)!.add(Number(row.studentId));
          if (!schoolsByVehicle.has(vehicleId)) schoolsByVehicle.set(vehicleId, new Set());
          schoolsByVehicle.get(vehicleId)!.add(Number(row.schoolId));
          if (row.isActive && Number(row.schoolId) === Number(schoolId)) servingSchoolVehicleIds.add(vehicleId);
        };
        if (row.serviceType === "pickup" || row.serviceType === "both") touchVehicle(primaryVehicleId, "schoolbound");
        if (row.serviceType === "dropoff" || row.serviceType === "both") touchVehicle(homeVehicleId, "homebound");
      }
      const vehiclesWithOccupancy = transportVehiclesWithSource.map((vehicle: any) => {
        const destinationIds = destinationIdsByVehicle.get(Number(vehicle.id)) || [];
        const destinationMasterIds = destinationMasterIdsByVehicle.get(Number(vehicle.id)) || [];
        const schoolIdsServed = Array.from(schoolsByVehicle.get(Number(vehicle.id)) || []);
        const schoolboundOccupied = schoolboundStudents.get(Number(vehicle.id))?.size || 0;
        const homeboundOccupied = homeboundStudents.get(Number(vehicle.id))?.size || 0;
        return {
          ...vehicle,
          destinationIds,
          destinationMasterIds,
          destinations: destinationIds.map((routeId) => destinationById.get(routeId)).filter(Boolean),
          occupantCount: vehicleStudents.get(Number(vehicle.id))?.size || 0,
          schoolboundOccupied,
          homeboundOccupied,
          schoolboundSeatsAvailable: Math.max(0, Number(vehicle.capacity || 0) - schoolboundOccupied),
          homeboundSeatsAvailable: Math.max(0, Number(vehicle.capacity || 0) - homeboundOccupied),
          schoolsServed: schoolIdsServed.map((servedSchoolId) => ({ id: servedSchoolId, name: schoolNameById.get(servedSchoolId) || `School ${servedSchoolId}` })),
        };
      });
      const servingVehicles = vehiclesWithOccupancy.filter((vehicle: any) => associatedVehicleIds.has(Number(vehicle.id)));

      const assignmentAccounts = new Map<number, any>();
      for (const row of learnerAccountsResult.rows as any[]) assignmentAccounts.set(Number(row.studentId), row);
      const assignmentsWithLedger = (assignmentsResult.rows as any[]).map((row: any) => {
        const account = assignmentAccounts.get(Number(row.studentId));
        return account ? { ...row, charged: account.charges, adjustments: account.adjustments, paid: account.received, balance: account.balance } : row;
      });

      const arrearsSnapshotResult = await db.execute(sql`
        WITH allocated AS (
          SELECT pa.charge_id, SUM(pa.amount)::numeric AS allocated
          FROM transport_payment_allocations pa
          JOIN transport_payments p ON p.id=pa.payment_id
          WHERE p.school_id=${schoolId} AND p.reversed_at IS NULL
          GROUP BY pa.charge_id
        ), charge_balances AS (
          SELECT c.student_id, c.academic_year, c.month,
                 COALESCE(c.service_period_end,(date_trunc('month',make_date(c.academic_year,GREATEST(c.month,1),1))+interval '1 month - 1 day')::date) AS period_end,
                 GREATEST(0,c.amount-COALESCE(a.allocated,0))::numeric AS outstanding
          FROM transport_charges c
          LEFT JOIN allocated a ON a.charge_id=c.id
          WHERE c.school_id=${schoolId} AND c.status NOT IN ('cancelled','void')
        ), credit_totals AS (
          SELECT student_id,
                 GREATEST(0,COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0))::numeric AS credits
          FROM transport_account_adjustments
          WHERE school_id=${schoolId} AND status='approved' AND effective_date < date_trunc('month',CURRENT_DATE)::date
          GROUP BY student_id
        )
        SELECT cb.student_id AS "studentId",
               GREATEST(0,COALESCE(SUM(cb.outstanding) FILTER (WHERE cb.period_end < date_trunc('month',CURRENT_DATE)::date),0)-COALESCE(ct.credits,0))::text AS "qualifyingArrears",
               MIN(make_date(cb.academic_year,GREATEST(cb.month,1),1)) FILTER (WHERE cb.period_end < date_trunc('month',CURRENT_DATE)::date AND cb.outstanding>0)::text AS "oldestOverdueMonth",
               COALESCE(SUM(cb.outstanding) FILTER (WHERE cb.period_end >= date_trunc('month',CURRENT_DATE)::date AND cb.period_end < (date_trunc('month',CURRENT_DATE)+interval '1 month')::date),0)::text AS "currentMonthOutstanding"
        FROM charge_balances cb
        LEFT JOIN credit_totals ct ON ct.student_id=cb.student_id
        GROUP BY cb.student_id,ct.credits
      `);
      const arrearsByStudent = new Map((arrearsSnapshotResult.rows as any[]).map((row:any)=>[Number(row.studentId),row]));
      const assignmentsWithArrears = assignmentsWithLedger.map((row:any) => ({ ...row, ...(arrearsByStudent.get(Number(row.studentId)) || { qualifyingArrears:"0", oldestOverdueMonth:null, currentMonthOutstanding:"0" }) }));
      const learnerAccountsWithArrears = (learnerAccountsResult.rows as any[]).map((row:any) => ({ ...row, ...(arrearsByStudent.get(Number(row.studentId)) || { qualifyingArrears:"0", oldestOverdueMonth:null, currentMonthOutstanding:"0" }) }));
      const paymentEligibleStudents = learnerAccountsWithArrears.filter((row: any) => !row.archivedAt && (Boolean(row.isActive) && !["terminated", "completed"].includes(String(row.serviceState || "")) || amount(row.balance) > 0.00001)).map((row: any) => ({
        id: Number(row.studentId), firstName: row.firstName, lastName: row.lastName, admissionNo: row.admissionNo, className: row.className, status: row.studentStatus,
      }));

      const totalsResult = await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM transport_assignments WHERE school_id=${schoolId} AND is_active=true)::int AS active_learners,
          (SELECT COUNT(*) FROM transport_assignments WHERE school_id=${schoolId} AND service_state='pending_start')::int AS pending_learners,
          (SELECT COUNT(*) FROM transport_routes WHERE school_id=${schoolId} AND is_active=true)::int AS active_routes,
          (SELECT COUNT(DISTINCT COALESCE(vehicle_id,outbound_vehicle_id)) FROM transport_assignments WHERE school_id=${schoolId} AND is_active=true AND COALESCE(vehicle_id,outbound_vehicle_id) IS NOT NULL)::int AS active_vehicles,
          COALESCE((SELECT SUM(amount) FROM transport_charges WHERE school_id=${schoolId} AND status <> 'cancelled'),0)::text AS expected,
          COALESCE((SELECT SUM(amount) FROM transport_payments WHERE school_id=${schoolId} AND reversed_at IS NULL),0)::text AS collected,
          COALESCE((SELECT SUM(net_amount-amount_paid) FROM transport_payouts WHERE school_id=${schoolId} AND status <> 'paid'),0)::text AS payouts_due,
          COALESCE((SELECT SUM(outstanding_amount) FROM transport_advances WHERE school_id=${schoolId} AND status NOT IN ('settled','cancelled')),0)::text AS advances_outstanding,
          (SELECT COUNT(*) FROM transport_claims WHERE school_id=${schoolId} AND status IN ('draft','disputed','submitted'))::int AS pending_claims,
          (SELECT COUNT(*) FROM transport_refunds WHERE school_id=${schoolId} AND status IN ('requested','approved_awaiting_payment'))::int AS pending_refunds
      `);

      const [subscriptionPolicies, hqClaimLinks, auditUsers] = await Promise.all([
        school.organizationId ? db.select().from(transportSubscriptionPolicies).where(eq(transportSubscriptionPolicies.organizationId, school.organizationId)).orderBy(desc(transportSubscriptionPolicies.startYear), desc(transportSubscriptionPolicies.startMonth), desc(transportSubscriptionPolicies.createdAt)) : Promise.resolve([] as any[]),
        claims.length ? db.select({ schoolClaimId: transportHqClaimItems.schoolClaimId, hqClaimId: transportHqClaimItems.hqClaimId, hqClaimNumber: transportHqClaims.claimNumber, hqClaimStatus: transportHqClaims.status, hqPayoutId: transportHqPayouts.id, hqPayoutNumber: transportHqPayouts.payoutNumber, hqPayoutStatus: transportHqPayouts.status, hqPayoutAmountPaid: transportHqPayouts.amountPaid, hqPayoutNetAmount: transportHqPayouts.netAmount })
          .from(transportHqClaimItems).innerJoin(transportHqClaims, eq(transportHqClaims.id, transportHqClaimItems.hqClaimId)).leftJoin(transportHqPayouts, eq(transportHqPayouts.hqClaimId, transportHqClaims.id)).where(inArray(transportHqClaimItems.schoolClaimId, claims.map((row) => row.id))) : Promise.resolve([] as any[]),
        audits.length ? db.select({ id: users.id, username: users.username, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, Array.from(new Set(audits.map((row) => Number(row.userId)).filter(Boolean))))) : Promise.resolve([] as any[]),
      ]);
      const hqBySchoolClaim = new Map(hqClaimLinks.map((row: any) => [Number(row.schoolClaimId), row]));
      const claimsWithHq = claims.map((claim: any) => ({ ...claim, ...(hqBySchoolClaim.get(Number(claim.id)) || {}), payoutStatus: hqBySchoolClaim.get(Number(claim.id))?.hqPayoutStatus || "not_paid", paidAmount: hqBySchoolClaim.get(Number(claim.id))?.hqPayoutAmountPaid || "0", outstandingAmount: String(Math.max(0, amount(claim.netAmount) - amount(hqBySchoolClaim.get(Number(claim.id))?.hqPayoutAmountPaid))) }));
      const auditUserById = new Map(auditUsers.map((row: any) => [Number(row.id), row]));
      const paymentById = new Map((paymentsResult.rows as any[]).map((row: any) => [Number(row.id), row]));
      const claimById = new Map(claimsWithHq.map((row: any) => [Number(row.id), row]));
      const payoutById = new Map(payouts.map((row: any) => [Number(row.id), row]));
      const refundById = new Map(refundsForView.map((row: any) => [Number(row.id), row]));
      const cashupById = new Map(cashups.map((row: any) => [Number(row.id), row]));
      const billingRunById = new Map(billingRuns.map((row: any) => [Number(row.id), row]));
      const vehicleByIdForAudit = new Map(vehiclesWithOccupancy.map((row: any) => [Number(row.id), row]));
      const studentByIdForAudit = new Map(learnerRows.map((row: any) => [Number(row.id), row]));
      const assignmentByIdForAudit = new Map(assignmentsWithArrears.map((row: any) => [Number(row.id), row]));
      const auditsWithNames = audits.map((audit: any) => {
        const auditUser = auditUserById.get(Number(audit.userId));
        const userName = auditUser ? `${auditUser.firstName || ""} ${auditUser.lastName || ""}`.trim() || auditUser.username : audit.userId ? `User #${audit.userId}` : "System";
        let recordReference = audit.entityId ? `#${audit.entityId}` : "—";
        if (audit.entityType === "vehicle") recordReference = vehicleByIdForAudit.get(Number(audit.entityId))?.registrationNumber || recordReference;
        if (audit.entityType === "claim") recordReference = claimById.get(Number(audit.entityId))?.claimNumber || recordReference;
        if (audit.entityType === "payout") recordReference = payoutById.get(Number(audit.entityId))?.payoutNumber || recordReference;
        if (audit.entityType === "refund") recordReference = refundById.get(Number(audit.entityId))?.refundNumber || recordReference;
        if (audit.entityType === "cashup") recordReference = cashupById.get(Number(audit.entityId))?.cashupNumber || recordReference;
        if (audit.entityType === "payment") recordReference = paymentById.get(Number(audit.entityId))?.receiptNo || recordReference;
        if (audit.entityType === "billing_run") recordReference = billingRunById.get(Number(audit.entityId))?.runNumber || recordReference;
        if (audit.entityType === "learner" || audit.entityType === "student") { const student = studentByIdForAudit.get(Number(audit.entityId)); recordReference = student ? `${student.firstName} ${student.lastName} (${student.admissionNo || "—"})` : recordReference; }
        if (audit.entityType === "assignment") { const assignment = assignmentByIdForAudit.get(Number(audit.entityId)); recordReference = assignment ? `${assignment.firstName} ${assignment.lastName} (${assignment.admissionNo || "—"})` : recordReference; }
        const metadata = (audit.metadata || {}) as any;
        const effectiveDate = metadata.stopServiceDate || metadata.effectiveDate || null;
        return { ...audit, userName, recordReference, effectiveDate };
      });

      return res.json({
        school,
        currentUserId: userOf(req)?.id || null,
        settings,
        routes: routesWithUsage,
        points,
        owners,
        drivers,
        allOwners,
        allDrivers,
        vehicles: servingVehicles,
        allVehicles: vehiclesWithOccupancy,
        organizationRoutes: organizationRoutesWithUsage,
        destinationMasters,
        vehicleDestinations: vehicleDestinationRows,
        vehicleSchoolAssociations: organizationVehicleSchoolLinks,
        organizationSchools: orgSchoolRows,
        servicePoints: servicePointsWithUsage,
        paths,
        pathNodes,
        pathNodeLearners,
        students: learnerRows,
        paymentEligibleStudents,
        staff: staffRows,
        assignments: assignmentsWithArrears,
        learnerAccounts: learnerAccountsWithArrears,
        payments: paymentsResult.rows,
        refunds: refundsForView,
        cashups: cashups.map(schoolCashupView),
        billingRuns,
        subscriptions,
        penalties,
        advances,
        incidents,
        claims: claimsWithHq,
        payouts,
        audits: auditsWithNames,
        subscriptionPolicies,
        organizationSettings,
        operatingDriverHistory,
        vehicleReplacementHistory,
        dashboard: {
          ...(totalsResult.rows[0] as any),
          suspendedArrears: assignmentsWithArrears.filter((row:any)=>row.serviceState==="suspended_arrears").length,
          pendingVehicleReassignment: assignmentsWithArrears.filter((row:any)=>row.serviceState==="pending_vehicle_reassignment").length,
          atRiskNextBilling: assignmentsWithArrears.filter((row:any)=>!["suspended_arrears","pending_vehicle_reassignment","terminated","completed"].includes(String(row.serviceState || "")) && amount(row.currentMonthOutstanding) > amount(organizationSettings?.minimumArrearsSuspensionBalance)).length,
        },
      });
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.get("/api/transport/overview", requireAuth, requireAnyPermission("transport.dashboard.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const parsed = z.object({ from: dateString, to: dateString }).parse(req.query);
      if (parsed.from > parsed.to) return res.status(400).json({ message: "From date cannot be after To date" });
      const [learners, charges, payments, claims, refunds, advances] = await Promise.all([
        db.execute(sql`
          SELECT a.id,a.student_id AS "studentId",a.service_state AS "serviceState",a.financial_status AS "financialStatus",a.start_date AS "startDate",a.end_date AS "endDate",
                 s.first_name AS "firstName",s.last_name AS "lastName",s.admission_no AS "admissionNo",r.name AS "destinationName",v.registration_number AS "vehicleRegistration",a.vehicle_id AS "vehicleId"
          FROM transport_assignments a JOIN students s ON s.id=a.student_id JOIN transport_routes r ON r.id=a.route_id LEFT JOIN transport_vehicles v ON v.id=a.vehicle_id
          WHERE a.school_id=${school.id} AND a.start_date <= ${parsed.to} AND (a.end_date IS NULL OR a.end_date >= ${parsed.from}) AND a.service_state NOT IN ('terminated','completed')
          ORDER BY s.first_name,s.last_name
        `),
        db.execute(sql`SELECT c.*,s.first_name AS "firstName",s.last_name AS "lastName",s.admission_no AS "admissionNo" FROM transport_charges c JOIN students s ON s.id=c.student_id WHERE c.school_id=${school.id} AND c.status <> 'cancelled' AND COALESCE(c.service_period_start,make_date(c.academic_year,GREATEST(c.month,1),1)) <= ${parsed.to} AND COALESCE(c.service_period_end,(date_trunc('month',make_date(c.academic_year,GREATEST(c.month,1),1))+interval '1 month - 1 day')::date) >= ${parsed.from} ORDER BY c.service_period_start,c.id`),
        db.execute(sql`SELECT p.*,s.first_name AS "firstName",s.last_name AS "lastName",s.admission_no AS "admissionNo" FROM transport_payments p JOIN students s ON s.id=p.student_id WHERE p.school_id=${school.id} AND p.payment_date BETWEEN ${parsed.from} AND ${parsed.to} AND p.reversed_at IS NULL ORDER BY p.payment_date,p.id`),
        db.execute(sql`SELECT c.*,v.registration_number AS "vehicleRegistration",o.name AS "ownerName",p.status AS "legacyPayoutStatus",p.amount_paid AS "legacyAmountPaid" FROM transport_claims c JOIN transport_vehicles v ON v.id=c.vehicle_id LEFT JOIN transport_owners o ON o.id=c.owner_id LEFT JOIN transport_payouts p ON p.claim_id=c.id WHERE c.school_id=${school.id} AND make_date(c.service_year,c.service_month,1) BETWEEN date_trunc('month',${parsed.from}::date) AND date_trunc('month',${parsed.to}::date) ORDER BY c.service_year,c.service_month,c.id`),
        db.execute(sql`SELECT r.*,s.first_name AS "firstName",s.last_name AS "lastName",s.admission_no AS "admissionNo" FROM transport_refunds r JOIN students s ON s.id=r.student_id WHERE r.school_id=${school.id} AND r.effective_date BETWEEN ${parsed.from} AND ${parsed.to} ORDER BY r.effective_date,r.id`),
        db.execute(sql`SELECT a.*,v.registration_number AS "vehicleRegistration",o.name AS "ownerName" FROM transport_advances a JOIN transport_vehicles v ON v.id=a.vehicle_id LEFT JOIN transport_owners o ON o.id=a.owner_id WHERE a.school_id=${school.id} AND a.request_date BETWEEN ${parsed.from} AND ${parsed.to} ORDER BY a.request_date,a.id`),
      ]);
      const learnerRows = learners.rows as any[];
      const vehicleIds = new Set(learnerRows.map((row) => Number(row.vehicleId || 0)).filter(Boolean));
      const chargeRows = charges.rows as any[];
      const paymentRows = payments.rows as any[];
      const claimRows = claims.rows as any[];
      const refundRows = refunds.rows as any[];
      const advanceRows = advances.rows as any[];
      const totalCharged = rounded(chargeRows.reduce((sum,row) => sum + amount(row.amount),0));
      const totalCollected = rounded(paymentRows.reduce((sum,row) => sum + amount(row.amount),0));
      const pendingRefundRows = refundRows.filter((row) => ["requested","approved_awaiting_payment"].includes(String(row.status)));
      const pendingClaims = claimRows.filter((row) => ["draft","submitted","verified"].includes(String(row.status)));
      const payoutDueRows = claimRows.filter((row) => ["verified","approved","paid"].includes(String(row.status))).map((row) => ({ ...row, outstanding: Math.max(0, amount(row.netAmount) - amount(row.legacyAmountPaid)) })).filter((row) => row.outstanding > 0);
      const activeDestinationIds = new Set(learnerRows.map((row:any) => row.destinationName).filter(Boolean));
      return res.json({
        period: parsed,
        summary: { activeLearners: learnerRows.length, activeDestinations: activeDestinationIds.size, activeVehicles: vehicleIds.size, totalCharged, totalCollected, outstanding: rounded(totalCharged-totalCollected), payoutsDue: rounded(payoutDueRows.reduce((sum,row) => sum + row.outstanding,0)), pendingClaims: pendingClaims.length, pendingRefunds: pendingRefundRows.length, advancesOutstanding: rounded(advanceRows.filter((row) => !["settled","cancelled","rejected"].includes(String(row.status))).reduce((sum,row)=>sum+amount(row.outstandingAmount),0)) },
        records: { activeLearners: learnerRows, activeVehicles: Array.from(vehicleIds).map((id) => ({ id, registrationNumber: learnerRows.find((row) => Number(row.vehicleId)===id)?.vehicleRegistration, learnerCount: learnerRows.filter((row) => Number(row.vehicleId)===id).length })), charges: chargeRows, payments: paymentRows, payoutsDue: payoutDueRows, pendingClaims, pendingRefunds: pendingRefundRows, advances: advanceRows },
      });
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/learner-accounts/:studentId", requireAuth, requireAnyPermission("transport.payments.view", "transport.charges.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const studentId = Number(req.params.studentId);
      const [learner] = await db.select({
        id: students.id, firstName: students.firstName, lastName: students.lastName, admissionNo: students.admissionNo, className: classes.className,
        parentId: students.parentId, parentFirstName: parents.firstName, parentLastName: parents.lastName, parentPhone: parents.phone, parentEmail: parents.email,
      }).from(students).leftJoin(classes, eq(classes.id, students.classId)).leftJoin(parents, eq(parents.id, students.parentId))
        .where(and(eq(students.id, studentId), eq(students.schoolId, school.id)));
      if (!learner) return res.status(404).json({ message: "Learner not found" });
      const [summary, assignments, charges, payments, adjustments, refunds] = await Promise.all([
        accountSummary(studentId, school.id),
        db.execute(sql`
          SELECT a.*,
                 a.student_id AS "studentId", a.route_id AS "routeId", a.service_type AS "serviceType",
                 a.start_date AS "startDate", a.end_date AS "endDate", a.is_active AS "isActive",
                 a.service_state AS "serviceState", a.financial_status AS "financialStatus", a.planning_status AS "planningStatus",
                 a.seat_reserved_until AS "seatReservedUntil", a.suspension_reason AS "suspensionReason", a.seat_released_at AS "seatReleasedAt",
                 a.agreed_fee AS "agreedFee", a.base_monthly_fee AS "fullFee", a.vehicle_id AS "vehicleId", a.outbound_vehicle_id AS "outboundVehicleId",
                 r.name AS "destinationName", v.registration_number AS "vehicleRegistration", ov.registration_number AS "homeboundVehicleRegistration"
          FROM transport_assignments a
          JOIN transport_routes r ON r.id=a.route_id
          LEFT JOIN transport_vehicles v ON v.id=a.vehicle_id
          LEFT JOIN transport_vehicles ov ON ov.id=a.outbound_vehicle_id
          WHERE a.school_id=${school.id} AND a.student_id=${studentId}
          ORDER BY a.start_date DESC,a.id DESC
        `),
        db.execute(sql`
          SELECT c.*,
                 c.student_id AS "studentId", c.assignment_id AS "assignmentId", c.route_id AS "routeId", c.vehicle_id AS "vehicleId",
                 c.academic_year AS "academicYear", c.service_period_start AS "servicePeriodStart", c.service_period_end AS "servicePeriodEnd",
                 c.chargeable_days AS "chargeableDays", c.days_in_period AS "daysInPeriod", c.calculation_type AS "calculationType", c.due_date AS "dueDate",
                 r.name AS "destinationName", v.registration_number AS "vehicleRegistration",
                 COALESCE((SELECT SUM(pa.amount) FROM transport_payment_allocations pa JOIN transport_payments p ON p.id=pa.payment_id WHERE pa.charge_id=c.id AND p.reversed_at IS NULL),0)::text AS allocated
          FROM transport_charges c
          LEFT JOIN transport_routes r ON r.id=c.route_id LEFT JOIN transport_vehicles v ON v.id=c.vehicle_id
          WHERE c.school_id=${school.id} AND c.student_id=${studentId}
          ORDER BY c.academic_year DESC,c.month DESC,c.id DESC
        `),
        db.execute(sql`
          SELECT p.*,
                 p.student_id AS "studentId", p.payment_date AS "paymentDate", p.payment_method AS "paymentMethod", p.academic_year AS "academicYear",
                 p.receipt_no AS "receiptNo", p.verification_status AS "verificationStatus", p.external_reference AS "externalReference",
                 p.received_by_user_id AS "receivedByUserId", p.verified_at AS "verifiedAt", p.verified_by_user_id AS "verifiedByUserId",
                 p.reconciled_at AS "reconciledAt", p.reconciled_by_user_id AS "reconciledByUserId", p.reversed_at AS "reversedAt",
                 p.reversed_by_user_id AS "reversedByUserId", p.reversal_reason AS "reversalReason",
                 COALESCE((SELECT SUM(pa.amount) FROM transport_payment_allocations pa WHERE pa.payment_id=p.id),0)::text AS allocated,
                 cp.cashup_id AS "cashupId", cu.cashup_number AS "cashupNumber", cu.status AS "cashupStatus"
          FROM transport_payments p
          LEFT JOIN transport_cashup_payments cp ON cp.payment_id=p.id LEFT JOIN transport_cashups cu ON cu.id=cp.cashup_id
          WHERE p.school_id=${school.id} AND p.student_id=${studentId}
          ORDER BY p.payment_date DESC,p.id DESC
        `),
        db.select().from(transportAccountAdjustments).where(and(eq(transportAccountAdjustments.schoolId, school.id), eq(transportAccountAdjustments.studentId, studentId))).orderBy(desc(transportAccountAdjustments.effectiveDate), desc(transportAccountAdjustments.id)),
        db.select().from(transportRefunds).where(and(eq(transportRefunds.schoolId, school.id), eq(transportRefunds.studentId, studentId))).orderBy(desc(transportRefunds.effectiveDate), desc(transportRefunds.id)),
      ]);
      const transactions: any[] = [];
      for (const row of charges.rows as any[]) transactions.push({ kind: "charge", date: row.servicePeriodStart || `${row.academicYear}-${String(row.month).padStart(2,"0")}-01`, reference: `Charge #${row.id}`, description: row.description || `${row.destinationName || "Transport"} · ${MONTH_NAMES[Number(row.month) - 1] || row.month} ${row.academicYear}`, debit: amount(row.amount), credit: 0, record: row });
      for (const row of payments.rows as any[]) if (!row.reversedAt) transactions.push({ kind: "payment", date: row.paymentDate, reference: row.receiptNo, description: `Payment · ${String(row.paymentMethod || "").replaceAll("_"," ")}`, debit: 0, credit: amount(row.amount), record: row });
      for (const row of adjustments as any[]) if (row.status === "approved") transactions.push({ kind: "adjustment", date: row.effectiveDate, reference: `Adjustment #${row.id}`, description: row.reason || row.adjustmentType, debit: row.direction === "debit" ? amount(row.amount) : 0, credit: row.direction === "credit" ? amount(row.amount) : 0, record: row });
      for (const row of refunds as any[]) if (row.status === "paid" && row.method !== "credit") transactions.push({ kind: "refund", date: row.paidAt ? isoDate(new Date(row.paidAt)) : row.effectiveDate, reference: row.refundNumber, description: `Refund paid · ${String(row.method || "").replaceAll("_", " ")}${row.reason ? ` · ${row.reason}` : ""}`, debit: amount(row.amount), credit: 0, record: row });
      transactions.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.reference).localeCompare(String(b.reference)));
      let running = 0;
      for (const line of transactions) { running = rounded(running + line.debit - line.credit); line.balance = running; }
      return res.json({ learner, summary, assignments: assignments.rows, charges: charges.rows, payments: payments.rows, adjustments, refunds, transactions });
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/reports/learner-statement", requireAuth, requireAnyPermission("transport.reports.view", "transport.payments.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const parsed = z.object({ studentId: z.coerce.number().int().positive(), from: dateString, to: dateString }).parse(req.query);
      if (parsed.from > parsed.to) return res.status(400).json({ message: "From date cannot be after To date" });
      return res.json(await learnerStatementData(school.id, parsed.studentId, parsed.from, parsed.to));
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/reports/learner-statement/print", requireAuth, requireAnyPermission("transport.reports.view", "transport.payments.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).send("Select a school");
      const parsed = z.object({ studentId: z.coerce.number().int().positive(), from: dateString, to: dateString }).parse(req.query);
      if (parsed.from > parsed.to) return res.status(400).send("From date cannot be after To date");
      const statement = await learnerStatementData(school.id, parsed.studentId, parsed.from, parsed.to);
      const rows = statement.transactions.map((row: any) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.reference)}</td><td>${escapeHtml(row.description)}</td><td>${row.debit ? `USD ${Number(row.debit).toFixed(2)}` : "—"}</td><td>${row.credit ? `USD ${Number(row.credit).toFixed(2)}` : "—"}</td><td>USD ${Number(row.balance).toFixed(2)}</td></tr>`).join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"/><style>@page{size:A4;margin:12mm}body{font-family:Arial;color:#111;font-size:10px}h1,h2{text-align:center;margin:4px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px;border:1px solid #bbb;padding:10px;margin:12px 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:6px}th{background:#eee}.summary{margin-top:12px;margin-left:auto;width:45%}</style></head><body><h1>${escapeHtml(school.name)}</h1><h2>LEARNER TRANSPORT STATEMENT</h2><div class="meta"><div><b>Learner:</b> ${escapeHtml(`${statement.learner.firstName} ${statement.learner.lastName}`)}</div><div><b>Admission:</b> ${escapeHtml(statement.learner.admissionNo)}</div><div><b>Class:</b> ${escapeHtml(statement.learner.className || "—")}</div><div><b>Period:</b> ${escapeHtml(parsed.from)} to ${escapeHtml(parsed.to)}</div><div><b>Opening balance:</b> USD ${statement.openingBalance.toFixed(2)}</div><div><b>Closing balance:</b> USD ${statement.closingBalance.toFixed(2)}</div></div><table><thead><tr><th>Date</th><th>Reference</th><th>Transaction</th><th>Charge / Debit</th><th>Payment / Credit</th><th>Balance</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No Transport transactions in this period.</td></tr>'}</tbody></table><table class="summary"><tr><td>Total debits</td><td>USD ${statement.totalCharges.toFixed(2)}</td></tr><tr><td>Total payments / credits</td><td>USD ${statement.totalCredits.toFixed(2)}</td></tr><tr><td><b>Closing balance</b></td><td><b>USD ${statement.closingBalance.toFixed(2)}</b></td></tr></table></body></html>`;
      const pdf = await renderHtmlPdf({ html, pdfOptions: { format: "A4", printBackground: true, preferCSSPageSize: true } });
      const filename = reportPdfFilename(`Transport_Learner_Statement_${statement.learner.admissionNo}_${parsed.from}_${parsed.to}`);
      res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`); res.send(pdf);
    } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : "Unable to generate learner statement" }); }
  });

  registerMasterCrud(app, "/api/transport/routes", transportRoutes, routeInput, "route", "transport.routes.create", "transport.routes.edit");
  registerMasterCrud(app, "/api/transport/pickup-points", transportPickupPoints, pointInput, "legacy_pickup_point", "transport.stops.manage", "transport.stops.manage");
  registerMasterCrud(app, "/api/transport/owners", transportOwners, ownerInput, "owner", "transport.owners.manage", "transport.owners.manage");
  registerMasterCrud(app, "/api/transport/drivers", transportDrivers, driverInput, "driver", "transport.drivers.manage", "transport.drivers.manage");
  registerMasterCrud(app, "/api/transport/vehicles", transportVehicles, vehicleInput, "vehicle", "transport.vehicles.create", "transport.vehicles.edit");


  app.post("/api/transport/vehicles/:id/change-primary-driver", requireAuth, requireAnyPermission("transport.vehicles.edit", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const vehicleId = Number(req.params.id);
      const vehicle = await assertOrganizationRecord(transportVehicles, vehicleId, school);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      const input = z.object({ driverId: z.coerce.number().int().positive(), effectiveDate: dateString, reason: z.string().trim().min(3), notes: optionalText }).parse(req.body);
      const alternatives = await db.select().from(transportVehicleAlternativeDrivers).where(and(eq(transportVehicleAlternativeDrivers.vehicleId, vehicleId), isNull(transportVehicleAlternativeDrivers.effectiveTo)));
      if (alternatives.some((row:any)=>Number(row.driverId)===input.driverId)) return res.status(409).json({ message: "Remove this driver from Alternative Drivers before making them the Primary Driver." });
      const validated = await validateTransportMasterValues({ entityType: "vehicle", school, previous: vehicle, values: { ...vehicle, driverId: input.driverId } });
      const result = await db.transaction(async (tx) => {
        await tx.update(transportVehicleDriverHistory).set({ effectiveTo: previousDay(input.effectiveDate) }).where(and(eq(transportVehicleDriverHistory.vehicleId, vehicleId), isNull(transportVehicleDriverHistory.effectiveTo)));
        await tx.insert(transportVehicleDriverHistory).values({ schoolId: school.id, vehicleId, driverId: input.driverId, effectiveFrom: input.effectiveDate, reason: input.reason, createdByUserId: user.id });
        const [activeAlternativeCover] = await tx.select().from(transportVehicleOperatingDriverHistory).where(and(eq(transportVehicleOperatingDriverHistory.vehicleId, vehicleId), eq(transportVehicleOperatingDriverHistory.operatingMode, "alternative"), isNull(transportVehicleOperatingDriverHistory.effectiveTo))).limit(1);
        const appliesNow = input.effectiveDate <= isoDate(new Date());
        const updateValues:any = { updatedAt: new Date() };
        if (appliesNow) updateValues.driverId = input.driverId;
        if (!activeAlternativeCover) {
          const effectiveAt = new Date(`${input.effectiveDate}T00:00:00Z`);
          await tx.update(transportVehicleOperatingDriverHistory).set({ effectiveTo: effectiveAt }).where(and(
            eq(transportVehicleOperatingDriverHistory.vehicleId, vehicleId),
            lte(transportVehicleOperatingDriverHistory.effectiveFrom, effectiveAt),
            or(isNull(transportVehicleOperatingDriverHistory.effectiveTo), gte(transportVehicleOperatingDriverHistory.effectiveTo, effectiveAt)),
          ));
          await tx.insert(transportVehicleOperatingDriverHistory).values({ schoolId: school.id, vehicleId, driverId: input.driverId, operatingMode: "primary", effectiveFrom: effectiveAt, reason: input.reason, notes: input.notes || null, createdByUserId: user.id });
          if (appliesNow) updateValues.currentOperatingDriverId = input.driverId;
        }
        const [updated] = await tx.update(transportVehicles).set(updateValues).where(eq(transportVehicles.id, vehicleId)).returning();
        await writeAudit(tx, school.id, user.id, "vehicle", vehicleId, "change_primary_driver", vehicle, updated, input.reason, { previousDriverId: vehicle.driverId, newDriverId: input.driverId, effectiveDate: input.effectiveDate, notes: input.notes || null });
        return updated;
      });
      return res.json(result);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/vehicles/:id/activate-alternative-driver", requireAuth, requireAnyPermission("transport.vehicles.edit", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const vehicleId = Number(req.params.id);
      const vehicle = await assertOrganizationRecord(transportVehicles, vehicleId, school);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      const input = z.object({ driverId: z.coerce.number().int().positive(), effectiveAt: z.string().datetime().optional(), expectedReturnAt: z.string().datetime().optional().nullable(), reason: z.string().trim().min(3), notes: optionalText }).parse(req.body);
      const [alternative] = await db.select().from(transportVehicleAlternativeDrivers).where(and(eq(transportVehicleAlternativeDrivers.vehicleId, vehicleId), eq(transportVehicleAlternativeDrivers.driverId, input.driverId), isNull(transportVehicleAlternativeDrivers.effectiveTo))).limit(1);
      if (!alternative) return res.status(409).json({ message: "The selected driver is not an active Alternative Driver for this vehicle." });
      const [otherOperating] = await db.select().from(transportVehicleOperatingDriverHistory).where(and(eq(transportVehicleOperatingDriverHistory.driverId, input.driverId), eq(transportVehicleOperatingDriverHistory.operatingMode, "alternative"), isNull(transportVehicleOperatingDriverHistory.effectiveTo), ne(transportVehicleOperatingDriverHistory.vehicleId, vehicleId))).limit(1);
      if (otherOperating) {
        const [otherVehicle] = await db.select().from(transportVehicles).where(eq(transportVehicles.id, otherOperating.vehicleId)).limit(1);
        return res.status(409).json({ message: `This Alternative Driver is currently operating ${otherVehicle?.registrationNumber || `vehicle #${otherOperating.vehicleId}`}. End that cover before activating another vehicle.` });
      }
      const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
      const [driver] = await db.select().from(transportDrivers).where(eq(transportDrivers.id, input.driverId)).limit(1);
      if (!driver?.isActive) return res.status(409).json({ message: "The selected Alternative Driver is inactive." });
      const result = await db.transaction(async (tx) => {
        await tx.update(transportVehicleOperatingDriverHistory).set({ effectiveTo: effectiveAt }).where(and(eq(transportVehicleOperatingDriverHistory.vehicleId, vehicleId), isNull(transportVehicleOperatingDriverHistory.effectiveTo)));
        const [history] = await tx.insert(transportVehicleOperatingDriverHistory).values({ schoolId: school.id, vehicleId, driverId: input.driverId, operatingMode: "alternative", effectiveFrom: effectiveAt, expectedReturnAt: input.expectedReturnAt ? new Date(input.expectedReturnAt) : null, reason: input.reason, notes: input.notes || null, createdByUserId: user.id }).returning();
        const [updated] = await tx.update(transportVehicles).set({ currentOperatingDriverId: input.driverId, updatedAt: new Date() }).where(eq(transportVehicles.id, vehicleId)).returning();
        await writeAudit(tx, school.id, user.id, "vehicle", vehicleId, "activate_alternative_driver", vehicle, updated, input.reason, { operatingHistoryId: history.id, alternativeDriverId: input.driverId, effectiveAt: effectiveAt.toISOString(), expectedReturnAt: input.expectedReturnAt || null });
        return updated;
      });
      return res.json(result);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/vehicles/:id/return-primary-driver", requireAuth, requireAnyPermission("transport.vehicles.edit", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const vehicleId = Number(req.params.id);
      const vehicle = await assertOrganizationRecord(transportVehicles, vehicleId, school);
      if (!vehicle?.driverId) return res.status(409).json({ message: "This vehicle has no Primary Driver to return to service." });
      const input = z.object({ effectiveAt: z.string().datetime().optional(), reason: z.string().trim().min(3).default("Primary Driver returned to service"), notes: optionalText }).parse(req.body || {});
      const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
      const result = await db.transaction(async (tx) => {
        await tx.update(transportVehicleOperatingDriverHistory).set({ effectiveTo: effectiveAt }).where(and(eq(transportVehicleOperatingDriverHistory.vehicleId, vehicleId), isNull(transportVehicleOperatingDriverHistory.effectiveTo)));
        await tx.insert(transportVehicleOperatingDriverHistory).values({ schoolId: school.id, vehicleId, driverId: vehicle.driverId!, operatingMode: "primary", effectiveFrom: effectiveAt, reason: input.reason, notes: input.notes || null, createdByUserId: user.id });
        const [updated] = await tx.update(transportVehicles).set({ currentOperatingDriverId: vehicle.driverId, updatedAt: new Date() }).where(eq(transportVehicles.id, vehicleId)).returning();
        await writeAudit(tx, school.id, user.id, "vehicle", vehicleId, "return_primary_driver", vehicle, updated, input.reason, { effectiveAt: effectiveAt.toISOString() });
        return updated;
      });
      return res.json(result);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/vehicles/:id/change-owner", requireAuth, requireAnyPermission("transport.vehicles.edit", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const vehicleId = Number(req.params.id);
      const vehicle = await assertOrganizationRecord(transportVehicles, vehicleId, school);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      const input = z.object({ ownershipType: z.enum(["school","staff","contracted"]), ownerId: nullablePositiveInt, primaryDriverId: nullablePositiveInt, alternativeDriverIds: z.array(z.coerce.number().int().positive()).default([]), effectiveDate: dateString, reason: z.string().trim().min(3) }).parse(req.body);
      const candidate:any = { ...vehicle, ownershipType: input.ownershipType, ownerId: input.ownerId, driverId: input.primaryDriverId };
      const validated = await validateTransportMasterValues({ entityType: "vehicle", school, previous: vehicle, values: candidate });
      const altIds = await validateAlternativeDriverIds({ school, vehicleId, primaryDriverId: input.primaryDriverId, ownerId: validated.ownerId, ownershipType: validated.ownershipType, alternativeDriverIds: input.alternativeDriverIds });
      const result = await db.transaction(async (tx) => {
        await tx.update(transportVehicleOwnerHistory).set({ effectiveTo: previousDay(input.effectiveDate) }).where(and(eq(transportVehicleOwnerHistory.vehicleId, vehicleId), isNull(transportVehicleOwnerHistory.effectiveTo)));
        if (validated.ownerId) await tx.insert(transportVehicleOwnerHistory).values({ schoolId: school.id, vehicleId, ownerId: validated.ownerId, effectiveFrom: input.effectiveDate, reason: input.reason, createdByUserId: user.id });
        if (Number(vehicle.driverId || 0) !== Number(input.primaryDriverId || 0)) {
          await tx.update(transportVehicleDriverHistory).set({ effectiveTo: previousDay(input.effectiveDate) }).where(and(eq(transportVehicleDriverHistory.vehicleId, vehicleId), isNull(transportVehicleDriverHistory.effectiveTo)));
          if (input.primaryDriverId) await tx.insert(transportVehicleDriverHistory).values({ schoolId: school.id, vehicleId, driverId: input.primaryDriverId, effectiveFrom: input.effectiveDate, reason: input.reason, createdByUserId: user.id });
        }
        await tx.update(transportVehicleAlternativeDrivers).set({ effectiveTo: previousDay(input.effectiveDate), reason: input.reason }).where(and(eq(transportVehicleAlternativeDrivers.vehicleId, vehicleId), isNull(transportVehicleAlternativeDrivers.effectiveTo)));
        if (altIds.length) await tx.insert(transportVehicleAlternativeDrivers).values(altIds.map((driverId)=>({ vehicleId, driverId, effectiveFrom: input.effectiveDate, reason: input.reason, createdByUserId: user.id })));
        const appliesNow = input.effectiveDate <= isoDate(new Date());
        const vehicleChanges:any = { updatedAt: new Date() };
        if (appliesNow) {
          vehicleChanges.ownershipType = validated.ownershipType;
          vehicleChanges.ownerId = validated.ownerId || null;
          vehicleChanges.driverId = input.primaryDriverId || null;
          vehicleChanges.currentOperatingDriverId = input.primaryDriverId || null;
        }
        const [updated] = await tx.update(transportVehicles).set(vehicleChanges).where(eq(transportVehicles.id, vehicleId)).returning();
        const effectiveAt = new Date(`${input.effectiveDate}T00:00:00Z`);
        await tx.update(transportVehicleOperatingDriverHistory).set({ effectiveTo: effectiveAt }).where(and(
          eq(transportVehicleOperatingDriverHistory.vehicleId, vehicleId),
          lte(transportVehicleOperatingDriverHistory.effectiveFrom, effectiveAt),
          or(isNull(transportVehicleOperatingDriverHistory.effectiveTo), gte(transportVehicleOperatingDriverHistory.effectiveTo, effectiveAt)),
        ));
        if (input.primaryDriverId) await tx.insert(transportVehicleOperatingDriverHistory).values({ schoolId: school.id, vehicleId, driverId: input.primaryDriverId, operatingMode: "primary", effectiveFrom: effectiveAt, reason: input.reason, createdByUserId: user.id });
        await writeAudit(tx, school.id, user.id, "vehicle", vehicleId, "change_owner", vehicle, updated, input.reason, { effectiveDate: input.effectiveDate, alternativeDriverIds: altIds });
        return updated;
      });
      return res.json(result);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/vehicles/:id/replace", requireAuth, requireAnyPermission("transport.vehicles.edit", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const originalVehicleId = Number(req.params.id);
      const original = await assertOrganizationRecord(transportVehicles, originalVehicleId, school);
      if (!original) return res.status(404).json({ message: "Vehicle not found" });
      const input = z.object({
        replacementVehicleId: z.coerce.number().int().positive(),
        replacementType: z.enum(["temporary","permanent"]),
        effectiveAt: z.string().datetime().optional(),
        expectedReturnAt: z.string().datetime().optional().nullable(),
        reason: z.string().trim().min(3),
        notes: optionalText,
        schoolIds: z.array(z.coerce.number().int().positive()).optional(),
        carryDestinations: z.boolean().default(true),
        carryOwner: z.boolean().default(false),
        carryPrimaryDriver: z.boolean().default(false),
        carryAlternativeDrivers: z.boolean().default(false),
      }).parse(req.body);
      if (input.replacementVehicleId === originalVehicleId) return res.status(409).json({ message: "Choose a different replacement vehicle." });
      const replacement = await assertOrganizationRecord(transportVehicles, input.replacementVehicleId, school);
      if (!replacement || !replacement.isActive) return res.status(409).json({ message: "Replacement vehicle is unavailable." });
      const orgSchoolIds = await organizationSchoolIds(school);
      const originalLinks = await db.select().from(transportVehicleSchools).where(and(
        eq(transportVehicleSchools.vehicleId, originalVehicleId),
        eq(transportVehicleSchools.isActive, true),
        inArray(transportVehicleSchools.schoolId, orgSchoolIds),
      ));
      const linkedSchoolIds = new Set(originalLinks.map((row:any)=>Number(row.schoolId)));
      const schoolIds = Array.from(new Set((input.schoolIds?.length ? input.schoolIds : [school.id]).map(Number)))
        .filter((id)=>orgSchoolIds.includes(id) && linkedSchoolIds.has(id));
      if (!schoolIds.length) return res.status(400).json({ message: "Select at least one school currently associated with the original vehicle." });

      const affected = await db.select().from(transportAssignments).where(and(
        inArray(transportAssignments.schoolId, schoolIds),
        eq(transportAssignments.isActive, true),
        or(eq(transportAssignments.vehicleId, originalVehicleId), eq(transportAssignments.outboundVehicleId, originalVehicleId)),
      ));
      const affectedStudents = new Set(affected.map((row:any)=>Number(row.studentId)));
      if (affectedStudents.size > Number(replacement.capacity || 0)) {
        return res.status(409).json({ message: `Replacement vehicle capacity is ${replacement.capacity}, but ${affectedStudents.size} active learner(s) would move to it.` });
      }
      const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
      if (Number.isNaN(effectiveAt.getTime())) return res.status(400).json({ message: "Invalid replacement effective date/time." });
      const appliesNow = effectiveAt.getTime() <= Date.now();

      const result = await db.transaction(async (tx) => {
        for (const sid of schoolIds) await ensureMasterAssociation("vehicle", replacement.id, sid, user.id);

        if (input.carryDestinations) {
          const destinationRows = await tx.select().from(transportVehicleDestinations).where(eq(transportVehicleDestinations.vehicleId, originalVehicleId));
          for (const destination of destinationRows) {
            await tx.insert(transportVehicleDestinations).values({
              vehicleId: replacement.id,
              routeId: destination.routeId,
              destinationMasterId: destination.destinationMasterId || null,
              createdByUserId: user.id,
            }).onConflictDoNothing();
          }
        }

        if (input.carryOwner || input.carryPrimaryDriver || input.carryAlternativeDrivers) {
          const replacementCandidate:any = {
            ...replacement,
            ownershipType: input.carryOwner ? original.ownershipType : replacement.ownershipType,
            ownerId: input.carryOwner ? original.ownerId : replacement.ownerId,
            driverId: input.carryPrimaryDriver ? original.driverId : replacement.driverId,
          };
          const validated = await validateTransportMasterValues({ entityType: "vehicle", school, previous: replacement, values: replacementCandidate });
          const altIds = input.carryAlternativeDrivers
            ? (await tx.select().from(transportVehicleAlternativeDrivers).where(and(
                eq(transportVehicleAlternativeDrivers.vehicleId, originalVehicleId),
                lte(transportVehicleAlternativeDrivers.effectiveFrom, isoDate(effectiveAt)),
                or(isNull(transportVehicleAlternativeDrivers.effectiveTo), gte(transportVehicleAlternativeDrivers.effectiveTo, isoDate(effectiveAt))),
              ))).map((row:any)=>Number(row.driverId))
            : (await tx.select().from(transportVehicleAlternativeDrivers).where(and(
                eq(transportVehicleAlternativeDrivers.vehicleId, replacement.id),
                lte(transportVehicleAlternativeDrivers.effectiveFrom, isoDate(effectiveAt)),
                or(isNull(transportVehicleAlternativeDrivers.effectiveTo), gte(transportVehicleAlternativeDrivers.effectiveTo, isoDate(effectiveAt))),
              ))).map((row:any)=>Number(row.driverId));
          await validateAlternativeDriverIds({
            school,
            vehicleId: replacement.id,
            primaryDriverId: validated.driverId || null,
            ownerId: validated.ownerId || null,
            ownershipType: validated.ownershipType,
            alternativeDriverIds: altIds,
          });
          if (input.carryOwner && original.ownerId) {
            await tx.update(transportVehicleOwnerHistory).set({ effectiveTo: previousDay(isoDate(effectiveAt)) }).where(and(eq(transportVehicleOwnerHistory.vehicleId, replacement.id), isNull(transportVehicleOwnerHistory.effectiveTo)));
            await tx.insert(transportVehicleOwnerHistory).values({ schoolId: school.id, vehicleId: replacement.id, ownerId: original.ownerId, effectiveFrom: isoDate(effectiveAt), reason: input.reason, createdByUserId: user.id });
          }
          if (input.carryPrimaryDriver && original.driverId) {
            await tx.update(transportVehicleDriverHistory).set({ effectiveTo: previousDay(isoDate(effectiveAt)) }).where(and(eq(transportVehicleDriverHistory.vehicleId, replacement.id), isNull(transportVehicleDriverHistory.effectiveTo)));
            await tx.insert(transportVehicleDriverHistory).values({ schoolId: school.id, vehicleId: replacement.id, driverId: original.driverId, effectiveFrom: isoDate(effectiveAt), reason: input.reason, createdByUserId: user.id });
          }
          if (input.carryAlternativeDrivers) {
            await tx.update(transportVehicleAlternativeDrivers).set({ effectiveTo: previousDay(isoDate(effectiveAt)), reason: input.reason }).where(and(eq(transportVehicleAlternativeDrivers.vehicleId, replacement.id), isNull(transportVehicleAlternativeDrivers.effectiveTo)));
            if (altIds.length) await tx.insert(transportVehicleAlternativeDrivers).values(altIds.map((driverId)=>({ vehicleId: replacement.id, driverId, effectiveFrom: isoDate(effectiveAt), reason: input.reason, createdByUserId: user.id })));
          }
          if (appliesNow) {
            const updateValues:any = { updatedAt: new Date() };
            if (input.carryOwner) { updateValues.ownershipType = validated.ownershipType; updateValues.ownerId = validated.ownerId || null; }
            if (input.carryPrimaryDriver) { updateValues.driverId = validated.driverId || null; updateValues.currentOperatingDriverId = validated.driverId || null; }
            await tx.update(transportVehicles).set(updateValues).where(eq(transportVehicles.id, replacement.id));
          }
        }

        const replacementRecords:any[] = [];
        for (const sid of schoolIds) {
          const [record] = await tx.insert(transportVehicleReplacements).values({
            schoolId: sid,
            originalVehicleId,
            replacementVehicleId: replacement.id,
            replacementType: input.replacementType,
            effectiveFrom: effectiveAt,
            expectedReturnAt: input.expectedReturnAt ? new Date(input.expectedReturnAt) : null,
            reason: input.reason,
            notes: input.notes || null,
            createdByUserId: user.id,
          }).returning();
          replacementRecords.push(record);
        }

        let movedAssignments = 0;
        if (appliesNow) {
          for (const assignment of affected) {
            const changes:any = { updatedAt: new Date() };
            if (Number(assignment.vehicleId || 0) === originalVehicleId) changes.vehicleId = replacement.id;
            if (Number(assignment.outboundVehicleId || 0) === originalVehicleId) changes.outboundVehicleId = replacement.id;
            const [updatedAssignment] = await tx.update(transportAssignments).set(changes).where(eq(transportAssignments.id, assignment.id)).returning();
            await tx.insert(transportAssignmentEvents).values({
              schoolId: assignment.schoolId,
              assignmentId: assignment.id,
              eventType: input.replacementType === "temporary" ? "temporary_vehicle_replacement" : "vehicle_replaced",
              effectiveDate: isoDate(effectiveAt),
              previousValues: assignment,
              newValues: updatedAssignment,
              reason: input.reason,
              createdByUserId: user.id,
            });
            movedAssignments += 1;
          }
        }
        await writeAudit(tx, school.id, user.id, "vehicle", originalVehicleId, input.replacementType === "temporary" ? "temporary_replacement" : "permanent_replacement", original, replacement, input.reason, {
          replacementRecordIds: replacementRecords.map((row:any)=>row.id),
          replacementVehicleId: replacement.id,
          schoolIds,
          scheduled: !appliesNow,
          affectedAssignmentIds: affected.map((row:any)=>row.id),
          carryOwner: input.carryOwner,
          carryPrimaryDriver: input.carryPrimaryDriver,
          carryAlternativeDrivers: input.carryAlternativeDrivers,
          carryDestinations: input.carryDestinations,
        });
        return { replacements: replacementRecords, affectedAssignments: movedAssignments, scheduledAssignments: appliesNow ? 0 : affected.length };
      });
      return res.status(201).json(result);
    } catch (error) { return routeError(res, error); }
  });


  app.post("/api/transport/vehicle-replacements/:id/return-original", requireAuth, requireAnyPermission("transport.vehicles.edit", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const replacementId = Number(req.params.id);
      const [record] = await db.select().from(transportVehicleReplacements).where(and(eq(transportVehicleReplacements.id, replacementId), eq(transportVehicleReplacements.schoolId, school.id))).limit(1);
      if (!record || record.replacementType !== "temporary" || record.effectiveTo) return res.status(409).json({ message: "Active temporary replacement not found." });
      const input = z.object({ effectiveAt: z.string().datetime().optional(), reason: z.string().trim().min(3).default("Original vehicle returned to service") }).parse(req.body || {});
      const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
      const affected = await db.select().from(transportAssignments).where(and(eq(transportAssignments.schoolId, school.id), eq(transportAssignments.isActive, true), or(eq(transportAssignments.vehicleId, record.replacementVehicleId), eq(transportAssignments.outboundVehicleId, record.replacementVehicleId))));
      await db.transaction(async (tx) => {
        for (const assignment of affected) {
          const changes:any={ updatedAt:new Date() };
          if (Number(assignment.vehicleId||0)===Number(record.replacementVehicleId)) changes.vehicleId=record.originalVehicleId;
          if (Number(assignment.outboundVehicleId||0)===Number(record.replacementVehicleId)) changes.outboundVehicleId=record.originalVehicleId;
          const [updated] = await tx.update(transportAssignments).set(changes).where(eq(transportAssignments.id,assignment.id)).returning();
          await tx.insert(transportAssignmentEvents).values({ schoolId: school.id, assignmentId: assignment.id, eventType:"temporary_vehicle_returned", effectiveDate:isoDate(effectiveAt), previousValues:assignment, newValues:updated, reason:input.reason, createdByUserId:user.id });
        }
        await tx.update(transportVehicleReplacements).set({ effectiveTo: effectiveAt }).where(eq(transportVehicleReplacements.id,replacementId));
        await writeAudit(tx, school.id,user.id,"vehicle",record.originalVehicleId,"return_original_vehicle",null,record,input.reason,{replacementRecordId:record.id});
      });
      return res.json({ message:"Original vehicle returned to service", affectedAssignments:affected.length });
    } catch (error) { return routeError(res,error); }
  });

  app.get("/api/transport/organization-settings", requireAuth, requirePermission("transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      const organizationId = user?.organizationId || school?.organizationId || null;
      if (!organizationId) return res.status(400).json({ message: "Organization context is required" });
      return res.json(await getOrCreateOrganizationTransportSettings(Number(organizationId)));
    } catch (error) { return routeError(res, error); }
  });

  app.put("/api/transport/organization-settings", requireAuth, requirePermission("transport.hq.settings.manage"), async (req, res) => {
    try {
      const user = userOf(req);
      if (user?.role !== "org_admin") return res.status(403).json({ message: "HQ Organization Admin access is required to change the organisation Transport arrears policy." });
      if (!user?.organizationId) return res.status(400).json({ message: "Organization context is required" });
      const parsed = organizationTransportSettingsInput.parse(req.body);
      const previous = await getOrCreateOrganizationTransportSettings(Number(user.organizationId));
      const [updated] = await db.update(transportOrganizationSettings).set({
        minimumArrearsSuspensionBalance: String(parsed.minimumArrearsSuspensionBalance),
        suspendedSeatPolicy: parsed.suspendedSeatPolicy,
        suspendedSeatReleaseDays: parsed.suspendedSeatReleaseDays,
        automaticArrearsReinstatement: parsed.automaticArrearsReinstatement,
        arrearsWarningEnabled: parsed.arrearsWarningEnabled,
        updatedAt: new Date(),
      }).where(eq(transportOrganizationSettings.organizationId, Number(user.organizationId))).returning();
      const school = await schoolContext(req);
      if (school) await writeAudit(db, school.id, user.id, "organization_transport_settings", updated.id, "update", previous, updated, "Organization Transport arrears policy updated");
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.put("/api/transport/settings", requireAuth, requireAnyPermission("transport.settings.manage", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = clean(settingsInput.parse(req.body));
      const previous = await getOrCreateSettings(school.id);
      const effectivePricingMode = String(parsed.oneWayPricingMode ?? previous.oneWayPricingMode ?? "percentage");
      const effectiveSchoolBoundPercent = Number(parsed.inboundOneWayPercent ?? previous.inboundOneWayPercent ?? 60);
      const effectiveHomeBoundPercent = Number(parsed.outboundOneWayPercent ?? previous.outboundOneWayPercent ?? 60);
      if (effectivePricingMode === "percentage" && (effectiveSchoolBoundPercent < 50 || effectiveHomeBoundPercent < 50)) {
        const error: any = new Error("School-bound and home-bound percentages must each be at least 50% when Percentage pricing is active.");
        error.status = 400;
        throw error;
      }
      const settingsValues: any = { ...parsed, currencyCode: "USD", updatedAt: new Date() };
      for (const key of ["inboundOneWayPercent", "outboundOneWayPercent", "inboundOneWayFixedAddition", "outboundOneWayFixedAddition"]) {
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
      if (parsed.studentId) {
        const learner = await assertOrganizationRecord(students, Number(parsed.studentId), school);
        if (!learner) return res.status(404).json({ message: "Learner not found in this organization" });
      }
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
      const previous = await assertOrganizationRecord(transportServicePoints, id, school);
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
      const [updated] = await db.update(transportServicePoints).set(updateValues).where(eq(transportServicePoints.id, id)).returning();
      await writeAudit(db, school.id, user.id, "service_point", id, "update", previous, updated);
      return res.json(updated);
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.get("/api/transport/destinations/:id/usage", requireAuth, requirePermission("transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const destination = await assertOrganizationRecord(transportRoutes, Number(req.params.id), school);
      if (!destination) return res.status(404).json({ message: "Destination not found" });
      const orgSchoolIds = await organizationSchoolIds(school);
      const orgRoutes = await db.select().from(transportRoutes).where(inArray(transportRoutes.schoolId, orgSchoolIds));
      const peerRouteIds = destination.destinationMasterId
        ? orgRoutes.filter((route) => Number(route.destinationMasterId || 0) === Number(destination.destinationMasterId)).map((route) => Number(route.id))
        : orgRoutes.filter((route) => canonicalDestinationKey(route.name) === canonicalDestinationKey(destination.name)).map((route) => Number(route.id));
      if (!peerRouteIds.length) peerRouteIds.push(Number(destination.id));

      const assignments = await db.select({
        assignmentId: transportAssignments.id,
        studentId: students.id, firstName: students.firstName, lastName: students.lastName, admissionNo: students.admissionNo,
        className: classes.className, schoolName: schools.name, serviceType: transportAssignments.serviceType,
        pickupServicePointId: transportAssignments.pickupServicePointId, dropoffServicePointId: transportAssignments.dropoffServicePointId,
        pickupName: sql<string>`pickup_sp.name`, dropoffName: sql<string>`dropoff_sp.name`,
        vehicleId: transportAssignments.vehicleId, outboundVehicleId: transportAssignments.outboundVehicleId,
      }).from(transportAssignments)
        .innerJoin(students, eq(students.id, transportAssignments.studentId))
        .innerJoin(schools, eq(schools.id, transportAssignments.schoolId))
        .leftJoin(classes, eq(classes.id, students.classId))
        .leftJoin(sql`transport_service_points pickup_sp`, sql`pickup_sp.id = ${transportAssignments.pickupServicePointId}`)
        .leftJoin(sql`transport_service_points dropoff_sp`, sql`dropoff_sp.id = ${transportAssignments.dropoffServicePointId}`)
        .where(and(inArray(transportAssignments.routeId, peerRouteIds), eq(transportAssignments.isActive, true)));

      const fleetRows = school.organizationId ? await db.select({
        occupantId: fleetVehicleOccupants.id, studentId: students.id, firstName: students.firstName, lastName: students.lastName,
        admissionNo: students.admissionNo, className: classes.className, schoolName: schools.name,
        serviceType: fleetVehicleOccupants.serviceType, pickupServicePointId: fleetVehicleOccupants.pickupServicePointId,
        dropoffServicePointId: fleetVehicleOccupants.dropoffServicePointId, pickupName: fleetVehicleOccupants.pickupName,
        dropoffName: fleetVehicleOccupants.dropoffName, fleetVehicleId: fleetVehicleOccupants.vehicleId,
      }).from(fleetVehicleOccupants)
        .leftJoin(students, eq(students.id, fleetVehicleOccupants.studentId))
        .leftJoin(classes, eq(classes.id, students.classId))
        .leftJoin(schools, eq(schools.id, fleetVehicleOccupants.schoolId))
        .where(and(eq(fleetVehicleOccupants.organizationId, school.organizationId), eq(fleetVehicleOccupants.isActive, true), inArray(fleetVehicleOccupants.routeId, peerRouteIds))) : [];

      const studentMap = new Map<number, any>();
      for (const row of assignments as any[]) studentMap.set(Number(row.studentId), {
        studentId: row.studentId, name: `${row.firstName || ""} ${row.lastName || ""}`.trim(), admissionNo: row.admissionNo,
        className: row.className, schoolName: row.schoolName, serviceType: row.serviceType,
        pickupPoint: row.pickupName || null, dropoffPoint: row.dropoffName || null,
      });
      for (const row of fleetRows as any[]) if (row.studentId && !studentMap.has(Number(row.studentId))) studentMap.set(Number(row.studentId), {
        studentId: row.studentId, name: `${row.firstName || ""} ${row.lastName || ""}`.trim(), admissionNo: row.admissionNo,
        className: row.className, schoolName: row.schoolName, serviceType: row.serviceType,
        pickupPoint: row.pickupName || null, dropoffPoint: row.dropoffName || null,
      });

      const transportVehicleIds = new Set<number>();
      for (const row of assignments as any[]) { if (row.vehicleId) transportVehicleIds.add(Number(row.vehicleId)); if (row.outboundVehicleId) transportVehicleIds.add(Number(row.outboundVehicleId)); }
      const destinationVehicles = await db.select({ vehicleId: transportVehicleDestinations.vehicleId }).from(transportVehicleDestinations).where(inArray(transportVehicleDestinations.routeId, peerRouteIds));
      destinationVehicles.forEach((row) => transportVehicleIds.add(Number(row.vehicleId)));
      const transportVehicleRows = transportVehicleIds.size ? await db.select().from(transportVehicles).where(inArray(transportVehicles.id, Array.from(transportVehicleIds))) : [];
      const [orgOwners, orgDrivers, orgSchools, fleetProfiles, orgStaff] = await Promise.all([
        db.select().from(transportOwners).where(inArray(transportOwners.schoolId, orgSchoolIds)),
        db.select().from(transportDrivers).where(inArray(transportDrivers.schoolId, orgSchoolIds)),
        db.select({ id: schools.id, name: schools.name }).from(schools).where(inArray(schools.id, orgSchoolIds)),
        school.organizationId ? db.select({ id: fleetVehicleProfiles.id, transportVehicleId: fleetVehicleProfiles.transportVehicleId, assetId: fleetVehicleProfiles.assetId, baseSchoolId: fleetVehicleProfiles.baseSchoolId, primaryDriverStaffId: fleetVehicleProfiles.primaryDriverStaffId, status: fleetVehicleProfiles.status, assetNumber: assetRegister.assetNumber, assetName: assetRegister.name, registration: assetVehicleDetails.registrationNumber })
          .from(fleetVehicleProfiles).innerJoin(assetRegister, eq(assetRegister.id, fleetVehicleProfiles.assetId)).leftJoin(assetVehicleDetails, eq(assetVehicleDetails.assetId, assetRegister.id)).where(eq(fleetVehicleProfiles.organizationId, school.organizationId)) : Promise.resolve([] as any[]),
        db.select({ id: staff.id, firstName: staff.firstName, lastName: staff.lastName }).from(staff).where(inArray(staff.schoolId, orgSchoolIds)),
      ]);
      const ownerById = new Map(orgOwners.map((row) => [Number(row.id), row]));
      const driverById = new Map(orgDrivers.map((row) => [Number(row.id), row]));
      const schoolById = new Map(orgSchools.map((row) => [Number(row.id), row.name]));
      const staffById = new Map(orgStaff.map((row) => [Number(row.id), row]));
      const fleetByTransport = new Map((fleetProfiles as any[]).filter((row) => row.transportVehicleId).map((row) => [Number(row.transportVehicleId), row]));
      const vehicleMap = new Map<string, any>();
      for (const vehicle of transportVehicleRows as any[]) {
        const owner = vehicle.ownerId ? ownerById.get(Number(vehicle.ownerId)) : null;
        const driver = vehicle.driverId ? driverById.get(Number(vehicle.driverId)) : null;
        const fleet = fleetByTransport.get(Number(vehicle.id));
        vehicleMap.set(`transport:${vehicle.id}`, {
          source: fleet ? "FCGS Fleet" : (vehicle.ownershipType === "contracted" || vehicle.ownershipType === "staff" ? "Contracted" : "Transport"),
          id: vehicle.id, transportVehicleId: vehicle.id, fleetVehicleId: fleet?.id || null,
          registration: vehicle.registrationNumber, makeModel: vehicle.makeModel, baseSchool: schoolById.get(Number(vehicle.schoolId)) || null,
          owner: vehicle.ownershipType === "school" ? "FCGS" : owner?.name || null,
          driver: driver ? `${driver.firstName} ${driver.lastName}` : null, status: vehicle.status,
        });
      }
      const fleetVehicleIds = new Set((fleetRows as any[]).map((row) => Number(row.fleetVehicleId)).filter(Boolean));
      for (const fleet of fleetProfiles as any[]) if (fleetVehicleIds.has(Number(fleet.id)) && !fleet.transportVehicleId) {
        const driver = fleet.primaryDriverStaffId ? staffById.get(Number(fleet.primaryDriverStaffId)) : null;
        vehicleMap.set(`fleet:${fleet.id}`, { source: "FCGS Fleet", id: fleet.id, transportVehicleId: null, fleetVehicleId: fleet.id,
          registration: fleet.registration || fleet.assetName || fleet.assetNumber, makeModel: fleet.assetName || null,
          baseSchool: fleet.baseSchoolId ? schoolById.get(Number(fleet.baseSchoolId)) || null : null, owner: "FCGS",
          driver: driver ? `${driver.firstName} ${driver.lastName}` : null, status: fleet.status });
      }

      const pointIds = new Set<number>();
      for (const row of assignments as any[]) { if (row.pickupServicePointId) pointIds.add(Number(row.pickupServicePointId)); if (row.dropoffServicePointId) pointIds.add(Number(row.dropoffServicePointId)); }
      for (const row of fleetRows as any[]) { if (row.pickupServicePointId) pointIds.add(Number(row.pickupServicePointId)); if (row.dropoffServicePointId) pointIds.add(Number(row.dropoffServicePointId)); }
      const points = pointIds.size ? await db.select().from(transportServicePoints).where(inArray(transportServicePoints.id, Array.from(pointIds))) : [];
      return res.json({ destination, peerRouteIds, students: Array.from(studentMap.values()), vehicles: Array.from(vehicleMap.values()), points });
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/service-points/:id/usage", requireAuth, requirePermission("transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const point = await assertOrganizationRecord(transportServicePoints, id, school);
      if (!point) return res.status(404).json({ message: "Service point not found" });
      const orgSchoolIds = await organizationSchoolIds(school);
      const assignments = await db.select({
        assignmentId: transportAssignments.id,
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        admissionNo: students.admissionNo,
        className: classes.className,
        parentFirstName: parents.firstName,
        parentLastName: parents.lastName,
        parentPhone: parents.phone,
        parentEmail: parents.email,
        schoolName: schools.name,
        vehicleId: transportVehicles.id,
        vehicleRegistration: transportVehicles.registrationNumber,
        vehicleMakeModel: transportVehicles.makeModel,
        vehicleSchoolId: transportVehicles.schoolId,
        vehicleOwnerId: transportVehicles.ownerId,
        vehicleStatus: transportVehicles.status,
        vehicleOwnershipType: transportVehicles.ownershipType,
        driverFirstName: transportDrivers.firstName,
        driverLastName: transportDrivers.lastName,
      }).from(transportAssignments)
        .innerJoin(students, eq(students.id, transportAssignments.studentId))
        .innerJoin(schools, eq(schools.id, students.schoolId))
        .leftJoin(classes, eq(classes.id, students.classId))
        .leftJoin(parents, eq(parents.id, students.parentId))
        .leftJoin(transportVehicles, eq(transportVehicles.id, transportAssignments.vehicleId))
        .leftJoin(transportDrivers, eq(transportDrivers.id, transportAssignments.driverId))
        .where(and(
          inArray(transportAssignments.schoolId, orgSchoolIds),
          eq(transportAssignments.isActive, true),
          or(eq(transportAssignments.pickupServicePointId, id), eq(transportAssignments.dropoffServicePointId, id)),
        ));
      const fleetRows = school.organizationId ? await db.select({
        occupantId: fleetVehicleOccupants.id,
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        admissionNo: students.admissionNo,
        className: classes.className,
        parentFirstName: parents.firstName,
        parentLastName: parents.lastName,
        parentPhone: parents.phone,
        parentEmail: parents.email,
        schoolName: schools.name,
        fleetVehicleId: fleetVehicleProfiles.id,
        fleetBaseSchoolId: fleetVehicleProfiles.baseSchoolId,
        fleetPrimaryDriverStaffId: fleetVehicleProfiles.primaryDriverStaffId,
        fleetStatus: fleetVehicleProfiles.status,
        assetNumber: assetRegister.assetNumber,
        vehicleName: assetRegister.name,
        vehicleRegistration: assetVehicleDetails.registrationNumber,
      }).from(fleetVehicleOccupants)
        .innerJoin(fleetVehicleProfiles, eq(fleetVehicleProfiles.id, fleetVehicleOccupants.vehicleId))
        .innerJoin(assetRegister, eq(assetRegister.id, fleetVehicleProfiles.assetId))
        .leftJoin(assetVehicleDetails, eq(assetVehicleDetails.assetId, assetRegister.id))
        .leftJoin(students, eq(students.id, fleetVehicleOccupants.studentId))
        .leftJoin(classes, eq(classes.id, students.classId))
        .leftJoin(parents, eq(parents.id, students.parentId))
        .leftJoin(schools, eq(schools.id, students.schoolId))
        .where(and(
          eq(fleetVehicleOccupants.organizationId, school.organizationId),
          eq(fleetVehicleOccupants.isActive, true),
          or(eq(fleetVehicleOccupants.pickupServicePointId, id), eq(fleetVehicleOccupants.dropoffServicePointId, id)),
        )) : [];
      const studentMap = new Map<number, any>();
      for (const row of assignments) studentMap.set(Number(row.studentId), {
        studentId: row.studentId, name: `${row.firstName || ""} ${row.lastName || ""}`.trim(), admissionNo: row.admissionNo,
        className: row.className, parentName: `${row.parentFirstName || ""} ${row.parentLastName || ""}`.trim() || null,
        parentPhone: row.parentPhone, parentEmail: row.parentEmail, schoolName: row.schoolName,
        vehicle: row.vehicleRegistration || null, driver: `${row.driverFirstName || ""} ${row.driverLastName || ""}`.trim() || null,
      });
      for (const row of fleetRows as any[]) if (row.studentId && !studentMap.has(Number(row.studentId))) studentMap.set(Number(row.studentId), {
        studentId: row.studentId, name: `${row.firstName || ""} ${row.lastName || ""}`.trim(), admissionNo: row.admissionNo,
        className: row.className, parentName: `${row.parentFirstName || ""} ${row.parentLastName || ""}`.trim() || null,
        parentPhone: row.parentPhone, parentEmail: row.parentEmail, schoolName: row.schoolName,
        vehicle: row.vehicleRegistration || row.vehicleName || row.assetNumber || null, driver: null,
      });
      const [orgOwners, orgDrivers, orgStaff, orgSchools] = await Promise.all([
        db.select().from(transportOwners).where(inArray(transportOwners.schoolId, orgSchoolIds)),
        db.select().from(transportDrivers).where(inArray(transportDrivers.schoolId, orgSchoolIds)),
        db.select({ id: staff.id, firstName: staff.firstName, lastName: staff.lastName }).from(staff).where(inArray(staff.schoolId, orgSchoolIds)),
        db.select({ id: schools.id, name: schools.name }).from(schools).where(inArray(schools.id, orgSchoolIds)),
      ]);
      const ownerById = new Map(orgOwners.map((row) => [Number(row.id), row]));
      const driverById = new Map(orgDrivers.map((row) => [Number(row.id), row]));
      const staffById = new Map(orgStaff.map((row) => [Number(row.id), row]));
      const schoolById = new Map(orgSchools.map((row) => [Number(row.id), row.name]));
      const fleetByTransportVehicle = school.organizationId ? await db.select({ transportVehicleId: fleetVehicleProfiles.transportVehicleId, fleetVehicleId: fleetVehicleProfiles.id }).from(fleetVehicleProfiles).where(eq(fleetVehicleProfiles.organizationId, school.organizationId)) : [];
      const fleetLinkByTransportId = new Map(fleetByTransportVehicle.filter((row) => row.transportVehicleId).map((row) => [Number(row.transportVehicleId), Number(row.fleetVehicleId)]));
      const vehicleMap = new Map<string, any>();
      for (const row of assignments) if (row.vehicleId) {
        const fullVehicle = await assertOrganizationRecord(transportVehicles, Number(row.vehicleId), school);
        const owner = fullVehicle?.ownerId ? ownerById.get(Number(fullVehicle.ownerId)) : null;
        const driver = fullVehicle?.driverId ? driverById.get(Number(fullVehicle.driverId)) : null;
        vehicleMap.set(`transport:${row.vehicleId}`, {
          source: fleetLinkByTransportId.has(Number(row.vehicleId)) ? "FCGS Fleet" : (fullVehicle?.ownershipType === "contracted" || fullVehicle?.ownershipType === "staff" ? "Contracted" : "Transport"),
          id: row.vehicleId,
          transportVehicleId: row.vehicleId,
          fleetVehicleId: fleetLinkByTransportId.get(Number(row.vehicleId)) || null,
          registration: row.vehicleRegistration,
          makeModel: fullVehicle?.makeModel || null,
          baseSchool: fullVehicle ? schoolById.get(Number(fullVehicle.schoolId)) || null : null,
          owner: fullVehicle?.ownershipType === "school" ? "FCGS" : owner?.name || null,
          driver: driver ? `${driver.firstName} ${driver.lastName}` : null,
          status: fullVehicle?.status || null,
        });
      }
      for (const row of fleetRows as any[]) if (row.fleetVehicleId) {
        const driver = row.fleetPrimaryDriverStaffId ? staffById.get(Number(row.fleetPrimaryDriverStaffId)) : null;
        vehicleMap.set(`fleet:${row.fleetVehicleId}`, {
          source: "FCGS Fleet", id: row.fleetVehicleId, fleetVehicleId: row.fleetVehicleId, transportVehicleId: null,
          registration: row.vehicleRegistration || row.vehicleName || row.assetNumber,
          makeModel: row.vehicleName || null,
          baseSchool: row.fleetBaseSchoolId ? schoolById.get(Number(row.fleetBaseSchoolId)) || null : null,
          owner: "FCGS",
          driver: driver ? `${driver.firstName} ${driver.lastName}` : null,
          status: row.fleetStatus || null,
        });
      }
      return res.json({ point, students: Array.from(studentMap.values()), vehicles: Array.from(vehicleMap.values()) });
    } catch (error) { return routeError(res, error); }
  });

  app.delete("/api/transport/service-points/:id", requireAuth, requireAnyPermission("transport.stops.manage", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const point = await assertOrganizationRecord(transportServicePoints, id, school);
      if (!point) return res.status(404).json({ message: "Service point not found" });
      const orgSchoolIds = await organizationSchoolIds(school);
      const [assignmentUse] = await db.select({ id: transportAssignments.id }).from(transportAssignments).where(and(
        inArray(transportAssignments.schoolId, orgSchoolIds),
        or(eq(transportAssignments.pickupServicePointId, id), eq(transportAssignments.dropoffServicePointId, id)),
      )).limit(1);
      const [fleetUse] = school.organizationId ? await db.select({ id: fleetVehicleOccupants.id }).from(fleetVehicleOccupants).where(and(
        eq(fleetVehicleOccupants.organizationId, school.organizationId),
        or(eq(fleetVehicleOccupants.pickupServicePointId, id), eq(fleetVehicleOccupants.dropoffServicePointId, id)),
      )).limit(1) : [];
      if (assignmentUse || fleetUse) return res.status(409).json({ message: "This Pick-Up/Drop-Off Point is in use and cannot be deleted." });
      await db.delete(transportServicePoints).where(eq(transportServicePoints.id, id));
      await writeAudit(db, Number(point.schoolId), user.id, "service_point", id, "delete", point, null, "Unused saved Pick-Up/Drop-Off Point deleted");
      return res.json({ ok: true });
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/vehicles/:id/occupants", requireAuth, requirePermission("transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const vehicle = await assertOrganizationRecord(transportVehicles, id, school);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      const orgSchoolIds = await organizationSchoolIds(school);
      const rows = await db.select({
        assignmentId: transportAssignments.id, studentId: students.id, firstName: students.firstName, lastName: students.lastName,
        admissionNo: students.admissionNo, className: classes.className, schoolName: schools.name,
        startDate: transportAssignments.startDate, endDate: transportAssignments.endDate, isActive: transportAssignments.isActive,
        serviceState: transportAssignments.serviceState, financialStatus: transportAssignments.financialStatus,
        seatReservedUntil: transportAssignments.seatReservedUntil, suspensionReason: transportAssignments.suspensionReason, seatReleasedAt: transportAssignments.seatReleasedAt,
        routeName: transportRoutes.name,
      }).from(transportAssignments)
        .innerJoin(students, eq(students.id, transportAssignments.studentId))
        .innerJoin(schools, eq(schools.id, transportAssignments.schoolId))
        .leftJoin(classes, eq(classes.id, students.classId))
        .leftJoin(transportRoutes, eq(transportRoutes.id, transportAssignments.routeId))
        .where(and(inArray(transportAssignments.schoolId, orgSchoolIds), or(eq(transportAssignments.vehicleId, id), eq(transportAssignments.outboundVehicleId, id)), or(eq(transportAssignments.isActive, true), and(eq(transportAssignments.serviceState, "pending_start"), ne(transportAssignments.financialStatus, "pending_first_payment")))));
      const unique = new Map<number, any>();
      for (const row of rows) unique.set(Number(row.studentId), row);
      return res.json({ vehicle, occupants: Array.from(unique.values()) });
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/vehicles/:id/route", requireAuth, requireAnyPermission("transport.vehicles.edit", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const vehicleId = Number(req.params.id);
      const vehicle = await assertOrganizationRecord(transportVehicles, vehicleId, school);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      const direction = z.enum(["pickup","dropoff"]).default("pickup").parse(req.query.direction || "pickup");
      const orgSchoolIds = await organizationSchoolIds(school);
      const rows = await db.execute(sql`
        SELECT a.id,a.school_id AS "schoolId",a.student_id AS "studentId",a.service_type AS "serviceType",
               sp.id AS "pickupPointId",sp.name AS "pickupName",sp.latitude AS "pickupLatitude",sp.longitude AS "pickupLongitude",
               dp.id AS "dropoffPointId",dp.name AS "dropoffName",dp.latitude AS "dropoffLatitude",dp.longitude AS "dropoffLongitude",
               sc.name AS "schoolName",sc.latitude AS "schoolLatitude",sc.longitude AS "schoolLongitude"
        FROM transport_assignments a
        JOIN schools sc ON sc.id=a.school_id
        LEFT JOIN transport_service_points sp ON sp.id=a.pickup_service_point_id
        LEFT JOIN transport_service_points dp ON dp.id=a.dropoff_service_point_id
        WHERE a.school_id IN (${sql.join(orgSchoolIds.map((id) => sql`${id}`), sql`,`)})
          AND (a.is_active=true OR (a.service_state='pending_start' AND a.financial_status <> 'pending_first_payment'))
          AND (
            (${direction}='pickup' AND a.service_type IN ('pickup','both') AND a.vehicle_id=${vehicleId}) OR
            (${direction}='dropoff' AND a.service_type IN ('dropoff','both') AND COALESCE(a.outbound_vehicle_id,a.vehicle_id)=${vehicleId})
          )
      `);
      const learnerPoints = new Map<number, RouteCoordinate>();
      const schoolPoints = new Map<number, RouteCoordinate>();
      const warnings: string[] = [];
      for (const row of rows.rows as any[]) {
        const pointId = direction === "pickup" ? Number(row.pickupPointId || 0) : Number(row.dropoffPointId || row.pickupPointId || 0);
        const latitude = Number(direction === "pickup" ? row.pickupLatitude : (row.dropoffLatitude ?? row.pickupLatitude));
        const longitude = Number(direction === "pickup" ? row.pickupLongitude : (row.dropoffLongitude ?? row.pickupLongitude));
        const name = String(direction === "pickup" ? row.pickupName : (row.dropoffName || row.pickupName || "Learner stop"));
        if (pointId && Number.isFinite(latitude) && Number.isFinite(longitude)) learnerPoints.set(pointId, { latitude, longitude, name, type: "learner_stop", schoolId: Number(row.schoolId), servicePointId: pointId });
        const schoolLat = Number(row.schoolLatitude); const schoolLng = Number(row.schoolLongitude);
        if (Number.isFinite(schoolLat) && Number.isFinite(schoolLng) && row.schoolLatitude != null && row.schoolLongitude != null) {
          schoolPoints.set(Number(row.schoolId), { latitude: schoolLat, longitude: schoolLng, name: String(row.schoolName), type: "school_checkpoint", schoolId: Number(row.schoolId) });
        } else if (!warnings.includes(`${row.schoolName} has no configured coordinates.`)) warnings.push(`${row.schoolName} has no configured coordinates.`);
      }
      const learners = Array.from(learnerPoints.values()); const checkpoints = Array.from(schoolPoints.values());
      let schoolboundOrder: RouteCoordinate[] = [];
      if (learners.length) {
        let start = learners[0]; let farthest = -1;
        for (const point of learners) {
          const nearestSchool = checkpoints.length ? Math.min(...checkpoints.map((checkpoint) => haversineMeters(point.latitude, point.longitude, checkpoint.latitude, checkpoint.longitude))) : 0;
          if (nearestSchool > farthest) { farthest = nearestSchool; start = point; }
        }
        const orderedLearners = nearestNeighborOrder(learners, start);
        const orderedSchools = checkpoints.length ? nearestNeighborOrder(checkpoints, orderedLearners[orderedLearners.length - 1]) .slice(1) : [];
        schoolboundOrder = [...orderedLearners, ...orderedSchools];
      } else schoolboundOrder = nearestNeighborOrder(checkpoints);
      const ordered = direction === "pickup" ? schoolboundOrder : [...schoolboundOrder].reverse();
      const routed = await roadRoute(ordered);
      return res.json({ vehicle: { id: vehicle.id, registrationNumber: vehicle.registrationNumber, routeNotes: vehicle.routeNotes || null }, direction, nodes: ordered, geometry: routed.geometry, distanceKm: routed.distanceKm, durationMinutes: routed.durationMinutes, provider: routed.provider, warnings, generatedAt: new Date().toISOString(), editable: false });
    } catch (error) { return routeError(res, error); }
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
        assertOrganizationRecord(transportVehicles, parsed.vehicleId, school),
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
          isTwoWay: parsed.isTwoWay,
          canonicalTraversal: parsed.canonicalTraversal,
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
            reverseExpectedTime: nodeInput.reverseExpectedTime,
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

  app.put("/api/transport/paths/:id", requireAuth, requireAnyPermission("transport.paths.manage", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(transportVehiclePaths, id, school.id);
      if (!previous) return res.status(404).json({ message: "Vehicle path not found" });
      if (previous.status !== "draft") return res.status(409).json({ message: "Only draft path versions can be edited. Create a new version for an active path." });
      const parsed = pathInput.parse(req.body);
      const [route, vehicle] = await Promise.all([
        assertSchoolRecord(transportRoutes, parsed.routeId, school.id),
        assertOrganizationRecord(transportVehicles, parsed.vehicleId, school),
      ]);
      if (!route || !vehicle) return res.status(404).json({ message: "Route or vehicle not found" });
      const updated = await db.transaction(async (tx) => {
        const pathValues: any = {
          routeId: parsed.routeId, vehicleId: parsed.vehicleId, direction: parsed.direction,
          isTwoWay: parsed.isTwoWay, canonicalTraversal: parsed.canonicalTraversal, name: parsed.name,
          effectiveFrom: parsed.effectiveFrom, effectiveTo: parsed.effectiveTo,
          geometry: parsed.geometry ?? parsed.nodes.map((node) => [node.latitude, node.longitude]),
          estimatedDistanceKm: parsed.estimatedDistanceKm, estimatedDurationMinutes: parsed.estimatedDurationMinutes,
          notes: parsed.notes, updatedAt: new Date(),
        };
        if (pathValues.estimatedDistanceKm !== undefined && pathValues.estimatedDistanceKm !== null) pathValues.estimatedDistanceKm = String(pathValues.estimatedDistanceKm);
        const [path] = await tx.update(transportVehiclePaths).set(pathValues).where(eq(transportVehiclePaths.id, id)).returning();
        const oldNodes = await tx.select({ id: transportPathNodes.id }).from(transportPathNodes).where(eq(transportPathNodes.pathId, id));
        if (oldNodes.length) await tx.delete(transportPathNodeLearners).where(inArray(transportPathNodeLearners.pathNodeId, oldNodes.map((row) => row.id)));
        await tx.delete(transportPathNodes).where(eq(transportPathNodes.pathId, id));
        for (const nodeInput of [...parsed.nodes].sort((a, b) => a.stopOrder - b.stopOrder)) {
          const [node] = await tx.insert(transportPathNodes).values({
            schoolId: school.id, pathId: path.id, nodeType: nodeInput.nodeType, name: nodeInput.name,
            latitude: String(nodeInput.latitude), longitude: String(nodeInput.longitude), stopOrder: nodeInput.stopOrder,
            expectedTime: nodeInput.expectedTime, reverseExpectedTime: nodeInput.reverseExpectedTime,
            checkpointRadiusMeters: nodeInput.checkpointRadiusMeters, notes: nodeInput.notes,
          }).returning();
          for (const link of nodeInput.learnerLinks ?? []) await tx.insert(transportPathNodeLearners).values({ ...link, schoolId: school.id, pathNodeId: node.id });
        }
        await writeAudit(tx, school.id, user.id, "vehicle_path", id, "edit_draft", previous, path, "Draft vehicle path edited");
        return path;
      });
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
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
      const vehicle = await assertOrganizationRecord(transportVehicles, path.vehicleId, school);
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
      if (parsed.serviceType === "both") parsed.outboundVehicleId = parsed.vehicleId;
      parsed.serviceState = "pending_start";
      parsed.financialStatus = "pending_first_payment";
      await validateAssignmentSelection(school.id, user.id, parsed);
      await associateVehicleWithSchoolAndDestination(parsed.vehicleId, parsed.routeId, school.id, user.id);
      if (parsed.outboundVehicleId && Number(parsed.outboundVehicleId) !== Number(parsed.vehicleId || 0)) await associateVehicleWithSchoolAndDestination(parsed.outboundVehicleId, parsed.routeId, school.id, user.id);
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
      const pricingMode = String(settings.oneWayPricingMode || "percentage");
      const percent = parsed.serviceType === "pickup"
        ? (pricingMode === "percentage" ? amount(settings.inboundOneWayPercent) : 50)
        : parsed.serviceType === "dropoff"
          ? (pricingMode === "percentage" ? amount(settings.outboundOneWayPercent) : 50)
          : 100;
      const expectedOneWayFee = parsed.serviceType === "both"
        ? amount(parsed.baseMonthlyFee)
        : pricingMode === "fixed_addition"
          ? rounded(amount(parsed.baseMonthlyFee) / 2 + (parsed.serviceType === "pickup" ? amount(settings.inboundOneWayFixedAddition) : amount(settings.outboundOneWayFixedAddition)))
          : rounded(amount(parsed.baseMonthlyFee) * percent / 100);
      if (parsed.serviceType !== "both" && Math.abs(amount(parsed.agreedFee) - expectedOneWayFee) > 0.009) {
        // Existing workflow permits a deliberately agreed override, but the configured
        // pricing method remains the authoritative standard used by the UI and audit data.
      }
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

  app.patch("/api/transport/assignments/:id/service-points", requireAuth, requireAnyPermission("transport.learners.edit_service", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(transportAssignments, id, school.id);
      if (!previous || !previous.isActive) return res.status(404).json({ message: "Active assignment not found" });
      const parsed = assignmentServicePointsInput.parse(req.body);
      const pickupServicePointId = parsed.pickupServicePointId ?? null;
      const dropoffServicePointId = parsed.dropoffServicePointId ?? null;

      if ((previous.serviceType === "pickup" || previous.serviceType === "both") && !pickupServicePointId) {
        return res.status(400).json({ message: "Select or create the learner's Pick-Up Point." });
      }
      if ((previous.serviceType === "dropoff" || previous.serviceType === "both") && !dropoffServicePointId) {
        return res.status(400).json({ message: "Select or create the learner's Drop-Off Point." });
      }
      await validateLearnerServicePoint(school, Number(previous.studentId), pickupServicePointId, ["pickup", "both"]);
      await validateLearnerServicePoint(school, Number(previous.studentId), dropoffServicePointId, ["dropoff", "both"]);

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(transportAssignments).set({
          pickupServicePointId,
          dropoffServicePointId,
          updatedAt: new Date(),
        }).where(eq(transportAssignments.id, id)).returning();
        await tx.delete(transportPathNodeLearners).where(eq(transportPathNodeLearners.assignmentId, id));
        await linkAssignmentNodes(tx, school.id, row);
        await writeAudit(tx, school.id, user.id, "assignment", id, "service_points_update", previous, row, "Learner Pick-Up/Drop-Off Point completed");
        return row;
      });
      return res.json(updated);
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
      const pendingCancellation = await pendingCancellationForAssignment(id);
      if (pendingCancellation) return res.status(409).json({ message: `This service already has a cancellation scheduled for ${pendingCancellation.effectiveDate}. A transfer cannot be started while that cancellation is pending.` });
      const parsed: any = clean(transferInput.parse(req.body));
      const prospective = { ...previous, ...parsed, studentId: previous.studentId };
      if (prospective.serviceType === "both") prospective.outboundVehicleId = prospective.vehicleId;
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
      if (base.serviceType === "both") base.outboundVehicleId = base.vehicleId;
      const serviceType = base.serviceType ?? previous.serviceType;
      const pricingMode = String(settings.oneWayPricingMode || "percentage");
      const percent = serviceType === "pickup"
        ? (pricingMode === "percentage" ? amount(settings.inboundOneWayPercent) : 50)
        : serviceType === "dropoff"
          ? (pricingMode === "percentage" ? amount(settings.outboundOneWayPercent) : 50)
          : 100;
      const newAssignment = await db.transaction(async (tx) => {
        const startsNow = effectiveDate <= isoDate(new Date());
        await tx.update(transportAssignments).set({ endDate: previousEnd, isActive: startsNow ? false : true, serviceState: startsNow ? "terminated" : previous.serviceState, updatedAt: new Date() }).where(eq(transportAssignments.id, id));
        const values: any = {
          schoolId: school.id,
          studentId: previous.studentId,
          routeId: base.routeId,
          vehicleId: base.vehicleId,
          outboundVehicleId: base.outboundVehicleId,
          driverId: base.driverId,
          inboundPathId: base.inboundPathId,
          inboundPathTraversal: base.inboundPathTraversal || "forward",
          outboundPathId: base.outboundPathId,
          outboundPathTraversal: base.outboundPathTraversal || "forward",
          pickupServicePointId: base.pickupServicePointId,
          dropoffServicePointId: base.dropoffServicePointId,
          pickupPathNodeId: base.pickupPathNodeId,
          dropoffPathNodeId: base.dropoffPathNodeId,
          serviceType,
          serviceState: effectiveDate <= isoDate(new Date()) ? "active" : "pending_start",
          planningStatus: base.planningStatus ?? "assigned_to_path",
          financialStatus: previous.financialStatus,
          billingFrequency: "monthly",
          baseMonthlyFee: base.baseMonthlyFee,
          agreedFee: base.agreedFee,
          oneWayPercentSnapshot: String(percent),
          startDate: effectiveDate,
          endDate: base.endDate,
          isActive: effectiveDate <= isoDate(new Date()),
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

  app.post("/api/transport/assignments/:id/cancel", requireAuth, requireAnyPermission("transport.learners.edit_service", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(transportAssignments, id, school.id);
      if (!previous || !previous.isActive) return res.status(404).json({ message: "Active transport registration not found" });
      const existingCancellation = await pendingCancellationForAssignment(id);
      if (existingCancellation) return res.status(409).json({ message: `Service cancellation has already been recorded for this service period (effective ${existingCancellation.effectiveDate}).` });
      const parsed = z.object({ stopServiceDate: dateString, reason: z.string().trim().min(3), refundMethod: z.enum(["credit", "cash", "bank_transfer", "mobile_money", "original_method"]).optional() }).parse(req.body);
      if (parsed.stopServiceDate < previous.startDate) return res.status(409).json({ message: "Stop Service Date cannot be before the Service Start Date." });
      const settings = await getOrCreateSettings(school.id);
      const refundEffectiveDate = isoDate(new Date(new Date(`${parsed.stopServiceDate}T00:00:00Z`).getTime() + 86400000));
      const result = await db.transaction(async (tx) => {
        const [row] = await tx.update(transportAssignments).set({ endDate: parsed.stopServiceDate, isActive: parsed.stopServiceDate < isoDate(new Date()) ? false : previous.isActive, serviceState: parsed.stopServiceDate < isoDate(new Date()) ? "terminated" : previous.serviceState, updatedAt: new Date() }).where(eq(transportAssignments.id, id)).returning();
        await tx.insert(transportAssignmentEvents).values({ schoolId: school.id, assignmentId: id, eventType: "service_cancelled", effectiveDate: parsed.stopServiceDate, previousValues: previous, newValues: row, reason: parsed.reason, createdByUserId: user.id });
        const calculation = unusedServiceRefund(previous, refundEffectiveDate, settings);
        let refund: any = null;
        if (calculation.amount > 0) {
          [refund] = await tx.insert(transportRefunds).values({ schoolId: school.id, studentId: previous.studentId, assignmentId: previous.id, refundNumber: numberCode("REF", school.shortCode, Date.now().toString().slice(-6)), refundType: "termination_refund", amount: String(calculation.amount), effectiveDate: refundEffectiveDate, method: parsed.refundMethod || "credit", calculationSnapshot: calculation, reason: parsed.reason, requestedByUserId: user.id }).returning();
        }
        await writeAudit(tx, school.id, user.id, "assignment", id, "cancel_service", previous, row, parsed.reason, { stopServiceDate: parsed.stopServiceDate, refundId: refund?.id ?? null });
        return { assignment: row, refund };
      });
      await notifyParentForStudent(previous.studentId, school.id, user.id, "Transport service cancellation recorded", `The last day of transport service is ${parsed.stopServiceDate}.`, "info");
      return res.json(result);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/assignments/:id/state", requireAuth, requireAnyPermission("transport.learners.edit_service", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(transportAssignments, id, school.id);
      if (!previous) return res.status(404).json({ message: "Assignment not found" });
      const pendingCancellation = await pendingCancellationForAssignment(id);
      if (pendingCancellation) return res.status(409).json({ message: `This service already has a cancellation scheduled for ${pendingCancellation.effectiveDate}. A service-state change cannot be applied while that cancellation is pending.` });
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
      const orgPolicy = school.organizationId ? await getOrCreateOrganizationTransportSettings(school.organizationId) : { minimumArrearsSuspensionBalance: "1", suspendedSeatPolicy: "release_after_days", suspendedSeatReleaseDays: 14, automaticArrearsReinstatement: true, arrearsWarningEnabled: true };
      await reconcileArrearsSeatReleases(school.id);
      const period = periodDates(parsed.academicYear, parsed.month);
      const filters = [eq(transportAssignments.schoolId, school.id), lte(transportAssignments.startDate, period.end), or(isNull(transportAssignments.endDate), gte(transportAssignments.endDate, period.start)), sql`${transportAssignments.serviceState} NOT IN ('suspended_arrears','pending_vehicle_reassignment')`];
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
      const orgPolicy = school.organizationId ? await getOrCreateOrganizationTransportSettings(school.organizationId) : { minimumArrearsSuspensionBalance: "1", suspendedSeatPolicy: "release_after_days", suspendedSeatReleaseDays: 14, automaticArrearsReinstatement: true, arrearsWarningEnabled: true };
      await reconcileArrearsSeatReleases(school.id);
      const period = periodDates(parsed.academicYear, parsed.month);
      const filters = [eq(transportAssignments.schoolId, school.id), lte(transportAssignments.startDate, period.end), or(isNull(transportAssignments.endDate), gte(transportAssignments.endDate, period.start)), sql`${transportAssignments.serviceState} NOT IN ('suspended_arrears','pending_vehicle_reassignment')`];
      if (parsed.assignmentIds?.length) filters.push(inArray(transportAssignments.id, parsed.assignmentIds));
      const assignments = await db.select().from(transportAssignments).where(and(...filters));
      let created = 0;
      let skipped = 0;
      let totalGenerated = 0;
      let newlySuspended = 0;
      let seatsReleasedImmediately = 0;
      const suspendedLearners: any[] = [];
      let billingRun: any = null;
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
          const arrears = await qualifyingTransportArrears(tx, school.id, assignment.studentId, period.start);
          const threshold = amount(orgPolicy.minimumArrearsSuspensionBalance);
          if (arrears.balance > threshold) {
            const seatPolicy = String(orgPolicy.suspendedSeatPolicy || "release_after_days");
            const releaseImmediately = seatPolicy === "release_immediately";
            const seatReservedUntil = seatPolicy === "release_after_days" ? addDaysIso(period.start, Number(orgPolicy.suspendedSeatReleaseDays || 0)) : null;
            const [suspended] = await tx.update(transportAssignments).set({
              serviceState: "suspended_arrears", financialStatus: "overdue", suspensionReason: "arrears",
              seatReservedUntil, seatReleasedAt: releaseImmediately ? new Date() : null, isActive: !releaseImmediately, updatedAt: new Date(),
            }).where(eq(transportAssignments.id, assignment.id)).returning();
            await tx.insert(transportAssignmentEvents).values({ schoolId: school.id, assignmentId: assignment.id, eventType: "suspended_arrears", effectiveDate: period.start, previousValues: assignment, newValues: suspended, reason: `Previous Transport balance ${arrears.balance.toFixed(2)} exceeded the organisation threshold ${threshold.toFixed(2)} when the next month charge was generated`, createdByUserId: user.id });
            newlySuspended += 1; if (releaseImmediately) seatsReleasedImmediately += 1;
            suspendedLearners.push({ studentId: assignment.studentId, assignmentId: assignment.id, arrearsBalance: arrears.balance, oldestOverdueMonth: arrears.oldestMonth, seatReservedUntil, seatReleased: releaseImmediately });
          }
          created += 1;
          totalGenerated = rounded(totalGenerated + calculated);
        }
        [billingRun] = await tx.insert(transportBillingRuns).values({
          schoolId: school.id,
          runNumber: numberCode("BILL", school.shortCode, Date.now().toString().slice(-6)),
          serviceYear: parsed.academicYear, serviceMonth: parsed.month, status: "completed",
          generatedCount: created, skippedCount: skipped, failedCount: 0, totalAmount: String(totalGenerated),
          details: { assignmentIds: parsed.assignmentIds || null, dueDate: parsed.dueDate || null, description: parsed.description || null, newlySuspended, seatsReleasedImmediately, suspendedLearners },
          generatedByUserId: user.id,
        }).returning();
        await writeAudit(tx, school.id, user.id, "billing_run", billingRun.id, "generate", null, billingRun);
      });
      return res.status(201).json({ created, skipped, total: totalGenerated, newlySuspended, seatsReleasedImmediately, suspendedLearners, billingRun });
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
      const eligibility = await transportPaymentEligibility(school.id, parsed.studentId);
      if (!eligibility.eligible) return res.status(409).json({ message: eligibility.reason || "Learner is not eligible for a Transport payment." });
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
        await tx.insert(transportReceiptEvents).values({ schoolId: school.id, paymentId: payment.id, eventType: "issued", copyType: "single_receipt", createdByUserId: user.id, metadata: { receiptNo } });
        const [activeAssignment] = await tx.select().from(transportAssignments).where(and(
          eq(transportAssignments.schoolId, school.id), eq(transportAssignments.studentId, parsed.studentId), eq(transportAssignments.isActive, true),
        )).orderBy(desc(transportAssignments.startDate)).limit(1);
        if (activeAssignment) {
          const financialStatus = remaining > 0 ? "credit" : "paid";
          const serviceState = activeAssignment.serviceState === "pending_start" && activeAssignment.startDate <= isoDate(new Date()) ? "active" : activeAssignment.serviceState;
          await tx.update(transportAssignments).set({ financialStatus, serviceState, updatedAt: new Date() }).where(eq(transportAssignments.id, activeAssignment.id));
        }
        const reinstatement = await reconcileArrearsAfterPayment(tx, school, parsed.studentId, user.id);
        await writeAudit(tx, school.id, user.id, "payment", payment.id, "record", null, { ...payment, unallocatedCredit: remaining, reinstatement: reinstatement ? { assignmentId: reinstatement.id, serviceState: reinstatement.serviceState } : null });
        return { payment, unallocatedCredit: remaining, reinstatement };
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

      const settings = await getOrCreateSettings(school.id);
      const queryFormatRaw = Array.isArray(req.query.format) ? req.query.format[0] : req.query.format;
      const queryFormat = queryFormatRaw ? receiptPrintFormatInput.safeParse(String(queryFormatRaw)) : null;
      if (queryFormat && !queryFormat.success) return res.status(400).json({ message: "Receipt format must be either a4 or thermal80." });
      const configuredFormat = receiptPrintFormatInput.safeParse(String(settings.receiptPrintFormat || "a4"));
      const printFormat = queryFormat?.success ? queryFormat.data : (configuredFormat.success ? configuredFormat.data : "a4");

      const printCountResult = await db.execute(sql`SELECT COUNT(*)::int count FROM transport_receipt_events WHERE payment_id=${id} AND event_type IN ('printed','reprint')`);
      const priorPrintCount = Number(printCountResult.rows[0]?.count ?? 0);
      const eventType = priorPrintCount > 0 ? "reprint" : "printed";
      await db.insert(transportReceiptEvents).values({
        schoolId: school.id,
        paymentId: id,
        eventType,
        copyType: "single_receipt",
        createdByUserId: user.id,
        metadata: { printNumber: priorPrintCount + 1, format: printFormat, formatOverride: Boolean(queryFormat?.success) },
      });
      await writeAudit(db, school.id, user.id, "receipt", id, eventType, null, {
        receiptNo: payment.receiptNo,
        printNumber: priorPrintCount + 1,
        format: printFormat,
        formatOverride: Boolean(queryFormat?.success),
      });

      const snapshot = payment.receiptSnapshot as any;
      const verifyUrl = `${req.protocol}://${req.get("host")}/api/public/transport/receipts/${encodeURIComponent(payment.verificationToken)}`;
      const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 150 });
      const allocation = await db.execute(sql`SELECT COALESCE(SUM(amount),0)::text allocated FROM transport_payment_allocations WHERE payment_id=${id}`);
      const allocated = amount(allocation.rows[0]?.allocated);
      const credit = rounded(amount(payment.amount) - allocated);
      const reprint = priorPrintCount > 0;
      const logo = await imageDataUrl(snapshot?.school?.logo || school.logo);
      const logoMarkup = logo ? `<div class="logo"><img src="${escapeHtml(logo)}" alt="School logo"/></div>` : "";
      const schoolName = escapeHtml(snapshot?.school?.name || school.name);
      const schoolAddress = escapeHtml(snapshot?.school?.address || school.address || "");
      const schoolPhone = escapeHtml(snapshot?.school?.phone || school.phone || "");
      const learnerName = escapeHtml(`${snapshot?.learner?.firstName ?? ""} ${snapshot?.learner?.lastName ?? ""}`.trim());
      const admissionNo = escapeHtml(snapshot?.learner?.admissionNo || "—");
      const className = escapeHtml(snapshot?.learner?.className || "—");
      const routeName = escapeHtml(snapshot?.assignment?.routeName || "—");
      const pickupDestination = escapeHtml(snapshot?.assignment?.pickupName || snapshot?.assignment?.dropoffName || "—");
      const vehicleRegistration = escapeHtml(snapshot?.assignment?.vehicleRegistration || "—");
      const driverName = escapeHtml(snapshot?.assignment?.driverName || "—");
      const serviceType = escapeHtml(snapshot?.assignment?.serviceType || "—");
      const paymentMethod = escapeHtml(payment.paymentMethod || "—");
      const receivedBy = escapeHtml(snapshot?.receivedBy || "—");
      const transportManager = escapeHtml(snapshot?.transportManagerName || "Not configured");
      const issuedAt = escapeHtml(snapshot?.issuedAt || "—");
      const paymentDate = escapeHtml(payment.paymentDate || "—");
      const status = escapeHtml(payment.status || "—");
      const receiptNo = escapeHtml(payment.receiptNo);
      const notice = "This copy does not independently authorise a claim or payout. Claim eligibility is verified in the FCGS Portal.";

      const a4Copy = (label: string) => `
        <section class="receipt">
          ${reprint ? '<div class="watermark">REPRINT</div>' : ""}
          ${logoMarkup}
          <header><div class="school"><h1>${schoolName}</h1><div>${schoolAddress}</div><div>${schoolPhone}</div></div><div class="copy">${label}</div></header>
          <h2>TRANSPORT RECEIPT</h2>
          <div class="grid">
            <div><b>Receipt No.</b><span>${receiptNo}</span></div>
            <div><b>Status</b><span>${status}</span></div>
            <div><b>Learner</b><span>${learnerName}</span></div>
            <div><b>Admission No.</b><span>${admissionNo}</span></div>
            <div><b>Class</b><span>${className}</span></div>
            <div><b>Payment date</b><span>${paymentDate}</span></div>
            <div><b>Route</b><span>${routeName}</span></div>
            <div><b>Pickup / destination</b><span>${pickupDestination}</span></div>
            <div><b>Vehicle</b><span>${vehicleRegistration}</span></div>
            <div><b>Driver</b><span>${driverName}</span></div>
            <div><b>Service</b><span>${serviceType}</span></div>
            <div><b>Payment method</b><span>${paymentMethod}</span></div>
          </div>
          <div class="amount">USD ${amount(payment.amount).toFixed(2)}</div>
          <div class="small">Allocated: USD ${allocated.toFixed(2)} · Learner credit: USD ${credit.toFixed(2)}</div>
          <footer><div><b>Received by:</b> ${receivedBy}<br/><b>Transport Manager:</b> ${transportManager}<br/><b>Issued:</b> ${issuedAt}</div><div class="qr"><img src="${qr}"/><small>Scan to verify</small></div></footer>
          <p class="notice">${notice}</p>
        </section>`;

      const thermalRow = (label: string, value: string) => `<div class="row"><div class="label">${label}</div><div class="value">${value}</div></div>`;
      const thermalCopy = (label: string) => `
        <section class="receipt thermal-receipt">
          ${reprint ? '<div class="watermark">REPRINT</div>' : ""}
          ${logoMarkup}
          <div class="school"><h1>${schoolName}</h1>${schoolAddress ? `<div>${schoolAddress}</div>` : ""}${schoolPhone ? `<div>${schoolPhone}</div>` : ""}</div>
          <div class="copy">${label}</div>
          <h2>TRANSPORT RECEIPT</h2>
          <div class="details">
            ${thermalRow("Receipt No.", receiptNo)}
            ${thermalRow("Status", status)}
            ${thermalRow("Learner", learnerName)}
            ${thermalRow("Admission No.", admissionNo)}
            ${thermalRow("Class", className)}
            ${thermalRow("Payment date", paymentDate)}
            ${thermalRow("Route", routeName)}
            ${thermalRow("Pickup / destination", pickupDestination)}
            ${thermalRow("Vehicle", vehicleRegistration)}
            ${thermalRow("Driver", driverName)}
            ${thermalRow("Service", serviceType)}
            ${thermalRow("Payment method", paymentMethod)}
          </div>
          <div class="amount">USD ${amount(payment.amount).toFixed(2)}</div>
          <div class="totals"><div><b>Allocated</b><span>USD ${allocated.toFixed(2)}</span></div><div><b>Learner credit</b><span>USD ${credit.toFixed(2)}</span></div></div>
          <div class="handover">
            ${thermalRow("Received by", receivedBy)}
            ${thermalRow("Transport Manager", transportManager)}
            ${thermalRow("Issued", issuedAt)}
          </div>
          <div class="qr"><img src="${qr}"/><small>Scan to verify</small></div>
          <p class="notice">${notice}</p>
        </section>`;

      let pdf: Buffer;
      if (printFormat === "thermal80") {
        const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${receiptNo}</title><style>
          *{box-sizing:border-box}html,body{width:80mm;margin:0;padding:0;font-family:Arial,sans-serif;color:#111;background:#fff}body{overflow-wrap:anywhere;word-break:normal}.receipt{position:relative;width:80mm;padding:3.5mm 4mm;overflow:visible}.thermal-receipt+.thermal-receipt{border-top:1px dashed #555;margin-top:3mm;padding-top:5mm}.logo{text-align:center;margin:0 auto 2mm}.logo img{display:inline-block;max-width:34mm;max-height:20mm;width:auto;height:auto;object-fit:contain}.school{text-align:center;font-size:10.5px;font-weight:600;line-height:1.4;overflow-wrap:anywhere}.school h1{font-size:14.5px;font-weight:800;line-height:1.2;margin:0 0 1mm}.copy{margin:3mm auto 1.5mm;text-align:center;font-weight:800;font-size:11px;border:1.4px solid #111;padding:1.5mm 2mm;max-width:60mm}.thermal-receipt h2{text-align:center;font-size:14.5px;font-weight:800;letter-spacing:.5px;margin:2mm 0 3mm}.details,.handover{border-top:1.2px solid #555}.row{padding:1.7mm 0;border-bottom:1px dotted #777}.label{font-size:9.5px;font-weight:800;margin-bottom:.6mm}.value{font-size:11px;font-weight:600;line-height:1.4;white-space:normal;overflow-wrap:anywhere}.amount{text-align:center;font-size:23px;font-weight:800;margin:4mm 0 2mm}.totals{font-size:10.5px;font-weight:600;border-top:1.2px solid #555;border-bottom:1.2px solid #555;padding:1.5mm 0;margin-bottom:3mm}.totals div{display:flex;justify-content:space-between;gap:3mm;padding:.7mm 0}.totals span{text-align:right;white-space:nowrap}.handover{margin-top:2mm}.qr{text-align:center;margin:3mm auto 2mm}.qr img{display:block;width:25mm;height:25mm;margin:0 auto 1mm}.qr small{font-size:9px;font-weight:600}.notice{font-size:9px;font-weight:600;line-height:1.4;border-top:1px solid #777;padding-top:2mm;margin:2mm 0 0;white-space:normal;overflow-wrap:anywhere}.watermark{position:absolute;z-index:0;transform:rotate(-25deg);font-size:25mm;font-weight:700;color:rgba(180,0,0,.07);top:42%;left:7mm;pointer-events:none}.receipt>*:not(.watermark){position:relative;z-index:1}@media print{html,body{width:80mm}}
        </style></head><body>${thermalCopy("RECEIPT")}</body></html>`;
        pdf = await renderHtmlPdf({ html, pdfOptions: { printBackground: true }, fitToContent: { width: "80mm", paddingPx: 2 } });
      } else {
        const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${receiptNo}</title><style>
          @page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0}.receipt{position:relative;border:1.5px solid #222;padding:16px;margin-bottom:12px;min-height:122mm;overflow:hidden}.receipt:first-child{border-bottom-style:dashed}.logo{text-align:center;margin:0 auto 8px}.logo img{display:inline-block;max-width:42mm;max-height:22mm;width:auto;height:auto;object-fit:contain}header{position:relative;display:flex;justify-content:center;align-items:flex-start;gap:20px;font-size:12px;min-height:48px}.school{text-align:center;max-width:70%}.school h1{font-size:19px;margin:0 0 4px;overflow-wrap:anywhere}.copy{position:absolute;right:0;top:0;font-weight:bold;border:1px solid #111;padding:7px;max-width:28%;text-align:center;overflow-wrap:anywhere}h2{text-align:center;font-size:16px;letter-spacing:1.2px;margin:13px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 20px;font-size:12px}.grid div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dotted #bbb;padding-bottom:3px;min-width:0}.grid b{flex:0 0 auto}.grid span{text-align:right;overflow-wrap:anywhere;min-width:0}.amount{text-align:center;font-size:28px;font-weight:bold;margin:14px 0 4px}.small{text-align:center;font-size:11px}footer{display:flex;justify-content:space-between;align-items:end;gap:16px;margin-top:10px;font-size:11px;overflow-wrap:anywhere}.qr{text-align:center;flex:0 0 auto}.qr img{width:75px;display:block}.notice{font-size:9px;border-top:1px solid #ddd;padding-top:6px;overflow-wrap:anywhere}.watermark{position:absolute;transform:rotate(-25deg);font-size:82px;font-weight:bold;color:rgba(180,0,0,.09);top:42%;left:17%;pointer-events:none}@media print{button{display:none}}
        </style></head><body>${a4Copy("RECEIPT")}</body></html>`;
        pdf = await renderHtmlPdf({ html, pdfOptions: { format: "A4", printBackground: true, preferCSSPageSize: true } });
      }

      const suffix = printFormat === "thermal80" ? "80mm" : "A4";
      const filename = reportPdfFilename(`Transport_Receipt_${payment.receiptNo}_${suffix}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`);
      res.setHeader("X-FCGS-Receipt-Format", printFormat);
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
        const nextStatus = previous.method === "credit" ? "credited" : "approved_awaiting_payment";
        const [row] = await tx.update(transportRefunds).set({ status: nextStatus, approvedByUserId: user.id, approvedAt: new Date(), ...(nextStatus === "credited" ? { paidAt: new Date(), paidByUserId: user.id } : {}) }).where(eq(transportRefunds.id, id)).returning();
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
      if (!previous || previous.status !== "approved_awaiting_payment") return res.status(409).json({ message: "External refund must be approved and awaiting payment first" });
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
      if (!parsed.paymentIds.length && !parsed.refundIds.length) return res.status(400).json({ message: "Select at least one receipt or paid refund for this cash-up." });
      const payments = parsed.paymentIds.length ? await db.select().from(transportPayments).where(and(eq(transportPayments.schoolId, school.id), inArray(transportPayments.id, parsed.paymentIds), isNull(transportPayments.reversedAt))) : [];
      if (payments.length !== parsed.paymentIds.length) return res.status(400).json({ message: "One or more payments are invalid or already reversed" });
      const refunds = parsed.refundIds.length ? await db.select().from(transportRefunds).where(and(eq(transportRefunds.schoolId, school.id), inArray(transportRefunds.id, parsed.refundIds), eq(transportRefunds.status, "paid"), isNull(transportRefunds.accountedCashupId))) : [];
      if (refunds.length !== parsed.refundIds.length) return res.status(400).json({ message: "One or more refunds are invalid or have not been paid yet." });
      const alreadyCashed = parsed.paymentIds.length ? await db.select({ paymentId: transportCashupPayments.paymentId }).from(transportCashupPayments).where(inArray(transportCashupPayments.paymentId, parsed.paymentIds)) : [];
      if (alreadyCashed.length) return res.status(409).json({ message: "One or more selected payments have already been included in a cash-up. Refresh the list and select only uncash-up payments." });
      const historicallyAccountedRefunds = parsed.refundIds.length ? await db.select({ refundId: transportCashupRefunds.refundId })
        .from(transportCashupRefunds)
        .innerJoin(transportCashups, eq(transportCashups.id, transportCashupRefunds.cashupId))
        .where(and(inArray(transportCashupRefunds.refundId, parsed.refundIds), eq(transportCashups.status, "verified"))) : [];
      if (historicallyAccountedRefunds.length) return res.status(409).json({ message: "One or more selected refunds were already accounted for by a completed cash-up. Refresh the list and select only unaccounted refunds." });

      const handover = calculateCashupHandover(payments, refunds);
      const expectedCash = handover.cash;
      const expectedNonCash = handover.nonCash;
      const created = await db.transaction(async (tx) => {
        const [cashup] = await tx.insert(transportCashups).values({
          schoolId: school.id,
          cashupNumber: numberCode("CASH", school.shortCode, Date.now().toString().slice(-6)),
          cashupDate: parsed.cashupDate,
          cashierUserId: user.id,
          expectedCash: String(expectedCash),
          actualCash: String(expectedCash),
          expectedNonCash: String(expectedNonCash),
          actualNonCash: String(expectedNonCash),
          variance: "0",
          depositReference: parsed.depositReference,
          notes: parsed.notes,
        }).returning();
        for (const payment of payments) await tx.insert(transportCashupPayments).values({ cashupId: cashup.id, paymentId: payment.id });
        for (const refund of refunds) await tx.insert(transportCashupRefunds).values({ cashupId: cashup.id, refundId: refund.id });
        await writeAudit(tx, school.id, user.id, "cashup", cashup.id, "create", null, schoolCashupView(cashup), null, { paymentIds: parsed.paymentIds, refundIds: parsed.refundIds });
        return cashup;
      });
      return res.status(201).json(schoolCashupView(created));
    } catch (error) { return routeError(res, error); }
  });

  app.put("/api/transport/cashups/:id", requireAuth, requireAnyPermission("transport.cashups.prepare", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(transportCashups, id, school.id);
      if (!previous || previous.status !== "draft") return res.status(409).json({ message: "Only a draft cash-up can be edited" });
      if (previous.cashierUserId !== user.id) return res.status(403).json({ message: "Only the Receptionist/cashier who prepared this draft can edit it" });
      const parsed = cashupInput.parse(req.body);
      if (!parsed.paymentIds.length && !parsed.refundIds.length) return res.status(400).json({ message: "Select at least one receipt or paid refund for this cash-up." });
      const payments = parsed.paymentIds.length ? await db.select().from(transportPayments).where(and(eq(transportPayments.schoolId, school.id), inArray(transportPayments.id, parsed.paymentIds), isNull(transportPayments.reversedAt))) : [];
      if (payments.length !== parsed.paymentIds.length) return res.status(409).json({ message: "One or more selected payments are no longer valid. Refresh this draft." });
      const refunds = parsed.refundIds.length ? await db.select().from(transportRefunds).where(and(eq(transportRefunds.schoolId, school.id), inArray(transportRefunds.id, parsed.refundIds), eq(transportRefunds.status, "paid"), isNull(transportRefunds.accountedCashupId))) : [];
      if (refunds.length !== parsed.refundIds.length) return res.status(409).json({ message: "One or more selected refunds are no longer valid or have already been accounted for." });
      const conflictingPayments = parsed.paymentIds.length ? await db.select({ paymentId: transportCashupPayments.paymentId, cashupId: transportCashupPayments.cashupId }).from(transportCashupPayments).where(and(inArray(transportCashupPayments.paymentId, parsed.paymentIds), ne(transportCashupPayments.cashupId, id))) : [];
      if (conflictingPayments.length) return res.status(409).json({ message: "One or more selected payments were included in another cash-up while this draft was open." });
      const conflictingRefunds = parsed.refundIds.length ? await db.select({ refundId: transportCashupRefunds.refundId, cashupId: transportCashupRefunds.cashupId }).from(transportCashupRefunds).innerJoin(transportCashups, eq(transportCashups.id, transportCashupRefunds.cashupId)).where(and(inArray(transportCashupRefunds.refundId, parsed.refundIds), ne(transportCashupRefunds.cashupId, id), eq(transportCashups.status, "verified"))) : [];
      if (conflictingRefunds.length) return res.status(409).json({ message: "One or more selected refunds were already accounted for by another completed cash-up." });
      const handover = calculateCashupHandover(payments, refunds);
      const expectedCash = handover.cash;
      const expectedNonCash = handover.nonCash;
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(transportCashups).set({
          cashupDate: parsed.cashupDate, expectedCash: String(expectedCash), actualCash: String(expectedCash),
          expectedNonCash: String(expectedNonCash), actualNonCash: String(expectedNonCash),
          variance: "0",
          depositReference: parsed.depositReference || null, notes: parsed.notes || null,
        }).where(and(eq(transportCashups.id, id), eq(transportCashups.status, "draft"))).returning();
        if (!row) throw Object.assign(new Error("Draft changed while you were editing it. Refresh and try again."), { status: 409 });
        await tx.delete(transportCashupPayments).where(eq(transportCashupPayments.cashupId, id));
        await tx.delete(transportCashupRefunds).where(eq(transportCashupRefunds.cashupId, id));
        for (const payment of payments) await tx.insert(transportCashupPayments).values({ cashupId: id, paymentId: payment.id });
        for (const refund of refunds) await tx.insert(transportCashupRefunds).values({ cashupId: id, refundId: refund.id });
        await writeAudit(tx, school.id, user.id, "cashup", id, "edit_draft", schoolCashupView(previous), schoolCashupView(row), null, { paymentIds: parsed.paymentIds, refundIds: parsed.refundIds });
        return row;
      });
      return res.json(schoolCashupView(updated));
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/cashups/:id/discard", requireAuth, requireAnyPermission("transport.cashups.prepare", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const previous = await assertSchoolRecord(transportCashups, id, school.id);
      if (!previous || previous.status !== "draft") return res.status(409).json({ message: "Only a draft cash-up can be discarded" });
      if (previous.cashierUserId !== user.id) return res.status(403).json({ message: "Only the Receptionist/cashier who prepared this draft can discard it" });
      const reason = z.object({ reason: z.string().trim().min(3).default("Draft discarded before submission") }).parse(req.body || {}).reason;
      const discarded = await db.transaction(async (tx) => {
        await tx.delete(transportCashupPayments).where(eq(transportCashupPayments.cashupId, id));
        await tx.delete(transportCashupRefunds).where(eq(transportCashupRefunds.cashupId, id));
        const [row] = await tx.update(transportCashups).set({ status: "discarded", notes: previous.notes ? `${previous.notes}\n[Discarded] ${reason}` : `[Discarded] ${reason}` }).where(eq(transportCashups.id, id)).returning();
        await writeAudit(tx, school.id, user.id, "cashup", id, "discard_draft", schoolCashupView(previous), schoolCashupView(row), reason);
        return row;
      });
      return res.json(schoolCashupView(discarded));
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/cashups/:id/detail", requireAuth, requireAnyPermission("transport.cashups.view", "transport.cashups.prepare", "transport.cashups.verify", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const cashup = await assertSchoolRecord(transportCashups, Number(req.params.id), school.id);
      if (!cashup) return res.status(404).json({ message: "Cash-up not found" });
      const linkedPayments = await db.execute(sql`
        SELECT p.id, p.receipt_no AS "receiptNo", p.payment_date AS "paymentDate", p.payment_method AS "paymentMethod", p.amount::text,
               s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo"
        FROM transport_cashup_payments cp
        JOIN transport_payments p ON p.id=cp.payment_id
        LEFT JOIN students s ON s.id=p.student_id
        WHERE cp.cashup_id=${cashup.id}
        ORDER BY p.payment_date, p.receipt_no
      `);
      const linkedRefunds = await db.execute(sql`
        SELECT r.id, r.refund_number AS "refundNumber", r.method, r.amount::text, r.effective_date AS "effectiveDate",
               s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo"
        FROM transport_cashup_refunds cr
        JOIN transport_refunds r ON r.id=cr.refund_id
        LEFT JOIN students s ON s.id=r.student_id
        WHERE cr.cashup_id=${cashup.id}
        ORDER BY r.effective_date, r.refund_number
      `);
      const uncheckedPayments = await db.execute(sql`
        SELECT p.id, p.receipt_no AS "receiptNo", p.payment_date AS "paymentDate", p.payment_method AS "paymentMethod", p.amount::text,
               s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo"
        FROM transport_payments p
        LEFT JOIN students s ON s.id=p.student_id
        LEFT JOIN transport_cashup_payments cp ON cp.payment_id=p.id
        WHERE p.school_id=${school.id} AND p.payment_date=${cashup.cashupDate} AND p.reversed_at IS NULL AND p.status <> 'reversed'
          AND cp.payment_id IS NULL
        ORDER BY p.receipt_no
      `);
      const signatures = await db.select().from(electronicSignatures)
        .where(and(eq(electronicSignatures.entityType, "transport_cashup"), eq(electronicSignatures.entityId, cashup.id)))
        .orderBy(asc(electronicSignatures.signedAt));
      return res.json({ cashup: schoolCashupView(cashup), linkedPayments: linkedPayments.rows, linkedRefunds: linkedRefunds.rows, uncheckedPayments: uncheckedPayments.rows, signatures });
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/cashups/:id/submit", requireAuth, requireAnyPermission("transport.cashups.prepare", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const { password } = cashupSignInput.parse(req.body);
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportCashups, id, school.id);
      if (!previous) return res.status(404).json({ message: "Cash-up not found" });
      if (previous.status !== "draft") return res.status(409).json({ message: "Only a draft cash-up can be submitted" });
      if (previous.cashierUserId !== user.id) return res.status(403).json({ message: "Only the Receptionist/cashier who prepared this cash-up can submit and sign it" });
      const invalidPayments = await db.execute(sql`
        SELECT p.receipt_no AS "receiptNo"
        FROM transport_cashup_payments cp
        JOIN transport_payments p ON p.id=cp.payment_id
        WHERE cp.cashup_id=${id}
          AND (p.school_id<>${school.id} OR p.reversed_at IS NOT NULL OR p.status='reversed')
      `);
      const invalidRefunds = await db.execute(sql`
        SELECT r.refund_number AS "refundNumber"
        FROM transport_cashup_refunds cr
        JOIN transport_refunds r ON r.id=cr.refund_id
        WHERE cr.cashup_id=${id}
          AND (r.school_id<>${school.id} OR r.status<>'paid' OR r.method='credit')
      `);
      if (invalidPayments.rows.length || invalidRefunds.rows.length) return res.status(409).json({
        message: "This draft contains receipts or refunds whose financial state changed after the draft was prepared. Reopen and edit the draft before submitting.",
        invalidReceipts: invalidPayments.rows, invalidRefunds: invalidRefunds.rows,
      });
      const linkedCount = await db.execute(sql`SELECT (SELECT COUNT(*) FROM transport_cashup_payments WHERE cashup_id=${id}) + (SELECT COUNT(*) FROM transport_cashup_refunds WHERE cashup_id=${id}) AS count`);
      if (Number((linkedCount.rows[0] as any)?.count || 0) === 0) return res.status(409).json({ message: "This draft no longer contains any receipts or paid refunds. Reopen and edit it before submitting." });
      const signature = await preparedElectronicSignature(
        user.id, password, "transport_cashup", id, "receptionist",
        `I confirm that I handed over the system-calculated amounts recorded on cash-up ${previous.cashupNumber}.`,
        { systemCash: previous.actualCash, systemNonCash: previous.actualNonCash, cashupNumber: previous.cashupNumber }
      );
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(transportCashups).set({ status: "submitted", submittedAt: new Date() }).where(eq(transportCashups.id, id)).returning();
        await tx.insert(electronicSignatures).values(signature);
        await writeAudit(tx, school.id, user.id, "cashup", id, "submit_and_sign", schoolCashupView(previous), schoolCashupView(row));
        return row;
      });
      return res.json(schoolCashupView(updated));
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/cashups/:id/flag-discrepancy", requireAuth, requireAnyPermission("transport.cashups.verify", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = cashupDiscrepancyInput.parse(req.body);
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportCashups, id, school.id);
      if (!previous || previous.status !== "submitted") return res.status(409).json({ message: "Only submitted cash-ups can be flagged for discrepancy" });
      if (previous.cashierUserId === user.id) return res.status(409).json({ message: "The person who prepared the cash-up cannot perform Accounts verification actions on the same cash-up" });
      const signature = await preparedElectronicSignature(
        user.id, parsed.password, "transport_cashup", id, "accounts_clerk",
        `I flag a discrepancy requiring investigation on cash-up ${previous.cashupNumber}.`,
        { discrepancyReason: parsed.discrepancyReason, cashupNumber: previous.cashupNumber },
      );
      const [row] = await db.transaction(async (tx) => {
        const [updated] = await tx.update(transportCashups).set({
          accountsVerificationNotes: parsed.notes || null,
          accountsDiscrepancyReason: parsed.discrepancyReason,
        }).where(and(eq(transportCashups.id, id), eq(transportCashups.status, "submitted"))).returning();
        if (!updated) throw Object.assign(new Error("Cash-up changed while the discrepancy was being recorded. Refresh and try again."), { status: 409 });
        await tx.insert(electronicSignatures).values(signature);
        await writeAudit(tx, school.id, user.id, "cashup", id, "accounts_flag_discrepancy", schoolCashupView(previous), schoolCashupView(updated), parsed.discrepancyReason);
        return [updated];
      });
      return res.json({ ...schoolCashupView(row), discrepancyFlagged: true });
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/cashups/:id/verify", requireAuth, requireAnyPermission("transport.cashups.verify", "transport.edit"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = cashupVerifyInput.parse(req.body);
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportCashups, id, school.id);
      if (!previous || previous.status !== "submitted") return res.status(409).json({ message: "Only submitted cash-ups can be verified" });
      if (previous.cashierUserId === user.id) return res.status(409).json({ message: "The person who prepared the cash-up cannot verify the same cash-up" });

      const invalidPayments = await db.execute(sql`
        SELECT p.receipt_no AS "receiptNo"
        FROM transport_cashup_payments cp
        JOIN transport_payments p ON p.id=cp.payment_id
        WHERE cp.cashup_id=${id}
          AND (p.school_id<>${school.id} OR p.reversed_at IS NOT NULL OR p.status='reversed')
      `);
      const invalidRefunds = await db.execute(sql`
        SELECT r.refund_number AS "refundNumber"
        FROM transport_cashup_refunds cr
        JOIN transport_refunds r ON r.id=cr.refund_id
        WHERE cr.cashup_id=${id}
          AND (r.school_id<>${school.id} OR r.status<>'paid' OR r.method='credit')
      `);
      const unchecked = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM transport_payments p LEFT JOIN transport_cashup_payments cp ON cp.payment_id=p.id
        WHERE p.school_id=${school.id} AND p.payment_date=${previous.cashupDate} AND p.reversed_at IS NULL AND p.status <> 'reversed' AND cp.payment_id IS NULL
      `);
      const uncheckedCount = Number((unchecked.rows[0] as any)?.count || 0);
      if (invalidPayments.rows.length || invalidRefunds.rows.length || uncheckedCount > 0) {
        return res.status(409).json({
          message: "This cash-up cannot be verified because its transaction set no longer reconciles cleanly. Use Flag Discrepancy so the issue is investigated without substituting financial amounts.",
          invalidReceipts: invalidPayments.rows,
          invalidRefunds: invalidRefunds.rows,
          uncheckedCount,
        });
      }

      const signature = await preparedElectronicSignature(
        user.id, parsed.password, "transport_cashup", id, "accounts_clerk",
        `I confirm the handover against the system-calculated amounts recorded for cash-up ${previous.cashupNumber}.`,
        { systemCash: previous.actualCash, systemNonCash: previous.actualNonCash, cashupNumber: previous.cashupNumber },
      );
      const updated = await db.transaction(async (tx) => {
        const linkedRefundRows = await tx.execute(sql`
          SELECT r.id, r.accounted_cashup_id AS "accountedCashupId"
          FROM transport_cashup_refunds cr
          JOIN transport_refunds r ON r.id=cr.refund_id
          WHERE cr.cashup_id=${id}
          FOR UPDATE OF r
        `);
        const conflictingRefund = (linkedRefundRows.rows as any[]).find((item) => item.accountedCashupId && Number(item.accountedCashupId) !== id);
        if (conflictingRefund) {
          const conflict: any = new Error("One or more paid refunds were already accounted for by another completed cash-up. Use Flag Discrepancy and investigate before verification.");
          conflict.status = 409;
          throw conflict;
        }
        const refundIds = (linkedRefundRows.rows as any[]).map((item) => Number(item.id));
        if (refundIds.length) {
          const legacyCompletedLinks = await tx.select({ refundId: transportCashupRefunds.refundId, cashupId: transportCashupRefunds.cashupId })
            .from(transportCashupRefunds)
            .innerJoin(transportCashups, eq(transportCashups.id, transportCashupRefunds.cashupId))
            .where(and(inArray(transportCashupRefunds.refundId, refundIds), eq(transportCashups.status, "verified"), ne(transportCashups.id, id)));
          if (legacyCompletedLinks.length) {
            const conflict: any = new Error("One or more paid refunds were already accounted for by another completed cash-up. Use Flag Discrepancy and investigate before verification.");
            conflict.status = 409;
            throw conflict;
          }
          await tx.update(transportRefunds).set({ accountedCashupId: id, accountedAt: new Date() })
            .where(and(inArray(transportRefunds.id, refundIds), isNull(transportRefunds.accountedCashupId)));
        }

        const [row] = await tx.update(transportCashups).set({
          status: "verified",
          // Historical compatibility columns remain, but Accounts cannot enter substitute values.
          accountsReceivedCash: String(previous.actualCash),
          accountsReceivedNonCash: String(previous.actualNonCash),
          accountsVerificationNotes: parsed.notes,
          accountsDiscrepancyReason: null,
          verifiedAt: new Date(), verifiedByUserId: user.id,
        }).where(and(eq(transportCashups.id, id), eq(transportCashups.status, "submitted"))).returning();
        if (!row) throw Object.assign(new Error("Cash-up changed while verification was in progress. Refresh and try again."), { status: 409 });
        await tx.insert(electronicSignatures).values(signature);
        const linked = await tx.select({ paymentId: transportCashupPayments.paymentId }).from(transportCashupPayments).where(eq(transportCashupPayments.cashupId, id));
        if (linked.length) await tx.update(transportPayments).set({ verificationStatus: "reconciled", reconciledAt: new Date(), reconciledByUserId: user.id }).where(inArray(transportPayments.id, linked.map((item) => item.paymentId)));
        await writeAudit(tx, school.id, user.id, "cashup", id, "accounts_verify_and_sign", schoolCashupView(previous), schoolCashupView(row), null, { uncheckedCount });
        return row;
      });
      return res.json(schoolCashupView(updated));
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
        FROM transport_cashup_payments cp JOIN transport_payments p ON p.id=cp.payment_id LEFT JOIN students s ON s.id=p.student_id
        WHERE cp.cashup_id=${cashup.id} ORDER BY p.payment_date, p.receipt_no
      `);
      const signatures = await db.select().from(electronicSignatures)
        .where(and(eq(electronicSignatures.entityType, "transport_cashup"), eq(electronicSignatures.entityId, cashup.id)));
      const receptionist = signatures.find((row) => row.signatureRole === "receptionist");
      const accounts = signatures.find((row) => row.signatureRole === "accounts_clerk");
      const paymentRows = payments.rows.map((payment: any) => `<tr><td>${escapeHtml(payment.receiptNo)}</td><td>${escapeHtml(`${payment.firstName || ""} ${payment.lastName || ""}`.trim())}<div class="small">${escapeHtml(payment.admissionNo || "")}</div></td><td>${escapeHtml(payment.paymentDate)}</td><td>${escapeHtml(String(payment.paymentMethod || "").replaceAll("_", " "))}</td><td>USD ${amount(payment.amount).toFixed(2)}</td></tr>`).join("");
      const signatureBlock = (row: any, label: string) => row
        ? `<div class="signature"><b>${escapeHtml(label)}</b><div class="signline"><img src="${row.signatureSnapshot}" alt="signature"/><div><strong>${escapeHtml(row.signerName)}</strong><br/><span>${escapeHtml(new Date(row.signedAt).toLocaleString("en-ZW", { timeZone: "Africa/Harare" }))}</span></div></div></div>`
        : `<div class="signature"><b>${escapeHtml(label)}</b><div class="unsigned">Not yet signed</div></div>`;
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(cashup.cashupNumber)}</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;color:#111}h1,h2{text-align:center;margin:0 0 8px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;border:1px solid #bbb;padding:12px;margin:16px 0}.totals{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:15px 0}.box{border:1px solid #bbb;padding:10px}.box b{display:block;font-size:11px;color:#555}.box span{font-size:17px;font-weight:bold}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #bbb;padding:7px;text-align:left}th{background:#eee}.small{font-size:9px;color:#555}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:32px}.signature{border:1px solid #bbb;padding:10px;min-height:115px}.signline{display:grid;grid-template-columns:150px 1fr;gap:12px;align-items:center;margin-top:8px}.signline img{max-width:145px;max-height:70px}.signline span,.unsigned{font-size:10px;color:#555}</style></head><body><h1>${escapeHtml(school.name)}</h1><h2>TRANSPORT DAILY CASH HANDOVER & ACKNOWLEDGEMENT</h2><div class="meta"><div><b>Cash-up:</b> ${escapeHtml(cashup.cashupNumber)}</div><div><b>Status:</b> ${escapeHtml(cashup.status)}</div><div><b>Cash-up date:</b> ${escapeHtml(cashup.cashupDate)}</div><div><b>Reference:</b> ${escapeHtml(cashup.depositReference || "—")}</div></div><div class="totals"><div class="box"><b>System-calculated handover</b><span>USD ${rounded(amount(cashup.actualCash)+amount(cashup.actualNonCash)).toFixed(2)}</span></div><div class="box"><b>Accounts verification</b><span>${cashup.verifiedAt ? `Verified · USD ${rounded(amount(cashup.actualCash)+amount(cashup.actualNonCash)).toFixed(2)}` : cashup.accountsDiscrepancyReason ? "Discrepancy flagged" : "Awaiting verification"}</span></div></div><table><thead><tr><th>Receipt</th><th>Learner</th><th>Payment date</th><th>Method</th><th>Amount</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="5">No linked payments.</td></tr>'}</tbody></table><p><b>Receptionist notes:</b> ${escapeHtml(cashup.notes || "—")}</p><p><b>Accounts notes:</b> ${escapeHtml(cashup.accountsVerificationNotes || "—")}</p>${cashup.accountsDiscrepancyReason ? `<p><b>Discrepancy:</b> ${escapeHtml(cashup.accountsDiscrepancyReason)}</p>` : ""}<div class="signatures">${signatureBlock(receptionist,"Receptionist acknowledgement")}${signatureBlock(accounts,"Accounts action / signature")}</div></body></html>`;
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
      const vehicle = await assertOrganizationRecord(transportVehicles, parsed.vehicleId, school);
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
      const vehicle = await assertOrganizationRecord(transportVehicles, parsed.vehicleId, school);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

      const activePaths = await db.select().from(transportVehiclePaths).where(and(
        eq(transportVehiclePaths.schoolId, school.id),
        eq(transportVehiclePaths.vehicleId, vehicle.id),
        eq(transportVehiclePaths.status, "active"),
      )).orderBy(desc(transportVehiclePaths.activatedAt), desc(transportVehiclePaths.versionNumber));
      let expectedPath: any = parsed.pathId ? activePaths.find((path) => path.id === parsed.pathId) || null : activePaths.length === 1 ? activePaths[0] : null;
      if (parsed.pathId && !expectedPath) {
        const selectedPath = await assertSchoolRecord(transportVehiclePaths, parsed.pathId, school.id);
        if (!selectedPath || selectedPath.vehicleId !== vehicle.id) return res.status(400).json({ message: "The selected path is not assigned to this vehicle." });
        expectedPath = selectedPath;
      }
      if (!parsed.assignmentOverride && activePaths.length > 1 && !expectedPath) {
        return res.status(400).json({ message: "Select the journey path or direction for this incident." });
      }
      if (parsed.pathTraversal === "reverse" && expectedPath && !expectedPath.isTwoWay) {
        return res.status(400).json({ message: "Reverse traversal is only available on a two-way vehicle path." });
      }

      const occurredAt = new Date(parsed.occurredAt);
      const occurredOn = isoDate(occurredAt);
      const effectiveOwnerId = await effectiveVehicleOwnerId(vehicle, occurredOn);
      const effectiveDriverId = await effectiveOperatingDriverId(vehicle, occurredAt);
      const expected = {
        vehicleId: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        makeModel: vehicle.makeModel,
        ownershipType: vehicle.ownershipType,
        ownerId: effectiveOwnerId,
        driverId: effectiveDriverId,
        routeId: expectedPath?.routeId || null,
        pathId: expectedPath?.id || null,
        pathName: expectedPath?.name || null,
        pathTraversal: parsed.pathTraversal,
      };
      const actual = {
        vehicleId: vehicle.id,
        ownerId: parsed.ownerId ?? effectiveOwnerId ?? null,
        driverId: parsed.driverId ?? effectiveDriverId ?? null,
        routeId: parsed.routeId ?? expectedPath?.routeId ?? null,
        pathId: parsed.pathId ?? expectedPath?.id ?? null,
        pathTraversal: parsed.pathTraversal,
      };
      if (!parsed.assignmentOverride) {
        const mismatched = Number(actual.ownerId || 0) !== Number(expected.ownerId || 0)
          || Number(actual.driverId || 0) !== Number(expected.driverId || 0)
          || Number(actual.routeId || 0) !== Number(expected.routeId || 0)
          || Number(actual.pathId || 0) !== Number(expected.pathId || 0);
        if (mismatched) return res.status(409).json({ message: "The incident context does not match the vehicle's current owner, driver, route and path. Enable the substitute/deviation option and provide a reason." });
      }
      if (actual.ownerId && !(await assertOrganizationRecord(transportOwners, Number(actual.ownerId), school))) return res.status(400).json({ message: "Incident owner was not found" });
      if (actual.driverId && !(await assertOrganizationRecord(transportDrivers, Number(actual.driverId), school))) return res.status(400).json({ message: "Incident driver was not found" });
      if (actual.routeId && !(await assertSchoolRecord(transportRoutes, Number(actual.routeId), school.id))) return res.status(400).json({ message: "Incident route was not found" });

      const incidentValues: any = {
        ...parsed,
        ownerId: actual.ownerId,
        driverId: actual.driverId,
        routeId: actual.routeId,
        pathId: actual.pathId,
        expectedContext: expected,
        actualContext: actual,
        occurredAt,
        latitude: parsed.latitude == null ? null : String(parsed.latitude),
        longitude: parsed.longitude == null ? null : String(parsed.longitude),
        schoolId: school.id,
        incidentNumber: numberCode("INC", school.shortCode, Date.now().toString().slice(-6)),
        reportedByUserId: user.id,
      };
      const [created] = await db.insert(transportIncidents).values(incidentValues).returning();
      await writeAudit(db, school.id, user.id, "incident", created.id, parsed.assignmentOverride ? "report_with_override" : "report", null, created, parsed.overrideReason || created.description);
      return res.status(201).json(created);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/claims/preview", requireAuth, requireAnyPermission("transport.claims.generate", "transport.claims.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req); if (!school) return res.status(400).json({ message: "Select a school" });
      const parsed = claimInput.parse(req.body);
      let vehicleIds: number[] = [];
      if (parsed.allVehicles) {
        const rows = await db.execute(sql`SELECT DISTINCT pa.vehicle_id AS id FROM transport_payment_allocations pa JOIN transport_payments p ON p.id=pa.payment_id WHERE p.school_id=${school.id} AND p.reversed_at IS NULL AND (pa.service_year < ${parsed.serviceYear} OR (pa.service_year=${parsed.serviceYear} AND pa.service_month <= ${parsed.serviceMonth}))`);
        vehicleIds = (rows.rows as any[]).map((row) => Number(row.id)).filter(Boolean);
      } else if (parsed.vehicleId) vehicleIds = [Number(parsed.vehicleId)];
      const previews = [] as any[];
      for (const vehicleId of vehicleIds) {
        const existing = await db.select().from(transportClaims).where(and(eq(transportClaims.schoolId, school.id), eq(transportClaims.vehicleId, vehicleId), eq(transportClaims.serviceYear, parsed.serviceYear), eq(transportClaims.serviceMonth, parsed.serviceMonth)));
        if (existing[0] && existing[0].status !== "draft") {
          previews.push({ vehicleId, vehicleRegistration: (await assertOrganizationRecord(transportVehicles, vehicleId, school))?.registrationNumber || `#${vehicleId}`, frozenClaim: existing[0], eligibleAmount: amount(existing[0].grossAmount), excluded: [] });
          continue;
        }
        const computed = await computeSchoolClaim(school, vehicleId, parsed.serviceYear, parsed.serviceMonth, existing[0]?.id || null);
        previews.push({ vehicleId, vehicleRegistration: computed.vehicle.registrationNumber, eligibleAllocations: computed.candidates.length, eligibleAmount: computed.gross, currentPeriodAmount: computed.currentPeriodAmount, priorPeriodAmount: computed.priorPeriodAmount, deductions: computed.deductions, deductionAmount: computed.deductionAmount, netAmount: computed.net, excluded: computed.excluded });
      }
      return res.json({ serviceYear: parsed.serviceYear, serviceMonth: parsed.serviceMonth, allVehicles: parsed.allVehicles, previews });
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/claims/generate", requireAuth, requireAnyPermission("transport.claims.generate", "transport.create"), async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req); if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const parsed = claimInput.parse(req.body);
      let vehicleIds: number[] = [];
      if (parsed.allVehicles) {
        const rows = await db.execute(sql`SELECT DISTINCT pa.vehicle_id AS id FROM transport_payment_allocations pa JOIN transport_payments p ON p.id=pa.payment_id WHERE p.school_id=${school.id} AND p.reversed_at IS NULL AND (pa.service_year < ${parsed.serviceYear} OR (pa.service_year=${parsed.serviceYear} AND pa.service_month <= ${parsed.serviceMonth}))`);
        vehicleIds = (rows.rows as any[]).map((row) => Number(row.id)).filter(Boolean);
      } else if (parsed.vehicleId) vehicleIds = [Number(parsed.vehicleId)];
      if (!vehicleIds.length) return res.status(409).json({ message: "No vehicles with payment allocations were found for this school and service month." });
      const generated: any[] = []; const skipped: any[] = [];
      for (const vehicleId of vehicleIds) {
        try { const result = await saveSchoolClaim(school, user.id, parsed.serviceYear, parsed.serviceMonth, vehicleId, parsed.notes); generated.push(result.claim); }
        catch (error: any) { if (parsed.allVehicles && Number(error?.status || 400) === 409) skipped.push({ vehicleId, message: error?.message || "No claimable amount" }); else throw error; }
      }
      if (!generated.length) return res.status(409).json({ message: "No claimable vehicle amounts were available.", skipped });
      return res.status(201).json(parsed.allVehicles ? { generated, skipped } : generated[0]);
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/claims/:id/detail", requireAuth, requireAnyPermission("transport.claims.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const claim = await assertSchoolRecord(transportClaims, Number(req.params.id), school.id);
      if (!claim) return res.status(404).json({ message: "Claim not found" });
      const [vehicle, owner, driver, deductions] = await Promise.all([
        assertOrganizationRecord(transportVehicles, claim.vehicleId, school),
        claim.ownerId ? assertOrganizationRecord(transportOwners, claim.ownerId, school) : Promise.resolve(null),
        claim.driverId ? assertOrganizationRecord(transportDrivers, claim.driverId, school) : Promise.resolve(null),
        db.select().from(transportClaimDeductions).where(eq(transportClaimDeductions.claimId, claim.id)).orderBy(asc(transportClaimDeductions.priority)),
      ]);
      const allocations = await db.execute(sql`
        SELECT ca.id, ca.amount::text, p.id AS "paymentId", p.receipt_no AS "receiptNo", p.payment_date AS "paymentDate", p.payment_method AS "paymentMethod", p.amount::text AS "paymentAmount",
          c.service_period_start AS "serviceStart", c.service_period_end AS "serviceEnd", c.month AS "serviceMonth", c.academic_year AS "serviceYear",
          s.id AS "studentId", s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo", cl.class_name AS "className",
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
        ORDER BY s.last_name,s.first_name,p.payment_date,p.receipt_no
      `);
      return res.json({ claim, vehicle, owner, driver, deductions, allocations: allocations.rows });
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/claims/:id/reconcile", requireAuth, async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const permitted = await userHasAnyPermission(user.id, "transport.claims.submit", "transport.claims.verify", "transport.edit");
      if (!permitted) return res.status(403).json({ message: "Missing permission to reconcile provider claims" });
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportClaims, id, school.id);
      if (!previous) return res.status(404).json({ message: "Claim not found" });
      if (!["draft", "disputed"].includes(String(previous.status))) return res.status(409).json({ message: "Only an open school claim can be reconciled" });
      const parsed = claimReconciliationInput.parse(req.body);
      const [updated] = await db.update(transportClaims).set({
        status: parsed.outcome === "disputed" ? "disputed" : "draft",
        manualClaimReference: parsed.manualClaimReference,
        manualClaimDocument: parsed.manualClaimDocument,
        reconciliationStatus: parsed.outcome,
        reconciliationNotes: parsed.notes,
        disputeReason: parsed.outcome === "disputed" ? parsed.disputeReason : null,
        disputeResolution: parsed.outcome === "disputed" ? null : previous.disputeResolution,
        reconciledByUserId: user.id,
        reconciledAt: new Date(),
      }).where(eq(transportClaims.id, id)).returning();
      await writeAudit(db, school.id, user.id, "claim", id, parsed.outcome === "disputed" ? "reconcile_disputed" : "reconcile_matched", previous, updated, parsed.disputeReason || parsed.notes);
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.post("/api/transport/claims/:id/resolve-dispute", requireAuth, async (req, res) => {
    try {
      const school = await schoolContext(req); const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const permitted = await userHasAnyPermission(user.id, "transport.claims.submit", "transport.claims.verify", "transport.edit");
      if (!permitted) return res.status(403).json({ message: "Missing permission to resolve provider claim disputes" });
      const id = Number(req.params.id); const previous = await assertSchoolRecord(transportClaims, id, school.id);
      if (!previous || previous.status !== "disputed") return res.status(409).json({ message: "Only a disputed claim can be resolved" });
      const parsed = claimDisputeResolutionInput.parse(req.body);
      const [updated] = await db.update(transportClaims).set({ status: "draft", reconciliationStatus: "resolved", disputeResolution: parsed.resolution, reconciliationNotes: parsed.notes || previous.reconciliationNotes, reconciledByUserId: user.id, reconciledAt: new Date() }).where(eq(transportClaims.id, id)).returning();
      await writeAudit(db, school.id, user.id, "claim", id, "resolve_dispute", previous, updated, parsed.resolution);
      return res.json(updated);
    } catch (error) { return routeError(res, error); }
  });

  app.get("/api/transport/claims/:id/print", requireAuth, requireAnyPermission("transport.claims.view", "transport.view"), async (req, res) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).send("Select a school");
      const claim = await assertSchoolRecord(transportClaims, Number(req.params.id), school.id);
      if (!claim) return res.status(404).send("Claim not found");
      const [vehicle, owner, driver] = await Promise.all([
        assertOrganizationRecord(transportVehicles, claim.vehicleId, school),
        claim.ownerId ? assertOrganizationRecord(transportOwners, claim.ownerId, school) : Promise.resolve(null),
        claim.driverId ? assertOrganizationRecord(transportDrivers, claim.driverId, school) : Promise.resolve(null),
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
      const { status, reason } = z.object({ status: z.enum(["submitted", "rejected", "cancelled"]), reason: optionalText }).parse(req.body);
      const permission = status === "submitted" ? "transport.claims.submit" : "transport.claims.verify";
      const permitted = await userHasAnyPermission(user.id, permission, "transport.claims.approve", "transport.edit");
      if (!permitted) return res.status(403).json({ message: `Missing permission: ${permission}` });
      if (status === "submitted") {
        if (previous.status !== "draft") return res.status(409).json({ message: `Claim cannot move from ${previous.status} to submitted` });
        if (!["matched", "resolved"].includes(String(previous.reconciliationStatus))) return res.status(409).json({ message: "Compare the provider's manual claim with the system claim and complete reconciliation before submitting to HQ." });
      } else {
        if (!reason?.trim()) return res.status(400).json({ message: "A reason is required" });
        if (!["draft", "disputed", "submitted"].includes(String(previous.status))) return res.status(409).json({ message: `Claim cannot move from ${previous.status} to ${status}` });
      }
      const changes: any = { status };
      if (status === "submitted") changes.submittedAt = new Date();
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
      const vehicle = await assertOrganizationRecord(transportVehicles, claim.vehicleId, school);
      const owner = claim.ownerId ? await assertOrganizationRecord(transportOwners, claim.ownerId, school) : null;
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
