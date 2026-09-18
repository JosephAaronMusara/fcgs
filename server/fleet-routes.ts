import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requireAuth, requireAnyPermission, requirePermission } from "./auth";
import { storage } from "./storage";
import { ensureFleetEnabledForSchool } from "./school-feature-flags";
import {
  activityLogs,
  assetMaintenanceRecords,
  assetCentres,
  assetRegister,
  assetVehicleDetails,
  fleetAllocations,
  fleetComplianceDocuments,
  fleetComponents,
  fleetDriverProfiles,
  fleetDisposalRecommendations,
  fleetFuelTransactions,
  fleetIncidents,
  fleetInspections,
  fleetMaintenanceJobs,
  fleetOdometerReadings,
  fleetTrips,
  fleetVehicleOccupants,
  fleetVehicleProfiles,
  fleetVehicleRequests,
  notifications,
  schools,
  staff,
  students,
  transportDrivers,
  transportRoutes,
  transportServicePoints,
  transportSettings,
  transportVehicles,
} from "@shared/schema";

type AuthedUser = { id: number; role?: string; schoolId?: number | null; organizationId?: number | null; firstName?: string | null; lastName?: string | null };
type FleetScope = { organizationId: number; schoolId: number | null; orgWide: boolean; userId: number };
const userOf = (req: Request) => req.user as AuthedUser;
const optionalText = z.string().trim().optional().nullable();
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateTime = z.coerce.date();
const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().min(0);
const money = z.coerce.number().finite().min(0);

function fail(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected Fleet error";
  const status = /not found/i.test(message) ? 404 : /permission|denied|outside|context/i.test(message) ? 403 : /conflict|unavailable|already|expired|suspended|odometer/i.test(message) ? 409 : 400;
  return res.status(status).json({ message });
}

async function hasPermission(userId: number, code: string) {
  const effective = await storage.getUserEffectivePermissions(userId);
  return effective.some((entry) => entry.permission.code === code && entry.granted);
}

async function scopeOf(req: Request): Promise<FleetScope> {
  const current = userOf(req);
  let organizationId = current.organizationId ?? null;
  let schoolId = current.schoolId ?? null;
  if (!organizationId && schoolId) {
    const [row] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, schoolId)).limit(1);
    organizationId = row?.organizationId ?? null;
  }
  if (!organizationId) throw new Error("Organisation context is required");
  if (current.role === "org_admin") {
    const requestedSchool = req.header("X-School-Id");
    if (requestedSchool) {
      const id = Number(requestedSchool);
      const [row] = await db.select({ id: schools.id }).from(schools).where(and(eq(schools.id, id), eq(schools.organizationId, organizationId))).limit(1);
      if (!row) throw new Error("School is outside your organisation");
      return { organizationId, schoolId: id, orgWide: false, userId: current.id };
    }
    return { organizationId, schoolId: null, orgWide: true, userId: current.id };
  }
  if (!schoolId) throw new Error("School context is required");
  return { organizationId, schoolId, orgWide: false, userId: current.id };
}

function schoolCondition(column: any, scope: FleetScope) {
  return scope.orgWide ? undefined : eq(column, scope.schoolId!);
}

async function currentStaff(userId: number) {
  const [row] = await db.select().from(staff).where(eq(staff.userId, userId)).limit(1);
  return row ?? null;
}

async function logFleet(req: Request, scope: FleetScope, action: string, description: string, targetType?: string, targetId?: number, metadata?: Record<string, unknown>) {
  const u = userOf(req);
  await db.insert(activityLogs).values({
    organizationId: scope.organizationId,
    schoolId: scope.schoolId,
    userId: u.id,
    userName: `${u.firstName || ""} ${u.lastName || ""}`.trim() || null,
    userRole: u.role || null,
    action,
    category: "Fleet Management",
    description,
    targetType: targetType || null,
    targetId: targetId || null,
    metadata: metadata || null,
    ipAddress: req.ip || req.socket.remoteAddress || null,
  }).catch(() => undefined);
}

async function notifyStaff(staffId: number | null | undefined, scope: FleetScope, title: string, message: string, link = "/fleet-management") {
  if (!staffId) return;
  const [person] = await db.select({ userId: staff.userId, schoolId: staff.schoolId }).from(staff).where(eq(staff.id, staffId)).limit(1);
  if (!person?.userId) return;
  await db.insert(notifications).values({
    organizationId: scope.organizationId,
    schoolId: person.schoolId,
    userId: person.userId,
    type: "fleet",
    title,
    message,
    severity: "info",
    channel: "in_app",
    link,
    actorUserId: scope.userId,
  }).catch(() => undefined);
}

async function assertVehicleScope(vehicleId: number, scope: FleetScope) {
  const [row] = await db.select().from(fleetVehicleProfiles).where(and(
    eq(fleetVehicleProfiles.id, vehicleId),
    eq(fleetVehicleProfiles.organizationId, scope.organizationId),
    scope.orgWide ? undefined : eq(fleetVehicleProfiles.schoolId, scope.schoolId!),
  )).limit(1);
  if (!row) throw new Error("Fleet vehicle not found or outside your context");
  return row;
}

async function assertDriverEligible(staffId: number, organizationId: number) {
  const [profile] = await db.select().from(fleetDriverProfiles).where(and(eq(fleetDriverProfiles.staffId, staffId), eq(fleetDriverProfiles.organizationId, organizationId))).limit(1);
  if (!profile) throw new Error("Selected staff member is not an authorised Fleet driver");
  if (profile.status !== "active") throw new Error("Selected Fleet driver is suspended or inactive");
  if (new Date(`${profile.licenceExpiry}T23:59:59`) < new Date()) throw new Error("Selected Fleet driver's licence has expired");
  return profile;
}

async function assertNoTripConflict(vehicleId: number, driverStaffId: number, departureAt: Date | null, returnAt: Date | null, excludeTripId?: number) {
  if (!departureAt || !returnAt) return;
  const rows = await db.select().from(fleetTrips).where(and(
    inArray(fleetTrips.status, ["allocated", "ready", "in_progress"]),
    or(eq(fleetTrips.vehicleId, vehicleId), eq(fleetTrips.driverStaffId, driverStaffId)),
  ));
  const conflict = rows.find((trip) => trip.id !== excludeTripId && trip.plannedDepartureAt && trip.expectedReturnAt && departureAt < trip.expectedReturnAt && returnAt > trip.plannedDepartureAt);
  if (conflict) throw new Error(`Vehicle or driver already has conflicting trip #${conflict.id}`);
}

const registrationNumberInput = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9 ]+$/, "Vehicle registration may contain letters, numbers and spaces only").transform((value) => value.replace(/\s+/g, " ").toUpperCase());
const vehicleIdentityInput = z.object({
  registrationNumber: registrationNumberInput.optional(),
  vin: optionalText,
  engineNumber: optionalText,
  make: optionalText,
  model: optionalText,
  manufactureYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
  colour: optionalText,
  fuelType: optionalText,
  vehicleClass: optionalText,
});
const vehicleProfileFields = z.object({
  baseSchoolId: positiveInt.optional(),
  capacity: positiveInt.default(1),
  allocationType: z.enum(["pool", "staff", "department", "school", "temporary", "student_transport"]).default("pool"),
  custodianStaffId: positiveInt.optional().nullable(),
  primaryDriverStaffId: positiveInt.optional().nullable(),
  currentOdometer: nonNegativeInt.default(0),
  status: z.enum(["available", "allocated", "in_use", "inspection", "service_due", "maintenance", "broken_down", "accident_damaged", "suspended", "disposed"]).default("available"),
  serviceIntervalKm: positiveInt.default(10000),
  serviceIntervalMonths: positiveInt.default(6),
  lastServiceDate: dateText.optional().nullable(),
  lastServiceOdometer: nonNegativeInt.optional().nullable(),
  nextServiceDate: dateText.optional().nullable(),
  nextServiceOdometer: nonNegativeInt.optional().nullable(),
  notes: optionalText,
});
const vehicleCreateInput = vehicleProfileFields.merge(vehicleIdentityInput).extend({ assetId: positiveInt.optional().nullable() }).superRefine((value, ctx) => {
  if (!value.assetId && !value.registrationNumber) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["registrationNumber"], message: "Registration number is required for a new vehicle" });
});
const vehicleUpdateInput = vehicleProfileFields.partial().merge(vehicleIdentityInput.partial());
const transportAvailabilityInput = z.object({
  schoolId: positiveInt,
  capacity: positiveInt,
  linkExistingTransportVehicleId: positiveInt.optional().nullable(),
  driverId: positiveInt.optional().nullable(),
  registrationExpiry: dateText.optional().nullable(),
  insuranceExpiry: dateText.optional().nullable(),
  fitnessExpiry: dateText.optional().nullable(),
  radioLicenceExpiry: dateText.optional().nullable(),
  status: z.enum(["draft", "active", "suspended"]).default("active"),
  notes: optionalText,
});

const coordinateInput = z.coerce.number().finite();
const occupantInput = z.object({
  vehicleId: positiveInt,
  occupantType: z.enum(["student", "staff", "other"]),
  studentId: positiveInt.optional().nullable(),
  staffId: positiveInt.optional().nullable(),
  occupantName: optionalText,
  routeId: positiveInt.optional().nullable(),
  routeName: optionalText,
  serviceType: z.enum(["both", "pickup", "dropoff"]).default("both"),
  sameLocation: z.boolean().default(true),
  pickupServicePointId: positiveInt.optional().nullable(),
  dropoffServicePointId: positiveInt.optional().nullable(),
  pickupName: z.string().trim().min(1),
  pickupAddress: optionalText,
  pickupLandmark: optionalText,
  pickupLatitude: coordinateInput.min(-90).max(90).optional().nullable(),
  pickupLongitude: coordinateInput.min(-180).max(180).optional().nullable(),
  pickupPrivacyClass: z.enum(["private_household", "shared_household", "public_common"]).default("private_household"),
  pickupInstructions: optionalText,
  dropoffName: optionalText,
  dropoffAddress: optionalText,
  dropoffLandmark: optionalText,
  dropoffLatitude: coordinateInput.min(-90).max(90).optional().nullable(),
  dropoffLongitude: coordinateInput.min(-180).max(180).optional().nullable(),
  dropoffPrivacyClass: z.enum(["private_household", "shared_household", "public_common"]).default("private_household"),
  dropoffInstructions: optionalText,
  startDate: dateText,
  endDate: dateText.optional().nullable(),
  notes: optionalText,
}).superRefine((value, ctx) => {
  if (value.occupantType === "student" && !value.studentId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["studentId"], message: "Select a student" });
  if (value.occupantType === "staff" && !value.staffId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["staffId"], message: "Select a staff member" });
  if (value.occupantType === "other" && !value.occupantName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["occupantName"], message: "Enter the occupant name" });
  if (!value.routeId && !value.routeName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["routeId"], message: "Select or enter a route" });
  if (!value.sameLocation && !value.dropoffName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dropoffName"], message: "Enter the drop-off location when it differs from pick-up" });
  if (value.endDate && value.endDate < value.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "End date cannot be before start date" });
});

const driverInput = z.object({
  staffId: positiveInt,
  licenceNumber: z.string().trim().min(1),
  licenceClass: z.string().trim().min(1),
  licenceExpiry: dateText,
  permittedVehicleClasses: z.array(z.string()).default([]),
  defensiveDrivingExpiry: dateText.optional().nullable(),
  status: z.enum(["active", "suspended", "inactive"]).default("active"),
  suspensionReason: optionalText,
  notes: optionalText,
});

const requestInput = z.object({
  requesterStaffId: positiveInt.optional(),
  purpose: z.string().trim().min(1),
  destination: z.string().trim().min(1),
  departureAt: dateTime,
  expectedReturnAt: dateTime,
  passengerCount: positiveInt.default(1),
  vehicleRequirement: z.string().trim().min(1).default("any"),
  driverRequired: z.boolean().default(true),
  specialRequirements: optionalText,
  emergencyOverride: z.boolean().default(false),
  emergencyReason: optionalText,
}).refine((v) => v.expectedReturnAt > v.departureAt, { message: "Expected return must be after departure" });

const tripInput = z.object({
  requestId: positiveInt.optional().nullable(),
  vehicleId: positiveInt,
  driverStaffId: positiveInt,
  purpose: z.string().trim().min(1),
  destination: z.string().trim().min(1),
  plannedDepartureAt: dateTime.optional().nullable(),
  expectedReturnAt: dateTime.optional().nullable(),
  passengerCount: positiveInt.default(1),
  emergencyOverride: z.boolean().default(false),
  notes: optionalText,
});

async function syncTransportCompliance(vehicleId: number, documentType: string, expiryDate: string) {
  const [profile] = await db.select({ transportVehicleId: fleetVehicleProfiles.transportVehicleId }).from(fleetVehicleProfiles).where(eq(fleetVehicleProfiles.id, vehicleId)).limit(1);
  if (!profile?.transportVehicleId) return;
  const updates: any = {};
  if (documentType === "vehicle_licence") updates.registrationExpiry = expiryDate;
  if (documentType === "insurance") updates.insuranceExpiry = expiryDate;
  if (documentType === "certificate_of_fitness") updates.fitnessExpiry = expiryDate;
  if (documentType === "radio_licence") updates.radioLicenceExpiry = expiryDate;
  if (Object.keys(updates).length) await db.update(transportVehicles).set({ ...updates, updatedAt: new Date() }).where(eq(transportVehicles.id, profile.transportVehicleId));
}

async function assertVehicleOperational(vehicle: typeof fleetVehicleProfiles.$inferSelect) {
  if (["maintenance", "broken_down", "accident_damaged", "suspended", "disposed"].includes(vehicle.status)) throw new Error("Vehicle is unavailable for trips");
  const expired = await db.select({ id: fleetComplianceDocuments.id, type: fleetComplianceDocuments.documentType, expiry: fleetComplianceDocuments.expiryDate })
    .from(fleetComplianceDocuments)
    .where(and(eq(fleetComplianceDocuments.vehicleId, vehicle.id), sql`${fleetComplianceDocuments.expiryDate} < current_date`));
  if (expired.length) throw new Error(`Vehicle has expired compliance: ${expired.map((row) => row.type).join(", ")}`);
  if (vehicle.nextServiceOdometer && vehicle.currentOdometer >= vehicle.nextServiceOdometer) throw new Error("Vehicle is due for service by odometer");
  if (vehicle.nextServiceDate && new Date(`${vehicle.nextServiceDate}T23:59:59`) < new Date()) throw new Error("Vehicle is overdue for scheduled service");
}

function normalizedRegistration(value: string | null | undefined) {
  return String(value || "").toUpperCase().replace(/\s+/g, "");
}

async function assertSchoolInOrganisation(schoolId: number, organizationId: number) {
  const [row] = await db.select({ id: schools.id, name: schools.name }).from(schools).where(and(eq(schools.id, schoolId), eq(schools.organizationId, organizationId))).limit(1);
  if (!row) throw new Error("Selected Base/Home school is outside your organisation");
  return row;
}

async function assertTransportDriverForOrganisation(driverId: number | null | undefined, organizationId: number) {
  if (!driverId) return null;
  const [row] = await db.select({ driver: transportDrivers, organizationId: schools.organizationId })
    .from(transportDrivers).innerJoin(schools, eq(schools.id, transportDrivers.schoolId))
    .where(and(eq(transportDrivers.id, driverId), eq(schools.organizationId, organizationId), eq(transportDrivers.isActive, true))).limit(1);
  if (!row) throw new Error("Selected Transport driver is unavailable in your organisation");
  return row.driver;
}

async function assertServicePointInOrganisation(pointId: number | null | undefined, organizationId: number) {
  if (!pointId) return null;
  const [row] = await db.select({ point: transportServicePoints, organizationId: schools.organizationId })
    .from(transportServicePoints).innerJoin(schools, eq(schools.id, transportServicePoints.schoolId))
    .where(and(eq(transportServicePoints.id, pointId), eq(schools.organizationId, organizationId), eq(transportServicePoints.isActive, true))).limit(1);
  if (!row) throw new Error("Selected Pick-Up/Drop-Off Point is unavailable in your organisation");
  return row.point;
}

async function assertStaffInOrganisation(staffId: number | null | undefined, organizationId: number, label: string) {
  if (!staffId) return null;
  const [row] = await db.select({ id: staff.id, schoolId: staff.schoolId }).from(staff).innerJoin(schools, eq(schools.id, staff.schoolId)).where(and(eq(staff.id, staffId), eq(schools.organizationId, organizationId))).limit(1);
  if (!row) throw new Error(`Selected ${label} is outside your organisation`);
  return row;
}

async function assertRegistrationAvailable(registrationNumber: string, organizationId: number, excludeAssetId?: number) {
  const rows = await db.select({ assetId: assetVehicleDetails.assetId, registrationNumber: assetVehicleDetails.registrationNumber })
    .from(assetVehicleDetails)
    .innerJoin(assetRegister, eq(assetRegister.id, assetVehicleDetails.assetId))
    .where(eq(assetRegister.organizationId, organizationId));
  const target = normalizedRegistration(registrationNumber);
  const conflict = rows.find((row) => row.assetId !== excludeAssetId && normalizedRegistration(row.registrationNumber) === target);
  if (conflict) throw new Error(`Vehicle registration ${registrationNumber} is already recorded`);
}

async function vehicleAssetNumber(registrationNumber: string, organizationId: number, schoolId: number | null) {
  const compact = normalizedRegistration(registrationNumber).replace(/[^A-Z0-9]/g, "") || "VEHICLE";
  const base = `VEH-${compact}`.slice(0, 45);
  const rows = await db.select({ assetNumber: assetRegister.assetNumber }).from(assetRegister).where(and(eq(assetRegister.organizationId, organizationId), schoolId == null ? isNull(assetRegister.schoolId) : eq(assetRegister.schoolId, schoolId)));
  if (!rows.some((row) => row.assetNumber === base)) return base;
  let counter = 2;
  while (rows.some((row) => row.assetNumber === `${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

async function assertRouteInScope(routeId: number | null | undefined, scope: FleetScope) {
  if (!routeId) return null;
  const [route] = await db.select().from(transportRoutes).innerJoin(schools, eq(schools.id, transportRoutes.schoolId)).where(and(eq(transportRoutes.id, routeId), eq(schools.organizationId, scope.organizationId))).limit(1);
  if (!route) throw new Error("Selected route is outside your organisation");
  if (!scope.orgWide && route.transport_routes.schoolId !== scope.schoolId) throw new Error("Selected route is outside your school context");
  return route.transport_routes;
}

async function resolveOccupantPerson(input: z.infer<typeof occupantInput>, scope: FleetScope) {
  if (input.occupantType === "student") {
    const [person] = await db.select({ id: students.id, schoolId: students.schoolId, firstName: students.firstName, lastName: students.lastName, organizationId: schools.organizationId })
      .from(students).innerJoin(schools, eq(schools.id, students.schoolId)).where(eq(students.id, input.studentId!)).limit(1);
    if (!person || person.organizationId !== scope.organizationId) throw new Error("Selected student is outside your organisation");
    if (!scope.orgWide && person.schoolId !== scope.schoolId) throw new Error("Selected student is outside your school context");
    return { studentId: person.id, staffId: null, occupantName: `${person.firstName} ${person.lastName}` };
  }
  if (input.occupantType === "staff") {
    const [person] = await db.select({ id: staff.id, schoolId: staff.schoolId, firstName: staff.firstName, lastName: staff.lastName, organizationId: schools.organizationId })
      .from(staff).innerJoin(schools, eq(schools.id, staff.schoolId)).where(eq(staff.id, input.staffId!)).limit(1);
    if (!person || person.organizationId !== scope.organizationId) throw new Error("Selected staff member is outside your organisation");
    if (!scope.orgWide && person.schoolId !== scope.schoolId) throw new Error("Selected staff member is outside your school context");
    return { studentId: null, staffId: person.id, occupantName: `${person.firstName} ${person.lastName}` };
  }
  return { studentId: null, staffId: null, occupantName: input.occupantName!.trim() };
}

function occupantLocationValues(input: z.infer<typeof occupantInput>) {
  const same = input.sameLocation;
  return {
    pickupName: input.pickupName,
    pickupAddress: input.pickupAddress ?? null,
    pickupLandmark: input.pickupLandmark ?? null,
    pickupLatitude: input.pickupLatitude == null ? null : String(input.pickupLatitude),
    pickupLongitude: input.pickupLongitude == null ? null : String(input.pickupLongitude),
    pickupPrivacyClass: input.pickupPrivacyClass,
    pickupInstructions: input.pickupInstructions ?? null,
    dropoffName: same ? input.pickupName : (input.dropoffName ?? null),
    dropoffAddress: same ? (input.pickupAddress ?? null) : (input.dropoffAddress ?? null),
    dropoffLandmark: same ? (input.pickupLandmark ?? null) : (input.dropoffLandmark ?? null),
    dropoffLatitude: same ? (input.pickupLatitude == null ? null : String(input.pickupLatitude)) : (input.dropoffLatitude == null ? null : String(input.dropoffLatitude)),
    dropoffLongitude: same ? (input.pickupLongitude == null ? null : String(input.pickupLongitude)) : (input.dropoffLongitude == null ? null : String(input.dropoffLongitude)),
    dropoffPrivacyClass: same ? input.pickupPrivacyClass : input.dropoffPrivacyClass,
    dropoffInstructions: same ? (input.pickupInstructions ?? null) : (input.dropoffInstructions ?? null),
  };
}

export function registerFleetRoutes(app: Express) {
  app.get("/api/fleet/bootstrap", requireAuth, requirePermission("fleet.view"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const me = await currentStaff(scope.userId);
      const orgSchools = await db.select({ id: schools.id, name: schools.name, shortCode: schools.shortCode }).from(schools).where(eq(schools.organizationId, scope.organizationId)).orderBy(asc(schools.name));
      const allAssetVehicles = await db.select({
        asset: assetRegister,
        details: assetVehicleDetails,
      }).from(assetRegister).leftJoin(assetVehicleDetails, eq(assetVehicleDetails.assetId, assetRegister.id)).where(and(
        eq(assetRegister.organizationId, scope.organizationId),
        eq(assetRegister.assetClass, "vehicle"),
        eq(assetRegister.isActive, true),
      )).orderBy(asc(assetRegister.name));
      const profiles = await db.select().from(fleetVehicleProfiles).where(and(eq(fleetVehicleProfiles.organizationId, scope.organizationId), scope.orgWide ? undefined : eq(fleetVehicleProfiles.schoolId, scope.schoolId!))).orderBy(asc(fleetVehicleProfiles.id));
      const allProfileAssetRows = await db.select({ assetId: fleetVehicleProfiles.assetId }).from(fleetVehicleProfiles).where(eq(fleetVehicleProfiles.organizationId, scope.organizationId));
      const activeFleetAssetIds = new Set(allProfileAssetRows.map((row) => row.assetId));
      const assetById = new Map(allAssetVehicles.map((row) => [row.asset.id, row]));
      const vehicles = profiles.map((profile) => ({ ...profile, ...(assetById.get(profile.assetId) || {}) }));
      const visibleAssetVehicles = scope.orgWide ? allAssetVehicles : allAssetVehicles.filter((row) => row.asset.schoolId === scope.schoolId || row.asset.schoolId == null);
      const availableAssets = visibleAssetVehicles.filter((row) => !activeFleetAssetIds.has(row.asset.id));
      const orgStaff = orgSchools.length
        ? await db.select().from(staff).where(inArray(staff.schoolId, orgSchools.map((row) => row.id))).orderBy(asc(staff.firstName), asc(staff.lastName))
        : [];
      const orgSchoolIds = orgSchools.map((row) => row.id);
      const visibleSchoolIds = scope.orgWide ? orgSchoolIds : [scope.schoolId!];
      const orgStudents = visibleSchoolIds.length
        ? await db.select({ id: students.id, schoolId: students.schoolId, admissionNo: students.admissionNo, firstName: students.firstName, lastName: students.lastName, status: students.status }).from(students).where(inArray(students.schoolId, visibleSchoolIds)).orderBy(asc(students.firstName), asc(students.lastName))
        : [];
      const routeRows = visibleSchoolIds.length
        ? await db.select().from(transportRoutes).where(and(inArray(transportRoutes.schoolId, visibleSchoolIds), eq(transportRoutes.isActive, true))).orderBy(asc(transportRoutes.name))
        : [];
      const transportVehicleRows = orgSchoolIds.length
        ? await db.select().from(transportVehicles).where(inArray(transportVehicles.schoolId, orgSchoolIds)).orderBy(asc(transportVehicles.registrationNumber))
        : [];
      const transportDriverRows = orgSchoolIds.length
        ? await db.select().from(transportDrivers).where(and(inArray(transportDrivers.schoolId, orgSchoolIds), eq(transportDrivers.isActive, true))).orderBy(asc(transportDrivers.firstName), asc(transportDrivers.lastName))
        : [];
      const servicePointRows = orgSchoolIds.length
        ? await db.select({ point: transportServicePoints, originSchoolName: schools.name })
          .from(transportServicePoints).innerJoin(schools, eq(schools.id, transportServicePoints.schoolId))
          .where(and(inArray(transportServicePoints.schoolId, orgSchoolIds), eq(transportServicePoints.isActive, true))).orderBy(asc(transportServicePoints.name))
          .then((rows) => rows.map((row) => ({ ...row.point, originSchoolName: row.originSchoolName })))
        : [];
      const [transportSettingsRow] = scope.schoolId
        ? await db.select().from(transportSettings).where(eq(transportSettings.schoolId, scope.schoolId)).limit(1)
        : [];
      const scopedStaffIds = new Set(orgStaff.map((row) => row.id));
      const driverProfiles = (await db.select().from(fleetDriverProfiles).where(eq(fleetDriverProfiles.organizationId, scope.organizationId)).orderBy(desc(fleetDriverProfiles.id)))
        .filter((profile) => scope.orgWide || scopedStaffIds.has(profile.staffId));
      const drivers = driverProfiles.map((profile) => ({ ...profile, staff: orgStaff.find((s) => s.id === profile.staffId) || null }));
      const whereOrgSchool = (orgCol: any, schoolCol: any) => and(eq(orgCol, scope.organizationId), scope.orgWide ? undefined : eq(schoolCol, scope.schoolId!));
      const [requests, trips, allocations, occupants, fuel, inspections, maintenance, compliance, incidents, components, disposals] = await Promise.all([
        db.select().from(fleetVehicleRequests).where(whereOrgSchool(fleetVehicleRequests.organizationId, fleetVehicleRequests.schoolId)).orderBy(desc(fleetVehicleRequests.createdAt)),
        db.select().from(fleetTrips).where(whereOrgSchool(fleetTrips.organizationId, fleetTrips.schoolId)).orderBy(desc(fleetTrips.createdAt)),
        db.select().from(fleetAllocations).where(whereOrgSchool(fleetAllocations.organizationId, fleetAllocations.schoolId)).orderBy(desc(fleetAllocations.createdAt)),
        db.select().from(fleetVehicleOccupants).where(whereOrgSchool(fleetVehicleOccupants.organizationId, fleetVehicleOccupants.schoolId)).orderBy(asc(fleetVehicleOccupants.vehicleId), asc(fleetVehicleOccupants.occupantName)),
        db.select().from(fleetFuelTransactions).where(whereOrgSchool(fleetFuelTransactions.organizationId, fleetFuelTransactions.schoolId)).orderBy(desc(fleetFuelTransactions.createdAt)),
        db.select().from(fleetInspections).where(whereOrgSchool(fleetInspections.organizationId, fleetInspections.schoolId)).orderBy(desc(fleetInspections.inspectedAt)),
        db.select().from(fleetMaintenanceJobs).where(whereOrgSchool(fleetMaintenanceJobs.organizationId, fleetMaintenanceJobs.schoolId)).orderBy(desc(fleetMaintenanceJobs.createdAt)),
        profiles.length
          ? db.select().from(fleetComplianceDocuments).where(and(eq(fleetComplianceDocuments.organizationId, scope.organizationId), inArray(fleetComplianceDocuments.vehicleId, profiles.map((profile) => profile.id)))).orderBy(asc(fleetComplianceDocuments.expiryDate))
          : Promise.resolve([]),
        db.select().from(fleetIncidents).where(whereOrgSchool(fleetIncidents.organizationId, fleetIncidents.schoolId)).orderBy(desc(fleetIncidents.occurredAt)),
        db.select().from(fleetComponents).where(whereOrgSchool(fleetComponents.organizationId, fleetComponents.schoolId)).orderBy(desc(fleetComponents.createdAt)),
        db.select().from(fleetDisposalRecommendations).where(whereOrgSchool(fleetDisposalRecommendations.organizationId, fleetDisposalRecommendations.schoolId)).orderBy(desc(fleetDisposalRecommendations.createdAt)),
      ]);
      const costs = {
        fuel: fuel.reduce((sum, row) => sum + Number(row.totalCost || 0), 0),
        maintenance: maintenance.reduce((sum, row) => sum + Number(row.actualCost || 0), 0),
        incidents: incidents.reduce((sum, row) => sum + Math.max(0, Number(row.estimatedDamage || 0) - Number(row.amountRecovered || 0)), 0),
        components: components.reduce((sum, row) => sum + Number(row.purchaseCost || 0), 0),
      };
      res.json({ scope, schools: orgSchools, currentStaff: me, staff: orgStaff, students: orgStudents, routes: routeRows, servicePoints: servicePointRows, transportSettings: transportSettingsRow || { savedPointSuggestionRadiusMeters: 50 }, vehicles, availableAssets, transportVehicles: transportVehicleRows, transportDrivers: transportDriverRows, drivers, requests, trips, allocations, occupants, fuel, inspections, maintenance, compliance, incidents, components, disposals, costs });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/vehicles", requireAuth, requirePermission("fleet.vehicles.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const input = vehicleCreateInput.parse(req.body);
      if (input.primaryDriverStaffId) await assertDriverEligible(input.primaryDriverStaffId, scope.organizationId);
      await assertStaffInOrganisation(input.custodianStaffId, scope.organizationId, "custodian");

      const requestedBaseSchoolId = input.baseSchoolId ?? scope.schoolId ?? null;
      let asset: typeof assetRegister.$inferSelect;
      let createdAsset = false;

      if (input.assetId) {
        const [existingAsset] = await db.select().from(assetRegister).where(and(eq(assetRegister.id, input.assetId), eq(assetRegister.organizationId, scope.organizationId), eq(assetRegister.assetClass, "vehicle"))).limit(1);
        if (!existingAsset) throw new Error("Vehicle asset not found");
        if (!scope.orgWide && existingAsset.schoolId && existingAsset.schoolId !== scope.schoolId) throw new Error("Vehicle asset is outside your school context");
        asset = existingAsset;
      } else {
        if (!input.registrationNumber) throw new Error("Registration number is required for a new vehicle");
        const baseSchoolId = requestedBaseSchoolId;
        if (!baseSchoolId) throw new Error("Select a Base/Home school for the vehicle");
        await assertSchoolInOrganisation(baseSchoolId, scope.organizationId);
        await assertRegistrationAvailable(input.registrationNumber, scope.organizationId);
        const assetSchoolId = scope.schoolId ?? baseSchoolId;
        const [centre] = await db.select({ id: assetCentres.id }).from(assetCentres).where(and(eq(assetCentres.organizationId, scope.organizationId), eq(assetCentres.schoolId, assetSchoolId), eq(assetCentres.isActive, true))).limit(1);
        const assetNumber = await vehicleAssetNumber(input.registrationNumber, scope.organizationId, assetSchoolId);
        const vehicleName = [input.make, input.model].filter(Boolean).join(" ").trim() || input.registrationNumber;
        const created = await db.transaction(async (tx) => {
          const [row] = await tx.insert(assetRegister).values({
            organizationId: scope.organizationId,
            schoolId: assetSchoolId,
            owningCentreId: centre?.id ?? null,
            currentCentreId: centre?.id ?? null,
            assetNumber,
            assetClass: "vehicle",
            name: vehicleName,
            acquisitionCost: "0",
            currentValue: "0",
            condition: "good",
            status: "available",
            isActive: true,
            createdByUserId: scope.userId,
          }).returning();
          await tx.insert(assetVehicleDetails).values({
            assetId: row.id,
            registrationNumber: input.registrationNumber,
            vin: input.vin ?? null,
            engineNumber: input.engineNumber ?? null,
            make: input.make ?? null,
            model: input.model ?? null,
            manufactureYear: input.manufactureYear ?? null,
            colour: input.colour ?? null,
            fuelType: input.fuelType ?? null,
            vehicleClass: input.vehicleClass ?? null,
          });
          return row;
        });
        asset = created;
        createdAsset = true;
      }

      const baseSchoolId = input.baseSchoolId ?? asset.schoolId ?? scope.schoolId ?? null;
      if (!baseSchoolId) throw new Error("Select a Base/Home school for the vehicle");
      await assertSchoolInOrganisation(baseSchoolId, scope.organizationId);

      if (input.registrationNumber && !createdAsset) {
        await assertRegistrationAvailable(input.registrationNumber, scope.organizationId, asset.id);
        await db.insert(assetVehicleDetails).values({
          assetId: asset.id,
          registrationNumber: input.registrationNumber,
          vin: input.vin ?? null,
          engineNumber: input.engineNumber ?? null,
          make: input.make ?? null,
          model: input.model ?? null,
          manufactureYear: input.manufactureYear ?? null,
          colour: input.colour ?? null,
          fuelType: input.fuelType ?? null,
          vehicleClass: input.vehicleClass ?? null,
        }).onConflictDoUpdate({ target: assetVehicleDetails.assetId, set: {
          registrationNumber: input.registrationNumber,
          vin: input.vin ?? undefined,
          engineNumber: input.engineNumber ?? undefined,
          make: input.make ?? undefined,
          model: input.model ?? undefined,
          manufactureYear: input.manufactureYear ?? undefined,
          colour: input.colour ?? undefined,
          fuelType: input.fuelType ?? undefined,
          vehicleClass: input.vehicleClass ?? undefined,
          updatedAt: new Date(),
        }});
      }

      const [created] = await db.insert(fleetVehicleProfiles).values({
        organizationId: scope.organizationId,
        schoolId: baseSchoolId,
        baseSchoolId,
        assetId: asset.id,
        transportVehicleId: null,
        capacity: input.capacity,
        allocationType: input.allocationType,
        custodianStaffId: input.custodianStaffId ?? null,
        primaryDriverStaffId: input.primaryDriverStaffId ?? null,
        currentOdometer: input.currentOdometer,
        status: input.status,
        serviceIntervalKm: input.serviceIntervalKm,
        serviceIntervalMonths: input.serviceIntervalMonths,
        lastServiceDate: input.lastServiceDate ?? null,
        lastServiceOdometer: input.lastServiceOdometer ?? null,
        nextServiceDate: input.nextServiceDate ?? null,
        nextServiceOdometer: input.nextServiceOdometer ?? null,
        notes: input.notes ?? null,
        createdByUserId: scope.userId,
      }).returning();
      await ensureFleetEnabledForSchool(baseSchoolId);
      await logFleet(req, scope, createdAsset ? "fleet_vehicle_registered" : "fleet_vehicle_activated", `${createdAsset ? "Registered" : "Activated"} vehicle asset ${asset.assetNumber} for Fleet Management`, "fleet_vehicle", created.id, { assetId: asset.id, baseSchoolId });
      res.status(201).json(created);
    } catch (error) { fail(res, error); }
  });

  app.put("/api/fleet/vehicles/:id", requireAuth, requirePermission("fleet.vehicles.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const id = Number(req.params.id);
      const vehicle = await assertVehicleScope(id, scope);
      const input = vehicleUpdateInput.parse(req.body);
      const nextBaseSchoolId = input.baseSchoolId ?? vehicle.baseSchoolId ?? vehicle.schoolId;
      if (!nextBaseSchoolId) throw new Error("Select a Base/Home school for the vehicle");
      await assertSchoolInOrganisation(nextBaseSchoolId, scope.organizationId);
      if (input.primaryDriverStaffId) await assertDriverEligible(input.primaryDriverStaffId, scope.organizationId);
      await assertStaffInOrganisation(input.custodianStaffId, scope.organizationId, "custodian");
      if (input.registrationNumber) await assertRegistrationAvailable(input.registrationNumber, scope.organizationId, vehicle.assetId);

      const identityUpdate = {
        registrationNumber: input.registrationNumber,
        vin: input.vin,
        engineNumber: input.engineNumber,
        make: input.make,
        model: input.model,
        manufactureYear: input.manufactureYear,
        colour: input.colour,
        fuelType: input.fuelType,
        vehicleClass: input.vehicleClass,
      };
      const hasIdentityUpdate = Object.values(identityUpdate).some((value) => value !== undefined);
      const profileUpdate: any = {};
      for (const key of ["baseSchoolId", "capacity", "allocationType", "custodianStaffId", "primaryDriverStaffId", "currentOdometer", "status", "serviceIntervalKm", "serviceIntervalMonths", "lastServiceDate", "lastServiceOdometer", "nextServiceDate", "nextServiceOdometer", "notes"] as const) {
        if (input[key] !== undefined) profileUpdate[key] = input[key];
      }
      if (input.baseSchoolId !== undefined) profileUpdate.schoolId = input.baseSchoolId;
      profileUpdate.updatedAt = new Date();

      const row = await db.transaction(async (tx) => {
        if (hasIdentityUpdate) {
          const cleanIdentityUpdate = Object.fromEntries(Object.entries(identityUpdate).filter(([, value]) => value !== undefined));
          await tx.insert(assetVehicleDetails).values({ assetId: vehicle.assetId, ...cleanIdentityUpdate }).onConflictDoUpdate({ target: assetVehicleDetails.assetId, set: { ...cleanIdentityUpdate, updatedAt: new Date() } });
          const [details] = await tx.select().from(assetVehicleDetails).where(eq(assetVehicleDetails.assetId, vehicle.assetId)).limit(1);
          const [asset] = await tx.select().from(assetRegister).where(eq(assetRegister.id, vehicle.assetId)).limit(1);
          if (input.make !== undefined || input.model !== undefined) {
            const nextName = [details?.make, details?.model].filter(Boolean).join(" ").trim() || details?.registrationNumber || asset?.name;
            if (nextName) await tx.update(assetRegister).set({ name: nextName, updatedAt: new Date() }).where(eq(assetRegister.id, vehicle.assetId));
          }
          if (vehicle.transportVehicleId) {
            const [linkedTransport] = await tx.select().from(transportVehicles).where(eq(transportVehicles.id, vehicle.transportVehicleId)).limit(1);
            if (linkedTransport) {
              const transportUpdate: any = {};
              if (input.registrationNumber !== undefined && details?.registrationNumber) {
                const orgSchoolIds = (await tx.select({ id: schools.id }).from(schools).where(eq(schools.organizationId, scope.organizationId))).map((row) => row.id);
                const orgVehicles = orgSchoolIds.length ? await tx.select({ id: transportVehicles.id, registrationNumber: transportVehicles.registrationNumber }).from(transportVehicles).where(inArray(transportVehicles.schoolId, orgSchoolIds)) : [];
                const duplicate = orgVehicles.find((row) => row.id !== linkedTransport.id && normalizedRegistration(row.registrationNumber) === normalizedRegistration(details.registrationNumber));
                if (duplicate) throw new Error(`Transport already has ${details.registrationNumber} in this organisation`);
                transportUpdate.registrationNumber = details.registrationNumber;
              }
              if (input.make !== undefined || input.model !== undefined) transportUpdate.makeModel = [details?.make, details?.model].filter(Boolean).join(" ").trim() || asset?.name || linkedTransport.makeModel;
              if (Object.keys(transportUpdate).length) await tx.update(transportVehicles).set({ ...transportUpdate, updatedAt: new Date() }).where(eq(transportVehicles.id, linkedTransport.id));
            }
          }
        }
        const [updated] = await tx.update(fleetVehicleProfiles).set(profileUpdate).where(eq(fleetVehicleProfiles.id, id)).returning();
        return updated;
      });
      if (row?.schoolId) await ensureFleetEnabledForSchool(row.schoolId);
      await logFleet(req, scope, "fleet_vehicle_updated", `Updated Fleet vehicle #${id}`, "fleet_vehicle", id);
      res.json(row);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/vehicles/:id/make-available-in-transport", requireAuth, requirePermission("fleet.vehicles.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid Fleet vehicle");
      const vehicle = await assertVehicleScope(id, scope);
      const input = transportAvailabilityInput.parse(req.body);
      await assertSchoolInOrganisation(input.schoolId, scope.organizationId);
      await assertTransportDriverForOrganisation(input.driverId, scope.organizationId);

      if (vehicle.transportVehicleId) {
        const [existingLink] = await db.select().from(transportVehicles).where(eq(transportVehicles.id, vehicle.transportVehicleId)).limit(1);
        return res.json({ alreadyAvailable: true, transportVehicle: existingLink ?? { id: vehicle.transportVehicleId } });
      }

      const [assetRow] = await db.select({ asset: assetRegister, details: assetVehicleDetails }).from(assetRegister)
        .leftJoin(assetVehicleDetails, eq(assetVehicleDetails.assetId, assetRegister.id))
        .where(and(eq(assetRegister.id, vehicle.assetId), eq(assetRegister.organizationId, scope.organizationId))).limit(1);
      if (!assetRow?.asset) throw new Error("Linked vehicle asset was not found");
      const registrationNumber = registrationNumberInput.parse(assetRow.details?.registrationNumber || "");
      const makeModel = [assetRow.details?.make, assetRow.details?.model].filter(Boolean).join(" ").trim() || assetRow.asset.name || registrationNumber;

      const orgSchoolIds = (await db.select({ id: schools.id }).from(schools).where(eq(schools.organizationId, scope.organizationId))).map((row) => row.id);
      const existingInOrganisation = orgSchoolIds.length ? await db.select().from(transportVehicles).where(inArray(transportVehicles.schoolId, orgSchoolIds)) : [];
      const duplicate = existingInOrganisation.find((row) => normalizedRegistration(row.registrationNumber) === normalizedRegistration(registrationNumber));
      let transportVehicle: typeof transportVehicles.$inferSelect;

      if (duplicate) {
        if (Number(input.linkExistingTransportVehicleId || 0) !== duplicate.id) {
          throw new Error(`Transport already has ${registrationNumber} in this organisation. Choose the existing record to link it instead of creating a duplicate.`);
        }
        const [alreadyLinked] = await db.select({ id: fleetVehicleProfiles.id }).from(fleetVehicleProfiles).where(eq(fleetVehicleProfiles.transportVehicleId, duplicate.id)).limit(1);
        if (alreadyLinked && alreadyLinked.id !== vehicle.id) throw new Error("That Transport vehicle is already linked to another Fleet vehicle");
        transportVehicle = duplicate;
      } else {
        if (input.linkExistingTransportVehicleId) throw new Error("The selected existing Transport vehicle no longer matches this registration");
        [transportVehicle] = await db.insert(transportVehicles).values({
          schoolId: input.schoolId,
          registrationNumber,
          makeModel,
          capacity: input.capacity,
          ownershipType: "school",
          ownerId: null,
          driverId: input.driverId ?? null,
          registrationExpiry: input.registrationExpiry ?? null,
          insuranceExpiry: input.insuranceExpiry ?? null,
          fitnessExpiry: input.fitnessExpiry ?? null,
          radioLicenceExpiry: input.radioLicenceExpiry ?? null,
          status: input.status,
          isActive: input.status === "active",
          notes: input.notes ?? `FCGS asset ${assetRow.asset.assetNumber} made available to Transport from Fleet Management.`,
        }).returning();
      }

      const [updated] = await db.update(fleetVehicleProfiles).set({ transportVehicleId: transportVehicle.id, updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, vehicle.id)).returning();
      await logFleet(req, scope, duplicate ? "fleet_transport_vehicle_linked" : "fleet_vehicle_made_available_in_transport", `${registrationNumber} is now available in Transport at school #${input.schoolId}`, "fleet_vehicle", vehicle.id, { transportVehicleId: transportVehicle.id, transportSchoolId: input.schoolId, linkedExisting: Boolean(duplicate) });
      return res.status(duplicate ? 200 : 201).json({ fleetVehicle: updated, transportVehicle, linkedExisting: Boolean(duplicate) });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/occupants", requireAuth, requirePermission("fleet.occupants.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const input = occupantInput.parse(req.body);
      const vehicle = await assertVehicleScope(input.vehicleId, scope);
      const route = await assertRouteInScope(input.routeId, scope);
      const person = await resolveOccupantPerson(input, scope);
      await assertServicePointInOrganisation(input.pickupServicePointId, scope.organizationId);
      await assertServicePointInOrganisation(input.dropoffServicePointId, scope.organizationId);
      const locations = occupantLocationValues(input);
      const [row] = await db.insert(fleetVehicleOccupants).values({
        organizationId: scope.organizationId,
        schoolId: vehicle.schoolId,
        vehicleId: vehicle.id,
        occupantType: input.occupantType,
        studentId: person.studentId,
        staffId: person.staffId,
        occupantName: person.occupantName,
        routeId: route?.id ?? null,
        routeName: route?.name ?? input.routeName ?? null,
        serviceType: input.serviceType,
        sameLocation: input.sameLocation,
        pickupServicePointId: input.pickupServicePointId ?? null,
        dropoffServicePointId: input.sameLocation ? (input.pickupServicePointId ?? null) : (input.dropoffServicePointId ?? null),
        ...locations,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        notes: input.notes ?? null,
        isActive: !input.endDate || input.endDate >= new Date().toISOString().slice(0, 10),
        createdByUserId: scope.userId,
      }).returning();
      await logFleet(req, scope, "fleet_vehicle_occupant_added", `Added ${person.occupantName} as a regular occupant of Fleet vehicle #${vehicle.id}`, "fleet_vehicle_occupant", row.id, { vehicleId: vehicle.id, routeId: route?.id ?? null });
      res.status(201).json(row);
    } catch (error) { fail(res, error); }
  });

  app.put("/api/fleet/occupants/:id", requireAuth, requirePermission("fleet.occupants.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid Fleet occupant record");
      const [existing] = await db.select().from(fleetVehicleOccupants).where(and(eq(fleetVehicleOccupants.id, id), eq(fleetVehicleOccupants.organizationId, scope.organizationId), scope.orgWide ? undefined : eq(fleetVehicleOccupants.schoolId, scope.schoolId!))).limit(1);
      if (!existing) throw new Error("Fleet vehicle occupant not found or outside your context");
      const input = occupantInput.parse(req.body);
      const vehicle = await assertVehicleScope(input.vehicleId, scope);
      const route = await assertRouteInScope(input.routeId, scope);
      const person = await resolveOccupantPerson(input, scope);
      await assertServicePointInOrganisation(input.pickupServicePointId, scope.organizationId);
      await assertServicePointInOrganisation(input.dropoffServicePointId, scope.organizationId);
      const locations = occupantLocationValues(input);
      const [row] = await db.update(fleetVehicleOccupants).set({
        schoolId: vehicle.schoolId,
        vehicleId: vehicle.id,
        occupantType: input.occupantType,
        studentId: person.studentId,
        staffId: person.staffId,
        occupantName: person.occupantName,
        routeId: route?.id ?? null,
        routeName: route?.name ?? input.routeName ?? null,
        serviceType: input.serviceType,
        sameLocation: input.sameLocation,
        pickupServicePointId: input.pickupServicePointId ?? null,
        dropoffServicePointId: input.sameLocation ? (input.pickupServicePointId ?? null) : (input.dropoffServicePointId ?? null),
        ...locations,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        isActive: !input.endDate || input.endDate >= new Date().toISOString().slice(0, 10),
        notes: input.notes ?? null,
        updatedAt: new Date(),
      }).where(eq(fleetVehicleOccupants.id, id)).returning();
      await logFleet(req, scope, "fleet_vehicle_occupant_updated", `Updated regular occupant ${person.occupantName} on Fleet vehicle #${vehicle.id}`, "fleet_vehicle_occupant", id, { vehicleId: vehicle.id, routeId: route?.id ?? null });
      res.json(row);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/occupants/:id/end", requireAuth, requirePermission("fleet.occupants.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid Fleet occupant record");
      const input = z.object({ endDate: dateText.default(() => new Date().toISOString().slice(0, 10)), notes: optionalText }).parse(req.body || {});
      const [existing] = await db.select().from(fleetVehicleOccupants).where(and(eq(fleetVehicleOccupants.id, id), eq(fleetVehicleOccupants.organizationId, scope.organizationId), scope.orgWide ? undefined : eq(fleetVehicleOccupants.schoolId, scope.schoolId!))).limit(1);
      if (!existing) throw new Error("Fleet vehicle occupant not found or outside your context");
      await assertVehicleScope(existing.vehicleId, scope);
      if (input.endDate < existing.startDate) throw new Error("End date cannot be before the occupant start date");
      const [row] = await db.update(fleetVehicleOccupants).set({ endDate: input.endDate, isActive: false, notes: input.notes ?? existing.notes, updatedAt: new Date() }).where(eq(fleetVehicleOccupants.id, id)).returning();
      await logFleet(req, scope, "fleet_vehicle_occupant_ended", `Ended regular occupant ${existing.occupantName || `#${id}`} on Fleet vehicle #${existing.vehicleId}`, "fleet_vehicle_occupant", id, { vehicleId: existing.vehicleId, endDate: input.endDate });
      res.json(row);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/drivers", requireAuth, requirePermission("fleet.drivers.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = driverInput.parse(req.body); const [person] = await db.select().from(staff).where(eq(staff.id, input.staffId)).limit(1); if (!person) throw new Error("Staff member not found"); if (!scope.orgWide && person.schoolId !== scope.schoolId) throw new Error("Staff member is outside your school context"); const [row] = await db.insert(fleetDriverProfiles).values({ ...input, organizationId: scope.organizationId, createdByUserId: scope.userId }).returning(); await logFleet(req, scope, "fleet_driver_authorised", `Authorised ${person.firstName} ${person.lastName} as a Fleet driver`, "staff", person.id); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.put("/api/fleet/drivers/:id", requireAuth, requirePermission("fleet.drivers.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); const [existing] = await db.select().from(fleetDriverProfiles).where(and(eq(fleetDriverProfiles.id, id), eq(fleetDriverProfiles.organizationId, scope.organizationId))).limit(1); if (!existing) throw new Error("Fleet driver not found"); const input = driverInput.omit({ staffId: true }).partial().parse(req.body); const [row] = await db.update(fleetDriverProfiles).set({ ...input, updatedAt: new Date() }).where(eq(fleetDriverProfiles.id, id)).returning(); await logFleet(req, scope, "fleet_driver_updated", `Updated Fleet driver #${id}`, "fleet_driver", id); res.json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/requests", requireAuth, requirePermission("fleet.requests.create"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = requestInput.parse(req.body); const me = await currentStaff(scope.userId); const canManage = await hasPermission(scope.userId, "fleet.requests.manage"); const requesterStaffId = canManage && input.requesterStaffId ? input.requesterStaffId : me?.id; if (!requesterStaffId) throw new Error("A staff record is required to request a vehicle"); if (input.emergencyOverride && !canManage) throw new Error("Emergency override requires Fleet request management permission"); if (input.emergencyOverride && !input.emergencyReason) throw new Error("Emergency reason is required"); const [row] = await db.insert(fleetVehicleRequests).values({ ...input, requesterStaffId, organizationId: scope.organizationId, schoolId: scope.schoolId ?? (await db.select({ schoolId: staff.schoolId }).from(staff).where(eq(staff.id, requesterStaffId)).limit(1))[0]?.schoolId ?? null, status: input.emergencyOverride ? "approved" : "submitted", approvedByUserId: input.emergencyOverride ? scope.userId : null, approvedAt: input.emergencyOverride ? new Date() : null, createdByUserId: scope.userId }).returning(); await logFleet(req, scope, "fleet_request_created", `Created vehicle request #${row.id}`, "fleet_request", row.id); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.put("/api/fleet/requests/:id/status", requireAuth, requirePermission("fleet.requests.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); const input = z.object({ status: z.enum(["approved", "rejected", "cancelled"]), reason: optionalText }).parse(req.body); const [existing] = await db.select().from(fleetVehicleRequests).where(and(eq(fleetVehicleRequests.id, id), eq(fleetVehicleRequests.organizationId, scope.organizationId), scope.orgWide ? undefined : eq(fleetVehicleRequests.schoolId, scope.schoolId!))).limit(1); if (!existing) throw new Error("Fleet request not found"); const [row] = await db.update(fleetVehicleRequests).set({ status: input.status, rejectionReason: input.status === "rejected" ? input.reason : null, approvedByUserId: input.status === "approved" ? scope.userId : existing.approvedByUserId, approvedAt: input.status === "approved" ? new Date() : existing.approvedAt, updatedAt: new Date() }).where(eq(fleetVehicleRequests.id, id)).returning(); await notifyStaff(existing.requesterStaffId, scope, `Fleet request ${input.status}`, input.status === "rejected" ? `Your vehicle request for ${existing.destination} was rejected${input.reason ? `: ${input.reason}` : "."}` : `Your vehicle request for ${existing.destination} was ${input.status}.`); await logFleet(req, scope, `fleet_request_${input.status}`, `${input.status} Fleet request #${id}`, "fleet_request", id); res.json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/trips", requireAuth, requirePermission("fleet.trips.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = tripInput.parse(req.body); const vehicle = await assertVehicleScope(input.vehicleId, scope); await assertVehicleOperational(vehicle); await assertDriverEligible(input.driverStaffId, scope.organizationId); await assertNoTripConflict(input.vehicleId, input.driverStaffId, input.plannedDepartureAt ?? null, input.expectedReturnAt ?? null); const [row] = await db.insert(fleetTrips).values({ ...input, organizationId: scope.organizationId, schoolId: vehicle.schoolId, status: "allocated", createdByUserId: scope.userId }).returning(); if (input.requestId) await db.update(fleetVehicleRequests).set({ status: "allocated", updatedAt: new Date() }).where(eq(fleetVehicleRequests.id, input.requestId)); await notifyStaff(input.driverStaffId, scope, "Fleet trip assigned", `You have been assigned a Fleet trip to ${input.destination}${input.plannedDepartureAt ? ` departing ${input.plannedDepartureAt.toLocaleString()}` : ""}.`); await logFleet(req, scope, "fleet_trip_allocated", `Allocated Fleet trip #${row.id}`, "fleet_trip", row.id); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/trips/:id/start", requireAuth, requireAnyPermission("fleet.trips.drive", "fleet.trips.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); const input = z.object({ odometerKm: nonNegativeInt, checklist: z.record(z.any()).default({}), defects: optionalText }).parse(req.body); const [trip] = await db.select().from(fleetTrips).where(and(eq(fleetTrips.id, id), eq(fleetTrips.organizationId, scope.organizationId))).limit(1); if (!trip) throw new Error("Fleet trip not found"); const vehicle = await assertVehicleScope(trip.vehicleId, scope); const me = await currentStaff(scope.userId); if (!(await hasPermission(scope.userId, "fleet.trips.manage")) && me?.id !== trip.driverStaffId) throw new Error("You may only start your own assigned trip"); if (trip.status !== "allocated" && trip.status !== "ready") throw new Error("Trip is not ready to start"); if (input.odometerKm < vehicle.currentOdometer) throw new Error(`Odometer cannot be lower than current reading ${vehicle.currentOdometer} km`); const failed = Object.values(input.checklist).some((v) => v === false || v === "fail"); if (failed) throw new Error("Pre-trip inspection contains failed safety items; vehicle must be reviewed before departure"); const result = await db.transaction(async (tx) => { await tx.insert(fleetInspections).values({ organizationId: scope.organizationId, schoolId: trip.schoolId, vehicleId: trip.vehicleId, tripId: trip.id, inspectorStaffId: trip.driverStaffId, inspectionType: "pre_trip", odometerKm: input.odometerKm, checklist: input.checklist, result: "pass", defects: input.defects, createdByUserId: scope.userId }); await tx.insert(fleetOdometerReadings).values({ organizationId: scope.organizationId, vehicleId: trip.vehicleId, tripId: trip.id, readingKm: input.odometerKm, readingType: "trip_start", recordedByUserId: scope.userId }); await tx.update(fleetVehicleProfiles).set({ currentOdometer: input.odometerKm, status: "in_use", updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, trip.vehicleId)); const [updated] = await tx.update(fleetTrips).set({ startOdometer: input.odometerKm, actualDepartureAt: new Date(), status: "in_progress", updatedAt: new Date() }).where(eq(fleetTrips.id, id)).returning(); return updated; }); await logFleet(req, scope, "fleet_trip_started", `Started Fleet trip #${id}`, "fleet_trip", id); res.json(result); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/trips/:id/complete", requireAuth, requireAnyPermission("fleet.trips.drive", "fleet.trips.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); const input = z.object({ odometerKm: nonNegativeInt, checklist: z.record(z.any()).default({}), defects: optionalText, notes: optionalText }).parse(req.body); const [trip] = await db.select().from(fleetTrips).where(and(eq(fleetTrips.id, id), eq(fleetTrips.organizationId, scope.organizationId))).limit(1); if (!trip) throw new Error("Fleet trip not found"); if (trip.status !== "in_progress") throw new Error("Trip is not in progress"); const me = await currentStaff(scope.userId); if (!(await hasPermission(scope.userId, "fleet.trips.manage")) && me?.id !== trip.driverStaffId) throw new Error("You may only complete your own assigned trip"); const vehicle = await assertVehicleScope(trip.vehicleId, scope); const floor = Math.max(vehicle.currentOdometer, trip.startOdometer || 0); if (input.odometerKm < floor) throw new Error(`Ending odometer cannot be lower than ${floor} km`); const failed = Object.values(input.checklist).some((v) => v === false || v === "fail") || !!input.defects; const result = await db.transaction(async (tx) => { await tx.insert(fleetInspections).values({ organizationId: scope.organizationId, schoolId: trip.schoolId, vehicleId: trip.vehicleId, tripId: trip.id, inspectorStaffId: trip.driverStaffId, inspectionType: "return", odometerKm: input.odometerKm, checklist: input.checklist, result: failed ? "attention" : "pass", defects: input.defects, createdByUserId: scope.userId }); await tx.insert(fleetOdometerReadings).values({ organizationId: scope.organizationId, vehicleId: trip.vehicleId, tripId: trip.id, readingKm: input.odometerKm, readingType: "trip_end", recordedByUserId: scope.userId }); await tx.update(fleetVehicleProfiles).set({ currentOdometer: input.odometerKm, status: failed ? "inspection" : "available", updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, trip.vehicleId)); const [updated] = await tx.update(fleetTrips).set({ endOdometer: input.odometerKm, distanceKm: input.odometerKm - (trip.startOdometer || input.odometerKm), actualReturnAt: new Date(), status: "completed", notes: input.notes ?? trip.notes, updatedAt: new Date() }).where(eq(fleetTrips.id, id)).returning(); return updated; }); await logFleet(req, scope, "fleet_trip_completed", `Completed Fleet trip #${id}`, "fleet_trip", id); res.json(result); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/allocations", requireAuth, requirePermission("fleet.allocations.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ vehicleId: positiveInt, allocationType: z.enum(["staff", "department", "school", "temporary", "student_transport"]), allocatedToType: z.enum(["staff", "school", "department", "student_transport"]), allocatedToStaffId: positiveInt.optional().nullable(), allocatedToSchoolId: positiveInt.optional().nullable(), allocatedToName: optionalText, primaryDriverStaffId: positiveInt.optional().nullable(), startsAt: dateTime, endsAt: dateTime.optional().nullable(), reason: optionalText }).parse(req.body); const vehicle = await assertVehicleScope(input.vehicleId, scope); if (input.allocatedToSchoolId && input.allocatedToSchoolId !== vehicle.schoolId && !(await hasPermission(scope.userId, "fleet.allocations.cross_school"))) throw new Error("Cross-school allocation permission required"); if (input.primaryDriverStaffId) await assertDriverEligible(input.primaryDriverStaffId, scope.organizationId); const [row] = await db.insert(fleetAllocations).values({ ...input, organizationId: scope.organizationId, schoolId: vehicle.schoolId, status: "active", approvedByUserId: scope.userId, createdByUserId: scope.userId }).returning(); await db.update(fleetVehicleProfiles).set({ allocationType: input.allocationType, custodianStaffId: input.allocatedToStaffId ?? vehicle.custodianStaffId, primaryDriverStaffId: input.primaryDriverStaffId ?? vehicle.primaryDriverStaffId, status: "allocated", updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, vehicle.id)); if (vehicle.schoolId) await ensureFleetEnabledForSchool(vehicle.schoolId); if (input.allocatedToSchoolId) await ensureFleetEnabledForSchool(input.allocatedToSchoolId); if (input.allocatedToStaffId) { const [assignedStaff] = await db.select({ schoolId: staff.schoolId }).from(staff).where(eq(staff.id, input.allocatedToStaffId)).limit(1); if (assignedStaff?.schoolId) await ensureFleetEnabledForSchool(assignedStaff.schoolId); } await logFleet(req, scope, "fleet_allocation_created", `Created standing allocation #${row.id}`, "fleet_allocation", row.id); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/allocations/:id/end", requireAuth, requirePermission("fleet.allocations.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); const input = z.object({ odometerIn: nonNegativeInt.optional(), conditionIn: optionalText }).parse(req.body); const [allocation] = await db.select().from(fleetAllocations).where(and(eq(fleetAllocations.id, id), eq(fleetAllocations.organizationId, scope.organizationId))).limit(1); if (!allocation) throw new Error("Fleet allocation not found"); await assertVehicleScope(allocation.vehicleId, scope); const [row] = await db.update(fleetAllocations).set({ ...input, status: "ended", endsAt: new Date(), updatedAt: new Date() }).where(eq(fleetAllocations.id, id)).returning(); await db.update(fleetVehicleProfiles).set({ allocationType: "pool", status: "available", updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, allocation.vehicleId)); await logFleet(req, scope, "fleet_allocation_ended", `Ended Fleet allocation #${id}`, "fleet_allocation", id); res.json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/odometer", requireAuth, requirePermission("fleet.odometer.record"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ vehicleId: positiveInt, readingKm: nonNegativeInt, readingType: z.enum(["manual", "inspection", "service", "correction"]).default("manual"), notes: optionalText }).parse(req.body); const vehicle = await assertVehicleScope(input.vehicleId, scope); if (input.readingType !== "correction" && input.readingKm < vehicle.currentOdometer) throw new Error(`Odometer cannot be lower than current reading ${vehicle.currentOdometer} km`); const [row] = await db.insert(fleetOdometerReadings).values({ organizationId: scope.organizationId, vehicleId: vehicle.id, readingKm: input.readingKm, readingType: input.readingType, notes: input.notes, recordedByUserId: scope.userId }).returning(); await db.update(fleetVehicleProfiles).set({ currentOdometer: input.readingKm, updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, vehicle.id)); await logFleet(req, scope, "fleet_odometer_recorded", `Recorded ${input.readingKm} km for Fleet vehicle #${vehicle.id}`, "fleet_odometer", row.id); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/inspections", requireAuth, requirePermission("fleet.inspections.perform"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ vehicleId: positiveInt, inspectionType: z.enum(["scheduled", "handover", "spot_check"]), odometerKm: nonNegativeInt.optional().nullable(), checklist: z.record(z.any()).default({}), result: z.enum(["pass", "attention", "fail"]).default("pass"), defects: optionalText }).parse(req.body); const vehicle = await assertVehicleScope(input.vehicleId, scope); const me = await currentStaff(scope.userId); const [row] = await db.insert(fleetInspections).values({ organizationId: scope.organizationId, schoolId: vehicle.schoolId, vehicleId: vehicle.id, inspectorStaffId: me?.id, inspectionType: input.inspectionType, odometerKm: input.odometerKm, checklist: input.checklist, result: input.result, defects: input.defects, createdByUserId: scope.userId }).returning(); if (input.odometerKm != null && input.odometerKm >= vehicle.currentOdometer) { await db.insert(fleetOdometerReadings).values({ organizationId: scope.organizationId, vehicleId: vehicle.id, readingKm: input.odometerKm, readingType: "inspection", recordedByUserId: scope.userId }); await db.update(fleetVehicleProfiles).set({ currentOdometer: input.odometerKm, status: input.result === "fail" ? "suspended" : input.result === "attention" ? "inspection" : vehicle.status, updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, vehicle.id)); } else if (input.result === "fail") await db.update(fleetVehicleProfiles).set({ status: "suspended", updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, vehicle.id)); else if (input.result === "attention") await db.update(fleetVehicleProfiles).set({ status: "inspection", updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, vehicle.id)); await logFleet(req, scope, "fleet_inspection_recorded", `Recorded ${input.inspectionType} inspection for Fleet vehicle #${vehicle.id}`, "fleet_inspection", row.id); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/fuel", requireAuth, requirePermission("fleet.fuel.record"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ vehicleId: positiveInt, tripId: positiveInt.optional().nullable(), driverStaffId: positiveInt.optional().nullable(), transactionDate: dateText, odometerKm: nonNegativeInt, fuelType: z.string().trim().min(1), litres: z.coerce.number().positive(), pricePerLitre: money.default(0), totalCost: money.default(0), supplier: optionalText, paymentMethod: z.string().trim().min(1).default("organisation_account"), receiptReference: optionalText, receiptUrl: optionalText, fullTank: z.boolean().default(false), notes: optionalText }).parse(req.body); const vehicle = await assertVehicleScope(input.vehicleId, scope); if (input.odometerKm < vehicle.currentOdometer) throw new Error(`Fuel odometer cannot be lower than current reading ${vehicle.currentOdometer} km`); const total = input.totalCost || input.litres * input.pricePerLitre; const [row] = await db.insert(fleetFuelTransactions).values({ ...input, totalCost: String(total), litres: String(input.litres), pricePerLitre: String(input.pricePerLitre), organizationId: scope.organizationId, schoolId: vehicle.schoolId, createdByUserId: scope.userId }).returning(); if (input.odometerKm > vehicle.currentOdometer) { await db.insert(fleetOdometerReadings).values({ organizationId: scope.organizationId, vehicleId: vehicle.id, tripId: input.tripId, readingKm: input.odometerKm, readingType: "fuel", recordedByUserId: scope.userId }); await db.update(fleetVehicleProfiles).set({ currentOdometer: input.odometerKm, updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, vehicle.id)); } await logFleet(req, scope, "fleet_fuel_recorded", `Recorded ${input.litres} L fuel for Fleet vehicle #${vehicle.id}`, "fleet_fuel", row.id); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/maintenance", requireAuth, requireAnyPermission("fleet.maintenance.request", "fleet.maintenance.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ vehicleId: positiveInt, jobType: z.enum(["service", "repair", "breakdown", "inspection_followup"]).default("repair"), issueDescription: z.string().trim().min(1), odometerKm: nonNegativeInt.optional().nullable(), priority: z.enum(["low", "normal", "high", "critical"]).default("normal"), serviceProvider: optionalText, estimatedCost: money.default(0), notes: optionalText }).parse(req.body); const vehicle = await assertVehicleScope(input.vehicleId, scope); const [asset] = await db.select().from(assetRegister).where(eq(assetRegister.id, vehicle.assetId)).limit(1); if (!asset) throw new Error("Linked asset not found"); const ref = `FLT-MNT-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`; const result = await db.transaction(async (tx) => { const [assetRecord] = await tx.insert(assetMaintenanceRecords).values({ organizationId: scope.organizationId, schoolId: vehicle.schoolId, centreId: asset.currentCentreId, referenceNumber: ref, assetId: vehicle.assetId, issueDescription: input.issueDescription, serviceProvider: input.serviceProvider, status: "reported", dateReported: new Date().toISOString().slice(0,10), estimatedCost: String(input.estimatedCost), actualCost: "0", notes: input.notes, createdByUserId: scope.userId }).returning(); const [job] = await tx.insert(fleetMaintenanceJobs).values({ ...input, estimatedCost: String(input.estimatedCost), organizationId: scope.organizationId, schoolId: vehicle.schoolId, referenceNumber: ref, assetMaintenanceRecordId: assetRecord.id, status: "reported", createdByUserId: scope.userId }).returning(); if (input.priority === "critical" || input.jobType === "breakdown") await tx.update(fleetVehicleProfiles).set({ status: input.jobType === "breakdown" ? "broken_down" : "maintenance", updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, vehicle.id)); return job; }); await logFleet(req, scope, "fleet_maintenance_created", `Created connected Fleet/Asset maintenance job ${ref}`, "fleet_maintenance", result.id); res.status(201).json(result); } catch (error) { fail(res, error); }
  });

  app.put("/api/fleet/maintenance/:id", requireAuth, requirePermission("fleet.maintenance.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); const input = z.object({ status: z.enum(["reported", "approved", "in_progress", "completed", "cancelled"]).optional(), serviceProvider: optionalText, estimatedCost: money.optional(), actualCost: money.optional(), workCompleted: optionalText, nextServiceDate: dateText.optional().nullable(), nextServiceOdometer: nonNegativeInt.optional().nullable() }).parse(req.body); const [job] = await db.select().from(fleetMaintenanceJobs).where(and(eq(fleetMaintenanceJobs.id, id), eq(fleetMaintenanceJobs.organizationId, scope.organizationId))).limit(1); if (!job) throw new Error("Fleet maintenance job not found"); await assertVehicleScope(job.vehicleId, scope); if (input.status === "approved" && !(await hasPermission(scope.userId, "fleet.maintenance.approve"))) throw new Error("Fleet maintenance approval permission required"); const updates: any = { ...input, updatedAt: new Date() }; if (input.estimatedCost !== undefined) updates.estimatedCost = String(input.estimatedCost); if (input.actualCost !== undefined) updates.actualCost = String(input.actualCost); const [row] = await db.update(fleetMaintenanceJobs).set(updates).where(eq(fleetMaintenanceJobs.id, id)).returning(); if (job.assetMaintenanceRecordId) await db.update(assetMaintenanceRecords).set({ status: input.status || undefined, serviceProvider: input.serviceProvider || undefined, estimatedCost: input.estimatedCost !== undefined ? String(input.estimatedCost) : undefined, actualCost: input.actualCost !== undefined ? String(input.actualCost) : undefined, workCompleted: input.workCompleted || undefined, nextServiceDate: input.nextServiceDate || undefined, updatedAt: new Date() }).where(eq(assetMaintenanceRecords.id, job.assetMaintenanceRecordId)); if (input.status === "completed") { if (!(await hasPermission(scope.userId, "fleet.vehicles.release"))) { await db.update(fleetVehicleProfiles).set({ status: "inspection", updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, job.vehicleId)); } else { await db.update(fleetVehicleProfiles).set({ status: "available", lastServiceDate: new Date().toISOString().slice(0,10), lastServiceOdometer: job.odometerKm, nextServiceDate: input.nextServiceDate, nextServiceOdometer: input.nextServiceOdometer, updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, job.vehicleId)); } } await logFleet(req, scope, "fleet_maintenance_updated", `Updated Fleet maintenance job ${job.referenceNumber}`, "fleet_maintenance", id); res.json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/compliance", requireAuth, requirePermission("fleet.compliance.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ vehicleId: positiveInt, documentType: z.string().trim().min(1), documentNumber: optionalText, issueDate: dateText.optional().nullable(), expiryDate: dateText, issuingAuthority: optionalText, documentUrl: optionalText, verificationStatus: z.enum(["unverified", "verified", "rejected"]).default("unverified"), notes: optionalText }).parse(req.body); await assertVehicleScope(input.vehicleId, scope); const [row] = await db.insert(fleetComplianceDocuments).values({ ...input, organizationId: scope.organizationId, createdByUserId: scope.userId }).returning(); await syncTransportCompliance(input.vehicleId, input.documentType, input.expiryDate); await logFleet(req, scope, "fleet_compliance_recorded", `Recorded ${input.documentType} compliance for vehicle #${input.vehicleId}`, "fleet_compliance", row.id); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/incidents", requireAuth, requirePermission("fleet.incidents.create"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ vehicleId: positiveInt, tripId: positiveInt.optional().nullable(), driverStaffId: positiveInt.optional().nullable(), incidentType: z.enum(["accident", "breakdown", "damage", "tyre_failure", "security", "other"]), occurredAt: dateTime, location: optionalText, description: z.string().trim().min(1), injuriesReported: z.boolean().default(false), policeReportReference: optionalText, insuranceClaimNumber: optionalText, claimStatus: optionalText, estimatedDamage: money.default(0), amountRecovered: money.default(0), notes: optionalText }).parse(req.body); const vehicle = await assertVehicleScope(input.vehicleId, scope); const [row] = await db.insert(fleetIncidents).values({ ...input, estimatedDamage: String(input.estimatedDamage), amountRecovered: String(input.amountRecovered), organizationId: scope.organizationId, schoolId: vehicle.schoolId, createdByUserId: scope.userId }).returning(); if (["accident", "breakdown"].includes(input.incidentType)) await db.update(fleetVehicleProfiles).set({ status: input.incidentType === "accident" ? "accident_damaged" : "broken_down", updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, vehicle.id)); await logFleet(req, scope, "fleet_incident_created", `Reported Fleet ${input.incidentType} #${row.id}`, "fleet_incident", row.id); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/disposals", requireAuth, requirePermission("fleet.disposal.recommend"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ vehicleId: positiveInt, reason: z.string().trim().min(1), reviewNotes: optionalText }).parse(req.body); const vehicle = await assertVehicleScope(input.vehicleId, scope); const [asset] = await db.select().from(assetRegister).where(eq(assetRegister.id, vehicle.assetId)).limit(1); if (!asset) throw new Error("Linked asset not found"); const maintenanceCost = (await db.select({ total: sql<number>`coalesce(sum(${fleetMaintenanceJobs.actualCost}), 0)::float` }).from(fleetMaintenanceJobs).where(eq(fleetMaintenanceJobs.vehicleId, vehicle.id)))[0]?.total || 0; const [row] = await db.insert(fleetDisposalRecommendations).values({ organizationId: scope.organizationId, schoolId: vehicle.schoolId, vehicleId: vehicle.id, reason: input.reason, conditionSnapshot: asset.condition, odometerSnapshot: vehicle.currentOdometer, maintenanceCostSnapshot: String(maintenanceCost), currentAssetValueSnapshot: String(asset.currentValue || 0), reviewNotes: input.reviewNotes, status: "recommended", recommendedByUserId: scope.userId }).returning(); await logFleet(req, scope, "fleet_disposal_recommended", `Recommended Fleet vehicle #${vehicle.id} for replacement/disposal review`, "fleet_disposal", row.id); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.put("/api/fleet/disposals/:id/status", requireAuth, requirePermission("fleet.disposal.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); const input = z.object({ status: z.enum(["approved", "declined", "handed_to_assets", "completed"]), reviewNotes: optionalText }).parse(req.body); const [existing] = await db.select().from(fleetDisposalRecommendations).where(and(eq(fleetDisposalRecommendations.id, id), eq(fleetDisposalRecommendations.organizationId, scope.organizationId), scope.orgWide ? undefined : eq(fleetDisposalRecommendations.schoolId, scope.schoolId!))).limit(1); if (!existing) throw new Error("Fleet disposal recommendation not found"); const vehicle = await assertVehicleScope(existing.vehicleId, scope); if (input.status === "completed") { const [asset] = await db.select({ status: assetRegister.status }).from(assetRegister).where(eq(assetRegister.id, vehicle.assetId)).limit(1); if (asset?.status !== "disposed") throw new Error("Asset disposal must be completed in Assets & Inventory before the Fleet case can be completed"); }
      const [row] = await db.update(fleetDisposalRecommendations).set({ status: input.status, reviewNotes: input.reviewNotes, reviewedByUserId: scope.userId, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(fleetDisposalRecommendations.id, id)).returning(); if (["approved", "handed_to_assets"].includes(input.status)) await db.update(fleetVehicleProfiles).set({ status: "suspended", updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, vehicle.id)); if (input.status === "completed") await db.update(fleetVehicleProfiles).set({ status: "disposed", isActive: false, updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, vehicle.id)); await logFleet(req, scope, `fleet_disposal_${input.status}`, `${input.status} Fleet disposal recommendation #${id}`, "fleet_disposal", id); res.json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/components", requireAuth, requirePermission("fleet.components.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ componentType: z.enum(["tyre", "battery"]), serialNumber: z.string().trim().min(1), brand: optionalText, specification: optionalText, purchaseDate: dateText.optional().nullable(), purchaseCost: money.default(0), supplier: optionalText, warrantyExpiry: dateText.optional().nullable(), vehicleId: positiveInt.optional().nullable(), wheelPosition: optionalText, fittedAtOdometer: nonNegativeInt.optional().nullable(), condition: z.string().trim().min(1).default("new"), status: z.enum(["in_stock", "fitted", "removed", "retread", "disposed"]).default("in_stock"), notes: optionalText }).parse(req.body); let schoolId = scope.schoolId; if (input.vehicleId) schoolId = (await assertVehicleScope(input.vehicleId, scope)).schoolId; const [row] = await db.insert(fleetComponents).values({ ...input, purchaseCost: String(input.purchaseCost), organizationId: scope.organizationId, schoolId, fittedAt: input.vehicleId ? new Date() : null, createdByUserId: scope.userId }).returning(); await logFleet(req, scope, "fleet_component_created", `Recorded Fleet ${input.componentType} ${input.serialNumber}`, "fleet_component", row.id); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/vehicles/:id/suspend", requireAuth, requirePermission("fleet.vehicles.suspend"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); await assertVehicleScope(id, scope); const reason = z.object({ reason: z.string().trim().min(1) }).parse(req.body).reason; const [row] = await db.update(fleetVehicleProfiles).set({ status: "suspended", notes: sql`coalesce(${fleetVehicleProfiles.notes}, '') || ${`\nSuspended: ${reason}`}`, updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, id)).returning(); await logFleet(req, scope, "fleet_vehicle_suspended", `Suspended Fleet vehicle #${id}: ${reason}`, "fleet_vehicle", id); res.json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/fleet/vehicles/:id/release", requireAuth, requirePermission("fleet.vehicles.release"), async (req, res) => {
    try { const scope = await scopeOf(req); const id = Number(req.params.id); await assertVehicleScope(id, scope); const [row] = await db.update(fleetVehicleProfiles).set({ status: "available", updatedAt: new Date() }).where(eq(fleetVehicleProfiles.id, id)).returning(); await logFleet(req, scope, "fleet_vehicle_released", `Released Fleet vehicle #${id} to service`, "fleet_vehicle", id); res.json(row); } catch (error) { fail(res, error); }
  });
}
