import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, date, decimal, pgEnum, json, jsonb, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// drizzle-zod 0.7.x has a known TypeScript-only regression where calling
// `.omit({ field: true })` on a generated insert schema resolves the mask keys
// to `never`. Runtime validation is correct, but the broken inferred type then
// cascades through routes and storage. Keep the runtime schema unchanged while
// restoring the standard Zod object shape at the type level.
type OmittedInsertObject<
  TSchema extends z.AnyZodObject,
  TMask extends Record<string, true>,
> = TSchema extends z.ZodObject<infer TShape, infer TUnknownKeys, infer TCatchall>
  ? z.ZodObject<Omit<TShape, Extract<keyof TShape, keyof TMask>>, TUnknownKeys, TCatchall>
  : never;

function omitInsertFields<
  TSchema extends z.AnyZodObject,
  const TMask extends Record<string, true>,
>(schema: TSchema, mask: TMask): OmittedInsertObject<TSchema, TMask> {
  return schema.omit(mask as any) as unknown as OmittedInsertObject<TSchema, TMask>;
}

export const userRoleEnum = pgEnum("user_role", ["org_admin", "school_admin", "teacher", "quality_control_officer", "assistant_teacher", "librarian", "student", "parent"]);

export const genderEnum = pgEnum("gender", ["male", "female"]);

export const subjectTypeEnum = pgEnum("subject_type", ["ZIMSEC", "Cambridge", "HEXCO", "ZIMSEC Advanced Level", "ZIMSEC Ordinary Level", "Cambridge Advanced Level", "Cambridge Ordinary Level", "Cambridge IGCSE", "DELF", "HSK"]);

export const attendanceStatusEnum = pgEnum("attendance_status", ["present", "absent", "sick", "fees", "suspended", "absconding", "excused", "late"]);

export const staffStatusEnum = pgEnum("staff_status", ["active", "inactive"]);

export const studentStatusEnum = pgEnum("student_status", ["active", "inactive", "transferred", "internally_transferred", "graduated"]);

export const internalTransferPersonTypeEnum = pgEnum("internal_transfer_person_type", ["student", "staff"]);
export const internalTransferStatusEnum = pgEnum("internal_transfer_status", ["completed"]);

export const subjectAssignmentModeEnum = pgEnum("subject_assignment_mode", ["add", "remove"]);

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

// Managed by connect-pg-simple. Keeping it in the Drizzle schema prevents
// `drizzle-kit push` from proposing deletion of the live session store table.
export const sessionTable = pgTable("session", {
  sid: varchar("sid").primaryKey().notNull(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => ({
  expireIndex: index("IDX_session_expire").on(table.expire),
}));

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
  enableParentFeesPayments: boolean("enable_parent_fees_payments").default(true),
  enableHostel: boolean("enable_hostel").default(false),
  enablePOS: boolean("enable_pos").default(false),
  enableELibrary: boolean("enable_e_library").default(true),
  enableELogbook: boolean("enable_e_logbook").default(true),
  enableTransport: boolean("enable_transport").default(false),
  enableFleetManagement: boolean("enable_fleet_management").default(false),
  enableAccessControl: boolean("enable_access_control").default(false),
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
  schoolRadiusMeters: integer("school_radius_meters").default(100),
  callCentrePhone: text("call_centre_phone"),
  callCentreWhatsApp: text("call_centre_whatsapp"),
  schoolType: text("school_type").default("secondary"),
  showClassPositionOnReports: boolean("show_class_position_on_reports").default(false),
  terminationStatus: text("termination_status"),
  terminationRequestedAt: timestamp("termination_requested_at"),
  terminationAt: timestamp("termination_at"),
  terminationByUserId: integer("termination_by_user_id").references((): AnyPgColumn => users.id),
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
  photo: text("photo"),
  schoolId: integer("school_id").references((): AnyPgColumn => schools.id),
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
  nationalIdNumber: text("national_id_number"),
  passportNumber: text("passport_number"),
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
  signatureData: text("signature_data"),
  signatureUpdatedAt: timestamp("signature_updated_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  normalizedStaffNoUniqueIdx: uniqueIndex("staff_staff_no_normalized_uidx").on(sql`upper(btrim(${table.staffNo}))`),
  canonicalStaffNoCheck: check(
    "staff_staff_no_canonical_chk",
    sql`${table.staffNo} = upper(btrim(${table.staffNo})) AND ${table.staffNo} ~ '^FCGS[0-9]{2}E[0-9]{4,}[A-Z]+$'`,
  ),
}));

// Reusable electronic signatures. The signature snapshot is copied at signing time so
// historical acknowledgements never change when a staff member later replaces their specimen.
export const electronicSignatures = pgTable("electronic_signatures", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  signatureRole: text("signature_role").notNull(),
  signerUserId: integer("signer_user_id").references(() => users.id).notNull(),
  signerStaffId: integer("signer_staff_id").references(() => staff.id),
  signerName: text("signer_name").notNull(),
  statement: text("statement").notNull(),
  signatureSnapshot: text("signature_snapshot").notNull(),
  specimenUpdatedAt: timestamp("specimen_updated_at"),
  signedAt: timestamp("signed_at").notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
}, (table) => ({
  entityRoleUnique: uniqueIndex("electronic_signatures_entity_role_uidx").on(table.entityType, table.entityId, table.signatureRole),
}));

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
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const classTeacherAssignments = pgTable("class_teacher_assignments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  teacherId: integer("teacher_id").references(() => staff.id).notNull(),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const classSubjects = pgTable("class_subjects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
  assignmentMode: subjectAssignmentModeEnum("assignment_mode").notNull().default("add"),
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
  photo: text("photo"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const students = pgTable("students", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id),
  schoolId: integer("school_id").references(() => schools.id),
  admissionNo: text("admission_no").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  nationalIdNumber: text("national_id_number"),
  passportNumber: text("passport_number"),
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
  statusDate: date("status_date"),
  feesTotalTerm: decimal("fees_total_term", { precision: 10, scale: 2 }).default("0"),
  feesPaidSoFar: decimal("fees_paid_so_far", { precision: 10, scale: 2 }).default("0"),
  feesBalance: decimal("fees_balance", { precision: 10, scale: 2 }).default("0"),
  feesMaxBalance: decimal("fees_max_balance", { precision: 10, scale: 2 }).default("0"),
  feesCustomerId: text("fees_customer_id"),
  feesStatus: text("fees_status").default("n/a"),
  feesSource: text("fees_source").default("student_payments_csv"),
  feesSnapshotAt: timestamp("fees_snapshot_at"),
  feesImportBatchId: integer("fees_import_batch_id"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  schoolAdmissionNoUniqueIdx: uniqueIndex("students_school_admission_no_normalized_uidx").on(table.schoolId, sql`upper(btrim(${table.admissionNo}))`),
  canonicalAdmissionNoCheck: check(
    "students_admission_no_canonical_chk",
    sql`${table.admissionNo} = upper(btrim(${table.admissionNo})) AND ${table.admissionNo} ~ '^FCGS[0-9]{2}S[0-9]{4,}[A-Z]+$'`,
  ),
}));

export const personNumberSequences = pgTable("person_number_sequences", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  entityType: text("entity_type").notNull(),
  year: integer("year").notNull(),
  schoolId: integer("school_id").notNull(),
  lastSequence: integer("last_sequence").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  allocationKeyUniqueIdx: uniqueIndex("person_number_sequences_entity_year_school_uidx").on(
    table.entityType,
    table.year,
    table.schoolId,
  ),
  entityTypeCheck: check("person_number_sequences_entity_type_chk", sql`${table.entityType} IN ('student', 'staff')`),
  yearCheck: check("person_number_sequences_year_chk", sql`${table.year} BETWEEN 2000 AND 9999`),
  schoolIdCheck: check("person_number_sequences_school_id_chk", sql`${table.schoolId} > 0`),
  sequenceCheck: check("person_number_sequences_last_sequence_chk", sql`${table.lastSequence} >= 0`),
}));

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
}, (table) => ({
  classSubjectUnique: uniqueIndex("staff_subjects_class_subject_uidx").on(table.classId, table.subjectId),
}));

export const studentSubjects = pgTable("student_subjects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
  assignmentMode: subjectAssignmentModeEnum("assignment_mode").notNull().default("add"),
});

export const internalTransfers = pgTable("internal_transfers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  personType: internalTransferPersonTypeEnum("person_type").notNull(),
  personId: integer("person_id").notNull(),
  sourceStudentId: integer("source_student_id").references(() => students.id),
  destinationStudentId: integer("destination_student_id").references(() => students.id),
  personName: text("person_name").notNull(),
  sourceSchoolId: integer("source_school_id").references(() => schools.id).notNull(),
  destinationSchoolId: integer("destination_school_id").references(() => schools.id).notNull(),
  sourceClassId: integer("source_class_id").references(() => classes.id),
  destinationClassId: integer("destination_class_id").references(() => classes.id),
  sourceStreamId: integer("source_stream_id").references(() => streams.id),
  destinationStreamId: integer("destination_stream_id").references(() => streams.id),
  sourceRole: text("source_role"),
  destinationRole: text("destination_role"),
  sourceAccessGroupId: integer("source_access_group_id").references(() => accessGroups.id),
  destinationAccessGroupId: integer("destination_access_group_id").references(() => accessGroups.id),
  sourceAdmissionNo: text("source_admission_no"),
  destinationAdmissionNo: text("destination_admission_no"),
  effectiveDate: date("effective_date").notNull(),
  joiningDate: date("joining_date"),
  reason: text("reason").notNull(),
  status: internalTransferStatusEnum("status").notNull().default("completed"),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id),
  completedByUserId: integer("completed_by_user_id").references(() => users.id),
  completedAt: timestamp("completed_at").defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const studentEnrollmentEvents = pgTable("student_enrollment_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id),
  eventType: text("event_type").notNull(),
  effectiveDate: date("effective_date").notNull(),
  reason: text("reason"),
  notes: text("notes"),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// The first three values are dormant legacy labels retained because historical
// rows still use them. Active grading logic is restricted to the exact profile
// keys by the grading integrity constraints and shared/academic-profiles.ts.
export const gradeLevelEnum = pgEnum("grade_level", ["A_Level", "O_Level", "IGCSE", "SEC_ZIM_A", "SEC_ZIM_O", "SEC_CAM_A", "SEC_CAM_O", "SEC_CAM_IGCSE", "PRI_ZIM_ECD", "PRI_ZIM_G12", "PRI_ZIM_G37", "PRI_CAM_ECD", "PRI_CAM_G12", "PRI_CAM_G37"]);
export const gradePointsDirectionEnum = pgEnum("grade_points_direction", ["higher_is_better", "lower_is_better"]);

export const gradeProfileSettings = pgTable("grade_profile_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  gradeLevel: gradeLevelEnum("grade_level").notNull(),
  pointsDirection: gradePointsDirectionEnum("points_direction").notNull(),
  configurationVersion: integer("configuration_version").notNull().default(1),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolProfileUnique: uniqueIndex("grade_profile_settings_school_profile_uidx").on(table.schoolId, table.gradeLevel),
}));

export const grades = pgTable("grades", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  gradeName: text("grade_name").notNull(),
  gradeLevel: gradeLevelEnum("grade_level").notNull(),
  classIds: integer("class_ids").array(),
  appliesAll: boolean("applies_all").default(false),
  lowerLimit: integer("lower_limit").notNull(),
  upperLimit: integer("upper_limit").notNull(),
  gradePoints: decimal("grade_points", { precision: 6, scale: 2 }),
  gradeStatus: text("grade_status"),
  rankOrder: integer("rank_order"),
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
  enforceExamUniqueness: boolean("enforce_exam_uniqueness").notNull().default(false),
  isPublished: boolean("is_published").default(true),
  createdBy: integer("created_by").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  singlePerExamSubjectUnique: uniqueIndex("assessments_single_per_exam_subject_uidx")
    .on(table.classId, table.subjectId, table.examId)
    .where(sql`${table.enforceExamUniqueness} = true and ${table.examId} is not null`),
}));

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
  source: text("source").notNull().default("teacher"),
  gateEvidenceLocked: boolean("gate_evidence_locked").notNull().default(false),
  firstGateArrivalAt: timestamp("first_gate_arrival_at"),
  admittedAt: timestamp("admitted_at"),
  lastGateExitAt: timestamp("last_gate_exit_at"),
  gateId: integer("gate_id"),
  gateDeviceId: integer("gate_device_id"),
  gateCorrectionReason: text("gate_correction_reason"),
  gateCorrectedByUserId: integer("gate_corrected_by_user_id").references(() => users.id),
  gateCorrectedAt: timestamp("gate_corrected_at"),
  reconciliationAt: timestamp("reconciliation_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  studentClassDateUniqueIdx: uniqueIndex("attendance_student_class_date_uidx").on(table.studentId, table.classId, table.date),
  studentDateIdx: index("attendance_student_date_idx").on(table.studentId, table.date),
}));

export const attendanceGateEvidenceCorrections = pgTable("attendance_gate_evidence_corrections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  attendanceRecordId: integer("attendance_record_id").references(() => attendanceRecords.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  previousStatus: text("previous_status").notNull(),
  newStatus: text("new_status").notNull(),
  previousReason: text("previous_reason"),
  correctionReason: text("correction_reason").notNull(),
  previousSource: text("previous_source"),
  correctedByUserId: integer("corrected_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  attendanceIdx: index("attendance_gate_corrections_attendance_idx").on(table.attendanceRecordId, table.createdAt),
  studentIdx: index("attendance_gate_corrections_student_idx").on(table.studentId, table.createdAt),
}));

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

// Transport operations, learner billing, reconciliation and provider settlements.

export const transportDestinationMasters = pgTable("transport_destination_masters", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  canonicalKey: text("canonical_key").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ organizationCanonicalUnique: uniqueIndex("transport_destination_masters_org_canonical_uidx").on(table.organizationId, table.canonicalKey) }));

// Existing Stage 1 tables are retained and extended additively so production data remains valid.
export const transportRoutes = pgTable("transport_routes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  destinationMasterId: integer("destination_master_id").references(() => transportDestinationMasters.id),
  name: text("name").notNull(),
  code: text("code").notNull(),
  direction: text("direction").notNull().default("both"),
  defaultFee: decimal("default_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  billingFrequency: text("billing_frequency").notNull().default("monthly"),
  departureTime: text("departure_time"),
  arrivalTime: text("arrival_time"),
  capacity: integer("capacity"), // Legacy field; operational capacity comes from the assigned vehicle.
  status: text("status").notNull().default("active"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  retiredAt: timestamp("retired_at"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ schoolCodeUnique: uniqueIndex("transport_routes_school_code_uidx").on(table.schoolId, table.code) }));

// Legacy route-level pickup points remain available for existing records. New registrations use service points and path nodes.
export const transportPickupPoints = pgTable("transport_pickup_points", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  routeId: integer("route_id").references(() => transportRoutes.id).notNull(),
  name: text("name").notNull(),
  stopOrder: integer("stop_order").notNull().default(1),
  pickupTime: text("pickup_time"),
  dropoffTime: text("dropoff_time"),
  feeOverride: decimal("fee_override", { precision: 12, scale: 2 }),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportOwners = pgTable("transport_owners", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  name: text("name").notNull(),
  ownerType: text("owner_type").notNull().default("individual"),
  // Legacy column retained additively. New UI writes alternativeContactName.
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  alternativeContactName: text("alternative_contact_name"),
  alternativeContactPhone: text("alternative_contact_phone"),
  alternativeContactEmail: text("alternative_contact_email"),
  alternativeContactRelationship: text("alternative_contact_relationship"),
  isStaffOwner: boolean("is_staff_owner").notNull().default(false),
  staffId: integer("staff_id").references(() => staff.id),
  nationalIdOrRegistration: text("national_id_or_registration"),
  paymentDetails: text("payment_details"),
  isActive: boolean("is_active").notNull().default(true),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolStaffOwnerUnique: uniqueIndex("transport_owners_school_staff_uidx")
    .on(table.schoolId, table.staffId)
    .where(sql`${table.staffId} is not null`),
}));

export const transportDrivers = pgTable("transport_drivers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  ownerId: integer("owner_id").references(() => transportOwners.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  homeAddress: text("home_address"),
  photo: text("photo"),
  nationalId: text("national_id"),
  licenceNumber: text("licence_number"),
  licenceExpiry: date("licence_expiry"),
  engagementType: text("engagement_type").notNull().default("internal"),
  nextOfKinName: text("next_of_kin_name"),
  nextOfKinRelationship: text("next_of_kin_relationship"),
  nextOfKinPhone: text("next_of_kin_phone"),
  nextOfKinAlternativePhone: text("next_of_kin_alternative_phone"),
  nextOfKinEmail: text("next_of_kin_email"),
  nextOfKinAddress: text("next_of_kin_address"),
  complianceStatus: text("compliance_status").notNull().default("unknown"),
  isActive: boolean("is_active").notNull().default(true),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const transportVehicles = pgTable("transport_vehicles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  registrationNumber: text("registration_number").notNull(),
  registrationKey: text("registration_key"), // Uppercase alphanumeric key with spaces removed for organisation-wide duplicate detection.
  makeModel: text("make_model"),
  capacity: integer("capacity").notNull().default(1),
  ownershipType: text("ownership_type").notNull().default("school"),
  ownerId: integer("owner_id").references(() => transportOwners.id),
  driverId: integer("driver_id").references(() => transportDrivers.id),
  currentOperatingDriverId: integer("current_operating_driver_id").references(() => transportDrivers.id),
  registrationExpiry: date("registration_expiry"),
  insuranceExpiry: date("insurance_expiry"),
  fitnessExpiry: date("fitness_expiry"),
  radioLicenceExpiry: date("radio_licence_expiry"),
  primaryImage: text("primary_image"),
  complianceStatus: text("compliance_status").notNull().default("unknown"),
  status: text("status").notNull().default("active"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  routeNotes: text("route_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ schoolRegistrationUnique: uniqueIndex("transport_vehicles_school_registration_uidx").on(table.schoolId, table.registrationNumber) }));

export const transportVehicleSchools = pgTable("transport_vehicle_schools", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  associatedAt: timestamp("associated_at").defaultNow(),
  associatedByUserId: integer("associated_by_user_id").references(() => users.id),
}, (table) => ({ vehicleSchoolUnique: uniqueIndex("transport_vehicle_schools_vehicle_school_uidx").on(table.vehicleId, table.schoolId) }));

export const transportDriverSchools = pgTable("transport_driver_schools", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").references(() => transportDrivers.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  associatedAt: timestamp("associated_at").defaultNow(),
  associatedByUserId: integer("associated_by_user_id").references(() => users.id),
}, (table) => ({ driverSchoolUnique: uniqueIndex("transport_driver_schools_driver_school_uidx").on(table.driverId, table.schoolId) }));

export const transportOwnerSchools = pgTable("transport_owner_schools", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ownerId: integer("owner_id").references(() => transportOwners.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  associatedAt: timestamp("associated_at").defaultNow(),
  associatedByUserId: integer("associated_by_user_id").references(() => users.id),
}, (table) => ({ ownerSchoolUnique: uniqueIndex("transport_owner_schools_owner_school_uidx").on(table.ownerId, table.schoolId) }));

export const transportOrganizationSettings = pgTable("transport_organization_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  minimumArrearsSuspensionBalance: decimal("minimum_arrears_suspension_balance", { precision: 12, scale: 2 }).notNull().default("1"),
  suspendedSeatPolicy: text("suspended_seat_policy").notNull().default("release_after_days"),
  suspendedSeatReleaseDays: integer("suspended_seat_release_days").notNull().default(14),
  automaticArrearsReinstatement: boolean("automatic_arrears_reinstatement").notNull().default(true),
  arrearsWarningEnabled: boolean("arrears_warning_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ organizationUnique: uniqueIndex("transport_organization_settings_organization_uidx").on(table.organizationId) }));

export const transportSettings = pgTable("transport_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  transportManagerStaffId: integer("transport_manager_staff_id").references(() => staff.id),
  currencyCode: text("currency_code").notNull().default("USD"),
  stopGroupingDistanceMeters: integer("stop_grouping_distance_meters").notNull().default(30),
  oneWayPricingMode: text("one_way_pricing_mode").notNull().default("percentage"),
  inboundOneWayPercent: decimal("inbound_one_way_percent", { precision: 6, scale: 2 }).notNull().default("60"),
  outboundOneWayPercent: decimal("outbound_one_way_percent", { precision: 6, scale: 2 }).notNull().default("60"),
  inboundOneWayFixedAddition: decimal("inbound_one_way_fixed_addition", { precision: 12, scale: 2 }).notNull().default("0"),
  outboundOneWayFixedAddition: decimal("outbound_one_way_fixed_addition", { precision: 12, scale: 2 }).notNull().default("0"),
  joiningFullChargeThroughDay: integer("joining_full_charge_through_day").notNull().default(5),
  refundNoCreditRemainingDays: integer("refund_no_credit_remaining_days").notNull().default(5),
  pendingSeatReservationEnabled: boolean("pending_seat_reservation_enabled").notNull().default(true),
  pendingSeatReservationDays: integer("pending_seat_reservation_days").notNull().default(7),
  receiptPrefix: text("receipt_prefix").notNull().default("TR"),
  receiptSequenceLength: integer("receipt_sequence_length").notNull().default(6),
  receiptResetYearly: boolean("receipt_reset_yearly").notNull().default(true),
  receiptNextSequence: integer("receipt_next_sequence").notNull().default(1),
  receiptSequenceYear: integer("receipt_sequence_year"),
  receiptFooter: text("receipt_footer"),
  printCopiesOnOnePage: boolean("print_copies_on_one_page").notNull().default(true),
  requireCashupForClaim: boolean("require_cashup_for_claim").notNull().default(true),
  reportWeekStartsOn: integer("report_week_starts_on").notNull().default(1),
  fortnightAnchorDate: date("fortnight_anchor_date"),
  mapProvider: text("map_provider").notNull().default("openstreetmap"),
  defaultCheckpointRadiusMeters: integer("default_checkpoint_radius_meters").notNull().default(50),
  savedPointSuggestionRadiusMeters: integer("saved_point_suggestion_radius_meters").notNull().default(50),
  attachmentSizeLimitMB: integer("attachment_size_limit_mb").notNull().default(25),
  complianceNotificationDays: jsonb("compliance_notification_days").notNull().default(sql`'[30,14,7,1,0]'::jsonb`),
  complianceNotificationRecipients: jsonb("compliance_notification_recipients").notNull().default(sql`'["transport_manager"]'::jsonb`),
  approvalWorkflow: jsonb("approval_workflow").notNull().default(sql`'{}'::jsonb`),
  deductionPriority: jsonb("deduction_priority").notNull().default(sql`'["refund","subscription","penalty","advance","other"]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ schoolUnique: uniqueIndex("transport_settings_school_uidx").on(table.schoolId) }));

export const transportServicePoints = pgTable("transport_service_points", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  studentId: integer("student_id").references(() => students.id), // Optional provenance; saved points are reusable organisation-wide.
  pointType: text("point_type").notNull().default("both"),
  name: text("name").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  address: text("address"),
  landmark: text("landmark"),
  instructions: text("instructions"),
  privacyClass: text("privacy_class").notNull().default("private_household"),
  isTemporary: boolean("is_temporary").notNull().default(false),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportVehiclePaths = pgTable("transport_vehicle_paths", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  routeId: integer("route_id").references(() => transportRoutes.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  direction: text("direction").notNull(),
  isTwoWay: boolean("is_two_way").notNull().default(false),
  canonicalTraversal: text("canonical_traversal").notNull().default("forward"),
  name: text("name").notNull(),
  versionNumber: integer("version_number").notNull().default(1),
  status: text("status").notNull().default("draft"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  geometry: jsonb("geometry"),
  estimatedDistanceKm: decimal("estimated_distance_km", { precision: 10, scale: 2 }),
  estimatedDurationMinutes: integer("estimated_duration_minutes"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  activatedByUserId: integer("activated_by_user_id").references(() => users.id),
  activatedAt: timestamp("activated_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ versionUnique: uniqueIndex("transport_vehicle_path_version_uidx").on(table.schoolId, table.vehicleId, table.routeId, table.direction, table.versionNumber) }));

export const transportPathNodes = pgTable("transport_path_nodes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  pathId: integer("path_id").references(() => transportVehiclePaths.id).notNull(),
  nodeType: text("node_type").notNull(),
  name: text("name").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  stopOrder: integer("stop_order").notNull(),
  expectedTime: text("expected_time"),
  reverseExpectedTime: text("reverse_expected_time"),
  checkpointRadiusMeters: integer("checkpoint_radius_meters"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ pathOrderUnique: uniqueIndex("transport_path_node_order_uidx").on(table.pathId, table.stopOrder) }));

export const transportAssignments = pgTable("transport_assignments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  routeId: integer("route_id").references(() => transportRoutes.id).notNull(),
  pickupPointId: integer("pickup_point_id").references(() => transportPickupPoints.id),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id),
  driverId: integer("driver_id").references(() => transportDrivers.id),
  outboundVehicleId: integer("outbound_vehicle_id").references(() => transportVehicles.id),
  inboundPathId: integer("inbound_path_id").references(() => transportVehiclePaths.id),
  inboundPathTraversal: text("inbound_path_traversal").notNull().default("forward"),
  outboundPathId: integer("outbound_path_id").references(() => transportVehiclePaths.id),
  outboundPathTraversal: text("outbound_path_traversal").notNull().default("forward"),
  pickupServicePointId: integer("pickup_service_point_id").references(() => transportServicePoints.id),
  dropoffServicePointId: integer("dropoff_service_point_id").references(() => transportServicePoints.id),
  pickupPathNodeId: integer("pickup_path_node_id").references(() => transportPathNodes.id),
  dropoffPathNodeId: integer("dropoff_path_node_id").references(() => transportPathNodes.id),
  serviceType: text("service_type").notNull().default("both"),
  serviceState: text("service_state").notNull().default("pending_start"),
  planningStatus: text("planning_status").notNull().default("pending_path_assignment"),
  financialStatus: text("financial_status").notNull().default("pending_first_payment"),
  billingFrequency: text("billing_frequency").notNull().default("monthly"),
  baseMonthlyFee: decimal("base_monthly_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  agreedFee: decimal("agreed_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  oneWayPercentSnapshot: decimal("one_way_percent_snapshot", { precision: 6, scale: 2 }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  seatReservedUntil: date("seat_reserved_until"),
  suspensionReason: text("suspension_reason"),
  seatReleasedAt: timestamp("seat_released_at"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  activeStudentUnique: uniqueIndex("transport_assignments_active_student_uidx").on(table.schoolId, table.studentId).where(sql`${table.isActive} = true`),
}));

export const transportPathNodeLearners = pgTable("transport_path_node_learners", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  pathNodeId: integer("path_node_id").references(() => transportPathNodes.id).notNull(),
  assignmentId: integer("assignment_id").references(() => transportAssignments.id).notNull(),
  servicePointId: integer("service_point_id").references(() => transportServicePoints.id).notNull(),
  boardsHere: boolean("boards_here").notNull().default(false),
  alightsHere: boolean("alights_here").notNull().default(false),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ assignmentNodeUnique: uniqueIndex("transport_path_node_learner_uidx").on(table.assignmentId, table.pathNodeId, table.servicePointId) }));

export const transportAssignmentEvents = pgTable("transport_assignment_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  assignmentId: integer("assignment_id").references(() => transportAssignments.id).notNull(),
  eventType: text("event_type").notNull(),
  effectiveDate: date("effective_date").notNull(),
  previousValues: jsonb("previous_values"),
  newValues: jsonb("new_values"),
  reason: text("reason").notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportCharges = pgTable("transport_charges", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  assignmentId: integer("assignment_id").references(() => transportAssignments.id).notNull(),
  routeId: integer("route_id").references(() => transportRoutes.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id),
  academicYear: integer("academic_year").notNull(),
  term: text("term").notNull(),
  month: integer("month").notNull().default(0),
  servicePeriodStart: date("service_period_start"),
  servicePeriodEnd: date("service_period_end"),
  daysInPeriod: integer("days_in_period"),
  chargeableDays: integer("chargeable_days"),
  calculationType: text("calculation_type").notNull().default("full"),
  calculationSnapshot: jsonb("calculation_snapshot"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currencyCode: text("currency_code").notNull().default("USD"),
  status: text("status").notNull().default("open"),
  dueDate: date("due_date"),
  description: text("description"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ periodUnique: uniqueIndex("transport_charges_assignment_period_uidx").on(table.assignmentId, table.academicYear, table.term, table.month) }));

export const transportAccountAdjustments = pgTable("transport_account_adjustments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  assignmentId: integer("assignment_id").references(() => transportAssignments.id),
  chargeId: integer("charge_id").references(() => transportCharges.id),
  adjustmentType: text("adjustment_type").notNull(),
  direction: text("direction").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currencyCode: text("currency_code").notNull().default("USD"),
  effectiveDate: date("effective_date").notNull(),
  reason: text("reason").notNull(),
  metadata: jsonb("metadata"),
  status: text("status").notNull().default("requested"),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  disbursedByUserId: integer("disbursed_by_user_id").references(() => users.id),
  disbursedAt: timestamp("disbursed_at"),
  rejectedByUserId: integer("rejected_by_user_id").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportProviderAdjustments = pgTable("transport_provider_adjustments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  ownerId: integer("owner_id").references(() => transportOwners.id),
  adjustmentType: text("adjustment_type").notNull(),
  direction: text("direction").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currencyCode: text("currency_code").notNull().default("USD"),
  serviceYear: integer("service_year").notNull(),
  serviceMonth: integer("service_month").notNull(),
  applyYear: integer("apply_year").notNull(),
  applyMonth: integer("apply_month").notNull(),
  assignmentId: integer("assignment_id").references(() => transportAssignments.id),
  refundId: integer("refund_id"),
  claimId: integer("claim_id"),
  status: text("status").notNull().default("pending"),
  reason: text("reason").notNull(),
  metadata: jsonb("metadata"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportPayments = pgTable("transport_payments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currencyCode: text("currency_code").notNull().default("USD"),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"),
  academicYear: integer("academic_year").notNull(),
  term: text("term").notNull(),
  month: integer("month").notNull().default(0),
  receiptNo: text("receipt_no").notNull().unique(),
  verificationToken: text("verification_token").unique(),
  receiptSnapshot: jsonb("receipt_snapshot").notNull().default(sql`'{}'::jsonb`),
  status: text("status").notNull().default("issued"),
  verificationStatus: text("verification_status").notNull().default("unverified"),
  externalReference: text("external_reference"),
  notes: text("notes"),
  receivedByUserId: integer("received_by_user_id").references(() => users.id).notNull(),
  verifiedAt: timestamp("verified_at"),
  verifiedByUserId: integer("verified_by_user_id").references(() => users.id),
  reconciledAt: timestamp("reconciled_at"),
  reconciledByUserId: integer("reconciled_by_user_id").references(() => users.id),
  reversedAt: timestamp("reversed_at"),
  reversedByUserId: integer("reversed_by_user_id").references(() => users.id),
  reversalReason: text("reversal_reason"),
  replacementPaymentId: integer("replacement_payment_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportPaymentAllocations = pgTable("transport_payment_allocations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  paymentId: integer("payment_id").references(() => transportPayments.id).notNull(),
  chargeId: integer("charge_id").references(() => transportCharges.id).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  serviceMonth: integer("service_month"),
  serviceYear: integer("service_year"),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id),
  claimEligibleAt: timestamp("claim_eligible_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ paymentChargeUnique: uniqueIndex("transport_payment_charge_uidx").on(table.paymentId, table.chargeId) }));

export const transportReceiptEvents = pgTable("transport_receipt_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  paymentId: integer("payment_id").references(() => transportPayments.id).notNull(),
  eventType: text("event_type").notNull(),
  copyType: text("copy_type"),
  reason: text("reason"),
  metadata: jsonb("metadata"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportRefunds = pgTable("transport_refunds", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  assignmentId: integer("assignment_id").references(() => transportAssignments.id),
  refundNumber: text("refund_number").notNull().unique(),
  refundType: text("refund_type").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  effectiveDate: date("effective_date").notNull(),
  method: text("method").notNull(),
  status: text("status").notNull().default("requested"),
  calculationSnapshot: jsonb("calculation_snapshot"),
  reason: text("reason").notNull(),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id).notNull(),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  paidByUserId: integer("paid_by_user_id").references(() => users.id),
  paidAt: timestamp("paid_at"),
  externalReference: text("external_reference"),
  accountedCashupId: integer("accounted_cashup_id"),
  accountedAt: timestamp("accounted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportCashups = pgTable("transport_cashups", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  cashupNumber: text("cashup_number").notNull().unique(),
  cashupDate: date("cashup_date").notNull(),
  cashierUserId: integer("cashier_user_id").references(() => users.id).notNull(),
  expectedCash: decimal("expected_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  actualCash: decimal("actual_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedNonCash: decimal("expected_non_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  actualNonCash: decimal("actual_non_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  variance: decimal("variance", { precision: 12, scale: 2 }).notNull().default("0"),
  accountsReceivedCash: decimal("accounts_received_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  accountsReceivedNonCash: decimal("accounts_received_non_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  accountsVerificationNotes: text("accounts_verification_notes"),
  accountsDiscrepancyReason: text("accounts_discrepancy_reason"),
  hqReceivedCash: decimal("hq_received_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  hqReceivedNonCash: decimal("hq_received_non_cash", { precision: 12, scale: 2 }).notNull().default("0"),
  hqVariance: decimal("hq_variance", { precision: 12, scale: 2 }).notNull().default("0"),
  hqNotes: text("hq_notes"),
  hqConfirmedByUserId: integer("hq_confirmed_by_user_id").references(() => users.id),
  hqConfirmedAt: timestamp("hq_confirmed_at"),
  depositReference: text("deposit_reference"),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  submittedAt: timestamp("submitted_at"),
  verifiedAt: timestamp("verified_at"),
  verifiedByUserId: integer("verified_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportCashupPayments = pgTable("transport_cashup_payments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  cashupId: integer("cashup_id").references(() => transportCashups.id).notNull(),
  paymentId: integer("payment_id").references(() => transportPayments.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ paymentUnique: uniqueIndex("transport_cashup_payment_uidx").on(table.paymentId) }));

export const transportSubscriptionRules = pgTable("transport_subscription_rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id),
  ruleType: text("rule_type").notNull().default("fixed"),
  value: decimal("value", { precision: 12, scale: 2 }).notNull(),
  minimumAmount: decimal("minimum_amount", { precision: 12, scale: 2 }),
  maximumAmount: decimal("maximum_amount", { precision: 12, scale: 2 }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportPenalties = pgTable("transport_penalties", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  ownerId: integer("owner_id").references(() => transportOwners.id),
  penaltyNumber: text("penalty_number").notNull().unique(),
  category: text("category").notNull(),
  incidentDate: date("incident_date").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("approved"),
  reason: text("reason").notNull(),
  disputeNotes: text("dispute_notes"),
  effectiveYear: integer("effective_year").notNull(),
  effectiveMonth: integer("effective_month").notNull(),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportAdvances = pgTable("transport_advances", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  ownerId: integer("owner_id").references(() => transportOwners.id),
  advanceNumber: text("advance_number").notNull().unique(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  outstandingAmount: decimal("outstanding_amount", { precision: 12, scale: 2 }).notNull(),
  purpose: text("purpose").notNull(),
  requestDate: date("request_date").notNull(),
  disbursementDate: date("disbursement_date"),
  disbursementReference: text("disbursement_reference"),
  recoveryMethod: text("recovery_method").notNull(),
  recoveryValue: decimal("recovery_value", { precision: 12, scale: 2 }).notNull(),
  recoveryStartYear: integer("recovery_start_year").notNull(),
  recoveryStartMonth: integer("recovery_start_month").notNull(),
  minimumOwnerTakeHome: decimal("minimum_owner_take_home", { precision: 12, scale: 2 }).notNull().default("0"),
  maximumMonthlyRecovery: decimal("maximum_monthly_recovery", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("requested"),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  disbursedByUserId: integer("disbursed_by_user_id").references(() => users.id),
  disbursedAt: timestamp("disbursed_at"),
  rejectedByUserId: integer("rejected_by_user_id").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportIncidents = pgTable("transport_incidents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  incidentNumber: text("incident_number").notNull().unique(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  ownerId: integer("owner_id").references(() => transportOwners.id),
  driverId: integer("driver_id").references(() => transportDrivers.id),
  routeId: integer("route_id").references(() => transportRoutes.id),
  pathId: integer("path_id").references(() => transportVehiclePaths.id),
  pathTraversal: text("path_traversal").notNull().default("forward"),
  assignmentOverride: boolean("assignment_override").notNull().default(false),
  overrideReason: text("override_reason"),
  expectedContext: jsonb("expected_context").notNull().default(sql`'{}'::jsonb`),
  actualContext: jsonb("actual_context").notNull().default(sql`'{}'::jsonb`),
  incidentType: text("incident_type").notNull(),
  severity: text("severity").notNull().default("medium"),
  occurredAt: timestamp("occurred_at").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  description: text("description").notNull(),
  resolution: text("resolution"),
  status: text("status").notNull().default("reported"),
  affectedStudentIds: jsonb("affected_student_ids").notNull().default(sql`'[]'::jsonb`),
  linkedAdvanceId: integer("linked_advance_id").references(() => transportAdvances.id),
  linkedPenaltyId: integer("linked_penalty_id").references(() => transportPenalties.id),
  reportedByUserId: integer("reported_by_user_id").references(() => users.id).notNull(),
  resolvedByUserId: integer("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportDriverOwnerHistory = pgTable("transport_driver_owner_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  driverId: integer("driver_id").references(() => transportDrivers.id).notNull(),
  ownerId: integer("owner_id").references(() => transportOwners.id),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  reason: text("reason").notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  currentDriverOwnerUnique: uniqueIndex("transport_driver_owner_current_uidx")
    .on(table.driverId)
    .where(sql`${table.effectiveTo} is null`),
}));

export const transportDocumentRequirements = pgTable("transport_document_requirements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  entityType: text("entity_type").notNull(), // owner | driver | vehicle
  ownerType: text("owner_type"),
  scopeKey: text("scope_key").notNull().default("all"),
  categoryCode: text("category_code").notNull(),
  label: text("label").notNull(),
  isRequired: boolean("is_required").notNull().default(false),
  allowsMultiple: boolean("allows_multiple").notNull().default(false),
  tracksExpiry: boolean("tracks_expiry").notNull().default(false),
  isImage: boolean("is_image").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolEntityCategoryUnique: uniqueIndex("transport_document_requirements_scope_uidx")
    .on(table.schoolId, table.entityType, table.scopeKey, table.categoryCode),
}));

export const transportDocuments = pgTable("transport_documents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  entityType: text("entity_type").notNull(), // owner | driver | vehicle
  entityId: integer("entity_id").notNull(),
  categoryCode: text("category_code").notNull(),
  originalName: text("original_name").notNull(),
  storedName: text("stored_name").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  expiryDate: date("expiry_date"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  replacedByDocumentId: integer("replaced_by_document_id").references((): AnyPgColumn => transportDocuments.id),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id).notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  archivedAt: timestamp("archived_at"),
}, (table) => ({
  entityActiveIdx: index("transport_documents_entity_active_idx").on(table.schoolId, table.entityType, table.entityId, table.isActive),
  categoryIdx: index("transport_documents_category_idx").on(table.categoryCode, table.expiryDate),
}));

export const transportComplianceOverrides = pgTable("transport_compliance_overrides", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  documentId: integer("document_id").references(() => transportDocuments.id),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  revokedByUserId: integer("revoked_by_user_id").references(() => users.id),
  revokedAt: timestamp("revoked_at"),
  revokeReason: text("revoke_reason"),
}, (table) => ({
  activeEntityIdx: index("transport_compliance_overrides_entity_idx").on(table.schoolId, table.entityType, table.entityId, table.expiresAt),
}));

export const transportComplianceNotificationLog = pgTable("transport_compliance_notification_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  documentId: integer("document_id").references(() => transportDocuments.id),
  categoryCode: text("category_code").notNull(),
  thresholdDays: integer("threshold_days").notNull(),
  expiryDate: date("expiry_date").notNull(),
  recipientUserId: integer("recipient_user_id").references(() => users.id).notNull(),
  notificationId: integer("notification_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  dedupeUnique: uniqueIndex("transport_compliance_notification_dedupe_uidx")
    .on(table.schoolId, table.entityType, table.entityId, table.categoryCode, table.thresholdDays, table.expiryDate, table.recipientUserId),
}));

export const transportClaims = pgTable("transport_claims", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  ownerId: integer("owner_id").references(() => transportOwners.id),
  driverId: integer("driver_id").references(() => transportDrivers.id),
  claimNumber: text("claim_number").notNull().unique(),
  serviceYear: integer("service_year").notNull(),
  serviceMonth: integer("service_month").notNull(),
  status: text("status").notNull().default("draft"),
  currentPeriodAmount: decimal("current_period_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  priorPeriodAmount: decimal("prior_period_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  deductionAmount: decimal("deduction_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  netAmount: decimal("net_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  manualClaimReference: text("manual_claim_reference"),
  manualClaimDocument: text("manual_claim_document"),
  reconciliationStatus: text("reconciliation_status").notNull().default("pending"),
  reconciliationNotes: text("reconciliation_notes"),
  disputeReason: text("dispute_reason"),
  disputeResolution: text("dispute_resolution"),
  reconciledByUserId: integer("reconciled_by_user_id").references(() => users.id),
  reconciledAt: timestamp("reconciled_at"),
  notes: text("notes"),
  preparedByUserId: integer("prepared_by_user_id").references(() => users.id).notNull(),
  submittedAt: timestamp("submitted_at"),
  verifiedByUserId: integer("verified_by_user_id").references(() => users.id),
  verifiedAt: timestamp("verified_at"),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ vehiclePeriodUnique: uniqueIndex("transport_claim_vehicle_period_uidx").on(table.schoolId, table.vehicleId, table.serviceYear, table.serviceMonth) }));

export const transportClaimAllocations = pgTable("transport_claim_allocations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  claimId: integer("claim_id").references(() => transportClaims.id).notNull(),
  allocationId: integer("allocation_id").references(() => transportPaymentAllocations.id).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ allocationUnique: uniqueIndex("transport_claim_allocation_uidx").on(table.allocationId) }));

export const transportClaimDeductions = pgTable("transport_claim_deductions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  claimId: integer("claim_id").references(() => transportClaims.id).notNull(),
  deductionType: text("deduction_type").notNull(),
  sourceId: integer("source_id"),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  priority: integer("priority").notNull().default(100),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportPayouts = pgTable("transport_payouts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  claimId: integer("claim_id").references(() => transportClaims.id).notNull(),
  payoutNumber: text("payout_number").notNull().unique(),
  status: text("status").notNull().default("approved"),
  grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }).notNull(),
  deductionAmount: decimal("deduction_amount", { precision: 12, scale: 2 }).notNull(),
  netAmount: decimal("net_amount", { precision: 12, scale: 2 }).notNull(),
  amountPaid: decimal("amount_paid", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentDate: date("payment_date"),
  paymentMethod: text("payment_method"),
  paymentReference: text("payment_reference"),
  verificationToken: text("verification_token").notNull().unique(),
  snapshot: jsonb("snapshot").notNull().default(sql`'{}'::jsonb`),
  generatedByUserId: integer("generated_by_user_id").references(() => users.id).notNull(),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  paidByUserId: integer("paid_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ claimUnique: uniqueIndex("transport_payout_claim_uidx").on(table.claimId) }));

// Vehicle-to-destination assignments. A Transport vehicle is organisation-visible, but
// destinations remain school-owned operational records. This join lets the same physical
// vehicle serve multiple destinations across multiple schools without duplicating the vehicle.
export const transportVehicleDestinations = pgTable("transport_vehicle_destinations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  routeId: integer("route_id").references(() => transportRoutes.id).notNull(),
  destinationMasterId: integer("destination_master_id").references(() => transportDestinationMasters.id),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ vehicleRouteUnique: uniqueIndex("transport_vehicle_destination_uidx").on(table.vehicleId, table.routeId) }));

// Monthly billing runs replace the old empty Charges tab with an auditable generation history.
export const transportBillingRuns = pgTable("transport_billing_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  runNumber: text("run_number").notNull().unique(),
  serviceYear: integer("service_year").notNull(),
  serviceMonth: integer("service_month").notNull(),
  status: text("status").notNull().default("completed"),
  generatedCount: integer("generated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
  generatedByUserId: integer("generated_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Cash refunds are physical school cash outflows. Linking them to a cash-up makes net cash in
// hand reconcilable without pretending a refund is a negative receipt.
export const transportCashupRefunds = pgTable("transport_cashup_refunds", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  cashupId: integer("cashup_id").references(() => transportCashups.id).notNull(),
  refundId: integer("refund_id").references(() => transportRefunds.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ refundIdx: index("transport_cashup_refund_idx").on(table.refundId) }));

// Organisation-level provider subscription policy. Historical rows are never rewritten after
// settlement posting; replacing an open-month rule preserves the old row for audit.
export const transportSubscriptionPolicies = pgTable("transport_subscription_policies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id),
  ruleType: text("rule_type").notNull().default("fixed"),
  value: decimal("value", { precision: 12, scale: 2 }).notNull(),
  minimumAmount: decimal("minimum_amount", { precision: 12, scale: 2 }),
  maximumAmount: decimal("maximum_amount", { precision: 12, scale: 2 }),
  startYear: integer("start_year").notNull(),
  startMonth: integer("start_month").notNull(),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  supersededByPolicyId: integer("superseded_by_policy_id"),
  replacedAt: timestamp("replaced_at"),
  replacedByUserId: integer("replaced_by_user_id").references(() => users.id),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// HQ settlement layer. School claims remain the service evidence; HQ consolidates and pays them.
export const transportHqClaims = pgTable("transport_hq_claims", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  ownerId: integer("owner_id").references(() => transportOwners.id),
  claimNumber: text("claim_number").notNull().unique(),
  serviceYear: integer("service_year").notNull(),
  serviceMonth: integer("service_month").notNull(),
  status: text("status").notNull().default("draft"),
  grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  deductionAmount: decimal("deduction_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  netAmount: decimal("net_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  snapshot: jsonb("snapshot").notNull().default(sql`'{}'::jsonb`),
  notes: text("notes"),
  preparedByUserId: integer("prepared_by_user_id").references(() => users.id).notNull(),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ vehiclePeriodUnique: uniqueIndex("transport_hq_claim_vehicle_period_uidx").on(table.organizationId, table.vehicleId, table.serviceYear, table.serviceMonth) }));

export const transportHqClaimItems = pgTable("transport_hq_claim_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  hqClaimId: integer("hq_claim_id").references(() => transportHqClaims.id).notNull(),
  schoolClaimId: integer("school_claim_id").references(() => transportClaims.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }).notNull(),
  deductionAmount: decimal("deduction_amount", { precision: 12, scale: 2 }).notNull(),
  netAmount: decimal("net_amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ schoolClaimUnique: uniqueIndex("transport_hq_claim_school_claim_uidx").on(table.schoolClaimId) }));

export const transportHqPayouts = pgTable("transport_hq_payouts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  hqClaimId: integer("hq_claim_id").references(() => transportHqClaims.id).notNull(),
  ownerId: integer("owner_id").references(() => transportOwners.id),
  payoutNumber: text("payout_number").notNull().unique(),
  status: text("status").notNull().default("not_paid"),
  netAmount: decimal("net_amount", { precision: 12, scale: 2 }).notNull(),
  amountPaid: decimal("amount_paid", { precision: 12, scale: 2 }).notNull().default("0"),
  generatedByUserId: integer("generated_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ hqClaimUnique: uniqueIndex("transport_hq_payout_claim_uidx").on(table.hqClaimId) }));

export const transportProviderPaymentRuns = pgTable("transport_provider_payment_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  ownerId: integer("owner_id").references(() => transportOwners.id),
  runNumber: text("run_number").notNull().unique(),
  serviceYear: integer("service_year"),
  serviceMonth: integer("service_month"),
  status: text("status").notNull().default("open"),
  totalDue: decimal("total_due", { precision: 12, scale: 2 }).notNull().default("0"),
  amountPaid: decimal("amount_paid", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const transportProviderPaymentRunItems = pgTable("transport_provider_payment_run_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  runId: integer("run_id").references(() => transportProviderPaymentRuns.id).notNull(),
  payoutId: integer("payout_id").references(() => transportHqPayouts.id).notNull(),
  amountDue: decimal("amount_due", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ payoutUnique: uniqueIndex("transport_provider_payment_run_payout_uidx").on(table.payoutId) }));

export const transportProviderDisbursements = pgTable("transport_provider_disbursements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  runId: integer("run_id").references(() => transportProviderPaymentRuns.id).notNull(),
  disbursementNumber: text("disbursement_number").notNull().unique(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"),
  paymentReference: text("payment_reference"),
  collectorType: text("collector_type").notNull(),
  collectorOwnerId: integer("collector_owner_id").references(() => transportOwners.id),
  collectorDriverId: integer("collector_driver_id").references(() => transportDrivers.id),
  collectorName: text("collector_name"),
  collectorNationalId: text("collector_national_id"),
  collectorPhone: text("collector_phone"),
  collectorRole: text("collector_role"),
  notes: text("notes"),
  processedByUserId: integer("processed_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportProviderDisbursementAllocations = pgTable("transport_provider_disbursement_allocations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  disbursementId: integer("disbursement_id").references(() => transportProviderDisbursements.id).notNull(),
  runItemId: integer("run_item_id").references(() => transportProviderPaymentRunItems.id).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ disbursementItemUnique: uniqueIndex("transport_provider_disbursement_item_uidx").on(table.disbursementId, table.runItemId) }));

export const transportPeriodLocks = pgTable("transport_period_locks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  periodType: text("period_type").notNull(),
  year: integer("year").notNull(),
  month: integer("month"),
  status: text("status").notNull().default("locked"),
  reason: text("reason"),
  lockedByUserId: integer("locked_by_user_id").references(() => users.id).notNull(),
  lockedAt: timestamp("locked_at").defaultNow(),
  reopenedByUserId: integer("reopened_by_user_id").references(() => users.id),
  reopenedAt: timestamp("reopened_at"),
}, (table) => ({ periodUnique: uniqueIndex("transport_period_lock_uidx").on(table.schoolId, table.periodType, table.year, table.month) }));

export const transportVehicleOwnerHistory = pgTable("transport_vehicle_owner_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  ownerId: integer("owner_id").references(() => transportOwners.id).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  reason: text("reason"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportVehicleDriverHistory = pgTable("transport_vehicle_driver_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  driverId: integer("driver_id").references(() => transportDrivers.id).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  reason: text("reason"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportVehicleAlternativeDrivers = pgTable("transport_vehicle_alternative_drivers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  driverId: integer("driver_id").references(() => transportDrivers.id).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  reason: text("reason"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ activeAlternativeUnique: uniqueIndex("transport_vehicle_alternative_active_uidx").on(table.vehicleId, table.driverId).where(sql`${table.effectiveTo} IS NULL`) }));

export const transportVehicleOperatingDriverHistory = pgTable("transport_vehicle_operating_driver_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => transportVehicles.id).notNull(),
  driverId: integer("driver_id").references(() => transportDrivers.id).notNull(),
  operatingMode: text("operating_mode").notNull().default("primary"),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  expectedReturnAt: timestamp("expected_return_at"),
  reason: text("reason"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportVehicleReplacements = pgTable("transport_vehicle_replacements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  originalVehicleId: integer("original_vehicle_id").references(() => transportVehicles.id).notNull(),
  replacementVehicleId: integer("replacement_vehicle_id").references(() => transportVehicles.id).notNull(),
  replacementType: text("replacement_type").notNull().default("permanent"),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
  expectedReturnAt: timestamp("expected_return_at"),
  reason: text("reason").notNull(),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transportAuditEvents = pgTable("transport_audit_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  action: text("action").notNull(),
  previousValues: jsonb("previous_values"),
  newValues: jsonb("new_values"),
  reason: text("reason"),
  metadata: jsonb("metadata"),
  userId: integer("user_id").references(() => users.id),
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

export const libraryShelves = pgTable("library_shelves", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  schoolShelfNameUnique: uniqueIndex("library_shelves_school_name_unique").on(table.schoolId, table.name),
}));

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
  streamIds: integer("stream_ids").array(),
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
  notes: text("notes"),
  attachmentUrls: text("attachment_urls").array().default(sql`ARRAY[]::text[]`),
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
  dueDate: timestamp("due_date").notNull(),
  returnedAt: timestamp("returned_at"),
  conditionOnBorrow: text("condition_on_borrow").default("good"),
  conditionOnReturn: text("condition_on_return"),
  markedLostAt: timestamp("marked_lost_at"),
  markedRecoveredAt: timestamp("marked_recovered_at"),
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

export const libraryReservationStatusEnum = pgEnum("library_reservation_status", ["pending", "ready", "fulfilled", "cancelled", "expired"]);

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
  userId: integer("user_id").references(() => users.id),
  date: date("date").notNull(),
  clockIn: timestamp("clock_in"),
  clockOut: timestamp("clock_out"),
  status: text("status").notNull().default("on_time"),
  source: text("source").notNull().default("manual"),
  firstGateEntryAt: timestamp("first_gate_entry_at"),
  lastGateExitAt: timestamp("last_gate_exit_at"),
  currentlyOnCampus: boolean("currently_on_campus"),
  missingClockOut: boolean("missing_clock_out").notNull().default(false),
  autoClockedOut: boolean("auto_clocked_out").default(false),
  reasonRequired: boolean("reason_required").default(false),
  reasonType: text("reason_type"),
  reasonSubmittedAt: timestamp("reason_submitted_at"),
  lateReason: text("late_reason"),
  earlyClockOutReason: text("early_clock_out_reason"),
  clockInAccuracy: integer("clock_in_accuracy"),
  clockOutAccuracy: integer("clock_out_accuracy"),
  deviceSignature: text("device_signature"),
  clockInLatitude: text("clock_in_latitude"),
  clockInLongitude: text("clock_in_longitude"),
  clockOutLatitude: text("clock_out_latitude"),
  clockOutLongitude: text("clock_out_longitude"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  schoolStaffDateUniqueIdx: uniqueIndex("staff_attendance_school_staff_date_uidx").on(table.schoolId, table.staffId, table.date),
  schoolDateIdx: index("staff_attendance_school_date_idx").on(table.schoolId, table.date),
}));

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
  targetScope: text("target_scope").default("all"),
  targetStreamIds: integer("target_stream_ids").array().default(sql`ARRAY[]::integer[]`),
  targetClassIds: integer("target_class_ids").array().default(sql`ARRAY[]::integer[]`),
  targetStudentIds: integer("target_student_ids").array().default(sql`ARRAY[]::integer[]`),
  targetStaffIds: integer("target_staff_ids").array().default(sql`ARRAY[]::integer[]`),
  publishedRecipientUserIds: integer("published_recipient_user_ids").array().default(sql`ARRAY[]::integer[]`),
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
  streamId: integer("stream_id").references(() => streams.id),
  hostelMasterId: integer("hostel_master_id").references(() => staff.id),
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
  nationalIdNumber: text("birth_entry_number"),
  dreamJob: text("dream_job"),
  expectedStartDate: date("expected_start_date"),
  documents: text("documents"),
  status: text("status").default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Staff recruitment is intentionally separate from student admissions.
export const languageToolSettings = pgTable("language_tool_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  primaryProvider: text("primary_provider"),
  fallbackProvider: text("fallback_provider").default("harper"),
  mode: text("mode").notNull().default("balanced"),
  dialect: text("dialect").notNull().default("en-GB"),
  studentNamePersonalization: boolean("student_name_personalization").notNull().default(true),
  genderPronounCheck: boolean("gender_pronoun_check").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  organizationUnique: uniqueIndex("language_tool_settings_org_uidx").on(table.organizationId),
}));

export const recruitmentSettings = pgTable("recruitment_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  publicApplicationsOpen: boolean("public_applications_open").notNull().default(true),
  generalApplicationsOpen: boolean("general_applications_open").notNull().default(true),
  attachmentSizeLimitMB: integer("attachment_size_limit_mb").notNull().default(15),
  careersPageTitle: text("careers_page_title").notNull().default("Careers at First Choice Group of Schools"),
  careersPageMessage: text("careers_page_message").notNull().default("Apply for an advertised vacancy or submit a general application for future opportunities."),
  generalApplicationCategories: jsonb("general_application_categories").notNull().default(sql`'["High School Teaching","Primary School Teaching","Non-Teaching / Support Staff"]'::jsonb`),
  duplicateMatchFields: jsonb("duplicate_match_fields").notNull().default(sql`'["email","phone","national_id"]'::jsonb`),
  highSchoolMaxAge: integer("high_school_max_age").notNull().default(35),
  highSchoolMinimumALevelPoints: integer("high_school_minimum_a_level_points").notNull().default(13),
  highSchoolTeachingQualifiedMinimumALevelPoints: integer("high_school_teaching_qualified_minimum_a_level_points").notNull().default(10),
  highSchoolTeachingQualificationExceptionEnabled: boolean("high_school_teaching_qualification_exception_enabled").notNull().default(true),
  primaryTeachingQualificationRequired: boolean("primary_teaching_qualification_required").notNull().default(true),
  primaryMaximumOLevelSittings: integer("primary_maximum_o_level_sittings").notNull().default(2),
  primaryMinimumOLevelSubjects: integer("primary_minimum_o_level_subjects").notNull().default(5),
  primaryMinimumOLevelGrade: text("primary_minimum_o_level_grade").notNull().default("C"),
  primaryMandatoryOLevelSubjects: jsonb("primary_mandatory_o_level_subjects").notNull().default(sql`'["Mathematics","Science","English"]'::jsonb`),
  primaryMandatoryOLevelGrade: text("primary_mandatory_o_level_grade").notNull().default("C"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ organizationUnique: uniqueIndex("recruitment_settings_org_uidx").on(table.organizationId) }));

export const recruitmentDepartments = pgTable("recruitment_departments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  applicationCategory: text("application_category").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(100),
  responsibleUserId: integer("responsible_user_id").references(() => users.id),
  applicantContactPhone: text("applicant_contact_phone"),
  applicantContactEmail: text("applicant_contact_email"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  organizationNameUnique: uniqueIndex("recruitment_departments_org_name_uidx").on(table.organizationId, table.name),
  organizationOrderIdx: index("recruitment_departments_org_order_idx").on(table.organizationId, table.displayOrder),
}));

export const recruitmentExaminationBoards = pgTable("recruitment_examination_boards", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(100),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  organizationNameUnique: uniqueIndex("recruitment_examination_boards_org_name_uidx").on(table.organizationId, table.name),
  organizationOrderIdx: index("recruitment_examination_boards_org_order_idx").on(table.organizationId, table.displayOrder),
}));

export const recruitmentVacancies = pgTable("recruitment_vacancies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id),
  code: text("code").notNull(),
  title: text("title").notNull(),
  employmentCategory: text("employment_category").notNull(),
  department: text("department"),
  examinationBoard: text("examination_board"),
  subjects: jsonb("subjects").notNull().default(sql`'[]'::jsonb`),
  minimumYearsExperience: decimal("minimum_years_experience", { precision: 6, scale: 2 }),
  teachingQualificationRequired: boolean("teaching_qualification_required").notNull().default(false),
  description: text("description").notNull(),
  locationText: text("location_text"),
  positionsAvailable: integer("positions_available").notNull().default(1),
  status: text("status").notNull().default("draft"),
  publishedAt: timestamp("published_at"),
  opensAt: timestamp("opens_at"),
  closesAt: timestamp("closes_at"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  organizationCodeUnique: uniqueIndex("recruitment_vacancies_org_code_uidx").on(table.organizationId, table.code),
  publicStatusIdx: index("recruitment_vacancies_public_idx").on(table.organizationId, table.status, table.closesAt),
}));

export const recruitmentRequirements = pgTable("recruitment_requirements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  vacancyId: integer("vacancy_id").references(() => recruitmentVacancies.id),
  employmentCategory: text("employment_category"),
  scopeKey: text("scope_key").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  helpText: text("help_text"),
  inputType: text("input_type").notNull().default("boolean"),
  acceptedValues: jsonb("accepted_values").notNull().default(sql`'[]'::jsonb`),
  minimumNumber: decimal("minimum_number", { precision: 12, scale: 2 }),
  maximumNumber: decimal("maximum_number", { precision: 12, scale: 2 }),
  isMandatory: boolean("is_mandatory").notNull().default(false),
  autoRejectOnFail: boolean("auto_reject_on_fail").notNull().default(false),
  alternativePassKeywords: jsonb("alternative_pass_keywords").notNull().default(sql`'[]'::jsonb`),
  alternativePassNote: text("alternative_pass_note"),
  displayOrder: integer("display_order").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  scopeCodeUnique: uniqueIndex("recruitment_requirements_scope_code_uidx").on(table.organizationId, table.scopeKey, table.code),
}));

export const recruitmentDocumentCategories = pgTable("recruitment_document_categories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  vacancyId: integer("vacancy_id").references(() => recruitmentVacancies.id),
  employmentCategory: text("employment_category"),
  scopeKey: text("scope_key").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  isRequired: boolean("is_required").notNull().default(false),
  allowsMultiple: boolean("allows_multiple").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  scopeCodeUnique: uniqueIndex("recruitment_document_categories_scope_code_uidx").on(table.organizationId, table.scopeKey, table.code),
}));

export const recruitmentApplications = pgTable("recruitment_applications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id),
  vacancyId: integer("vacancy_id").references(() => recruitmentVacancies.id),
  applicationType: text("application_type").notNull(),
  employmentCategory: text("employment_category").notNull(),
  department: text("department"),
  examinationBoard: text("examination_board"), // legacy compatibility for historical single-value records
  examinationBoards: jsonb("examination_boards").notNull().default(sql`'[]'::jsonb`),
  declaredSubjects: jsonb("declared_subjects").notNull().default(sql`'[]'::jsonb`),
  recruiterAssignedSubjects: jsonb("recruiter_assigned_subjects").notNull().default(sql`'[]'::jsonb`),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  nationalId: text("national_id").notNull(),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"),
  address: text("address"),
  preferredSchoolIds: jsonb("preferred_school_ids").notNull().default(sql`'[]'::jsonb`),
  qualifications: text("qualifications"),
  yearsExperience: decimal("years_experience", { precision: 6, scale: 2 }).notNull().default("0"),
  currentEmployer: text("current_employer"),
  coverLetter: text("cover_letter"),
  ageAtSubmission: integer("age_at_submission"),
  aLevelResults: jsonb("a_level_results").notNull().default(sql`'[]'::jsonb`),
  aLevelPoints: integer("a_level_points"),
  oLevelResults: jsonb("o_level_results").notNull().default(sql`'[]'::jsonb`),
  oLevelSittingCount: integer("o_level_sitting_count"),
  oLevelQualifyingSubjectCount: integer("o_level_qualifying_subject_count"),
  holdsTeachingQualification: boolean("holds_teaching_qualification").notNull().default(false),
  eligibilityRoute: text("eligibility_route"),
  normalizedEmail: text("normalized_email").notNull(),
  normalizedPhone: text("normalized_phone").notNull(),
  normalizedNationalId: text("normalized_national_id").notNull(),
  eligibilityStatus: text("eligibility_status").notNull().default("eligible"),
  failedRequirementCodes: jsonb("failed_requirement_codes").notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("submitted"),
  recruiterNotes: text("recruiter_notes"),
  availabilityStatus: text("availability_status").notNull().default("available"),
  availabilityNotes: text("availability_notes"),
  lastContactedAt: timestamp("last_contacted_at"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  submittedAt: timestamp("submitted_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  organizationStatusIdx: index("recruitment_applications_org_status_idx").on(table.organizationId, table.status, table.submittedAt),
  emailIdx: index("recruitment_applications_normalized_email_idx").on(table.organizationId, table.normalizedEmail),
  phoneIdx: index("recruitment_applications_normalized_phone_idx").on(table.organizationId, table.normalizedPhone),
  nationalIdIdx: index("recruitment_applications_normalized_national_id_idx").on(table.organizationId, table.normalizedNationalId),
}));

export const recruitmentApplicationAnswers = pgTable("recruitment_application_answers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  applicationId: integer("application_id").references(() => recruitmentApplications.id).notNull(),
  requirementId: integer("requirement_id").references(() => recruitmentRequirements.id).notNull(),
  answerValue: jsonb("answer_value").notNull(),
  passed: boolean("passed").notNull().default(true),
  alternativeAccepted: boolean("alternative_accepted").notNull().default(false),
  evaluationNote: text("evaluation_note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({ applicationRequirementUnique: uniqueIndex("recruitment_application_answers_uidx").on(table.applicationId, table.requirementId) }));

export const recruitmentApplicationDocuments = pgTable("recruitment_application_documents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  applicationId: integer("application_id").references(() => recruitmentApplications.id).notNull(),
  categoryCode: text("category_code").notNull(),
  originalName: text("original_name").notNull(),
  storedName: text("stored_name").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  reviewStatus: text("review_status"),
  reviewNotes: text("review_notes"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  archivedAt: timestamp("archived_at"),
}, (table) => ({ applicationIdx: index("recruitment_application_documents_application_idx").on(table.applicationId, table.isActive) }));

export const recruitmentApplicationStatusHistory = pgTable("recruitment_application_status_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  applicationId: integer("application_id").references(() => recruitmentApplications.id).notNull(),
  previousStatus: text("previous_status"),
  newStatus: text("new_status").notNull(),
  notes: text("notes"),
  changedByUserId: integer("changed_by_user_id").references(() => users.id),
  actorType: text("actor_type").notNull().default("staff"),
  actorLabel: text("actor_label"),
  changedAt: timestamp("changed_at").defaultNow(),
});

export const recruitmentNotes = pgTable("recruitment_notes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  applicationId: integer("application_id").references(() => recruitmentApplications.id).notNull(),
  note: text("note").notNull(),
  authorUserId: integer("author_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  applicationIdx: index("recruitment_notes_application_idx").on(table.applicationId, table.createdAt),
}));

export const recruitmentRejectionAttempts = pgTable("recruitment_rejection_attempts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  vacancyId: integer("vacancy_id").references(() => recruitmentVacancies.id),
  applicationType: text("application_type").notNull(),
  employmentCategory: text("employment_category").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  normalizedEmail: text("normalized_email"),
  normalizedPhone: text("normalized_phone"),
  normalizedNationalId: text("normalized_national_id"),
  reasonCode: text("reason_code").notNull(),
  failedRequirementCodes: jsonb("failed_requirement_codes").notNull().default(sql`'[]'::jsonb`),
  duplicateApplicationId: integer("duplicate_application_id").references(() => recruitmentApplications.id),
  screeningDetails: jsonb("screening_details").notNull().default(sql`'{}'::jsonb`),
  attemptedAt: timestamp("attempted_at").defaultNow(),
}, (table) => ({ organizationReasonIdx: index("recruitment_rejection_attempts_org_reason_idx").on(table.organizationId, table.reasonCode, table.attemptedAt) }));

export const recruitmentInterviews = pgTable("recruitment_interviews", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  applicationId: integer("application_id").references(() => recruitmentApplications.id).notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  location: text("location"),
  interviewType: text("interview_type").notNull().default("in_person"),
  panelUserIds: jsonb("panel_user_ids").notNull().default(sql`'[]'::jsonb`),
  notes: text("notes"),
  applicantInstructions: text("applicant_instructions"),
  internalNotes: text("internal_notes"),
  interviewLink: text("interview_link"),
  status: text("status").notNull().default("scheduled"),
  outcome: text("outcome"),
  createdByUserId: integer("created_by_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const recruitmentVacancyCandidates = pgTable("recruitment_vacancy_candidates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vacancyId: integer("vacancy_id").references(() => recruitmentVacancies.id).notNull(),
  applicationId: integer("application_id").references(() => recruitmentApplications.id).notNull(),
  stage: text("stage").notNull().default("suggested"),
  matchReasons: jsonb("match_reasons").notNull().default(sql`'[]'::jsonb`),
  finalRank: integer("final_rank"),
  shortlistedAt: timestamp("shortlisted_at"),
  rankedAt: timestamp("ranked_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  vacancyApplicationUnique: uniqueIndex("recruitment_vacancy_candidates_uidx").on(table.vacancyId, table.applicationId),
  vacancyStageIdx: index("recruitment_vacancy_candidates_stage_idx").on(table.vacancyId, table.stage),
}));

export const recruitmentTalentRankingLists = pgTable("recruitment_talent_ranking_lists", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  department: text("department").notNull(),
  subject: text("subject").notNull(),
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  listUnique: uniqueIndex("recruitment_talent_ranking_lists_uidx").on(table.organizationId, table.department, table.subject),
}));

export const recruitmentTalentRankings = pgTable("recruitment_talent_rankings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  applicationId: integer("application_id").references(() => recruitmentApplications.id).notNull(),
  department: text("department").notNull(),
  subject: text("subject").notNull(),
  position: integer("position").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  addedAt: timestamp("added_at").defaultNow(),
  removedAt: timestamp("removed_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  candidateListUnique: uniqueIndex("recruitment_talent_rankings_candidate_list_uidx").on(table.organizationId, table.applicationId, table.department, table.subject),
  listPositionIdx: index("recruitment_talent_rankings_list_position_idx").on(table.organizationId, table.department, table.subject, table.isActive, table.position),
  applicationIdx: index("recruitment_talent_rankings_application_idx").on(table.applicationId, table.isActive),
}));

export const recruitmentActivity = pgTable("recruitment_activity", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  applicationId: integer("application_id").references(() => recruitmentApplications.id),
  vacancyId: integer("vacancy_id").references(() => recruitmentVacancies.id),
  activityType: text("activity_type").notNull(),
  summary: text("summary").notNull(),
  details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
  actorUserId: integer("actor_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  applicationIdx: index("recruitment_activity_application_idx").on(table.applicationId, table.createdAt),
  vacancyIdx: index("recruitment_activity_vacancy_idx").on(table.vacancyId, table.createdAt),
}));

export const recruitmentNotificationConfigs = pgTable("recruitment_notification_configs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  eventKey: text("event_key").notNull(),
  applicationVariant: text("application_variant").notNull().default("any"),
  enabled: boolean("enabled").notNull().default(false),
  channel: text("channel").notNull().default("none"),
  emailSubject: text("email_subject"),
  emailTemplate: text("email_template"),
  smsTemplate: text("sms_template"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  organizationEventVariantUnique: uniqueIndex("recruitment_notification_configs_uidx").on(table.organizationId, table.eventKey, table.applicationVariant),
}));

export const recruitmentNotificationLogs = pgTable("recruitment_notification_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  applicationId: integer("application_id").references(() => recruitmentApplications.id),
  vacancyId: integer("vacancy_id").references(() => recruitmentVacancies.id),
  interviewId: integer("interview_id").references(() => recruitmentInterviews.id),
  eventKey: text("event_key").notNull(),
  channel: text("channel").notNull(),
  destination: text("destination"),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
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
  accountRole: userRoleEnum("account_role"),
  isSystemDefault: boolean("is_system_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const accessGroupPermissions = pgTable("access_group_permissions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accessGroupId: integer("access_group_id").references(() => accessGroups.id).notNull(),
  permissionId: integer("permission_id").references(() => permissions.id).notNull(),
}, (table) => ({
  accessGroupPermissionUniqueIdx: uniqueIndex("access_group_permissions_group_permission_uidx").on(table.accessGroupId, table.permissionId),
}));

export const userAccessGroups = pgTable("user_access_groups", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id).notNull(),
  accessGroupId: integer("access_group_id").references(() => accessGroups.id).notNull(),
}, (table) => ({
  userAccessGroupUniqueIdx: uniqueIndex("user_access_groups_user_group_uidx").on(table.userId, table.accessGroupId),
}));

export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id).notNull(),
  permissionId: integer("permission_id").references(() => permissions.id).notNull(),
  granted: boolean("granted").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userPermissionOverrideUniqueIdx: uniqueIndex("user_permission_overrides_user_permission_uidx").on(table.userId, table.permissionId),
}));

export const userSchoolAccess = pgTable("user_school_access", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
});

export const insertOrganizationSchema = omitInsertFields(createInsertSchema(organizations), { id: true, createdAt: true });
export const insertSchoolSchema = omitInsertFields(createInsertSchema(schools), { id: true, createdAt: true });
export const insertUserSchema = omitInsertFields(createInsertSchema(users), { id: true, createdAt: true });
export const insertStaffSchema = omitInsertFields(createInsertSchema(staff), { id: true, staffNo: true, createdAt: true });
export const insertStreamSchema = omitInsertFields(createInsertSchema(streams), { id: true });
export const insertClassSchema = omitInsertFields(createInsertSchema(classes), { id: true, archivedAt: true, createdAt: true });
export const insertClassTeacherAssignmentSchema = omitInsertFields(createInsertSchema(classTeacherAssignments), { id: true, createdAt: true });
export const insertParentSchema = omitInsertFields(createInsertSchema(parents), { id: true, createdAt: true });
export const insertStudentSchema = omitInsertFields(createInsertSchema(students), { id: true, admissionNo: true, archivedAt: true, createdAt: true });
export const insertSubjectSchema = omitInsertFields(createInsertSchema(subjects), { id: true });
export const insertStaffSubjectSchema = omitInsertFields(createInsertSchema(staffSubjects), { id: true });
export const insertStudentSubjectSchema = omitInsertFields(createInsertSchema(studentSubjects), { id: true });
export const insertInternalTransferSchema = omitInsertFields(createInsertSchema(internalTransfers), { id: true, createdAt: true, completedAt: true });
export const insertStudentEnrollmentEventSchema = omitInsertFields(createInsertSchema(studentEnrollmentEvents), { id: true, createdAt: true });
export const insertClassSubjectSchema = omitInsertFields(createInsertSchema(classSubjects), { id: true });
export const insertGradeSchema = omitInsertFields(createInsertSchema(grades), { id: true });
export const insertGradeProfileSettingSchema = omitInsertFields(createInsertSchema(gradeProfileSettings), { id: true, createdAt: true, updatedAt: true });
export const insertAssessmentSchema = omitInsertFields(createInsertSchema(assessments), { id: true, createdAt: true });
export const insertMarkSchema = omitInsertFields(createInsertSchema(marks), { id: true, markedAt: true });
export const insertAttendanceRecordSchema = omitInsertFields(createInsertSchema(attendanceRecords), { id: true, createdAt: true });
export const insertDisciplineRecordSchema = omitInsertFields(createInsertSchema(disciplineRecords), { id: true, createdAt: true });
export const insertClinicRecordSchema = omitInsertFields(createInsertSchema(clinicRecords), { id: true, createdAt: true });
export const insertFeesPaymentSchema = omitInsertFields(createInsertSchema(feesPayments), { id: true, createdAt: true });
export const insertTransportRouteSchema = omitInsertFields(createInsertSchema(transportRoutes), { id: true, createdAt: true, updatedAt: true });
export const insertTransportPickupPointSchema = omitInsertFields(createInsertSchema(transportPickupPoints), { id: true, createdAt: true });
export const insertTransportOwnerSchema = omitInsertFields(createInsertSchema(transportOwners), { id: true, createdAt: true, updatedAt: true });
export const insertTransportDriverSchema = omitInsertFields(createInsertSchema(transportDrivers), { id: true, createdAt: true, updatedAt: true });
export const insertTransportVehicleSchema = omitInsertFields(createInsertSchema(transportVehicles), { id: true, createdAt: true, updatedAt: true });
export const insertTransportOrganizationSettingSchema = omitInsertFields(createInsertSchema(transportOrganizationSettings), { id: true, createdAt: true, updatedAt: true });
export const insertTransportSettingSchema = omitInsertFields(createInsertSchema(transportSettings), { id: true, createdAt: true, updatedAt: true });
export const insertTransportServicePointSchema = omitInsertFields(createInsertSchema(transportServicePoints), { id: true, createdAt: true });
export const insertTransportVehiclePathSchema = omitInsertFields(createInsertSchema(transportVehiclePaths), { id: true, createdAt: true, updatedAt: true, activatedAt: true });
export const insertTransportPathNodeSchema = omitInsertFields(createInsertSchema(transportPathNodes), { id: true, createdAt: true });
export const insertTransportAssignmentSchema = omitInsertFields(createInsertSchema(transportAssignments), { id: true, createdAt: true, updatedAt: true });
export const insertTransportPathNodeLearnerSchema = omitInsertFields(createInsertSchema(transportPathNodeLearners), { id: true, createdAt: true });
export const insertTransportAssignmentEventSchema = omitInsertFields(createInsertSchema(transportAssignmentEvents), { id: true, createdAt: true });
export const insertTransportChargeSchema = omitInsertFields(createInsertSchema(transportCharges), { id: true, createdAt: true });
export const insertTransportAccountAdjustmentSchema = omitInsertFields(createInsertSchema(transportAccountAdjustments), { id: true, createdAt: true });
export const insertTransportProviderAdjustmentSchema = omitInsertFields(createInsertSchema(transportProviderAdjustments), { id: true, createdAt: true });
export const insertTransportPaymentSchema = omitInsertFields(createInsertSchema(transportPayments), { id: true, createdAt: true, reversedAt: true, reversedByUserId: true, reversalReason: true, verifiedAt: true, verifiedByUserId: true, reconciledAt: true, reconciledByUserId: true });
export const insertTransportPaymentAllocationSchema = omitInsertFields(createInsertSchema(transportPaymentAllocations), { id: true, createdAt: true });
export const insertTransportReceiptEventSchema = omitInsertFields(createInsertSchema(transportReceiptEvents), { id: true, createdAt: true });
export const insertTransportRefundSchema = omitInsertFields(createInsertSchema(transportRefunds), { id: true, createdAt: true, approvedAt: true, paidAt: true, accountedCashupId: true, accountedAt: true });
export const insertTransportCashupSchema = omitInsertFields(createInsertSchema(transportCashups), { id: true, createdAt: true, submittedAt: true, verifiedAt: true });
export const insertTransportCashupPaymentSchema = omitInsertFields(createInsertSchema(transportCashupPayments), { id: true, createdAt: true });
export const insertTransportSubscriptionRuleSchema = omitInsertFields(createInsertSchema(transportSubscriptionRules), { id: true, createdAt: true });
export const insertTransportPenaltySchema = omitInsertFields(createInsertSchema(transportPenalties), { id: true, createdAt: true });
export const insertTransportAdvanceSchema = omitInsertFields(createInsertSchema(transportAdvances), { id: true, createdAt: true });
export const insertTransportIncidentSchema = omitInsertFields(createInsertSchema(transportIncidents), { id: true, createdAt: true, resolvedAt: true });
export const insertTransportClaimSchema = omitInsertFields(createInsertSchema(transportClaims), { id: true, createdAt: true, submittedAt: true, verifiedAt: true, approvedAt: true });
export const insertTransportClaimAllocationSchema = omitInsertFields(createInsertSchema(transportClaimAllocations), { id: true, createdAt: true });
export const insertTransportClaimDeductionSchema = omitInsertFields(createInsertSchema(transportClaimDeductions), { id: true, createdAt: true });
export const insertTransportPayoutSchema = omitInsertFields(createInsertSchema(transportPayouts), { id: true, createdAt: true });
export const insertTransportPeriodLockSchema = omitInsertFields(createInsertSchema(transportPeriodLocks), { id: true, lockedAt: true, reopenedAt: true });
export const insertTransportVehicleOwnerHistorySchema = omitInsertFields(createInsertSchema(transportVehicleOwnerHistory), { id: true, createdAt: true });
export const insertTransportVehicleDriverHistorySchema = omitInsertFields(createInsertSchema(transportVehicleDriverHistory), { id: true, createdAt: true });
export const insertTransportVehicleAlternativeDriverSchema = omitInsertFields(createInsertSchema(transportVehicleAlternativeDrivers), { id: true, createdAt: true });
export const insertTransportVehicleOperatingDriverHistorySchema = omitInsertFields(createInsertSchema(transportVehicleOperatingDriverHistory), { id: true, createdAt: true });
export const insertTransportVehicleReplacementSchema = omitInsertFields(createInsertSchema(transportVehicleReplacements), { id: true, createdAt: true });
export const insertTransportAuditEventSchema = omitInsertFields(createInsertSchema(transportAuditEvents), { id: true, createdAt: true });
export const insertTransportDriverOwnerHistorySchema = omitInsertFields(createInsertSchema(transportDriverOwnerHistory), { id: true, createdAt: true });
export const insertTransportDocumentRequirementSchema = omitInsertFields(createInsertSchema(transportDocumentRequirements), { id: true, createdAt: true, updatedAt: true });
export const insertTransportDocumentSchema = omitInsertFields(createInsertSchema(transportDocuments), { id: true, uploadedAt: true, archivedAt: true });
export const insertTransportComplianceOverrideSchema = omitInsertFields(createInsertSchema(transportComplianceOverrides), { id: true, createdAt: true, revokedAt: true });
export const insertTransportComplianceNotificationLogSchema = omitInsertFields(createInsertSchema(transportComplianceNotificationLog), { id: true, createdAt: true });

export const insertLibraryResourceSchema = omitInsertFields(createInsertSchema(libraryResources), { id: true, createdAt: true });
export const insertLibraryCategorySchema = omitInsertFields(createInsertSchema(libraryCategories), { id: true, createdAt: true });
export const insertLibraryShelfSchema = omitInsertFields(createInsertSchema(libraryShelves), { id: true, createdAt: true });
export const insertLibraryBookSchema = omitInsertFields(createInsertSchema(libraryBooks), { id: true, createdAt: true });
export const insertLibraryBookCopySchema = omitInsertFields(createInsertSchema(libraryBookCopies), { id: true, addedAt: true });
export const insertLibraryLoanSchema = omitInsertFields(createInsertSchema(libraryLoans), { id: true, createdAt: true, issuedAt: true, returnedAt: true, markedLostAt: true, markedRecoveredAt: true });
export const insertLibraryFineSchema = omitInsertFields(createInsertSchema(libraryFines), { id: true, createdAt: true, paidAt: true });
export const insertLibraryReservationSchema = omitInsertFields(createInsertSchema(libraryReservations), { id: true, createdAt: true, reservedAt: true, notifiedAt: true });
export const insertLibraryPolicySchema = omitInsertFields(createInsertSchema(libraryPolicies), { id: true, updatedAt: true });
export const insertTimetableSlotSchema = omitInsertFields(createInsertSchema(timetableSlots), { id: true });
export const insertLogbookEntrySchema = omitInsertFields(createInsertSchema(logbookEntries), { id: true, createdAt: true });
export const insertStaffAttendanceLogSchema = omitInsertFields(createInsertSchema(staffAttendanceLogs), { id: true, createdAt: true });
export const insertPosItemSchema = omitInsertFields(createInsertSchema(posItems), { id: true, createdAt: true });
export const insertPosSaleSchema = omitInsertFields(createInsertSchema(posSales), { id: true, saleDate: true });
export const insertPosSaleItemSchema = omitInsertFields(createInsertSchema(posSaleItems), { id: true });
export const insertNewsletterSchema = omitInsertFields(createInsertSchema(newsletters), { id: true, createdAt: true });
export const insertHostelSchema = omitInsertFields(createInsertSchema(hostels), { id: true, createdAt: true });
export const insertHostelRollCallSchema = omitInsertFields(createInsertSchema(hostelRollCall), { id: true, createdAt: true });
export const insertStudentApplicationSchema = omitInsertFields(createInsertSchema(studentApplications), { id: true, createdAt: true });
export const insertLanguageToolSettingSchema = omitInsertFields(createInsertSchema(languageToolSettings), { id: true, createdAt: true, updatedAt: true });
export const insertRecruitmentSettingSchema = omitInsertFields(createInsertSchema(recruitmentSettings), { id: true, createdAt: true, updatedAt: true });
export const insertRecruitmentDepartmentSchema = omitInsertFields(createInsertSchema(recruitmentDepartments), { id: true, createdAt: true, updatedAt: true });
export const insertRecruitmentExaminationBoardSchema = omitInsertFields(createInsertSchema(recruitmentExaminationBoards), { id: true, createdAt: true, updatedAt: true });
export const insertRecruitmentVacancySchema = omitInsertFields(createInsertSchema(recruitmentVacancies), { id: true, createdAt: true, updatedAt: true, publishedAt: true });
export const insertRecruitmentRequirementSchema = omitInsertFields(createInsertSchema(recruitmentRequirements), { id: true, createdAt: true, updatedAt: true });
export const insertRecruitmentDocumentCategorySchema = omitInsertFields(createInsertSchema(recruitmentDocumentCategories), { id: true, createdAt: true, updatedAt: true });
export const insertRecruitmentApplicationSchema = omitInsertFields(createInsertSchema(recruitmentApplications), { id: true, createdAt: true, updatedAt: true, submittedAt: true, reviewedAt: true });
export const insertRecruitmentApplicationAnswerSchema = omitInsertFields(createInsertSchema(recruitmentApplicationAnswers), { id: true, createdAt: true });
export const insertRecruitmentApplicationDocumentSchema = omitInsertFields(createInsertSchema(recruitmentApplicationDocuments), { id: true, uploadedAt: true, archivedAt: true });
export const insertRecruitmentApplicationStatusHistorySchema = omitInsertFields(createInsertSchema(recruitmentApplicationStatusHistory), { id: true, changedAt: true });
export const insertRecruitmentNoteSchema = omitInsertFields(createInsertSchema(recruitmentNotes), { id: true, createdAt: true });
export const insertRecruitmentRejectionAttemptSchema = omitInsertFields(createInsertSchema(recruitmentRejectionAttempts), { id: true, attemptedAt: true });
export const insertRecruitmentVacancyCandidateSchema = omitInsertFields(createInsertSchema(recruitmentVacancyCandidates), { id: true, createdAt: true, updatedAt: true });
export const insertRecruitmentTalentRankingListSchema = omitInsertFields(createInsertSchema(recruitmentTalentRankingLists), { id: true, updatedAt: true });
export const insertRecruitmentTalentRankingSchema = omitInsertFields(createInsertSchema(recruitmentTalentRankings), { id: true, addedAt: true, removedAt: true, updatedAt: true });
export const insertRecruitmentActivitySchema = omitInsertFields(createInsertSchema(recruitmentActivity), { id: true, createdAt: true });
export const insertRecruitmentNotificationConfigSchema = omitInsertFields(createInsertSchema(recruitmentNotificationConfigs), { id: true, createdAt: true, updatedAt: true });
export const insertRecruitmentNotificationLogSchema = omitInsertFields(createInsertSchema(recruitmentNotificationLogs), { id: true, createdAt: true });
export const insertRecruitmentInterviewSchema = omitInsertFields(createInsertSchema(recruitmentInterviews), { id: true, createdAt: true, updatedAt: true });
export const insertPermissionSchema = omitInsertFields(createInsertSchema(permissions), { id: true, createdAt: true });
export const insertAccessGroupSchema = omitInsertFields(createInsertSchema(accessGroups), { id: true, createdAt: true });
export const insertAccessGroupPermissionSchema = omitInsertFields(createInsertSchema(accessGroupPermissions), { id: true });
export const insertUserAccessGroupSchema = omitInsertFields(createInsertSchema(userAccessGroups), { id: true });
export const insertUserPermissionOverrideSchema = omitInsertFields(createInsertSchema(userPermissionOverrides), { id: true, createdAt: true });
export const insertUserSchoolAccessSchema = omitInsertFields(createInsertSchema(userSchoolAccess), { id: true });

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
export type InsertClassTeacherAssignment = z.infer<typeof insertClassTeacherAssignmentSchema>;
export type ClassTeacherAssignment = typeof classTeacherAssignments.$inferSelect;
export type InsertParent = z.infer<typeof insertParentSchema>;
export type Parent = typeof parents.$inferSelect;
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof students.$inferSelect;
export type InsertSubject = z.infer<typeof insertSubjectSchema>;
export type Subject = typeof subjects.$inferSelect;
export type InsertStaffSubject = z.infer<typeof insertStaffSubjectSchema>;
export type StaffSubject = typeof staffSubjects.$inferSelect;
export type InsertStudentSubject = z.infer<typeof insertStudentSubjectSchema>;
export type InternalTransfer = typeof internalTransfers.$inferSelect;
export type InsertInternalTransfer = z.infer<typeof insertInternalTransferSchema>;
export type StudentSubject = typeof studentSubjects.$inferSelect;
export type InsertClassSubject = z.infer<typeof insertClassSubjectSchema>;
export type ClassSubject = typeof classSubjects.$inferSelect;
export type InsertGrade = z.infer<typeof insertGradeSchema>;
export type Grade = typeof grades.$inferSelect;
export type InsertGradeProfileSetting = z.infer<typeof insertGradeProfileSettingSchema>;
export type GradeProfileSetting = typeof gradeProfileSettings.$inferSelect;
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;
export type Assessment = typeof assessments.$inferSelect;
export type InsertMark = z.infer<typeof insertMarkSchema>;
export type Mark = typeof marks.$inferSelect;
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type AttendanceGateEvidenceCorrection = typeof attendanceGateEvidenceCorrections.$inferSelect;
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
export type InsertLibraryShelf = z.infer<typeof insertLibraryShelfSchema>;
export type LibraryShelf = typeof libraryShelves.$inferSelect;
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
export type InsertHostel = z.infer<typeof insertHostelSchema>;
export type Hostel = typeof hostels.$inferSelect;
export type InsertHostelRollCall = z.infer<typeof insertHostelRollCallSchema>;
export type HostelRollCall = typeof hostelRollCall.$inferSelect;
export type InsertStudentApplication = z.infer<typeof insertStudentApplicationSchema>;
export type StudentApplication = typeof studentApplications.$inferSelect;
export type RecruitmentSetting = typeof recruitmentSettings.$inferSelect;
export type LanguageToolSetting = typeof languageToolSettings.$inferSelect;
export type RecruitmentDepartment = typeof recruitmentDepartments.$inferSelect;
export type RecruitmentExaminationBoard = typeof recruitmentExaminationBoards.$inferSelect;
export type RecruitmentVacancy = typeof recruitmentVacancies.$inferSelect;
export type RecruitmentRequirement = typeof recruitmentRequirements.$inferSelect;
export type RecruitmentDocumentCategory = typeof recruitmentDocumentCategories.$inferSelect;
export type RecruitmentApplication = typeof recruitmentApplications.$inferSelect;
export type RecruitmentApplicationAnswer = typeof recruitmentApplicationAnswers.$inferSelect;
export type RecruitmentApplicationDocument = typeof recruitmentApplicationDocuments.$inferSelect;
export type RecruitmentApplicationStatusHistory = typeof recruitmentApplicationStatusHistory.$inferSelect;
export type RecruitmentNote = typeof recruitmentNotes.$inferSelect;
export type RecruitmentRejectionAttempt = typeof recruitmentRejectionAttempts.$inferSelect;
export type RecruitmentVacancyCandidate = typeof recruitmentVacancyCandidates.$inferSelect;
export type RecruitmentTalentRankingList = typeof recruitmentTalentRankingLists.$inferSelect;
export type RecruitmentTalentRanking = typeof recruitmentTalentRankings.$inferSelect;
export type RecruitmentActivity = typeof recruitmentActivity.$inferSelect;
export type RecruitmentNotificationConfig = typeof recruitmentNotificationConfigs.$inferSelect;
export type RecruitmentNotificationLog = typeof recruitmentNotificationLogs.$inferSelect;
export type RecruitmentInterview = typeof recruitmentInterviews.$inferSelect;
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

export const insertCommunicationLogSchema = omitInsertFields(createInsertSchema(communicationLogs), { id: true, createdAt: true });
export type InsertCommunicationLog = z.infer<typeof insertCommunicationLogSchema>;
export type CommunicationLog = typeof communicationLogs.$inferSelect;

export const communicationJobStatusEnum = pgEnum("communication_job_status", ["queued", "running", "completed", "failed"]);

export const communicationJobs = pgTable("communication_jobs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  jobType: text("job_type").notNull(),
  title: text("title").notNull(),
  status: communicationJobStatusEnum("status").notNull().default("queued"),
  requestedBy: integer("requested_by").references(() => users.id),
  totalCount: integer("total_count").notNull().default(0),
  processedCount: integer("processed_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  errorSummary: text("error_summary"),
  metadata: jsonb("metadata"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCommunicationJobSchema = omitInsertFields(createInsertSchema(communicationJobs), { id: true, createdAt: true, updatedAt: true, startedAt: true, completedAt: true });
export type InsertCommunicationJob = z.infer<typeof insertCommunicationJobSchema>;
export type CommunicationJob = typeof communicationJobs.$inferSelect;

// Assessment Types (lookup table)
export const assessmentTypes = pgTable("assessment_types", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id),
  name: text("name").notNull(),
  code: text("code"),
  assessmentCardinality: text("assessment_cardinality"),
  reportAggregationMode: text("report_aggregation_mode"),
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

// Publication is stored per linked exercise/exam and class. Stream publication is a
// bulk operation over these class rows, which keeps class and stream state synchronized.
export const assessmentPublications = pgTable("assessment_publications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  examId: integer("exam_id").references(() => exams.id).notNull(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  streamId: integer("stream_id").references(() => streams.id),
  isPublished: boolean("is_published").notNull().default(false),
  publicationVersion: integer("publication_version").notNull().default(0),
  lastAction: text("last_action").notNull().default("unpublished"),
  publishedByUserId: integer("published_by_user_id").references(() => users.id),
  publishedAt: timestamp("published_at"),
  unpublishedByUserId: integer("unpublished_by_user_id").references(() => users.id),
  unpublishedAt: timestamp("unpublished_at"),
  unpublishReason: text("unpublish_reason"),
  overallCommentRowsSnapshot: jsonb("overall_comment_rows_snapshot").$type<any[]>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  examClassUnique: uniqueIndex("assessment_publications_exam_class_uidx").on(table.examId, table.classId),
}));

export const assessmentPublicationEvents = pgTable("assessment_publication_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicationId: integer("publication_id").references(() => assessmentPublications.id),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  examId: integer("exam_id").references(() => exams.id).notNull(),
  classId: integer("class_id").references(() => classes.id),
  streamId: integer("stream_id").references(() => streams.id),
  action: text("action").notNull(),
  publicationVersion: integer("publication_version").notNull().default(0),
  reason: text("reason"),
  audience: text("audience"),
  channels: text("channels").array(),
  performedByUserId: integer("performed_by_user_id").references(() => users.id),
  metadata: jsonb("metadata"),
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

  // School-level calendar events may suppress normal attendance expectations
  // without affecting gate access permissions. Values: normal | no_regular_attendance.
  attendanceExpectation: text("attendance_expectation").notNull().default("normal"),

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

export const calendarEventClasses = pgTable(
  "calendar_event_classes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    eventId: integer("event_id").references(() => calendarEvents.id).notNull(),
    classId: integer("class_id").references(() => classes.id).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    uniqEventClass: uniqueIndex("calendar_event_classes_event_class_unique").on(
      t.eventId,
      t.classId,
    ),
  }),
);

export const calendarEventStaffViewers = pgTable(
  "calendar_event_staff_viewers",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    eventId: integer("event_id").references(() => calendarEvents.id).notNull(),
    staffId: integer("staff_id").references(() => staff.id).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    uniqEventStaff: uniqueIndex("calendar_event_staff_viewers_event_staff_unique").on(
      t.eventId,
      t.staffId,
    ),
  }),
);

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
export const insertCalendarEventSchema = omitInsertFields(createInsertSchema(calendarEvents), {
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEvents.$inferSelect;

export const insertCalendarEventReminderSchema = omitInsertFields(
  createInsertSchema(calendarEventReminders),
  {
    id: true,
    createdAt: true,
  },
);
export type InsertCalendarEventReminder = z.infer<
  typeof insertCalendarEventReminderSchema
>;
export type CalendarEventReminder = typeof calendarEventReminders.$inferSelect;

export const insertCalendarEventAttendeeSchema = omitInsertFields(
  createInsertSchema(calendarEventAttendees),
  {
    id: true,
    createdAt: true,
  },
);
export type InsertCalendarEventAttendee = z.infer<
  typeof insertCalendarEventAttendeeSchema
>;
export type CalendarEventAttendee = typeof calendarEventAttendees.$inferSelect;

export const insertScheduledJobSchema = omitInsertFields(createInsertSchema(scheduledJobs), {
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

export const insertNotificationSchema = omitInsertFields(createInsertSchema(notifications), { id: true, createdAt: true, readAt: true });
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

// School-day attendance configuration
export const schoolDaySchedules = pgTable("school_day_schedules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  dayOfWeek: integer("day_of_week").notNull(), // 0 Sunday ... 6 Saturday
  isSchoolDay: boolean("is_school_day").notNull().default(false),
  studentStartTime: text("student_start_time").notNull().default("07:30"),
  studentLateGraceMinutes: integer("student_late_grace_minutes").notNull().default(0),
  studentEndTime: text("student_end_time").notNull().default("15:30"),
  studentDismissalGraceMinutes: integer("student_dismissal_grace_minutes").notNull().default(0),
  staffStartTime: text("staff_start_time").notNull().default("07:20"),
  staffLateGraceMinutes: integer("staff_late_grace_minutes").notNull().default(0),
  staffEndTime: text("staff_end_time").notNull().default("16:00"),
  breakStartTime: text("break_start_time"),
  breakEndTime: text("break_end_time"),
  lunchStartTime: text("lunch_start_time"),
  lunchEndTime: text("lunch_end_time"),
  reconciliationTime: text("reconciliation_time").notNull().default("09:00"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolDayUniqueIdx: uniqueIndex("school_day_schedules_school_day_uidx").on(table.schoolId, table.dayOfWeek),
  schoolIdx: index("school_day_schedules_school_idx").on(table.schoolId),
  dayCheck: check("school_day_schedules_day_chk", sql`${table.dayOfWeek} BETWEEN 0 AND 6`),
}));

export type SchoolDaySchedule = typeof schoolDaySchedules.$inferSelect;

// Date-specific exceptions to the weekly school-day pattern. These are used for
// holidays, exceptional closures, make-up school days and other academic-calendar
// changes without mutating the recurring weekly timetable.
export const schoolDayOverrides = pgTable("school_day_overrides", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  calendarEventId: integer("calendar_event_id").references(() => calendarEvents.id),
  overrideDate: date("override_date").notNull(),
  isSchoolDay: boolean("is_school_day").notNull(),
  reason: text("reason").notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolDateUniqueIdx: uniqueIndex("school_day_overrides_school_date_uidx").on(table.schoolId, table.overrideDate),
  schoolDateIdx: index("school_day_overrides_school_date_idx").on(table.schoolId, table.overrideDate),
  calendarEventIdx: index("school_day_overrides_calendar_event_idx").on(table.calendarEventId),
}));

export type SchoolDayOverride = typeof schoolDayOverrides.$inferSelect;

// Student Payments CSV import review/snapshots. This deliberately does not alter fees_payments.
export const feesImportBatches = pgTable("fees_import_batches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  fileName: text("file_name"),
  source: text("source").notNull().default("student_payments_csv"),
  termTotalFee: decimal("term_total_fee", { precision: 10, scale: 2 }).notNull().default("0"),
  termMaxBalance: decimal("term_max_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("preview"),
  totalRows: integer("total_rows").notNull().default(0),
  matchedRows: integer("matched_rows").notNull().default(0),
  customerCodeMatches: integer("customer_code_matches").notNull().default(0),
  exactNameMatches: integer("exact_name_matches").notNull().default(0),
  fuzzyNameMatches: integer("fuzzy_name_matches").notNull().default(0),
  unmatchedRows: integer("unmatched_rows").notNull().default(0),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id),
  previewedAt: timestamp("previewed_at").defaultNow(),
  committedAt: timestamp("committed_at"),
});

export const feesImportItems = pgTable("fees_import_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  batchId: integer("batch_id").references(() => feesImportBatches.id).notNull(),
  rowNumber: integer("row_number").notNull(),
  csvCustomerCode: text("csv_customer_code"),
  csvName: text("csv_name").notNull(),
  csvGroup: text("csv_group"),
  csvArea: text("csv_area"),
  balanceDue: decimal("balance_due", { precision: 10, scale: 2 }).notNull().default("0"),
  matchedStudentId: integer("matched_student_id").references(() => students.id),
  matchedAdmissionNo: text("matched_admission_no"),
  matchedStudentName: text("matched_student_name"),
  matchMethod: text("match_method").notNull(),
  calculatedStatus: text("calculated_status"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  batchRowUniqueIdx: uniqueIndex("fees_import_items_batch_row_uidx").on(table.batchId, table.rowNumber),
}));

export type FeesImportBatch = typeof feesImportBatches.$inferSelect;
export type FeesImportItem = typeof feesImportItems.$inferSelect;

// Access Control / Gate integration
export const gateBridges = pgTable("gate_bridges", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  name: text("name").notNull(),
  bridgeKeyHash: text("bridge_key_hash").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  configurationRevision: integer("configuration_revision").default(1).notNull(),
  lastSyncedRevision: integer("last_synced_revision"),
  lastConfigSyncAt: timestamp("last_config_sync_at"),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  lastIpAddress: text("last_ip_address"),
  softwareVersion: text("software_version"),
  lastError: text("last_error"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolIdx: index("gate_bridges_school_idx").on(table.schoolId),
  schoolNameUniqueIdx: uniqueIndex("gate_bridges_school_name_uidx").on(table.schoolId, table.name),
}));

export const accessGates = pgTable("access_gates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  bridgeId: integer("bridge_id").references(() => gateBridges.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  gateTemplate: text("gate_template").notNull().default("standard_4_lane"),
  expectedTerminalCount: integer("expected_terminal_count").notNull().default(4),
  isActive: boolean("is_active").default(true).notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolIdx: index("access_gates_school_idx").on(table.schoolId),
  bridgeIdx: index("access_gates_bridge_idx").on(table.bridgeId),
  schoolNameUniqueIdx: uniqueIndex("access_gates_school_name_uidx").on(table.schoolId, table.name),
}));

export const gateDevices = pgTable("gate_devices", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  bridgeId: integer("bridge_id").references(() => gateBridges.id).notNull(),
  gateId: integer("gate_id").references(() => accessGates.id),
  deviceKey: text("device_key").notNull().unique(),
  name: text("name").notNull(),
  lanePosition: text("lane_position"),
  location: text("location"),
  direction: text("direction").notNull().default("entry"),
  protocol: text("protocol").notNull().default("http"),
  localAddress: text("local_address"),
  localPort: integer("local_port").notNull().default(9090),
  deviceSn: text("device_sn"),
  macAddress: text("mac_address"),
  isActive: boolean("is_active").default(true).notNull(),
  lastSeenAt: timestamp("last_seen_at"),
  lastConnectionStatus: text("last_connection_status").notNull().default("never_seen"),
  lastVersionInfo: jsonb("last_version_info"),
  lastError: text("last_error"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  bridgeIdx: index("gate_devices_bridge_idx").on(table.bridgeId),
  gateIdx: index("gate_devices_gate_idx").on(table.gateId),
  schoolIdx: index("gate_devices_school_idx").on(table.schoolId),
  gateLaneUniqueIdx: uniqueIndex("gate_devices_gate_lane_uidx").on(table.gateId, table.lanePosition),
}));

export const gateCommands = pgTable("gate_commands", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  bridgeId: integer("bridge_id").references(() => gateBridges.id).notNull(),
  deviceId: integer("device_id").references(() => gateDevices.id).notNull(),
  commandType: text("command_type").notNull(),
  status: text("status").notNull().default("pending"),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id),
  requestReason: text("request_reason"),
  payload: jsonb("payload"),
  result: jsonb("result"),
  errorMessage: text("error_message"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  claimedAt: timestamp("claimed_at"),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  bridgeStatusIdx: index("gate_commands_bridge_status_idx").on(table.bridgeId, table.status, table.requestedAt),
  deviceIdx: index("gate_commands_device_idx").on(table.deviceId, table.requestedAt),
}));

export const gateLogs = pgTable("gate_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  bridgeId: integer("bridge_id").references(() => gateBridges.id),
  gateId: integer("gate_id").references(() => accessGates.id),
  deviceId: integer("device_id").references(() => gateDevices.id),
  severity: text("severity").notNull().default("info"),
  sourceType: text("source_type").notNull().default("system"),
  eventType: text("event_type").notNull(),
  message: text("message").notNull(),
  details: jsonb("details"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
}, (table) => ({
  schoolOccurredIdx: index("gate_logs_school_occurred_idx").on(table.schoolId, table.occurredAt),
  bridgeIdx: index("gate_logs_bridge_idx").on(table.bridgeId),
  gateIdx: index("gate_logs_gate_idx").on(table.gateId),
  deviceIdx: index("gate_logs_device_idx").on(table.deviceId),
}));

export const accessIdentities = pgTable("access_identities", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  personType: text("person_type").notNull(), // student | staff
  studentId: integer("student_id").references(() => students.id),
  staffId: integer("staff_id").references(() => staff.id),
  identityNo: text("identity_no").notNull(), // admissionNo / staffNo
  displayName: text("display_name").notNull(),
  photoPath: text("photo_path"),
  isActive: boolean("is_active").notNull().default(true),
  enrollmentRemovedAt: timestamp("enrollment_removed_at"),
  enrollmentRemovalReason: text("enrollment_removal_reason"),
  enrollmentRemovedByUserId: integer("enrollment_removed_by_user_id").references(() => users.id),
  manualRestrictionActive: boolean("manual_restriction_active").notNull().default(false),
  manualRestrictionReason: text("manual_restriction_reason"),
  manualRestrictedByUserId: integer("manual_restricted_by_user_id").references(() => users.id),
  manualRestrictedAt: timestamp("manual_restricted_at"),
  desiredEntryAccess: text("desired_entry_access").notNull().default("allow"),
  lastPolicyReason: text("last_policy_reason"),
  lastPolicyEvaluatedAt: timestamp("last_policy_evaluated_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  identityNoUniqueIdx: uniqueIndex("access_identities_identity_no_uidx").on(table.identityNo),
  studentUniqueIdx: uniqueIndex("access_identities_student_uidx").on(table.studentId).where(sql`${table.studentId} IS NOT NULL`),
  staffUniqueIdx: uniqueIndex("access_identities_staff_uidx").on(table.staffId).where(sql`${table.staffId} IS NOT NULL`),
  schoolIdx: index("access_identities_school_idx").on(table.schoolId),
}));

export const gateIdentitySync = pgTable("gate_identity_sync", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  identityId: integer("identity_id").references(() => accessIdentities.id).notNull(),
  deviceId: integer("device_id").references(() => gateDevices.id).notNull(),
  desiredListType: text("desired_list_type").notNull().default("white"),
  desiredEnabled: boolean("desired_enabled").notNull().default(true),
  desiredTimeGroup: integer("desired_time_group").notNull().default(0),
  terminalReportedIdentityNo: text("terminal_reported_identity_no"),
  syncStatus: text("sync_status").notNull().default("pending"),
  lastCommandId: integer("last_command_id").references(() => gateCommands.id),
  lastSyncedAt: timestamp("last_synced_at"),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  identityDeviceUniqueIdx: uniqueIndex("gate_identity_sync_identity_device_uidx").on(table.identityId, table.deviceId),
  deviceStatusIdx: index("gate_identity_sync_device_status_idx").on(table.deviceId, table.syncStatus),
  deviceTerminalIdentityIdx: index("gate_identity_sync_device_terminal_identity_idx").on(table.deviceId, table.terminalReportedIdentityNo),
}));

export const financialAccessOverrides = pgTable("financial_access_overrides", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  academicYear: text("academic_year").notNull(),
  term: text("term").notNull(),
  reason: text("reason").notNull(),
  effectiveFrom: timestamp("effective_from").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  status: text("status").notNull().default("scheduled"), // scheduled | active | expired | revoked | blocked
  activatedAt: timestamp("activated_at"),
  grantedByUserId: integer("granted_by_user_id").references(() => users.id).notNull(),
  revokedByUserId: integer("revoked_by_user_id").references(() => users.id),
  revokedAt: timestamp("revoked_at"),
  revocationReason: text("revocation_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  studentTermIdx: index("financial_access_overrides_student_term_idx").on(table.studentId, table.academicYear, table.term),
  schoolStatusIdx: index("financial_access_overrides_school_status_idx").on(table.schoolId, table.status, table.effectiveFrom),
}));

export const studentEarlyReleaseAuthorizations = pgTable("student_early_release_authorizations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  releaseType: text("release_type").notNull().default("early_dismissal"), // early_dismissal | temporary_off_campus
  validFrom: timestamp("valid_from").notNull(),
  validUntil: timestamp("valid_until").notNull(),
  returnExpected: boolean("return_expected").notNull().default(false),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("scheduled"), // scheduled | active | expired | revoked
  approvedByUserId: integer("approved_by_user_id").references(() => users.id).notNull(),
  revokedByUserId: integer("revoked_by_user_id").references(() => users.id),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  studentTimeIdx: index("student_early_release_student_time_idx").on(table.studentId, table.validFrom, table.validUntil),
  schoolStatusIdx: index("student_early_release_school_status_idx").on(table.schoolId, table.status, table.validFrom),
}));

export const staffEarlyDepartureApprovals = pgTable("staff_early_departure_approvals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  staffId: integer("staff_id").references(() => staff.id).notNull(),
  attendanceDate: date("attendance_date").notNull(),
  allowedFrom: timestamp("allowed_from").notNull(),
  validUntil: timestamp("valid_until"),
  returnExpected: boolean("return_expected").notNull().default(false),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("active"),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id).notNull(),
  revokedByUserId: integer("revoked_by_user_id").references(() => users.id),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  staffDateIdx: index("staff_early_departure_staff_date_idx").on(table.staffId, table.attendanceDate),
}));

export const accessEvents = pgTable("access_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  bridgeId: integer("bridge_id").references(() => gateBridges.id).notNull(),
  gateId: integer("gate_id").references(() => accessGates.id),
  deviceId: integer("device_id").references(() => gateDevices.id).notNull(),
  identityId: integer("identity_id").references(() => accessIdentities.id),
  eventUuid: text("event_uuid").notNull(),
  terminalIdentityNo: text("terminal_identity_no"),
  identityNo: text("identity_no"),
  identityMappingSource: text("identity_mapping_source"),
  personType: text("person_type"),
  studentId: integer("student_id").references(() => students.id),
  staffId: integer("staff_id").references(() => staff.id),
  direction: text("direction").notNull(),
  recognized: boolean("recognized").notNull().default(false),
  accessDecision: text("access_decision").notNull().default("unknown"),
  decisionReason: text("decision_reason"),
  financialStatus: text("financial_status"),
  financialSource: text("financial_source"),
  financialSnapshotAt: timestamp("financial_snapshot_at"),
  financialImportBatchId: integer("financial_import_batch_id"),
  overrideId: integer("override_id").references(() => financialAccessOverrides.id),
  attendanceRecordId: integer("attendance_record_id").references(() => attendanceRecords.id),
  staffAttendanceLogId: integer("staff_attendance_log_id").references(() => staffAttendanceLogs.id),
  attendanceEffect: text("attendance_effect"),
  occurredAt: timestamp("occurred_at").notNull(),
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  deviceEventUniqueIdx: uniqueIndex("access_events_device_uuid_uidx").on(table.deviceId, table.eventUuid),
  schoolOccurredIdx: index("access_events_school_occurred_idx").on(table.schoolId, table.occurredAt),
  studentOccurredIdx: index("access_events_student_occurred_idx").on(table.studentId, table.occurredAt),
  staffOccurredIdx: index("access_events_staff_occurred_idx").on(table.staffId, table.occurredAt),
}));

export const attendanceMessageTemplates = pgTable("attendance_message_templates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  templateKey: text("template_key").notNull(),
  smsTemplate: text("sms_template").notNull(),
  emailSubjectTemplate: text("email_subject_template"),
  emailBodyTemplate: text("email_body_template"),
  isDefaultCustomized: boolean("is_default_customized").notNull().default(false),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolTemplateUniqueIdx: uniqueIndex("attendance_message_templates_school_key_uidx").on(table.schoolId, table.templateKey),
}));

// Immutable audit trail for every attendance-template change or default restore.
// The live template remains in attendance_message_templates; this table records
// the exact previous/new content and the actor for later review.
export const attendanceMessageTemplateVersions = pgTable("attendance_message_template_versions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  templateId: integer("template_id").references(() => attendanceMessageTemplates.id).notNull(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  templateKey: text("template_key").notNull(),
  action: text("action").notNull().default("updated"), // updated | restored_default
  previousSmsTemplate: text("previous_sms_template").notNull(),
  previousEmailSubjectTemplate: text("previous_email_subject_template"),
  previousEmailBodyTemplate: text("previous_email_body_template"),
  newSmsTemplate: text("new_sms_template").notNull(),
  newEmailSubjectTemplate: text("new_email_subject_template"),
  newEmailBodyTemplate: text("new_email_body_template"),
  changedByUserId: integer("changed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  templateHistoryIdx: index("attendance_message_template_versions_template_idx").on(table.templateId, table.createdAt),
  schoolHistoryIdx: index("attendance_message_template_versions_school_idx").on(table.schoolId, table.createdAt),
}));

export type AccessIdentity = typeof accessIdentities.$inferSelect;
export type GateIdentitySync = typeof gateIdentitySync.$inferSelect;
export type FinancialAccessOverride = typeof financialAccessOverrides.$inferSelect;
export type StudentEarlyReleaseAuthorization = typeof studentEarlyReleaseAuthorizations.$inferSelect;
export type StaffEarlyDepartureApproval = typeof staffEarlyDepartureApprovals.$inferSelect;
export type AccessEvent = typeof accessEvents.$inferSelect;
export type AttendanceMessageTemplate = typeof attendanceMessageTemplates.$inferSelect;
export type AttendanceMessageTemplateVersion = typeof attendanceMessageTemplateVersions.$inferSelect;

// Organisation-owned attendance notification templates. These are the source of
// truth for every school in an organisation; school-specific template tables are
// retained only for backwards compatibility with earlier test builds.
export const organizationAttendanceMessageTemplates = pgTable("organization_attendance_message_templates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  templateKey: text("template_key").notNull(),
  smsTemplate: text("sms_template").notNull(),
  emailSubjectTemplate: text("email_subject_template"),
  emailBodyTemplate: text("email_body_template"),
  isDefaultCustomized: boolean("is_default_customized").notNull().default(false),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  organizationTemplateUniqueIdx: uniqueIndex("organization_attendance_message_templates_org_key_uidx").on(table.organizationId, table.templateKey),
}));

export const organizationAttendanceMessageTemplateVersions = pgTable("organization_attendance_message_template_versions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  templateId: integer("template_id").references(() => organizationAttendanceMessageTemplates.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  templateKey: text("template_key").notNull(),
  action: text("action").notNull().default("updated"),
  previousSmsTemplate: text("previous_sms_template").notNull(),
  previousEmailSubjectTemplate: text("previous_email_subject_template"),
  previousEmailBodyTemplate: text("previous_email_body_template"),
  newSmsTemplate: text("new_sms_template").notNull(),
  newEmailSubjectTemplate: text("new_email_subject_template"),
  newEmailBodyTemplate: text("new_email_body_template"),
  changedByUserId: integer("changed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  templateHistoryIdx: index("organization_attendance_message_versions_template_idx").on(table.templateId, table.createdAt),
  organizationHistoryIdx: index("organization_attendance_message_versions_org_idx").on(table.organizationId, table.createdAt),
}));

export type OrganizationAttendanceMessageTemplate = typeof organizationAttendanceMessageTemplates.$inferSelect;
export type OrganizationAttendanceMessageTemplateVersion = typeof organizationAttendanceMessageTemplateVersions.$inferSelect;

export type GateBridge = typeof gateBridges.$inferSelect;
export type AccessGate = typeof accessGates.$inferSelect;
export type GateDevice = typeof gateDevices.$inferSelect;
export type GateCommand = typeof gateCommands.$inferSelect;
export type GateLog = typeof gateLogs.$inferSelect;

export const insertActivityLogSchema = omitInsertFields(createInsertSchema(activityLogs), { id: true, createdAt: true });
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

export const insertQcReportSchema = omitInsertFields(createInsertSchema(qcReports), { id: true, createdAt: true, updatedAt: true });
export type InsertQcReport = z.infer<typeof insertQcReportSchema>;
export type QcReport = typeof qcReports.$inferSelect;

export const qcRecords = pgTable("qc_records", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  subjectId: integer("subject_id").references(() => subjects.id).notNull(),
  academicYear: text("academic_year").notNull(),
  term: text("term").notNull(),
  recordDate: date("record_date").notNull(),
  descriptionComment: text("description_comment").notNull(),
  actionTaken: text("action_taken"),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertQcRecordSchema = omitInsertFields(createInsertSchema(qcRecords), { id: true, createdAt: true, updatedAt: true });
export type InsertQcRecord = z.infer<typeof insertQcRecordSchema>;
export type QcRecord = typeof qcRecords.$inferSelect;

export const ecdRatingEnum = pgEnum("ecd_rating", ["YES", "NO", "ALMOST"]);

export const ecdAssessmentDomains = pgTable("ecd_assessment_domains", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
});

export const ecdAssessmentItems = pgTable("ecd_assessment_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  domainId: integer("domain_id").references(() => ecdAssessmentDomains.id).notNull(),
  itemText: text("item_text").notNull(),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
});

export const ecdAssessmentRecords = pgTable("ecd_assessment_records", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  studentId: integer("student_id").references(() => students.id).notNull(),
  classId: integer("class_id").references(() => classes.id).notNull(),
  streamId: integer("stream_id").references(() => streams.id),
  examId: integer("exam_id").references(() => exams.id).notNull(),
  status: text("status").default("draft"),
  publishedAt: timestamp("published_at"),
  updatedBy: integer("updated_by").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  studentExamUnique: uniqueIndex("ecd_assessment_records_student_exam_uidx").on(table.studentId, table.examId),
}));

export const ecdAssessmentResponses = pgTable("ecd_assessment_responses", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  recordId: integer("record_id").references(() => ecdAssessmentRecords.id).notNull(),
  itemId: integer("item_id").references(() => ecdAssessmentItems.id).notNull(),
  rating: ecdRatingEnum("rating"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  recordItemUnique: uniqueIndex("ecd_assessment_responses_record_item_uidx").on(table.recordId, table.itemId),
}));

export const reportCommentTypeEnum = pgEnum("report_comment_type", ["principal", "class_teacher"]);

export const reportComments = pgTable("report_comments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  schoolId: integer("school_id").references(() => schools.id).notNull(),
  gradeId: integer("grade_id").references(() => grades.id),
  commentGrade: text("comment_grade").notNull(),
  gradeLevel: gradeLevelEnum("grade_level"),
  subjectId: integer("subject_id").references(() => subjects.id),
  classId: integer("class_id").references(() => classes.id),
  commentText: text("comment_text").notNull(),
  commentType: reportCommentTypeEnum("comment_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  principalPoolUnique: uniqueIndex("report_comments_principal_pool_uidx")
    .on(table.schoolId, table.gradeId)
    .where(sql`${table.commentType} = 'principal' AND ${table.gradeId} IS NOT NULL AND ${table.classId} IS NULL AND ${table.commentGrade} NOT LIKE '__REPORT_CARD_OVERRIDE__:%'`),
  classTeacherPoolUnique: uniqueIndex("report_comments_class_teacher_pool_uidx")
    .on(table.schoolId, table.classId, table.gradeId)
    .where(sql`${table.commentType} = 'class_teacher' AND ${table.gradeId} IS NOT NULL AND ${table.classId} IS NOT NULL AND ${table.commentGrade} NOT LIKE '__REPORT_CARD_OVERRIDE__:%'`),
  principalLegacyPoolUnique: uniqueIndex("report_comments_principal_legacy_pool_uidx")
    .on(table.schoolId, table.commentGrade, table.gradeLevel)
    .where(sql`${table.commentType} = 'principal' AND ${table.gradeId} IS NULL AND ${table.classId} IS NULL AND ${table.gradeLevel} IS NOT NULL AND ${table.commentGrade} NOT LIKE '__REPORT_CARD_OVERRIDE__:%'`),
  principalLegacyPoolNullGradeLevelUnique: uniqueIndex("report_comments_principal_legacy_pool_null_grade_level_uidx")
    .on(table.schoolId, table.commentGrade)
    .where(sql`${table.commentType} = 'principal' AND ${table.gradeId} IS NULL AND ${table.classId} IS NULL AND ${table.gradeLevel} IS NULL AND ${table.commentGrade} NOT LIKE '__REPORT_CARD_OVERRIDE__:%'`),
  classTeacherLegacyPoolUnique: uniqueIndex("report_comments_class_teacher_legacy_pool_uidx")
    .on(table.schoolId, table.classId, table.commentGrade, table.gradeLevel)
    .where(sql`${table.commentType} = 'class_teacher' AND ${table.gradeId} IS NULL AND ${table.classId} IS NOT NULL AND ${table.gradeLevel} IS NOT NULL AND ${table.commentGrade} NOT LIKE '__REPORT_CARD_OVERRIDE__:%'`),
  classTeacherLegacyPoolNullGradeLevelUnique: uniqueIndex("report_comments_class_teacher_legacy_pool_null_grade_level_uidx")
    .on(table.schoolId, table.classId, table.commentGrade)
    .where(sql`${table.commentType} = 'class_teacher' AND ${table.gradeId} IS NULL AND ${table.classId} IS NOT NULL AND ${table.gradeLevel} IS NULL AND ${table.commentGrade} NOT LIKE '__REPORT_CARD_OVERRIDE__:%'`),
  reportCardOverrideUnique: uniqueIndex("report_comments_override_uidx")
    .on(table.schoolId, table.commentType, table.commentGrade)
    .where(sql`${table.commentGrade} LIKE '__REPORT_CARD_OVERRIDE__:%'`),
}));

export const insertReportCommentSchema = omitInsertFields(createInsertSchema(reportComments), { id: true, createdAt: true });
export type InsertReportComment = z.infer<typeof insertReportCommentSchema>;
export type ReportComment = typeof reportComments.$inferSelect;

export const insertEcdAssessmentDomainSchema = omitInsertFields(createInsertSchema(ecdAssessmentDomains), { id: true });
export const insertEcdAssessmentItemSchema = omitInsertFields(createInsertSchema(ecdAssessmentItems), { id: true });
export const insertEcdAssessmentRecordSchema = omitInsertFields(createInsertSchema(ecdAssessmentRecords), { id: true, createdAt: true, updatedAt: true, publishedAt: true });
export const insertEcdAssessmentResponseSchema = omitInsertFields(createInsertSchema(ecdAssessmentResponses), { id: true, createdAt: true, updatedAt: true });
export type InsertEcdAssessmentDomain = z.infer<typeof insertEcdAssessmentDomainSchema>;
export type EcdAssessmentDomain = typeof ecdAssessmentDomains.$inferSelect;
export type InsertEcdAssessmentItem = z.infer<typeof insertEcdAssessmentItemSchema>;
export type EcdAssessmentItem = typeof ecdAssessmentItems.$inferSelect;
export type InsertEcdAssessmentRecord = z.infer<typeof insertEcdAssessmentRecordSchema>;
export type EcdAssessmentRecord = typeof ecdAssessmentRecords.$inferSelect;
export type InsertEcdAssessmentResponse = z.infer<typeof insertEcdAssessmentResponseSchema>;
export type EcdAssessmentResponse = typeof ecdAssessmentResponses.$inferSelect;

export const insertAssessmentTypeSchema = omitInsertFields(createInsertSchema(assessmentTypes), { id: true, createdAt: true });
export const insertExamTypeSchema = omitInsertFields(createInsertSchema(examTypes), { id: true, createdAt: true });
export const insertExamSchema = omitInsertFields(createInsertSchema(exams), { id: true, createdAt: true });
export const insertAssessmentPublicationSchema = omitInsertFields(createInsertSchema(assessmentPublications), { id: true, createdAt: true, updatedAt: true });
export const insertAssessmentPublicationEventSchema = omitInsertFields(createInsertSchema(assessmentPublicationEvents), { id: true, createdAt: true });
export const insertAssessmentPaperSchema = omitInsertFields(createInsertSchema(assessmentPapers), { id: true });
export const insertAssessmentCommentSchema = omitInsertFields(createInsertSchema(assessmentComments), { id: true, createdAt: true });
export const insertAssessmentMarkSchema = omitInsertFields(createInsertSchema(assessmentMarks), { id: true, markedAt: true });
export const insertAssessmentMarkPaperSchema = omitInsertFields(createInsertSchema(assessmentMarkPapers), { id: true });

export type InsertAssessmentType = z.infer<typeof insertAssessmentTypeSchema>;
export type AssessmentType = typeof assessmentTypes.$inferSelect;
export type InsertExamType = z.infer<typeof insertExamTypeSchema>;
export type ExamType = typeof examTypes.$inferSelect;
export type InsertExam = z.infer<typeof insertExamSchema>;
export type Exam = typeof exams.$inferSelect;
export type InsertAssessmentPublication = z.infer<typeof insertAssessmentPublicationSchema>;
export type AssessmentPublication = typeof assessmentPublications.$inferSelect;
export type InsertAssessmentPublicationEvent = z.infer<typeof insertAssessmentPublicationEventSchema>;
export type AssessmentPublicationEvent = typeof assessmentPublicationEvents.$inferSelect;
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
  accessGroupId: integer("access_group_id"),
  isSystemDefault: boolean("is_system_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertStaffRoleSchema = omitInsertFields(createInsertSchema(staffRoles), { id: true, createdAt: true });
export type InsertStaffRole = z.infer<typeof insertStaffRoleSchema>;
export type StaffRole = typeof staffRoles.$inferSelect;

// Assets & Inventory
export const assetCentres = pgTable("asset_centres", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreType: text("centre_type").notNull().default("school"), // hq | school | warehouse | workshop | other
  name: text("name").notNull(),
  code: text("code").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgCodeUnique: uniqueIndex("asset_centres_org_code_uq").on(table.organizationId, table.code),
  schoolUnique: uniqueIndex("asset_centres_school_uq").on(table.schoolId),
  orgIdx: index("asset_centres_org_idx").on(table.organizationId, table.isActive),
}));

export const assetInventorySettings = pgTable("asset_inventory_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  currency: text("currency").notNull().default("USD"),
  purchaseRequestApprovalThreshold: decimal("purchase_request_approval_threshold", { precision: 14, scale: 2 }).notNull().default("100"),
  purchaseOrderHqThreshold: decimal("purchase_order_hq_threshold", { precision: 14, scale: 2 }).notNull().default("1000"),
  lowStockNotificationsEnabled: boolean("low_stock_notifications_enabled").notNull().default(true),
  defaultSupplierLeadTimeDays: integer("default_supplier_lead_time_days").notNull().default(7),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  organizationUnique: uniqueIndex("asset_inventory_settings_org_uq").on(table.organizationId),
}));

export const assetInventoryCategories = pgTable("asset_inventory_categories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").references(() => assetCentres.id),
  kind: text("kind").notNull(), // asset | inventory
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  scopeNameUnique: uniqueIndex("asset_inventory_categories_scope_name_uq").on(table.organizationId, table.schoolId, table.kind, table.name),
  centreNameIdx: index("asset_inventory_categories_centre_idx").on(table.centreId, table.kind, table.name),
}));

export const assetInventoryLocations = pgTable("asset_inventory_locations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").references(() => assetCentres.id),
  name: text("name").notNull(),
  code: text("code"),
  locationType: text("location_type").notNull().default("general"),
  description: text("description"),
  isStore: boolean("is_store").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolNameUnique: uniqueIndex("asset_inventory_locations_school_name_uq").on(table.schoolId, table.name),
  centreNameIdx: index("asset_inventory_locations_centre_idx").on(table.centreId, table.name),
}));

export const inventorySuppliers = pgTable("inventory_suppliers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  registrationNumber: text("registration_number"),
  taxNumber: text("tax_number"),
  goodsServices: text("goods_services"),
  paymentTerms: text("payment_terms"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgNameUnique: uniqueIndex("inventory_suppliers_org_name_uq").on(table.organizationId, table.name),
}));

export const assetRegister = pgTable("asset_register", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  owningCentreId: integer("owning_centre_id").references(() => assetCentres.id),
  currentCentreId: integer("current_centre_id").references(() => assetCentres.id),
  assetNumber: text("asset_number").notNull(),
  assetClass: text("asset_class").notNull().default("general"), // vehicle assets are the identity source for Fleet Management
  name: text("name").notNull(),
  categoryId: integer("category_id").references(() => assetInventoryCategories.id),
  locationId: integer("location_id").references(() => assetInventoryLocations.id),
  supplierId: integer("supplier_id").references(() => inventorySuppliers.id),
  serialNumber: text("serial_number"),
  description: text("description"),
  acquisitionDate: date("acquisition_date"),
  acquisitionCost: decimal("acquisition_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  currentValue: decimal("current_value", { precision: 14, scale: 2 }).notNull().default("0"),
  condition: text("condition").notNull().default("good"),
  status: text("status").notNull().default("available"),
  warrantyExpiry: date("warranty_expiry"),
  supplier: text("supplier"),
  procurementReference: text("procurement_reference"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolAssetNumberUnique: uniqueIndex("asset_register_school_number_uq").on(table.schoolId, table.assetNumber),
  centreAssetNumberUnique: uniqueIndex("asset_register_centre_number_uq").on(table.currentCentreId, table.assetNumber),
  schoolIdx: index("asset_register_school_idx").on(table.schoolId),
  centreIdx: index("asset_register_centre_idx").on(table.currentCentreId, table.status),
}));

export const assetVehicleDetails = pgTable("asset_vehicle_details", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  assetId: integer("asset_id").notNull().references(() => assetRegister.id),
  registrationNumber: text("registration_number"),
  vin: text("vin"),
  engineNumber: text("engine_number"),
  make: text("make"),
  model: text("model"),
  manufactureYear: integer("manufacture_year"),
  colour: text("colour"),
  fuelType: text("fuel_type"),
  vehicleClass: text("vehicle_class"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  assetUnique: uniqueIndex("asset_vehicle_details_asset_uq").on(table.assetId),
  registrationIdx: index("asset_vehicle_details_registration_idx").on(table.registrationNumber),
}));

export const inventoryItems = pgTable("inventory_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").references(() => assetCentres.id),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  itemType: text("item_type").notNull().default("consumable"), // consumable | returnable | spare_part | resale
  categoryId: integer("category_id").references(() => assetInventoryCategories.id),
  defaultLocationId: integer("default_location_id").references(() => assetInventoryLocations.id),
  preferredSupplierId: integer("preferred_supplier_id").references(() => inventorySuppliers.id),
  unitOfMeasure: text("unit_of_measure").notNull().default("unit"),
  purchaseUnit: text("purchase_unit"),
  issueUnit: text("issue_unit"),
  unitConversionFactor: decimal("unit_conversion_factor", { precision: 14, scale: 4 }).notNull().default("1"),
  quantityOnHand: decimal("quantity_on_hand", { precision: 14, scale: 3 }).notNull().default("0"),
  reorderEnabled: boolean("reorder_enabled").notNull().default(true),
  reorderLevel: decimal("reorder_level", { precision: 14, scale: 3 }).notNull().default("0"),
  criticalStockLevel: decimal("critical_stock_level", { precision: 14, scale: 3 }).notNull().default("0"),
  targetStockLevel: decimal("target_stock_level", { precision: 14, scale: 3 }).notNull().default("0"),
  preferredReorderQuantity: decimal("preferred_reorder_quantity", { precision: 14, scale: 3 }).notNull().default("0"),
  supplierLeadTimeDays: integer("supplier_lead_time_days").notNull().default(0),
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  batchTrackingEnabled: boolean("batch_tracking_enabled").notNull().default(false),
  expiryTrackingEnabled: boolean("expiry_tracking_enabled").notNull().default(false),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolSkuUnique: uniqueIndex("inventory_items_school_sku_uq").on(table.schoolId, table.sku),
  centreSkuUnique: uniqueIndex("inventory_items_centre_sku_uq").on(table.centreId, table.sku),
  schoolIdx: index("inventory_items_school_idx").on(table.schoolId),
  centreIdx: index("inventory_items_centre_idx").on(table.centreId, table.isActive),
}));

export const inventoryBatches = pgTable("inventory_batches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  itemId: integer("item_id").notNull().references(() => inventoryItems.id),
  centreId: integer("centre_id").references(() => assetCentres.id),
  locationId: integer("location_id").references(() => assetInventoryLocations.id),
  batchNumber: text("batch_number").notNull(),
  manufactureDate: date("manufacture_date"),
  expiryDate: date("expiry_date"),
  quantityOnHand: decimal("quantity_on_hand", { precision: 14, scale: 3 }).notNull().default("0"),
  supplierId: integer("supplier_id").references(() => inventorySuppliers.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  itemBatchUnique: uniqueIndex("inventory_batches_item_batch_uq").on(table.itemId, table.batchNumber, table.locationId),
  expiryIdx: index("inventory_batches_expiry_idx").on(table.expiryDate),
}));

export const inventoryMovements = pgTable("inventory_movements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").references(() => assetCentres.id),
  referenceNumber: text("reference_number").notNull(),
  itemId: integer("item_id").notNull().references(() => inventoryItems.id),
  batchId: integer("batch_id").references(() => inventoryBatches.id),
  movementType: text("movement_type").notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull(),
  quantityBefore: decimal("quantity_before", { precision: 14, scale: 3 }).notNull(),
  quantityAfter: decimal("quantity_after", { precision: 14, scale: 3 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  fromLocationId: integer("from_location_id").references(() => assetInventoryLocations.id),
  toLocationId: integer("to_location_id").references(() => assetInventoryLocations.id),
  recipientType: text("recipient_type"),
  recipientId: integer("recipient_id"),
  sourceDocumentType: text("source_document_type"),
  sourceDocumentId: integer("source_document_id"),
  reason: text("reason"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  schoolReferenceUnique: uniqueIndex("inventory_movements_school_reference_uq").on(table.schoolId, table.referenceNumber),
  centreReferenceUnique: uniqueIndex("inventory_movements_centre_reference_uq").on(table.centreId, table.referenceNumber),
  itemIdx: index("inventory_movements_item_idx").on(table.itemId, table.createdAt),
}));

export const inventoryReturnableIssues = pgTable("inventory_returnable_issues", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").notNull().references(() => assetCentres.id),
  referenceNumber: text("reference_number").notNull(),
  itemId: integer("item_id").notNull().references(() => inventoryItems.id),
  quantityIssued: decimal("quantity_issued", { precision: 14, scale: 3 }).notNull(),
  quantityReturned: decimal("quantity_returned", { precision: 14, scale: 3 }).notNull().default("0"),
  recipientType: text("recipient_type").notNull(),
  recipientId: integer("recipient_id"),
  recipientName: text("recipient_name").notNull(),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  expectedReturnDate: date("expected_return_date"),
  lastReturnedAt: timestamp("last_returned_at"),
  status: text("status").notNull().default("issued"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  centreReferenceUnique: uniqueIndex("inventory_returnable_issues_centre_reference_uq").on(table.centreId, table.referenceNumber),
  itemStatusIdx: index("inventory_returnable_issues_item_status_idx").on(table.itemId, table.status),
  dueDateIdx: index("inventory_returnable_issues_due_idx").on(table.expectedReturnDate, table.status),
}));

export const assetAssignments = pgTable("asset_assignments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").references(() => assetCentres.id),
  referenceNumber: text("reference_number").notNull(),
  assetId: integer("asset_id").notNull().references(() => assetRegister.id),
  assigneeType: text("assignee_type").notNull(),
  assigneeId: integer("assignee_id"),
  assigneeName: text("assignee_name").notNull(),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  expectedReturnDate: date("expected_return_date"),
  returnedAt: timestamp("returned_at"),
  conditionOut: text("condition_out").notNull().default("good"),
  conditionIn: text("condition_in"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  returnedByUserId: integer("returned_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolReferenceUnique: uniqueIndex("asset_assignments_school_reference_uq").on(table.schoolId, table.referenceNumber),
  centreReferenceUnique: uniqueIndex("asset_assignments_centre_reference_uq").on(table.centreId, table.referenceNumber),
  assetStatusIdx: index("asset_assignments_asset_status_idx").on(table.assetId, table.status),
}));

export const assetMaintenanceRecords = pgTable("asset_maintenance_records", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").references(() => assetCentres.id),
  referenceNumber: text("reference_number").notNull(),
  assetId: integer("asset_id").notNull().references(() => assetRegister.id),
  issueDescription: text("issue_description").notNull(),
  serviceProvider: text("service_provider"),
  status: text("status").notNull().default("reported"),
  dateReported: date("date_reported").notNull(),
  dateSent: date("date_sent"),
  dateReturned: date("date_returned"),
  estimatedCost: decimal("estimated_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  actualCost: decimal("actual_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  workCompleted: text("work_completed"),
  nextServiceDate: date("next_service_date"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const assetDamageCases = pgTable("asset_damage_cases", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").references(() => assetCentres.id),
  referenceNumber: text("reference_number").notNull(),
  assetId: integer("asset_id").references(() => assetRegister.id),
  inventoryItemId: integer("inventory_item_id").references(() => inventoryItems.id),
  incidentDate: date("incident_date").notNull(),
  incidentType: text("incident_type").notNull().default("breakage"),
  locationId: integer("location_id").references(() => assetInventoryLocations.id),
  description: text("description").notNull(),
  classification: text("classification").notNull().default("unconfirmed"),
  responsiblePartyType: text("responsible_party_type"),
  responsiblePartyId: integer("responsible_party_id"),
  responsiblePartyName: text("responsible_party_name"),
  findings: text("findings"),
  status: text("status").notNull().default("reported"),
  proposedCharge: decimal("proposed_charge", { precision: 14, scale: 2 }).notNull().default("0"),
  approvedCharge: decimal("approved_charge", { precision: 14, scale: 2 }).notNull().default("0"),
  amountRecovered: decimal("amount_recovered", { precision: 14, scale: 2 }).notNull().default("0"),
  approvalNotes: text("approval_notes"),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  schoolReferenceUnique: uniqueIndex("asset_damage_cases_school_reference_uq").on(table.schoolId, table.referenceNumber),
  centreReferenceUnique: uniqueIndex("asset_damage_cases_centre_reference_uq").on(table.centreId, table.referenceNumber),
}));

export const assetDamageRecoveries = pgTable("asset_damage_recoveries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  damageCaseId: integer("damage_case_id").notNull().references(() => assetDamageCases.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").references(() => assetCentres.id),
  referenceNumber: text("reference_number").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"),
  receiptNumber: text("receipt_number"),
  notes: text("notes"),
  receivedByUserId: integer("received_by_user_id").references(() => users.id),
  receivedAt: timestamp("received_at").defaultNow(),
});

export const inventoryStocktakes = pgTable("inventory_stocktakes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").references(() => assetCentres.id),
  referenceNumber: text("reference_number").notNull(),
  locationId: integer("location_id").references(() => assetInventoryLocations.id),
  status: text("status").notNull().default("draft"),
  countDate: date("count_date").notNull(),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const inventoryStocktakeLines = pgTable("inventory_stocktake_lines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  stocktakeId: integer("stocktake_id").notNull().references(() => inventoryStocktakes.id),
  itemId: integer("item_id").notNull().references(() => inventoryItems.id),
  expectedQuantity: decimal("expected_quantity", { precision: 14, scale: 3 }).notNull(),
  countedQuantity: decimal("counted_quantity", { precision: 14, scale: 3 }),
  varianceQuantity: decimal("variance_quantity", { precision: 14, scale: 3 }),
  notes: text("notes"),
}, (table) => ({
  stocktakeItemUnique: uniqueIndex("inventory_stocktake_lines_item_uq").on(table.stocktakeId, table.itemId),
}));

export const inventoryLowStockAlerts = pgTable("inventory_low_stock_alerts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").references(() => assetCentres.id),
  itemId: integer("item_id").notNull().references(() => inventoryItems.id),
  status: text("status").notNull().default("open"),
  severity: text("severity").notNull().default("low"),
  quantityAtTrigger: decimal("quantity_at_trigger", { precision: 14, scale: 3 }).notNull(),
  reorderLevel: decimal("reorder_level", { precision: 14, scale: 3 }).notNull(),
  suggestedQuantity: decimal("suggested_quantity", { precision: 14, scale: 3 }).notNull().default("0"),
  acknowledgedByUserId: integer("acknowledged_by_user_id").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  itemStatusUnique: uniqueIndex("inventory_low_stock_alert_item_status_uq").on(table.itemId, table.status),
  centreStatusIdx: index("inventory_low_stock_alert_centre_idx").on(table.centreId, table.status, table.severity),
}));

export const inventoryPurchaseRequests = pgTable("inventory_purchase_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").notNull().references(() => assetCentres.id),
  referenceNumber: text("reference_number").notNull(),
  department: text("department"),
  requiredDate: date("required_date"),
  justification: text("justification").notNull(),
  urgency: text("urgency").notNull().default("normal"),
  status: text("status").notNull().default("draft"),
  estimatedTotal: decimal("estimated_total", { precision: 14, scale: 2 }).notNull().default("0"),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  approvalNotes: text("approval_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  centreReferenceUnique: uniqueIndex("inventory_purchase_requests_centre_ref_uq").on(table.centreId, table.referenceNumber),
}));

export const inventoryPurchaseRequestLines = pgTable("inventory_purchase_request_lines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  requestId: integer("request_id").notNull().references(() => inventoryPurchaseRequests.id),
  itemId: integer("item_id").references(() => inventoryItems.id),
  itemName: text("item_name").notNull(),
  itemType: text("item_type").notNull().default("consumable"),
  quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull(),
  unitOfMeasure: text("unit_of_measure").notNull().default("unit"),
  estimatedUnitCost: decimal("estimated_unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  preferredSupplierId: integer("preferred_supplier_id").references(() => inventorySuppliers.id),
  notes: text("notes"),
});

export const inventoryPurchaseOrders = pgTable("inventory_purchase_orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").notNull().references(() => assetCentres.id),
  purchaseRequestId: integer("purchase_request_id").references(() => inventoryPurchaseRequests.id),
  supplierId: integer("supplier_id").notNull().references(() => inventorySuppliers.id),
  referenceNumber: text("reference_number").notNull(),
  status: text("status").notNull().default("draft"),
  expectedDeliveryDate: date("expected_delivery_date"),
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount: decimal("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  discountAmount: decimal("discount_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  terms: text("terms"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  centreReferenceUnique: uniqueIndex("inventory_purchase_orders_centre_ref_uq").on(table.centreId, table.referenceNumber),
}));

export const inventoryPurchaseOrderLines = pgTable("inventory_purchase_order_lines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => inventoryPurchaseOrders.id),
  requestLineId: integer("request_line_id").references(() => inventoryPurchaseRequestLines.id),
  itemId: integer("item_id").references(() => inventoryItems.id),
  itemName: text("item_name").notNull(),
  itemType: text("item_type").notNull().default("consumable"),
  orderedQuantity: decimal("ordered_quantity", { precision: 14, scale: 3 }).notNull(),
  receivedQuantity: decimal("received_quantity", { precision: 14, scale: 3 }).notNull().default("0"),
  unitOfMeasure: text("unit_of_measure").notNull().default("unit"),
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
});

export const inventoryGoodsReceipts = pgTable("inventory_goods_receipts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  centreId: integer("centre_id").notNull().references(() => assetCentres.id),
  purchaseOrderId: integer("purchase_order_id").references(() => inventoryPurchaseOrders.id),
  supplierId: integer("supplier_id").references(() => inventorySuppliers.id),
  referenceNumber: text("reference_number").notNull(),
  deliveryNoteNumber: text("delivery_note_number"),
  receivedDate: date("received_date").notNull(),
  status: text("status").notNull().default("posted"),
  inspectionNotes: text("inspection_notes"),
  receivedByUserId: integer("received_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  centreReferenceUnique: uniqueIndex("inventory_goods_receipts_centre_ref_uq").on(table.centreId, table.referenceNumber),
}));

export const inventoryGoodsReceiptLines = pgTable("inventory_goods_receipt_lines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  goodsReceiptId: integer("goods_receipt_id").notNull().references(() => inventoryGoodsReceipts.id),
  purchaseOrderLineId: integer("purchase_order_line_id").references(() => inventoryPurchaseOrderLines.id),
  itemId: integer("item_id").references(() => inventoryItems.id),
  itemName: text("item_name").notNull(),
  itemType: text("item_type").notNull().default("consumable"),
  quantityDelivered: decimal("quantity_delivered", { precision: 14, scale: 3 }).notNull(),
  quantityAccepted: decimal("quantity_accepted", { precision: 14, scale: 3 }).notNull(),
  quantityRejected: decimal("quantity_rejected", { precision: 14, scale: 3 }).notNull().default("0"),
  unitCost: decimal("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  batchNumber: text("batch_number"),
  expiryDate: date("expiry_date"),
  rejectionReason: text("rejection_reason"),
});

export const assetCentreTransfers = pgTable("asset_centre_transfers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  referenceNumber: text("reference_number").notNull(),
  sourceCentreId: integer("source_centre_id").notNull().references(() => assetCentres.id),
  destinationCentreId: integer("destination_centre_id").notNull().references(() => assetCentres.id),
  sourceLocationId: integer("source_location_id").references(() => assetInventoryLocations.id),
  destinationLocationId: integer("destination_location_id").references(() => assetInventoryLocations.id),
  status: text("status").notNull().default("draft"),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  dispatchedByUserId: integer("dispatched_by_user_id").references(() => users.id),
  receivedByUserId: integer("received_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  dispatchedAt: timestamp("dispatched_at"),
  receivedAt: timestamp("received_at"),
  transportDetails: text("transport_details"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgReferenceUnique: uniqueIndex("asset_centre_transfers_org_ref_uq").on(table.organizationId, table.referenceNumber),
  statusIdx: index("asset_centre_transfers_status_idx").on(table.organizationId, table.status),
}));

export const assetCentreTransferLines = pgTable("asset_centre_transfer_lines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  transferId: integer("transfer_id").notNull().references(() => assetCentreTransfers.id),
  lineType: text("line_type").notNull(), // asset | inventory
  assetId: integer("asset_id").references(() => assetRegister.id),
  itemId: integer("item_id").references(() => inventoryItems.id),
  destinationItemId: integer("destination_item_id").references(() => inventoryItems.id),
  quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull().default("1"),
  conditionDispatched: text("condition_dispatched"),
  conditionReceived: text("condition_received"),
  quantityReceived: decimal("quantity_received", { precision: 14, scale: 3 }),
  varianceNotes: text("variance_notes"),
  status: text("status").notNull().default("pending"),
});


// Fleet Management — operational extension of vehicle assets. Asset identity stays in asset_register/asset_vehicle_details.
export const fleetVehicleProfiles = pgTable("fleet_vehicle_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  baseSchoolId: integer("base_school_id").references(() => schools.id),
  assetId: integer("asset_id").notNull().references(() => assetRegister.id),
  transportVehicleId: integer("transport_vehicle_id").references(() => transportVehicles.id),
  capacity: integer("capacity").notNull().default(1),
  allocationType: text("allocation_type").notNull().default("pool"), // pool | staff | department | school | temporary | student_transport
  custodianStaffId: integer("custodian_staff_id").references(() => staff.id),
  primaryDriverStaffId: integer("primary_driver_staff_id").references(() => staff.id),
  currentOdometer: integer("current_odometer").notNull().default(0),
  status: text("status").notNull().default("available"),
  serviceIntervalKm: integer("service_interval_km").notNull().default(10000),
  serviceIntervalMonths: integer("service_interval_months").notNull().default(6),
  lastServiceDate: date("last_service_date"),
  lastServiceOdometer: integer("last_service_odometer"),
  nextServiceDate: date("next_service_date"),
  nextServiceOdometer: integer("next_service_odometer"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  assetUnique: uniqueIndex("fleet_vehicle_profiles_asset_uidx").on(table.assetId),
  transportUnique: uniqueIndex("fleet_vehicle_profiles_transport_uidx").on(table.transportVehicleId).where(sql`${table.transportVehicleId} is not null`),
  orgStatusIdx: index("fleet_vehicle_profiles_org_status_idx").on(table.organizationId, table.status),
}));

export const fleetVehicleOccupants = pgTable("fleet_vehicle_occupants", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  vehicleId: integer("vehicle_id").notNull().references(() => fleetVehicleProfiles.id),
  occupantType: text("occupant_type").notNull(), // student | staff | other
  studentId: integer("student_id").references(() => students.id),
  staffId: integer("staff_id").references(() => staff.id),
  occupantName: text("occupant_name"),
  routeId: integer("route_id").references(() => transportRoutes.id),
  routeName: text("route_name"),
  serviceType: text("service_type").notNull().default("both"), // both | pickup | dropoff
  sameLocation: boolean("same_location").notNull().default(true),
  pickupServicePointId: integer("pickup_service_point_id").references(() => transportServicePoints.id),
  dropoffServicePointId: integer("dropoff_service_point_id").references(() => transportServicePoints.id),
  pickupName: text("pickup_name").notNull(),
  pickupAddress: text("pickup_address"),
  pickupLandmark: text("pickup_landmark"),
  pickupLatitude: decimal("pickup_latitude", { precision: 10, scale: 7 }),
  pickupLongitude: decimal("pickup_longitude", { precision: 10, scale: 7 }),
  pickupPrivacyClass: text("pickup_privacy_class").notNull().default("private_household"),
  pickupInstructions: text("pickup_instructions"),
  dropoffName: text("dropoff_name"),
  dropoffAddress: text("dropoff_address"),
  dropoffLandmark: text("dropoff_landmark"),
  dropoffLatitude: decimal("dropoff_latitude", { precision: 10, scale: 7 }),
  dropoffLongitude: decimal("dropoff_longitude", { precision: 10, scale: 7 }),
  dropoffPrivacyClass: text("dropoff_privacy_class").notNull().default("private_household"),
  dropoffInstructions: text("dropoff_instructions"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  vehicleActiveIdx: index("fleet_vehicle_occupants_vehicle_active_idx").on(table.vehicleId, table.isActive),
  routeIdx: index("fleet_vehicle_occupants_route_idx").on(table.routeId),
  activeStudentUnique: uniqueIndex("fleet_vehicle_occupants_active_student_uidx").on(table.vehicleId, table.studentId).where(sql`${table.isActive} = true AND ${table.studentId} IS NOT NULL`),
  activeStaffUnique: uniqueIndex("fleet_vehicle_occupants_active_staff_uidx").on(table.vehicleId, table.staffId).where(sql`${table.isActive} = true AND ${table.staffId} IS NOT NULL`),
}));

export const fleetDriverProfiles = pgTable("fleet_driver_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  staffId: integer("staff_id").notNull().references(() => staff.id),
  licenceNumber: text("licence_number").notNull(),
  licenceClass: text("licence_class").notNull(),
  licenceExpiry: date("licence_expiry").notNull(),
  permittedVehicleClasses: jsonb("permitted_vehicle_classes").notNull().default(sql`'[]'::jsonb`),
  defensiveDrivingExpiry: date("defensive_driving_expiry"),
  status: text("status").notNull().default("active"),
  suspensionReason: text("suspension_reason"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ staffUnique: uniqueIndex("fleet_driver_profiles_staff_uidx").on(table.staffId) }));

export const fleetAllocations = pgTable("fleet_allocations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  vehicleId: integer("vehicle_id").notNull().references(() => fleetVehicleProfiles.id),
  allocationType: text("allocation_type").notNull(),
  allocatedToType: text("allocated_to_type").notNull(), // staff | school | department | student_transport
  allocatedToStaffId: integer("allocated_to_staff_id").references(() => staff.id),
  allocatedToSchoolId: integer("allocated_to_school_id").references(() => schools.id),
  allocatedToName: text("allocated_to_name"),
  primaryDriverStaffId: integer("primary_driver_staff_id").references(() => staff.id),
  startsAt: timestamp("starts_at").notNull().defaultNow(),
  endsAt: timestamp("ends_at"),
  odometerOut: integer("odometer_out"),
  odometerIn: integer("odometer_in"),
  conditionOut: text("condition_out").default("good"),
  conditionIn: text("condition_in"),
  status: text("status").notNull().default("active"),
  reason: text("reason"),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ vehicleStatusIdx: index("fleet_allocations_vehicle_status_idx").on(table.vehicleId, table.status) }));

export const fleetVehicleRequests = pgTable("fleet_vehicle_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  requesterStaffId: integer("requester_staff_id").notNull().references(() => staff.id),
  purpose: text("purpose").notNull(),
  destination: text("destination").notNull(),
  departureAt: timestamp("departure_at").notNull(),
  expectedReturnAt: timestamp("expected_return_at").notNull(),
  passengerCount: integer("passenger_count").notNull().default(1),
  vehicleRequirement: text("vehicle_requirement").notNull().default("any"),
  driverRequired: boolean("driver_required").notNull().default(true),
  specialRequirements: text("special_requirements"),
  status: text("status").notNull().default("submitted"),
  rejectionReason: text("rejection_reason"),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  emergencyOverride: boolean("emergency_override").notNull().default(false),
  emergencyReason: text("emergency_reason"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ orgStatusIdx: index("fleet_vehicle_requests_org_status_idx").on(table.organizationId, table.status) }));

export const fleetTrips = pgTable("fleet_trips", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  requestId: integer("request_id").references(() => fleetVehicleRequests.id),
  vehicleId: integer("vehicle_id").notNull().references(() => fleetVehicleProfiles.id),
  driverStaffId: integer("driver_staff_id").notNull().references(() => staff.id),
  purpose: text("purpose").notNull(),
  destination: text("destination").notNull(),
  plannedDepartureAt: timestamp("planned_departure_at"),
  expectedReturnAt: timestamp("expected_return_at"),
  actualDepartureAt: timestamp("actual_departure_at"),
  actualReturnAt: timestamp("actual_return_at"),
  startOdometer: integer("start_odometer"),
  endOdometer: integer("end_odometer"),
  distanceKm: integer("distance_km"),
  passengerCount: integer("passenger_count").notNull().default(1),
  status: text("status").notNull().default("allocated"),
  emergencyOverride: boolean("emergency_override").notNull().default(false),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ vehicleStatusIdx: index("fleet_trips_vehicle_status_idx").on(table.vehicleId, table.status), driverStatusIdx: index("fleet_trips_driver_status_idx").on(table.driverStaffId, table.status) }));

export const fleetOdometerReadings = pgTable("fleet_odometer_readings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  vehicleId: integer("vehicle_id").notNull().references(() => fleetVehicleProfiles.id),
  tripId: integer("trip_id").references(() => fleetTrips.id),
  readingKm: integer("reading_km").notNull(),
  readingType: text("reading_type").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  notes: text("notes"),
  recordedByUserId: integer("recorded_by_user_id").references(() => users.id),
});

export const fleetFuelTransactions = pgTable("fleet_fuel_transactions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  vehicleId: integer("vehicle_id").notNull().references(() => fleetVehicleProfiles.id),
  tripId: integer("trip_id").references(() => fleetTrips.id),
  driverStaffId: integer("driver_staff_id").references(() => staff.id),
  transactionDate: date("transaction_date").notNull(),
  odometerKm: integer("odometer_km").notNull(),
  fuelType: text("fuel_type").notNull(),
  litres: decimal("litres", { precision: 12, scale: 3 }).notNull(),
  pricePerLitre: decimal("price_per_litre", { precision: 12, scale: 4 }).notNull().default("0"),
  totalCost: decimal("total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  supplier: text("supplier"),
  paymentMethod: text("payment_method").notNull().default("organisation_account"),
  receiptReference: text("receipt_reference"),
  receiptUrl: text("receipt_url"),
  fullTank: boolean("full_tank").notNull().default(false),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const fleetInspections = pgTable("fleet_inspections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  vehicleId: integer("vehicle_id").notNull().references(() => fleetVehicleProfiles.id),
  tripId: integer("trip_id").references(() => fleetTrips.id),
  inspectorStaffId: integer("inspector_staff_id").references(() => staff.id),
  inspectionType: text("inspection_type").notNull(), // pre_trip | return | scheduled
  odometerKm: integer("odometer_km"),
  checklist: jsonb("checklist").notNull().default(sql`'{}'::jsonb`),
  result: text("result").notNull().default("pass"),
  defects: text("defects"),
  inspectedAt: timestamp("inspected_at").notNull().defaultNow(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
});

export const fleetMaintenanceJobs = pgTable("fleet_maintenance_jobs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  vehicleId: integer("vehicle_id").notNull().references(() => fleetVehicleProfiles.id),
  assetMaintenanceRecordId: integer("asset_maintenance_record_id").references(() => assetMaintenanceRecords.id),
  referenceNumber: text("reference_number").notNull(),
  jobType: text("job_type").notNull().default("repair"),
  issueDescription: text("issue_description").notNull(),
  odometerKm: integer("odometer_km"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("reported"),
  serviceProvider: text("service_provider"),
  estimatedCost: decimal("estimated_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  actualCost: decimal("actual_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  workCompleted: text("work_completed"),
  nextServiceDate: date("next_service_date"),
  nextServiceOdometer: integer("next_service_odometer"),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  releasedByUserId: integer("released_by_user_id").references(() => users.id),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ orgReferenceUnique: uniqueIndex("fleet_maintenance_jobs_org_ref_uidx").on(table.organizationId, table.referenceNumber) }));

export const fleetComplianceDocuments = pgTable("fleet_compliance_documents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  vehicleId: integer("vehicle_id").notNull().references(() => fleetVehicleProfiles.id),
  documentType: text("document_type").notNull(),
  documentNumber: text("document_number"),
  issueDate: date("issue_date"),
  expiryDate: date("expiry_date").notNull(),
  issuingAuthority: text("issuing_authority"),
  documentUrl: text("document_url"),
  verificationStatus: text("verification_status").notNull().default("unverified"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ vehicleTypeIdx: index("fleet_compliance_vehicle_type_idx").on(table.vehicleId, table.documentType) }));

export const fleetIncidents = pgTable("fleet_incidents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  vehicleId: integer("vehicle_id").notNull().references(() => fleetVehicleProfiles.id),
  tripId: integer("trip_id").references(() => fleetTrips.id),
  driverStaffId: integer("driver_staff_id").references(() => staff.id),
  incidentType: text("incident_type").notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  location: text("location"),
  description: text("description").notNull(),
  injuriesReported: boolean("injuries_reported").notNull().default(false),
  policeReportReference: text("police_report_reference"),
  insuranceClaimNumber: text("insurance_claim_number"),
  claimStatus: text("claim_status"),
  estimatedDamage: decimal("estimated_damage", { precision: 14, scale: 2 }).notNull().default("0"),
  amountRecovered: decimal("amount_recovered", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const fleetDisposalRecommendations = pgTable("fleet_disposal_recommendations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  vehicleId: integer("vehicle_id").notNull().references(() => fleetVehicleProfiles.id),
  reason: text("reason").notNull(),
  conditionSnapshot: text("condition_snapshot"),
  odometerSnapshot: integer("odometer_snapshot"),
  maintenanceCostSnapshot: decimal("maintenance_cost_snapshot", { precision: 14, scale: 2 }).notNull().default("0"),
  currentAssetValueSnapshot: decimal("current_asset_value_snapshot", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("recommended"), // recommended | approved | declined | handed_to_assets | completed
  reviewNotes: text("review_notes"),
  recommendedByUserId: integer("recommended_by_user_id").references(() => users.id),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ vehicleStatusIdx: index("fleet_disposal_vehicle_status_idx").on(table.vehicleId, table.status) }));

export const fleetComponents = pgTable("fleet_components", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  schoolId: integer("school_id").references(() => schools.id),
  componentType: text("component_type").notNull(), // tyre | battery
  serialNumber: text("serial_number").notNull(),
  brand: text("brand"),
  specification: text("specification"),
  purchaseDate: date("purchase_date"),
  purchaseCost: decimal("purchase_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  supplier: text("supplier"),
  warrantyExpiry: date("warranty_expiry"),
  vehicleId: integer("vehicle_id").references(() => fleetVehicleProfiles.id),
  wheelPosition: text("wheel_position"),
  fittedAtOdometer: integer("fitted_at_odometer"),
  fittedAt: timestamp("fitted_at"),
  removedAtOdometer: integer("removed_at_odometer"),
  removedAt: timestamp("removed_at"),
  condition: text("condition").notNull().default("new"),
  status: text("status").notNull().default("in_stock"),
  removalReason: text("removal_reason"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ orgSerialUnique: uniqueIndex("fleet_components_org_serial_uidx").on(table.organizationId, table.serialNumber) }));

export const insertAssetInventorySettingsSchema = omitInsertFields(createInsertSchema(assetInventorySettings), { id: true, createdAt: true, updatedAt: true });
export const insertInventoryReturnableIssueSchema = omitInsertFields(createInsertSchema(inventoryReturnableIssues), { id: true, updatedAt: true });
export const insertAssetCentreSchema = omitInsertFields(createInsertSchema(assetCentres), { id: true, createdAt: true, updatedAt: true });
export const insertAssetInventoryCategorySchema = omitInsertFields(createInsertSchema(assetInventoryCategories), { id: true, createdAt: true, updatedAt: true });
export const insertAssetInventoryLocationSchema = omitInsertFields(createInsertSchema(assetInventoryLocations), { id: true, createdAt: true, updatedAt: true });
export const insertAssetRegisterSchema = omitInsertFields(createInsertSchema(assetRegister), { id: true, createdAt: true, updatedAt: true });
export const insertInventoryItemSchema = omitInsertFields(createInsertSchema(inventoryItems), { id: true, createdAt: true, updatedAt: true });
export type AssetCentre = typeof assetCentres.$inferSelect;
export type AssetInventoryCategory = typeof assetInventoryCategories.$inferSelect;
export type AssetInventoryLocation = typeof assetInventoryLocations.$inferSelect;
export type AssetRegisterItem = typeof assetRegister.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InventorySupplier = typeof inventorySuppliers.$inferSelect;
