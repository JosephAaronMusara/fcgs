import type { Express, Request } from "express";
import multer from "multer";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requireAuth, requireAnyPermission, requirePermission } from "./auth";
import { savePrivateBuffer, streamPrivateFile } from "./private-files";
import {
  calculateTransportCompliance,
  ensureTransportDocumentRequirements,
  scanTransportComplianceForSchool,
} from "./transport-compliance";
import {
  schools,
  staff,
  transportAssignments,
  transportAuditEvents,
  transportComplianceOverrides,
  transportDocumentRequirements,
  transportDocuments,
  transportDriverOwnerHistory,
  transportDrivers,
  transportIncidents,
  transportOwners,
  transportPathNodes,
  transportRoutes,
  transportSettings,
  transportVehicleDriverHistory,
  transportVehicleOwnerHistory,
  transportVehiclePaths,
  transportVehicles,
  users,
} from "@shared/schema";

type AuthedUser = { id: number; role?: string; schoolId?: number | null; organizationId?: number | null };
const userOf = (req: Request) => req.user as AuthedUser | undefined;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

async function schoolContext(req: Request) {
  const user = userOf(req);
  if (!user) return null;
  const header = Array.isArray(req.headers["x-school-id"]) ? req.headers["x-school-id"][0] : req.headers["x-school-id"];
  const schoolId = user.role === "org_admin" ? Number(header || req.query.schoolId) : Number(user.schoolId);
  if (!Number.isInteger(schoolId) || schoolId <= 0) return null;
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) return null;
  if (user.role === "org_admin" && user.organizationId && school.organizationId !== user.organizationId) return null;
  return school;
}

async function assertEntity(entityType: string, entityId: number, schoolId: number) {
  const table = entityType === "owner" ? transportOwners : entityType === "driver" ? transportDrivers : entityType === "vehicle" ? transportVehicles : null;
  if (!table) throw Object.assign(new Error("Unsupported Transport document entity type"), { status: 400 });
  const [contextSchool] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  const [record] = await db.select().from(table as any).where(eq((table as any).id, entityId)).limit(1);
  if (!record) throw Object.assign(new Error("Transport record not found"), { status: 404 });
  const [originSchool] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, Number((record as any).schoolId))).limit(1);
  if (!contextSchool || !originSchool || contextSchool.organizationId !== originSchool.organizationId) throw Object.assign(new Error("Transport record not found"), { status: 404 });
  return record as any;
}

async function organisationSchoolIds(schoolId: number): Promise<number[]> {
  const [contextSchool] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!contextSchool?.organizationId) return [schoolId];
  const rows = await db.select({ id: schools.id }).from(schools).where(eq(schools.organizationId, contextSchool.organizationId));
  return rows.map((row) => row.id);
}

async function assertDocument(documentId: number, schoolId: number) {
  const [document] = await db.select().from(transportDocuments).where(eq(transportDocuments.id, documentId)).limit(1);
  if (!document) throw Object.assign(new Error("Document not found"), { status: 404 });
  const allowedSchoolIds = await organisationSchoolIds(schoolId);
  if (!allowedSchoolIds.includes(document.schoolId)) throw Object.assign(new Error("Document not found"), { status: 404 });
  return document;
}

async function writeAudit(schoolId: number, userId: number, entityType: string, entityId: number, action: string, previousValues: unknown, newValues: unknown, reason?: string | null) {
  await db.insert(transportAuditEvents).values({ schoolId, userId, entityType, entityId, action, previousValues: previousValues ?? null, newValues: newValues ?? null, reason: reason || null });
}

function toDate(value: unknown): string | null {
  const stringValue = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(stringValue) ? stringValue : null;
}

export function registerTransportDocumentRoutes(app: Express): void {
  app.get("/api/transport/staff-owner-search", requireAuth, requirePermission("transport.owners.manage"), async (req, res, next) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user || !school.organizationId) return res.status(400).json({ message: "Select a school" });
      const query = String(req.query.q || "").trim().toLowerCase();
      const rows = await db.select({
        id: staff.id,
        schoolId: staff.schoolId,
        schoolName: schools.name,
        staffNo: staff.staffNo,
        firstName: staff.firstName,
        lastName: staff.lastName,
        phone: staff.phone,
        email: staff.email,
        address: staff.address,
        nationalId: staff.nationalIdNumber,
        role: staff.role,
        status: staff.status,
      }).from(staff).innerJoin(schools, eq(schools.id, staff.schoolId))
        .where(and(eq(schools.organizationId, school.organizationId), eq(staff.status, "active")))
        .orderBy(asc(staff.firstName), asc(staff.lastName));
      const filtered = !query ? rows.slice(0, 100) : rows.filter((row) => `${row.firstName} ${row.lastName} ${row.staffNo || ""} ${row.email || ""} ${row.phone || ""}`.toLowerCase().includes(query)).slice(0, 100);
      res.json(filtered);
    } catch (error) { next(error); }
  });

  app.get("/api/transport/document-requirements", requireAuth, requireAnyPermission("transport.documents.view", "transport.compliance.view", "transport.view"), async (req, res, next) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      await ensureTransportDocumentRequirements(school.id);
      const rows = await db.select().from(transportDocumentRequirements).where(eq(transportDocumentRequirements.schoolId, school.id)).orderBy(asc(transportDocumentRequirements.entityType), asc(transportDocumentRequirements.displayOrder));
      res.json(rows);
    } catch (error) { next(error); }
  });

  app.put("/api/transport/document-requirements/:id", requireAuth, requirePermission("transport.compliance.manage"), async (req, res, next) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const input = z.object({
        label: z.string().trim().min(1),
        isRequired: z.boolean(),
        allowsMultiple: z.boolean(),
        tracksExpiry: z.boolean(),
        isImage: z.boolean(),
        displayOrder: z.coerce.number().int().min(0),
        isActive: z.boolean(),
      }).parse(req.body);
      const [previous] = await db.select().from(transportDocumentRequirements).where(and(eq(transportDocumentRequirements.id, id), eq(transportDocumentRequirements.schoolId, school.id))).limit(1);
      if (!previous) return res.status(404).json({ message: "Document requirement not found" });
      const [updated] = await db.update(transportDocumentRequirements).set({ ...input, updatedAt: new Date() }).where(eq(transportDocumentRequirements.id, id)).returning();
      await writeAudit(school.id, user.id, "document_requirement", id, "update", previous, updated);
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.get("/api/transport/:entityType/:entityId/documents", requireAuth, requireAnyPermission("transport.documents.view", "transport.documents.manage", "transport.view"), async (req, res, next) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const entityType = String(req.params.entityType);
      const entityId = Number(req.params.entityId);
      const entity = await assertEntity(entityType, entityId, school.id);
      const entitySchoolId = Number(entity.schoolId || school.id);
      await ensureTransportDocumentRequirements(entitySchoolId);
      const ownerType = entityType === "owner" ? entity.ownerType : null;
      const scopeKey = `${entityType}:${ownerType || "all"}`;
      const [requirements, documents, compliance] = await Promise.all([
        db.select().from(transportDocumentRequirements).where(and(
          eq(transportDocumentRequirements.schoolId, entitySchoolId),
          eq(transportDocumentRequirements.entityType, entityType),
          eq(transportDocumentRequirements.isActive, true),
          or(eq(transportDocumentRequirements.scopeKey, scopeKey), eq(transportDocumentRequirements.scopeKey, `${entityType}:all`)),
        )).orderBy(asc(transportDocumentRequirements.displayOrder)),
        db.select().from(transportDocuments).where(and(eq(transportDocuments.schoolId, entitySchoolId), eq(transportDocuments.entityType, entityType), eq(transportDocuments.entityId, entityId))).orderBy(desc(transportDocuments.isActive), desc(transportDocuments.uploadedAt)),
        calculateTransportCompliance({ schoolId: entitySchoolId, entityType: entityType as "owner" | "driver" | "vehicle", entityId, ownerType }),
      ]);
      res.json({ requirements, documents, compliance });
    } catch (error) { next(error); }
  });

  app.post("/api/transport/:entityType/:entityId/documents", requireAuth, requirePermission("transport.documents.manage"), upload.single("file"), async (req, res, next) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const entityType = String(req.params.entityType);
      const entityId = Number(req.params.entityId);
      const entity = await assertEntity(entityType, entityId, school.id);
      const entitySchoolId = Number(entity.schoolId || school.id);
      if (!req.file) return res.status(400).json({ message: "Select a file to upload" });
      const [settings] = await db.select().from(transportSettings).where(eq(transportSettings.schoolId, entitySchoolId)).limit(1);
      const maxBytes = Number(settings?.attachmentSizeLimitMB || 25) * 1024 * 1024;
      if (req.file.size > maxBytes) return res.status(413).json({ message: `Each Transport attachment must be ${settings?.attachmentSizeLimitMB || 25} MB or smaller.` });
      const categoryCode = String(req.body.categoryCode || "other").trim().toLowerCase();
      const expiryDate = toDate(req.body.expiryDate);
      const isPrimary = String(req.body.isPrimary || "false") === "true";
      await ensureTransportDocumentRequirements(entitySchoolId);
      const [requirement] = await db.select().from(transportDocumentRequirements).where(and(
        eq(transportDocumentRequirements.schoolId, entitySchoolId),
        eq(transportDocumentRequirements.entityType, entityType),
        eq(transportDocumentRequirements.categoryCode, categoryCode),
        eq(transportDocumentRequirements.isActive, true),
      )).limit(1);
      if (!requirement && categoryCode !== "other") return res.status(400).json({ message: "Unknown Transport document category" });
      if (requirement?.tracksExpiry && !expiryDate) return res.status(400).json({ message: "This document category requires an expiry date." });
      const saved = await savePrivateBuffer({ namespace: `transport-${entityType}`, scopeId: entityId, originalName: req.file.originalname, mimeType: req.file.mimetype, buffer: req.file.buffer });
      const [existingPrimary] = await db.select({ id: transportDocuments.id }).from(transportDocuments).where(and(eq(transportDocuments.schoolId, entitySchoolId), eq(transportDocuments.entityType, entityType), eq(transportDocuments.entityId, entityId), eq(transportDocuments.isPrimary, true), eq(transportDocuments.isActive, true))).limit(1);
      const effectivePrimary = isPrimary || categoryCode === "driver_photo" || Boolean(requirement?.isImage && !existingPrimary);
      const [created] = await db.transaction(async (tx) => {
        if (effectivePrimary) await tx.update(transportDocuments).set({ isPrimary: false }).where(and(eq(transportDocuments.schoolId, entitySchoolId), eq(transportDocuments.entityType, entityType), eq(transportDocuments.entityId, entityId)));
        if (requirement && !requirement.allowsMultiple) {
          await tx.update(transportDocuments).set({ isActive: false, archivedAt: new Date() }).where(and(
            eq(transportDocuments.schoolId, entitySchoolId),
            eq(transportDocuments.entityType, entityType),
            eq(transportDocuments.entityId, entityId),
            eq(transportDocuments.categoryCode, categoryCode),
            eq(transportDocuments.isActive, true),
          ));
        }
        const [document] = await tx.insert(transportDocuments).values({ schoolId: entitySchoolId, entityType, entityId, categoryCode, ...saved, expiryDate, isPrimary: effectivePrimary, uploadedByUserId: user.id }).returning();
        if (entityType === "driver" && categoryCode === "driver_photo") await tx.update(transportDrivers).set({ photo: `/api/transport/documents/${document.id}?inline=1`, updatedAt: new Date() }).where(eq(transportDrivers.id, entityId));
        if (entityType === "vehicle" && effectivePrimary && requirement?.isImage) await tx.update(transportVehicles).set({ primaryImage: `/api/transport/documents/${document.id}?inline=1`, updatedAt: new Date() }).where(eq(transportVehicles.id, entityId));
        // Synchronize explicit expiry fields with the current document metadata.
        if (entityType === "vehicle" && expiryDate) {
          const patch: Record<string, unknown> = { updatedAt: new Date() };
          if (categoryCode === "registration_certificate" || categoryCode === "road_licence") patch.registrationExpiry = expiryDate;
          if (categoryCode === "insurance") patch.insuranceExpiry = expiryDate;
          if (categoryCode === "fitness") patch.fitnessExpiry = expiryDate;
          if (categoryCode === "radio_licence") patch.radioLicenceExpiry = expiryDate;
          if (Object.keys(patch).length > 1) await tx.update(transportVehicles).set(patch).where(eq(transportVehicles.id, entityId));
        }
        if (entityType === "driver" && expiryDate && ["licence_front", "licence_back"].includes(categoryCode)) await tx.update(transportDrivers).set({ licenceExpiry: expiryDate, updatedAt: new Date() }).where(eq(transportDrivers.id, entityId));
        return [document];
      });
      await writeAudit(entitySchoolId, user.id, entityType, entityId, "document_upload", null, created, categoryCode);
      await scanTransportComplianceForSchool(entitySchoolId, user.id);
      res.status(201).json(created);
    } catch (error) { next(error); }
  });

  app.get("/api/transport/documents/:id", requireAuth, requireAnyPermission("transport.documents.view", "transport.documents.manage", "transport.view"), async (req, res, next) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const document = await assertDocument(id, school.id);
      await streamPrivateFile({ res, storageKey: document.storageKey, mimeType: document.mimeType, originalName: document.originalName, disposition: req.query.inline === "1" ? "inline" : "attachment" });
    } catch (error) { next(error); }
  });

  app.delete("/api/transport/documents/:id", requireAuth, requirePermission("transport.documents.manage"), async (req, res, next) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const id = Number(req.params.id);
      const document = await assertDocument(id, school.id);
      const [updated] = await db.update(transportDocuments).set({ isActive: false, isPrimary: false, archivedAt: new Date() }).where(eq(transportDocuments.id, id)).returning();
      await writeAudit(document.schoolId, user.id, document.entityType, document.entityId, "document_archive", document, updated, document.categoryCode);
      await scanTransportComplianceForSchool(document.schoolId, user.id);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.post("/api/transport/:entityType/:entityId/compliance-overrides", requireAuth, requireAnyPermission("transport.compliance.manage", "transport.vehicles.override_compliance"), async (req, res, next) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      const entityType = String(req.params.entityType);
      const entityId = Number(req.params.entityId);
      const entity = await assertEntity(entityType, entityId, school.id);
      const entitySchoolId = Number(entity.schoolId || school.id);
      const input = z.object({ reason: z.string().trim().min(5), expiresAt: z.string().datetime({ offset: true }).or(z.string().datetime()), documentId: z.coerce.number().int().positive().optional().nullable() }).parse(req.body);
      const [created] = await db.insert(transportComplianceOverrides).values({ schoolId: entitySchoolId, entityType, entityId, documentId: input.documentId || null, reason: input.reason, expiresAt: new Date(input.expiresAt), createdByUserId: user.id }).returning();
      await writeAudit(entitySchoolId, user.id, entityType, entityId, "compliance_override", null, created, input.reason);
      await scanTransportComplianceForSchool(entitySchoolId, user.id);
      res.status(201).json(created);
    } catch (error) { next(error); }
  });

  app.post("/api/transport/compliance/scan", requireAuth, requireAnyPermission("transport.compliance.manage", "transport.settings.manage"), async (req, res, next) => {
    try {
      const school = await schoolContext(req);
      const user = userOf(req);
      if (!school || !user) return res.status(400).json({ message: "Select a school" });
      res.json(await scanTransportComplianceForSchool(school.id, user.id));
    } catch (error) { next(error); }
  });

  app.get("/api/transport/records/:entityType/:entityId", requireAuth, requirePermission("transport.view"), async (req, res, next) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const entityType = String(req.params.entityType);
      const entityId = Number(req.params.entityId);
      const record = await assertEntity(entityType, entityId, school.id);
      const entitySchoolId = Number(record.schoolId || school.id);
      const orgSchoolIds = await organisationSchoolIds(school.id);
      let relationships: any = {};
      if (entityType === "owner") {
        const [vehicles, drivers, ownerHistory, driverHistory, incidents] = await Promise.all([
          db.select().from(transportVehicles).where(and(inArray(transportVehicles.schoolId, orgSchoolIds), eq(transportVehicles.ownerId, entityId))).orderBy(asc(transportVehicles.registrationNumber)),
          db.select().from(transportDrivers).where(and(inArray(transportDrivers.schoolId, orgSchoolIds), eq(transportDrivers.ownerId, entityId))).orderBy(asc(transportDrivers.firstName)),
          db.select().from(transportVehicleOwnerHistory).where(eq(transportVehicleOwnerHistory.ownerId, entityId)).orderBy(desc(transportVehicleOwnerHistory.effectiveFrom)),
          db.select().from(transportDriverOwnerHistory).where(eq(transportDriverOwnerHistory.ownerId, entityId)).orderBy(desc(transportDriverOwnerHistory.effectiveFrom)),
          db.select().from(transportIncidents).where(and(inArray(transportIncidents.schoolId, orgSchoolIds), eq(transportIncidents.ownerId, entityId))).orderBy(desc(transportIncidents.occurredAt)),
        ]);
        relationships = { vehicles, drivers, ownerHistory, driverHistory, incidents };
      } else if (entityType === "driver") {
        const [owner, vehicles, ownerHistory, vehicleHistory, incidents] = await Promise.all([
          record.ownerId ? db.select().from(transportOwners).where(eq(transportOwners.id, record.ownerId)).limit(1) : Promise.resolve([]),
          db.select().from(transportVehicles).where(and(inArray(transportVehicles.schoolId, orgSchoolIds), eq(transportVehicles.driverId, entityId))).orderBy(asc(transportVehicles.registrationNumber)),
          db.select().from(transportDriverOwnerHistory).where(eq(transportDriverOwnerHistory.driverId, entityId)).orderBy(desc(transportDriverOwnerHistory.effectiveFrom)),
          db.select().from(transportVehicleDriverHistory).where(eq(transportVehicleDriverHistory.driverId, entityId)).orderBy(desc(transportVehicleDriverHistory.effectiveFrom)),
          db.select().from(transportIncidents).where(and(inArray(transportIncidents.schoolId, orgSchoolIds), eq(transportIncidents.driverId, entityId))).orderBy(desc(transportIncidents.occurredAt)),
        ]);
        relationships = { owner: owner[0] || null, vehicles, ownerHistory, vehicleHistory, incidents };
      } else {
        const [owner, driver, paths, ownerHistory, driverHistory, incidents, assignments] = await Promise.all([
          record.ownerId ? db.select().from(transportOwners).where(eq(transportOwners.id, record.ownerId)).limit(1) : Promise.resolve([]),
          record.driverId ? db.select().from(transportDrivers).where(eq(transportDrivers.id, record.driverId)).limit(1) : Promise.resolve([]),
          db.select().from(transportVehiclePaths).where(and(inArray(transportVehiclePaths.schoolId, orgSchoolIds), eq(transportVehiclePaths.vehicleId, entityId))).orderBy(desc(transportVehiclePaths.createdAt)),
          db.select().from(transportVehicleOwnerHistory).where(eq(transportVehicleOwnerHistory.vehicleId, entityId)).orderBy(desc(transportVehicleOwnerHistory.effectiveFrom)),
          db.select().from(transportVehicleDriverHistory).where(eq(transportVehicleDriverHistory.vehicleId, entityId)).orderBy(desc(transportVehicleDriverHistory.effectiveFrom)),
          db.select().from(transportIncidents).where(and(inArray(transportIncidents.schoolId, orgSchoolIds), eq(transportIncidents.vehicleId, entityId))).orderBy(desc(transportIncidents.occurredAt)),
          db.select().from(transportAssignments).where(and(inArray(transportAssignments.schoolId, orgSchoolIds), or(eq(transportAssignments.vehicleId, entityId), eq(transportAssignments.outboundVehicleId, entityId)))).orderBy(desc(transportAssignments.createdAt)),
        ]);
        relationships = { owner: owner[0] || null, driver: driver[0] || null, paths, ownerHistory, driverHistory, incidents, assignments };
      }
      const documents = await db.select().from(transportDocuments).where(and(eq(transportDocuments.schoolId, entitySchoolId), eq(transportDocuments.entityType, entityType), eq(transportDocuments.entityId, entityId))).orderBy(desc(transportDocuments.isActive), desc(transportDocuments.uploadedAt));
      const compliance = await calculateTransportCompliance({ schoolId: entitySchoolId, entityType: entityType as "owner" | "driver" | "vehicle", entityId, ownerType: record.ownerType });
      res.json({ record, relationships, documents, compliance });
    } catch (error) { next(error); }
  });

  app.get("/api/transport/incident-context", requireAuth, requirePermission("transport.view"), async (req, res, next) => {
    try {
      const school = await schoolContext(req);
      if (!school) return res.status(400).json({ message: "Select a school" });
      const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : null;
      const driverId = req.query.driverId ? Number(req.query.driverId) : null;
      let vehicles = [] as any[];
      if (vehicleId) {
        const vehicle = await assertEntity("vehicle", vehicleId, school.id);
        vehicles = [vehicle];
      } else if (driverId) {
        await assertEntity("driver", driverId, school.id);
        vehicles = await db.select().from(transportVehicles).where(and(eq(transportVehicles.schoolId, school.id), eq(transportVehicles.driverId, driverId), eq(transportVehicles.isActive, true))).orderBy(asc(transportVehicles.registrationNumber));
      }
      const vehicle = vehicles.length === 1 ? vehicles[0] : null;
      if (!vehicle) return res.json({ vehicles, context: null });
      const [owner, driver, paths] = await Promise.all([
        vehicle.ownerId ? db.select().from(transportOwners).where(eq(transportOwners.id, vehicle.ownerId)).limit(1) : Promise.resolve([]),
        vehicle.driverId ? db.select().from(transportDrivers).where(eq(transportDrivers.id, vehicle.driverId)).limit(1) : Promise.resolve([]),
        db.select().from(transportVehiclePaths).where(and(eq(transportVehiclePaths.schoolId, school.id), eq(transportVehiclePaths.vehicleId, vehicle.id), eq(transportVehiclePaths.status, "active"))).orderBy(desc(transportVehiclePaths.effectiveFrom)),
      ]);
      const pathIds = paths.map((path) => path.id);
      const nodes = pathIds.length ? await db.select().from(transportPathNodes).where(inArray(transportPathNodes.pathId, pathIds)).orderBy(asc(transportPathNodes.stopOrder)) : [];
      const routeIds = Array.from(new Set(paths.map((path) => path.routeId)));
      const routes = routeIds.length ? await db.select().from(transportRoutes).where(inArray(transportRoutes.id, routeIds)) : [];
      res.json({ vehicles, context: { vehicle, owner: owner[0] || null, driver: driver[0] || null, paths: paths.map((path) => ({ ...path, nodes: nodes.filter((node) => node.pathId === path.id), route: routes.find((route) => route.id === path.routeId) || null })) } });
    } catch (error) { next(error); }
  });
}
