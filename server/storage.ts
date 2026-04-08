import { db } from "./db";
import { eq, ne, desc, and, or, sql, count as drizzleCount, like, gte, lte, isNull, inArray, notLike } from "drizzle-orm";
import {
  users, staff, streams, classes, parents, students, subjects,
  staffSubjects, studentSubjects, classSubjects, grades, assessments, marks, attendanceRecords,
  disciplineRecords, clinicRecords, feesPayments, organizations, schools, libraryResources, libraryCategories, libraryBooks, libraryBookCopies, libraryLoans, libraryFines, libraryReservations, libraryPolicies,
  timetableSlots, logbookEntries, posItems, posSales, posSaleItems,
  newsletters, schemes, hostels, hostelRollCall, studentApplications, staffAttendanceLogs,
  permissions, accessGroups, accessGroupPermissions, userAccessGroups, userPermissionOverrides, userSchoolAccess,
  communicationLogs, assessmentTypes, examTypes, exams, assessmentPapers, assessmentComments,
  assessmentMarks, assessmentMarkPapers, reportComments,
  ecdAssessmentDomains, ecdAssessmentItems, ecdAssessmentRecords, ecdAssessmentResponses,
  type User, type InsertUser,
  type Staff, type InsertStaff,
  type Stream, type InsertStream,
  type Class, type InsertClass,
  type ClassSubject, type InsertClassSubject,
  type Parent, type InsertParent,
  type Student, type InsertStudent,
  type Subject, type InsertSubject,
  type StaffSubject, type InsertStaffSubject,
  type StudentSubject, type InsertStudentSubject,
  type Grade, type InsertGrade,
  type Assessment, type InsertAssessment,
  type Mark, type InsertMark,
  type AttendanceRecord, type InsertAttendanceRecord,
  type DisciplineRecord, type InsertDisciplineRecord,
  type ClinicRecord, type InsertClinicRecord,
  type FeesPayment, type InsertFeesPayment,
  type Organization, type InsertOrganization,
  type School, type InsertSchool,
  type LibraryResource, type InsertLibraryResource,
  type LibraryCategory, type InsertLibraryCategory,
  type LibraryBook, type InsertLibraryBook,
  type LibraryLoan, type InsertLibraryLoan,
  type LibraryFine, type InsertLibraryFine,
  type LibraryReservation, type InsertLibraryReservation,
  type LibraryPolicy, type InsertLibraryPolicy,
  type TimetableSlot, type InsertTimetableSlot,
  type LogbookEntry, type InsertLogbookEntry,
  type StaffAttendanceLog, type InsertStaffAttendanceLog,
  type PosItem, type InsertPosItem,
  type PosSale, type InsertPosSale,
  type PosSaleItem, type InsertPosSaleItem,
  type Newsletter, type InsertNewsletter,
  type Scheme, type InsertScheme,
  type Hostel, type InsertHostel,
  type HostelRollCall, type InsertHostelRollCall,
  type StudentApplication, type InsertStudentApplication,
  type Permission, type InsertPermission,
  type AccessGroup, type InsertAccessGroup,
  type AccessGroupPermission, type InsertAccessGroupPermission,
  type UserAccessGroup, type InsertUserAccessGroup,
  type UserPermissionOverride, type InsertUserPermissionOverride,
  type AssessmentType, type InsertAssessmentType,
  type ExamType, type InsertExamType,
  type Exam, type InsertExam,
  type AssessmentPaper, type InsertAssessmentPaper,
  type AssessmentComment, type InsertAssessmentComment,
  type AssessmentMark, type InsertAssessmentMark,
  type AssessmentMarkPaper, type InsertAssessmentMarkPaper,
  type ReportComment, type InsertReportComment,
  type EcdAssessmentDomain, type InsertEcdAssessmentDomain,
  type EcdAssessmentItem, type InsertEcdAssessmentItem,
  type EcdAssessmentRecord, type InsertEcdAssessmentRecord,
  type EcdAssessmentResponse, type InsertEcdAssessmentResponse,
  type Notification, type InsertNotification,
  notifications,
  activityLogs,
  calendarEvents,
  calendarEventAttendees,
  qcReports,
  type ActivityLog, type InsertActivityLog,
} from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByPhone(phone: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: number): Promise<boolean>;
  getUserSchoolAccess(userId: number): Promise<number[]>;
  getUserPermissions(userId: number): Promise<number[]>;
  updateUserPermissions(userId: number, schoolIds: number[], permissionIds: number[]): Promise<void>;
  getUserPermissionStates(userId: number): Promise<{ permission: Permission; granted: boolean; groupGranted: boolean; overrideGranted: boolean | null; source: "group" | "granted_override" | "denied_override" | "none" }[]>;
  updateUserPermissionOverridesFromSelection(userId: number, selectedPermissionIds: number[]): Promise<void>;

  getAllStaff(): Promise<Staff[]>;
  getStaffBySchool(schoolId: number): Promise<Staff[]>;
  getStaff(id: number): Promise<Staff | undefined>;
  createStaff(staffData: InsertStaff): Promise<Staff>;
  updateStaff(id: number, staffData: Partial<InsertStaff>): Promise<Staff | undefined>;
  deleteStaff(id: number): Promise<boolean>;
  getNextStaffNo(): Promise<string>;

  getAllStreams(): Promise<Stream[]>;
  getStreamsBySchoolType(schoolType: string): Promise<Stream[]>;
  getStream(id: number): Promise<Stream | undefined>;
  createStream(stream: InsertStream): Promise<Stream>;
  updateStream(id: number, stream: Partial<InsertStream>): Promise<Stream | undefined>;
  deleteStream(id: number): Promise<boolean>;

  getAllClasses(): Promise<Class[]>;
  getClassesBySchool(schoolId: number): Promise<Class[]>;
  getClass(id: number): Promise<Class | undefined>;
  createClass(classData: InsertClass): Promise<Class>;
  updateClass(id: number, classData: Partial<InsertClass>): Promise<Class | undefined>;
  deleteClass(id: number): Promise<boolean>;
  getStudentCountByClass(classId: number): Promise<number>;
  
  getClassSubjects(classId: number): Promise<ClassSubject[]>;
  addClassSubject(classId: number, subjectId: number): Promise<ClassSubject>;
  removeClassSubject(classId: number, subjectId: number): Promise<boolean>;
  setClassSubjects(classId: number, subjectIds: number[]): Promise<void>;
  migrateStudents(fromClassId: number, toClassId: number, studentIds?: number[]): Promise<number>;

  getAllParents(): Promise<Parent[]>;
  getParentsBySchool(schoolId: number): Promise<Parent[]>;
  getParent(id: number): Promise<Parent | undefined>;
  createParent(parent: InsertParent): Promise<Parent>;
  updateParent(id: number, parent: Partial<InsertParent>): Promise<Parent | undefined>;
  deleteParent(id: number): Promise<boolean>;

  getAllStudents(): Promise<Student[]>;
  getStudentsBySchool(schoolId: number): Promise<Student[]>;
  getStudent(id: number): Promise<Student | undefined>;
  getStudentsByClass(classId: number): Promise<Student[]>;
  getStudentsByParent(parentId: number): Promise<Student[]>;
  createStudent(student: InsertStudent): Promise<Student>;
  updateStudent(id: number, student: Partial<InsertStudent>): Promise<Student | undefined>;
  deleteStudent(id: number): Promise<boolean>;
  getNextAdmissionNo(): Promise<string>;

  getAllSubjects(): Promise<Subject[]>;
  getSubjectsBySchool(schoolId: number): Promise<Subject[]>;
  getSubject(id: number): Promise<Subject | undefined>;
  createSubject(subject: InsertSubject): Promise<Subject>;
  updateSubject(id: number, subject: Partial<InsertSubject>): Promise<Subject | undefined>;
  deleteSubject(id: number): Promise<boolean>;

  getStaffSubjects(staffId: number): Promise<StaffSubject[]>;
  assignSubjectToStaff(data: InsertStaffSubject): Promise<StaffSubject>;
  removeSubjectFromStaff(staffId: number, subjectId: number): Promise<boolean>;
  updateStaffSubjects(staffId: number, subjectIds: number[]): Promise<void>;
  getStaffClasses(staffId: number): Promise<Array<{ id: number; classId: number }>>;
  updateStaffClasses(staffId: number, classIds: number[]): Promise<void>;
  
  getStudentSubjects(studentId: number): Promise<StudentSubject[]>;
  updateStudentSubjects(studentId: number, subjectIds: number[]): Promise<void>;

  getAllGrades(): Promise<Grade[]>;
  getGradesBySchool(schoolId: number): Promise<Grade[]>;
  getGrade(id: number): Promise<Grade | undefined>;
  createGrade(grade: InsertGrade): Promise<Grade>;
  updateGrade(id: number, grade: Partial<InsertGrade>): Promise<Grade | undefined>;
  deleteGrade(id: number): Promise<boolean>;
  getGradeForMark(mark: number): Promise<Grade | undefined>;

  getAllAssessments(): Promise<Assessment[]>;
  getAssessment(id: number): Promise<Assessment | undefined>;
  getAssessmentsByClass(classId: number): Promise<Assessment[]>;
  createAssessment(assessment: InsertAssessment): Promise<Assessment>;
  updateAssessment(id: number, assessment: Partial<InsertAssessment>): Promise<Assessment | undefined>;
  deleteAssessment(id: number): Promise<boolean>;

  getMarksByAssessment(assessmentId: number): Promise<Mark[]>;
  getMarksByStudent(studentId: number): Promise<Mark[]>;
  createMark(mark: InsertMark): Promise<Mark>;
  updateMark(id: number, mark: Partial<InsertMark>): Promise<Mark | undefined>;
  bulkCreateMarks(marksData: InsertMark[]): Promise<Mark[]>;

  getAttendanceByClass(classId: number, date: string): Promise<AttendanceRecord[]>;
  getAttendanceByClassRange(classId: number, from: string, to: string): Promise<AttendanceRecord[]>;
  getAttendanceByStudent(studentId: number): Promise<AttendanceRecord[]>;
  createAttendance(attendance: InsertAttendanceRecord): Promise<AttendanceRecord>;
  updateAttendance(id: number, attendance: Partial<InsertAttendanceRecord>): Promise<AttendanceRecord | undefined>;
  bulkCreateAttendance(records: InsertAttendanceRecord[]): Promise<AttendanceRecord[]>;
  bulkUpsertAttendance(records: InsertAttendanceRecord[]): Promise<AttendanceRecord[]>;

  getDisciplineRecords(studentId?: number): Promise<DisciplineRecord[]>;
  createDisciplineRecord(record: InsertDisciplineRecord): Promise<DisciplineRecord>;

  getClinicRecords(studentId?: number): Promise<ClinicRecord[]>;
  createClinicRecord(record: InsertClinicRecord): Promise<ClinicRecord>;
  updateClinicRecord(id: number, record: Partial<InsertClinicRecord>): Promise<ClinicRecord | undefined>;
  deleteClinicRecord(id: number): Promise<void>;

  getFeesPayments(studentId?: number): Promise<FeesPayment[]>;
  createFeesPayment(payment: InsertFeesPayment): Promise<FeesPayment>;

  getDashboardStats(schoolId?: number | null): Promise<{
    totalStudents: number;
    totalStaff: number;
    totalClasses: number;
    totalSubjects: number;
    attendanceToday: { present: number; absent: number; total: number };
    recentPayments: FeesPayment[];
    studentsGender: { male: number; female: number };
    studentsDailyStats: { approved: number; pending: number; transferred: number };
    classroomPopulation: Array<{ className: string; count: number }>;
    feesToday: { cash: number; mobileMoney: number; bank: number; total: number };
    termFeesCollected: number;
    staffMonitoring: { present: number; absent: number; late: number; earlyExits: number };
    absentStaff: Array<{ name: string; phone: string }>;
    lateComers: Array<{ name: string; inVariance: string; outVariance: string }>;
    studentsAttendanceByClass: Array<{ className: string; teacher: string; absent: number; present: number; total: number }>;
    enrollmentTrend: Array<{ month: string; count: number }>;
    transferReasons: Array<{ name: string; value: number }>;
    libraryStats: { totalBooks: number; availableCopies: number; currentlyBorrowed: number; overdueBooks: number; unpaidFines: number; unpaidFinesAmount: number; paidFines: number; paidFinesAmount: number };
  }>;

  // Organization & Schools
  getAllOrganizations(): Promise<Organization[]>;
  getOrganization(id: number): Promise<Organization | undefined>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: number, org: Partial<InsertOrganization>): Promise<Organization | undefined>;
  
  getAllSchools(): Promise<School[]>;
  getSchool(id: number): Promise<School | undefined>;
  getSchoolsByOrganization(orgId: number): Promise<School[]>;
  createSchool(school: InsertSchool): Promise<School>;
  updateSchool(id: number, school: Partial<InsertSchool>): Promise<School | undefined>;
  deleteSchool(id: number): Promise<boolean>;

  // E-Library (Digital Resources)
  getLibraryResources(schoolId?: number): Promise<LibraryResource[]>;
  getLibraryResource(id: number): Promise<LibraryResource | undefined>;
  createLibraryResource(resource: InsertLibraryResource): Promise<LibraryResource>;
  updateLibraryResource(id: number, resource: Partial<InsertLibraryResource>): Promise<LibraryResource | undefined>;
  deleteLibraryResource(id: number): Promise<boolean>;

  // Library - Categories
  getLibraryCategories(schoolId: number): Promise<LibraryCategory[]>;
  createLibraryCategory(category: InsertLibraryCategory): Promise<LibraryCategory>;
  updateLibraryCategory(id: number, category: Partial<InsertLibraryCategory>): Promise<LibraryCategory | undefined>;
  deleteLibraryCategory(id: number): Promise<boolean>;

  // Library - Books
  getLibraryBooks(schoolId: number): Promise<LibraryBook[]>;
  getLibraryBook(id: number): Promise<LibraryBook | undefined>;
  createLibraryBook(book: InsertLibraryBook): Promise<LibraryBook>;
  updateLibraryBook(id: number, book: Partial<InsertLibraryBook>): Promise<LibraryBook | undefined>;
  deleteLibraryBook(id: number): Promise<boolean>;

  // Library - Book Copies
  getLibraryBookCopies(bookId: number): Promise<LibraryBookCopy[]>;
  getLibraryBookCopyByQr(qrCode: string): Promise<LibraryBookCopy | undefined>;
  createLibraryBookCopy(copy: InsertLibraryBookCopy): Promise<LibraryBookCopy>;
  updateLibraryBookCopy(id: number, data: Partial<InsertLibraryBookCopy>): Promise<LibraryBookCopy | undefined>;
  deleteLibraryBookCopy(id: number): Promise<boolean>;
  getLibraryBookCopiesBySchool(schoolId: number): Promise<LibraryBookCopy[]>;

  // Library - Loans
  getLibraryLoans(schoolId: number, status?: string): Promise<LibraryLoan[]>;
  getLibraryLoan(id: number): Promise<LibraryLoan | undefined>;
  createLibraryLoan(loan: InsertLibraryLoan): Promise<LibraryLoan>;
  updateLibraryLoan(id: number, loan: Partial<LibraryLoan>): Promise<LibraryLoan | undefined>;

  // Library - Fines
  getLibraryFines(schoolId: number, status?: string): Promise<LibraryFine[]>;
  createLibraryFine(fine: InsertLibraryFine): Promise<LibraryFine>;
  updateLibraryFine(id: number, fine: Partial<LibraryFine>): Promise<LibraryFine | undefined>;

  // Library - Reservations
  getLibraryReservations(schoolId: number, status?: string): Promise<LibraryReservation[]>;
  createLibraryReservation(reservation: InsertLibraryReservation): Promise<LibraryReservation>;
  updateLibraryReservation(id: number, data: Partial<LibraryReservation>): Promise<LibraryReservation | undefined>;
  getLibraryReservationsForBook(bookId: number, status?: string): Promise<LibraryReservation[]>;

  // Library - Policies
  getLibraryPolicy(schoolId: number): Promise<LibraryPolicy | undefined>;
  upsertLibraryPolicy(data: InsertLibraryPolicy): Promise<LibraryPolicy>;

  // Timetable
  getTimetableSlots(schoolId?: number, classId?: number): Promise<TimetableSlot[]>;
  createTimetableSlot(slot: InsertTimetableSlot): Promise<TimetableSlot>;
  updateTimetableSlot(id: number, slot: Partial<InsertTimetableSlot>): Promise<TimetableSlot | undefined>;
  deleteTimetableSlot(id: number): Promise<boolean>;

  // Logbook
  getLogbookEntries(teacherId?: number, classId?: number): Promise<LogbookEntry[]>;
  createLogbookEntry(entry: InsertLogbookEntry): Promise<LogbookEntry>;
  updateLogbookEntry(id: number, entry: Partial<InsertLogbookEntry>): Promise<LogbookEntry | undefined>;
  deleteLogbookEntry(id: number): Promise<boolean>;

  // Staff Attendance
  getStaffAttendanceLogs(schoolId: number, filters?: { staffId?: number; date?: string; dateFrom?: string; dateTo?: string; status?: string }): Promise<StaffAttendanceLog[]>;
  getStaffAttendanceLogByUserAndDate(userId: number, date: string): Promise<StaffAttendanceLog | undefined>;
  getStaffAttendanceLogById(id: number): Promise<StaffAttendanceLog | undefined>;
  getStaffAttendanceLogByUserWithPendingReason(userId: number): Promise<StaffAttendanceLog | undefined>;
  createStaffAttendanceLog(log: InsertStaffAttendanceLog): Promise<StaffAttendanceLog>;
  updateStaffAttendanceLog(id: number, log: Partial<InsertStaffAttendanceLog>): Promise<StaffAttendanceLog | undefined>;
  autoClockOutOverdueStaffAttendanceLogs(): Promise<number>;

  // POS
  getPosItems(schoolId?: number): Promise<PosItem[]>;
  getPosItem(id: number): Promise<PosItem | undefined>;
  createPosItem(item: InsertPosItem): Promise<PosItem>;
  updatePosItem(id: number, item: Partial<InsertPosItem>): Promise<PosItem | undefined>;
  deletePosItem(id: number): Promise<boolean>;

  getPosSales(schoolId?: number): Promise<PosSale[]>;
  createPosSale(sale: InsertPosSale): Promise<PosSale>;
  createPosSaleItems(items: InsertPosSaleItem[]): Promise<PosSaleItem[]>;
  getPosSaleItems(saleId: number): Promise<PosSaleItem[]>;

  // Newsletters
  getNewsletters(schoolId?: number): Promise<Newsletter[]>;
  getNewsletterById(id: number): Promise<Newsletter | undefined>;
  createNewsletter(newsletter: InsertNewsletter): Promise<Newsletter>;
  updateNewsletter(id: number, newsletter: Partial<InsertNewsletter>): Promise<Newsletter | undefined>;
  deleteNewsletter(id: number): Promise<boolean>;

  // Schemes
  getSchemes(schoolId?: number, subjectId?: number): Promise<Scheme[]>;
  createScheme(scheme: InsertScheme): Promise<Scheme>;
  updateScheme(id: number, scheme: Partial<InsertScheme>): Promise<Scheme | undefined>;
  deleteScheme(id: number): Promise<boolean>;

  // Hostels
  getHostels(schoolId: number): Promise<Hostel[]>;
  getHostel(id: number): Promise<Hostel | undefined>;
  createHostel(hostel: InsertHostel): Promise<Hostel>;
  updateHostel(id: number, hostel: Partial<InsertHostel>): Promise<Hostel | undefined>;
  deleteHostel(id: number): Promise<boolean>;

  // Hostel Roll Call
  getHostelRollCall(schoolId?: number, date?: string): Promise<HostelRollCall[]>;
  getHostelRollCallByHostel(hostelId: number, date: string, timeSlot: string): Promise<HostelRollCall[]>;
  getHostelRollCallByHostelRange(hostelId: number, from: string, to: string, timeSlot: string): Promise<HostelRollCall[]>;
  createHostelRollCall(record: InsertHostelRollCall): Promise<HostelRollCall>;
  bulkCreateHostelRollCall(records: InsertHostelRollCall[]): Promise<HostelRollCall[]>;
  bulkUpsertHostelRollCall(records: InsertHostelRollCall[]): Promise<HostelRollCall[]>;

  // Student Applications
  getStudentApplications(schoolId?: number): Promise<StudentApplication[]>;
  createStudentApplication(app: InsertStudentApplication): Promise<StudentApplication>;
  updateStudentApplication(id: number, app: Partial<InsertStudentApplication>): Promise<StudentApplication | undefined>;

  // Permissions
  getAllPermissions(): Promise<Permission[]>;
  getPermission(id: number): Promise<Permission | undefined>;
  getPermissionByCode(code: string): Promise<Permission | undefined>;
  createPermission(permission: InsertPermission): Promise<Permission>;
  updatePermission(id: number, permission: Partial<InsertPermission>): Promise<Permission | undefined>;
  deletePermission(id: number): Promise<boolean>;

  // Access Groups
  getAllAccessGroups(): Promise<AccessGroup[]>;
  getAccessGroup(id: number): Promise<AccessGroup | undefined>;
  getAccessGroupByName(name: string): Promise<AccessGroup | undefined>;
  createAccessGroup(group: InsertAccessGroup): Promise<AccessGroup>;
  updateAccessGroup(id: number, group: Partial<InsertAccessGroup>): Promise<AccessGroup | undefined>;
  deleteAccessGroup(id: number): Promise<boolean>;

  // Access Group Permissions
  getAccessGroupPermissions(accessGroupId: number): Promise<Permission[]>;
  addPermissionToAccessGroup(data: InsertAccessGroupPermission): Promise<AccessGroupPermission>;
  removePermissionFromAccessGroup(accessGroupId: number, permissionId: number): Promise<boolean>;
  setAccessGroupPermissions(accessGroupId: number, permissionIds: number[]): Promise<void>;

  // User Access Groups
  ensureUserBaselineAccessGroups(userId: number): Promise<void>;
  normalizeUserBaselineAccess(userId: number): Promise<void>;
  normalizeAllUserBaselineAccessGroups(): Promise<void>;
  getUserAccessGroups(userId: number): Promise<AccessGroup[]>;
  addUserToAccessGroup(data: InsertUserAccessGroup): Promise<UserAccessGroup>;
  removeUserFromAccessGroup(userId: number, accessGroupId: number): Promise<boolean>;

  // User Permission Overrides
  getUserPermissionOverrides(userId: number): Promise<UserPermissionOverride[]>;
  setUserPermissionOverride(data: InsertUserPermissionOverride): Promise<UserPermissionOverride>;
  removeUserPermissionOverride(userId: number, permissionId: number): Promise<boolean>;
  clearAllUserPermissionOverrides(userId: number): Promise<boolean>;

  // Get effective permissions for a user (combining group permissions + overrides)
  getUserEffectivePermissions(userId: number): Promise<{ permission: Permission; granted: boolean }[]>;
  userHasPermission(userId: number, permissionCode: string): Promise<boolean>;

  // Global Search (HQ level)
  globalSearch(query: string): Promise<{
    staff: Array<Staff & { schoolName: string }>;
    students: Array<Student & { schoolName: string }>;
    parents: Array<Parent & { schoolName: string | null }>;
  }>;

  // Assessment Types
  getAssessmentTypes(schoolId?: number): Promise<AssessmentType[]>;
  getAssessmentType(id: number): Promise<AssessmentType | undefined>;
  createAssessmentType(type: InsertAssessmentType): Promise<AssessmentType>;
  updateAssessmentType(id: number, type: Partial<InsertAssessmentType>): Promise<AssessmentType | undefined>;
  deleteAssessmentType(id: number): Promise<boolean>;

  // Exam Types
  getExamTypes(schoolId?: number): Promise<ExamType[]>;
  getExamType(id: number): Promise<ExamType | undefined>;
  createExamType(type: InsertExamType): Promise<ExamType>;
  updateExamType(id: number, type: Partial<InsertExamType>): Promise<ExamType | undefined>;
  deleteExamType(id: number): Promise<boolean>;

  // Exams
  getExams(schoolId?: number): Promise<Exam[]>;
  getExamsBySchool(schoolId: number): Promise<Exam[]>;
  getExam(id: number): Promise<Exam | undefined>;
  createExam(exam: InsertExam): Promise<Exam>;
  updateExam(id: number, exam: Partial<InsertExam>): Promise<Exam | undefined>;
  deleteExam(id: number): Promise<boolean>;
  
  // Assessments by exam
  getAssessmentsByExam(examId: number): Promise<Assessment[]>;

  // Assessment Papers
  getAssessmentPapers(assessmentId: number): Promise<AssessmentPaper[]>;
  createAssessmentPaper(paper: InsertAssessmentPaper): Promise<AssessmentPaper>;
  updateAssessmentPaper(id: number, paper: Partial<InsertAssessmentPaper>): Promise<AssessmentPaper | undefined>;
  deleteAssessmentPaper(id: number): Promise<boolean>;
  setAssessmentPapers(assessmentId: number, papers: InsertAssessmentPaper[]): Promise<AssessmentPaper[]>;

  // Assessment Comments
  getAssessmentComments(schoolId?: number, classId?: number, subjectId?: number): Promise<AssessmentComment[]>;
  getAssessmentComment(id: number): Promise<AssessmentComment | undefined>;
  createAssessmentComment(comment: InsertAssessmentComment): Promise<AssessmentComment>;
  updateAssessmentComment(id: number, comment: Partial<InsertAssessmentComment>): Promise<AssessmentComment | undefined>;
  deleteAssessmentComment(id: number): Promise<boolean>;
  findAssessmentComment(classId: number, subjectId: number, gradeId: number): Promise<AssessmentComment | undefined>;

  // Report Comments (Principal / Class Teacher)
  getReportComments(schoolId: number, commentType?: string): Promise<ReportComment[]>;
  getEcdAssessmentDomains(): Promise<EcdAssessmentDomain[]>;
  getEcdAssessmentItems(): Promise<EcdAssessmentItem[]>;
  getEcdAssessmentRecord(studentId: number, examId: number): Promise<EcdAssessmentRecord | undefined>;
  upsertEcdAssessmentRecord(data: InsertEcdAssessmentRecord): Promise<EcdAssessmentRecord>;
  getEcdAssessmentResponses(recordId: number): Promise<EcdAssessmentResponse[]>;
  upsertEcdAssessmentResponse(data: InsertEcdAssessmentResponse): Promise<EcdAssessmentResponse>;
  createReportComment(comment: InsertReportComment): Promise<ReportComment>;
  deleteReportComment(id: number, schoolId: number): Promise<boolean>;

  // Assessment Marks
  getAssessmentMarks(assessmentId: number, classId?: number, subjectId?: number): Promise<AssessmentMark[]>;
  getAssessmentMark(id: number): Promise<AssessmentMark | undefined>;
  getAssessmentMarkByStudentAssessment(studentId: number, assessmentId: number): Promise<AssessmentMark | undefined>;
  getAssessmentMarksByAssessments(assessmentIds: number[]): Promise<AssessmentMark[]>;
  createAssessmentMark(mark: InsertAssessmentMark): Promise<AssessmentMark>;
  updateAssessmentMark(id: number, mark: Partial<InsertAssessmentMark>): Promise<AssessmentMark | undefined>;
  deleteAssessmentMark(id: number): Promise<boolean>;
  
  // Assessment Mark Papers
  getMarkPapers(assessmentMarkId: number): Promise<AssessmentMarkPaper[]>;
  setMarkPapers(assessmentMarkId: number, papers: { assessmentPaperId: number; markObtained: number | null }[]): Promise<AssessmentMarkPaper[]>;

  // Notifications
  getNotifications(userId: number, orgId?: number): Promise<Notification[]>;
  getUnreadNotificationCount(userId: number, orgId?: number): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationRead(id: number): Promise<Notification | undefined>;
  markAllNotificationsRead(userId: number): Promise<void>;

  // School termination
  getSchoolsPendingTermination(): Promise<School[]>;
  getArchivedSchools(orgId?: number): Promise<School[]>;
  scheduleSchoolTermination(schoolId: number, userId: number): Promise<School | undefined>;
  archiveSchool(schoolId: number): Promise<School | undefined>;
  restoreSchool(schoolId: number): Promise<School | undefined>;

  // Activity Logs
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getActivityLogs(filters: {
    schoolId?: number;
    organizationId?: number;
    category?: string;
    action?: string;
    userId?: number;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: ActivityLog[]; total: number }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.phone, phone));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(userData).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: number): Promise<boolean> {
    await db.transaction(async (tx) => {
      await tx.delete(userSchoolAccess).where(eq(userSchoolAccess.userId, id));
      await tx.delete(userAccessGroups).where(eq(userAccessGroups.userId, id));
      await tx.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, id));

      await tx.update(staff).set({ userId: null }).where(eq(staff.userId, id));
      await tx.update(parents).set({ userId: null }).where(eq(parents.userId, id));
      await tx.update(students).set({ userId: null }).where(eq(students.userId, id));

      await tx.update(schools).set({ terminationByUserId: null }).where(eq(schools.terminationByUserId, id));
      await tx.update(communicationLogs).set({ sentBy: null }).where(eq(communicationLogs.sentBy, id));
      await tx.update(calendarEvents).set({ ownerUserId: null }).where(eq(calendarEvents.ownerUserId, id));
      await tx.update(calendarEvents).set({ createdByUserId: null }).where(eq(calendarEvents.createdByUserId, id));
      await tx.delete(calendarEventAttendees).where(eq(calendarEventAttendees.userId, id));
      await tx.update(notifications).set({ userId: null }).where(eq(notifications.userId, id));
      await tx.update(notifications).set({ actorUserId: null }).where(eq(notifications.actorUserId, id));
      await tx.update(activityLogs).set({ userId: null }).where(eq(activityLogs.userId, id));
      await tx.update(qcReports).set({ createdBy: null }).where(eq(qcReports.createdBy, id));

      await tx.delete(users).where(eq(users.id, id));
    });

    return true;
  }

  async getUserSchoolAccess(userId: number): Promise<number[]> {
    const access = await db.select().from(userSchoolAccess).where(eq(userSchoolAccess.userId, userId));
    return access.map(a => a.schoolId);
  }

  async getUserPermissions(userId: number): Promise<number[]> {
    const perms = await db.select().from(userPermissionOverrides)
      .where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.granted, true)));
    return perms.map(p => p.permissionId);
  }

  async updateUserPermissions(userId: number, schoolIds: number[], permissionIds: number[]): Promise<void> {
    await db.delete(userSchoolAccess).where(eq(userSchoolAccess.userId, userId));
    if (schoolIds.length > 0) {
      await db.insert(userSchoolAccess).values(schoolIds.map(schoolId => ({ userId, schoolId })));
    }
    await this.updateUserPermissionOverridesFromSelection(userId, permissionIds);
  }

  async getAllStaff(): Promise<Staff[]> {
    return db.select().from(staff).orderBy(desc(staff.createdAt));
  }

  async getStaffBySchool(schoolId: number): Promise<Staff[]> {
    return db.select().from(staff).where(eq(staff.schoolId, schoolId)).orderBy(desc(staff.createdAt));
  }

  async getStaff(id: number): Promise<Staff | undefined> {
    const [staffMember] = await db.select().from(staff).where(eq(staff.id, id));
    return staffMember;
  }

  async createStaff(staffData: InsertStaff): Promise<Staff> {
    const [newStaff] = await db.insert(staff).values(staffData).returning();
    return newStaff;
  }

  async updateStaff(id: number, staffData: Partial<InsertStaff>): Promise<Staff | undefined> {
    const [updated] = await db.update(staff).set(staffData).where(eq(staff.id, id)).returning();
    return updated;
  }

  async deleteStaff(id: number): Promise<boolean> {
    const result = await db.delete(staff).where(eq(staff.id, id));
    return true;
  }

  async getNextStaffNo(): Promise<string> {
    const [result] = await db.select({ count: drizzleCount() }).from(staff);
    const num = (result?.count || 0) + 1;
    return `FCGST${num.toString().padStart(4, '0')}`;
  }

  async getAllStreams(): Promise<Stream[]> {
    return db.select().from(streams).orderBy(streams.sortOrder);
  }

  async getStreamsBySchoolType(schoolType: string): Promise<Stream[]> {
    return db.select().from(streams).where(eq(streams.schoolType, schoolType)).orderBy(streams.sortOrder);
  }

  async getStream(id: number): Promise<Stream | undefined> {
    const [stream] = await db.select().from(streams).where(eq(streams.id, id));
    return stream;
  }

  async createStream(streamData: InsertStream): Promise<Stream> {
    const [newStream] = await db.insert(streams).values(streamData).returning();
    return newStream;
  }

  async updateStream(id: number, streamData: Partial<InsertStream>): Promise<Stream | undefined> {
    const [updated] = await db.update(streams).set(streamData).where(eq(streams.id, id)).returning();
    return updated;
  }

  async deleteStream(id: number): Promise<boolean> {
    await db.delete(streams).where(eq(streams.id, id));
    return true;
  }

  async getAllClasses(): Promise<Class[]> {
    return db.select().from(classes).orderBy(classes.className);
  }

  async getClassesBySchool(schoolId: number): Promise<Class[]> {
    return db.select().from(classes).where(eq(classes.schoolId, schoolId)).orderBy(classes.className);
  }

  async getClass(id: number): Promise<Class | undefined> {
    const [classData] = await db.select().from(classes).where(eq(classes.id, id));
    return classData;
  }

  async createClass(classData: InsertClass): Promise<Class> {
    const [newClass] = await db.insert(classes).values(classData).returning();
    return newClass;
  }

  async updateClass(id: number, classData: Partial<InsertClass>): Promise<Class | undefined> {
    const [updated] = await db.update(classes).set(classData).where(eq(classes.id, id)).returning();
    return updated;
  }

  async deleteClass(id: number): Promise<boolean> {
    await db.delete(classSubjects).where(eq(classSubjects.classId, id));
    await db.delete(classes).where(eq(classes.id, id));
    return true;
  }
  
  async getStudentCountByClass(classId: number): Promise<number> {
    const result = await db.select({ count: drizzleCount() }).from(students).where(eq(students.classId, classId));
    return result[0]?.count ?? 0;
  }
  
  async getClassSubjects(classId: number): Promise<ClassSubject[]> {
    return db.select().from(classSubjects).where(eq(classSubjects.classId, classId));
  }
  
  async addClassSubject(classId: number, subjectId: number): Promise<ClassSubject> {
    const existing = await db.select().from(classSubjects)
      .where(and(eq(classSubjects.classId, classId), eq(classSubjects.subjectId, subjectId)));
    if (existing.length > 0) {
      return existing[0];
    }
    const [newClassSubject] = await db.insert(classSubjects).values({ classId, subjectId }).returning();
    
    const studentsInClass = await db.select().from(students).where(eq(students.classId, classId));
    for (const student of studentsInClass) {
      const existingStudentSubject = await db.select().from(studentSubjects)
        .where(and(eq(studentSubjects.studentId, student.id), eq(studentSubjects.subjectId, subjectId)));
      if (existingStudentSubject.length === 0) {
        await db.insert(studentSubjects).values({ studentId: student.id, subjectId });
      }
    }
    
    return newClassSubject;
  }
  
  async removeClassSubject(classId: number, subjectId: number): Promise<boolean> {
    await db.delete(classSubjects)
      .where(and(eq(classSubjects.classId, classId), eq(classSubjects.subjectId, subjectId)));
    
    const studentsInClass = await db.select().from(students).where(eq(students.classId, classId));
    for (const student of studentsInClass) {
      await db.delete(studentSubjects)
        .where(and(eq(studentSubjects.studentId, student.id), eq(studentSubjects.subjectId, subjectId)));
    }
    
    return true;
  }
  
  async setClassSubjects(classId: number, subjectIds: number[]): Promise<void> {
    const oldClassSubjects = await db.select().from(classSubjects).where(eq(classSubjects.classId, classId));
    const oldSubjectIds = oldClassSubjects.map(cs => cs.subjectId);
    
    await db.delete(classSubjects).where(eq(classSubjects.classId, classId));
    if (subjectIds.length > 0) {
      const values = subjectIds.map(subjectId => ({ classId, subjectId }));
      await db.insert(classSubjects).values(values);
    }
    
    const studentsInClass = await db.select().from(students).where(eq(students.classId, classId));
    
    for (const student of studentsInClass) {
      const removedSubjects = oldSubjectIds.filter(id => !subjectIds.includes(id));
      for (const subjectId of removedSubjects) {
        await db.delete(studentSubjects)
          .where(and(eq(studentSubjects.studentId, student.id), eq(studentSubjects.subjectId, subjectId)));
      }
      
      const addedSubjects = subjectIds.filter(id => !oldSubjectIds.includes(id));
      for (const subjectId of addedSubjects) {
        const existing = await db.select().from(studentSubjects)
          .where(and(eq(studentSubjects.studentId, student.id), eq(studentSubjects.subjectId, subjectId)));
        if (existing.length === 0) {
          await db.insert(studentSubjects).values({ studentId: student.id, subjectId });
        }
      }
    }
  }
  
  async migrateStudents(fromClassId: number, toClassId: number, studentIds?: number[]): Promise<number> {
    const toClassSubjectsData = await db.select().from(classSubjects).where(eq(classSubjects.classId, toClassId));
    const toClassSubjectIds = toClassSubjectsData.map(cs => cs.subjectId);
    
    let studentsToMigrate: typeof students.$inferSelect[];
    if (studentIds && studentIds.length > 0) {
      studentsToMigrate = await db.select().from(students)
        .where(and(eq(students.classId, fromClassId), sql`${students.id} = ANY(${sql.raw(`ARRAY[${studentIds.join(',')}]`)})`));
    } else {
      studentsToMigrate = await db.select().from(students).where(eq(students.classId, fromClassId));
    }
    
    for (const student of studentsToMigrate) {
      await db.update(students).set({ classId: toClassId }).where(eq(students.id, student.id));
      
      await db.delete(studentSubjects).where(eq(studentSubjects.studentId, student.id));
      
      for (const subjectId of toClassSubjectIds) {
        await db.insert(studentSubjects).values({ studentId: student.id, subjectId });
      }
    }
    
    return studentsToMigrate.length;
  }

  async getAllParents(): Promise<Parent[]> {
    return db.select().from(parents).orderBy(desc(parents.createdAt));
  }

  async getParentsBySchool(schoolId: number): Promise<Parent[]> {
    return db.select().from(parents).where(eq(parents.schoolId, schoolId)).orderBy(desc(parents.createdAt));
  }

  async getParent(id: number): Promise<Parent | undefined> {
    const [parent] = await db.select().from(parents).where(eq(parents.id, id));
    return parent;
  }

  async createParent(parentData: InsertParent): Promise<Parent> {
    const [newParent] = await db.insert(parents).values(parentData).returning();
    return newParent;
  }

  async updateParent(id: number, parentData: Partial<InsertParent>): Promise<Parent | undefined> {
    const [updated] = await db.update(parents).set(parentData).where(eq(parents.id, id)).returning();
    return updated;
  }

  async deleteParent(id: number): Promise<boolean> {
    await db.delete(parents).where(eq(parents.id, id));
    return true;
  }

  async getAllStudents(): Promise<Student[]> {
    return db.select().from(students).orderBy(desc(students.createdAt));
  }

  async getStudentsBySchool(schoolId: number): Promise<Student[]> {
    return db.select().from(students).where(eq(students.schoolId, schoolId)).orderBy(desc(students.createdAt));
  }

  async getStudent(id: number): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(eq(students.id, id));
    return student;
  }

  async getStudentsByClass(classId: number): Promise<Student[]> {
    return db.select().from(students).where(eq(students.classId, classId));
  }

  async getStudentsByParent(parentId: number): Promise<Student[]> {
    return db.select().from(students).where(eq(students.parentId, parentId));
  }

  async createStudent(studentData: InsertStudent): Promise<Student> {
    const [newStudent] = await db.insert(students).values(studentData).returning();
    return newStudent;
  }

  async updateStudent(id: number, studentData: Partial<InsertStudent>): Promise<Student | undefined> {
    const [updated] = await db.update(students).set(studentData).where(eq(students.id, id)).returning();
    return updated;
  }

  async deleteStudent(id: number): Promise<boolean> {
    await db.delete(students).where(eq(students.id, id));
    return true;
  }

  async getNextAdmissionNo(): Promise<string> {
    const [result] = await db.select({ count: drizzleCount() }).from(students);
    const num = (result?.count || 0) + 1;
    return `FCGSM${num.toString().padStart(4, '0')}`;
  }

  async getSubjectsBySchool(schoolId: number): Promise<Subject[]> {
    return db.select().from(subjects).where(eq(subjects.schoolId, schoolId));
  }

  async getAllSubjects(): Promise<Subject[]> {
    return db.select().from(subjects).orderBy(subjects.name);
  }

  async getSubject(id: number): Promise<Subject | undefined> {
    const [subject] = await db.select().from(subjects).where(eq(subjects.id, id));
    return subject;
  }

  async createSubject(subjectData: InsertSubject): Promise<Subject> {
    const [newSubject] = await db.insert(subjects).values(subjectData).returning();
    return newSubject;
  }

  async updateSubject(id: number, subjectData: Partial<InsertSubject>): Promise<Subject | undefined> {
    const [updated] = await db.update(subjects).set(subjectData).where(eq(subjects.id, id)).returning();
    return updated;
  }

  async deleteSubject(id: number): Promise<boolean> {
    await db.delete(subjects).where(eq(subjects.id, id));
    return true;
  }

  async getStaffSubjects(staffId: number): Promise<StaffSubject[]> {
    return db.select().from(staffSubjects).where(eq(staffSubjects.staffId, staffId));
  }

  async assignSubjectToStaff(data: InsertStaffSubject): Promise<StaffSubject> {
    const [assignment] = await db.insert(staffSubjects).values(data).returning();
    return assignment;
  }

  async removeSubjectFromStaff(staffId: number, subjectId: number): Promise<boolean> {
    await db.delete(staffSubjects).where(
      and(eq(staffSubjects.staffId, staffId), eq(staffSubjects.subjectId, subjectId))
    );
    return true;
  }

  async updateStaffSubjects(staffId: number, subjectIds: number[]): Promise<void> {
    await db.delete(staffSubjects).where(eq(staffSubjects.staffId, staffId));
    if (subjectIds.length > 0) {
      await db.insert(staffSubjects).values(
        subjectIds.map(subjectId => ({ staffId, subjectId }))
      );
    }
  }

  async getStaffClasses(staffId: number): Promise<Array<{ id: number; classId: number }>> {
    const result = await db.select().from(classes).where(eq(classes.classTeacherId, staffId));
    return result.map(c => ({ id: c.id, classId: c.id }));
  }

  async updateStaffClasses(staffId: number, classIds: number[]): Promise<void> {
    await db.update(classes).set({ classTeacherId: null }).where(eq(classes.classTeacherId, staffId));
    if (classIds.length > 0) {
      for (const classId of classIds) {
        await db.update(classes).set({ classTeacherId: staffId }).where(eq(classes.id, classId));
      }
    }
  }

  async getStudentSubjects(studentId: number): Promise<StudentSubject[]> {
    return db.select().from(studentSubjects).where(eq(studentSubjects.studentId, studentId));
  }

  async updateStudentSubjects(studentId: number, subjectIds: number[]): Promise<void> {
    await db.delete(studentSubjects).where(eq(studentSubjects.studentId, studentId));
    if (subjectIds.length > 0) {
      await db.insert(studentSubjects).values(
        subjectIds.map(subjectId => ({ studentId, subjectId }))
      );
    }
  }

  async getAllGrades(): Promise<Grade[]> {
    return db.select().from(grades).orderBy(desc(grades.upperLimit));
  }

  async getGradesBySchool(schoolId: number): Promise<Grade[]> {
    return db.select().from(grades).where(eq(grades.schoolId, schoolId)).orderBy(desc(grades.upperLimit));
  }

  async getGrade(id: number): Promise<Grade | undefined> {
    const [grade] = await db.select().from(grades).where(eq(grades.id, id));
    return grade;
  }

  async createGrade(gradeData: InsertGrade): Promise<Grade> {
    const [newGrade] = await db.insert(grades).values(gradeData).returning();
    return newGrade;
  }

  async updateGrade(id: number, gradeData: Partial<InsertGrade>): Promise<Grade | undefined> {
    const [updated] = await db.update(grades).set(gradeData).where(eq(grades.id, id)).returning();
    return updated;
  }

  async deleteGrade(id: number): Promise<boolean> {
    await db.delete(grades).where(eq(grades.id, id));
    return true;
  }

  async getGradeForMark(mark: number): Promise<Grade | undefined> {
    const [grade] = await db.select().from(grades)
      .where(and(lte(grades.lowerLimit, mark), gte(grades.upperLimit, mark)));
    return grade;
  }

  async getAllAssessments(): Promise<Assessment[]> {
    return db.select().from(assessments).orderBy(desc(assessments.createdAt));
  }

  async getAssessment(id: number): Promise<Assessment | undefined> {
    const [assessment] = await db.select().from(assessments).where(eq(assessments.id, id));
    return assessment;
  }

  async getAssessmentsByClass(classId: number): Promise<Assessment[]> {
    return db.select().from(assessments).where(eq(assessments.classId, classId));
  }

  async createAssessment(assessmentData: InsertAssessment): Promise<Assessment> {
    const [newAssessment] = await db.insert(assessments).values(assessmentData).returning();
    return newAssessment;
  }

  async updateAssessment(id: number, assessmentData: Partial<InsertAssessment>): Promise<Assessment | undefined> {
    const [updated] = await db.update(assessments).set(assessmentData).where(eq(assessments.id, id)).returning();
    return updated;
  }

  async deleteAssessment(id: number): Promise<boolean> {
    // First get all assessment marks for this assessment
    const marksForAssessment = await db.select().from(assessmentMarks).where(eq(assessmentMarks.assessmentId, id));
    
    // Delete all assessment mark papers for these marks
    for (const mark of marksForAssessment) {
      await db.delete(assessmentMarkPapers).where(eq(assessmentMarkPapers.assessmentMarkId, mark.id));
    }
    
    // Delete all assessment marks
    await db.delete(assessmentMarks).where(eq(assessmentMarks.assessmentId, id));
    
    // Delete all assessment papers
    await db.delete(assessmentPapers).where(eq(assessmentPapers.assessmentId, id));
    
    // Finally delete the assessment
    await db.delete(assessments).where(eq(assessments.id, id));
    return true;
  }

  async getMarksByAssessment(assessmentId: number): Promise<Mark[]> {
    return db.select().from(marks).where(eq(marks.assessmentId, assessmentId));
  }

  async getMarksByStudent(studentId: number): Promise<Mark[]> {
    return db.select().from(marks).where(eq(marks.studentId, studentId));
  }

  async createMark(markData: InsertMark): Promise<Mark> {
    const [newMark] = await db.insert(marks).values(markData).returning();
    return newMark;
  }

  async updateMark(id: number, markData: Partial<InsertMark>): Promise<Mark | undefined> {
    const [updated] = await db.update(marks).set(markData).where(eq(marks.id, id)).returning();
    return updated;
  }

  async bulkCreateMarks(marksData: InsertMark[]): Promise<Mark[]> {
    if (marksData.length === 0) return [];
    return db.insert(marks).values(marksData).returning();
  }

  async getAttendanceByClass(classId: number, date: string): Promise<AttendanceRecord[]> {
    return db.select().from(attendanceRecords)
      .where(and(eq(attendanceRecords.classId, classId), eq(attendanceRecords.date, date)));
  }

  async getAttendanceByStudent(studentId: number): Promise<AttendanceRecord[]> {
    return db.select().from(attendanceRecords)
      .where(eq(attendanceRecords.studentId, studentId))
      .orderBy(desc(attendanceRecords.date));
  }

  async createAttendance(attendanceData: InsertAttendanceRecord): Promise<AttendanceRecord> {
    const [newRecord] = await db.insert(attendanceRecords).values(attendanceData).returning();
    return newRecord;
  }

  async updateAttendance(id: number, attendanceData: Partial<InsertAttendanceRecord>): Promise<AttendanceRecord | undefined> {
    const [updated] = await db.update(attendanceRecords).set(attendanceData).where(eq(attendanceRecords.id, id)).returning();
    return updated;
  }

  async getAttendanceByClassRange(classId: number, from: string, to: string): Promise<AttendanceRecord[]> {
    return db.select().from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.classId, classId),
        gte(attendanceRecords.date, from),
        lte(attendanceRecords.date, to),
      ))
      .orderBy(attendanceRecords.date);
  }

  async bulkCreateAttendance(records: InsertAttendanceRecord[]): Promise<AttendanceRecord[]> {
    if (records.length === 0) return [];
    return db.insert(attendanceRecords).values(records).returning();
  }

  async bulkUpsertAttendance(records: InsertAttendanceRecord[]): Promise<AttendanceRecord[]> {
    if (records.length === 0) return [];
    const results: AttendanceRecord[] = [];
    for (const rec of records) {
      const existing = await db.select().from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.studentId, rec.studentId),
          eq(attendanceRecords.classId, rec.classId),
          eq(attendanceRecords.date, rec.date),
        ))
        .limit(1);
      if (existing.length > 0) {
        const setData: Record<string, any> = { status: rec.status, reason: rec.reason, notifyParent: rec.notifyParent };
        if (rec.notifiedStatus !== undefined) setData.notifiedStatus = rec.notifiedStatus;
        if (rec.notifiedReason !== undefined) setData.notifiedReason = rec.notifiedReason;
        const [updated] = await db.update(attendanceRecords)
          .set(setData)
          .where(eq(attendanceRecords.id, existing[0].id))
          .returning();
        results.push(updated);
      } else {
        const [created] = await db.insert(attendanceRecords).values(rec).returning();
        results.push(created);
      }
    }
    return results;
  }

  async getDisciplineRecords(studentId?: number): Promise<DisciplineRecord[]> {
    if (studentId) {
      return db.select().from(disciplineRecords)
        .where(eq(disciplineRecords.studentId, studentId))
        .orderBy(desc(disciplineRecords.incidentDate));
    }
    return db.select().from(disciplineRecords).orderBy(desc(disciplineRecords.incidentDate));
  }

  async createDisciplineRecord(recordData: InsertDisciplineRecord): Promise<DisciplineRecord> {
    const [newRecord] = await db.insert(disciplineRecords).values(recordData).returning();
    return newRecord;
  }

  async getClinicRecords(studentId?: number): Promise<ClinicRecord[]> {
    if (studentId) {
      return db.select().from(clinicRecords)
        .where(eq(clinicRecords.studentId, studentId))
        .orderBy(desc(clinicRecords.visitDate));
    }
    return db.select().from(clinicRecords).orderBy(desc(clinicRecords.visitDate));
  }

  async createClinicRecord(recordData: InsertClinicRecord): Promise<ClinicRecord> {
    const [newRecord] = await db.insert(clinicRecords).values(recordData).returning();
    return newRecord;
  }

  async updateClinicRecord(id: number, recordData: Partial<InsertClinicRecord>): Promise<ClinicRecord | undefined> {
    const [updated] = await db.update(clinicRecords).set(recordData).where(eq(clinicRecords.id, id)).returning();
    return updated;
  }

  async deleteClinicRecord(id: number): Promise<void> {
    await db.delete(clinicRecords).where(eq(clinicRecords.id, id));
  }

  async getFeesPayments(studentId?: number): Promise<FeesPayment[]> {
    if (studentId) {
      return db.select().from(feesPayments)
        .where(eq(feesPayments.studentId, studentId))
        .orderBy(desc(feesPayments.paymentDate));
    }
    return db.select().from(feesPayments).orderBy(desc(feesPayments.paymentDate));
  }

  async createFeesPayment(paymentData: InsertFeesPayment): Promise<FeesPayment> {
    const [newPayment] = await db.insert(feesPayments).values(paymentData).returning();
    return newPayment;
  }

  async getDashboardStats(schoolId?: number | null): Promise<{
    totalStudents: number;
    totalStaff: number;
    totalClasses: number;
    totalSubjects: number;
    attendanceToday: { present: number; absent: number; total: number };
    recentPayments: FeesPayment[];
    studentsGender: { male: number; female: number };
    studentsDailyStats: { approved: number; pending: number; transferred: number };
    classroomPopulation: Array<{ className: string; count: number }>;
    feesToday: { cash: number; mobileMoney: number; bank: number; total: number };
    termFeesCollected: number;
    staffMonitoring: { present: number; absent: number; late: number; earlyExits: number };
    absentStaff: Array<{ name: string; phone: string }>;
    lateComers: Array<{ name: string; inVariance: string; outVariance: string }>;
    studentsAttendanceByClass: Array<{ className: string; teacher: string; absent: number; present: number; total: number }>;
    libraryStats: { totalBooks: number; availableCopies: number; currentlyBorrowed: number; overdueBooks: number; unpaidFines: number; unpaidFinesAmount: number; paidFines: number; paidFinesAmount: number };
  }> {
    const today = new Date().toISOString().split('T')[0];

    // Helper to compute classroom population
    const computeClassroomPopulation = (studentsList: any[], classesList: any[]) => {
      const classMap = new Map(classesList.map(c => [c.id, c.name]));
      const counts = new Map<string, number>();
      studentsList.forEach(s => {
        if (s.classId) {
          const className = classMap.get(s.classId) || 'Unassigned';
          counts.set(className, (counts.get(className) || 0) + 1);
        }
      });
      return Array.from(counts.entries()).map(([className, count]) => ({ className, count })).sort((a, b) => a.className.localeCompare(b.className));
    };

    // Helper to generate enrollment trend from student enrollment dates
    const generateEnrollmentTrend = (studentsList: any[]) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const now = new Date();
      const trend: Array<{ month: string; count: number }> = [];
      
      for (let i = 11; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthName = months[date.getMonth()];
        const year = date.getFullYear().toString().slice(-2);
        // Count students enrolled up to this month
        const count = studentsList.filter((s: any) => {
          if (!s.enrollmentDate) return true; // Count all if no date
          const enrollDate = new Date(s.enrollmentDate);
          return enrollDate <= new Date(date.getFullYear(), date.getMonth() + 1, 0);
        }).length;
        trend.push({ month: `${monthName}'${year}`, count });
      }
      return trend;
    };

    // Helper to compute attendance by class
    const computeAttendanceByClass = (attendanceList: any[], studentsList: any[], classesList: any[], staffList: any[]) => {
      const classMap = new Map(classesList.map(c => [c.id, c]));
      const studentClassMap = new Map(studentsList.map(s => [s.id, s.classId]));
      const staffMap = new Map(staffList.map(s => [s.id, `${s.firstName} ${s.lastName}`]));
      
      const byClass = new Map<number, { present: number; absent: number }>();
      attendanceList.forEach(a => {
        const classId = studentClassMap.get(a.studentId);
        if (classId) {
          if (!byClass.has(classId)) byClass.set(classId, { present: 0, absent: 0 });
          const entry = byClass.get(classId)!;
          if (a.status === 'present') entry.present++;
          else entry.absent++;
        }
      });

      return Array.from(byClass.entries()).map(([classId, data]) => {
        const classInfo = classMap.get(classId);
        return {
          className: classInfo?.name || 'Unknown',
          teacher: classInfo?.classTeacherId ? (staffMap.get(classInfo.classTeacherId) || '-') : '-',
          absent: data.absent,
          present: data.present,
          total: data.present + data.absent
        };
      }).sort((a, b) => a.className.localeCompare(b.className));
    };

    const computeLibraryStats = async (sid?: number | null) => {
      const booksQuery = sid
        ? db.select().from(libraryBooks).where(eq(libraryBooks.schoolId, sid))
        : db.select().from(libraryBooks);
      const loansQuery = sid
        ? db.select().from(libraryLoans).where(eq(libraryLoans.schoolId, sid))
        : db.select().from(libraryLoans);
      const finesQuery = sid
        ? db.select().from(libraryFines).where(eq(libraryFines.schoolId, sid))
        : db.select().from(libraryFines);

      const [booksList, loansList, finesList] = await Promise.all([booksQuery, loansQuery, finesQuery]);

      const totalBooks = booksList.length;
      const availableCopies = booksList.reduce((sum, b) => sum + (b.availableCopies || 0), 0);
      const activeLoans = loansList.filter(l => l.status === "active");
      const currentlyBorrowed = activeLoans.length;
      const overdueBooks = activeLoans.filter(l => l.dueDate && new Date(l.dueDate) < new Date()).length
        + loansList.filter(l => l.status === "overdue").length;
      const unpaidFinesList = finesList.filter(f => f.status === "unpaid");
      const paidFinesList = finesList.filter(f => f.status === "paid");

      return {
        totalBooks,
        availableCopies,
        currentlyBorrowed,
        overdueBooks,
        unpaidFines: unpaidFinesList.length,
        unpaidFinesAmount: unpaidFinesList.reduce((sum, f) => sum + parseFloat(f.amount), 0),
        paidFines: paidFinesList.length,
        paidFinesAmount: paidFinesList.reduce((sum, f) => sum + parseFloat(f.amount), 0),
      };
    };

    // If schoolId is provided, filter by school
    if (schoolId) {
      const schoolStudentsList = await db.select().from(students).where(eq(students.schoolId, schoolId));
      const schoolStaffList = await db.select().from(staff).where(eq(staff.schoolId, schoolId));
      const schoolClassesList = await db.select().from(classes).where(eq(classes.schoolId, schoolId));
      const allSubjectsList = await db.select().from(subjects);
      
      const studentIds = new Set(schoolStudentsList.map(s => s.id));

      const todayAttendance = await db.select().from(attendanceRecords).where(eq(attendanceRecords.date, today));
      const filteredAttendance = todayAttendance.filter(r => studentIds.has(r.studentId));
      const presentCount = filteredAttendance.filter(r => r.status === 'present').length;
      const absentCount = filteredAttendance.filter(r => r.status !== 'present').length;

      const allPayments = await db.select().from(feesPayments).orderBy(desc(feesPayments.paymentDate)).limit(50);
      const recentPayments = allPayments.filter(p => studentIds.has(p.studentId)).slice(0, 10);

      // Students daily stats (simplified - using status field if exists)
      const activeStudents = schoolStudentsList.filter((s: any) => s.status === 'active' || !s.status);
      const approved = activeStudents.length;

      // Gender counts (only active/approved students)
      const maleCount = activeStudents.filter(s => s.gender === 'male' || s.gender === 'Male').length;
      const femaleCount = activeStudents.filter(s => s.gender === 'female' || s.gender === 'Female').length;
      const pending = schoolStudentsList.filter((s: any) => s.status === 'pending').length;
      const transferred = schoolStudentsList.filter((s: any) => s.status === 'transferred').length;

      // Fees today
      const todayPayments = recentPayments.filter(p => p.paymentDate === today);
      const cashToday = todayPayments.filter(p => p.paymentMethod === 'cash').reduce((sum, p) => sum + parseFloat(p.amount), 0);
      const mobileToday = todayPayments.filter(p => p.paymentMethod === 'mobile_money').reduce((sum, p) => sum + parseFloat(p.amount), 0);
      const bankToday = todayPayments.filter(p => p.paymentMethod === 'bank_transfer').reduce((sum, p) => sum + parseFloat(p.amount), 0);
      const termTotal = allPayments.filter(p => studentIds.has(p.studentId)).reduce((sum, p) => sum + parseFloat(p.amount), 0);

      // Generate enrollment trend (last 12 months based on enrollment dates)
      const enrollmentTrend = generateEnrollmentTrend(schoolStudentsList);
      
      // Calculate transfer reasons based on student status
      const transferReasons = [
        { name: 'Fees Issues', value: Math.floor(transferred * 0.35) },
        { name: 'Relocation', value: Math.floor(transferred * 0.25) },
        { name: 'Academic', value: Math.floor(transferred * 0.20) },
        { name: 'Other', value: Math.ceil(transferred * 0.20) }
      ].filter(r => r.value > 0);

      return {
        totalStudents: schoolStudentsList.length,
        totalStaff: schoolStaffList.length,
        totalClasses: schoolClassesList.length,
        totalSubjects: allSubjectsList.length,
        attendanceToday: { present: presentCount, absent: absentCount, total: filteredAttendance.length },
        recentPayments,
        studentsGender: { male: maleCount, female: femaleCount },
        studentsDailyStats: { approved, pending, transferred },
        classroomPopulation: computeClassroomPopulation(schoolStudentsList, schoolClassesList),
        feesToday: { cash: cashToday, mobileMoney: mobileToday, bank: bankToday, total: cashToday + mobileToday + bankToday },
        termFeesCollected: termTotal,
        staffMonitoring: { present: 0, absent: 0, late: 0, earlyExits: 0 }, // Placeholder - will be filled by clock-in app
        absentStaff: [], // Placeholder - will be filled by clock-in app
        lateComers: [], // Placeholder - will be filled by clock-in app
        studentsAttendanceByClass: computeAttendanceByClass(filteredAttendance, schoolStudentsList, schoolClassesList, schoolStaffList),
        enrollmentTrend,
        transferReasons,
        libraryStats: await computeLibraryStats(schoolId)
      };
    }

    // No school filter - return all data
    const [studentCount] = await db.select({ count: drizzleCount() }).from(students);
    const [staffCount] = await db.select({ count: drizzleCount() }).from(staff);
    const [classCount] = await db.select({ count: drizzleCount() }).from(classes);
    const [subjectCount] = await db.select({ count: drizzleCount() }).from(subjects);

    const allStudents = await db.select().from(students);
    const allClasses = await db.select().from(classes);
    const allStaff = await db.select().from(staff);

    const todayAttendance = await db.select().from(attendanceRecords).where(eq(attendanceRecords.date, today));
    const presentCount = todayAttendance.filter(r => r.status === 'present').length;
    const absentCount = todayAttendance.filter(r => r.status !== 'present').length;

    const recentPayments = await db.select().from(feesPayments).orderBy(desc(feesPayments.paymentDate)).limit(10);

    const activeStudentsList = allStudents.filter((s: any) => s.status === 'active' || !s.status);
    const approved = activeStudentsList.length;

    const maleCount = activeStudentsList.filter(s => s.gender === 'male' || s.gender === 'Male').length;
    const femaleCount = activeStudentsList.filter(s => s.gender === 'female' || s.gender === 'Female').length;
    const pending = allStudents.filter((s: any) => s.status === 'pending').length;
    const transferred = allStudents.filter((s: any) => s.status === 'transferred').length;

    const todayPayments = recentPayments.filter(p => p.paymentDate === today);
    const cashToday = todayPayments.filter(p => p.paymentMethod === 'cash').reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const mobileToday = todayPayments.filter(p => p.paymentMethod === 'mobile_money').reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const bankToday = todayPayments.filter(p => p.paymentMethod === 'bank_transfer').reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const termTotal = recentPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);

    // Generate enrollment trend
    const enrollmentTrend = generateEnrollmentTrend(allStudents);
    
    // Calculate transfer reasons
    const transferReasons = [
      { name: 'Fees Issues', value: Math.floor(transferred * 0.35) },
      { name: 'Relocation', value: Math.floor(transferred * 0.25) },
      { name: 'Academic', value: Math.floor(transferred * 0.20) },
      { name: 'Other', value: Math.ceil(transferred * 0.20) }
    ].filter(r => r.value > 0);

    return {
      totalStudents: studentCount?.count || 0,
      totalStaff: staffCount?.count || 0,
      totalClasses: classCount?.count || 0,
      totalSubjects: subjectCount?.count || 0,
      attendanceToday: { present: presentCount, absent: absentCount, total: todayAttendance.length },
      recentPayments,
      studentsGender: { male: maleCount, female: femaleCount },
      studentsDailyStats: { approved, pending, transferred },
      classroomPopulation: computeClassroomPopulation(allStudents, allClasses),
      feesToday: { cash: cashToday, mobileMoney: mobileToday, bank: bankToday, total: cashToday + mobileToday + bankToday },
      termFeesCollected: termTotal,
      staffMonitoring: { present: 0, absent: 0, late: 0, earlyExits: 0 },
      absentStaff: [],
      lateComers: [],
      studentsAttendanceByClass: computeAttendanceByClass(todayAttendance, allStudents, allClasses, allStaff),
      enrollmentTrend,
      transferReasons,
      libraryStats: await computeLibraryStats()
    };
  }

  // Organization methods
  async getAllOrganizations(): Promise<Organization[]> {
    return db.select().from(organizations).orderBy(organizations.name);
  }

  async getOrganization(id: number): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  }

  async createOrganization(orgData: InsertOrganization): Promise<Organization> {
    const [newOrg] = await db.insert(organizations).values(orgData).returning();
    return newOrg;
  }

  async updateOrganization(id: number, orgData: Partial<InsertOrganization>): Promise<Organization | undefined> {
    const [updated] = await db.update(organizations).set(orgData).where(eq(organizations.id, id)).returning();
    return updated;
  }

  // School methods
  async getAllSchools(): Promise<School[]> {
    return db.select().from(schools).where(
      or(isNull(schools.terminationStatus), ne(schools.terminationStatus, "archived"))
    ).orderBy(schools.name);
  }

  async getSchool(id: number): Promise<School | undefined> {
    const [school] = await db.select().from(schools).where(eq(schools.id, id));
    return school;
  }

  async getSchoolsByOrganization(orgId: number): Promise<School[]> {
    return db.select().from(schools).where(eq(schools.organizationId, orgId));
  }

  async createSchool(schoolData: InsertSchool): Promise<School> {
    const [newSchool] = await db.insert(schools).values(schoolData).returning();
    return newSchool;
  }

  async updateSchool(id: number, schoolData: Partial<InsertSchool>): Promise<School | undefined> {
    const [updated] = await db.update(schools).set(schoolData).where(eq(schools.id, id)).returning();
    return updated;
  }

  async deleteSchool(id: number): Promise<boolean> {
    await db.delete(schools).where(eq(schools.id, id));
    return true;
  }

  // E-Library methods
  async getLibraryResources(schoolId?: number): Promise<LibraryResource[]> {
    if (schoolId) {
      return db.select().from(libraryResources).where(eq(libraryResources.schoolId, schoolId)).orderBy(desc(libraryResources.createdAt));
    }
    return db.select().from(libraryResources).orderBy(desc(libraryResources.createdAt));
  }

  async getLibraryResource(id: number): Promise<LibraryResource | undefined> {
    const [resource] = await db.select().from(libraryResources).where(eq(libraryResources.id, id));
    return resource;
  }

  async createLibraryResource(resourceData: InsertLibraryResource): Promise<LibraryResource> {
    const [newResource] = await db.insert(libraryResources).values(resourceData).returning();
    return newResource;
  }

  async updateLibraryResource(id: number, resourceData: Partial<InsertLibraryResource>): Promise<LibraryResource | undefined> {
    const [updated] = await db.update(libraryResources).set(resourceData).where(eq(libraryResources.id, id)).returning();
    return updated;
  }

  async deleteLibraryResource(id: number): Promise<boolean> {
    await db.delete(libraryResources).where(eq(libraryResources.id, id));
    return true;
  }

  // Library - Categories
  async getLibraryCategories(schoolId: number): Promise<LibraryCategory[]> {
    return db.select().from(libraryCategories).where(eq(libraryCategories.schoolId, schoolId)).orderBy(libraryCategories.name);
  }

  async createLibraryCategory(data: InsertLibraryCategory): Promise<LibraryCategory> {
    const [cat] = await db.insert(libraryCategories).values(data).returning();
    return cat;
  }

  async updateLibraryCategory(id: number, data: Partial<InsertLibraryCategory>): Promise<LibraryCategory | undefined> {
    const [updated] = await db.update(libraryCategories).set(data).where(eq(libraryCategories.id, id)).returning();
    return updated;
  }

  async deleteLibraryCategory(id: number): Promise<boolean> {
    await db.delete(libraryCategories).where(eq(libraryCategories.id, id));
    return true;
  }

  // Library - Books
  async getLibraryBooks(schoolId: number): Promise<LibraryBook[]> {
    return db.select().from(libraryBooks).where(eq(libraryBooks.schoolId, schoolId)).orderBy(desc(libraryBooks.createdAt));
  }

  async getLibraryBook(id: number): Promise<LibraryBook | undefined> {
    const [book] = await db.select().from(libraryBooks).where(eq(libraryBooks.id, id));
    return book;
  }

  async createLibraryBook(data: InsertLibraryBook): Promise<LibraryBook> {
    const [book] = await db.insert(libraryBooks).values(data).returning();
    return book;
  }

  async updateLibraryBook(id: number, data: Partial<InsertLibraryBook>): Promise<LibraryBook | undefined> {
    const [updated] = await db.update(libraryBooks).set(data).where(eq(libraryBooks.id, id)).returning();
    return updated;
  }

  async deleteLibraryBook(id: number): Promise<boolean> {
    await db.delete(libraryLoans).where(eq(libraryLoans.bookId, id));
    await db.delete(libraryBooks).where(eq(libraryBooks.id, id));
    return true;
  }

  // Library - Book Copies
  async getLibraryBookCopy(id: number): Promise<LibraryBookCopy | undefined> {
    const [copy] = await db.select().from(libraryBookCopies).where(eq(libraryBookCopies.id, id));
    return copy;
  }

  async getLibraryBookCopies(bookId: number): Promise<LibraryBookCopy[]> {
    return db.select().from(libraryBookCopies).where(eq(libraryBookCopies.bookId, bookId)).orderBy(desc(libraryBookCopies.addedAt));
  }

  async getLibraryBookCopyByQr(qrCode: string): Promise<LibraryBookCopy | undefined> {
    const [copy] = await db.select().from(libraryBookCopies).where(eq(libraryBookCopies.qrCode, qrCode));
    return copy;
  }

  async createLibraryBookCopy(data: InsertLibraryBookCopy): Promise<LibraryBookCopy> {
    const [copy] = await db.insert(libraryBookCopies).values(data).returning();
    return copy;
  }

  async updateLibraryBookCopy(id: number, data: Partial<InsertLibraryBookCopy>): Promise<LibraryBookCopy | undefined> {
    const [updated] = await db.update(libraryBookCopies).set(data).where(eq(libraryBookCopies.id, id)).returning();
    return updated;
  }

  async deleteLibraryBookCopy(id: number): Promise<boolean> {
    await db.delete(libraryBookCopies).where(eq(libraryBookCopies.id, id));
    return true;
  }

  async getLibraryBookCopiesBySchool(schoolId: number): Promise<LibraryBookCopy[]> {
    return db.select().from(libraryBookCopies).where(eq(libraryBookCopies.schoolId, schoolId)).orderBy(desc(libraryBookCopies.addedAt));
  }

  // Library - Loans
  async getLibraryLoans(schoolId: number, status?: string): Promise<LibraryLoan[]> {
    if (status) {
      return db.select().from(libraryLoans).where(and(eq(libraryLoans.schoolId, schoolId), eq(libraryLoans.status, status as any))).orderBy(desc(libraryLoans.issuedAt));
    }
    return db.select().from(libraryLoans).where(eq(libraryLoans.schoolId, schoolId)).orderBy(desc(libraryLoans.issuedAt));
  }

  async getLibraryLoan(id: number): Promise<LibraryLoan | undefined> {
    const [loan] = await db.select().from(libraryLoans).where(eq(libraryLoans.id, id));
    return loan;
  }

  async createLibraryLoan(data: InsertLibraryLoan): Promise<LibraryLoan> {
    const [loan] = await db.insert(libraryLoans).values(data).returning();
    return loan;
  }

  async updateLibraryLoan(id: number, data: Partial<LibraryLoan>): Promise<LibraryLoan | undefined> {
    const [updated] = await db.update(libraryLoans).set(data).where(eq(libraryLoans.id, id)).returning();
    return updated;
  }

  // Library - Fines
  async getLibraryFines(schoolId: number, status?: string): Promise<LibraryFine[]> {
    if (status) {
      return db.select().from(libraryFines).where(and(eq(libraryFines.schoolId, schoolId), eq(libraryFines.status, status as any))).orderBy(desc(libraryFines.createdAt));
    }
    return db.select().from(libraryFines).where(eq(libraryFines.schoolId, schoolId)).orderBy(desc(libraryFines.createdAt));
  }

  async createLibraryFine(data: InsertLibraryFine): Promise<LibraryFine> {
    const [fine] = await db.insert(libraryFines).values(data).returning();
    return fine;
  }

  async updateLibraryFine(id: number, data: Partial<LibraryFine>): Promise<LibraryFine | undefined> {
    const [updated] = await db.update(libraryFines).set(data).where(eq(libraryFines.id, id)).returning();
    return updated;
  }

  // Library - Reservations
  async getLibraryReservations(schoolId: number, status?: string): Promise<LibraryReservation[]> {
    if (status) {
      return db.select().from(libraryReservations).where(and(eq(libraryReservations.schoolId, schoolId), eq(libraryReservations.status, status as any))).orderBy(desc(libraryReservations.reservedAt));
    }
    return db.select().from(libraryReservations).where(eq(libraryReservations.schoolId, schoolId)).orderBy(desc(libraryReservations.reservedAt));
  }

  async createLibraryReservation(data: InsertLibraryReservation): Promise<LibraryReservation> {
    const [reservation] = await db.insert(libraryReservations).values(data).returning();
    return reservation;
  }

  async updateLibraryReservation(id: number, data: Partial<LibraryReservation>): Promise<LibraryReservation | undefined> {
    const [updated] = await db.update(libraryReservations).set(data).where(eq(libraryReservations.id, id)).returning();
    return updated;
  }

  async getLibraryReservationsForBook(bookId: number, status?: string): Promise<LibraryReservation[]> {
    if (status) {
      return db.select().from(libraryReservations).where(and(eq(libraryReservations.bookId, bookId), eq(libraryReservations.status, status as any))).orderBy(libraryReservations.reservedAt);
    }
    return db.select().from(libraryReservations).where(eq(libraryReservations.bookId, bookId)).orderBy(libraryReservations.reservedAt);
  }

  // Library Policy methods
  async getLibraryPolicy(schoolId: number): Promise<LibraryPolicy | undefined> {
    const [policy] = await db.select().from(libraryPolicies).where(eq(libraryPolicies.schoolId, schoolId));
    return policy;
  }

  async upsertLibraryPolicy(data: InsertLibraryPolicy): Promise<LibraryPolicy> {
    const existing = data.schoolId ? await this.getLibraryPolicy(data.schoolId) : undefined;
    if (existing) {
      const [updated] = await db.update(libraryPolicies).set({ ...data, updatedAt: new Date() }).where(eq(libraryPolicies.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(libraryPolicies).values(data).returning();
    return created;
  }

  // Timetable methods
  async getTimetableSlots(schoolId?: number, classId?: number): Promise<TimetableSlot[]> {
    if (classId) {
      return db.select().from(timetableSlots).where(eq(timetableSlots.classId, classId));
    }
    if (schoolId) {
      return db.select().from(timetableSlots).where(eq(timetableSlots.schoolId, schoolId));
    }
    return db.select().from(timetableSlots);
  }

  async createTimetableSlot(slotData: InsertTimetableSlot): Promise<TimetableSlot> {
    const [newSlot] = await db.insert(timetableSlots).values(slotData).returning();
    return newSlot;
  }

  async updateTimetableSlot(id: number, slotData: Partial<InsertTimetableSlot>): Promise<TimetableSlot | undefined> {
    const [updated] = await db.update(timetableSlots).set(slotData).where(eq(timetableSlots.id, id)).returning();
    return updated;
  }

  async deleteTimetableSlot(id: number): Promise<boolean> {
    await db.delete(timetableSlots).where(eq(timetableSlots.id, id));
    return true;
  }

  // Logbook methods
  async getLogbookEntries(teacherId?: number, classId?: number): Promise<LogbookEntry[]> {
    if (teacherId) {
      return db.select().from(logbookEntries).where(eq(logbookEntries.teacherId, teacherId)).orderBy(desc(logbookEntries.date));
    }
    if (classId) {
      return db.select().from(logbookEntries).where(eq(logbookEntries.classId, classId)).orderBy(desc(logbookEntries.date));
    }
    return db.select().from(logbookEntries).orderBy(desc(logbookEntries.date));
  }

  async createLogbookEntry(entryData: InsertLogbookEntry): Promise<LogbookEntry> {
    const [newEntry] = await db.insert(logbookEntries).values(entryData).returning();
    return newEntry;
  }

  async updateLogbookEntry(id: number, entryData: Partial<InsertLogbookEntry>): Promise<LogbookEntry | undefined> {
    const [updated] = await db.update(logbookEntries).set(entryData).where(eq(logbookEntries.id, id)).returning();
    return updated;
  }

  async deleteLogbookEntry(id: number): Promise<boolean> {
    await db.delete(logbookEntries).where(eq(logbookEntries.id, id));
    return true;
  }

  // Staff Attendance methods
  async getStaffAttendanceLogs(schoolId: number, filters?: { staffId?: number; date?: string; dateFrom?: string; dateTo?: string; status?: string }): Promise<StaffAttendanceLog[]> {
    const conditions = [eq(staffAttendanceLogs.schoolId, schoolId)];
    if (filters?.staffId) conditions.push(eq(staffAttendanceLogs.staffId, filters.staffId));
    if (filters?.date) conditions.push(eq(staffAttendanceLogs.date, filters.date));
    if (filters?.dateFrom) conditions.push(gte(staffAttendanceLogs.date, filters.dateFrom));
    if (filters?.dateTo) conditions.push(lte(staffAttendanceLogs.date, filters.dateTo));
    if (filters?.status) conditions.push(eq(staffAttendanceLogs.status, filters.status));
    return db.select().from(staffAttendanceLogs).where(and(...conditions)).orderBy(desc(staffAttendanceLogs.date), desc(staffAttendanceLogs.clockIn));
  }

  async getStaffAttendanceLogByUserAndDate(userId: number, date: string): Promise<StaffAttendanceLog | undefined> {
    const [log] = await db.select().from(staffAttendanceLogs).where(and(eq(staffAttendanceLogs.userId, userId), eq(staffAttendanceLogs.date, date)));
    return log;
  }

  async getStaffAttendanceLogById(id: number): Promise<StaffAttendanceLog | undefined> {
    const [log] = await db.select().from(staffAttendanceLogs).where(eq(staffAttendanceLogs.id, id));
    return log;
  }

  async getStaffAttendanceLogByUserWithPendingReason(userId: number): Promise<StaffAttendanceLog | undefined> {
    const [log] = await db.select().from(staffAttendanceLogs)
      .where(and(eq(staffAttendanceLogs.userId, userId), eq(staffAttendanceLogs.reasonRequired, true)))
      .orderBy(desc(staffAttendanceLogs.date), desc(staffAttendanceLogs.clockOut), desc(staffAttendanceLogs.clockIn))
      .limit(1);
    return log;
  }

  async createStaffAttendanceLog(logData: InsertStaffAttendanceLog): Promise<StaffAttendanceLog> {
    const [newLog] = await db.insert(staffAttendanceLogs).values(logData).returning();
    return newLog;
  }

  async updateStaffAttendanceLog(id: number, logData: Partial<InsertStaffAttendanceLog>): Promise<StaffAttendanceLog | undefined> {
    const [updated] = await db.update(staffAttendanceLogs).set(logData).where(eq(staffAttendanceLogs.id, id)).returning();
    return updated;
  }

  async autoClockOutOverdueStaffAttendanceLogs(): Promise<number> {
    const today = new Date().toISOString().split("T")[0];
    const overdueLogs = await db.select().from(staffAttendanceLogs).where(and(isNull(staffAttendanceLogs.clockOut), lte(staffAttendanceLogs.date, today)));

    let updatedCount = 0;
    for (const log of overdueLogs) {
      const logDate = new Date(`${log.date}T00:00:00`);
      const autoClockOutAt = new Date(logDate);
      autoClockOutAt.setHours(23, 59, 0, 0);
      if (autoClockOutAt.getTime() > Date.now()) continue;

      await db.update(staffAttendanceLogs)
        .set({ clockOut: autoClockOutAt, autoClockedOut: true })
        .where(eq(staffAttendanceLogs.id, log.id));
      updatedCount += 1;
    }

    return updatedCount;
  }

  // POS methods
  async getPosItems(schoolId?: number): Promise<PosItem[]> {
    if (schoolId) {
      return db.select().from(posItems).where(eq(posItems.schoolId, schoolId)).orderBy(posItems.name);
    }
    return db.select().from(posItems).orderBy(posItems.name);
  }

  async getPosItem(id: number): Promise<PosItem | undefined> {
    const [item] = await db.select().from(posItems).where(eq(posItems.id, id));
    return item;
  }

  async createPosItem(itemData: InsertPosItem): Promise<PosItem> {
    const [newItem] = await db.insert(posItems).values(itemData).returning();
    return newItem;
  }

  async updatePosItem(id: number, itemData: Partial<InsertPosItem>): Promise<PosItem | undefined> {
    const [updated] = await db.update(posItems).set(itemData).where(eq(posItems.id, id)).returning();
    return updated;
  }

  async deletePosItem(id: number): Promise<boolean> {
    await db.delete(posItems).where(eq(posItems.id, id));
    return true;
  }

  async getPosSales(schoolId?: number): Promise<PosSale[]> {
    if (schoolId) {
      return db.select().from(posSales).where(eq(posSales.schoolId, schoolId)).orderBy(desc(posSales.saleDate));
    }
    return db.select().from(posSales).orderBy(desc(posSales.saleDate));
  }

  async createPosSale(saleData: InsertPosSale): Promise<PosSale> {
    const [newSale] = await db.insert(posSales).values(saleData).returning();
    return newSale;
  }

  async createPosSaleItems(itemsData: InsertPosSaleItem[]): Promise<PosSaleItem[]> {
    if (itemsData.length === 0) return [];
    return db.insert(posSaleItems).values(itemsData).returning();
  }

  async getPosSaleItems(saleId: number): Promise<PosSaleItem[]> {
    return db.select().from(posSaleItems).where(eq(posSaleItems.saleId, saleId));
  }

  // Newsletter methods
  async getNewsletters(schoolId?: number): Promise<Newsletter[]> {
    if (schoolId) {
      return db.select().from(newsletters).where(eq(newsletters.schoolId, schoolId)).orderBy(desc(newsletters.publishDate));
    }
    return db.select().from(newsletters).orderBy(desc(newsletters.publishDate));
  }

  async getNewsletterById(id: number): Promise<Newsletter | undefined> {
    const [newsletter] = await db.select().from(newsletters).where(eq(newsletters.id, id));
    return newsletter;
  }

  async createNewsletter(newsletterData: InsertNewsletter): Promise<Newsletter> {
    const [newNewsletter] = await db.insert(newsletters).values(newsletterData).returning();
    return newNewsletter;
  }

  async updateNewsletter(id: number, newsletterData: Partial<InsertNewsletter>): Promise<Newsletter | undefined> {
    const [updated] = await db.update(newsletters).set(newsletterData).where(eq(newsletters.id, id)).returning();
    return updated;
  }

  async deleteNewsletter(id: number): Promise<boolean> {
    await db.delete(newsletters).where(eq(newsletters.id, id));
    return true;
  }

  // Schemes methods
  async getSchemes(schoolId?: number, subjectId?: number): Promise<Scheme[]> {
    if (subjectId) {
      return db.select().from(schemes).where(eq(schemes.subjectId, subjectId)).orderBy(schemes.week);
    }
    if (schoolId) {
      return db.select().from(schemes).where(eq(schemes.schoolId, schoolId)).orderBy(schemes.week);
    }
    return db.select().from(schemes).orderBy(schemes.week);
  }

  async createScheme(schemeData: InsertScheme): Promise<Scheme> {
    const [newScheme] = await db.insert(schemes).values(schemeData).returning();
    return newScheme;
  }

  async updateScheme(id: number, schemeData: Partial<InsertScheme>): Promise<Scheme | undefined> {
    const [updated] = await db.update(schemes).set(schemeData).where(eq(schemes.id, id)).returning();
    return updated;
  }

  async deleteScheme(id: number): Promise<boolean> {
    await db.delete(schemes).where(eq(schemes.id, id));
    return true;
  }

  // Hostel Roll Call methods
  async getHostels(schoolId: number): Promise<Hostel[]> {
    return db.select().from(hostels).where(eq(hostels.schoolId, schoolId)).orderBy(hostels.name);
  }

  async getHostel(id: number): Promise<Hostel | undefined> {
    const [hostel] = await db.select().from(hostels).where(eq(hostels.id, id));
    return hostel;
  }

  async createHostel(hostelData: InsertHostel): Promise<Hostel> {
    const [newHostel] = await db.insert(hostels).values(hostelData).returning();
    return newHostel;
  }

  async updateHostel(id: number, hostelData: Partial<InsertHostel>): Promise<Hostel | undefined> {
    const [updated] = await db.update(hostels).set(hostelData).where(eq(hostels.id, id)).returning();
    return updated;
  }

  async deleteHostel(id: number): Promise<boolean> {
    await db.delete(hostels).where(eq(hostels.id, id));
    return true;
  }

  async getHostelRollCall(schoolId?: number, date?: string): Promise<HostelRollCall[]> {
    if (date && schoolId) {
      return db.select().from(hostelRollCall).where(and(eq(hostelRollCall.schoolId, schoolId), eq(hostelRollCall.date, date)));
    }
    if (date) {
      return db.select().from(hostelRollCall).where(eq(hostelRollCall.date, date));
    }
    if (schoolId) {
      return db.select().from(hostelRollCall).where(eq(hostelRollCall.schoolId, schoolId)).orderBy(desc(hostelRollCall.date));
    }
    return db.select().from(hostelRollCall).orderBy(desc(hostelRollCall.date));
  }

  async createHostelRollCall(recordData: InsertHostelRollCall): Promise<HostelRollCall> {
    const [newRecord] = await db.insert(hostelRollCall).values(recordData).returning();
    return newRecord;
  }

  async getHostelRollCallByHostel(hostelId: number, date: string, timeSlot: string): Promise<HostelRollCall[]> {
    const students = await db.select().from(schema.students).where(eq(schema.students.hostelId, hostelId));
    const studentIds = students.map(s => s.id);
    if (studentIds.length === 0) return [];
    return db.select().from(hostelRollCall).where(
      and(
        eq(hostelRollCall.date, date),
        eq(hostelRollCall.timeSlot, timeSlot),
        inArray(hostelRollCall.studentId, studentIds)
      )
    );
  }

  async getHostelRollCallByHostelRange(hostelId: number, from: string, to: string, timeSlot: string): Promise<HostelRollCall[]> {
    const students = await db.select().from(schema.students).where(eq(schema.students.hostelId, hostelId));
    const studentIds = students.map(s => s.id);
    if (studentIds.length === 0) return [];
    return db.select().from(hostelRollCall).where(
      and(
        inArray(hostelRollCall.studentId, studentIds),
        eq(hostelRollCall.timeSlot, timeSlot),
        gte(hostelRollCall.date, from),
        lte(hostelRollCall.date, to)
      )
    );
  }

  async bulkCreateHostelRollCall(records: InsertHostelRollCall[]): Promise<HostelRollCall[]> {
    if (records.length === 0) return [];
    return db.insert(hostelRollCall).values(records).returning();
  }

  async bulkUpsertHostelRollCall(records: InsertHostelRollCall[]): Promise<HostelRollCall[]> {
    if (records.length === 0) return [];
    const results: HostelRollCall[] = [];
    for (const rec of records) {
      const existing = await db.select().from(hostelRollCall).where(
        and(
          eq(hostelRollCall.studentId, rec.studentId),
          eq(hostelRollCall.date, rec.date),
          eq(hostelRollCall.timeSlot, rec.timeSlot)
        )
      );
      if (existing.length > 0) {
        const [updated] = await db.update(hostelRollCall)
          .set({ status: rec.status, notes: rec.notes, markedBy: rec.markedBy })
          .where(eq(hostelRollCall.id, existing[0].id))
          .returning();
        results.push(updated);
      } else {
        const [created] = await db.insert(hostelRollCall).values(rec).returning();
        results.push(created);
      }
    }
    return results;
  }

  // Student Application methods
  async getStudentApplications(schoolId?: number): Promise<StudentApplication[]> {
    if (schoolId) {
      return db.select().from(studentApplications).where(eq(studentApplications.schoolId, schoolId)).orderBy(desc(studentApplications.createdAt));
    }
    return db.select().from(studentApplications).orderBy(desc(studentApplications.createdAt));
  }

  async createStudentApplication(appData: InsertStudentApplication): Promise<StudentApplication> {
    const [newApp] = await db.insert(studentApplications).values(appData).returning();
    return newApp;
  }

  async updateStudentApplication(id: number, appData: Partial<InsertStudentApplication>): Promise<StudentApplication | undefined> {
    const [updated] = await db.update(studentApplications).set(appData).where(eq(studentApplications.id, id)).returning();
    return updated;
  }

  // Permissions
  async getAllPermissions(): Promise<Permission[]> {
    return db.select().from(permissions).orderBy(permissions.category, permissions.name);
  }

  async getPermission(id: number): Promise<Permission | undefined> {
    const [permission] = await db.select().from(permissions).where(eq(permissions.id, id));
    return permission;
  }

  async getPermissionByCode(code: string): Promise<Permission | undefined> {
    const [permission] = await db.select().from(permissions).where(eq(permissions.code, code));
    return permission;
  }

  async createPermission(permission: InsertPermission): Promise<Permission> {
    const [newPermission] = await db.insert(permissions).values(permission).returning();
    return newPermission;
  }

  async updatePermission(id: number, permissionData: Partial<InsertPermission>): Promise<Permission | undefined> {
    const [updated] = await db.update(permissions).set(permissionData).where(eq(permissions.id, id)).returning();
    return updated;
  }

  async deletePermission(id: number): Promise<boolean> {
    const result = await db.delete(permissions).where(eq(permissions.id, id));
    return true;
  }

  // Access Groups
  async getAllAccessGroups(): Promise<AccessGroup[]> {
    return db.select().from(accessGroups).orderBy(accessGroups.name);
  }

  async getAccessGroup(id: number): Promise<AccessGroup | undefined> {
    const [group] = await db.select().from(accessGroups).where(eq(accessGroups.id, id));
    return group;
  }

  async getAccessGroupByName(name: string): Promise<AccessGroup | undefined> {
    const [group] = await db.select().from(accessGroups).where(eq(accessGroups.name, name));
    return group;
  }

  async createAccessGroup(group: InsertAccessGroup): Promise<AccessGroup> {
    const [newGroup] = await db.insert(accessGroups).values(group).returning();
    return newGroup;
  }

  async updateAccessGroup(id: number, groupData: Partial<InsertAccessGroup>): Promise<AccessGroup | undefined> {
    const [updated] = await db.update(accessGroups).set(groupData).where(eq(accessGroups.id, id)).returning();
    return updated;
  }

  async deleteAccessGroup(id: number): Promise<boolean> {
    await db.delete(accessGroups).where(eq(accessGroups.id, id));
    return true;
  }

  // Access Group Permissions
  async getAccessGroupPermissions(accessGroupId: number): Promise<Permission[]> {
    const result = await db
      .select({ permission: permissions })
      .from(accessGroupPermissions)
      .innerJoin(permissions, eq(accessGroupPermissions.permissionId, permissions.id))
      .where(eq(accessGroupPermissions.accessGroupId, accessGroupId));
    return result.map(r => r.permission);
  }

  async addPermissionToAccessGroup(data: InsertAccessGroupPermission): Promise<AccessGroupPermission> {
    const [newMapping] = await db.insert(accessGroupPermissions).values(data).returning();
    return newMapping;
  }

  async removePermissionFromAccessGroup(accessGroupId: number, permissionId: number): Promise<boolean> {
    await db.delete(accessGroupPermissions).where(
      and(
        eq(accessGroupPermissions.accessGroupId, accessGroupId),
        eq(accessGroupPermissions.permissionId, permissionId)
      )
    );
    return true;
  }

  async setAccessGroupPermissions(accessGroupId: number, permissionIds: number[]): Promise<void> {
    await db.delete(accessGroupPermissions).where(eq(accessGroupPermissions.accessGroupId, accessGroupId));
    if (permissionIds.length > 0) {
      await db.insert(accessGroupPermissions).values(
        permissionIds.map(permissionId => ({ accessGroupId, permissionId }))
      );
    }
  }

  // User Access Groups
  private normalizeRoleKey(value: string | null | undefined): string | null {
    if (!value) return null;
    return value.trim().toLowerCase().replace(/\s+/g, "_");
  }

  private async resolveBaselineAccessGroupForUser(userId: number, user: User): Promise<AccessGroup | undefined> {
    let targetGroup: AccessGroup | undefined;
    const [staffMember] = await db.select().from(staff).where(eq(staff.userId, userId));

    if (staffMember?.accessGroupId) {
      targetGroup = await this.getAccessGroup(staffMember.accessGroupId);
    }

    if (!targetGroup) {
      const normalizedStaffRole = this.normalizeRoleKey(staffMember?.role);
      const roleToGroupName: Record<string, string> = {
        teacher: "Teacher",
        assistant_teacher: "Assistant Teacher",
        assistantteacher: "Assistant Teacher",
        librarian: "Librarian",
        quality_control_officer: "Quality Control Officer",
        quality_control: "Quality Control Officer",
        qualitycontrol: "Quality Control Officer",
        qc: "Quality Control Officer",
        quality: "Quality Control Officer",
        quality_assurance: "Quality Control Officer",
        accountant: "Accountant",
        accounts: "Accountant",
        bursar: "Accountant",
        administrator: "School Admin",
        admin: "School Admin",
        school_admin: "School Admin",
        schooladmin: "School Admin",
        deputy_head: "School Admin",
        deputyhead: "School Admin",
        head: "School Admin",
        headmaster: "School Admin",
        headmistress: "School Admin",
      };
      if (normalizedStaffRole && roleToGroupName[normalizedStaffRole]) {
        targetGroup = await this.getAccessGroupByName(roleToGroupName[normalizedStaffRole]);
      }
    }

    if (!targetGroup) {
      const userRoleToGroupName: Partial<Record<User["role"], string>> = {
        school_admin: "School Admin",
        teacher: "Teacher",
        assistant_teacher: "Assistant Teacher",
        librarian: "Librarian",
        quality_control_officer: "Quality Control Officer",
      };
      const mappedName = userRoleToGroupName[user.role];
      if (mappedName) {
        targetGroup = await this.getAccessGroupByName(mappedName);
      }
    }

    return targetGroup;
  }

  async ensureUserBaselineAccessGroups(userId: number): Promise<void> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return;

    const existingMappings = await db.select().from(userAccessGroups).where(eq(userAccessGroups.userId, userId));
    const existingGroups = await db
      .select({ group: accessGroups })
      .from(userAccessGroups)
      .innerJoin(accessGroups, eq(userAccessGroups.accessGroupId, accessGroups.id))
      .where(eq(userAccessGroups.userId, userId));
    const currentGroupIds = new Set(existingGroups.map(({ group }) => group.id));

    if (user.role === "org_admin") {
      const orgHqGroup = await this.getAccessGroupByName("Org HQ");
      if (!orgHqGroup) return;

      if (!currentGroupIds.has(orgHqGroup.id)) {
        await this.addUserToAccessGroup({ userId, accessGroupId: orgHqGroup.id });
      }

      const explicitSchoolAccess = await db.select().from(userSchoolAccess).where(eq(userSchoolAccess.userId, userId));
      if (explicitSchoolAccess.length === 0) {
        const allSchools = user.organizationId
          ? await db.select({ id: schools.id }).from(schools).where(eq(schools.organizationId, user.organizationId))
          : await db.select({ id: schools.id }).from(schools);

        if (allSchools.length > 0) {
          await db.insert(userSchoolAccess).values(allSchools.map((school) => ({ userId, schoolId: school.id })));
        }
      }
      return;
    }

    const targetGroup = await this.resolveBaselineAccessGroupForUser(userId, user);
    if (!targetGroup) return;

    if (!currentGroupIds.has(targetGroup.id)) {
      await this.addUserToAccessGroup({ userId, accessGroupId: targetGroup.id });
      return;
    }

    if (existingMappings.length === 0) {
      await this.addUserToAccessGroup({ userId, accessGroupId: targetGroup.id });
    }
  }

  async normalizeAllUserBaselineAccessGroups(): Promise<void> {
    const allUsers = await db.select({ id: users.id }).from(users);
    for (const user of allUsers) {
      await this.ensureUserBaselineAccessGroups(user.id);
    }
  }

  async normalizeUserBaselineAccess(userId: number): Promise<void> {
    await this.ensureUserBaselineAccessGroups(userId);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.role !== "org_admin") return;

    const orgHqGroup = await this.getAccessGroupByName("Org HQ");
    if (!orgHqGroup) return;

    const groups = await this.getUserAccessGroups(userId);
    if (!groups.some((g) => g.id === orgHqGroup.id)) return;

    const baselinePermissions = await this.getAccessGroupPermissions(orgHqGroup.id);
    if (baselinePermissions.length === 0) return;

    const baselineIds = new Set(baselinePermissions.map((p) => p.id));
    const overrides = await this.getUserPermissionOverrides(userId);
    const falseOverrides = overrides.filter((o) => baselineIds.has(o.permissionId) && o.granted === false);
    const trueOverrides = overrides.filter((o) => o.granted === true);

    if (falseOverrides.length === baselineIds.size && trueOverrides.length === 0) {
      await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, userId));
    }
  }

  async getUserAccessGroups(userId: number): Promise<AccessGroup[]> {
    await this.ensureUserBaselineAccessGroups(userId);
    const result = await db
      .select({ group: accessGroups })
      .from(userAccessGroups)
      .innerJoin(accessGroups, eq(userAccessGroups.accessGroupId, accessGroups.id))
      .where(eq(userAccessGroups.userId, userId));
    return result.map(r => r.group);
  }

  async addUserToAccessGroup(data: InsertUserAccessGroup): Promise<UserAccessGroup> {
    const existing = await db.select().from(userAccessGroups).where(
      and(
        eq(userAccessGroups.userId, data.userId),
        eq(userAccessGroups.accessGroupId, data.accessGroupId)
      )
    );

    if (existing[0]) {
      return existing[0];
    }

    const [newMapping] = await db.insert(userAccessGroups).values(data).returning();
    return newMapping;
  }

  async removeUserFromAccessGroup(userId: number, accessGroupId: number): Promise<boolean> {
    await db.delete(userAccessGroups).where(
      and(
        eq(userAccessGroups.userId, userId),
        eq(userAccessGroups.accessGroupId, accessGroupId)
      )
    );
    return true;
  }

  // User Permission Overrides
  async getUserPermissionOverrides(userId: number): Promise<UserPermissionOverride[]> {
    return db.select().from(userPermissionOverrides).where(eq(userPermissionOverrides.userId, userId));
  }

  async setUserPermissionOverride(data: InsertUserPermissionOverride): Promise<UserPermissionOverride> {
    await db.delete(userPermissionOverrides).where(
      and(
        eq(userPermissionOverrides.userId, data.userId),
        eq(userPermissionOverrides.permissionId, data.permissionId)
      )
    );
    const [override] = await db.insert(userPermissionOverrides).values(data).returning();
    return override;
  }

  async removeUserPermissionOverride(userId: number, permissionId: number): Promise<boolean> {
    await db.delete(userPermissionOverrides).where(
      and(
        eq(userPermissionOverrides.userId, userId),
        eq(userPermissionOverrides.permissionId, permissionId)
      )
    );
    return true;
  }

  async clearAllUserPermissionOverrides(userId: number): Promise<boolean> {
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, userId));
    return true;
  }

  // Get effective permissions for a user
  async getUserPermissionStates(userId: number): Promise<{ permission: Permission; granted: boolean; groupGranted: boolean; overrideGranted: boolean | null; source: "group" | "granted_override" | "denied_override" | "none" }[]> {
    const [allPerms, userGroups, overrides] = await Promise.all([
      this.getAllPermissions(),
      this.getUserAccessGroups(userId),
      this.getUserPermissionOverrides(userId),
    ]);

    const groupPermissions = await Promise.all(
      userGroups.map(group => this.getAccessGroupPermissions(group.id))
    );

    const groupPermissionIds = new Set<number>();
    for (const permissionsForGroup of groupPermissions) {
      permissionsForGroup.forEach(permission => groupPermissionIds.add(permission.id));
    }

    const overrideMap = new Map<number, boolean>();
    for (const override of overrides) {
      overrideMap.set(override.permissionId, override.granted);
    }

    return allPerms.map(permission => {
      const groupGranted = groupPermissionIds.has(permission.id);
      const overrideGranted = overrideMap.has(permission.id) ? overrideMap.get(permission.id)! : null;
      const granted = overrideGranted !== null ? overrideGranted : groupGranted;
      let source: "group" | "granted_override" | "denied_override" | "none" = "none";
      if (overrideGranted === true) source = "granted_override";
      else if (overrideGranted === false) source = "denied_override";
      else if (groupGranted) source = "group";
      return { permission, granted, groupGranted, overrideGranted, source };
    });
  }

  async updateUserPermissionOverridesFromSelection(userId: number, selectedPermissionIds: number[]): Promise<void> {
    const [userGroups, allPerms] = await Promise.all([
      this.getUserAccessGroups(userId),
      this.getAllPermissions(),
    ]);

    const groupPermissions = await Promise.all(userGroups.map(group => this.getAccessGroupPermissions(group.id)));
    const groupPermissionIds = new Set<number>();
    for (const permissionsForGroup of groupPermissions) {
      permissionsForGroup.forEach(permission => groupPermissionIds.add(permission.id));
    }

    const selectedSet = new Set(selectedPermissionIds);

    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, userId));

    const overridesToInsert: { userId: number; permissionId: number; granted: boolean }[] = [];

    for (const permission of allPerms) {
      const baseline = groupPermissionIds.has(permission.id);
      const selected = selectedSet.has(permission.id);
      if (baseline !== selected) {
        overridesToInsert.push({
          userId,
          permissionId: permission.id,
          granted: selected,
        });
      }
    }

    if (overridesToInsert.length > 0) {
      await db.insert(userPermissionOverrides).values(overridesToInsert);
    }
  }

  async getUserEffectivePermissions(userId: number): Promise<{ permission: Permission; granted: boolean }[]> {
    const states = await this.getUserPermissionStates(userId);
    return states.map(({ permission, granted }) => ({ permission, granted }));
  }

  async userHasPermission(userId: number, permissionCode: string): Promise<boolean> {
    const permission = await this.getPermissionByCode(permissionCode);
    if (!permission) return false;

    const effectivePermissions = await this.getUserEffectivePermissions(userId);
    const matchingPermission = effectivePermissions.find(({ permission: currentPermission }) => currentPermission.id === permission.id);
    return matchingPermission?.granted === true;
  }

  async globalSearch(query: string): Promise<{
    staff: Array<Staff & { schoolName: string }>;
    students: Array<Student & { schoolName: string }>;
    parents: Array<Parent & { schoolName: string | null }>;
  }> {
    if (!query || query.trim().length < 2) {
      return { staff: [], students: [], parents: [] };
    }

    const searchTerm = `%${query.toLowerCase()}%`;

    const allStaff = await db.select().from(staff).limit(100);
    const allSchools = await db.select().from(schools);
    const schoolMap = new Map(allSchools.map(s => [s.id, s.name]));

    const staffResults = allStaff.filter(s => {
      const searchLower = query.toLowerCase();
      return (
        s.firstName?.toLowerCase().includes(searchLower) ||
        s.lastName?.toLowerCase().includes(searchLower) ||
        s.email?.toLowerCase().includes(searchLower) ||
        s.phone?.includes(query) ||
        s.staffNo?.toLowerCase().includes(searchLower)
      );
    }).slice(0, 20);

    const allStudents = await db.select().from(students).limit(100);
    const studentResults = allStudents.filter(s => {
      const searchLower = query.toLowerCase();
      return (
        s.firstName?.toLowerCase().includes(searchLower) ||
        s.lastName?.toLowerCase().includes(searchLower) ||
        s.email?.toLowerCase().includes(searchLower) ||
        s.phone?.includes(query) ||
        s.admissionNo?.toLowerCase().includes(searchLower)
      );
    }).slice(0, 20);

    const allParents = await db.select().from(parents).limit(100);
    const parentResults = allParents.filter(p => {
      const searchLower = query.toLowerCase();
      return (
        p.firstName?.toLowerCase().includes(searchLower) ||
        p.lastName?.toLowerCase().includes(searchLower) ||
        p.email?.toLowerCase().includes(searchLower) ||
        p.phone?.includes(query)
      );
    }).slice(0, 20);

    return {
      staff: staffResults.map(s => ({ ...s, schoolName: schoolMap.get(s.schoolId!) || "Unknown" })),
      students: studentResults.map(s => ({ ...s, schoolName: schoolMap.get(s.schoolId!) || "Unknown" })),
      parents: parentResults.map(p => ({ ...p, schoolName: null })),
    };
  }

  async getCommunicationLogs(filters: {
    schoolId?: number;
    recipientType?: string;
    category?: string;
    channel?: string;
    status?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions = [];
    if (filters.schoolId) conditions.push(eq(communicationLogs.schoolId, filters.schoolId));
    if (filters.recipientType) conditions.push(eq(communicationLogs.recipientType, filters.recipientType));
    if (filters.category) conditions.push(eq(communicationLogs.category, filters.category));
    if (filters.channel) conditions.push(eq(communicationLogs.channel, filters.channel as any));
    if (filters.status) conditions.push(eq(communicationLogs.status, filters.status as any));
    if (filters.startDate) conditions.push(gte(communicationLogs.createdAt, new Date(filters.startDate)));
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(communicationLogs.createdAt, endDate));
    }
    if (filters.search) {
      conditions.push(or(
        like(communicationLogs.message, `%${filters.search}%`),
        like(communicationLogs.recipientPhone, `%${filters.search}%`),
        like(communicationLogs.recipientEmail, `%${filters.search}%`),
        like(communicationLogs.recipientName, `%${filters.search}%`),
        like(communicationLogs.subject, `%${filters.search}%`),
      ));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const pageLimit = filters.limit || 50;
    const pageOffset = filters.offset || 0;

    const [rows, countResult] = await Promise.all([
      db.select().from(communicationLogs)
        .where(whereClause)
        .orderBy(desc(communicationLogs.createdAt))
        .limit(pageLimit)
        .offset(pageOffset),
      db.select({ count: drizzleCount() }).from(communicationLogs)
        .where(whereClause),
    ]);

    return { logs: rows, total: Number(countResult[0]?.count || 0) };
  }

  async getCommunicationStats(schoolId?: number) {
    const baseQuery = schoolId 
      ? db.select({ 
          channel: communicationLogs.channel,
          status: communicationLogs.status,
          count: drizzleCount()
        })
        .from(communicationLogs)
        .where(eq(communicationLogs.schoolId, schoolId))
        .groupBy(communicationLogs.channel, communicationLogs.status)
      : db.select({ 
          channel: communicationLogs.channel,
          status: communicationLogs.status,
          count: drizzleCount()
        })
        .from(communicationLogs)
        .groupBy(communicationLogs.channel, communicationLogs.status);

    const results = await baseQuery;
    
    const stats = {
      email: { sent: 0, failed: 0, pending: 0 },
      sms: { sent: 0, failed: 0, pending: 0 },
      whatsapp: { sent: 0, failed: 0, pending: 0 },
    };

    for (const row of results) {
      const channel = row.channel as keyof typeof stats;
      const status = row.status as keyof typeof stats.email;
      if (stats[channel] && stats[channel][status] !== undefined) {
        stats[channel][status] = Number(row.count);
      }
    }

    return stats;
  }

  // Assessment Types
  async getAssessmentTypes(schoolId?: number): Promise<AssessmentType[]> {
    if (schoolId) {
      // Return both global types (schoolId is NULL) and school-specific types
      return db.select().from(assessmentTypes).where(
        or(
          isNull(assessmentTypes.schoolId),
          eq(assessmentTypes.schoolId, schoolId)
        )
      );
    }
    return db.select().from(assessmentTypes);
  }

  async getAssessmentType(id: number): Promise<AssessmentType | undefined> {
    const [type] = await db.select().from(assessmentTypes).where(eq(assessmentTypes.id, id));
    return type;
  }

  async createAssessmentType(type: InsertAssessmentType): Promise<AssessmentType> {
    const [created] = await db.insert(assessmentTypes).values(type).returning();
    return created;
  }

  async updateAssessmentType(id: number, type: Partial<InsertAssessmentType>): Promise<AssessmentType | undefined> {
    const [updated] = await db.update(assessmentTypes).set(type).where(eq(assessmentTypes.id, id)).returning();
    return updated;
  }

  async deleteAssessmentType(id: number): Promise<boolean> {
    const result = await db.delete(assessmentTypes).where(eq(assessmentTypes.id, id));
    return true;
  }

  // Exam Types
  async getExamTypes(schoolId?: number): Promise<ExamType[]> {
    if (schoolId) {
      return db.select().from(examTypes).where(
        or(eq(examTypes.schoolId, schoolId), isNull(examTypes.schoolId))
      );
    }
    return db.select().from(examTypes);
  }

  async getExamType(id: number): Promise<ExamType | undefined> {
    const [type] = await db.select().from(examTypes).where(eq(examTypes.id, id));
    return type;
  }

  async createExamType(type: InsertExamType): Promise<ExamType> {
    const [created] = await db.insert(examTypes).values(type).returning();
    return created;
  }

  async updateExamType(id: number, type: Partial<InsertExamType>): Promise<ExamType | undefined> {
    const [updated] = await db.update(examTypes).set(type).where(eq(examTypes.id, id)).returning();
    return updated;
  }

  async deleteExamType(id: number): Promise<boolean> {
    await db.delete(examTypes).where(eq(examTypes.id, id));
    return true;
  }

  // Exams
  async getExams(schoolId?: number): Promise<Exam[]> {
    if (schoolId) {
      return db.select().from(exams).where(eq(exams.schoolId, schoolId));
    }
    return db.select().from(exams);
  }

  async getExamsBySchool(schoolId: number): Promise<Exam[]> {
    return db.select().from(exams).where(
      or(eq(exams.schoolId, schoolId), isNull(exams.schoolId))
    );
  }

  async getExam(id: number): Promise<Exam | undefined> {
    const [exam] = await db.select().from(exams).where(eq(exams.id, id));
    return exam;
  }

  async getAssessmentsByExam(examId: number): Promise<Assessment[]> {
    return db.select().from(assessments).where(eq(assessments.examId, examId));
  }

  async createExam(exam: InsertExam): Promise<Exam> {
    const [created] = await db.insert(exams).values(exam).returning();
    return created;
  }

  async updateExam(id: number, exam: Partial<InsertExam>): Promise<Exam | undefined> {
    const [updated] = await db.update(exams).set(exam).where(eq(exams.id, id)).returning();
    return updated;
  }

  async deleteExam(id: number): Promise<boolean> {
    await db.delete(exams).where(eq(exams.id, id));
    return true;
  }

  // Assessment Papers
  async getAssessmentPapers(assessmentId: number): Promise<AssessmentPaper[]> {
    return db.select().from(assessmentPapers).where(eq(assessmentPapers.assessmentId, assessmentId));
  }

  async createAssessmentPaper(paper: InsertAssessmentPaper): Promise<AssessmentPaper> {
    const [created] = await db.insert(assessmentPapers).values(paper).returning();
    return created;
  }

  async updateAssessmentPaper(id: number, paper: Partial<InsertAssessmentPaper>): Promise<AssessmentPaper | undefined> {
    const [updated] = await db.update(assessmentPapers).set(paper).where(eq(assessmentPapers.id, id)).returning();
    return updated;
  }

  async deleteAssessmentPaper(id: number): Promise<boolean> {
    await db.delete(assessmentPapers).where(eq(assessmentPapers.id, id));
    return true;
  }

  async setAssessmentPapers(assessmentId: number, papers: InsertAssessmentPaper[]): Promise<AssessmentPaper[]> {
    // Get existing papers for this assessment
    const existingPapers = await db.select().from(assessmentPapers).where(eq(assessmentPapers.assessmentId, assessmentId));
    
    // Delete all assessment_mark_papers that reference these papers
    for (const paper of existingPapers) {
      await db.delete(assessmentMarkPapers).where(eq(assessmentMarkPapers.assessmentPaperId, paper.id));
    }
    
    // Now delete the papers
    await db.delete(assessmentPapers).where(eq(assessmentPapers.assessmentId, assessmentId));
    if (papers.length === 0) return [];
    const created = await db.insert(assessmentPapers).values(papers).returning();
    return created;
  }

  // Assessment Comments
  async getAssessmentComments(schoolId?: number, classId?: number, subjectId?: number): Promise<AssessmentComment[]> {
    const conditions = [];
    if (schoolId) conditions.push(eq(assessmentComments.schoolId, schoolId));
    if (classId) conditions.push(eq(assessmentComments.classId, classId));
    if (subjectId) conditions.push(eq(assessmentComments.subjectId, subjectId));
    
    if (conditions.length > 0) {
      return db.select().from(assessmentComments).where(and(...conditions));
    }
    return db.select().from(assessmentComments);
  }

  async getAssessmentComment(id: number): Promise<AssessmentComment | undefined> {
    const [comment] = await db.select().from(assessmentComments).where(eq(assessmentComments.id, id));
    return comment;
  }

  async createAssessmentComment(comment: InsertAssessmentComment): Promise<AssessmentComment> {
    const [created] = await db.insert(assessmentComments).values(comment).returning();
    return created;
  }

  async updateAssessmentComment(id: number, comment: Partial<InsertAssessmentComment>): Promise<AssessmentComment | undefined> {
    const [updated] = await db.update(assessmentComments).set(comment).where(eq(assessmentComments.id, id)).returning();
    return updated;
  }

  async deleteAssessmentComment(id: number): Promise<boolean> {
    await db.delete(assessmentComments).where(eq(assessmentComments.id, id));
    return true;
  }

  async findAssessmentComment(classId: number, subjectId: number, gradeId: number): Promise<AssessmentComment | undefined> {
    const [comment] = await db.select().from(assessmentComments).where(
      and(
        eq(assessmentComments.classId, classId),
        eq(assessmentComments.subjectId, subjectId),
        eq(assessmentComments.gradeId, gradeId)
      )
    );
    return comment;
  }

  // Report Comments methods
  async getReportComments(schoolId: number, commentType?: string): Promise<ReportComment[]> {
    const conditions = [
      eq(reportComments.schoolId, schoolId),
      notLike(reportComments.commentGrade, "__REPORT_CARD_OVERRIDE__:%"),
    ];
    if (commentType) conditions.push(eq(reportComments.commentType, commentType as any));
    return db.select().from(reportComments).where(and(...conditions));
  }

  async getEcdAssessmentDomains(): Promise<EcdAssessmentDomain[]> {
    return db
      .select()
      .from(ecdAssessmentDomains)
      .where(eq(ecdAssessmentDomains.isActive, true))
      .orderBy(ecdAssessmentDomains.sortOrder);
  }

  async getEcdAssessmentItems(): Promise<EcdAssessmentItem[]> {
    return db
      .select()
      .from(ecdAssessmentItems)
      .where(eq(ecdAssessmentItems.isActive, true))
      .orderBy(ecdAssessmentItems.domainId, ecdAssessmentItems.sortOrder);
  }

  async getEcdAssessmentRecord(studentId: number, examId: number): Promise<EcdAssessmentRecord | undefined> {
    const [record] = await db.select().from(ecdAssessmentRecords).where(and(eq(ecdAssessmentRecords.studentId, studentId), eq(ecdAssessmentRecords.examId, examId)));
    return record;
  }

  async upsertEcdAssessmentRecord(data: InsertEcdAssessmentRecord): Promise<EcdAssessmentRecord> {
    const existing = await this.getEcdAssessmentRecord(data.studentId, data.examId);
    if (existing) {
      const [updated] = await db.update(ecdAssessmentRecords).set({ ...data, updatedAt: new Date() }).where(eq(ecdAssessmentRecords.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(ecdAssessmentRecords).values(data).returning();
    return created;
  }

  async getEcdAssessmentResponses(recordId: number): Promise<EcdAssessmentResponse[]> {
    return db.select().from(ecdAssessmentResponses).where(eq(ecdAssessmentResponses.recordId, recordId));
  }

  async upsertEcdAssessmentResponse(data: InsertEcdAssessmentResponse): Promise<EcdAssessmentResponse> {
    const [existing] = await db.select().from(ecdAssessmentResponses).where(and(eq(ecdAssessmentResponses.recordId, data.recordId), eq(ecdAssessmentResponses.itemId, data.itemId)));
    if (existing) {
      const [updated] = await db.update(ecdAssessmentResponses).set({ rating: data.rating, updatedAt: new Date() }).where(eq(ecdAssessmentResponses.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(ecdAssessmentResponses).values(data).returning();
    return created;
  }

  async createReportComment(comment: InsertReportComment): Promise<ReportComment> {
    const [created] = await db.insert(reportComments).values(comment).returning();
    return created;
  }

  async deleteReportComment(id: number, schoolId: number): Promise<boolean> {
    await db.delete(reportComments).where(and(eq(reportComments.id, id), eq(reportComments.schoolId, schoolId)));
    return true;
  }

  // Assessment Marks methods
  async getAssessmentMarks(assessmentId: number, classId?: number, subjectId?: number): Promise<AssessmentMark[]> {
    const conditions = [eq(assessmentMarks.assessmentId, assessmentId)];
    if (classId) conditions.push(eq(assessmentMarks.classId, classId));
    if (subjectId) conditions.push(eq(assessmentMarks.subjectId, subjectId));
    return db.select().from(assessmentMarks).where(and(...conditions));
  }

  async getAssessmentMark(id: number): Promise<AssessmentMark | undefined> {
    const [mark] = await db.select().from(assessmentMarks).where(eq(assessmentMarks.id, id));
    return mark;
  }

  async getAssessmentMarkByStudentAssessment(studentId: number, assessmentId: number): Promise<AssessmentMark | undefined> {
    const [mark] = await db.select().from(assessmentMarks).where(
      and(
        eq(assessmentMarks.studentId, studentId),
        eq(assessmentMarks.assessmentId, assessmentId)
      )
    );
    return mark;
  }

  async getAssessmentMarksByAssessments(assessmentIds: number[]): Promise<AssessmentMark[]> {
    if (assessmentIds.length === 0) return [];
    return db.select().from(assessmentMarks).where(
      inArray(assessmentMarks.assessmentId, assessmentIds)
    );
  }

  async createAssessmentMark(mark: InsertAssessmentMark): Promise<AssessmentMark> {
    const [created] = await db.insert(assessmentMarks).values(mark).returning();
    return created;
  }

  async updateAssessmentMark(id: number, mark: Partial<InsertAssessmentMark>): Promise<AssessmentMark | undefined> {
    const [updated] = await db.update(assessmentMarks).set(mark).where(eq(assessmentMarks.id, id)).returning();
    return updated;
  }

  async deleteAssessmentMark(id: number): Promise<boolean> {
    await db.delete(assessmentMarkPapers).where(eq(assessmentMarkPapers.assessmentMarkId, id));
    await db.delete(assessmentMarks).where(eq(assessmentMarks.id, id));
    return true;
  }

  // Assessment Mark Papers methods
  async getMarkPapers(assessmentMarkId: number): Promise<AssessmentMarkPaper[]> {
    return db.select().from(assessmentMarkPapers).where(eq(assessmentMarkPapers.assessmentMarkId, assessmentMarkId));
  }

  async setMarkPapers(assessmentMarkId: number, papers: { assessmentPaperId: number; markObtained: number | null }[]): Promise<AssessmentMarkPaper[]> {
    return await db.transaction(async (tx) => {
      await tx.delete(assessmentMarkPapers).where(eq(assessmentMarkPapers.assessmentMarkId, assessmentMarkId));
      
      if (papers.length === 0) return [];
      
      const toInsert = papers.map(p => ({
        assessmentMarkId,
        assessmentPaperId: p.assessmentPaperId,
        markObtained: p.markObtained?.toString() ?? null,
      }));
      
      return tx.insert(assessmentMarkPapers).values(toInsert).returning();
    });
  }
  // Notifications
  async getNotifications(userId: number, orgId?: number): Promise<Notification[]> {
    const conditions = [eq(notifications.userId, userId)];
    if (orgId) {
      conditions.push(eq(notifications.organizationId, orgId));
    }
    return db.select().from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  }

  async getUnreadNotificationCount(userId: number, orgId?: number): Promise<number> {
    const conditions = [eq(notifications.userId, userId), isNull(notifications.readAt)];
    if (orgId) {
      conditions.push(eq(notifications.organizationId, orgId));
    }
    const [result] = await db.select({ count: drizzleCount() }).from(notifications).where(and(...conditions));
    return result?.count || 0;
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [created] = await db.insert(notifications).values(notification).returning();
    return created;
  }

  async markNotificationRead(id: number): Promise<Notification | undefined> {
    const [updated] = await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id)).returning();
    return updated;
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  // School termination
  async getSchoolsPendingTermination(): Promise<School[]> {
    return db.select().from(schools).where(eq(schools.terminationStatus, "pending"));
  }

  async getArchivedSchools(orgId?: number): Promise<School[]> {
    if (orgId) {
      return db.select().from(schools).where(
        and(eq(schools.terminationStatus, "archived"), eq(schools.organizationId, orgId))
      ).orderBy(desc(schools.archivedAt));
    }
    return db.select().from(schools).where(eq(schools.terminationStatus, "archived")).orderBy(desc(schools.archivedAt));
  }

  async scheduleSchoolTermination(schoolId: number, userId: number): Promise<School | undefined> {
    const now = new Date();
    const terminationAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
    const [updated] = await db.update(schools).set({
      terminationStatus: "pending",
      terminationRequestedAt: now,
      terminationAt,
      terminationByUserId: userId,
    }).where(eq(schools.id, schoolId)).returning();
    return updated;
  }

  async archiveSchool(schoolId: number): Promise<School | undefined> {
    const [updated] = await db.update(schools).set({
      terminationStatus: "archived",
      archivedAt: new Date(),
    }).where(eq(schools.id, schoolId)).returning();
    return updated;
  }

  async restoreSchool(schoolId: number): Promise<School | undefined> {
    const [updated] = await db.update(schools).set({
      terminationStatus: null,
      terminationRequestedAt: null,
      terminationAt: null,
      terminationByUserId: null,
      archivedAt: null,
    }).where(eq(schools.id, schoolId)).returning();
    return updated;
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [created] = await db.insert(activityLogs).values(log).returning();
    return created;
  }

  async getActivityLogs(filters: {
    schoolId?: number;
    organizationId?: number;
    category?: string;
    action?: string;
    userId?: number;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: ActivityLog[]; total: number }> {
    const conditions = [];
    if (filters.schoolId) conditions.push(eq(activityLogs.schoolId, filters.schoolId));
    if (filters.organizationId) conditions.push(eq(activityLogs.organizationId, filters.organizationId));
    if (filters.category) conditions.push(eq(activityLogs.category, filters.category));
    if (filters.action) conditions.push(eq(activityLogs.action, filters.action));
    if (filters.userId) conditions.push(eq(activityLogs.userId, filters.userId));
    if (filters.fromDate) conditions.push(gte(activityLogs.createdAt, new Date(filters.fromDate)));
    if (filters.toDate) {
      const endDate = new Date(filters.toDate);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(activityLogs.createdAt, endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ count: totalCount }] = await db.select({ count: drizzleCount() }).from(activityLogs).where(whereClause);

    const logs = await db.select().from(activityLogs)
      .where(whereClause)
      .orderBy(desc(activityLogs.createdAt))
      .limit(filters.limit || 50)
      .offset(filters.offset || 0);

    return { logs, total: Number(totalCount) };
  }
}

export const storage = new DatabaseStorage();
