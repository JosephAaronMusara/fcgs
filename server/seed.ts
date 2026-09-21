import { db } from "./db";
import { users, organizations, schools, permissions, accessGroups, accessGroupPermissions, userAccessGroups, userSchoolAccess, staffRoles } from "@shared/schema";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

import { RBAC_PERMISSIONS_DATA } from "./rbac-config";

const PERMISSIONS_DATA = RBAC_PERMISSIONS_DATA;

const ORG_HQ_TRANSPORT_OVERSIGHT_PERMISSIONS = new Set([
  "transport.view", "transport.dashboard.view", "transport.charges.view", "transport.payments.view",
  "transport.receipts.view", "transport.claims.view", "transport.payouts.view", "transport.reports.view", "transport.audit.view",
  "transport.organization.view", "transport.organization.reports", "transport.organization.export", "transport.hq.settings.manage",
]);

const ORG_HQ_PERMISSIONS = PERMISSIONS_DATA
  .filter((permission) => !permission.code.startsWith("transport.") || ORG_HQ_TRANSPORT_OVERSIGHT_PERMISSIONS.has(permission.code))
  .map((permission) => permission.code);

const ASSET_INVENTORY_OFFICER_PERMISSIONS = [
  "assets.view", "assets.create", "assets.edit", "assets.assign", "assets.transfer", "assets.maintenance", "assets.reports", "assets.setup.manage",
  "inventory.view", "inventory.items.manage", "inventory.receive", "inventory.issue", "inventory.adjust", "inventory.stocktake", "inventory.reports", "inventory.low_stock.view",
  "inventory.restock.request", "inventory.procurement.view", "inventory.procurement.request", "inventory.procurement.order", "inventory.procurement.receive",
  "inventory.transfer.request", "inventory.transfer.dispatch", "inventory.transfer.receive",
  "damage.view", "damage.report", "damage.investigate", "damage.reports",
];

const ACCESS_GROUPS_DATA = [
  {
    name: "School Admin",
    description: "Full access to all school features. Can view, create, edit, and delete all data within their school.",
    isSystemDefault: true,
    permissions: PERMISSIONS_DATA.map(p => p.code), // All permissions
  },
  {
    name: "Teacher",
    description: "Can view all data. Can create assessments and enter marks. Can upload and download files from E-Library.",
    isSystemDefault: true,
    permissions: [
      "dashboard.view",
      "students.view",
      "students.manage_photo",
      "staff.view",
      "parents.view",
      "classes.view",
      "subjects.view",
      "assessments.view", "assessments.create", "assessments.edit",
      "marks.view", "marks.create", "marks.edit",
      "attendance.view", "attendance.create", "attendance.edit",
      "discipline.view", "discipline.create",
      "fees.view",
      "library.view", "library.download",
      "timetable.view",
      "logbook.view", "logbook.create", "logbook.edit",
      "staff_attendance.view_own", "staff_attendance.view_logs", "staff_attendance.clock_in", "staff_attendance.clock_out",
      "newsletters.view",
      "hostel.view",
      "applications.view",
      "settings.view",
      "clinic.view", "clinic.create", "clinic.edit",
      "reports.view", "reports.generate",
      "qc_reports.view",
      "communication.view", "communication.send",
      "grades.view", "grades.create", "grades.edit",
      "hostels.view",
      "record_of_marks.view", "record_of_marks.export",
      "transport.view",
	"calendar.view",
	"staff_attendance.view_own",
	"staff_attendance.view_logs",
	"staff_attendance.clock_in",
	"staff_attendance.clock_out",
	"calendar.create.personal",
	"calendar.create.class",
	"calendar.edit.own",
	"calendar.delete.own",
	"calendar.manage.reminders",
    ],
  },
  {
    name: "Quality Control Officer",
    description: "Same access as School Admin, but cannot manage finances (view-only for fees).",
    isSystemDefault: true,
    permissions: PERMISSIONS_DATA.filter(p =>
      !["fees.create", "fees.edit", "fees.delete", "fees.manage_structure"].includes(p.code)
    ).map(p => p.code),
  },
  {
    name: "Assistant Teacher",
    description: "Same access as Teacher. Can view all data, create assessments, enter marks, and manage files.",
    isSystemDefault: true,
    permissions: [
      "dashboard.view",
      "students.view",
      "students.manage_photo",
      "staff.view",
      "parents.view",
      "classes.view",
      "subjects.view",
      "assessments.view", "assessments.create", "assessments.edit",
      "marks.view", "marks.create", "marks.edit",
      "attendance.view", "attendance.create", "attendance.edit",
      "discipline.view", "discipline.create",
      "fees.view",
      "library.view", "library.download",
      "timetable.view",
      "logbook.view", "logbook.create", "logbook.edit",
      "staff_attendance.view_own", "staff_attendance.view_logs", "staff_attendance.clock_in", "staff_attendance.clock_out",
      "newsletters.view",
      "hostel.view",
      "applications.view",
      "settings.view",
      "clinic.view", "clinic.create", "clinic.edit",
      "reports.view", "reports.generate",
      "qc_reports.view",
      "communication.view", "communication.send",
      "grades.view", "grades.create", "grades.edit",
      "hostels.view",
      "record_of_marks.view", "record_of_marks.export",
      "transport.view",
	"calendar.view",
	"staff_attendance.view_own",
	"staff_attendance.view_logs",
	"staff_attendance.clock_in",
	"staff_attendance.clock_out",
	"calendar.create.personal",
	"calendar.create.class",
	"calendar.edit.own",
	"calendar.delete.own",
	"calendar.manage.reminders",
    ],
  },
  {
    name: "Librarian",
    description: "Manages library resources including catalog, circulation, digital resources, and fines. Can view students and classes.",
    isSystemDefault: true,
    permissions: [
      "dashboard.view",
      "students.view",
      "staff.view",
      "classes.view",
      "subjects.view",
      "library.view", "library.resources.manage", "library.catalog.manage", "library.copies.manage", "library.circulation.manage", "library.fines.manage", "library.reservations.manage", "library.policy.manage", "library.import", "library.download", "library.catalogue.delete",
      "settings.view",
      "newsletters.view",
      "communication.view",
	"calendar.view",
    ],
  },
  {
    name: "Accountant",
    description: "Manages fees, payments, POS transactions, and financial records. Can view students and classes.",
    isSystemDefault: true,
    permissions: [
      "dashboard.view",
      "students.view",
      "staff.view",
      "parents.view",
      "classes.view",
      "subjects.view",
      "fees.view", "fees.create", "fees.edit", "fees.delete", "fees.manage_structure",
      "pos.view", "pos.create_sale", "pos.manage_items", "pos.export",
      "settings.view",
      "newsletters.view",
      "communication.view", "communication.send",
      "reports.view",
      "transport.view", "transport.dashboard.view", "transport.charges.view", "transport.charges.generate", "transport.charges.adjust",
      "transport.payments.view", "transport.payments.record", "transport.payments.verify", "transport.payments.reverse",
      "transport.receipts.view", "transport.receipts.verify",
      "transport.refunds.request", "transport.refunds.approve", "transport.refunds.pay",
      "transport.cashups.prepare", "transport.cashups.verify", "transport.claims.view", "transport.claims.verify", "transport.claims.approve",
      "transport.penalties.manage", "transport.advances.request", "transport.advances.approve", "transport.advances.disburse", "transport.payouts.view", "transport.payouts.generate", "transport.payouts.pay",
      "transport.periods.lock", "transport.reports.view", "transport.audit.view",
	"calendar.view",
	"staff_attendance.view_own",
	"staff_attendance.view_logs",
	"staff_attendance.clock_in",
	"staff_attendance.clock_out",
    ],
  },
  {
    name: "Receptionist",
    description: "Records receipts and prepares daily transport cash handovers without verification authority.",
    isSystemDefault: true,
    permissions: [
      "dashboard.view", "students.view", "parents.view", "classes.view", "fees.view",
      "transport.view", "transport.dashboard.view", "transport.charges.view",
      "transport.payments.view", "transport.payments.record", "transport.receipts.view",
      "transport.refunds.request", "transport.cashups.prepare",
      "calendar.view", "staff_attendance.view_own", "staff_attendance.clock_in", "staff_attendance.clock_out",
    ],
  },
  {
    name: "Transport Manager",
    description: "Manages school transport operations, learner services, path setup, claims verification and reporting without final finance payout authority.",
    isSystemDefault: true,
    permissions: [
      "transport.view", "transport.dashboard.view",
      "transport.routes.create", "transport.routes.edit", "transport.stops.manage", "transport.paths.manage",
      "transport.vehicles.create", "transport.vehicles.edit", "transport.drivers.manage", "transport.owners.manage",
      "transport.documents.view", "transport.documents.manage", "transport.compliance.view", "transport.compliance.manage",
      "transport.learners.enrol", "transport.learners.edit_service", "transport.learners.transfer",
      "transport.charges.view", "transport.charges.generate", "transport.payments.view",
      "transport.receipts.view", "transport.receipts.verify", "transport.refunds.request",
      "transport.cashups.prepare", "transport.incidents.manage",
      "transport.claims.view", "transport.claims.generate", "transport.claims.submit", "transport.claims.verify",
      "transport.advances.request", "transport.payouts.view", "transport.reports.view", "transport.audit.view",
    ],
  },
  {
    name: "Recruitment Manager",
    description: "Manages staff vacancies, screening requirements, applications, interviews and recruitment settings.",
    isSystemDefault: true,
    permissions: [
      "recruitment.view", "recruitment.vacancies.manage", "recruitment.requirements.manage",
      "recruitment.applications.review", "recruitment.applications.process", "recruitment.rejected_attempts.view",
      "recruitment.documents.view", "recruitment.documents.manage", "recruitment.interviews.manage", "recruitment.settings.manage",
      "staff.view", "settings.view", "communication.view", "communication.send",
    ],
  },
  {
    name: "Assets & Inventory Officer",
    description: "Manages asset registers, stores, stock movements, procurement receipts, centre transfers, maintenance and damage reporting.",
    isSystemDefault: true,
    permissions: ASSET_INVENTORY_OFFICER_PERMISSIONS,
  },
  {
    name: "Org HQ",
    description: "Organization-wide administration with operational Assets & Inventory access and read-only Transport oversight by default.",
    isSystemDefault: true,
    permissions: ORG_HQ_PERMISSIONS,
  },
];

async function seed() {
  console.log("Seeding database...");

  // Create organization if not exists
  const existingOrg = await db.select().from(organizations).where(eq(organizations.name, "First Choice Group Of Schools"));
  let orgId: number;

  if (existingOrg.length === 0) {
    const [newOrg] = await db.insert(organizations).values({
      name: "First Choice Group Of Schools",
      email: "info@firstchoicegroup.co.zw",
      phone: "+263 242 000000",
      address: "Harare, Zimbabwe"
    }).returning();
    orgId = newOrg.id;
    console.log("Organization created: First Choice Group Of Schools");
  } else {
    orgId = existingOrg[0].id;
    console.log("Organization already exists");
  }

  // Create schools if not exists
  const schoolsData = [
    { name: "Prospect", shortCode: "PROSPECT", organizationId: orgId, enableHostel: false, examinationBoard: "ZIMSEC" },
    { name: "Macheke", shortCode: "MACHEKE", organizationId: orgId, enableHostel: true, examinationBoard: "ZIMSEC" },
    { name: "Waterfalls", shortCode: "WATERFALLS", organizationId: orgId, enableHostel: false, examinationBoard: "ZIMSEC" },
    { name: "Highfield", shortCode: "HIGHFIELD", organizationId: orgId, enableHostel: false, examinationBoard: "ZIMSEC" },
    { name: "Waterfalls Jnr", shortCode: "WATERFALLSJNR", organizationId: orgId, enableHostel: false, examinationBoard: "ZIMSEC" },
  ];

  const schoolMap = new Map<string, number>();

  for (const school of schoolsData) {
    const existing = await db.select().from(schools).where(eq(schools.shortCode, school.shortCode));
    if (existing.length === 0) {
      const [newSchool] = await db.insert(schools).values(school).returning();
      schoolMap.set(school.shortCode, newSchool.id);
      console.log(`School created: ${school.name}`);
    } else {
      schoolMap.set(school.shortCode, existing[0].id);
      console.log(`School already exists: ${school.name}`);
    }
  }

  // Create school-specific admin users
  const schoolAdmins = [
    { username: "admin_prospect", schoolCode: "PROSPECT", firstName: "Prospect", lastName: "Admin", email: "admin.prospect@firstchoicegroup.co.zw" },
    { username: "admin_macheke", schoolCode: "MACHEKE", firstName: "Macheke", lastName: "Admin", email: "admin.macheke@firstchoicegroup.co.zw" },
    { username: "admin_waterfalls", schoolCode: "WATERFALLS", firstName: "Waterfalls", lastName: "Admin", email: "admin.waterfalls@firstchoicegroup.co.zw" },
    { username: "admin_highfield", schoolCode: "HIGHFIELD", firstName: "Highfield", lastName: "Admin", email: "admin.highfield@firstchoicegroup.co.zw" },
    { username: "admin_waterfallsjnr", schoolCode: "WATERFALLSJNR", firstName: "Waterfalls Jnr", lastName: "Admin", email: "admin.waterfallsjnr@firstchoicegroup.co.zw" },
  ];

  const hashedPassword = await bcrypt.hash("admin123", 10);
  const adminUserIds: number[] = [];
  const newlyCreatedAdminUserIds = new Set<number>();

  // Existing user/group/school-scope configuration is administrator-owned. Seed reruns
  // must not delete legacy accounts or rewrite their RBAC memberships/scope.

  for (const admin of schoolAdmins) {
    const schoolId = schoolMap.get(admin.schoolCode);
    const existingAdmin = await db.select().from(users).where(eq(users.username, admin.username));

    if (existingAdmin.length === 0) {
      const [newAdmin] = await db.insert(users).values({
        username: admin.username,
        password: hashedPassword,
        email: admin.email,
        role: "school_admin",
        firstName: admin.firstName,
        lastName: admin.lastName,
        schoolId: schoolId,
        organizationId: orgId,
      }).returning();
      adminUserIds.push(newAdmin.id);
      newlyCreatedAdminUserIds.add(newAdmin.id);
      console.log(`Admin user created: ${admin.username} / admin123`);
    } else {
      // Update password and school assignment
      await db.update(users).set({
        password: hashedPassword,
        schoolId: schoolId,
        organizationId: orgId
      }).where(eq(users.username, admin.username));
      adminUserIds.push(existingAdmin[0].id);
      console.log(`Admin user updated: ${admin.username}`);
    }
  }

  // Create org_admin user
  const existingOrgAdmin = await db.select().from(users).where(eq(users.username, "org_admin"));
  let orgAdminUserId: number;
  let orgAdminCreated = false;

  if (existingOrgAdmin.length === 0) {
    const hashedPassword = await bcrypt.hash("admin123", 10);
    const [orgAdmin] = await db.insert(users).values({
      username: "org_admin",
      password: hashedPassword,
      email: "it@firstchoicegroup.co.zw",
      role: "org_admin",
      firstName: "Organization",
      lastName: "Administrator",
      organizationId: orgId,
    }).returning();
    orgAdminUserId = orgAdmin.id;
    orgAdminCreated = true;
    console.log("Org Admin user created: org_admin / admin123");
  } else {
    orgAdminUserId = existingOrgAdmin[0].id;
    console.log("Org Admin user already exists");
  }

  // Seed permissions
  console.log("Seeding permissions...");
  const permissionMap = new Map<string, number>();

  // Seeding must be non-destructive on an existing installation. Legacy permission
  // retirement is handled by explicit migrations, not by deleting configured rights here.

  for (const perm of PERMISSIONS_DATA) {
    const existing = await db.select().from(permissions).where(eq(permissions.code, perm.code));
    if (existing.length === 0) {
      const [newPerm] = await db.insert(permissions).values(perm).returning();
      permissionMap.set(perm.code, newPerm.id);
    } else {
      permissionMap.set(perm.code, existing[0].id);
    }
  }
  console.log(`Seeded ${PERMISSIONS_DATA.length} permissions`);

  // Seed access groups and assign permissions
  console.log("Seeding access groups...");
  const accessGroupMap = new Map<string, number>();

  for (const group of ACCESS_GROUPS_DATA) {
    const existing = await db.select().from(accessGroups).where(eq(accessGroups.name, group.name));
    let groupId: number;

    const created = existing.length === 0;
    if (created) {
      const [newGroup] = await db.insert(accessGroups).values({
        name: group.name,
        description: group.description,
        isSystemDefault: group.isSystemDefault,
      }).returning();
      groupId = newGroup.id;
    } else {
      groupId = existing[0].id;
    }
    accessGroupMap.set(group.name, groupId);

    // Permission defaults are applied only to a newly-created access group. Existing
    // groups are administrator-owned configuration and must survive seed/deploy reruns.
    if (created) {
      for (const permCode of group.permissions) {
        const permId = permissionMap.get(permCode);
        if (permId) {
          await db.insert(accessGroupPermissions).values({
            accessGroupId: groupId,
            permissionId: permId,
          });
        }
      }
      console.log(`Access group "${group.name}" created with ${group.permissions.length} permissions`);
    } else {
      console.log(`Access group "${group.name}" already exists; preserving configured permissions`);
    }
  }

  // Assign access groups to users
  const schoolAdminGroupId = accessGroupMap.get("School Admin");
  const orgMemberGroupId = accessGroupMap.get("Org HQ");

  // Assign School Admin access group to all school-specific admins
  if (schoolAdminGroupId) {
    for (const adminId of adminUserIds) {
      if (!newlyCreatedAdminUserIds.has(adminId)) continue;
      await db.insert(userAccessGroups).values({
        userId: adminId,
        accessGroupId: schoolAdminGroupId,
      }).onConflictDoNothing();
    }
    console.log(`Default School Admin membership applied only to newly created admin users`);
  }

  if (orgMemberGroupId && orgAdminCreated) {
    await db.insert(userAccessGroups).values({
      userId: orgAdminUserId,
      accessGroupId: orgMemberGroupId,
    }).onConflictDoNothing();
    console.log("New Org Admin user assigned to Org HQ access group");
  }

  const newlyCreatedAllAdminUserIds = [...newlyCreatedAdminUserIds, ...(orgAdminCreated ? [orgAdminUserId] : [])];

  // Seed school scope only for accounts created in this run. Existing scope is preserved,
  // including the deliberate choice to leave an existing user with no school mappings.
  console.log("Seeding school access for newly created admin users...");
  const allSchoolIds = Array.from(schoolMap.values());

  for (const adminId of newlyCreatedAllAdminUserIds) {
    if (allSchoolIds.length > 0) {
      await db.insert(userSchoolAccess).values(
        allSchoolIds.map(schoolId => ({ userId: adminId, schoolId }))
      ).onConflictDoNothing();
    }
  }
  console.log(`Existing configured school access was preserved`);

  // Seed default staff roles
  console.log("Seeding staff roles...");
  const DEFAULT_STAFF_ROLES = [
    { name: "teacher", label: "Teacher", description: "Classroom teacher responsible for teaching and assessments", isSystemDefault: true },
    { name: "assistant_teacher", label: "Assistant Teacher", description: "Supports lead teachers in classroom activities", isSystemDefault: true },
    { name: "administrator", label: "Administrator", description: "School administrator managing operations", isSystemDefault: true },
    { name: "accountant", label: "Accountant", description: "Handles financial records, fees, and POS", isSystemDefault: true },
    { name: "receptionist", label: "Receptionist", description: "Receives payments, issues receipts and prepares school cash handovers", isSystemDefault: true },
    { name: "librarian", label: "Librarian", description: "Manages library resources and circulation", isSystemDefault: true },
    { name: "quality_control_officer", label: "Quality Control Officer", description: "Oversees academic quality and standards", isSystemDefault: true },
  ];

  for (const roleData of DEFAULT_STAFF_ROLES) {
    const [existing] = await db.select().from(staffRoles).where(eq(staffRoles.name, roleData.name));
    if (!existing) {
      await db.insert(staffRoles).values(roleData);
      console.log(`  Staff role "${roleData.label}" created`);
    }
  }

  console.log("Seed complete!");
}

seed().catch(console.error);
