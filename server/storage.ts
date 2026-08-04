import { db } from "./db";
import { compareStudentsByFirstName, studentFirstNameOrder } from "./student-sort";
import { eq, ne, desc, asc, and, or, sql, count as drizzleCount, like, gte, lte, lt, isNull, inArray, notLike } from "drizzle-orm";
import {
  users, staff, streams, classes, classTeacherAssignments, parents, students, subjects,
  staffSubjects, studentSubjects, classSubjects, grades, assessments, marks, attendanceRecords,
  disciplineRecords, clinicRecords, feesPayments, organizations, schools, libraryResources, libraryCategories, libraryShelves, libraryBooks, libraryBookCopies, libraryLoans, libraryFines, libraryReservations, libraryPolicies,
  timetableSlots, logbookEntries, posItems, posSales, posSaleItems,
  newsletters, hostels, hostelRollCall, studentApplications, staffAttendanceLogs,
  permissions, accessGroups, accessGroupPermissions, userAccessGroups, userPermissionOverrides, userSchoolAccess, staffRoles,
  communicationLogs, assessmentTypes, examTypes, exams, assessmentPapers, assessmentComments,
  assessmentMarks, assessmentMarkPapers, reportComments,
  ecdAssessmentDomains, ecdAssessmentItems, ecdAssessmentRecords, ecdAssessmentResponses,
  type User, type InsertUser,
  type Staff, type InsertStaff,
  type Stream, type InsertStream,
  type Class, type InsertClass,
  type ClassTeacherAssignment, type InsertClassTeacherAssignment,
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
  type LibraryShelf, type InsertLibraryShelf,
  type LibraryBook, type InsertLibraryBook,
  type LibraryBookCopy, type InsertLibraryBookCopy,
  type LibraryLoan, type InsertLibraryLoan,
  type LibraryFine, type InsertLibraryFine,
  type LibraryReservation, type InsertLibraryReservation,
  type LibraryPolicy, type InsertLibraryPolicy,
  type TimetableSlot, type InsertTimetableSlot,
  type LogbookEntry, type InsertLogbookEntry,
  type StaffAttendanceLog, type InsertStaffAttendanceLog,
  type PosItem, type InsertPosItem,
  type PosSale,
  type PosSaleItem,
  type Newsletter, type InsertNewsletter,
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
  internalTransfers,
  calendarEvents,
  calendarEventAttendees,
  qcReports,
  type ActivityLog, type InsertActivityLog, type InternalTransfer, type InsertInternalTransfer,
} from "@shared/schema";


export class PosSaleProcessingError extends Error {
  constructor(
    public readonly code: "ITEM_NOT_FOUND" | "INSUFFICIENT_STOCK" | "INVALID_PRICE",
    message: string,
  ) {
    super(message);
    this.name = "PosSaleProcessingError";
  }
}

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
  getNextStaffNo(options?: { schoolId?: number | null; referenceDate?: string | Date | null }): Promise<string>;

  getInternalTransfers(filters?: { organizationId?: number | null; schoolId?: number | null; personType?: string | null }): Promise<InternalTransfer[]>;
  createInternalTransfer(data: InsertInternalTransfer): Promise<InternalTransfer>;
  transferStudentWithinOrganization(args: { studentId: number; destinationSchoolId: number; destinationClassId: number; admissionNo?: string | null; effectiveDate: string; reason: string; userId?: number | null; notes?: string | null }): Promise<{ student: Student; transfer: InternalTransfer; warnings: string[] }>;
  transferStaffWithinOrganization(args: { staffId: number; destinationSchoolId: number; destinationRole: string; destinationAccessGroupId?: number | null; effectiveDate: string; reason: string; userId?: number | null; notes?: string | null }): Promise<{ staff: Staff; transfer: InternalTransfer }>;

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
  getClassSubjectOverridesByClasses(classIds: number[]): Promise<ClassSubject[]>;
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
  getActiveStudentsBySchool(schoolId: number): Promise<Student[]>;
  getArchivedStudents(): Promise<Student[]>;
  getArchivedStudentsBySchool(schoolId: number): Promise<Student[]>;
  getStudent(id: number): Promise<Student | undefined>;
  getStudentsByClass(classId: number): Promise<Student[]>;
  getStudentsByParent(parentId: number): Promise<Student[]>;
  createStudent(student: InsertStudent): Promise<Student>;
  updateStudent(id: number, student: Partial<InsertStudent>): Promise<Student | undefined>;
  deleteStudent(id: number): Promise<boolean>;
  getNextAdmissionNo(options?: { schoolId?: number | null; referenceDate?: string | Date | null }): Promise<string>;

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
  getStudentSubjectOverridesByStudents(studentIds: number[]): Promise<StudentSubject[]>;
  updateStudentSubjects(studentId: number, subjectIds: number[]): Promise<void>;

  getAllGrades(): Promise<Grade[]>;
  getGradesBySchool(schoolId: number): Promise<Grade[]>;
  getGrade(id: number): Promise<Grade | undefined>;
  createGrade(grade: InsertGrade): Promise<Grade>;
  updateGrade(id: number, grade: Partial<InsertGrade>): Promise<Grade | undefined>;
  attachClassToGrades(classId: number, gradeIds: number[]): Promise<number>;
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

  getDashboardStats(schoolId?: number | null, options?: { fromDate?: string; toDate?: string; attendancePage?: number; attendancePageSize?: number }): Promise<{
    totalStudents: number;
    totalStaff: number;
    totalClasses: number;
    totalSubjects: number;
    attendanceToday: { present: number; absent: number; unmarked: number; total: number; fromDate: string; toDate: string; page: number; pageSize: number; totalPages: number; totalRows: number };
    recentPayments: FeesPayment[];
    studentsGender: { male: number; female: number };
    studentsDailyStats: { approved: number; pending: number; transferred: number };
    classroomPopulation: Array<{ className: string; count: number }>;
    feesToday: { cash: number; mobileMoney: number; bank: number; total: number };
    termFeesCollected: number;
    staffMonitoring: { present: number; absent: number; late: number; earlyExits: number };
    absentStaff: Array<{ name: string; phone: string }>;
    lateComers: Array<{ name: string; inVariance: string; outVariance: string }>;
    studentsAttendanceByClass: Array<{ classId: number; className: string; teacher: string; absent: number; present: number; unmarked: number; total: number; attendancePercent: number }>;
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

  // Library - Shelves
  getLibraryShelves(schoolId: number): Promise<LibraryShelf[]>;
  createLibraryShelf(shelf: InsertLibraryShelf): Promise<LibraryShelf>;
  updateLibraryShelf(id: number, shelf: Partial<InsertLibraryShelf>): Promise<LibraryShelf | undefined>;
  deleteLibraryShelf(id: number): Promise<boolean>;

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
  getTimetableSlot(id: number): Promise<TimetableSlot | undefined>;
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
  getPosSale(id: number): Promise<PosSale | undefined>;
  createPosSaleWithItems(args: {
    schoolId: number;
    paymentMethod: string;
    customerName?: string | null;
    studentId?: number | null;
    soldBy?: number | null;
    items: Array<{ itemId: number; quantity: number }>;
  }): Promise<{ sale: PosSale; items: PosSaleItem[] }>;
  getPosSaleItems(saleId: number): Promise<PosSaleItem[]>;

  // Newsletters
  getNewsletters(schoolId?: number): Promise<Newsletter[]>;
  getNewsletterById(id: number): Promise<Newsletter | undefined>;
  createNewsletter(newsletter: InsertNewsletter): Promise<Newsletter>;
  updateNewsletter(id: number, newsletter: Partial<InsertNewsletter>): Promise<Newsletter | undefined>;
  deleteNewsletter(id: number): Promise<boolean>;

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
  getAssessmentPapersByAssessments(assessmentIds: number[]): Promise<AssessmentPaper[]>;
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
  getMarkPapersByMarks(assessmentMarkIds: number[]): Promise<AssessmentMarkPaper[]>;
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

const DASHBOARD_ACTIVE_STUDENT_STATUSES = new Set(["", "active", "approved"]);

function normalizeDashboardDate(value: unknown): Date | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function generateEnrollmentTrend(
  studentList: any[],
): Array<{ month: string; count: number }> {
  const now = new Date();

  const buckets = Array.from({ length: 24 }, (_, index) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - (23 - index), 1);
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;

    return {
      key,
      label: monthDate.toLocaleString("en-US", {
        month: "short",
        year: "2-digit",
      }),
    };
  });

  const counts = new Map<string, number>(buckets.map((bucket) => [bucket.key, 0]));

  for (const student of studentList ?? []) {
    const enrolledAt = normalizeDashboardDate(
      student?.enrollmentDate ?? student?.createdAt,
    );

    if (!enrolledAt) continue;

    const key = `${enrolledAt.getFullYear()}-${String(enrolledAt.getMonth() + 1).padStart(2, "0")}`;
    if (!counts.has(key)) continue;

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return buckets.map((bucket) => ({
    month: bucket.label,
    count: counts.get(bucket.key) ?? 0,
  }));
}

function computeClassroomPopulation(
  studentList: any[],
  classList: any[],
): Array<{ className: string; male: number; female: number; other: number; count: number }> {
  const activeClasses = (classList ?? []).filter((cls: any) => !cls?.archivedAt);

  const counts = new Map<number, { male: number; female: number; other: number; count: number }>();
  for (const cls of activeClasses) {
    const classId = Number(cls?.id);
    if (Number.isFinite(classId)) {
      counts.set(classId, { male: 0, female: 0, other: 0, count: 0 });
    }
  }

  for (const student of studentList ?? []) {
    const status = String(student?.status ?? "active").trim().toLowerCase();
    if (!DASHBOARD_ACTIVE_STUDENT_STATUSES.has(status)) continue;

    const classId = Number(student?.classId);
    const bucket = counts.get(classId);
    if (!bucket) continue;

    const gender = String(student?.gender ?? "").trim().toLowerCase();
    if (gender === "male" || gender === "m") bucket.male += 1;
    else if (gender === "female" || gender === "f") bucket.female += 1;
    else bucket.other += 1;
    bucket.count += 1;
  }

  return activeClasses
    .map((cls: any) => {
      const count = counts.get(Number(cls?.id)) ?? { male: 0, female: 0, other: 0, count: 0 };
      return {
        className: String(
          cls?.shortCode?.trim() || cls?.className?.trim() || `Class ${cls?.id}`
        ),
        male: count.male,
        female: count.female,
        other: count.other,
        count: count.count,
      };
    })
    .sort((a, b) =>
      a.className.localeCompare(b.className, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

function nonArchivedStudentCondition() {
  return isNull(students.archivedAt);
}

function archivedStudentCondition() {
  return sql`${students.archivedAt} IS NOT NULL`;
}

function activeEnrolledStudentCondition() {
  return sql`
    ${students.archivedAt} IS NULL
    AND LOWER(TRIM(COALESCE(${students.status}::text, 'active'))) IN ('active', 'approved', '')
  `;
}

export class DatabaseStorage implements IStorage {
  private subjectMatchesStream(subject: Subject, streamId: number | null | undefined): boolean {
    if (streamId == null) {
      return false;
    }

    const scopedStreamIds = subject.streamIds ?? [];

    if (subject.streamId != null) {
      return subject.streamId === streamId;
    }

    if (scopedStreamIds.length > 0) {
      return scopedStreamIds.includes(streamId);
    }

    return false;
  }

  private async getClassSubjectOverrides(classId: number): Promise<ClassSubject[]> {
    return db.select().from(classSubjects).where(eq(classSubjects.classId, classId));
  }

  private async getStudentSubjectOverrides(studentId: number): Promise<StudentSubject[]> {
    return db.select().from(studentSubjects).where(eq(studentSubjects.studentId, studentId));
  }

  private async getInheritedSubjectIdsForClass(classId: number): Promise<number[]> {
    const classData = await this.getClass(classId);
    if (!classData) {
      return [];
    }

    const schoolSubjects = classData.schoolId
      ? await this.getSubjectsBySchool(classData.schoolId)
      : await this.getAllSubjects();

    return schoolSubjects
      .filter((subject) => this.subjectMatchesStream(subject, classData.streamId))
      .map((subject) => subject.id);
  }

  private async getResolvedClassSubjectIds(classId: number): Promise<number[]> {
    const resolved = new Set(await this.getInheritedSubjectIdsForClass(classId));
    const overrides = await this.getClassSubjectOverrides(classId);

    for (const row of overrides) {
      if (row.assignmentMode === "remove") {
        resolved.delete(row.subjectId);
      } else {
        resolved.add(row.subjectId);
      }
    }

    return Array.from(resolved);
  }

  private async getResolvedStudentSubjectIds(studentId: number): Promise<number[]> {
    const student = await this.getStudent(studentId);
    const resolved = new Set<number>(student?.classId ? await this.getResolvedClassSubjectIds(student.classId) : []);
    const overrides = await this.getStudentSubjectOverrides(studentId);

    for (const row of overrides) {
      if (row.assignmentMode === "remove") {
        resolved.delete(row.subjectId);
      } else {
        resolved.add(row.subjectId);
      }
    }

    return Array.from(resolved);
  }

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


  async getInternalTransfers(filters: { organizationId?: number | null; schoolId?: number | null; personType?: string | null } = {}): Promise<InternalTransfer[]> {
    const conditions: any[] = [];
    if (filters.organizationId) conditions.push(eq(internalTransfers.organizationId, filters.organizationId));
    if (filters.schoolId) {
      conditions.push(or(eq(internalTransfers.sourceSchoolId, filters.schoolId), eq(internalTransfers.destinationSchoolId, filters.schoolId)));
    }
    if (filters.personType && filters.personType !== "all") conditions.push(eq(internalTransfers.personType, filters.personType as any));
    const whereClause = conditions.length ? and(...conditions) : undefined;
    return db.select().from(internalTransfers).where(whereClause).orderBy(desc(internalTransfers.createdAt));
  }

  async createInternalTransfer(data: InsertInternalTransfer): Promise<InternalTransfer> {
    const [created] = await db.insert(internalTransfers).values(data).returning();
    return created;
  }

  async transferStudentWithinOrganization(args: { studentId: number; destinationSchoolId: number; destinationClassId: number; admissionNo?: string | null; effectiveDate: string; reason: string; userId?: number | null; notes?: string | null }): Promise<{ student: Student; transfer: InternalTransfer; warnings: string[] }> {
    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(students).where(eq(students.id, args.studentId));
      if (!existing || existing.archivedAt) throw new Error("Student not found");
      if (!existing.schoolId) throw new Error("Student does not belong to a school");
      if (existing.schoolId === args.destinationSchoolId) throw new Error("Destination school must be different from the current school");

      const [sourceSchool] = await tx.select().from(schools).where(eq(schools.id, existing.schoolId));
      const [destinationSchool] = await tx.select().from(schools).where(eq(schools.id, args.destinationSchoolId));
      if (!sourceSchool || !destinationSchool) throw new Error("Source or destination school not found");
      if (!sourceSchool.organizationId || sourceSchool.organizationId !== destinationSchool.organizationId) throw new Error("Transfers are only allowed within the same organization");

      const [destinationClass] = await tx.select().from(classes).where(and(eq(classes.id, args.destinationClassId), isNull(classes.archivedAt)));
      if (!destinationClass || destinationClass.schoolId !== args.destinationSchoolId) throw new Error("Destination class does not belong to the destination school");

      const nextAdmissionNo = (args.admissionNo && args.admissionNo.trim())
        ? args.admissionNo.trim().toUpperCase()
        : existing.admissionNo;
      if (nextAdmissionNo !== existing.admissionNo) {
        const [duplicate] = await tx.select({ id: students.id }).from(students).where(and(eq(students.admissionNo, nextAdmissionNo), ne(students.id, existing.id)));
        if (duplicate) throw new Error("Admission number already exists");
      }

      await tx.delete(studentSubjects).where(eq(studentSubjects.studentId, existing.id));

      const [updated] = await tx.update(students).set({
        schoolId: args.destinationSchoolId,
        classId: destinationClass.id,
        streamId: destinationClass.streamId || null,
        admissionNo: nextAdmissionNo,
        hostelId: null,
        isBoarding: false,
        isDayScholar: true,
        status: "active",
      }).where(eq(students.id, existing.id)).returning();
      if (!updated) throw new Error("Student transfer failed");

      const warnings: string[] = [];
      if (existing.parentId) {
        const siblingsInSource = await tx.select({ id: students.id }).from(students).where(and(
          eq(students.parentId, existing.parentId),
          eq(students.schoolId, existing.schoolId),
          ne(students.id, existing.id),
          isNull(students.archivedAt)
        ));
        if (siblingsInSource.length === 0) {
          const [parent] = await tx.select().from(parents).where(eq(parents.id, existing.parentId));
          await tx.update(parents).set({ schoolId: args.destinationSchoolId }).where(eq(parents.id, existing.parentId));
          if (parent?.userId) {
            await tx.update(users).set({ schoolId: args.destinationSchoolId, organizationId: sourceSchool.organizationId }).where(eq(users.id, parent.userId));
          }
        } else {
          warnings.push("The linked parent still has another child at the source school, so the parent account was left at the source school.");
        }
      }

      if (existing.userId) {
        await tx.update(users).set({ schoolId: args.destinationSchoolId, organizationId: sourceSchool.organizationId, isActive: true }).where(eq(users.id, existing.userId));
      }

      const [transfer] = await tx.insert(internalTransfers).values({
        organizationId: sourceSchool.organizationId,
        personType: "student",
        personId: existing.id,
        personName: `${existing.firstName} ${existing.lastName}`.trim(),
        sourceSchoolId: existing.schoolId,
        destinationSchoolId: args.destinationSchoolId,
        sourceClassId: existing.classId || null,
        destinationClassId: destinationClass.id,
        sourceStreamId: existing.streamId || null,
        destinationStreamId: destinationClass.streamId || null,
        sourceAdmissionNo: existing.admissionNo,
        destinationAdmissionNo: nextAdmissionNo,
        effectiveDate: args.effectiveDate,
        reason: args.reason,
        status: "completed",
        requestedByUserId: args.userId || null,
        completedByUserId: args.userId || null,
        notes: args.notes || null,
      }).returning();

      return { student: updated, transfer, warnings };
    });
  }

  async transferStaffWithinOrganization(args: { staffId: number; destinationSchoolId: number; destinationRole: string; destinationAccessGroupId?: number | null; effectiveDate: string; reason: string; userId?: number | null; notes?: string | null }): Promise<{ staff: Staff; transfer: InternalTransfer }> {
    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(staff).where(eq(staff.id, args.staffId));
      if (!existing) throw new Error("Staff member not found");
      if (!existing.schoolId) throw new Error("Staff member does not belong to a school");
      if (existing.schoolId === args.destinationSchoolId) throw new Error("Destination school must be different from the current school");

      const [sourceSchool] = await tx.select().from(schools).where(eq(schools.id, existing.schoolId));
      const [destinationSchool] = await tx.select().from(schools).where(eq(schools.id, args.destinationSchoolId));
      if (!sourceSchool || !destinationSchool) throw new Error("Source or destination school not found");
      if (!sourceSchool.organizationId || sourceSchool.organizationId !== destinationSchool.organizationId) throw new Error("Transfers are only allowed within the same organization");

      // Staff roles are configurable text values, while users.role is a fixed system identity.
      // Resolve the linked account identity from existing members of the selected access group
      // instead of copying a configurable staff-role name into the PostgreSQL enum.
      const destinationAccessGroupId = args.destinationAccessGroupId || existing.accessGroupId || null;
      let destinationUserRole: User["role"] | null = null;

      if (destinationAccessGroupId) {
        const [group] = await tx.select().from(accessGroups).where(eq(accessGroups.id, destinationAccessGroupId));
        if (!group) throw new Error("Destination access group not found");
      }

      if (existing.userId) {
        const [linkedUser] = await tx
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, existing.userId));
        if (!linkedUser) throw new Error("The linked staff login account could not be found");
        if (!destinationAccessGroupId) {
          throw new Error("A destination access group is required for staff with a linked login account");
        }

        const peerRoles = await tx
          .select({
            role: users.role,
            memberCount: sql<number>`count(*)::int`,
          })
          .from(userAccessGroups)
          .innerJoin(users, eq(users.id, userAccessGroups.userId))
          .where(and(
            eq(userAccessGroups.accessGroupId, destinationAccessGroupId),
            ne(users.id, existing.userId),
          ))
          .groupBy(users.role)
          .orderBy(desc(sql`count(*)`), asc(users.role));

        const totalPeers = peerRoles.reduce((total, row) => total + Number(row.memberCount || 0), 0);
        const leadingPeerRole = peerRoles[0];
        const secondPeerRole = peerRoles[1];
        const hasClearMajority = Boolean(
          leadingPeerRole &&
          Number(leadingPeerRole.memberCount) > totalPeers / 2 &&
          (!secondPeerRole || Number(leadingPeerRole.memberCount) > Number(secondPeerRole.memberCount)),
        );

        // Empty or genuinely mixed custom groups retain the account's existing system identity.
        // Permissions still come from the destination access group.
        destinationUserRole = hasClearMajority ? leadingPeerRole!.role : linkedUser.role;
      }

      // All validation and account-role resolution must finish before teaching links are cleared.
      const now = new Date();
      await tx.delete(staffSubjects).where(eq(staffSubjects.staffId, existing.id));
      await tx.update(classes).set({ classTeacherId: null }).where(eq(classes.classTeacherId, existing.id));
      await tx.update(classTeacherAssignments).set({ effectiveTo: now }).where(and(eq(classTeacherAssignments.teacherId, existing.id), isNull(classTeacherAssignments.effectiveTo)));
      await tx.update(timetableSlots).set({ teacherId: null }).where(eq(timetableSlots.teacherId, existing.id));

      const [updated] = await tx.update(staff).set({
        schoolId: args.destinationSchoolId,
        role: args.destinationRole,
        accessGroupId: destinationAccessGroupId,
        status: "active",
      }).where(eq(staff.id, existing.id)).returning();
      if (!updated) throw new Error("Staff transfer failed");

      if (existing.userId && destinationUserRole) {
        await tx.update(users).set({
          schoolId: args.destinationSchoolId,
          organizationId: sourceSchool.organizationId,
          role: destinationUserRole,
          isActive: true,
        }).where(eq(users.id, existing.userId));
        await tx.delete(userAccessGroups).where(eq(userAccessGroups.userId, existing.userId));
        await tx.insert(userAccessGroups).values({
          userId: existing.userId,
          accessGroupId: destinationAccessGroupId!,
        }).onConflictDoNothing();
      }

      const [transfer] = await tx.insert(internalTransfers).values({
        organizationId: sourceSchool.organizationId,
        personType: "staff",
        personId: existing.id,
        personName: `${existing.firstName} ${existing.lastName}`.trim(),
        sourceSchoolId: existing.schoolId,
        destinationSchoolId: args.destinationSchoolId,
        sourceRole: existing.role || null,
        destinationRole: args.destinationRole,
        sourceAccessGroupId: existing.accessGroupId || null,
        destinationAccessGroupId,
        effectiveDate: args.effectiveDate,
        reason: args.reason,
        status: "completed",
        requestedByUserId: args.userId || null,
        completedByUserId: args.userId || null,
        notes: args.notes || null,
      }).returning();

      return { staff: updated, transfer };
    });
  }

  private getSchoolSequenceCode(schoolId?: number | null): string {
    const value = Number(schoolId || 0);
    if (!Number.isFinite(value) || value <= 0) return "A";
    let remaining = Math.floor(value);
    let result = "";
    while (remaining > 0) {
      const offset = (remaining - 1) % 26;
      result = String.fromCharCode(65 + offset) + result;
      remaining = Math.floor((remaining - 1) / 26);
    }
    return result;
  }

  private normalizeReferenceDate(referenceDate?: string | Date | null): Date {
    if (referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())) {
      return referenceDate;
    }
    if (typeof referenceDate === "string" && referenceDate.trim()) {
      const parsed = new Date(referenceDate);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return new Date();
  }

  private buildFormattedSequenceNumber(prefix: "S" | "E", schoolId?: number | null, referenceDate?: string | Date | null, sequence: number = 1): string {
    const refDate = this.normalizeReferenceDate(referenceDate);
    const year = String(refDate.getFullYear()).slice(-2);
    const sequencePart = String(sequence).padStart(4, "0");
    const schoolCode = this.getSchoolSequenceCode(schoolId);
    return `FCGS${year}${prefix}${sequencePart}${schoolCode}`.toUpperCase();
  }

  async getNextStaffNo(options?: { schoolId?: number | null; referenceDate?: string | Date | null }): Promise<string> {
    const referenceDate = this.normalizeReferenceDate(options?.referenceDate);
    const schoolId = options?.schoolId || null;
    const year = referenceDate.getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);

    const conditions = [gte(staff.createdAt, start), lt(staff.createdAt, end)];
    if (schoolId) {
      conditions.push(eq(staff.schoolId, schoolId));
    }

    const rows = await db
      .select({ staffNo: staff.staffNo })
      .from(staff)
      .where(and(...conditions));

    let maxSequence = 0;
    const pattern = new RegExp(`^FCGS${String(year).slice(-2)}E(\\d{4})${this.getSchoolSequenceCode(schoolId)}$`, "i");
    for (const row of rows) {
      const match = (row.staffNo || "").match(pattern);
      if (!match) continue;
      const sequence = Number(match[1]);
      if (Number.isFinite(sequence) && sequence > maxSequence) {
        maxSequence = sequence;
      }
    }

    return this.buildFormattedSequenceNumber("E", schoolId, referenceDate, maxSequence + 1);
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
    return db.select().from(classes).where(isNull(classes.archivedAt)).orderBy(classes.className);
  }

  async getClassesBySchool(schoolId: number): Promise<Class[]> {
    return db.select().from(classes).where(and(eq(classes.schoolId, schoolId), isNull(classes.archivedAt))).orderBy(classes.className);
  }

  async getClass(id: number): Promise<Class | undefined> {
    const [classData] = await db.select().from(classes).where(eq(classes.id, id));
    return classData;
  }

  async createClass(classData: InsertClass): Promise<Class> {
    return db.transaction(async (tx) => {
      const [newClass] = await tx.insert(classes).values(classData).returning();

      if (newClass.classTeacherId) {
        await tx.insert(classTeacherAssignments).values({
          classId: newClass.id,
          teacherId: newClass.classTeacherId,
          effectiveFrom: newClass.createdAt ?? new Date(),
        });
      }

      return newClass;
    });
  }

  async updateClass(id: number, classData: Partial<InsertClass>): Promise<Class | undefined> {
    return db.transaction(async (tx) => {
      const [existingClass] = await tx.select().from(classes).where(eq(classes.id, id));
      if (!existingClass) return undefined;

      const [updated] = await tx.update(classes).set(classData).where(eq(classes.id, id)).returning();

      if (Object.prototype.hasOwnProperty.call(classData, "classTeacherId") && existingClass.classTeacherId !== updated.classTeacherId) {
        const effectiveFrom = new Date();
        await tx.update(classTeacherAssignments)
          .set({ effectiveTo: effectiveFrom })
          .where(and(eq(classTeacherAssignments.classId, id), isNull(classTeacherAssignments.effectiveTo)));

        if (updated.classTeacherId) {
          await tx.insert(classTeacherAssignments).values({
            classId: id,
            teacherId: updated.classTeacherId,
            effectiveFrom,
          });
        }
      }

      return updated;
    });
  }

  async deleteClass(id: number): Promise<boolean> {
    const archivedAt = new Date();
    await db.transaction(async (tx) => {
      await tx.update(classTeacherAssignments)
        .set({ effectiveTo: archivedAt })
        .where(and(eq(classTeacherAssignments.classId, id), isNull(classTeacherAssignments.effectiveTo)));

      await tx.update(classes)
        .set({ archivedAt })
        .where(eq(classes.id, id));
    });
    return true;
  }
  
  async getStudentCountByClass(classId: number): Promise<number> {
    const result = await db
      .select({ count: drizzleCount() })
      .from(students)
      .where(and(eq(students.classId, classId), activeEnrolledStudentCondition()));

    return result[0]?.count ?? 0;
  }
  
  async getClassSubjects(classId: number): Promise<ClassSubject[]> {
    const resolvedSubjectIds = await this.getResolvedClassSubjectIds(classId);
    return resolvedSubjectIds.map((subjectId, index) => ({
      id: -1 * (index + 1),
      classId,
      subjectId,
      assignmentMode: "add",
    } as ClassSubject));
  }

  async getClassSubjectOverridesByClasses(classIds: number[]): Promise<ClassSubject[]> {
    if (classIds.length === 0) return [];
    return db.select().from(classSubjects).where(inArray(classSubjects.classId, classIds));
  }
  
  async addClassSubject(classId: number, subjectId: number): Promise<ClassSubject> {
    const resolved = new Set((await this.getClassSubjects(classId)).map((row) => row.subjectId));
    resolved.add(subjectId);
    await this.setClassSubjects(classId, Array.from(resolved));

    return {
      id: -1 * (resolved.size + 1),
      classId,
      subjectId,
      assignmentMode: "add",
    } as ClassSubject;
  }
  
  async removeClassSubject(classId: number, subjectId: number): Promise<boolean> {
    const resolved = new Set((await this.getClassSubjects(classId)).map((row) => row.subjectId));
    resolved.delete(subjectId);
    await this.setClassSubjects(classId, Array.from(resolved));
    return true;
  }
  
  async setClassSubjects(classId: number, subjectIds: number[]): Promise<void> {
    const inheritedSubjectIds = new Set(await this.getInheritedSubjectIdsForClass(classId));
    const uniqueSubjectIds = Array.from(new Set(subjectIds));
    const desiredSubjectIds = new Set(uniqueSubjectIds);

    const inserts = [
      ...uniqueSubjectIds
        .filter((subjectId) => !inheritedSubjectIds.has(subjectId))
        .map((subjectId) => ({ classId, subjectId, assignmentMode: "add" as const })),
      ...Array.from(inheritedSubjectIds)
        .filter((subjectId) => !desiredSubjectIds.has(subjectId))
        .map((subjectId) => ({ classId, subjectId, assignmentMode: "remove" as const })),
    ];

    await db.transaction(async (tx) => {
      await tx.delete(classSubjects).where(eq(classSubjects.classId, classId));
      if (inserts.length > 0) {
        await tx.insert(classSubjects).values(inserts);
      }
    });
  }
  
  async migrateStudents(fromClassId: number, toClassId: number, studentIds?: number[]): Promise<number> {
    const conditions = [
      eq(students.classId, fromClassId),
      activeEnrolledStudentCondition(),
    ];

    if (studentIds && studentIds.length > 0) {
      conditions.push(inArray(students.id, studentIds));
    }

    const studentsToMigrate = await db
      .select()
      .from(students)
      .where(and(...conditions));

    for (const student of studentsToMigrate) {
      await db.update(students).set({ classId: toClassId }).where(eq(students.id, student.id));
      await db.delete(studentSubjects).where(eq(studentSubjects.studentId, student.id));
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
    return db
      .select()
      .from(students)
      .where(nonArchivedStudentCondition())
      .orderBy(...studentFirstNameOrder);
  }

  async getStudentsBySchool(schoolId: number): Promise<Student[]> {
    return db
      .select()
      .from(students)
      .where(and(eq(students.schoolId, schoolId), nonArchivedStudentCondition()))
      .orderBy(...studentFirstNameOrder);
  }

  async getActiveStudentsBySchool(schoolId: number): Promise<Student[]> {
    return db
      .select()
      .from(students)
      .where(and(eq(students.schoolId, schoolId), activeEnrolledStudentCondition()))
      .orderBy(...studentFirstNameOrder);
  }

  async getArchivedStudents(): Promise<Student[]> {
    return db
      .select()
      .from(students)
      .where(archivedStudentCondition())
      .orderBy(...studentFirstNameOrder);
  }

  async getArchivedStudentsBySchool(schoolId: number): Promise<Student[]> {
    return db
      .select()
      .from(students)
      .where(and(eq(students.schoolId, schoolId), archivedStudentCondition()))
      .orderBy(...studentFirstNameOrder);
  }

  async getStudent(id: number): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(eq(students.id, id));
    return student;
  }

  async getStudentsByClass(classId: number): Promise<Student[]> {
    return db
      .select()
      .from(students)
      .where(and(eq(students.classId, classId), activeEnrolledStudentCondition()))
      .orderBy(...studentFirstNameOrder);
  }

  async getStudentsByParent(parentId: number): Promise<Student[]> {
    return db
      .select()
      .from(students)
      .where(and(eq(students.parentId, parentId), nonArchivedStudentCondition()))
      .orderBy(...studentFirstNameOrder);
  }

  async createStudent(studentData: InsertStudent): Promise<Student> {
    const [newStudent] = await db.insert(students).values(studentData).returning();
    return newStudent;
  }

  async updateStudent(id: number, studentData: Partial<InsertStudent>): Promise<Student | undefined> {
    const [updated] = await db
      .update(students)
      .set(studentData)
      .where(and(eq(students.id, id), isNull(students.archivedAt)))
      .returning();
    return updated;
  }

  async deleteStudent(id: number): Promise<boolean> {
    const archived = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(students).where(eq(students.id, id));
      if (!existing || existing.archivedAt) {
        return false;
      }

      if (existing.userId) {
        await tx
          .update(users)
          .set({ isActive: false })
          .where(eq(users.id, existing.userId));
      }

      const [updated] = await tx
        .update(students)
        .set({ archivedAt: new Date(), status: "inactive" })
        .where(and(eq(students.id, id), isNull(students.archivedAt)))
        .returning();

      return !!updated;
    });

    return archived;
  }

  async getNextAdmissionNo(options?: { schoolId?: number | null; referenceDate?: string | Date | null }): Promise<string> {
    const referenceDate = this.normalizeReferenceDate(options?.referenceDate);
    const schoolId = options?.schoolId || null;
    const year = referenceDate.getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);

    const conditions = [
      gte(sql`COALESCE(${students.enrollmentDate}::timestamp, ${students.createdAt})`, start),
      lt(sql`COALESCE(${students.enrollmentDate}::timestamp, ${students.createdAt})`, end),
    ];
    if (schoolId) {
      conditions.push(eq(students.schoolId, schoolId));
    }

    const rows = await db
      .select({ admissionNo: students.admissionNo })
      .from(students)
      .where(and(...conditions));

    let maxSequence = 0;
    const pattern = new RegExp(`^FCGS${String(year).slice(-2)}S(\\d{4})${this.getSchoolSequenceCode(schoolId)}$`, "i");
    for (const row of rows) {
      const match = (row.admissionNo || "").match(pattern);
      if (!match) continue;
      const sequence = Number(match[1]);
      if (Number.isFinite(sequence) && sequence > maxSequence) {
        maxSequence = sequence;
      }
    }

    return this.buildFormattedSequenceNumber("S", schoolId, referenceDate, maxSequence + 1);
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
    const result = await db.select().from(classes).where(and(eq(classes.classTeacherId, staffId), isNull(classes.archivedAt)));
    return result.map(c => ({ id: c.id, classId: c.id }));
  }

  async updateStaffClasses(staffId: number, classIds: number[]): Promise<void> {
    const effectiveFrom = new Date();
    await db.transaction(async (tx) => {
      const currentAssignments = await tx.select().from(classes).where(and(eq(classes.classTeacherId, staffId), isNull(classes.archivedAt)));
      const currentClassIds = new Set(currentAssignments.map((item) => item.id));
      const requestedClassIds = new Set(classIds);

      for (const currentClassId of currentClassIds) {
        if (requestedClassIds.has(currentClassId)) continue;
        await tx.update(classes).set({ classTeacherId: null }).where(eq(classes.id, currentClassId));
        await tx.update(classTeacherAssignments)
          .set({ effectiveTo: effectiveFrom })
          .where(and(eq(classTeacherAssignments.classId, currentClassId), isNull(classTeacherAssignments.effectiveTo)));
      }

      for (const classId of classIds) {
        const [existingClass] = await tx.select().from(classes).where(and(eq(classes.id, classId), isNull(classes.archivedAt)));
        if (!existingClass) continue;
        if (existingClass.classTeacherId === staffId) continue;

        await tx.update(classTeacherAssignments)
          .set({ effectiveTo: effectiveFrom })
          .where(and(eq(classTeacherAssignments.classId, classId), isNull(classTeacherAssignments.effectiveTo)));

        await tx.update(classes).set({ classTeacherId: staffId }).where(eq(classes.id, classId));
        await tx.insert(classTeacherAssignments).values({ classId, teacherId: staffId, effectiveFrom });
      }
    });
  }

  async getStudentSubjects(studentId: number): Promise<StudentSubject[]> {
    const resolvedSubjectIds = await this.getResolvedStudentSubjectIds(studentId);
    return resolvedSubjectIds.map((subjectId, index) => ({
      id: -1 * (index + 1),
      studentId,
      subjectId,
      assignmentMode: "add",
    } as StudentSubject));
  }

  async getStudentSubjectOverridesByStudents(studentIds: number[]): Promise<StudentSubject[]> {
    if (studentIds.length === 0) return [];
    return db.select().from(studentSubjects).where(inArray(studentSubjects.studentId, studentIds));
  }

  async updateStudentSubjects(studentId: number, subjectIds: number[]): Promise<void> {
    const student = await this.getStudent(studentId);
    const inheritedSubjectIds = new Set<number>(student?.classId ? await this.getResolvedClassSubjectIds(student.classId) : []);
    const uniqueSubjectIds = Array.from(new Set(subjectIds));
    const desiredSubjectIds = new Set(uniqueSubjectIds);

    const inserts = [
      ...uniqueSubjectIds
        .filter((subjectId) => !inheritedSubjectIds.has(subjectId))
        .map((subjectId) => ({ studentId, subjectId, assignmentMode: "add" as const })),
      ...Array.from(inheritedSubjectIds)
        .filter((subjectId) => !desiredSubjectIds.has(subjectId))
        .map((subjectId) => ({ studentId, subjectId, assignmentMode: "remove" as const })),
    ];

    await db.transaction(async (tx) => {
      await tx.delete(studentSubjects).where(eq(studentSubjects.studentId, studentId));
      if (inserts.length > 0) {
        await tx.insert(studentSubjects).values(inserts);
      }
    });
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

  async attachClassToGrades(classId: number, gradeIds: number[]): Promise<number> {
    const normalizedGradeIds = Array.from(new Set(gradeIds.map(Number).filter(Number.isFinite)));
    if (!Number.isFinite(classId) || normalizedGradeIds.length === 0) return 0;

    const updated = await db
      .update(grades)
      .set({
        classIds: sql<number[]>`array_append(COALESCE(${grades.classIds}, ARRAY[]::integer[]), ${classId})`,
      })
      .where(and(
        inArray(grades.id, normalizedGradeIds),
        sql`COALESCE(${grades.appliesAll}, false) = false`,
        sql`cardinality(COALESCE(${grades.classIds}, ARRAY[]::integer[])) > 0`,
        sql`NOT (${classId} = ANY(COALESCE(${grades.classIds}, ARRAY[]::integer[])))`,
      ))
      .returning({ id: grades.id });

    return updated.length;
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
    const [newAssessment] = await db.insert(assessments).values({
      ...assessmentData,
      isPublished: true,
    }).returning();
    return newAssessment;
  }

  async updateAssessment(id: number, assessmentData: Partial<InsertAssessment>): Promise<Assessment | undefined> {
    const [updated] = await db.update(assessments).set({
      ...assessmentData,
      isPublished: true,
    }).where(eq(assessments.id, id)).returning();
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

  async getDashboardStats(schoolId?: number | null, options: { fromDate?: string; toDate?: string; attendancePage?: number; attendancePageSize?: number } = {}): Promise<{
    totalStudents: number;
    totalStaff: number;
    totalClasses: number;
    totalSubjects: number;
    attendanceToday: { present: number; absent: number; unmarked: number; total: number; fromDate: string; toDate: string; page: number; pageSize: number; totalPages: number; totalRows: number };
    recentPayments: FeesPayment[];
    studentsGender: { male: number; female: number };
    studentsDailyStats: { approved: number; pending: number; transferred: number };
    classroomPopulation: Array<{ className: string; count: number }>;
    feesToday: { cash: number; mobileMoney: number; bank: number; total: number };
    termFeesCollected: number;
    staffMonitoring: { present: number; absent: number; late: number; earlyExits: number };
    absentStaff: Array<{ name: string; phone: string }>;
    lateComers: Array<{ name: string; inVariance: string; outVariance: string }>;
    studentsAttendanceByClass: Array<{ classId: number; className: string; teacher: string; absent: number; present: number; unmarked: number; total: number; attendancePercent: number }>;
    enrollmentTrend: Array<{ month: string; count: number }>;
    transferReasons: Array<{ name: string; value: number }>;
    libraryStats: { totalBooks: number; availableCopies: number; currentlyBorrowed: number; overdueBooks: number; unpaidFines: number; unpaidFinesAmount: number; paidFines: number; paidFinesAmount: number };
  }> {
    const today = new Date().toISOString().slice(0, 10);
    const normalizedFromDate = /^\d{4}-\d{2}-\d{2}$/.test(options.fromDate || "") ? options.fromDate! : today;
    const requestedToDate = /^\d{4}-\d{2}-\d{2}$/.test(options.toDate || "") ? options.toDate! : normalizedFromDate;
    const normalizedToDate = requestedToDate < normalizedFromDate ? normalizedFromDate : requestedToDate;
    const attendancePageSize = Math.max(1, Math.min(50, Number(options.attendancePageSize) || 10));
    const attendancePage = Math.max(1, Number(options.attendancePage) || 1);

    const toIsoDate = (value: unknown): string | null => {
      if (!value) return null;
      const dateValue = value instanceof Date ? value : new Date(value as string);
      if (Number.isNaN(dateValue.getTime())) return null;
      return dateValue.toISOString().slice(0, 10);
    };

    const parseAmount = (value: string | number | null | undefined) => Number.parseFloat(String(value ?? 0)) || 0;

    const generateEnrollmentTrend = (studentList: any[]) => {
      const now = new Date();

      const months = Array.from({ length: 24 }, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - (23 - index), 1);
        return {
          key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
          month: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
          value: 0,
        };
      });

      const monthMap = new Map(months.map((item) => [item.key, item]));

      for (const student of studentList) {
        const rawDate =
          student.enrollmentDate ||
          student.enrollment_date ||
          student.createdAt ||
          student.created_at;

        if (!rawDate) continue;

        const date = new Date(rawDate);
        if (Number.isNaN(date.getTime())) continue;

        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const bucket = monthMap.get(key);
        if (bucket) {
          bucket.value += 1;
        }
      }

      let runningTotal = 0;

      return months.map((item) => {
        runningTotal += item.value;
        return {
          month: item.month,
          count: runningTotal,
        };
      });
    };

    const enumerateDates = (startDate: string, endDate: string) => {
      const results: string[] = [];
      const cursor = new Date(`${startDate}T00:00:00.000Z`);
      const stop = new Date(`${endDate}T00:00:00.000Z`);
      while (cursor.getTime() <= stop.getTime()) {
        results.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return results;
    };

    const formatTeacherName = (staffMember: any) => {
      if (!staffMember) return "-";
      const gender = String(staffMember.gender || "").toLowerCase();
      const title = gender === "male" ? "Mr" : gender === "female" ? "Ms" : "";
      const firstInitial = staffMember.firstName ? `${String(staffMember.firstName).trim().charAt(0).toUpperCase()}.` : "";
      const surname = String(staffMember.lastName || "").trim();
      return [title, firstInitial, surname].filter(Boolean).join(" ").trim() || "-";
    };

    const buildAttendanceStats = async (sid?: number | null) => {
      const studentQuery = sid
        ? db
            .select()
            .from(students)
            .where(and(eq(students.schoolId, sid), activeEnrolledStudentCondition()))
        : db
            .select()
            .from(students)
            .where(activeEnrolledStudentCondition());

      const studentsList = await studentQuery;
      const classIdsFromStudents = Array.from(new Set(
        studentsList
          .map((studentItem) => studentItem.classId)
          .filter((value): value is number => typeof value === "number"),
      ));

      const attendanceList = sid
        ? await db
            .select({
              id: attendanceRecords.id,
              studentId: attendanceRecords.studentId,
              classId: attendanceRecords.classId,
              date: attendanceRecords.date,
              status: attendanceRecords.status,
              reason: attendanceRecords.reason,
              notifyParent: attendanceRecords.notifyParent,
              notifiedStatus: attendanceRecords.notifiedStatus,
              notifiedReason: attendanceRecords.notifiedReason,
              markedBy: attendanceRecords.markedBy,
              createdAt: attendanceRecords.createdAt,
            })
            .from(attendanceRecords)
            .innerJoin(students, eq(students.id, attendanceRecords.studentId))
            .where(and(
              eq(students.schoolId, sid),
              activeEnrolledStudentCondition(),
              gte(attendanceRecords.date, normalizedFromDate),
              lte(attendanceRecords.date, normalizedToDate),
            ))
        : await db
            .select({
              id: attendanceRecords.id,
              studentId: attendanceRecords.studentId,
              classId: attendanceRecords.classId,
              date: attendanceRecords.date,
              status: attendanceRecords.status,
              reason: attendanceRecords.reason,
              notifyParent: attendanceRecords.notifyParent,
              notifiedStatus: attendanceRecords.notifiedStatus,
              notifiedReason: attendanceRecords.notifiedReason,
              markedBy: attendanceRecords.markedBy,
              createdAt: attendanceRecords.createdAt,
            })
            .from(attendanceRecords)
            .innerJoin(students, eq(students.id, attendanceRecords.studentId))
            .where(and(
              activeEnrolledStudentCondition(),
              gte(attendanceRecords.date, normalizedFromDate),
              lte(attendanceRecords.date, normalizedToDate),
            ));

      const attendanceClassIds = Array.from(new Set(
        attendanceList
          .map((attendanceRecord) => attendanceRecord.classId)
          .filter((value): value is number => typeof value === "number"),
      ));

      const classScopeIds = Array.from(new Set([...classIdsFromStudents, ...attendanceClassIds]));
      const classQuery = sid
        ? classScopeIds.length
          ? db.select().from(classes).where(or(eq(classes.schoolId, sid), inArray(classes.id, classScopeIds))).orderBy(classes.className)
          : db.select().from(classes).where(eq(classes.schoolId, sid)).orderBy(classes.className)
        : db.select().from(classes).orderBy(classes.className);

      const classesList = await classQuery;
      const relevantClasses = classesList.filter((classItem) => {
        const createdDate = toIsoDate(classItem.createdAt) || normalizedFromDate;
        const archivedDate = toIsoDate(classItem.archivedAt);
        const hasAttendanceInRange = attendanceClassIds.includes(classItem.id);
        return hasAttendanceInRange || (createdDate <= normalizedToDate && (!archivedDate || archivedDate >= normalizedFromDate));
      });

      if (!relevantClasses.length) {
        return {
          summary: { present: 0, absent: 0, unmarked: 0, total: 0, fromDate: normalizedFromDate, toDate: normalizedToDate, page: attendancePage, pageSize: attendancePageSize, totalPages: 0, totalRows: 0 },
          rows: [] as Array<{ classId: number; className: string; teacher: string; absent: number; present: number; unmarked: number; total: number; attendancePercent: number }>,
        };
      }

      const relevantClassIds = relevantClasses.map((classItem) => classItem.id);
      const activeStudents = studentsList.filter((studentItem: any) => {
        if (!studentItem.classId || !relevantClassIds.includes(studentItem.classId)) return false;
        const status = String(studentItem.status || "active").toLowerCase();
        return status === "active" || status === "approved" || status === "";
      });

      const assignmentList = relevantClassIds.length
        ? await db
            .select()
            .from(classTeacherAssignments)
            .where(inArray(classTeacherAssignments.classId, relevantClassIds))
            .orderBy(asc(classTeacherAssignments.classId), asc(classTeacherAssignments.effectiveFrom))
        : [];

      const teacherIds = Array.from(new Set([
        ...relevantClasses.map((classItem) => classItem.classTeacherId).filter(Boolean),
        ...assignmentList.map((assignment) => assignment.teacherId),
      ] as number[]));

      const staffList = teacherIds.length
        ? await db.select().from(staff).where(inArray(staff.id, teacherIds))
        : [];

      const staffById = new Map(staffList.map((staffMember) => [staffMember.id, staffMember]));
      const classAssignments = new Map<number, ClassTeacherAssignment[]>();
      assignmentList.forEach((assignment) => {
        const list = classAssignments.get(assignment.classId) || [];
        list.push(assignment);
        classAssignments.set(assignment.classId, list);
      });

      const attendanceByDateClass = new Map<string, typeof attendanceList>();
      const schoolHasRecordsByDate = new Set<string>();
      attendanceList.forEach((attendanceRecord) => {
        if (!relevantClassIds.includes(attendanceRecord.classId)) return;
        const key = `${attendanceRecord.date}::${attendanceRecord.classId}`;
        const list = attendanceByDateClass.get(key) || [];
        list.push(attendanceRecord);
        attendanceByDateClass.set(key, list);
        schoolHasRecordsByDate.add(attendanceRecord.date);
      });

      const rosterByClass = new Map<number, number>();
      activeStudents.forEach((studentItem) => {
        if (!studentItem.classId) return;
        rosterByClass.set(studentItem.classId, (rosterByClass.get(studentItem.classId) || 0) + 1);
      });

      const rangeDates = enumerateDates(normalizedFromDate, normalizedToDate);
      const getTeacherLabelForRange = (classItem: Class) => {
        const assignments = (classAssignments.get(classItem.id) || []).filter((assignment) => {
          const start = toIsoDate(assignment.effectiveFrom) || normalizedFromDate;
          const end = toIsoDate(assignment.effectiveTo) || normalizedToDate;
          return start <= normalizedToDate && end >= normalizedFromDate;
        });

        if (normalizedFromDate === normalizedToDate) {
          const activeAssignment = assignments.find((assignment) => {
            const start = toIsoDate(assignment.effectiveFrom) || normalizedFromDate;
            const end = toIsoDate(assignment.effectiveTo) || normalizedToDate;
            return start <= normalizedFromDate && end >= normalizedFromDate;
          });
          if (activeAssignment) return formatTeacherName(staffById.get(activeAssignment.teacherId));
          if ((toIsoDate(classItem.archivedAt) || today) >= normalizedFromDate && classItem.classTeacherId) {
            return formatTeacherName(staffById.get(classItem.classTeacherId));
          }
          return "-";
        }

        const teacherLabels: string[] = [];
        const seen = new Set<string>();
        assignments.forEach((assignment) => {
          const label = formatTeacherName(staffById.get(assignment.teacherId));
          if (!seen.has(label)) {
            seen.add(label);
            teacherLabels.push(label);
          }
        });

        if (!teacherLabels.length && classItem.classTeacherId) {
          teacherLabels.push(formatTeacherName(staffById.get(classItem.classTeacherId)));
        }

        return teacherLabels.join(", ") || "-";
      };

      const rows = relevantClasses.map((classItem) => {
        let present = 0;
        let absent = 0;
        let unmarked = 0;
        let total = 0;

        rangeDates.forEach((dateKey) => {
          const createdDate = toIsoDate(classItem.createdAt) || dateKey;
          const archivedDate = toIsoDate(classItem.archivedAt);
          const hasAttendanceOnDate = attendanceByDateClass.has(`${dateKey}::${classItem.id}`);
          if (!hasAttendanceOnDate) {
            if (createdDate > dateKey) return;
            if (archivedDate && archivedDate < dateKey) return;
          }

          const records = attendanceByDateClass.get(`${dateKey}::${classItem.id}`) || [];
          if (records.length > 0) {
            const datePresent = records.filter((record) => record.status === "present").length;
            const dateAbsent = records.length - datePresent;
            present += datePresent;
            absent += dateAbsent;
            total += records.length;
            return;
          }

          const rosterCount = rosterByClass.get(classItem.id) || 0;
          const shouldTreatAsUnmarked = schoolHasRecordsByDate.has(dateKey) || dateKey === today;
          if (shouldTreatAsUnmarked && rosterCount > 0) {
            unmarked += rosterCount;
            total += rosterCount;
          }
        });

        return {
          classId: classItem.id,
          className: classItem.shortCode?.trim() || classItem.className,
          teacher: getTeacherLabelForRange(classItem),
          present,
          absent,
          unmarked,
          total,
          attendancePercent: total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0,
        };
      }).sort((left, right) => left.className.localeCompare(right.className));

      const totalRows = rows.length;
      const totalPages = totalRows === 0 ? 0 : Math.ceil(totalRows / attendancePageSize);
      const safePage = totalPages === 0 ? 1 : Math.min(attendancePage, totalPages);
      const paginatedRows = rows.slice((safePage - 1) * attendancePageSize, safePage * attendancePageSize);
      const summary = rows.reduce((accumulator, row) => ({
        present: accumulator.present + row.present,
        absent: accumulator.absent + row.absent,
        unmarked: accumulator.unmarked + row.unmarked,
        total: accumulator.total + row.total,
      }), { present: 0, absent: 0, unmarked: 0, total: 0 });

      return {
        summary: {
          ...summary,
          fromDate: normalizedFromDate,
          toDate: normalizedToDate,
          page: safePage,
          pageSize: attendancePageSize,
          totalPages,
          totalRows,
        },
        rows: paginatedRows,
      };
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
        unpaidFinesAmount: unpaidFinesList.reduce((sum, f) => sum + parseAmount(f.amount), 0),
        paidFines: paidFinesList.length,
        paidFinesAmount: paidFinesList.reduce((sum, f) => sum + parseAmount(f.amount), 0),
      };
    };

    if (schoolId) {
      const schoolStudentRecordsList = await db
        .select()
        .from(students)
        .where(and(eq(students.schoolId, schoolId), nonArchivedStudentCondition()));

      const schoolStudentsList = schoolStudentRecordsList.filter((studentItem: any) => {
        const status = String(studentItem.status || "active").toLowerCase();
        return DASHBOARD_ACTIVE_STUDENT_STATUSES.has(status);
      });
      const schoolStaffList = await db.select().from(staff).where(eq(staff.schoolId, schoolId));
      const schoolClassesList = await db.select().from(classes).where(and(eq(classes.schoolId, schoolId), isNull(classes.archivedAt)));
      const allSubjectsList = await db.select().from(subjects);
      const studentIds = new Set(schoolStudentRecordsList.map(s => s.id));
      const [attendanceStats, allPayments] = await Promise.all([
        buildAttendanceStats(schoolId),
        db.select().from(feesPayments).orderBy(desc(feesPayments.paymentDate)).limit(50),
      ]);
      const recentPayments = allPayments.filter(p => studentIds.has(p.studentId)).slice(0, 10);

      const activeStudentsList = schoolStudentsList;
      const approved = activeStudentsList.length;
      const maleCount = activeStudentsList.filter(s => s.gender === 'male').length;
      const femaleCount = activeStudentsList.filter(s => s.gender === 'female').length;
      const pending = schoolStudentRecordsList.filter((s: any) => String(s.status || '').toLowerCase() === 'pending').length;
      const transferred = schoolStudentRecordsList.filter((s: any) => String(s.status || '').toLowerCase() === 'transferred').length;

      const todayPayments = recentPayments.filter(p => p.paymentDate === today);
      const cashToday = todayPayments.filter(p => p.paymentMethod === 'cash').reduce((sum, p) => sum + parseAmount(p.amount), 0);
      const mobileToday = todayPayments.filter(p => p.paymentMethod === 'mobile_money').reduce((sum, p) => sum + parseAmount(p.amount), 0);
      const bankToday = todayPayments.filter(p => p.paymentMethod === 'bank_transfer').reduce((sum, p) => sum + parseAmount(p.amount), 0);
      const termTotal = allPayments.filter(p => studentIds.has(p.studentId)).reduce((sum, p) => sum + parseAmount(p.amount), 0);

      const enrollmentTrend = generateEnrollmentTrend(schoolStudentsList);
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
        attendanceToday: attendanceStats.summary,
        recentPayments,
        studentsGender: { male: maleCount, female: femaleCount },
        studentsDailyStats: { approved, pending, transferred },
        classroomPopulation: computeClassroomPopulation(schoolStudentsList, schoolClassesList),
        feesToday: { cash: cashToday, mobileMoney: mobileToday, bank: bankToday, total: cashToday + mobileToday + bankToday },
        termFeesCollected: termTotal,
        staffMonitoring: { present: 0, absent: 0, late: 0, earlyExits: 0 },
        absentStaff: [],
        lateComers: [],
        studentsAttendanceByClass: attendanceStats.rows,
        enrollmentTrend,
        transferReasons,
        libraryStats: await computeLibraryStats(schoolId)
      };
    }

    const [studentCount, staffCount, classCount, subjectCount] = await Promise.all([
      db.select({ count: drizzleCount() }).from(students).where(activeEnrolledStudentCondition()),
      db.select({ count: drizzleCount() }).from(staff),
      db.select({ count: drizzleCount() }).from(classes).where(isNull(classes.archivedAt)),
      db.select({ count: drizzleCount() }).from(subjects),
    ]);

    const [allStudents, allStudentRecords, allClasses, attendanceStats, recentPayments] = await Promise.all([
      db.select().from(students).where(activeEnrolledStudentCondition()),
      db.select().from(students).where(nonArchivedStudentCondition()),
      db.select().from(classes).where(isNull(classes.archivedAt)),
      buildAttendanceStats(),
      db.select().from(feesPayments).orderBy(desc(feesPayments.paymentDate)).limit(10),
    ]);

    const activeStudentsList = allStudents;
    const approved = activeStudentsList.length;
    const maleCount = activeStudentsList.filter(s => s.gender === 'male').length;
    const femaleCount = activeStudentsList.filter(s => s.gender === 'female').length;
    const pending = allStudentRecords.filter((s: any) => String(s.status || '').toLowerCase() === 'pending').length;
    const transferred = allStudentRecords.filter((s: any) => String(s.status || '').toLowerCase() === 'transferred').length;

    const todayPayments = recentPayments.filter(p => p.paymentDate === today);
    const cashToday = todayPayments.filter(p => p.paymentMethod === 'cash').reduce((sum, p) => sum + parseAmount(p.amount), 0);
    const mobileToday = todayPayments.filter(p => p.paymentMethod === 'mobile_money').reduce((sum, p) => sum + parseAmount(p.amount), 0);
    const bankToday = todayPayments.filter(p => p.paymentMethod === 'bank_transfer').reduce((sum, p) => sum + parseAmount(p.amount), 0);
    const termTotal = recentPayments.reduce((sum, p) => sum + parseAmount(p.amount), 0);

    const enrollmentTrend = generateEnrollmentTrend(allStudents);
    const transferReasons = [
      { name: 'Fees Issues', value: Math.floor(transferred * 0.35) },
      { name: 'Relocation', value: Math.floor(transferred * 0.25) },
      { name: 'Academic', value: Math.floor(transferred * 0.20) },
      { name: 'Other', value: Math.ceil(transferred * 0.20) }
    ].filter(r => r.value > 0);

    return {
      totalStudents: studentCount[0]?.count || 0,
      totalStaff: staffCount[0]?.count || 0,
      totalClasses: classCount[0]?.count || 0,
      totalSubjects: subjectCount[0]?.count || 0,
      attendanceToday: attendanceStats.summary,
      recentPayments,
      studentsGender: { male: maleCount, female: femaleCount },
      studentsDailyStats: { approved, pending, transferred },
      classroomPopulation: computeClassroomPopulation(allStudents, allClasses),
      feesToday: { cash: cashToday, mobileMoney: mobileToday, bank: bankToday, total: cashToday + mobileToday + bankToday },
      termFeesCollected: termTotal,
      staffMonitoring: { present: 0, absent: 0, late: 0, earlyExits: 0 },
      absentStaff: [],
      lateComers: [],
      studentsAttendanceByClass: attendanceStats.rows,
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

  // Library - Shelves
  async getLibraryShelves(schoolId: number): Promise<LibraryShelf[]> {
    return db.select().from(libraryShelves).where(eq(libraryShelves.schoolId, schoolId)).orderBy(libraryShelves.name);
  }

  async createLibraryShelf(data: InsertLibraryShelf): Promise<LibraryShelf> {
    const [shelf] = await db.insert(libraryShelves).values(data).returning();
    return shelf;
  }

  async updateLibraryShelf(id: number, data: Partial<InsertLibraryShelf>): Promise<LibraryShelf | undefined> {
    const [updated] = await db.update(libraryShelves).set(data).where(eq(libraryShelves.id, id)).returning();
    return updated;
  }

  async deleteLibraryShelf(id: number): Promise<boolean> {
    await db.delete(libraryShelves).where(eq(libraryShelves.id, id));
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
    if (schoolId && classId) {
      return db.select().from(timetableSlots).where(
        and(eq(timetableSlots.schoolId, schoolId), eq(timetableSlots.classId, classId)),
      );
    }
    if (schoolId) {
      return db.select().from(timetableSlots).where(eq(timetableSlots.schoolId, schoolId));
    }
    if (classId) {
      return db.select().from(timetableSlots).where(eq(timetableSlots.classId, classId));
    }
    return db.select().from(timetableSlots);
  }

  async getTimetableSlot(id: number): Promise<TimetableSlot | undefined> {
    const [slot] = await db.select().from(timetableSlots).where(eq(timetableSlots.id, id));
    return slot;
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

  async getPosSale(id: number): Promise<PosSale | undefined> {
    const [sale] = await db.select().from(posSales).where(eq(posSales.id, id));
    return sale;
  }

  async createPosSaleWithItems(args: {
    schoolId: number;
    paymentMethod: string;
    customerName?: string | null;
    studentId?: number | null;
    soldBy?: number | null;
    items: Array<{ itemId: number; quantity: number }>;
  }): Promise<{ sale: PosSale; items: PosSaleItem[] }> {
    const groupedItems = new Map<number, number>();
    for (const item of args.items) {
      groupedItems.set(item.itemId, (groupedItems.get(item.itemId) || 0) + item.quantity);
    }

    return db.transaction(async (tx) => {
      const lines: Array<{ item: PosItem; quantity: number; unitPrice: string; totalPrice: string }> = [];
      let totalCents = 0;

      for (const [itemId, quantity] of [...groupedItems.entries()].sort((a, b) => a[0] - b[0])) {
        const [item] = await tx
          .select()
          .from(posItems)
          .where(and(
            eq(posItems.id, itemId),
            eq(posItems.schoolId, args.schoolId),
            or(eq(posItems.isActive, true), isNull(posItems.isActive)),
          ))
          .for("update");

        if (!item) {
          throw new PosSaleProcessingError("ITEM_NOT_FOUND", `POS item ${itemId} was not found in the active school.`);
        }

        const available = item.stockQty ?? 0;
        if (available < quantity) {
          throw new PosSaleProcessingError(
            "INSUFFICIENT_STOCK",
            `${item.name} has only ${available} unit${available === 1 ? "" : "s"} available.`,
          );
        }

        const unitPriceCents = Math.round(Number(item.price) * 100);
        if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) {
          throw new PosSaleProcessingError("INVALID_PRICE", `${item.name} has an invalid selling price.`);
        }

        const lineTotalCents = unitPriceCents * quantity;
        totalCents += lineTotalCents;
        lines.push({
          item,
          quantity,
          unitPrice: (unitPriceCents / 100).toFixed(2),
          totalPrice: (lineTotalCents / 100).toFixed(2),
        });
      }

      const [sale] = await tx.insert(posSales).values({
        schoolId: args.schoolId,
        customerName: args.customerName || null,
        studentId: args.studentId || null,
        totalAmount: (totalCents / 100).toFixed(2),
        paymentMethod: args.paymentMethod,
        soldBy: args.soldBy || null,
      }).returning();

      const saleItems = await tx.insert(posSaleItems).values(lines.map((line) => ({
        saleId: sale.id,
        itemId: line.item.id,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: line.totalPrice,
      }))).returning();

      for (const line of lines) {
        await tx.update(posItems)
          .set({ stockQty: (line.item.stockQty ?? 0) - line.quantity })
          .where(and(eq(posItems.id, line.item.id), eq(posItems.schoolId, args.schoolId)));
      }

      return { sale, items: saleItems };
    });
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
    const hostelStudents = await db.select().from(students).where(eq(students.hostelId, hostelId));
    const studentIds = hostelStudents.map((student) => student.id);
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
    const hostelStudents = await db.select().from(students).where(eq(students.hostelId, hostelId));
    const studentIds = hostelStudents.map((student) => student.id);
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
  private normalizeAccessLookupKey(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized || null;
  }

  private async findAccessGroupByLookupKey(candidates: Array<string | null | undefined>): Promise<AccessGroup | undefined> {
    const candidateKeys = new Set(
      candidates
        .map((candidate) => this.normalizeAccessLookupKey(candidate))
        .filter((candidate): candidate is string => Boolean(candidate))
    );
    if (candidateKeys.size === 0) return undefined;

    const groups = await this.getAllAccessGroups();
    return groups.find((group) => {
      const groupKey = this.normalizeAccessLookupKey(group.name);
      return groupKey ? candidateKeys.has(groupKey) : false;
    });
  }

  private async resolveBaselineAccessGroupForUser(userId: number, user: User): Promise<{ group?: AccessGroup; authoritative: boolean }> {
    const [staffMember] = await db.select().from(staff).where(eq(staff.userId, userId));

    if (staffMember?.accessGroupId) {
      const explicitGroup = await this.getAccessGroup(staffMember.accessGroupId);
      if (explicitGroup) return { group: explicitGroup, authoritative: true };
    }

    if (staffMember?.role) {
      const [configuredRole] = await db.select().from(staffRoles).where(eq(staffRoles.name, staffMember.role));
      const matchedGroup = await this.findAccessGroupByLookupKey([
        staffMember.role,
        configuredRole?.name,
        configuredRole?.label,
      ]);
      if (matchedGroup) return { group: matchedGroup, authoritative: true };
    }

    const roleMatchedGroup = await this.findAccessGroupByLookupKey([user.role]);
    return { group: roleMatchedGroup, authoritative: false };
  }

  async ensureUserBaselineAccessGroups(userId: number): Promise<void> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return;

    const existingGroups = await db
      .select({ group: accessGroups })
      .from(userAccessGroups)
      .innerJoin(accessGroups, eq(userAccessGroups.accessGroupId, accessGroups.id))
      .where(eq(userAccessGroups.userId, userId));
    const currentGroupIds = new Set(existingGroups.map(({ group }) => group.id));

    if (user.role === "org_admin") {
      const orgHqGroup = await this.findAccessGroupByLookupKey(["org_hq", "org admin", "organization hq"]);
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

    const { group: targetGroup, authoritative } = await this.resolveBaselineAccessGroupForUser(userId, user);
    if (!targetGroup) return;

    if (authoritative) {
      const staleGroupIds = existingGroups
        .map(({ group }) => group.id)
        .filter((groupId) => groupId !== targetGroup.id);

      if (staleGroupIds.length > 0) {
        await db.delete(userAccessGroups).where(
          and(
            eq(userAccessGroups.userId, userId),
            inArray(userAccessGroups.accessGroupId, staleGroupIds)
          )
        );
      }
    }

    if (!currentGroupIds.has(targetGroup.id)) {
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

    const allStudents = await db.select().from(students).orderBy(...studentFirstNameOrder).limit(100);
    const studentResults = allStudents.filter(s => {
      const searchLower = query.toLowerCase();
      return (
        s.firstName?.toLowerCase().includes(searchLower) ||
        s.lastName?.toLowerCase().includes(searchLower) ||
        s.email?.toLowerCase().includes(searchLower) ||
        s.phone?.includes(query) ||
        s.admissionNo?.toLowerCase().includes(searchLower)
      );
    }).sort(compareStudentsByFirstName).slice(0, 20);

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

  async getAssessmentPapersByAssessments(assessmentIds: number[]): Promise<AssessmentPaper[]> {
    if (assessmentIds.length === 0) return [];
    return db.select().from(assessmentPapers).where(inArray(assessmentPapers.assessmentId, assessmentIds));
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
    return db.transaction(async (tx) => {
      const existingPapers = await tx
        .select()
        .from(assessmentPapers)
        .where(eq(assessmentPapers.assessmentId, assessmentId));

      // This replacement helper is safe only during initial assessment creation. Updates
      // must use reconcileAssessmentPapersAndMarks so paper IDs and learner marks survive.
      if (existingPapers.length > 0) {
        const existingMarks = await tx
          .select({ id: assessmentMarks.id })
          .from(assessmentMarks)
          .where(eq(assessmentMarks.assessmentId, assessmentId))
          .limit(1);
        if (existingMarks.length > 0) {
          throw new Error(
            "Unsafe assessment paper replacement blocked because learner marks already exist. Use the reconciliation workflow instead.",
          );
        }
      }

      await tx.delete(assessmentPapers).where(eq(assessmentPapers.assessmentId, assessmentId));
      if (papers.length === 0) return [];
      return tx.insert(assessmentPapers).values(papers).returning();
    });
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
    return db.select().from(reportComments).where(and(...conditions)).orderBy(desc(reportComments.id));
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

  async getMarkPapersByMarks(assessmentMarkIds: number[]): Promise<AssessmentMarkPaper[]> {
    if (assessmentMarkIds.length === 0) return [];
    return db.select().from(assessmentMarkPapers).where(inArray(assessmentMarkPapers.assessmentMarkId, assessmentMarkIds));
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
