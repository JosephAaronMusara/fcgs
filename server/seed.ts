import { db } from "./db";
import { users, organizations, schools, permissions, accessGroups, accessGroupPermissions, userAccessGroups, userPermissionOverrides, userSchoolAccess, staffRoles } from "@shared/schema";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

const PERMISSIONS_DATA = [
  // Dashboard
  { code: "dashboard.view", name: "View Dashboard", description: "Access the main dashboard with statistics and overview", category: "Dashboard" },
  
  // Students
  { code: "students.view", name: "View Students", description: "View student list and profiles", category: "Students" },
  { code: "students.create", name: "Create Students", description: "Add new students to the system", category: "Students" },
  { code: "students.edit", name: "Edit Students", description: "Modify student information", category: "Students" },
  { code: "students.delete", name: "Delete Students", description: "Remove students from the system", category: "Students" },
  
  // Staff
  { code: "staff.view", name: "View Staff", description: "View staff list and profiles", category: "Staff" },
  { code: "staff.create", name: "Create Staff", description: "Add new staff members", category: "Staff" },
  { code: "staff.edit", name: "Edit Staff", description: "Modify staff information", category: "Staff" },
  { code: "staff.delete", name: "Delete Staff", description: "Remove staff from the system", category: "Staff" },
  
  // Parents
  { code: "parents.view", name: "View Parents", description: "View parent/guardian information", category: "Parents" },
  { code: "parents.create", name: "Create Parents", description: "Add new parents/guardians", category: "Parents" },
  { code: "parents.edit", name: "Edit Parents", description: "Modify parent information", category: "Parents" },
  { code: "parents.delete", name: "Delete Parents", description: "Remove parents from the system", category: "Parents" },
  
  // Classes
  { code: "classes.view", name: "View Classes", description: "View class information and rosters", category: "Classes" },
  { code: "classes.create", name: "Create Classes", description: "Create new class sections", category: "Classes" },
  { code: "classes.edit", name: "Edit Classes", description: "Modify class information", category: "Classes" },
  { code: "classes.delete", name: "Delete Classes", description: "Remove classes from the system", category: "Classes" },
  
  // Subjects
  { code: "subjects.view", name: "View Subjects", description: "View subject list and details", category: "Subjects" },
  { code: "subjects.create", name: "Create Subjects", description: "Add new subjects to curriculum", category: "Subjects" },
  { code: "subjects.edit", name: "Edit Subjects", description: "Modify subject information", category: "Subjects" },
  { code: "subjects.delete", name: "Delete Subjects", description: "Remove subjects from the system", category: "Subjects" },
  
  // Assessments
  { code: "assessments.view", name: "View Assessments", description: "View assessment schedules and details", category: "Assessments" },
  { code: "assessments.create", name: "Create Assessments", description: "Create new assessments/exams", category: "Assessments" },
  { code: "assessments.edit", name: "Edit Assessments", description: "Modify assessment details", category: "Assessments" },
  { code: "assessments.delete", name: "Delete Assessments", description: "Remove assessments from the system", category: "Assessments" },
  
  // Marks
  { code: "marks.view", name: "View Marks", description: "View student marks and grades", category: "Marks" },
  { code: "marks.create", name: "Enter Marks", description: "Record student marks for assessments", category: "Marks" },
  { code: "marks.edit", name: "Edit Marks", description: "Modify recorded marks", category: "Marks" },
  { code: "marks.delete", name: "Delete Marks", description: "Remove marks from the system", category: "Marks" },
  
  // Attendance
  { code: "attendance.view", name: "View Attendance", description: "View attendance records", category: "Attendance" },
  { code: "attendance.create", name: "Record Attendance", description: "Take and record attendance", category: "Attendance" },
  { code: "attendance.edit", name: "Edit Attendance", description: "Modify attendance records", category: "Attendance" },
  
  // Discipline
  { code: "discipline.view", name: "View Discipline Records", description: "View disciplinary records", category: "Discipline" },
  { code: "discipline.create", name: "Create Discipline Records", description: "Log disciplinary incidents", category: "Discipline" },
  { code: "discipline.edit", name: "Edit Discipline Records", description: "Modify disciplinary records", category: "Discipline" },
  { code: "discipline.delete", name: "Delete Discipline Records", description: "Remove disciplinary records", category: "Discipline" },
  
  // Fees & Finance
  { code: "fees.view", name: "View Fees", description: "View fee structures and payments", category: "Fees" },
  { code: "fees.create", name: "Create Fee Payments", description: "Record fee payments", category: "Fees" },
  { code: "fees.edit", name: "Edit Fee Payments", description: "Modify payment records", category: "Fees" },
  { code: "fees.delete", name: "Delete Fee Payments", description: "Remove payment records", category: "Fees" },
  { code: "fees.manage_structure", name: "Manage Fee Structure", description: "Create and modify fee structures", category: "Fees" },
  
  // E-Library
  { code: "library.view", name: "View Library Resources", description: "View E-Library resources", category: "Library" },
  { code: "library.upload", name: "Upload Library Resources", description: "Add resources to E-Library", category: "Library" },
  { code: "library.download", name: "Download Library Resources", description: "Download E-Library resources", category: "Library" },
  { code: "library.delete", name: "Delete Library Resources", description: "Remove library resources", category: "Library" },
  
  // Timetable
  { code: "timetable.view", name: "View Timetable", description: "View class schedules", category: "Timetable" },
  { code: "timetable.create", name: "Create Timetable", description: "Create class schedules", category: "Timetable" },
  { code: "timetable.edit", name: "Edit Timetable", description: "Modify class schedules", category: "Timetable" },
  { code: "timetable.delete", name: "Delete Timetable", description: "Remove schedule entries", category: "Timetable" },
  
  // E-Logbook
  { code: "logbook.view", name: "View Logbook Entries", description: "View teacher logbook entries", category: "Logbook" },
  { code: "logbook.create", name: "Create Logbook Entry", description: "Record lesson documentation", category: "Logbook" },
  { code: "logbook.edit", name: "Edit Logbook Entry", description: "Modify logbook entries", category: "Logbook" },
  { code: "logbook.delete", name: "Delete Logbook Entry", description: "Remove logbook entries", category: "Logbook" },
  
  // E-Schemes
  { code: "schemes.view", name: "View Schemes of Work", description: "View lesson plans and schemes", category: "Schemes" },
  { code: "schemes.create", name: "Create Scheme of Work", description: "Create lesson plans", category: "Schemes" },
  { code: "schemes.edit", name: "Edit Scheme of Work", description: "Modify lesson plans", category: "Schemes" },
  { code: "schemes.delete", name: "Delete Scheme of Work", description: "Remove lesson plans", category: "Schemes" },
  
  // POS
  { code: "pos.view", name: "View POS", description: "View Point of Sale data", category: "POS" },
  { code: "pos.create_sale", name: "Create POS Sale", description: "Process sales transactions", category: "POS" },
  { code: "pos.manage_items", name: "Manage POS Items", description: "Add/edit POS inventory items", category: "POS" },
  { code: "pos.export", name: "Export POS Data", description: "Export sales data to Sage", category: "POS" },
  
  // Newsletters
  { code: "newsletters.view", name: "View Newsletters", description: "View school newsletters", category: "Newsletters" },
  { code: "newsletters.create", name: "Create Newsletter", description: "Create and publish newsletters", category: "Newsletters" },
  { code: "newsletters.edit", name: "Edit Newsletter", description: "Modify newsletter content", category: "Newsletters" },
  { code: "newsletters.delete", name: "Delete Newsletter", description: "Remove newsletters", category: "Newsletters" },
  
  // Hostel
  { code: "hostel.view", name: "View Hostel Roll Call", description: "View boarding attendance", category: "Hostel" },
  { code: "hostel.create", name: "Record Hostel Roll Call", description: "Take boarding attendance", category: "Hostel" },
  { code: "hostel.edit", name: "Edit Hostel Roll Call", description: "Modify roll call records", category: "Hostel" },
  
  // Applications
  { code: "applications.view", name: "View Applications", description: "View student applications", category: "Applications" },
  { code: "applications.process", name: "Process Applications", description: "Approve/reject applications", category: "Applications" },
  
  // School Settings
  { code: "settings.view", name: "View School Settings", description: "View school configuration", category: "Settings" },
  { code: "settings.edit", name: "Edit School Settings", description: "Modify school settings", category: "Settings" },
  
  // User Management
  { code: "users.view", name: "View Users", description: "View user accounts", category: "Users" },
  { code: "users.create", name: "Create Users", description: "Create user accounts", category: "Users" },
  { code: "users.edit", name: "Edit Users", description: "Modify user accounts", category: "Users" },
  { code: "users.delete", name: "Delete Users", description: "Remove user accounts", category: "Users" },
  { code: "users.manage_permissions", name: "Manage User Permissions", description: "Modify user access rights", category: "Users" },
  
  // Access Groups
  { code: "access_groups.view", name: "View Access Groups", description: "View access group definitions", category: "Access Groups" },
  { code: "access_groups.manage", name: "Manage Access Groups", description: "Create and modify access groups", category: "Access Groups" },

  // Clinic
  { code: "clinic.view", name: "View Clinic Records", description: "View medical visit records", category: "Clinic" },
  { code: "clinic.create", name: "Create Clinic Records", description: "Record new medical visits", category: "Clinic" },
  { code: "clinic.edit", name: "Edit Clinic Records", description: "Modify medical visit records", category: "Clinic" },
  { code: "clinic.delete", name: "Delete Clinic Records", description: "Remove medical visit records", category: "Clinic" },

  // Reports (Academic Reports Hub)
  { code: "reports.view", name: "View Reports", description: "View academic report cards and analytics", category: "Reports" },
  { code: "reports.generate", name: "Generate Reports", description: "Generate and download report cards", category: "Reports" },
  { code: "reports.send", name: "Send Reports", description: "Send report cards to parents via email/SMS", category: "Reports" },

  // QC Reports
  { code: "qc_reports.view", name: "View QC Reports", description: "View quality control assessment reports", category: "QC Reports" },
  { code: "qc_reports.create", name: "Create QC Reports", description: "Create quality control reports for students", category: "QC Reports" },
  { code: "qc_reports.edit", name: "Edit QC Reports", description: "Modify quality control reports", category: "QC Reports" },

  // Communication
  { code: "communication.view", name: "View Communications", description: "View communication logs and messages", category: "Communication" },
  { code: "communication.send", name: "Send Communications", description: "Send emails, SMS, and notifications", category: "Communication" },
  { code: "communication.manage", name: "Manage Communications", description: "Manage communication settings and templates", category: "Communication" },

  // Activity Logs
  { code: "activity_logs.view", name: "View Activity Logs", description: "View system activity and audit logs", category: "Activity Logs" },
  { code: "activity_logs.export", name: "Export Activity Logs", description: "Export activity logs to file", category: "Activity Logs" },

  // Grades
  { code: "grades.view", name: "View Grades", description: "View grade boundaries and configurations", category: "Grades" },
  { code: "grades.create", name: "Create Grades", description: "Create new grade boundaries", category: "Grades" },
  { code: "grades.edit", name: "Edit Grades", description: "Modify grade boundaries", category: "Grades" },
  { code: "grades.delete", name: "Delete Grades", description: "Remove grade boundaries", category: "Grades" },

  // Hostels Management
  { code: "hostels.view", name: "View Hostels", description: "View hostel buildings and room assignments", category: "Hostels" },
  { code: "hostels.create", name: "Create Hostels", description: "Add new hostel buildings", category: "Hostels" },
  { code: "hostels.edit", name: "Edit Hostels", description: "Modify hostel information", category: "Hostels" },
  { code: "hostels.delete", name: "Delete Hostels", description: "Remove hostel buildings", category: "Hostels" },

  // Record of Marks
  { code: "record_of_marks.view", name: "View Record of Marks", description: "View student marks across assessments", category: "Record of Marks" },
  { code: "record_of_marks.export", name: "Export Record of Marks", description: "Export marks records to file", category: "Record of Marks" },

  // Transport
  { code: "transport.view", name: "View Transport", description: "View transport routes and assignments", category: "Transport" },
  { code: "transport.create", name: "Create Transport Routes", description: "Add new transport routes", category: "Transport" },
  { code: "transport.edit", name: "Edit Transport Routes", description: "Modify transport routes", category: "Transport" },
  { code: "transport.delete", name: "Delete Transport Routes", description: "Remove transport routes", category: "Transport" },

  // Calendar
  { code: "calendar.view", name: "View Calendar", description: "View calendar events", category: "Calendar" },
  { code: "calendar.create.personal", name: "Create Personal Events", description: "Create personal calendar events", category: "Calendar" },
  { code: "calendar.create.class", name: "Create Class Events", description: "Create class calendar events", category: "Calendar" },
  { code: "calendar.create.school", name: "Create School Events", description: "Create school calendar events", category: "Calendar" },
  { code: "calendar.create.org", name: "Create Org Events", description: "Create organization calendar events", category: "Calendar" },
  { code: "calendar.edit.own", name: "Edit Own Events", description: "Edit events you created", category: "Calendar" },
  { code: "calendar.edit.scope", name: "Edit Scoped Events", description: "Edit events in your scope (school/org)", category: "Calendar" },
  { code: "calendar.delete.own", name: "Delete Own Events", description: "Delete events you created", category: "Calendar" },
  { code: "calendar.delete.scope", name: "Delete Scoped Events", description: "Delete events in your scope (school/org)", category: "Calendar" },
  { code: "calendar.manage.reminders", name: "Manage Reminders", description: "Create and manage event reminders", category: "Calendar" },
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

  // Seed individual permission overrides for all admin users (all permissions granted)
  console.log("Seeding individual permission overrides for admin users...");
  const allAdminUserIds = [...adminUserIds, orgAdminUserId];
  const allPermissionIds = Array.from(permissionMap.values());

  for (const adminId of allAdminUserIds) {
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, adminId));
    if (allPermissionIds.length > 0) {
      await db.insert(userPermissionOverrides).values(
        allPermissionIds.map(permissionId => ({ userId: adminId, permissionId, granted: true }))
      );
    }
  }
  console.log(`Individual permission overrides seeded for ${allAdminUserIds.length} admin users (${allPermissionIds.length} permissions each)`);

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
