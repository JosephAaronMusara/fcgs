import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, date, decimal, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoleEnum = pgEnum("user_role", ["org_admin", "school_admin", "teacher", "quality_control_officer", "assistant_teacher", "librarian", "student", "parent"]);

export const genderEnum = pgEnum("gender", ["male", "female"]);

export const subjectTypeEnum = pgEnum("subject_type", ["ZIMSEC", "Cambridge", "HEXCO"]);

export const attendanceStatusEnum = pgEnum("attendance_status", ["present", "absent", "sick", "fees", "suspended", "absconding", "excused", "late"]);

export const staffStatusEnum = pgEnum("staff_status", ["active", "inactive"]);

export const studentStatusEnum = pgEnum("student_status", ["active", "inactive", "transferred", "graduated"]);

export const hostelStatusEnum = pgEnum("hostel_status", ["present", "absent", "leave", "sick"]);

export const calendarScopeEnum = pgEnum("calendar_scope", [
  "personal",
  "class",
  "school",
  "org",
]);

export const calendarReminderChannelEnum = pgEnum(
  "calendar_reminder_channel",
  ["in_app", "email", "sms"],
);

export const calendarAttendeeStatusEnum = pgEnum(
  "calendar_attendee_status",
  ["invited", "accepted", "declined"],
);

export const scheduledJobTypeEnum = pgEnum("scheduled_job_type", [
  "calendar_reminder",
]);

export const scheduledJobStatusEnum = pgEnum("scheduled_job_status", [
  "pending",
  "processing",
  "sent",
  "failed",
  "dead",
]);

export const organizations = pgTable("organizations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  logo: text("logo"),
  stamp: text("stamp"),
  motto: text("motto"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  currentAcademicYear: text("current_academic_year"),
  currentTerm: text("current_term").default("term1"),
  term1StartDate: date("term1_start_date"),
  term1EndDate: date("term1_end_date"),
  vac1StartDate: date("vac1_start_date"),
  vac1EndDate: date("vac1_end_date"),
  term2StartDate: date("term2_start_date"),
  term2EndDate: date("term2_end_date"),
  vac2StartDate: date("vac2_start_date"),
  vac2EndDate: date("vac2_end_date"),
  term3StartDate: date("term3_start_date"),
  term3EndDate: date("term3_end_date"),
  photoUploadLimitMB: integer("photo_upload_limit_mb").default(5),
  systemUrl: text("system_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const schools = pgTable("schools", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  shortCode: text("short_code").notNull(),
  logo: text("logo"),
  stamp: text("stamp"),
  motto: text("motto"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  principalName: text("principal_name"),
  principalEmail: text("principal_email"),
  principalPhone: text("principal_phone"),
  enableFinance: boolean("enable_finance").default(true),
  enableHostel: boolean("enable_hostel").default(false),
  enablePOS: boolean("enable_pos").default(false),
  enableELibrary: boolean("enable_e_library").default(true),
  enableELogbook: boolean("enable_e_logbook").default(true),
  enableTransport: boolean("enable_transport").default(false),
  enableESchemes: boolean("enable_e_schemes").default(true),
  currentAcademicYear: text("current_academic_year"),
  currentTerm: text("current_term").default("term1"),
  term1StartDate: date("term1_start_date"),
  term1EndDate: date("term1_end_date"),
  vac1StartDate: date("vac1_start_date"),
  vac1EndDate: date("vac1_end_date"),
  term2StartDate: date("term2_start_date"),
  term2EndDate: date("term2_end_date"),
  vac2StartDate: date("vac2_start_date"),
  vac2EndDate: date("vac2_end_date"),
  term3StartDate: date("term3_start_date"),
  term3EndDate: date("term3_end_date"),
  examinationBoard: text("examination_board").default("ZIMSEC"),
  reportCardAssessmentTypeId: integer("report_card_assessment_type_id"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  callCentrePhone: text("call_centre_phone"),
  callCentreWhatsApp: text("call_centre_whatsapp"),
  schoolType: text("school_type").default("secondary"),
  terminationStatus: text("termination_status"),
  terminationRequestedAt: timestamp("termination_requested_at"),
  terminationAt: timestamp("termination_at"),
  terminationByUserId: integer("termination_by_user_id").references(() => users.id),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  role: userRoleEnum("role").notNull().default("student"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  schoolId: integer("school_id").references(() => schools.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  isActive: boolean("is_active").default(true),
  passwordResetToken: text("password_reset_token"),
  passwordResetTokenExpiry: timestamp("password_reset_token_expiry"),
  tempPasswordLoginsRemaining: integer("temp_password_logins_remaining"),
  mustResetPassword: boolean("must_reset_password").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const staff = pgTable("staff", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id),
  schoolId: integer("school_id").references(() => schools.id),
  staffNo: text("staff_no").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  gender: genderEnum("gender"),
  address: text("address"),
  streetAddress: text("street_address"),
  residentialArea: text("residential_area"),
  photo: text("photo"),
  role: text("role").default("teacher"),
  status: staffStatusEnum("status").default("active"),
  mobileId: text("mobile_id"),
  accessGroupId: integer("access_group_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const streams = pgTable("streams", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  description: text("description"),
  schoolType: text("school_type").default("secondary"),
  sortOrder: integer("sort_order").default(0),
});

export const classes = pgTable("classes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  className: text("class_name").notNull(),
  shortCode: text("short_code"),
  streamId: integer("stream_id").references(() => streams.id),
  classTeacherId: integer("class_teacher_id").references(() => staff.id),
  capacity: integer("capacity").default(40),
  createdAt: timestamp("created_at").defaultNow(),
});

export const classSubjects = pgTable("class_subjects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
});

export const parents = pgTable("parents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id),
  schoolId: integer("school_id").references(() => schools.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone").notNull(),
  address: text("address"),
  streetAddress: text("street_address"),
  residentialArea: text("residential_area"),
  occupation: text("occupation"),
  relationship: text("relationship").default("parent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const students = pgTable("students", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id),
  schoolId: integer("school_id").references(() => schools.id),
  admissionNo: text("admission_no").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  gender: genderEnum("gender"),
  dateOfBirth: date("date_of_birth"),
  address: text("address"),
  streetAddress: text("street_address"),
  residentialArea: text("residential_area"),
  photo: text("photo"),
  classId: integer("class_id").references(() => classes.id),
  streamId: integer("stream_id").references(() => streams.id),
  parentId: integer("parent_id").references(() => parents.id),
  hostelId: integer("hostel_id").references(() => hostels.id),
  isBoarding: boolean("is_boarding").default(false),
  isDayScholar: boolean("is_day_scholar").default(false),
  status: studentStatusEnum("status").default("active"),
  enrollmentDate: date("enrollment_date"),
  feesTotalTerm: decimal("fees_total_term", { precision: 10, scale: 2 }).default("0"),
  feesPaidSoFar: decimal("fees_paid_so_far", { precision: 10, scale: 2 }).default("0"),
  feesBalance: decimal("fees_balance", { precision: 10, scale: 2 }).default("0"),
  feesMaxBalance: decimal("fees_max_balance", { precision: 10, scale: 2 }).default("0"),
  feesCustomerId: text("fees_customer_id"),
  feesStatus: text("fees_status").default("n/a"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const subjects = pgTable("subjects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  name: text("name").notNull(),
  shortCode: text("short_code").notNull(),
  syllabusCode: text("syllabus_code"),
  subjectType: subjectTypeEnum("subject_type"),
  description: text("description"),
  streamId: integer("stream_id").references(() => streams.id),
  streamIds: integer("stream_ids").array(),
});

export const staffSubjects = pgTable("staff_subjects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  staffId: integer("staff_id").references(() => staff.id).notNull(),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
  classId: integer("class_id").references(() => classes.id),
});

export const studentSubjects = pgTable("student_subjects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
});

export const gradeLevelEnum = pgEnum("grade_level", ["A_Level", "O_Level", "IGCSE"]);

export const grades = pgTable("grades", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  gradeName: text("grade_name").notNull(),
  gradeLevel: gradeLevelEnum("grade_level").notNull(),
  classIds: integer("class_ids").array(),
  appliesAll: boolean("applies_all").default(false),
  lowerLimit: integer("lower_limit").notNull(),
  upperLimit: integer("upper_limit").notNull(),
  gradePoints: decimal("grade_points", { precision: 3, scale: 1 }),
  gradeStatus: text("grade_status"),
  gradeType: subjectTypeEnum("grade_type"),
});

export const assessments = pgTable("assessments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  name: text("name").notNull(),
  topic: text("topic").notNull(),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  assessmentTypeId: integer("assessment_type_id"),
  assessmentDate: date("assessment_date"),
  dueDate: date("due_date"),
  totalMarks: integer("total_marks").default(100),
  termId: integer("term_id"),
  year: integer("year"),
  examId: integer("exam_id"),
  isPublished: boolean("is_published").default(false),
  createdBy: integer("created_by").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const marks = pgTable("marks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  assessmentId: integer("assessment_id").references(() => assessments.id).notNull(),
  marksObtained: decimal("marks_obtained", { precision: 5, scale: 2 }),
  grade: text("grade"),
  comment: text("comment"),
  markedBy: integer("marked_by").references(() => staff.id),
  markedAt: timestamp("marked_at").defaultNow(),
});

export const attendanceRecords = pgTable("attendance_records", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  date: date("date").notNull(),
  status: attendanceStatusEnum("status").notNull().default("present"),
  reason: text("reason"),
  notifyParent: boolean("notify_parent").default(false),
  notifiedStatus: text("notified_status"),
  notifiedReason: text("notified_reason"),
  markedBy: integer("marked_by").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const disciplineRecords = pgTable("discipline_records", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  incidentDate: date("incident_date").notNull(),
  incidentType: text("incident_type").notNull(),
  description: text("description"),
  actionTaken: text("action_taken"),
  severity: text("severity").default("minor"),
  reportedBy: integer("reported_by").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const clinicRecords = pgTable("clinic_records", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  visitDate: date("visit_date").notNull(),
  visitType: text("visit_type").notNull(),
  symptoms: text("symptoms"),
  diagnosis: text("diagnosis"),
  treatment: text("treatment"),
  medicationGiven: text("medication_given"),
  temperature: text("temperature"),
  bloodPressure: text("blood_pressure"),
  weight: text("weight"),
  severity: text("severity").default("mild"),
  followUpRequired: boolean("follow_up_required").default(false),
  followUpDate: date("follow_up_date"),
  parentNotified: boolean("parent_notified").default(false),
  referredToHospital: boolean("referred_to_hospital").default(false),
  hospitalName: text("hospital_name"),
  attendedBy: integer("attended_by").references(() => staff.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const feesPayments = pgTable("fees_payments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: text("payment_method").default("cash"),
  term: text("term"),
  year: integer("year"),
  receiptNo: text("receipt_no"),
  receivedBy: integer("received_by").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const libraryResources = pgTable("library_resources", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"),
  subjectId: integer("subject_id").references(() => subjects.id),
  classId: integer("class_id").references(() => classes.id),
  fileUrl: text("file_url"),
  fileType: text("file_type"),
  uploadedBy: integer("uploaded_by").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const libraryBookStatusEnum = pgEnum("library_book_status", ["available", "borrowed", "lost", "damaged", "reserved"]);
export const libraryLoanStatusEnum = pgEnum("library_loan_status", ["active", "returned", "overdue", "lost"]);
export const libraryFineStatusEnum = pgEnum("library_fine_status", ["unpaid", "paid", "waived"]);
export const libraryBorrowerTypeEnum = pgEnum("library_borrower_type", ["student", "staff"]);

export const libraryCategories = pgTable("library_categories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const libraryBooks = pgTable("library_books", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  title: text("title").notNull(),
  author: text("author"),
  isbn: text("isbn"),
  publisher: text("publisher"),
  edition: text("edition"),
  publishYear: integer("publish_year"),
  publicationDate: date("publication_date"),
  categoryId: integer("category_id").references(() => libraryCategories.id),
  subjectId: integer("subject_id").references(() => subjects.id),
  classId: integer("class_id").references(() => classes.id),
  streamId: integer("stream_id").references(() => streams.id),
  description: text("description"),
  totalCopies: integer("total_copies").default(1),
  availableCopies: integer("available_copies").default(1),
  damagedCopies: integer("damaged_copies").default(0),
  lostStolenCopies: integer("lost_stolen_copies").default(0),
  shelfLocation: text("shelf_location"),
  coverImage: text("cover_image"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const libraryCopyStatusEnum = pgEnum("library_copy_status", ["available", "borrowed", "damaged", "lost"]);

export const libraryBookCopies = pgTable("library_book_copies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  bookId: integer("book_id").references(() => libraryBooks.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id),
  qrCode: text("qr_code").notNull().unique(),
  status: libraryCopyStatusEnum("status").default("available"),
  condition: text("condition").default("Good"),
  addedAt: timestamp("added_at").defaultNow(),
});

export const libraryLoans = pgTable("library_loans", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  bookId: integer("book_id").references(() => libraryBooks.id).notNull(),
  copyId: integer("copy_id").references(() => libraryBookCopies.id),
  borrowerType: libraryBorrowerTypeEnum("borrower_type").notNull(),
  borrowerId: integer("borrower_id").notNull(),
  borrowerName: text("borrower_name"),
  issuedBy: integer("issued_by").references(() => staff.id),
  issuedAt: timestamp("issued_at").defaultNow(),
  dueDate: date("due_date").notNull(),
  returnedAt: timestamp("returned_at"),
  conditionOnBorrow: text("condition_on_borrow").default("good"),
  status: libraryLoanStatusEnum("status").default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const libraryFines = pgTable("library_fines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  loanId: integer("loan_id").references(() => libraryLoans.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason"),
  status: libraryFineStatusEnum("status").default("unpaid"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const libraryReservationStatusEnum = pgEnum("library_reservation_status", ["pending", "ready", "fulfilled", "cancelled"]);

export const libraryReservations = pgTable("library_reservations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  bookId: integer("book_id").references(() => libraryBooks.id).notNull(),
  reserverType: libraryBorrowerTypeEnum("reserver_type").notNull(),
  reserverId: integer("reserver_id").notNull(),
  reserverName: text("reserver_name"),
  status: libraryReservationStatusEnum("status").default("pending"),
  reservedAt: timestamp("reserved_at").defaultNow(),
  notifiedAt: timestamp("notified_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const libraryPolicies = pgTable("library_policies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  bookOverdueSmsAlert: boolean("book_overdue_sms_alert").default(true),
  maxBooksStudent: integer("max_books_student").default(1),
  maxBooksTeacher: integer("max_books_teacher").default(500),
  overdueChargePerDay: text("overdue_charge_per_day").default("0.50"),
  defaultBorrowDays: integer("default_borrow_days").default(1),
  smsAlertWindowDays: integer("sms_alert_window_days").default(1),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const timetableSlots = pgTable("timetable_slots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  classId: integer("class_id").references(() => classes.id).notNull(),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
  teacherId: integer("teacher_id").references(() => staff.id),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  room: text("room"),
  term: text("term"),
  year: integer("year"),
});

export const logbookEntries = pgTable("logbook_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  teacherId: integer("teacher_id").references(() => staff.id).notNull(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
  date: date("date").notNull(),
  topic: text("topic").notNull(),
  objectives: text("objectives"),
  activities: text("activities"),
  resources: text("resources"),
  homework: text("homework"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const staffAttendanceLogs = pgTable("staff_attendance_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  staffId: integer("staff_id").references(() => staff.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  date: date("date").notNull(),
  clockIn: timestamp("clock_in"),
  clockOut: timestamp("clock_out"),
  status: text("status").notNull().default("on_time"),
  clockInLatitude: text("clock_in_latitude"),
  clockInLongitude: text("clock_in_longitude"),
  clockOutLatitude: text("clock_out_latitude"),
  clockOutLongitude: text("clock_out_longitude"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const posItems = pgTable("pos_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  stockQty: integer("stock_qty").default(0),
  sku: text("sku"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const posSales = pgTable("pos_sales", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  saleDate: timestamp("sale_date").defaultNow(),
  customerName: text("customer_name"),
  studentId: integer("student_id").references(() => students.id),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").default("cash"),
  receiptNo: text("receipt_no"),
  soldBy: integer("sold_by").references(() => staff.id),
  exported: boolean("exported").default(false),
});

export const posSaleItems = pgTable("pos_sale_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  saleId: integer("sale_id").references(() => posSales.id).notNull(),
  itemId: integer("item_id").references(() => posItems.id).notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
});

export const newsletters = pgTable("newsletters", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  targetAudience: text("target_audience").default("all"),
  channels: text("channels").array().default(["email"]),
  publishDate: timestamp("publish_date").defaultNow(),
  isPublished: boolean("is_published").default(false),
  createdBy: integer("created_by").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const schemes = pgTable("schemes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
  classId: integer("class_id").references(() => classes.id),
  teacherId: integer("teacher_id").references(() => staff.id),
  term: text("term").notNull(),
  year: integer("year").notNull(),
  week: integer("week"),
  topic: text("topic").notNull(),
  objectives: text("objectives"),
  activities: text("activities"),
  resources: text("resources"),
  assessment: text("assessment"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const hostels = pgTable("hostels", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  name: text("name").notNull(),
  capacity: integer("capacity"),
  gender: genderEnum("gender"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const hostelRollCall = pgTable("hostel_roll_call", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  studentId: integer("student_id").references(() => students.id).notNull(),
  date: date("date").notNull(),
  timeSlot: text("time_slot").notNull(),
  status: hostelStatusEnum("status").notNull().default("present"),
  notes: text("notes"),
  markedBy: integer("marked_by").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const studentApplications = pgTable("student_applications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dateOfBirth: date("date_of_birth"),
  gender: genderEnum("gender"),
  previousSchool: text("previous_school"),
  gradeApplyingFor: text("grade_applying_for"),
  religion: text("religion"),
  streetAddress: text("street_address"),
  residentialArea: text("residential_area"),
  subjectsOfInterest: text("subjects_of_interest"),
  parentName: text("parent_name").notNull(),
  parentPhone: text("parent_phone").notNull(),
  parentEmail: text("parent_email"),
  parentRelationship: text("parent_relationship"),
  address: text("address"),
  birthEntryNumber: text("birth_entry_number"),
  dreamJob: text("dream_job"),
  expectedStartDate: date("expected_start_date"),
  documents: text("documents"),
  status: text("status").default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const accessGroups = pgTable("access_groups", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  description: text("description"),
  isSystemDefault: boolean("is_system_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const accessGroupPermissions = pgTable("access_group_permissions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accessGroupId: integer("access_group_id").references(() => accessGroups.id).notNull(),
  permissionId: integer("permission_id").references(() => permissions.id).notNull(),
});

export const userAccessGroups = pgTable("user_access_groups", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id).notNull(),
  accessGroupId: integer("access_group_id").references(() => accessGroups.id).notNull(),
});

export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id).notNull(),
  permissionId: integer("permission_id").references(() => permissions.id).notNull(),
  granted: boolean("granted").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userSchoolAccess = pgTable("user_school_access", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export const insertSchoolSchema = createInsertSchema(schools).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertStaffSchema = createInsertSchema(staff).omit({ id: true, createdAt: true });
export const insertStreamSchema = createInsertSchema(streams).omit({ id: true });
export const insertClassSchema = createInsertSchema(classes).omit({ id: true, createdAt: true });
export const insertParentSchema = createInsertSchema(parents).omit({ id: true, createdAt: true });
export const insertStudentSchema = createInsertSchema(students).omit({ id: true, createdAt: true });
export const insertSubjectSchema = createInsertSchema(subjects).omit({ id: true });
export const insertStaffSubjectSchema = createInsertSchema(staffSubjects).omit({ id: true });
export const insertStudentSubjectSchema = createInsertSchema(studentSubjects).omit({ id: true });
export const insertClassSubjectSchema = createInsertSchema(classSubjects).omit({ id: true });
export const insertGradeSchema = createInsertSchema(grades).omit({ id: true });
export const insertAssessmentSchema = createInsertSchema(assessments).omit({ id: true, createdAt: true });
export const insertMarkSchema = createInsertSchema(marks).omit({ id: true, markedAt: true });
export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecords).omit({ id: true, createdAt: true });
export const insertDisciplineRecordSchema = createInsertSchema(disciplineRecords).omit({ id: true, createdAt: true });
export const insertClinicRecordSchema = createInsertSchema(clinicRecords).omit({ id: true, createdAt: true });
export const insertFeesPaymentSchema = createInsertSchema(feesPayments).omit({ id: true, createdAt: true });
export const insertLibraryResourceSchema = createInsertSchema(libraryResources).omit({ id: true, createdAt: true });
export const insertLibraryCategorySchema = createInsertSchema(libraryCategories).omit({ id: true, createdAt: true });
export const insertLibraryBookSchema = createInsertSchema(libraryBooks).omit({ id: true, createdAt: true });
export const insertLibraryBookCopySchema = createInsertSchema(libraryBookCopies).omit({ id: true, addedAt: true });
export const insertLibraryLoanSchema = createInsertSchema(libraryLoans).omit({ id: true, createdAt: true, issuedAt: true, returnedAt: true });
export const insertLibraryFineSchema = createInsertSchema(libraryFines).omit({ id: true, createdAt: true, paidAt: true });
export const insertLibraryReservationSchema = createInsertSchema(libraryReservations).omit({ id: true, createdAt: true, reservedAt: true, notifiedAt: true });
export const insertLibraryPolicySchema = createInsertSchema(libraryPolicies).omit({ id: true, updatedAt: true });
export const insertTimetableSlotSchema = createInsertSchema(timetableSlots).omit({ id: true });
export const insertLogbookEntrySchema = createInsertSchema(logbookEntries).omit({ id: true, createdAt: true });
export const insertStaffAttendanceLogSchema = createInsertSchema(staffAttendanceLogs).omit({ id: true, createdAt: true });
export const insertPosItemSchema = createInsertSchema(posItems).omit({ id: true, createdAt: true });
export const insertPosSaleSchema = createInsertSchema(posSales).omit({ id: true, saleDate: true });
export const insertPosSaleItemSchema = createInsertSchema(posSaleItems).omit({ id: true });
export const insertNewsletterSchema = createInsertSchema(newsletters).omit({ id: true, createdAt: true });
export const insertSchemeSchema = createInsertSchema(schemes).omit({ id: true, createdAt: true });
export const insertHostelSchema = createInsertSchema(hostels).omit({ id: true, createdAt: true });
export const insertHostelRollCallSchema = createInsertSchema(hostelRollCall).omit({ id: true, createdAt: true });
export const insertStudentApplicationSchema = createInsertSchema(studentApplications).omit({ id: true, createdAt: true });
export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true, createdAt: true });
export const insertAccessGroupSchema = createInsertSchema(accessGroups).omit({ id: true, createdAt: true });
export const insertAccessGroupPermissionSchema = createInsertSchema(accessGroupPermissions).omit({ id: true });
export const insertUserAccessGroupSchema = createInsertSchema(userAccessGroups).omit({ id: true });
export const insertUserPermissionOverrideSchema = createInsertSchema(userPermissionOverrides).omit({ id: true, createdAt: true });
export const insertUserSchoolAccessSchema = createInsertSchema(userSchoolAccess).omit({ id: true });

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;
export type InsertSchool = z.infer<typeof insertSchoolSchema>;
export type School = typeof schools.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staff.$inferSelect;
export type InsertStream = z.infer<typeof insertStreamSchema>;
export type Stream = typeof streams.$inferSelect;
export type InsertClass = z.infer<typeof insertClassSchema>;
export type Class = typeof classes.$inferSelect;
export type InsertParent = z.infer<typeof insertParentSchema>;
export type Parent = typeof parents.$inferSelect;
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof students.$inferSelect;
export type InsertSubject = z.infer<typeof insertSubjectSchema>;
export type Subject = typeof subjects.$inferSelect;
export type InsertStaffSubject = z.infer<typeof insertStaffSubjectSchema>;
export type StaffSubject = typeof staffSubjects.$inferSelect;
export type InsertStudentSubject = z.infer<typeof insertStudentSubjectSchema>;
export type StudentSubject = typeof studentSubjects.$inferSelect;
export type InsertClassSubject = z.infer<typeof insertClassSubjectSchema>;
export type ClassSubject = typeof classSubjects.$inferSelect;
export type InsertGrade = z.infer<typeof insertGradeSchema>;
export type Grade = typeof grades.$inferSelect;
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;
export type Assessment = typeof assessments.$inferSelect;
export type InsertMark = z.infer<typeof insertMarkSchema>;
export type Mark = typeof marks.$inferSelect;
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type InsertDisciplineRecord = z.infer<typeof insertDisciplineRecordSchema>;
export type DisciplineRecord = typeof disciplineRecords.$inferSelect;
export type InsertClinicRecord = z.infer<typeof insertClinicRecordSchema>;
export type ClinicRecord = typeof clinicRecords.$inferSelect;
export type InsertFeesPayment = z.infer<typeof insertFeesPaymentSchema>;
export type FeesPayment = typeof feesPayments.$inferSelect;
export type InsertLibraryResource = z.infer<typeof insertLibraryResourceSchema>;
export type LibraryResource = typeof libraryResources.$inferSelect;
export type InsertLibraryCategory = z.infer<typeof insertLibraryCategorySchema>;
export type LibraryCategory = typeof libraryCategories.$inferSelect;
export type InsertLibraryBook = z.infer<typeof insertLibraryBookSchema>;
export type LibraryBook = typeof libraryBooks.$inferSelect;
export type InsertLibraryBookCopy = z.infer<typeof insertLibraryBookCopySchema>;
export type LibraryBookCopy = typeof libraryBookCopies.$inferSelect;
export type InsertLibraryLoan = z.infer<typeof insertLibraryLoanSchema>;
export type LibraryLoan = typeof libraryLoans.$inferSelect;
export type InsertLibraryFine = z.infer<typeof insertLibraryFineSchema>;
export type LibraryFine = typeof libraryFines.$inferSelect;
export type InsertLibraryReservation = z.infer<typeof insertLibraryReservationSchema>;
export type LibraryReservation = typeof libraryReservations.$inferSelect;
export type InsertLibraryPolicy = z.infer<typeof insertLibraryPolicySchema>;
export type LibraryPolicy = typeof libraryPolicies.$inferSelect;
export type InsertTimetableSlot = z.infer<typeof insertTimetableSlotSchema>;
export type TimetableSlot = typeof timetableSlots.$inferSelect;
export type InsertLogbookEntry = z.infer<typeof insertLogbookEntrySchema>;
export type LogbookEntry = typeof logbookEntries.$inferSelect;
export type InsertStaffAttendanceLog = z.infer<typeof insertStaffAttendanceLogSchema>;
export type StaffAttendanceLog = typeof staffAttendanceLogs.$inferSelect;
export type InsertPosItem = z.infer<typeof insertPosItemSchema>;
export type PosItem = typeof posItems.$inferSelect;
export type InsertPosSale = z.infer<typeof insertPosSaleSchema>;
export type PosSale = typeof posSales.$inferSelect;
export type InsertPosSaleItem = z.infer<typeof insertPosSaleItemSchema>;
export type PosSaleItem = typeof posSaleItems.$inferSelect;
export type InsertNewsletter = z.infer<typeof insertNewsletterSchema>;
export type Newsletter = typeof newsletters.$inferSelect;
export type InsertScheme = z.infer<typeof insertSchemeSchema>;
export type Scheme = typeof schemes.$inferSelect;
export type InsertHostel = z.infer<typeof insertHostelSchema>;
export type Hostel = typeof hostels.$inferSelect;
export type InsertHostelRollCall = z.infer<typeof insertHostelRollCallSchema>;
export type HostelRollCall = typeof hostelRollCall.$inferSelect;
export type InsertStudentApplication = z.infer<typeof insertStudentApplicationSchema>;
export type StudentApplication = typeof studentApplications.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissions.$inferSelect;
export type InsertAccessGroup = z.infer<typeof insertAccessGroupSchema>;
export type AccessGroup = typeof accessGroups.$inferSelect;
export type InsertAccessGroupPermission = z.infer<typeof insertAccessGroupPermissionSchema>;
export type AccessGroupPermission = typeof accessGroupPermissions.$inferSelect;
export type InsertUserAccessGroup = z.infer<typeof insertUserAccessGroupSchema>;
export type UserAccessGroup = typeof userAccessGroups.$inferSelect;
export type InsertUserPermissionOverride = z.infer<typeof insertUserPermissionOverrideSchema>;
export type UserPermissionOverride = typeof userPermissionOverrides.$inferSelect;
export type InsertUserSchoolAccess = z.infer<typeof insertUserSchoolAccessSchema>;
export type UserSchoolAccess = typeof userSchoolAccess.$inferSelect;

// Communication Logs
export const communicationChannelEnum = pgEnum("communication_channel", ["email", "sms", "whatsapp"]);
export const communicationStatusEnum = pgEnum("communication_status", ["pending", "sent", "failed", "delivered"]);

export const communicationLogs = pgTable("communication_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  channel: communicationChannelEnum("channel").notNull(),
  recipientType: text("recipient_type").notNull(), // staff, student, parent
  recipientId: integer("recipient_id"),
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  recipientName: text("recipient_name"),
  subject: text("subject"),
  message: text("message").notNull(),
  category: text("category"), // attendance, academic_reports, account, notices, general
  status: communicationStatusEnum("status").default("pending"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  sentBy: integer("sent_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCommunicationLogSchema = createInsertSchema(communicationLogs).omit({ id: true, createdAt: true });
export type InsertCommunicationLog = z.infer<typeof insertCommunicationLogSchema>;
export type CommunicationLog = typeof communicationLogs.$inferSelect;

// Assessment Types (lookup table)
export const assessmentTypes = pgTable("assessment_types", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Exam Types (lookup table)
export const examTypes = pgTable("exam_types", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Exams (linked to assessments)
export const exams = pgTable("exams", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  examName: text("exam_name").notNull(),
  examTypeId: integer("exam_type_id").references(() => examTypes.id),
  assessmentTypeId: integer("assessment_type_id").references(() => assessmentTypes.id),
  termId: integer("term_id"),
  year: integer("year"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  isPublished: boolean("is_published").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Assessment Papers (multiple papers per assessment, weights must sum to 100%)
export const assessmentPapers = pgTable("assessment_papers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  assessmentId: integer("assessment_id").references(() => assessments.id).notNull(),
  paperName: text("paper_name").notNull(),
  paperMarks: integer("paper_marks").notNull(),
  paperWeightPct: decimal("paper_weight_pct", { precision: 5, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").default(0),
});

// Assessment Comments (per class/subject/grade combination)
export const assessmentComments = pgTable("assessment_comments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  classId: integer("class_id").references(() => classes.id).notNull(),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
  gradeId: integer("grade_id").references(() => grades.id).notNull(),
  commentText: text("comment_text").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Comment source enum for marks
export const commentSourceEnum = pgEnum("comment_source", ["pool", "custom"]);

// Mark attendance status enum
export const markStatusEnum = pgEnum("mark_status", ["none", "present", "absent", "sick", "excused"]);

// Assessment Marks - main record per student/assessment with calculated values
export const assessmentMarks = pgTable("assessment_marks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  assessmentId: integer("assessment_id").references(() => assessments.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
  percentage: decimal("percentage", { precision: 5, scale: 2 }),
  gradeId: integer("grade_id").references(() => grades.id),
  attStatus: markStatusEnum("att_status").default("present"),
  commentId: integer("comment_id").references(() => assessmentComments.id),
  customCommentText: text("custom_comment_text"),
  autoCommentSnapshot: text("auto_comment_snapshot"),
  commentSource: commentSourceEnum("comment_source").default("pool"),
  markedBy: integer("marked_by").references(() => staff.id),
  markedAt: timestamp("marked_at").defaultNow(),
});

// Assessment Mark Papers - individual paper marks (dynamic per assessment)
export const assessmentMarkPapers = pgTable("assessment_mark_papers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  assessmentMarkId: integer("assessment_mark_id").references(() => assessmentMarks.id).notNull(),
  assessmentPaperId: integer("assessment_paper_id").references(() => assessmentPapers.id).notNull(),
  markObtained: decimal("mark_obtained", { precision: 5, scale: 2 }),
});

// =====================
// Calendar (Phase 1)
// =====================

export const calendarEvents = pgTable("calendar_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  // personal | class | school | org
  scope: calendarScopeEnum("scope").notNull(),

  organizationId: integer("organization_id").references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  classId: integer("class_id").references(() => classes.id),

  // personal events owned by a user (staff/parent/student)
  ownerUserId: integer("owner_user_id").references(() => users.id),

  createdByUserId: integer("created_by_user_id").references(() => users.id),

  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),

  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  allDay: boolean("all_day").default(false),

  timezone: text("timezone").default("Africa/Harare"),

  // Audience toggles for viewers (parents/students are view-only)
  includeStudents: boolean("include_students").default(true),
  includeParents: boolean("include_parents").default(false),

  // Recurrence (RRULE + exceptions)
  rrule: text("rrule"),
  recurrenceUntil: timestamp("recurrence_until"),
  exdates: jsonb("exdates").$type<string[]>(), // ISO strings (UTC)

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const calendarEventReminders = pgTable("calendar_event_reminders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  eventId: integer("event_id").references(() => calendarEvents.id).notNull(),

  minutesBefore: integer("minutes_before").notNull(), // 1440, 60, 15, etc.
  channel: calendarReminderChannelEnum("channel").notNull(), // in_app|email|sms
  enabled: boolean("enabled").default(true),

  createdAt: timestamp("created_at").defaultNow(),
});

export const calendarEventAttendees = pgTable("calendar_event_attendees", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  eventId: integer("event_id").references(() => calendarEvents.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  status: calendarAttendeeStatusEnum("status").default("invited"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const calendarEventClasses = pgTable("calendar_event_classes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  eventId: integer("event_id").references(() => calendarEvents.id).notNull(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const calendarEventStaffViewers = pgTable("calendar_event_staff_viewers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  eventId: integer("event_id").references(() => calendarEvents.id).notNull(),
  staffId: integer("staff_id").references(() => staff.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Generic scheduler table (Option A)
export const scheduledJobs = pgTable("scheduled_jobs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  jobType: scheduledJobTypeEnum("job_type").notNull(), // calendar_reminder
  status: scheduledJobStatusEnum("status").notNull().default("pending"),

  runAt: timestamp("run_at").notNull(),
  payload: jsonb("payload").notNull(), // eventId, reminderId, audience, etc.

  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastError: text("last_error"),

  lockedAt: timestamp("locked_at"),
  lockedBy: text("locked_by"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas + types
export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEvents.$inferSelect;

export const insertCalendarEventReminderSchema =
  createInsertSchema(calendarEventReminders).omit({
    id: true,
    createdAt: true,
  });
export type InsertCalendarEventReminder = z.infer<
  typeof insertCalendarEventReminderSchema
>;
export type CalendarEventReminder = typeof calendarEventReminders.$inferSelect;

export const insertCalendarEventAttendeeSchema =
  createInsertSchema(calendarEventAttendees).omit({
    id: true,
    createdAt: true,
  });
export type InsertCalendarEventAttendee = z.infer<
  typeof insertCalendarEventAttendeeSchema
>;
export type CalendarEventAttendee = typeof calendarEventAttendees.$inferSelect;

export const insertScheduledJobSchema = createInsertSchema(scheduledJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lockedAt: true,
});
export type InsertScheduledJob = z.infer<typeof insertScheduledJobSchema>;
export type ScheduledJob = typeof scheduledJobs.$inferSelect;

export const notifications = pgTable("notifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  userId: integer("user_id").references(() => users.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  severity: text("severity").default("info"),
  channel: text("channel"),
  link: text("link"),
  actorUserId: integer("actor_user_id").references(() => users.id),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true, readAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export const activityLogs = pgTable("activity_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  userId: integer("user_id").references(() => users.id),
  userName: text("user_name"),
  userRole: text("user_role"),
  action: text("action").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  targetType: text("target_type"),
  targetId: integer("target_id"),
  targetName: text("target_name"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({ id: true, createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

export const qcStatusEnum = pgEnum("qc_status", ["not_started", "in_progress", "complete"]);
export const behaviourRatingEnum = pgEnum("behaviour_rating", ["good", "fair", "bad"]);

export const qcReports = pgTable("qc_reports", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  termNumber: integer("term_number").notNull(),
  year: text("year").notNull(),
  qcStatus: qcStatusEnum("qc_status").default("not_started"),
  attendanceComment: text("attendance_comment"),
  behaviourComment: text("behaviour_comment"),
  behaviourRating: behaviourRatingEnum("behaviour_rating"),
  studyHabitsComment: text("study_habits_comment"),
  subjectComments: jsonb("subject_comments"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertQcReportSchema = createInsertSchema(qcReports).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQcReport = z.infer<typeof insertQcReportSchema>;
export type QcReport = typeof qcReports.$inferSelect;

export const reportCommentTypeEnum = pgEnum("report_comment_type", ["principal", "class_teacher"]);

/**
 * COMMENT GRADING SCALE (hardcoded, used ONLY for Principal's & Class Teacher's comments)
 * Edit these values to change the grade boundaries for auto-assigning comments.
 * The grade is determined by comparing the student's average mark against these ranges.
 */
export const COMMENT_GRADE_SCALE = [
  { grade: "A*", min: 90, max: 100 },
  { grade: "A",  min: 80, max: 89 },
  { grade: "B",  min: 70, max: 79 },
  { grade: "C",  min: 60, max: 69 },
  { grade: "D",  min: 50, max: 59 },
  { grade: "E",  min: 40, max: 49 },
  { grade: "F",  min: 30, max: 39 },
  { grade: "G",  min: 20, max: 29 },
  { grade: "U",  min: 0,  max: 19 },
] as const;

export const COMMENT_GRADE_OPTIONS = COMMENT_GRADE_SCALE.map(g => g.grade);

export function getCommentGradeForAverage(avgPercent: number): string {
  for (const { grade, min, max } of COMMENT_GRADE_SCALE) {
    if (avgPercent >= min && avgPercent <= max) return grade;
  }
  return "U";
}

export const reportComments = pgTable("report_comments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  gradeId: integer("grade_id").references(() => grades.id),
  commentGrade: text("comment_grade").notNull(),
  classId: integer("class_id").references(() => classes.id),
  commentText: text("comment_text").notNull(),
  commentType: reportCommentTypeEnum("comment_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertReportCommentSchema = createInsertSchema(reportComments).omit({ id: true, createdAt: true });
export type InsertReportComment = z.infer<typeof insertReportCommentSchema>;
export type ReportComment = typeof reportComments.$inferSelect;

export const insertAssessmentTypeSchema = createInsertSchema(assessmentTypes).omit({ id: true, createdAt: true });
export const insertExamTypeSchema = createInsertSchema(examTypes).omit({ id: true, createdAt: true });
export const insertExamSchema = createInsertSchema(exams).omit({ id: true, createdAt: true });
export const insertAssessmentPaperSchema = createInsertSchema(assessmentPapers).omit({ id: true });
export const insertAssessmentCommentSchema = createInsertSchema(assessmentComments).omit({ id: true, createdAt: true });
export const insertAssessmentMarkSchema = createInsertSchema(assessmentMarks).omit({ id: true, markedAt: true });
export const insertAssessmentMarkPaperSchema = createInsertSchema(assessmentMarkPapers).omit({ id: true });

export type InsertAssessmentType = z.infer<typeof insertAssessmentTypeSchema>;
export type AssessmentType = typeof assessmentTypes.$inferSelect;
export type InsertExamType = z.infer<typeof insertExamTypeSchema>;
export type ExamType = typeof examTypes.$inferSelect;
export type InsertExam = z.infer<typeof insertExamSchema>;
export type Exam = typeof exams.$inferSelect;
export type InsertAssessmentPaper = z.infer<typeof insertAssessmentPaperSchema>;
export type AssessmentPaper = typeof assessmentPapers.$inferSelect;
export type InsertAssessmentComment = z.infer<typeof insertAssessmentCommentSchema>;
export type AssessmentComment = typeof assessmentComments.$inferSelect;
export type InsertAssessmentMark = z.infer<typeof insertAssessmentMarkSchema>;
export type AssessmentMark = typeof assessmentMarks.$inferSelect;
export type InsertAssessmentMarkPaper = z.infer<typeof insertAssessmentMarkPaperSchema>;
export type AssessmentMarkPaper = typeof assessmentMarkPapers.$inferSelect;

export const staffRoles = pgTable("staff_roles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  isSystemDefault: boolean("is_system_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertStaffRoleSchema = createInsertSchema(staffRoles).omit({ id: true, createdAt: true });
export type InsertStaffRole = z.infer<typeof insertStaffRoleSchema>;
export type StaffRole = typeof staffRoles.$inferSelect;
