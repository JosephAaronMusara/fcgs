import { db } from "./db";
import { users, organizations, schools, permissions, accessGroups, accessGroupPermissions, userAccessGroups, userSchoolAccess, staffRoles } from "@shared/schema";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

import { RBAC_PERMISSIONS_DATA } from "./rbac-config";

const PERMISSIONS_DATA = RBAC_PERMISSIONS_DATA;

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
      "staff.view",
      "parents.view",
      "classes.view",
      "subjects.view",
      "assessments.view", "assessments.create", "assessments.edit",
      "marks.view", "marks.create", "marks.edit",
      "attendance.view", "attendance.create", "attendance.edit",
      "discipline.view", "discipline.create",
      "fees.view",
      "library.view", "library.upload", "library.download",
      "timetable.view",
      "logbook.view", "logbook.create", "logbook.edit",
      "schemes.view", "schemes.create", "schemes.edit",
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
      "staff.view",
      "parents.view",
      "classes.view",
      "subjects.view",
      "assessments.view", "assessments.create", "assessments.edit",
      "marks.view", "marks.create", "marks.edit",
      "attendance.view", "attendance.create", "attendance.edit",
      "discipline.view", "discipline.create",
      "fees.view",
      "library.view", "library.upload", "library.download",
      "timetable.view",
      "logbook.view", "logbook.create", "logbook.edit",
      "schemes.view", "schemes.create", "schemes.edit",
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
      "library.view", "library.upload", "library.download", "library.delete",
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
      "transport.view",
	"calendar.view",
    ],
  },
  {
    name: "Org HQ",
    description: "Super user with full access to all schools in the organization. Has all permissions across all campuses.",
    isSystemDefault: true,
    permissions: PERMISSIONS_DATA.map(p => p.code), // All permissions
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

  // Delete old generic admin if exists (and its access group mappings)
  const oldAdmin = await db.select().from(users).where(eq(users.username, "admin"));
  if (oldAdmin.length > 0) {
    try {
      await db.delete(userAccessGroups).where(eq(userAccessGroups.userId, oldAdmin[0].id));
      await db.delete(users).where(eq(users.username, "admin"));
      console.log("Removed old generic admin user");
    } catch {
      console.log("Could not remove old generic admin user (referenced by other records), skipping");
    }
  }

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
    console.log("Org Admin user created: org_admin / admin123");
  } else {
    orgAdminUserId = existingOrgAdmin[0].id;
    console.log("Org Admin user already exists");
  }

  // Seed permissions
  console.log("Seeding permissions...");
  const permissionMap = new Map<string, number>();
  
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
    
    if (existing.length === 0) {
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

    // Clear existing permissions for this group and reassign
    await db.delete(accessGroupPermissions).where(eq(accessGroupPermissions.accessGroupId, groupId));
    
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
  }

  // Assign access groups to users
  const schoolAdminGroupId = accessGroupMap.get("School Admin");
  const orgMemberGroupId = accessGroupMap.get("Org HQ");

  // Assign School Admin access group to all school-specific admins
  if (schoolAdminGroupId) {
    for (const adminId of adminUserIds) {
      const existingMapping = await db.select().from(userAccessGroups)
        .where(eq(userAccessGroups.userId, adminId));
      if (existingMapping.length === 0) {
        await db.insert(userAccessGroups).values({
          userId: adminId,
          accessGroupId: schoolAdminGroupId,
        });
      }
    }
    console.log(`${adminUserIds.length} school admins assigned to School Admin access group`);
  }

  if (orgMemberGroupId) {
    const existingMapping = await db.select().from(userAccessGroups)
      .where(eq(userAccessGroups.userId, orgAdminUserId));
    if (existingMapping.length === 0) {
      await db.insert(userAccessGroups).values({
        userId: orgAdminUserId,
        accessGroupId: orgMemberGroupId,
      });
      console.log("Org Admin user assigned to Org HQ access group");
    }
  }

  const allAdminUserIds = [...adminUserIds, orgAdminUserId];

  // Seed school access for all admin users (access to all schools)
  console.log("Seeding school access for admin users...");
  const allSchoolIds = Array.from(schoolMap.values());

  for (const adminId of allAdminUserIds) {
    await db.delete(userSchoolAccess).where(eq(userSchoolAccess.userId, adminId));
    if (allSchoolIds.length > 0) {
      await db.insert(userSchoolAccess).values(
        allSchoolIds.map(schoolId => ({ userId: adminId, schoolId }))
      );
    }
  }
  console.log(`School access seeded for ${allAdminUserIds.length} admin users (${allSchoolIds.length} schools each)`);

  // Seed default staff roles
  console.log("Seeding staff roles...");
  const DEFAULT_STAFF_ROLES = [
    { name: "teacher", label: "Teacher", description: "Classroom teacher responsible for teaching and assessments", isSystemDefault: true },
    { name: "assistant_teacher", label: "Assistant Teacher", description: "Supports lead teachers in classroom activities", isSystemDefault: true },
    { name: "administrator", label: "Administrator", description: "School administrator managing operations", isSystemDefault: true },
    { name: "accountant", label: "Accountant", description: "Handles financial records, fees, and POS", isSystemDefault: true },
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
