import { db } from "./db";
import { RBAC_PERMISSIONS_DATA } from "./rbac-config";
import { accessGroupPermissions, accessGroups, permissions, userPermissionOverrides, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
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

async function ensureAccessGroupPermissions(groupName: string, permissionCodes: string[], createIfMissing = false) {
  let [group] = await db.select().from(accessGroups).where(eq(accessGroups.name, groupName));
  if (!group && createIfMissing) {
    [group] = await db.insert(accessGroups).values({
      name: groupName,
      description: "Manages school transport operations, learner services, path setup, claims verification and transport reporting.",
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

async function ensureTransportAccessGroupDefaults() {
  const allTransportCodes = RBAC_PERMISSIONS_DATA.filter((permission) => permission.code.startsWith("transport.")).map((permission) => permission.code);
  await ensureAccessGroupPermissions("School Admin", allTransportCodes);
  await ensureAccessGroupPermissions("Org HQ", allTransportCodes);
  await ensureAccessGroupPermissions("Accountant", ACCOUNTANT_TRANSPORT_PERMISSIONS);
  await ensureAccessGroupPermissions("Transport Manager", TRANSPORT_MANAGER_PERMISSIONS, true);
  await ensureAccessGroupPermissions("Quality Control Officer", ["transport.view", "transport.dashboard.view", "transport.reports.view", "transport.audit.view"]);
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
  await ensureTransportAccessGroupDefaults();
  await cleanupLegacyBlanketAdminOverrides();
  await storage.normalizeAllUserBaselineAccessGroups();
}
