export const RBAC_PERMISSIONS_DATA = [
  // Dashboard
  { code: "dashboard.view", name: "View Dashboard", description: "Access the main dashboard with statistics and overview", category: "Dashboard" },

  // Students
  { code: "students.view", name: "View Students", description: "View student list and profiles", category: "Students" },
  { code: "students.create", name: "Create Students", description: "Add new students to the system", category: "Students" },
  { code: "students.edit", name: "Edit Students", description: "Modify student information", category: "Students" },
  { code: "students.classroom.assign", name: "Assign Student Classroom", description: "Assign active students to an existing classroom, including incoming internal transfers", category: "Students" },
  { code: "students.restore_transferred", name: "Restore Transferred Students", description: "Restore and re-enrol students who previously transferred out while preserving their original identity and admission number", category: "Students" },
  { code: "students.manage_photo", name: "Manage Student Photos", description: "Upload, replace and download student profile photos", category: "Students" },
  { code: "students.delete", name: "Delete Students", description: "Remove students from the system", category: "Students" },

  // Internal Transfers
  { code: "internal_transfers.view", name: "View Internal Transfers", description: "View internal school-to-school transfer options and completed transfer history", category: "Internal Transfers" },
  { code: "internal_transfers.transfer.student", name: "Transfer Students Between Schools", description: "Move student records between schools within the same organisation", category: "Internal Transfers" },
  { code: "internal_transfers.transfer.staff", name: "Transfer Staff Between Schools", description: "Move staff records between schools within the same organisation", category: "Internal Transfers" },

  // Staff
  { code: "staff.view", name: "View Staff", description: "View staff list and profiles", category: "Staff" },
  { code: "staff.create", name: "Create Staff", description: "Add new staff members", category: "Staff" },
  { code: "staff.edit", name: "Edit Staff", description: "Modify staff information", category: "Staff" },
  { code: "staff.manage_photo", name: "Manage Staff Photos", description: "Upload, replace and download staff profile photos", category: "Staff" },
  { code: "staff.delete", name: "Delete Staff", description: "Remove staff from the system", category: "Staff" },
  { code: "staff.assign_subjects", name: "Assign Classes & Subjects", description: "Assign class and subject teaching combinations to staff members", category: "Staff" },

  // Parents
  { code: "parents.view", name: "View Parents", description: "View parent/guardian information", category: "Parents" },
  { code: "parents.create", name: "Create Parents", description: "Add new parents/guardians", category: "Parents" },
  { code: "parents.edit", name: "Edit Parents", description: "Modify parent information", category: "Parents" },
  { code: "parents.manage_photo", name: "Manage Parent Photos", description: "Upload, replace and download parent profile photos", category: "Parents" },
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
  { code: "users.manage_photo", name: "Manage HQ Staff Photos", description: "Upload, replace and download HQ staff profile photos", category: "Users" },
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

  // Recruitment
  { code: "recruitment.view", name: "View Recruitment", description: "View vacancies, applications and recruitment dashboard", category: "Recruitment" },
  { code: "recruitment.vacancies.manage", name: "Manage Recruitment Vacancies", description: "Create, publish, close and archive staff vacancies", category: "Recruitment" },
  { code: "recruitment.requirements.manage", name: "Manage Recruitment Requirements", description: "Configure screening criteria and applicant document categories", category: "Recruitment" },
  { code: "recruitment.applications.review", name: "Review Recruitment Applications", description: "View applicant details, screening results and history", category: "Recruitment" },
  { code: "recruitment.applications.process", name: "Process Recruitment Applications", description: "Shortlist, reject, interview and hire recruitment applicants", category: "Recruitment" },
  { code: "recruitment.rejected_attempts.view", name: "View Rejected Recruitment Attempts", description: "View duplicate and failed-criteria application attempts", category: "Recruitment" },
  { code: "recruitment.documents.view", name: "View Recruitment Documents", description: "View private applicant documents", category: "Recruitment" },
  { code: "recruitment.documents.manage", name: "Manage Recruitment Documents", description: "Manage applicant document records", category: "Recruitment" },
  { code: "recruitment.interviews.manage", name: "Manage Recruitment Interviews", description: "Schedule and record recruitment interviews", category: "Recruitment" },
  { code: "recruitment.settings.manage", name: "Manage Recruitment Settings", description: "Configure public careers and recruitment settings", category: "Recruitment" },

  // Fleet Management
  { code: "fleet.view", name: "View Fleet Management", description: "Open Fleet Management and view vehicles within the user's permitted scope", category: "Fleet Management" },
  { code: "fleet.dashboard.view", name: "View Fleet Dashboard", description: "View Fleet operational summary and alerts", category: "Fleet Management" },
  { code: "fleet.vehicles.manage", name: "Manage Fleet Vehicles", description: "Activate vehicle assets for Fleet and manage operational vehicle profiles", category: "Fleet Management" },
  { code: "fleet.occupants.manage", name: "Manage Fleet Vehicle Occupants", description: "Assign regular vehicle occupants and maintain their route and pickup/drop-off details", category: "Fleet Management" },
  { code: "fleet.drivers.manage", name: "Manage Fleet Drivers", description: "Authorise existing staff members as Fleet drivers and maintain licence details", category: "Fleet Management" },
  { code: "fleet.requests.create", name: "Request Fleet Vehicles", description: "Submit vehicle requests", category: "Fleet Management" },
  { code: "fleet.requests.manage", name: "Manage Fleet Requests", description: "Review, approve, reject and allocate vehicle requests", category: "Fleet Management" },
  { code: "fleet.trips.manage", name: "Manage Fleet Trips", description: "Create and administer Fleet trips", category: "Fleet Management" },
  { code: "fleet.trips.drive", name: "Operate Assigned Fleet Trips", description: "Start and complete trips assigned to the current staff driver", category: "Fleet Management" },
  { code: "fleet.allocations.manage", name: "Manage Fleet Allocations", description: "Create and end standing, school, department and temporary allocations", category: "Fleet Management" },
  { code: "fleet.allocations.cross_school", name: "Manage Cross-School Fleet Allocations", description: "Transfer or allocate Fleet vehicles across organisation centres", category: "Fleet Management" },
  { code: "fleet.odometer.record", name: "Record Fleet Odometers", description: "Capture controlled vehicle odometer readings", category: "Fleet Management" },
  { code: "fleet.fuel.record", name: "Record Fleet Fuel", description: "Record vehicle fuel purchases and operational fuel data", category: "Fleet Management" },
  { code: "fleet.fuel.manage", name: "Manage Fleet Fuel", description: "Review and manage Fleet fuel transactions", category: "Fleet Management" },
  { code: "fleet.inspections.perform", name: "Perform Fleet Inspections", description: "Complete pre-trip, return and scheduled vehicle inspections", category: "Fleet Management" },
  { code: "fleet.inspections.manage", name: "Manage Fleet Inspections", description: "Review inspection results and defects", category: "Fleet Management" },
  { code: "fleet.maintenance.request", name: "Request Fleet Maintenance", description: "Report defects and request vehicle maintenance", category: "Fleet Management" },
  { code: "fleet.maintenance.manage", name: "Manage Fleet Maintenance", description: "Manage detailed vehicle maintenance jobs linked to the asset history", category: "Fleet Management" },
  { code: "fleet.maintenance.approve", name: "Approve Fleet Maintenance", description: "Approve Fleet maintenance work and expenditure", category: "Fleet Management" },
  { code: "fleet.vehicles.suspend", name: "Suspend Fleet Vehicles", description: "Suspend unsafe or non-compliant vehicles", category: "Fleet Management" },
  { code: "fleet.vehicles.release", name: "Release Fleet Vehicles", description: "Return suspended or maintained vehicles to service", category: "Fleet Management" },
  { code: "fleet.compliance.view", name: "View Fleet Compliance", description: "View Fleet licensing, insurance and compliance status", category: "Fleet Management" },
  { code: "fleet.compliance.manage", name: "Manage Fleet Compliance", description: "Maintain owned-vehicle compliance documents and verification", category: "Fleet Management" },
  { code: "fleet.incidents.create", name: "Report Fleet Incidents", description: "Report accidents, breakdowns, damage and safety events", category: "Fleet Management" },
  { code: "fleet.incidents.manage", name: "Manage Fleet Incidents", description: "Manage incidents and insurance claim information", category: "Fleet Management" },
  { code: "fleet.components.manage", name: "Manage Fleet Tyres and Batteries", description: "Track tyres and batteries throughout their lifecycle", category: "Fleet Management" },
  { code: "fleet.disposal.recommend", name: "Recommend Fleet Disposal", description: "Submit a vehicle replacement/disposal recommendation for management review", category: "Fleet Management" },
  { code: "fleet.disposal.manage", name: "Manage Fleet Disposal", description: "Review Fleet disposal recommendations and hand approved cases to the asset disposal process", category: "Fleet Management" },
  { code: "fleet.costs.view", name: "View Fleet Costs", description: "View fuel, maintenance, incident and component operating costs", category: "Fleet Management" },
  { code: "fleet.reports.view", name: "View Fleet Reports", description: "View Fleet utilisation, cost and operational reports", category: "Fleet Management" },
  { code: "fleet.settings.manage", name: "Manage Fleet Settings", description: "Manage organisation Fleet operational settings", category: "Fleet Management" },

  // Record of Marks
  { code: "record_of_marks.view", name: "View Record of Marks", description: "View student marks across assessments", category: "Record of Marks" },
  { code: "record_of_marks.export", name: "Export Record of Marks", description: "Export marks records to file", category: "Record of Marks" },

  // Transport — legacy permissions remain for existing access groups while granular permissions are assigned.
  { code: "transport.view", name: "View Transport", description: "Open the Transport workspace and view school-scoped operational records", category: "Transport" },
  { code: "transport.create", name: "Legacy Transport Create", description: "Legacy compatibility permission for existing Transport access groups", category: "Transport" },
  { code: "transport.edit", name: "Legacy Transport Edit", description: "Legacy compatibility permission for existing Transport access groups", category: "Transport" },
  { code: "transport.delete", name: "Legacy Transport Delete", description: "Legacy compatibility permission for existing Transport access groups", category: "Transport" },
  { code: "transport.dashboard.view", name: "View Transport Dashboard", description: "View Transport operational and financial summary cards", category: "Transport" },
  { code: "transport.hq.settings.manage", name: "Manage Organisation Transport Policy", description: "Manage organisation-wide Transport arrears and suspended-seat policy", category: "Transport" },
  { code: "transport.routes.create", name: "Create Transport Routes", description: "Create school transport routes", category: "Transport" },
  { code: "transport.routes.edit", name: "Edit Transport Routes", description: "Edit and change the lifecycle status of school transport routes", category: "Transport" },
  { code: "transport.stops.manage", name: "Manage Route Stops", description: "Create and edit route stop catalogue records", category: "Transport" },
  { code: "transport.paths.manage", name: "Manage Vehicle Paths", description: "Create, version, arrange and activate vehicle paths and checkpoints", category: "Transport" },
  { code: "transport.vehicles.create", name: "Create Vehicles", description: "Register vehicles within the current school", category: "Transport" },
  { code: "transport.vehicles.edit", name: "Edit Vehicles", description: "Edit vehicle details and effective-dated owner or driver assignments", category: "Transport" },
  { code: "transport.vehicles.override_compliance", name: "Override Vehicle Compliance", description: "Authorise a documented compliance override for a vehicle", category: "Transport" },
  { code: "transport.drivers.manage", name: "Manage Drivers", description: "Create, edit, activate and retire school transport drivers", category: "Transport" },
  { code: "transport.owners.manage", name: "Manage Vehicle Owners", description: "Create, edit, activate and retire vehicle owners", category: "Transport" },
  { code: "transport.documents.view", name: "View Transport Documents", description: "View private owner, driver and vehicle documents and images", category: "Transport" },
  { code: "transport.documents.manage", name: "Manage Transport Documents", description: "Upload, replace, archive and categorize private Transport documents", category: "Transport" },
  { code: "transport.compliance.view", name: "View Transport Compliance", description: "View required, missing, expiring and expired Transport documents", category: "Transport" },
  { code: "transport.compliance.manage", name: "Manage Transport Compliance", description: "Configure Transport document requirements and compliance notifications", category: "Transport" },
  { code: "transport.learners.enrol", name: "Enrol Transport Learners", description: "Register learners, coordinates and pending transport services", category: "Transport" },
  { code: "transport.learners.edit_service", name: "Change Learner Service State", description: "Pause, suspend, resume or terminate learner transport service", category: "Transport" },
  { code: "transport.learners.transfer", name: "Transfer Transport Learners", description: "Transfer learners between paths, stops, vehicles or service terms", category: "Transport" },
  { code: "transport.capacity.override", name: "Override Vehicle Capacity", description: "Authorise an exceptional capacity override with a reason", category: "Transport" },
  { code: "transport.charges.view", name: "View Transport Charges", description: "View monthly learner transport charges and balances", category: "Transport" },
  { code: "transport.charges.generate", name: "Generate Transport Charges", description: "Preview and generate monthly and prorated transport charges", category: "Transport" },
  { code: "transport.charges.adjust", name: "Adjust Transport Charges", description: "Create controlled debit or credit adjustments without editing history", category: "Transport" },
  { code: "transport.payments.view", name: "View Transport Payments", description: "View learner transport payments and allocations", category: "Transport" },
  { code: "transport.payments.record", name: "Record Transport Payments", description: "Record payments and issue secured immutable receipts", category: "Transport" },
  { code: "transport.payments.verify", name: "Verify Transport Payments", description: "Verify payment references and receipt validity", category: "Transport" },
  { code: "transport.payments.reverse", name: "Reverse Transport Payments", description: "Reverse an immutable payment and receipt with a mandatory reason", category: "Transport" },
  { code: "transport.receipts.view", name: "View and Print Transport Receipts", description: "View and print customer and service-provider receipt copies", category: "Transport" },
  { code: "transport.receipts.verify", name: "Verify Transport Receipts", description: "Check receipt validity and claim or payout usage", category: "Transport" },
  { code: "transport.refunds.request", name: "Request Transport Refunds", description: "Request transport credits or external refunds", category: "Transport" },
  { code: "transport.refunds.approve", name: "Approve Transport Refunds", description: "Approve calculated transport credits and refunds", category: "Transport" },
  { code: "transport.refunds.pay", name: "Pay Transport Refunds", description: "Record payment of an approved external refund", category: "Transport" },
  { code: "transport.cashups.prepare", name: "Prepare Transport Cash-Ups", description: "Prepare and submit daily transport payment reconciliations", category: "Transport" },
  { code: "transport.cashups.verify", name: "Verify Transport Cash-Ups", description: "Verify cash-ups and mark included payments as reconciled", category: "Transport" },
  { code: "transport.incidents.manage", name: "Manage Transport Incidents", description: "Log and resolve breakdowns, delays, route issues and other incidents", category: "Transport" },
  { code: "transport.claims.view", name: "View Vehicle Claims", description: "View vehicle claims and eligible receipt allocations", category: "Transport" },
  { code: "transport.claims.generate", name: "Generate Vehicle Claims", description: "Generate vehicle claims from reconciled unclaimed allocations", category: "Transport" },
  { code: "transport.claims.submit", name: "Submit Vehicle Claims", description: "Submit a draft vehicle claim for verification", category: "Transport" },
  { code: "transport.claims.verify", name: "Verify Vehicle Claims", description: "Verify operational and receipt detail on submitted claims", category: "Transport" },
  { code: "transport.claims.approve", name: "Approve Vehicle Claims", description: "Approve verified claims for payout generation", category: "Transport" },
  { code: "transport.penalties.manage", name: "Manage Vehicle Penalties", description: "Create controlled configurable payout deductions for penalties", category: "Transport" },
  { code: "transport.advances.request", name: "Request Vehicle Advances", description: "Record vehicle advance requests and proposed recovery terms", category: "Transport" },
  { code: "transport.advances.approve", name: "Approve Vehicle Advances", description: "Approve or reject fair non-negative vehicle advance recoveries", category: "Transport" },
  { code: "transport.advances.disburse", name: "Disburse Vehicle Advances", description: "Record disbursement references for approved vehicle advances", category: "Transport" },
  { code: "transport.payouts.view", name: "View Payout Slips", description: "View and print immutable vehicle payout slips", category: "Transport" },
  { code: "transport.payouts.generate", name: "Generate Payout Slips", description: "Generate gross, deduction and net payout snapshots", category: "Transport" },
  { code: "transport.payouts.pay", name: "Record Vehicle Payouts", description: "Record full or partial payment against an approved payout slip", category: "Transport" },
  { code: "transport.periods.lock", name: "Lock Transport Periods", description: "Lock approved Transport settlement periods", category: "Transport" },
  { code: "transport.periods.reopen", name: "Reopen Transport Periods", description: "Reopen a locked period with elevated permission and a reason", category: "Transport" },
  { code: "transport.reports.view", name: "View Transport Reports", description: "View periodic learner, collection, claim and payout reports", category: "Transport" },
  { code: "transport.audit.view", name: "View Transport Audit Trail", description: "View detailed immutable Transport audit events", category: "Transport" },
  { code: "transport.settings.manage", name: "Manage Transport Settings", description: "Manage school-specific effective Transport policy values", category: "Transport" },
  { code: "transport.organization.view", name: "View Organisation Transport", description: "View consolidated Transport oversight across all schools", category: "Transport" },
  { code: "transport.organization.reports", name: "View Organisation Transport Reports", description: "View and export organisation Transport comparison reports", category: "Transport" },
  { code: "transport.organization.export", name: "Export Organisation Transport", description: "Export consolidated Transport oversight data", category: "Transport" },
  { code: "transport.organization.manage", name: "Manage Organisation Transport", description: "Perform exceptional organisation-level Transport management", category: "Transport" },
  { code: "transport.subscription.manage", name: "Manage Transport Subscription Policy", description: "Manage organisation-wide provider subscription policy and vehicle overrides", category: "Transport" },
  { code: "transport.hq.claims.manage", name: "Manage HQ Transport Claims", description: "Consolidate, review and approve school transport claims at HQ", category: "Transport" },
  { code: "transport.hq.payouts.manage", name: "Manage HQ Transport Payouts", description: "Create and manage HQ provider payout and payment-run records", category: "Transport" },
  { code: "transport.hq.disbursements.manage", name: "Record HQ Provider Disbursements", description: "Record actual provider cash or electronic disbursements and collectors at HQ", category: "Transport" },

  // Assets & Inventory
  { code: "assets.view", name: "View Assets & Inventory", description: "Open the Assets & Inventory workspace and view school-scoped records", category: "Assets & Inventory" },
  { code: "assets.create", name: "Register Assets", description: "Register new fixed assets", category: "Assets & Inventory" },
  { code: "assets.edit", name: "Edit Assets", description: "Edit and archive fixed asset records", category: "Assets & Inventory" },
  { code: "assets.assign", name: "Assign and Return Assets", description: "Issue assets to custodians and process returns", category: "Assets & Inventory" },
  { code: "assets.transfer", name: "Transfer Assets", description: "Transfer assets between approved locations", category: "Assets & Inventory" },
  { code: "assets.maintenance", name: "Manage Asset Maintenance", description: "Report, update and complete maintenance work", category: "Assets & Inventory" },
  { code: "assets.dispose", name: "Dispose Assets", description: "Approve asset write-off and disposal", category: "Assets & Inventory" },
  { code: "assets.reports", name: "View Asset Reports", description: "View and export asset reports", category: "Assets & Inventory" },
  { code: "assets.setup.manage", name: "Manage Asset Setup", description: "Manage categories, stores and locations", category: "Assets & Inventory" },
  { code: "assets.view.organization", name: "View Organisation Assets", description: "View consolidated assets and inventory across all centres", category: "Assets & Inventory" },
  { code: "assets.manage.organization", name: "Manage Organisation Assets", description: "Manage HQ and centre-scoped asset operations across the organisation", category: "Assets & Inventory" },
  { code: "inventory.view", name: "View Inventory", description: "View inventory balances and movement history", category: "Assets & Inventory" },
  { code: "inventory.items.manage", name: "Manage Inventory Items", description: "Create and edit inventory catalogue items", category: "Assets & Inventory" },
  { code: "inventory.receive", name: "Receive Inventory", description: "Receive stock through controlled movements", category: "Assets & Inventory" },
  { code: "inventory.issue", name: "Issue Inventory", description: "Issue and return stock through controlled movements", category: "Assets & Inventory" },
  { code: "inventory.adjust", name: "Adjust Inventory", description: "Create authorised stock adjustments and write-offs", category: "Assets & Inventory" },
  { code: "inventory.stocktake", name: "Manage Stocktakes", description: "Create and approve physical stocktakes", category: "Assets & Inventory" },
  { code: "inventory.reports", name: "View Inventory Reports", description: "View and export inventory reports", category: "Assets & Inventory" },
  { code: "inventory.low_stock.view", name: "View Low-stock Alerts", description: "View and acknowledge stock threshold alerts", category: "Assets & Inventory" },
  { code: "inventory.restock.request", name: "Request Restocking", description: "Create replenishment and purchase requests", category: "Assets & Inventory" },
  { code: "inventory.restock.approve", name: "Approve Restocking", description: "Approve restock and purchase requests", category: "Assets & Inventory" },
  { code: "inventory.procurement.view", name: "View Procurement", description: "View suppliers, purchase requests, orders and goods receipts", category: "Assets & Inventory" },
  { code: "inventory.procurement.request", name: "Create Purchase Requests", description: "Create and submit purchase requests", category: "Assets & Inventory" },
  { code: "inventory.procurement.approve", name: "Approve Procurement", description: "Approve purchase requests and purchase orders", category: "Assets & Inventory" },
  { code: "inventory.procurement.order", name: "Manage Purchase Orders", description: "Create and issue supplier purchase orders", category: "Assets & Inventory" },
  { code: "inventory.procurement.receive", name: "Receive Procured Goods", description: "Inspect deliveries and post goods received notes", category: "Assets & Inventory" },
  { code: "inventory.transfer.request", name: "Request Centre Transfers", description: "Request stock and asset movements between centres", category: "Assets & Inventory" },
  { code: "inventory.transfer.approve", name: "Approve Centre Transfers", description: "Approve inter-centre asset and stock transfers", category: "Assets & Inventory" },
  { code: "inventory.transfer.dispatch", name: "Dispatch Centre Transfers", description: "Dispatch approved centre transfers", category: "Assets & Inventory" },
  { code: "inventory.transfer.receive", name: "Receive Centre Transfers", description: "Receive and reconcile centre transfers", category: "Assets & Inventory" },
  { code: "damage.view", name: "View Breakage Cases", description: "View damage, loss and breakage cases", category: "Assets & Inventory" },
  { code: "damage.report", name: "Report Breakages", description: "Report damage, loss and breakages", category: "Assets & Inventory" },
  { code: "damage.investigate", name: "Investigate Breakages", description: "Record findings and propose liability charges", category: "Assets & Inventory" },
  { code: "damage.approve_charge", name: "Approve Damage Charges", description: "Approve, reject or waive proposed damage charges", category: "Assets & Inventory" },
  { code: "damage.record_recovery", name: "Record Damage Recoveries", description: "Record payments and recoveries against approved charges", category: "Assets & Inventory" },
  { code: "damage.reports", name: "View Damage Reports", description: "View damage liability and recovery reports", category: "Assets & Inventory" },

  // Access Control
  { code: "access_control.view", name: "View Access Control", description: "View physical Gates, Gate Bridges, face terminals, health and connection status", category: "Access Control" },
  { code: "access_control.control_gates", name: "Control Gates", description: "Send audited terminal connection tests and manual physical gate-open commands", category: "Access Control" },
  { code: "access_control.manage_devices", name: "Manage Access Control Devices", description: "Create Gates and Gate Bridges and configure terminal lane assignments, IP addresses and ports", category: "Access Control" },
  { code: "access_control.audit.view", name: "View Access Control Audit", description: "View Access Control operational logs, security-relevant events and command history", category: "Access Control" },
  { code: "access_control.identities.manage", name: "Manage Access Identities", description: "Enroll, resynchronize and remove student and staff identities on face terminals", category: "Access Control" },
  { code: "access_control.financial_override.view", name: "View Financial Access Overrides", description: "View temporary financial access overrides for students", category: "Access Control" },
  { code: "access_control.financial_override.create", name: "Grant Financial Access Overrides", description: "Grant time-limited temporary student entry access overrides within policy limits", category: "Access Control" },
  { code: "access_control.financial_override.revoke", name: "Revoke Financial Access Overrides", description: "Revoke active or scheduled financial access overrides", category: "Access Control" },
  { code: "access_control.early_release.manage", name: "Manage Student Early Release", description: "Create and revoke audited student early-release authorisations", category: "Access Control" },
  { code: "access_control.staff_departure.manage", name: "Manage Staff Early Departure", description: "Create audited staff early-departure approvals", category: "Access Control" },
  { code: "access_control.attendance_correction", name: "Correct Gate Attendance Evidence", description: "Correct exceptional Gate-confirmed student attendance evidence with a mandatory audited reason", category: "Access Control" },

  // Placeholder / Coming Soon Modules
  { code: "kundai.view", name: "View kundAi", description: "Open the kundAi module", category: "kundAi" },
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
