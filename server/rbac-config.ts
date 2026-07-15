export const RBAC_PERMISSIONS_DATA = [
  // Dashboard
  { code: "dashboard.view", name: "View Dashboard", description: "Access the main dashboard with statistics and overview", category: "Dashboard" },
  
  // Students
  { code: "students.view", name: "View Students", description: "View student list and profiles", category: "Students" },
  { code: "students.create", name: "Create Students", description: "Add new students to the system", category: "Students" },
  { code: "students.edit", name: "Edit Students", description: "Modify student information", category: "Students" },
  { code: "students.delete", name: "Delete Students", description: "Remove students from the system", category: "Students" },
  
  // Internal Transfers
  { code: "internal_transfers.view", name: "View Internal Transfers", description: "View internal school-to-school transfer options and completed transfer history", category: "Internal Transfers" },
  { code: "internal_transfers.transfer.student", name: "Transfer Students Between Schools", description: "Move student records between schools within the same organisation", category: "Internal Transfers" },
  { code: "internal_transfers.transfer.staff", name: "Transfer Staff Between Schools", description: "Move staff records between schools within the same organisation", category: "Internal Transfers" },

  // Staff
  { code: "staff.view", name: "View Staff", description: "View staff list and profiles", category: "Staff" },
  { code: "staff.create", name: "Create Staff", description: "Add new staff members", category: "Staff" },
  { code: "staff.edit", name: "Edit Staff", description: "Modify staff information", category: "Staff" },
  { code: "staff.delete", name: "Delete Staff", description: "Remove staff from the system", category: "Staff" },
  { code: "staff.assign_subjects", name: "Assign Classes & Subjects", description: "Assign class and subject teaching combinations to staff members", category: "Staff" },
  
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
  
  // Library
  { code: "library.view", name: "View Library", description: "View library catalog, circulation, resources, fines, reservations and policy", category: "Library" },
  { code: "library.resources.manage", name: "Manage Digital Resources", description: "Create and update digital library resources", category: "Library" },
  { code: "library.catalog.manage", name: "Manage Catalog", description: "Create and update library books, categories and cover images", category: "Library" },
  { code: "library.copies.manage", name: "Manage Book Copies", description: "Add and update physical book copies and QR assignments", category: "Library" },
  { code: "library.circulation.manage", name: "Manage Circulation", description: "Issue, return and mark loans as lost", category: "Library" },
  { code: "library.fines.manage", name: "Manage Fines", description: "Create and update library fines", category: "Library" },
  { code: "library.reservations.manage", name: "Manage Reservations", description: "Create and update library reservations", category: "Library" },
  { code: "library.policy.manage", name: "Manage Library Policy", description: "Update library borrowing policy settings", category: "Library" },
  { code: "library.import", name: "Import Library Books", description: "Import library catalog data from spreadsheets", category: "Library" },
  { code: "students.import", name: "Import Students", description: "Import student records from spreadsheets", category: "Students" },
  { code: "parents.import", name: "Import Parents", description: "Import parent and guardian records from spreadsheets", category: "Parents" },
  { code: "staff.import", name: "Import Staff", description: "Import staff records from spreadsheets", category: "Staff" },
  { code: "clinic.import", name: "Import Clinic Records", description: "Import clinic and health records from spreadsheets", category: "Clinic" },
  { code: "fees.import", name: "Import Fees", description: "Import fee balances and payment data from spreadsheets", category: "Finance" },
  { code: "library.download", name: "Download Library Resources", description: "Download digital library resources", category: "Library" },
  { code: "library.catalogue.delete", name: "Delete Library Records", description: "Delete library resources, copies, categories and books", category: "Library" },
  { code: "library.upload", name: "Legacy Library Upload", description: "Legacy compatibility permission for old library upload flows", category: "Library" },
  
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

  // Staff Attendance
  { code: "staff_attendance.view_own", name: "View Own Staff Attendance", description: "View your own staff attendance records", category: "Staff Attendance" },
  { code: "staff_attendance.view_all", name: "View All Staff Attendance", description: "View all staff attendance records for the active school", category: "Staff Attendance" },
  { code: "staff_attendance.view_overview", name: "View Staff Attendance Overview", description: "View the staff attendance overview grid", category: "Staff Attendance" },
  { code: "staff_attendance.view_logs", name: "View Staff Attendance Logs", description: "View the staff attendance logs tab", category: "Staff Attendance" },
  { code: "staff_attendance.clock_in", name: "Clock In for Staff Attendance", description: "Clock in to staff attendance", category: "Staff Attendance" },
  { code: "staff_attendance.clock_out", name: "Clock Out for Staff Attendance", description: "Clock out of staff attendance", category: "Staff Attendance" },
  { code: "staff_attendance.reset_device_id", name: "Reset Staff Attendance Device ID", description: "Reset a staff member's attendance device binding", category: "Staff Attendance" },
  
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
  { code: "academic_reports.publish.class", name: "Publish Class Results", description: "Publish and lock an exercise or exam for one class", category: "Reports" },
  { code: "academic_reports.publish.stream", name: "Publish Stream Results", description: "Publish and lock an exercise or exam for every class in a stream", category: "Reports" },
  { code: "academic_reports.unpublish", name: "Unpublish Results", description: "Unpublish results with a recorded reason so marks can be corrected", category: "Reports" },
  { code: "academic_reports.send.class", name: "Send Class Reports", description: "Send published report cards for a class", category: "Reports" },
  { code: "academic_reports.send.stream", name: "Send Stream Reports", description: "Send published report cards for published classes in a stream", category: "Reports" },
  { code: "reports.ecd_entry", name: "Manage ECD Assessment Entry", description: "Create and update ECD assessment ticks in Academic Reports", category: "Reports" },
  { code: "reports.comments_manage", name: "Manage Report Comments", description: "Create and manage report comment banks", category: "Reports" },

  // QC Reports
  { code: "qc_reports.view", name: "View QC Reports", description: "View quality control assessment reports", category: "QC Reports" },
  { code: "qc_reports.create", name: "Create QC Reports", description: "Create quality control reports for students", category: "QC Reports" },
  { code: "qc_reports.edit", name: "Edit QC Reports", description: "Modify quality control reports", category: "QC Reports" },
  { code: "qc_reports.delete", name: "Delete QC Reports", description: "Delete quality control records", category: "QC Reports" },

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

  // Placeholder / Coming Soon Modules
  { code: "kundai.view", name: "View kundAi", description: "Open the kundAi module", category: "kundAi" },
  { code: "discussion_forum.view", name: "View Discussion Forum", description: "Open the discussion forum module", category: "Discussion Forum" },
  { code: "learning_materials.view", name: "View Learning Materials", description: "Open the learning materials module", category: "Learning Materials" },
  { code: "products.view", name: "View Products", description: "Open the products module", category: "Products" },
  { code: "school_expenses.view", name: "View School Expenses", description: "Open the school expenses module", category: "School Expenses" },
  { code: "school_incomes.view", name: "View School Incomes", description: "Open the school incomes module", category: "School Incomes" },
  { code: "financial_statements.view", name: "View Financial Statements", description: "Open the financial statements module", category: "Financial Statements" },
  { code: "arrears.view", name: "View Arrears", description: "Open the arrears module", category: "Arrears" },

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

export type RbacPermissionSeed = (typeof RBAC_PERMISSIONS_DATA)[number];
