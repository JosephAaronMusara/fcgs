import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { setupAuth, requireAuth, requirePermission, requireRole } from "./auth";
import { storage } from "./storage";
import { compareStudentsByFirstName, sortStudentsByFirstName, studentFirstNameOrder } from "./student-sort";
import { db } from "./db";
import { staffSubjects, users, qcReports, qcRecords, assessmentMarks as assessmentMarksSchema, assessments as assessmentsSchema, assessmentTypes as assessmentTypesSchema, assessmentPapers as assessmentPapersSchema, assessmentMarkPapers as assessmentMarkPapersSchema, assessmentPublications, assessmentPublicationEvents, classSubjects as classSubjectsSchema, studentSubjects as studentSubjectsSchema, students as studentsTable, staff as staffTable, classes as classesTable, subjects as subjectsTable, libraryLoans as libraryLoansTable, timetableSlots as timetableSlotsTable, staffRoles, organizations, userSchoolAccess, reportComments, communicationJobs, libraryShelves as libraryShelvesTable, classTeacherAssignments as classTeacherAssignmentsTable, userAccessGroups } from "@shared/schema";
import multer from "multer";
import { parse as csvParse } from "csv-parse/sync";
import { eq, and, or, inArray, sql, like, desc, count as drizzleCount } from "drizzle-orm";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerCalendarRoutes } from "./calendar-routes";
import { communicationService, createBroadcastNotifications } from "./communication";
import { generateReportCardPdf, type ReportCardPdfData } from "./pdf-report-card";
import { parseFinitePercentage, resolveGradeForPercentage } from "./grade-resolution";
import { z } from "zod";
import bcrypt from "bcrypt";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import { 
  insertStaffSchema, insertStudentSchema, insertParentSchema, 
  insertClassSchema, insertSubjectSchema, insertGradeSchema,
  insertAssessmentSchema, insertMarkSchema, insertAttendanceRecordSchema,
  insertDisciplineRecordSchema, insertClinicRecordSchema, insertFeesPaymentSchema, insertStreamSchema,
  insertOrganizationSchema, insertSchoolSchema, insertLibraryResourceSchema, insertLibraryCategorySchema, insertLibraryShelfSchema, insertLibraryBookSchema, insertLibraryLoanSchema, insertLibraryFineSchema, insertLibraryReservationSchema,
  libraryBooks as libraryBooksTable, libraryBookCopies as libraryBookCopiesTable, libraryFines as libraryFinesTable, libraryReservations as libraryReservationsTable,
  insertTimetableSlotSchema, insertLogbookEntrySchema, insertStaffAttendanceLogSchema, insertPosItemSchema,
  schools as schoolsTable, staff, parents as parentsTable,
  insertPosSaleSchema, insertNewsletterSchema, insertSchemeSchema,
  insertHostelSchema, insertHostelRollCallSchema, insertStudentApplicationSchema,
  hostels as hostelsTable,
  insertPermissionSchema, insertAccessGroupSchema,
  type User, type AccessGroup, type Staff, type InsertStudent, type InsertActivityLog
} from "@shared/schema";
import { ECD_DOMAIN_SEEDS, filterItemsByGradeProfileKey, getCompatibleGradeProfileKeys, getGradingProfilesForSchool, getGradeProfileLabel, getSubjectTypeOptionsForSchool, isEcdStream, isSubjectTypeCompatibleWithGradeType, normalizeExamBoard, normalizeSchoolType, profileMatchesStreamName, resolveGradeProfileKey, resolveSecondaryGroupingFromStream, type GradeProfileKey } from "@shared/academic-profiles";

function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
});

const updateUserPermissionsSchema = z.object({
  schoolIds: z.array(z.number()).optional().default([]),
  permissionIds: z.array(z.number()).optional().default([]),
});

const PASSWORD_RULES = {
  minLength: 8,
  requireLowercase: true,
  requireUppercase: true,
  requireSpecial: true,
};

function getGradesForProfile(grades: any[], profileKey: string | null | undefined) {
  return filterItemsByGradeProfileKey(grades, profileKey);
}

async function resolveGradeProfileContext(args: {
  schoolId: number;
  classId: number;
  subjectId: number;
}): Promise<{
  profileKey: GradeProfileKey | null;
  school: any;
  classInfo: any;
  subject: any;
  streamName: string | null;
}> {
  const school = await storage.getSchool(args.schoolId);
  const classInfo = await storage.getClass(args.classId);
  const subject = await storage.getSubject(args.subjectId);
  // A class assessment must always use the assessment class stream. Student stream
  // values can be blank or stale after enrolments/transfers and must not change grading.
  const streamId = classInfo?.streamId ?? null;
  const stream = streamId ? await storage.getStream(streamId) : undefined;
  const streamName = stream?.name || null;
  const profileKey = resolveGradeProfileKey({
    schoolType: school?.schoolType,
    examinationBoard: school?.examinationBoard,
    streamName,
    subjectType: subject?.subjectType,
  });
  return { profileKey, school, classInfo, subject, streamName };
}

function isSubjectAvailableForClass(subject: any, classInfo: any): boolean {
  const classStreamId = classInfo?.streamId ? Number(classInfo.streamId) : null;
  const subjectStreamIds = Array.isArray(subject?.streamIds) && subject.streamIds.length > 0
    ? subject.streamIds.map((id: any) => Number(id))
    : subject?.streamId ? [Number(subject.streamId)] : [];

  if (!classStreamId || subjectStreamIds.length === 0) return true;
  return subjectStreamIds.includes(classStreamId);
}

function isGradeApplicableToClass(grade: any, classId: number): boolean {
  if (grade?.appliesAll) return true;
  if (!Array.isArray(grade?.classIds) || grade.classIds.length === 0) return true;
  return grade.classIds.map((id: any) => Number(id)).includes(Number(classId));
}

function getApplicableGradesForContext(grades: any[], args: { profileKey: string | null | undefined; classId: number }) {
  return getGradesForProfile(grades, args.profileKey).filter((grade) => isGradeApplicableToClass(grade, args.classId));
}

function getClassSubjectGradeCandidates(args: {
  allGrades: any[];
  school: any;
  classInfo: any;
  classStreamName?: string | null;
  subject: any;
}) {
  const profileKey = resolveGradeProfileKey({
    schoolType: args.school?.schoolType,
    examinationBoard: args.school?.examinationBoard,
    streamName: args.classStreamName || null,
    subjectType: args.subject?.subjectType,
  });
  return {
    profileKey,
    grades: profileKey
      ? getApplicableGradesForContext(args.allGrades, {
          profileKey,
          classId: Number(args.classInfo?.id || 0),
        })
      : [],
  };
}

function resolveStoredAssessmentGrade(args: {
  mark: any;
  percentage: number | null;
  applicableGrades: any[];
  allGrades: any[];
  subjectType?: string | null;
}) {
  if (args.percentage === null) return null;

  if (args.mark?.gradeId) {
    const linkedGrade = args.allGrades.find(
      (grade) => Number(grade.id) === Number(args.mark.gradeId),
    );
    if (linkedGrade) return linkedGrade;
  }

  const resolution = resolveGradeForPercentage(
    args.percentage,
    args.applicableGrades,
    args.subjectType,
  );
  return resolution.ambiguous ? null : resolution.grade;
}

async function getCurrentStaffMember(req: Request, schoolId: number) {
  const currentUser = await storage.getUser((req.user as any).id);
  if (!currentUser) return null;
  const schoolStaff = await storage.getStaffBySchool(schoolId);
  return schoolStaff.find((member) => member.userId === currentUser.id) || null;
}

function isTeacherScopedRole(role?: string | null) {
  return role === "teacher" || role === "assistant_teacher";
}

async function getTeacherAssignmentScope(req: Request, schoolId: number) {
  const currentUser = req.user as User;
  if (!isTeacherScopedRole(currentUser?.role)) return null;

  const staffMember = await getCurrentStaffMember(req, schoolId);
  if (!staffMember) {
    return { staffMember: null, assignments: [] as any[] };
  }

  const assignments = (await storage.getStaffSubjects(staffMember.id))
    .filter((row: any) => row.classId !== null && row.classId !== undefined);

  return { staffMember, assignments };
}

function isPairInTeacherAssignments(assignments: any[], classId: number, subjectId: number) {
  return assignments.some((row) =>
    Number(row.classId) === Number(classId) && Number(row.subjectId) === Number(subjectId)
  );
}

async function ensureTeacherAssignmentForAssessment(req: Request, res: Response, schoolId: number, classId: number, subjectId: number) {
  const scope = await getTeacherAssignmentScope(req, schoolId);
  if (!scope) return true;

  if (isPairInTeacherAssignments(scope.assignments, classId, subjectId)) {
    return true;
  }

  res.status(403).json({ message: "You are not assigned to this class and subject combination" });
  return false;
}

function calculatePositionMap(items: Array<{ id: number; value: number | null }>) {
  const filtered = items.filter((item) => item.value !== null).sort((a, b) => (b.value || 0) - (a.value || 0));
  const map = new Map<number, string>();
  const size = filtered.length;
  let currentPosition = 0;
  let lastValue: number | null = null;
  filtered.forEach((item, index) => {
    if (item.value !== lastValue) {
      currentPosition = index + 1;
      lastValue = item.value;
    }
    map.set(item.id, `${currentPosition}/${size}`);
  });
  return { size, map };
}

async function calculateStreamPositionMap(examId: number, schoolId: number, streamId?: number | null) {
  if (!streamId) return { size: 0, map: new Map<number, string>() };
  const classes = (await storage.getClassesBySchool(schoolId)).filter((cls) => cls.streamId === streamId);
  if (classes.length === 0) return { size: 0, map: new Map<number, string>() };

  const allAssessments = await storage.getAssessmentsByExam(examId);
  const classIds = new Set(classes.map((cls) => cls.id));
  const streamAssessments = allAssessments.filter((assessment) => classIds.has(assessment.classId));
  if (streamAssessments.length === 0) return { size: 0, map: new Map<number, string>() };

  const studentsByClass = new Map<number, any[]>();
  for (const cls of classes) {
    studentsByClass.set(cls.id, await storage.getStudentsByClass(cls.id));
  }

  const marks = await storage.getAssessmentMarksByAssessments(streamAssessments.map((assessment) => assessment.id));
  const totals = new Map<number, { sum: number; count: number }>();
  for (const mark of marks) {
    if (mark.percentage === null || mark.percentage === undefined) continue;
    const current = totals.get(mark.studentId) || { sum: 0, count: 0 };
    current.sum += parseFloat(mark.percentage as any);
    current.count += 1;
    totals.set(mark.studentId, current);
  }

  const items: Array<{ id: number; value: number | null }> = [];
  for (const students of studentsByClass.values()) {
    for (const student of students) {
      const entry = totals.get(student.id);
      items.push({ id: student.id, value: entry && entry.count > 0 ? entry.sum / entry.count : null });
    }
  }
  return calculatePositionMap(items);
}

async function validateSubjectPayloadForSchool(schoolId: number, payload: any, res: Response, existingSubject?: any) {
  const school = await storage.getSchool(schoolId);
  if (!school) {
    res.status(404).json({ message: "School not found" });
    return null;
  }

  const schoolType = normalizeSchoolType(school.schoolType);
  const board = normalizeExamBoard(school.examinationBoard);
  const nextSubjectType = payload.subjectType !== undefined ? payload.subjectType : existingSubject?.subjectType;
  const nextStreamIds = Array.isArray(payload.streamIds)
    ? payload.streamIds
    : payload.streamId !== undefined && payload.streamId !== null
      ? [payload.streamId]
      : Array.isArray(existingSubject?.streamIds) && existingSubject.streamIds.length > 0
        ? existingSubject.streamIds
        : existingSubject?.streamId
          ? [existingSubject.streamId]
          : [];

  if (schoolType === "secondary") {
    if (!nextSubjectType) {
      res.status(400).json({ message: "Subject Type is required for secondary school subjects" });
      return null;
    }
    const allowedTypes = board === "Cambridge"
      ? ["Cambridge Advanced Level", "Cambridge Ordinary Level", "Cambridge IGCSE", "DELF", "HEXCO", "HSK"]
      : ["ZIMSEC Advanced Level", "ZIMSEC Ordinary Level", "DELF", "HEXCO", "HSK"];
    if (!allowedTypes.includes(nextSubjectType)) {
      res.status(400).json({ message: `Invalid subject type for ${board} secondary school` });
      return null;
    }
  }

  if (schoolType === "primary" && nextSubjectType) {
    const allowedTypes = getSubjectTypeOptionsForSchool(schoolType, board);
    if (!allowedTypes.includes(nextSubjectType)) {
      res.status(400).json({ message: `Invalid subject type for ${board} primary school` });
      return null;
    }
  }

  if (nextStreamIds.length > 0) {
    const streamRecords = await Promise.all(nextStreamIds.map((id: number) => storage.getStream(Number(id))));
    const validStreams = streamRecords.filter(Boolean);
    if (validStreams.length !== nextStreamIds.length) {
      res.status(400).json({ message: "One or more selected streams do not exist" });
      return null;
    }
    if (validStreams.some((stream) => normalizeSchoolType(stream!.schoolType) !== schoolType)) {
      res.status(400).json({ message: "Subject streams must belong to the same school type" });
      return null;
    }
    if (schoolType === "secondary") {
      const levelGroups = new Set(validStreams.map((stream) => resolveSecondaryGroupingFromStream(stream!.name)).filter(Boolean));
      if (levelGroups.size > 1) {
        res.status(400).json({ message: "Secondary subjects cannot span both lower and advanced level streams" });
        return null;
      }
      const levelGroup = Array.from(levelGroups)[0];
      const expectedGroup = nextSubjectType === "Cambridge Advanced Level" || nextSubjectType === "ZIMSEC Advanced Level" ? "ADVANCED" : "LOWER";
      if (levelGroup && levelGroup !== expectedGroup) {
        res.status(400).json({ message: "Selected streams do not match the chosen subject type level" });
        return null;
      }
    }
  }

  return { schoolType, board, subjectType: nextSubjectType, streamIds: nextStreamIds };
}

const ECD_ITEM_TEXT_ALIASES: Record<string, string[]> = {
  "Can share with others": ["Can share"],
};

async function ensureEcdSeedData() {
  const { ecdAssessmentDomains, ecdAssessmentItems } = await import("@shared/schema");
  const existingDomains = await db.select().from(ecdAssessmentDomains);
  const existingItems = await db.select().from(ecdAssessmentItems);
  const domainByCode = new Map(existingDomains.map((domain) => [domain.code, domain]));
  const matchedDomainIds = new Set<number>();
  const matchedItemIds = new Set<number>();

  for (const domainSeed of ECD_DOMAIN_SEEDS) {
    let domain = domainByCode.get(domainSeed.code);
    if (domain) {
      matchedDomainIds.add(domain.id);
      if (domain.name !== domainSeed.name || domain.sortOrder !== domainSeed.sortOrder || domain.isActive !== true) {
        const [updatedDomain] = await db
          .update(ecdAssessmentDomains)
          .set({
            name: domainSeed.name,
            sortOrder: domainSeed.sortOrder,
            isActive: true,
          })
          .where(eq(ecdAssessmentDomains.id, domain.id))
          .returning();
        domain = updatedDomain;
        domainByCode.set(domain.code, domain);
      }
    } else {
      const [createdDomain] = await db
        .insert(ecdAssessmentDomains)
        .values({
          code: domainSeed.code,
          name: domainSeed.name,
          sortOrder: domainSeed.sortOrder,
          isActive: true,
        })
        .returning();
      domain = createdDomain;
      domainByCode.set(domain.code, domain);
      matchedDomainIds.add(domain.id);
    }

    for (let index = 0; index < domainSeed.items.length; index += 1) {
      const itemText = domainSeed.items[index];
      const candidateTexts = [itemText, ...(ECD_ITEM_TEXT_ALIASES[itemText] || [])];
      const existingItem =
        existingItems.find(
          (item) => !matchedItemIds.has(item.id) && item.domainId === domain.id && candidateTexts.includes(item.itemText),
        ) ||
        existingItems.find((item) => !matchedItemIds.has(item.id) && candidateTexts.includes(item.itemText));

      if (existingItem) {
        matchedItemIds.add(existingItem.id);
        if (
          existingItem.domainId !== domain.id ||
          existingItem.itemText !== itemText ||
          existingItem.sortOrder !== index + 1 ||
          existingItem.isActive !== true
        ) {
          await db
            .update(ecdAssessmentItems)
            .set({
              domainId: domain.id,
              itemText,
              sortOrder: index + 1,
              isActive: true,
            })
            .where(eq(ecdAssessmentItems.id, existingItem.id));
        }
      } else {
        await db.insert(ecdAssessmentItems).values({
          domainId: domain.id,
          itemText,
          sortOrder: index + 1,
          isActive: true,
        });
      }
    }
  }

  for (const domain of existingDomains) {
    if (!matchedDomainIds.has(domain.id) && domain.isActive !== false) {
      await db.update(ecdAssessmentDomains).set({ isActive: false }).where(eq(ecdAssessmentDomains.id, domain.id));
    }
  }

  for (const item of existingItems) {
    if (!matchedItemIds.has(item.id) && item.isActive !== false) {
      await db.update(ecdAssessmentItems).set({ isActive: false }).where(eq(ecdAssessmentItems.id, item.id));
    }
  }
}

async function loadEcdSectionsForStudentExam(studentId: number, examId: number, streamNames?: Array<string | null | undefined>) {
  const exam = await storage.getExam(examId);
  const assessmentType = exam?.assessmentTypeId ? await storage.getAssessmentType(exam.assessmentTypeId) : null;
  if (!assessmentType || assessmentType.name !== "End-of-Term Exam") return [];

  const record = await storage.getEcdAssessmentRecord(studentId, examId);
  const streamCandidates = Array.isArray(streamNames) ? streamNames : [];
  const hasEcdStream = streamCandidates.some((name) => isEcdStream(name));
  if (!record && !hasEcdStream) return [];

  const responses = record ? await storage.getEcdAssessmentResponses(record.id) : [];
  const responseMap = new Map(responses.map((row) => [row.itemId, row.rating]));
  const domains = await storage.getEcdAssessmentDomains();
  const items = await storage.getEcdAssessmentItems();

  return domains.map((domain) => ({
    code: domain.code,
    name: domain.name,
    items: items
      .filter((item) => item.domainId === domain.id)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((item) => ({
        itemText: item.itemText,
        rating: responseMap.get(item.id) || null,
      })),
  }));
}

function validatePassword(password: string): { valid: boolean; message?: string } {
  if (password.length < PASSWORD_RULES.minLength) return { valid: false, message: "Password must be at least 8 characters" };
  if (!/[a-z]/.test(password)) return { valid: false, message: "Password must contain a lowercase letter" };
  if (!/[A-Z]/.test(password)) return { valid: false, message: "Password must contain an uppercase letter" };
  if (!/[^a-zA-Z0-9]/.test(password)) return { valid: false, message: "Password must contain a special character" };
  return { valid: true };
}

function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}


const USER_ROLE_VALUES: User["role"][] = [
  "org_admin",
  "school_admin",
  "teacher",
  "quality_control_officer",
  "assistant_teacher",
  "librarian",
  "student",
  "parent",
];

const STAFF_ACCOUNT_ROLE_VALUES = USER_ROLE_VALUES.filter(
  (role) => !["org_admin", "student", "parent"].includes(role)
);

function normalizeAccessLookupKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalized || null;
}

function findMatchingStaffAccountRole(candidates: Array<string | null | undefined>): User["role"] | undefined {
  const candidateKeys = new Set(
    candidates
      .map((candidate) => normalizeAccessLookupKey(candidate))
      .filter((candidate): candidate is string => Boolean(candidate))
  );
  if (candidateKeys.size === 0) return undefined;

  return STAFF_ACCOUNT_ROLE_VALUES.find((role) => {
    const roleKey = normalizeAccessLookupKey(role);
    return roleKey ? candidateKeys.has(roleKey) : false;
  });
}

async function resolveAccessGroupForStaffRecord(staffMember: Pick<Staff, "role" | "accessGroupId">): Promise<AccessGroup | undefined> {
  if (staffMember.accessGroupId) {
    const group = await storage.getAccessGroup(staffMember.accessGroupId);
    if (group) return group;
  }

  const [configuredRole] = staffMember.role
    ? await db.select().from(staffRoles).where(eq(staffRoles.name, staffMember.role))
    : [];

  const candidateKeys = new Set(
    [staffMember.role, configuredRole?.name, configuredRole?.label]
      .map((candidate) => normalizeAccessLookupKey(candidate))
      .filter((candidate): candidate is string => Boolean(candidate))
  );
  if (candidateKeys.size === 0) return undefined;

  const allGroups = await storage.getAllAccessGroups();
  return allGroups.find((group) => {
    const groupKey = normalizeAccessLookupKey(group.name);
    return groupKey ? candidateKeys.has(groupKey) : false;
  });
}

function resolveUserRoleForStaffRecord(staffMember: Pick<Staff, "role">, accessGroup?: AccessGroup): User["role"] {
  return findMatchingStaffAccountRole([accessGroup?.name, staffMember.role]) || "teacher";
}

async function replaceUserAccessGroupsWithPrimary(userId: number, primaryAccessGroupId: number): Promise<void> {
  const currentGroups = await storage.getUserAccessGroups(userId);
  for (const group of currentGroups) {
    if (group.id !== primaryAccessGroupId) {
      await storage.removeUserFromAccessGroup(userId, group.id);
    }
  }
  await storage.addUserToAccessGroup({ userId, accessGroupId: primaryAccessGroupId });
}

async function syncLinkedUserFromStaffRecord(staffMember: Staff): Promise<void> {
  if (!staffMember.userId) return;

  const accessGroup = await resolveAccessGroupForStaffRecord(staffMember);
  const userRole = resolveUserRoleForStaffRecord(staffMember, accessGroup);

  await storage.updateUser(staffMember.userId, {
    firstName: staffMember.firstName,
    lastName: staffMember.lastName,
    email: staffMember.email || null,
    phone: staffMember.phone || null,
    schoolId: staffMember.schoolId || null,
    role: userRole,
    isActive: staffMember.status !== "inactive",
  });

  if (accessGroup) {
    await replaceUserAccessGroupsWithPrimary(staffMember.userId, accessGroup.id);
  } else {
    await storage.normalizeUserBaselineAccess(staffMember.userId);
  }
}

async function validateUserUniqueness(username: string, email?: string | null, phone?: string | null, excludeUserId?: number): Promise<string | null> {
  const existingByUsername = await storage.getUserByUsername(username);
  if (existingByUsername && existingByUsername.id !== excludeUserId) return "Username already exists";
  if (email) {
    const existingByEmail = await storage.getUserByEmail(email);
    if (existingByEmail && existingByEmail.id !== excludeUserId) return "Email already in use by another user";
  }
  if (phone) {
    const existingByPhone = await storage.getUserByPhone(phone);
    if (existingByPhone && existingByPhone.id !== excludeUserId) return "Phone number already in use by another user";
  }
  return null;
}

function logActivity(req: Request, data: Omit<InsertActivityLog, "userId" | "userName" | "userRole" | "organizationId" | "ipAddress"> & { schoolId?: number | null }) {
  const user = req.user as User | undefined;
  if (!user) return;
  storage.createActivityLog({
    ...data,
    schoolId: data.schoolId ?? getSchoolContext(req),
    organizationId: user.organizationId,
    userId: user.id,
    userName: user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user.username,
    userRole: user.role,
    ipAddress: req.ip || req.socket.remoteAddress || null,
  }).catch(() => {});
}

function clampPercentage(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampPercentageNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

type BackgroundJobResult = {
  processedCount?: number;
  successCount?: number;
  failedCount?: number;
  skippedCount?: number;
  errorSummary?: string | null;
  metadata?: Record<string, any>;
};

async function queueCommunicationBackgroundJob(input: {
  schoolId?: number | null;
  requestedBy?: number | null;
  jobType: string;
  title: string;
  totalCount?: number;
  metadata?: Record<string, any> | null;
}, runner: (jobId: number) => Promise<BackgroundJobResult>) {
  const [job] = await db.insert(communicationJobs).values({
    schoolId: input.schoolId ?? null,
    requestedBy: input.requestedBy ?? null,
    jobType: input.jobType,
    title: input.title,
    status: "queued",
    totalCount: input.totalCount ?? 0,
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    metadata: input.metadata ?? null,
  }).returning();

  setImmediate(async () => {
    try {
      await db.update(communicationJobs)
        .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(communicationJobs.id, job.id));

      const result = await runner(job.id);
      await db.update(communicationJobs)
        .set({
          status: "completed",
          processedCount: result.processedCount ?? input.totalCount ?? 0,
          successCount: result.successCount ?? 0,
          failedCount: result.failedCount ?? 0,
          skippedCount: result.skippedCount ?? 0,
          errorSummary: result.errorSummary ?? null,
          metadata: result.metadata ? { ...(input.metadata || {}), ...result.metadata } : input.metadata ?? null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(communicationJobs.id, job.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[COMMUNICATION_JOB_${job.id}_FAILED]`, error);
      await db.update(communicationJobs)
        .set({
          status: "failed",
          errorSummary: message,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(communicationJobs.id, job.id));
    }
  });

  return job;
}

async function updateCommunicationJobProgress(jobId: number, patch: Partial<BackgroundJobResult>) {
  await db.update(communicationJobs)
    .set({ ...patch, updatedAt: new Date() } as any)
    .where(eq(communicationJobs.id, jobId));
}


type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function shouldUsePagination(req: Request) {
  return req.query.paginated === "true" || req.query.page !== undefined || req.query.pageSize !== undefined;
}

function parsePagination(req: Request) {
  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const requestedPageSize = Number.parseInt(String(req.query.pageSize || req.query.limit || "25"), 10) || 25;
  const pageSize = Math.min(100000, Math.max(1, requestedPageSize));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

function normalizeSearch(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function toPaginatedResult<T>(items: T[], total: number, page: number, pageSize: number): PaginatedResult<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function getBodyCount(body: any): number | undefined {
  if (!body || typeof body !== "object") return undefined;
  for (const key of ["students", "parents", "staff", "records", "books", "items", "rows"]) {
    if (Array.isArray(body[key])) return body[key].length;
  }
  return undefined;
}

function auditCategoryForPath(pathname: string) {
  const clean = pathname.replace(/^\/api\//, "");
  const first = clean.split("/")[0] || "system";
  const map: Record<string, string> = {
    students: "students",
    parents: "parents",
    staff: "staff",
    clinic: "clinic",
    fees: "finance",
    library: "library",
    classes: "classes",
    subjects: "subjects",
    assessments: "assessments",
    attendance: "attendance",
    applications: "applications",
    schools: "settings",
    users: "users",
    permissions: "access_control",
    "access-groups": "access_control",
    notifications: "communication",
    newsletters: "communication",
    communication: "communication",
  };
  return map[first] || first;
}

function auditActionForRequest(req: Request) {
  const pathname = req.path || req.originalUrl || "";
  if (/\/import/.test(pathname)) return "import";
  if (/\/upload|\/photo|\/cover/.test(pathname)) return "upload";
  if (req.method === "POST") return "create";
  if (req.method === "PUT" || req.method === "PATCH") return "update";
  if (req.method === "DELETE") return "delete";
  return req.method.toLowerCase();
}

function buildAuditDescription(req: Request, action: string, category: string) {
  const user = req.user as User | undefined;
  const userName = user?.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user?.username || "System";
  const target = (req.path || req.originalUrl || "").replace(/^\/api\//, "");
  return `${userName} completed ${action} on ${category} (${target})`;
}

function installActivityAudit(app: Express) {
  app.use("/api", (req, res, next) => {
    if (!req.isAuthenticated?.() || !req.user) return next();
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if ((req.path || "").startsWith("/activity-logs")) return next();

    res.on("finish", () => {
      if (!req.user || res.statusCode < 200 || res.statusCode >= 400) return;
      const action = auditActionForRequest(req);
      const category = auditCategoryForPath(req.path || req.originalUrl || "");
      const file = (req as any).file;
      const files = (req as any).files;
      const uploadedFileNames = Array.isArray(files)
        ? files.map((f: any) => f?.originalname).filter(Boolean)
        : file?.originalname
          ? [file.originalname]
          : undefined;

      logActivity(req, {
        schoolId: getSchoolContext(req),
        action,
        category,
        description: buildAuditDescription(req, action, category),
        targetType: category,
        targetId: req.params?.id ? Number.parseInt(String(req.params.id), 10) || null : null,
        targetName: req.body?.name || req.body?.title || req.body?.fileName || uploadedFileNames?.[0] || null,
        metadata: {
          method: req.method,
          path: req.path || req.originalUrl,
          statusCode: res.statusCode,
          rowCount: getBodyCount(req.body),
          fileName: req.body?.fileName || uploadedFileNames?.[0],
          fileNames: uploadedFileNames,
        },
      });
    });

    next();
  });
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function getTermDateRanges(entity: { term1StartDate?: string | null; term1EndDate?: string | null; vac1StartDate?: string | null; vac1EndDate?: string | null; term2StartDate?: string | null; term2EndDate?: string | null; vac2StartDate?: string | null; vac2EndDate?: string | null; term3StartDate?: string | null; term3EndDate?: string | null }): Record<string, { start: string; end: string }> {
  const ranges: Record<string, { start: string; end: string }> = {};

  if (entity.term1StartDate && entity.term1EndDate) {
    ranges.term1 = { start: entity.term1StartDate, end: entity.term1EndDate };
  }
  if (entity.term2StartDate && entity.term2EndDate) {
    ranges.term2 = { start: entity.term2StartDate, end: entity.term2EndDate };
  }
  if (entity.term3StartDate && entity.term3EndDate) {
    ranges.term3 = { start: entity.term3StartDate, end: entity.term3EndDate };
  }

  if (entity.vac1StartDate && entity.vac1EndDate) {
    ranges.vac1 = { start: entity.vac1StartDate, end: entity.vac1EndDate };
  } else if (entity.term1EndDate && entity.term2StartDate) {
    ranges.vac1 = { start: addDays(entity.term1EndDate, 3), end: addDays(entity.term2StartDate, -3) };
  }

  if (entity.vac2StartDate && entity.vac2EndDate) {
    ranges.vac2 = { start: entity.vac2StartDate, end: entity.vac2EndDate };
  } else if (entity.term2EndDate && entity.term3StartDate) {
    ranges.vac2 = { start: addDays(entity.term2EndDate, 3), end: addDays(entity.term3StartDate, -3) };
  }

  return ranges;
}

function parseTermNumber(termStr: string | number | null | undefined): number {
  if (!termStr) return 1;
  if (typeof termStr === "number") return termStr;
  const match = termStr.match(/term(\d+)/);
  return match ? parseInt(match[1]) : 1;
}

function normalizeQcTermValue(termStr: string | number | null | undefined): "term1" | "term2" | "term3" {
  if (typeof termStr === "number") {
    return termStr === 2 ? "term2" : termStr === 3 ? "term3" : "term1";
  }

  const normalized = String(termStr ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  if (["2", "term2", "t2"].includes(normalized)) return "term2";
  if (["3", "term3", "t3"].includes(normalized)) return "term3";
  return "term1";
}

function termLabel(termStr: string): string {
  const labels: Record<string, string> = { term1: "Term 1", term2: "Term 2", term3: "Term 3", vac1: "Vacation 1", vac2: "Vacation 2" };
  return labels[termStr] || termStr;
}

function rebaseDateToAcademicYear(dateStr: string, academicYear: number): string {
  if (!dateStr) return dateStr;
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${academicYear}-${parts[1]}-${parts[2]}`;
}

function getAcademicTermDateRanges(entity: { term1StartDate?: string | null; term1EndDate?: string | null; vac1StartDate?: string | null; vac1EndDate?: string | null; term2StartDate?: string | null; term2EndDate?: string | null; vac2StartDate?: string | null; vac2EndDate?: string | null; term3StartDate?: string | null; term3EndDate?: string | null }, academicYear: number | null | undefined): Record<string, { start: string; end: string }> {
  const ranges = getTermDateRanges(entity);
  if (!academicYear) return ranges;
  return Object.fromEntries(
    Object.entries(ranges).map(([key, value]) => [
      key,
      {
        start: rebaseDateToAcademicYear(value.start, academicYear),
        end: rebaseDateToAcademicYear(value.end, academicYear),
      },
    ])
  );
}

function mergeAcademicCalendarSources(
  primary?: { term1StartDate?: string | null; term1EndDate?: string | null; vac1StartDate?: string | null; vac1EndDate?: string | null; term2StartDate?: string | null; term2EndDate?: string | null; vac2StartDate?: string | null; vac2EndDate?: string | null; term3StartDate?: string | null; term3EndDate?: string | null } | null,
  secondary?: { term1StartDate?: string | null; term1EndDate?: string | null; vac1StartDate?: string | null; vac1EndDate?: string | null; term2StartDate?: string | null; term2EndDate?: string | null; vac2StartDate?: string | null; vac2EndDate?: string | null; term3StartDate?: string | null; term3EndDate?: string | null } | null,
) {
  return {
    term1StartDate: primary?.term1StartDate ?? secondary?.term1StartDate ?? null,
    term1EndDate: primary?.term1EndDate ?? secondary?.term1EndDate ?? null,
    vac1StartDate: primary?.vac1StartDate ?? secondary?.vac1StartDate ?? null,
    vac1EndDate: primary?.vac1EndDate ?? secondary?.vac1EndDate ?? null,
    term2StartDate: primary?.term2StartDate ?? secondary?.term2StartDate ?? null,
    term2EndDate: primary?.term2EndDate ?? secondary?.term2EndDate ?? null,
    vac2StartDate: primary?.vac2StartDate ?? secondary?.vac2StartDate ?? null,
    vac2EndDate: primary?.vac2EndDate ?? secondary?.vac2EndDate ?? null,
    term3StartDate: primary?.term3StartDate ?? secondary?.term3StartDate ?? null,
    term3EndDate: primary?.term3EndDate ?? secondary?.term3EndDate ?? null,
  };
}

function assessmentMatchesAcademicYear(assessment: { year?: number | null; assessmentDate?: string | null }, academicYear: number): boolean {
  if (assessment.year) return assessment.year === academicYear;
  if (assessment.assessmentDate) return assessment.assessmentDate.startsWith(`${academicYear}-`);
  return true;
}

function applyAssessmentFilters<T extends { schoolId?: number | null; classId?: number | null; subjectId?: number | null; year?: number | null; assessmentDate?: string | null }>(
  assessments: T[],
  {
    schoolId,
    classId,
    subjectId,
    academicYear,
    dateFrom,
    dateTo,
    termFilter,
    calendarConfig,
  }: {
    schoolId?: number | null;
    classId?: number;
    subjectId?: number;
    academicYear?: number | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    termFilter?: string | null;
    calendarConfig?: any;
  }
): T[] {
  let filtered = [...assessments];

  if (schoolId) filtered = filtered.filter((a) => a.schoolId === schoolId);
  if (classId) filtered = filtered.filter((a) => a.classId === classId);
  if (subjectId) filtered = filtered.filter((a) => a.subjectId === subjectId);
  if (academicYear) filtered = filtered.filter((a) => assessmentMatchesAcademicYear(a, academicYear));

  if (termFilter && termFilter !== "none") {
    if (!calendarConfig) return [];
    const termDateRanges = getAcademicTermDateRanges(calendarConfig, academicYear);
    const range = termDateRanges[termFilter];
    if (!range?.start || !range?.end) return [];
    filtered = filtered.filter((a) => !!a.assessmentDate && a.assessmentDate >= range.start && a.assessmentDate <= range.end);
  }

  if (dateFrom) filtered = filtered.filter((a) => !!a.assessmentDate && a.assessmentDate >= dateFrom);
  if (dateTo) filtered = filtered.filter((a) => !!a.assessmentDate && a.assessmentDate <= dateTo);

  return filtered;
}

function isOperationalActiveStudent(student: any): boolean {
  const status = String(student?.status ?? "active").trim().toLowerCase();

  return (
    !student?.archivedAt &&
    ["", "active", "approved"].includes(status)
  );
}

async function getHistoricalStudentsForAssessments(params: {
  schoolId: number;
  classId: number;
  subjectId: number;
  assessmentIds: number[];
  includeSiblingAssessmentHistory?: boolean;
  academicYear?: number | null;
}) {
  const {
    schoolId,
    classId,
    subjectId,
    assessmentIds,
    includeSiblingAssessmentHistory = false,
    academicYear = null,
  } = params;

  const currentClassStudents = (await storage.getStudentsByClass(classId))
    .filter((student: any) =>
      student.schoolId === schoolId && isOperationalActiveStudent(student)
    );

  const studentMap = new Map(currentClassStudents.map((student: any) => [student.id, student]));

  const subjectStudentIds = new Set<number>();
  for (const student of currentClassStudents) {
    const resolvedSubjects = await storage.getStudentSubjects(student.id);
    if (resolvedSubjects.some((row) => row.subjectId === subjectId)) {
      subjectStudentIds.add(student.id);
    }
  }

  let historyAssessmentIds = [...assessmentIds];
  if (includeSiblingAssessmentHistory) {
    const siblingAssessments = applyAssessmentFilters(await storage.getAssessmentsByClass(classId), {
      schoolId,
      classId,
      subjectId,
      academicYear,
    });

    historyAssessmentIds = Array.from(
      new Set([...historyAssessmentIds, ...siblingAssessments.map((assessment) => assessment.id)])
    );
  }

  const historicalStudentIds = new Set<number>();
  if (historyAssessmentIds.length > 0) {
    const historyMarks = await storage.getAssessmentMarksByAssessments(historyAssessmentIds);

    for (const mark of historyMarks) {
      historicalStudentIds.add(mark.studentId);
    }

    if (historicalStudentIds.size > 0) {
      const historicalStudents = await db
        .select()
        .from(studentsTable)
        .where(
          and(
            eq(studentsTable.schoolId, schoolId),
            inArray(studentsTable.id, Array.from(historicalStudentIds))
          )
        );

      for (const student of historicalStudents) {
        if (isOperationalActiveStudent(student)) {
          studentMap.set(student.id, student as any);
        }
      }
    }
  }

  const currentStudentsForSubject = currentClassStudents.filter((student: any) =>
    subjectStudentIds.has(student.id)
  );

  const shouldFallbackToWholeActiveClass =
    currentClassStudents.length > 0 && currentStudentsForSubject.length === 0;

  const allowedCurrentStudentIds = new Set(
    (shouldFallbackToWholeActiveClass ? currentClassStudents : currentStudentsForSubject)
      .map((student: any) => student.id)
  );

  const students = Array.from(studentMap.values())
    .filter((student: any) =>
      isOperationalActiveStudent(student) &&
      (
        allowedCurrentStudentIds.has(student.id) ||
        historicalStudentIds.has(student.id)
      )
    );

  return sortStudentsByFirstName(students);
}

function subjectMatchesHierarchyStream(subject: any, streamId: number | null | undefined): boolean {
  if (streamId == null) {
    return false;
  }

  const scopedStreamIds = Array.isArray(subject?.streamIds) ? subject.streamIds : [];

  if (subject?.streamId != null) {
    return subject.streamId === streamId;
  }

  if (scopedStreamIds.length > 0) {
    return scopedStreamIds.includes(streamId);
  }

  return false;
}

async function getSchoolScopedSubjects(schoolId: number | null | undefined) {
  const allSubjects = await storage.getAllSubjects();
  if (schoolId == null) {
    return allSubjects;
  }
  return allSubjects.filter((subject) => subject.schoolId === schoolId);
}

async function getInheritedClassSubjectIds(classData: any): Promise<number[]> {
  const schoolSubjects = await getSchoolScopedSubjects(classData?.schoolId ?? null);
  return schoolSubjects
    .filter((subject) => subjectMatchesHierarchyStream(subject, classData?.streamId))
    .map((subject) => subject.id);
}

async function buildClassSubjectManagementPayload(classId: number) {
  const classData = await storage.getClass(classId);
  if (!classData) {
    return null;
  }

  const allSubjects = await getSchoolScopedSubjects(classData.schoolId);
  const overrideRows = await db.select().from(classSubjectsSchema).where(eq(classSubjectsSchema.classId, classId));
  const selectedRows = await storage.getClassSubjects(classId);
  const inheritedSelected = await getInheritedClassSubjectIds(classData);

  return {
    all: allSubjects,
    selected: selectedRows.map((row) => row.subjectId.toString()),
    directSelected: overrideRows.filter((row) => row.assignmentMode === "add").map((row) => row.subjectId.toString()),
    removed: overrideRows.filter((row) => row.assignmentMode === "remove").map((row) => row.subjectId.toString()),
    inheritedSelected: inheritedSelected.map((id) => id.toString()),
  };
}

async function buildStudentSubjectManagementPayload(studentId: number) {
  const student = await storage.getStudent(studentId);
  if (!student) {
    return null;
  }

  const allSubjects = await getSchoolScopedSubjects(student.schoolId);
  const overrideRows = await db.select().from(studentSubjectsSchema).where(eq(studentSubjectsSchema.studentId, studentId));
  const selectedRows = await storage.getStudentSubjects(studentId);
  const inheritedSelected = student.classId ? (await storage.getClassSubjects(student.classId)).map((row) => row.subjectId) : [];

  return {
    all: allSubjects,
    selected: selectedRows.map((row) => row.subjectId.toString()),
    directSelected: overrideRows.filter((row) => row.assignmentMode === "add").map((row) => row.subjectId.toString()),
    removed: overrideRows.filter((row) => row.assignmentMode === "remove").map((row) => row.subjectId.toString()),
    inheritedSelected: inheritedSelected.map((id) => id.toString()),
  };
}

// Helper to get school context from request
// For org_admin, uses X-School-Id header when in school context
// For school-level users, uses their assigned schoolId
async function getSystemUrl(schoolId?: number | null): Promise<string> {
  try {
    if (schoolId) {
      const school = await storage.getSchool(schoolId);
      if (school?.organizationId) {
        const org = await storage.getOrganization(school.organizationId);
        if (org?.systemUrl) return org.systemUrl;
      }
    }
    const orgs = await db.select().from(organizations).limit(1);
    if (orgs[0]?.systemUrl) return orgs[0].systemUrl;
  } catch {}
  return "";
}

function normalizePortalBaseUrl(value?: string | null): string {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

function getRequestBaseUrl(req: Request): string {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || req.protocol || "https";
  return forwardedHost ? normalizePortalBaseUrl(`${protocol}://${forwardedHost}`) : "";
}

async function findUserForPasswordReset(identifier: string): Promise<User | undefined> {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return undefined;

  const [directUser] = await db
    .select()
    .from(users)
    .where(
      or(
        sql`lower(${users.username}) = ${normalized}`,
        sql`lower(coalesce(${users.email}, '')) = ${normalized}`,
      ),
    )
    .limit(1);

  if (directUser) return directUser;
  if (!normalized.includes("@")) return undefined;

  const linkedUserIds: number[] = [];
  const [staffMatch] = await db
    .select({ userId: staffTable.userId })
    .from(staffTable)
    .where(sql`lower(coalesce(${staffTable.email}, '')) = ${normalized}`)
    .limit(1);
  const [parentMatch] = await db
    .select({ userId: parentsTable.userId })
    .from(parentsTable)
    .where(sql`lower(coalesce(${parentsTable.email}, '')) = ${normalized}`)
    .limit(1);
  const [studentMatch] = await db
    .select({ userId: studentsTable.userId })
    .from(studentsTable)
    .where(sql`lower(coalesce(${studentsTable.email}, '')) = ${normalized}`)
    .limit(1);

  for (const match of [staffMatch, parentMatch, studentMatch]) {
    if (match?.userId && !linkedUserIds.includes(match.userId)) linkedUserIds.push(match.userId);
  }

  if (linkedUserIds.length === 0) return undefined;
  return storage.getUser(linkedUserIds[0]);
}


function buildSchoolSequenceCode(schoolId?: number | null): string {
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

function buildFormattedPersonNumber(prefix: "S" | "E", schoolId?: number | null, referenceDate?: string | Date | null, sequence: number = 1) {
  const date = referenceDate ? new Date(referenceDate) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const yearPart = String(safeDate.getFullYear()).slice(-2);
  return `FCGS${yearPart}${prefix}${String(sequence).padStart(4, "0")}${buildSchoolSequenceCode(schoolId)}`.toUpperCase();
}

type ExternalChannel = { type: "email" | "sms"; value: string };

function dedupeExternalChannels(channels: ExternalChannel[]) {
  const seen = new Set<string>();
  return channels.filter((channel) => {
    const key = `${channel.type}:${channel.value.trim().toLowerCase()}`;
    if (!channel.value?.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getUserExternalChannels(user: User): Promise<ExternalChannel[]> {
  const channels: ExternalChannel[] = [];
  const pushIfPresent = (type: "email" | "sms", value?: string | null) => {
    if (value && value.trim()) channels.push({ type, value: value.trim() });
  };

  pushIfPresent("email", user.email);
  pushIfPresent("sms", user.phone);

  const [linkedStaff] = await db.select({
    email: staff.email,
    phone: staff.phone,
  }).from(staff).where(eq(staff.userId, user.id)).limit(1);

  if (linkedStaff) {
    pushIfPresent("email", linkedStaff.email);
    pushIfPresent("sms", linkedStaff.phone);
  }

  const [linkedParent] = await db.select({
    email: parentsTable.email,
    phone: parentsTable.phone,
  }).from(parentsTable).where(eq(parentsTable.userId, user.id)).limit(1);

  if (linkedParent) {
    pushIfPresent("email", linkedParent.email);
    pushIfPresent("sms", linkedParent.phone);
  }

  const [linkedStudent] = await db.select({
    email: studentsTable.email,
    phone: studentsTable.phone,
    parentId: studentsTable.parentId,
  }).from(studentsTable).where(eq(studentsTable.userId, user.id)).limit(1);

  if (linkedStudent) {
    pushIfPresent("email", linkedStudent.email);
    pushIfPresent("sms", linkedStudent.phone);

    if (linkedStudent.parentId) {
      const [studentParent] = await db.select({
        email: parentsTable.email,
        phone: parentsTable.phone,
      }).from(parentsTable).where(eq(parentsTable.id, linkedStudent.parentId)).limit(1);

      if (studentParent) {
        pushIfPresent("email", studentParent.email);
        pushIfPresent("sms", studentParent.phone);
      }
    }
  }

  return dedupeExternalChannels(channels);
}

async function issuePasswordSetupLink(user: User, options?: {
  schoolId?: number | null;
  recipientType?: string;
  recipientId?: number | null;
  recipientName?: string;
  sentBy?: number;
  usernameOverride?: string;
  subjectPrefix?: string;
  requestBaseUrl?: string;
}) {
  const resetToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await storage.updateUser(user.id, {
    passwordResetToken: resetToken,
    passwordResetTokenExpiry: expiresAt,
    mustResetPassword: true,
  });

  const systemUrl = await getSystemUrl(options?.schoolId);
  const baseUrl =
    normalizePortalBaseUrl(options?.requestBaseUrl) ||
    normalizePortalBaseUrl(systemUrl) ||
    normalizePortalBaseUrl(process.env.APP_BASE_URL);
  const resetPath = `/reset-password?token=${encodeURIComponent(resetToken)}`;
  const resetLink = baseUrl ? `${baseUrl}${resetPath}` : resetPath;

  const displayName = options?.recipientName || [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username;
  const username = options?.usernameOverride || user.username;
  const isPasswordReset = options?.subjectPrefix === "Password Reset";
  const introduction = isPasswordReset
    ? "A password reset was requested for your account."
    : "Your account is ready.";
  const messageText = `Dear ${displayName},\n${introduction}\nUsername: ${username}\nUse this one-time link to set or reset your password (valid for 1 hour):\n${resetLink}\n\nIf you did not request this change, you can ignore this message.\n\nHardwork - Discipline - Changing Lives`;
  const messageHtml = messageText.replace(/\n/g, "<br>");
  const subject = `${options?.subjectPrefix || "Password Setup"} Link`;

  const channels = await getUserExternalChannels(user);
  const deliveries = await Promise.all(channels.map(async (channel) => {
    const result = channel.type === "email"
      ? await communicationService.sendEmail({
          to: channel.value,
          subject,
          text: messageText,
          html: messageHtml,
          schoolId: options?.schoolId || undefined,
          recipientType: options?.recipientType,
          recipientId: options?.recipientId || undefined,
          recipientName: displayName,
          category: "account",
          sentBy: options?.sentBy,
        })
      : await communicationService.sendSms({
          to: channel.value,
          message: messageText,
          schoolId: options?.schoolId || undefined,
          recipientType: options?.recipientType,
          recipientId: options?.recipientId || undefined,
          recipientName: displayName,
          category: "account",
          sentBy: options?.sentBy,
        });
    return { channel, result };
  }));

  return {
    resetToken,
    resetLink,
    channels,
    results: deliveries.map((delivery) => delivery.result),
    deliveries,
  };
}

async function findReusableParentForApplication(options: {
  schoolId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  const schoolId = options.schoolId || undefined;
  const normalize = (value?: string | null) => (value || "").trim().toLowerCase();
  const email = normalize(options.email);
  const phoneDigits = (options.phone || "").replace(/\D+/g, "");
  const firstName = normalize(options.firstName);
  const lastName = normalize(options.lastName);

  const pool = schoolId ? await storage.getParentsBySchool(schoolId) : await storage.getAllParents();

  return pool.find((parent) => {
    const parentEmail = normalize(parent.email);
    const parentPhone = (parent.phone || "").replace(/\D+/g, "");
    const namesMatch = normalize(parent.firstName) === firstName && normalize(parent.lastName) === lastName;
    return (!!email && parentEmail === email) || (!!phoneDigits && parentPhone === phoneDigits) || (namesMatch && !!phoneDigits && parentPhone === phoneDigits);
  });
}

function getSchoolContext(req: Request): number | null {
  const currentUser = req.user as User;

  if (currentUser.role === "org_admin") {
    // Org admin can switch between schools using header
    const headerSchoolId = req.headers["x-school-id"] as string;
    return headerSchoolId ? parseInt(headerSchoolId, 10) : null;
  }

  // School-level users always use their assigned school
  return currentUser.schoolId;
}

async function requireSchoolScope(req: Request, res: Response): Promise<number | null> {
  const schoolId = getSchoolContext(req);
  if (!schoolId || Number.isNaN(schoolId)) {
    res.status(400).json({ message: "No school context" });
    return null;
  }
  return schoolId;
}

async function ensureClassInSchool(classId: number, schoolId: number, res: Response) {
  const classInfo = await storage.getClass(classId);
  if (!classInfo || classInfo.schoolId !== schoolId) {
    res.status(403).json({ message: "Class not in school context" });
    return null;
  }
  return classInfo;
}

async function ensureSubjectInSchool(subjectId: number, schoolId: number, res: Response) {
  const subjectInfo = await storage.getSubject(subjectId);
  if (!subjectInfo || subjectInfo.schoolId !== schoolId) {
    res.status(403).json({ message: "Subject not in school context" });
    return null;
  }
  return subjectInfo;
}

async function ensureGradeInSchool(gradeId: number, schoolId: number, res: Response) {
  const grade = await storage.getGrade(gradeId);
  if (!grade || grade.schoolId !== schoolId) {
    res.status(403).json({ message: "Grade not in school context" });
    return null;
  }
  return grade;
}

async function ensureStudentInSchool(studentId: number, schoolId: number, res: Response) {
  const student = await storage.getStudent(studentId);
  if (!student || student.schoolId !== schoolId) {
    res.status(403).json({ message: "Student not in school context" });
    return null;
  }
  return student;
}

async function ensureExamInSchool(examId: number, schoolId: number, res: Response) {
  const exam = await storage.getExam(examId);
  if (!exam || (exam.schoolId !== null && exam.schoolId !== schoolId)) {
    res.status(403).json({ message: "Exam not in school context" });
    return null;
  }
  return exam;
}

async function ensureAssessmentTypeInSchool(assessmentTypeId: number, schoolId: number, res: Response) {
  const assessmentType = await storage.getAssessmentType(assessmentTypeId);
  if (!assessmentType || (assessmentType.schoolId !== null && assessmentType.schoolId !== schoolId)) {
    res.status(403).json({ message: "Assessment type not in school context" });
    return null;
  }
  return assessmentType;
}

async function getScopedAssessmentOrRespond(req: Request, res: Response, assessmentId: number) {
  const schoolId = await requireSchoolScope(req, res);
  if (!schoolId) return null;

  const assessment = await storage.getAssessment(assessmentId);
  if (!assessment) {
    res.status(404).json({ message: "Assessment not found" });
    return null;
  }

  if (assessment.schoolId !== schoolId) {
    res.status(403).json({ message: "Assessment not in school context" });
    return null;
  }

  const hasTeacherAssignment = await ensureTeacherAssignmentForAssessment(
    req,
    res,
    schoolId,
    Number(assessment.classId),
    Number(assessment.subjectId),
  );
  if (!hasTeacherAssignment) return null;

  return { schoolId, assessment };
}

async function validateAssessmentPayloadForSchool(
  schoolId: number,
  assessmentData: Record<string, any>,
  res: Response,
  existingAssessment?: { classId: number | null; subjectId: number | null; examId?: number | null; assessmentTypeId?: number | null } | null,
) {
  const classId = assessmentData.classId ?? existingAssessment?.classId;
  const subjectId = assessmentData.subjectId ?? existingAssessment?.subjectId;
  const examId = assessmentData.examId !== undefined ? assessmentData.examId : existingAssessment?.examId;
  const assessmentTypeId = assessmentData.assessmentTypeId !== undefined
    ? assessmentData.assessmentTypeId
    : existingAssessment?.assessmentTypeId;

  if (!classId) {
    res.status(400).json({ message: "classId is required" });
    return null;
  }
  if (!subjectId) {
    res.status(400).json({ message: "subjectId is required" });
    return null;
  }

  const classInfo = await ensureClassInSchool(Number(classId), schoolId, res);
  if (!classInfo) return null;

  const subjectInfo = await ensureSubjectInSchool(Number(subjectId), schoolId, res);
  if (!subjectInfo) return null;

  if (examId !== null && examId !== undefined && examId !== "") {
    const exam = await ensureExamInSchool(Number(examId), schoolId, res);
    if (!exam) return null;
  }

  if (assessmentTypeId !== null && assessmentTypeId !== undefined && assessmentTypeId !== "") {
    const assessmentType = await ensureAssessmentTypeInSchool(Number(assessmentTypeId), schoolId, res);
    if (!assessmentType) return null;
  }

  if (!isSubjectAvailableForClass(subjectInfo, classInfo)) {
    res.status(400).json({ message: "Selected subject is not available for the chosen class stream" });
    return null;
  }

  const classSubjectRows = await storage.getClassSubjects(classInfo.id);
  if (classSubjectRows.length > 0 && !classSubjectRows.some((row) => row.subjectId === subjectInfo.id)) {
    res.status(400).json({ message: "Selected subject is not assigned to the chosen class" });
    return null;
  }

  return { classInfo, subjectInfo };
}

async function ensureAssessmentCommentPairAllowed(
  req: Request,
  res: Response,
  schoolId: number,
  classId: number,
  subjectId: number,
) {
  const classInfo = await ensureClassInSchool(Number(classId), schoolId, res);
  if (!classInfo) return null;

  const subjectInfo = await ensureSubjectInSchool(Number(subjectId), schoolId, res);
  if (!subjectInfo) return null;

  if (!isSubjectAvailableForClass(subjectInfo, classInfo)) {
    res.status(400).json({ message: "Selected subject is not available for the chosen class stream" });
    return null;
  }

  const classSubjectRows = await storage.getClassSubjects(classInfo.id);
  if (classSubjectRows.length > 0 && !classSubjectRows.some((row) => Number(row.subjectId) === Number(subjectInfo.id))) {
    res.status(400).json({ message: "Selected subject is not assigned to the chosen class" });
    return null;
  }

  const hasTeacherAssignment = await ensureTeacherAssignmentForAssessment(
    req,
    res,
    schoolId,
    Number(classInfo.id),
    Number(subjectInfo.id),
  );
  if (!hasTeacherAssignment) return null;

  return { classInfo, subjectInfo };
}

async function getScopedAssessmentCommentOrRespond(req: Request, res: Response, id: number) {
  const schoolId = await requireSchoolScope(req, res);
  if (!schoolId) return null;

  const comment = await storage.getAssessmentComment(id);
  if (!comment) {
    res.status(404).json({ message: "Comment not found" });
    return null;
  }

  if (comment.schoolId !== schoolId) {
    res.status(403).json({ message: "Comment not in school context" });
    return null;
  }

  const pair = await ensureAssessmentCommentPairAllowed(
    req,
    res,
    schoolId,
    Number(comment.classId),
    Number(comment.subjectId),
  );
  if (!pair) return null;

  return { schoolId, comment, ...pair };
}

async function getScopedAssessmentMarkOrRespond(req: Request, res: Response, id: number) {
  const schoolId = await requireSchoolScope(req, res);
  if (!schoolId) return null;

  const mark = await storage.getAssessmentMark(id);
  if (!mark) {
    res.status(404).json({ message: "Mark not found" });
    return null;
  }

  if (mark.schoolId !== schoolId) {
    res.status(403).json({ message: "Mark not in school context" });
    return null;
  }

  const assessment = await storage.getAssessment(mark.assessmentId);
  if (!assessment || assessment.schoolId !== schoolId) {
    res.status(404).json({ message: "Assessment not found" });
    return null;
  }

  return { schoolId, mark, assessment };
}


const ACKNOWLEDGED_NOT_WRITTEN_STATUSES = new Set(["absent", "sick", "excused"]);

function markStatusLabel(status: unknown): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "absent") return "Absent";
  if (normalized === "sick") return "Sick";
  if (normalized === "excused") return "Excused";
  return "";
}

async function getClassExamPublication(examId: number, classId: number) {
  const [row] = await db
    .select()
    .from(assessmentPublications)
    .where(and(eq(assessmentPublications.examId, examId), eq(assessmentPublications.classId, classId)))
    .limit(1);
  return row;
}

async function isClassExamPublished(examId: number | null | undefined, classId: number | null | undefined): Promise<boolean> {
  if (!examId || !classId) return false;
  const publication = await getClassExamPublication(Number(examId), Number(classId));
  return publication?.isPublished === true;
}

async function rejectIfAssessmentPublished(assessment: { examId?: number | null; classId?: number | null }, res: Response): Promise<boolean> {
  if (await isClassExamPublished(assessment.examId, assessment.classId)) {
    res.status(423).json({
      message: "This exercise/exam has been published for the class. Marks and assessment structure are read-only until it is unpublished.",
      code: "ASSESSMENT_PUBLISHED",
    });
    return true;
  }
  return false;
}

async function userHasAnyPermission(userId: number, codes: string[]): Promise<boolean> {
  for (const code of codes) {
    if (await storage.userHasPermission(userId, code)) return true;
  }
  return false;
}

async function ensurePublishedPortalAccess(args: {
  user: User;
  examId: number;
  classId: number;
  studentId?: number | null;
  res: Response;
}): Promise<boolean> {
  if (args.user.role !== "student" && args.user.role !== "parent") return true;

  if (!(await isClassExamPublished(args.examId, args.classId))) {
    args.res.status(403).json({ message: "These results have not been published" });
    return false;
  }

  if (args.user.role === "student") {
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.userId, args.user.id)).limit(1);
    if (!student || Number(student.classId) !== Number(args.classId) || (args.studentId && Number(student.id) !== Number(args.studentId))) {
      args.res.status(403).json({ message: "Access denied" });
      return false;
    }
    return true;
  }

  const [parent] = await db.select().from(parentsTable).where(eq(parentsTable.userId, args.user.id)).limit(1);
  if (!parent) {
    args.res.status(403).json({ message: "Parent profile not found" });
    return false;
  }
  const linkedChildren = await db.select().from(studentsTable).where(eq(studentsTable.parentId, parent.id));
  const allowed = linkedChildren.some((student: any) =>
    Number(student.classId) === Number(args.classId) && (!args.studentId || Number(student.id) === Number(args.studentId))
  );
  if (!allowed) {
    args.res.status(403).json({ message: "Access denied" });
    return false;
  }
  return true;
}

type ClassExamSubjectProgress = {
  subjectId: number;
  subjectName: string;
  assessmentId: number | null;
  assessmentCreated: boolean;
  totalStudents: number;
  markedCount: number;
  acknowledgedCount: number;
  partialCount: number;
  unrecordedCount: number;
  progressPct: number | null;
  withMarksPct: number;
  acknowledgedPct: number;
  unrecordedPct: number;
  avgPct: number | null;
};

type ClassExamProgress = {
  classInfo: any;
  students: any[];
  subjects: ClassExamSubjectProgress[];
  totals: {
    expectedEntries: number;
    withMarks: number;
    acknowledged: number;
    partial: number;
    unrecorded: number;
    offeredSubjects: number;
    assessmentsCreated: number;
    assessmentsMissing: number;
  };
};

type ExamProgressContext = {
  schoolId: number;
  examId: number;
  classesById: Map<number, any>;
  studentsByClass: Map<number, any[]>;
  subjectsById: Map<number, any>;
  classSubjectIdsByClass: Map<number, Set<number>>;
  studentSubjectIdsByStudent: Map<number, Set<number>>;
  assessmentByClassSubject: Map<string, any>;
  marksByAssessmentStudent: Map<number, Map<number, any>>;
  papersByAssessment: Map<number, any[]>;
  paperMarksByMark: Map<number, any[]>;
  publicationByClass: Map<number, any>;
};

function classSubjectKey(classId: number, subjectId: number): string {
  return `${classId}:${subjectId}`;
}

function subjectMatchesProgressStream(subject: any, streamId: number | null | undefined): boolean {
  if (streamId === null || streamId === undefined) return false;
  const normalizedStreamId = Number(streamId);
  if (subject?.streamId !== null && subject?.streamId !== undefined) {
    return Number(subject.streamId) === normalizedStreamId;
  }
  const streamIds = Array.isArray(subject?.streamIds) ? subject.streamIds.map((id: any) => Number(id)) : [];
  return streamIds.includes(normalizedStreamId);
}

async function loadExamProgressContext(schoolId: number, examId: number): Promise<ExamProgressContext> {
  const [schoolClasses, schoolStudents, allSubjects, allAssessments, publicationRows] = await Promise.all([
    storage.getClassesBySchool(schoolId),
    storage.getActiveStudentsBySchool(schoolId),
    storage.getAllSubjects(),
    storage.getAssessmentsByExam(examId),
    db.select().from(assessmentPublications).where(and(
      eq(assessmentPublications.schoolId, schoolId),
      eq(assessmentPublications.examId, examId),
    )),
  ]);

  const classIds = schoolClasses.map((classInfo: any) => Number(classInfo.id));
  const classIdSet = new Set(classIds);
  const students = schoolStudents.filter((student: any) => student.classId && classIdSet.has(Number(student.classId)));
  const studentIds = students.map((student: any) => Number(student.id));
  const assessments = allAssessments.filter((assessment: any) => classIdSet.has(Number(assessment.classId)));
  const assessmentIds = assessments.map((assessment: any) => Number(assessment.id));

  const [classSubjectOverrides, studentSubjectOverrides, assessmentPapers, assessmentMarks] = await Promise.all([
    storage.getClassSubjectOverridesByClasses(classIds),
    storage.getStudentSubjectOverridesByStudents(studentIds),
    storage.getAssessmentPapersByAssessments(assessmentIds),
    storage.getAssessmentMarksByAssessments(assessmentIds),
  ]);
  const paperMarks = await storage.getMarkPapersByMarks(assessmentMarks.map((mark: any) => Number(mark.id)));

  const classesById = new Map(schoolClasses.map((classInfo: any) => [Number(classInfo.id), classInfo]));
  const studentsByClass = new Map<number, any[]>();
  for (const student of students) {
    const classId = Number(student.classId);
    const bucket = studentsByClass.get(classId) || [];
    bucket.push(student);
    studentsByClass.set(classId, bucket);
  }

  const subjectsById = new Map(allSubjects.map((subject: any) => [Number(subject.id), subject]));
  const schoolSubjects = allSubjects.filter((subject: any) => Number(subject.schoolId) === Number(schoolId));
  const classOverridesByClass = new Map<number, any[]>();
  for (const row of classSubjectOverrides) {
    const classId = Number(row.classId);
    const bucket = classOverridesByClass.get(classId) || [];
    bucket.push(row);
    classOverridesByClass.set(classId, bucket);
  }

  const classSubjectIdsByClass = new Map<number, Set<number>>();
  for (const classInfo of schoolClasses) {
    const classId = Number(classInfo.id);
    const resolved = new Set<number>(
      schoolSubjects
        .filter((subject: any) => subjectMatchesProgressStream(subject, classInfo.streamId))
        .map((subject: any) => Number(subject.id)),
    );
    for (const row of classOverridesByClass.get(classId) || []) {
      if (String(row.assignmentMode || "add") === "remove") resolved.delete(Number(row.subjectId));
      else resolved.add(Number(row.subjectId));
    }
    classSubjectIdsByClass.set(classId, resolved);
  }

  const studentOverridesByStudent = new Map<number, any[]>();
  for (const row of studentSubjectOverrides) {
    const studentId = Number(row.studentId);
    const bucket = studentOverridesByStudent.get(studentId) || [];
    bucket.push(row);
    studentOverridesByStudent.set(studentId, bucket);
  }

  const studentSubjectIdsByStudent = new Map<number, Set<number>>();
  for (const student of students) {
    const studentId = Number(student.id);
    const resolved = new Set<number>(classSubjectIdsByClass.get(Number(student.classId)) || []);
    for (const row of studentOverridesByStudent.get(studentId) || []) {
      if (String(row.assignmentMode || "add") === "remove") resolved.delete(Number(row.subjectId));
      else resolved.add(Number(row.subjectId));
    }
    studentSubjectIdsByStudent.set(studentId, resolved);
  }

  const assessmentByClassSubject = new Map<string, any>();
  for (const assessment of assessments) {
    const key = classSubjectKey(Number(assessment.classId), Number(assessment.subjectId));
    if (!assessmentByClassSubject.has(key)) assessmentByClassSubject.set(key, assessment);
  }

  const marksByAssessmentStudent = new Map<number, Map<number, any>>();
  for (const mark of assessmentMarks) {
    const assessmentId = Number(mark.assessmentId);
    const byStudent = marksByAssessmentStudent.get(assessmentId) || new Map<number, any>();
    byStudent.set(Number(mark.studentId), mark);
    marksByAssessmentStudent.set(assessmentId, byStudent);
  }

  const papersByAssessment = new Map<number, any[]>();
  for (const paper of assessmentPapers) {
    const assessmentId = Number(paper.assessmentId);
    const bucket = papersByAssessment.get(assessmentId) || [];
    bucket.push(paper);
    papersByAssessment.set(assessmentId, bucket);
  }

  const paperMarksByMark = new Map<number, any[]>();
  for (const paperMark of paperMarks) {
    const markId = Number(paperMark.assessmentMarkId);
    const bucket = paperMarksByMark.get(markId) || [];
    bucket.push(paperMark);
    paperMarksByMark.set(markId, bucket);
  }

  return {
    schoolId,
    examId,
    classesById,
    studentsByClass,
    subjectsById,
    classSubjectIdsByClass,
    studentSubjectIdsByStudent,
    assessmentByClassSubject,
    marksByAssessmentStudent,
    papersByAssessment,
    paperMarksByMark,
    publicationByClass: new Map(publicationRows.map((row: any) => [Number(row.classId), row])),
  };
}

function buildClassExamProgress(context: ExamProgressContext, classId: number): ClassExamProgress {
  const classInfo = context.classesById.get(Number(classId));
  if (!classInfo) throw new Error("Class not found");

  const students = context.studentsByClass.get(Number(classId)) || [];
  const offeredSubjects = Array.from(context.classSubjectIdsByClass.get(Number(classId)) || [])
    .map((subjectId) => context.subjectsById.get(Number(subjectId)))
    .filter(Boolean)
    .sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || "")));

  const result: ClassExamSubjectProgress[] = [];
  let expectedEntries = 0;
  let totalWithMarks = 0;
  let totalAcknowledged = 0;
  let totalPartial = 0;
  let totalUnrecorded = 0;

  for (const subject of offeredSubjects as any[]) {
    const subjectId = Number(subject.id);
    const eligibleStudents = students.filter((student: any) => context.studentSubjectIdsByStudent.get(Number(student.id))?.has(subjectId));
    const totalStudents = eligibleStudents.length;
    const assessment = context.assessmentByClassSubject.get(classSubjectKey(Number(classId), subjectId));

    expectedEntries += totalStudents;

    if (!assessment) {
      totalUnrecorded += totalStudents;
      result.push({
        subjectId,
        subjectName: subject.name,
        assessmentId: null,
        assessmentCreated: false,
        totalStudents,
        markedCount: 0,
        acknowledgedCount: 0,
        partialCount: 0,
        unrecordedCount: totalStudents,
        progressPct: null,
        withMarksPct: 0,
        acknowledgedPct: 0,
        unrecordedPct: 100,
        avgPct: null,
      });
      continue;
    }

    const markByStudent = context.marksByAssessmentStudent.get(Number(assessment.id)) || new Map<number, any>();
    const requiredPapers = context.papersByAssessment.get(Number(assessment.id)) || [];
    let withMarks = 0;
    let acknowledged = 0;
    let partial = 0;
    const completedPercentages: number[] = [];

    for (const student of eligibleStudents) {
      const mark: any = markByStudent.get(Number(student.id));
      if (!mark) continue;
      const status = String(mark.attStatus || "none").toLowerCase();
      if (ACKNOWLEDGED_NOT_WRITTEN_STATUSES.has(status)) {
        acknowledged++;
        continue;
      }

      const savedPaperRows = context.paperMarksByMark.get(Number(mark.id)) || [];
      const savedByPaperId = new Map(savedPaperRows.map((row: any) => [Number(row.assessmentPaperId), row.markObtained]));
      const completedPaperCount = requiredPapers.filter((paper: any) => {
        const value = savedByPaperId.get(Number(paper.id));
        return value !== null && value !== undefined && value !== "";
      }).length;
      const allPapersComplete = requiredPapers.length > 0 && completedPaperCount === requiredPapers.length;

      if (allPapersComplete && mark.percentage !== null && mark.percentage !== undefined) {
        withMarks++;
        const pct = Number(mark.percentage);
        if (Number.isFinite(pct)) completedPercentages.push(pct);
      } else if (completedPaperCount > 0 || status === "present") {
        partial++;
      }
    }

    const unrecorded = Math.max(0, totalStudents - withMarks - acknowledged - partial);
    const progressPct = totalStudents > 0 ? Math.round(((withMarks + acknowledged) / totalStudents) * 100) : 0;
    const withMarksPct = totalStudents > 0 ? Math.round((withMarks / totalStudents) * 100) : 0;
    const acknowledgedPct = totalStudents > 0 ? Math.round((acknowledged / totalStudents) * 100) : 0;
    const unrecordedPct = Math.max(0, 100 - withMarksPct - acknowledgedPct);
    const avgPct = completedPercentages.length
      ? Math.round(completedPercentages.reduce((sum, value) => sum + value, 0) / completedPercentages.length)
      : null;

    totalWithMarks += withMarks;
    totalAcknowledged += acknowledged;
    totalPartial += partial;
    totalUnrecorded += unrecorded;

    result.push({
      subjectId,
      subjectName: subject.name,
      assessmentId: Number(assessment.id),
      assessmentCreated: true,
      totalStudents,
      markedCount: withMarks,
      acknowledgedCount: acknowledged,
      partialCount: partial,
      unrecordedCount: unrecorded,
      progressPct,
      withMarksPct,
      acknowledgedPct,
      unrecordedPct,
      avgPct,
    });
  }

  return {
    classInfo,
    students,
    subjects: result,
    totals: {
      expectedEntries,
      withMarks: totalWithMarks,
      acknowledged: totalAcknowledged,
      partial: totalPartial,
      unrecorded: totalUnrecorded,
      offeredSubjects: offeredSubjects.length,
      assessmentsCreated: result.filter((row) => row.assessmentCreated).length,
      assessmentsMissing: result.filter((row) => !row.assessmentCreated).length,
    },
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() });
  });

  setupAuth(app);
  installActivityAudit(app);

  app.post("/api/auth/request-password-reset", async (req, res, next) => {
    try {
      const identifier = String(req.body?.username || req.body?.identifier || "").trim();
      if (!identifier) {
        return res.status(400).json({ message: "Username or email is required" });
      }

      const user = await findUserForPasswordReset(identifier);
      if (user && user.isActive) {
        const delivery = await issuePasswordSetupLink(user, {
          schoolId: user.schoolId || undefined,
          recipientType: user.role,
          recipientName: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username,
          usernameOverride: user.username,
          subjectPrefix: "Password Reset",
          requestBaseUrl: getRequestBaseUrl(req),
        });

        const emailDeliveries = delivery.deliveries.filter((item) => item.channel.type === "email");
        const successfulEmail = emailDeliveries.some((item) => item.result.success);
        if (!successfulEmail) {
          const reasons = emailDeliveries.length > 0
            ? emailDeliveries.map((item) => `${item.channel.value}: ${item.result.error || "delivery failed"}`).join("; ")
            : "no email address is linked to this account";
          console.error(`[Password Reset] Email delivery failed for user ${user.id}: ${reasons}`);
        }
      }

      // Keep this response generic so the endpoint does not reveal whether an account exists.
      return res.json({ message: "If an active account exists, password reset instructions have been sent." });
    } catch (error) {
      console.error("[Password Reset] Request failed:", error);
      next(error);
    }
  });
  registerObjectStorageRoutes(app);
  registerCalendarRoutes(app);
  await ensureEcdSeedData();

  const readOnlyExemptPaths = [
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/register",
    "/api/auth/request-password-reset",
    "/api/auth/reset-password-with-token",
    "/api/auth/force-reset-password",
    "/api/notifications",
    "/api/schools",
  ];

  app.use("/api", async (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }

    if (readOnlyExemptPaths.some(p => req.path.startsWith(p))) {
      return next();
    }

    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return next();
    }

    const schoolId = getSchoolContext(req);
    if (!schoolId) return next();

    try {
      const school = await storage.getSchool(schoolId);
      if (school && (school.terminationStatus === "pending" || school.terminationStatus === "archived")) {
        return res.status(403).json({ 
          message: school.terminationStatus === "archived"
            ? "This school is archived and in read-only mode. No changes can be made."
            : "This school is in read-only mode due to pending termination. No changes can be made.",
          readOnly: true
        });
      }
    } catch (e) {}

    next();
  });

  app.get("/api/public/org-branding", async (req, res, next) => {
    try {
      const orgs = await storage.getAllOrganizations();
      const org = orgs[0];
      if (org) {
        res.json({ name: org.name, logo: org.logo, motto: org.motto, stamp: org.stamp, address: org.address, phone: org.phone, email: org.email });
      } else {
        res.json({ name: "First Choice Group of Schools", logo: null, motto: null, stamp: null, address: null, phone: null, email: null });
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/public/schools", async (req, res, next) => {
    try {
      const allSchools = await storage.getAllSchools();
      const visibleSchools = allSchools.filter(s => {
        if (s.terminationStatus === "pending" && s.terminationAt) {
          const hoursLeft = (new Date(s.terminationAt).getTime() - Date.now()) / (1000 * 60 * 60);
          if (hoursLeft <= 1) return false;
        }
        return true;
      });
      res.json(visibleSchools.map(s => ({ id: s.id, name: s.name, shortCode: s.shortCode, schoolType: s.schoolType || "secondary", examinationBoard: s.examinationBoard || "ZIMSEC", isBoarding: s.enableHostel || false })));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/users/validate-unique", requireAuth, async (req, res, next) => {
    try {
      const { username, email, phone, excludeUserId } = req.query;
      const conflicts: Record<string, boolean> = {};
      const excludeId = excludeUserId ? parseInt(excludeUserId as string) : null;
      
      if (username) {
        const existing = await storage.getUserByUsername(username as string);
        conflicts.username = !!existing && existing.id !== excludeId;
      }
      if (email) {
        const existing = await storage.getUserByEmail(email as string);
        conflicts.email = !!existing && existing.id !== excludeId;
      }
      if (phone) {
        const existing = await storage.getUserByPhone(phone as string);
        conflicts.phone = !!existing && existing.id !== excludeId;
      }
      res.json(conflicts);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/dashboard/stats", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const fromDate = typeof req.query.fromDate === "string" ? req.query.fromDate : undefined;
      const toDate = typeof req.query.toDate === "string" ? req.query.toDate : undefined;
      const attendancePage = typeof req.query.attendancePage === "string" ? Number(req.query.attendancePage) : undefined;
      const attendancePageSize = typeof req.query.attendancePageSize === "string" ? Number(req.query.attendancePageSize) : undefined;
      const stats = await storage.getDashboardStats(schoolId, { fromDate, toDate, attendancePage, attendancePageSize });
      res.json(stats);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/users", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const roleFilter = req.query.role as string | undefined;
      const users = await storage.getAllUsers();
      const sanitizedUsers = users.map(({ password, ...u }) => u);
      if (roleFilter) {
        res.json(sanitizedUsers.filter(u => u.role === roleFilter));
      } else {
        res.json(sanitizedUsers);
      }
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/users/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id);
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.errors });
      }
      const updated = await storage.updateUser(userId, parsed.data);
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }
      const { password, ...sanitized } = updated;
      res.json(sanitized);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/users/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id);
      const currentUser = req.user as Express.User;
      if (userId === currentUser.id) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      await storage.deleteUser(userId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/users/:id/schools", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const userId = parseInt(req.params.id);
      const access = await checkTenantAccess(currentUser, userId, { repairLegacyOrgAdmin: true });
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }
      await storage.normalizeUserBaselineAccess(userId);
      const schoolAccess = await storage.getUserSchoolAccess(userId);
      res.json(schoolAccess);
    } catch (error) {
      next(error);
    }
  });


  app.put("/api/users/:id/permissions", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const userId = parseInt(req.params.id);
      const parsed = updateUserPermissionsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.errors });
      }

      const access = await checkTenantAccess(currentUser, userId, { repairLegacyOrgAdmin: true });
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }

      const targetUser = access.targetUser;
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      await storage.normalizeUserBaselineAccess(userId);

      if (targetUser.role === "org_admin") {
        const orgHqGroup = await storage.getAccessGroupByName("Org HQ");
        if (orgHqGroup) {
          const currentGroups = await storage.getUserAccessGroups(userId);
          if (!currentGroups.some(group => group.id === orgHqGroup.id)) {
            await storage.addUserToAccessGroup({ userId, accessGroupId: orgHqGroup.id });
          }
        }
      }

      await db.delete(userSchoolAccess).where(eq(userSchoolAccess.userId, userId));
      if (parsed.data.schoolIds.length > 0) {
        await db.insert(userSchoolAccess).values(parsed.data.schoolIds.map(schoolId => ({ userId, schoolId })));
      }

      await storage.updateUserPermissionOverridesFromSelection(userId, parsed.data.permissionIds);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/users/:id/password", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id);
      const { password } = req.body;
      if (!password || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const updated = await storage.updateUser(userId, { password: hashedPassword });
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }
      logActivity(req, { action: "reset_password", category: "settings", description: `Reset password for user: ${updated.username}`, targetType: "user", targetId: updated.id, targetName: updated.username });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/users/:id/status", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id);
      const currentUser = req.user as User;
      if (userId === currentUser.id) {
        return res.status(400).json({ message: "Cannot change your own account status" });
      }
      const { isActive } = req.body;
      const updated = await storage.updateUser(userId, { isActive: !!isActive });
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }
      logActivity(req, { action: isActive ? "activate" : "deactivate", category: "settings", description: `${isActive ? "Activated" : "Deactivated"} user account: ${updated.username}`, targetType: "user", targetId: updated.id, targetName: updated.username });
      const { password, ...sanitized } = updated;
      res.json(sanitized);
    } catch (error) {
      next(error);
    }
  });

  // Global Search (HQ level - org_admin only)
  app.get("/api/search", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const query = req.query.q as string || "";
      const results = await storage.globalSearch(query);
      res.json(results);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!shouldUsePagination(req)) {
        const staffList = await storage.getAllStaff();
        const filtered = schoolId ? staffList.filter(s => s.schoolId === schoolId) : staffList;
        return res.json(filtered);
      }

      const { page, pageSize, offset } = parsePagination(req);
      const search = normalizeSearch(req.query.search);
      const conditions: any[] = [];
      if (schoolId) conditions.push(eq(staffTable.schoolId, schoolId));
      if (search) {
        const q = `%${search}%`;
        conditions.push(sql`(lower(${staffTable.firstName}) like ${q} or lower(${staffTable.lastName}) like ${q} or lower(coalesce(${staffTable.staffNo}, '')) like ${q} or lower(coalesce(${staffTable.phone}, '')) like ${q} or lower(coalesce(${staffTable.email}, '')) like ${q} or lower(coalesce(${staffTable.role}, '')) like ${q})`);
      }
      const whereClause = conditions.length ? and(...conditions) : undefined;
      const [{ count: totalCount }] = await db.select({ count: drizzleCount() }).from(staffTable).where(whereClause);
      const items = await db.select().from(staffTable).where(whereClause).orderBy(desc(staffTable.createdAt)).limit(pageSize).offset(offset);
      return res.json(toPaginatedResult(items, Number(totalCount), page, pageSize));
    } catch (error) {
      next(error);
    }
  });


  const internalTransferStudentSchema = z.object({
    studentId: z.coerce.number().int().positive(),
    destinationSchoolId: z.coerce.number().int().positive(),
    destinationClassId: z.coerce.number().int().positive(),
    admissionNo: z.string().trim().optional().nullable(),
    effectiveDate: z.string().min(4),
    reason: z.string().trim().min(3),
    notes: z.string().trim().optional().nullable(),
  });

  const internalTransferStaffSchema = z.object({
    staffId: z.coerce.number().int().positive(),
    destinationSchoolId: z.coerce.number().int().positive(),
    destinationRole: z.string().trim().min(1),
    destinationAccessGroupId: z.coerce.number().int().positive().optional().nullable(),
    effectiveDate: z.string().min(4),
    reason: z.string().trim().min(3),
    notes: z.string().trim().optional().nullable(),
  });

  async function getInternalTransferSchools(req: Request, sourceSchoolId?: number | null) {
    const currentUser = req.user as User;
    const contextSchoolId = sourceSchoolId || getSchoolContext(req) || currentUser.schoolId || null;
    const contextSchool = contextSchoolId ? await storage.getSchool(contextSchoolId) : undefined;
    const allSchools = await storage.getAllSchools();

    const organizationId = contextSchool?.organizationId || currentUser.organizationId || null;
    const configuredOrganizationIds = new Set(
      allSchools
        .map((school) => school.organizationId)
        .filter((value): value is number => value !== null && value !== undefined)
        .map(Number),
    );

    let visibleSchools = organizationId
      ? allSchools.filter((school) => Number(school.organizationId) === Number(organizationId))
      : [];

    // Older installations can contain schools created before organisation linkage was
    // enforced. When the database clearly represents a single organisation, include those
    // unlinked schools so a valid internal transfer destination is not silently omitted.
    if (configuredOrganizationIds.size <= 1) {
      const legacyUnlinkedSchools = allSchools.filter(
        (school) => school.organizationId === null || school.organizationId === undefined,
      );
      visibleSchools = Array.from(
        new Map([...visibleSchools, ...legacyUnlinkedSchools].map((school) => [school.id, school])).values(),
      );
    }

    if (!organizationId && configuredOrganizationIds.size <= 1) {
      visibleSchools = allSchools;
    }

    if (!visibleSchools.length) {
      throw Object.assign(new Error("No schools are available in the current organisation"), { status: 400 });
    }

    if (currentUser.role === "school_admin" && currentUser.schoolId && contextSchoolId !== currentUser.schoolId) {
      throw Object.assign(new Error("You can only initiate transfers from your assigned school"), { status: 403 });
    }

    if (
      currentUser.role === "org_admin" &&
      currentUser.organizationId &&
      contextSchool?.organizationId &&
      Number(contextSchool.organizationId) !== Number(currentUser.organizationId)
    ) {
      throw Object.assign(new Error("The source school is outside your organisation"), { status: 403 });
    }

    return visibleSchools.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }

  async function ensureInternalTransferSchoolLinkage(
    req: Request,
    sourceSchoolId: number,
    destinationSchoolId: number,
  ) {
    const currentUser = req.user as User;
    const sourceSchool = await storage.getSchool(sourceSchoolId);
    const destinationSchool = await storage.getSchool(destinationSchoolId);
    if (!sourceSchool || !destinationSchool) {
      throw Object.assign(new Error("Source or destination school not found"), { status: 404 });
    }

    const knownOrganizationIds = new Set(
      [currentUser.organizationId, sourceSchool.organizationId, destinationSchool.organizationId]
        .filter((value): value is number => value !== null && value !== undefined)
        .map(Number),
    );
    if (knownOrganizationIds.size > 1) {
      throw Object.assign(new Error("Transfers are only allowed within the same organisation"), { status: 403 });
    }

    let organizationId = Array.from(knownOrganizationIds)[0] || null;
    if (!organizationId) {
      const organisationRows = await db.select({ id: organizations.id }).from(organizations).limit(2);
      if (organisationRows.length !== 1) {
        throw Object.assign(new Error("The organisation could not be determined for these schools"), { status: 400 });
      }
      organizationId = organisationRows[0].id;
    }

    // Repair legacy school rows that pre-date mandatory organisation linkage. This is only
    // reached after the same-organisation checks above have established an unambiguous org.
    if (!sourceSchool.organizationId) {
      await db.update(schoolsTable).set({ organizationId }).where(eq(schoolsTable.id, sourceSchool.id));
    }
    if (!destinationSchool.organizationId) {
      await db.update(schoolsTable).set({ organizationId }).where(eq(schoolsTable.id, destinationSchool.id));
    }

    return organizationId;
  }

  app.get("/api/internal-transfers/destinations", requireAuth, requirePermission("internal_transfers.view"), async (req, res, next) => {
    try {
      const sourceSchoolId = req.query.sourceSchoolId ? Number(req.query.sourceSchoolId) : null;
      if (sourceSchoolId !== null && (!Number.isInteger(sourceSchoolId) || sourceSchoolId <= 0)) {
        return res.status(400).json({ message: "Valid source school is required" });
      }
      res.json(await getInternalTransferSchools(req, sourceSchoolId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/internal-transfers/destinations/:schoolId/classes", requireAuth, requirePermission("internal_transfers.view"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const destinationSchoolId = Number(req.params.schoolId);
      if (!Number.isInteger(destinationSchoolId) || destinationSchoolId <= 0) {
        return res.status(400).json({ message: "Valid destination school is required" });
      }

      const destinationSchool = await storage.getSchool(destinationSchoolId);
      const allowedSchools = await getInternalTransferSchools(req, getSchoolContext(req) || currentUser.schoolId || null);
      if (!destinationSchool || !allowedSchools.some((school) => school.id === destinationSchoolId)) {
        return res.status(403).json({ message: "Destination school is outside your organisation" });
      }

      const destinationClasses = await storage.getClassesBySchool(destinationSchoolId);
      res.json(destinationClasses.sort((a, b) => String(a.className || "").localeCompare(String(b.className || ""))));
    } catch (error) {
      next(error);
    }
  });

  async function buildTransferReferenceMaps(transfers: any[]) {
    const schoolIds = Array.from(new Set(transfers.flatMap((t) => [t.sourceSchoolId, t.destinationSchoolId]).filter(Boolean)));
    const classIds = Array.from(new Set(transfers.flatMap((t) => [t.sourceClassId, t.destinationClassId]).filter(Boolean)));
    const schoolRows = schoolIds.length ? await Promise.all(schoolIds.map((id) => storage.getSchool(Number(id)))) : [];
    const classRows = classIds.length ? await Promise.all(classIds.map((id) => storage.getClass(Number(id)))) : [];
    return {
      schoolsById: new Map(schoolRows.filter(Boolean).map((school: any) => [school.id, school])),
      classesById: new Map(classRows.filter(Boolean).map((classInfo: any) => [classInfo.id, classInfo])),
    };
  }

  app.get("/api/internal-transfers", requireAuth, requirePermission("internal_transfers.view"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const personType = String(req.query.personType || "all");
      const transfers = await storage.getInternalTransfers({
        organizationId: currentUser.organizationId || undefined,
        schoolId: schoolId || undefined,
        personType,
      });
      const { schoolsById, classesById } = await buildTransferReferenceMaps(transfers);
      res.json(transfers.map((transfer: any) => ({
        ...transfer,
        sourceSchoolName: schoolsById.get(transfer.sourceSchoolId)?.name || "Source school",
        destinationSchoolName: schoolsById.get(transfer.destinationSchoolId)?.name || "Destination school",
        sourceClassName: transfer.sourceClassId ? classesById.get(transfer.sourceClassId)?.className || null : null,
        destinationClassName: transfer.destinationClassId ? classesById.get(transfer.destinationClassId)?.className || null : null,
      })));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/internal-transfers/students", requireAuth, requirePermission("internal_transfers.transfer.student"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const data = internalTransferStudentSchema.parse(req.body);
      const student = await storage.getStudent(data.studentId);
      if (!student || student.archivedAt) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (currentUser.role !== "org_admin" && schoolId && student.schoolId !== schoolId) {
        return res.status(403).json({ message: "You can only transfer students from your current school" });
      }
      await ensureInternalTransferSchoolLinkage(req, Number(student.schoolId), data.destinationSchoolId);
      const result = await storage.transferStudentWithinOrganization({
        ...data,
        userId: currentUser.id,
      });
      logActivity(req, {
        action: "transfer",
        category: "students",
        description: `Transferred student ${result.student.firstName} ${result.student.lastName} to another school`,
        targetType: "student",
        targetId: result.student.id,
        targetName: `${result.student.firstName} ${result.student.lastName}`,
        schoolId: student.schoolId,
      });
      res.status(201).json({ message: "Student transferred successfully", ...result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid transfer data", errors: error.errors });
      }
      if (error?.message) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });

  app.post("/api/internal-transfers/staff", requireAuth, requirePermission("internal_transfers.transfer.staff"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const data = internalTransferStaffSchema.parse(req.body);
      const staffMember = await storage.getStaff(data.staffId);
      if (!staffMember) {
        return res.status(404).json({ message: "Staff member not found" });
      }
      if (currentUser.role !== "org_admin" && schoolId && staffMember.schoolId !== schoolId) {
        return res.status(403).json({ message: "You can only transfer staff from your current school" });
      }
      await ensureInternalTransferSchoolLinkage(req, Number(staffMember.schoolId), data.destinationSchoolId);
      const result = await storage.transferStaffWithinOrganization({
        ...data,
        userId: currentUser.id,
      });
      logActivity(req, {
        action: "transfer",
        category: "staff",
        description: `Transferred staff member ${result.staff.firstName} ${result.staff.lastName} to another school`,
        targetType: "staff",
        targetId: result.staff.id,
        targetName: `${result.staff.firstName} ${result.staff.lastName}`,
        schoolId: staffMember.schoolId,
      });
      res.status(201).json({ message: "Staff member transferred successfully", ...result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid transfer data", errors: error.errors });
      }
      if (error?.message) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });

  app.get("/api/me/subject-assignments", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const staffMember = await getCurrentStaffMember(req, schoolId);
      if (!staffMember) {
        return res.json([]);
      }

      const rows = await storage.getStaffSubjects(staffMember.id);
      res.json(rows.filter((row: any) => row.classId !== null && row.classId !== undefined));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff/next-no", requireAuth, async (req, res, next) => {
    try {
      const staffNo = await storage.getNextStaffNo({
        schoolId: getSchoolContext(req),
        referenceDate: new Date(),
      });
      res.json({ staffNo });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff/search", requireAuth, async (req, res, next) => {
    try {
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;

      const query = (req.query.q as string || "").trim().toLowerCase();
      if (!query || query.length < 2) return res.json([]);

      let allStaff: any[] = [];
      let schoolMap = new Map<number, string>();

      if (schoolId) {
        allStaff = await storage.getStaffBySchool(schoolId);
      } else if (currentUser?.organizationId) {
        const orgSchools = await storage.getSchoolsByOrganization(currentUser.organizationId);
        schoolMap = new Map(orgSchools.map(s => [s.id, s.schoolName]));
        const staffArrays = await Promise.all(orgSchools.map(s => storage.getStaffBySchool(s.id)));
        allStaff = staffArrays.flat();
      } else {
        return res.status(400).json({ message: "School or organization context required" });
      }

      const results = allStaff
        .filter(s => {
          const firstName = (s.firstName || "").toLowerCase();
          const lastName = (s.lastName || "").toLowerCase();
          const fullName = `${firstName} ${lastName}`;
          const staffNo = (s.staffNo || "").toLowerCase();
          return firstName.includes(query) || lastName.includes(query) || fullName.includes(query) || staffNo.includes(query);
        })
        .slice(0, 20)
        .map(s => ({
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          staffNo: s.staffNo,
          photo: s.photo,
          role: s.role,
          status: s.status,
          schoolId: s.schoolId,
          schoolName: schoolMap.get(s.schoolId) || undefined,
        }));

      res.json(results);
    } catch (error) { next(error); }
  });

  app.get("/api/staff/:id", requireAuth, async (req, res, next) => {
    try {
      const staffMember = await storage.getStaff(parseInt(req.params.id));
      if (!staffMember) {
        return res.status(404).json({ message: "Staff not found" });
      }
      res.json(staffMember);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/staff", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const data = insertStaffSchema.parse(req.body);
      if (!data.nationalIdNumber?.trim()) {
        return res.status(400).json({ message: "National ID Number is required" });
      }
      const effectiveSchoolId = data.schoolId || schoolId || undefined;
      const referenceDate = new Date();
      const staffNo = (data.staffNo || (await storage.getNextStaffNo({ schoolId: effectiveSchoolId, referenceDate }))).toUpperCase();
      const newStaff = await storage.createStaff({
        ...data,
        staffNo,
        nationalIdNumber: data.nationalIdNumber.trim(),
        passportNumber: data.passportNumber?.trim() || null,
        schoolId: effectiveSchoolId,
      });
      logActivity(req, { action: "create", category: "staff", description: `Added staff member: ${newStaff.firstName} ${newStaff.lastName}`, targetType: "staff", targetId: newStaff.id, targetName: `${newStaff.firstName} ${newStaff.lastName}` });
      res.status(201).json(newStaff);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/staff/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const payload: any = { ...req.body };
      if (typeof payload.staffNo === "string") payload.staffNo = payload.staffNo.toUpperCase();
      if (typeof payload.nationalIdNumber === "string") payload.nationalIdNumber = payload.nationalIdNumber.trim();
      if (typeof payload.passportNumber === "string") payload.passportNumber = payload.passportNumber.trim() || null;
      if (payload.accessGroupId !== undefined && payload.accessGroupId !== null) {
        const parsedAccessGroupId = Number(payload.accessGroupId);
        if (!Number.isInteger(parsedAccessGroupId) || parsedAccessGroupId <= 0) {
          return res.status(400).json({ message: "Invalid access group" });
        }
        const selectedAccessGroup = await storage.getAccessGroup(parsedAccessGroupId);
        if (!selectedAccessGroup) {
          return res.status(400).json({ message: "Access group not found" });
        }
        payload.accessGroupId = parsedAccessGroupId;
      }
      if ("nationalIdNumber" in payload && !payload.nationalIdNumber) {
        return res.status(400).json({ message: "National ID Number is required" });
      }
      const updated = await storage.updateStaff(parseInt(req.params.id), payload);
      if (!updated) {
        return res.status(404).json({ message: "Staff not found" });
      }
      await syncLinkedUserFromStaffRecord(updated);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/staff/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      await storage.deleteStaff(parseInt(req.params.id));
      res.json({ message: "Staff deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/staff/import", requireAuth, requireRole("school_admin", "org_admin"), requirePermission("staff.import"), async (req, res, next) => {
    try {
      const { staff: staffData } = req.body;
      if (!Array.isArray(staffData)) {
        return res.status(400).json({ message: "Invalid staff data" });
      }
      const schoolId = getSchoolContext(req);
      let imported = 0;
      const errors: string[] = [];
      for (const s of staffData) {
        try {
          const nextNo = await storage.getNextStaffNo();
          const cleanedData = {
            ...s,
            staffNo: nextNo,
            schoolId: schoolId || undefined,
            gender: s.gender && s.gender.trim() !== "" ? s.gender.trim().toLowerCase() : null,
            email: s.email && s.email.trim() !== "" ? s.email.trim() : null,
            phone: s.phone && s.phone.trim() !== "" ? s.phone.trim() : null,
            address: s.address && s.address.trim() !== "" ? s.address.trim() : null,
            streetAddress: s.streetAddress && s.streetAddress.trim() !== "" ? s.streetAddress.trim() : null,
            residentialArea: s.residentialArea && s.residentialArea.trim() !== "" ? s.residentialArea.trim() : null,
            role: s.role && s.role.trim() !== "" ? s.role.trim().toLowerCase() : "teacher",
          };
          await storage.createStaff(cleanedData);
          imported++;
        } catch (e: any) {
          const name = `${s.firstName || ""} ${s.lastName || ""}`.trim();
          errors.push(`${name}: ${e.message || "Unknown error"}`);
          console.error("Failed to import staff:", e);
        }
      }
      res.json({ imported, total: staffData.length, errors: errors.length > 0 ? errors.slice(0, 10) : undefined });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/staff/:id/reset-mobile-id", requireAuth, requirePermission("staff_attendance.reset_device_id"), async (req, res, next) => {
    try {
      const targetStaffId = parseInt(req.params.id);
      const existingStaff = await storage.getStaff(targetStaffId);
      const updated = await storage.updateStaff(targetStaffId, { mobileId: null });
      if (!updated) {
        return res.status(404).json({ message: "Staff not found" });
      }
      logActivity(req, {
        action: "reset_device_id",
        category: "staff_attendance",
        description: "Reset staff attendance device binding",
        targetType: "staff",
        targetId: updated.id,
        targetName: `${updated.firstName} ${updated.lastName}`,
        schoolId: updated.schoolId ?? undefined,
        metadata: {
          previousDeviceId: existingStaff?.mobileId ?? null,
          newDeviceId: null,
        },
      });
      res.json({ message: "Device ID reset successfully", staff: updated });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff/:id/subjects", requireAuth, async (req, res, next) => {
    try {
      const staffId = parseInt(req.params.id);
      const subjects = await storage.getStaffSubjects(staffId);
      res.json(subjects);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/staff/:id/subjects", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const staffId = parseInt(req.params.id);
      const { subjectIds } = req.body;
      if (!Array.isArray(subjectIds)) {
        return res.status(400).json({ message: "Invalid subject IDs" });
      }
      await storage.updateStaffSubjects(staffId, subjectIds);
      res.json({ message: "Subjects updated successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff/:id/subject-assignments", requireAuth, requirePermission("staff.assign_subjects"), async (req, res, next) => {
    try {
      const staffId = parseInt(req.params.id, 10);
      if (Number.isNaN(staffId)) return res.status(400).json({ message: "Invalid staff ID" });

      const rows = await storage.getStaffSubjects(staffId);
      res.json(rows.filter((row) => row.classId !== null));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff-subject-assignment-conflict", requireAuth, requirePermission("staff.assign_subjects"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const classId = parseInt(String(req.query.classId || ""), 10);
      const subjectId = parseInt(String(req.query.subjectId || ""), 10);
      const excludeStaffId = req.query.excludeStaffId ? parseInt(String(req.query.excludeStaffId), 10) : null;

      if (Number.isNaN(classId) || Number.isNaN(subjectId)) {
        return res.status(400).json({ message: "classId and subjectId are required" });
      }

      const classInfo = await storage.getClass(classId);
      const subjectInfo = await storage.getSubject(subjectId);
      if (!classInfo || classInfo.schoolId !== schoolId) {
        return res.status(404).json({ message: "Class not found" });
      }
      if (!subjectInfo || subjectInfo.schoolId !== schoolId) {
        return res.status(404).json({ message: "Subject not found" });
      }

      const existingRows = await db.select().from(staffSubjects).where(
        and(
          eq(staffSubjects.classId, classId),
          eq(staffSubjects.subjectId, subjectId),
          excludeStaffId ? sql`${staffSubjects.staffId} <> ${excludeStaffId}` : sql`true`
        )
      );

      if (existingRows.length === 0) {
        return res.json({ conflict: false });
      }

      const existing = existingRows[0];
      const existingStaff = await storage.getStaff(existing.staffId);
      const existingUser = existingStaff?.userId ? await storage.getUser(existingStaff.userId) : null;
      const teacherName = existingUser
        ? `${existingUser.firstName || ""} ${existingUser.lastName || ""}`.trim()
        : existingStaff
          ? `${existingStaff.firstName || ""} ${existingStaff.lastName || ""}`.trim() || `Staff #${existing.staffId}`
          : `Staff #${existing.staffId}`;

      return res.json({
        conflict: true,
        assignment: {
          staffId: existing.staffId,
          classId,
          subjectId,
          teacherName,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/staff/:id/subject-assignments", requireAuth, requirePermission("staff.assign_subjects"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const staffId = parseInt(req.params.id, 10);
      if (Number.isNaN(staffId)) return res.status(400).json({ message: "Invalid staff ID" });

      const staffMember = await storage.getStaff(staffId);
      if (!staffMember || staffMember.schoolId !== schoolId) {
        return res.status(404).json({ message: "Staff member not found" });
      }

      const bodyAssignments = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
      const bodyReassignments = Array.isArray(req.body?.reassignments) ? req.body.reassignments : [];
      if (!bodyAssignments) {
        return res.status(400).json({ message: "Assignments payload is required" });
      }

      const normalizedAssignments = bodyAssignments.map((row: any) => ({
        classId: Number(row?.classId),
        subjectId: Number(row?.subjectId),
      }));
      const normalizedReassignments = new Set(
        bodyReassignments.map((row: any) => `${Number(row?.classId)}-${Number(row?.subjectId)}`)
      );

      if (normalizedAssignments.some((row) => Number.isNaN(row.classId) || Number.isNaN(row.subjectId))) {
        return res.status(400).json({ message: "Each assignment must include classId and subjectId" });
      }

      const dedupedAssignments = normalizedAssignments.filter((row, index, arr) =>
        arr.findIndex((candidate) => candidate.classId === row.classId && candidate.subjectId === row.subjectId) === index
      );

      for (const assignment of dedupedAssignments) {
        const classInfo = await storage.getClass(assignment.classId);
        const subjectInfo = await storage.getSubject(assignment.subjectId);

        if (!classInfo || classInfo.schoolId !== schoolId) {
          return res.status(404).json({ message: `Class ${assignment.classId} not found in current school` });
        }
        if (!subjectInfo || subjectInfo.schoolId !== schoolId) {
          return res.status(404).json({ message: `Subject ${assignment.subjectId} not found in current school` });
        }

        const conflictRows = await db.select().from(staffSubjects).where(
          and(
            eq(staffSubjects.classId, assignment.classId),
            eq(staffSubjects.subjectId, assignment.subjectId),
            sql`${staffSubjects.staffId} <> ${staffId}`
          )
        );

        if (conflictRows.length > 0) {
          const conflictKey = `${assignment.classId}-${assignment.subjectId}`;
          if (!normalizedReassignments.has(conflictKey)) {
            const conflicting = conflictRows[0];
            const conflictingStaff = await storage.getStaff(conflicting.staffId);
            const conflictingUser = conflictingStaff?.userId ? await storage.getUser(conflictingStaff.userId) : null;
            const teacherName = conflictingUser
              ? `${conflictingUser.firstName || ""} ${conflictingUser.lastName || ""}`.trim()
              : conflictingStaff
                ? `${conflictingStaff.firstName || ""} ${conflictingStaff.lastName || ""}`.trim() || `Staff #${conflicting.staffId}`
                : `Staff #${conflicting.staffId}`;

            return res.status(409).json({
              message: `This Class + Subject combination submitted is already assigned to ${teacherName}.`,
              code: "ASSIGNMENT_CONFLICT",
              assignment: {
                staffId: conflicting.staffId,
                classId: assignment.classId,
                subjectId: assignment.subjectId,
                teacherName,
              },
            });
          }
        }
      }

      await db.transaction(async (tx) => {
        await tx.delete(staffSubjects).where(eq(staffSubjects.staffId, staffId));

        for (const assignment of dedupedAssignments) {
          const conflictKey = `${assignment.classId}-${assignment.subjectId}`;
          if (normalizedReassignments.has(conflictKey)) {
            await tx.delete(staffSubjects).where(
              and(
                eq(staffSubjects.classId, assignment.classId),
                eq(staffSubjects.subjectId, assignment.subjectId),
                sql`${staffSubjects.staffId} <> ${staffId}`
              )
            );
          }
        }

        if (dedupedAssignments.length > 0) {
          await tx.insert(staffSubjects).values(
            dedupedAssignments.map((assignment) => ({
              staffId,
              classId: assignment.classId,
              subjectId: assignment.subjectId,
            }))
          );
        }
      });

      res.json({ message: "Assignments updated successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff/:id/classes", requireAuth, async (req, res, next) => {
    try {
      const staffId = parseInt(req.params.id);
      const classes = await storage.getStaffClasses(staffId);
      res.json(classes);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/staff/:id/classes", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const staffId = parseInt(req.params.id);
      const { classIds } = req.body;
      if (!Array.isArray(classIds)) {
        return res.status(400).json({ message: "Invalid class IDs" });
      }
      await storage.updateStaffClasses(staffId, classIds);
      res.json({ message: "Classes updated successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Staff User Account Management
  app.get("/api/staff/:id/user", requireAuth, async (req, res, next) => {
    try {
      const staffId = parseInt(req.params.id);
      const staffMember = await storage.getStaff(staffId);
      if (!staffMember) {
        return res.status(404).json({ message: "Staff member not found" });
      }
      if (!staffMember.userId) {
        return res.status(404).json({ message: "No user account linked" });
      }
      const user = await storage.getUser(staffMember.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      // Don't send password
      const { password, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/staff/:id/user", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const staffId = parseInt(req.params.id);
      const { username, password, sendResetToken } = req.body;
      if (!username) {
        return res.status(400).json({ message: "Username is required" });
      }
      const staffMember = await storage.getStaff(staffId);
      if (!staffMember) {
        return res.status(404).json({ message: "Staff member not found" });
      }
      if (staffMember.userId) {
        return res.status(400).json({ message: "Staff member already has a user account" });
      }
      const uniqueError = await validateUserUniqueness(username, staffMember.email, staffMember.phone);
      if (uniqueError) {
        return res.status(400).json({ message: uniqueError });
      }

      let hashedPassword: string;
      let tokenData: { passwordResetToken?: string; passwordResetTokenExpiry?: Date; tempPasswordLoginsRemaining?: number; mustResetPassword?: boolean } = {};
      let passwordToSend: string | null = null;

      if (sendResetToken) {
        const tempPwd = crypto.randomBytes(16).toString("hex");
        hashedPassword = await bcrypt.hash(tempPwd, 10);
        tokenData = {
          mustResetPassword: true,
        };
      } else {
        if (!password) {
          return res.status(400).json({ message: "Password is required when not sending a password setup link" });
        }
        const pwdCheck = validatePassword(password);
        if (!pwdCheck.valid) {
          return res.status(400).json({ message: pwdCheck.message });
        }
        hashedPassword = await bcrypt.hash(password, 10);
        tokenData = { tempPasswordLoginsRemaining: 3 };
        passwordToSend = password;
      }

      const accessGroup = await resolveAccessGroupForStaffRecord(staffMember);
      const userRole = resolveUserRoleForStaffRecord(staffMember, accessGroup);
      const newUser = await storage.createUser({
        username,
        password: hashedPassword,
        email: staffMember.email || undefined,
        firstName: staffMember.firstName,
        lastName: staffMember.lastName,
        phone: staffMember.phone || undefined,
        role: userRole,
        schoolId: staffMember.schoolId || undefined,
        isActive: true,
        ...tokenData,
      });
      const linkedStaff = await storage.updateStaff(staffId, { userId: newUser.id });
      if (accessGroup) {
        await replaceUserAccessGroupsWithPrimary(newUser.id, accessGroup.id);
      } else {
        await storage.normalizeUserBaselineAccess(newUser.id);
      }
      if (linkedStaff) {
        await syncLinkedUserFromStaffRecord(linkedStaff);
      }

      const name = `${staffMember.firstName} ${staffMember.lastName}`;
      const schoolId = staffMember.schoolId;
      const userId = (req.user as User).id;

      if (sendResetToken) {
        await issuePasswordSetupLink(newUser, {
          schoolId: schoolId || undefined,
          recipientType: "staff",
          recipientId: staffId,
          recipientName: name,
          sentBy: userId,
          usernameOverride: username,
          subjectPrefix: "Password Setup",
        });
      } else if (passwordToSend) {
        const sysUrl = await getSystemUrl(schoolId);
        const loginLink = sysUrl ? `\nLogin here: ${sysUrl}` : "";
        const credMsg = `Dear ${name},\nYour account has been created.\nUsername: ${username}\nTemporary Password: ${passwordToSend}\nThis password is valid for 3 logins. You will be required to set your own password.${loginLink}\n\nHardwork - Discipline - Changing Lives`;
        if (staffMember.phone) {
          await communicationService.sendSms({ to: staffMember.phone, message: credMsg, schoolId: schoolId || 0, recipientType: "staff", recipientId: staffId, sentBy: userId, category: "account", recipientName: name });
        }
        if (staffMember.email) {
          await communicationService.sendEmail({ to: staffMember.email, subject: "Account Created - Your Login Credentials", html: credMsg.replace(/\n/g, '<br>'), text: credMsg, schoolId: schoolId || 0, recipientType: "staff", recipientId: staffId, sentBy: userId, category: "account", recipientName: name });
        }
      }

      res.status(201).json({ message: "User account created successfully", userId: newUser.id });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/staff/:id/user/password", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const staffId = parseInt(req.params.id);
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ message: "Password is required" });
      }
      const staffMember = await storage.getStaff(staffId);
      if (!staffMember || !staffMember.userId) {
        return res.status(404).json({ message: "Staff member or user account not found" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      await storage.updateUser(staffMember.userId, { password: hashedPassword });
      res.json({ message: "Password reset successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/staff/:id/user/status", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const staffId = parseInt(req.params.id);
      const { isActive } = req.body;
      if (typeof isActive !== "boolean") {
        return res.status(400).json({ message: "isActive must be a boolean" });
      }
      const staffMember = await storage.getStaff(staffId);
      if (!staffMember || !staffMember.userId) {
        return res.status(404).json({ message: "Staff member or user account not found" });
      }
      await storage.updateUser(staffMember.userId, { isActive });
      res.json({ message: "Account status updated successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/streams", requireAuth, async (req, res, next) => {
    try {
      const schoolType = req.query.schoolType as string | undefined;
      const streamList = schoolType 
        ? await storage.getStreamsBySchoolType(schoolType)
        : await storage.getAllStreams();
      res.json(streamList);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/streams", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const data = insertStreamSchema.parse(req.body);
      const newStream = await storage.createStream(data);
      res.status(201).json(newStream);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/classes", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const classList = await storage.getAllClasses();
      const filtered = schoolId 
        ? classList.filter(c => c.schoolId === schoolId)
        : classList;
      res.json(filtered);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/classes/:id", requireAuth, async (req, res, next) => {
    try {
      const classData = await storage.getClass(parseInt(req.params.id));
      if (!classData) {
        return res.status(404).json({ message: "Class not found" });
      }
      res.json(classData);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/classes", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const data = insertClassSchema.parse(req.body);
      const newClass = await storage.createClass(data);
      res.status(201).json(newClass);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/classes/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const updated = await storage.updateClass(parseInt(req.params.id), req.body);
      if (!updated) {
        return res.status(404).json({ message: "Class not found" });
      }
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/classes/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const classData = await storage.getClass(parseInt(req.params.id));
      if (!classData) {
        return res.status(404).json({ message: "Class not found" });
      }
      if (schoolId && classData.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteClass(parseInt(req.params.id));
      res.json({ message: "Class deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/classes/:id/student-count", requireAuth, async (req, res, next) => {
    try {
      const count = await storage.getStudentCountByClass(parseInt(req.params.id));
      res.json({ count });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/class-subjects/all", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const classList = schoolId ? await storage.getClassesBySchool(schoolId) : await storage.getAllClasses();
      const resolvedRows = await Promise.all(
        classList.map(async (classItem) => {
          const subjectRows = await storage.getClassSubjects(classItem.id);
          return subjectRows.map((row, index) => ({
            id: row.id ?? (-1 * (index + 1)),
            classId: classItem.id,
            subjectId: row.subjectId,
            assignmentMode: row.assignmentMode,
          }));
        }),
      );
      res.json(resolvedRows.flat());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/classes/:id/subjects", requireAuth, async (req, res, next) => {
    try {
      const classId = parseInt(req.params.id);
      const classData = await storage.getClass(classId);
      if (!classData) {
        return res.status(404).json({ message: "Class not found" });
      }
      const schoolId = getSchoolContext(req);
      if (schoolId && classData.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const payload = await buildClassSubjectManagementPayload(classId);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/classes/:id/subjects", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const classId = parseInt(req.params.id);
      const classData = await storage.getClass(classId);
      if (!classData) {
        return res.status(404).json({ message: "Class not found" });
      }
      if (schoolId && classData.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { subjectId } = req.body;
      if (!subjectId) {
        return res.status(400).json({ message: "subjectId is required" });
      }
      const schoolSubjects = await getSchoolScopedSubjects(classData.schoolId);
      if (!schoolSubjects.some((subject) => subject.id === Number(subjectId))) {
        return res.status(400).json({ message: "Invalid subject" });
      }
      const payload = await buildClassSubjectManagementPayload(classId);
      const selected = new Set((payload?.selected ?? []).map(Number));
      const directSelected = new Set((payload?.directSelected ?? []).map(Number));
      const removed = new Set((payload?.removed ?? []).map(Number));
      selected.add(Number(subjectId));
      directSelected.add(Number(subjectId));
      removed.delete(Number(subjectId));
      await db.transaction(async (tx) => {
        await tx.delete(classSubjectsSchema).where(eq(classSubjectsSchema.classId, classId));
        const inserts = [
          ...Array.from(directSelected).map((id) => ({ classId, subjectId: id, assignmentMode: "add" as const })),
          ...Array.from(removed).map((id) => ({ classId, subjectId: id, assignmentMode: "remove" as const })),
        ];
        if (inserts.length > 0) {
          await tx.insert(classSubjectsSchema).values(inserts);
        }
      });
      res.status(201).json(await buildClassSubjectManagementPayload(classId));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/classes/:id/subjects/:subjectId", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const classId = parseInt(req.params.id);
      const classData = await storage.getClass(classId);
      if (!classData) {
        return res.status(404).json({ message: "Class not found" });
      }
      if (schoolId && classData.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const subjectId = parseInt(req.params.subjectId);
      const payload = await buildClassSubjectManagementPayload(classId);
      const inherited = new Set((payload?.inheritedSelected ?? []).map(Number));
      const directSelected = new Set((payload?.directSelected ?? []).map(Number));
      const removed = new Set((payload?.removed ?? []).map(Number));
      directSelected.delete(subjectId);
      if (inherited.has(subjectId)) {
        removed.add(subjectId);
      } else {
        removed.delete(subjectId);
      }
      await db.transaction(async (tx) => {
        await tx.delete(classSubjectsSchema).where(eq(classSubjectsSchema.classId, classId));
        const inserts = [
          ...Array.from(directSelected).map((id) => ({ classId, subjectId: id, assignmentMode: "add" as const })),
          ...Array.from(removed).map((id) => ({ classId, subjectId: id, assignmentMode: "remove" as const })),
        ];
        if (inserts.length > 0) {
          await tx.insert(classSubjectsSchema).values(inserts);
        }
      });
      res.json({ message: "Subject removed from class", data: await buildClassSubjectManagementPayload(classId) });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/classes/:id/subjects", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const classId = parseInt(req.params.id);
      const classData = await storage.getClass(classId);
      if (!classData) {
        return res.status(404).json({ message: "Class not found" });
      }
      if (schoolId && classData.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { subjectIds, directSubjectIds, removedSubjectIds } = req.body as {
        subjectIds?: number[];
        directSubjectIds?: number[];
        removedSubjectIds?: number[];
      };
      if (!Array.isArray(subjectIds)) {
        return res.status(400).json({ message: "subjectIds must be an array" });
      }
      const schoolSubjects = await getSchoolScopedSubjects(classData.schoolId);
      const validSubjectIds = new Set(schoolSubjects.map((subject) => subject.id));
      const selected = Array.from(new Set(subjectIds.map(Number))).filter((id) => validSubjectIds.has(id));
      const inherited = new Set(await getInheritedClassSubjectIds(classData));
      const normalizedDirect = Array.isArray(directSubjectIds)
        ? Array.from(new Set(directSubjectIds.map(Number))).filter((id) => validSubjectIds.has(id) && selected.includes(id))
        : selected.filter((id) => !inherited.has(id));
      const normalizedRemoved = Array.isArray(removedSubjectIds)
        ? Array.from(new Set(removedSubjectIds.map(Number))).filter((id) => validSubjectIds.has(id) && !selected.includes(id))
        : Array.from(inherited).filter((id) => !selected.includes(id));
      await db.transaction(async (tx) => {
        await tx.delete(classSubjectsSchema).where(eq(classSubjectsSchema.classId, classId));
        const inserts = [
          ...normalizedDirect.map((id) => ({ classId, subjectId: id, assignmentMode: "add" as const })),
          ...normalizedRemoved.map((id) => ({ classId, subjectId: id, assignmentMode: "remove" as const })),
        ];
        if (inserts.length > 0) {
          await tx.insert(classSubjectsSchema).values(inserts);
        }
      });
      res.json({ message: "Class subjects updated", data: await buildClassSubjectManagementPayload(classId) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/classes/:id/migrate", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const fromClassId = parseInt(req.params.id);
      const { toClassId, studentIds } = req.body;
      
      if (!toClassId) {
        return res.status(400).json({ message: "toClassId is required" });
      }
      
      const fromClass = await storage.getClass(fromClassId);
      const toClass = await storage.getClass(toClassId);
      
      if (!fromClass || !toClass) {
        return res.status(404).json({ message: "Class not found" });
      }
      
      if (schoolId && (fromClass.schoolId !== schoolId || toClass.schoolId !== schoolId)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const count = await storage.migrateStudents(fromClassId, toClassId, studentIds);
      res.json({ message: `Migrated ${count} student(s)`, count });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/parents", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!shouldUsePagination(req)) {
        const parentList = await storage.getAllParents();
        const filtered = schoolId
          ? parentList.filter(p => p.schoolId === schoolId)
          : parentList.filter(p => p.schoolId !== null);
        return res.json(filtered);
      }

      const { page, pageSize, offset } = parsePagination(req);
      const search = normalizeSearch(req.query.search);
      const conditions: any[] = [];
      if (schoolId) conditions.push(eq(parentsTable.schoolId, schoolId));
      else conditions.push(sql`${parentsTable.schoolId} is not null`);
      if (search) {
        const q = `%${search}%`;
        conditions.push(sql`(lower(${parentsTable.firstName}) like ${q} or lower(${parentsTable.lastName}) like ${q} or lower(coalesce(${parentsTable.phone}, '')) like ${q} or lower(coalesce(${parentsTable.email}, '')) like ${q} or lower(coalesce(${parentsTable.relationship}, '')) like ${q})`);
      }
      const whereClause = conditions.length ? and(...conditions) : undefined;
      const [{ count: totalCount }] = await db.select({ count: drizzleCount() }).from(parentsTable).where(whereClause);
      const items = await db.select().from(parentsTable).where(whereClause).orderBy(desc(parentsTable.createdAt)).limit(pageSize).offset(offset);
      const parentIds = items.map((parent) => parent.id);
      const childCounts = parentIds.length
        ? await db.select({ parentId: studentsTable.parentId, count: drizzleCount() })
            .from(studentsTable)
            .where(and(inArray(studentsTable.parentId, parentIds), sql`${studentsTable.archivedAt} is null`))
            .groupBy(studentsTable.parentId)
        : [];
      const countByParentId = new Map(childCounts.map((row) => [row.parentId, Number(row.count)]));
      const itemsWithCounts = items.map((parent) => ({
        ...parent,
        childrenCount: countByParentId.get(parent.id) || 0,
      }));
      return res.json(toPaginatedResult(itemsWithCounts, Number(totalCount), page, pageSize));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/parents/:id", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const parent = await storage.getParent(parseInt(req.params.id));
      if (!parent) {
        return res.status(404).json({ message: "Parent not found" });
      }
      // Enforce school context - school_admin must match parent.schoolId exactly
      if (schoolId && parent.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      res.json(parent);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/parents", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const data = insertParentSchema.parse(req.body);
      
      // Determine effective schoolId - require context for all roles
      const effectiveSchoolId = schoolId || currentUser.schoolId;
      
      if (!effectiveSchoolId) {
        return res.status(400).json({ message: "School context required to create parent" });
      }
      
      const newParent = await storage.createParent({
        ...data,
        schoolId: effectiveSchoolId,
      });
      res.status(201).json(newParent);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/parents/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const parentId = parseInt(req.params.id);
      const parent = await storage.getParent(parentId);
      if (!parent) {
        return res.status(404).json({ message: "Parent not found" });
      }
      // Enforce school context - must match parent.schoolId exactly
      if (schoolId && parent.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      // Strip schoolId from body for all roles to prevent cross-school moves
      const { schoolId: _bodySchoolId, ...safeBody } = req.body;
      const updated = await storage.updateParent(parentId, safeBody);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/parents/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const parentId = parseInt(req.params.id);
      const parent = await storage.getParent(parentId);
      if (!parent) {
        return res.status(404).json({ message: "Parent not found" });
      }
      // Enforce school context - school_admin must match parent.schoolId exactly
      if (schoolId && parent.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteParent(parentId);
      res.json({ message: "Parent deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Parent import endpoint
  app.post("/api/parents/import", requireAuth, requireRole("school_admin", "org_admin"), requirePermission("parents.import"), async (req, res, next) => {
    try {
      const { parents: parentData } = req.body;
      if (!Array.isArray(parentData)) {
        return res.status(400).json({ message: "Invalid data format" });
      }
      
      const schoolId = getSchoolContext(req);
      if (!schoolId) {
        return res.status(400).json({ message: "School context required for import" });
      }
      
      // Preload all parents for this school once (performance optimization)
      const allParents = await storage.getAllParents();
      const schoolParents = allParents.filter(p => p.schoolId === schoolId);
      
      let imported = 0;
      let skipped = 0;
      
      for (const row of parentData) {
        try {
          // Validate basic required fields
          if (!row.firstName || !row.lastName) {
            skipped++;
            continue;
          }
          
          const phone = row.phone?.replace(/\D/g, "").slice(-9) || "";
          
          // Check if parent already exists by phone (scoped to current school)
          let existingParent = null;
          if (phone && phone.length >= 9) {
            existingParent = schoolParents.find(p => {
              const pPhone = p.phone?.replace(/\D/g, "").slice(-9) || "";
              return pPhone === phone && pPhone.length >= 9;
            });
          }
          
          if (existingParent) {
            // Update existing parent
            await storage.updateParent(existingParent.id, {
              firstName: row.firstName || existingParent.firstName,
              lastName: row.lastName || existingParent.lastName,
              email: row.email || existingParent.email,
              relationship: row.relationship || existingParent.relationship,
              occupation: row.occupation || existingParent.occupation,
              address: row.address || existingParent.address,
            });
            imported++;
          } else {
            // Create new parent with school context
            const newParent = await storage.createParent({
              firstName: row.firstName,
              lastName: row.lastName,
              phone: row.phone || "",
              email: row.email || undefined,
              relationship: row.relationship || "parent",
              occupation: row.occupation || undefined,
              address: row.address || undefined,
              schoolId,
            });
            schoolParents.push(newParent);
            imported++;
          }
        } catch {
          skipped++;
        }
      }
      
      res.json({ imported, skipped, total: parentData.length });
    } catch (error) {
      next(error);
    }
  });

  // Parent user account management
  app.get("/api/parents/:id/user", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const parentId = parseInt(req.params.id);
      const parent = await storage.getParent(parentId);
      if (!parent) {
        return res.status(404).json({ message: "Parent not found" });
      }
      
      // Enforce school context - school_admin must match parent.schoolId exactly
      if (schoolId && parent.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      if (parent.userId) {
        const user = await storage.getUser(parent.userId);
        if (user) {
          // Strip password from response
          const { password: _pw, ...safeUser } = user;
          return res.json({ user: safeUser });
        }
      }
      
      res.json({ user: null });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/parents/:id/user", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const parentId = parseInt(req.params.id);
      const { username, password, sendResetToken } = req.body;
      
      if (!username) {
        return res.status(400).json({ message: "Username is required" });
      }
      
      const parent = await storage.getParent(parentId);
      if (!parent) {
        return res.status(404).json({ message: "Parent not found" });
      }
      
      if (schoolId && parent.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      if (parent.userId) {
        return res.status(400).json({ message: "Parent already has a user account" });
      }
      
      const uniqueError = await validateUserUniqueness(username);
      if (uniqueError) {
        return res.status(400).json({ message: uniqueError });
      }
      
      const effectiveSchoolId = schoolId || parent.schoolId;
      if (!effectiveSchoolId) {
        return res.status(400).json({ message: "School context required to create user account" });
      }
      
      let hashedPassword: string;
      let tokenData: any = {};
      let passwordToSend: string | null = null;

      if (sendResetToken) {
        const tempPwd = crypto.randomBytes(16).toString("hex");
        hashedPassword = await bcrypt.hash(tempPwd, 10);
        tokenData = {
          mustResetPassword: true,
        };
      } else {
        if (!password) {
          return res.status(400).json({ message: "Password is required when not sending a password setup link" });
        }
        const pwdCheck = validatePassword(password);
        if (!pwdCheck.valid) {
          return res.status(400).json({ message: pwdCheck.message });
        }
        hashedPassword = await bcrypt.hash(password, 10);
        tokenData = { tempPasswordLoginsRemaining: 3 };
        passwordToSend = password;
      }

      const newUser = await storage.createUser({
        username,
        password: hashedPassword,
        role: "parent",
        email: parent.email || undefined,
        firstName: parent.firstName,
        lastName: parent.lastName,
        phone: parent.phone || undefined,
        schoolId: effectiveSchoolId,
        ...tokenData,
      });
      
      await storage.updateParent(parentId, { userId: newUser.id });

      const name = `${parent.firstName} ${parent.lastName}`;
      const userId = (req.user as User).id;

      if (sendResetToken) {
        await issuePasswordSetupLink(newUser, {
          schoolId: effectiveSchoolId,
          recipientType: "parent",
          recipientId: parentId,
          recipientName: name,
          sentBy: userId,
          usernameOverride: username,
          subjectPrefix: "Password Setup",
        });
      } else if (passwordToSend) {
        const sysUrl = await getSystemUrl(effectiveSchoolId);
        const loginLink = sysUrl ? `\nLogin here: ${sysUrl}` : "";
        const credMsg = `Dear ${name},\nYour account has been created.\nUsername: ${username}\nTemporary Password: ${passwordToSend}\nThis password is valid for 3 logins. You will be required to set your own password.${loginLink}\n\nHardwork - Discipline - Changing Lives`;
        if (parent.phone) {
          await communicationService.sendSms({ to: parent.phone, message: credMsg, schoolId: effectiveSchoolId, recipientType: "parent", recipientId: parentId, sentBy: userId, category: "account", recipientName: name });
        }
        if (parent.email) {
          await communicationService.sendEmail({ to: parent.email, subject: "Account Created - Your Login Credentials", html: credMsg.replace(/\n/g, '<br>'), text: credMsg, schoolId: effectiveSchoolId, recipientType: "parent", recipientId: parentId, sentBy: userId, category: "account", recipientName: name });
        }
      }
      
      const { password: _pw, ...safeUser } = newUser;
      res.status(201).json({ user: safeUser, message: "User account created successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/parents/:id/user/password", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const parentId = parseInt(req.params.id);
      const { password } = req.body;
      
      if (!password || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      
      const parent = await storage.getParent(parentId);
      if (!parent || !parent.userId) {
        return res.status(404).json({ message: "Parent or user account not found" });
      }
      
      // Enforce school context - school_admin must match parent.schoolId exactly
      if (schoolId && parent.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      await storage.updateUser(parent.userId, { password: hashedPassword });
      
      res.json({ message: "Password reset successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/parents/:id/user/status", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const parentId = parseInt(req.params.id);
      const { isActive } = req.body;
      
      const parent = await storage.getParent(parentId);
      if (!parent || !parent.userId) {
        return res.status(404).json({ message: "Parent or user account not found" });
      }
      
      // Enforce school context - school_admin must match parent.schoolId exactly
      if (schoolId && parent.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      await storage.updateUser(parent.userId, { isActive: !!isActive });
      
      res.json({ message: isActive ? "Account activated" : "Account deactivated" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/students", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const status = String(req.query.status || "").toLowerCase();

      if (!shouldUsePagination(req)) {
        const archivedOnly = status === "archived";
        const studentList = archivedOnly
          ? schoolId
            ? await storage.getArchivedStudentsBySchool(schoolId)
            : await storage.getArchivedStudents()
          : schoolId
            ? await storage.getStudentsBySchool(schoolId)
            : await storage.getAllStudents();
        return res.json(studentList);
      }

      const { page, pageSize, offset } = parsePagination(req);
      const search = normalizeSearch(req.query.search);
      const classId = req.query.classId && req.query.classId !== "all" ? Number.parseInt(String(req.query.classId), 10) : null;
      const streamId = req.query.streamId && req.query.streamId !== "all" ? Number.parseInt(String(req.query.streamId), 10) : null;
      const conditions: any[] = [];
      if (schoolId) conditions.push(eq(studentsTable.schoolId, schoolId));
      if (status === "archived") {
        conditions.push(sql`${studentsTable.archivedAt} is not null`);
      } else {
        conditions.push(sql`${studentsTable.archivedAt} is null`);
        if (status && status !== "all") {
          conditions.push(eq(studentsTable.status, status as any));
        }
      }
      if (Number.isFinite(classId)) conditions.push(eq(studentsTable.classId, classId as number));
      if (Number.isFinite(streamId)) conditions.push(eq(studentsTable.streamId, streamId as number));
      if (search) {
        const q = `%${search}%`;
        conditions.push(sql`(
          lower(${studentsTable.firstName}) like ${q}
          or lower(${studentsTable.lastName}) like ${q}
          or lower(coalesce(${studentsTable.admissionNo}, '')) like ${q}
          or lower(coalesce(${studentsTable.phone}, '')) like ${q}
          or lower(coalesce(${studentsTable.email}, '')) like ${q}
          or exists (
            select 1 from ${parentsTable}
            where ${parentsTable.id} = ${studentsTable.parentId}
              and (lower(${parentsTable.firstName}) like ${q}
                or lower(${parentsTable.lastName}) like ${q}
                or lower(coalesce(${parentsTable.phone}, '')) like ${q}
                or lower(coalesce(${parentsTable.email}, '')) like ${q})
          )
        )`);
      }
      const whereClause = conditions.length ? and(...conditions) : undefined;
      const [{ count: totalCount }] = await db.select({ count: drizzleCount() }).from(studentsTable).where(whereClause);
      const items = await db.select().from(studentsTable).where(whereClause).orderBy(...studentFirstNameOrder).limit(pageSize).offset(offset);
      const parentIds = Array.from(new Set(items.map((student) => student.parentId).filter((id): id is number => typeof id === "number")));
      const parentRows = parentIds.length
        ? await db.select({
          id: parentsTable.id,
          firstName: parentsTable.firstName,
          lastName: parentsTable.lastName,
          phone: parentsTable.phone,
          email: parentsTable.email,
          relationship: parentsTable.relationship,
        }).from(parentsTable).where(inArray(parentsTable.id, parentIds))
        : [];
      const parentsById = new Map(parentRows.map((parent) => [parent.id, parent]));
      const itemsWithParentDetails = items.map((student) => {
        const parent = student.parentId ? parentsById.get(student.parentId) : undefined;
        return parent ? {
          ...student,
          parentName: `${parent.firstName || ""} ${parent.lastName || ""}`.trim(),
          parentPhone: parent.phone,
          parentEmail: parent.email,
          parentRelationship: parent.relationship,
        } : student;
      });
      return res.json(toPaginatedResult(itemsWithParentDetails, Number(totalCount), page, pageSize));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/students/search", requireAuth, async (req, res, next) => {
    try {
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;

      const query = (req.query.q as string || "").trim().toLowerCase();
      if (!query || query.length < 2) return res.json([]);

      let allStudents: any[] = [];
      let classMap = new Map<number, any>();
      let schoolMap = new Map<number, string>();

      if (schoolId) {
        allStudents = await storage.getStudentsBySchool(schoolId);
        const allClasses = await storage.getClassesBySchool(schoolId);
        classMap = new Map(allClasses.map(c => [c.id, c]));
      } else if (currentUser?.organizationId) {
        const orgSchools = await storage.getSchoolsByOrganization(currentUser.organizationId);
        schoolMap = new Map(orgSchools.map(s => [s.id, s.schoolName]));
        const dataArrays = await Promise.all(orgSchools.map(async s => {
          const studs = await storage.getStudentsBySchool(s.id);
          const cls = await storage.getClassesBySchool(s.id);
          cls.forEach(c => classMap.set(c.id, c));
          return studs;
        }));
        allStudents = dataArrays.flat();
      } else {
        return res.status(400).json({ message: "School or organization context required" });
      }

      const results = allStudents
        .filter(s => {
          const firstName = (s.firstName || "").toLowerCase();
          const lastName = (s.lastName || "").toLowerCase();
          const fullName = `${firstName} ${lastName}`;
          const admNo = (s.admissionNo || "").toLowerCase();
          return firstName.includes(query) || lastName.includes(query) || fullName.includes(query) || admNo.includes(query);
        })
        .sort(compareStudentsByFirstName)
        .slice(0, 20)
        .map(s => ({
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          admissionNo: s.admissionNo,
          photo: s.photo,
          className: s.classId ? classMap.get(s.classId)?.className || "" : "",
          status: s.status,
          schoolId: s.schoolId,
          schoolName: schoolMap.get(s.schoolId) || undefined,
        }));

      res.json(results);
    } catch (error) { next(error); }
  });

  app.get("/api/students/next-admission-no", requireAuth, async (req, res, next) => {
    try {
      const admissionNo = await storage.getNextAdmissionNo({
        schoolId: getSchoolContext(req),
        referenceDate: new Date(),
      });
      res.json({ admissionNo });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/students/by-class/:classId", requireAuth, async (req, res, next) => {
    try {
      const studentList = await storage.getStudentsByClass(parseInt(req.params.classId));
      res.json(studentList);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/students/by-parent/:parentId", requireAuth, async (req, res, next) => {
    try {
      const requestedParentId = parseInt(req.params.parentId);
      const user = req.user as User;
      
      if (user.role === "parent") {
        if (user.id !== requestedParentId) {
          return res.status(403).json({ message: "Access denied" });
        }
        const allParents = await storage.getAllParents();
        const parentRecord = allParents.find(p => p.userId === user.id);
        if (!parentRecord) {
          return res.json([]);
        }
        const studentList = await storage.getStudentsByParent(parentRecord.id);
        return res.json(studentList);
      }
      
      const studentList = await storage.getStudentsByParent(requestedParentId);
      res.json(studentList);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/students/:id", requireAuth, async (req, res, next) => {
    try {
      const student = await storage.getStudent(parseInt(req.params.id));
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      const schoolId = getSchoolContext(req);
      if (schoolId && student.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const parent = student.parentId ? await storage.getParent(student.parentId) : undefined;
      if (!parent) {
        return res.json(student);
      }

      res.json({
        ...student,
        parent,
        parentName: `${parent.firstName || ""} ${parent.lastName || ""}`.trim(),
        parentPhone: parent.phone,
        parentEmail: parent.email,
        parentRelationship: parent.relationship,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/students", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const data = insertStudentSchema.parse(req.body);
      const effectiveSchoolId = data.schoolId || schoolId || currentUser.schoolId || undefined;
      const enrollmentReferenceDate = data.enrollmentDate || new Date();
      const normalizedData: any = {
        ...data,
        admissionNo: (data.admissionNo || (await storage.getNextAdmissionNo({ schoolId: effectiveSchoolId, referenceDate: enrollmentReferenceDate }))).toUpperCase(),
        nationalIdNumber: data.nationalIdNumber?.trim() || null,
        passportNumber: data.passportNumber?.trim() || null,
        schoolId: effectiveSchoolId,
      };
      if (normalizedData.isDayScholar) {
        normalizedData.isBoarding = false;
        normalizedData.hostelId = null;
      } else {
        normalizedData.isBoarding = true;
      }
      if (normalizedData.hostelId) {
        const hostel = await storage.getHostel(Number(normalizedData.hostelId));
        if (!hostel) {
          return res.status(400).json({ message: "Selected hostel was not found" });
        }
        if (effectiveSchoolId && hostel.schoolId !== effectiveSchoolId) {
          return res.status(400).json({ message: "Selected hostel does not belong to this school" });
        }
        if (hostel.gender && normalizedData.gender && hostel.gender !== normalizedData.gender) {
          return res.status(400).json({ message: "Student gender does not match the selected hostel" });
        }
      }
      const newStudent = await storage.createStudent(normalizedData);
      logActivity(req, { action: "create", category: "students", description: `Added student: ${newStudent.firstName} ${newStudent.lastName}`, targetType: "student", targetId: newStudent.id, targetName: `${newStudent.firstName} ${newStudent.lastName}` });
      res.status(201).json(newStudent);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/students/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const studentId = parseInt(req.params.id);
      const existing = await storage.getStudent(studentId);
      if (!existing) {
        return res.status(404).json({ message: "Student not found" });
      }
      const normalizedData: any = { ...req.body };
      if (typeof normalizedData.admissionNo === "string") normalizedData.admissionNo = normalizedData.admissionNo.toUpperCase();
      if (typeof normalizedData.nationalIdNumber === "string") normalizedData.nationalIdNumber = normalizedData.nationalIdNumber.trim() || null;
      if (typeof normalizedData.passportNumber === "string") normalizedData.passportNumber = normalizedData.passportNumber.trim() || null;
      if (Object.prototype.hasOwnProperty.call(normalizedData, "isDayScholar")) {
        if (normalizedData.isDayScholar) {
          normalizedData.isBoarding = false;
          normalizedData.hostelId = null;
        } else {
          normalizedData.isBoarding = true;
        }
      }
      if (Object.prototype.hasOwnProperty.call(normalizedData, "hostelId") && normalizedData.hostelId) {
        normalizedData.isBoarding = true;
        normalizedData.isDayScholar = false;
      }
      const resolvedGender = normalizedData.gender ?? existing.gender;
      const resolvedSchoolId = normalizedData.schoolId ?? existing.schoolId;
      if (Object.prototype.hasOwnProperty.call(normalizedData, "hostelId") && normalizedData.hostelId) {
        const hostel = await storage.getHostel(Number(normalizedData.hostelId));
        if (!hostel) {
          return res.status(400).json({ message: "Selected hostel was not found" });
        }
        if (resolvedSchoolId && hostel.schoolId !== resolvedSchoolId) {
          return res.status(400).json({ message: "Selected hostel does not belong to this school" });
        }
        if (hostel.gender && resolvedGender && hostel.gender !== resolvedGender) {
          return res.status(400).json({ message: "Student gender does not match the selected hostel" });
        }
      }
      const updated = await storage.updateStudent(studentId, normalizedData);
      if (!updated) {
        return res.status(404).json({ message: "Student not found" });
      }
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/students/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const studentId = parseInt(req.params.id);

      const student = await storage.getStudent(studentId);
      if (!student || student.archivedAt) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (currentUser.role !== "org_admin" && schoolId && student.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const deleted = await storage.deleteStudent(studentId);
      if (!deleted) {
        return res.status(404).json({ message: "Student not found" });
      }

      logActivity(req, {
        action: "delete",
        category: "students",
        description: `Archived student: ${student.firstName} ${student.lastName}`,
        targetType: "student",
        targetId: student.id,
        targetName: `${student.firstName} ${student.lastName}`,
        schoolId: student.schoolId ?? undefined,
      });
      res.json({ message: "Student deleted successfully", archived: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/students/:id/transfer", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const id = parseInt(req.params.id);
      const student = await storage.getStudent(id);
      if (!student || student.archivedAt) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (currentUser.role !== "org_admin" && schoolId && student.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const updated = await storage.updateStudent(id, { status: "transferred" });
      if (student.userId) {
        await storage.updateUser(student.userId, { isActive: false });
      }
      res.json({ message: "Student transferred successfully", student: updated });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/students/:id/subjects", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const studentId = parseInt(req.params.id);
      const student = await storage.getStudent(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (currentUser.role !== "org_admin" && schoolId && student.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const payload = await buildStudentSubjectManagementPayload(studentId);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

  async function getPhotoLimitBytes(schoolId: number): Promise<number> {
    const school = await storage.getSchool(schoolId);
    if (school?.organizationId) {
      const org = await storage.getOrganization(school.organizationId);
      if (org?.photoUploadLimitMB) return org.photoUploadLimitMB * 1024 * 1024;
    }
    return 5 * 1024 * 1024;
  }

  app.post("/api/students/:id/photo", requireAuth, requireRole("school_admin", "org_admin", "teacher"), photoUpload.single("photo"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No image file uploaded" });
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const studentId = parseInt(req.params.id);
      const student = await storage.getStudent(studentId);
      if (!student) return res.status(404).json({ message: "Student not found" });
      if (student.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      const limitBytes = await getPhotoLimitBytes(schoolId);
      if (req.file.size > limitBytes) return res.status(400).json({ message: `Photo exceeds the ${Math.round(limitBytes / (1024 * 1024))}MB upload limit` });

      const objectRoot = process.env.LOCAL_OBJECT_DIR || "/var/lib/fcgs/object_storage";


      const rawExt = path.extname(req.file.originalname || "").toLowerCase().replace(".", "");


      const ext = /^[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : "jpg";


      const objectName = `uploads/student-photos/${studentId}-${Date.now()}.${ext}`;


      const absPath = path.join(objectRoot, objectName);


      await fs.mkdir(path.dirname(absPath), { recursive: true });


      await fs.writeFile(absPath, req.file.buffer);

      const photoPath = `/objects/${objectName}`;
      await storage.updateStudent(studentId, { photo: photoPath });
      res.json({ photo: photoPath });
    } catch (error) { next(error); }
  });

  app.post("/api/staff/:id/photo", requireAuth, requireRole("school_admin", "org_admin"), photoUpload.single("photo"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No image file uploaded" });
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const staffId = parseInt(req.params.id);
      const staffMember = await storage.getStaff(staffId);
      if (!staffMember) return res.status(404).json({ message: "Staff member not found" });
      if (staffMember.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      const limitBytes = await getPhotoLimitBytes(schoolId);
      if (req.file.size > limitBytes) return res.status(400).json({ message: `Photo exceeds the ${Math.round(limitBytes / (1024 * 1024))}MB upload limit` });

      const objectRoot = process.env.LOCAL_OBJECT_DIR || "/var/lib/fcgs/object_storage";


      const rawExt = path.extname(req.file.originalname || "").toLowerCase().replace(".", "");


      const ext = /^[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : "jpg";


      const objectName = `uploads/staff-photos/${staffId}-${Date.now()}.${ext}`;


      const absPath = path.join(objectRoot, objectName);


      await fs.mkdir(path.dirname(absPath), { recursive: true });


      await fs.writeFile(absPath, req.file.buffer);

      const photoPath = `/objects/${objectName}`;
      await storage.updateStaff(staffId, { photo: photoPath });
      res.json({ photo: photoPath });
    } catch (error) { next(error); }
  });

  app.put("/api/students/:id/subjects", requireAuth, requireRole("school_admin", "org_admin", "teacher"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const studentId = parseInt(req.params.id);
      const student = await storage.getStudent(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (currentUser.role !== "org_admin" && schoolId && student.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { subjectIds, directSubjectIds, removedSubjectIds } = req.body as {
        subjectIds?: number[];
        directSubjectIds?: number[];
        removedSubjectIds?: number[];
      };
      if (!Array.isArray(subjectIds)) {
        return res.status(400).json({ message: "subjectIds must be an array" });
      }
      const schoolSubjects = await getSchoolScopedSubjects(student.schoolId);
      const validSubjectIds = new Set(schoolSubjects.map((subject) => subject.id));
      const selected = Array.from(new Set(subjectIds.map(Number))).filter((id) => validSubjectIds.has(id));
      const inherited = new Set(student.classId ? (await storage.getClassSubjects(student.classId)).map((row) => row.subjectId) : []);
      const normalizedDirect = Array.isArray(directSubjectIds)
        ? Array.from(new Set(directSubjectIds.map(Number))).filter((id) => validSubjectIds.has(id) && selected.includes(id))
        : selected.filter((id) => !inherited.has(id));
      const normalizedRemoved = Array.isArray(removedSubjectIds)
        ? Array.from(new Set(removedSubjectIds.map(Number))).filter((id) => validSubjectIds.has(id) && !selected.includes(id))
        : Array.from(inherited).filter((id) => !selected.includes(id));
      await db.transaction(async (tx) => {
        await tx.delete(studentSubjectsSchema).where(eq(studentSubjectsSchema.studentId, studentId));
        const inserts = [
          ...normalizedDirect.map((id) => ({ studentId, subjectId: id, assignmentMode: "add" as const })),
          ...normalizedRemoved.map((id) => ({ studentId, subjectId: id, assignmentMode: "remove" as const })),
        ];
        if (inserts.length > 0) {
          await tx.insert(studentSubjectsSchema).values(inserts);
        }
      });
      res.json({ message: "Student subjects updated successfully", data: await buildStudentSubjectManagementPayload(studentId) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/students/import", requireAuth, requireRole("school_admin", "org_admin"), requirePermission("students.import"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const effectiveSchoolId = schoolId || currentUser.schoolId;
      
      interface ImportStudentData {
        admissionNo?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        gender?: "male" | "female";
        dateOfBirth?: string;
        address?: string;
        status?: string;
        className?: string;
        parentName?: string;
        parentPhone?: string;
        parentEmail?: string;
        parentRelationship?: string;
        enrollmentDate?: string;
        religion?: string;
        transferReason?: string;
      }
      
      const { students: studentData } = req.body as { students: ImportStudentData[] };
      
      if (!Array.isArray(studentData)) {
        return res.status(400).json({ message: "Invalid data format" });
      }

      const allClasses = await storage.getAllClasses();
      const schoolClasses = effectiveSchoolId ? allClasses.filter(c => c.schoolId === effectiveSchoolId) : allClasses;
      const allParents = await storage.getAllParents();
      const schoolParents = effectiveSchoolId ? allParents.filter(p => p.schoolId === effectiveSchoolId) : allParents;
      const allStudents = await storage.getAllStudents();
      
      const classMap = new Map<string, number>();
      for (const c of schoolClasses) {
        classMap.set(c.className.toLowerCase().trim(), c.id);
      }
      
      const parentPhoneMap = new Map<string, number>();
      for (const p of schoolParents) {
        if (p.phone) {
          const normalizedPhone = p.phone.replace(/\D/g, "").slice(-9);
          parentPhoneMap.set(normalizedPhone, p.id);
        }
      }
      
      const existingAdmissionNos = new Set(allStudents.map(s => s.admissionNo?.toLowerCase()));
      
      let imported = 0;
      let skipped = 0;
      let parentsCreated = 0;
      let classesCreated = 0;
      const errors: string[] = [];
      
      for (const student of studentData) {
        try {
          if (!student.firstName || !student.lastName) {
            skipped++;
            continue;
          }
          
          let admissionNo = student.admissionNo?.trim() || "";
          if (admissionNo && existingAdmissionNos.has(admissionNo.toLowerCase())) {
            skipped++;
            continue;
          }
          
          if (!admissionNo) {
            const existingNumbers = allStudents
              .map(s => s.admissionNo)
              .filter(n => n && n.startsWith("FCGSM"))
              .map(n => parseInt(n.replace("FCGSM", "")) || 0);
            const maxNo = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
            admissionNo = `FCGSM${String(maxNo + 1 + imported).padStart(4, "0")}`;
          }
          
          let classId: number | undefined;
          if (student.className) {
            const classNameLower = student.className.toLowerCase().trim();
            if (classMap.has(classNameLower)) {
              classId = classMap.get(classNameLower);
            } else if (effectiveSchoolId) {
              const newClass = await storage.createClass({
                className: student.className.trim(),
                schoolId: effectiveSchoolId,
              });
              classMap.set(classNameLower, newClass.id);
              classId = newClass.id;
              classesCreated++;
            }
          }
          
          let parentId: number | undefined;
          if (student.parentName || student.parentPhone) {
            const normalizedPhone = student.parentPhone?.replace(/\D/g, "").slice(-9) || "";
            
            if (normalizedPhone && parentPhoneMap.has(normalizedPhone)) {
              parentId = parentPhoneMap.get(normalizedPhone);
            } else if (student.parentName && effectiveSchoolId) {
              const nameParts = student.parentName.trim().split(/\s+/);
              const firstName = nameParts[0] || "Parent";
              const lastName = nameParts.slice(1).join(" ") || student.lastName;
              
              const newParent = await storage.createParent({
                firstName,
                lastName,
                phone: student.parentPhone?.trim(),
                email: student.parentEmail?.trim() || undefined,
                relationship: student.parentRelationship?.trim() || undefined,
                schoolId: effectiveSchoolId,
              });
              
              if (normalizedPhone) {
                parentPhoneMap.set(normalizedPhone, newParent.id);
              }
              parentId = newParent.id;
              parentsCreated++;
            }
          }
          
          await storage.createStudent({
            admissionNo,
            firstName: student.firstName.trim(),
            lastName: student.lastName.trim(),
            email: student.email?.trim() || undefined,
            phone: student.phone?.trim() || undefined,
            gender: student.gender || undefined,
            dateOfBirth: student.dateOfBirth?.trim() || undefined,
            address: student.address?.trim() || undefined,
            classId,
            parentId,
            schoolId: effectiveSchoolId || undefined,
            status: (student.status as "active" | "inactive" | "transferred" | "graduated") || "active",
            isDayScholar: true,
          });
          
          existingAdmissionNos.add(admissionNo.toLowerCase());
          imported++;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push(`Row ${imported + skipped + 1}: ${errMsg}`);
          skipped++;
        }
      }

      res.json({ 
        imported, 
        skipped,
        parentsCreated,
        classesCreated,
        total: studentData.length,
        errors: errors.slice(0, 10),
      });
    } catch (error) {
      next(error);
    }
  });

  const studentAccountSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    password: z.string().optional(),
    sendResetToken: z.boolean().optional().default(true),
  });

  const studentPasswordSchema = z.object({
    password: z.string().min(6, "Password must be at least 6 characters"),
  });

  const studentStatusSchema = z.object({
    isActive: z.boolean(),
  });

  app.get("/api/students/:id/user", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const studentId = parseInt(req.params.id);
      const student = await storage.getStudent(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (currentUser.role !== "org_admin" && schoolId && student.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!student.userId) {
        return res.json(null);
      }
      const user = await storage.getUser(student.userId);
      res.json(user || null);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/students/:id/user", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const studentId = parseInt(req.params.id);
      const student = await storage.getStudent(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (currentUser.role !== "org_admin" && schoolId && student.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (student.userId) {
        return res.status(400).json({ message: "Student already has a user account" });
      }

      const parsed = studentAccountSchema.parse(req.body);
      const uniqueError = await validateUserUniqueness(parsed.username, student.email, student.phone);
      if (uniqueError) {
        return res.status(400).json({ message: uniqueError });
      }

      let hashedPassword: string;
      let tokenData: any = {};
      let passwordToSend: string | null = null;

      if (parsed.sendResetToken) {
        const tempPwd = crypto.randomBytes(16).toString("hex");
        hashedPassword = await bcrypt.hash(tempPwd, 10);
        tokenData = {
          mustResetPassword: true,
        };
      } else {
        if (!parsed.password) {
          return res.status(400).json({ message: "Password is required when not sending a password setup link" });
        }
        const pwdCheck = validatePassword(parsed.password);
        if (!pwdCheck.valid) {
          return res.status(400).json({ message: pwdCheck.message });
        }
        hashedPassword = await bcrypt.hash(parsed.password, 10);
        tokenData = { tempPasswordLoginsRemaining: 3 };
        passwordToSend = parsed.password;
      }

      const newUser = await storage.createUser({
        username: parsed.username,
        password: hashedPassword,
        role: "student",
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email || undefined,
        phone: student.phone || undefined,
        schoolId: student.schoolId,
        ...tokenData,
      });

      await storage.updateStudent(studentId, { userId: newUser.id });

      const name = `${student.firstName} ${student.lastName}`;
      const userId = currentUser.id;
      const effSchoolId = student.schoolId || 0;

      if (parsed.sendResetToken) {
        await issuePasswordSetupLink(newUser, {
          schoolId: effSchoolId,
          recipientType: "student",
          recipientId: studentId,
          recipientName: name,
          sentBy: userId,
          usernameOverride: parsed.username,
          subjectPrefix: "Password Setup",
        });
      } else if (passwordToSend) {
        const parentRecord = student.parentId ? await storage.getParent(student.parentId) : null;
        const contactPhone = student.phone || parentRecord?.phone;
        const contactEmail = student.email || parentRecord?.email;
        const sysUrl = await getSystemUrl(effSchoolId);
        const loginLink = sysUrl ? `\nLogin here: ${sysUrl}` : "";
        const credMsg = `Dear ${name},\nYour account has been created.\nUsername: ${parsed.username}\nTemporary Password: ${passwordToSend}\nThis password is valid for 3 logins. You will be required to set your own password.${loginLink}\n\nHardwork - Discipline - Changing Lives`;
        if (contactPhone) {
          await communicationService.sendSms({ to: contactPhone, message: credMsg, schoolId: effSchoolId, recipientType: "student", recipientId: studentId, sentBy: userId, category: "account", recipientName: name });
        }
        if (contactEmail) {
          await communicationService.sendEmail({ to: contactEmail, subject: "Account Created - Your Login Credentials", html: credMsg.replace(/\n/g, '<br>'), text: credMsg, schoolId: effSchoolId, recipientType: "student", recipientId: studentId, sentBy: userId, category: "account", recipientName: name });
        }
      }

      res.status(201).json(newUser);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/students/:id/user/password", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const studentId = parseInt(req.params.id);
      const student = await storage.getStudent(studentId);
      if (!student || !student.userId) {
        return res.status(404).json({ message: "Student or user account not found" });
      }
      if (currentUser.role !== "org_admin" && schoolId && student.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const parsed = studentPasswordSchema.parse(req.body);
      const bcrypt = await import("bcrypt");
      const hashedPassword = await bcrypt.hash(parsed.password, 10);
      
      await storage.updateUser(student.userId, { password: hashedPassword });
      res.json({ message: "Password updated successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/students/:id/user/status", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const studentId = parseInt(req.params.id);
      const student = await storage.getStudent(studentId);
      if (!student || !student.userId) {
        return res.status(404).json({ message: "Student or user account not found" });
      }
      if (currentUser.role !== "org_admin" && schoolId && student.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const parsed = studentStatusSchema.parse(req.body);
      await storage.updateUser(student.userId, { isActive: parsed.isActive });
      res.json({ message: "Account status updated successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/subjects", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const hasPaginationParams = req.query.page !== undefined || req.query.perPage !== undefined || req.query.paginated === "true";
      const page = parseInt(req.query.page as string) || 1;
      const perPage = parseInt(req.query.perPage as string) || 50;
      const search = (req.query.search as string) || "";

      const subjectList = await storage.getAllSubjects();
      let filtered = schoolId
        ? subjectList.filter(s => s.schoolId === schoolId)
        : subjectList;

      if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(s =>
          s.name.toLowerCase().includes(searchLower) ||
          (s.shortCode || "").toLowerCase().includes(searchLower) ||
          (s.syllabusCode || "").toLowerCase().includes(searchLower)
        );
      }

      filtered.sort((a, b) => {
        const aLabel = `${a.shortCode || ""} ${a.name || ""}`.trim();
        const bLabel = `${b.shortCode || ""} ${b.name || ""}`.trim();
        return aLabel.localeCompare(bLabel);
      });

      // Selector/dropdown consumers expect the complete school subject list so the
      // visible 5-item searchable dropdown can scroll through all entries. Only the
      // Subjects management page uses pagination params and receives a paginated shape.
      if (!hasPaginationParams) {
        return res.json(filtered);
      }

      const total = filtered.length;
      const start = (page - 1) * perPage;
      const items = filtered.slice(start, start + perPage);

      res.json({
        items,
        total,
        page,
        perPage,
        hasPrev: page > 1,
        hasNext: start + perPage < total
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/subjects/:id", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const subject = await storage.getSubject(parseInt(req.params.id));
      if (!subject) {
        return res.status(404).json({ message: "Subject not found" });
      }
      if (schoolId && subject.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      res.json(subject);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/subjects", requireAuth, requireRole("school_admin", "teacher", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) {
        return res.status(400).json({ message: "School context required" });
      }
      const validated = await validateSubjectPayloadForSchool(schoolId, req.body, res);
      if (!validated) return;
      const data = insertSubjectSchema.parse({ ...req.body, schoolId });
      const newSubject = await storage.createSubject(data);
      res.status(201).json(newSubject);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/subjects/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const subject = await storage.getSubject(parseInt(req.params.id));
      if (!subject) {
        return res.status(404).json({ message: "Subject not found" });
      }
      if (schoolId && subject.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const validated = await validateSubjectPayloadForSchool(subject.schoolId, req.body, res, subject);
      if (!validated) return;
      const { name, shortCode, syllabusCode, subjectType, description, streamId, streamIds } = req.body;
      const updateData: Partial<{ name: string; shortCode: string; syllabusCode: string | null; subjectType: string; description: string; streamId: number | null; streamIds: number[] | null }> = {};
      if (name !== undefined) updateData.name = name;
      if (shortCode !== undefined) updateData.shortCode = shortCode;
      if (syllabusCode !== undefined) updateData.syllabusCode = syllabusCode;
      if (subjectType !== undefined) updateData.subjectType = subjectType;
      if (description !== undefined) updateData.description = description;
      if (streamId !== undefined) updateData.streamId = streamId;
      if (streamIds !== undefined) updateData.streamIds = streamIds;
      
      const updated = await storage.updateSubject(parseInt(req.params.id), updateData);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/subjects/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const subject = await storage.getSubject(parseInt(req.params.id));
      if (!subject) {
        return res.status(404).json({ message: "Subject not found" });
      }
      if (schoolId && subject.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteSubject(parseInt(req.params.id));
      res.json({ message: "Subject deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/grades", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const page = parseInt(req.query.page as string) || 1;
      const perPage = parseInt(req.query.perPage as string) || 50;
      const search = (req.query.search as string) || "";
      const gradeLevel = req.query.gradeLevel as string || "";
      
      const gradeList = await storage.getAllGrades();
      let filtered = schoolId 
        ? gradeList.filter(g => g.schoolId === schoolId)
        : gradeList;
      
      if (gradeLevel) {
        filtered = filterItemsByGradeProfileKey(filtered, gradeLevel);
      }
      
      if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(g => 
          g.gradeName.toLowerCase().includes(searchLower) ||
          (g.gradeStatus && g.gradeStatus.toLowerCase().includes(searchLower))
        );
      }
      
      const total = filtered.length;
      const start = (page - 1) * perPage;
      const items = filtered.slice(start, start + perPage);
      
      res.json({
        items,
        total,
        page,
        perPage,
        hasPrev: page > 1,
        hasNext: start + perPage < total
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/grades", requireAuth, requireRole("school_admin", "org_admin", "teacher", "quality_control_officer"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) {
        return res.status(400).json({ message: "School context required" });
      }
      const data = insertGradeSchema.parse({ ...req.body, schoolId });
      const newGrade = await storage.createGrade(data);
      res.status(201).json(newGrade);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/grades/:id", requireAuth, requireRole("school_admin", "org_admin", "teacher", "quality_control_officer"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const grade = await storage.getGrade(parseInt(req.params.id));
      if (!grade) {
        return res.status(404).json({ message: "Grade not found" });
      }
      if (schoolId && grade.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { gradeName, gradeLevel, classIds, appliesAll, lowerLimit, upperLimit, gradePoints, gradeStatus, gradeType } = req.body;
      const updateData: Record<string, any> = {};
      if (gradeName !== undefined) updateData.gradeName = gradeName;
      if (gradeLevel !== undefined) updateData.gradeLevel = gradeLevel;
      if (classIds !== undefined) updateData.classIds = classIds;
      if (appliesAll !== undefined) updateData.appliesAll = appliesAll;
      if (lowerLimit !== undefined) updateData.lowerLimit = lowerLimit;
      if (upperLimit !== undefined) updateData.upperLimit = upperLimit;
      if (gradePoints !== undefined) updateData.gradePoints = gradePoints;
      if (gradeStatus !== undefined) updateData.gradeStatus = gradeStatus;
      if (gradeType !== undefined) updateData.gradeType = gradeType;
      
      const updated = await storage.updateGrade(parseInt(req.params.id), updateData);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/grades/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const grade = await storage.getGrade(parseInt(req.params.id));
      if (!grade) {
        return res.status(404).json({ message: "Grade not found" });
      }
      if (schoolId && grade.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteGrade(parseInt(req.params.id));
      res.json({ message: "Grade deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/assessments/by-class/:classId", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const classId = parseInt(req.params.classId);
      const classInfo = await ensureClassInSchool(classId, schoolId, res);
      if (!classInfo) return;

      const assessmentList = await storage.getAssessmentsByClass(classId);
      const assessmentsWithPapers = await Promise.all(
        assessmentList
          .filter((assessment) => assessment.schoolId === schoolId)
          .map(async (assessment) => {
            const papers = await storage.getAssessmentPapers(assessment.id);
            return { ...assessment, papers };
          })
      );
      res.json(assessmentsWithPapers);
    } catch (error) {
      next(error);
    }
  });


  app.delete("/api/assessments/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, parseInt(req.params.id));
      if (!scoped) return;
      if (await rejectIfAssessmentPublished(scoped.assessment, res)) return;

      await storage.deleteAssessment(scoped.assessment.id);
      res.json({ message: "Assessment deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/marks/by-assessment/:assessmentId", requireAuth, async (req, res, next) => {
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, parseInt(req.params.assessmentId));
      if (!scoped) return;

      const markList = await storage.getMarksByAssessment(scoped.assessment.id);
      res.json(markList);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/marks/by-student/:studentId", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const studentId = parseInt(req.params.studentId);
      const student = await ensureStudentInSchool(studentId, schoolId, res);
      if (!student) return;

      const markList = await storage.getMarksByStudent(student.id);
      res.json(markList);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/marks", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const data = insertMarkSchema.parse(req.body);
      const assessment = await storage.getAssessment(data.assessmentId);
      if (!assessment || assessment.schoolId !== schoolId) {
        return res.status(403).json({ message: "Assessment not in school context" });
      }

      const student = await ensureStudentInSchool(data.studentId, schoolId, res);
      if (!student) return;
      if (student.classId !== assessment.classId) {
        return res.status(400).json({ message: "Student does not belong to the assessment class" });
      }

      const newMark = await storage.createMark(data);
      res.status(201).json(newMark);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/marks/bulk", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const marksData = req.body.marks.map((m: any) => insertMarkSchema.parse(m));
      for (const mark of marksData) {
        const assessment = await storage.getAssessment(mark.assessmentId);
        if (!assessment || assessment.schoolId !== schoolId) {
          return res.status(403).json({ message: "Assessment not in school context" });
        }

        const student = await ensureStudentInSchool(mark.studentId, schoolId, res);
        if (!student) return;
        if (student.classId !== assessment.classId) {
          return res.status(400).json({ message: "Student does not belong to the assessment class" });
        }
      }

      const newMarks = await storage.bulkCreateMarks(marksData);
      res.status(201).json(newMarks);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/attendance/by-class/:classId/:date", requireAuth, async (req, res, next) => {
    try {
      const date = req.params.date || new Date().toISOString().split('T')[0];
      const records = await storage.getAttendanceByClass(parseInt(req.params.classId), date);
      res.json(records);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/attendance/by-student/:studentId", requireAuth, async (req, res, next) => {
    try {
      const records = await storage.getAttendanceByStudent(parseInt(req.params.studentId));
      res.json(records);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/attendance", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const data = insertAttendanceRecordSchema.parse(req.body);
      const newRecord = await storage.createAttendance(data);
      res.status(201).json(newRecord);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/attendance/bulk", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const { records, notifyParent } = req.body;
      const parsed = records.map((r: any) => {
        const rec = insertAttendanceRecordSchema.parse(r);
        delete (rec as any).notifiedStatus;
        delete (rec as any).notifiedReason;
        return rec;
      });

      const currentUserForRegister = req.user as User;
      if (currentUserForRegister.role === "teacher") {
        const [currentStaff] = await db.select().from(staff).where(eq(staff.userId, currentUserForRegister.id)).limit(1);
        if (!currentStaff) {
          return res.status(403).json({ message: "Only the currently assigned class teacher can mark this class register" });
        }

        const classIdsToMark = Array.from(new Set(parsed.map((rec: any) => Number(rec.classId)).filter(Number.isFinite)));
        for (const classId of classIdsToMark) {
          const classInfo = await storage.getClass(classId);
          if (!classInfo) {
            return res.status(404).json({ message: `Class ${classId} not found` });
          }

          const isCurrentClassTeacher = Number(classInfo.classTeacherId) === Number(currentStaff.id);
          const activeAssignment = await db.select().from(classTeacherAssignmentsTable).where(and(
            eq(classTeacherAssignmentsTable.classId, classId),
            eq(classTeacherAssignmentsTable.teacherId, currentStaff.id),
            sql`(${classTeacherAssignmentsTable.effectiveTo} IS NULL OR ${classTeacherAssignmentsTable.effectiveTo} > now())`
          )).limit(1);

          if (!isCurrentClassTeacher && activeAssignment.length === 0) {
            return res.status(403).json({
              message: "Only the currently assigned class teacher can mark this class register",
              classId,
              className: classInfo.className,
            });
          }
        }
      }

      const absentSlugs = ['absent', 'sick', 'fees', 'suspended', 'absconding', 'excused', 'late'];
      const unknownReasons = ['', 'no reason'];

      const previousBaselines: Record<number, { notifiedStatus: string | null; notifiedReason: string | null }> = {};
      if (parsed.length > 0) {
        const groupKey = (classId: number, date: string) => `${classId}|${date}`;
        const groups = new Map<string, typeof parsed>();
        for (const rec of parsed) {
          const key = groupKey(rec.classId, rec.date);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(rec);
        }
        for (const [key, recs] of groups.entries()) {
          const [cid, dt] = key.split('|');
          const existing = await storage.getAttendanceByClass(parseInt(cid), dt);
          for (const rec of recs) {
            const prev = existing.find(e => e.studentId === rec.studentId);
            previousBaselines[rec.studentId] = {
              notifiedStatus: prev?.notifiedStatus ?? null,
              notifiedReason: prev?.notifiedReason ?? null,
            };
          }
        }
      }

      if (notifyParent) {
        for (const rec of parsed) {
          rec.notifiedStatus = rec.status;
          rec.notifiedReason = rec.reason || null;
        }
      }

      const newRecords = await storage.bulkUpsertAttendance(parsed);

      if (notifyParent) {
        const currentUser = await storage.getUser((req.user as any).id);
        const schoolId = getSchoolContext(req) || currentUser?.schoolId;
        const school = schoolId ? await storage.getSchool(schoolId) : null;
        const callPhone = school?.callCentrePhone || '';
        const waPhone = school?.callCentreWhatsApp || '';

        for (const rec of newRecords) {
          const baseline = previousBaselines[rec.studentId] || { notifiedStatus: null, notifiedReason: null };
          const baselineStatus = baseline.notifiedStatus || '';
          const baselineReason = (baseline.notifiedReason || '').trim();
          const firstTimeNotify = !baseline.notifiedStatus;

          const newSlug = rec.status;
          const newReason = (rec.reason || '').trim();

          const baselineAbsentLike = absentSlugs.includes(baselineStatus);
          const newAbsentLike = absentSlugs.includes(newSlug);

          const changed = baselineStatus !== newSlug || baselineReason !== newReason;

          if (!changed && !newAbsentLike) {
            console.log(`[FCGS Attendance Notify] No change vs baseline for student ${rec.studentId}: status=${newSlug}, reason="${newReason}" — skipping (present)`);
            continue;
          }

          const student = await storage.getStudent(rec.studentId);
          if (!student?.parentId) {
            console.log(`[FCGS Attendance Notify] Student ${rec.studentId} has no parent — skipping`);
            continue;
          }
          const parent = await storage.getParent(student.parentId);
          if (!parent?.phone && !parent?.email) {
            console.log(`[FCGS Attendance Notify] Parent ${student.parentId} has no phone or email — skipping`);
            continue;
          }

          const studentName = `${student.firstName} ${student.lastName}`;
          let msg = '';

          if (changed && baselineAbsentLike && newSlug === 'present' && !firstTimeNotify) {
            msg = `FCGS Attendance: ${studentName} was initially marked ABSENT, this has been amended to PRESENT. We apologise for any inconvenience caused. Thank you.`;
          } else if (changed && baselineAbsentLike && newAbsentLike && !firstTimeNotify) {
            msg = `FCGS Attendance: ${studentName} reason for absence has been updated; reason: ${(newReason || 'No Reason').toUpperCase()}. Please contact our Call Centre for any enquiries you may have.`;
          } else if (newAbsentLike) {
            const classInfo = await storage.getClass(rec.classId);
            const className = classInfo?.shortCode || classInfo?.className || 'Class';

            let teacherName = '';
            let teacherPhone = '';
            let teacherEmail = '';

            if (classInfo?.classTeacherId) {
              const classTeacher = await storage.getStaff(classInfo.classTeacherId);
              if (classTeacher) {
                teacherName = `${classTeacher.firstName} ${classTeacher.lastName}`.trim();
                teacherPhone = classTeacher.phone || '';
                teacherEmail = classTeacher.email || '';
              }
            }

            const reasonRaw = newReason;
            const reasonLc = reasonRaw.toLowerCase();
            const isUnknown = unknownReasons.includes(reasonLc);

            const teacherContactBits = [
              teacherPhone ? `Phone: ${teacherPhone}` : null,
              teacherEmail ? `Email: ${teacherEmail}` : null,
            ].filter(Boolean);

            const contactLine =
              teacherName && teacherContactBits.length > 0
                ? `Contact: ${teacherName} | ${teacherContactBits.join(' | ')}`
                : teacherName
                  ? `Contact: ${teacherName}`
                  : (callPhone || waPhone)
                    ? `Phone: ${callPhone}${waPhone ? ` or WhatsApp: ${waPhone}` : ''}`
                    : '';

            const line1 = `FCGS Attendance: ${studentName} was marked ABSENT on ${rec.date} (${className}).`;

            let line2: string;
            if (isUnknown) {
              line2 = teacherName
                ? 'Please contact us with a reason for the absence.'
                : 'Please contact us with a reason for the absence.';
            } else {
              line2 = teacherName
                ? `Reason: ${reasonRaw.toUpperCase()}. Please contact us for any enquiries you may have.`
                : `Reason: ${reasonRaw.toUpperCase()}. Please contact us for any enquiries you may have.`;
            }

            msg = contactLine
              ? `${line1}\n${line2}\n${contactLine}`
              : `${line1}\n${line2}`;
          }
          if (msg) {
            const senderId = (req.user as any).id;
            console.log(`[FCGS Attendance Notify] Sending to parent of student ${rec.studentId}: baseline=${baselineStatus}→new=${newSlug}, changed=${changed}, firstTimeNotify=${firstTimeNotify}`);

            if (parent.phone) {
              communicationService.sendSms({
                to: parent.phone,
                message: msg,
                schoolId: schoolId || undefined,
                recipientType: "parent",
                recipientId: parent.id,
                sentBy: senderId,
                category: "attendance",
                recipientName: `${parent.firstName} ${parent.lastName}`,
              }).catch((err) => {
                console.error(`[FCGS Attendance Notify] SMS send failed for student ${rec.studentId}:`, err);
              });
            }

            if (parent.email) {
              communicationService.sendEmail({
                to: parent.email,
                subject: "FCGS Attendance Notification",
                text: msg,
                html: msg.replace(/\n/g, '<br>'),
                schoolId: schoolId || undefined,
                recipientType: "parent",
                recipientId: parent.id,
                sentBy: senderId,
                category: "attendance",
                recipientName: `${parent.firstName} ${parent.lastName}`,
              }).catch((err) => {
                console.error(`[FCGS Attendance Notify] Email send failed for student ${rec.studentId}:`, err);
              });
            }
          } else {
            console.log(`[FCGS Attendance Notify] No notification for student ${rec.studentId}: baseline=${baselineStatus}(absent=${baselineAbsentLike}) → new=${newSlug}(absent=${newAbsentLike}), changed=${changed}, firstTimeNotify=${firstTimeNotify}`);
          }
        }
      }

      res.status(201).json(newRecords);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/attendance/grid/:classId/:from/:to", requireAuth, async (req, res, next) => {
    try {
      const classParam = req.params.classId;
      const showAllClasses = classParam === "all";
      const classId = showAllClasses ? null : parseInt(classParam);
      const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
      let from = req.params.from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      let to = req.params.to || new Date().toISOString().split('T')[0];
      if (!isValidDate(from)) from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      if (!isValidDate(to)) to = new Date().toISOString().split('T')[0];

      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      const classesForScope = schoolId ? await storage.getClassesBySchool(schoolId) : await storage.getAllClasses();
      const classesById = new Map(classesForScope.map((classItem) => [classItem.id, classItem]));
      const targetClasses = showAllClasses
        ? classesForScope
        : classId && classesById.has(classId)
          ? [classesById.get(classId)!]
          : [];

      const studentGroups = await Promise.all(targetClasses.map((classItem) => storage.getStudentsByClass(classItem.id)));
      const recordGroups = await Promise.all(targetClasses.map((classItem) => storage.getAttendanceByClassRange(classItem.id, from, to)));
      const students = studentGroups.flat();
      const records = recordGroups.flat();

      const dates: string[] = [];
      const d = new Date(from);
      const end = new Date(to);
      while (d <= end) {
        const day = d.getDay();
        if (day !== 0 && day !== 6) {
          dates.push(d.toISOString().split('T')[0]);
        }
        d.setDate(d.getDate() + 1);
      }

      const statusIndex: Record<number, Record<string, string>> = {};
      const recordIndex: Record<number, Record<string, any>> = {};
      for (const r of records) {
        if (!statusIndex[r.studentId]) statusIndex[r.studentId] = {};
        if (!recordIndex[r.studentId]) recordIndex[r.studentId] = {};
        statusIndex[r.studentId][r.date] = r.status;
        recordIndex[r.studentId][r.date] = r;
      }

      let presentCount = 0;
      let absentCount = 0;
      for (const r of records) {
        if (r.date === new Date().toISOString().split('T')[0]) {
          if (r.status === 'present') presentCount++;
          else absentCount++;
        }
      }

      res.json({
        dates,
        students: students
          .map(s => {
            const classInfo = classesById.get(Number(s.classId));
            return {
              id: s.id,
              firstName: s.firstName,
              lastName: s.lastName,
              name: `${s.firstName} ${s.lastName}`.trim(),
              admissionNo: s.admissionNo,
              classId: s.classId,
              className: classInfo?.shortCode || classInfo?.className || '',
              statuses: statusIndex[s.id] || {},
              records: recordIndex[s.id] || {},
            };
          })
          .sort(compareStudentsByFirstName),
        present: presentCount,
        absent: absentCount,
        total: students.length,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/attendance/export/:classId/:from/:to", requireAuth, async (req, res, next) => {
    try {
      const classId = parseInt(req.params.classId);
      const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
      let from = req.params.from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      let to = req.params.to || new Date().toISOString().split('T')[0];
      if (!isValidDate(from)) from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      if (!isValidDate(to)) to = new Date().toISOString().split('T')[0];
      const records = await storage.getAttendanceByClassRange(classId, from, to);
      const students = await storage.getStudentsByClass(classId);
      const classInfo = await storage.getClass(classId);

      const dates: string[] = [];
      const d = new Date(from);
      const end = new Date(to);
      while (d <= end) {
        const day = d.getDay();
        if (day !== 0 && day !== 6) {
          dates.push(d.toISOString().split('T')[0]);
        }
        d.setDate(d.getDate() + 1);
      }

      const index: Record<number, Record<string, string>> = {};
      for (const r of records) {
        if (!index[r.studentId]) index[r.studentId] = {};
        index[r.studentId][r.date] = r.status;
      }

      let csv = `"STUDENT",${dates.map(d => `"${d}"`).join(',')}\n`;
      for (const s of students) {
        const name = `${s.firstName} ${s.lastName}`.toUpperCase();
        const row = dates.map(dt => (index[s.id]?.[dt] || '').toUpperCase());
        csv += `"${name}",${row.map(v => `"${v}"`).join(',')}\n`;
      }

      res.setHeader('Content-Type', 'text/csv');
      const attClassName = (classInfo?.className || `Class_${classId}`).replace(/\s+/g, "_");
      res.setHeader('Content-Disposition', `attachment; filename="Attendance_${attClassName}_${from}_to_${to}.csv"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/attendance/:id", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const updated = await storage.updateAttendance(parseInt(req.params.id), req.body);
      if (!updated) {
        return res.status(404).json({ message: "Attendance record not found" });
      }
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/discipline", requireAuth, async (req, res, next) => {
    try {
      const studentId = req.query.studentId ? parseInt(req.query.studentId as string) : undefined;
      const records = await storage.getDisciplineRecords(studentId);
      res.json(records);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/discipline", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const data = insertDisciplineRecordSchema.parse(req.body);
      const newRecord = await storage.createDisciplineRecord(data);
      res.status(201).json(newRecord);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/clinic", requireAuth, async (req, res, next) => {
    try {
      const studentId = req.query.studentId ? parseInt(req.query.studentId as string) : undefined;
      const records = await storage.getClinicRecords(studentId);
      res.json(records);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/clinic", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const data = insertClinicRecordSchema.parse(req.body);
      const newRecord = await storage.createClinicRecord(data);
      res.status(201).json(newRecord);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/clinic/:id", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateClinicRecord(id, req.body);
      if (!updated) return res.status(404).json({ message: "Record not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/clinic/:id", requireAuth, requireRole("school_admin"), async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteClinicRecord(id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/clinic/import", requireAuth, requireRole("school_admin", "teacher"), requirePermission("clinic.import"), async (req, res, next) => {
    try {
      const { records } = req.body;
      if (!Array.isArray(records)) return res.status(400).json({ message: "Records must be an array" });
      const created = [];
      for (const rec of records) {
        const data = insertClinicRecordSchema.parse(rec);
        const newRecord = await storage.createClinicRecord(data);
        created.push(newRecord);
      }
      res.status(201).json({ imported: created.length, records: created });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/fees", requireAuth, async (req, res, next) => {
    try {
      const studentId = req.query.studentId ? parseInt(req.query.studentId as string) : undefined;
      const payments = await storage.getFeesPayments(studentId);
      res.json(payments);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/fees", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const data = insertFeesPaymentSchema.parse(req.body);
      const newPayment = await storage.createFeesPayment(data);
      res.status(201).json(newPayment);
    } catch (error) {
      next(error);
    }
  });

  // Centralized fee status calculation (matches PHP logic)
  function computeFeesStatusKey(balanceDue: number, maxBalance: number): string {
    if (balanceDue <= 0.01) return "fully_paid";
    if (maxBalance > 0 && balanceDue <= maxBalance + 0.01) return "up_to_date";
    return "in_arrears";
  }

  // Student Fees Management - CSV Import
  const feesUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  app.post("/api/fees/import-csv", requireAuth, requireRole("school_admin", "org_admin"), requirePermission("fees.import"), feesUpload.single("fees_csv"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "No school context" });

      const termTotalFee = parseFloat(req.body.term_total_fee || "0");
      const termMaxBalance = parseFloat(req.body.term_max_balance || "0");

      if (!req.file) return res.status(400).json({ message: "No CSV file uploaded" });

      const csvContent = req.file.buffer.toString("utf-8");
      let records: string[][];
      try {
        records = csvParse(csvContent, { relax_column_count: true, skip_empty_lines: true, trim: true });
      } catch {
        return res.status(400).json({ message: "Invalid CSV format. Please ensure it is a valid comma-delimited file." });
      }

      if (records.length < 2) return res.status(400).json({ message: "CSV file is empty or has no data rows" });

      const header = records[0].map(h => h.toLowerCase().trim());

      const colMap: Record<string, number | null> = { customer: null, name: null, group: null, area: null, balance: null };

      header.forEach((col, index) => {
        if (["customer", "customer id", "customer code"].includes(col)) colMap.customer = index;
        else if (["name", "student", "student name"].includes(col)) colMap.name = index;
        else if (["group", "form", "stream"].includes(col)) colMap.group = index;
        else if (["area", "class", "class name"].includes(col)) colMap.area = index;
        else if (["balance", "balance due", "fees balance"].includes(col)) colMap.balance = index;
      });

      if (colMap.name === null || colMap.balance === null) {
        return res.status(400).json({ message: 'CSV must contain at least "Name" and "Balance" / "Balance due" columns.' });
      }

      const allStudents = await storage.getStudentsBySchool(schoolId);
      let updated = 0;
      let notFound = 0;

      for (let i = 1; i < records.length; i++) {
        const row = records[i];
        const name = colMap.name !== null && row[colMap.name] ? row[colMap.name].trim() : "";
        if (!name) continue;

        let balanceRaw = colMap.balance !== null && row[colMap.balance] ? row[colMap.balance].trim() : "0";
        balanceRaw = balanceRaw.replace(/[, ]/g, "");
        const balanceDue = parseFloat(balanceRaw) || 0;

        const customer = colMap.customer !== null && row[colMap.customer] ? row[colMap.customer].trim() : "";

        let matchedStudent = null;

        if (customer) {
          matchedStudent = allStudents.find(s => s.feesCustomerId === customer);
        }

        if (!matchedStudent) {
          const nameLower = name.toLowerCase();
          matchedStudent = allStudents.find(s => {
            const fullName = `${s.firstName} ${s.lastName}`.toLowerCase();
            return fullName === nameLower;
          });
        }

        if (!matchedStudent) {
          const nameLower = name.toLowerCase();
          matchedStudent = allStudents.find(s => {
            const fullName = `${s.firstName} ${s.lastName}`.toLowerCase();
            return fullName.includes(nameLower) || nameLower.includes(fullName);
          });
        }

        if (!matchedStudent) {
          notFound++;
          continue;
        }

        const paid = Math.max(0, termTotalFee - balanceDue);
        const statusKey = computeFeesStatusKey(balanceDue, termMaxBalance);

        const updateData: Record<string, any> = {
          feesTotalTerm: termTotalFee.toFixed(2),
          feesPaidSoFar: paid.toFixed(2),
          feesBalance: balanceDue.toFixed(2),
          feesMaxBalance: termMaxBalance.toFixed(2),
          feesStatus: statusKey,
        };
        if (customer) updateData.feesCustomerId = customer;

        await db.update(studentsTable).set(updateData).where(eq(studentsTable.id, matchedStudent.id));
        updated++;
      }

      res.json({ success: true, updated, not_found: notFound });
    } catch (error) {
      next(error);
    }
  });

  // Student Fees Management - Send fee reminders (SMS + Email)
  app.post("/api/fees/notify", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "No school context" });
      const userId = (req.user as any)?.id;

      const { studentIds } = req.body;
      if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ message: "No students selected." });
      }

      const school = await storage.getSchool(schoolId);
      const schoolName = school?.name || "FCGS";
      const selectedStudentIds = studentIds.map((sid: any) => parseInt(sid)).filter((sid: number) => Number.isFinite(sid));

      const job = await queueCommunicationBackgroundJob({
        schoolId,
        requestedBy: userId || null,
        jobType: "fees_reminder",
        title: `Send fees reminders to ${selectedStudentIds.length} student${selectedStudentIds.length === 1 ? "" : "s"}`,
        totalCount: selectedStudentIds.length,
        metadata: { studentCount: selectedStudentIds.length },
      }, async (jobId) => {
        let sent = 0;
        let missing = 0;
        let processed = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const sid of selectedStudentIds) {
          processed++;
          try {
            const student = await storage.getStudent(sid);
            if (!student || student.schoolId !== schoolId) { missing++; continue; }

            const name = `${student.firstName} ${student.lastName}`;
            const total = parseFloat(student.feesTotalTerm || "0");
            const paid = parseFloat(student.feesPaidSoFar || "0");
            const balance = parseFloat(student.feesBalance || "0");
            const maxBalance = parseFloat(student.feesMaxBalance || "0");

            const statusKey = computeFeesStatusKey(balance, maxBalance);
            const statusTxt = statusKey === "fully_paid" ? "fully paid" : statusKey === "up_to_date" ? "up to date" : "in arrears";

            let classLabel = "N/A";
            if (student.classId) {
              const cls = await storage.getClass(student.classId);
              if (cls) classLabel = cls.className;
            }

            let parentPhone = "";
            let parentEmail = "";
            let parentName = "";
            if (student.parentId) {
              const parent = await storage.getParent(student.parentId);
              if (parent) {
                parentPhone = parent.phone || "";
                parentEmail = parent.email || "";
                parentName = `${parent.firstName} ${parent.lastName}`;
              }
            }

            if (!parentPhone && !parentEmail) {
              missing++;
              continue;
            }

            const summaryLine = `Total: $${total.toFixed(2)} | Paid: $${paid.toFixed(2)} | Balance: $${balance.toFixed(2)} | Status: ${statusTxt}${maxBalance > 0 ? ` (max allowed balance: $${maxBalance.toFixed(2)})` : ""}`;
            const smsMessage = `${schoolName} Fees Reminder: ${name} (${classLabel}). ${summaryLine}. Please clear any arrears as soon as possible. Thank you.`;
            let anySent = false;

            if (parentPhone) {
              const smsResult = await communicationService.sendSms({
                to: parentPhone,
                message: smsMessage,
                schoolId,
                recipientType: "parent",
                recipientId: student.parentId || undefined,
                recipientName: parentName,
                category: "fees_reminder",
                sentBy: userId,
              });
              if (smsResult.success) anySent = true;
              else if (smsResult.error) errors.push(`SMS for ${name}: ${smsResult.error}`);
            }

            if (parentEmail) {
              const emailBody = `Dear Parent/Guardian

This is a friendly reminder of the current fee position for your child:

Student: ${name}
Class: ${classLabel}
${summaryLine}

If you have recently made payment, please ignore this message.

Thank you,
${schoolName}`;
              const emailResult = await communicationService.sendEmail({
                to: parentEmail,
                subject: `${schoolName} Fees Reminder - ${name}`,
                text: emailBody,
                html: emailBody.replace(/\n/g, "<br>"),
                schoolId,
                recipientType: "parent",
                recipientId: student.parentId || undefined,
                recipientName: parentName,
                category: "fees_reminder",
                sentBy: userId,
              });
              if (emailResult.success) anySent = true;
              else if (emailResult.error) errors.push(`Email for ${name}: ${emailResult.error}`);
            }

            if (anySent) sent++; else failed++;
          } catch (studentErr) {
            failed++;
            errors.push(`Student ${sid}: ${studentErr instanceof Error ? studentErr.message : 'unknown error'}`);
          } finally {
            if (processed % 10 === 0 || processed === selectedStudentIds.length) {
              await updateCommunicationJobProgress(jobId, { processedCount: processed, successCount: sent, failedCount: failed, skippedCount: missing });
            }
          }
        }

        return {
          processedCount: processed,
          successCount: sent,
          failedCount: failed,
          skippedCount: missing,
          errorSummary: errors.length ? errors.slice(0, 20).join("; ") : null,
          metadata: { sent, missing, failed, errors: errors.slice(0, 10) },
        };
      });

      logActivity(req, {
        action: "create",
        category: "fees",
        description: `Queued fees reminders for ${selectedStudentIds.length} student${selectedStudentIds.length === 1 ? "" : "s"}`,
        targetType: "communication_job",
        targetId: job.id,
        schoolId,
        metadata: { jobType: "fees_reminder", studentCount: selectedStudentIds.length },
      });

      res.status(202).json({ success: true, queued: true, jobId: job.id, sent: 0, missing: 0, message: `Fees reminders queued for ${selectedStudentIds.length} student${selectedStudentIds.length === 1 ? "" : "s"}. Sending will continue in the background.` });
    } catch (error) {
      next(error);
    }
  });


  // Student Fees Management - Get students present but in arrears (for attendance register popup)
  // Matches PHP fcgs_att_fees_arrears_list: cross-references attendance records with fee balances
  app.post("/api/fees/arrears-for-class", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "No school context" });

      const { classId, date } = req.body;
      if (!classId) return res.status(400).json({ message: "No class specified." });

      const attDate = date || new Date().toISOString().split("T")[0];

      const classInfo = await storage.getClass(parseInt(classId));
      if (!classInfo || classInfo.schoolId !== schoolId) {
        return res.status(403).json({ message: "Class not found in this school." });
      }
      const className = classInfo.className || `Class #${classId}`;

      const classStudents = (await storage.getStudentsByClass(parseInt(classId))).filter(s => s.schoolId === schoolId);
      const attendanceRecords = await storage.getAttendanceByClass(parseInt(classId), attDate);

      const attendanceMap = new Map<number, string>();
      for (const rec of attendanceRecords) {
        if (!attendanceMap.has(rec.studentId)) {
          attendanceMap.set(rec.studentId, rec.status);
        }
      }

      let presentCount = 0;
      let arrearsPresentCount = 0;
      const arrearsStudents: any[] = [];

      for (const student of classStudents) {
        const attStatus = attendanceMap.get(student.id);
        if (attStatus !== "present") continue;

        presentCount++;

        const balance = parseFloat(student.feesBalance || "0");
        const maxBalance = parseFloat(student.feesMaxBalance || "0");
        const statusKey = computeFeesStatusKey(balance, maxBalance);

        if (statusKey === "in_arrears") {
          arrearsPresentCount++;
          const statusLabel = statusKey === "in_arrears" ? "In arrears" : statusKey === "up_to_date" ? "Up to date" : "Fully paid";
          arrearsStudents.push({
            id: student.id,
            name: `${student.firstName} ${student.lastName}`.toUpperCase(),
            balance: Math.round(balance * 100) / 100,
            status: statusLabel,
          });
        }
      }

      const allPresentPaid = presentCount > 0 && arrearsPresentCount === 0;

      res.json({
        success: true,
        data: {
          students: arrearsStudents,
          att_date: attDate,
          class_name: className,
          present_count: presentCount,
          arrears_present_count: arrearsPresentCount,
          all_present_paid: allPresentPaid,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Student Fees Management - Get fees summary for all students
  app.get("/api/fees/summary", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "No school context" });

      const allStudents = await storage.getStudentsBySchool(schoolId);
      const classes = await storage.getClassesBySchool(schoolId);
      const classMap = new Map(classes.map(c => [c.id, c.className]));

      const results = await Promise.all(allStudents.map(async (student) => {
        let parentPhone = "";
        let parentEmail = "";
        if (student.parentId) {
          const parent = await storage.getParent(student.parentId);
          if (parent) {
            parentPhone = parent.phone || "";
            parentEmail = parent.email || "";
          }
        }

        return {
          id: student.id,
          name: `${student.firstName} ${student.lastName}`,
          admissionNo: student.admissionNo,
          classLabel: student.classId ? (classMap.get(student.classId) || "-") : "-",
          photo: student.photo || null,
          total: parseFloat(student.feesTotalTerm || "0"),
          paid: parseFloat(student.feesPaidSoFar || "0"),
          balance: parseFloat(student.feesBalance || "0"),
          maxBalance: parseFloat(student.feesMaxBalance || "0"),
          feesStatus: student.feesStatus || "n/a",
          hasParentContact: !!(parentPhone || parentEmail),
        };
      }));

      res.json(results);
    } catch (error) {
      next(error);
    }
  });

  // Organization routes
  app.get("/api/organizations", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const orgs = await storage.getAllOrganizations();
      res.json(orgs);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/organizations/:id", requireAuth, async (req, res, next) => {
    try {
      const org = await storage.getOrganization(parseInt(req.params.id));
      if (!org) return res.status(404).json({ message: "Organization not found" });
      res.json(org);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/organizations", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const data = insertOrganizationSchema.parse(req.body);
      const newOrg = await storage.createOrganization(data);
      res.status(201).json(newOrg);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/organizations/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const data = { ...req.body };
      if (data.photoUploadLimitMB !== undefined) {
        const allowed = [2, 5, 10, 15, 20];
        if (!allowed.includes(data.photoUploadLimitMB)) {
          return res.status(400).json({ message: `Photo upload limit must be one of: ${allowed.join(", ")} MB` });
        }
      }
      const updated = await storage.updateOrganization(parseInt(req.params.id), data);
      if (!updated) return res.status(404).json({ message: "Organization not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  // School routes
  app.get("/api/residential-areas", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) {
        return res.status(400).json({ message: "No school context" });
      }
      const areas = await db.execute(sql`
        SELECT DISTINCT residential_area FROM (
          SELECT residential_area FROM staff WHERE school_id = ${schoolId} AND residential_area IS NOT NULL AND residential_area != ''
          UNION
          SELECT residential_area FROM students WHERE school_id = ${schoolId} AND residential_area IS NOT NULL AND residential_area != ''
          UNION
          SELECT residential_area FROM parents WHERE school_id = ${schoolId} AND residential_area IS NOT NULL AND residential_area != ''
        ) AS combined ORDER BY residential_area
      `);
      res.json(areas.rows.map((r: any) => r.residential_area));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/schools/current", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) {
        return res.status(400).json({ message: "No school context" });
      }
      const school = await storage.getSchool(schoolId);
      if (!school) {
        return res.status(404).json({ message: "School not found" });
      }
      res.json(school);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/schools", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const schoolsList = await storage.getAllSchools();
      // If in school context, only return that school
      // If not (org_admin at HQ level), return all schools in their org
      if (schoolId) {
        const school = schoolsList.find(s => s.id === schoolId);
        res.json(school ? [school] : []);
      } else {
        const currentUser = req.user as User;
        const filtered = currentUser.organizationId 
          ? schoolsList.filter(s => s.organizationId === currentUser.organizationId)
          : schoolsList;
        res.json(filtered);
      }
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/schools/:id", requireAuth, async (req, res, next) => {
    try {
      const school = await storage.getSchool(parseInt(req.params.id));
      if (!school) return res.status(404).json({ message: "School not found" });
      res.json(school);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/schools", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const existingOrgSchools = currentUser.organizationId
        ? await db.select({ id: schoolsTable.id }).from(schoolsTable).where(eq(schoolsTable.organizationId, currentUser.organizationId))
        : await db.select({ id: schoolsTable.id }).from(schoolsTable);
      const existingSchoolIds = existingOrgSchools.map(s => s.id);

      const data = insertSchoolSchema.parse({
        ...req.body,
        organizationId: currentUser.organizationId,
      });
      const newSchool = await storage.createSchool(data);

      const orgUsers = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "org_admin"), currentUser.organizationId ? eq(users.organizationId, currentUser.organizationId) : sql`1=1`));
      for (const orgUser of orgUsers) {
        const accessIds = await storage.getUserSchoolAccess(orgUser.id);
        const hasAllCurrentSchools = existingSchoolIds.length === 0
          ? accessIds.length === 0
          : existingSchoolIds.every(id => accessIds.includes(id));
        if (hasAllCurrentSchools) {
          await db.insert(userSchoolAccess).values({ userId: orgUser.id, schoolId: newSchool.id }).onConflictDoNothing();
        }
      }

      logActivity(req, { action: "create", category: "schools", description: `Created school: ${newSchool.name}`, targetType: "school", targetId: newSchool.id, targetName: newSchool.name, schoolId: newSchool.id });
      res.status(201).json(newSchool);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/schools/:id", requireAuth, requireRole("org_admin", "school_admin"), async (req, res, next) => {
    try {
      const updated = await storage.updateSchool(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "School not found" });
      logActivity(req, { action: "update", category: "schools", description: `Updated school settings: ${updated.name}`, targetType: "school", targetId: updated.id, targetName: updated.name });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/schools/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const schoolId = parseInt(req.params.id);
      const currentUser = req.user as User;
      const school = await storage.getSchool(schoolId);
      if (!school) return res.status(404).json({ message: "School not found" });

      if (school.terminationStatus === "pending") {
        return res.status(400).json({ message: "School is already pending termination" });
      }

      const updated = await storage.scheduleSchoolTermination(schoolId, currentUser.id);
      logActivity(req, { action: "schedule_termination", category: "schools", description: `Scheduled school for termination: ${school.name}`, targetType: "school", targetId: school.id, targetName: school.name });

      const orgUsers = await db.select().from(users).where(
        and(
          eq(users.organizationId, school.organizationId!),
          eq(users.role, "org_admin"),
          eq(users.isActive, true)
        )
      );

      const initiatorName = currentUser.firstName && currentUser.lastName
        ? `${currentUser.firstName} ${currentUser.lastName}`
        : currentUser.username;

      for (const orgUser of orgUsers) {
        await storage.createNotification({
          organizationId: school.organizationId,
          schoolId: school.id,
          userId: orgUser.id,
          type: "school_termination",
          title: "School Archival Initiated",
          message: `${initiatorName} has scheduled "${school.name}" for archival. The school will be archived in 72 hours unless restored. Users can still log in (read-only) until 1 hour before archival.`,
          severity: "warning",
          actorUserId: currentUser.id,
        });

        if (orgUser.email) {
          try {
            await communicationService.sendEmail({
              to: orgUser.email,
              subject: `School Archival Initiated: ${school.name}`,
              html: `<h2>School Archival Notice</h2>
<p><strong>${initiatorName}</strong> has scheduled <strong>${school.name}</strong> for archival.</p>
<p>The school will be archived in <strong>72 hours</strong>. Users can still log in (read-only) until 1 hour before archival.</p>
<p>To cancel this action, log in to the system and use the <strong>Restore</strong> button on the school card.</p>
<p>After archival, school data will be preserved and accessible to HQ members only via the Archives panel.</p>`,
              schoolId: school.id,
              recipientType: "org_admin",
              recipientId: orgUser.id,
              sentBy: currentUser.id,
              category: "notices",
              recipientName: orgUser.username || "Org HQ User",
            });
          } catch (emailErr) {
            console.error("Failed to send termination email:", emailErr);
          }
        }
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/schools/:id/restore", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const schoolId = parseInt(req.params.id);
      const currentUser = req.user as User;
      const school = await storage.getSchool(schoolId);
      if (!school) return res.status(404).json({ message: "School not found" });
      if (school.terminationStatus !== "pending") {
        return res.status(400).json({ message: "School is not pending termination" });
      }

      const restored = await storage.restoreSchool(schoolId);
      logActivity(req, { action: "restore", category: "schools", description: `Restored school from termination: ${school.name}`, targetType: "school", targetId: school.id, targetName: school.name });

      const orgUsers = await db.select().from(users).where(
        and(
          eq(users.organizationId, school.organizationId!),
          eq(users.role, "org_admin"),
          eq(users.isActive, true)
        )
      );

      const initiatorName = currentUser.firstName && currentUser.lastName
        ? `${currentUser.firstName} ${currentUser.lastName}`
        : currentUser.username;

      for (const orgUser of orgUsers) {
        await storage.createNotification({
          organizationId: school.organizationId,
          schoolId: school.id,
          userId: orgUser.id,
          type: "school_restored",
          title: "School Restored",
          message: `${initiatorName} has cancelled the scheduled deletion of "${school.name}". The school is now active again.`,
          severity: "info",
          actorUserId: currentUser.id,
        });
      }

      res.json(restored);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/archived-schools", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const archivedSchools = await storage.getArchivedSchools(currentUser.organizationId ?? undefined);
      res.json(archivedSchools);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/schools/:id/unarchive", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const schoolId = parseInt(req.params.id);
      const school = await storage.getSchool(schoolId);
      if (!school) return res.status(404).json({ message: "School not found" });
      if (school.terminationStatus !== "archived") {
        return res.status(400).json({ message: "School is not archived" });
      }
      const restored = await storage.restoreSchool(schoolId);
      logActivity(req, { action: "restore", category: "schools", description: `Restored archived school: ${school.name}`, targetType: "school", targetId: school.id, targetName: school.name });
      res.json(restored);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/schools/:id/termination-status", requireAuth, async (req, res, next) => {
    try {
      const schoolId = parseInt(req.params.id);
      const school = await storage.getSchool(schoolId);
      if (!school) return res.status(404).json({ message: "School not found" });
      res.json({
        terminationStatus: school.terminationStatus,
        terminationAt: school.terminationAt,
        terminationRequestedAt: school.terminationRequestedAt,
        archivedAt: school.archivedAt,
      });
    } catch (error) {
      next(error);
    }
  });

  // Notifications routes
  app.get("/api/notifications", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const notifs = await storage.getNotifications(currentUser.id, currentUser.organizationId ?? undefined);
      res.json(notifs);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const count = await storage.getUnreadNotificationCount(currentUser.id, currentUser.organizationId ?? undefined);
      res.json({ count });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notifications/:id/read", requireAuth, async (req, res, next) => {
    try {
      const updated = await storage.markNotificationRead(parseInt(req.params.id));
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notifications/read-all", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      await storage.markAllNotificationsRead(currentUser.id);
      res.json({ message: "All notifications marked as read" });
    } catch (error) {
      next(error);
    }
  });

  // Activity Logs routes
  app.get("/api/activity-logs", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req) || (req.query.schoolId ? parseInt(req.query.schoolId as string) : undefined);
      const currentUser = req.user as User;
      const filters: any = {};
      if (schoolId) filters.schoolId = schoolId;
      if (currentUser.organizationId) filters.organizationId = currentUser.organizationId;
      if (req.query.category) filters.category = req.query.category as string;
      if (req.query.action) filters.action = req.query.action as string;
      if (req.query.userId) filters.userId = parseInt(req.query.userId as string);
      if (req.query.fromDate) filters.fromDate = req.query.fromDate as string;
      if (req.query.toDate) filters.toDate = req.query.toDate as string;
      if (req.query.limit) filters.limit = parseInt(req.query.limit as string);
      if (req.query.offset) filters.offset = parseInt(req.query.offset as string);
      const result = await storage.getActivityLogs(filters);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/activity-logs/export", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req) || (req.query.schoolId ? parseInt(req.query.schoolId as string) : undefined);
      const currentUser = req.user as User;
      const filters: any = { limit: 10000 };
      if (schoolId) filters.schoolId = schoolId;
      if (currentUser.organizationId) filters.organizationId = currentUser.organizationId;
      if (req.query.category) filters.category = req.query.category as string;
      if (req.query.action) filters.action = req.query.action as string;
      if (req.query.fromDate) filters.fromDate = req.query.fromDate as string;
      if (req.query.toDate) filters.toDate = req.query.toDate as string;
      const { logs } = await storage.getActivityLogs(filters);
      const format = (req.query.format as string) || "txt";
      const dateStr = new Date().toISOString().split("T")[0];

      if (format === "csv") {
        let csv = `Date/Time,Category,Action,User,Role,Description,Target Type,Target Name,IP Address\r\n`;
        for (const log of logs) {
          const ts = log.createdAt ? new Date(log.createdAt).toLocaleString("en-US", { timeZone: "Africa/Harare", hour12: true }) : "N/A";
          const escape = (v: string | null | undefined) => {
            if (!v) return "";
            return `"${v.replace(/"/g, '""')}"`;
          };
          csv += `${escape(ts)},${escape(log.category)},${escape(log.action)},${escape(log.userName || "System")},${escape(log.userRole || "system")},${escape(log.description)},${escape(log.targetType)},${escape(log.targetName || (log.targetId ? String(log.targetId) : ""))},${escape(log.ipAddress)}\r\n`;
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        const catLabel = req.query.category ? `_${(req.query.category as string).replace(/\s+/g, "_")}` : "";
        const actionLabel = req.query.action ? `_${(req.query.action as string).replace(/\s+/g, "_")}` : "";
        const fromLabel = req.query.fromDate ? `_from_${req.query.fromDate}` : "";
        const toLabel = req.query.toDate ? `_to_${req.query.toDate}` : "";
        res.setHeader("Content-Disposition", `attachment; filename="Activity_Logs${catLabel}${actionLabel}${fromLabel}${toLabel}_${dateStr}.csv"`);
        res.send(csv);
      } else {
        const lines = [
          "FCGS Activity Logs Export",
          `Generated: ${new Date().toLocaleString("en-US", { timeZone: "Africa/Harare", hour12: true })} (CAT)`,
          `Total Records: ${logs.length}`,
          "=".repeat(80),
          "",
        ];
        for (const log of logs) {
          const ts = log.createdAt ? new Date(log.createdAt).toLocaleString("en-US", { timeZone: "Africa/Harare", hour12: true }) : "N/A";
          lines.push(`[${ts}] ${log.category?.toUpperCase()} | ${log.action}`);
          lines.push(`  User: ${log.userName || "System"} (${log.userRole || "system"})`);
          lines.push(`  Description: ${log.description}`);
          if (log.targetType) lines.push(`  Target: ${log.targetType} - ${log.targetName || log.targetId}`);
          if (log.ipAddress) lines.push(`  IP: ${log.ipAddress}`);
          lines.push("-".repeat(80));
        }
        const catLabel = req.query.category ? `_${(req.query.category as string).replace(/\s+/g, "_")}` : "";
        const actionLabel = req.query.action ? `_${(req.query.action as string).replace(/\s+/g, "_")}` : "";
        const fromLabel = req.query.fromDate ? `_from_${req.query.fromDate}` : "";
        const toLabel = req.query.toDate ? `_to_${req.query.toDate}` : "";
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="Activity_Logs${catLabel}${actionLabel}${fromLabel}${toLabel}_${dateStr}.txt"`);
        res.send(lines.join("\n"));
      }
    } catch (error) {
      next(error);
    }
  });


  // E-Library routes (digital resources)
  const libraryLoanCreateSchema = insertLibraryLoanSchema.partial({ dueDate: true }).extend({
    bookId: z.number(),
    borrowerType: z.enum(["student", "staff"]),
    borrowerId: z.number(),
    copyId: z.number().optional().nullable(),
    dueDate: z.string().optional(),
    notes: z.string().optional().nullable(),
    conditionOnBorrow: z.string().optional().nullable(),
  });

  const libraryFineUpdateSchema = z.object({
    status: z.enum(["unpaid", "paid", "waived"]).optional(),
    amount: z.string().optional(),
    reason: z.string().optional().nullable(),
  });

  const libraryReservationUpdateSchema = z.object({
    status: z.enum(["pending", "ready", "fulfilled", "cancelled", "expired"]).optional(),
    notifiedAt: z.union([z.string(), z.date()]).optional().nullable(),
    expiresAt: z.union([z.string(), z.date()]).optional().nullable(),
  });

  function parseIdParam(value: string): number {
    return parseInt(value, 10);
  }

  function getRequiredLibrarySchoolId(req: Request, res: Response): number | null {
    const schoolId = getSchoolContext(req);
    if (!schoolId) {
      res.status(400).json({ message: "School context required" });
      return null;
    }
    return schoolId;
  }

  async function resolveCurrentStaffRecord(userId: number) {
    const [staffRecord] = await db.select().from(staff).where(eq(staff.userId, userId)).limit(1);
    return staffRecord;
  }

  async function getScopedLibraryResource(resourceId: number, schoolId: number) {
    const resource = await storage.getLibraryResource(resourceId);
    if (!resource || resource.schoolId !== schoolId) return null;
    return resource;
  }

  async function getScopedLibraryCategory(categoryId: number, schoolId: number) {
    const categories = await storage.getLibraryCategories(schoolId);
    return categories.find((category) => category.id === categoryId) ?? null;
  }

  async function getScopedLibraryShelf(shelfId: number, schoolId: number) {
    const shelves = await storage.getLibraryShelves(schoolId);
    return shelves.find((shelf) => shelf.id === shelfId) ?? null;
  }

  async function getScopedLibraryBook(bookId: number, schoolId: number) {
    const book = await storage.getLibraryBook(bookId);
    if (!book || book.schoolId !== schoolId) return null;
    return book;
  }

  async function getScopedLibraryCopy(copyId: number, schoolId: number) {
    const copy = await storage.getLibraryBookCopy(copyId);
    if (!copy || copy.schoolId !== schoolId) return null;
    return copy;
  }

  async function recalculateLibraryBookCounters(bookId: number) {
    const copies = await db.select().from(libraryBookCopiesTable).where(eq(libraryBookCopiesTable.bookId, bookId));
    const activeCopies = copies.filter((copy) => copy.status !== "lost");
    const availableCopies = activeCopies.filter((copy) => copy.status === "available").length;
    const damagedCopies = activeCopies.filter((copy) => copy.status === "damaged").length;
    const lostStolenCopies = copies.filter((copy) => copy.status === "lost").length;

    await db.update(libraryBooksTable).set({
      totalCopies: activeCopies.length,
      availableCopies,
      damagedCopies,
      lostStolenCopies,
    }).where(eq(libraryBooksTable.id, bookId));
  }

  async function getScopedLibraryLoan(loanId: number, schoolId: number) {
    const loan = await storage.getLibraryLoan(loanId);
    if (!loan || loan.schoolId !== schoolId) return null;
    return loan;
  }

  async function getScopedLibraryFine(fineId: number, schoolId: number) {
    const fines = await storage.getLibraryFines(schoolId);
    return fines.find((fine) => fine.id === fineId) ?? null;
  }

  async function getScopedLibraryReservation(reservationId: number, schoolId: number) {
    const reservations = await storage.getLibraryReservations(schoolId);
    return reservations.find((reservation) => reservation.id === reservationId) ?? null;
  }

  async function expireLibraryReservations(bookId: number, schoolId: number) {
    await db
      .update(libraryReservationsTable)
      .set({ status: "expired" as any })
      .where(
        and(
          eq(libraryReservationsTable.schoolId, schoolId),
          eq(libraryReservationsTable.bookId, bookId),
          eq(libraryReservationsTable.status, "pending" as any),
          sql`${libraryReservationsTable.expiresAt} IS NOT NULL`,
          sql`${libraryReservationsTable.expiresAt} < NOW()`
        )
      );
  }

  async function moveNextReservationToReady(bookId: number, schoolId: number) {
    await expireLibraryReservations(bookId, schoolId);
    const pendingReservations = await storage.getLibraryReservationsForBook(bookId, "pending");
    const nextReservation = pendingReservations.find((reservation) => reservation.schoolId === schoolId);
    if (!nextReservation) return null;

    const readyUntil = new Date();
    readyUntil.setDate(readyUntil.getDate() + 3);

    const [updated] = await db
      .update(libraryReservationsTable)
      .set({
        status: "ready" as any,
        notifiedAt: new Date(),
        expiresAt: readyUntil,
      })
      .where(eq(libraryReservationsTable.id, nextReservation.id))
      .returning();

    return updated;
  }

  async function getBorrowerForLibraryLoan(schoolId: number, borrowerType: "student" | "staff", borrowerId: number) {
    if (borrowerType === "student") {
      const borrower = await storage.getStudent(borrowerId);
      if (!borrower || borrower.schoolId !== schoolId) return null;
      return {
        borrowerName: `${borrower.firstName} ${borrower.lastName}`.trim(),
        schoolId: borrower.schoolId,
      };
    }

    const borrower = await storage.getStaff(borrowerId);
    if (!borrower || borrower.schoolId !== schoolId) return null;
    return {
      borrowerName: `${borrower.firstName} ${borrower.lastName}`.trim(),
      schoolId: borrower.schoolId,
    };
  }

  async function enforceLibraryLoanPolicy(schoolId: number, borrowerType: "student" | "staff", borrowerId: number) {
    const policy = await storage.getLibraryPolicy(schoolId);
    const maxAllowed = borrowerType === "student"
      ? (policy?.maxBooksStudent ?? 1)
      : (policy?.maxBooksTeacher ?? 500);
    const activeLoans = await storage.getLibraryLoans(schoolId);
    const activeCount = activeLoans.filter((loan) =>
      loan.borrowerType === borrowerType &&
      loan.borrowerId === borrowerId &&
      ["active", "overdue"].includes(String(loan.status))
    ).length;

    if (activeCount >= maxAllowed) {
      return { ok: false, message: `Borrower has already reached the maximum of ${maxAllowed} active book(s).` };
    }

    return { ok: true, policy };
  }

  app.get("/api/library/resources", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const resources = await storage.getLibraryResources(schoolId);
      res.json(resources);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/library/resources/:id", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const resource = await getScopedLibraryResource(parseIdParam(req.params.id), schoolId);
      if (!resource) return res.status(404).json({ message: "Resource not found" });
      res.json(resource);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/library/resources", requireAuth, requirePermission("library.resources.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId || !req.user) return;
      const data = insertLibraryResourceSchema.parse(req.body);
      const staffRecord = await resolveCurrentStaffRecord(req.user.id);
      const newResource = await storage.createLibraryResource({
        ...data,
        schoolId,
        uploadedBy: staffRecord?.id,
      });
      res.status(201).json(newResource);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/library/resources/:id", requireAuth, requirePermission("library.resources.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const resourceId = parseIdParam(req.params.id);
      const resource = await getScopedLibraryResource(resourceId, schoolId);
      if (!resource) return res.status(404).json({ message: "Resource not found" });
      const updated = await storage.updateLibraryResource(resourceId, { ...req.body, schoolId });
      if (!updated) return res.status(404).json({ message: "Resource not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/library/resources/:id", requireAuth, requirePermission("library.catalogue.delete"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const resourceId = parseIdParam(req.params.id);
      const resource = await getScopedLibraryResource(resourceId, schoolId);
      if (!resource) return res.status(404).json({ message: "Resource not found" });
      await storage.deleteLibraryResource(resourceId);
      res.json({ message: "Resource deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Library - Categories
  app.get("/api/library/categories", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const categories = await storage.getLibraryCategories(schoolId);
      res.json(categories);
    } catch (error) { next(error); }
  });

  app.post("/api/library/categories", requireAuth, requirePermission("library.catalog.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const data = insertLibraryCategorySchema.parse(req.body);
      const category = await storage.createLibraryCategory({ ...data, schoolId });
      res.status(201).json(category);
    } catch (error) { next(error); }
  });

  app.put("/api/library/categories/:id", requireAuth, requirePermission("library.catalog.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const categoryId = parseIdParam(req.params.id);
      const category = await getScopedLibraryCategory(categoryId, schoolId);
      if (!category) return res.status(404).json({ message: "Category not found" });
      const updated = await storage.updateLibraryCategory(categoryId, { ...req.body, schoolId });
      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.delete("/api/library/categories/:id", requireAuth, requirePermission("library.catalogue.delete"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const categoryId = parseIdParam(req.params.id);
      const category = await getScopedLibraryCategory(categoryId, schoolId);
      if (!category) return res.status(404).json({ message: "Category not found" });
      await storage.deleteLibraryCategory(categoryId);
      res.json({ message: "Category deleted" });
    } catch (error) { next(error); }
  });

  // Library - Shelves
  app.get("/api/library/shelves", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const shelves = await storage.getLibraryShelves(schoolId);
      res.json(shelves);
    } catch (error) { next(error); }
  });

  app.post("/api/library/shelves", requireAuth, requirePermission("library.catalog.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const parsed = insertLibraryShelfSchema.parse({ ...req.body, schoolId });
      const existing = await storage.getLibraryShelves(schoolId);
      const duplicate = existing.find((shelf) => shelf.name.trim().toLowerCase() === parsed.name.trim().toLowerCase());
      if (duplicate) return res.status(400).json({ message: "A shelf with this name already exists." });
      const shelf = await storage.createLibraryShelf({ ...parsed, schoolId });
      res.status(201).json(shelf);
    } catch (error) { next(error); }
  });

  app.put("/api/library/shelves/:id", requireAuth, requirePermission("library.catalog.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const shelfId = parseIdParam(req.params.id);
      const shelf = await getScopedLibraryShelf(shelfId, schoolId);
      if (!shelf) return res.status(404).json({ message: "Shelf not found" });
      const nextName = String(req.body?.name || "").trim();
      if (!nextName) return res.status(400).json({ message: "Shelf name is required" });
      const existing = await storage.getLibraryShelves(schoolId);
      const duplicate = existing.find((item) => item.id !== shelfId && item.name.trim().toLowerCase() === nextName.toLowerCase());
      if (duplicate) return res.status(400).json({ message: "A shelf with this name already exists." });
      const updated = await db.transaction(async (tx) => {
        const [updatedShelf] = await tx.update(libraryShelvesTable).set({
          name: nextName,
          description: req.body?.description ?? null,
        }).where(and(eq(libraryShelvesTable.id, shelfId), eq(libraryShelvesTable.schoolId, schoolId))).returning();
        if (shelf.name !== nextName) {
          await tx.update(libraryBooksTable).set({ shelfLocation: nextName }).where(and(eq(libraryBooksTable.schoolId, schoolId), eq(libraryBooksTable.shelfLocation, shelf.name)));
        }
        return updatedShelf;
      });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.delete("/api/library/shelves/:id", requireAuth, requirePermission("library.catalog.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const shelfId = parseIdParam(req.params.id);
      const shelf = await getScopedLibraryShelf(shelfId, schoolId);
      if (!shelf) return res.status(404).json({ message: "Shelf not found" });
      const replacement = typeof req.query.replacement === "string" ? req.query.replacement.trim() : "N/A";
      await db.transaction(async (tx) => {
        await tx.update(libraryBooksTable).set({ shelfLocation: replacement || "N/A" }).where(and(eq(libraryBooksTable.schoolId, schoolId), eq(libraryBooksTable.shelfLocation, shelf.name)));
        await tx.delete(libraryShelvesTable).where(and(eq(libraryShelvesTable.id, shelfId), eq(libraryShelvesTable.schoolId, schoolId)));
      });
      res.json({ message: "Shelf deleted" });
    } catch (error) { next(error); }
  });

  // Library - Books
  app.get("/api/library/books", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const books = await storage.getLibraryBooks(schoolId);
      res.json(books);
    } catch (error) { next(error); }
  });

  app.get("/api/library/books/:id", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const book = await getScopedLibraryBook(parseIdParam(req.params.id), schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });
      res.json(book);
    } catch (error) { next(error); }
  });

  app.post("/api/library/books", requireAuth, requirePermission("library.catalog.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const data = insertLibraryBookSchema.parse(req.body);
      const existingBooks = await storage.getLibraryBooks(schoolId);
      const duplicate = existingBooks.find((existingBook) =>
        existingBook.title.toLowerCase().trim() === data.title.toLowerCase().trim() &&
        (existingBook.classId ?? null) === (data.classId ?? null) &&
        ((existingBook.isbn ?? "").trim()) === ((data.isbn ?? "").trim())
      );

      if (duplicate) {
        return res.status(400).json({ message: "A matching book already exists in this school catalog." });
      }

      const book = await storage.createLibraryBook({ ...data, schoolId });
      res.status(201).json(book);
    } catch (error) { next(error); }
  });

  app.put("/api/library/books/:id", requireAuth, requirePermission("library.catalog.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;

      const bookId = parseIdParam(req.params.id);
      const book = await getScopedLibraryBook(bookId, schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });

      const incomingTitle = String(req.body?.title ?? book.title ?? "").trim();
      const incomingClassId =
        req.body?.classId !== undefined ? (req.body.classId ?? null) : (book.classId ?? null);
      const incomingIsbn = String(req.body?.isbn ?? book.isbn ?? "").trim();

      const existingBooks = await storage.getLibraryBooks(schoolId);
      const duplicate = existingBooks.find((existingBook) =>
        existingBook.id !== bookId &&
        existingBook.title.toLowerCase().trim() === incomingTitle.toLowerCase() &&
        (existingBook.classId ?? null) === incomingClassId &&
        ((existingBook.isbn ?? "").trim()) === incomingIsbn
      );

      if (duplicate) {
        return res.status(400).json({ message: "A matching book already exists in this school catalog." });
      }

      const updated = await storage.updateLibraryBook(bookId, { ...req.body, schoolId });
      if (!updated) return res.status(404).json({ message: "Book not found" });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/library/books/:id", requireAuth, requirePermission("library.catalogue.delete"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const bookId = parseIdParam(req.params.id);
      const book = await getScopedLibraryBook(bookId, schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });

      const loans = await storage.getLibraryLoans(schoolId);
      const activeLoanExists = loans.some((loan) => loan.bookId === bookId && ["active", "overdue"].includes(String(loan.status)));
      if (activeLoanExists) {
        return res.status(400).json({ message: "Cannot delete a book with active or overdue loans." });
      }

      await db.transaction(async (tx) => {
        const closedLoans = loans.filter((loan) => loan.bookId === bookId).map((loan) => loan.id);
        if (closedLoans.length) {
          await tx.delete(libraryFinesTable).where(inArray(libraryFinesTable.loanId, closedLoans));
          await tx.delete(libraryLoansTable).where(inArray(libraryLoansTable.id, closedLoans));
        }
        await tx.delete(libraryReservationsTable).where(and(eq(libraryReservationsTable.schoolId, schoolId), eq(libraryReservationsTable.bookId, bookId)));
        await tx.delete(libraryBookCopiesTable).where(and(eq(libraryBookCopiesTable.schoolId, schoolId), eq(libraryBookCopiesTable.bookId, bookId)));
        await tx.delete(libraryBooksTable).where(and(eq(libraryBooksTable.schoolId, schoolId), eq(libraryBooksTable.id, bookId)));
      });

      res.json({ message: "Book deleted" });
    } catch (error) { next(error); }
  });

  // Library - Book Copies
  app.get("/api/library/books/:bookId/copies", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const bookId = parseIdParam(req.params.bookId);
      const book = await getScopedLibraryBook(bookId, schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });
      const copies = await storage.getLibraryBookCopies(bookId);
      res.json(copies.filter((copy) => copy.schoolId === schoolId));
    } catch (error) { next(error); }
  });

  app.get("/api/library/copies", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const copies = await storage.getLibraryBookCopiesBySchool(schoolId);
      res.json(copies);
    } catch (error) { next(error); }
  });

  app.get("/api/library/copies/qr/:qrCode", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const copy = await storage.getLibraryBookCopyByQr(req.params.qrCode);
      if (!copy || copy.schoolId !== schoolId) return res.status(404).json({ message: "No book copy found with this QR code" });
      const book = await getScopedLibraryBook(copy.bookId, schoolId);
      let activeLoan = null;
      if (copy.status === "borrowed" && book?.schoolId) {
        const allLoans = await storage.getLibraryLoans(book.schoolId, "active");
        activeLoan = allLoans.find((loan) => loan.copyId === copy.id) || null;
      }
      res.json({ copy, book, activeLoan });
    } catch (error) { next(error); }
  });

  app.post("/api/library/books/:bookId/copies", requireAuth, requirePermission("library.copies.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const bookId = parseIdParam(req.params.bookId);
      const book = await getScopedLibraryBook(bookId, schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });
      const { qrCode, condition, notes } = req.body as { qrCode?: string; condition?: string; notes?: string };
      if (!qrCode) return res.status(400).json({ message: "QR code is required" });
      const existing = await storage.getLibraryBookCopyByQr(qrCode);
      if (existing) return res.status(400).json({ message: "This QR code is already assigned to another book copy" });

      const normalizedCondition = String(condition || "Good");
      const normalizedStatus = normalizedCondition.toLowerCase() === "damaged" ? "damaged" : normalizedCondition.toLowerCase() === "lost" ? "lost" : "available";

      const createdCopy = await storage.createLibraryBookCopy({
        bookId,
        schoolId,
        qrCode,
        condition: normalizedCondition,
        status: normalizedStatus as any,
        notes: notes || null,
        attachmentUrls: [],
      });
      await recalculateLibraryBookCounters(bookId);
      res.status(201).json(createdCopy);
    } catch (error) { next(error); }
  });

  app.put("/api/library/copies/:id", requireAuth, requirePermission("library.copies.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const copyId = parseIdParam(req.params.id);
      const copy = await getScopedLibraryCopy(copyId, schoolId);
      if (!copy) return res.status(404).json({ message: "Copy not found" });

      const nextQrCode = String(req.body?.qrCode ?? copy.qrCode).trim();
      if (!nextQrCode) return res.status(400).json({ message: "QR code is required" });
      const existing = await storage.getLibraryBookCopyByQr(nextQrCode);
      if (existing && existing.id !== copyId) {
        return res.status(400).json({ message: "This QR code is already assigned to another book copy" });
      }

      const nextStatus = String(req.body?.status ?? copy.status ?? "available");
      const nextCondition = String(req.body?.condition ?? copy.condition ?? "Good");
      const attachmentUrls = Array.isArray(req.body?.attachmentUrls)
        ? req.body.attachmentUrls.filter((value: unknown) => typeof value === "string" && value.trim().length > 0)
        : (copy.attachmentUrls ?? []);

      if (copy.status === "borrowed" && nextStatus !== "borrowed") {
        return res.status(400).json({ message: "Borrowed copies must be updated through circulation before changing status" });
      }

      const normalizedStatus = nextStatus === "lost"
        ? "lost"
        : nextStatus === "damaged" || nextCondition.toLowerCase() === "damaged"
          ? "damaged"
          : copy.status === "borrowed"
            ? "borrowed"
            : "available";

      const updated = await storage.updateLibraryBookCopy(copyId, {
        qrCode: nextQrCode,
        condition: nextCondition,
        status: normalizedStatus as any,
        notes: typeof req.body?.notes === "string" ? req.body.notes : (copy.notes ?? null),
        attachmentUrls,
      });
      if (!updated) return res.status(404).json({ message: "Copy not found" });

      if (copy.status === "lost" && normalizedStatus !== "lost") {
        const [latestLostLoan] = await db
          .select()
          .from(libraryLoansTable)
          .where(
            and(
              eq(libraryLoansTable.schoolId, schoolId),
              eq(libraryLoansTable.copyId, copyId),
              eq(libraryLoansTable.status, "lost" as any)
            )
          )
          .orderBy(desc(libraryLoansTable.markedLostAt), desc(libraryLoansTable.issuedAt))
          .limit(1);

        if (latestLostLoan && !latestLostLoan.markedRecoveredAt) {
          await db.update(libraryLoansTable).set({
            markedRecoveredAt: new Date(),
          }).where(eq(libraryLoansTable.id, latestLostLoan.id));
        }
      }

      await recalculateLibraryBookCounters(copy.bookId);
      res.json(updated);
    } catch (error) { next(error); }
  });

  const copyAttachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
  app.post("/api/library/copies/:id/attachments", requireAuth, requirePermission("library.copies.manage"), copyAttachmentUpload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No attachment uploaded" });
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const copyId = parseIdParam(req.params.id);
      const copy = await getScopedLibraryCopy(copyId, schoolId);
      if (!copy) return res.status(404).json({ message: "Copy not found" });

      const objectRoot = process.env.LOCAL_OBJECT_DIR || "/var/lib/fcgs/object_storage";
      const rawExt = path.extname(req.file.originalname || "").toLowerCase().replace(".", "");
      const ext = /^[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : "jpg";
      const objectName = `uploads/library-copy-attachments/${copyId}-${Date.now()}.${ext}`;
      const absPath = path.join(objectRoot, objectName);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, req.file.buffer);
      const attachmentUrl = `/objects/${objectName}`;

      const updated = await storage.updateLibraryBookCopy(copyId, {
        attachmentUrls: [...(copy.attachmentUrls ?? []), attachmentUrl],
      });

      res.json({ attachmentUrl, copy: updated });
    } catch (error) { next(error); }
  });


  app.delete("/api/library/copies/:id/attachments", requireAuth, requirePermission("library.catalogue.delete"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const copyId = parseIdParam(req.params.id);
      const copy = await getScopedLibraryCopy(copyId, schoolId);
      if (!copy) return res.status(404).json({ message: "Copy not found" });

      const attachmentUrl = String(req.body?.attachmentUrl ?? "").trim();
      if (!attachmentUrl) return res.status(400).json({ message: "Attachment URL is required" });
      if (!(copy.attachmentUrls ?? []).includes(attachmentUrl)) {
        return res.status(404).json({ message: "Attachment not found on this copy" });
      }

      const updatedUrls = (copy.attachmentUrls ?? []).filter((url) => url !== attachmentUrl);
      const updated = await storage.updateLibraryBookCopy(copyId, { attachmentUrls: updatedUrls });
      if (!updated) return res.status(404).json({ message: "Copy not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.delete("/api/library/copies/:id", requireAuth, requirePermission("library.catalogue.delete"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const copyId = parseIdParam(req.params.id);
      const copyToDelete = await getScopedLibraryCopy(copyId, schoolId);
      if (!copyToDelete) return res.status(404).json({ message: "Copy not found" });
      if (copyToDelete.status === "borrowed") {
        return res.status(400).json({ message: "Cannot delete a borrowed copy" });
      }
      const book = await getScopedLibraryBook(copyToDelete.bookId, schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });

      await db.delete(libraryBookCopiesTable).where(eq(libraryBookCopiesTable.id, copyId));
      await recalculateLibraryBookCounters(book.id);

      res.json({ message: "Copy deleted" });
    } catch (error) { next(error); }
  });

  // Library - Loans (Circulation)
  app.get("/api/library/loans", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const status = req.query.status as string | undefined;
      const loans = await storage.getLibraryLoans(schoolId, status);
      res.json(loans);
    } catch (error) { next(error); }
  });

  app.post("/api/library/loans", requireAuth, requirePermission("library.circulation.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId || !req.user) return;
      const parsed = libraryLoanCreateSchema.parse(req.body);
      const book = await getScopedLibraryBook(parsed.bookId, schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });

      const borrower = await getBorrowerForLibraryLoan(schoolId, parsed.borrowerType, parsed.borrowerId);
      if (!borrower) return res.status(400).json({ message: "Borrower does not belong to the current school" });

      const policyCheck = await enforceLibraryLoanPolicy(schoolId, parsed.borrowerType, parsed.borrowerId);
      if (!policyCheck.ok) return res.status(400).json({ message: policyCheck.message });

      let copy = parsed.copyId ? await getScopedLibraryCopy(parsed.copyId, schoolId) : null;
      if (copy && copy.bookId !== book.id) {
        return res.status(400).json({ message: "Selected copy does not belong to this book" });
      }
      if (!copy) {
        const availableCopies = (await storage.getLibraryBookCopies(book.id)).filter((item) => item.schoolId === schoolId && item.status === "available");
        copy = availableCopies[0] ?? null;
      }
      if (!copy) return res.status(400).json({ message: "No issuable copy exists for this book" });
      if (copy.status === "damaged") return res.status(400).json({ message: "Damaged copies cannot be issued out" });
      if (copy.status === "lost") return res.status(400).json({ message: "Lost copies cannot be issued out" });
      if (copy.status !== "available") return res.status(400).json({ message: "Selected copy is not available for borrowing" });

      const existingLoans = await storage.getLibraryLoans(schoolId);
      const duplicateActiveLoan = existingLoans.find((loan) => loan.copyId === copy!.id && ["active", "overdue"].includes(String(loan.status)));
      if (duplicateActiveLoan) {
        return res.status(400).json({ message: "This copy already has an active loan" });
      }

      const staffRecord = await resolveCurrentStaffRecord(req.user.id);
      const dueDate = parsed.dueDate
        ? new Date(parsed.dueDate)
        : (() => {
            const date = new Date();
            date.setDate(date.getDate() + (policyCheck.policy?.defaultBorrowDays ?? 14));
            return date;
          })();

      if (Number.isNaN(dueDate.getTime())) {
        return res.status(400).json({ message: "A valid due date and time is required" });
      }

      const loan = await db.transaction(async (tx) => {
        const copyConditionOnBorrow = parsed.conditionOnBorrow ?? copy!.condition ?? "Good";

        const [createdLoan] = await tx.insert(libraryLoansTable).values({
          schoolId,
          bookId: book.id,
          copyId: copy!.id,
          borrowerType: parsed.borrowerType,
          borrowerId: parsed.borrowerId,
          borrowerName: borrower.borrowerName,
          issuedBy: staffRecord?.id,
          dueDate,
          status: "active",
          notes: parsed.notes ?? null,
          conditionOnBorrow: copyConditionOnBorrow,
        }).returning();

        await tx.update(libraryBookCopiesTable).set({
          status: "borrowed",
          condition: copyConditionOnBorrow,
          notes: parsed.notes ?? copy!.notes ?? null,
        }).where(eq(libraryBookCopiesTable.id, copy!.id));
        await tx.update(libraryBooksTable).set({
          availableCopies: Math.max((book.availableCopies || 0) - 1, 0),
        }).where(eq(libraryBooksTable.id, book.id));
        await tx.update(libraryReservationsTable).set({ status: "fulfilled" as any }).where(and(
          eq(libraryReservationsTable.schoolId, schoolId),
          eq(libraryReservationsTable.bookId, book.id),
          eq(libraryReservationsTable.reserverType, parsed.borrowerType as any),
          eq(libraryReservationsTable.reserverId, parsed.borrowerId),
          sql`${libraryReservationsTable.status} in ('pending','ready')`
        ));

        return createdLoan;
      });

      res.status(201).json(loan);
    } catch (error) { next(error); }
  });

  app.put("/api/library/loans/:id/return", requireAuth, requirePermission("library.circulation.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const loan = await getScopedLibraryLoan(parseIdParam(req.params.id), schoolId);
      if (!loan) return res.status(404).json({ message: "Loan not found" });
      if (!["active", "overdue"].includes(String(loan.status))) {
        return res.status(400).json({ message: "Only active or overdue loans can be returned" });
      }
      const book = await getScopedLibraryBook(loan.bookId, schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });
      const copy = loan.copyId ? await getScopedLibraryCopy(loan.copyId, schoolId) : null;

      const now = new Date();
      const dueDate = loan.dueDate ? new Date(loan.dueDate) : null;
      const overdueDays = dueDate && now > dueDate ? Math.ceil((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      const policy = await storage.getLibraryPolicy(schoolId);
      const overdueCharge = Number(policy?.overdueChargePerDay ?? "0");
      const fineAmount = overdueDays > 0 ? (overdueDays * overdueCharge).toFixed(2) : null;

      const nextCondition = typeof req.body?.condition === "string" && req.body.condition.trim().length > 0
        ? req.body.condition.trim()
        : (copy?.condition ?? loan.conditionOnBorrow ?? "Good");
      const nextNotes = typeof req.body?.notes === "string"
        ? req.body.notes
        : (copy?.notes ?? loan.notes ?? null);
      const returnCopyStatus = nextCondition.toLowerCase() === "damaged"
        ? "damaged"
        : nextCondition.toLowerCase() === "lost"
          ? "lost"
          : "available";

      const updated = await db.transaction(async (tx) => {
        const [returnedLoan] = await tx.update(libraryLoansTable).set({
          status: "returned",
          returnedAt: now,
          notes: nextNotes,
          conditionOnReturn: nextCondition,
        }).where(eq(libraryLoansTable.id, loan.id)).returning();

        if (copy) {
          await tx.update(libraryBookCopiesTable).set({
            status: returnCopyStatus as any,
            condition: nextCondition,
            notes: nextNotes,
          }).where(eq(libraryBookCopiesTable.id, copy.id));
        }

        if (fineAmount && Number(fineAmount) > 0) {
          const existingFine = (await storage.getLibraryFines(schoolId)).find((fine) => fine.loanId === loan.id);
          if (!existingFine) {
            await tx.insert(libraryFinesTable).values({
              schoolId,
              loanId: loan.id,
              amount: fineAmount,
              reason: `Overdue by ${overdueDays} day(s)`,
              status: "unpaid",
            });
          }
        }

        return returnedLoan;
      });

      await recalculateLibraryBookCounters(book.id);
      await moveNextReservationToReady(book.id, schoolId);
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.put("/api/library/loans/:id/extend", requireAuth, requirePermission("library.circulation.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const loan = await getScopedLibraryLoan(parseIdParam(req.params.id), schoolId);
      if (!loan) return res.status(404).json({ message: "Loan not found" });
      if (String(loan.status) !== "active") {
        return res.status(400).json({ message: "Only active loans can be extended" });
      }
      if (!loan.dueDate) {
        return res.status(400).json({ message: "Loan has no due date to extend" });
      }
      const currentDueDate = new Date(loan.dueDate);
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const dueStart = new Date(currentDueDate.getFullYear(), currentDueDate.getMonth(), currentDueDate.getDate());
      if (dueStart < todayStart) {
        return res.status(400).json({ message: "Overdue loans cannot be extended" });
      }
      currentDueDate.setDate(currentDueDate.getDate() + 1);
      const updated = await storage.updateLibraryLoan(loan.id, { dueDate: currentDueDate } as any);
      if (!updated) return res.status(404).json({ message: "Loan not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.put("/api/library/loans/:id/lost", requireAuth, requirePermission("library.circulation.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const loan = await getScopedLibraryLoan(parseIdParam(req.params.id), schoolId);
      if (!loan) return res.status(404).json({ message: "Loan not found" });
      if (!["active", "overdue"].includes(String(loan.status))) {
        return res.status(400).json({ message: "Only active or overdue loans can be marked lost" });
      }
      const book = await getScopedLibraryBook(loan.bookId, schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });
      const copy = loan.copyId ? await getScopedLibraryCopy(loan.copyId, schoolId) : null;

      const updated = await db.transaction(async (tx) => {
        const [lostLoan] = await tx.update(libraryLoansTable).set({
          status: "lost",
          markedLostAt: new Date(),
        }).where(eq(libraryLoansTable.id, loan.id)).returning();
        if (copy) {
          await tx.update(libraryBookCopiesTable).set({ status: "lost", condition: "Lost" }).where(eq(libraryBookCopiesTable.id, copy.id));
        }
        return lostLoan;
      });

      await recalculateLibraryBookCounters(book.id);
      res.json(updated);
    } catch (error) { next(error); }
  });

  // Library - Fines
  app.get("/api/library/fines", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const status = req.query.status as string | undefined;
      const fines = await storage.getLibraryFines(schoolId, status);
      res.json(fines);
    } catch (error) { next(error); }
  });

  app.post("/api/library/fines", requireAuth, requirePermission("library.fines.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const data = insertLibraryFineSchema.parse(req.body);
      const loan = await getScopedLibraryLoan(data.loanId, schoolId);
      if (!loan) return res.status(404).json({ message: "Loan not found" });
      const fine = await storage.createLibraryFine({ ...data, schoolId, loanId: loan.id });
      res.status(201).json(fine);
    } catch (error) { next(error); }
  });

  app.put("/api/library/fines/:id", requireAuth, requirePermission("library.fines.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const fineId = parseIdParam(req.params.id);
      const fine = await getScopedLibraryFine(fineId, schoolId);
      if (!fine) return res.status(404).json({ message: "Fine not found" });
      const payload = libraryFineUpdateSchema.parse(req.body);
      const updatePayload: Record<string, unknown> = { ...payload };
      if (payload.status === "paid") updatePayload.paidAt = new Date();
      if (payload.status && payload.status !== "paid") updatePayload.paidAt = null;
      const updated = await storage.updateLibraryFine(fineId, updatePayload as any);
      if (!updated) return res.status(404).json({ message: "Fine not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  // Library - Reservations
  app.get("/api/library/reservations", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const books = await storage.getLibraryBooks(schoolId);
      await Promise.all(books.map((book) => expireLibraryReservations(book.id, schoolId)));
      const status = req.query.status as string | undefined;
      const reservations = await storage.getLibraryReservations(schoolId, status);
      res.json(reservations);
    } catch (error) { next(error); }
  });

  app.post("/api/library/reservations", requireAuth, requirePermission("library.reservations.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const data = insertLibraryReservationSchema.parse(req.body);
      const book = await getScopedLibraryBook(data.bookId, schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });
      const borrower = await getBorrowerForLibraryLoan(schoolId, data.reserverType as any, data.reserverId);
      if (!borrower) return res.status(400).json({ message: "Reserver does not belong to the current school" });
      await expireLibraryReservations(book.id, schoolId);
      const existing = await storage.getLibraryReservationsForBook(data.bookId);
      const alreadyReserved = existing.find((reservation) =>
        reservation.schoolId === schoolId &&
        ["pending", "ready"].includes(String(reservation.status)) &&
        reservation.reserverId === data.reserverId &&
        reservation.reserverType === data.reserverType
      );
      if (alreadyReserved) {
        return res.status(400).json({ message: "You already have an open reservation for this book" });
      }
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const reservation = await storage.createLibraryReservation({
        ...data,
        schoolId,
        reserverName: borrower.borrowerName,
        expiresAt,
      });
      res.status(201).json(reservation);
    } catch (error) { next(error); }
  });

  app.put("/api/library/reservations/:id", requireAuth, requirePermission("library.reservations.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const reservationId = parseIdParam(req.params.id);
      const reservation = await getScopedLibraryReservation(reservationId, schoolId);
      if (!reservation) return res.status(404).json({ message: "Reservation not found" });
      const payload = libraryReservationUpdateSchema.parse(req.body);
      const updated = await storage.updateLibraryReservation(reservationId, payload as any);
      if (!updated) return res.status(404).json({ message: "Reservation not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.get("/api/library/books/:bookId/reservations", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const bookId = parseIdParam(req.params.bookId);
      const book = await getScopedLibraryBook(bookId, schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });
      await expireLibraryReservations(bookId, schoolId);
      const status = req.query.status as string | undefined;
      const reservations = await storage.getLibraryReservationsForBook(bookId, status);
      res.json(reservations.filter((reservation) => reservation.schoolId === schoolId));
    } catch (error) { next(error); }
  });

  // Library - Cover image upload
  const coverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  app.post("/api/library/books/cover-upload", requireAuth, requirePermission("library.catalog.manage"), coverUpload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No image file uploaded" });
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;

      const objectRoot = process.env.LOCAL_OBJECT_DIR || "/var/lib/fcgs/object_storage";
      const rawExt = path.extname(req.file.originalname || "").toLowerCase().replace(".", "");
      const ext = /^[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : "jpg";
      const objectName = `uploads/library-covers/temp-${schoolId}-${Date.now()}.${ext}`;
      const absPath = path.join(objectRoot, objectName);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, req.file.buffer);
      res.json({ url: `/objects/${objectName}` });
    } catch (error) { next(error); }
  });
  app.post("/api/library/books/:bookId/cover", requireAuth, requirePermission("library.catalog.manage"), coverUpload.single("cover"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No image file uploaded" });
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const bookId = parseIdParam(req.params.bookId);
      const book = await getScopedLibraryBook(bookId, schoolId);
      if (!book) return res.status(404).json({ message: "Book not found" });

      const objectRoot = process.env.LOCAL_OBJECT_DIR || "/var/lib/fcgs/object_storage";
      const rawExt = path.extname(req.file.originalname || "").toLowerCase().replace(".", "");
      const ext = /^[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : "jpg";
      const objectName = `uploads/library-covers/${bookId}-${Date.now()}.${ext}`;
      const absPath = path.join(objectRoot, objectName);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, req.file.buffer);

      const coverPath = `/objects/${objectName}`;
      await storage.updateLibraryBook(bookId, { coverImage: coverPath });
      res.json({ coverImage: coverPath });
    } catch (error) { next(error); }
  });

  // Library - Policy routes
  app.get("/api/library/policy", requireAuth, requirePermission("library.view"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const policy = await storage.getLibraryPolicy(schoolId);
      res.json(policy || {
        bookOverdueSmsAlert: true,
        maxBooksStudent: 1,
        maxBooksTeacher: 500,
        overdueChargePerDay: "0.50",
        defaultBorrowDays: 14,
        smsAlertWindowDays: 1,
      });
    } catch (error) { next(error); }
  });

  app.post("/api/library/policy", requireAuth, requirePermission("library.policy.manage"), async (req, res, next) => {
    try {
      const schoolId = getRequiredLibrarySchoolId(req, res);
      if (!schoolId) return;
      const policy = await storage.upsertLibraryPolicy({ ...req.body, schoolId });
      res.json(policy);
    } catch (error) { next(error); }
  });

  // Library - Book import from Excel
  const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  app.post(
    "/api/library/books/import",
    requireAuth,
    requirePermission("library.import"),
    importUpload.single("file"),
    async (req, res, next) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }

        const schoolId = getSchoolContext(req);
        if (!schoolId) {
          return res.status(400).json({ message: "School context required" });
        }

        const XLSX = await import("xlsx");
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, any>[];

        const existingBooks = await storage.getLibraryBooks(schoolId);

        let imported = 0;
        let updated = 0;
        let skipped = 0;

        for (const row of rows) {
          const title = String(row["Title"] ?? row["title"] ?? "").trim();
          if (!title) {
            skipped++;
            continue;
          }

          const isbn = String(row["ISBN"] ?? row["isbn"] ?? "").trim();
          const author = String(row["Author"] ?? row["author"] ?? "").trim();
          const publisher = String(row["Publisher"] ?? row["publisher"] ?? "").trim();
          const shelf = String(
            row["Shelf"] ?? row["shelf"] ?? row["Shelf Location"] ?? ""
          ).trim();
          const subjectName = String(row["Subject"] ?? row["subject"] ?? "").trim();

          const totalRaw = parseInt(String(row["Total"] ?? row["total"] ?? "1"), 10);
          const total = Number.isNaN(totalRaw) || totalRaw < 1 ? 1 : totalRaw;

          const subjectId: number | undefined = undefined;
          
          const existingBook = existingBooks.find((b) => {
            const sameTitle = (b.title || "").toLowerCase().trim() === title.toLowerCase();
            const sameIsbn = isbn ? (b.isbn || "").trim() === isbn : true;
            return sameTitle && sameIsbn;
          });

          const payload = {
            schoolId,
            title,
            isbn: isbn || undefined,
            author: author || undefined,
            publisher: publisher || undefined,
            shelfLocation: shelf || undefined,
            subjectId: subjectId || undefined,
            totalCopies: total,
            availableCopies: total,
            damagedCopies: 0,
            lostStolenCopies: 0,
          };

          if (existingBook) {
            await storage.updateLibraryBook(existingBook.id, {
              isbn: payload.isbn ?? existingBook.isbn ?? undefined,
              author: payload.author ?? existingBook.author ?? undefined,
              publisher: payload.publisher ?? existingBook.publisher ?? undefined,
              shelfLocation: payload.shelfLocation ?? existingBook.shelfLocation ?? undefined,
              subjectId: payload.subjectId ?? existingBook.subjectId ?? undefined,
              totalCopies: payload.totalCopies,
              availableCopies: payload.availableCopies,
              damagedCopies: payload.damagedCopies,
              lostStolenCopies: payload.lostStolenCopies,
            });
            updated++;
          } else {
            await storage.createLibraryBook(payload as any);
            imported++;
          }
        }

        return res.json({
          imported,
          updated,
          skipped,
          total: rows.length,
        });
      } catch (error) {
        console.error("[LIBRARY_IMPORT_ERROR]", error);
        next(error);
      }
    }
  );

  // Timetable routes
  app.get("/api/timetable", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req) || (req.query.schoolId ? parseInt(req.query.schoolId as string) : undefined);
      const classId = req.query.classId ? parseInt(req.query.classId as string) : undefined;
      const slots = await storage.getTimetableSlots(schoolId, classId);
      res.json(slots);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/timetable", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const data = insertTimetableSlotSchema.parse(req.body);
      const newSlot = await storage.createTimetableSlot(data);
      res.status(201).json(newSlot);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/timetable/:id", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const updated = await storage.updateTimetableSlot(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Slot not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/timetable/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      await storage.deleteTimetableSlot(parseInt(req.params.id));
      res.json({ message: "Slot deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Logbook routes
  app.get("/api/logbook", requireAuth, async (req, res, next) => {
    try {
      const teacherId = req.query.teacherId ? parseInt(req.query.teacherId as string) : undefined;
      const classId = req.query.classId ? parseInt(req.query.classId as string) : undefined;
      const entries = await storage.getLogbookEntries(teacherId, classId);
      res.json(entries);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/logbook", requireAuth, requireRole("teacher", "school_admin"), async (req, res, next) => {
    try {
      const data = insertLogbookEntrySchema.parse(req.body);
      const newEntry = await storage.createLogbookEntry(data);
      res.status(201).json(newEntry);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/logbook/:id", requireAuth, requireRole("teacher", "school_admin"), async (req, res, next) => {
    try {
      const updated = await storage.updateLogbookEntry(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Entry not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/logbook/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      await storage.deleteLogbookEntry(parseInt(req.params.id));
      res.json({ message: "Entry deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Staff Attendance routes
  const ATTENDANCE_GPS_ACCURACY_THRESHOLD_METERS = 150;

  function getAttendanceDeviceFingerprint(req: Request): string | null {
    const raw = typeof req.body?.deviceSignature === "string" ? req.body.deviceSignature.trim() : "";
    if (raw) return raw.slice(0, 255);
    return null;
  }

  function getAttendanceDeviceToken(req: Request): string | null {
    const raw = typeof req.body?.deviceToken === "string" ? req.body.deviceToken.trim() : "";
    if (!raw) return null;
    return `token:${raw}`.slice(0, 255);
  }

  function getAttendanceDeviceSignature(req: Request): string | null {
    return getAttendanceDeviceToken(req) || getAttendanceDeviceFingerprint(req);
  }

  function getAttendanceRadiusMeters(school: { schoolRadiusMeters?: number | null } | undefined | null): number {
    return school?.schoolRadiusMeters && school.schoolRadiusMeters > 0 ? school.schoolRadiusMeters : 100;
  }

  function expectedEndForAttendanceDate(date: string): { hour: number; minute: number } | null {
    const day = new Date(`${date}T00:00:00`).getDay();
    if (day === 0 || day === 6) return null;
    return { hour: 16, minute: 0 };
  }

  async function findStaffByRegisteredDeviceId(deviceId: string) {
    if (!deviceId) return null;
    const matches = await db.select({
      id: users.id,
      schoolId: users.schoolId,
      userId: staff.userId,
      staffId: staff.id,
      firstName: staff.firstName,
      lastName: staff.lastName,
      mobileId: staff.mobileId,
    }).from(staff).leftJoin(users, eq(users.id, staff.userId)).where(eq(staff.mobileId, deviceId)).limit(1);
    return matches[0] ?? null;
  }

  async function validateAttendanceLocation(req: Request, schoolId: number, stage: "clock_in" | "clock_out") {
    const latitude = typeof req.body?.latitude === "string" ? req.body.latitude : null;
    const longitude = typeof req.body?.longitude === "string" ? req.body.longitude : null;
    const accuracyRaw = req.body?.accuracy;
    const accuracy = typeof accuracyRaw === "number" ? accuracyRaw : typeof accuracyRaw === "string" && accuracyRaw.trim() ? Number(accuracyRaw) : null;
    const attemptCountRaw = req.body?.attemptCount;
    const attemptCount = typeof attemptCountRaw === "number" ? attemptCountRaw : typeof attemptCountRaw === "string" && attemptCountRaw.trim() ? Number(attemptCountRaw) : 1;
    const deviceSignature = getAttendanceDeviceSignature(req);
    const deviceFingerprint = getAttendanceDeviceFingerprint(req);

    const school = await storage.getSchool(schoolId);
    if (!school) {
      return { ok: false as const, status: 400, message: "School not found" };
    }

    if (!latitude || !longitude) {
      logActivity(req, {
        action: stage === "clock_in" ? "clock_in_location_missing" : "clock_out_location_missing",
        category: "staff_attendance",
        description: `Denied ${stage.replace("_", " ")} because location coordinates were missing`,
        targetType: "school",
        targetId: school.id,
        targetName: school.name,
        schoolId: school.id,
        metadata: { stage, attemptCount, accuracy, deviceSignature },
      });
      return { ok: false as const, status: 400, message: "Location coordinates are required" };
    }

    if (accuracy == null || Number.isNaN(accuracy) || accuracy > ATTENDANCE_GPS_ACCURACY_THRESHOLD_METERS) {
      logActivity(req, {
        action: stage === "clock_in" ? "clock_in_accuracy_denied" : "clock_out_accuracy_denied",
        category: "staff_attendance",
        description: `Denied ${stage.replace("_", " ")} because GPS accuracy was too low`,
        targetType: "school",
        targetId: school.id,
        targetName: school.name,
        schoolId: school.id,
        metadata: { stage, accuracy, threshold: ATTENDANCE_GPS_ACCURACY_THRESHOLD_METERS, attemptCount, deviceSignature },
      });
      return { ok: false as const, status: 400, message: `Location accuracy is too low (${accuracy == null || Number.isNaN(accuracy) ? "unknown" : `${Math.round(accuracy)}m`}). Please retry in an open area.` };
    }

    if (school.latitude && school.longitude) {
      const distance = getDistanceMeters(
        parseFloat(latitude), parseFloat(longitude),
        parseFloat(school.latitude), parseFloat(school.longitude)
      );
      const radiusMeters = getAttendanceRadiusMeters(school);
      if (distance > radiusMeters) {
        logActivity(req, {
          action: stage === "clock_in" ? "clock_in_geofence_denied" : "clock_out_geofence_denied",
          category: "staff_attendance",
          description: `Denied ${stage.replace("_", " ")} outside school radius`,
          targetType: "school",
          targetId: school.id,
          targetName: school.name,
          schoolId: school.id,
          metadata: { stage, distanceMeters: Math.round(distance), radiusMeters, accuracy, attemptCount, deviceSignature },
        });
        return { ok: false as const, status: 400, message: `You are ${Math.round(distance)}m away from school. You must be within ${radiusMeters}m to ${stage === "clock_in" ? "clock in" : "clock out"}.` };
      }

      logActivity(req, {
        action: stage === "clock_in" ? "clock_in_geofence_pass" : "clock_out_geofence_pass",
        category: "staff_attendance",
        description: `${stage === "clock_in" ? "Clock in" : "Clock out"} passed geofence validation`,
        targetType: "school",
        targetId: school.id,
        targetName: school.name,
        schoolId: school.id,
        metadata: { stage, distanceMeters: Math.round(distance), radiusMeters, accuracy, attemptCount, deviceSignature },
      });
    }

    return { ok: true as const, latitude, longitude, accuracy: Math.round(accuracy), attemptCount, deviceSignature, deviceFingerprint, school };
  }

  async function hasAnyAttendancePermission(userId: number, permissions: string[]): Promise<boolean> {
    for (const permission of permissions) {
      if (await storage.userHasPermission(userId, permission)) return true;
    }
    return false;
  }

  function getTodayLocalIso(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function combineAttendanceReasons(log: { lateReason?: string | null; earlyClockOutReason?: string | null }): string | null {
    const parts: string[] = [];
    if (log.lateReason?.trim()) parts.push(`Late clock-in: ${log.lateReason.trim()}`);
    if (log.earlyClockOutReason?.trim()) parts.push(`Early clock-out: ${log.earlyClockOutReason.trim()}`);
    return parts.length ? parts.join(' | ') : null;
  }

  function getAttendanceReasonPrompt(reasonType: string | null | undefined): { title: string; message: string } {
    if (reasonType === 'early_clock_out') {
      return {
        title: 'Early Clock-Out Reason Required',
        message: 'You clocked out before 16:00 on a weekday. Enter the reason before continuing.',
      };
    }
    return {
      title: 'Late Clock-In Reason Required',
      message: 'You clocked in late. Enter the reason before continuing.',
    };
  }

  app.get("/api/staff-attendance/pending-reason", requireAuth, async (req, res, next) => {
    try {
      await storage.autoClockOutOverdueStaffAttendanceLogs();
      const user = req.user as User;
      const pending = await storage.getStaffAttendanceLogByUserWithPendingReason(user.id);
      if (!pending) return res.json(null);
      res.json({
        ...pending,
        prompt: getAttendanceReasonPrompt(pending.reasonType),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/staff-attendance/:id/submit-reason", requireAuth, async (req, res, next) => {
    try {
      await storage.autoClockOutOverdueStaffAttendanceLogs();
      const user = req.user as User;
      const attendanceId = parseInt(req.params.id, 10);
      if (Number.isNaN(attendanceId)) return res.status(400).json({ message: "Invalid attendance record" });

      const existing = await storage.getStaffAttendanceLogById(attendanceId);
      if (!existing || existing.userId !== user.id) return res.status(404).json({ message: "Attendance record not found" });
      if (!existing.reasonRequired || !existing.reasonType) return res.status(400).json({ message: "No pending reason is required for this record" });

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (!reason) return res.status(400).json({ message: "A reason is required" });

      const updates: Partial<InsertStaffAttendanceLog> = {
        reasonRequired: false,
        reasonSubmittedAt: new Date(),
      };
      if (existing.reasonType === 'early_clock_out') {
        updates.earlyClockOutReason = reason;
        updates.notes = combineAttendanceReasons({ lateReason: existing.lateReason, earlyClockOutReason: reason });
      } else {
        updates.lateReason = reason;
        updates.notes = combineAttendanceReasons({ lateReason: reason, earlyClockOutReason: existing.earlyClockOutReason });
      }

      const updated = await storage.updateStaffAttendanceLog(existing.id, updates);

      logActivity(req, {
        action: existing.reasonType === 'early_clock_out' ? 'early_clock_out_reason_submitted' : 'late_clock_in_reason_submitted',
        category: 'staff_attendance',
        description: existing.reasonType === 'early_clock_out' ? 'Submitted required early clock-out reason' : 'Submitted required late clock-in reason',
        targetType: 'staff_attendance',
        targetId: existing.id,
        targetName: `Attendance ${existing.id}`,
        schoolId: existing.schoolId,
        metadata: {
          attendanceId: existing.id,
          reasonType: existing.reasonType,
          reason,
        },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff-attendance", requireAuth, async (req, res, next) => {
    try {
      await storage.autoClockOutOverdueStaffAttendanceLogs();
      const user = req.user as User;
      const canViewOwn = await hasAnyAttendancePermission(user.id, ["staff_attendance.view_own", "logbook.view"]);
      const canViewAll = await hasAnyAttendancePermission(user.id, ["staff_attendance.view_all"]);
      const canViewLogs = await hasAnyAttendancePermission(user.id, ["staff_attendance.view_logs", "logbook.view"]);
      if (!canViewLogs || (!canViewOwn && !canViewAll)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const schoolId = req.query.schoolId ? parseInt(req.query.schoolId as string) : user.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School ID required" });

      const filters: any = {};
      if (req.query.staffId) filters.staffId = parseInt(req.query.staffId as string);
      if (req.query.date) filters.date = req.query.date as string;
      if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom as string;
      if (req.query.dateTo) filters.dateTo = req.query.dateTo as string;
      if (req.query.status) filters.status = req.query.status as string;

      let logs = await storage.getStaffAttendanceLogs(schoolId, filters);
      if (!canViewAll) {
        logs = logs.filter((l) => l.userId === user.id);
      }

      res.json(logs);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff-attendance/today", requireAuth, async (req, res, next) => {
    try {
      await storage.autoClockOutOverdueStaffAttendanceLogs();
      const user = req.user as User;
      const canViewToday = await hasAnyAttendancePermission(user.id, ["staff_attendance.view_own", "staff_attendance.clock_in", "staff_attendance.clock_out", "logbook.view"]);
      if (!canViewToday) {
        return res.status(403).json({ message: "Access denied" });
      }

      const today = getTodayLocalIso();
      const log = await storage.getStaffAttendanceLogByUserAndDate(user.id, today);
      res.json(log || null);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/staff-attendance/clock-in", requireAuth, async (req, res, next) => {
    try {
      await storage.autoClockOutOverdueStaffAttendanceLogs();
      const user = req.user as User;
      const canClockIn = await hasAnyAttendancePermission(user.id, ["staff_attendance.clock_in", "logbook.view"]);
      if (!canClockIn) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!user.schoolId) return res.status(400).json({ message: "No school assigned" });

      const today = getTodayLocalIso();
      const existing = await storage.getStaffAttendanceLogByUserAndDate(user.id, today);
      if (existing) return res.status(400).json({ message: "Already clocked in today" });

      const locationCheck = await validateAttendanceLocation(req, user.schoolId, "clock_in");
      if (!locationCheck.ok) {
        return res.status(locationCheck.status).json({ message: locationCheck.message });
      }

      const staffMembers = await storage.getStaffBySchool(user.schoolId);
      const staffRecord = staffMembers.find(s => s.userId === user.id);
      if (!staffRecord) return res.status(400).json({ message: "Staff record not found" });

      const currentDeviceId = locationCheck.deviceSignature;
      const legacyDeviceFingerprint = locationCheck.deviceFingerprint;
      if (!currentDeviceId) {
        return res.status(400).json({ message: "Device signature not available for attendance." });
      }

      const registeredOwner = await findStaffByRegisteredDeviceId(currentDeviceId);
      if (registeredOwner && registeredOwner.staffId !== staffRecord.id) {
        logActivity(req, {
          action: "wrong_device_clock_in_attempt",
          category: "staff_attendance",
          description: "Denied clock-in attempt from a device registered to another staff member",
          targetType: "staff_attendance",
          targetId: staffRecord.id,
          targetName: `${staffRecord.firstName} ${staffRecord.lastName}`,
          schoolId: user.schoolId,
          metadata: {
            attemptedStaffId: staffRecord.id,
            attemptedUserId: user.id,
            deviceId: currentDeviceId,
            registeredToStaffId: registeredOwner.staffId,
            registeredToName: `${registeredOwner.firstName} ${registeredOwner.lastName}`,
          },
        });
        return res.status(403).json({ message: `This device is not registered to your account. It is currently registered to ${registeredOwner.firstName} ${registeredOwner.lastName}. Please contact an administrator if this device needs to be reassigned.` });
      }

      let registeredDeviceId = staffRecord.mobileId;
      if (registeredDeviceId && registeredDeviceId !== currentDeviceId) {
        const canUpgradeLegacyFingerprint =
          !!legacyDeviceFingerprint &&
          registeredDeviceId === legacyDeviceFingerprint &&
          currentDeviceId.startsWith("token:");

        if (canUpgradeLegacyFingerprint) {
          await storage.updateStaff(staffRecord.id, { mobileId: currentDeviceId });
          registeredDeviceId = currentDeviceId;
          logActivity(req, {
            action: "attendance_device_token_upgraded",
            category: "staff_attendance",
            description: "Upgraded registered attendance device from browser fingerprint to device token",
            targetType: "staff",
            targetId: staffRecord.id,
            targetName: `${staffRecord.firstName} ${staffRecord.lastName}`,
            schoolId: user.schoolId,
            metadata: {
              previousDeviceId: legacyDeviceFingerprint,
              newDeviceId: currentDeviceId,
            },
          });
        } else {
          logActivity(req, {
            action: "wrong_device_clock_in_attempt",
            category: "staff_attendance",
            description: "Denied clock-in attempt from an unregistered device for this staff member",
            targetType: "staff_attendance",
            targetId: staffRecord.id,
            targetName: `${staffRecord.firstName} ${staffRecord.lastName}`,
            schoolId: user.schoolId,
            metadata: {
              attemptedStaffId: staffRecord.id,
              attemptedUserId: user.id,
              deviceId: currentDeviceId,
              legacyDeviceFingerprint,
              registeredDeviceId,
            },
          });
          return res.status(403).json({ message: "This device is not registered to your account. Please use your registered device or ask an administrator to reset your device ID." });
        }
      }

      if (!registeredDeviceId) {
        await storage.updateStaff(staffRecord.id, { mobileId: currentDeviceId });
        registeredDeviceId = currentDeviceId;
        logActivity(req, {
          action: "attendance_device_registered",
          category: "staff_attendance",
          description: "Registered attendance device for staff member",
          targetType: "staff",
          targetId: staffRecord.id,
          targetName: `${staffRecord.firstName} ${staffRecord.lastName}`,
          schoolId: user.schoolId,
          metadata: {
            deviceId: currentDeviceId,
            legacyDeviceFingerprint,
          },
        });
      }

      const now = new Date();
      const day = now.getDay();
      const weekend = day === 0 || day === 6;
      const startHour = weekend ? 8 : 7;
      const startMinute = weekend ? 0 : 20;
      const startTime = new Date(now);
      startTime.setHours(startHour, startMinute, 0, 0);
      const status = now > startTime ? "late" : "on_time";
      const reasonRequired = status === "late";

      const log = await storage.createStaffAttendanceLog({
        schoolId: user.schoolId,
        staffId: staffRecord.id,
        userId: user.id,
        date: today,
        clockIn: now,
        status,
        reasonRequired,
        reasonType: reasonRequired ? "late_clock_in" : null,
        notes: null,
        deviceSignature: locationCheck.deviceSignature,
        clockInAccuracy: locationCheck.accuracy,
        clockInLatitude: locationCheck.latitude,
        clockInLongitude: locationCheck.longitude,
      });

      logActivity(req, {
        action: "clock_in",
        category: "staff_attendance",
        description: `${status === "late" ? "Late" : "On-time"} clock in recorded`,
        targetType: "staff_attendance",
        targetId: log.id,
        targetName: `${staffRecord.firstName} ${staffRecord.lastName}`,
        schoolId: user.schoolId,
        metadata: {
          attendanceId: log.id,
          status,
          accuracy: locationCheck.accuracy,
          attemptCount: locationCheck.attemptCount,
          deviceSignature: locationCheck.deviceSignature,
          weekend,
          reasonRequired,
        },
      });

      if (status === "late") {
        logActivity(req, {
          action: "late_clock_in",
          category: "staff_attendance",
          description: "Late clock in noted",
          targetType: "staff_attendance",
          targetId: log.id,
          targetName: `${staffRecord.firstName} ${staffRecord.lastName}`,
          schoolId: user.schoolId,
          metadata: { attendanceId: log.id, reasonRequired: true, accuracy: locationCheck.accuracy },
        });
      }

      res.status(201).json(log);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/staff-attendance/clock-out", requireAuth, async (req, res, next) => {
    try {
      await storage.autoClockOutOverdueStaffAttendanceLogs();
      const user = req.user as User;
      const canClockOut = await hasAnyAttendancePermission(user.id, ["staff_attendance.clock_out", "logbook.view"]);
      if (!canClockOut) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!user.schoolId) return res.status(400).json({ message: "No school assigned" });
      const today = getTodayLocalIso();
      const existing = await storage.getStaffAttendanceLogByUserAndDate(user.id, today);
      if (!existing) return res.status(400).json({ message: "You haven't clocked in today" });
      if (existing.clockOut) return res.status(400).json({ message: existing.autoClockedOut ? "Today was already auto clocked out" : "Already clocked out today" });

      const locationCheck = await validateAttendanceLocation(req, user.schoolId, "clock_out");
      if (!locationCheck.ok) {
        return res.status(locationCheck.status).json({ message: locationCheck.message });
      }

      if (existing.deviceSignature && locationCheck.deviceSignature && existing.deviceSignature !== locationCheck.deviceSignature) {
        logActivity(req, {
          action: "device_signature_mismatch",
          category: "staff_attendance",
          description: "Clock-out device signature differs from clock-in signature",
          targetType: "staff_attendance",
          targetId: existing.id,
          targetName: `Attendance ${existing.id}`,
          schoolId: user.schoolId,
          metadata: {
            attendanceId: existing.id,
            clockInDeviceSignature: existing.deviceSignature,
            clockOutDeviceSignature: locationCheck.deviceSignature,
          },
        });
      }

      const now = new Date();
      const weekdayExpectedEnd = expectedEndForAttendanceDate(today);
      const requiresEarlyClockOutReason = !!weekdayExpectedEnd && now.getHours() * 60 + now.getMinutes() < weekdayExpectedEnd.hour * 60 + weekdayExpectedEnd.minute;

      const updated = await storage.updateStaffAttendanceLog(existing.id, {
        clockOut: now,
        autoClockedOut: false,
        reasonRequired: requiresEarlyClockOutReason,
        reasonType: requiresEarlyClockOutReason ? "early_clock_out" : existing.reasonType,
        clockOutAccuracy: locationCheck.accuracy,
        clockOutLatitude: locationCheck.latitude,
        clockOutLongitude: locationCheck.longitude,
        deviceSignature: existing.deviceSignature || locationCheck.deviceSignature,
      });

      logActivity(req, {
        action: "clock_out",
        category: "staff_attendance",
        description: "Clock out recorded",
        targetType: "staff_attendance",
        targetId: existing.id,
        targetName: `Attendance ${existing.id}`,
        schoolId: user.schoolId,
        metadata: {
          attendanceId: existing.id,
          accuracy: locationCheck.accuracy,
          attemptCount: locationCheck.attemptCount,
          deviceSignature: locationCheck.deviceSignature,
          reasonRequired: requiresEarlyClockOutReason,
        },
      });

      if (requiresEarlyClockOutReason) {
        logActivity(req, {
          action: "early_clock_out",
          category: "staff_attendance",
          description: "Early clock out reason required",
          targetType: "staff_attendance",
          targetId: existing.id,
          targetName: `Attendance ${existing.id}`,
          schoolId: user.schoolId,
          metadata: {
            attendanceId: existing.id,
            clockOut: now.toISOString(),
          },
        });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff-attendance/grid", requireAuth, async (req, res, next) => {
    try {
      await storage.autoClockOutOverdueStaffAttendanceLogs();
      const user = req.user as User;
      const canViewOverview = await hasAnyAttendancePermission(user.id, ["staff_attendance.view_overview", "staff_attendance.view_all"]);
      if (!canViewOverview) return res.status(403).json({ message: "Access denied" });

      const schoolId = user.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School ID required" });

      const dateFrom = (req.query.dateFrom as string) || getTodayLocalIso().slice(0, 8) + "01";
      const dateTo = (req.query.dateTo as string) || getTodayLocalIso();
      const selectedStaffId = req.query.staffId ? parseInt(req.query.staffId as string) : null;

      const logs = await storage.getStaffAttendanceLogs(schoolId, {
        dateFrom,
        dateTo,
        ...(selectedStaffId ? { staffId: selectedStaffId } : {}),
      });
      const staffMembers = await storage.getStaffBySchool(schoolId);
      const scopedStaffMembers = selectedStaffId ? staffMembers.filter((staffMember) => staffMember.id === selectedStaffId) : staffMembers;

      const dates: string[] = [];
      const start = new Date(`${dateFrom}T00:00:00`);
      const end = new Date(`${dateTo}T00:00:00`);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        dates.push(`${year}-${month}-${day}`);
      }

      const staffGrid = scopedStaffMembers.map(s => {
        const staffLogs = logs.filter(l => l.staffId === s.id);
        const statuses: Record<string, string> = {};
        staffLogs.forEach(l => {
          statuses[l.date] = l.status;
        });
        return {
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          statuses,
        };
      });

      res.json({ dates, staff: staffGrid });
    } catch (error) {
      next(error);
    }
  });

  // POS routes
  app.get("/api/pos/items", requireAuth, async (req, res, next) => {
    try {
      const schoolId = req.query.schoolId ? parseInt(req.query.schoolId as string) : undefined;
      const items = await storage.getPosItems(schoolId);
      res.json(items);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/pos/items/:id", requireAuth, async (req, res, next) => {
    try {
      const item = await storage.getPosItem(parseInt(req.params.id));
      if (!item) return res.status(404).json({ message: "Item not found" });
      res.json(item);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/pos/items", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const data = insertPosItemSchema.parse(req.body);
      const newItem = await storage.createPosItem(data);
      res.status(201).json(newItem);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/pos/items/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const updated = await storage.updatePosItem(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Item not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/pos/items/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      await storage.deletePosItem(parseInt(req.params.id));
      res.json({ message: "Item deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/pos/sales", requireAuth, async (req, res, next) => {
    try {
      const schoolId = req.query.schoolId ? parseInt(req.query.schoolId as string) : undefined;
      const sales = await storage.getPosSales(schoolId);
      res.json(sales);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/pos/sales", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const { items, ...saleData } = req.body;
      const sale = await storage.createPosSale(saleData);
      if (items && items.length > 0) {
        const saleItems = items.map((item: any) => ({ ...item, saleId: sale.id }));
        await storage.createPosSaleItems(saleItems);
      }
      res.status(201).json(sale);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/pos/sales/:id/items", requireAuth, async (req, res, next) => {
    try {
      const items = await storage.getPosSaleItems(parseInt(req.params.id));
      res.json(items);
    } catch (error) {
      next(error);
    }
  });

  // Newsletter routes
  app.get("/api/newsletters", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req) || (req.query.schoolId ? parseInt(req.query.schoolId as string) : undefined);
      const newsletters = await storage.getNewsletters(schoolId);
      res.json(newsletters);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/newsletters/recipient-counts", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req) || (req.query.schoolId ? parseInt(req.query.schoolId as string) : undefined);
      const audience = (req.query.audience as string) || "all";
      let emailCount = 0;
      let smsCount = 0;
      let inAppCount = 0;

      if (audience === "all" || audience === "parents") {
        const parents = schoolId ? await storage.getParentsBySchool(schoolId) : [];
        emailCount += parents.filter(p => p.email).length;
        smsCount += parents.filter(p => p.phone).length;
        inAppCount += parents.filter(p => p.userId).length;
      }
      if (audience === "all" || audience === "staff") {
        const staffMembers = schoolId ? await storage.getStaffBySchool(schoolId) : [];
        emailCount += staffMembers.filter(s => s.email).length;
        smsCount += staffMembers.filter(s => s.phone).length;
        inAppCount += staffMembers.filter(s => s.userId).length;
      }
      if (audience === "all" || audience === "students") {
        const studentsList = schoolId ? await storage.getStudentsBySchool(schoolId) : [];
        emailCount += studentsList.filter(s => s.email).length;
        smsCount += studentsList.filter(s => s.phone).length;
        inAppCount += studentsList.filter(s => (s as any).userId).length;
      }

      res.json({ email: emailCount, sms: smsCount, inApp: inAppCount });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/newsletters", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req) || (req.user as User).schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const data = insertNewsletterSchema.parse({ ...req.body, schoolId });
      const newNewsletter = await storage.createNewsletter(data);
      res.status(201).json(newNewsletter);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/newsletters/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const newsletterId = parseInt(req.params.id);
      const existing = await storage.getNewsletterById(newsletterId);
      const updated = await storage.updateNewsletter(newsletterId, req.body);
      if (!updated) return res.status(404).json({ message: "Newsletter not found" });

      const isNewlyPublished = (req.body.isPublished === true || req.body.status === "published")
        && existing && !existing.isPublished && updated.schoolId;
      let communicationJobId: number | null = null;

      if (isNewlyPublished) {
        const channels: string[] = updated.channels || [];
        const schoolId = updated.schoolId!;
        const audience = updated.targetAudience || "all";
        const plainText = updated.content.replace(/<[^>]*>/g, '');

        const job = await queueCommunicationBackgroundJob({
          schoolId,
          requestedBy: currentUser.id,
          jobType: "newsletter_publish",
          title: `Publish newsletter - ${updated.title}`,
          totalCount: 0,
          metadata: { newsletterId: updated.id, channels, audience, title: updated.title },
        }, async (jobId) => {
          let processed = 0;
          let sent = 0;
          let failed = 0;
          const errors: string[] = [];
          const shouldSendInApp = channels.includes("in_app") || channels.length === 0;

          if (shouldSendInApp) {
            try {
              await createBroadcastNotifications({
                schoolId,
                targetAudience: audience,
                title: updated.title,
                message: updated.content,
                channel: "newsletter",
                actorUserId: currentUser.id,
                link: `/newsletters`,
              });
              sent++;
            } catch (err) {
              failed++;
              errors.push(`In-app: ${err instanceof Error ? err.message : 'unknown error'}`);
            }
            processed++;
            await updateCommunicationJobProgress(jobId, { processedCount: processed, successCount: sent, failedCount: failed });
          }

          if (channels.includes("email")) {
            try {
              let allRecipients: Array<{ email: string; id: number; name: string }> = [];
              if (audience === "all" || audience === "parents") {
                const parents = await storage.getParentsBySchool(schoolId);
                allRecipients.push(...parents.filter(p => p.email).map(p => ({ email: p.email!, id: p.id, name: `${p.firstName} ${p.lastName}` })));
              }
              if (audience === "all" || audience === "staff") {
                const staffMembers = await storage.getStaffBySchool(schoolId);
                allRecipients.push(...staffMembers.filter(s => s.email).map(s => ({ email: s.email!, id: s.id, name: `${s.firstName} ${s.lastName}` })));
              }
              if (audience === "all" || audience === "students") {
                const studentsList = await storage.getStudentsBySchool(schoolId);
                allRecipients.push(...studentsList.filter(s => s.email).map(s => ({ email: s.email!, id: s.id, name: `${s.firstName} ${s.lastName}` })));
              }
              if (allRecipients.length > 0) {
                const result = await communicationService.sendBulkEmail(allRecipients, updated.title, updated.content, {
                  schoolId,
                  recipientType: "staff",
                  sentBy: currentUser.id,
                  category: "newsletter",
                });
                sent += result.sent;
                failed += result.failed;
                processed += allRecipients.length;
                if (result.errors) errors.push(...result.errors);
              }
            } catch (err) {
              failed++;
              errors.push(`Email: ${err instanceof Error ? err.message : 'unknown error'}`);
            }
            await updateCommunicationJobProgress(jobId, { processedCount: processed, successCount: sent, failedCount: failed });
          }

          if (channels.includes("sms")) {
            try {
              let allRecipients: Array<{ phone: string; id: number; name: string }> = [];
              if (audience === "all" || audience === "parents") {
                const parents = await storage.getParentsBySchool(schoolId);
                allRecipients.push(...parents.filter(p => p.phone).map(p => ({ phone: p.phone!, id: p.id, name: `${p.firstName} ${p.lastName}` })));
              }
              if (audience === "all" || audience === "staff") {
                const staffMembers = await storage.getStaffBySchool(schoolId);
                allRecipients.push(...staffMembers.filter(s => s.phone).map(s => ({ phone: s.phone!, id: s.id, name: `${s.firstName} ${s.lastName}` })));
              }
              if (audience === "all" || audience === "students") {
                const studentsList = await storage.getStudentsBySchool(schoolId);
                allRecipients.push(...studentsList.filter(s => s.phone).map(s => ({ phone: s.phone!, id: s.id, name: `${s.firstName} ${s.lastName}` })));
              }
              if (allRecipients.length > 0) {
                const result = await communicationService.sendBulkSms(allRecipients, plainText.length > 160 ? plainText.substring(0, 157) + "..." : plainText, {
                  schoolId,
                  recipientType: "staff",
                  sentBy: currentUser.id,
                  category: "newsletter",
                });
                sent += result.sent;
                failed += result.failed;
                processed += allRecipients.length;
                if (result.errors) errors.push(...result.errors);
              }
            } catch (err) {
              failed++;
              errors.push(`SMS: ${err instanceof Error ? err.message : 'unknown error'}`);
            }
          }

          return {
            processedCount: processed,
            successCount: sent,
            failedCount: failed,
            skippedCount: 0,
            errorSummary: errors.length ? errors.slice(0, 20).join("; ") : null,
            metadata: { sent, failed, errors: errors.slice(0, 10) },
          };
        });
        communicationJobId = job.id;

        logActivity(req, {
          action: "create",
          category: "communication",
          description: `Queued published newsletter: ${updated.title}`,
          targetType: "communication_job",
          targetId: job.id,
          schoolId,
          metadata: { jobType: "newsletter_publish", newsletterId: updated.id, channels, audience },
        });
      }


      res.json(communicationJobId ? { ...updated, communicationJobId, queued: true } : updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/newsletters/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      await storage.deleteNewsletter(parseInt(req.params.id));
      res.json({ message: "Newsletter deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Schemes routes
  app.get("/api/schemes", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req) || (req.query.schoolId ? parseInt(req.query.schoolId as string) : undefined);
      const subjectId = req.query.subjectId ? parseInt(req.query.subjectId as string) : undefined;
      const schemesList = await storage.getSchemes(schoolId, subjectId);
      res.json(schemesList);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/schemes", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const data = insertSchemeSchema.parse(req.body);
      const newScheme = await storage.createScheme(data);
      res.status(201).json(newScheme);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/schemes/:id", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const updated = await storage.updateScheme(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Scheme not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/schemes/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      await storage.deleteScheme(parseInt(req.params.id));
      res.json({ message: "Scheme deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Hostel Roll Call routes
  // Hostels CRUD routes
  app.get("/api/hostels", requireAuth, async (req, res, next) => {
    try {
      const schoolId = req.query.schoolId ? parseInt(req.query.schoolId as string) : getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School ID required" });
      const result = await storage.getHostels(schoolId);
      res.json(result);
    } catch (error) { next(error); }
  });

  app.post("/api/hostels", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const data = insertHostelSchema.parse({ ...req.body, schoolId });
      const hostel = await storage.createHostel(data);
      res.status(201).json(hostel);
    } catch (error) { next(error); }
  });

  app.put("/api/hostels/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const id = parseInt(req.params.id);
      const existing = await storage.getHostel(id);
      if (!existing) return res.status(404).json({ message: "Hostel not found" });
      if (schoolId && existing.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      const updated = await storage.updateHostel(id, req.body);
      if (!updated) return res.status(404).json({ message: "Hostel not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.post("/api/hostels/:id/manage-students", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const hostelId = parseInt(req.params.id);
      const { studentIds = [], mode = "assign" } = req.body as { studentIds?: number[]; mode?: "assign" | "remove" };
      const hostel = await storage.getHostel(hostelId);
      if (!hostel) return res.status(404).json({ message: "Hostel not found" });
      if (schoolId && hostel.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ message: "Select at least one student" });
      }

      const allStudents = await storage.getAllStudents();
      const selectedStudents = allStudents.filter(s => studentIds.includes(s.id));
      if (selectedStudents.length !== studentIds.length) {
        return res.status(400).json({ message: "One or more students were not found" });
      }

      for (const student of selectedStudents) {
        if (schoolId && student.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
        if (student.schoolId !== hostel.schoolId) return res.status(400).json({ message: "Students must belong to the same school as the hostel" });
        if (!student.isBoarding || student.isDayScholar) {
          return res.status(400).json({ message: `${student.firstName} ${student.lastName} is not marked as a boarder` });
        }
        if (hostel.gender && student.gender && hostel.gender !== student.gender) {
          return res.status(400).json({ message: `${student.firstName} ${student.lastName} does not match the hostel gender` });
        }
      }

      if (mode === "assign" && hostel.capacity) {
        const occupied = allStudents.filter(s => s.hostelId === hostel.id && s.isBoarding).length;
        const incomingUnique = selectedStudents.filter(s => s.hostelId !== hostel.id).length;
        if (occupied + incomingUnique > hostel.capacity) {
          return res.status(400).json({ message: `This assignment exceeds hostel capacity (${hostel.capacity})` });
        }
      }

      for (const student of selectedStudents) {
        await storage.updateStudent(student.id, mode === "remove"
          ? { hostelId: null }
          : { hostelId });
      }
      res.json({ message: `${mode === "remove" ? "Removed" : "Assigned"} ${selectedStudents.length} student(s)` });
    } catch (error) { next(error); }
  });

  app.delete("/api/hostels/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const id = parseInt(req.params.id);
      const hostel = await storage.getHostel(id);
      if (!hostel) return res.status(404).json({ message: "Hostel not found" });
      if (schoolId && hostel.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      const allStudents = await storage.getAllStudents();
      const assignedCount = allStudents.filter(s => s.hostelId === id && s.isBoarding).length;
      if (assignedCount > 0) {
        return res.status(400).json({ message: `This hostel has ${assignedCount} assigned student(s). Reassign or remove them first.` });
      }
      await storage.deleteHostel(id);
      res.json({ message: "Hostel deleted" });
    } catch (error) { next(error); }
  });

  app.get("/api/hostel/rollcall", requireAuth, async (req, res, next) => {
    try {
      const schoolId = req.query.schoolId ? parseInt(req.query.schoolId as string) : getSchoolContext(req) || undefined;
      const date = req.query.date as string | undefined;
      const records = await storage.getHostelRollCall(schoolId, date);
      res.json(records);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/hostel/rollcall/by-hostel/:hostelId/:date/:timeSlot", requireAuth, async (req, res, next) => {
    try {
      const hostelId = parseInt(req.params.hostelId);
      const date = req.params.date;
      const timeSlot = req.params.timeSlot;
      const records = await storage.getHostelRollCallByHostel(hostelId, date, timeSlot);
      res.json(records);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/hostel/rollcall/grid/:hostelId/:from/:to/:timeSlot", requireAuth, async (req, res, next) => {
    try {
      const hostelId = parseInt(req.params.hostelId);
      const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
      let from = req.params.from;
      let to = req.params.to;
      const timeSlot = req.params.timeSlot;
      if (!isValidDate(from)) from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      if (!isValidDate(to)) to = new Date().toISOString().split('T')[0];

      const records = await storage.getHostelRollCallByHostelRange(hostelId, from, to, timeSlot);
      const allStudents = await storage.getStudentsBySchool(getSchoolContext(req) || 0);
      const hostelStudents = allStudents.filter(s => s.hostelId === hostelId && s.isBoarding);

      const dates: string[] = [];
      const d = new Date(from);
      const end = new Date(to);
      while (d <= end) {
        dates.push(d.toISOString().split('T')[0]);
        d.setDate(d.getDate() + 1);
      }

      const index: Record<number, Record<string, string>> = {};
      for (const r of records) {
        if (!index[r.studentId]) index[r.studentId] = {};
        index[r.studentId][r.date] = r.status;
      }

      let presentCount = 0;
      let absentCount = 0;
      const today = new Date().toISOString().split('T')[0];
      for (const r of records) {
        if (r.date === today) {
          if (r.status === 'present') presentCount++;
          else absentCount++;
        }
      }

      res.json({
        dates,
        students: hostelStudents.map(s => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          admissionNo: s.admissionNo,
          statuses: index[s.id] || {},
        })),
        present: presentCount,
        absent: absentCount,
        total: hostelStudents.length,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/hostel/rollcall/export/:hostelId/:from/:to/:timeSlot", requireAuth, async (req, res, next) => {
    try {
      const hostelId = parseInt(req.params.hostelId);
      const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
      let from = req.params.from;
      let to = req.params.to;
      const timeSlot = req.params.timeSlot;
      if (!isValidDate(from)) from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      if (!isValidDate(to)) to = new Date().toISOString().split('T')[0];

      const records = await storage.getHostelRollCallByHostelRange(hostelId, from, to, timeSlot);
      const allStudents = await storage.getStudentsBySchool(getSchoolContext(req) || 0);
      const hostelStudents = allStudents.filter(s => s.hostelId === hostelId && s.isBoarding);
      const hostel = await storage.getHostel(hostelId);

      const dates: string[] = [];
      const d = new Date(from);
      const end = new Date(to);
      while (d <= end) {
        dates.push(d.toISOString().split('T')[0]);
        d.setDate(d.getDate() + 1);
      }

      const index: Record<number, Record<string, string>> = {};
      for (const r of records) {
        if (!index[r.studentId]) index[r.studentId] = {};
        index[r.studentId][r.date] = r.status;
      }

      let csv = `Hostel Attendance - ${hostel?.name || 'Unknown'} (${timeSlot})\r\n`;
      csv += `Period: ${from} to ${to}\r\n\r\n`;
      csv += `No,Student,Admission No,${dates.join(',')}\r\n`;
      hostelStudents.forEach((s, idx) => {
        const statuses = dates.map(date => {
          const st = index[s.id]?.[date];
          return st ? st.charAt(0).toUpperCase() : '-';
        });
        csv += `${idx + 1},"${s.firstName} ${s.lastName}",${s.admissionNo},${statuses.join(',')}\r\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      const hostelName = (hostel?.name || 'hostel').replace(/\s+/g, "_");
      res.setHeader('Content-Disposition', `attachment; filename="Hostel_Attendance_${hostelName}_${timeSlot}_${from}_to_${to}.csv"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/hostel/rollcall", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const data = insertHostelRollCallSchema.parse(req.body);
      const newRecord = await storage.createHostelRollCall(data);
      res.status(201).json(newRecord);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/hostel/rollcall/bulk", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const { records, notifySchoolAdmin } = req.body;
      const schoolId = getSchoolContext(req);
      const parsed = records.map((r: any) => ({
        ...r,
        schoolId: r.schoolId || schoolId,
      }));
      const newRecords = await storage.bulkUpsertHostelRollCall(parsed);

      if (notifySchoolAdmin && schoolId) {
        const currentUser = req.user as any;
        const school = await storage.getSchool(schoolId);
        const allUsers = await storage.getAllUsers();
        const adminUsers: any[] = [];
        for (const user of allUsers.filter(u => u.schoolId === schoolId && u.isActive)) {
          const groups = await storage.getUserAccessGroups(user.id);
          const hasSchoolAdminGroup = groups.some(g => g.name === "School Admin");
          if (user.role === "school_admin" || hasSchoolAdminGroup) {
            adminUsers.push(user);
          }
        }
        const hostels = await storage.getHostels(schoolId);
        const students = await storage.getAllStudents();
        for (const rec of newRecords) {
          if (rec.status === "present") continue;
          const student = await storage.getStudent(rec.studentId);
          if (!student || student.schoolId !== schoolId) continue;
          const hostel = student.hostelId ? hostels.find(h => h.id === student.hostelId) : null;
          const message = `Hostel Attendance Alert: ${student.firstName} ${student.lastName} was marked ${rec.status.toUpperCase()} on ${rec.date}${hostel ? ` in ${hostel.name}` : ""}${rec.timeSlot ? ` (${rec.timeSlot})` : ""}${rec.notes ? `. Note: ${rec.notes}` : ""}.`;
          for (const admin of adminUsers) {
            await storage.createNotification({
              userId: admin.id,
              organizationId: admin.organizationId,
              schoolId,
              type: "attendance",
              title: "Hostel Attendance Alert",
              message,
              data: { studentId: student.id, hostelId: hostel?.id || null, status: rec.status, date: rec.date, timeSlot: rec.timeSlot },
              actionUrl: "/hostel",
            });
            if (admin.phone) {
              communicationService.sendSms({
                to: admin.phone,
                message,
                schoolId,
                recipientType: "staff",
                sentBy: currentUser.id,
                category: "attendance",
                recipientName: `${admin.firstName || ""} ${admin.lastName || ""}`.trim(),
              }).catch(() => {});
            }
            if (admin.email) {
              communicationService.sendEmail({
                to: admin.email,
                subject: `Hostel Attendance Alert${school?.name ? ` - ${school.name}` : ""}`,
                text: message,
                html: message.replace(/\n/g, '<br>'),
                schoolId,
                recipientType: "staff",
                sentBy: currentUser.id,
                category: "attendance",
                recipientName: `${admin.firstName || ""} ${admin.lastName || ""}`.trim(),
              }).catch(() => {});
            }
          }
        }
      }

      res.status(201).json(newRecords);
    } catch (error) {
      next(error);
    }
  });

  // Student Application routes (public)
  app.get("/api/applications", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = req.query.schoolId ? parseInt(req.query.schoolId as string) : undefined;
      const applications = await storage.getStudentApplications(schoolId);
      res.json(applications);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/applications", async (req, res, next) => {
    try {
      const data = insertStudentApplicationSchema.parse(req.body);
      const newApp = await storage.createStudentApplication(data);
      res.status(201).json(newApp);

      try {
        const allUsers = await storage.getAllUsers();
        let schoolName = "Unknown School";
        if (newApp.schoolId) {
          const school = await storage.getSchool(newApp.schoolId);
          if (school) schoolName = school.name;
        }

        const schoolAdmins = allUsers.filter(u =>
          u.role === "school_admin" && u.schoolId === newApp.schoolId && u.isActive
        );
        const orgAdmins = allUsers.filter(u =>
          u.role === "org_admin" && u.isActive
        );

        const notifTitle = `New Student Application`;
        const notifMessage = `${newApp.firstName} ${newApp.lastName} has applied for enrollment${newApp.gradeApplyingFor ? ` in ${newApp.gradeApplyingFor}` : ""}.`;

        for (const admin of schoolAdmins) {
          await storage.createNotification({
            userId: admin.id,
            organizationId: admin.organizationId,
            schoolId: newApp.schoolId,
            type: "application",
            title: notifTitle,
            message: notifMessage,
            severity: "info",
            link: "/applications",
          });
        }

        for (const admin of orgAdmins) {
          await storage.createNotification({
            userId: admin.id,
            organizationId: admin.organizationId,
            schoolId: newApp.schoolId,
            type: "application",
            title: notifTitle,
            message: `[${schoolName}] ${notifMessage}`,
            severity: "info",
            link: "/applications",
          });
        }
      } catch (notifError) {
        console.error("Failed to create application notifications:", notifError);
      }
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/applications/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const updated = await storage.updateStudentApplication(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Application not found" });

      if (req.body.status === "approved" && updated.schoolId) {
        try {
          const nameParts = (updated.parentName || "").trim().split(/\s+/);
          const parentFirstName = nameParts[0] || "Parent";
          const parentLastName = nameParts.slice(1).join(" ") || updated.lastName;

          const newParent = await storage.createParent({
            schoolId: updated.schoolId,
            firstName: parentFirstName,
            lastName: parentLastName,
            email: updated.parentEmail || undefined,
            phone: updated.parentPhone || "",
            streetAddress: updated.streetAddress || undefined,
            residentialArea: updated.residentialArea || undefined,
            address: updated.address || undefined,
            relationship: updated.parentRelationship || "parent",
          });

          const admissionNo = await storage.getNextAdmissionNo();
          await storage.createStudent({
            schoolId: updated.schoolId,
            admissionNo,
            firstName: updated.firstName,
            lastName: updated.lastName,
            email: undefined,
            phone: undefined,
            gender: (updated.gender === "male" || updated.gender === "female") ? updated.gender : undefined,
            dateOfBirth: updated.dateOfBirth || undefined,
            streetAddress: updated.streetAddress || undefined,
            residentialArea: updated.residentialArea || undefined,
            address: updated.address || undefined,
            parentId: newParent.id,
            enrollmentDate: new Date().toISOString().split("T")[0],
            status: "active",
          });
        } catch (enrollErr) {
          console.error("Failed to auto-enroll student from application:", enrollErr);
        }
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  // Permissions routes
  app.get("/api/permissions", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canViewAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const perms = await storage.getAllPermissions();
      res.json(perms);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/permissions", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const data = insertPermissionSchema.parse(req.body);
      const newPerm = await storage.createPermission(data);
      res.status(201).json(newPerm);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/permissions/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const updated = await storage.updatePermission(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Permission not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/permissions/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      await storage.deletePermission(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Access Groups routes
  app.get("/api/access-groups", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canViewAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const groups = await getVisibleAccessGroupsForUser(currentUser);
      res.json(groups);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/access-groups/:id", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canViewAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const visibleGroups = await getVisibleAccessGroupsForUser(currentUser);
      const group = visibleGroups.find(g => g.id === parseInt(req.params.id));
      if (!group) return res.status(404).json({ message: "Access group not found" });
      res.json(group);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/access-groups/:id/permissions", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canViewAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const visibleGroups = await getVisibleAccessGroupsForUser(currentUser);
      const group = visibleGroups.find(g => g.id === parseInt(req.params.id));
      if (!group) return res.status(404).json({ message: "Access group not found" });
      const perms = await storage.getAccessGroupPermissions(group.id);
      res.json(perms);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/access-groups", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const data = insertAccessGroupSchema.parse(req.body);
      const newGroup = await storage.createAccessGroup(data);
      res.status(201).json(newGroup);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/access-groups/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const updated = await storage.updateAccessGroup(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Access group not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/access-groups/:id/permissions", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const { permissionIds } = req.body as { permissionIds: number[] };
      await storage.setAccessGroupPermissions(parseInt(req.params.id), permissionIds || []);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/access-groups/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const groupId = parseInt(req.params.id);
      const group = await storage.getAccessGroup(groupId);
      if (!group) {
        return res.status(404).json({ message: "Access group not found" });
      }
      const assignedUsers = await db.select({ count: sql<number>`count(*)` }).from(userAccessGroups).where(eq(userAccessGroups.accessGroupId, groupId));
      const usageCount = Number(assignedUsers[0]?.count ?? 0);
      if (usageCount > 0) {
        return res.status(400).json({ message: "This access group cannot be deleted because users are assigned to it." });
      }
      await storage.deleteAccessGroup(groupId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Staff Roles CRUD
  app.get("/api/staff-roles", requireAuth, async (req, res, next) => {
    try {
      const roles = await db.select().from(staffRoles).orderBy(staffRoles.id);
      res.json(roles);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/staff-roles", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const { name, label, description } = req.body;
      if (!name || !label) {
        return res.status(400).json({ message: "Name and label are required" });
      }
      const [role] = await db.insert(staffRoles).values({ name, label, description: description || null, isSystemDefault: false }).returning();
      res.json(role);
    } catch (error: any) {
      if (error?.constraint || error?.message?.includes("unique")) {
        return res.status(400).json({ message: "A role with this name already exists" });
      }
      next(error);
    }
  });

  app.put("/api/staff-roles/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const { label, description } = req.body;
      const [existing] = await db.select().from(staffRoles).where(eq(staffRoles.id, id));
      if (!existing) {
        return res.status(404).json({ message: "Role not found" });
      }
      const updates: any = {};
      if (label !== undefined) updates.label = label;
      if (description !== undefined) updates.description = description;
      const [updated] = await db.update(staffRoles).set(updates).where(eq(staffRoles.id, id)).returning();
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/staff-roles/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(staffRoles).where(eq(staffRoles.id, id));
      if (!existing) {
        return res.status(404).json({ message: "Role not found" });
      }
      const assignedStaff = await db.select({ count: sql<number>`count(*)` }).from(staff).where(eq(staff.role, existing.name));
      const usageCount = Number(assignedStaff[0]?.count ?? 0);
      if (usageCount > 0) {
        return res.status(400).json({ message: "This role cannot be deleted because staff members are assigned to it." });
      }
      await db.delete(staffRoles).where(eq(staffRoles.id, id));
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Helper function to check tenant-scoped access
  async function checkTenantAccess(
    currentUser: User,
    targetUserId: number,
    options?: { repairLegacyOrgAdmin?: boolean }
  ): Promise<{ allowed: boolean; error?: string; targetUser?: User }> {
    let targetUser = await storage.getUser(targetUserId);
    if (!targetUser) {
      return { allowed: false, error: "User not found" };
    }

    if (
      options?.repairLegacyOrgAdmin &&
      currentUser.role === 'org_admin' &&
      !!currentUser.organizationId &&
      targetUser.role === 'org_admin' &&
      !targetUser.organizationId
    ) {
      const repaired = await storage.updateUser(targetUserId, { organizationId: currentUser.organizationId });
      if (repaired) {
        targetUser = repaired;
      }
    }

    if (currentUser.role === 'org_admin') {
      if (!currentUser.organizationId) {
        return { allowed: true, targetUser };
      }

      let targetOrganizationId = targetUser.organizationId ?? null;

      if (!targetOrganizationId && targetUser.schoolId) {
        const targetSchool = await storage.getSchool(targetUser.schoolId);
        targetOrganizationId = targetSchool?.organizationId ?? null;
      }

      if (targetOrganizationId !== currentUser.organizationId) {
        return { allowed: false, error: "Access denied - user not in your organization" };
      }
    } else if (currentUser.schoolId) {
      if (targetUser.schoolId !== currentUser.schoolId) {
        return { allowed: false, error: "Access denied - user not in your school" };
      }
    }
    return { allowed: true, targetUser };
  }

  function isOrganizationOnlyAccessGroup(group: AccessGroup): boolean {
    const groupKey = normalizeAccessLookupKey(group.name);
    return groupKey === normalizeAccessLookupKey("Org HQ");
  }

  async function canViewAccessRights(currentUser: User): Promise<boolean> {
    if (currentUser.role === 'org_admin') return true;
    return (
      await storage.userHasPermission(currentUser.id, 'access_groups.view') ||
      await storage.userHasPermission(currentUser.id, 'users.manage_permissions')
    );
  }

  async function canManageAccessRights(currentUser: User): Promise<boolean> {
    if (currentUser.role === 'org_admin') return true;
    return await storage.userHasPermission(currentUser.id, 'users.manage_permissions');
  }

  async function getVisibleAccessGroupsForUser(currentUser: User) {
    const groups = await storage.getAllAccessGroups();
    if (currentUser.role === 'org_admin') return groups;
    return groups.filter(group => !isOrganizationOnlyAccessGroup(group));
  }

  async function getAssignableAccessGroupForUser(currentUser: User, accessGroupId: number) {
    const group = await storage.getAccessGroup(accessGroupId);
    if (!group) return { allowed: false as const, error: 'Access group not found' };
    if (currentUser.role === 'org_admin') return { allowed: true as const, group };
    if (isOrganizationOnlyAccessGroup(group)) {
      return { allowed: false as const, error: 'That access group is reserved for organization administrators' };
    }
    return { allowed: true as const, group };
  }

  // User Access Groups routes
  app.get("/api/users/:userId/access-groups", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canViewAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const targetUserId = parseInt(req.params.userId);
      const access = await checkTenantAccess(currentUser, targetUserId, { repairLegacyOrgAdmin: true });
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }
      await storage.normalizeUserBaselineAccess(targetUserId);
      const visibleGroups = await getVisibleAccessGroupsForUser(currentUser);
      const visibleIds = new Set(visibleGroups.map(g => g.id));
      const groups = (await storage.getUserAccessGroups(targetUserId)).filter(group => visibleIds.has(group.id));
      res.json(groups);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/users/:userId/access-groups", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canManageAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const targetUserId = parseInt(req.params.userId);
      const access = await checkTenantAccess(currentUser, targetUserId);
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }
      const { accessGroupId } = req.body as { accessGroupId: number };
      const allowedGroup = await getAssignableAccessGroupForUser(currentUser, accessGroupId);
      if (!allowedGroup.allowed) {
        return res.status(403).json({ message: allowedGroup.error });
      }
      const [linkedStaff] = await db.select().from(staff).where(eq(staff.userId, targetUserId)).limit(1);
      if (linkedStaff) {
        const updatedStaff = await storage.updateStaff(linkedStaff.id, { accessGroupId });
        if (updatedStaff) {
          await syncLinkedUserFromStaffRecord(updatedStaff);
        }
        const mapping = await storage.addUserToAccessGroup({
          userId: targetUserId,
          accessGroupId
        });
        return res.status(201).json(mapping);
      }

      const mapping = await storage.addUserToAccessGroup({
        userId: targetUserId,
        accessGroupId
      });
      res.status(201).json(mapping);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/users/:userId/access-groups/:groupId", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canManageAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const targetUserId = parseInt(req.params.userId);
      const access = await checkTenantAccess(currentUser, targetUserId);
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }
      const groupId = parseInt(req.params.groupId);
      const allowedGroup = await getAssignableAccessGroupForUser(currentUser, groupId);
      if (!allowedGroup.allowed) {
        return res.status(403).json({ message: allowedGroup.error });
      }
      const [linkedStaff] = await db.select().from(staff).where(eq(staff.userId, targetUserId)).limit(1);
      if (linkedStaff?.accessGroupId === groupId) {
        await storage.updateStaff(linkedStaff.id, { accessGroupId: null });
      }
      await storage.removeUserFromAccessGroup(targetUserId, groupId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // User Permission Overrides routes
  app.get("/api/users/:userId/permissions", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canViewAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const targetUserId = parseInt(req.params.userId);
      const access = await checkTenantAccess(currentUser, targetUserId, { repairLegacyOrgAdmin: true });
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }
      await storage.normalizeUserBaselineAccess(targetUserId);
      const permissionStates = await storage.getUserPermissionStates(targetUserId);
      res.json(permissionStates);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/users/:userId/permission-overrides", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canViewAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const targetUserId = parseInt(req.params.userId);
      const access = await checkTenantAccess(currentUser, targetUserId, { repairLegacyOrgAdmin: true });
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }
      await storage.normalizeUserBaselineAccess(targetUserId);
      const overrides = await storage.getUserPermissionOverrides(targetUserId);
      res.json(overrides);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/users/:userId/permission-overrides", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canManageAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const targetUserId = parseInt(req.params.userId);
      const access = await checkTenantAccess(currentUser, targetUserId);
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }
      const { permissionId, granted } = req.body as { permissionId: number; granted: boolean };
      const override = await storage.setUserPermissionOverride({
        userId: targetUserId,
        permissionId,
        granted
      });
      res.status(201).json(override);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/users/:userId/permission-overrides/:permissionId", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canManageAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const targetUserId = parseInt(req.params.userId);
      const access = await checkTenantAccess(currentUser, targetUserId);
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }
      await storage.removeUserPermissionOverride(targetUserId, parseInt(req.params.permissionId));
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/users/:userId/permission-overrides", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (!(await canManageAccessRights(currentUser))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const targetUserId = parseInt(req.params.userId);
      const access = await checkTenantAccess(currentUser, targetUserId);
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }
      await storage.clearAllUserPermissionOverrides(targetUserId);
      logActivity(req, {
        action: "update",
        category: "staff",
        description: `Reset access rights to group default for user #${targetUserId}`,
        targetType: "user",
        targetId: targetUserId,
      });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Check if user has permission (only self or admin with tenant scope)
  app.get("/api/users/:userId/has-permission/:code", requireAuth, async (req, res, next) => {
    try {
      const requestedUserId = parseInt(req.params.userId);
      const currentUser = req.user as User;
      
      // Allow checking own permissions
      if (currentUser.id !== requestedUserId) {
        // Check if admin with proper tenant scope
        if (currentUser.role === 'org_admin') {
          const targetUser = await storage.getUser(requestedUserId);
          if (!targetUser || targetUser.organizationId !== currentUser.organizationId) {
            return res.status(403).json({ message: "Access denied - user not in your organization" });
          }
        } else if (currentUser.role === 'school_admin') {
          const targetUser = await storage.getUser(requestedUserId);
          if (!targetUser || targetUser.schoolId !== currentUser.schoolId) {
            return res.status(403).json({ message: "Access denied - user not in your school" });
          }
        } else {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      const hasPermission = await storage.userHasPermission(requestedUserId, req.params.code);
      res.json({ hasPermission });
    } catch (error) {
      next(error);
    }
  });

  // Communication routes
  app.get("/api/communication/status", requireAuth, async (req, res) => {
    res.json({
      email: communicationService.isEmailConfigured(),
      sms: communicationService.isSmsConfigured(),
      whatsapp: false,
      in_app: true,
      disabled: communicationService.communicationsDisabled,
    });
  });


  app.get("/api/communication/jobs/:id", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const jobId = parseInt(req.params.id);
      if (!Number.isFinite(jobId)) return res.status(400).json({ message: "Invalid job id" });

      const [job] = await db.select().from(communicationJobs).where(eq(communicationJobs.id, jobId)).limit(1);
      if (!job) return res.status(404).json({ message: "Communication job not found" });

      if (currentUser.role !== "org_admin") {
        const userSchoolId = getSchoolContext(req) || currentUser.schoolId;
        if (job.schoolId && userSchoolId && job.schoolId !== userSchoolId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  const sendNotificationSchema = z.object({
    channel: z.enum(["email", "sms", "in_app"]).optional(),
    channels: z.array(z.enum(["email", "sms", "in_app"])).optional(),
    recipientType: z.enum(["staff", "student", "parent"]),
    recipientIds: z.array(z.number()).default([]),
    targetAudience: z.enum(["selected", "all", "streams", "classes", "individuals"]).optional().default("selected"),
    streamIds: z.array(z.number()).optional().default([]),
    classIds: z.array(z.number()).optional().default([]),
    studentIds: z.array(z.number()).optional().default([]),
    staffIds: z.array(z.number()).optional().default([]),
    search: z.string().optional(),
    classFilter: z.string().optional(),
    statusFilter: z.string().optional(),
    subject: z.string().optional(),
    message: z.string().optional(),
    schoolId: z.number().optional(),
  });

  type NotifyRecipientForSend = { id: number; email?: string | null; phone?: string | null; name: string };

  async function resolveCommunicationRecipients(currentUser: User, req: Request, data: z.infer<typeof sendNotificationSchema>): Promise<{ schoolId: number; recipients: NotifyRecipientForSend[] }> {
    const targetSchoolId = data.schoolId || getSchoolContext(req) || currentUser.schoolId || 0;
    const selectedRecipientIds = data.recipientIds || [];
    const normalize = (value: unknown) => String(value || "").trim().toLowerCase();
    const matchesSearch = (parts: unknown[], searchTerm?: string) => {
      const term = normalize(searchTerm);
      if (!term) return true;
      return parts.some((part) => normalize(part).includes(term));
    };

    let recipients: NotifyRecipientForSend[] = [];

    if (data.recipientType === "staff") {
      const staffList = await storage.getStaffBySchool(targetSchoolId);
      let selectedStaff = staffList;
      if (data.targetAudience === "selected") {
        selectedStaff = staffList.filter(s => selectedRecipientIds.includes(s.id));
      } else if (data.targetAudience === "individuals") {
        const selectedStaffIds = new Set((data.staffIds || []).map(Number));
        selectedStaff = staffList.filter(s => selectedStaffIds.has(s.id));
      } else {
        selectedStaff = staffList.filter(s => matchesSearch([s.firstName, s.lastName, s.staffId, s.position, s.phone, s.email], data.search));
      }
      recipients = selectedStaff.map(s => ({ id: s.id, email: s.email, phone: s.phone, name: `${s.firstName} ${s.lastName}` }));
    } else if (data.recipientType === "student") {
      const studentList = await storage.getStudentsBySchool(targetSchoolId);
      let selectedStudents = studentList;

      if (data.targetAudience === "selected") {
        selectedStudents = studentList.filter(s => selectedRecipientIds.includes(s.id));
      } else if (data.targetAudience === "streams") {
        const selectedStreamIds = new Set((data.streamIds || []).map(Number));
        const schoolClasses = await storage.getClassesBySchool(targetSchoolId);
        const classIdsForSelectedStreams = new Set(schoolClasses
          .filter(c => typeof c.streamId === "number" && selectedStreamIds.has(c.streamId))
          .map(c => c.id));
        selectedStudents = studentList.filter(s => typeof s.classId === "number" && classIdsForSelectedStreams.has(s.classId));
      } else if (data.targetAudience === "classes") {
        const selectedClassIds = new Set((data.classIds || []).map(Number));
        const schoolClasses = await storage.getClassesBySchool(targetSchoolId);
        const validClassIds = new Set(schoolClasses.filter(c => selectedClassIds.has(c.id)).map(c => c.id));
        selectedStudents = studentList.filter(s => typeof s.classId === "number" && validClassIds.has(s.classId));
      } else if (data.targetAudience === "individuals") {
        const selectedStudentIds = new Set((data.studentIds || []).map(Number));
        selectedStudents = studentList.filter(s => selectedStudentIds.has(s.id));
      } else {
        selectedStudents = studentList.filter(s => {
          const classOk = !data.classFilter || data.classFilter === "all" || s.classId === Number(data.classFilter);
          const statusOk = !data.statusFilter || data.statusFilter === "all" || s.status === data.statusFilter;
          const searchOk = matchesSearch([s.firstName, s.lastName, s.admissionNo, s.phone, s.email], data.search);
          return classOk && statusOk && searchOk;
        });
      }
      recipients = selectedStudents.map(s => ({ id: s.id, email: s.email, phone: s.phone, name: `${s.firstName} ${s.lastName}` }));
    } else if (data.recipientType === "parent") {
      const parentList = await storage.getParentsBySchool(targetSchoolId);
      let selectedParents = parentList;

      if (data.targetAudience === "selected") {
        selectedParents = parentList.filter(p => selectedRecipientIds.includes(p.id));
      } else if (["streams", "classes", "individuals"].includes(data.targetAudience)) {
        const studentList = await storage.getStudentsBySchool(targetSchoolId);
        const schoolClasses = await storage.getClassesBySchool(targetSchoolId);
        const validClassIds = new Set(schoolClasses.filter(c => (data.classIds || []).includes(c.id)).map(c => c.id));
        const selectedStreamIds = new Set((data.streamIds || []).map(Number));
        const classIdsForSelectedStreams = new Set(schoolClasses
          .filter(c => typeof c.streamId === "number" && selectedStreamIds.has(c.streamId))
          .map(c => c.id));
        const selectedStudentIds = new Set((data.studentIds || []).map(Number));

        const parentIds = new Set(studentList
          .filter(s => {
            if (!s.parentId) return false;
            if (data.targetAudience === "streams") return typeof s.classId === "number" && classIdsForSelectedStreams.has(s.classId);
            if (data.targetAudience === "classes") return typeof s.classId === "number" && validClassIds.has(s.classId);
            return selectedStudentIds.has(s.id);
          })
          .map(s => s.parentId)
          .filter((id): id is number => typeof id === "number"));

        selectedParents = parentList.filter(p => parentIds.has(p.id));
      } else {
        selectedParents = parentList.filter(p => matchesSearch([p.firstName, p.lastName, p.phone, p.email, p.relationship], data.search));
      }
      recipients = selectedParents.map(p => ({ id: p.id, email: p.email, phone: p.phone, name: `${p.firstName} ${p.lastName}` }));
    }

    return { schoolId: targetSchoolId, recipients };
  }

  app.post("/api/communication/preview-recipients", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const data = sendNotificationSchema.parse(req.body);
      const { recipients } = await resolveCommunicationRecipients(currentUser, req, data);
      res.json({
        total: recipients.length,
        email: recipients.filter(r => !!r.email).length,
        sms: recipients.filter(r => !!r.phone).length,
        inApp: recipients.length,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/communication/send", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const data = sendNotificationSchema.parse(req.body);
      if (!data.message?.trim()) {
        return res.status(400).json({ message: "Message is required" });
      }
      const notificationMessage = data.message.trim();

      const channelsToUse = data.channels || (data.channel ? [data.channel] : []);
      if (channelsToUse.length === 0) {
        return res.status(400).json({ message: "No channels specified" });
      }

      const { schoolId: targetSchoolId, recipients } = await resolveCommunicationRecipients(currentUser, req, data);

      if (recipients.length === 0) {
        return res.status(400).json({ message: "No valid recipients found" });
      }

      const job = await queueCommunicationBackgroundJob({
        schoolId: targetSchoolId || null,
        requestedBy: currentUser.id,
        jobType: "notice_send",
        title: `Send notice to ${recipients.length} ${data.recipientType}${recipients.length === 1 ? "" : "s"}`,
        totalCount: recipients.length * channelsToUse.length,
        metadata: {
          channels: channelsToUse,
          recipientType: data.recipientType,
          subject: data.subject || "Notification",
        },
      }, async (jobId) => {
        let totalSent = 0;
        let totalFailed = 0;
        let processed = 0;
        const allErrors: string[] = [];

        for (const channel of channelsToUse) {
          if (channel === "email") {
            const emailRecipients = recipients.filter(r => r.email).map(r => ({ email: r.email!, id: r.id, name: r.name }));
            if (emailRecipients.length > 0) {
              const result = await communicationService.sendBulkEmail(emailRecipients, data.subject || "Notification", notificationMessage, {
                schoolId: targetSchoolId || undefined,
                recipientType: data.recipientType,
                sentBy: currentUser.id,
                category: "notices",
              });
              totalSent += result.sent;
              totalFailed += result.failed;
              processed += emailRecipients.length;
              if (result.errors) allErrors.push(...result.errors);
              await updateCommunicationJobProgress(jobId, { processedCount: processed, successCount: totalSent, failedCount: totalFailed });
            }
          } else if (channel === "sms") {
            const smsRecipients = recipients.filter(r => r.phone).map(r => ({ phone: r.phone!, id: r.id, name: r.name }));
            if (smsRecipients.length > 0) {
              const result = await communicationService.sendBulkSms(smsRecipients, notificationMessage, {
                schoolId: targetSchoolId || undefined,
                recipientType: data.recipientType,
                sentBy: currentUser.id,
                category: "notices",
              });
              totalSent += result.sent;
              totalFailed += result.failed;
              processed += smsRecipients.length;
              if (result.errors) allErrors.push(...result.errors);
              await updateCommunicationJobProgress(jobId, { processedCount: processed, successCount: totalSent, failedCount: totalFailed });
            }
          } else if (channel === "in_app") {
            const { createInAppNotifications } = await import("./communication");
            await createInAppNotifications({
              recipientType: data.recipientType,
              recipientIds: recipients.map((recipient) => recipient.id),
              title: data.subject || "Notification",
              message: notificationMessage,
              channel: "in_app",
              schoolId: targetSchoolId || undefined,
              actorUserId: currentUser.id,
            });
            totalSent += recipients.length;
            processed += recipients.length;
            await updateCommunicationJobProgress(jobId, { processedCount: processed, successCount: totalSent, failedCount: totalFailed });
          }
        }

        const skipped = Math.max(0, recipients.length * channelsToUse.length - processed);
        return {
          processedCount: processed,
          successCount: totalSent,
          failedCount: totalFailed,
          skippedCount: skipped,
          errorSummary: allErrors.length ? allErrors.slice(0, 20).join("; ") : null,
        };
      });

      logActivity(req, {
        action: "create",
        category: "communication",
        description: `Queued notice for ${recipients.length} ${data.recipientType}${recipients.length === 1 ? "" : "s"} via ${channelsToUse.join(", ")}`,
        targetType: "communication_job",
        targetId: job.id,
        schoolId: targetSchoolId || null,
        metadata: { jobType: "notice_send", channels: channelsToUse, recipientType: data.recipientType, recipientCount: recipients.length },
      });

      res.status(202).json({
        success: true,
        queued: true,
        jobId: job.id,
        sent: 0,
        failed: 0,
        errors: [],
        message: `Notification queued for ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}. Sending will continue in the background.`,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/communication/logs", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req) || currentUser.schoolId || undefined;
      const { recipientType, category, channel, status, search, startDate, endDate, page } = req.query;
      const pageNum = page ? Math.max(1, Number(page)) : 1;
      const limit = 50;
      const offset = (pageNum - 1) * limit;
      const result = await storage.getCommunicationLogs({
        schoolId: schoolId || undefined,
        recipientType: recipientType as string | undefined,
        category: category as string | undefined,
        channel: channel as string | undefined,
        status: status as string | undefined,
        search: search as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
        limit,
        offset,
      });
      res.json({ logs: result.logs, total: result.total, page: pageNum, totalPages: Math.ceil(result.total / limit) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/communication/stats", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const stats = await storage.getCommunicationStats(currentUser.schoolId || undefined);
      res.json(stats);
    } catch (error) {
      next(error);
    }
  });

  // Assessment Types
  app.get("/api/assessment-types", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const types = schoolId
        ? await storage.getAssessmentTypes(schoolId)
        : await storage.getAssessmentTypes();

      res.json(types);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/assessment-types", requireAuth, async (req, res, next) => {
    try {
      const created = await storage.createAssessmentType(req.body);
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/assessment-types/:id", requireAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateAssessmentType(id, req.body);
      if (!updated) return res.status(404).json({ message: "Assessment type not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/assessment-types/:id", requireAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteAssessmentType(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // Exam Types
  app.get("/api/exam-types", requireAuth, async (req, res, next) => {
    try {
      const types = await storage.getExamTypes();
      res.json(types);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/exam-types", requireAuth, async (req, res, next) => {
    try {
      const created = await storage.createExamType(req.body);
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/exam-types/:id", requireAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateExamType(id, req.body);
      if (!updated) return res.status(404).json({ message: "Exam type not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/exam-types/:id", requireAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteExamType(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // Exams
  app.get("/api/exams", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const examList = schoolId
        ? await storage.getExamsBySchool(schoolId)
        : await storage.getExams();

      res.json(examList);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/exams/:id", requireAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const exam = await storage.getExam(id);
      if (!exam) return res.status(404).json({ message: "Exam not found" });
      res.json(exam);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/exams", requireAuth, async (req, res, next) => {
    try {
      const examData = { ...req.body };
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId || null;
      const hasExplicitSchoolId = Object.prototype.hasOwnProperty.call(examData, "schoolId");

      if (currentUser?.role === "org_admin") {
        // Org HQ may intentionally create a global linked exercise/exam by sending schoolId: null.
        // If Org HQ does not send schoolId, use the active school context if there is one.
        if (!hasExplicitSchoolId) {
          examData.schoolId = schoolId;
        }
      } else {
        // School-level users must not be able to create global or other-school linked records.
        examData.schoolId = schoolId;
      }
      
      if (!examData.assessmentTypeId && examData.examTypeId) {
        const examType = await storage.getExamType(examData.examTypeId);
        if (examType && schoolId) {
          const assessmentTypes = await storage.getAssessmentTypes(schoolId);
          const normalName = (s: string) => s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
          const match = assessmentTypes.find(at => normalName(at.name) === normalName(examType.name));
          if (match) {
            examData.assessmentTypeId = match.id;
          }
        }
      }
      const created = await storage.createExam(examData);
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/exams/:id", requireAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateExam(id, req.body);
      if (!updated) return res.status(404).json({ message: "Exam not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/exams/:id", requireAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteExam(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // Record of Marks - grouped by assessment type with sub-columns for each assessment
  app.get("/api/record-of-marks", requireAuth, requireRole("school_admin", "org_admin", "teacher"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "No school context" });

      const classId = parseInt(req.query.classId as string);
      const subjectId = parseInt(req.query.subjectId as string);
      const academicYear = req.query.academicYear ? parseInt(req.query.academicYear as string) : null;
      const dateFrom = req.query.dateFrom as string || null;
      const dateTo = req.query.dateTo as string || null;
      const termFilter = req.query.termFilter as string || null;

      if (!classId || !subjectId || !academicYear) {
        return res.status(400).json({ message: "academicYear, classId and subjectId are required" });
      }

      const classInfo = await storage.getClass(classId);
      if (!classInfo || classInfo.schoolId !== schoolId) {
        return res.status(403).json({ message: "Class not in school context" });
      }

      const subjectInfo = await storage.getSubject(subjectId);
      if (!subjectInfo || subjectInfo.schoolId !== schoolId) {
        return res.status(403).json({ message: "Subject not in school context" });
      }

      const school = await storage.getSchool(schoolId);
      const org = school?.organizationId ? await storage.getOrganization(school.organizationId) : null;
      const calendarConfig = mergeAcademicCalendarSources(school, org);

      const allAssessments = await storage.getAssessmentsByClass(classId);
      const filtered = applyAssessmentFilters(allAssessments, {
        schoolId,
        classId,
        subjectId,
        academicYear,
        dateFrom,
        dateTo,
        termFilter,
        calendarConfig,
      }).sort((a, b) => (a.assessmentDate || "").localeCompare(b.assessmentDate || ""));

      const assessmentTypes = await storage.getAssessmentTypes();
      const typeMap = new Map(assessmentTypes.map(t => [t.id, t.name]));

      const assessmentIds = filtered.map(a => a.id);
      const allMarks = assessmentIds.length > 0
        ? await storage.getAssessmentMarksByAssessments(assessmentIds)
        : [];

      const allPapers: Record<number, any[]> = {};
      for (const a of filtered) {
        const papers = await storage.getAssessmentPapers(a.id);
        allPapers[a.id] = papers.sort((x, y) => (x.sortOrder || 0) - (y.sortOrder || 0));
      }

      const allMarkPapers: Record<number, any[]> = {};
      for (const m of allMarks) {
        const paperMarks = await storage.getMarkPapers(m.id);
        allMarkPapers[m.id] = paperMarks;
      }

      const students = await getHistoricalStudentsForAssessments({
        schoolId,
        classId,
        subjectId,
        assessmentIds,
        includeSiblingAssessmentHistory: false,
        academicYear,
      });

      const grouped: Record<string, { typeName: string; assessments: any[] }> = {};

      for (const a of filtered) {
        const typeKey = a.assessmentTypeId ? a.assessmentTypeId.toString() : "0";
        const typeName = a.assessmentTypeId ? (typeMap.get(a.assessmentTypeId) || "Unknown Type") : "Uncategorized";

        if (!grouped[typeKey]) {
          grouped[typeKey] = { typeName, assessments: [] };
        }

        const papers = allPapers[a.id] || [];
        const dateStr = a.assessmentDate
          ? new Date(a.assessmentDate + "T00:00:00").toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" })
          : "";

        const columns = papers.length > 0
          ? papers.map(p => ({
              paperId: p.id,
              label: p.paperName,
              outOf: p.paperMarks,
              weightPct: parseFloat(p.paperWeightPct as string),
            }))
          : [{ paperId: null, label: "Mark", outOf: a.totalMarks || 100, weightPct: 100 }];

        grouped[typeKey].assessments.push({
          id: a.id,
          name: a.name,
          date: dateStr,
          rawDate: a.assessmentDate || "",
          typeName,
          columns,
        });
      }

      const marksByStudentAssessment: Record<string, any> = {};
      for (const m of allMarks) {
        const key = `${m.studentId}_${m.assessmentId}`;
        const paperMarks = allMarkPapers[m.id] || [];
        marksByStudentAssessment[key] = {
          percentage: m.percentage ? parseFloat(m.percentage) : null,
          attStatus: m.attStatus,
          paperMarks: paperMarks.reduce((acc: Record<number, number | null>, pm: any) => {
            acc[pm.assessmentPaperId] = pm.markObtained !== null ? parseFloat(pm.markObtained) : null;
            return acc;
          }, {}),
        };
      }

      res.json({
        className: classInfo.className,
        subjectName: subjectInfo?.name || "",
        academicYear,
        dateFrom,
        dateTo,
        termFilter,
        groups: Object.values(grouped),
        students: students.map((s: any) => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          admissionNo: s.admissionNo || "",
        })),
        marks: marksByStudentAssessment,
      });
    } catch (error) {
      next(error);
    }
  });

  // Assessment Papers
  app.get("/api/assessments/:assessmentId/papers", requireAuth, async (req, res, next) => {
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, parseInt(req.params.assessmentId));
      if (!scoped) return;

      const papers = await storage.getAssessmentPapers(scoped.assessment.id);
      res.json(papers);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/assessments/:assessmentId/papers", requireAuth, async (req, res, next) => {
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, parseInt(req.params.assessmentId));
      if (!scoped) return;
      if (await rejectIfAssessmentPublished(scoped.assessment, res)) return;

      const papers = Array.isArray(req.body.papers) ? req.body.papers : [];
      const papersWithAssessmentId = papers.map((p: any, i: number) => ({ ...p, assessmentId: scoped.assessment.id, sortOrder: i }));
      const result = await storage.setAssessmentPapers(scoped.assessment.id, papersWithAssessmentId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Assessment Comments - enriched list with class/subject/grade names, sorted Class→Subject→Grade
  app.get("/api/assessment-comments", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const classId = req.query.classId ? Number(req.query.classId) : undefined;
      const subjectId = req.query.subjectId ? Number(req.query.subjectId) : undefined;

      if (classId) {
        const classInfo = await ensureClassInSchool(classId, schoolId, res);
        if (!classInfo) return;
      }
      if (subjectId) {
        const subjectInfo = await ensureSubjectInSchool(subjectId, schoolId, res);
        if (!subjectInfo) return;
      }

      let comments = await storage.getAssessmentComments(schoolId, classId, subjectId);
      const teacherScope = await getTeacherAssignmentScope(req, schoolId);
      if (teacherScope) {
        comments = comments.filter((comment) =>
          isPairInTeacherAssignments(
            teacherScope.assignments,
            Number(comment.classId),
            Number(comment.subjectId),
          )
        );
      }

      const gradeRankMap: Record<string, number> = { 'A*': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'U': 6 };

      const enriched = await Promise.all(comments.map(async (c) => {
        const cls = await storage.getClass(c.classId);
        const subject = await storage.getSubject(c.subjectId);
        const grade = await storage.getGrade(c.gradeId);
        const gradeName = grade?.gradeName || "";
        const gradeRank = gradeRankMap[gradeName.toUpperCase().replace(/\s/g, '')] ?? 999;
        return {
          ...c,
          className: cls?.className || "",
          subjectName: subject?.name || "",
          gradeName,
          gradeRank,
        };
      }));

      enriched.sort((a, b) => {
        const cmp1 = a.className.localeCompare(b.className, undefined, { numeric: true });
        if (cmp1 !== 0) return cmp1;
        const cmp2 = a.subjectName.localeCompare(b.subjectName, undefined, { numeric: true });
        if (cmp2 !== 0) return cmp2;
        return a.gradeRank - b.gradeRank;
      });

      const result = enriched.map(({ gradeRank, ...rest }) => rest);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Bulk create comments (multi class × multi subject × single grade)
  app.post("/api/assessment-comments", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const { classIds, subjectIds, gradeId, commentText } = req.body;
      if (!Array.isArray(classIds) || !classIds.length) return res.status(400).json({ message: "At least one class required" });
      if (!Array.isArray(subjectIds) || !subjectIds.length) return res.status(400).json({ message: "At least one subject required" });
      if (!gradeId) return res.status(400).json({ message: "Grade is required" });
      if (!commentText?.trim()) return res.status(400).json({ message: "Comment text is required" });

      const grade = await ensureGradeInSchool(Number(gradeId), schoolId, res);
      if (!grade) return;

      let created = 0;
      for (const cid of classIds) {
        for (const sid of subjectIds) {
          const pair = await ensureAssessmentCommentPairAllowed(req, res, schoolId, Number(cid), Number(sid));
          if (!pair) return;

          const existing = await storage.findAssessmentComment(Number(cid), Number(sid), Number(grade.id));
          if (existing) continue;
          await storage.createAssessmentComment({
            schoolId,
            classId: Number(cid),
            subjectId: Number(sid),
            gradeId: Number(grade.id),
            commentText: commentText.trim(),
          });
          created++;
        }
      }

      res.status(201).json({ created });
    } catch (error) {
      next(error);
    }
  });

  // Pre-check duplicates before bulk create
  app.post("/api/assessment-comments/check-duplicates", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const { classIds, subjectIds, gradeId } = req.body;
      if (!Array.isArray(classIds) || !Array.isArray(subjectIds) || !gradeId) {
        return res.status(400).json({ message: "classIds, subjectIds and gradeId are required" });
      }

      const grade = await ensureGradeInSchool(Number(gradeId), schoolId, res);
      if (!grade) return;

      const duplicates: any[] = [];
      const missingPairs: any[] = [];

      for (const cid of classIds) {
        for (const sid of subjectIds) {
          const pair = await ensureAssessmentCommentPairAllowed(req, res, schoolId, Number(cid), Number(sid));
          if (!pair) return;
          const { classInfo: cls, subjectInfo: subject } = pair;

          const existing = await storage.findAssessmentComment(Number(cid), Number(sid), Number(gradeId));

          if (existing) {
            duplicates.push({
              id: existing.id,
              classId: Number(cid),
              subjectId: Number(sid),
              className: cls.className || "",
              subjectName: subject.name || "",
              gradeName: grade.gradeName || "",
              commentText: existing.commentText,
            });
          } else {
            missingPairs.push({
              classId: Number(cid),
              subjectId: Number(sid),
              className: cls.className || "",
              subjectName: subject.name || "",
            });
          }
        }
      }

      duplicates.sort((a, b) => {
        const c = a.className.localeCompare(b.className, undefined, { numeric: true });
        if (c !== 0) return c;
        return a.subjectName.localeCompare(b.subjectName, undefined, { numeric: true });
      });

      res.json({ duplicates, missingPairs });
    } catch (error) {
      next(error);
    }
  });

  // Overwrite selected duplicates + create missing pairs
  app.post("/api/assessment-comments/overwrite-and-create", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const { overwriteIds, missingPairs, gradeId, commentText } = req.body;
      if (!gradeId) return res.status(400).json({ message: "Grade required" });
      if (!commentText?.trim()) return res.status(400).json({ message: "Comment text required" });

      const grade = await ensureGradeInSchool(Number(gradeId), schoolId, res);
      if (!grade) return;

      let overwritten = 0;
      if (Array.isArray(overwriteIds)) {
        for (const id of overwriteIds) {
          const scopedComment = await getScopedAssessmentCommentOrRespond(req, res, Number(id));
          if (!scopedComment) return;

          if (scopedComment.comment.gradeId === Number(grade.id)) {
            await storage.updateAssessmentComment(scopedComment.comment.id, { commentText: commentText.trim() });
            overwritten++;
          }
        }
      }

      let created = 0;
      if (Array.isArray(missingPairs)) {
        for (const pair of missingPairs) {
          const allowedPair = await ensureAssessmentCommentPairAllowed(
            req,
            res,
            schoolId,
            Number(pair.classId),
            Number(pair.subjectId),
          );
          if (!allowedPair) return;

          const existing = await storage.findAssessmentComment(Number(pair.classId), Number(pair.subjectId), Number(grade.id));
          if (existing) continue;
          await storage.createAssessmentComment({
            schoolId,
            classId: Number(pair.classId),
            subjectId: Number(pair.subjectId),
            gradeId: Number(grade.id),
            commentText: commentText.trim(),
          });
          created++;
        }
      }

      res.json({ overwritten, created });
    } catch (error) {
      next(error);
    }
  });

  // Update a single comment's text
  app.put("/api/assessment-comments/:id", requireAuth, async (req, res, next) => {
    try {
      const scopedComment = await getScopedAssessmentCommentOrRespond(req, res, parseInt(req.params.id));
      if (!scopedComment) return;

      const { commentText } = req.body;
      if (!commentText?.trim()) return res.status(400).json({ message: "Comment text is required" });
      const updated = await storage.updateAssessmentComment(scopedComment.comment.id, { commentText: commentText.trim() });
      if (!updated) return res.status(404).json({ message: "Comment not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/assessment-comments/:id", requireAuth, async (req, res, next) => {
    try {
      const scopedComment = await getScopedAssessmentCommentOrRespond(req, res, parseInt(req.params.id));
      if (!scopedComment) return;

      await storage.deleteAssessmentComment(scopedComment.comment.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // Report Comments (Principal / Class Teacher)
  const normalizeReportCommentClassIds = (payload: any): number[] => {
    const rawClassIds = (() => {
      if (Array.isArray(payload?.classIds)) return payload.classIds;
      if (typeof payload?.classIds === "string") {
        try {
          const parsed = JSON.parse(payload.classIds);
          if (Array.isArray(parsed)) return parsed;
        } catch {}
        return payload.classIds.split(",").map((value: string) => value.trim()).filter(Boolean);
      }
      if (Array.isArray(payload?.classes)) return payload.classes;
      if (payload?.classId !== undefined && payload?.classId !== null) return [payload.classId];
      return [];
    })();
    return rawClassIds
      .map((value: any) => typeof value === "object" && value !== null ? Number(value.id ?? value.value ?? value.classId) : Number(value))
      .filter((value: number) => Number.isFinite(value) && value > 0);
  };

  const reportCommentMatchesGrade = (comment: any, gradeId: number | null, commentGrade: string, gradeLevel?: string | null) => {
    if (gradeId && comment.gradeId === gradeId) return true;
    return comment.commentGrade === commentGrade && (comment.gradeLevel || null) === (gradeLevel || null);
  };

  function resolveReportCommentGradeForAverage(grades: any[], averagePercentage: number | null) {
    if (averagePercentage === null) return null;
    const roundedAverage = Math.round(averagePercentage);
    const orderedGrades = [...grades].sort((a, b) => (Number(b.upperLimit) || 0) - (Number(a.upperLimit) || 0));
    return orderedGrades.find((grade) => roundedAverage >= Number(grade.lowerLimit) && roundedAverage <= Number(grade.upperLimit)) || null;
  }

  function findReportCommentForConfiguredGrade(args: {
    comments: any[];
    commentType: "principal" | "class_teacher";
    grade: any | null;
    profileKey?: string | null;
    classId?: number | null;
  }) {
    if (!args.grade) return "";
    const compatibleKeys = new Set(getCompatibleGradeProfileKeys(args.profileKey));
    const matches = args.comments.filter((comment) => {
      if (comment.commentType !== args.commentType) return false;
      if (args.commentType === "class_teacher" && args.classId && comment.classId && Number(comment.classId) !== Number(args.classId)) return false;
      if (comment.gradeId && Number(comment.gradeId) === Number(args.grade.id)) return true;
      if ((comment.commentGrade || "") !== (args.grade.gradeName || "")) return false;
      if (!comment.gradeLevel) return true;
      if (compatibleKeys.size === 0) return comment.gradeLevel === args.profileKey;
      return compatibleKeys.has(comment.gradeLevel);
    });

    const exactClass = args.commentType === "class_teacher" && args.classId
      ? matches.find((comment) => Number(comment.classId) === Number(args.classId))
      : undefined;
    return (exactClass || matches.find((comment) => !comment.classId) || matches[0] || {}).commentText || "";
  }

  const REPORT_CARD_OVERRIDE_PREFIX = "__REPORT_CARD_OVERRIDE__";

  function buildReportCardOverrideKey(studentId: number, examId: number) {
    return `${REPORT_CARD_OVERRIDE_PREFIX}:${studentId}:${examId}`;
  }

  function parseReportCardOverrideKey(value: string | null | undefined): { studentId: number; examId: number } | null {
    if (!value || typeof value !== "string") return null;
    const match = value.match(/^__REPORT_CARD_OVERRIDE__:(\d+):(\d+)$/);
    if (!match) return null;
    const studentId = Number(match[1]);
    const examId = Number(match[2]);
    if (!Number.isFinite(studentId) || !Number.isFinite(examId)) return null;
    return { studentId, examId };
  }

  async function getReportCardCommentOverrideMap(schoolId: number, examId: number, studentIds?: number[]) {
    const rows = await db
      .select()
      .from(reportComments)
      .where(and(
        eq(reportComments.schoolId, schoolId),
        like(reportComments.commentGrade, `${REPORT_CARD_OVERRIDE_PREFIX}:%:${examId}`),
      ));

    const allowedStudentIds = studentIds ? new Set(studentIds.map((id) => Number(id))) : null;
    const map = new Map<number, { principal?: string; class_teacher?: string }>();

    for (const row of rows) {
      const parsed = parseReportCardOverrideKey(row.commentGrade);
      if (!parsed || parsed.examId !== examId) continue;
      if (allowedStudentIds && !allowedStudentIds.has(parsed.studentId)) continue;
      const entry = map.get(parsed.studentId) || {};
      if (row.commentType === "principal") entry.principal = row.commentText || "";
      if (row.commentType === "class_teacher") entry.class_teacher = row.commentText || "";
      map.set(parsed.studentId, entry);
    }

    return map;
  }

  app.get("/api/report-comments", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "No school context" });
      const commentType = req.query.commentType as string | undefined;
      const comments = await storage.getReportComments(schoolId, commentType);
      res.json(comments);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/report-comments", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "No school context" });
      const { gradeId, commentGrade, commentText, commentType, gradeLevel } = req.body;
      if (!commentText || !commentType) {
        return res.status(400).json({ message: "commentText and commentType are required" });
      }
      if (!["principal", "class_teacher"].includes(commentType)) {
        return res.status(400).json({ message: "commentType must be 'principal' or 'class_teacher'" });
      }
      const normalizedClassIds = normalizeReportCommentClassIds(req.body);
      if (commentType === "class_teacher" && normalizedClassIds.length === 0) {
        return res.status(400).json({ message: "classId is required for class teacher comments" });
      }
      let resolvedCommentGrade = commentGrade;
      let resolvedGradeLevel = gradeLevel;
      let resolvedGradeId = gradeId ? Number(gradeId) : null;
      if (resolvedGradeId) {
        const grade = await ensureGradeInSchool(resolvedGradeId, schoolId, res);
        if (!grade) return;
        resolvedCommentGrade = grade.gradeName;
        resolvedGradeLevel = grade.gradeLevel;
      }
      if (!resolvedCommentGrade) {
        return res.status(400).json({ message: "A grade must be selected" });
      }
      const createdComments = [];
      if (commentType === "class_teacher") {
        for (const selectedClassId of normalizedClassIds) {
          const classInfo = await ensureClassInSchool(selectedClassId, schoolId, res);
          if (!classInfo) return;
          const comment = await storage.createReportComment({
            schoolId,
            gradeId: resolvedGradeId,
            commentGrade: resolvedCommentGrade,
            gradeLevel: resolvedGradeLevel,
            subjectId: null,
            commentText,
            commentType,
            classId: selectedClassId,
          } as any);
          createdComments.push(comment);
        }
        return res.status(201).json(createdComments);
      }
      const comment = await storage.createReportComment({
        schoolId,
        gradeId: resolvedGradeId,
        commentGrade: resolvedCommentGrade,
        gradeLevel: resolvedGradeLevel,
        subjectId: null,
        commentText,
        commentType,
      } as any);
      res.status(201).json(comment);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/report-comments/check-duplicates", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "No school context" });
      const { commentType, gradeId, gradeLevel } = req.body;
      if (!commentType || !["principal", "class_teacher"].includes(commentType)) {
        return res.status(400).json({ message: "commentType is required" });
      }
      if (!gradeId) return res.status(400).json({ message: "gradeId is required" });

      const grade = await ensureGradeInSchool(Number(gradeId), schoolId, res);
      if (!grade) return;
      const resolvedGradeId = Number(grade.id);
      const resolvedCommentGrade = grade.gradeName;
      const resolvedGradeLevel = grade.gradeLevel || gradeLevel || null;
      const allComments = await storage.getReportComments(schoolId, commentType);

      if (commentType === "principal") {
        const existing = allComments.find((comment: any) => reportCommentMatchesGrade(comment, resolvedGradeId, resolvedCommentGrade, resolvedGradeLevel));
        if (existing) {
          return res.json({
            duplicates: [{
              id: existing.id,
              gradeName: resolvedCommentGrade,
              commentText: existing.commentText,
            }],
            missingTargets: [],
          });
        }
        return res.json({ duplicates: [], missingTargets: [{ gradeName: resolvedCommentGrade }] });
      }

      const normalizedClassIds = normalizeReportCommentClassIds(req.body);
      if (normalizedClassIds.length === 0) {
        return res.status(400).json({ message: "classId is required for class teacher comments" });
      }

      const duplicates: any[] = [];
      const missingTargets: any[] = [];
      for (const classId of normalizedClassIds) {
        const classInfo = await ensureClassInSchool(classId, schoolId, res);
        if (!classInfo) return;
        const existing = allComments.find((comment: any) => Number(comment.classId) === classId && reportCommentMatchesGrade(comment, resolvedGradeId, resolvedCommentGrade, resolvedGradeLevel));
        if (existing) {
          duplicates.push({
            id: existing.id,
            classId,
            className: classInfo.className || "",
            gradeName: resolvedCommentGrade,
            commentText: existing.commentText,
          });
        } else {
          missingTargets.push({
            classId,
            className: classInfo.className || "",
          });
        }
      }
      duplicates.sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }));
      return res.json({ duplicates, missingTargets });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/report-comments/overwrite-and-create", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "No school context" });
      const { overwriteIds, missingTargets, gradeId, gradeLevel, commentText, commentType } = req.body;
      if (!commentText?.trim()) return res.status(400).json({ message: "commentText is required" });
      if (!commentType || !["principal", "class_teacher"].includes(commentType)) {
        return res.status(400).json({ message: "commentType is required" });
      }
      if (!gradeId) return res.status(400).json({ message: "gradeId is required" });

      const grade = await ensureGradeInSchool(Number(gradeId), schoolId, res);
      if (!grade) return;
      const resolvedGradeId = Number(grade.id);
      const resolvedCommentGrade = grade.gradeName;
      const resolvedGradeLevel = grade.gradeLevel || gradeLevel || null;

      let overwritten = 0;
      if (Array.isArray(overwriteIds)) {
        for (const id of overwriteIds) {
          const [existing] = await db.select().from(reportComments).where(and(eq(reportComments.id, Number(id)), eq(reportComments.schoolId, schoolId), eq(reportComments.commentType, commentType as any)));
          if (!existing) continue;
          await db.update(reportComments).set({
            commentText: commentText.trim(),
            gradeId: resolvedGradeId,
            commentGrade: resolvedCommentGrade,
            gradeLevel: resolvedGradeLevel,
          }).where(and(eq(reportComments.id, existing.id), eq(reportComments.schoolId, schoolId)));
          overwritten++;
        }
      }

      let created = 0;
      if (Array.isArray(missingTargets)) {
        for (const target of missingTargets) {
          let classId: number | null = null;
          if (commentType === "class_teacher") {
            classId = Number(target.classId);
            const classInfo = await ensureClassInSchool(classId, schoolId, res);
            if (!classInfo) return;
          }
          await storage.createReportComment({
            schoolId,
            gradeId: resolvedGradeId,
            commentGrade: resolvedCommentGrade,
            gradeLevel: resolvedGradeLevel,
            subjectId: null,
            commentText: commentText.trim(),
            commentType,
            classId,
          } as any);
          created++;
        }
      }

      return res.json({ overwritten, created });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/report-comments/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "No school context" });
      const id = parseInt(req.params.id);
      await storage.deleteReportComment(id, schoolId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/report-card-subject-comments", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const studentId = Number(req.body?.studentId);
      const assessmentId =
        req.body?.assessmentId === null || req.body?.assessmentId === undefined || req.body?.assessmentId === ""
          ? null
          : Number(req.body.assessmentId);
      const examId =
        req.body?.examId === null || req.body?.examId === undefined || req.body?.examId === ""
          ? null
          : Number(req.body.examId);
      const classId =
        req.body?.classId === null || req.body?.classId === undefined || req.body?.classId === ""
          ? null
          : Number(req.body.classId);
      const subjectId =
        req.body?.subjectId === null || req.body?.subjectId === undefined || req.body?.subjectId === ""
          ? null
          : Number(req.body.subjectId);
      const commentText = typeof req.body?.commentText === "string" ? req.body.commentText : "";

      if (!Number.isFinite(studentId)) {
        return res.status(400).json({ message: "studentId is required" });
      }

      let assessment =
        assessmentId !== null && Number.isFinite(assessmentId)
          ? await storage.getAssessment(assessmentId)
          : null;

      if (!assessment && Number.isFinite(examId) && Number.isFinite(classId) && Number.isFinite(subjectId)) {
        const examAssessments = await storage.getAssessmentsByExam(Number(examId));
        const matchingAssessments = examAssessments
          .filter(
            (candidate) =>
              Number(candidate.classId) === Number(classId) &&
              Number(candidate.subjectId) === Number(subjectId),
          )
          .sort((a, b) => Number(b.id) - Number(a.id));
        assessment = matchingAssessments[0] || null;
      }

      if (!assessment || Number(assessment.schoolId) !== Number(schoolId)) {
        return res.status(404).json({ message: "Assessment not found" });
      }
      if (await rejectIfAssessmentPublished(assessment, res)) return;

      const student = await ensureStudentInSchool(studentId, schoolId, res);
      if (!student) return;
      if (Number(student.classId) !== Number(assessment.classId)) {
        return res.status(400).json({ message: "Student does not belong to the assessment class" });
      }

      const existingMark = await storage.getAssessmentMarkByStudentAssessment(studentId, Number(assessment.id));
      if (!existingMark || Number(existingMark.schoolId) !== Number(schoolId)) {
        return res.status(404).json({ message: "Assessment mark not found" });
      }

      let poolCommentId: number | null = null;
      let poolCommentText: string | null = null;
      if (existingMark.gradeId) {
        const poolComment = await storage.findAssessmentComment(
          Number(assessment.classId),
          Number(assessment.subjectId),
          Number(existingMark.gradeId),
        );
        if (poolComment) {
          poolCommentId = poolComment.id;
          poolCommentText = poolComment.commentText;
        }
      }

      const trimmed = commentText.trim();
      const usePool = trimmed.length === 0;
      const updated = await storage.updateAssessmentMark(existingMark.id, {
        commentId: usePool ? poolCommentId : null,
        customCommentText: usePool ? null : trimmed,
        autoCommentSnapshot: poolCommentText,
        commentSource: usePool ? "pool" : "custom",
      });

      if (!updated) {
        return res.status(500).json({ message: "Failed to save subject comment" });
      }

      return res.json({
        ok: true,
        assessmentId: Number(assessment.id),
        commentText: usePool ? (poolCommentText || "") : trimmed,
        commentPool: poolCommentText || "",
        commentSource: usePool ? "pool" : "custom",
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/report-card-comment-overrides", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "No school context" });

      const examId = Number(req.body?.examId);
      const studentId = Number(req.body?.studentId);
      const commentType = req.body?.commentType;
      const commentText = typeof req.body?.commentText === "string" ? req.body.commentText : "";

      if (!Number.isFinite(examId) || !Number.isFinite(studentId)) {
        return res.status(400).json({ message: "examId and studentId are required" });
      }
      if (commentType !== "principal" && commentType !== "class_teacher") {
        return res.status(400).json({ message: "commentType must be 'principal' or 'class_teacher'" });
      }

      const student = await storage.getStudent(studentId);
      if (!student || Number(student.schoolId) !== Number(schoolId)) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (student.classId && await isClassExamPublished(examId, Number(student.classId))) {
        return res.status(423).json({ message: "This report has been published. Comments are read-only until it is unpublished.", code: "ASSESSMENT_PUBLISHED" });
      }

      const overrideKey = buildReportCardOverrideKey(studentId, examId);
      const [existing] = await db
        .select()
        .from(reportComments)
        .where(and(
          eq(reportComments.schoolId, schoolId),
          eq(reportComments.commentType, commentType as any),
          eq(reportComments.commentGrade, overrideKey),
        ));

      const trimmed = commentText.trim();
      if (!trimmed) {
        if (existing) {
          await db.delete(reportComments).where(eq(reportComments.id, existing.id));
        }
        return res.json({ ok: true, overrideText: null });
      }

      if (existing) {
        await db
          .update(reportComments)
          .set({
            commentText: trimmed,
            classId: commentType === "class_teacher" ? student.classId ?? null : null,
          })
          .where(eq(reportComments.id, existing.id));
      } else {
        await db.insert(reportComments).values({
          schoolId,
          gradeId: null,
          commentGrade: overrideKey,
          gradeLevel: null,
          subjectId: null,
          classId: commentType === "class_teacher" ? student.classId ?? null : null,
          commentText: trimmed,
          commentType,
        });
      }

      res.json({ ok: true, overrideText: trimmed });
    } catch (error) {
      next(error);
    }
  });

  // Enhanced Assessments with Papers
  app.get("/api/assessments", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const classId = req.query.classId ? Number(req.query.classId) : undefined;
      const subjectId = req.query.subjectId ? Number(req.query.subjectId) : undefined;
      const academicYear = req.query.academicYear ? Number(req.query.academicYear) : undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const termFilter = req.query.termFilter as string | undefined;
      const search = req.query.search as string | undefined;

      if (classId) {
        const classInfo = await ensureClassInSchool(classId, schoolId, res);
        if (!classInfo) return;
      }
      if (subjectId) {
        const subjectInfo = await ensureSubjectInSchool(subjectId, schoolId, res);
        if (!subjectInfo) return;
      }

      const school = await storage.getSchool(schoolId);
      const org = school?.organizationId ? await storage.getOrganization(school.organizationId) : null;
      const calendarConfig = mergeAcademicCalendarSources(school, org);
      const teacherScope = await getTeacherAssignmentScope(req, schoolId);

      let assessmentList;
      if (classId) {
        assessmentList = await storage.getAssessmentsByClass(classId);
      } else {
        assessmentList = await storage.getAllAssessments();
      }

      assessmentList = applyAssessmentFilters(assessmentList, {
        schoolId,
        classId,
        subjectId,
        academicYear,
        dateFrom,
        dateTo,
        termFilter,
        calendarConfig,
      });

      if (teacherScope) {
        assessmentList = assessmentList.filter((assessment: any) =>
          isPairInTeacherAssignments(
            teacherScope.assignments,
            Number(assessment.classId),
            Number(assessment.subjectId),
          )
        );
      }

      if (search) {
        const lowerSearch = search.toLowerCase();
        assessmentList = assessmentList.filter((a) =>
          a.name?.toLowerCase().includes(lowerSearch) ||
          a.topic?.toLowerCase().includes(lowerSearch)
        );
      }

      const withPapers = await Promise.all(
        assessmentList.map(async (a) => {
          const papers = await storage.getAssessmentPapers(a.id);
          return { ...a, papers };
        })
      );

      res.json(withPapers);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/assessments", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const { papers, schoolId: _ignoredSchoolId, ...assessmentData } = req.body;

      if (!Array.isArray(papers) || papers.length < 1) {
        return res.status(400).json({ message: "At least one paper is required" });
      }

      const validatedRefs = await validateAssessmentPayloadForSchool(schoolId, assessmentData, res);
      if (!validatedRefs) return;

      if (assessmentData.examId && await isClassExamPublished(Number(assessmentData.examId), Number(assessmentData.classId))) {
        return res.status(423).json({ message: "This exercise/exam has already been published for the class. New assessments cannot be added until it is unpublished.", code: "ASSESSMENT_PUBLISHED" });
      }

      const hasTeacherAssignment = await ensureTeacherAssignmentForAssessment(
        req,
        res,
        schoolId,
        Number(assessmentData.classId),
        Number(assessmentData.subjectId),
      );
      if (!hasTeacherAssignment) return;

      const assessmentWithName = {
        ...assessmentData,
        schoolId,
        classId: Number(assessmentData.classId),
        subjectId: Number(assessmentData.subjectId),
        assessmentTypeId: assessmentData.assessmentTypeId ? Number(assessmentData.assessmentTypeId) : null,
        examId: assessmentData.examId ? Number(assessmentData.examId) : null,
        name: assessmentData.name || assessmentData.topic,
        isPublished: true,
      };

      const assessment = await storage.createAssessment(assessmentWithName);

      const papersWithAssessmentId = papers.map((p: any, i: number) => ({
        ...p,
        assessmentId: assessment.id,
        sortOrder: i,
      }));
      await storage.setAssessmentPapers(assessment.id, papersWithAssessmentId);

      const savedPapers = await storage.getAssessmentPapers(assessment.id);
      res.status(201).json({ ...assessment, papers: savedPapers });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/assessments/:id", requireAuth, async (req, res, next) => {
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, parseInt(req.params.id));
      if (!scoped) return;
      if (await rejectIfAssessmentPublished(scoped.assessment, res)) return;

      const { papers, schoolId: _ignoredSchoolId, ...assessmentData } = req.body;

      if (papers !== undefined && (!Array.isArray(papers) || papers.length < 1)) {
        return res.status(400).json({ message: "At least one paper is required" });
      }

      if (assessmentData.topic && !assessmentData.name) {
        assessmentData.name = assessmentData.topic;
      }

      const validatedRefs = await validateAssessmentPayloadForSchool(scoped.schoolId, assessmentData, res, scoped.assessment);
      if (!validatedRefs) return;

      const resolvedClassId = assessmentData.classId !== undefined ? Number(assessmentData.classId) : Number(scoped.assessment.classId);
      const resolvedSubjectId = assessmentData.subjectId !== undefined ? Number(assessmentData.subjectId) : Number(scoped.assessment.subjectId);
      const hasTeacherAssignment = await ensureTeacherAssignmentForAssessment(
        req,
        res,
        scoped.schoolId,
        resolvedClassId,
        resolvedSubjectId,
      );
      if (!hasTeacherAssignment) return;

      const updatePayload = {
        ...assessmentData,
        schoolId: scoped.schoolId,
        classId: assessmentData.classId !== undefined ? Number(assessmentData.classId) : scoped.assessment.classId,
        subjectId: assessmentData.subjectId !== undefined ? Number(assessmentData.subjectId) : scoped.assessment.subjectId,
        assessmentTypeId: assessmentData.assessmentTypeId === undefined
          ? scoped.assessment.assessmentTypeId
          : (assessmentData.assessmentTypeId ? Number(assessmentData.assessmentTypeId) : null),
        examId: assessmentData.examId === undefined
          ? scoped.assessment.examId
          : (assessmentData.examId ? Number(assessmentData.examId) : null),
        isPublished: true,
      };

      const updated = await storage.updateAssessment(scoped.assessment.id, updatePayload);
      if (!updated) return res.status(404).json({ message: "Assessment not found" });

      if (papers !== undefined) {
        const papersWithAssessmentId = papers.map((p: any, i: number) => ({
          ...p,
          assessmentId: scoped.assessment.id,
          sortOrder: i,
        }));
        await storage.setAssessmentPapers(scoped.assessment.id, papersWithAssessmentId);
      }

      const savedPapers = await storage.getAssessmentPapers(scoped.assessment.id);
      res.json({ ...updated, papers: savedPapers });
    } catch (error) {
      next(error);
    }
  });

  // ==================== MARKS ENTRY ====================
  
  // Get marks entry data for an assessment (students with their marks)
  app.get("/api/marks-entry/:assessmentId", requireAuth, async (req, res, next) => {
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, parseInt(req.params.assessmentId));
      if (!scoped) return;

      const assessmentId = scoped.assessment.id;
      const assessment = scoped.assessment;

      const papers = await storage.getAssessmentPapers(assessmentId);

      const students = await getHistoricalStudentsForAssessments({
        schoolId: scoped.schoolId,
        classId: assessment.classId,
        subjectId: assessment.subjectId,
        assessmentIds: [assessmentId],
        includeSiblingAssessmentHistory: true,
        academicYear: assessment.year || null,
      });

      const marks = await storage.getAssessmentMarks(assessmentId);
      const marksWithPapers = await Promise.all(marks.map(async (mark) => {
        const paperMarks = await storage.getMarkPapers(mark.id);
        return { ...mark, paperMarks };
      }));

      const marksByStudent: Record<number, any> = {};
      for (const mark of marksWithPapers) {
        marksByStudent[mark.studentId] = mark;
      }

      const allGrades = await storage.getGradesBySchool(assessment.schoolId || 0);
      const { profileKey } = await resolveGradeProfileContext({
        schoolId: assessment.schoolId || scoped.schoolId,
        classId: assessment.classId,
        subjectId: assessment.subjectId,
      });
      const grades = profileKey
        ? getApplicableGradesForContext(allGrades, { profileKey, classId: assessment.classId })
        : [];

      const comments = await storage.getAssessmentComments(assessment.schoolId || undefined, assessment.classId, assessment.subjectId);

      const publication = assessment.examId ? await getClassExamPublication(Number(assessment.examId), Number(assessment.classId)) : undefined;
      res.json({
        assessment,
        papers,
        students,
        marksByStudent,
        grades,
        comments,
        gradeProfileKey: profileKey,
        publication: {
          isPublished: publication?.isPublished === true,
          status: publication?.isPublished ? (publication.lastAction === "republished" ? "Republished" : "Published") : "Unpublished",
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Helper function to calculate grade from percentage
  function calculateGrade(percentage: number, grades: any[], subjectType?: string | null): {
    gradeId: number | null;
    gradeName: string;
    ambiguous: boolean;
    matchingGradeIds: number[];
  } {
    const resolution = resolveGradeForPercentage(percentage, grades, subjectType);
    return {
      gradeId: resolution.grade ? Number(resolution.grade.id) : null,
      gradeName: resolution.grade?.gradeName || "",
      ambiguous: resolution.ambiguous,
      matchingGradeIds: resolution.matchingGradeIds,
    };
  }

  // Save/update marks for a student
  app.post("/api/marks-entry", requireAuth, async (req, res, next) => {
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, Number(req.body.assessmentId));
      if (!scoped) return;
      if (await rejectIfAssessmentPublished(scoped.assessment, res)) return;

      const { studentId, paperMarks, attStatus, customCommentText, commentSource } = req.body;
      if (!Array.isArray(paperMarks)) {
        return res.status(400).json({ message: "paperMarks is required" });
      }

      const assessment = scoped.assessment;
      const schoolId = scoped.schoolId;
      const classId = assessment.classId;
      const subjectId = assessment.subjectId;

      const student = await ensureStudentInSchool(Number(studentId), schoolId, res);
      if (!student) return;

      const historicalStudents = await getHistoricalStudentsForAssessments({
        schoolId,
        classId,
        subjectId,
        assessmentIds: [assessment.id],
        includeSiblingAssessmentHistory: true,
        academicYear: assessment.year || null,
      });
      const historicalStudentIds = new Set(historicalStudents.map((item: any) => item.id));
      if (student.classId !== classId && !historicalStudentIds.has(student.id)) {
        return res.status(400).json({ message: "Student does not belong to the assessment class history" });
      }

      // Get assessment papers to calculate weighted percentage
      const papers = await storage.getAssessmentPapers(assessment.id);
      

      const normalizedPaperMarks = paperMarks.map((pm: any) => {
        const markValue = pm?.markObtained;
        if (markValue === null || markValue === undefined || markValue === "") {
          return { ...pm, markObtained: null };
        }
        const numericMark = Number(markValue);
        if (!Number.isFinite(numericMark) || !Number.isInteger(numericMark)) {
          throw new Error("Marks must be whole numbers only");
        }
        const paper = papers.find(p => p.id === pm.assessmentPaperId);
        if (paper && numericMark > Number(paper.paperMarks)) {
          throw new Error(`Mark cannot exceed ${paper.paperMarks}`);
        }
        if (numericMark < 0) {
          throw new Error("Marks cannot be negative");
        }
        return { ...pm, markObtained: numericMark.toString() };
      });

      const hasAnyPaperMark = normalizedPaperMarks.some(
        (pm: any) => pm.markObtained !== null && pm.markObtained !== undefined && pm.markObtained !== "",
      );
      const allowedMarkStatuses = new Set(["none", "present", "absent", "sick", "excused"]);
      const requestedStatus = String(attStatus || "none").trim().toLowerCase();
      let normalizedAttStatus = allowedMarkStatuses.has(requestedStatus) ? requestedStatus : "none";

      // A numeric mark always means the learner was present. A blank row explicitly
      // marked Present is incomplete, so it is saved as the neutral --- status.
      if (hasAnyPaperMark) {
        normalizedAttStatus = "present";
      } else if (normalizedAttStatus === "present") {
        normalizedAttStatus = "none";
      }

      // Calculate weighted percentage
      let totalWeightedScore = 0;
      let totalWeight = 0;
      
      for (const pm of normalizedPaperMarks) {
        const paper = papers.find(p => p.id === pm.assessmentPaperId);
        if (paper && pm.markObtained !== null && pm.markObtained !== "") {
          const markPct = (parseFloat(pm.markObtained) / paper.paperMarks) * 100;
          const weight = parseFloat(paper.paperWeightPct as string);
          totalWeightedScore += (markPct * weight) / 100;
          totalWeight += weight;
        }
      }
      
      const allRequiredPapersMarked = papers.length > 0 && papers.every((paper: any) =>
        normalizedPaperMarks.some((pm: any) =>
          Number(pm.assessmentPaperId) === Number(paper.id) &&
          pm.markObtained !== null && pm.markObtained !== undefined && pm.markObtained !== ""
        )
      );
      const percentage = allRequiredPapersMarked && totalWeight > 0 ? Math.round(totalWeightedScore) : null;
      
      // Get grade from percentage only after every required paper has been recorded.
      const allGrades = await storage.getGradesBySchool(schoolId);
      const { profileKey } = await resolveGradeProfileContext({
        schoolId,
        classId,
        subjectId,
      });
      const grades = profileKey
        ? getApplicableGradesForContext(allGrades, { profileKey, classId })
        : [];
      const subject = await storage.getSubject(subjectId);
      const gradeResolution = percentage !== null
        ? calculateGrade(percentage, grades, subject?.subjectType)
        : { gradeId: null, gradeName: "", ambiguous: false, matchingGradeIds: [] as number[] };
      const { gradeId, gradeName } = gradeResolution;

      if (percentage !== null && (!gradeId || gradeResolution.ambiguous)) {
        const detail = gradeResolution.ambiguous
          ? `Overlapping grade ranges matched IDs: ${gradeResolution.matchingGradeIds.join(", ")}`
          : `No grade range covers ${percentage}%`;
        console.warn("[MARK_GRADE_RESOLUTION_FAILED]", {
          assessmentId: assessment.id,
          studentId: Number(studentId),
          schoolId,
          classId,
          subjectId,
          percentage,
          profileKey,
          detail,
        });
        return res.status(422).json({
          message: gradeResolution.ambiguous
            ? "This mark matches overlapping grade ranges. Please correct the grading configuration before saving."
            : `No grade is configured for ${percentage}% in this class and subject. Please correct the grading configuration before saving.`,
          code: "GRADE_CONFIGURATION_INVALID",
          percentage,
          profileKey,
        });
      }
      
      // Always look up pool comment for this grade (used for auto snapshot)
      let commentId = null;
      let autoCommentSnapshot: string | null = null;
      if (gradeId) {
        const poolComment = await storage.findAssessmentComment(classId, subjectId, gradeId);
        if (poolComment) {
          commentId = poolComment.id;
          autoCommentSnapshot = poolComment.commentText;
        }
      }

      const statusOnlyComment = markStatusLabel(normalizedAttStatus);
      if (statusOnlyComment) {
        commentId = null;
        autoCommentSnapshot = statusOnlyComment;
      }
      
      // Smart comment source detection (matches PHP behavior):
      // Treat as POOL if custom text is empty OR matches the auto snapshot
      let finalCommentSource = commentSource || "pool";
      let finalCustomText = customCommentText || null;
      if (!finalCustomText || finalCustomText.trim() === "" || finalCustomText.trim() === (autoCommentSnapshot || "").trim()) {
        finalCommentSource = "pool";
        finalCustomText = null;
      } else {
        finalCommentSource = "custom";
      }
      if (statusOnlyComment) {
        finalCommentSource = "pool";
        finalCustomText = null;
      }
      
      // Check if mark exists for this student/assessment
      let existingMark = await storage.getAssessmentMarkByStudentAssessment(Number(studentId), assessment.id);

      if (existingMark && existingMark.schoolId !== schoolId) {
        return res.status(403).json({ message: "Mark not in school context" });
      }

      let mark;
      if (existingMark) {
        mark = await storage.updateAssessmentMark(existingMark.id, {
          schoolId,
          assessmentId: assessment.id,
          studentId: Number(studentId),
          classId,
          subjectId,
          percentage: percentage?.toString() || null,
          gradeId,
          attStatus: normalizedAttStatus as "none" | "present" | "absent" | "sick" | "excused",
          commentId: finalCommentSource === "pool" ? commentId : null,
          customCommentText: finalCustomText,
          autoCommentSnapshot,
          commentSource: finalCommentSource,
        });
      } else {
        mark = await storage.createAssessmentMark({
          schoolId,
          assessmentId: assessment.id,
          studentId: Number(studentId),
          classId,
          subjectId,
          percentage: percentage?.toString() || null,
          gradeId,
          attStatus: normalizedAttStatus as "none" | "present" | "absent" | "sick" | "excused",
          commentId: finalCommentSource === "pool" ? commentId : null,
          customCommentText: finalCustomText,
          autoCommentSnapshot,
          commentSource: finalCommentSource,
        });
      }
      
      if (!mark) {
        return res.status(500).json({ message: "Failed to save mark" });
      }
      
      // Save paper marks
      await storage.setMarkPapers(mark.id, normalizedPaperMarks);
      
      // Get saved paper marks
      const savedPaperMarks = await storage.getMarkPapers(mark.id);
      
      res.json({
        ...mark,
        paperMarks: savedPaperMarks,
        gradeName,
      });
    } catch (error) {
      next(error);
    }
  });

  // Delete a mark
  app.delete("/api/marks-entry/:markId", requireAuth, async (req, res, next) => {
    try {
      const scopedMark = await getScopedAssessmentMarkOrRespond(req, res, parseInt(req.params.markId));
      if (!scopedMark) return;
      if (await rejectIfAssessmentPublished(scopedMark.assessment, res)) return;

      await storage.deleteAssessmentMark(scopedMark.mark.id);
      res.json({ message: "Mark deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/ecd-assessment/template", requireAuth, async (_req, res, next) => {
    try {
      const domains = await storage.getEcdAssessmentDomains();
      const items = await storage.getEcdAssessmentItems();
      res.json({
        domains: domains.map((domain) => ({
          ...domain,
          items: items.filter((item) => item.domainId === domain.id),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/ecd-assessment/context", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const school = await storage.getSchool(schoolId);
      if (normalizeSchoolType(school?.schoolType) !== "primary") {
        return res.status(400).json({ message: "ECD assessment is only available for primary schools" });
      }
      const classes = await storage.getClassesBySchool(schoolId);
      const ecdClasses = [];
      for (const cls of classes) {
        const stream = cls.streamId ? await storage.getStream(cls.streamId) : undefined;
        const streamName = stream?.name || null;
        if (!isEcdStream(streamName) && !isEcdStream(cls.className)) continue;
        ecdClasses.push({ ...cls, streamName: streamName || cls.className });
      }
      const examId = Number(req.query.examId || 0);
      const classId = Number(req.query.classId || 0);
      const exam = examId ? await storage.getExam(examId) : undefined;
      const assessmentType = exam?.assessmentTypeId ? await storage.getAssessmentType(exam.assessmentTypeId) : undefined;
      const isEndOfTermExam = assessmentType?.name === "End-of-Term Exam";
      const students = classId ? await storage.getStudentsByClass(classId) : [];
      const roster = [];
      for (const student of students) {
        const record = examId ? await storage.getEcdAssessmentRecord(student.id, examId) : undefined;
        const responseCount = record ? (await storage.getEcdAssessmentResponses(record.id)).filter((row) => row.rating).length : 0;
        roster.push({
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          admissionNo: student.admissionNo,
          status: record?.status || "draft",
          completedResponses: responseCount,
        });
      }
      res.json({ ecdClasses, exam, isEndOfTermExam, students: roster });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/ecd-assessment/record", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const studentId = Number(req.query.studentId || 0);
      const examId = Number(req.query.examId || 0);
      const classId = Number(req.query.classId || 0);
      if (!studentId || !examId) return res.status(400).json({ message: "studentId and examId are required" });
      const student = await storage.getStudent(studentId);
      const exam = await storage.getExam(examId);
      const classInfo = await storage.getClass(classId || Number(student?.classId || 0));
      if (!student || !exam || !classInfo) {
        return res.status(404).json({ message: "Record context not found" });
      }
      if (classInfo.schoolId !== schoolId) {
        return res.status(404).json({ message: "Record context not found" });
      }
      if (student.classId && Number(student.classId) !== classInfo.id) {
        return res.status(404).json({ message: "Record context not found" });
      }
      if (exam.schoolId && exam.schoolId !== schoolId) {
        return res.status(404).json({ message: "Record context not found" });
      }
      const record = await storage.getEcdAssessmentRecord(studentId, examId);
      const responses = record ? await storage.getEcdAssessmentResponses(record.id) : [];
      res.json({ record: record || null, responses });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/ecd-assessment/record", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const { studentId, examId, classId, streamId, itemId, rating, status, clearAll } = req.body;
      if (!studentId || !examId || !classId) {
        return res.status(400).json({ message: "studentId, classId and examId are required" });
      }
      const student = await storage.getStudent(Number(studentId));
      const exam = await storage.getExam(Number(examId));
      const classInfo = await storage.getClass(Number(classId));
      if (!student || !exam || !classInfo) {
        return res.status(404).json({ message: "Record context not found" });
      }
      if (classInfo.schoolId !== schoolId) {
        return res.status(404).json({ message: "Record context not found" });
      }
      if (student.classId && Number(student.classId) !== classInfo.id) {
        return res.status(404).json({ message: "Record context not found" });
      }
      if (exam.schoolId && exam.schoolId !== schoolId) {
        return res.status(404).json({ message: "Record context not found" });
      }
      const assessmentType = exam.assessmentTypeId ? await storage.getAssessmentType(exam.assessmentTypeId) : undefined;
      if (assessmentType?.name !== "End-of-Term Exam") {
        return res.status(400).json({ message: "ECD assessment is only available for End-of-Term Exam records" });
      }
      const stream = streamId ? await storage.getStream(Number(streamId)) : (classInfo?.streamId ? await storage.getStream(classInfo.streamId) : undefined);
      if (!stream || !isEcdStream(stream.name)) {
        return res.status(400).json({ message: "ECD assessment is only available for ECD classes" });
      }
      const record = await storage.upsertEcdAssessmentRecord({
        schoolId,
        studentId: Number(studentId),
        classId: Number(classId),
        streamId: stream.id,
        examId: Number(examId),
        status: status || "draft",
        updatedBy: null,
      } as any);
      if (clearAll) {
        const existingResponses = await storage.getEcdAssessmentResponses(record.id);
        for (const response of existingResponses) {
          await storage.upsertEcdAssessmentResponse({
            recordId: record.id,
            itemId: Number(response.itemId),
            rating: null,
          } as any);
        }
      } else if (itemId) {
        await storage.upsertEcdAssessmentResponse({
          recordId: record.id,
          itemId: Number(itemId),
          rating: rating || null,
        } as any);
      }
      const responses = await storage.getEcdAssessmentResponses(record.id);
      res.json({ record, responses });
    } catch (error) {
      next(error);
    }
  });

  // ==================== ACADEMIC REPORTS / REPORT CARDS ====================
  
  // Get available exams for report cards (grouped by exam)
  app.get("/api/report-cards/exams", requireAuth, async (req, res, next) => {
    try {
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      
      let exams = await storage.getExamsBySchool(schoolId);
      if (currentUser?.role === "student" || currentUser?.role === "parent") {
        let classIds: number[] = [];
        if (currentUser.role === "student") {
          const [student] = await db.select().from(studentsTable).where(eq(studentsTable.userId, currentUser.id)).limit(1);
          if (student?.classId) classIds = [Number(student.classId)];
        } else {
          const [parent] = await db.select().from(parentsTable).where(eq(parentsTable.userId, currentUser.id)).limit(1);
          if (parent) {
            const children = await db.select().from(studentsTable).where(eq(studentsTable.parentId, parent.id));
            classIds = Array.from(new Set(children.map((student: any) => Number(student.classId)).filter(Boolean)));
          }
        }
        if (!classIds.length) return res.json([]);
        const publishedRows = await db.select().from(assessmentPublications).where(and(
          eq(assessmentPublications.schoolId, schoolId),
          eq(assessmentPublications.isPublished, true),
          inArray(assessmentPublications.classId, classIds),
        ));
        const publishedExamIds = new Set(publishedRows.map((row: any) => Number(row.examId)));
        exams = exams.filter((exam: any) => publishedExamIds.has(Number(exam.id)));
      }
      res.json(exams);
    } catch (error) {
      next(error);
    }
  });

  // Get report card data for a class and exam
  app.get("/api/report-cards/:examId/class/:classId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const classId = parseInt(req.params.classId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      if (currentUser?.role === "student" || currentUser?.role === "parent") {
        return res.status(403).json({ message: "Class-wide report data is not available in the student or parent portal" });
      }
      
      const school = await storage.getSchool(schoolId);
      const org = school?.organizationId ? await storage.getOrganization(school.organizationId) : undefined;
      
      const classInfo = await storage.getClass(classId);
      if (!classInfo) return res.status(404).json({ message: "Class not found" });
      if (classInfo.schoolId && classInfo.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const exam = await storage.getExam(examId);
      if (!exam) return res.status(404).json({ message: "Exam not found" });
      if (exam.schoolId && exam.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const students = await storage.getStudentsByClass(classId);
      const allAssessments = (await storage.getAssessmentsByExam(examId))
        .filter((assessment: any) => Number(assessment.classId) === Number(classId));
      const publication = await getClassExamPublication(examId, classId);
      
      const subjectIds = [...new Set(allAssessments.map(a => a.subjectId))];
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const subjects = subjectsData.filter(Boolean);
      
      const grades = await storage.getGradesBySchool(schoolId);
      const classStream = classInfo.streamId ? await storage.getStream(classInfo.streamId) : undefined;
      const gradeCandidatesBySubject = new Map<number, any[]>();
      for (const subject of subjects) {
        if (!subject) continue;
        gradeCandidatesBySubject.set(
          Number(subject.id),
          getClassSubjectGradeCandidates({
            allGrades: grades,
            school,
            classInfo,
            classStreamName: classStream?.name || null,
            subject,
          }).grades,
        );
      }
      
      const assessmentIds = allAssessments.map(a => a.id);
      const allMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      
      const marksMap = new Map<string, typeof allMarks[0]>();
      for (const mark of allMarks) {
        const key = `${mark.studentId}-${mark.assessmentId}`;
        marksMap.set(key, mark);
      }
      
      const teacherMap = new Map<string, string>();
      const getTeacherDisplayName = async (staffId: number) => {
        const staffMember = await storage.getStaff(staffId);
        if (!staffMember) return `Staff #${staffId}`;

        const user = staffMember.userId ? await storage.getUser(staffMember.userId) : null;
        const normalizedGender = (staffMember.gender || "").toString().toLowerCase();
        const title = normalizedGender === "male" ? "Mr." : normalizedGender === "female" ? "Ms." : "";

        const firstName = ((staffMember.firstName || user?.firstName || "") as string).trim();
        const lastName = ((staffMember.lastName || user?.lastName || "") as string).trim();
        const firstInitial = firstName ? `${firstName.charAt(0).toUpperCase()}.` : "";

        if (lastName) {
          return [title, firstInitial, lastName].filter(Boolean).join(" ").trim();
        }

        const fallbackName = user
          ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
          : `${staffMember.firstName || ""} ${staffMember.lastName || ""}`.trim();

        return fallbackName || `Staff #${staffId}`;
      };
      try {
        const allStaffSubjects = await db.select({
          staffId: staffSubjects.staffId,
          subjectId: staffSubjects.subjectId,
          classId: staffSubjects.classId,
        }).from(staffSubjects).where(
          eq(staffSubjects.classId, classId)
        );
        for (const ss of allStaffSubjects) {
          const name = await getTeacherDisplayName(ss.staffId);
          teacherMap.set(`${ss.subjectId}-${ss.classId}`, name);
        }
      } catch (e) {}
      
      const bySubject: Record<number, Record<number, number>> = {};
      
      const studentSubjectRows: Record<number, Record<number, {
        assessmentId: number;
        percentage: number | null;
        grade: string;
        gradePoints: number;
        comment: string;
        commentPool: string;
        teacher: string;
        subjectId: number;
        subjectName: string;
      }>> = {};
      
      const studentIdSet = new Set(students.map(s => s.id));
      
      for (const subject of subjects) {
        if (!subject) continue;
        const assessment = allAssessments.find(a => a.subjectId === subject.id && a.classId === classId);
        if (!assessment) continue;
        
        const teacher = teacherMap.get(`${subject.id}-${classId}`) || "";
        
        for (const student of students) {
          const markKey = `${student.id}-${assessment.id}`;
          const mark = marksMap.get(markKey);
          
          if (!mark) continue;
          
          const pctRaw = parseFinitePercentage(mark.percentage);
          const statusComment = markStatusLabel(mark.attStatus);
          if (pctRaw === null && !statusComment) continue;
          
          let gradeName = "";
          let gradePoints = 0;
          const resolvedGrade = resolveStoredAssessmentGrade({
            mark,
            percentage: pctRaw,
            applicableGrades: gradeCandidatesBySubject.get(Number(subject.id)) || [],
            allGrades: grades,
            subjectType: subject.subjectType,
          });
          if (resolvedGrade) {
            gradeName = resolvedGrade.gradeName;
            gradePoints = resolvedGrade.gradePoints ? parseFloat(resolvedGrade.gradePoints as string) : 0;
          }
          
          const comment = statusComment || mark.customCommentText || mark.autoCommentSnapshot || "";
          
          if (pctRaw !== null) {
            if (!bySubject[subject.id]) bySubject[subject.id] = {};
            bySubject[subject.id][student.id] = pctRaw;
          }
          
          if (!studentSubjectRows[student.id]) studentSubjectRows[student.id] = {};
          studentSubjectRows[student.id][subject.id] = {
            assessmentId: assessment.id,
            percentage: pctRaw,
            grade: gradeName,
            gradePoints,
            comment,
            commentPool: mark.autoCommentSnapshot || "",
            teacher,
            subjectId: subject.id,
            subjectName: subject.name,
          };
        }
      }
      
      const subjectAvg: Record<number, number> = {};
      const subjectRank: Record<number, Record<number, string>> = {};
      
      for (const [subjIdStr, sidToPct] of Object.entries(bySubject)) {
        const subjId = parseInt(subjIdStr);
        const vals = Object.values(sidToPct);
        subjectAvg[subjId] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        
        const sorted = Object.entries(sidToPct)
          .sort(([, a], [, b]) => b - a);
        const n = sorted.length;
        subjectRank[subjId] = {};
        sorted.forEach(([sid], i) => {
          subjectRank[subjId][parseInt(sid)] = `${i + 1}/${n}`;
        });
      }
      
      const prevPctMap: Record<string, number> = {};
      const overtimeMap: Record<number, Array<{ label: string; avg: number }>> = {};
      try {
        const allSchoolExams = await storage.getExamsBySchool(schoolId);
        const sortedExams = allSchoolExams
          .filter(e => e.id !== examId)
          .sort((a, b) => {
            const dateA = a.startDate ? new Date(a.startDate).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            const dateB = b.startDate ? new Date(b.startDate).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
            return dateB - dateA;
          });
        
        const prevExam = sortedExams.length > 0 ? sortedExams[0] : null;
        
        if (prevExam) {
          const prevAssessments = await storage.getAssessmentsByExam(prevExam.id);
          const prevAssessmentIds = prevAssessments.map(a => a.id);
          let prevMarks: any[] = [];
          if (prevAssessmentIds.length > 0) {
            prevMarks = await storage.getAssessmentMarksByAssessments(prevAssessmentIds);
          }
          
          for (const mark of prevMarks) {
            if (mark.percentage !== null && mark.percentage !== undefined) {
              const key = `${mark.studentId}-${mark.subjectId}`;
              prevPctMap[key] = parseFloat(mark.percentage);
            }
          }
        }
        
        const currentExamAssessmentTypeId = exam.assessmentTypeId;
        const chronoExams = [...allSchoolExams]
          .filter(e => currentExamAssessmentTypeId ? e.assessmentTypeId === currentExamAssessmentTypeId : true)
          .sort((a, b) => {
            const dateA = a.startDate ? new Date(a.startDate).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            const dateB = b.startDate ? new Date(b.startDate).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
            return dateA - dateB;
          });
        
        const examMarksCache: Array<{ exam: typeof chronoExams[0]; marks: any[] }> = [];
        for (const pastExam of chronoExams) {
          const pastAssessments = await storage.getAssessmentsByExam(pastExam.id);
          const pastAssessmentIds = pastAssessments.map(a => a.id);
          if (pastAssessmentIds.length === 0) continue;
          const pastMarks = await storage.getAssessmentMarksByAssessments(pastAssessmentIds);
          examMarksCache.push({ exam: pastExam, marks: pastMarks });
        }
        
        for (const studentObj of students) {
          const studentOvertime: Array<{ label: string; avg: number }> = [];
          for (const cached of examMarksCache) {
            const studentPastMarks = cached.marks.filter(m => m.studentId === studentObj.id && m.percentage !== null && m.percentage !== undefined);
            if (studentPastMarks.length === 0) continue;
            const sum = studentPastMarks.reduce((a, m) => a + parseFloat(m.percentage), 0);
            const avg = Math.round(sum / studentPastMarks.length);
            const termLabel = cached.exam.termId ? `T${cached.exam.termId}` : '';
            const label = termLabel ? `${termLabel} - ${cached.exam.examName}` : cached.exam.examName;
            studentOvertime.push({ label, avg });
          }
          overtimeMap[studentObj.id] = studentOvertime;
        }
      } catch (e) {}
      
      const reportCards = await Promise.all(students.map(async (student) => {
        const rows = studentSubjectRows[student.id] || {};
        const subjectResults: Array<{
          assessmentId?: number;
          subjectId: number;
          subjectName: string;
          mark: string;
          dev: string;
          classAvg: string;
          grade: string;
          rank: string;
          comment: string;
          commentPool?: string;
          teacher: string;
          gradePoints: number;
        }> = [];
        
        const sortedSubjects = Object.values(rows).sort((a, b) =>
          a.subjectName.localeCompare(b.subjectName)
        );
        
        let sumMarks = 0;
        let passed = 0;
        let points = 0;
        let nSubjects = 0;
        
        const chartSubjectLabels: string[] = [];
        const chartStudentMarks: number[] = [];
        const chartClassAvgs: (number | null)[] = [];
        
        for (const row of sortedSubjects) {
          const pct = row.percentage;
          const hasNumericMark = pct !== null && Number.isFinite(pct);
          if (hasNumericMark) {
            sumMarks += pct as number;
            nSubjects++;
            if ((pct as number) >= 60) passed++;
            points += Number.isFinite(row.gradePoints) ? row.gradePoints : 0;
          }
          
          const avgVal = subjectAvg[row.subjectId];
          const classAvgStr = hasNumericMark && avgVal !== undefined
            ? parseFloat(avgVal.toFixed(1)).toString()
            : '';
          
          const rankStr = hasNumericMark ? (subjectRank[row.subjectId]?.[student.id] || '') : '';
          const markStr = hasNumericMark ? parseFloat((pct as number).toFixed(1)).toString() : '';
          
          const prevKey = `${student.id}-${row.subjectId}`;
          const prevPct = prevPctMap[prevKey];
          let dev = '';
          if (hasNumericMark) {
            if (prevPct === undefined) {
              dev = '+NEW';
            } else {
              const diff = Math.round((pct as number) - prevPct);
              if (diff > 0) dev = `+${diff}`;
              else if (diff < 0) dev = `${diff}`;
              else dev = '0';
            }
          }
          
          subjectResults.push({
            assessmentId: row.assessmentId,
            subjectId: row.subjectId,
            subjectName: row.subjectName,
            mark: markStr,
            dev,
            classAvg: classAvgStr,
            grade: row.grade,
            rank: rankStr,
            comment: row.comment,
            commentPool: row.commentPool,
            teacher: row.teacher,
            gradePoints: row.gradePoints,
          });
          
          if (hasNumericMark) {
            chartSubjectLabels.push(row.subjectName);
            chartStudentMarks.push(parseFloat((pct as number).toFixed(1)));
            chartClassAvgs.push(avgVal !== undefined ? parseFloat(avgVal.toFixed(1)) : null);
          }
        }
        
        const totalMark = nSubjects > 0 ? `${Math.round(sumMarks)}/${100 * nSubjects}` : '';
        const avgPct = nSubjects > 0 ? parseFloat((sumMarks / nSubjects).toFixed(1)) : null;
        const avgMarkStr = avgPct !== null ? `${parseFloat(avgPct.toFixed(1))}%` : '';
        const subjectsPassed = nSubjects > 0 ? `${passed}/${nSubjects}` : '';
        
        const chartOvertimeLabels = (overtimeMap[student.id] || []).map(o => o.label);
        const chartOvertimeAvgs = (overtimeMap[student.id] || []).map(o => o.avg);
        const studentStream = student.streamId ? await storage.getStream(student.streamId) : null;
        const classStream = classInfo?.streamId ? await storage.getStream(classInfo.streamId) : null;
        const ecdSections = await loadEcdSectionsForStudentExam(student.id, examId, [studentStream?.name, classStream?.name]);
        
        return {
          student: {
            id: student.id,
            admissionNo: student.admissionNo,
            firstName: student.firstName,
            lastName: student.lastName,
            gender: student.gender || '',
            photo: student.photo,
          },
          subjects: subjectResults,
          summary: {
            totalMark,
            avgMark: avgMarkStr,
            subjectsPassed,
            points: nSubjects > 0 ? points.toString() : '',
            classPosition: '',
            overallPosition: '',
            classSize: 0,
            averagePercentage: avgPct,
            totalSubjects: nSubjects,
          },
          chartSubjectLabels,
          chartStudentMarks,
          chartClassAvgs,
          chartOvertimeLabels,
          chartOvertimeAvgs,
          ecdSections,
        };
      }));
      
      const allReportComments = await storage.getReportComments(schoolId);
      const allGrades = (await storage.getAllGrades()).filter((grade) => grade.schoolId === schoolId);

      for (const rc of reportCards) {
        const avg = rc.summary.averagePercentage;
        const streamId = classInfo?.streamId ?? null;
        const stream = streamId ? await storage.getStream(streamId) : null;
        const profileKey = resolveGradeProfileKey({
          schoolType: school?.schoolType,
          examinationBoard: school?.examinationBoard,
          streamName: stream?.name,
        });
        const applicableGrades = getApplicableGradesForContext(allGrades, { profileKey, classId });
        const configuredGrade = resolveReportCommentGradeForAverage(applicableGrades, avg);
        const principalPoolComment = findReportCommentForConfiguredGrade({
          comments: allReportComments,
          commentType: "principal",
          grade: configuredGrade,
          profileKey,
        });
        const classTeacherPoolComment = findReportCommentForConfiguredGrade({
          comments: allReportComments,
          commentType: "class_teacher",
          grade: configuredGrade,
          profileKey,
          classId,
        });
        (rc as any).principalCommentPool = principalPoolComment;
        (rc as any).classTeacherCommentPool = classTeacherPoolComment;
        (rc as any).principalComment = principalPoolComment;
        (rc as any).classTeacherComment = classTeacherPoolComment;
      }

      const overrideMap = await getReportCardCommentOverrideMap(schoolId, examId, reportCards.map((rc) => rc.student.id));
      for (const rc of reportCards) {
        const overrides = overrideMap.get(rc.student.id);
        if (overrides?.principal !== undefined) {
          (rc as any).principalComment = overrides.principal || "";
        }
        if (overrides?.class_teacher !== undefined) {
          (rc as any).classTeacherComment = overrides.class_teacher || "";
        }
      }

      const studentsWithMarks = reportCards.filter(r => r.summary.averagePercentage !== null);
      const classPositionMap = calculatePositionMap(
        studentsWithMarks.map((rc) => ({ id: rc.student.id, value: rc.summary.averagePercentage }))
      );
      const streamPositionMap = await calculateStreamPositionMap(examId, schoolId, classInfo?.streamId || null);
      const classSize = classPositionMap.size;

      for (const rc of reportCards) {
        rc.summary.classSize = classSize;
        rc.summary.classPosition = classPositionMap.map.get(rc.student.id) || '';
        rc.summary.overallPosition = streamPositionMap.map.get(rc.student.id) || rc.summary.classPosition || '';
      }
      
      res.json({
        school: {
          id: school?.id,
          name: school?.name,
          logo: school?.logo,
          stamp: school?.stamp,
          address: school?.address,
          phone: school?.phone,
          email: school?.email,
          principalName: school?.principalName,
          principalPhone: school?.principalPhone,
          currentAcademicYear: school?.currentAcademicYear || org?.currentAcademicYear,
          currentTerm: school?.currentTerm || org?.currentTerm,
          examinationBoard: school?.examinationBoard,
          showClassPositionOnReports: !!school?.showClassPositionOnReports,
        },
        class: classInfo,
        exam,
        subjects,
        reportCards,
        publication: {
          isPublished: publication?.isPublished === true,
          status: publication?.isPublished ? (publication.lastAction === "republished" ? "Republished" : "Published") : "Unpublished",
          publicationVersion: publication?.publicationVersion || 0,
          publishedAt: publication?.publishedAt || null,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Get individual student report card
  app.get("/api/report-cards/:examId/student/:studentId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const studentId = parseInt(req.params.studentId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      
      const school = await storage.getSchool(schoolId);
      const org2 = school?.organizationId ? await storage.getOrganization(school.organizationId) : undefined;
      const student = await storage.getStudent(studentId);
      if (!student) return res.status(404).json({ message: "Student not found" });
      
      const classInfo = student.classId ? await storage.getClass(student.classId) : null;
      const exam = await storage.getExam(examId);
      if (!exam) return res.status(404).json({ message: "Exam not found" });
      if (!classInfo) return res.status(400).json({ message: "Student class context required" });
      if (!currentUser || !(await ensurePublishedPortalAccess({ user: currentUser, examId, classId: classInfo.id, studentId, res }))) return;
      
      const allAssessments = (await storage.getAssessmentsByExam(examId)).filter((assessment: any) => Number(assessment.classId) === Number(classInfo.id));
      const grades = await storage.getGradesBySchool(schoolId);
      const classStream = classInfo.streamId ? await storage.getStream(classInfo.streamId) : undefined;
      
      const subjectResults: Array<{
        subjectId: number;
        subjectName: string;
        percentage: number | null;
        grade: string;
        gradePoints: number;
        comment: string;
      }> = [];
      
      let totalPercentage = 0;
      let totalGradePoints = 0;
      let subjectCount = 0;
      
      for (const assessment of allAssessments) {
        const subject = await storage.getSubject(assessment.subjectId);
        if (!subject) continue;
        
        const mark = await storage.getAssessmentMarkByStudentAssessment(studentId, assessment.id);
        
        let percentage: number | null = null;
        let gradeName = "";
        let gradePoints = 0;
        let comment = "";
        
        if (mark) {
          percentage = parseFinitePercentage(mark.percentage);
          const applicableGrades = getClassSubjectGradeCandidates({
            allGrades: grades,
            school,
            classInfo,
            classStreamName: classStream?.name || null,
            subject,
          }).grades;
          const resolvedGrade = resolveStoredAssessmentGrade({
            mark,
            percentage,
            applicableGrades,
            allGrades: grades,
            subjectType: subject.subjectType,
          });
          if (resolvedGrade) {
            gradeName = resolvedGrade.gradeName;
            gradePoints = resolvedGrade.gradePoints ? parseFloat(resolvedGrade.gradePoints as string) : 0;
          }
          
          comment = mark.customCommentText || mark.autoCommentSnapshot || "";
          
          if (percentage !== null) {
            totalPercentage += percentage;
            totalGradePoints += gradePoints;
            subjectCount++;
          }
        }
        
        subjectResults.push({
          subjectId: subject.id,
          subjectName: subject.name,
          percentage,
          grade: gradeName,
          gradePoints,
          comment,
        });
      }
      
      const averagePercentage = subjectCount > 0 ? Math.round(totalPercentage / subjectCount) : null;
      const averageGradePoints = subjectCount > 0 ? (totalGradePoints / subjectCount).toFixed(1) : null;
      
      res.json({
        school: {
          id: school?.id,
          name: school?.name,
          logo: school?.logo,
          stamp: school?.stamp,
          address: school?.address,
          phone: school?.phone,
          email: school?.email,
          principalName: school?.principalName,
          principalPhone: school?.principalPhone,
          currentAcademicYear: school?.currentAcademicYear || org2?.currentAcademicYear,
          currentTerm: school?.currentTerm || org2?.currentTerm,
          examinationBoard: school?.examinationBoard,
          showClassPositionOnReports: !!school?.showClassPositionOnReports,
        },
        class: classInfo,
        exam,
        student: {
          id: student.id,
          admissionNo: student.admissionNo,
          firstName: student.firstName,
          lastName: student.lastName,
          gender: student.gender,
          photo: student.photo,
        },
        subjects: subjectResults,
        summary: {
          averagePercentage,
          averageGradePoints,
          totalSubjects: subjectCount,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  async function buildReportCardPdfData(
    studentId: number,
    examId: number,
    schoolId: number,
    schoolInfo: any,
    classInfo: any,
    examInfo: any,
  ): Promise<ReportCardPdfData | null> {
    const allAssessments = (await storage.getAssessmentsByExam(examId)).filter((assessment: any) => Number(assessment.classId) === Number(classInfo.id));

    const subjectIds = [...new Set(allAssessments.map(a => a.subjectId))];
    const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
    const subjectsList = subjectsData.filter(Boolean);

    const grades = await storage.getGradesBySchool(schoolId);
    const gradeClassStream = classInfo.streamId ? await storage.getStream(classInfo.streamId) : undefined;
    const gradeCandidatesBySubject = new Map<number, any[]>();
    for (const subject of subjectsList) {
      if (!subject) continue;
      gradeCandidatesBySubject.set(
        Number(subject.id),
        getClassSubjectGradeCandidates({
          allGrades: grades,
          school: schoolInfo,
          classInfo,
          classStreamName: gradeClassStream?.name || null,
          subject,
        }).grades,
      );
    }
    const assessmentIds = allAssessments.map(a => a.id);
    const allMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);

    const marksMap = new Map<string, typeof allMarks[0]>();
    for (const mark of allMarks) {
      marksMap.set(`${mark.studentId}-${mark.assessmentId}`, mark);
    }

    const students = await storage.getStudentsByClass(classInfo.id);

    const bySubject: Record<number, Record<number, number>> = {};
    const studentSubjectRows: Record<number, Record<number, {
      percentage: number | null; grade: string; gradePoints: number;
      comment: string; subjectId: number; subjectName: string;
    }>> = {};

    const teacherMap = new Map<string, string>();
    const getTeacherDisplayName = async (staffId: number) => {
      const staffMember = await storage.getStaff(staffId);
      if (!staffMember) return `Staff #${staffId}`;

      const normalizedGender = (staffMember.gender || "").toString().toLowerCase();
      const title = normalizedGender === "male" ? "Mr" : normalizedGender === "female" ? "Ms" : "";
      const lastName = (staffMember.lastName || "").trim();
      if (lastName) {
        return `${title ? `${title} ` : ""}${lastName}`.trim();
      }

      const user = staffMember.userId ? await storage.getUser(staffMember.userId) : null;
      const userLastName = (user?.lastName || "").trim();
      if (userLastName) {
        return `${title ? `${title} ` : ""}${userLastName}`.trim();
      }

      const fallbackName = user
        ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
        : `${staffMember.firstName || ""} ${staffMember.lastName || ""}`.trim();

      return fallbackName || `Staff #${staffId}`;
    };
    try {
      const allStaffSubjectsList = await db.select({
        staffId: staffSubjects.staffId,
        subjectId: staffSubjects.subjectId,
        classId: staffSubjects.classId,
      }).from(staffSubjects).where(eq(staffSubjects.classId, classInfo.id));
      for (const ss of allStaffSubjectsList) {
        const tName = await getTeacherDisplayName(ss.staffId);
        teacherMap.set(`${ss.subjectId}-${ss.classId}`, tName);
      }
    } catch (e) {}

    for (const subject of subjectsList) {
      if (!subject) continue;
      const assessment = allAssessments.find(a => a.subjectId === subject.id && a.classId === classInfo.id);
      if (!assessment) continue;

      for (const stu of students) {
        const markKey = `${stu.id}-${assessment.id}`;
        const mark = marksMap.get(markKey);
        if (!mark) continue;

        const pctRaw = parseFinitePercentage(mark.percentage);
        const statusComment = markStatusLabel(mark.attStatus);
        if (pctRaw === null && !statusComment) continue;

        let gradeName = '';
        let gradePoints = 0;
        const resolvedGrade = resolveStoredAssessmentGrade({
          mark,
          percentage: pctRaw,
          applicableGrades: gradeCandidatesBySubject.get(Number(subject.id)) || [],
          allGrades: grades,
          subjectType: subject.subjectType,
        });
        if (resolvedGrade) {
          gradeName = resolvedGrade.gradeName;
          gradePoints = resolvedGrade.gradePoints ? parseFloat(resolvedGrade.gradePoints as string) : 0;
        }

        const comment = statusComment || mark.customCommentText || mark.autoCommentSnapshot || '';

        if (pctRaw !== null) {
          if (!bySubject[subject.id]) bySubject[subject.id] = {};
          bySubject[subject.id][stu.id] = pctRaw;
        }

        if (!studentSubjectRows[stu.id]) studentSubjectRows[stu.id] = {};
        studentSubjectRows[stu.id][subject.id] = {
          percentage: pctRaw, grade: gradeName, gradePoints,
          comment, subjectId: subject.id, subjectName: subject.name,
        };
      }
    }

    const rows = studentSubjectRows[studentId] || {};
    if (Object.keys(rows).length === 0) return null;

    const subjectAvg: Record<number, number> = {};
    const subjectRank: Record<number, Record<number, string>> = {};

    for (const [subjIdStr, sidToPct] of Object.entries(bySubject)) {
      const subjId = parseInt(subjIdStr);
      const vals = Object.values(sidToPct);
      subjectAvg[subjId] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const sorted = Object.entries(sidToPct).sort(([, a], [, b]) => b - a);
      const n = sorted.length;
      subjectRank[subjId] = {};
      sorted.forEach(([sid], i) => { subjectRank[subjId][parseInt(sid)] = `${i + 1}/${n}`; });
    }

    const pdfPrevPctMap: Record<string, number> = {};
    try {
      const allSchoolExams = await storage.getExamsBySchool(schoolId);
      const sortedExams = allSchoolExams
        .filter(e => e.id !== examId)
        .sort((a, b) => {
          const dateA = a.startDate ? new Date(a.startDate).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const dateB = b.startDate ? new Date(b.startDate).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          return dateB - dateA;
        });
      const prevExam = sortedExams.length > 0 ? sortedExams[0] : null;
      if (prevExam) {
        const prevAssessments = await storage.getAssessmentsByExam(prevExam.id);
        const prevAssessmentIds = prevAssessments.map(a => a.id);
        if (prevAssessmentIds.length > 0) {
          const prevMarks = await storage.getAssessmentMarksByAssessments(prevAssessmentIds);
          for (const mark of prevMarks) {
            if (mark.percentage !== null && mark.percentage !== undefined) {
              pdfPrevPctMap[`${mark.studentId}-${mark.subjectId}`] = parseFloat(mark.percentage);
            }
          }
        }
      }
    } catch (e) {}

    const sortedRows = Object.values(rows).sort((a, b) => a.subjectName.localeCompare(b.subjectName));
    let sumMarks = 0, passed = 0, points = 0, nSubjects = 0;
    const pdfSubjects: Array<{ subjectName: string; mark: string; dev: string; classAvg: string; grade: string; rank: string; comment: string; teacher: string }> = [];

    for (const row of sortedRows) {
      const pct = row.percentage;
      const hasNumericMark = pct !== null && Number.isFinite(pct);
      if (hasNumericMark) {
        sumMarks += pct as number;
        nSubjects++;
        if ((pct as number) >= 60) passed++;
        points += Number.isFinite(row.gradePoints) ? row.gradePoints : 0;
      }

      const avgVal = subjectAvg[row.subjectId];
      const classAvgStr = hasNumericMark && avgVal !== undefined ? parseFloat(avgVal.toFixed(1)).toString() : '';
      const rankStr = hasNumericMark ? (subjectRank[row.subjectId]?.[studentId] || '') : '';
      const markStr = hasNumericMark ? parseFloat((pct as number).toFixed(1)).toString() : '';
      const teacher = teacherMap.get(`${row.subjectId}-${classInfo.id}`) || '';

      const prevVal = pdfPrevPctMap[`${studentId}-${row.subjectId}`];
      let dev = '';
      if (hasNumericMark) {
        if (prevVal === undefined) {
          dev = '+NEW';
        } else {
          const diff = Math.round((pct as number) - prevVal);
          if (diff > 0) dev = `+${diff}`;
          else if (diff < 0) dev = `${diff}`;
          else dev = '0';
        }
      }

      pdfSubjects.push({
        subjectName: row.subjectName, mark: markStr, dev,
        classAvg: classAvgStr, grade: row.grade, rank: rankStr,
        comment: row.comment, teacher,
      });
    }

    const totalMark = nSubjects > 0 ? `${Math.round(sumMarks)}/${100 * nSubjects}` : '';
    const avgPct = nSubjects > 0 ? parseFloat((sumMarks / nSubjects).toFixed(1)) : null;
    const avgMarkStr = avgPct !== null ? `${parseFloat(avgPct.toFixed(1))}%` : '';
    const subjectsPassed = nSubjects > 0 ? `${passed}/${nSubjects}` : '';

    const studentsWithMarks = students.filter(s => {
      const r = studentSubjectRows[s.id];
      return r && Object.keys(r).length > 0;
    });
    const studentAvgs = studentsWithMarks.map(s => {
      const r = studentSubjectRows[s.id];
      const vals = Object.values(r || {}).filter(v => v.percentage !== null);
      const sum = vals.reduce((a, v) => a + (v.percentage ?? 0), 0);
      return { id: s.id, avg: vals.length > 0 ? sum / vals.length : 0 };
    }).sort((a, b) => b.avg - a.avg);

    let position = '';
    const classSize = studentAvgs.length;
    let currentPos = 0;
    let lastAvg: number | null = null;
    for (let i = 0; i < studentAvgs.length; i++) {
      if (studentAvgs[i].avg !== lastAvg) { currentPos = i + 1; lastAvg = studentAvgs[i].avg; }
      if (studentAvgs[i].id === studentId) { position = `${currentPos}/${classSize}`; break; }
    }
    const streamPositionMap = await calculateStreamPositionMap(examId, schoolId, classInfo?.streamId || null);
    const overallPosition = streamPositionMap.map.get(studentId) || position;

    const student = students.find(s => s.id === studentId);
    if (!student) return null;
    const studentStream = student.streamId ? await storage.getStream(student.streamId) : null;
    const classStream = classInfo?.streamId ? await storage.getStream(classInfo.streamId) : null;
    const ecdSections = await loadEcdSectionsForStudentExam(studentId, examId, [studentStream?.name, classStream?.name]);

    const termId = examInfo?.termId;
    const termName = termId ? `Term ${termId}` : undefined;

    let principalComment = '';
    let classTeacherComment = '';
    if (avgPct !== null) {
      const allComments = await storage.getReportComments(schoolId);
      const allGrades = (await storage.getAllGrades()).filter((grade) => grade.schoolId === schoolId);
      const profileKey = resolveGradeProfileKey({
        schoolType: schoolInfo?.schoolType,
        examinationBoard: schoolInfo?.examinationBoard,
        streamName: classStream?.name || null,
      });
      const applicableGrades = getApplicableGradesForContext(allGrades, { profileKey, classId: classInfo.id });
      const configuredGrade = resolveReportCommentGradeForAverage(applicableGrades, avgPct);
      principalComment = findReportCommentForConfiguredGrade({
        comments: allComments,
        commentType: "principal",
        grade: configuredGrade,
        profileKey,
      });
      classTeacherComment = findReportCommentForConfiguredGrade({
        comments: allComments,
        commentType: "class_teacher",
        grade: configuredGrade,
        profileKey,
        classId: classInfo.id,
      });
    }

    const pdfOverrideMap = await getReportCardCommentOverrideMap(schoolId, examId, [studentId]);
    const pdfOverrides = pdfOverrideMap.get(studentId);
    if (pdfOverrides?.principal !== undefined) {
      principalComment = pdfOverrides.principal || '';
    }
    if (pdfOverrides?.class_teacher !== undefined) {
      classTeacherComment = pdfOverrides.class_teacher || '';
    }

    return {
      school: {
        name: schoolInfo?.name || 'School',
        logo: schoolInfo?.logo,
        stamp: schoolInfo?.stamp,
        address: schoolInfo?.address,
        phone: schoolInfo?.phone,
        email: schoolInfo?.email,
        principalName: schoolInfo?.principalName,
        principalPhone: schoolInfo?.principalPhone,
      },
      studentName: `${student.firstName} ${student.lastName}`,
      admissionNo: student.admissionNo || '',
      className: classInfo.className || '',
      examName: examInfo?.examName || '',
      termName,
      subjects: pdfSubjects,
      summary: {
        totalMark,
        avgMark: avgMarkStr,
        subjectsPassed,
        points: nSubjects > 0 ? points.toString() : '',
        classPosition: position,
        overallPosition,
      },
      ecdSections,
      principalComment,
      classTeacherComment,
    };
  }

  async function buildReportCardMessage(
    studentId: number,
    examId: number,
    schoolId: number,
    schoolName: string,
    className: string,
    examName: string,
    studentName: string,
    regNo: string,
  ): Promise<string | null> {
    const studentForClass = await storage.getStudent(studentId);
    const allAssessments = (await storage.getAssessmentsByExam(examId)).filter((assessment: any) => !studentForClass?.classId || Number(assessment.classId) === Number(studentForClass.classId));
    const grades = await storage.getGradesBySchool(schoolId);
    const [exam, schoolInfo] = await Promise.all([
      storage.getExam(examId),
      storage.getSchool(schoolId),
    ]);
    const termId = exam?.termId;
    const termName = termId ? `Term ${termId}` : '';

    const student = studentForClass;
    const studentClass = student?.classId ? await storage.getClass(student.classId) : null;
    const studentStream = student?.streamId ? await storage.getStream(student.streamId) : null;
    const classStream = studentClass?.streamId ? await storage.getStream(studentClass.streamId) : null;
    const ecdSections = await loadEcdSectionsForStudentExam(studentId, examId, [studentStream?.name, classStream?.name]);

    const formatEcdRating = (rating: string | null | undefined) => {
      if (rating === 'YES') return 'Yes';
      if (rating === 'NO') return 'No';
      if (rating === 'ALMOST') return 'Almost';
      return '';
    };

    const lines: Array<{ subject: string; pct: string; grade: string; statusComment: string }> = [];
    let totalPct = 0;
    let subjectCount = 0;
    let totalGradePoints = 0;

    for (const assessment of allAssessments) {
      const subject = await storage.getSubject(assessment.subjectId);
      if (!subject) continue;

      const mark = await storage.getAssessmentMarkByStudentAssessment(studentId, assessment.id);
      if (!mark) continue;

      const statusComment = markStatusLabel(mark.attStatus);
      const pctNum = parseFinitePercentage(mark.percentage);
      if (pctNum === null && !statusComment) continue;

      const pctStr = pctNum !== null
        ? (pctNum % 1 === 0 ? String(Math.round(pctNum)) : pctNum.toFixed(1))
        : '';
      let gradeName = '';
      let gradePoints = 0;

      const applicableGrades = studentClass
        ? getClassSubjectGradeCandidates({
            allGrades: grades,
            school: schoolInfo,
            classInfo: studentClass,
            classStreamName: classStream?.name || null,
            subject,
          }).grades
        : [];
      const resolvedGrade = resolveStoredAssessmentGrade({
        mark,
        percentage: pctNum,
        applicableGrades,
        allGrades: grades,
        subjectType: subject.subjectType,
      });
      if (resolvedGrade) {
        gradeName = resolvedGrade.gradeName;
        gradePoints = resolvedGrade.gradePoints ? parseFloat(resolvedGrade.gradePoints as string) : 0;
      }

      lines.push({ subject: subject.name, pct: pctStr, grade: gradeName, statusComment });
      if (pctNum !== null) {
        totalPct += pctNum;
        totalGradePoints += gradePoints;
        subjectCount++;
      }
    }

    lines.sort((a, b) => a.subject.localeCompare(b.subject));

    const ecdBlocks = ecdSections
      .map((section) => {
        const itemLines = section.items
          .filter((item) => item.rating)
          .map((item) => `${item.itemText}: ${formatEcdRating(item.rating)}`);

        if (itemLines.length === 0) return null;

        return [
          `${section.code}. ${section.name.toUpperCase()}`,
          ...itemLines,
        ].join('\n');
      })
      .filter(Boolean) as string[];

    if (lines.length < 1 && ecdBlocks.length < 1) return null;

    const resultLines = lines.map(l => {
      if (l.statusComment) return `${l.subject}: ${l.statusComment}`;
      const gradeStr = l.grade ? ` (${l.grade})` : '';
      return `${l.subject}: ${l.pct}%${gradeStr}`;
    });

    const avgPct = subjectCount > 0 ? (totalPct / subjectCount) : null;
    const fmtNum = (n: number) => n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1);
    const avgStr = avgPct !== null ? fmtNum(avgPct) : null;
    const totalFmt = fmtNum(totalPct);
    const totalStr = `${totalFmt}/${subjectCount * 100}`;
    const hasGradePoints = grades.length > 0;

    const summaryParts: string[] = [];
    if (subjectCount > 0) {
      if (avgStr !== null) summaryParts.push(`Avg: ${avgStr}%`);
      summaryParts.push(`Total: ${totalStr}`);
      if (hasGradePoints) summaryParts.push(`Points: ${Math.round(totalGradePoints)}`);
    }

    const headerLines = [
      `${schoolName}`,
      `(REPORT CARD)`,
      ``,
      `Student: ${studentName} (${regNo})`,
      `Class: ${className}`,
      `Exam: ${examName}`,
    ];
    if (termName) headerLines.push(`Term: ${termName}`);

    const msgParts = [
      ...headerLines,
      ``,
    ];

    if (resultLines.length > 0) {
      msgParts.push(`Academic Results:`);
      msgParts.push(...resultLines);
      msgParts.push(``);
    }

    if (summaryParts.length > 0) {
      msgParts.push(summaryParts.join(' | '));
    }

    if (ecdBlocks.length > 0) {
      msgParts.push(``);
      msgParts.push(`ECD Assessment:`);
      msgParts.push(...ecdBlocks);
      msgParts.push(``);
    }

    msgParts.push('Hardwork - Discipline - Changing Lives');

    return msgParts.join('\n');
  }


  app.get("/api/report-cards/:examId/student/:studentId/download", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const studentId = parseInt(req.params.studentId);
      const classId = req.query.classId ? parseInt(req.query.classId as string) : null;

      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const student = await storage.getStudent(studentId);
      if (!student || student.schoolId !== schoolId) return res.status(404).json({ message: "Student not found" });

      const activeClassId = classId || student.classId;
      if (!activeClassId) return res.status(400).json({ message: "Class context required" });

      const school = await storage.getSchool(schoolId);
      const classInfo = await storage.getClass(activeClassId);
      const exam = await storage.getExam(examId);
      if (!classInfo) return res.status(404).json({ message: "Class not found" });
      if (classInfo.schoolId && classInfo.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      if (!exam) return res.status(404).json({ message: "Exam not found" });
      if (exam.schoolId && exam.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      if (!currentUser || !(await ensurePublishedPortalAccess({ user: currentUser, examId, classId: activeClassId, studentId, res }))) return;

      const pdfData = await buildReportCardPdfData(studentId, examId, schoolId, school, classInfo, exam);
      if (!pdfData) return res.status(404).json({ message: "No report card data available for this student" });

      const pdfBuffer = await generateReportCardPdf(pdfData);
      const safeStudentName = `${student.firstName}_${student.lastName}`.replace(/\s+/g, "_");
      const safeClassName = (classInfo.className || 'Class').replace(/\s+/g, "_");
      const safeExamName = (exam.examName || 'Exam').replace(/\s+/g, "_");

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Report_Card_${safeStudentName}_${safeClassName}_${safeExamName}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/report-cards/send-all", requireAuth, async (req, res, next) => {
    try {
      const { examId, classId } = req.body;
      if (!examId || !classId) return res.status(400).json({ message: "Missing examId or classId" });

      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId || !currentUser) return res.status(400).json({ message: "School context required" });
      if (!(await userHasAnyPermission(currentUser.id, ["academic_reports.send.class", "academic_reports.send.stream"]))) {
        return res.status(403).json({ message: "Permission required to send academic reports" });
      }
      if (!(await isClassExamPublished(Number(examId), Number(classId)))) {
        return res.status(409).json({ message: "Publish this exercise/exam for the class before sending reports" });
      }

      const [school, classInfo, students, exam] = await Promise.all([
        storage.getSchool(schoolId),
        storage.getClass(classId),
        storage.getStudentsByClass(classId),
        storage.getExam(examId),
      ]);
      if (!classInfo || classInfo.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      if (exam && exam.schoolId && exam.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const userId = currentUser.id;
      const schoolName = school?.name || 'School';
      const className = classInfo?.className || `Class ${classId}`;
      const examName = exam?.examName || `Exam ${examId}`;

      const job = await queueCommunicationBackgroundJob({
        schoolId,
        requestedBy: userId,
        jobType: "report_cards_send_all",
        title: `Send report cards - ${className} - ${examName}`,
        totalCount: students.length,
        metadata: { examId, classId, className, examName, studentCount: students.length },
      }, async (jobId) => {
        let sent = 0, skipped = 0, noParent = 0, noResults = 0, smsCount = 0, emailCount = 0, processed = 0;
        const errors: string[] = [];

        for (const student of students) {
          processed++;
          try {
            if (!student.parentId) { noParent++; continue; }
            const parent = await storage.getParent(student.parentId);
            if (!parent) { noParent++; continue; }
            if (!parent.phone && !parent.email) { skipped++; continue; }

            const name = `${student.firstName} ${student.lastName}`;
            const regNo = student.admissionNo || '';
            const msg = await buildReportCardMessage(student.id, examId, schoolId, schoolName, className, examName, name, regNo);
            if (!msg) { noResults++; continue; }

            let anySent = false;
            if (parent.phone) {
              const smsResult = await communicationService.sendSms({
                to: parent.phone,
                message: msg,
                schoolId,
                recipientType: "parent",
                recipientId: parent.id,
                sentBy: userId,
                category: "academic_reports",
                recipientName: `${parent.firstName} ${parent.lastName}`,
              });
              if (smsResult.success) { smsCount++; anySent = true; }
              else if (smsResult.error) errors.push(`SMS to ${parent.phone}: ${smsResult.error}`);
            }

            if (parent.email) {
              try {
                const pdfData = await buildReportCardPdfData(student.id, examId, schoolId, school, classInfo, exam);
                const pdfBuffer = pdfData ? await generateReportCardPdf(pdfData) : null;
                const emailResult = await communicationService.sendEmail({
                  to: parent.email,
                  subject: `Report Card - ${name} | ${examName}`,
                  html: `<p>Dear Parent/Guardian,</p><p>Please find attached the report card for <strong>${name}</strong> (${regNo}).</p><p>Hardwork - Discipline - Changing Lives</p>`,
                  text: msg,
                  attachments: pdfBuffer ? [{ filename: `Report_Card_${name.replace(/\s+/g, '_')}.pdf`, content: pdfBuffer }] : undefined,
                  schoolId,
                  recipientType: "parent",
                  recipientId: parent.id,
                  sentBy: userId,
                  category: "academic_reports",
                  recipientName: `${parent.firstName} ${parent.lastName}`,
                });
                if (emailResult.success) { emailCount++; anySent = true; }
                else if (emailResult.error) errors.push(`Email to ${parent.email}: ${emailResult.error}`);
              } catch (pdfErr) {
                errors.push(`PDF/Email for ${name}: ${pdfErr instanceof Error ? pdfErr.message : 'unknown error'}`);
              }
            }

            if (anySent) sent++; else skipped++;
          } catch (studentErr) {
            skipped++;
            errors.push(`Student ${student.id}: ${studentErr instanceof Error ? studentErr.message : 'unknown error'}`);
          } finally {
            if (processed % 10 === 0 || processed === students.length) {
              await updateCommunicationJobProgress(jobId, { processedCount: processed, successCount: sent, failedCount: skipped, skippedCount: noParent + noResults });
            }
          }
        }

        return {
          processedCount: processed,
          successCount: sent,
          failedCount: skipped,
          skippedCount: noParent + noResults,
          errorSummary: errors.length ? errors.slice(0, 20).join("; ") : null,
          metadata: { sent, skipped, noParent, noResults, smsCount, emailCount, errors: errors.slice(0, 10) },
        };
      });

      const publication = await getClassExamPublication(Number(examId), Number(classId));
      await db.insert(assessmentPublicationEvents).values({
        publicationId: publication?.id || null,
        schoolId,
        examId: Number(examId),
        classId: Number(classId),
        streamId: classInfo?.streamId || null,
        action: "report_sent",
        publicationVersion: publication?.publicationVersion || 0,
        audience: "parents",
        channels: ["sms", "email"],
        performedByUserId: currentUser.id,
        metadata: { jobId: job.id, studentCount: students.length },
      });

      logActivity(req, {
        action: "create",
        category: "academic_reports",
        description: `Queued report cards for ${className} - ${examName}`,
        targetType: "communication_job",
        targetId: job.id,
        schoolId,
        metadata: { jobType: "report_cards_send_all", examId, classId, studentCount: students.length },
      });

      res.status(202).json({
        success: true,
        queued: true,
        jobId: job.id,
        message: `Report cards queued for ${students.length} student${students.length === 1 ? "" : "s"}. Sending will continue in the background.`,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/report-cards/send-one", requireAuth, async (req, res, next) => {
    try {
      const { examId, classId, studentId } = req.body;
      if (!examId || !classId || !studentId) return res.status(400).json({ message: "Missing parameters" });
      
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId || !currentUser) return res.status(400).json({ message: "School context required" });
      if (!(await storage.userHasPermission(currentUser.id, "academic_reports.send.class"))) {
        return res.status(403).json({ message: "Permission required: academic_reports.send.class" });
      }
      if (!(await isClassExamPublished(Number(examId), Number(classId)))) {
        return res.status(409).json({ message: "Publish this exercise/exam for the class before sending reports" });
      }
      
      const school = await storage.getSchool(schoolId);
      const classInfo = await storage.getClass(classId);
      const student = await storage.getStudent(studentId);
      if (!student) return res.status(404).json({ message: "Student not found" });
      
      if (!student.parentId) return res.status(400).json({ message: "No parent linked to this student" });
      const parent = await storage.getParent(student.parentId);
      if (!parent) return res.status(400).json({ message: "Parent not found" });
      
      const exam = await storage.getExam(examId);
      const userId = (req.user as any).id;
      const name = `${student.firstName} ${student.lastName}`;
      const className = classInfo?.className || `Class ${classId}`;
      const examName = exam?.examName || `Exam ${examId}`;
      const schoolName = school?.name || 'School';
      const regNo = student.admissionNo || '';

      const msg = await buildReportCardMessage(student.id, examId, schoolId, schoolName, className, examName, name, regNo);
      if (!msg) {
        return res.json({
          success: false,
          message: "No valid results found for this student. Report card not sent.",
          details: { smsCount: 0, emailCount: 0, errors: [] },
        });
      }
      
      let smsCount = 0, emailCount = 0;
      const errors: string[] = [];
      
      if (parent.phone) {
        const smsResult = await communicationService.sendSms({
          to: parent.phone,
          message: msg,
          schoolId,
          recipientType: "parent",
          recipientId: parent.id,
          sentBy: userId,
          category: "academic_reports",
          recipientName: `${parent.firstName} ${parent.lastName}`,
        });
        if (smsResult.success) smsCount++;
        else if (smsResult.error) errors.push(`SMS: ${smsResult.error}`);
      }
      
      if (parent.email) {
        try {
          const pdfData = await buildReportCardPdfData(student.id, examId, schoolId, school, classInfo, exam);
          const pdfBuffer = pdfData ? await generateReportCardPdf(pdfData) : null;
          const emailResult = await communicationService.sendEmail({
            to: parent.email,
            subject: `Report Card - ${name} | ${examName}`,
            html: `<p>Dear Parent/Guardian,</p><p>Please find attached the report card for <strong>${name}</strong> (${regNo}).</p><p>Hardwork - Discipline - Changing Lives</p>`,
            text: msg,
            attachments: pdfBuffer ? [{ filename: `Report_Card_${name.replace(/\s+/g, '_')}.pdf`, content: pdfBuffer }] : undefined,
            schoolId,
            recipientType: "parent",
            recipientId: parent.id,
            sentBy: userId,
            category: "academic_reports",
            recipientName: `${parent.firstName} ${parent.lastName}`,
          });
          if (emailResult.success) emailCount++;
          else if (emailResult.error) errors.push(`Email: ${emailResult.error}`);
        } catch (pdfErr) {
          errors.push(`PDF/Email: ${pdfErr instanceof Error ? pdfErr.message : 'unknown error'}`);
        }
      }
      
      if (smsCount === 0 && emailCount === 0) {
        return res.json({ 
          success: false, 
          message: `Could not send report card. ${errors.join('. ')}`,
          details: { smsCount, emailCount, errors },
        });
      }
      
      const publication = await getClassExamPublication(Number(examId), Number(classId));
      await db.insert(assessmentPublicationEvents).values({
        publicationId: publication?.id || null,
        schoolId,
        examId: Number(examId),
        classId: Number(classId),
        streamId: classInfo?.streamId || null,
        action: "report_sent",
        publicationVersion: publication?.publicationVersion || 0,
        audience: "parents",
        channels: ["sms", "email"],
        performedByUserId: currentUser.id,
        metadata: { studentId, smsCount, emailCount },
      });

      res.json({ 
        success: true, 
        message: `Report card sent. [SMS: ${smsCount}, Email: ${emailCount}]`,
        details: { smsCount, emailCount, errors },
      });
    } catch (error) {
      next(error);
    }
  });

  // =============================================
  // REPORT HUB APIs
  // =============================================

  // Get streams for report hub (filtered to those with classes in current school)
  app.get("/api/report-hub/streams", requireAuth, async (req, res, next) => {
    try {
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const allStreams = await storage.getAllStreams();
      const allClasses = await storage.getAllClasses();
      const schoolStreamIds = new Set(allClasses.filter(c => c.schoolId === schoolId).map(c => c.streamId).filter(Boolean));
      const filtered = allStreams.filter(s => schoolStreamIds.has(s.id));
      res.json(filtered);
    } catch (error) {
      next(error);
    }
  });

  const publicationActionSchema = z.object({
    examId: z.coerce.number().int().positive(),
    classId: z.coerce.number().int().positive().optional(),
    streamId: z.coerce.number().int().positive().optional(),
    publish: z.boolean(),
    reason: z.string().trim().optional().nullable(),
  });

  async function setClassPublication(args: {
    schoolId: number;
    examId: number;
    classId: number;
    streamId?: number | null;
    publish: boolean;
    reason?: string | null;
    userId: number;
  }) {
    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(assessmentPublications).where(and(
        eq(assessmentPublications.examId, args.examId),
        eq(assessmentPublications.classId, args.classId),
      )).limit(1);

      if (!args.publish && !args.reason?.trim()) {
        throw new Error("A reason is required when unpublishing results");
      }

      const now = new Date();
      let publication: any;
      let action = args.publish ? "published" : "unpublished";
      let version = existing?.publicationVersion || 0;

      if (args.publish) {
        if (existing?.isPublished) return { publication: existing, changed: false, action: existing.lastAction || "published" };
        version += 1;
        action = version > 1 ? "republished" : "published";
        const values = {
          schoolId: args.schoolId,
          examId: args.examId,
          classId: args.classId,
          streamId: args.streamId || null,
          isPublished: true,
          publicationVersion: version,
          lastAction: action,
          publishedByUserId: args.userId,
          publishedAt: now,
          unpublishedByUserId: null,
          unpublishedAt: null,
          unpublishReason: null,
          updatedAt: now,
        };
        if (existing) {
          [publication] = await tx.update(assessmentPublications).set(values).where(eq(assessmentPublications.id, existing.id)).returning();
        } else {
          [publication] = await tx.insert(assessmentPublications).values(values).returning();
        }
      } else {
        if (!existing?.isPublished) return { publication: existing, changed: false, action: "unpublished" };
        [publication] = await tx.update(assessmentPublications).set({
          isPublished: false,
          lastAction: "unpublished",
          unpublishedByUserId: args.userId,
          unpublishedAt: now,
          unpublishReason: args.reason?.trim() || null,
          updatedAt: now,
        }).where(eq(assessmentPublications.id, existing.id)).returning();
      }

      await tx.insert(assessmentPublicationEvents).values({
        publicationId: publication?.id || existing?.id || null,
        schoolId: args.schoolId,
        examId: args.examId,
        classId: args.classId,
        streamId: args.streamId || null,
        action,
        publicationVersion: version,
        reason: args.publish ? null : args.reason?.trim() || null,
        performedByUserId: args.userId,
      });

      return { publication, changed: true, action };
    });
  }

  app.get("/api/report-hub/publication-status/:examId", requireAuth, async (req, res, next) => {
    try {
      const examId = Number(req.params.examId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const exam = await storage.getExam(examId);
      if (!exam) return res.status(404).json({ message: "Exercise/exam not found" });
      if (exam.schoolId && exam.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const schoolClasses = await storage.getClassesBySchool(schoolId);
      const rows = await db.select().from(assessmentPublications).where(and(
        eq(assessmentPublications.schoolId, schoolId),
        eq(assessmentPublications.examId, examId),
      ));
      const byClass = new Map(rows.map((row: any) => [Number(row.classId), row]));

      res.json({
        examId,
        classes: schoolClasses.map((classInfo: any) => {
          const publication: any = byClass.get(Number(classInfo.id));
          return {
            classId: classInfo.id,
            streamId: classInfo.streamId,
            isPublished: publication?.isPublished === true,
            status: publication?.isPublished ? (publication.lastAction === "republished" ? "Republished" : "Published") : "Unpublished",
            publicationVersion: publication?.publicationVersion || 0,
            publishedAt: publication?.publishedAt || null,
          };
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/report-hub/publication/class", requireAuth, async (req, res, next) => {
    try {
      const data = publicationActionSchema.parse(req.body);
      if (!data.classId) return res.status(400).json({ message: "classId is required" });
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId || !currentUser) return res.status(400).json({ message: "School context required" });

      const permission = data.publish ? "academic_reports.publish.class" : "academic_reports.unpublish";
      if (!(await storage.userHasPermission(currentUser.id, permission))) {
        return res.status(403).json({ message: `Permission required: ${permission}` });
      }

      const classInfo = await storage.getClass(data.classId);
      const exam = await storage.getExam(data.examId);
      if (!classInfo || classInfo.schoolId !== schoolId) return res.status(404).json({ message: "Class not found" });
      if (!exam || (exam.schoolId && exam.schoolId !== schoolId)) return res.status(404).json({ message: "Exercise/exam not found" });

      const progressContext = await loadExamProgressContext(schoolId, data.examId);
      const progress = buildClassExamProgress(progressContext, data.classId);
      const result = await setClassPublication({
        schoolId,
        examId: data.examId,
        classId: data.classId,
        streamId: classInfo.streamId,
        publish: data.publish,
        reason: data.reason,
        userId: currentUser.id,
      });

      logActivity(req, {
        action: data.publish ? "publish" : "unpublish",
        category: "academic_reports",
        description: `${result.action === "republished" ? "Republished" : data.publish ? "Published" : "Unpublished"} ${exam.examName} for ${classInfo.className}`,
        targetType: "exam_class_publication",
        targetId: result.publication?.id,
        targetName: `${exam.examName} - ${classInfo.className}`,
        schoolId,
        metadata: { examId: data.examId, classId: data.classId, reason: data.publish ? undefined : data.reason, summary: progress.totals },
      });

      res.json({
        changed: result.changed,
        action: result.action,
        isPublished: result.publication?.isPublished === true,
        status: result.publication?.isPublished ? (result.action === "republished" ? "Republished" : "Published") : "Unpublished",
        summary: progress.totals,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid publication request", errors: error.errors });
      if (error?.message) return res.status(400).json({ message: error.message });
      next(error);
    }
  });

  app.post("/api/report-hub/publication/stream", requireAuth, async (req, res, next) => {
    try {
      const data = publicationActionSchema.parse(req.body);
      if (!data.streamId) return res.status(400).json({ message: "streamId is required" });
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId || !currentUser) return res.status(400).json({ message: "School context required" });

      const permission = data.publish ? "academic_reports.publish.stream" : "academic_reports.unpublish";
      if (!(await storage.userHasPermission(currentUser.id, permission))) {
        return res.status(403).json({ message: `Permission required: ${permission}` });
      }

      const exam = await storage.getExam(data.examId);
      if (!exam || (exam.schoolId && exam.schoolId !== schoolId)) return res.status(404).json({ message: "Exercise/exam not found" });
      const classes = (await storage.getClassesBySchool(schoolId)).filter((classInfo: any) => Number(classInfo.streamId) === Number(data.streamId));
      if (!classes.length) return res.status(404).json({ message: "No classes found for the selected stream" });
      const progressContext = await loadExamProgressContext(schoolId, data.examId);

      const changedClasses: number[] = [];
      const summaries: any[] = [];
      for (const classInfo of classes) {
        const current = progressContext.publicationByClass.get(Number(classInfo.id));
        if (data.publish && current?.isPublished) continue;
        if (!data.publish && !current?.isPublished) continue;
        const progress = buildClassExamProgress(progressContext, classInfo.id);
        summaries.push({ classId: classInfo.id, className: classInfo.className, ...progress.totals });
        const result = await setClassPublication({
          schoolId,
          examId: data.examId,
          classId: classInfo.id,
          streamId: data.streamId,
          publish: data.publish,
          reason: data.reason,
          userId: currentUser.id,
        });
        if (result.changed) changedClasses.push(classInfo.id);
      }

      const rows = await db.select().from(assessmentPublications).where(and(
        eq(assessmentPublications.schoolId, schoolId),
        eq(assessmentPublications.examId, data.examId),
        eq(assessmentPublications.streamId, data.streamId),
      ));
      const publishedClassIds = new Set(rows.filter((row: any) => row.isPublished).map((row: any) => Number(row.classId)));
      const allPublished = classes.every((classInfo: any) => publishedClassIds.has(Number(classInfo.id)));

      logActivity(req, {
        action: data.publish ? "publish" : "unpublish",
        category: "academic_reports",
        description: `${data.publish ? "Published" : "Unpublished"} ${exam.examName} for ${changedClasses.length} class${changedClasses.length === 1 ? "" : "es"} in a stream`,
        targetType: "exam_stream_publication",
        targetId: data.streamId,
        targetName: exam.examName,
        schoolId,
        metadata: { examId: data.examId, streamId: data.streamId, changedClasses, reason: data.publish ? undefined : data.reason, summaries },
      });

      res.json({
        changedClassIds: changedClasses,
        classCount: classes.length,
        publishedCount: classes.filter((classInfo: any) => publishedClassIds.has(Number(classInfo.id))).length,
        allPublished,
        status: allPublished ? "Published" : "Unpublished",
        summaries,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid publication request", errors: error.errors });
      if (error?.message) return res.status(400).json({ message: error.message });
      next(error);
    }
  });

  // Get stream-level stats for an exam (all offered subjects and expected learner-subject entries)
  app.get("/api/report-hub/stream-stats/:examId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const [allStreams, progressContext] = await Promise.all([
        storage.getAllStreams(),
        loadExamProgressContext(schoolId, examId),
      ]);
      const schoolClasses = Array.from(progressContext.classesById.values());
      const publicationByClass = progressContext.publicationByClass;

      const streamStats = allStreams.map((stream: any) => {
        const streamClasses = schoolClasses.filter((classInfo: any) => Number(classInfo.streamId) === Number(stream.id));
        if (!streamClasses.length) return null;

        const classProgress = streamClasses.map((classInfo: any) => buildClassExamProgress(progressContext, classInfo.id));
        const expectedEntries = classProgress.reduce((sum, item) => sum + item.totals.expectedEntries, 0);
        const withMarks = classProgress.reduce((sum, item) => sum + item.totals.withMarks, 0);
        const acknowledged = classProgress.reduce((sum, item) => sum + item.totals.acknowledged, 0);
        const partial = classProgress.reduce((sum, item) => sum + item.totals.partial, 0);
        const unrecorded = classProgress.reduce((sum, item) => sum + item.totals.unrecorded, 0);
        const assessmentCreatedCount = classProgress.reduce((sum, item) => sum + item.totals.assessmentsCreated, 0);
        const assessmentMissingCount = classProgress.reduce((sum, item) => sum + item.totals.assessmentsMissing, 0);

        const weightedAverages = classProgress.flatMap((item) => item.subjects)
          .filter((subject) => subject.avgPct !== null && subject.markedCount > 0)
          .map((subject) => ({ value: Number(subject.avgPct), weight: subject.markedCount }));
        const totalAverageWeight = weightedAverages.reduce((sum, item) => sum + item.weight, 0);
        const avgPct = totalAverageWeight > 0
          ? Math.round(weightedAverages.reduce((sum, item) => sum + item.value * item.weight, 0) / totalAverageWeight)
          : null;

        const publishedCount = streamClasses.filter((classInfo: any) => publicationByClass.get(Number(classInfo.id))?.isPublished === true).length;
        const allPublished = publishedCount === streamClasses.length;
        const anyPublished = publishedCount > 0;
        const progressPct = expectedEntries > 0 ? Math.round(((withMarks + acknowledged) / expectedEntries) * 100) : 0;
        const withMarksPct = expectedEntries > 0 ? Math.round((withMarks / expectedEntries) * 100) : 0;
        const acknowledgedPct = expectedEntries > 0 ? Math.round((acknowledged / expectedEntries) * 100) : 0;

        return {
          streamId: stream.id,
          streamName: stream.name,
          classes: streamClasses.map((classInfo: any) => ({
            id: classInfo.id,
            name: classInfo.className,
            isPublished: publicationByClass.get(Number(classInfo.id))?.isPublished === true,
          })),
          progressPct,
          withMarksPct,
          acknowledgedPct,
          unrecordedPct: Math.max(0, 100 - withMarksPct - acknowledgedPct),
          avgPct,
          classCount: streamClasses.length,
          studentCount: classProgress.reduce((sum, item) => sum + item.students.length, 0),
          expectedEntries,
          withMarksCount: withMarks,
          acknowledgedCount: acknowledged,
          partialCount: partial,
          unrecordedCount: unrecorded,
          assessmentCreatedCount,
          assessmentMissingCount,
          publishedCount,
          allPublished,
          anyPublished,
          publicationStatus: allPublished ? "Published" : anyPublished ? "Partially published" : "Unpublished",
        };
      });

      res.json(streamStats.filter(Boolean));
    } catch (error) {
      next(error);
    }
  });

  // Get class-level subject progress for an exam. Subjects are driven by the class offering,
  // not by the assessments that happen to have been created.
  app.get("/api/report-hub/class-progress/:examId/:classId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const classId = parseInt(req.params.classId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const progressContext = await loadExamProgressContext(schoolId, examId);
      const progress = buildClassExamProgress(progressContext, classId);
      if (progress.classInfo.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const subjectIds = new Set(progress.subjects.map((subject) => Number(subject.subjectId)));
      const teacherMap = new Map<number, string>();
      const getTeacherDisplayName = async (staffId: number) => {
        const staffMember = await storage.getStaff(staffId);
        if (!staffMember) return `Staff #${staffId}`;
        const user = staffMember.userId ? await storage.getUser(staffMember.userId) : null;
        const normalizedGender = String(staffMember.gender || "").toLowerCase();
        const title = normalizedGender === "male" ? "Mr." : normalizedGender === "female" ? "Ms." : "";
        const firstName = String(staffMember.firstName || user?.firstName || "").trim();
        const lastName = String(staffMember.lastName || user?.lastName || "").trim();
        const firstInitial = firstName ? `${firstName.charAt(0).toUpperCase()}.` : "";
        return lastName ? [title, firstInitial, lastName].filter(Boolean).join(" ") : `${firstName} ${lastName}`.trim() || `Staff #${staffId}`;
      };

      const exactAssignments = await db.select({
        staffId: staffSubjects.staffId,
        subjectId: staffSubjects.subjectId,
      }).from(staffSubjects).where(eq(staffSubjects.classId, classId));
      for (const row of exactAssignments) {
        if (subjectIds.has(Number(row.subjectId)) && !teacherMap.has(Number(row.subjectId))) {
          teacherMap.set(Number(row.subjectId), await getTeacherDisplayName(Number(row.staffId)));
        }
      }

      const timetableRows = await db.select({
        teacherId: timetableSlotsTable.teacherId,
        subjectId: timetableSlotsTable.subjectId,
      }).from(timetableSlotsTable).where(eq(timetableSlotsTable.classId, classId));
      const timetableCounts = new Map<number, Map<number, number>>();
      for (const row of timetableRows) {
        if (!row.teacherId || !subjectIds.has(Number(row.subjectId)) || teacherMap.has(Number(row.subjectId))) continue;
        const counts = timetableCounts.get(Number(row.subjectId)) || new Map<number, number>();
        counts.set(Number(row.teacherId), (counts.get(Number(row.teacherId)) || 0) + 1);
        timetableCounts.set(Number(row.subjectId), counts);
      }
      for (const [subjectId, counts] of Array.from(timetableCounts.entries())) {
        const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
        if (top) teacherMap.set(subjectId, await getTeacherDisplayName(top[0]));
      }

      const publication = await getClassExamPublication(examId, classId);
      res.json({
        classId,
        className: progress.classInfo.className,
        totalStudents: progress.students.length,
        subjects: progress.subjects.map((subject) => ({
          ...subject,
          teacherName: teacherMap.get(Number(subject.subjectId)) || null,
        })),
        totals: progress.totals,
        publication: {
          isPublished: publication?.isPublished === true,
          status: publication?.isPublished ? (publication.lastAction === "republished" ? "Republished" : "Published") : "Unpublished",
          publicationVersion: publication?.publicationVersion || 0,
          publishedAt: publication?.publishedAt || null,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Missing marks for a class (grouped by every subject offered by the class)
  app.get("/api/report-hub/missing-marks/:examId/:classId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const classId = parseInt(req.params.classId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const classInfo = await storage.getClass(classId);
      if (!classInfo || Number(classInfo.schoolId) !== Number(schoolId)) return res.status(403).json({ message: "Access denied" });

      const students = await storage.getStudentsByClass(classId);
      const studentSubjectIdsByStudent = new Map<number, Set<number>>();
      await Promise.all(students.map(async (student: any) => {
        const rows = await storage.getStudentSubjects(student.id);
        studentSubjectIdsByStudent.set(student.id, new Set(rows.map((row: any) => Number(row.subjectId))));
      }));

      const classSubjectRows = await storage.getClassSubjects(classId);
      const offeredSubjectIds = Array.from(new Set(classSubjectRows.map((row: any) => Number(row.subjectId))));
      const offeredSubjects = (await Promise.all(offeredSubjectIds.map((id) => storage.getSubject(id))))
        .filter(Boolean)
        .sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || "")));

      const classAssessments = (await storage.getAssessmentsByExam(examId))
        .filter((assessment: any) => Number(assessment.classId) === classId);
      const assessmentBySubject = new Map<number, any>();
      for (const assessment of classAssessments) {
        if (!assessmentBySubject.has(Number(assessment.subjectId))) assessmentBySubject.set(Number(assessment.subjectId), assessment);
      }

      const assessmentIds = classAssessments.map((assessment: any) => assessment.id);
      const marks = assessmentIds.length ? await storage.getAssessmentMarksByAssessments(assessmentIds) : [];
      const papersByAssessment = new Map<number, any[]>();
      await Promise.all(classAssessments.map(async (assessment: any) => {
        papersByAssessment.set(assessment.id, await storage.getAssessmentPapers(assessment.id));
      }));
      const paperMarksByMark = new Map<number, any[]>();
      await Promise.all(marks.map(async (mark: any) => {
        paperMarksByMark.set(mark.id, await storage.getMarkPapers(mark.id));
      }));

      const missingBySubject = offeredSubjects.map((subject: any) => {
        const eligibleStudents = students.filter((student: any) => studentSubjectIdsByStudent.get(student.id)?.has(Number(subject.id)));
        const assessment = assessmentBySubject.get(Number(subject.id));
        if (!assessment) {
          return {
            subjectId: subject.id,
            subjectName: subject.name,
            assessmentCreated: false,
            totalStudents: eligibleStudents.length,
            missingCount: eligibleStudents.length,
            missingStudents: eligibleStudents.map((student: any) => ({
              id: student.id,
              name: `${student.firstName} ${student.lastName}`,
              admissionNo: student.admissionNo,
              reason: "Assessment not created",
            })),
          };
        }

        const markByStudent = new Map(
          marks
            .filter((mark: any) => Number(mark.assessmentId) === Number(assessment.id))
            .map((mark: any) => [Number(mark.studentId), mark]),
        );
        const requiredPapers = papersByAssessment.get(assessment.id) || [];
        const missingStudents = eligibleStudents.flatMap((student: any) => {
          const mark: any = markByStudent.get(Number(student.id));
          const normalizedStatus = String(mark?.attStatus || "").toLowerCase();
          if (ACKNOWLEDGED_NOT_WRITTEN_STATUSES.has(normalizedStatus)) return [];

          let reason = "Not recorded";
          if (mark) {
            if (requiredPapers.length > 0) {
              const paperMarks = paperMarksByMark.get(mark.id) || [];
              const valueByPaper = new Map(paperMarks.map((row: any) => [Number(row.assessmentPaperId), row.markObtained]));
              const completed = requiredPapers.filter((paper: any) => {
                const value = valueByPaper.get(Number(paper.id));
                return value !== null && value !== undefined && String(value).trim() !== "";
              }).length;
              if (completed === requiredPapers.length) return [];
              if (completed > 0) reason = "Partial papers recorded";
            } else if (mark.percentage !== null && mark.percentage !== undefined) {
              return [];
            }
          }

          return [{ id: student.id, name: `${student.firstName} ${student.lastName}`, admissionNo: student.admissionNo, reason }];
        });

        return {
          subjectId: subject.id,
          subjectName: subject.name,
          assessmentCreated: true,
          totalStudents: eligibleStudents.length,
          missingCount: missingStudents.length,
          missingStudents,
        };
      });

      res.json(missingBySubject);
    } catch (error) {
      next(error);
    }
  });

  // Class merit list
  app.get("/api/report-hub/class-merit/:examId/:classId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const classId = parseInt(req.params.classId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const [classInfo, exam, school] = await Promise.all([
        storage.getClass(classId),
        storage.getExam(examId),
        storage.getSchool(schoolId),
      ]);
      if (!classInfo || classInfo.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      if (exam && exam.schoolId && exam.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const stream = classInfo.streamId ? await storage.getStream(classInfo.streamId) : undefined;
      const streamName = stream?.name || null;
      const showPointsColumn = shouldShowMeritPointsColumn({ streamName, className: classInfo.className });
      const allGrades = await storage.getGradesBySchool(schoolId);

      const students = await storage.getStudentsByClass(classId);
      const studentSubjectIdsByStudent = new Map<number, Set<number>>();
      await Promise.all(students.map(async (student: any) => {
        const rows = await storage.getStudentSubjects(student.id);
        studentSubjectIdsByStudent.set(
          student.id,
          new Set(rows.map((row: any) => row.subjectId).filter((id: any) => id !== null && id !== undefined)),
        );
      }));

      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const classAssessments = allAssessmentsRaw.filter(a => a.classId === classId);

      const subjectIds = [...new Set(classAssessments.map(a => a.subjectId))];
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const validSubjects = subjectsData.filter(Boolean);

      const gradeCandidatesBySubject = new Map<number, any[]>();
      const getSubjectGradeCandidates = (subject: any) => {
        const existing = gradeCandidatesBySubject.get(Number(subject.id));
        if (existing) return existing;
        const profileKey = resolveGradeProfileKey({
          schoolType: school?.schoolType,
          examinationBoard: school?.examinationBoard,
          streamName,
          subjectType: subject.subjectType,
        });
        const applicableGrades = getApplicableGradesForContext(allGrades, { profileKey, classId });
        const candidates = getAnalyticsGradeCandidates(applicableGrades, subject.subjectType);
        gradeCandidatesBySubject.set(Number(subject.id), candidates);
        return candidates;
      };

      const assessmentIds = classAssessments.map(a => a.id);
      let classMarks: any[] = [];
      if (assessmentIds.length > 0) {
        classMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      }

      const rows = students.map(student => {
        const eligibleSubjectIds = studentSubjectIdsByStudent.get(student.id) || new Set<number>();
        const studentMarks = classMarks.filter(m => m.studentId === student.id);
        const cells: Record<number, number | null> = {};
        const cellGrades: Record<number, string> = {};
        const cellDisplays: Record<number, string> = {};
        let sum = 0;
        let eligibleCount = 0;
        let have = 0;
        let totalPoints = 0;

        for (const subject of validSubjects) {
          if (!subject) continue;
          const takesSubject = eligibleSubjectIds.has(subject.id);
          if (!takesSubject) {
            cells[subject.id] = null;
            continue;
          }

          eligibleCount++;
          const mark = studentMarks.find(m => m.subjectId === subject.id);
          const pct = mark?.percentage !== null && mark?.percentage !== undefined ? parseFloat(mark.percentage) : null;
          cells[subject.id] = pct;
          if (pct !== null) {
            sum += pct;
            have++;
            const gradeCandidates = getSubjectGradeCandidates(subject);
            const grade = resolveAnalyticsGradeForMark(mark, pct, gradeCandidates, subject.subjectType, allGrades);
            const gradeLabel = getGradeDisplayName(grade);
            totalPoints += getMeritGradePoints(grade);
            if (gradeLabel) cellGrades[subject.id] = gradeLabel;
            cellDisplays[subject.id] = formatMeritMarkDisplay(pct, gradeLabel);
          }
        }

        const avg = eligibleCount > 0 ? sum / eligibleCount : 0;

        return {
          studentName: `${student.firstName} ${student.lastName}`,
          admissionNo: student.admissionNo,
          cells,
          cellGrades,
          cellDisplays,
          total: Math.round(sum),
          totalDisplay: `${Math.round(sum)}/${eligibleCount * 100}`,
          avg: Math.round(avg * 10) / 10,
          avgDisplay: `${Math.round(avg)}%`,
          points: totalPoints,
          pointsDisplay: formatMeritPoints(totalPoints),
          subjectsWithMarks: have,
          eligibleSubjectCount: eligibleCount,
        };
      }).filter(row => row.eligibleSubjectCount > 0);

      rows.sort((a, b) => {
        if (b.avg !== a.avg) return b.avg - a.avg;
        if (b.total !== a.total) return b.total - a.total;
        return a.studentName.localeCompare(b.studentName);
      });

      let meritPos = 0;
      let meritLastAvg: number | null = null;
      const rankedRows = rows.map((row, index) => {
        if (row.avg !== meritLastAvg) {
          meritPos = index + 1;
          meritLastAvg = row.avg;
        }
        return {
          ...row,
          position: `${meritPos}/${rows.length}`,
        };
      });

      res.json({
        examName: exam?.examName || "",
        className: classInfo.className,
        subjects: validSubjects.map(s => ({ id: s!.id, name: getReportSubjectLabel(s) })),
        rows: rankedRows,
        totalStudents: rows.length,
        showPointsColumn,
      });
    } catch (error) {
      next(error);
    }
  });


  function getGradeDisplayName(grade: any) {
    return String(grade?.gradeName || "").trim();
  }

  function formatMeritMarkDisplay(pct: number, gradeLabel?: string | null) {
    const rounded = Math.round(pct);
    const cleanGrade = String(gradeLabel || "").trim();
    return cleanGrade ? `${rounded}% (${cleanGrade})` : `${rounded}%`;
  }

  function getMeritGradePoints(grade: any) {
    const rawPoints = grade?.gradePoints ?? grade?.points ?? 0;
    const points = typeof rawPoints === "number" ? rawPoints : parseFloat(String(rawPoints));
    return Number.isFinite(points) ? points : 0;
  }

  function formatMeritPoints(points: number) {
    if (!Number.isFinite(points)) return "0";
    return Number.isInteger(points) ? String(points) : String(Number(points.toFixed(1)));
  }

  function shouldShowMeritPointsColumn(_context?: { streamName?: string | null; className?: string | null }) {
    return true;
  }

  function getReportSubjectLabel(subject: any) {
    const shortCode = String(subject?.shortCode || "").trim();
    const syllabusCode = String(subject?.syllabusCode || "").trim();
    const base = shortCode || String(subject?.name || "Subject").trim() || "Subject";
    return syllabusCode ? `${base} (${syllabusCode})` : base;
  }

  async function getAnalyticsTeacherDisplayName(staffId: number) {
    const staffMember = await storage.getStaff(staffId);
    if (!staffMember) return `Staff #${staffId}`;

    const user = staffMember.userId ? await storage.getUser(staffMember.userId) : null;
    const normalizedGender = (staffMember.gender || "").toString().toLowerCase();
    const title = normalizedGender === "male" ? "Mr." : normalizedGender === "female" ? "Ms." : "";
    const firstName = ((staffMember.firstName || user?.firstName || "") as string).trim();
    const lastName = ((staffMember.lastName || user?.lastName || "") as string).trim();
    const firstInitial = firstName ? `${firstName.charAt(0).toUpperCase()}.` : "";

    if (lastName) {
      return [title, firstInitial, lastName].filter(Boolean).join(" ").trim();
    }

    const fallbackName = user
      ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
      : `${staffMember.firstName || ""} ${staffMember.lastName || ""}`.trim();

    return fallbackName || `Staff #${staffId}`;
  }

  async function resolveClassSubjectTeacherNames(schoolId: number, classId: number, subjectIds: number[]) {
    const teacherMap = new Map<number, string>();
    const subjectIdSet = new Set(subjectIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)));
    const teacherNameCache = new Map<number, string>();

    const getCachedTeacherName = async (staffId: number) => {
      const id = Number(staffId);
      if (teacherNameCache.has(id)) return teacherNameCache.get(id)!;
      const name = await getAnalyticsTeacherDisplayName(id);
      teacherNameCache.set(id, name);
      return name;
    };

    const setTeacherIfNeeded = async (subjectId: number, staffId: number | null | undefined) => {
      const normalizedSubjectId = Number(subjectId);
      if (!subjectIdSet.has(normalizedSubjectId) || !staffId || teacherMap.has(normalizedSubjectId)) return;
      teacherMap.set(normalizedSubjectId, await getCachedTeacherName(Number(staffId)));
    };

    if (subjectIdSet.size === 0) return teacherMap;

    // Primary source: Staff Management → exact Class + Subject assignments.
    try {
      const subjectTeacherRows = await db.select({
        staffId: staffSubjects.staffId,
        subjectId: staffSubjects.subjectId,
      }).from(staffSubjects).where(eq(staffSubjects.classId, classId));

      for (const row of subjectTeacherRows) {
        await setTeacherIfNeeded(Number(row.subjectId), row.staffId);
      }
    } catch (error) {
      console.warn("[ANALYTICS_TEACHER_ASSIGNMENTS_ERROR]", error);
    }

    // Fallback source: Timetable slots for the same Class + Subject.
    try {
      const timetableTeacherRows = await db.select({
        teacherId: timetableSlotsTable.teacherId,
        subjectId: timetableSlotsTable.subjectId,
      }).from(timetableSlotsTable).where(eq(timetableSlotsTable.classId, classId));

      const countsBySubject = new Map<number, Map<number, number>>();
      for (const row of timetableTeacherRows) {
        const subjectId = Number(row.subjectId);
        if (!row.teacherId || !subjectIdSet.has(subjectId) || teacherMap.has(subjectId)) continue;
        const subjectCounts = countsBySubject.get(subjectId) || new Map<number, number>();
        subjectCounts.set(Number(row.teacherId), (subjectCounts.get(Number(row.teacherId)) || 0) + 1);
        countsBySubject.set(subjectId, subjectCounts);
      }

      for (const [subjectId, teacherCounts] of countsBySubject.entries()) {
        const [topTeacherId] = Array.from(teacherCounts.entries()).sort((a, b) => b[1] - a[1])[0] || [];
        await setTeacherIfNeeded(subjectId, topTeacherId);
      }
    } catch (error) {
      console.warn("[ANALYTICS_TIMETABLE_TEACHER_ERROR]", error);
    }

    // Last safe fallback: legacy staff_subjects rows where class_id is NULL.
    // Only use this when exactly one staff member in this school is assigned to the subject.
    try {
      const legacyRows = await db.select({
        staffId: staffSubjects.staffId,
        subjectId: staffSubjects.subjectId,
      }).from(staffSubjects).where(sql`${staffSubjects.classId} IS NULL`);

      const legacyBySubject = new Map<number, number[]>();
      for (const row of legacyRows) {
        const subjectId = Number(row.subjectId);
        if (!subjectIdSet.has(subjectId) || teacherMap.has(subjectId)) continue;
        const staffMember = await storage.getStaff(Number(row.staffId));
        if (!staffMember || staffMember.schoolId !== schoolId) continue;
        const current = legacyBySubject.get(subjectId) || [];
        current.push(Number(row.staffId));
        legacyBySubject.set(subjectId, current);
      }

      for (const [subjectId, staffIds] of legacyBySubject.entries()) {
        const uniqueStaffIds = Array.from(new Set(staffIds));
        if (uniqueStaffIds.length === 1) {
          await setTeacherIfNeeded(subjectId, uniqueStaffIds[0]);
        }
      }
    } catch (error) {
      console.warn("[ANALYTICS_LEGACY_TEACHER_ASSIGNMENTS_ERROR]", error);
    }

    return teacherMap;
  }

  async function resolveStreamSubjectTeacherNames(schoolId: number, classIds: number[], subjectIds: number[]) {
    const teachersBySubject = new Map<number, Set<string>>();

    for (const classId of classIds) {
      const classTeacherMap = await resolveClassSubjectTeacherNames(schoolId, classId, subjectIds);
      for (const [subjectId, teacherName] of classTeacherMap.entries()) {
        if (!teacherName) continue;
        const existing = teachersBySubject.get(subjectId) || new Set<string>();
        existing.add(teacherName);
        teachersBySubject.set(subjectId, existing);
      }
    }

    const result = new Map<number, string>();
    for (const [subjectId, names] of teachersBySubject.entries()) {
      result.set(subjectId, Array.from(names).sort((a, b) => a.localeCompare(b)).join(", "));
    }
    return result;
  }

  function orderAnalyticsGrades(grades: any[]) {
    return [...grades].sort((a, b) => {
      const upperDiff = Number(b.upperLimit ?? -1) - Number(a.upperLimit ?? -1);
      if (upperDiff !== 0) return upperDiff;
      const lowerDiff = Number(b.lowerLimit ?? -1) - Number(a.lowerLimit ?? -1);
      if (lowerDiff !== 0) return lowerDiff;
      return getGradeDisplayName(a).localeCompare(getGradeDisplayName(b));
    });
  }

  function uniqueAnalyticsGradesByName(grades: any[]) {
    const seen = new Set<string>();
    const result: any[] = [];
    for (const grade of grades) {
      const name = getGradeDisplayName(grade);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      result.push(grade);
    }
    return result;
  }

  function getAnalyticsGradeCandidates(grades: any[], subjectType?: string | null) {
    const ordered = orderAnalyticsGrades(grades);
    const compatibleTyped = ordered.filter((grade) => grade.gradeType && isSubjectTypeCompatibleWithGradeType(subjectType, grade.gradeType));
    const genericGrades = ordered.filter((grade) => !grade.gradeType);
    const candidates = compatibleTyped.length > 0
      ? [...compatibleTyped, ...genericGrades]
      : genericGrades.length > 0
        ? genericGrades
        : ordered;
    return uniqueAnalyticsGradesByName(candidates);
  }

  function addAnalyticsGradeColumns(columns: string[], grades: any[]) {
    const seen = new Set(columns);
    for (const grade of grades) {
      const name = getGradeDisplayName(grade);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      columns.push(name);
    }
  }

  function uniqueGradesById(grades: any[]) {
    const seen = new Set<number>();
    const result: any[] = [];
    for (const grade of grades) {
      const id = Number(grade?.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      result.push(grade);
    }
    return result;
  }

  function findGradeForPercentage(pct: number, grades: any[], subjectType?: string | null) {
    if (!Array.isArray(grades) || grades.length === 0) return null;

    const ordered = orderAnalyticsGrades(grades);
    const compatibleTyped = ordered.filter((grade) => grade.gradeType && isSubjectTypeCompatibleWithGradeType(subjectType, grade.gradeType));
    const genericGrades = ordered.filter((grade) => !grade.gradeType);
    const candidateSets = compatibleTyped.length > 0
      ? [compatibleTyped, genericGrades, ordered]
      : genericGrades.length > 0
        ? [genericGrades, ordered]
        : [ordered];

    for (const set of candidateSets) {
      for (const grade of set) {
        const lower = Number(grade.lowerLimit);
        const upper = Number(grade.upperLimit);
        if (Number.isNaN(lower) || Number.isNaN(upper)) continue;
        if (pct >= lower && pct <= upper) return grade;
      }
    }

    return null;
  }

  function resolveAnalyticsGradeForMark(mark: any, pct: number, candidateGrades: any[], subjectType?: string | null, fallbackGrades: any[] = []) {
    const typedFallbackCandidates = getAnalyticsGradeCandidates(fallbackGrades, subjectType);
    const gradePool = uniqueGradesById([...candidateGrades, ...typedFallbackCandidates, ...fallbackGrades]);

    const linkedGrade = mark?.gradeId
      ? gradePool.find((grade) => Number(grade.id) === Number(mark.gradeId))
      : null;
    if (linkedGrade) return linkedGrade;

    // First use the profile/class-specific grade set. If that cannot resolve the
    // mark, continue to subject-type-aware school grades, then all school grades.
    // This is important for older marks where grade_id is empty but percentage is set.
    for (const pool of [candidateGrades, typedFallbackCandidates, fallbackGrades]) {
      const resolved = findGradeForPercentage(pct, pool, subjectType);
      if (resolved) return resolved;
    }

    return null;
  }

  function isPassingAnalyticsGrade(grade: any, pct: number, fallbackPassMark = 50) {
    const status = String(grade?.gradeStatus || "").trim().toUpperCase();
    if (status === "PASS") return true;
    if (status === "FAIL") return false;
    return pct >= fallbackPassMark;
  }

  // Class analytics
  app.get("/api/report-hub/class-analytics/:examId/:classId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const classId = parseInt(req.params.classId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const [school, exam, classInfo] = await Promise.all([
        storage.getSchool(schoolId),
        storage.getExam(examId),
        storage.getClass(classId),
      ]);
      if (!classInfo || classInfo.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      if (exam && exam.schoolId && exam.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const PASS_MARK = 50;
      const stream = classInfo.streamId ? await storage.getStream(classInfo.streamId) : undefined;
      const streamName = stream?.name || null;
      const students = await storage.getStudentsByClass(classId);
      const totalStudents = students.length;
      const allGrades = await storage.getGradesBySchool(schoolId);

      const studentSubjectIdsByStudent = new Map<number, Set<number>>();
      await Promise.all(students.map(async (student: any) => {
        const rows = await storage.getStudentSubjects(student.id);
        studentSubjectIdsByStudent.set(
          student.id,
          new Set(rows.map((row: any) => row.subjectId).filter((id: any) => id !== null && id !== undefined)),
        );
      }));

      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const classAssessments = allAssessmentsRaw.filter(a => a.classId === classId);

      const subjectIds = [...new Set(classAssessments.map(a => a.subjectId))];
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const validSubjects = subjectsData.filter(Boolean);
      const validSubjectIdSet = new Set(validSubjects.map((subject: any) => Number(subject.id)));
      const teacherMap = await resolveClassSubjectTeacherNames(schoolId, classId, subjectIds.map((id) => Number(id)));

      const assessmentIds = classAssessments.map(a => a.id);
      let classMarks: any[] = [];
      if (assessmentIds.length > 0) {
        classMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      }

      const gradeCounts: Record<string, number> = {};
      const gradeColumns: string[] = [];
      const subjectStats: Record<number, {
        sum: number;
        have: number;
        expected: number;
        pass: number;
        fail: number;
        gradeCounts: Record<string, number>;
        gradeCandidates: any[];
        subjectType?: string | null;
      }> = {};

      for (const subject of validSubjects) {
        if (!subject) continue;
        const profileKey = resolveGradeProfileKey({
          schoolType: school?.schoolType,
          examinationBoard: school?.examinationBoard,
          streamName,
          subjectType: subject.subjectType,
        });
        const applicableGrades = getApplicableGradesForContext(allGrades, { profileKey, classId });
        const gradeCandidates = getAnalyticsGradeCandidates(applicableGrades, subject.subjectType);
        addAnalyticsGradeColumns(gradeColumns, gradeCandidates);

        const expected = students.filter((student: any) => studentSubjectIdsByStudent.get(student.id)?.has(subject.id)).length;
        subjectStats[subject.id] = {
          sum: 0,
          have: 0,
          expected,
          pass: 0,
          fail: 0,
          gradeCounts: {},
          gradeCandidates,
          subjectType: subject.subjectType,
        };
      }

      const eligibleStudentSubjectPairs = new Set<string>();
      for (const student of students) {
        const eligibleSubjectIds = studentSubjectIdsByStudent.get(student.id) || new Set<number>();
        for (const subjectId of eligibleSubjectIds) {
          if (validSubjectIdSet.has(Number(subjectId))) {
            eligibleStudentSubjectPairs.add(`${student.id}-${subjectId}`);
          }
        }
      }

      let enteredCells = 0;
      let overallSum = 0;
      const countedStudentSubjectPairs = new Set<string>();

      for (const mark of classMarks) {
        if (mark.percentage === null || mark.percentage === undefined) continue;
        const studentSubjectKey = `${mark.studentId}-${mark.subjectId}`;
        if (!eligibleStudentSubjectPairs.has(studentSubjectKey)) continue;
        if (countedStudentSubjectPairs.has(studentSubjectKey)) continue;
        countedStudentSubjectPairs.add(studentSubjectKey);
        const parsedPct = parseFloat(mark.percentage);
        if (Number.isNaN(parsedPct)) continue;
        const pct = clampPercentageNumber(parsedPct);

        const stats = subjectStats[mark.subjectId];
        if (!stats) continue;

        enteredCells++;
        overallSum += pct;
        stats.sum += pct;
        stats.have++;

        const grade = resolveAnalyticsGradeForMark(mark, pct, stats.gradeCandidates, stats.subjectType, allGrades);
        const gradeLabel = getGradeDisplayName(grade);
        if (gradeLabel) {
          gradeCounts[gradeLabel] = (gradeCounts[gradeLabel] || 0) + 1;
          stats.gradeCounts[gradeLabel] = (stats.gradeCounts[gradeLabel] || 0) + 1;
        }

        if (isPassingAnalyticsGrade(grade, pct, PASS_MARK)) stats.pass++;
        else stats.fail++;
      }

      const expectedCells = Object.values(subjectStats).reduce((sum, stats) => sum + stats.expected, 0);
      const completion = clampPercentage(expectedCells > 0 ? (enteredCells / expectedCells) * 100 : 0) ?? 0;
      const overallAvg = clampPercentage(enteredCells > 0 ? overallSum / enteredCells : 0) ?? 0;

      const subjectSummary = validSubjects.map(subject => {
        if (!subject) return null;
        const stats = subjectStats[subject.id];
        if (!stats) return null;
        const avg = clampPercentage(stats.have > 0 ? stats.sum / stats.have : 0) ?? 0;
        const subCompletion = clampPercentage(stats.expected > 0 ? (stats.have / stats.expected) * 100 : 0) ?? 0;
        const gradedTotal = stats.pass + stats.fail;
        const passRate = clampPercentage(gradedTotal > 0 ? (stats.pass / gradedTotal) * 100 : 0) ?? 0;

        return {
          subjectId: subject.id,
          subjectName: getReportSubjectLabel(subject),
          teacherName: teacherMap.get(Number(subject.id)) || null,
          avg,
          completion: subCompletion,
          passed: stats.pass,
          failed: stats.fail,
          passRate,
          gradeCounts: stats.gradeCounts,
          totalStudents: stats.expected,
        };
      }).filter(Boolean);

      res.json({
        examName: exam?.examName || "",
        className: classInfo.className,
        overallAvg,
        completion,
        enteredCells,
        expectedCells,
        gradeColumns,
        gradeCounts,
        subjectSummary,
        totalStudents,
        passMark: PASS_MARK,
      });
    } catch (error) {
      next(error);
    }
  });

  // Stream merit list
  app.get("/api/report-hub/stream-merit/:examId/:streamId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const streamId = parseInt(req.params.streamId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const [exam, stream, school] = await Promise.all([
        storage.getExam(examId),
        storage.getStream(streamId),
        storage.getSchool(schoolId),
      ]);
      if (exam && exam.schoolId && exam.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const allClasses = await storage.getAllClasses();
      const streamClasses = allClasses.filter(c => c.schoolId === schoolId && c.streamId === streamId);
      const streamName = stream?.name || streamClasses[0]?.className || "";
      const showPointsColumn = shouldShowMeritPointsColumn({ streamName });
      const classIds = streamClasses.map(c => c.id);
      if (classIds.length === 0) return res.json({ examName: exam?.examName || "", streamName, subjects: [], rows: [], totalStudents: 0, showPointsColumn });

      const allGrades = await storage.getGradesBySchool(schoolId);

      let allStudents: any[] = [];
      for (const cls of streamClasses) {
        const classStudents = await storage.getStudentsByClass(cls.id);
        allStudents = allStudents.concat(classStudents);
      }
      if (allStudents.length === 0) return res.json({ examName: exam?.examName || "", streamName, subjects: [], rows: [], totalStudents: 0, showPointsColumn });

      const studentSubjectIdsByStudent = new Map<number, Set<number>>();
      await Promise.all(allStudents.map(async (student: any) => {
        const rows = await storage.getStudentSubjects(student.id);
        studentSubjectIdsByStudent.set(
          student.id,
          new Set(rows.map((row: any) => row.subjectId).filter((id: any) => id !== null && id !== undefined)),
        );
      }));

      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const streamAssessments = allAssessmentsRaw.filter(a => classIds.includes(a.classId));

      const assessmentIds = streamAssessments.map(a => a.id);
      let allMarks: any[] = [];
      if (assessmentIds.length > 0) {
        allMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      }

      const subjectIds = Array.from(new Set(streamAssessments.map((assessment: any) => Number(assessment.subjectId))));
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const subjectById = new Map<number, any>();
      for (const subject of subjectsData) {
        if (subject) subjectById.set(Number(subject.id), subject);
      }
      const validSubjectIds = subjectIds.filter((id) => subjectById.has(Number(id)));

      const gradeCandidatesBySubjectClass = new Map<string, any[]>();
      const getSubjectClassGradeCandidates = (subject: any, classId: number) => {
        const key = `${subject.id}-${classId}`;
        const existing = gradeCandidatesBySubjectClass.get(key);
        if (existing) return existing;
        const profileKey = resolveGradeProfileKey({
          schoolType: school?.schoolType,
          examinationBoard: school?.examinationBoard,
          streamName,
          subjectType: subject.subjectType,
        });
        const applicableGrades = getApplicableGradesForContext(allGrades, { profileKey, classId });
        const candidates = getAnalyticsGradeCandidates(applicableGrades, subject.subjectType);
        gradeCandidatesBySubjectClass.set(key, candidates);
        return candidates;
      };

      const perStudent: Record<number, {
        sum: number;
        have: number;
        eligibleCount: number;
        points: number;
        displays: Record<number, string>;
        raw: Record<number, number>;
        pointRaw: Record<number, number>;
      }> = {};
      for (const student of allStudents) {
        const eligibleSubjectIds = studentSubjectIdsByStudent.get(student.id) || new Set<number>();
        const eligibleCount = validSubjectIds.filter((subjectId) => eligibleSubjectIds.has(Number(subjectId))).length;
        perStudent[student.id] = { sum: 0, have: 0, eligibleCount, points: 0, displays: {}, raw: {}, pointRaw: {} };
      }

      for (const mark of allMarks) {
        const target = perStudent[Number(mark.studentId)];
        if (!target) continue;
        if (mark.percentage === null || mark.percentage === undefined) continue;

        const eligibleSubjectIds = studentSubjectIdsByStudent.get(Number(mark.studentId));
        if (eligibleSubjectIds && eligibleSubjectIds.size > 0 && !eligibleSubjectIds.has(Number(mark.subjectId))) continue;

        const subject = subjectById.get(Number(mark.subjectId));
        if (!subject) continue;

        const parsedPct = parseFloat(mark.percentage);
        if (Number.isNaN(parsedPct)) continue;
        const pct = clampPercentageNumber(parsedPct);

        const subjectId = Number(mark.subjectId);
        if (target.raw[subjectId] === undefined) {
          target.sum += pct;
          target.have++;
        } else {
          target.sum += pct - target.raw[subjectId];
        }

        target.raw[subjectId] = pct;
        const gradeCandidates = getSubjectClassGradeCandidates(subject, mark.classId);
        const grade = resolveAnalyticsGradeForMark(mark, pct, gradeCandidates, subject.subjectType, allGrades);
        const gradeLabel = getGradeDisplayName(grade);
        const gradePoints = getMeritGradePoints(grade);
        if (target.pointRaw[subjectId] === undefined) {
          target.points += gradePoints;
        } else {
          target.points += gradePoints - target.pointRaw[subjectId];
        }
        target.pointRaw[subjectId] = gradePoints;
        target.displays[subjectId] = formatMeritMarkDisplay(pct, gradeLabel);
      }

      const ranked = allStudents
        .map(student => {
          const data = perStudent[student.id];
          if (!data || data.eligibleCount <= 0) return null;
          const avg = data.sum / data.eligibleCount;
          return { student, avg, total: data.sum, data };
        })
        .filter(Boolean) as Array<{ student: any; avg: number; total: number; data: { eligibleCount: number; points: number; displays: Record<number, string> } }>;

      ranked.sort((a, b) => {
        if (b.avg !== a.avg) return b.avg - a.avg;
        if (b.total !== a.total) return b.total - a.total;
        const aName = `${a.student.firstName} ${a.student.lastName}`;
        const bName = `${b.student.firstName} ${b.student.lastName}`;
        return aName.localeCompare(bName);
      });

      let strmPos = 0;
      let strmLastAvg: number | null = null;
      const rows = ranked.map((r, index) => {
        if (r.avg !== strmLastAvg) {
          strmPos = index + 1;
          strmLastAvg = r.avg;
        }
        return {
          studentName: `${r.student.firstName} ${r.student.lastName}`,
          admissionNo: r.student.admissionNo,
          total: `${Math.round(r.total)}/${r.data.eligibleCount * 100}`,
          avg: `${Math.round(r.avg)}%`,
          points: formatMeritPoints(r.data.points),
          position: `${strmPos}/${ranked.length}`,
          subjectMarks: validSubjectIds.map(sid => r.data.displays[sid] || "-"),
        };
      });

      res.json({
        examName: exam?.examName || "",
        streamName,
        subjects: validSubjectIds.map((subjectId) => getReportSubjectLabel(subjectById.get(Number(subjectId)))).filter(Boolean),
        rows,
        totalStudents: allStudents.length,
        showPointsColumn,
      });
    } catch (error) {
      next(error);
    }
  });

  // Stream analytics
  app.get("/api/report-hub/stream-analytics/:examId/:streamId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const streamId = parseInt(req.params.streamId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const [school, exam, stream] = await Promise.all([
        storage.getSchool(schoolId),
        storage.getExam(examId),
        storage.getStream(streamId),
      ]);
      if (exam && exam.schoolId && exam.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const PASS_MARK = 50;
      const allClasses = await storage.getAllClasses();
      const streamClasses = allClasses.filter(c => c.schoolId === schoolId && c.streamId === streamId);
      const classIds = streamClasses.map(c => c.id);
      if (classIds.length === 0) {
        return res.json({ examName: exam?.examName || "", streamName: stream?.name || "", gradeColumns: [], rows: [] });
      }

      const streamName = stream?.name || streamClasses[0]?.className || "";
      const allGrades = await storage.getGradesBySchool(schoolId);

      let allStudents: any[] = [];
      for (const cls of streamClasses) {
        const classStudents = await storage.getStudentsByClass(cls.id);
        allStudents = allStudents.concat(classStudents);
      }
      const streamStudentIds = new Set(allStudents.map((student: any) => Number(student.id)));

      const studentSubjectIdsByStudent = new Map<number, Set<number>>();
      await Promise.all(allStudents.map(async (student: any) => {
        const rows = await storage.getStudentSubjects(student.id);
        studentSubjectIdsByStudent.set(
          student.id,
          new Set(rows.map((row: any) => row.subjectId).filter((id: any) => id !== null && id !== undefined)),
        );
      }));

      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const streamAssessments = allAssessmentsRaw.filter(a => classIds.includes(a.classId));

      const assessmentIds = streamAssessments.map(a => a.id);
      let allMarks: any[] = [];
      if (assessmentIds.length > 0) {
        allMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      }

      const subjectIds = [...new Set(streamAssessments.map((assessment: any) => Number(assessment.subjectId)))];
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const subjectById = new Map<number, any>();
      for (const subject of subjectsData) {
        if (subject) subjectById.set(Number(subject.id), subject);
      }
      const teacherMap = await resolveStreamSubjectTeacherNames(schoolId, classIds, subjectIds.map((id) => Number(id)));

      const gradeColumns: string[] = [];
      const gradeCandidatesBySubjectClass = new Map<string, any[]>();
      const getSubjectClassGradeCandidates = (subject: any, classId: number) => {
        const key = `${subject.id}-${classId}`;
        const existing = gradeCandidatesBySubjectClass.get(key);
        if (existing) return existing;
        const profileKey = resolveGradeProfileKey({
          schoolType: school?.schoolType,
          examinationBoard: school?.examinationBoard,
          streamName,
          subjectType: subject.subjectType,
        });
        const applicableGrades = getApplicableGradesForContext(allGrades, { profileKey, classId });
        const candidates = getAnalyticsGradeCandidates(applicableGrades, subject.subjectType);
        gradeCandidatesBySubjectClass.set(key, candidates);
        addAnalyticsGradeColumns(gradeColumns, candidates);
        return candidates;
      };

      for (const assessment of streamAssessments) {
        const subject = subjectById.get(Number(assessment.subjectId));
        if (subject) getSubjectClassGradeCandidates(subject, assessment.classId);
      }

      const bySubject: Record<number, {
        sum: number;
        cnt: number;
        pass: number;
        fail: number;
        gradeCounts: Record<string, number>;
        subjectType?: string | null;
      }> = {};

      const countedStreamStudentSubjectPairs = new Set<string>();

      for (const mark of allMarks) {
        if (mark.percentage === null || mark.percentage === undefined) continue;
        if (!streamStudentIds.has(Number(mark.studentId))) continue;
        const studentSubjectKey = `${mark.studentId}-${mark.subjectId}`;
        if (countedStreamStudentSubjectPairs.has(studentSubjectKey)) continue;
        countedStreamStudentSubjectPairs.add(studentSubjectKey);
        const eligibleSubjectIds = studentSubjectIdsByStudent.get(mark.studentId);
        if (eligibleSubjectIds && eligibleSubjectIds.size > 0 && !eligibleSubjectIds.has(Number(mark.subjectId))) continue;

        const parsedPct = parseFloat(mark.percentage);
        if (Number.isNaN(parsedPct)) continue;
        const pct = clampPercentageNumber(parsedPct);
        const subId = Number(mark.subjectId);
        let subject = subjectById.get(subId);
        if (!subject) {
          subject = await storage.getSubject(subId);
          if (subject) subjectById.set(subId, subject);
        }
        if (!subject) continue;

        const gradeCandidates = getSubjectClassGradeCandidates(subject, mark.classId);

        if (!bySubject[subId]) {
          bySubject[subId] = { sum: 0, cnt: 0, pass: 0, fail: 0, gradeCounts: {}, subjectType: subject.subjectType };
        }

        bySubject[subId].sum += pct;
        bySubject[subId].cnt++;

        const grade = resolveAnalyticsGradeForMark(mark, pct, gradeCandidates, subject.subjectType, allGrades);
        const gradeLabel = getGradeDisplayName(grade);
        if (gradeLabel) {
          bySubject[subId].gradeCounts[gradeLabel] = (bySubject[subId].gradeCounts[gradeLabel] || 0) + 1;
        }

        if (isPassingAnalyticsGrade(grade, pct, PASS_MARK)) bySubject[subId].pass++;
        else bySubject[subId].fail++;
      }

      const rows = [];
      for (const [subId, stats] of Object.entries(bySubject)) {
        let subject = subjectById.get(Number(subId));
        if (!subject) subject = await storage.getSubject(parseInt(subId));
        if (!subject) continue;

        const avg = clampPercentage(stats.cnt > 0 ? stats.sum / stats.cnt : 0) ?? 0;
        const total = stats.pass + stats.fail;
        const passRate = clampPercentage(total > 0 ? (stats.pass / total) * 100 : 0) ?? 0;

        rows.push({
          subjectId: parseInt(subId),
          subjectName: getReportSubjectLabel(subject),
          teacherName: teacherMap.get(Number(subId)) || null,
          avg,
          passed: stats.pass,
          failed: stats.fail,
          passRate,
          gradeCounts: stats.gradeCounts,
        });
      }

      rows.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

      res.json({
        examName: exam?.examName || "",
        streamName,
        gradeColumns,
        rows,
      });
    } catch (error) {
      next(error);
    }
  });

  // Classes for a stream (for the Reports dropdown)
  app.get("/api/report-hub/stream-classes/:streamId", requireAuth, async (req, res, next) => {
    try {
      const streamId = parseInt(req.params.streamId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const allClasses = await storage.getAllClasses();
      const streamClasses = allClasses
        .filter(c => c.schoolId === schoolId && c.streamId === streamId)
        .map(c => ({ id: c.id, name: c.className }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json(streamClasses);
    } catch (error) {
      next(error);
    }
  });

  // =============================================
  // QC RECORDS ENDPOINTS (REBUILT PAGE)
  // =============================================

  const qcRecordMutationSchema = z.object({
    studentId: z.coerce.number().int().positive(),
    classId: z.coerce.number().int().positive(),
    subjectId: z.coerce.number().int().positive(),
    academicYear: z.string().trim().min(1),
    term: z.enum(["term1", "term2", "term3"]),
    recordDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    descriptionComment: z.string().trim().min(1),
    actionTaken: z.string().trim().optional().nullable(),
  });

  app.get("/api/qc-records/bootstrap", requireAuth, requirePermission("qc_reports.view"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const school = await storage.getSchool(schoolId);
      if (!school) return res.status(404).json({ message: "School not found" });

      const classes = (await storage.getClassesBySchool(schoolId))
        .map((cls) => ({ id: cls.id, className: cls.className }))
        .sort((a, b) => a.className.localeCompare(b.className));

      res.json({
        currentAcademicYear: school.currentAcademicYear || new Date().getFullYear().toString(),
        currentTerm: normalizeQcTermValue(school.currentTerm),
        classes,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/qc-records/students", requireAuth, requirePermission("qc_reports.view"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const classId = Number(req.query.classId);
      if (!Number.isFinite(classId)) return res.json([]);

      const classRecord = await ensureClassInSchool(classId, schoolId, res);
      if (!classRecord) return;

      const rows = (await storage.getStudentsByClass(classId))
        .filter((student) => student.schoolId === schoolId)
        .map((student) => ({
          id: student.id,
          fullName: `${student.firstName} ${student.lastName}`.trim(),
          admissionNo: student.admissionNo,
        }));

      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/qc-records/subjects", requireAuth, requirePermission("qc_reports.view"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const studentId = Number(req.query.studentId);
      if (!Number.isFinite(studentId)) return res.json([]);

      const student = await ensureStudentInSchool(studentId, schoolId, res);
      if (!student) return;

      const subjectIds = Array.from(new Set((await storage.getStudentSubjects(student.id)).map((row) => row.subjectId).filter(Boolean)));
      if (subjectIds.length === 0) return res.json([]);

      const subjects = await storage.getAllSubjects();
      const rows = subjects
        .filter((subject) => subject.schoolId === schoolId && subjectIds.includes(subject.id))
        .map((subject) => ({ id: subject.id, name: subject.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/qc-records", requireAuth, requirePermission("qc_reports.view"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const studentId = Number(req.query.studentId);
      const academicYear = String(req.query.academicYear || "").trim();
      const term = normalizeQcTermValue(req.query.term as string | undefined);

      if (!Number.isFinite(studentId) || !academicYear) {
        return res.json([]);
      }

      const student = await ensureStudentInSchool(studentId, schoolId, res);
      if (!student) return;

      const rows = await db
        .select()
        .from(qcRecords)
        .where(
          and(
            eq(qcRecords.schoolId, schoolId),
            eq(qcRecords.studentId, studentId),
            eq(qcRecords.academicYear, academicYear),
            eq(qcRecords.term, term),
          )
        )
        .orderBy(desc(qcRecords.recordDate), desc(qcRecords.createdAt));

      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/qc-records", requireAuth, requirePermission("qc_reports.create"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const currentUser = req.user as User;
      const payload = qcRecordMutationSchema.parse(req.body);

      const student = await ensureStudentInSchool(payload.studentId, schoolId, res);
      if (!student) return;

      const classRecord = await ensureClassInSchool(payload.classId, schoolId, res);
      if (!classRecord) return;

      if (student.classId !== payload.classId) {
        return res.status(400).json({ message: "Selected student does not belong to the selected class" });
      }

      const subject = await ensureSubjectInSchool(payload.subjectId, schoolId, res);
      if (!subject) return;

      const studentSubjectIds = (await storage.getStudentSubjects(payload.studentId)).map((row) => row.subjectId);
      const allowedSubjectIds = new Set(studentSubjectIds.filter(Boolean));
      if (allowedSubjectIds.size > 0 && !allowedSubjectIds.has(payload.subjectId)) {
        return res.status(400).json({ message: "Selected subject is not assigned to this student" });
      }

      const [created] = await db
        .insert(qcRecords)
        .values({
          schoolId,
          classId: payload.classId,
          studentId: payload.studentId,
          subjectId: payload.subjectId,
          academicYear: payload.academicYear,
          term: payload.term,
          recordDate: payload.recordDate,
          descriptionComment: payload.descriptionComment,
          actionTaken: payload.actionTaken?.trim() || null,
          createdBy: currentUser.id,
          updatedBy: currentUser.id,
          updatedAt: new Date(),
        })
        .returning();

      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/qc-records/:id", requireAuth, requirePermission("qc_reports.edit"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const recordId = Number(req.params.id);
      if (!Number.isFinite(recordId)) return res.status(400).json({ message: "Invalid record id" });

      const currentUser = req.user as User;
      const payload = qcRecordMutationSchema.parse(req.body);

      const existing = await db
        .select()
        .from(qcRecords)
        .where(and(eq(qcRecords.id, recordId), eq(qcRecords.schoolId, schoolId)))
        .limit(1);

      if (!existing[0]) {
        return res.status(404).json({ message: "Record not found" });
      }

      const student = await ensureStudentInSchool(payload.studentId, schoolId, res);
      if (!student) return;

      const classRecord = await ensureClassInSchool(payload.classId, schoolId, res);
      if (!classRecord) return;

      if (student.classId !== payload.classId) {
        return res.status(400).json({ message: "Selected student does not belong to the selected class" });
      }

      const subject = await ensureSubjectInSchool(payload.subjectId, schoolId, res);
      if (!subject) return;

      const studentSubjectIds = (await storage.getStudentSubjects(payload.studentId)).map((row) => row.subjectId);
      const allowedSubjectIds = new Set(studentSubjectIds.filter(Boolean));
      if (allowedSubjectIds.size > 0 && !allowedSubjectIds.has(payload.subjectId)) {
        return res.status(400).json({ message: "Selected subject is not assigned to this student" });
      }

      const [updated] = await db
        .update(qcRecords)
        .set({
          classId: payload.classId,
          studentId: payload.studentId,
          subjectId: payload.subjectId,
          academicYear: payload.academicYear,
          term: payload.term,
          recordDate: payload.recordDate,
          descriptionComment: payload.descriptionComment,
          actionTaken: payload.actionTaken?.trim() || null,
          updatedBy: currentUser.id,
          updatedAt: new Date(),
        })
        .where(and(eq(qcRecords.id, recordId), eq(qcRecords.schoolId, schoolId)))
        .returning();

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/qc-records/:id", requireAuth, requirePermission("qc_reports.delete"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const recordId = Number(req.params.id);
      if (!Number.isFinite(recordId)) return res.status(400).json({ message: "Invalid record id" });

      const existing = await db
        .select({ id: qcRecords.id })
        .from(qcRecords)
        .where(and(eq(qcRecords.id, recordId), eq(qcRecords.schoolId, schoolId)))
        .limit(1);

      if (!existing[0]) {
        return res.status(404).json({ message: "Record not found" });
      }

      await db.delete(qcRecords).where(and(eq(qcRecords.id, recordId), eq(qcRecords.schoolId, schoolId)));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // =============================================
  // QC REPORTS ENDPOINTS
  // =============================================

  // QC Reports Landing: streams with classes and completion progress
  app.get("/api/qc-reports/landing", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const termNumber = req.query.term ? parseInt(req.query.term as string) : null;
      const year = req.query.year as string || null;

      const school = await storage.getSchool(schoolId);
      if (!school) return res.status(404).json({ message: "School not found" });

      const activeTerm = termNumber || parseTermNumber(school.currentTerm);
      const activeYear = year || school.currentAcademicYear || new Date().getFullYear().toString();

      const allClasses = await storage.getAllClasses();
      const schoolClasses = allClasses.filter(c => c.schoolId === schoolId);

      const allStreams = await storage.getAllStreams();
      const allStudents = await storage.getAllStudents();
      const schoolStudents = allStudents.filter(s => s.schoolId === schoolId && s.status === "active");

      const allQcReports = await db.select().from(qcReports).where(
        and(
          eq(qcReports.schoolId, schoolId),
          eq(qcReports.termNumber, activeTerm),
          eq(qcReports.year, activeYear)
        )
      );

      const streamMap: Record<string, { streamId: number; streamName: string; classes: any[] }> = {};

      for (const cls of schoolClasses) {
        const stream = allStreams.find(s => s.id === cls.streamId);
        const streamName = stream ? stream.name : "Other";
        const streamId = stream ? stream.id : 0;

        if (!streamMap[streamName]) {
          streamMap[streamName] = { streamId, streamName, classes: [] };
        }

        const classStudents = schoolStudents.filter(s => s.classId === cls.id);
        const totalStudents = classStudents.length;

        const completedStudentIds = new Set<number>();
        for (const qr of allQcReports) {
          if (qr.classId === cls.id) {
            completedStudentIds.add(qr.studentId);
          }
        }
        const completedCount = completedStudentIds.size;
        const pct = totalStudents > 0 ? Math.round((completedCount / totalStudents) * 100) : 0;

        streamMap[streamName].classes.push({
          id: cls.id,
          name: cls.className,
          totalStudents,
          completedReports: completedCount,
          progressPct: pct,
        });
      }

      const streams = Object.values(streamMap).map(s => {
        const totalStudents = s.classes.reduce((sum: number, c: any) => sum + c.totalStudents, 0);
        const totalCompleted = s.classes.reduce((sum: number, c: any) => sum + c.completedReports, 0);
        return {
          ...s,
          totalStudents,
          totalCompleted,
          progressPct: totalStudents > 0 ? Math.round((totalCompleted / totalStudents) * 100) : 0,
        };
      });

      res.json({
        term: activeTerm,
        year: activeYear,
        streams,
      });
    } catch (error) {
      next(error);
    }
  });

  // QC Reports: Subject-level progress for a class
  app.get("/api/qc-reports/class/:classId/subject-progress", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const classId = parseInt(req.params.classId);
      const termNumber = req.query.term ? parseInt(req.query.term as string) : null;
      const year = req.query.year as string || null;

      const school = await storage.getSchool(schoolId);
      if (!school) return res.status(404).json({ message: "School not found" });

      const activeTerm = termNumber || parseTermNumber(school.currentTerm);
      const activeYear = year || school.currentAcademicYear || new Date().getFullYear().toString();

      const cls = await storage.getClass(classId);
      if (!cls || cls.schoolId !== schoolId) return res.status(404).json({ message: "Class not found" });

      // Get subjects assigned to this class
      const allClassSubjects = await storage.getClassSubjects(classId);
      const allSubjects = await storage.getAllSubjects();
      const subjectMap = new Map(allSubjects.filter(s => s.schoolId === schoolId).map(s => [s.id, s]));

      // Get students in this class
      const allStudents = await storage.getAllStudents();
      const classStudents = allStudents.filter(s => s.classId === classId && s.schoolId === schoolId && s.status === "active");
      const totalStudents = classStudents.length;

      // Get QC reports for this class/term/year
      const classQcReports = await db.select().from(qcReports).where(
        and(
          eq(qcReports.schoolId, schoolId),
          eq(qcReports.classId, classId),
          eq(qcReports.termNumber, activeTerm),
          eq(qcReports.year, activeYear)
        )
      );

      // Overall class progress
      const completedCount = classQcReports.length;
      const overallPct = totalStudents > 0 ? Math.round((completedCount / totalStudents) * 100) : 0;

      // Per-subject progress: count how many QC reports have a non-empty comment for each subject
      const subjectProgress = allClassSubjects
        .map(cs => {
          const subject = subjectMap.get(cs.subjectId);
          if (!subject) return null;

          let withComment = 0;
          for (const qr of classQcReports) {
            const comments = qr.subjectComments as Record<string, string> | null;
            if (comments && comments[String(cs.subjectId)] && comments[String(cs.subjectId)].trim().length > 0) {
              withComment++;
            }
          }
          const pct = totalStudents > 0 ? Math.round((withComment / totalStudents) * 100) : 0;
          return {
            subjectId: subject.id,
            subjectName: subject.name + (subject.shortCode ? ` (${subject.shortCode})` : ""),
            totalStudents,
            completedComments: withComment,
            progressPct: pct,
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.subjectName.localeCompare(b.subjectName));

      res.json({
        classId,
        className: cls.className,
        term: activeTerm,
        year: activeYear,
        overallProgressPct: overallPct,
        totalStudents,
        totalReports: completedCount,
        subjects: subjectProgress,
      });
    } catch (error) {
      next(error);
    }
  });

  // QC Reports: Class students with report status
  app.get("/api/qc-reports/class/:classId", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const classId = parseInt(req.params.classId);
      const termNumber = req.query.term ? parseInt(req.query.term as string) : null;
      const year = req.query.year as string || null;

      const school = await storage.getSchool(schoolId);
      if (!school) return res.status(404).json({ message: "School not found" });

      const activeTerm = termNumber || parseTermNumber(school.currentTerm);
      const activeYear = year || school.currentAcademicYear || new Date().getFullYear().toString();

      const cls = await storage.getClass(classId);
      if (!cls || cls.schoolId !== schoolId) return res.status(404).json({ message: "Class not found" });

      const allStudents = await storage.getAllStudents();
      const classStudents = sortStudentsByFirstName(
        allStudents.filter(s => s.classId === classId && s.schoolId === schoolId && s.status === "active"),
      );

      const classQcReports = await db.select().from(qcReports).where(
        and(
          eq(qcReports.schoolId, schoolId),
          eq(qcReports.classId, classId),
          eq(qcReports.termNumber, activeTerm),
          eq(qcReports.year, activeYear)
        )
      );

      const qcMap = new Map<number, any>();
      for (const qr of classQcReports) {
        qcMap.set(qr.studentId, qr);
      }

      const students = classStudents.map(s => ({
        id: s.id,
        admissionNo: s.admissionNo,
        firstName: s.firstName,
        lastName: s.lastName,
        photo: s.photo,
        hasReport: qcMap.has(s.id),
        reportId: qcMap.get(s.id)?.id || null,
        qcStatus: qcMap.get(s.id)?.qcStatus || "not_started",
      }));

      res.json({
        classId,
        className: cls.className,
        term: activeTerm,
        year: activeYear,
        students,
      });
    } catch (error) {
      next(error);
    }
  });

  // QC Reports: Individual student report data (aggregated)
  app.get("/api/qc-reports/student/:studentId", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const studentId = parseInt(req.params.studentId);
      const classId = req.query.classId ? parseInt(req.query.classId as string) : null;
      const termNumber = req.query.term ? parseInt(req.query.term as string) : null;
      const year = req.query.year as string || null;

      const school = await storage.getSchool(schoolId);
      if (!school) return res.status(404).json({ message: "School not found" });

      const activeTerm = termNumber || parseTermNumber(school.currentTerm);
      const activeYear = year || school.currentAcademicYear || new Date().getFullYear().toString();

      const student = await storage.getStudent(studentId);
      if (!student || student.schoolId !== schoolId) return res.status(404).json({ message: "Student not found" });

      const activeClassId = classId || student.classId;
      if (!activeClassId) return res.status(400).json({ message: "Class context required" });

      const cls = await storage.getClass(activeClassId);

      // Get term dates
      let termStart = "";
      let termEnd = "";
      const termKey = `term${activeTerm}` as const;
      if (school[`${termKey}StartDate` as keyof typeof school]) {
        termStart = school[`${termKey}StartDate` as keyof typeof school] as string;
      }
      if (school[`${termKey}EndDate` as keyof typeof school]) {
        termEnd = school[`${termKey}EndDate` as keyof typeof school] as string;
      }

      // 1. Attendance data
      const allAttendance = await storage.getAttendanceByStudent(studentId);
      const termAttendance = allAttendance.filter(a => {
        if (a.classId !== activeClassId) return false;
        if (termStart && termEnd) {
          return a.date >= termStart && a.date <= termEnd;
        }
        return true;
      });

      const attendanceCounts: Record<string, number> = {};
      const attendanceByDate: Record<string, string> = {};
      for (const a of termAttendance) {
        const status = a.status || "present";
        attendanceCounts[status] = (attendanceCounts[status] || 0) + 1;
        attendanceByDate[a.date] = status;
      }

      // Build month calendars
      const months: { key: string; year: number; month: number; label: string }[] = [];
      if (termStart && termEnd) {
        const startDate = new Date(termStart);
        const endDate = new Date(termEnd);
        const cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const lastKey = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}`;
        let maxLoops = 12;
        while (maxLoops-- > 0) {
          const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          months.push({ key, year: cur.getFullYear(), month: cur.getMonth() + 1, label: monthNames[cur.getMonth()] });
          if (key === lastKey) break;
          cur.setMonth(cur.getMonth() + 1);
        }
      }

      // 2. Assessments and marks for written work + performance

      const allSubjects = await storage.getAllSubjects();
      const schoolSubjects = allSubjects.filter(s => s.schoolId === schoolId);

      // Get student's resolved subjects
      const studentSubjectRows = await storage.getStudentSubjects(studentId);
      const subjectIds: number[] = studentSubjectRows.map(ss => ss.subjectId);

      const studentSubjectList = schoolSubjects.filter(s => subjectIds.includes(s.id));

      // Get assessments for this class/term
      const classAssessments = await db.select().from(assessmentsSchema).where(
        and(
          eq(assessmentsSchema.schoolId, schoolId),
          eq(assessmentsSchema.classId, activeClassId),
          eq(assessmentsSchema.termId, activeTerm),
          eq(assessmentsSchema.year, parseInt(activeYear))
        )
      );

      // Get assessment types
      const assessmentTypesList = await db.select().from(assessmentTypesSchema).where(eq(assessmentTypesSchema.schoolId, schoolId));
      const typeMap = new Map<number, string>();
      for (const at of assessmentTypesList) {
        typeMap.set(at.id, at.name);
      }

      // Get marks for this student
      const studentMarks = await db.select().from(assessmentMarksSchema).where(
        and(
          eq(assessmentMarksSchema.studentId, studentId),
          eq(assessmentMarksSchema.classId, activeClassId),
          eq(assessmentMarksSchema.schoolId, schoolId)
        )
      );

      // Bucket assessment types
      function bucketType(typeName: string): string {
        const t = typeName.toLowerCase();
        if (t.includes("fortnight") || t.includes("week")) return "Fortnight";
        if (t.includes("test") || t.includes("exam")) return "Tests";
        if (t.includes("exercise") || t.includes("homework")) return "Exercises";
        return "Other";
      }

      // Written work: count of assessments by type per subject
      const writtenWork: { subject: string; subjectId: number; tests: number; exercises: number; fortnight: number; total: number }[] = [];

      for (const subj of studentSubjectList) {
        const subjAssessments = classAssessments.filter(a => a.subjectId === subj.id);
        let tests = 0, exercises = 0, fortnight = 0;
        for (const a of subjAssessments) {
          const typeName = a.assessmentTypeId ? typeMap.get(a.assessmentTypeId) || "" : "";
          const bucket = bucketType(typeName);
          const hasMark = studentMarks.some(m => m.assessmentId === a.id && m.percentage !== null);
          if (hasMark) {
            if (bucket === "Tests") tests++;
            else if (bucket === "Exercises") exercises++;
            else if (bucket === "Fortnight") fortnight++;
            else tests++;
          }
        }
        writtenWork.push({
          subject: subj.name,
          subjectId: subj.id,
          tests,
          exercises,
          fortnight,
          total: tests + exercises + fortnight,
        });
      }

      // Performance: average marks per subject + chart data
      const allGrades = await storage.getAllGrades();
      const schoolGrades = allGrades.filter(g => g.schoolId === schoolId);

      function getGrade(avg: number) {
        for (const g of schoolGrades) {
          if (avg >= g.lowerLimit && avg <= g.upperLimit) return g.gradeName;
        }
        return "-";
      }

      const performance: { subject: string; subjectId: number; avg: number | null; grade: string; comment: string }[] = [];
      const perfSeries: { subject: string; tests: number; exercises: number; fortnight: number }[] = [];

      for (const subj of studentSubjectList) {
        const subjAssessments = classAssessments.filter(a => a.subjectId === subj.id);
        const subjMarks = studentMarks.filter(m => subjAssessments.some(a => a.id === m.assessmentId) && m.percentage !== null);

        let avgPct: number | null = null;
        if (subjMarks.length > 0) {
          const sum = subjMarks.reduce((s, m) => s + parseFloat(m.percentage || "0"), 0);
          avgPct = Math.round((sum / subjMarks.length) * 100) / 100;
        }

        const grade = avgPct !== null ? getGrade(avgPct) : "-";
        const comment = subjMarks.length > 0 && subjMarks[subjMarks.length - 1].comment ? subjMarks[subjMarks.length - 1].comment || "" : "";

        performance.push({ subject: subj.name, subjectId: subj.id, avg: avgPct, grade, comment });

        // Per-type averages for chart
        const typeAvgs: Record<string, number[]> = { Tests: [], Exercises: [], Fortnight: [] };
        for (const a of subjAssessments) {
          const typeName = a.assessmentTypeId ? typeMap.get(a.assessmentTypeId) || "" : "";
          const bucket = bucketType(typeName);
          const mark = studentMarks.find(m => m.assessmentId === a.id);
          if (mark && mark.percentage !== null) {
            if (typeAvgs[bucket]) typeAvgs[bucket].push(parseFloat(mark.percentage));
          }
        }

        perfSeries.push({
          subject: subj.name,
          tests: typeAvgs.Tests.length > 0 ? Math.round(typeAvgs.Tests.reduce((s, v) => s + v, 0) / typeAvgs.Tests.length * 100) / 100 : 0,
          exercises: typeAvgs.Exercises.length > 0 ? Math.round(typeAvgs.Exercises.reduce((s, v) => s + v, 0) / typeAvgs.Exercises.length * 100) / 100 : 0,
          fortnight: typeAvgs.Fortnight.length > 0 ? Math.round(typeAvgs.Fortnight.reduce((s, v) => s + v, 0) / typeAvgs.Fortnight.length * 100) / 100 : 0,
        });
      }

      // 3. QC Report data
      const existingReports = await db.select().from(qcReports).where(
        and(
          eq(qcReports.studentId, studentId),
          eq(qcReports.classId, activeClassId),
          eq(qcReports.termNumber, activeTerm),
          eq(qcReports.year, activeYear),
          eq(qcReports.schoolId, schoolId)
        )
      );
      const qcReport = existingReports.length > 0 ? existingReports[0] : null;

      res.json({
        student: {
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          admissionNo: student.admissionNo,
          photo: student.photo,
        },
        className: cls?.className || "Unknown",
        classId: activeClassId,
        term: activeTerm,
        year: activeYear,
        termStart,
        termEnd,
        school: {
          name: school.name,
          logo: school.logo,
          stamp: school.stamp,
          phone: school.phone,
          principalName: school.principalName,
        },
        attendance: {
          counts: attendanceCounts,
          byDate: attendanceByDate,
          months,
          totalDays: Object.values(attendanceCounts).reduce((s, v) => s + v, 0),
          presentDays: attendanceCounts.present || 0,
        },
        writtenWork,
        performance,
        perfSeries,
        qcReport: qcReport ? {
          id: qcReport.id,
          qcStatus: qcReport.qcStatus,
          attendanceComment: qcReport.attendanceComment,
          behaviourComment: qcReport.behaviourComment,
          behaviourRating: qcReport.behaviourRating,
          studyHabitsComment: qcReport.studyHabitsComment,
          subjectComments: qcReport.subjectComments,
          notes: qcReport.notes,
        } : null,
      });
    } catch (error) {
      next(error);
    }
  });

  // QC Reports: Save/Create QC report
  app.post("/api/qc-reports/save", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const user = req.user as User;
      const { studentId, classId, termNumber, year, qcStatus, attendanceComment, behaviourComment, behaviourRating, studyHabitsComment, subjectComments, notes } = req.body;

      if (!studentId || !classId || !termNumber || !year) {
        return res.status(400).json({ message: "Missing required fields: studentId, classId, termNumber, year" });
      }

      const existing = await db.select().from(qcReports).where(
        and(
          eq(qcReports.studentId, studentId),
          eq(qcReports.classId, classId),
          eq(qcReports.termNumber, termNumber),
          eq(qcReports.year, year),
          eq(qcReports.schoolId, schoolId)
        )
      );

      let report;
      if (existing.length > 0) {
        const updated = await db.update(qcReports)
          .set({
            qcStatus: qcStatus || existing[0].qcStatus,
            attendanceComment: attendanceComment !== undefined ? attendanceComment : existing[0].attendanceComment,
            behaviourComment: behaviourComment !== undefined ? behaviourComment : existing[0].behaviourComment,
            behaviourRating: behaviourRating !== undefined ? behaviourRating : existing[0].behaviourRating,
            studyHabitsComment: studyHabitsComment !== undefined ? studyHabitsComment : existing[0].studyHabitsComment,
            subjectComments: subjectComments !== undefined ? subjectComments : existing[0].subjectComments,
            notes: notes !== undefined ? notes : existing[0].notes,
            updatedAt: new Date(),
          })
          .where(eq(qcReports.id, existing[0].id))
          .returning();
        report = updated[0];
      } else {
        const inserted = await db.insert(qcReports).values({
          schoolId,
          studentId,
          classId,
          termNumber,
          year,
          qcStatus: qcStatus || "in_progress",
          attendanceComment: attendanceComment || null,
          behaviourComment: behaviourComment || null,
          behaviourRating: behaviourRating || null,
          studyHabitsComment: studyHabitsComment || null,
          subjectComments: subjectComments || null,
          notes: notes || null,
          createdBy: user.id,
        }).returning();
        report = inserted[0];
      }

      res.json(report);
    } catch (error) {
      next(error);
    }
  });

  // QC Reports: Autosave (lightweight PATCH for comments only)
  app.patch("/api/qc-reports/autosave/:reportId", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const reportId = parseInt(req.params.reportId);
      const { attendanceComment, behaviourComment, behaviourRating, studyHabitsComment, subjectComments, notes, qcStatus } = req.body;

      const existing = await db.select().from(qcReports).where(
        and(
          eq(qcReports.id, reportId),
          eq(qcReports.schoolId, schoolId)
        )
      );

      if (existing.length === 0) return res.status(404).json({ message: "Report not found" });

      const updateData: any = { updatedAt: new Date() };
      if (attendanceComment !== undefined) updateData.attendanceComment = attendanceComment;
      if (behaviourComment !== undefined) updateData.behaviourComment = behaviourComment;
      if (behaviourRating !== undefined) updateData.behaviourRating = behaviourRating;
      if (studyHabitsComment !== undefined) updateData.studyHabitsComment = studyHabitsComment;
      if (subjectComments !== undefined) updateData.subjectComments = subjectComments;
      if (notes !== undefined) updateData.notes = notes;
      if (qcStatus !== undefined) updateData.qcStatus = qcStatus;

      const updated = await db.update(qcReports)
        .set(updateData)
        .where(eq(qcReports.id, reportId))
        .returning();

      res.json({ success: true, report: updated[0] });
    } catch (error) {
      next(error);
    }
  });

  // QC Reports: Generate PDF
  app.get("/api/qc-reports/pdf/:studentId", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const studentId = parseInt(req.params.studentId);
      const classId = req.query.classId ? parseInt(req.query.classId as string) : null;
      const termNumber = req.query.term ? parseInt(req.query.term as string) : null;
      const year = req.query.year as string || null;

      const school = await storage.getSchool(schoolId);
      if (!school) return res.status(404).json({ message: "School not found" });

      const activeTerm = termNumber || parseTermNumber(school.currentTerm);
      const activeYear = year || school.currentAcademicYear || new Date().getFullYear().toString();

      const student = await storage.getStudent(studentId);
      if (!student || student.schoolId !== schoolId) return res.status(404).json({ message: "Student not found" });

      const activeClassId = classId || student.classId;
      const cls = activeClassId ? await storage.getClass(activeClassId) : null;

      const existingReports = await db.select().from(qcReports).where(
        and(
          eq(qcReports.studentId, studentId),
          ...(activeClassId ? [eq(qcReports.classId, activeClassId)] : []),
          eq(qcReports.termNumber, activeTerm),
          eq(qcReports.year, activeYear),
          eq(qcReports.schoolId, schoolId)
        )
      );
      const qcReport = existingReports.length > 0 ? existingReports[0] : null;

      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ size: "A4", margin: 50 });

      res.setHeader("Content-Type", "application/pdf");
      const qcClassName = cls?.className?.replace(/\s+/g, "_") || "Class";
      res.setHeader("Content-Disposition", `attachment; filename="QC_Report_${student.firstName}_${student.lastName}_${qcClassName}_Term${activeTerm}_${activeYear}.pdf"`);

      doc.pipe(res);

      doc.fontSize(18).font("Helvetica-Bold").text(school.name || "School", { align: "center" });
      doc.fontSize(12).font("Helvetica").text("Quality Control Report", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Term ${activeTerm}, ${activeYear}`, { align: "center" });
      doc.moveDown(1);

      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      doc.fontSize(11).font("Helvetica-Bold").text("Student Information");
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica");
      doc.text(`Name: ${student.firstName} ${student.lastName}`);
      if (student.admissionNo) doc.text(`Admission No: ${student.admissionNo}`);
      if (cls) doc.text(`Class: ${cls.className}`);
      doc.moveDown(1);

      if (qcReport) {
        if (qcReport.behaviourRating) {
          doc.font("Helvetica-Bold").text("Behaviour Rating: ", { continued: true });
          doc.font("Helvetica").text(qcReport.behaviourRating.charAt(0).toUpperCase() + qcReport.behaviourRating.slice(1));
          doc.moveDown(0.3);
        }

        if (qcReport.attendanceComment) {
          doc.font("Helvetica-Bold").text("Attendance Comment:");
          doc.font("Helvetica").text(qcReport.attendanceComment);
          doc.moveDown(0.3);
        }

        if (qcReport.behaviourComment) {
          doc.font("Helvetica-Bold").text("Behaviour Comment:");
          doc.font("Helvetica").text(qcReport.behaviourComment);
          doc.moveDown(0.3);
        }

        if (qcReport.studyHabitsComment) {
          doc.font("Helvetica-Bold").text("Study Habits:");
          doc.font("Helvetica").text(qcReport.studyHabitsComment);
          doc.moveDown(0.3);
        }

        if (qcReport.subjectComments && typeof qcReport.subjectComments === "object") {
          const allSubjects = await storage.getAllSubjects();
          const subjMap = new Map(allSubjects.map(s => [String(s.id), s.name]));
          const comments = qcReport.subjectComments as Record<string, string>;
          const entries = Object.entries(comments).filter(([_, v]) => v);
          if (entries.length > 0) {
            doc.moveDown(0.5);
            doc.font("Helvetica-Bold").text("Subject Comments:");
            doc.moveDown(0.3);
            for (const [subjectId, comment] of entries) {
              const subjName = subjMap.get(subjectId) || `Subject ${subjectId}`;
              doc.font("Helvetica-Bold").text(`${subjName}: `, { continued: true });
              doc.font("Helvetica").text(comment);
            }
          }
        }

        if (qcReport.notes) {
          doc.moveDown(0.5);
          doc.font("Helvetica-Bold").text("Additional Notes:");
          doc.font("Helvetica").text(qcReport.notes);
        }
      } else {
        doc.text("No QC report data has been entered for this student yet.");
      }

      doc.moveDown(2);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(8).text(`Generated on ${new Date().toLocaleDateString()} | ${school.name}`, { align: "center" });

      doc.end();
    } catch (error) {
      next(error);
    }
  });

  // ============================================================
  // STUDENT & PARENT SELF-SERVICE PORTAL ENDPOINTS
  // ============================================================

  // Get the student record linked to the currently logged-in user
  app.get("/api/me/student-profile", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (currentUser.role !== "student") return res.status(403).json({ message: "Students only" });
      const allStudents = await storage.getAllStudents();
      const student = allStudents.find(s => s.userId === currentUser.id);
      if (!student) return res.status(404).json({ message: "Student record not found" });
      const classInfo = student.classId ? await storage.getClass(student.classId) : null;
      const parentInfo = student.parentId ? await storage.getParent(student.parentId) : null;
      res.json({ ...student, className: classInfo?.name, parentName: parentInfo ? `${parentInfo.firstName} ${parentInfo.lastName}` : null });
    } catch (error) { next(error); }
  });

  // Get the parent record linked to the currently logged-in user
  app.get("/api/me/parent-profile", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (currentUser.role !== "parent") return res.status(403).json({ message: "Parents only" });
      const allParents = await storage.getAllParents();
      const parent = allParents.find(p => p.userId === currentUser.id);
      if (!parent) return res.status(404).json({ message: "Parent record not found" });
      res.json(parent);
    } catch (error) { next(error); }
  });

  // Student: get my classes and subjects
  app.get("/api/me/classes", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (currentUser.role !== "student") return res.status(403).json({ message: "Students only" });
      const allStudents = await storage.getAllStudents();
      const student = allStudents.find(s => s.userId === currentUser.id);
      if (!student) return res.status(404).json({ message: "Student record not found" });
      const classInfo = student.classId ? await storage.getClass(student.classId) : null;
      const subjects = await storage.getStudentSubjects(student.id);
      const allSubjects = await storage.getAllSubjects();
      const mySubjects = allSubjects.filter(s => subjects.some(ss => ss.subjectId === s.id));
      const allStaff = await storage.getAllStaff();
      res.json({
        student,
        class: classInfo,
        subjects: mySubjects.map(sub => ({
          ...sub,
          teacherName: (() => {
            const teacher = allStaff.find(st => st.id === (sub as any).teacherId);
            return teacher ? `${teacher.firstName} ${teacher.lastName}` : null;
          })(),
        })),
      });
    } catch (error) { next(error); }
  });

  // Student: get my attendance records
  app.get("/api/me/attendance", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (currentUser.role !== "student") return res.status(403).json({ message: "Students only" });
      const allStudents = await storage.getAllStudents();
      const student = allStudents.find(s => s.userId === currentUser.id);
      if (!student) return res.status(404).json({ message: "Student record not found" });
      const records = await storage.getAttendanceByStudent(student.id);
      res.json(records);
    } catch (error) { next(error); }
  });

  async function getPublishedPortalGradesForStudent(student: any) {
    if (!student?.classId || !student?.schoolId) return [];

    const [markRows, classInfo, school, allGrades] = await Promise.all([
      db.select().from(assessmentMarksSchema).where(eq(assessmentMarksSchema.studentId, student.id)),
      storage.getClass(Number(student.classId)),
      storage.getSchool(Number(student.schoolId)),
      storage.getGradesBySchool(Number(student.schoolId)),
    ]);
    if (!classInfo) return [];
    const classStream = classInfo.streamId ? await storage.getStream(classInfo.streamId) : undefined;

    const results: any[] = [];
    for (const mark of markRows) {
      const assessment = await storage.getAssessment(mark.assessmentId);
      if (!assessment || Number(assessment.classId) !== Number(student.classId) || !assessment.examId) continue;
      const publication = await getClassExamPublication(Number(assessment.examId), Number(student.classId));
      if (!publication?.isPublished) continue;
      const [subject, exam, assessmentType] = await Promise.all([
        storage.getSubject(Number(assessment.subjectId)),
        storage.getExam(Number(assessment.examId)),
        assessment.assessmentTypeId ? storage.getAssessmentType(Number(assessment.assessmentTypeId)) : Promise.resolve(undefined),
      ]);
      const percentage = parseFinitePercentage(mark.percentage);
      const applicableGrades = subject
        ? getClassSubjectGradeCandidates({
            allGrades,
            school,
            classInfo,
            classStreamName: classStream?.name || null,
            subject,
          }).grades
        : [];
      const grade = subject
        ? resolveStoredAssessmentGrade({
            mark,
            percentage,
            applicableGrades,
            allGrades,
            subjectType: subject.subjectType,
          })
        : null;
      const statusComment = markStatusLabel(mark.attStatus);
      if (percentage === null && !statusComment) continue;
      results.push({
        id: mark.id,
        percentage: mark.percentage,
        grade: statusComment ? null : grade?.gradeName || null,
        comment: statusComment || mark.customCommentText || mark.autoCommentSnapshot || null,
        assessmentName: assessment.name || exam?.examName || "Assessment",
        assessmentType: assessmentType?.name || "Assessment",
        subjectName: subject?.name || "Unknown",
        subjectCode: subject?.syllabusCode || null,
        term: assessment.termId ? `Term ${assessment.termId}` : null,
        year: assessment.year ? String(assessment.year) : null,
        examId: assessment.examId,
        examName: exam?.examName || null,
        publicationStatus: publication.lastAction === "republished" ? "Republished" : "Published",
      });
    }
    return results.sort((a, b) =>
      String(b.year || "").localeCompare(String(a.year || "")) ||
      String(a.term || "").localeCompare(String(b.term || "")) ||
      String(a.subjectName || "").localeCompare(String(b.subjectName || ""))
    );
  }

  // Student: only published grades/marks are visible in the portal.
  app.get("/api/me/grades", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (currentUser.role !== "student") return res.status(403).json({ message: "Students only" });
      const [student] = await db.select().from(studentsTable).where(eq(studentsTable.userId, currentUser.id)).limit(1);
      if (!student) return res.status(404).json({ message: "Student record not found" });
      res.json(await getPublishedPortalGradesForStudent(student));
    } catch (error) { next(error); }
  });

  // Parent: get children's attendance
  app.get("/api/me/children-attendance", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (currentUser.role !== "parent") return res.status(403).json({ message: "Parents only" });
      const allParents = await storage.getAllParents();
      const parent = allParents.find(p => p.userId === currentUser.id);
      if (!parent) return res.status(404).json({ message: "Parent record not found" });
      const children = await storage.getStudentsByParent(parent.id);
      const result = await Promise.all(children.map(async child => {
        const records = await storage.getAttendanceByStudent(child.id);
        return { student: child, records };
      }));
      res.json(result);
    } catch (error) { next(error); }
  });

  // Parent: only published grades for linked children are visible in the portal.
  app.get("/api/me/children-grades", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (currentUser.role !== "parent") return res.status(403).json({ message: "Parents only" });
      const [parent] = await db.select().from(parentsTable).where(eq(parentsTable.userId, currentUser.id)).limit(1);
      if (!parent) return res.status(404).json({ message: "Parent record not found" });
      const children = await storage.getStudentsByParent(parent.id);
      const result = await Promise.all(children.map(async (child: any) => ({
        student: child,
        marks: await getPublishedPortalGradesForStudent(child),
      })));
      res.json(result);
    } catch (error) { next(error); }
  });

  // Newsletters for student/parent read-only access
  app.get("/api/me/newsletters", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (currentUser.role !== "student" && currentUser.role !== "parent") {
        return res.status(403).json({ message: "Students and parents only" });
      }
      const schoolId = currentUser.schoolId;
      if (!schoolId) return res.json([]);
      const newsletters = await storage.getNewsletters(schoolId);
      const published = newsletters.filter((n: any) => n.status === "published");
      res.json(published);
    } catch (error) { next(error); }
  });

  // ============= 360 Student Profile =============

  app.get("/api/student-profile/:studentId", requireAuth, async (req, res, next) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const currentUser = await storage.getUser((req.user as any).id);
      let schoolId = getSchoolContext(req) || currentUser?.schoolId;

      const student = await storage.getStudent(studentId);
      if (!student) return res.status(404).json({ message: "Student not found" });

      if (!schoolId && currentUser?.organizationId && student.schoolId) {
        const orgSchools = await storage.getSchoolsByOrganization(currentUser.organizationId);
        if (orgSchools.some(s => s.id === student.schoolId)) {
          schoolId = student.schoolId;
        }
      }

      if (!schoolId) return res.status(400).json({ message: "School context required" });
      if (student.schoolId !== schoolId) return res.status(404).json({ message: "Student not found" });

      const school = await storage.getSchool(schoolId);
      const allClasses = await storage.getClassesBySchool(schoolId);
      const classMap = new Map(allClasses.map(c => [c.id, c]));
      const allStreams = await storage.getAllStreams();
      const streamMap = new Map(allStreams.map(s => [s.id, s]));

      const classInfo = student.classId ? classMap.get(student.classId) : null;
      const streamInfo = student.streamId ? streamMap.get(student.streamId) : null;

      const parent = student.parentId ? await storage.getParent(student.parentId) : null;

      const studentSubjectRows = await storage.getStudentSubjects(studentId);
      const allSubjects = await storage.getSubjectsBySchool(schoolId);
      const subjectMap = new Map(allSubjects.map(s => [s.id, s]));
      const enrolledSubjects = studentSubjectRows.map(ss => subjectMap.get(ss.subjectId)).filter(Boolean);

      const examId = req.query.examId ? parseInt(req.query.examId as string) : null;

      const allExams = await storage.getExamsBySchool(schoolId);
      const orgExams = school?.organizationId ? (await storage.getExamsBySchool(0)).filter(e => !e.schoolId) : [];
      const allAvailableExams = [...allExams, ...orgExams];

      let resultsData: any[] = [];
      let summaryStats: any = null;

      if (examId) {
        const exam = allAvailableExams.find(e => e.id === examId);
        if (exam) {
          const examAssessments = await storage.getAssessmentsByExam(examId);
          const classAssessments = examAssessments.filter(a => a.classId === student.classId);
          if (classAssessments.length > 0) {
            const assessmentIds = classAssessments.map(a => a.id);
            const allMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
            const grades = await storage.getGradesBySchool(schoolId);
            const classStreamForGrades = classInfo?.streamId ? streamMap.get(classInfo.streamId) : null;

            const studentMarks = allMarks.filter(m => m.studentId === studentId);

            let totalPct = 0;
            let subjectCount = 0;
            let subjectsPassed = 0;
            let totalPoints = 0;

            resultsData = classAssessments.map(assessment => {
              const mark = studentMarks.find(m => m.assessmentId === assessment.id);
              const subject = subjectMap.get(assessment.subjectId);
              if (!mark || !subject) return null;

              const pct = parseFinitePercentage(mark.percentage);
              const applicableGrades = classInfo
                ? getClassSubjectGradeCandidates({
                    allGrades: grades,
                    school,
                    classInfo,
                    classStreamName: classStreamForGrades?.name || null,
                    subject,
                  }).grades
                : [];
              const grade = resolveStoredAssessmentGrade({
                mark,
                percentage: pct,
                applicableGrades,
                allGrades: grades,
                subjectType: subject.subjectType,
              });
              const gradeName = grade?.gradeName || "";
              const gradePoints = grade?.gradePoints ? parseFloat(grade.gradePoints as string) : 0;

              if (pct !== null) {
                totalPct += pct;
                subjectCount++;
                totalPoints += gradePoints;
                if (pct >= 50) subjectsPassed++;
              }

              const comment = mark.customCommentText || mark.autoCommentSnapshot || "";

              const allSubjectMarks = allMarks
                .filter(m => m.assessmentId === assessment.id)
                .map(m => parseFinitePercentage(m.percentage))
                .filter((value): value is number => value !== null)
                .sort((a, b) => b - a);

              let classPosition: number | null = null;
              if (pct !== null) {
                classPosition = allSubjectMarks.filter(v => v > pct).length + 1;
              }

              return {
                subjectId: subject.id,
                subjectName: subject.name,
                syllabusCode: subject.syllabusCode || "",
                percentage: pct,
                gradeName,
                gradePoints,
                comment,
                classPosition,
                totalInClass: allSubjectMarks.length,
              };
            }).filter(Boolean);

            const allStudentTotals: { studentId: number; total: number }[] = [];
            const classStudents = await storage.getStudentsByClass(student.classId!);
            for (const cs of classStudents) {
              let st = 0;
              let sc = 0;
              for (const assessment of classAssessments) {
                const m = allMarks.find(mk => mk.studentId === cs.id && mk.assessmentId === assessment.id);
                const markPercentage = parseFinitePercentage(m?.percentage);
                if (markPercentage !== null) {
                  st += markPercentage;
                  sc++;
                }
              }
              if (sc > 0) allStudentTotals.push({ studentId: cs.id, total: st });
            }
            allStudentTotals.sort((a, b) => b.total - a.total);
            const studentTotal = allStudentTotals.find(t => t.studentId === studentId);
            const classPosition = studentTotal ? allStudentTotals.filter(t => t.total > studentTotal.total).length + 1 : 0;

            let streamPosition: number | null = null;
            let totalInStream: number | null = null;
            if (classInfo?.streamId) {
              const streamClasses = allClasses.filter(c => c.streamId === classInfo.streamId);
              const streamStudentTotals: { studentId: number; total: number }[] = [];
              for (const sc of streamClasses) {
                const scAssessments = examAssessments.filter(a => a.classId === sc.id);
                const scAssessmentIds = scAssessments.map(a => a.id);
                const scMarks = scAssessmentIds.length > 0 ? await storage.getAssessmentMarksByAssessments(scAssessmentIds) : [];
                const scStudents = await storage.getStudentsByClass(sc.id);
                for (const ss of scStudents) {
                  let st = 0;
                  let ssc = 0;
                  for (const a of scAssessments) {
                    const m = scMarks.find(mk => mk.studentId === ss.id && mk.assessmentId === a.id);
                    const markPercentage = parseFinitePercentage(m?.percentage);
                    if (markPercentage !== null) {
                      st += markPercentage;
                      ssc++;
                    }
                  }
                  if (ssc > 0) streamStudentTotals.push({ studentId: ss.id, total: st });
                }
              }
              streamStudentTotals.sort((a, b) => b.total - a.total);
              const studentStreamTotal = streamStudentTotals.find(t => t.studentId === studentId);
              if (studentStreamTotal) {
                streamPosition = streamStudentTotals.filter(t => t.total > studentStreamTotal.total).length + 1;
                totalInStream = streamStudentTotals.length;
              }
            }

            const totalMarks = subjectCount * 100;
            summaryStats = {
              totalMarks: `${Math.round(totalPct)}/${totalMarks}`,
              averageMark: subjectCount > 0 ? Math.round(totalPct / subjectCount) : 0,
              subjectsPassed: `${subjectsPassed}/${subjectCount}`,
              points: totalPoints,
              classPosition: classPosition > 0 ? classPosition : null,
              totalInClass: allStudentTotals.length,
              streamPosition: streamPosition && streamPosition > 0 ? streamPosition : null,
              totalInStream,
            };
          }
        }
      }

      const allAssessments = await db.select().from(assessmentsSchema).where(
        and(
          eq(assessmentsSchema.classId, student.classId || 0),
        )
      );
      const allAssessmentIds = allAssessments.map(a => a.id);
      const allAssessmentMarks = allAssessmentIds.length > 0
        ? await storage.getAssessmentMarksByAssessments(allAssessmentIds)
        : [];
      const studentAllMarks = allAssessmentMarks.filter(m => m.studentId === studentId);

      const assessmentTypeRows = await db.select().from(assessmentTypesSchema).where(eq(assessmentTypesSchema.schoolId, schoolId));
      const typeMap = new Map(assessmentTypeRows.map(t => [t.id, t]));

      const workWritten: Record<number, { subjectId: number; subjectName: string; syllabusCode: string; tests: { done: number; total: number }; exercises: { done: number; total: number }; fortnights: { done: number; total: number } }> = {};

      for (const subject of enrolledSubjects) {
        if (!subject) continue;
        const subjectAssessments = allAssessments.filter(a => a.subjectId === subject.id);

        const counts = { tests: { done: 0, total: 0 }, exercises: { done: 0, total: 0 }, fortnights: { done: 0, total: 0 } };

        for (const a of subjectAssessments) {
          const typeName = a.assessmentTypeId ? (typeMap.get(a.assessmentTypeId)?.name || "").toLowerCase() : "";
          let category: "tests" | "exercises" | "fortnights" | null = null;
          if (typeName.includes("test") || typeName.includes("exam") || typeName.includes("mock")) category = "tests";
          else if (typeName.includes("exercise") || typeName.includes("homework") || typeName.includes("assignment")) category = "exercises";
          else if (typeName.includes("fortnight") || typeName.includes("biweek")) category = "fortnights";
          else category = "tests";

          counts[category].total++;
          const hasMark = studentAllMarks.some(m => m.assessmentId === a.id && m.percentage);
          if (hasMark) counts[category].done++;
        }

        workWritten[subject.id] = {
          subjectId: subject.id,
          subjectName: subject.name,
          syllabusCode: subject.syllabusCode || "",
          ...counts,
        };
      }

      const performanceBySubject: any[] = [];
      for (const subject of enrolledSubjects) {
        if (!subject) continue;
        const subjectAssessments = allAssessments.filter(a => a.subjectId === subject.id);
        const typeBreakdown: Record<string, number[]> = {};
        for (const a of subjectAssessments) {
          const typeName = a.assessmentTypeId ? (typeMap.get(a.assessmentTypeId)?.name || "Other") : "Other";
          const mark = studentAllMarks.find(m => m.assessmentId === a.id && m.percentage);
          if (mark) {
            if (!typeBreakdown[typeName]) typeBreakdown[typeName] = [];
            typeBreakdown[typeName].push(parseFloat(mark.percentage as string));
          }
        }
        const avgByType: Record<string, number> = {};
        for (const [type, vals] of Object.entries(typeBreakdown)) {
          avgByType[type] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
        }
        performanceBySubject.push({
          subjectId: subject.id,
          subjectName: subject.name,
          shortCode: subject.shortCode || subject.name.substring(0, 4),
          avgByType,
        });
      }

      const performanceOverTime: any[] = [];
      const examsSorted = allAvailableExams
        .filter(e => e.schoolId === schoolId || !e.schoolId)
        .sort((a, b) => {
          if (a.year !== b.year) return (a.year || 0) - (b.year || 0);
          return (a.id) - (b.id);
        });
      const classStudentsForChart = student.classId ? await storage.getStudentsByClass(student.classId) : [];
      for (const exam of examsSorted) {
	  const examAssessments = await storage.getAssessmentsByExam(exam.id);
	  const classAssessmentsRaw = examAssessments.filter(a => a.classId === student.classId);
	  if (classAssessmentsRaw.length === 0) continue;

	  // Load marks once for all assessments in this class+exam
	  const rawIds = classAssessmentsRaw.map(a => a.id);
	  const rawMarks = await storage.getAssessmentMarksByAssessments(rawIds);

	  // Count marks per assessment to pick the "real" assessment if duplicates exist
	  const markCount = new Map<number, number>();
	  for (const m of rawMarks) {
	    if (m.percentage !== null && m.percentage !== undefined) {
	      markCount.set(m.assessmentId, (markCount.get(m.assessmentId) || 0) + 1);
	    }
	  }

	  // Pick ONE assessment per subject (best coverage, tie → higher id)
	  const bestBySubject = new Map<number, typeof classAssessmentsRaw[0]>();
	  for (const a of classAssessmentsRaw) {
	    const prev = bestBySubject.get(a.subjectId);
	    if (!prev) {
	      bestBySubject.set(a.subjectId, a);
	    } else {
	      const cNew = markCount.get(a.id) || 0;
	      const cPrev = markCount.get(prev.id) || 0;
	      if (cNew > cPrev || (cNew === cPrev && a.id > prev.id)) {
	        bestBySubject.set(a.subjectId, a);
	      }
	    }
	  }

	  const classAssessments = Array.from(bestBySubject.values());
	  const chosenIds = new Set(classAssessments.map(a => a.id));
	  const examMarks = rawMarks.filter(m => chosenIds.has(m.assessmentId));

	  // Student avg (one per subject)
	  const studentExamMarks = examMarks.filter(m => m.studentId === studentId && m.percentage);
	  if (studentExamMarks.length === 0) continue;

	  const studentAvg = Math.round(
	    studentExamMarks.reduce((s, m) => s + parseFloat(m.percentage as string), 0) / studentExamMarks.length
	  );

	  // Class avg = average of student averages
	  const studentAvgs: number[] = [];
	  for (const cs of classStudentsForChart) {
	    const csMarks = examMarks.filter(m => m.studentId === cs.id && m.percentage);
	    if (csMarks.length > 0) {
	      studentAvgs.push(
	        Math.round(csMarks.reduce((s, m) => s + parseFloat(m.percentage as string), 0) / csMarks.length)
	      );
	    }
	  }
	  const classAvg = studentAvgs.length > 0
	    ? Math.round(studentAvgs.reduce((s, v) => s + v, 0) / studentAvgs.length)
	    : 0;

	  performanceOverTime.push({
	    examName: exam.examName,
	    studentAvg,
	    classAvg,
	  });
	}




      const attendance = await storage.getAttendanceByStudent(studentId);
      const attendanceSummary = {
        present: attendance.filter(a => a.status === "present").length,
        absent: attendance.filter(a => a.status === "absent").length,
        sick: attendance.filter(a => a.status === "sick").length,
        excused: attendance.filter(a => a.status === "excused").length,
        late: attendance.filter(a => a.status === "late").length,
        fees: attendance.filter(a => a.status === "fees" || a.status === "sent_home_fees").length,
        suspended: attendance.filter(a => a.status === "suspended").length,
        absconding: attendance.filter(a => a.status === "absconding").length,
        total: attendance.length,
      };
      const attendanceCalendar = attendance.map(a => ({
        date: a.date,
        status: a.status,
      }));

      const studentLoans = await db.select().from(libraryLoansTable).where(
        and(
          eq(libraryLoansTable.borrowerId, studentId),
          eq(libraryLoansTable.borrowerType, "student")
        )
      );
      const bookIds = [...new Set(studentLoans.map(l => l.bookId))];
      const libraryBooksData = bookIds.length > 0
        ? await Promise.all(bookIds.map(id => db.select().from(libraryBooksTable).where(eq(libraryBooksTable.id, id)).then(r => r[0])))
        : [];
      const bookMap = new Map(libraryBooksData.filter(Boolean).map(b => [b.id, b]));

      const libraryBorrowings = (studentLoans as any[]).map((loan: any) => {
        const book = bookMap.get(loan.bookId);
        return {
          id: loan.id,
          bookTitle: book?.title || "Unknown",
          author: book?.author || "",
          issuedAt: loan.issuedAt,
          dueDate: loan.dueDate,
          returnedAt: loan.returnedAt,
          status: loan.status,
          fineAmount: null as string | null,
        };
      });

      const disciplineRecords = await storage.getDisciplineRecords(studentId);

      const feesPayments = await storage.getFeesPayments(studentId);

      res.json({
        student: {
          ...student,
          className: classInfo?.className || null,
          classShortCode: classInfo?.shortCode || null,
          streamName: streamInfo?.name || null,
        },
        parent: parent ? {
          firstName: parent.firstName,
          lastName: parent.lastName,
          phone: parent.phone,
          email: parent.email,
          relationship: parent.relationship,
        } : null,
        subjects: enrolledSubjects.map(s => s ? ({
          id: s.id,
          name: s.name,
          syllabusCode: s.syllabusCode || "",
          shortCode: s.shortCode || "",
        }) : null).filter(Boolean),
        exams: allAvailableExams.map(e => ({ id: e.id, examName: e.examName, year: e.year })),
        results: resultsData,
        summaryStats,
        workWritten: Object.values(workWritten),
        performanceBySubject,
        performanceOverTime,
        attendanceSummary,
        attendanceCalendar,
        libraryBorrowings,
        disciplineRecords,
        feesPayments: feesPayments.slice(0, 20),
        feesBalance: student.feesBalance,
        feesTotalTerm: student.feesTotalTerm,
        feesPaidSoFar: student.feesPaidSoFar,
      });
    } catch (error) { next(error); }
  });

  // ============= 360 Staff Profile =============

  app.get("/api/staff-profile/:staffId", requireAuth, async (req, res, next) => {
    try {
      const staffId = parseInt(req.params.staffId);
      const currentUser = await storage.getUser((req.user as any).id);
      let schoolId = getSchoolContext(req) || currentUser?.schoolId;

      const staffMember = await storage.getStaff(staffId);
      if (!staffMember) return res.status(404).json({ message: "Staff member not found" });

      if (!schoolId && currentUser?.organizationId && staffMember.schoolId) {
        const orgSchools = await storage.getSchoolsByOrganization(currentUser.organizationId);
        if (orgSchools.some(s => s.id === staffMember.schoolId)) {
          schoolId = staffMember.schoolId;
        }
      }

      if (!schoolId) return res.status(400).json({ message: "School context required" });
      if (staffMember.schoolId !== schoolId) return res.status(404).json({ message: "Staff member not found" });

      const user = staffMember.userId ? await storage.getUser(staffMember.userId) : null;

      const allClasses = await storage.getClassesBySchool(schoolId);
      const classMap = new Map(allClasses.map(c => [c.id, c]));
      const allStreams = await storage.getAllStreams();
      const streamMap = new Map(allStreams.map(s => [s.id, s]));
      const allSubjects = await storage.getSubjectsBySchool(schoolId);
      const subjectMap = new Map(allSubjects.map(s => [s.id, s]));

      const staffSubjectRows = await storage.getStaffSubjects(staffId);
      const teachingAssignments = staffSubjectRows.map(ss => {
        const subject = subjectMap.get(ss.subjectId);
        const cls = ss.classId ? classMap.get(ss.classId) : null;
        const stream = cls?.streamId ? streamMap.get(cls.streamId) : null;
        return {
          subjectId: ss.subjectId,
          subjectName: subject?.name || "Unknown",
          syllabusCode: subject?.syllabusCode || "",
          shortCode: subject?.shortCode || "",
          classId: ss.classId,
          className: cls?.className || "",
          streamName: stream?.name || "",
        };
      });

      const timetableData = await db.select().from(timetableSlotsTable).where(
        and(
          eq(timetableSlotsTable.schoolId, schoolId),
          eq(timetableSlotsTable.teacherId, staffId)
        )
      );
      const timetable = timetableData.map(slot => {
        const subject = subjectMap.get(slot.subjectId);
        const cls = classMap.get(slot.classId);
        return {
          id: slot.id,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          room: slot.room,
          subjectName: subject?.name || "",
          className: cls?.className || "",
        };
      });

      const today = new Date();
      const dayOfWeek = today.getDay();
      const todayLessons = timetable.filter(t => t.dayOfWeek === dayOfWeek);
      const tomorrowDow = (dayOfWeek + 1) % 7;
      const upcomingLessons = timetable.filter(t => t.dayOfWeek === tomorrowDow);

      const assessmentTypeRows = await db.select().from(assessmentTypesSchema).where(eq(assessmentTypesSchema.schoolId, schoolId));
      const typeMap = new Map(assessmentTypeRows.map(t => [t.id, t]));

      const subjectsTaught: any[] = [];

      for (const assignment of teachingAssignments) {
        if (!assignment.classId) continue;

        const classAssessments = await db.select().from(assessmentsSchema).where(
          and(
            eq(assessmentsSchema.schoolId, schoolId),
            eq(assessmentsSchema.subjectId, assignment.subjectId),
            eq(assessmentsSchema.classId, assignment.classId)
          )
        );

        const assessmentIds = classAssessments.map(a => a.id);
        const allMarks = assessmentIds.length > 0
          ? await storage.getAssessmentMarksByAssessments(assessmentIds)
          : [];

        const classStudents = await storage.getStudentsByClass(assignment.classId);
        const totalStudents = classStudents.length;

        const workGivenByType: Record<string, { given: number; totalStudents: number; avgPerformance: number | null }> = {};

        for (const assessment of classAssessments) {
          const typeName = assessment.assessmentTypeId
            ? (typeMap.get(assessment.assessmentTypeId)?.name || "Other")
            : "Other";

          if (!workGivenByType[typeName]) {
            workGivenByType[typeName] = { given: 0, totalStudents, avgPerformance: null };
          }
          workGivenByType[typeName].given++;

          const marks = allMarks.filter(m => m.assessmentId === assessment.id && m.percentage);
          if (marks.length > 0) {
            const avg = marks.reduce((s, m) => s + parseFloat(m.percentage as string), 0) / marks.length;
            const current = workGivenByType[typeName].avgPerformance;
            workGivenByType[typeName].avgPerformance = current !== null ? (current + avg) / 2 : avg;
          }
        }

        const examNames = [...new Set(classAssessments.filter(a => a.examId).map(a => a.examId))];
        const studentPerformanceByExam: any[] = [];

        for (const examId of examNames) {
          if (!examId) continue;
          const examAssessments = classAssessments.filter(a => a.examId === examId);
          const examAssessmentIds = examAssessments.map(a => a.id);
          const examMarks = allMarks.filter(m => examAssessmentIds.includes(m.assessmentId) && m.percentage);

          if (examMarks.length > 0) {
            const avg = Math.round(examMarks.reduce((s, m) => s + parseFloat(m.percentage as string), 0) / examMarks.length);
            const exam = await storage.getExam(examId);
            studentPerformanceByExam.push({
              examName: exam?.examName || `Exam ${examId}`,
              avgPercentage: avg,
            });
          }
        }

        subjectsTaught.push({
          subjectId: assignment.subjectId,
          subjectName: assignment.subjectName,
          syllabusCode: assignment.syllabusCode,
          classId: assignment.classId,
          className: assignment.className,
          streamName: assignment.streamName,
          label: `${assignment.subjectName}${assignment.syllabusCode ? ` - ${assignment.syllabusCode}` : ""} - ${assignment.className}`,
          workGivenByType,
          studentPerformanceByExam,
        });
      }

      const attendanceLogs = await storage.getStaffAttendanceLogs(schoolId, { staffId });
      const attendanceCalendar = attendanceLogs.map(a => ({
        date: a.date,
        status: a.status,
        clockIn: a.clockIn,
        clockOut: a.clockOut,
      }));
      const attendanceSummary = {
        present: attendanceLogs.filter(a => a.status === "on_time" || a.status === "present").length,
        late: attendanceLogs.filter(a => a.status === "late").length,
        absent: attendanceLogs.filter(a => a.status === "absent").length,
        excused: attendanceLogs.filter(a => a.status === "excused" || a.status === "leave").length,
        total: attendanceLogs.length,
      };

      res.json({
        staff: {
          id: staffMember.id,
          firstName: staffMember.firstName,
          lastName: staffMember.lastName,
          email: staffMember.email,
          phone: staffMember.phone,
          gender: staffMember.gender,
          photo: staffMember.photo,
          role: staffMember.role,
          status: staffMember.status,
          staffNo: staffMember.staffNo,
          createdAt: staffMember.createdAt,
        },
        username: user?.username || null,
        teachingAssignments,
        timetable,
        todayLessons,
        upcomingLessons,
        subjectsTaught,
        attendanceCalendar,
        attendanceSummary,
      });
    } catch (error) { next(error); }
  });

  return httpServer;
}
