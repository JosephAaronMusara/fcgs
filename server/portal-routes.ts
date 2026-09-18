import type { Express, NextFunction, Request, Response } from "express";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import {
  accessEvents,
  accessIdentities,
  classes,
  feesPayments,
  financialAccessOverrides,
  hostels,
  parents,
  studentEarlyReleaseAuthorizations,
  students,
  transportAssignments,
  transportDrivers,
  transportPickupPoints,
  transportRoutes,
  transportServicePoints,
  transportVehicles,
  type User,
} from "@shared/schema";

function money(value: string | number | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function currentStudent(userId: number) {
  const [student] = await db.select().from(students).where(eq(students.userId, userId)).limit(1);
  return student || null;
}

async function currentParent(userId: number) {
  const [parent] = await db.select().from(parents).where(eq(parents.userId, userId)).limit(1);
  return parent || null;
}

async function linkedChildren(parentId: number) {
  return db.select().from(students).where(eq(students.parentId, parentId));
}

async function transportSnapshot(studentId: number) {
  const [assignment] = await db.select().from(transportAssignments).where(and(
    eq(transportAssignments.studentId, studentId),
    eq(transportAssignments.isActive, true),
  )).orderBy(desc(transportAssignments.updatedAt)).limit(1);
  if (!assignment) return null;

  const [route, pickup, pickupService, dropoffService, vehicle, outboundVehicle, driver] = await Promise.all([
    db.select().from(transportRoutes).where(eq(transportRoutes.id, assignment.routeId)).limit(1).then((r) => r[0] || null),
    assignment.pickupPointId ? db.select().from(transportPickupPoints).where(eq(transportPickupPoints.id, assignment.pickupPointId)).limit(1).then((r) => r[0] || null) : null,
    assignment.pickupServicePointId ? db.select().from(transportServicePoints).where(eq(transportServicePoints.id, assignment.pickupServicePointId)).limit(1).then((r) => r[0] || null) : null,
    assignment.dropoffServicePointId ? db.select().from(transportServicePoints).where(eq(transportServicePoints.id, assignment.dropoffServicePointId)).limit(1).then((r) => r[0] || null) : null,
    assignment.vehicleId ? db.select().from(transportVehicles).where(eq(transportVehicles.id, assignment.vehicleId)).limit(1).then((r) => r[0] || null) : null,
    assignment.outboundVehicleId ? db.select().from(transportVehicles).where(eq(transportVehicles.id, assignment.outboundVehicleId)).limit(1).then((r) => r[0] || null) : null,
    assignment.driverId ? db.select().from(transportDrivers).where(eq(transportDrivers.id, assignment.driverId)).limit(1).then((r) => r[0] || null) : null,
  ]);

  return {
    assignmentId: assignment.id,
    serviceState: assignment.serviceState,
    planningStatus: assignment.planningStatus,
    financialStatus: assignment.financialStatus,
    billingFrequency: assignment.billingFrequency,
    route: route ? { id: route.id, name: route.name, code: route.code, direction: route.direction, departureTime: route.departureTime, arrivalTime: route.arrivalTime } : null,
    pickupPoint: pickup?.name || pickupService?.name || null,
    dropoffPoint: dropoffService?.name || null,
    vehicle: vehicle ? { registrationNumber: vehicle.registrationNumber, makeModel: vehicle.makeModel } : null,
    outboundVehicle: outboundVehicle ? { registrationNumber: outboundVehicle.registrationNumber, makeModel: outboundVehicle.makeModel } : null,
    driver: driver ? { name: `${driver.firstName} ${driver.lastName}`.trim(), phone: driver.phone } : null,
    effectiveFrom: assignment.startDate,
    effectiveTo: assignment.endDate,
    suspensionReason: assignment.suspensionReason,
  };
}

async function financeSnapshot(student: typeof students.$inferSelect, includePayments = false) {
  const now = new Date();
  const [override] = await db.select().from(financialAccessOverrides).where(and(
    eq(financialAccessOverrides.studentId, student.id),
    inArray(financialAccessOverrides.status, ["active", "scheduled"]),
    lte(financialAccessOverrides.effectiveFrom, now),
    sql`${financialAccessOverrides.expiresAt} > ${now}`,
  )).orderBy(desc(financialAccessOverrides.createdAt)).limit(1);
  const paymentRows = includePayments
    ? await db.select().from(feesPayments).where(eq(feesPayments.studentId, student.id)).orderBy(desc(feesPayments.paymentDate), desc(feesPayments.id))
    : [];
  return {
    totalTerm: money(student.feesTotalTerm),
    paidSoFar: money(student.feesPaidSoFar),
    balance: money(student.feesBalance),
    maxBalance: money(student.feesMaxBalance),
    status: student.feesStatus || "n/a",
    source: student.feesSource || null,
    snapshotAt: student.feesSnapshotAt || null,
    temporaryAccessOverride: override ? {
      id: override.id,
      reason: override.reason,
      effectiveFrom: override.effectiveFrom,
      expiresAt: override.expiresAt,
      status: override.status,
      academicYear: override.academicYear,
      term: override.term,
    } : null,
    payments: paymentRows.map((payment) => ({
      id: payment.id,
      amount: money(payment.amount),
      paymentDate: payment.paymentDate,
      paymentMethod: payment.paymentMethod,
      term: payment.term,
      year: payment.year,
      receiptNo: payment.receiptNo,
    })),
  };
}

async function accessSnapshot(studentId: number) {
  const [identity] = await db.select().from(accessIdentities).where(eq(accessIdentities.studentId, studentId)).limit(1);
  const recent = await db.select({
    id: accessEvents.id,
    occurredAt: accessEvents.occurredAt,
    direction: accessEvents.direction,
    accessDecision: accessEvents.accessDecision,
    decisionReason: accessEvents.decisionReason,
    gateId: accessEvents.gateId,
    deviceId: accessEvents.deviceId,
  }).from(accessEvents).where(eq(accessEvents.studentId, studentId)).orderBy(desc(accessEvents.occurredAt)).limit(5);
  const now = new Date();
  const [release] = await db.select().from(studentEarlyReleaseAuthorizations).where(and(
    eq(studentEarlyReleaseAuthorizations.studentId, studentId),
    inArray(studentEarlyReleaseAuthorizations.status, ["active", "scheduled"]),
    lte(studentEarlyReleaseAuthorizations.validFrom, now),
    sql`${studentEarlyReleaseAuthorizations.validUntil} > ${now}`,
  )).orderBy(desc(studentEarlyReleaseAuthorizations.createdAt)).limit(1);
  return {
    enrolled: identity?.isActive === true,
    entryPolicy: identity?.desiredEntryAccess || "not_enrolled",
    policyReason: identity?.lastPolicyReason || null,
    manuallyRestricted: identity?.manualRestrictionActive === true,
    recentEvents: recent,
    earlyRelease: release ? { releaseType: release.releaseType, validFrom: release.validFrom, validUntil: release.validUntil, reason: release.reason } : null,
  };
}

async function studentSummary(student: typeof students.$inferSelect, includePayments = false) {
  const [classInfo, hostel, attendance, finance, access, transport] = await Promise.all([
    student.classId ? db.select().from(classes).where(eq(classes.id, student.classId)).limit(1).then((r) => r[0] || null) : null,
    student.hostelId ? db.select().from(hostels).where(eq(hostels.id, student.hostelId)).limit(1).then((r) => r[0] || null) : null,
    storage.getAttendanceByStudent(student.id),
    financeSnapshot(student, includePayments),
    accessSnapshot(student.id),
    transportSnapshot(student.id),
  ]);
  const recentAttendance = [...attendance].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10);
  const present = attendance.filter((row) => row.status === "present" || row.status === "late").length;
  return {
    student: {
      id: student.id,
      admissionNo: student.admissionNo,
      firstName: student.firstName,
      lastName: student.lastName,
      photo: student.photo,
      status: student.status,
      classId: student.classId,
      className: classInfo?.className || null,
      classShortCode: classInfo?.shortCode || null,
      isBoarding: student.isBoarding === true,
      isDayScholar: student.isDayScholar === true,
    },
    attendance: {
      rate: attendance.length ? Math.round((present / attendance.length) * 100) : 0,
      total: attendance.length,
      recent: recentAttendance,
    },
    finance,
    access,
    transport,
    boarding: {
      isBoarding: student.isBoarding === true,
      isDayScholar: student.isDayScholar === true,
      hostel: hostel ? { id: hostel.id, name: hostel.name, description: hostel.description } : null,
    },
  };
}

function requirePortalRole(role: "student" | "parent") {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as User;
    if (user?.role !== role) return res.status(403).json({ message: `${role === "student" ? "Students" : "Parents"} only` });
    next();
  };
}

export function registerPortalRoutes(app: Express) {
  app.get("/api/me/student-dashboard", requireAuth, requirePortalRole("student"), async (req, res) => {
    const user = req.user as User;
    const student = await currentStudent(user.id);
    if (!student) return res.status(404).json({ message: "Student record not found" });
    const summary = await studentSummary(student, false);
    // The student dashboard intentionally exposes only the reduced finance view.
    // Full term totals, payer/payment records and finance administration data stay
    // on staff/parent surfaces and cannot be recovered by calling this API directly.
    return res.json({
      ...summary,
      finance: {
        status: summary.finance.status,
        balance: summary.finance.balance,
        maxBalance: summary.finance.maxBalance,
        snapshotAt: summary.finance.snapshotAt,
        temporaryAccessOverride: summary.finance.temporaryAccessOverride,
      },
    });
  });

  app.get("/api/me/parent-dashboard", requireAuth, requirePortalRole("parent"), async (req, res) => {
    const user = req.user as User;
    const parent = await currentParent(user.id);
    if (!parent) return res.status(404).json({ message: "Parent record not found" });
    const children = await linkedChildren(parent.id);
    const summaries = await Promise.all(children.map((student) => studentSummary(student, false)));
    return res.json({
      parent: { id: parent.id, firstName: parent.firstName, lastName: parent.lastName, photo: parent.photo },
      children: summaries,
    });
  });

  app.get("/api/me/parent-finance", requireAuth, requirePortalRole("parent"), async (req, res) => {
    const user = req.user as User;
    const parent = await currentParent(user.id);
    if (!parent) return res.status(404).json({ message: "Parent record not found" });
    const children = await linkedChildren(parent.id);
    const rows = await Promise.all(children.map(async (student) => ({
      student: { id: student.id, admissionNo: student.admissionNo, firstName: student.firstName, lastName: student.lastName, photo: student.photo },
      finance: await financeSnapshot(student, true),
    })));
    return res.json({ children: rows });
  });

  app.get("/api/me/student-finance", requireAuth, requirePortalRole("student"), async (req, res) => {
    const user = req.user as User;
    const student = await currentStudent(user.id);
    if (!student) return res.status(404).json({ message: "Student record not found" });
    const finance = await financeSnapshot(student, false);
    // Student view is intentionally reduced: no family payment history, payer details,
    // sibling records or administrator finance operations.
    return res.json({
      student: { id: student.id, admissionNo: student.admissionNo, firstName: student.firstName, lastName: student.lastName },
      finance: {
        status: finance.status,
        balance: finance.balance,
        maxBalance: finance.maxBalance,
        snapshotAt: finance.snapshotAt,
        temporaryAccessOverride: finance.temporaryAccessOverride,
      },
      access: await accessSnapshot(student.id),
    });
  });

  app.get("/api/me/student-services", requireAuth, requirePortalRole("student"), async (req, res) => {
    const user = req.user as User;
    const student = await currentStudent(user.id);
    if (!student) return res.status(404).json({ message: "Student record not found" });
    const [transport, hostel] = await Promise.all([
      transportSnapshot(student.id),
      student.hostelId ? db.select().from(hostels).where(eq(hostels.id, student.hostelId)).limit(1).then((r) => r[0] || null) : null,
    ]);
    return res.json({ transport, boarding: { isBoarding: student.isBoarding === true, isDayScholar: student.isDayScholar === true, hostel: hostel ? { id: hostel.id, name: hostel.name, description: hostel.description } : null } });
  });
}
