import { db } from "./db";
import { RBAC_PERMISSIONS_DATA } from "./rbac-config";
import { accessGroupPermissions, accessGroups, permissions, userPermissionOverrides, users } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { storage } from "./storage";

async function ensurePermissionsCatalog() {
  for (const permission of RBAC_PERMISSIONS_DATA) {
    const [existing] = await db
      .select()
      .from(permissions)
      .where(eq(permissions.code, permission.code));

    if (!existing) {
      await db.insert(permissions).values(permission);
      continue;
    }

    if (
      existing.name !== permission.name ||
      existing.description !== permission.description ||
      existing.category !== permission.category
    ) {
      await db
        .update(permissions)
        .set({
          name: permission.name,
          description: permission.description,
          category: permission.category,
        })
        .where(eq(permissions.id, existing.id));
    }
  }
}

const RETIRED_PERMISSION_CODES = [
  "discussion_forum.view",
  "schemes.view",
  "schemes.create",
  "schemes.edit",
  "schemes.delete",
] as const;

async function removeRetiredPermissions() {
  const retired = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.code, [...RETIRED_PERMISSION_CODES]));

  const retiredIds = retired.map((permission) => permission.id);
  if (!retiredIds.length) return;

  await db.delete(accessGroupPermissions).where(inArray(accessGroupPermissions.permissionId, retiredIds));
  await db.delete(userPermissionOverrides).where(inArray(userPermissionOverrides.permissionId, retiredIds));
  await db.delete(permissions).where(inArray(permissions.id, retiredIds));
}


const TRANSPORT_MANAGER_PERMISSIONS = [
  "transport.view", "transport.dashboard.view",
  "transport.routes.create", "transport.routes.edit", "transport.stops.manage", "transport.paths.manage",
  "transport.vehicles.create", "transport.vehicles.edit", "transport.drivers.manage", "transport.owners.manage",
  "transport.learners.enrol", "transport.learners.edit_service", "transport.learners.transfer",
  "transport.charges.view", "transport.charges.generate", "transport.payments.view", "transport.receipts.view", "transport.receipts.verify",
  "transport.payment_plans.manage", "transport.refunds.request", "transport.cashups.prepare",
  "transport.incidents.manage", "transport.claims.view", "transport.claims.generate", "transport.claims.submit", "transport.claims.verify",
  "transport.advances.request", "transport.payouts.view", "transport.reports.view", "transport.audit.view",
];

const ACCOUNTANT_TRANSPORT_PERMISSIONS = [
  "transport.view", "transport.dashboard.view", "transport.charges.view", "transport.charges.generate", "transport.charges.adjust",
  "transport.payments.view", "transport.payments.record", "transport.payments.verify", "transport.payments.reverse",
  "transport.receipts.view", "transport.receipts.verify", "transport.payment_plans.manage",
  "transport.refunds.request", "transport.refunds.approve", "transport.refunds.pay",
  "transport.cashups.prepare", "transport.cashups.verify", "transport.claims.view", "transport.claims.verify", "transport.claims.approve",
  "transport.penalties.manage", "transport.advances.request", "transport.advances.approve", "transport.advances.disburse", "transport.payouts.view", "transport.payouts.generate", "transport.payouts.pay",
  "transport.periods.lock", "transport.reports.view", "transport.audit.view",
];

async function ensureAccessGroupPermissions(groupName: string, permissionCodes: string[], createIfMissing = false, description?: string) {
  let [group] = await db.select().from(accessGroups).where(eq(accessGroups.name, groupName));
  if (!group && createIfMissing) {
    [group] = await db.insert(accessGroups).values({
      name: groupName,
      description: description || "System access group managed by the FCGS permission bootstrap.",
      isSystemDefault: true,
    }).returning();
  }
  if (!group) return;

  const permissionRows = await db.select({ id: permissions.id }).from(permissions).where(inArray(permissions.code, permissionCodes));
  if (!permissionRows.length) return;
  await db.insert(accessGroupPermissions).values(
    permissionRows.map((permission) => ({ accessGroupId: group.id, permissionId: permission.id })),
  ).onConflictDoNothing();
}

const ORG_HQ_TRANSPORT_OVERSIGHT_PERMISSIONS = [
  "transport.view", "transport.dashboard.view", "transport.charges.view", "transport.payments.view",
  "transport.receipts.view", "transport.claims.view", "transport.payouts.view", "transport.reports.view", "transport.audit.view",
  "transport.organization.view", "transport.organization.reports", "transport.organization.export",
];

async function replaceAccessGroupPermissionSubset(groupName: string, prefix: string, allowedCodes: string[]) {
  const [group] = await db.select().from(accessGroups).where(eq(accessGroups.name, groupName));
  if (!group) return;
  const allRows = await db.select({ id: permissions.id, code: permissions.code }).from(permissions);
  const matchingIds = allRows.filter((row) => row.code.startsWith(prefix)).map((row) => row.id);
  if (matchingIds.length) {
    await db.delete(accessGroupPermissions).where(and(
      eq(accessGroupPermissions.accessGroupId, group.id),
      inArray(accessGroupPermissions.permissionId, matchingIds),
    ));
  }
  await ensureAccessGroupPermissions(groupName, allowedCodes);
}

async function ensureTransportAccessGroupDefaults() {
  const allTransportCodes = RBAC_PERMISSIONS_DATA.filter((permission) => permission.code.startsWith("transport.")).map((permission) => permission.code);
  await ensureAccessGroupPermissions("School Admin", allTransportCodes);
  await replaceAccessGroupPermissionSubset("Org HQ", "transport.", ORG_HQ_TRANSPORT_OVERSIGHT_PERMISSIONS);
  await ensureAccessGroupPermissions("Accountant", ACCOUNTANT_TRANSPORT_PERMISSIONS);
  await ensureAccessGroupPermissions(
    "Transport Manager",
    TRANSPORT_MANAGER_PERMISSIONS,
    true,
    "Manages school transport operations, learner services, path setup, claims verification and transport reporting.",
  );
  await ensureAccessGroupPermissions("Quality Control Officer", ["transport.view", "transport.dashboard.view", "transport.reports.view", "transport.audit.view"]);
}

const ASSET_INVENTORY_OFFICER_PERMISSIONS = [
  "assets.view", "assets.create", "assets.edit", "assets.assign", "assets.transfer", "assets.maintenance", "assets.reports", "assets.setup.manage",
  "inventory.view", "inventory.items.manage", "inventory.receive", "inventory.issue", "inventory.adjust", "inventory.stocktake", "inventory.reports", "inventory.low_stock.view",
  "inventory.restock.request", "inventory.procurement.view", "inventory.procurement.request", "inventory.procurement.order", "inventory.procurement.receive",
  "inventory.transfer.request", "inventory.transfer.dispatch", "inventory.transfer.receive",
  "damage.view", "damage.report", "damage.investigate", "damage.reports",
];

async function ensureAssetsInventoryAccessGroupDefaults() {
  const allCodes = RBAC_PERMISSIONS_DATA.filter((permission) => ["assets.", "inventory.", "damage."].some((prefix) => permission.code.startsWith(prefix))).map((permission) => permission.code);
  await ensureAccessGroupPermissions("School Admin", allCodes);
  await ensureAccessGroupPermissions("Org HQ", allCodes);
  await ensureAccessGroupPermissions("Assets & Inventory Officer", ASSET_INVENTORY_OFFICER_PERMISSIONS, true, "Manages asset registers, stores, stock movements, procurement receipts, centre transfers, maintenance and damage reporting.");
  await ensureAccessGroupPermissions("Accountant", ["assets.view", "assets.reports", "inventory.view", "inventory.reports", "inventory.low_stock.view", "inventory.procurement.view", "inventory.procurement.approve", "inventory.procurement.order", "damage.view", "damage.approve_charge", "damage.record_recovery", "damage.reports"]);
  await ensureAccessGroupPermissions("Teacher", ["assets.view", "damage.view", "damage.report"]);
}

async function ensurePhotoAccessGroupDefaults() {
  const adminPhotoPermissions = ["students.manage_photo", "staff.manage_photo", "parents.manage_photo", "users.manage_photo"];
  await ensureAccessGroupPermissions("School Admin", adminPhotoPermissions);
  await ensureAccessGroupPermissions("Org HQ", adminPhotoPermissions);
  await ensureAccessGroupPermissions("Teacher", ["students.manage_photo"]);
  await ensureAccessGroupPermissions("Assistant Teacher", ["students.manage_photo"]);
}

async function cleanupLegacyBlanketAdminOverrides() {
  const allPermissions = await db.select({ id: permissions.id }).from(permissions);
  const allPermissionIds = allPermissions.map((permission) => permission.id).sort((a, b) => a - b);
  if (allPermissionIds.length === 0) return;

  const adminUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.role, ["org_admin", "school_admin"]));

  for (const adminUser of adminUsers) {
    const overrides = await db
      .select({ permissionId: userPermissionOverrides.permissionId, granted: userPermissionOverrides.granted })
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, adminUser.id));

    if (overrides.length !== allPermissionIds.length) continue;
    if (overrides.some((override) => override.granted !== true)) continue;

    const overridePermissionIds = overrides
      .map((override) => override.permissionId)
      .sort((a, b) => a - b);

    const isLegacyBlanketGrant = overridePermissionIds.every((permissionId, index) => permissionId === allPermissionIds[index]);
    if (!isLegacyBlanketGrant) continue;

    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, adminUser.id));
  }
}

export async function ensureRbacBaseline() {
  await ensurePermissionsCatalog();
  await removeRetiredPermissions();
  await ensureTransportAccessGroupDefaults();
  await ensureAssetsInventoryAccessGroupDefaults();
  await ensurePhotoAccessGroupDefaults();
  await cleanupLegacyBlanketAdminOverrides();
  await storage.normalizeAllUserBaselineAccessGroups();
}
