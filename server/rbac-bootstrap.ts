import { db } from "./db";
import { RBAC_PERMISSIONS_DATA } from "./rbac-config";
import { accessGroupPermissions, accessGroups, permissions } from "@shared/schema";
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


const TRANSPORT_MANAGER_PERMISSIONS = [
  "transport.view", "transport.dashboard.view",
  "transport.routes.create", "transport.routes.edit", "transport.stops.manage", "transport.paths.manage",
  "transport.vehicles.create", "transport.vehicles.edit", "transport.drivers.manage", "transport.owners.manage",
  "transport.documents.view", "transport.documents.manage", "transport.compliance.view", "transport.compliance.manage",
  "transport.learners.enrol", "transport.learners.edit_service", "transport.learners.transfer",
  "transport.charges.view", "transport.charges.generate", "transport.payments.view", "transport.receipts.view", "transport.receipts.verify",
  "transport.refunds.request", "transport.cashups.prepare",
  "transport.incidents.manage", "transport.claims.view", "transport.claims.generate", "transport.claims.submit", "transport.claims.verify",
  "transport.advances.request", "transport.payouts.view", "transport.reports.view", "transport.audit.view",
];

const RECEPTIONIST_TRANSPORT_PERMISSIONS = [
  "transport.view", "transport.dashboard.view", "transport.charges.view",
  "transport.payments.view", "transport.payments.record", "transport.receipts.view",
  "transport.refunds.request", "transport.cashups.prepare",
];

const ACCOUNTANT_TRANSPORT_PERMISSIONS = [
  "transport.view", "transport.dashboard.view", "transport.charges.view", "transport.charges.generate", "transport.charges.adjust",
  "transport.payments.view", "transport.payments.record", "transport.payments.verify", "transport.payments.reverse",
  "transport.receipts.view", "transport.receipts.verify",
  "transport.refunds.request", "transport.refunds.approve", "transport.refunds.pay",
  "transport.cashups.prepare", "transport.cashups.verify", "transport.claims.view", "transport.claims.verify", "transport.claims.approve",
  "transport.penalties.manage", "transport.advances.request", "transport.advances.approve", "transport.advances.disburse", "transport.payouts.view", "transport.payouts.generate", "transport.payouts.pay",
  "transport.periods.lock", "transport.reports.view", "transport.audit.view",
];

// Existing access-group permission mappings are administrator-owned configuration.
// Baseline startup may seed permissions only for a group that it creates during this
// same bootstrap run; it must never add/remove rights on a group that already exists.
const accessGroupsCreatedThisBootstrap = new Set<number>();

async function ensureAccessGroupPermissions(groupName: string, permissionCodes: string[], createIfMissing = false, description?: string) {
  let [group] = await db.select().from(accessGroups).where(eq(accessGroups.name, groupName));
  if (!group && createIfMissing) {
    [group] = await db.insert(accessGroups).values({
      name: groupName,
      description: description || "System access group managed by the FCGS permission bootstrap.",
      isSystemDefault: true,
    }).returning();
    accessGroupsCreatedThisBootstrap.add(group.id);
  }
  if (!group || !accessGroupsCreatedThisBootstrap.has(group.id)) return;

  const permissionRows = await db.select({ id: permissions.id }).from(permissions).where(inArray(permissions.code, permissionCodes));
  if (!permissionRows.length) return;
  await db.insert(accessGroupPermissions).values(
    permissionRows.map((permission) => ({ accessGroupId: group.id, permissionId: permission.id })),
  ).onConflictDoNothing();
}

const ORG_HQ_TRANSPORT_OVERSIGHT_PERMISSIONS = [
  "transport.view", "transport.dashboard.view", "transport.charges.view", "transport.payments.view",
  "transport.receipts.view", "transport.claims.view", "transport.payouts.view", "transport.reports.view", "transport.audit.view",
  "transport.documents.view", "transport.compliance.view",
  "transport.organization.view", "transport.organization.reports", "transport.organization.export", "transport.organization.manage",
  "transport.subscription.manage", "transport.hq.claims.manage", "transport.hq.payouts.manage", "transport.hq.disbursements.manage", "transport.hq.settings.manage",
];

async function ensureTransportAccessGroupDefaults() {
  const allTransportCodes = RBAC_PERMISSIONS_DATA.filter((permission) => permission.code.startsWith("transport.")).map((permission) => permission.code);
  await ensureAccessGroupPermissions("School Admin", allTransportCodes);
  await ensureAccessGroupPermissions("Org HQ", ORG_HQ_TRANSPORT_OVERSIGHT_PERMISSIONS);
  await ensureAccessGroupPermissions("Accountant", ACCOUNTANT_TRANSPORT_PERMISSIONS);
  await ensureAccessGroupPermissions(
    "Receptionist",
    RECEPTIONIST_TRANSPORT_PERMISSIONS,
    true,
    "Records school transport receipts and prepares blind daily cash handovers without cash-up verification authority.",
  );
  await ensureAccessGroupPermissions(
    "Transport Manager",
    TRANSPORT_MANAGER_PERMISSIONS,
    true,
    "Manages school transport operations, learner services, path setup, claims verification and transport reporting.",
  );
  await ensureAccessGroupPermissions("Quality Control Officer", ["transport.view", "transport.dashboard.view", "transport.reports.view", "transport.audit.view"]);
  await ensureAccessGroupPermissions("School Admin", ["students.classroom.assign", "students.restore_transferred"]);
}


const RECRUITMENT_MANAGER_PERMISSIONS = RBAC_PERMISSIONS_DATA
  .filter((permission) => permission.code.startsWith("recruitment."))
  .map((permission) => permission.code);

async function ensureRecruitmentAccessGroupDefaults() {
  await ensureAccessGroupPermissions("Org HQ", RECRUITMENT_MANAGER_PERMISSIONS);
  await ensureAccessGroupPermissions(
    "Recruitment Manager",
    RECRUITMENT_MANAGER_PERMISSIONS,
    true,
    "Manages staff vacancies, screening requirements, private applicant documents, interviews and recruitment settings.",
  );
  await ensureAccessGroupPermissions("School Admin", [
    "recruitment.view",
    "recruitment.vacancies.manage",
    "recruitment.applications.review",
    "recruitment.applications.process",
    "recruitment.documents.view",
    "recruitment.documents.manage",
    "recruitment.interviews.manage",
  ]);
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

const FLEET_MANAGER_PERMISSIONS = RBAC_PERMISSIONS_DATA
  .filter((permission) => permission.code.startsWith("fleet."))
  .map((permission) => permission.code);

async function ensureFleetAccessGroupDefaults() {
  await ensureAccessGroupPermissions("School Admin", FLEET_MANAGER_PERMISSIONS);
  await ensureAccessGroupPermissions("Org HQ", FLEET_MANAGER_PERMISSIONS);
  await ensureAccessGroupPermissions("Fleet Manager", FLEET_MANAGER_PERMISSIONS, true, "Manages organisation Fleet vehicles, drivers, allocations, trips, inspections, maintenance, compliance, incidents and operating records.");
  await ensureAccessGroupPermissions("Transport Manager", [
    "fleet.view", "fleet.dashboard.view", "fleet.requests.create", "fleet.requests.manage", "fleet.trips.manage",
    "fleet.inspections.perform", "fleet.incidents.create", "fleet.compliance.view",
  ]);
  const requestOnly = ["fleet.view", "fleet.requests.create", "fleet.incidents.create"];
  for (const group of ["Teacher", "Assistant Teacher", "Accountant", "Librarian", "Quality Control Officer"]) {
    await ensureAccessGroupPermissions(group, requestOnly);
  }
}

async function ensureAccessControlDefaults() {
  const codes = RBAC_PERMISSIONS_DATA
    .filter((permission) => permission.code.startsWith("access_control."))
    .map((permission) => permission.code);
  await ensureAccessGroupPermissions("School Admin", codes);
  await ensureAccessGroupPermissions("Org HQ", codes);
}

async function ensurePhotoAccessGroupDefaults() {
  const adminPhotoPermissions = ["students.manage_photo", "staff.manage_photo", "parents.manage_photo", "users.manage_photo"];
  await ensureAccessGroupPermissions("School Admin", adminPhotoPermissions);
  await ensureAccessGroupPermissions("Org HQ", adminPhotoPermissions);
  await ensureAccessGroupPermissions("Teacher", ["students.manage_photo"]);
  await ensureAccessGroupPermissions("Assistant Teacher", ["students.manage_photo"]);
}

export async function ensureRbacBaseline() {
  accessGroupsCreatedThisBootstrap.clear();

  // Catalog maintenance is safe: permission metadata can be introduced/renamed without
  // changing which users or access groups actually hold those permissions.
  await ensurePermissionsCatalog();

  // Do not automatically remove retired permissions here. Removing a catalog entry also
  // deletes its group mappings and user overrides, which would rewrite administrator
  // configuration during application startup. Retirement must be an explicit migration.

  // These routines now seed permissions only when they create a brand-new default group.
  // Existing groups remain exactly as configured by administrators.
  await ensureTransportAccessGroupDefaults();
  await ensureRecruitmentAccessGroupDefaults();
  await ensureAssetsInventoryAccessGroupDefaults();
  await ensureFleetAccessGroupDefaults();
  await ensureAccessControlDefaults();
  await ensurePhotoAccessGroupDefaults();
}
