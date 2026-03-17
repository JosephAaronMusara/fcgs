import { db } from "./db";
import { RBAC_PERMISSIONS_DATA } from "./rbac-config";
import { permissions, userPermissionOverrides, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

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
  await cleanupLegacyBlanketAdminOverrides();
}
