import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { storage } from "./storage";
import { requireAuth, requireAnyPermission, requirePermission } from "./auth";
import {
  accessGroupPermissions,
  activityLogs,
  assetAssignments,
  assetCentreTransferLines,
  assetCentreTransfers,
  assetCentres,
  assetDamageCases,
  assetDamageRecoveries,
  assetInventoryCategories,
  assetInventoryLocations,
  assetInventorySettings,
  assetMaintenanceRecords,
  assetRegister,
  assetVehicleDetails,
  inventoryBatches,
  inventoryGoodsReceiptLines,
  inventoryGoodsReceipts,
  inventoryItems,
  inventoryLowStockAlerts,
  inventoryMovements,
  inventoryPurchaseOrderLines,
  inventoryPurchaseOrders,
  inventoryPurchaseRequestLines,
  inventoryPurchaseRequests,
  inventoryReturnableIssues,
  inventoryStocktakeLines,
  inventoryStocktakes,
  inventorySuppliers,
  notifications,
  organizations,
  permissions,
  schools,
  userAccessGroups,
  userPermissionOverrides,
  users,
} from "@shared/schema";

type AppUser = { id: number; role?: string; schoolId?: number | null; organizationId?: number | null; firstName?: string | null; lastName?: string | null };
type AssetScope = { organizationId: number; schoolId: number | null; centreId: number | null; centre: any | null; allCentres: boolean; userId: number };
const userOf = (req: Request) => req.user as AppUser;
const text = z.string().trim().min(1);
const optionalText = z.string().trim().optional().nullable();
const money = z.coerce.number().finite().min(0);
const positiveQty = z.coerce.number().finite().positive();
const nonNegativeQty = z.coerce.number().finite().min(0);
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function fail(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const status = /not found/i.test(message) ? 404 : /denied|outside|context|required|permission/i.test(message) ? 403 : 400;
  return res.status(status).json({ message });
}

function cleanCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "CTR";
}

function ref(prefix: string, centreCode: string) {
  return `${prefix}-${cleanCode(centreCode)}-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
}

async function hasPermission(userId: number, code: string) {
  const effective = await storage.getUserEffectivePermissions(userId);
  return effective.some((entry) => entry.permission.code === code && entry.granted);
}

async function requireEffectivePermission(scope: AssetScope, code: string) {
  if (!(await hasPermission(scope.userId, code))) throw new Error(`Permission required: ${code}`);
}

async function logAction(req: Request, scope: AssetScope, action: string, description: string, targetType?: string, targetId?: number, targetName?: string, metadata?: Record<string, unknown>) {
  const current = userOf(req);
  await db.insert(activityLogs).values({
    schoolId: scope.schoolId,
    organizationId: scope.organizationId,
    userId: current.id,
    userName: `${current.firstName || ""} ${current.lastName || ""}`.trim() || null,
    userRole: current.role || null,
    action,
    category: "Assets & Inventory",
    description,
    targetType: targetType || null,
    targetId: targetId || null,
    targetName: targetName || null,
    metadata: metadata || null,
    ipAddress: req.ip || req.socket.remoteAddress || null,
  }).catch(() => undefined);
}

async function notifyPermissionHolders(scope: AssetScope, permissionCodes: string[], title: string, message: string, link: string, severity: "info" | "warning" | "error" = "warning") {
  const permissionRows = await db.select({ id: permissions.id }).from(permissions).where(inArray(permissions.code, permissionCodes));
  if (!permissionRows.length) return;
  const ids = permissionRows.map((row) => row.id);
  const grouped = await db.selectDistinct({ userId: userAccessGroups.userId })
    .from(userAccessGroups)
    .innerJoin(accessGroupPermissions, eq(accessGroupPermissions.accessGroupId, userAccessGroups.accessGroupId))
    .where(inArray(accessGroupPermissions.permissionId, ids));
  const direct = await db.selectDistinct({ userId: userPermissionOverrides.userId })
    .from(userPermissionOverrides)
    .where(and(inArray(userPermissionOverrides.permissionId, ids), eq(userPermissionOverrides.granted, true)));
  const candidateIds = Array.from(new Set([...grouped, ...direct].map((row) => row.userId)));
  if (!candidateIds.length) return;
  const candidates = await db.select({ id: users.id, role: users.role, schoolId: users.schoolId, organizationId: users.organizationId, isActive: users.isActive })
    .from(users).where(inArray(users.id, candidateIds));
  const recipients = candidates.filter((candidate) => candidate.isActive && (
    (candidate.role === "org_admin" && candidate.organizationId === scope.organizationId) ||
    (!!scope.schoolId && candidate.schoolId === scope.schoolId)
  ));
  if (!recipients.length) return;
  await db.insert(notifications).values(recipients.map((recipient) => ({
    organizationId: scope.organizationId,
    schoolId: scope.schoolId,
    userId: recipient.id,
    type: "inventory_alert",
    title,
    message,
    severity,
    channel: "in_app",
    link,
    actorUserId: scope.userId,
  })));
}

async function ensureOrganisationCentres(organizationId: number, userId: number) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw new Error("Organisation not found");
  await db.insert(assetInventorySettings).values({ organizationId, createdByUserId: userId }).onConflictDoNothing();
  const orgSchools = await db.select().from(schools).where(eq(schools.organizationId, organizationId)).orderBy(asc(schools.name));
  await db.insert(assetCentres).values({
    organizationId,
    schoolId: null,
    centreType: "hq",
    name: org.name ? `${org.name} HQ` : "HQ Office",
    code: "HQ",
    address: org.address,
    phone: org.phone,
    email: org.email,
    createdByUserId: userId,
  }).onConflictDoNothing();
  for (const school of orgSchools) {
    await db.insert(assetCentres).values({
      organizationId,
      schoolId: school.id,
      centreType: "school",
      name: school.name,
      code: cleanCode(school.shortCode || `SCH-${school.id}`),
      address: school.address,
      phone: school.phone,
      email: school.email,
      createdByUserId: userId,
    }).onConflictDoNothing();
  }
  const centres = await db.select().from(assetCentres).where(and(eq(assetCentres.organizationId, organizationId), eq(assetCentres.isActive, true))).orderBy(asc(assetCentres.name));
  for (const centre of centres.filter((row) => row.schoolId)) {
    const schoolId = centre.schoolId!;
    await Promise.all([
      db.update(assetInventoryCategories).set({ centreId: centre.id }).where(and(eq(assetInventoryCategories.schoolId, schoolId), isNull(assetInventoryCategories.centreId))),
      db.update(assetInventoryLocations).set({ centreId: centre.id }).where(and(eq(assetInventoryLocations.schoolId, schoolId), isNull(assetInventoryLocations.centreId))),
      db.update(assetRegister).set({ owningCentreId: centre.id, currentCentreId: centre.id }).where(and(eq(assetRegister.schoolId, schoolId), isNull(assetRegister.currentCentreId))),
      db.update(inventoryItems).set({ centreId: centre.id }).where(and(eq(inventoryItems.schoolId, schoolId), isNull(inventoryItems.centreId))),
      db.update(inventoryMovements).set({ centreId: centre.id }).where(and(eq(inventoryMovements.schoolId, schoolId), isNull(inventoryMovements.centreId))),
      db.update(assetAssignments).set({ centreId: centre.id }).where(and(eq(assetAssignments.schoolId, schoolId), isNull(assetAssignments.centreId))),
      db.update(assetMaintenanceRecords).set({ centreId: centre.id }).where(and(eq(assetMaintenanceRecords.schoolId, schoolId), isNull(assetMaintenanceRecords.centreId))),
      db.update(assetDamageCases).set({ centreId: centre.id }).where(and(eq(assetDamageCases.schoolId, schoolId), isNull(assetDamageCases.centreId))),
      db.update(assetDamageRecoveries).set({ centreId: centre.id }).where(and(eq(assetDamageRecoveries.schoolId, schoolId), isNull(assetDamageRecoveries.centreId))),
      db.update(inventoryStocktakes).set({ centreId: centre.id }).where(and(eq(inventoryStocktakes.schoolId, schoolId), isNull(inventoryStocktakes.centreId))),
    ]);
  }
  return centres;
}

async function scopeOf(req: Request): Promise<AssetScope> {
  const current = userOf(req);
  let organizationId = current.organizationId ?? null;
  let schoolId = current.schoolId ?? null;
  const requestedSchoolId = req.header("X-School-Id") || "";
  if (current.role === "org_admin" && requestedSchoolId) schoolId = Number(requestedSchoolId);
  if (!organizationId && schoolId) {
    const [school] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, schoolId)).limit(1);
    organizationId = school?.organizationId ?? null;
  }
  if (!organizationId) throw new Error("Organisation context is required");
  const centres = await ensureOrganisationCentres(organizationId, current.id);
  if (current.role !== "org_admin") {
    const centre = centres.find((row) => row.schoolId === current.schoolId);
    if (!centre) throw new Error("Asset centre context is required");
    return { organizationId, schoolId: centre.schoolId, centreId: centre.id, centre, allCentres: false, userId: current.id };
  }
  if (schoolId) {
    const centre = centres.find((row) => row.schoolId === schoolId);
    if (!centre) throw new Error("School is outside your organisation");
    return { organizationId, schoolId, centreId: centre.id, centre, allCentres: false, userId: current.id };
  }
  const requestedCentre = String(req.query.centreId || req.header("X-Asset-Centre-Id") || "hq");
  if (requestedCentre === "all") {
    if (!(await hasPermission(current.id, "assets.view.organization"))) throw new Error("Organisation asset viewing permission required");
    return { organizationId, schoolId: null, centreId: null, centre: null, allCentres: true, userId: current.id };
  }
  const centre = requestedCentre === "hq"
    ? centres.find((row) => row.centreType === "hq")
    : centres.find((row) => row.id === Number(requestedCentre));
  if (!centre) throw new Error("Asset centre not found");
  return { organizationId, schoolId: centre.schoolId, centreId: centre.id, centre, allCentres: false, userId: current.id };
}

function scopedCondition(table: { organizationId: any; centreId: any }, scope: AssetScope) {
  return scope.allCentres ? eq(table.organizationId, scope.organizationId) : and(eq(table.organizationId, scope.organizationId), eq(table.centreId, scope.centreId!));
}

async function reconcileLowStock(scope: AssetScope, itemIds?: number[]) {
  const [settings] = await db.select().from(assetInventorySettings).where(eq(assetInventorySettings.organizationId, scope.organizationId)).limit(1);
  const notificationsEnabled = settings?.lowStockNotificationsEnabled !== false;
  const where = itemIds?.length
    ? and(eq(inventoryItems.organizationId, scope.organizationId), inArray(inventoryItems.id, itemIds))
    : scopedCondition(inventoryItems, scope);
  const items = await db.select().from(inventoryItems).where(where);
  for (const item of items) {
    if (!item.reorderEnabled || !item.centreId) continue;
    const onHand = Number(item.quantityOnHand);
    const reorderLevel = Number(item.reorderLevel);
    const [existing] = await db.select().from(inventoryLowStockAlerts)
      .where(and(eq(inventoryLowStockAlerts.itemId, item.id), inArray(inventoryLowStockAlerts.status, ["open", "acknowledged"])))
      .orderBy(desc(inventoryLowStockAlerts.createdAt)).limit(1);
    if (onHand <= reorderLevel) {
      const severity = onHand <= Number(item.criticalStockLevel) || onHand <= 0 ? "critical" : "low";
      const target = Math.max(Number(item.targetStockLevel), reorderLevel);
      const suggested = Math.max(Number(item.preferredReorderQuantity), target - onHand, 0);
      if (!existing) {
        const [created] = await db.insert(inventoryLowStockAlerts).values({
          organizationId: item.organizationId,
          schoolId: item.schoolId,
          centreId: item.centreId,
          itemId: item.id,
          status: "open",
          severity,
          quantityAtTrigger: String(onHand),
          reorderLevel: String(reorderLevel),
          suggestedQuantity: String(suggested),
        }).returning();
        const alertScope = { ...scope, centreId: item.centreId, schoolId: item.schoolId };
        if (notificationsEnabled) await notifyPermissionHolders(alertScope, ["inventory.low_stock.view", "inventory.restock.request"], severity === "critical" ? `Critical stock: ${item.name}` : `Low stock: ${item.name}`, `${item.name} has ${onHand} ${item.unitOfMeasure} remaining. Reorder level: ${reorderLevel}.`, `/assets-inventory?tab=procurement&itemId=${item.id}`, severity === "critical" ? "error" : "warning");
        void created;
      } else if (existing.severity !== severity) {
        await db.update(inventoryLowStockAlerts).set({ severity, quantityAtTrigger: String(onHand), suggestedQuantity: String(suggested), updatedAt: new Date() }).where(eq(inventoryLowStockAlerts.id, existing.id));
        if (severity === "critical") {
          const alertScope = { ...scope, centreId: item.centreId, schoolId: item.schoolId };
          if (notificationsEnabled) await notifyPermissionHolders(alertScope, ["inventory.low_stock.view", "inventory.restock.request"], `Critical stock: ${item.name}`, `${item.name} is now at ${onHand} ${item.unitOfMeasure}.`, `/assets-inventory?tab=procurement&itemId=${item.id}`, "error");
        }
      }
    } else if (existing) {
      await db.update(inventoryLowStockAlerts).set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() }).where(eq(inventoryLowStockAlerts.id, existing.id));
    }
  }
}

const categoryInput = z.object({ kind: z.enum(["asset", "inventory"]), name: text, code: optionalText, description: optionalText, isActive: z.boolean().optional().default(true) });
const centreInput = z.object({ name: text, code: text, centreType: z.enum(["hq", "school", "warehouse", "workshop", "other"]).default("other"), address: optionalText, phone: optionalText, email: optionalText });
const locationInput = z.object({ name: text, code: optionalText, locationType: z.string().default("general"), description: optionalText, isStore: z.boolean().optional().default(false), isActive: z.boolean().optional().default(true) });
const supplierInput = z.object({ name: text, contactPerson: optionalText, phone: optionalText, email: z.string().email().optional().nullable().or(z.literal("")), address: optionalText, registrationNumber: optionalText, taxNumber: optionalText, goodsServices: optionalText, paymentTerms: optionalText, notes: optionalText });
const vehicleDetailsInput = z.object({ registrationNumber: optionalText, vin: optionalText, engineNumber: optionalText, make: optionalText, model: optionalText, manufactureYear: z.coerce.number().int().min(1900).max(2200).optional().nullable(), colour: optionalText, fuelType: optionalText, vehicleClass: optionalText }).partial();
const assetInput = z.object({ assetNumber: text, assetClass: z.string().default("general"), name: text, categoryId: z.coerce.number().int().positive().optional().nullable(), locationId: z.coerce.number().int().positive().optional().nullable(), supplierId: z.coerce.number().int().positive().optional().nullable(), serialNumber: optionalText, description: optionalText, acquisitionDate: dateText.optional().nullable(), acquisitionCost: money.default(0), currentValue: money.default(0), condition: z.string().default("good"), status: z.string().default("available"), warrantyExpiry: dateText.optional().nullable(), supplier: optionalText, procurementReference: optionalText, notes: optionalText, vehicleDetails: vehicleDetailsInput.optional() });
const itemInput = z.object({ sku: text, name: text, itemType: z.enum(["consumable", "returnable", "spare_part", "resale"]).default("consumable"), categoryId: z.coerce.number().int().positive().optional().nullable(), defaultLocationId: z.coerce.number().int().positive().optional().nullable(), preferredSupplierId: z.coerce.number().int().positive().optional().nullable(), unitOfMeasure: z.string().default("unit"), purchaseUnit: optionalText, issueUnit: optionalText, unitConversionFactor: z.coerce.number().finite().positive().default(1), reorderEnabled: z.coerce.boolean().default(true), reorderLevel: nonNegativeQty.default(0), criticalStockLevel: nonNegativeQty.default(0), targetStockLevel: nonNegativeQty.default(0), preferredReorderQuantity: nonNegativeQty.default(0), supplierLeadTimeDays: z.coerce.number().int().min(0).default(0), unitCost: money.default(0), batchTrackingEnabled: z.coerce.boolean().default(false), expiryTrackingEnabled: z.coerce.boolean().default(false), description: optionalText });
const movementInput = z.object({ itemId: z.coerce.number().int().positive(), movementType: z.enum(["receipt", "issue", "return", "adjustment_in", "adjustment_out", "writeoff"]), quantity: positiveQty, unitCost: money.optional().default(0), batchNumber: optionalText, expiryDate: dateText.optional().nullable(), fromLocationId: z.coerce.number().int().positive().optional().nullable(), toLocationId: z.coerce.number().int().positive().optional().nullable(), recipientType: optionalText, recipientId: z.coerce.number().int().positive().optional().nullable(), reason: optionalText, notes: optionalText });
const assignmentInput = z.object({ assetId: z.coerce.number().int().positive(), assigneeType: text, assigneeId: z.coerce.number().int().positive().optional().nullable(), assigneeName: text, expectedReturnDate: dateText.optional().nullable(), conditionOut: z.string().default("good"), notes: optionalText });
const damageInput = z.object({ assetId: z.coerce.number().int().positive().optional().nullable(), inventoryItemId: z.coerce.number().int().positive().optional().nullable(), incidentDate: dateText, incidentType: z.string().default("breakage"), locationId: z.coerce.number().int().positive().optional().nullable(), description: text, classification: z.string().default("unconfirmed"), responsiblePartyType: optionalText, responsiblePartyId: z.coerce.number().int().positive().optional().nullable(), responsiblePartyName: optionalText, proposedCharge: money.default(0) }).refine((value) => value.assetId || value.inventoryItemId, "Select an asset or inventory item");
const maintenanceInput = z.object({ assetId: z.coerce.number().int().positive(), issueDescription: text, serviceProvider: optionalText, status: z.string().default("reported"), dateReported: dateText, dateSent: dateText.optional().nullable(), dateReturned: dateText.optional().nullable(), estimatedCost: money.default(0), actualCost: money.default(0), workCompleted: optionalText, nextServiceDate: dateText.optional().nullable(), notes: optionalText });

async function applyMovement(tx: any, scope: AssetScope, input: z.infer<typeof movementInput>, sourceDocumentType?: string, sourceDocumentId?: number) {
  if (!scope.centreId) throw new Error("A single centre is required for stock movements");
  const [item] = await tx.select().from(inventoryItems).where(and(eq(inventoryItems.id, input.itemId), eq(inventoryItems.organizationId, scope.organizationId), eq(inventoryItems.centreId, scope.centreId))).for("update").limit(1);
  if (!item) throw new Error("Inventory item not found in this centre");
  const before = Number(item.quantityOnHand);
  const incoming = ["receipt", "return", "adjustment_in"].includes(input.movementType);
  const after = before + (incoming ? input.quantity : -input.quantity);
  if (after < 0) throw new Error("This movement would create negative stock");
  let batchId: number | null = null;
  if (input.batchNumber) {
    const [existingBatch] = await tx.select().from(inventoryBatches).where(and(eq(inventoryBatches.itemId, item.id), eq(inventoryBatches.batchNumber, input.batchNumber), input.toLocationId ? eq(inventoryBatches.locationId, input.toLocationId) : isNull(inventoryBatches.locationId))).for("update").limit(1);
    const batchBefore = Number(existingBatch?.quantityOnHand || 0);
    const batchAfter = batchBefore + (incoming ? input.quantity : -input.quantity);
    if (batchAfter < 0) throw new Error("This movement would create negative batch stock");
    if (existingBatch) {
      await tx.update(inventoryBatches).set({ quantityOnHand: String(batchAfter), expiryDate: input.expiryDate || existingBatch.expiryDate, updatedAt: new Date() }).where(eq(inventoryBatches.id, existingBatch.id));
      batchId = existingBatch.id;
    } else {
      if (!incoming) throw new Error("Batch not found");
      const [createdBatch] = await tx.insert(inventoryBatches).values({ itemId: item.id, centreId: scope.centreId, locationId: input.toLocationId || item.defaultLocationId, batchNumber: input.batchNumber, expiryDate: input.expiryDate, quantityOnHand: String(input.quantity), supplierId: item.preferredSupplierId }).returning();
      batchId = createdBatch.id;
    }
  }
  const referenceNumber = ref(input.movementType.toUpperCase().slice(0, 3), scope.centre.code);
  const [movement] = await tx.insert(inventoryMovements).values({
    organizationId: scope.organizationId,
    schoolId: scope.schoolId,
    centreId: scope.centreId,
    referenceNumber,
    itemId: item.id,
    batchId,
    movementType: input.movementType,
    quantity: String(input.quantity),
    quantityBefore: String(before),
    quantityAfter: String(after),
    unitCost: String(input.unitCost || Number(item.unitCost)),
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    recipientType: input.recipientType,
    recipientId: input.recipientId,
    sourceDocumentType,
    sourceDocumentId,
    reason: input.reason,
    notes: input.notes,
    createdByUserId: scope.userId,
  }).returning();
  await tx.update(inventoryItems).set({ quantityOnHand: String(after), unitCost: input.unitCost ? String(input.unitCost) : item.unitCost, updatedAt: new Date() }).where(eq(inventoryItems.id, item.id));
  return movement;
}

export function registerAssetsInventoryRoutes(app: Express) {
  app.get("/api/assets-inventory/bootstrap", requireAuth, requireAnyPermission("assets.view", "inventory.view", "damage.view"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      await db.update(inventoryReturnableIssues).set({ status: "overdue", updatedAt: new Date() }).where(and(
        eq(inventoryReturnableIssues.organizationId, scope.organizationId),
        scope.allCentres ? sql`true` : eq(inventoryReturnableIssues.centreId, scope.centreId!),
        inArray(inventoryReturnableIssues.status, ["issued", "partially_returned"]),
        sql`${inventoryReturnableIssues.expectedReturnDate} is not null and ${inventoryReturnableIssues.expectedReturnDate} < current_date`,
      ));
      const [canViewAssets, canViewInventory, canViewDamage, canViewProcurement] = await Promise.all([
        hasPermission(scope.userId, "assets.view"),
        hasPermission(scope.userId, "inventory.view"),
        hasPermission(scope.userId, "damage.view"),
        Promise.all(["inventory.procurement.view", "inventory.procurement.request", "inventory.procurement.approve", "inventory.procurement.order", "inventory.procurement.receive"].map((code) => hasPermission(scope.userId, code))).then((values) => values.some(Boolean)),
      ]);
      if (canViewInventory) await reconcileLowStock(scope);
      const centres = await db.select().from(assetCentres)
        .where(and(eq(assetCentres.organizationId, scope.organizationId), eq(assetCentres.isActive, true)))
        .orderBy(asc(assetCentres.name));
      const centreIds = centres.map((centre) => centre.id);
      const [settingsRows, categories, locations, assets, items, returnableIssues, assignments, damages, maintenance, movements, stocktakes, alerts, suppliers, purchaseRequests, purchaseOrders, goodsReceipts, transfers] = await Promise.all([
        db.select().from(assetInventorySettings).where(eq(assetInventorySettings.organizationId, scope.organizationId)).limit(1),
        db.select().from(assetInventoryCategories).where(and(
          scope.allCentres
            ? eq(assetInventoryCategories.organizationId, scope.organizationId)
            : or(eq(assetInventoryCategories.centreId, scope.centreId!), and(eq(assetInventoryCategories.organizationId, scope.organizationId), isNull(assetInventoryCategories.centreId))),
          eq(assetInventoryCategories.isActive, true),
        )).orderBy(asc(assetInventoryCategories.name)),
        db.select().from(assetInventoryLocations).where(and(scopedCondition(assetInventoryLocations, scope), eq(assetInventoryLocations.isActive, true))).orderBy(asc(assetInventoryLocations.name)),
        canViewAssets ? db.select().from(assetRegister).where(scopedCondition({ organizationId: assetRegister.organizationId, centreId: assetRegister.currentCentreId }, scope)).orderBy(desc(assetRegister.createdAt)) : Promise.resolve([]),
        canViewInventory ? db.select().from(inventoryItems).where(scopedCondition(inventoryItems, scope)).orderBy(asc(inventoryItems.name)) : Promise.resolve([]),
        canViewInventory ? db.select().from(inventoryReturnableIssues).where(scopedCondition(inventoryReturnableIssues, scope)).orderBy(desc(inventoryReturnableIssues.issuedAt)) : Promise.resolve([]),
        canViewAssets ? db.select().from(assetAssignments).where(scopedCondition(assetAssignments, scope)).orderBy(desc(assetAssignments.createdAt)) : Promise.resolve([]),
        canViewDamage ? db.select().from(assetDamageCases).where(scopedCondition(assetDamageCases, scope)).orderBy(desc(assetDamageCases.createdAt)) : Promise.resolve([]),
        canViewAssets ? db.select().from(assetMaintenanceRecords).where(scopedCondition(assetMaintenanceRecords, scope)).orderBy(desc(assetMaintenanceRecords.createdAt)) : Promise.resolve([]),
        canViewInventory ? db.select().from(inventoryMovements).where(scopedCondition(inventoryMovements, scope)).orderBy(desc(inventoryMovements.createdAt)).limit(scope.allCentres ? 1000 : 300) : Promise.resolve([]),
        canViewInventory ? db.select().from(inventoryStocktakes).where(scopedCondition(inventoryStocktakes, scope)).orderBy(desc(inventoryStocktakes.createdAt)) : Promise.resolve([]),
        canViewInventory ? db.select().from(inventoryLowStockAlerts).where(and(scopedCondition(inventoryLowStockAlerts, scope), inArray(inventoryLowStockAlerts.status, ["open", "acknowledged"]))).orderBy(desc(inventoryLowStockAlerts.createdAt)) : Promise.resolve([]),
        canViewProcurement ? db.select().from(inventorySuppliers).where(and(eq(inventorySuppliers.organizationId, scope.organizationId), eq(inventorySuppliers.isActive, true))).orderBy(asc(inventorySuppliers.name)) : Promise.resolve([]),
        canViewProcurement ? db.select().from(inventoryPurchaseRequests).where(scopedCondition(inventoryPurchaseRequests, scope)).orderBy(desc(inventoryPurchaseRequests.createdAt)) : Promise.resolve([]),
        canViewProcurement ? db.select().from(inventoryPurchaseOrders).where(scopedCondition(inventoryPurchaseOrders, scope)).orderBy(desc(inventoryPurchaseOrders.createdAt)) : Promise.resolve([]),
        canViewProcurement ? db.select().from(inventoryGoodsReceipts).where(scopedCondition(inventoryGoodsReceipts, scope)).orderBy(desc(inventoryGoodsReceipts.createdAt)) : Promise.resolve([]),
        db.select().from(assetCentreTransfers).where(and(
          eq(assetCentreTransfers.organizationId, scope.organizationId),
          scope.allCentres ? sql`true` : or(eq(assetCentreTransfers.sourceCentreId, scope.centreId!), eq(assetCentreTransfers.destinationCentreId, scope.centreId!)),
        )).orderBy(desc(assetCentreTransfers.createdAt)),
      ]);

      const assetIds = assets.map((row) => row.id);
      const damageCentreIds = scope.allCentres ? centreIds : scope.centreId ? [scope.centreId] : [];
      const requestIds = purchaseRequests.map((row) => row.id);
      const orderIds = purchaseOrders.map((row) => row.id);
      const receiptIds = goodsReceipts.map((row) => row.id);
      const transferIds = transfers.map((row) => row.id);
      const [vehicleDetails, recoveries, requestLines, orderLines, receiptLines, transferLines] = await Promise.all([
        assetIds.length ? db.select().from(assetVehicleDetails).where(inArray(assetVehicleDetails.assetId, assetIds)) : Promise.resolve([]),
        canViewDamage && damageCentreIds.length ? db.select().from(assetDamageRecoveries).where(inArray(assetDamageRecoveries.centreId, damageCentreIds)).orderBy(desc(assetDamageRecoveries.receivedAt)) : Promise.resolve([]),
        requestIds.length ? db.select().from(inventoryPurchaseRequestLines).where(inArray(inventoryPurchaseRequestLines.requestId, requestIds)) : Promise.resolve([]),
        orderIds.length ? db.select().from(inventoryPurchaseOrderLines).where(inArray(inventoryPurchaseOrderLines.purchaseOrderId, orderIds)) : Promise.resolve([]),
        receiptIds.length ? db.select().from(inventoryGoodsReceiptLines).where(inArray(inventoryGoodsReceiptLines.goodsReceiptId, receiptIds)) : Promise.resolve([]),
        transferIds.length ? db.select().from(assetCentreTransferLines).where(inArray(assetCentreTransferLines.transferId, transferIds)) : Promise.resolve([]),
      ]);

      const centreMap = new Map(centres.map((centre) => [centre.id, centre]));
      const dashboard = {
        totalAssets: assets.filter((asset) => asset.isActive).length,
        acquisitionValue: assets.reduce((sum, asset) => sum + Number(asset.acquisitionCost), 0),
        currentAssetValue: assets.reduce((sum, asset) => sum + Number(asset.currentValue), 0),
        assignedAssets: assignments.filter((assignment) => assignment.status === "active").length,
        assetsInTransit: assets.filter((asset) => asset.status === "in_transit").length,
        maintenanceOpen: maintenance.filter((record) => !["completed", "cancelled"].includes(record.status)).length,
        inventoryItems: items.filter((item) => item.isActive).length,
        inventoryValue: items.reduce((sum, item) => sum + Number(item.quantityOnHand) * Number(item.unitCost), 0),
        lowStockItems: alerts.length,
        openDamageCases: damages.filter((damage) => !["closed", "rejected", "settled"].includes(damage.status)).length,
        outstandingDamageCharges: damages.reduce((sum, damage) => sum + Math.max(0, Number(damage.approvedCharge) - Number(damage.amountRecovered)), 0),
        transfersAwaitingReceipt: transfers.filter((transfer) => ["approved", "dispatched", "in_transit", "partially_received"].includes(transfer.status)).length,
        procurementAwaitingApproval: purchaseRequests.filter((request) => request.status === "submitted").length + purchaseOrders.filter((order) => order.status === "awaiting_approval").length,
      };
      const centreSummary = centres.map((centre) => {
        const centreAssets = assets.filter((asset) => asset.currentCentreId === centre.id);
        const centreItems = items.filter((item) => item.centreId === centre.id);
        return {
          centreId: centre.id,
          centreName: centre.name,
          centreType: centre.centreType,
          assets: centreAssets.length,
          assetValue: centreAssets.reduce((sum, asset) => sum + Number(asset.currentValue), 0),
          inventoryItems: centreItems.length,
          inventoryValue: centreItems.reduce((sum, item) => sum + Number(item.quantityOnHand) * Number(item.unitCost), 0),
          lowStock: alerts.filter((alert) => alert.centreId === centre.id).length,
          damaged: centreAssets.filter((asset) => asset.status === "damaged").length,
        };
      });
      res.json({ scope, settings: settingsRows[0] || null, dashboard, centreSummary, centres, centreMap: Object.fromEntries(centreMap), categories, locations, assets, vehicleDetails, items, returnableIssues, assignments, damages, recoveries, maintenance, movements, stocktakes, alerts, suppliers, purchaseRequests, requestLines, purchaseOrders, orderLines, goodsReceipts, receiptLines, transfers, transferLines });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/assets-inventory/centres", requireAuth, requirePermission("assets.manage.organization"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = centreInput.parse(req.body); const [row] = await db.insert(assetCentres).values({ ...input, code: cleanCode(input.code), organizationId: scope.organizationId, schoolId: null, createdByUserId: scope.userId }).returning(); await logAction(req, scope, "create", `Created asset centre ${row.name}`, "asset_centre", row.id, row.name); res.status(201).json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/categories", requireAuth, requirePermission("assets.setup.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre"); const input = categoryInput.parse(req.body); const [row] = await db.insert(assetInventoryCategories).values({ ...input, organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId, createdByUserId: scope.userId }).returning(); res.status(201).json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/locations", requireAuth, requirePermission("assets.setup.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre"); const input = locationInput.parse(req.body); const [row] = await db.insert(assetInventoryLocations).values({ ...input, organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId, createdByUserId: scope.userId }).returning(); res.status(201).json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/suppliers", requireAuth, requireAnyPermission("assets.setup.manage", "inventory.procurement.order"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = supplierInput.parse(req.body); const [row] = await db.insert(inventorySuppliers).values({ ...input, email: input.email || null, organizationId: scope.organizationId, createdByUserId: scope.userId }).returning(); await logAction(req, scope, "create", `Added supplier ${row.name}`, "supplier", row.id, row.name); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/assets-inventory/assets", requireAuth, requirePermission("assets.create"), async (req, res) => {
    try {
      const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre"); const input = assetInput.parse(req.body); const { vehicleDetails, acquisitionCost, currentValue, ...assetValues } = input;
      const row = await db.transaction(async (tx) => {
        const [asset] = await tx.insert(assetRegister).values({ ...assetValues, acquisitionCost: String(acquisitionCost), currentValue: String(currentValue), organizationId: scope.organizationId, schoolId: scope.schoolId, owningCentreId: scope.centreId, currentCentreId: scope.centreId, createdByUserId: scope.userId }).returning();
        if (asset.assetClass === "vehicle" && vehicleDetails) await tx.insert(assetVehicleDetails).values({ ...vehicleDetails, assetId: asset.id });
        return asset;
      });
      await logAction(req, scope, "create", `Registered asset ${row.assetNumber}`, "asset", row.id, row.name); res.status(201).json(row);
    } catch (error) { fail(res, error); }
  });
  app.put("/api/assets-inventory/assets/:id", requireAuth, requirePermission("assets.edit"), async (req, res) => {
    try { const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre"); const input = assetInput.partial().parse(req.body); const { vehicleDetails, acquisitionCost, currentValue, ...assetValues } = input; const [row] = await db.update(assetRegister).set({ ...assetValues, ...(acquisitionCost !== undefined ? { acquisitionCost: String(acquisitionCost) } : {}), ...(currentValue !== undefined ? { currentValue: String(currentValue) } : {}), updatedAt: new Date() }).where(and(eq(assetRegister.id, Number(req.params.id)), eq(assetRegister.currentCentreId, scope.centreId))).returning(); if (!row) throw new Error("Asset not found"); if (row.assetClass === "vehicle" && vehicleDetails) await db.insert(assetVehicleDetails).values({ ...vehicleDetails, assetId: row.id }).onConflictDoUpdate({ target: assetVehicleDetails.assetId, set: { ...vehicleDetails, updatedAt: new Date() } }); res.json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/items", requireAuth, requirePermission("inventory.items.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre"); const input = itemInput.parse(req.body); const { unitConversionFactor, reorderLevel, criticalStockLevel, targetStockLevel, preferredReorderQuantity, unitCost, ...itemValues } = input; const [row] = await db.insert(inventoryItems).values({ ...itemValues, unitConversionFactor: String(unitConversionFactor), reorderLevel: String(reorderLevel), criticalStockLevel: String(criticalStockLevel), targetStockLevel: String(targetStockLevel), preferredReorderQuantity: String(preferredReorderQuantity), unitCost: String(unitCost), quantityOnHand: "0", organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId, createdByUserId: scope.userId }).returning(); await reconcileLowStock(scope, [row.id]); res.status(201).json(row); } catch (error) { fail(res, error); }
  });
  app.put("/api/assets-inventory/items/:id", requireAuth, requirePermission("inventory.items.manage"), async (req, res) => {
    try { const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre"); const input = itemInput.partial().parse(req.body); const { unitConversionFactor, reorderLevel, criticalStockLevel, targetStockLevel, preferredReorderQuantity, unitCost, ...itemValues } = input; const [row] = await db.update(inventoryItems).set({ ...itemValues, ...(unitConversionFactor !== undefined ? { unitConversionFactor: String(unitConversionFactor) } : {}), ...(reorderLevel !== undefined ? { reorderLevel: String(reorderLevel) } : {}), ...(criticalStockLevel !== undefined ? { criticalStockLevel: String(criticalStockLevel) } : {}), ...(targetStockLevel !== undefined ? { targetStockLevel: String(targetStockLevel) } : {}), ...(preferredReorderQuantity !== undefined ? { preferredReorderQuantity: String(preferredReorderQuantity) } : {}), ...(unitCost !== undefined ? { unitCost: String(unitCost) } : {}), updatedAt: new Date() }).where(and(eq(inventoryItems.id, Number(req.params.id)), eq(inventoryItems.centreId, scope.centreId))).returning(); if (!row) throw new Error("Inventory item not found"); await reconcileLowStock(scope, [row.id]); res.json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/movements", requireAuth, requireAnyPermission("inventory.receive", "inventory.issue", "inventory.adjust"), async (req, res) => {
    try {
      const scope = await scopeOf(req); const input = movementInput.parse(req.body);
      const [movementItem] = await db.select({ itemType: inventoryItems.itemType }).from(inventoryItems).where(and(eq(inventoryItems.id, input.itemId), eq(inventoryItems.organizationId, scope.organizationId))).limit(1);
      if (movementItem?.itemType === "returnable" && ["issue", "return"].includes(input.movementType)) throw new Error("Use the Returnable Stock issue and return workflow for this item");
      const needed = input.movementType === "receipt" ? "inventory.receive" : ["issue", "return"].includes(input.movementType) ? "inventory.issue" : "inventory.adjust";
      await requireEffectivePermission(scope, needed);
      const row = await db.transaction((tx) => applyMovement(tx, scope, input));
      await reconcileLowStock(scope, [input.itemId]);
      await logAction(req, scope, "stock_movement", `${input.movementType} ${input.quantity} units`, "inventory_item", input.itemId, undefined, { referenceNumber: row.referenceNumber });
      res.status(201).json(row);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/assets-inventory/settings", requireAuth, requirePermission("assets.setup.manage"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const input = z.object({ currency: z.string().trim().min(3).max(3).transform((value) => value.toUpperCase()), purchaseRequestApprovalThreshold: money, purchaseOrderHqThreshold: money, lowStockNotificationsEnabled: z.coerce.boolean(), defaultSupplierLeadTimeDays: z.coerce.number().int().min(0).max(365) }).parse(req.body);
      const dbInput = { ...input, purchaseRequestApprovalThreshold: String(input.purchaseRequestApprovalThreshold), purchaseOrderHqThreshold: String(input.purchaseOrderHqThreshold) };
      const [row] = await db.insert(assetInventorySettings).values({ ...dbInput, organizationId: scope.organizationId, createdByUserId: scope.userId }).onConflictDoUpdate({ target: assetInventorySettings.organizationId, set: { ...dbInput, updatedAt: new Date() } }).returning();
      await logAction(req, scope, "update", "Updated Assets & Inventory operating settings", "asset_inventory_settings", row.id);
      res.json(row);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/assets-inventory/returnable-issues", requireAuth, requirePermission("inventory.issue"), async (req, res) => {
    try {
      const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre");
      const input = z.object({ itemId: z.coerce.number().int().positive(), quantity: positiveQty, recipientType: text, recipientId: z.coerce.number().int().positive().optional().nullable(), recipientName: text, expectedReturnDate: dateText.optional().nullable(), fromLocationId: z.coerce.number().int().positive().optional().nullable(), notes: optionalText }).parse(req.body);
      const [item] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, input.itemId), eq(inventoryItems.centreId, scope.centreId!))).limit(1);
      if (!item || item.itemType !== "returnable") throw new Error("Select a returnable inventory item");
      const row = await db.transaction(async (tx) => {
        const [issue] = await tx.insert(inventoryReturnableIssues).values({ organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId!, referenceNumber: ref("RTI", scope.centre.code), itemId: item.id, quantityIssued: String(input.quantity), recipientType: input.recipientType, recipientId: input.recipientId, recipientName: input.recipientName, expectedReturnDate: input.expectedReturnDate, notes: input.notes, createdByUserId: scope.userId }).returning();
        await applyMovement(tx, scope, { itemId: item.id, movementType: "issue", quantity: input.quantity, unitCost: 0, batchNumber: null, expiryDate: null, fromLocationId: input.fromLocationId, toLocationId: null, recipientType: input.recipientType, recipientId: input.recipientId, reason: `Returnable issue ${issue.referenceNumber}`, notes: input.notes }, "returnable_issue", issue.id);
        return issue;
      });
      await reconcileLowStock(scope, [item.id]);
      await logAction(req, scope, "issue", `Issued returnable stock ${row.referenceNumber}`, "returnable_issue", row.id, row.recipientName);
      res.status(201).json(row);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/assets-inventory/returnable-issues/:id/return", requireAuth, requirePermission("inventory.issue"), async (req, res) => {
    try {
      const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre");
      const input = z.object({ quantity: positiveQty, toLocationId: z.coerce.number().int().positive().optional().nullable(), notes: optionalText }).parse(req.body);
      const row = await db.transaction(async (tx) => {
        const [issue] = await tx.select().from(inventoryReturnableIssues).where(and(eq(inventoryReturnableIssues.id, Number(req.params.id)), eq(inventoryReturnableIssues.centreId, scope.centreId!))).for("update").limit(1);
        if (!issue || !["issued", "partially_returned", "overdue"].includes(issue.status)) throw new Error("Open returnable issue not found");
        const outstanding = Number(issue.quantityIssued) - Number(issue.quantityReturned);
        if (input.quantity > outstanding) throw new Error("Return quantity exceeds the outstanding quantity");
        await applyMovement(tx, scope, { itemId: issue.itemId, movementType: "return", quantity: input.quantity, unitCost: 0, batchNumber: null, expiryDate: null, fromLocationId: null, toLocationId: input.toLocationId, recipientType: issue.recipientType, recipientId: issue.recipientId, reason: `Return against ${issue.referenceNumber}`, notes: input.notes }, "returnable_issue", issue.id);
        const returned = Number(issue.quantityReturned) + input.quantity;
        const [updated] = await tx.update(inventoryReturnableIssues).set({ quantityReturned: String(returned), lastReturnedAt: new Date(), status: returned >= Number(issue.quantityIssued) ? "returned" : "partially_returned", notes: input.notes || issue.notes, updatedAt: new Date() }).where(eq(inventoryReturnableIssues.id, issue.id)).returning();
        return updated;
      });
      await reconcileLowStock(scope, [row.itemId]);
      res.json(row);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/assets-inventory/assignments", requireAuth, requirePermission("assets.assign"), async (req, res) => {
    try { const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre"); const input = assignmentInput.parse(req.body); const [asset] = await db.select().from(assetRegister).where(and(eq(assetRegister.id, input.assetId), eq(assetRegister.currentCentreId, scope.centreId))).limit(1); if (!asset || asset.status !== "available") throw new Error("Asset is not available"); const row = await db.transaction(async (tx) => { const [assignment] = await tx.insert(assetAssignments).values({ ...input, organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId, createdByUserId: scope.userId, referenceNumber: ref("ASN", scope.centre.code) }).returning(); await tx.update(assetRegister).set({ status: "assigned", updatedAt: new Date() }).where(eq(assetRegister.id, asset.id)); return assignment; }); res.status(201).json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/assignments/:id/return", requireAuth, requirePermission("assets.assign"), async (req, res) => {
    try { const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre"); const conditionIn = z.string().default("good").parse(req.body?.conditionIn); const [assignment] = await db.select().from(assetAssignments).where(and(eq(assetAssignments.id, Number(req.params.id)), eq(assetAssignments.centreId, scope.centreId))).limit(1); if (!assignment || assignment.status !== "active") throw new Error("Active assignment not found"); await db.transaction(async (tx) => { await tx.update(assetAssignments).set({ status: "returned", returnedAt: new Date(), conditionIn, returnedByUserId: scope.userId, updatedAt: new Date() }).where(eq(assetAssignments.id, assignment.id)); await tx.update(assetRegister).set({ status: "available", condition: conditionIn, updatedAt: new Date() }).where(eq(assetRegister.id, assignment.assetId)); }); res.json({ ok: true }); } catch (error) { fail(res, error); }
  });

  app.post("/api/assets-inventory/damage-cases", requireAuth, requirePermission("damage.report"), async (req, res) => {
    try { const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre"); const input = damageInput.parse(req.body); const [row] = await db.insert(assetDamageCases).values({ ...input, proposedCharge: String(input.proposedCharge), organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId, createdByUserId: scope.userId, referenceNumber: ref("DMG", scope.centre.code) }).returning(); if (input.assetId) await db.update(assetRegister).set({ status: "damaged", updatedAt: new Date() }).where(and(eq(assetRegister.id, input.assetId), eq(assetRegister.currentCentreId, scope.centreId))); res.status(201).json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/damage-cases/:id/assess", requireAuth, requirePermission("damage.investigate"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ findings: text, classification: text, proposedCharge: money, status: z.string().default("charge_proposed") }).parse(req.body); const [row] = await db.update(assetDamageCases).set({ ...input, proposedCharge: String(input.proposedCharge), updatedAt: new Date() }).where(and(eq(assetDamageCases.id, Number(req.params.id)), eq(assetDamageCases.organizationId, scope.organizationId), scope.allCentres ? sql`true` : eq(assetDamageCases.centreId, scope.centreId!))).returning(); if (!row) throw new Error("Damage case not found"); res.json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/damage-cases/:id/approve", requireAuth, requirePermission("damage.approve_charge"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ approvedCharge: money, approvalNotes: optionalText }).parse(req.body); const [existing] = await db.select().from(assetDamageCases).where(and(eq(assetDamageCases.id, Number(req.params.id)), eq(assetDamageCases.organizationId, scope.organizationId))).limit(1); if (!existing) throw new Error("Damage case not found"); if (!scope.allCentres && existing.centreId !== scope.centreId) throw new Error("Damage case is outside your centre"); if (existing.createdByUserId === scope.userId) throw new Error("The reporter cannot approve their own charge"); const [row] = await db.update(assetDamageCases).set({ ...input, approvedCharge: String(input.approvedCharge), status: input.approvedCharge > 0 ? "approved" : "waived", approvedByUserId: scope.userId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(assetDamageCases.id, existing.id)).returning(); res.json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/damage-cases/:id/recoveries", requireAuth, requirePermission("damage.record_recovery"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = z.object({ amount: z.coerce.number().finite().positive(), paymentMethod: text, receiptNumber: optionalText, notes: optionalText }).parse(req.body); const row = await db.transaction(async (tx) => { const [damage] = await tx.select().from(assetDamageCases).where(and(eq(assetDamageCases.id, Number(req.params.id)), eq(assetDamageCases.organizationId, scope.organizationId))).for("update").limit(1); if (!damage || !["approved", "partially_settled"].includes(damage.status)) throw new Error("Approved damage charge not found"); if (!scope.allCentres && damage.centreId !== scope.centreId) throw new Error("Damage charge is outside your centre"); const outstanding = Number(damage.approvedCharge) - Number(damage.amountRecovered); if (input.amount > outstanding) throw new Error("Recovery exceeds the outstanding charge"); const centre = await tx.select().from(assetCentres).where(eq(assetCentres.id, damage.centreId!)).limit(1); const [recovery] = await tx.insert(assetDamageRecoveries).values({ ...input, amount: String(input.amount), damageCaseId: damage.id, schoolId: damage.schoolId, centreId: damage.centreId, referenceNumber: ref("RCV", centre[0]?.code || "CTR"), receivedByUserId: scope.userId }).returning(); const recovered = Number(damage.amountRecovered) + input.amount; await tx.update(assetDamageCases).set({ amountRecovered: String(recovered), status: recovered >= Number(damage.approvedCharge) ? "settled" : "partially_settled", updatedAt: new Date() }).where(eq(assetDamageCases.id, damage.id)); return recovery; }); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/assets-inventory/maintenance", requireAuth, requirePermission("assets.maintenance"), async (req, res) => {
    try { const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre"); const input = maintenanceInput.parse(req.body); const [row] = await db.insert(assetMaintenanceRecords).values({ ...input, estimatedCost: String(input.estimatedCost), actualCost: String(input.actualCost), organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId, createdByUserId: scope.userId, referenceNumber: ref("MNT", scope.centre.code) }).returning(); await db.update(assetRegister).set({ status: "maintenance", updatedAt: new Date() }).where(and(eq(assetRegister.id, input.assetId), eq(assetRegister.currentCentreId, scope.centreId))); res.status(201).json(row); } catch (error) { fail(res, error); }
  });
  app.put("/api/assets-inventory/maintenance/:id", requireAuth, requirePermission("assets.maintenance"), async (req, res) => {
    try { const scope = await scopeOf(req); const input = maintenanceInput.partial().parse(req.body); const { estimatedCost, actualCost, ...maintenanceValues } = input; const [row] = await db.update(assetMaintenanceRecords).set({ ...maintenanceValues, ...(estimatedCost !== undefined ? { estimatedCost: String(estimatedCost) } : {}), ...(actualCost !== undefined ? { actualCost: String(actualCost) } : {}), updatedAt: new Date() }).where(and(eq(assetMaintenanceRecords.id, Number(req.params.id)), eq(assetMaintenanceRecords.organizationId, scope.organizationId), scope.allCentres ? sql`true` : eq(assetMaintenanceRecords.centreId, scope.centreId!))).returning(); if (!row) throw new Error("Maintenance record not found"); if (input.status === "completed") await db.update(assetRegister).set({ status: "available", updatedAt: new Date() }).where(eq(assetRegister.id, row.assetId)); res.json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/stocktakes", requireAuth, requirePermission("inventory.stocktake"), async (req, res) => {
    try { const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre"); const input = z.object({ locationId: z.coerce.number().int().positive().optional().nullable(), countDate: dateText, notes: optionalText }).parse(req.body); const row = await db.transaction(async (tx) => { const [stocktake] = await tx.insert(inventoryStocktakes).values({ ...input, organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId, createdByUserId: scope.userId, referenceNumber: ref("STK", scope.centre.code) }).returning(); const items = await tx.select().from(inventoryItems).where(and(eq(inventoryItems.centreId, scope.centreId!), eq(inventoryItems.isActive, true))); if (items.length) await tx.insert(inventoryStocktakeLines).values(items.map((item) => ({ stocktakeId: stocktake.id, itemId: item.id, expectedQuantity: item.quantityOnHand }))); return stocktake; }); res.status(201).json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/assets-inventory/low-stock-alerts/:id/acknowledge", requireAuth, requirePermission("inventory.low_stock.view"), async (req, res) => {
    try { const scope = await scopeOf(req); const [row] = await db.update(inventoryLowStockAlerts).set({ status: "acknowledged", acknowledgedByUserId: scope.userId, acknowledgedAt: new Date(), updatedAt: new Date() }).where(and(eq(inventoryLowStockAlerts.id, Number(req.params.id)), eq(inventoryLowStockAlerts.organizationId, scope.organizationId), scope.allCentres ? sql`true` : eq(inventoryLowStockAlerts.centreId, scope.centreId!))).returning(); if (!row) throw new Error("Low-stock alert not found"); res.json(row); } catch (error) { fail(res, error); }
  });

  app.post("/api/assets-inventory/purchase-requests", requireAuth, requireAnyPermission("inventory.restock.request", "inventory.procurement.request"), async (req, res) => {
    try {
      const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre");
      const input = z.object({ department: optionalText, requiredDate: dateText.optional().nullable(), justification: text, urgency: z.enum(["low", "normal", "high", "critical"]).default("normal"), submit: z.boolean().default(true), lines: z.array(z.object({ itemId: z.coerce.number().int().positive().optional().nullable(), itemName: text, itemType: z.string().default("consumable"), quantity: positiveQty, unitOfMeasure: z.string().default("unit"), estimatedUnitCost: money.default(0), preferredSupplierId: z.coerce.number().int().positive().optional().nullable(), notes: optionalText })).min(1) }).parse(req.body);
      const row = await db.transaction(async (tx) => {
        const estimatedTotal = input.lines.reduce((sum, line) => sum + line.quantity * line.estimatedUnitCost, 0);
        const [request] = await tx.insert(inventoryPurchaseRequests).values({ organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId!, referenceNumber: ref("PR", scope.centre.code), department: input.department, requiredDate: input.requiredDate, justification: input.justification, urgency: input.urgency, status: input.submit ? "submitted" : "draft", estimatedTotal: String(estimatedTotal), requestedByUserId: scope.userId }).returning();
        await tx.insert(inventoryPurchaseRequestLines).values(input.lines.map((line) => ({ ...line, quantity: String(line.quantity), estimatedUnitCost: String(line.estimatedUnitCost), requestId: request.id })));
        return request;
      });
      if (row.status === "submitted") await notifyPermissionHolders(scope, ["inventory.restock.approve", "inventory.procurement.approve"], `Purchase request awaiting approval`, `${row.referenceNumber} requires approval for ${row.estimatedTotal}.`, `/assets-inventory?tab=procurement`, "info");
      res.status(201).json(row);
    } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/purchase-requests/:id/approve", requireAuth, requireAnyPermission("inventory.restock.approve", "inventory.procurement.approve"), async (req, res) => {
    try { const scope = await scopeOf(req); const approvalNotes = optionalText.parse(req.body?.approvalNotes); const [existing] = await db.select().from(inventoryPurchaseRequests).where(and(eq(inventoryPurchaseRequests.id, Number(req.params.id)), eq(inventoryPurchaseRequests.organizationId, scope.organizationId))).limit(1); if (!existing) throw new Error("Purchase request not found"); if (!scope.allCentres && existing.centreId !== scope.centreId) throw new Error("Purchase request is outside your centre"); if (existing.requestedByUserId === scope.userId) throw new Error("The requester cannot approve their own request"); const [settings] = await db.select().from(assetInventorySettings).where(eq(assetInventorySettings.organizationId, scope.organizationId)).limit(1); if (Number(existing.estimatedTotal) >= Number(settings?.purchaseOrderHqThreshold || 1000) && userOf(req).role !== "org_admin") throw new Error("This high-value request requires HQ approval"); const [row] = await db.update(inventoryPurchaseRequests).set({ status: "approved", approvedByUserId: scope.userId, approvedAt: new Date(), approvalNotes, updatedAt: new Date() }).where(eq(inventoryPurchaseRequests.id, existing.id)).returning(); res.json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/purchase-orders", requireAuth, requirePermission("inventory.procurement.order"), async (req, res) => {
    try {
      const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre");
      const input = z.object({ supplierId: z.coerce.number().int().positive(), expectedDeliveryDate: dateText.optional().nullable(), taxAmount: money.default(0), discountAmount: money.default(0), terms: optionalText, notes: optionalText, requestId: z.coerce.number().int().positive().optional().nullable(), submit: z.boolean().default(true), lines: z.array(z.object({ requestLineId: z.coerce.number().int().positive().optional().nullable(), itemId: z.coerce.number().int().positive().optional().nullable(), itemName: text, itemType: z.string().default("consumable"), orderedQuantity: positiveQty, unitOfMeasure: z.string().default("unit"), unitCost: money.default(0), notes: optionalText })).min(1) }).parse(req.body);
      const [supplier] = await db.select().from(inventorySuppliers).where(and(eq(inventorySuppliers.id, input.supplierId), eq(inventorySuppliers.organizationId, scope.organizationId), eq(inventorySuppliers.isActive, true))).limit(1);
      if (!supplier) throw new Error("Supplier not found in this organisation");
      if (input.requestId) {
        const [request] = await db.select().from(inventoryPurchaseRequests).where(and(eq(inventoryPurchaseRequests.id, input.requestId), eq(inventoryPurchaseRequests.organizationId, scope.organizationId), eq(inventoryPurchaseRequests.centreId, scope.centreId))).limit(1);
        if (!request) throw new Error("Purchase request not found in this centre");
        if (request.status !== "approved") throw new Error("Only an approved purchase request can be converted to a purchase order");
        const requestLineIds = new Set((await db.select({ id: inventoryPurchaseRequestLines.id }).from(inventoryPurchaseRequestLines).where(eq(inventoryPurchaseRequestLines.requestId, request.id))).map((line) => line.id));
        if (input.lines.some((line) => line.requestLineId && !requestLineIds.has(line.requestLineId))) throw new Error("A purchase order line does not belong to the selected purchase request");
      }
      const row = await db.transaction(async (tx) => {
        const subtotal = input.lines.reduce((sum, line) => sum + line.orderedQuantity * line.unitCost, 0);
        const total = subtotal + input.taxAmount - input.discountAmount;
        const [order] = await tx.insert(inventoryPurchaseOrders).values({ organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId!, purchaseRequestId: input.requestId, supplierId: input.supplierId, referenceNumber: ref("PO", scope.centre.code), status: input.submit ? "awaiting_approval" : "draft", expectedDeliveryDate: input.expectedDeliveryDate, subtotal: String(subtotal), taxAmount: String(input.taxAmount), discountAmount: String(input.discountAmount), totalAmount: String(total), terms: input.terms, notes: input.notes, createdByUserId: scope.userId }).returning();
        await tx.insert(inventoryPurchaseOrderLines).values(input.lines.map((line) => ({ ...line, orderedQuantity: String(line.orderedQuantity), unitCost: String(line.unitCost), purchaseOrderId: order.id })));
        if (input.requestId) await tx.update(inventoryPurchaseRequests).set({ status: "purchase_order_created", updatedAt: new Date() }).where(eq(inventoryPurchaseRequests.id, input.requestId));
        return order;
      });
      res.status(201).json(row);
    } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/purchase-orders/:id/approve", requireAuth, requirePermission("inventory.procurement.approve"), async (req, res) => {
    try { const scope = await scopeOf(req); const [existing] = await db.select().from(inventoryPurchaseOrders).where(and(eq(inventoryPurchaseOrders.id, Number(req.params.id)), eq(inventoryPurchaseOrders.organizationId, scope.organizationId))).limit(1); if (!existing) throw new Error("Purchase order not found"); if (!scope.allCentres && existing.centreId !== scope.centreId) throw new Error("Purchase order is outside your centre"); if (existing.status !== "awaiting_approval") throw new Error("Only a purchase order awaiting approval can be approved"); if (existing.createdByUserId === scope.userId) throw new Error("The creator cannot approve their own purchase order"); const [settings] = await db.select().from(assetInventorySettings).where(eq(assetInventorySettings.organizationId, scope.organizationId)).limit(1); if (Number(existing.totalAmount) >= Number(settings?.purchaseOrderHqThreshold || 1000) && userOf(req).role !== "org_admin") throw new Error("This high-value purchase order requires HQ approval"); const row = await db.transaction(async (tx) => { const [approved] = await tx.update(inventoryPurchaseOrders).set({ status: "approved", approvedByUserId: scope.userId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(inventoryPurchaseOrders.id, existing.id)).returning(); if (existing.purchaseRequestId) await tx.update(inventoryPurchaseRequests).set({ status: "ordered", updatedAt: new Date() }).where(eq(inventoryPurchaseRequests.id, existing.purchaseRequestId)); return approved; }); res.json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/goods-receipts", requireAuth, requirePermission("inventory.procurement.receive"), async (req, res) => {
    try {
      const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a centre");
      const input = z.object({ purchaseOrderId: z.coerce.number().int().positive().optional().nullable(), supplierId: z.coerce.number().int().positive().optional().nullable(), deliveryNoteNumber: optionalText, receivedDate: dateText, inspectionNotes: optionalText, lines: z.array(z.object({ purchaseOrderLineId: z.coerce.number().int().positive().optional().nullable(), itemId: z.coerce.number().int().positive().optional().nullable(), sku: optionalText, itemName: text, itemType: z.string().default("consumable"), assetClass: z.string().default("general"), quantityDelivered: positiveQty, quantityAccepted: nonNegativeQty, quantityRejected: nonNegativeQty.default(0), unitCost: money.default(0), batchNumber: optionalText, expiryDate: dateText.optional().nullable(), rejectionReason: optionalText })).min(1) }).parse(req.body);
      let purchaseOrder: typeof inventoryPurchaseOrders.$inferSelect | null = null;
      if (input.purchaseOrderId) {
        [purchaseOrder] = await db.select().from(inventoryPurchaseOrders).where(and(eq(inventoryPurchaseOrders.id, input.purchaseOrderId), eq(inventoryPurchaseOrders.organizationId, scope.organizationId), eq(inventoryPurchaseOrders.centreId, scope.centreId))).limit(1);
        if (!purchaseOrder) throw new Error("Purchase order not found in this centre");
        if (!["approved", "partially_received"].includes(purchaseOrder.status)) throw new Error("Only an approved purchase order can be received");
        if (input.supplierId && input.supplierId !== purchaseOrder.supplierId) throw new Error("The supplier does not match the selected purchase order");
      } else if (input.lines.some((line) => line.purchaseOrderLineId)) {
        throw new Error("Select the purchase order for every linked purchase order line");
      }
      const supplierId = purchaseOrder?.supplierId || input.supplierId || null;
      if (supplierId) {
        const [supplier] = await db.select().from(inventorySuppliers).where(and(eq(inventorySuppliers.id, supplierId), eq(inventorySuppliers.organizationId, scope.organizationId), eq(inventorySuppliers.isActive, true))).limit(1);
        if (!supplier) throw new Error("Supplier not found in this organisation");
      }
      const row = await db.transaction(async (tx) => {
        const orderLines = purchaseOrder ? await tx.select().from(inventoryPurchaseOrderLines).where(eq(inventoryPurchaseOrderLines.purchaseOrderId, purchaseOrder.id)).for("update") : [];
        const orderLineById = new Map(orderLines.map((line) => [line.id, line]));
        const [receipt] = await tx.insert(inventoryGoodsReceipts).values({ organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId!, purchaseOrderId: purchaseOrder?.id || null, supplierId, referenceNumber: ref("GRN", scope.centre.code), deliveryNoteNumber: input.deliveryNoteNumber, receivedDate: input.receivedDate, inspectionNotes: input.inspectionNotes, receivedByUserId: scope.userId }).returning();
        for (const line of input.lines) {
          if (line.quantityAccepted + line.quantityRejected > line.quantityDelivered) throw new Error(`Accepted and rejected quantities exceed delivery for ${line.itemName}`);
          let linkedOrderLine: typeof inventoryPurchaseOrderLines.$inferSelect | undefined;
          if (line.purchaseOrderLineId) {
            linkedOrderLine = orderLineById.get(line.purchaseOrderLineId);
            if (!linkedOrderLine) throw new Error(`Purchase order line for ${line.itemName} does not belong to the selected purchase order`);
            const remaining = Number(linkedOrderLine.orderedQuantity) - Number(linkedOrderLine.receivedQuantity);
            if (line.quantityAccepted > remaining) throw new Error(`Accepted quantity exceeds the outstanding purchase order quantity for ${line.itemName}`);
          }
          if (line.itemId) {
            const [item] = await tx.select().from(inventoryItems).where(and(eq(inventoryItems.id, line.itemId), eq(inventoryItems.organizationId, scope.organizationId), eq(inventoryItems.centreId, scope.centreId!))).limit(1);
            if (!item) throw new Error(`Inventory item for ${line.itemName} is outside the receiving centre`);
          }
          await tx.insert(inventoryGoodsReceiptLines).values({ goodsReceiptId: receipt.id, purchaseOrderLineId: line.purchaseOrderLineId, itemId: line.itemId, itemName: line.itemName, itemType: line.itemType, quantityDelivered: String(line.quantityDelivered), quantityAccepted: String(line.quantityAccepted), quantityRejected: String(line.quantityRejected), unitCost: String(line.unitCost), batchNumber: line.batchNumber, expiryDate: line.expiryDate, rejectionReason: line.rejectionReason });
          if (line.quantityAccepted > 0 && ["asset", "fixed_asset"].includes(line.itemType)) {
            if (!Number.isInteger(line.quantityAccepted)) throw new Error("Fixed asset receipt quantity must be a whole number");
            for (let index = 0; index < line.quantityAccepted; index += 1) {
              const assetNumber = `${cleanCode(scope.centre.code)}-${cleanCode(line.assetClass === "vehicle" ? "VEH" : "AST")}-${Date.now().toString().slice(-7)}-${index + 1}`;
              const [asset] = await tx.insert(assetRegister).values({ organizationId: scope.organizationId, schoolId: scope.schoolId, owningCentreId: scope.centreId, currentCentreId: scope.centreId, assetNumber, assetClass: line.assetClass, name: line.itemName, acquisitionDate: input.receivedDate, acquisitionCost: String(line.unitCost), currentValue: String(line.unitCost), supplierId, procurementReference: receipt.referenceNumber, status: "available", condition: "new", createdByUserId: scope.userId }).returning();
              if (line.assetClass === "vehicle") await tx.insert(assetVehicleDetails).values({ assetId: asset.id }).onConflictDoNothing();
            }
          } else if (line.quantityAccepted > 0) {
            let itemId = line.itemId || null;
            if (!itemId) {
              const sku = line.sku || cleanCode(line.itemName);
              const [existingItem] = await tx.select().from(inventoryItems).where(and(eq(inventoryItems.centreId, scope.centreId!), eq(inventoryItems.sku, sku))).limit(1);
              if (existingItem) itemId = existingItem.id;
              else {
                const [createdItem] = await tx.insert(inventoryItems).values({ organizationId: scope.organizationId, schoolId: scope.schoolId, centreId: scope.centreId, sku, name: line.itemName, itemType: line.itemType as any, unitOfMeasure: "unit", preferredSupplierId: supplierId, unitCost: String(line.unitCost), quantityOnHand: "0", reorderEnabled: true, createdByUserId: scope.userId }).returning();
                itemId = createdItem.id;
              }
            }
            await applyMovement(tx, scope, { itemId, movementType: "receipt", quantity: line.quantityAccepted, unitCost: line.unitCost, batchNumber: line.batchNumber, expiryDate: line.expiryDate, fromLocationId: null, toLocationId: null, recipientType: null, recipientId: null, reason: `Goods receipt ${receipt.referenceNumber}`, notes: input.inspectionNotes }, "goods_receipt", receipt.id);
          }
          if (linkedOrderLine) await tx.update(inventoryPurchaseOrderLines).set({ receivedQuantity: String(Number(linkedOrderLine.receivedQuantity) + line.quantityAccepted) }).where(eq(inventoryPurchaseOrderLines.id, linkedOrderLine.id));
        }
        if (purchaseOrder) {
          const refreshedLines = await tx.select().from(inventoryPurchaseOrderLines).where(eq(inventoryPurchaseOrderLines.purchaseOrderId, purchaseOrder.id));
          const complete = refreshedLines.length > 0 && refreshedLines.every((line) => Number(line.receivedQuantity) >= Number(line.orderedQuantity));
          await tx.update(inventoryPurchaseOrders).set({ status: complete ? "fully_received" : "partially_received", updatedAt: new Date() }).where(eq(inventoryPurchaseOrders.id, purchaseOrder.id));
          if (complete && purchaseOrder.purchaseRequestId) await tx.update(inventoryPurchaseRequests).set({ status: "received", updatedAt: new Date() }).where(eq(inventoryPurchaseRequests.id, purchaseOrder.purchaseRequestId));
        }
        return receipt;
      });
      await reconcileLowStock(scope);
      res.status(201).json(row);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/assets-inventory/centre-transfers", requireAuth, requireAnyPermission("assets.transfer", "inventory.transfer.request"), async (req, res) => {
    try {
      const scope = await scopeOf(req); if (!scope.centreId) throw new Error("Select a source centre");
      const input = z.object({ destinationCentreId: z.coerce.number().int().positive(), sourceLocationId: z.coerce.number().int().positive().optional().nullable(), destinationLocationId: z.coerce.number().int().positive().optional().nullable(), transportDetails: optionalText, notes: optionalText, submit: z.boolean().default(true), lines: z.array(z.object({ lineType: z.enum(["asset", "inventory"]), assetId: z.coerce.number().int().positive().optional().nullable(), itemId: z.coerce.number().int().positive().optional().nullable(), quantity: positiveQty.default(1), conditionDispatched: optionalText })).min(1) }).parse(req.body);
      if (input.destinationCentreId === scope.centreId) throw new Error("Source and destination centres must be different");
      const [destination] = await db.select().from(assetCentres).where(and(eq(assetCentres.id, input.destinationCentreId), eq(assetCentres.organizationId, scope.organizationId), eq(assetCentres.isActive, true))).limit(1);
      if (!destination) throw new Error("Destination centre not found");
      for (const line of input.lines) {
        if (line.lineType === "asset" && !line.assetId) throw new Error("Select an asset for every asset line");
        if (line.lineType === "inventory" && !line.itemId) throw new Error("Select an inventory item for every inventory line");
      }
      const row = await db.transaction(async (tx) => {
        const [transfer] = await tx.insert(assetCentreTransfers).values({ organizationId: scope.organizationId, referenceNumber: ref("TRF", scope.centre.code), sourceCentreId: scope.centreId!, destinationCentreId: destination.id, sourceLocationId: input.sourceLocationId, destinationLocationId: input.destinationLocationId, status: input.submit ? "requested" : "draft", requestedByUserId: scope.userId, transportDetails: input.transportDetails, notes: input.notes }).returning();
        await tx.insert(assetCentreTransferLines).values(input.lines.map((line) => ({ ...line, quantity: String(line.quantity), transferId: transfer.id })));
        return transfer;
      });
      if (row.status === "requested") await notifyPermissionHolders(scope, ["inventory.transfer.approve", "assets.manage.organization"], `Centre transfer awaiting approval`, `${row.referenceNumber} is awaiting approval.`, `/assets-inventory?tab=transfers`, "info");
      res.status(201).json(row);
    } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/centre-transfers/:id/approve", requireAuth, requireAnyPermission("inventory.transfer.approve", "assets.manage.organization"), async (req, res) => {
    try { const scope = await scopeOf(req); const [existing] = await db.select().from(assetCentreTransfers).where(and(eq(assetCentreTransfers.id, Number(req.params.id)), eq(assetCentreTransfers.organizationId, scope.organizationId))).limit(1); if (!existing) throw new Error("Transfer not found"); if (!scope.allCentres && existing.sourceCentreId !== scope.centreId && !(await hasPermission(scope.userId, "assets.manage.organization"))) throw new Error("Transfer is outside your approval scope"); if (existing.requestedByUserId === scope.userId) throw new Error("The requester cannot approve their own transfer"); const [row] = await db.update(assetCentreTransfers).set({ status: "approved", approvedByUserId: scope.userId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(assetCentreTransfers.id, existing.id)).returning(); res.json(row); } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/centre-transfers/:id/dispatch", requireAuth, requireAnyPermission("inventory.transfer.dispatch", "assets.transfer"), async (req, res) => {
    try {
      const scope = await scopeOf(req); const transferId = Number(req.params.id);
      const row = await db.transaction(async (tx) => {
        const [transfer] = await tx.select().from(assetCentreTransfers).where(and(eq(assetCentreTransfers.id, transferId), eq(assetCentreTransfers.organizationId, scope.organizationId))).for("update").limit(1);
        if (!transfer || transfer.status !== "approved") throw new Error("Approved transfer not found");
        if (!scope.allCentres && transfer.sourceCentreId !== scope.centreId) throw new Error("Only the source centre can dispatch this transfer");
        const [sourceCentre] = await tx.select().from(assetCentres).where(eq(assetCentres.id, transfer.sourceCentreId)).limit(1);
        if (!sourceCentre) throw new Error("Source centre not found");
        const transferScope: AssetScope = { ...scope, centreId: transfer.sourceCentreId, schoolId: sourceCentre.schoolId, centre: sourceCentre, allCentres: false };
        const lines = await tx.select().from(assetCentreTransferLines).where(eq(assetCentreTransferLines.transferId, transfer.id));
        for (const line of lines) {
          if (line.lineType === "asset" && line.assetId) {
            const [asset] = await tx.select().from(assetRegister).where(and(eq(assetRegister.id, line.assetId), eq(assetRegister.currentCentreId, transfer.sourceCentreId))).for("update").limit(1);
            if (!asset || !["available", "assigned"].includes(asset.status)) throw new Error("An asset is not available for transfer");
            await tx.update(assetRegister).set({ status: "in_transit", updatedAt: new Date() }).where(eq(assetRegister.id, asset.id));
          } else if (line.itemId) {
            await applyMovement(tx, transferScope, { itemId: line.itemId, movementType: "issue", quantity: Number(line.quantity), unitCost: 0, batchNumber: null, expiryDate: null, fromLocationId: transfer.sourceLocationId, toLocationId: null, recipientType: "centre_transfer", recipientId: transfer.destinationCentreId, reason: `Transfer ${transfer.referenceNumber}`, notes: transfer.notes }, "centre_transfer", transfer.id);
          }
          await tx.update(assetCentreTransferLines).set({ status: "in_transit" }).where(eq(assetCentreTransferLines.id, line.id));
        }
        const [updated] = await tx.update(assetCentreTransfers).set({ status: "dispatched", dispatchedByUserId: scope.userId, dispatchedAt: new Date(), updatedAt: new Date() }).where(eq(assetCentreTransfers.id, transfer.id)).returning();
        return updated;
      });
      res.json(row);
    } catch (error) { fail(res, error); }
  });
  app.post("/api/assets-inventory/centre-transfers/:id/receive", requireAuth, requireAnyPermission("inventory.transfer.receive", "assets.transfer"), async (req, res) => {
    try {
      const scope = await scopeOf(req); const transferId = Number(req.params.id);
      const input = z.object({ lines: z.array(z.object({ lineId: z.coerce.number().int().positive(), quantityReceived: nonNegativeQty, conditionReceived: optionalText, varianceNotes: optionalText })).default([]) }).parse(req.body || {});
      const receiveById = new Map(input.lines.map((line) => [line.lineId, line]));
      const row = await db.transaction(async (tx) => {
        const [transfer] = await tx.select().from(assetCentreTransfers).where(and(eq(assetCentreTransfers.id, transferId), eq(assetCentreTransfers.organizationId, scope.organizationId))).for("update").limit(1);
        if (!transfer || !["dispatched", "in_transit", "partially_received"].includes(transfer.status)) throw new Error("Dispatched transfer not found");
        if (!scope.allCentres && transfer.destinationCentreId !== scope.centreId) throw new Error("Only the destination centre can receive this transfer");
        const [destinationCentre] = await tx.select().from(assetCentres).where(eq(assetCentres.id, transfer.destinationCentreId)).limit(1);
        if (!destinationCentre) throw new Error("Destination centre not found");
        const destinationScope: AssetScope = { ...scope, centreId: transfer.destinationCentreId, schoolId: destinationCentre.schoolId, centre: destinationCentre, allCentres: false };
        const lines = await tx.select().from(assetCentreTransferLines).where(eq(assetCentreTransferLines.transferId, transfer.id));
        for (const line of lines) {
          const received = receiveById.get(line.id);
          const quantityReceived = received ? received.quantityReceived : Number(line.quantity);
          if (quantityReceived > Number(line.quantity)) throw new Error("Received quantity exceeds dispatched quantity");
          if (line.lineType === "asset" && line.assetId) {
            await tx.update(assetRegister).set({ currentCentreId: transfer.destinationCentreId, schoolId: destinationCentre.schoolId, locationId: transfer.destinationLocationId, status: "available", condition: received?.conditionReceived || line.conditionDispatched || "good", updatedAt: new Date() }).where(eq(assetRegister.id, line.assetId));
          } else if (line.itemId && quantityReceived > 0) {
            const [sourceItem] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, line.itemId)).limit(1);
            if (!sourceItem) throw new Error("Source inventory item not found");
            let [destinationItem] = await tx.select().from(inventoryItems).where(and(eq(inventoryItems.centreId, transfer.destinationCentreId), eq(inventoryItems.sku, sourceItem.sku))).limit(1);
            if (!destinationItem) {
              [destinationItem] = await tx.insert(inventoryItems).values({ organizationId: sourceItem.organizationId, schoolId: destinationCentre.schoolId, centreId: transfer.destinationCentreId, sku: sourceItem.sku, name: sourceItem.name, itemType: sourceItem.itemType, categoryId: sourceItem.categoryId, defaultLocationId: transfer.destinationLocationId, preferredSupplierId: sourceItem.preferredSupplierId, unitOfMeasure: sourceItem.unitOfMeasure, purchaseUnit: sourceItem.purchaseUnit, issueUnit: sourceItem.issueUnit, unitConversionFactor: sourceItem.unitConversionFactor, quantityOnHand: "0", reorderEnabled: sourceItem.reorderEnabled, reorderLevel: sourceItem.reorderLevel, criticalStockLevel: sourceItem.criticalStockLevel, targetStockLevel: sourceItem.targetStockLevel, preferredReorderQuantity: sourceItem.preferredReorderQuantity, supplierLeadTimeDays: sourceItem.supplierLeadTimeDays, unitCost: sourceItem.unitCost, batchTrackingEnabled: sourceItem.batchTrackingEnabled, expiryTrackingEnabled: sourceItem.expiryTrackingEnabled, description: sourceItem.description, createdByUserId: scope.userId }).returning();
            }
            await applyMovement(tx, destinationScope, { itemId: destinationItem.id, movementType: "receipt", quantity: quantityReceived, unitCost: Number(sourceItem.unitCost), batchNumber: null, expiryDate: null, fromLocationId: null, toLocationId: transfer.destinationLocationId, recipientType: "centre_transfer", recipientId: transfer.sourceCentreId, reason: `Transfer ${transfer.referenceNumber}`, notes: received?.varianceNotes || transfer.notes }, "centre_transfer", transfer.id);
            await tx.update(assetCentreTransferLines).set({ destinationItemId: destinationItem.id }).where(eq(assetCentreTransferLines.id, line.id));
          }
          await tx.update(assetCentreTransferLines).set({ quantityReceived: String(quantityReceived), conditionReceived: received?.conditionReceived, varianceNotes: received?.varianceNotes, status: quantityReceived === Number(line.quantity) ? "received" : "variance" }).where(eq(assetCentreTransferLines.id, line.id));
        }
        const [updated] = await tx.update(assetCentreTransfers).set({ status: "received", receivedByUserId: scope.userId, receivedAt: new Date(), updatedAt: new Date() }).where(eq(assetCentreTransfers.id, transfer.id)).returning();
        return updated;
      });
      await reconcileLowStock(scope);
      res.json(row);
    } catch (error) { fail(res, error); }
  });

  app.get("/api/assets-inventory/reports/stock.csv", requireAuth, requirePermission("inventory.reports"), async (req, res) => {
    try { const scope = await scopeOf(req); const rows = await db.select({ item: inventoryItems, centreName: assetCentres.name }).from(inventoryItems).leftJoin(assetCentres, eq(assetCentres.id, inventoryItems.centreId)).where(scopedCondition(inventoryItems, scope)).orderBy(asc(inventoryItems.name)); const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`; const csv = ["Centre,SKU,Item,Type,Unit,Quantity,Reorder Level,Target Stock,Unit Cost", ...rows.map(({ item, centreName }) => [centreName, item.sku, item.name, item.itemType, item.unitOfMeasure, item.quantityOnHand, item.reorderLevel, item.targetStockLevel, item.unitCost].map(escape).join(","))].join("\n"); res.setHeader("Content-Type", "text/csv"); res.setHeader("Content-Disposition", 'attachment; filename="inventory-stock.csv"'); res.send(csv); } catch (error) { fail(res, error); }
  });
}
