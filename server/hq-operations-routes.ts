import type { Express, Request, Response } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { requireAnyPermission, requireAuth, requirePermission } from "./auth";
import {
  schools,
  transportAssignments,
  transportCharges,
  transportClaims,
  transportIncidents,
  transportPayments,
  transportRoutes,
  transportVehicles,
} from "@shared/schema";

type HqUser = { id: number; role?: string; organizationId?: number | null };

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requireHqUser(req: Request) {
  const user = req.user as HqUser;
  if (user?.role !== "org_admin" || !user.organizationId) {
    throw new Error("HQ organisation context is required");
  }
  return user;
}

async function buildTransportOverview(organizationId: number) {
  const orgSchools = await db
    .select({
      id: schools.id,
      name: schools.name,
      shortCode: schools.shortCode,
      enableTransport: schools.enableTransport,
      terminationStatus: schools.terminationStatus,
      archivedAt: schools.archivedAt,
    })
    .from(schools)
    .where(eq(schools.organizationId, organizationId))
    .orderBy(asc(schools.name));

  const activeSchools = orgSchools.filter((school) => !school.archivedAt && school.terminationStatus !== "pending");
  const schoolIds = activeSchools.map((school) => school.id);
  if (!schoolIds.length) {
    return {
      summary: {
        schoolsOperating: 0,
        activeRoutes: 0,
        activeVehicles: 0,
        activeLearners: 0,
        totalCharges: 0,
        totalCollections: 0,
        outstandingBalance: 0,
        collectionRate: 0,
        openIncidents: 0,
        openClaims: 0,
        complianceWarnings: 0,
      },
      schools: [],
      alerts: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const [routes, vehicles, assignments, charges, payments, incidents, claims] = await Promise.all([
    db.select().from(transportRoutes).where(inArray(transportRoutes.schoolId, schoolIds)),
    db.select().from(transportVehicles).where(inArray(transportVehicles.schoolId, schoolIds)),
    db.select().from(transportAssignments).where(inArray(transportAssignments.schoolId, schoolIds)),
    db.select().from(transportCharges).where(inArray(transportCharges.schoolId, schoolIds)),
    db.select().from(transportPayments).where(inArray(transportPayments.schoolId, schoolIds)),
    db.select().from(transportIncidents).where(inArray(transportIncidents.schoolId, schoolIds)),
    db.select().from(transportClaims).where(inArray(transportClaims.schoolId, schoolIds)),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const warningCutoff = new Date(today);
  warningCutoff.setDate(warningCutoff.getDate() + 30);

  const schoolRows = activeSchools.map((school) => {
    const schoolRoutes = routes.filter((row) => row.schoolId === school.id && row.isActive && row.status !== "retired");
    const schoolVehicles = vehicles.filter((row) => row.schoolId === school.id && row.isActive && row.status !== "retired");
    const schoolAssignments = assignments.filter((row) => row.schoolId === school.id && row.isActive && !["terminated", "cancelled"].includes(row.serviceState));
    const schoolCharges = charges.filter((row) => row.schoolId === school.id && row.status !== "void");
    const schoolPayments = payments.filter((row) => row.schoolId === school.id && row.status !== "reversed");
    const schoolIncidents = incidents.filter((row) => row.schoolId === school.id && !["resolved", "closed"].includes(row.status));
    const schoolClaims = claims.filter((row) => row.schoolId === school.id && !["paid", "closed", "cancelled", "rejected"].includes(row.status));
    const totalCharges = schoolCharges.reduce((sum, row) => sum + numberValue(row.amount), 0);
    const totalCollections = schoolPayments.reduce((sum, row) => sum + numberValue(row.amount), 0);
    const complianceWarnings = schoolVehicles.filter((vehicle) => {
      const dates = [vehicle.insuranceExpiry, vehicle.fitnessExpiry].filter(Boolean).map((value) => new Date(String(value)));
      return dates.some((date) => date <= warningCutoff);
    }).length;
    const collectionRate = totalCharges > 0 ? Math.min(100, (totalCollections / totalCharges) * 100) : 0;
    return {
      schoolId: school.id,
      schoolName: school.name,
      shortCode: school.shortCode,
      enabled: !!school.enableTransport,
      activeRoutes: schoolRoutes.length,
      activeVehicles: schoolVehicles.length,
      activeLearners: schoolAssignments.length,
      totalCharges,
      totalCollections,
      outstandingBalance: Math.max(0, totalCharges - totalCollections),
      collectionRate,
      openIncidents: schoolIncidents.length,
      openClaims: schoolClaims.length,
      complianceWarnings,
      status: school.enableTransport || schoolRoutes.length || schoolAssignments.length ? "operating" : "not_configured",
    };
  });

  const summary = schoolRows.reduce((acc, row) => ({
    schoolsOperating: acc.schoolsOperating + (row.status === "operating" ? 1 : 0),
    activeRoutes: acc.activeRoutes + row.activeRoutes,
    activeVehicles: acc.activeVehicles + row.activeVehicles,
    activeLearners: acc.activeLearners + row.activeLearners,
    totalCharges: acc.totalCharges + row.totalCharges,
    totalCollections: acc.totalCollections + row.totalCollections,
    outstandingBalance: acc.outstandingBalance + row.outstandingBalance,
    collectionRate: 0,
    openIncidents: acc.openIncidents + row.openIncidents,
    openClaims: acc.openClaims + row.openClaims,
    complianceWarnings: acc.complianceWarnings + row.complianceWarnings,
  }), {
    schoolsOperating: 0, activeRoutes: 0, activeVehicles: 0, activeLearners: 0,
    totalCharges: 0, totalCollections: 0, outstandingBalance: 0, collectionRate: 0,
    openIncidents: 0, openClaims: 0, complianceWarnings: 0,
  });
  summary.collectionRate = summary.totalCharges > 0 ? Math.min(100, (summary.totalCollections / summary.totalCharges) * 100) : 0;

  const alerts = schoolRows.flatMap((row) => {
    const rows: Array<{ schoolId: number; schoolName: string; type: string; count: number; severity: string; message: string }> = [];
    if (row.complianceWarnings) rows.push({ schoolId: row.schoolId, schoolName: row.schoolName, type: "compliance", count: row.complianceWarnings, severity: "warning", message: `${row.complianceWarnings} vehicle compliance record(s) expire within 30 days or are overdue.` });
    if (row.openIncidents) rows.push({ schoolId: row.schoolId, schoolName: row.schoolName, type: "incidents", count: row.openIncidents, severity: "error", message: `${row.openIncidents} transport incident(s) remain unresolved.` });
    if (row.openClaims) rows.push({ schoolId: row.schoolId, schoolName: row.schoolName, type: "claims", count: row.openClaims, severity: "info", message: `${row.openClaims} provider claim(s) remain open.` });
    if (row.outstandingBalance > 0) rows.push({ schoolId: row.schoolId, schoolName: row.schoolName, type: "balances", count: 1, severity: "info", message: `Outstanding learner transport balance: ${row.outstandingBalance.toFixed(2)}.` });
    return rows;
  });

  return { summary, schools: schoolRows, alerts, generatedAt: new Date().toISOString() };
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function registerHqOperationsRoutes(app: Express) {
  app.get(
    "/api/hq/transport/overview",
    requireAuth,
    requireAnyPermission("transport.organization.view", "transport.organization.reports", "transport.organization.manage"),
    async (req, res) => {
      try {
        const user = requireHqUser(req);
        res.json(await buildTransportOverview(user.organizationId!));
      } catch (error) {
        res.status(403).json({ message: error instanceof Error ? error.message : "Unable to load HQ transport oversight" });
      }
    },
  );

  app.get(
    "/api/hq/transport/overview.csv",
    requireAuth,
    requirePermission("transport.organization.export"),
    async (req, res) => {
      try {
        const user = requireHqUser(req);
        const overview = await buildTransportOverview(user.organizationId!);
        const headings = ["School", "Routes", "Vehicles", "Learners", "Charges", "Collections", "Outstanding", "Collection Rate", "Open Incidents", "Open Claims", "Compliance Warnings"];
        const rows = overview.schools.map((row) => [
          row.schoolName, row.activeRoutes, row.activeVehicles, row.activeLearners,
          row.totalCharges.toFixed(2), row.totalCollections.toFixed(2), row.outstandingBalance.toFixed(2),
          `${row.collectionRate.toFixed(1)}%`, row.openIncidents, row.openClaims, row.complianceWarnings,
        ]);
        const csv = [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="hq-transport-oversight-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.send(csv);
      } catch (error) {
        res.status(403).json({ message: error instanceof Error ? error.message : "Unable to export HQ transport oversight" });
      }
    },
  );
}
