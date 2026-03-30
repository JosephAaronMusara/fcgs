import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { setupAuth, requireAuth, requirePermission, requireRole } from "./auth";
import { storage } from "./storage";
import { db } from "./db";
import { staffSubjects, users, qcReports, assessmentMarks as assessmentMarksSchema, assessments as assessmentsSchema, assessmentTypes as assessmentTypesSchema, classSubjects as classSubjectsSchema, studentSubjects as studentSubjectsSchema, students as studentsTable, libraryLoans as libraryLoansTable, timetableSlots as timetableSlotsTable, staffRoles, organizations, userSchoolAccess, reportComments } from "@shared/schema";
import multer from "multer";
import { parse as csvParse } from "csv-parse/sync";
import { eq, and, sql, like } from "drizzle-orm";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerCalendarRoutes } from "./calendar-routes";
import { communicationService, createBroadcastNotifications } from "./communication";
import { generateReportCardPdf, type ReportCardPdfData } from "./pdf-report-card";
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
  insertOrganizationSchema, insertSchoolSchema, insertLibraryResourceSchema, insertLibraryCategorySchema, insertLibraryBookSchema, insertLibraryLoanSchema, insertLibraryFineSchema, insertLibraryReservationSchema,
  libraryBooks as libraryBooksTable,
  insertTimetableSlotSchema, insertLogbookEntrySchema, insertStaffAttendanceLogSchema, insertPosItemSchema,
  schools as schoolsTable,
  insertPosSaleSchema, insertNewsletterSchema, insertSchemeSchema,
  insertHostelSchema, insertHostelRollCallSchema, insertStudentApplicationSchema,
  hostels as hostelsTable,
  insertPermissionSchema, insertAccessGroupSchema,
  type User, type InsertStudent, type InsertActivityLog
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
  studentId?: number;
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
  let streamId = classInfo?.streamId ?? null;
  if (args.studentId) {
    const student = await storage.getStudent(args.studentId);
    if (student?.streamId) streamId = student.streamId;
  }
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

async function getCurrentStaffMember(req: Request, schoolId: number) {
  const currentUser = await storage.getUser((req.user as any).id);
  if (!currentUser) return null;
  const schoolStaff = await storage.getStaffBySchool(schoolId);
  return schoolStaff.find((member) => member.userId === currentUser.id) || null;
}

async function ensureTeacherAssignmentForAssessment(_req: Request, _res: Response, _schoolId: number, _classId: number, _subjectId: number) {
  return true;
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


function mapStaffRoleToUserRole(staffRole: string | null | undefined): User["role"] {
  switch (staffRole) {
    case "teacher":
      return "teacher";
    case "assistant_teacher":
      return "assistant_teacher";
    case "librarian":
      return "librarian";
    case "quality_control_officer":
      return "quality_control_officer";
    default:
      return "school_admin";
  }
}

function getDefaultAccessGroupNamesForUser(role: User["role"], staffRole?: string | null): string[] {
  if (role === "org_admin") return ["Org HQ"];
  if (role === "student") return [];
  if (role === "parent") return [];

  switch (staffRole || role) {
    case "teacher":
      return ["Teacher"];
    case "assistant_teacher":
      return ["Assistant Teacher"];
    case "librarian":
      return ["Librarian"];
    case "quality_control_officer":
      return ["Quality Control Officer"];
    case "accountant":
      return ["Accountant"];
    default:
      return [role === "school_admin" ? "School Admin" : "Teacher"];
  }
}

async function assignDefaultAccessGroupsToUser(userId: number, role: User["role"], staffRole?: string | null): Promise<void> {
  const groupNames = getDefaultAccessGroupNamesForUser(role, staffRole);
  if (!groupNames.length) return;

  const accessGroups = await storage.getAllAccessGroups();
  for (const groupName of groupNames) {
    const group = accessGroups.find(currentGroup => currentGroup.name === groupName);
    if (group) {
      await storage.addUserToAccessGroup({ userId, accessGroupId: group.id });
    }
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

function termLabel(termStr: string): string {
  const labels: Record<string, string> = { term1: "Term 1", term2: "Term 2", term3: "Term 3", vac1: "Vacation 1", vac2: "Vacation 2" };
  return labels[termStr] || termStr;
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

  return { schoolId, comment };
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

  return { schoolId, mark };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() });
  });

  setupAuth(app);
  registerObjectStorageRoutes(app);
  registerCalendarRoutes(app);
  await ensureEcdSeedData();

  const readOnlyExemptPaths = [
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/register",
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
      const stats = await storage.getDashboardStats(schoolId);
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
      const staffList = await storage.getAllStaff();
      // Filter by school context
      const filtered = schoolId 
        ? staffList.filter(s => s.schoolId === schoolId)
        : staffList;
      res.json(filtered);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff/next-no", requireAuth, async (req, res, next) => {
    try {
      const staffNo = await storage.getNextStaffNo();
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
      const newStaff = await storage.createStaff({
        ...data,
        schoolId: schoolId || undefined,
      });
      logActivity(req, { action: "create", category: "staff", description: `Added staff member: ${newStaff.firstName} ${newStaff.lastName}`, targetType: "staff", targetId: newStaff.id, targetName: `${newStaff.firstName} ${newStaff.lastName}` });
      res.status(201).json(newStaff);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/staff/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const updated = await storage.updateStaff(parseInt(req.params.id), req.body);
      if (!updated) {
        return res.status(404).json({ message: "Staff not found" });
      }
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

  app.post("/api/staff/import", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
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

  app.post("/api/staff/:id/reset-mobile-id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const updated = await storage.updateStaff(parseInt(req.params.id), { mobileId: null });
      if (!updated) {
        return res.status(404).json({ message: "Staff not found" });
      }
      res.json({ message: "Mobile ID reset successfully", staff: updated });
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
        const resetToken = generateResetToken();
        tokenData = {
          passwordResetToken: resetToken,
          passwordResetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
          mustResetPassword: true,
        };
      } else {
        if (!password) {
          return res.status(400).json({ message: "Password is required when not sending reset token" });
        }
        const pwdCheck = validatePassword(password);
        if (!pwdCheck.valid) {
          return res.status(400).json({ message: pwdCheck.message });
        }
        hashedPassword = await bcrypt.hash(password, 10);
        tokenData = { tempPasswordLoginsRemaining: 3 };
        passwordToSend = password;
      }

      const userRole = mapStaffRoleToUserRole(staffMember.role);
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
      await assignDefaultAccessGroupsToUser(newUser.id, userRole, staffMember.role);
      await storage.updateStaff(staffId, { userId: newUser.id });

      const name = `${staffMember.firstName} ${staffMember.lastName}`;
      const schoolId = staffMember.schoolId;
      const userId = (req.user as User).id;
      const sysUrl = await getSystemUrl(schoolId);
      const loginLink = sysUrl ? `\nLogin here: ${sysUrl}` : "";

      if (sendResetToken && tokenData.passwordResetToken) {
        const resetMsg = `Dear ${name},\nYour account has been created.\nUsername: ${username}\nPlease use this token to set your password (valid for 1 hour):\n${tokenData.passwordResetToken}${loginLink}\n\nHardwork - Discipline - Changing Lives`;
        if (staffMember.phone) {
          await communicationService.sendSms({ to: staffMember.phone, message: resetMsg, schoolId: schoolId || 0, recipientType: "staff", recipientId: staffId, sentBy: userId, category: "account", recipientName: name });
        }
        if (staffMember.email) {
          await communicationService.sendEmail({ to: staffMember.email, subject: "Account Created - Password Reset Required", html: resetMsg.replace(/\n/g, '<br>'), text: resetMsg, schoolId: schoolId || 0, recipientType: "staff", recipientId: staffId, sentBy: userId, category: "account", recipientName: name });
        }
      } else if (passwordToSend) {
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
      const allRecords = await db.select().from(classSubjectsSchema);
      res.json(allRecords);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/classes/:id/subjects", requireAuth, async (req, res, next) => {
    try {
      const classSubjectsList = await storage.getClassSubjects(parseInt(req.params.id));
      res.json(classSubjectsList);
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
      const subject = await storage.getSubject(subjectId);
      if (subject && subject.streamIds && subject.streamIds.length > 0) {
        if (!classData.streamId || !subject.streamIds.includes(classData.streamId)) {
          return res.status(400).json({ message: `${subject.name} is not available for this stream` });
        }
      }
      const classSubject = await storage.addClassSubject(classId, subjectId);
      res.status(201).json(classSubject);
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
      await storage.removeClassSubject(classId, parseInt(req.params.subjectId));
      res.json({ message: "Subject removed from class" });
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
      const { subjectIds } = req.body;
      if (!Array.isArray(subjectIds)) {
        return res.status(400).json({ message: "subjectIds must be an array" });
      }
      if (subjectIds.length > 0) {
        const allSubjects = await storage.getAllSubjects();
        const schoolSubjects = allSubjects.filter(s => s.schoolId === classData.schoolId);
        const invalidSubjects: string[] = [];
        for (const sid of subjectIds) {
          const subject = schoolSubjects.find(s => s.id === sid);
          if (subject && subject.streamIds && subject.streamIds.length > 0) {
            if (!classData.streamId || !subject.streamIds.includes(classData.streamId)) {
              invalidSubjects.push(subject.name);
            }
          }
        }
        if (invalidSubjects.length > 0) {
          return res.status(400).json({ message: `${invalidSubjects.join(", ")} ${invalidSubjects.length === 1 ? "is" : "are"} not available for this stream` });
        }
      }
      await storage.setClassSubjects(classId, subjectIds);
      res.json({ message: "Class subjects updated" });
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
      const parentList = await storage.getAllParents();
      // Always filter by schoolId - exclude null schoolId parents unless org_admin explicitly wants them
      // For multi-tenant security, require school context for parent access
      const filtered = schoolId 
        ? parentList.filter(p => p.schoolId === schoolId)
        : parentList.filter(p => p.schoolId !== null); // Org_admin without context gets all valid school parents, not null ones
      res.json(filtered);
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
  app.post("/api/parents/import", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
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
        const resetToken = generateResetToken();
        tokenData = {
          passwordResetToken: resetToken,
          passwordResetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
          mustResetPassword: true,
        };
      } else {
        if (!password) {
          return res.status(400).json({ message: "Password is required when not sending reset token" });
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
      const sysUrl = await getSystemUrl(effectiveSchoolId);
      const loginLink = sysUrl ? `\nLogin here: ${sysUrl}` : "";

      if (sendResetToken && tokenData.passwordResetToken) {
        const resetMsg = `Dear ${name},\nYour account has been created.\nUsername: ${username}\nPlease use this token to set your password (valid for 1 hour):\n${tokenData.passwordResetToken}${loginLink}\n\nHardwork - Discipline - Changing Lives`;
        if (parent.phone) {
          await communicationService.sendSms({ to: parent.phone, message: resetMsg, schoolId: effectiveSchoolId, recipientType: "parent", recipientId: parentId, sentBy: userId, category: "account", recipientName: name });
        }
        if (parent.email) {
          await communicationService.sendEmail({ to: parent.email, subject: "Account Created - Password Reset Required", html: resetMsg.replace(/\n/g, '<br>'), text: resetMsg, schoolId: effectiveSchoolId, recipientType: "parent", recipientId: parentId, sentBy: userId, category: "account", recipientName: name });
        }
      } else if (passwordToSend) {
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
      const studentList = await storage.getAllStudents();
      // Filter by school context
      const filtered = schoolId 
        ? studentList.filter(s => s.schoolId === schoolId)
        : studentList;
      res.json(filtered);
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
      const admissionNo = await storage.getNextAdmissionNo();
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
      res.json(student);
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
      const normalizedData: any = {
        ...data,
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
      await storage.deleteStudent(parseInt(req.params.id));
      res.json({ message: "Student deleted successfully" });
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
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (currentUser.role !== "org_admin" && schoolId && student.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const updated = await storage.updateStudent(id, { status: "transferred" });
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
      const studentSubjectList = await storage.getStudentSubjects(studentId);
      const allSubjects = await storage.getAllSubjects();
      const filteredSubjects = schoolId ? allSubjects.filter(s => s.schoolId === schoolId) : allSubjects;
      res.json({
        all: filteredSubjects,
        selected: studentSubjectList.map(ss => ss.subjectId.toString())
      });
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
      const { subjectIds } = req.body as { subjectIds: number[] };
      const uniqueSubjectIds = [...new Set(subjectIds || [])];
      await storage.updateStudentSubjects(studentId, uniqueSubjectIds);
      res.json({ message: "Student subjects updated successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/students/import", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
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
        const resetToken = generateResetToken();
        tokenData = {
          passwordResetToken: resetToken,
          passwordResetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
          mustResetPassword: true,
        };
      } else {
        if (!parsed.password) {
          return res.status(400).json({ message: "Password is required when not sending reset token" });
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
      const sysUrl = await getSystemUrl(effSchoolId);
      const loginLink = sysUrl ? `\nLogin here: ${sysUrl}` : "";

      if (parsed.sendResetToken && tokenData.passwordResetToken) {
        const parentRecord = student.parentId ? await storage.getParent(student.parentId) : null;
        const contactPhone = student.phone || parentRecord?.phone;
        const contactEmail = student.email || parentRecord?.email;
        const resetMsg = `Dear ${name},\nYour account has been created.\nUsername: ${parsed.username}\nPlease use this token to set your password (valid for 1 hour):\n${tokenData.passwordResetToken}${loginLink}\n\nHardwork - Discipline - Changing Lives`;
        if (contactPhone) {
          await communicationService.sendSms({ to: contactPhone, message: resetMsg, schoolId: effSchoolId, recipientType: "student", recipientId: studentId, sentBy: userId, category: "account", recipientName: name });
        }
        if (contactEmail) {
          await communicationService.sendEmail({ to: contactEmail, subject: "Account Created - Password Reset Required", html: resetMsg.replace(/\n/g, '<br>'), text: resetMsg, schoolId: effSchoolId, recipientType: "student", recipientId: studentId, sentBy: userId, category: "account", recipientName: name });
        }
      } else if (passwordToSend) {
        const parentRecord = student.parentId ? await storage.getParent(student.parentId) : null;
        const contactPhone = student.phone || parentRecord?.phone;
        const contactEmail = student.email || parentRecord?.email;
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
          s.shortCode.toLowerCase().includes(searchLower)
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
            const className = classInfo?.className || 'Class';
            const reasonRaw = newReason;
            const reasonLc = reasonRaw.toLowerCase();
            const isUnknown = unknownReasons.includes(reasonLc);
            const contactLine = `Phone: ${callPhone} or WhatsApp: ${waPhone}`;
            const line1 = `FCGS Attendance: ${studentName} was marked ABSENT on ${rec.date} (${className}).`;
            let line2: string;
            if (isUnknown) {
              line2 = 'Please contact our Call Centre with a reason for the absence.';
            } else {
              line2 = `Reason: ${reasonRaw.toUpperCase()}. Please contact our Call Centre for any enquiries you may have.`;
            }
            msg = `${line1}\n${line2}\n${contactLine}`;
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
      const classId = parseInt(req.params.classId);
      const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
      let from = req.params.from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      let to = req.params.to || new Date().toISOString().split('T')[0];
      if (!isValidDate(from)) from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      if (!isValidDate(to)) to = new Date().toISOString().split('T')[0];
      const records = await storage.getAttendanceByClassRange(classId, from, to);
      const students = await storage.getStudentsByClass(classId);

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
        students: students.map(s => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          admissionNo: s.admissionNo,
          statuses: index[s.id] || {},
        })),
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

  app.post("/api/clinic/import", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
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

  app.post("/api/fees/import-csv", requireAuth, requireRole("school_admin", "org_admin"), feesUpload.single("fees_csv"), async (req, res, next) => {
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

      let sent = 0;
      let missing = 0;

      for (const sid of studentIds) {
        const student = await storage.getStudent(parseInt(sid));
        if (!student || student.schoolId !== schoolId) continue;

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

        if (parentPhone) {
          await communicationService.sendSms({
            to: parentPhone,
            message: smsMessage,
            schoolId,
            recipientType: "parent",
            recipientId: student.parentId || undefined,
            recipientName: parentName,
            category: "fees_reminder",
            sentBy: userId,
          });
        }

        if (parentEmail) {
          const emailBody = `Dear Parent/Guardian,\n\nThis is a friendly reminder of the current fee position for your child:\n\nStudent: ${name}\nClass: ${classLabel}\n${summaryLine}\n\nIf you have recently made payment, please ignore this message.\n\nThank you,\n${schoolName}`;
          await communicationService.sendEmail({
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
        }

        sent++;
      }

      res.json({ success: true, sent, missing });
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
  app.get("/api/library/resources", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req) || (req.query.schoolId ? parseInt(req.query.schoolId as string) : undefined);
      const resources = await storage.getLibraryResources(schoolId);
      res.json(resources);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/library/resources/:id", requireAuth, async (req, res, next) => {
    try {
      const resource = await storage.getLibraryResource(parseInt(req.params.id));
      if (!resource) return res.status(404).json({ message: "Resource not found" });
      res.json(resource);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/library/resources", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const data = insertLibraryResourceSchema.parse(req.body);
      const newResource = await storage.createLibraryResource(data);
      res.status(201).json(newResource);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/library/resources/:id", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const updated = await storage.updateLibraryResource(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Resource not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/library/resources/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      await storage.deleteLibraryResource(parseInt(req.params.id));
      res.json({ message: "Resource deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Library - Categories
  app.get("/api/library/categories", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const categories = await storage.getLibraryCategories(schoolId);
      res.json(categories);
    } catch (error) { next(error); }
  });

  app.post("/api/library/categories", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const data = insertLibraryCategorySchema.parse(req.body);
      const category = await storage.createLibraryCategory(data);
      res.status(201).json(category);
    } catch (error) { next(error); }
  });

  app.put("/api/library/categories/:id", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const updated = await storage.updateLibraryCategory(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.delete("/api/library/categories/:id", requireAuth, requireRole("school_admin"), async (req, res, next) => {
    try {
      await storage.deleteLibraryCategory(parseInt(req.params.id));
      res.json({ message: "Category deleted" });
    } catch (error) { next(error); }
  });

  // Library - Books
  app.get("/api/library/books", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const books = await storage.getLibraryBooks(schoolId);
      res.json(books);
    } catch (error) { next(error); }
  });

  app.get("/api/library/books/:id", requireAuth, async (req, res, next) => {
    try {
      const book = await storage.getLibraryBook(parseInt(req.params.id));
      if (!book) return res.status(404).json({ message: "Book not found" });
      res.json(book);
    } catch (error) { next(error); }
  });

  app.post("/api/library/books", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const data = insertLibraryBookSchema.parse(req.body);
      if (data.schoolId && data.title && data.classId) {
        const existingBooks = await storage.getLibraryBooks(data.schoolId);
        const duplicate = existingBooks.find(
          (b) => b.title.toLowerCase() === data.title.toLowerCase() && b.classId === data.classId
        );
        if (duplicate) {
          return res.status(400).json({ message: "A book with this title already exists for this class/level. Please select a different class." });
        }
      }
      const book = await storage.createLibraryBook(data);
      res.status(201).json(book);
    } catch (error) { next(error); }
  });

  app.put("/api/library/books/:id", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const updated = await storage.updateLibraryBook(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Book not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.delete("/api/library/books/:id", requireAuth, requireRole("school_admin"), async (req, res, next) => {
    try {
      await storage.deleteLibraryBook(parseInt(req.params.id));
      res.json({ message: "Book deleted" });
    } catch (error) { next(error); }
  });

  // Library - Book Copies
  app.get("/api/library/books/:bookId/copies", requireAuth, async (req, res, next) => {
    try {
      const copies = await storage.getLibraryBookCopies(parseInt(req.params.bookId));
      res.json(copies);
    } catch (error) { next(error); }
  });

  app.get("/api/library/copies", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const copies = await storage.getLibraryBookCopiesBySchool(schoolId);
      res.json(copies);
    } catch (error) { next(error); }
  });

  app.get("/api/library/copies/qr/:qrCode", requireAuth, async (req, res, next) => {
    try {
      const copy = await storage.getLibraryBookCopyByQr(req.params.qrCode);
      if (!copy) return res.status(404).json({ message: "No book copy found with this QR code" });
      const book = await storage.getLibraryBook(copy.bookId);
      let activeLoan = null;
      if (copy.status === "borrowed" && book?.schoolId) {
        const allLoans = await storage.getLibraryLoans(book.schoolId, "active");
        activeLoan = allLoans.find(l => l.copyId === copy.id) || null;
      }
      res.json({ copy, book, activeLoan });
    } catch (error) { next(error); }
  });

  app.post("/api/library/books/:bookId/copies", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const bookId = parseInt(req.params.bookId);
      const book = await storage.getLibraryBook(bookId);
      if (!book) return res.status(404).json({ message: "Book not found" });
      const { qrCode, condition } = req.body;
      if (!qrCode) return res.status(400).json({ message: "QR code is required" });
      const existing = await storage.getLibraryBookCopyByQr(qrCode);
      if (existing) return res.status(400).json({ message: "This QR code is already assigned to another book copy" });
      const copy = await storage.createLibraryBookCopy({
        bookId,
        schoolId: book.schoolId,
        qrCode,
        condition: condition || "Good",
      });
      await storage.updateLibraryBook(bookId, {
        totalCopies: (book.totalCopies || 0) + 1,
        availableCopies: (book.availableCopies || 0) + 1,
      });
      res.status(201).json(copy);
    } catch (error) { next(error); }
  });

  app.put("/api/library/copies/:id", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const updated = await storage.updateLibraryBookCopy(parseInt(req.params.id), req.body);
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.delete("/api/library/copies/:id", requireAuth, requireRole("school_admin"), async (req, res, next) => {
    try {
      const copyId = parseInt(req.params.id);
      const copyToDelete = await storage.getLibraryBookCopy(copyId);
      if (!copyToDelete) return res.status(404).json({ message: "Copy not found" });
      if (copyToDelete.status === "borrowed") {
        return res.status(400).json({ message: "Cannot delete a borrowed copy" });
      }
      const book = await storage.getLibraryBook(copyToDelete.bookId);
      if (book) {
        await storage.updateLibraryBook(book.id, {
          totalCopies: Math.max((book.totalCopies || 0) - 1, 0),
          availableCopies: copyToDelete.status === "available"
            ? Math.max((book.availableCopies || 0) - 1, 0)
            : (book.availableCopies || 0),
        });
      }
      await storage.deleteLibraryBookCopy(copyId);
      res.json({ message: "Copy deleted" });
    } catch (error) { next(error); }
  });

  // Library - Loans (Circulation)
  app.get("/api/library/loans", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const status = req.query.status as string | undefined;
      const loans = await storage.getLibraryLoans(schoolId, status);
      res.json(loans);
    } catch (error) { next(error); }
  });

  app.post("/api/library/loans", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const data = insertLibraryLoanSchema.parse(req.body);
      const loan = await storage.createLibraryLoan(data);
      // Decrement available copies
      const book = await storage.getLibraryBook(data.bookId);
      if (book && (book.availableCopies || 0) > 0) {
        await storage.updateLibraryBook(data.bookId, { availableCopies: (book.availableCopies || 1) - 1 });
      }
      res.status(201).json(loan);
    } catch (error) { next(error); }
  });

  app.put("/api/library/loans/:id/return", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const loan = await storage.getLibraryLoan(parseInt(req.params.id));
      if (!loan) return res.status(404).json({ message: "Loan not found" });
      const updated = await storage.updateLibraryLoan(loan.id, { status: "returned", returnedAt: new Date() });
      // Increment available copies
      const book = await storage.getLibraryBook(loan.bookId);
      if (book) {
        await storage.updateLibraryBook(loan.bookId, { availableCopies: (book.availableCopies || 0) + 1 });
      }
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.put("/api/library/loans/:id/lost", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const loan = await storage.getLibraryLoan(parseInt(req.params.id));
      if (!loan) return res.status(404).json({ message: "Loan not found" });
      const updated = await storage.updateLibraryLoan(loan.id, { status: "lost" });
      // Decrement total copies
      const book = await storage.getLibraryBook(loan.bookId);
      if (book) {
        await storage.updateLibraryBook(loan.bookId, { totalCopies: Math.max(0, (book.totalCopies || 1) - 1) });
      }
      res.json(updated);
    } catch (error) { next(error); }
  });

  // Library - Fines
  app.get("/api/library/fines", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const status = req.query.status as string | undefined;
      const fines = await storage.getLibraryFines(schoolId, status);
      res.json(fines);
    } catch (error) { next(error); }
  });

  app.post("/api/library/fines", requireAuth, requireRole("school_admin", "teacher"), async (req, res, next) => {
    try {
      const data = insertLibraryFineSchema.parse(req.body);
      const fine = await storage.createLibraryFine(data);
      res.status(201).json(fine);
    } catch (error) { next(error); }
  });

  app.put("/api/library/fines/:id", requireAuth, requireRole("school_admin"), async (req, res, next) => {
    try {
      const updated = await storage.updateLibraryFine(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Fine not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  // Library - Reservations
  app.get("/api/library/reservations", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const status = req.query.status as string | undefined;
      const reservations = await storage.getLibraryReservations(schoolId, status);
      res.json(reservations);
    } catch (error) { next(error); }
  });

  app.post("/api/library/reservations", requireAuth, async (req, res, next) => {
    try {
      const data = insertLibraryReservationSchema.parse(req.body);
      const existing = await storage.getLibraryReservationsForBook(data.bookId, "pending");
      const alreadyReserved = existing.find(r => r.reserverId === data.reserverId && r.reserverType === data.reserverType);
      if (alreadyReserved) {
        return res.status(400).json({ message: "You already have a pending reservation for this book" });
      }
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const reservation = await storage.createLibraryReservation({ ...data, expiresAt });
      res.status(201).json(reservation);
    } catch (error) { next(error); }
  });

  app.put("/api/library/reservations/:id", requireAuth, async (req, res, next) => {
    try {
      const updated = await storage.updateLibraryReservation(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Reservation not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.get("/api/library/books/:bookId/reservations", requireAuth, async (req, res, next) => {
    try {
      const bookId = parseInt(req.params.bookId);
      const status = req.query.status as string | undefined;
      const reservations = await storage.getLibraryReservationsForBook(bookId, status);
      res.json(reservations);
    } catch (error) { next(error); }
  });

  // Library - Cover image upload
  const coverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  app.post("/api/library/books/:bookId/cover", requireAuth, requireRole("school_admin", "teacher"), coverUpload.single("cover"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No image file uploaded" });
      const bookId = parseInt(req.params.bookId);
      const book = await storage.getLibraryBook(bookId);
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
  app.get("/api/library/policy", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const policy = await storage.getLibraryPolicy(schoolId);
      res.json(policy || {
        bookOverdueSmsAlert: true,
        maxBooksStudent: 1,
        maxBooksTeacher: 500,
        overdueChargePerDay: "0.50",
        defaultBorrowDays: 1,
        smsAlertWindowDays: 1,
      });
    } catch (error) { next(error); }
  });

  app.post("/api/library/policy", requireAuth, requireRole("school_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const policy = await storage.upsertLibraryPolicy({ ...req.body, schoolId });
      res.json(policy);
    } catch (error) { next(error); }
  });

  // Library - Book import from Excel
  const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  app.post("/api/library/books/import", requireAuth, requireRole("school_admin", "teacher"), importUpload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const XLSX = await import("xlsx");
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, any>[];

      const subjects = await storage.getSubjects(schoolId);
      const existingBooks = await storage.getLibraryBooks(schoolId);
      let imported = 0;
      let updated = 0;
      let skipped = 0;

      for (const row of rows) {
        const title = (row["Title"] || row["title"] || "").toString().trim();
        if (!title) { skipped++; continue; }

        const isbn = (row["ISBN"] || row["isbn"] || "").toString().trim();
        const author = (row["Author"] || row["author"] || "").toString().trim();
        const publisher = (row["Publisher"] || row["publisher"] || "").toString().trim();
        const shelf = (row["Shelf"] || row["shelf"] || row["Shelf Location"] || "").toString().trim();
        const subjectName = (row["Subject"] || row["subject"] || "").toString().trim();
        const totalRaw = parseInt(row["Total"] || row["total"] || "1");
        const total = isNaN(totalRaw) || totalRaw < 1 ? 1 : totalRaw;

        let subjectId: number | undefined;
        if (subjectName) {
          const match = subjects.find(s => s.name.toLowerCase() === subjectName.toLowerCase());
          subjectId = match?.id;
        }

        const existingBook = existingBooks.find(b =>
          b.title.toLowerCase().trim() === title.toLowerCase() &&
          (isbn ? b.isbn === isbn : true)
        );

        if (existingBook) {
          await storage.updateLibraryBook(existingBook.id, {
            isbn: isbn || existingBook.isbn,
            author: author || existingBook.author,
            publisher: publisher || existingBook.publisher,
            shelfLocation: shelf || existingBook.shelfLocation,
            subjectId: subjectId || existingBook.subjectId,
            totalCopies: total,
            availableCopies: total,
            borrowedCopies: 0,
            damagedCopies: 0,
            lostStolenCopies: 0,
          });
          updated++;
        } else {
          await storage.createLibraryBook({
            schoolId,
            title,
            isbn: isbn || undefined,
            author: author || undefined,
            publisher: publisher || undefined,
            shelfLocation: shelf || undefined,
            subjectId: subjectId || undefined,
            totalCopies: total,
            availableCopies: total,
            borrowedCopies: 0,
            damagedCopies: 0,
            lostStolenCopies: 0,
          } as any);
          imported++;
        }
      }

      res.json({ imported, updated, skipped, total: rows.length });
    } catch (error) { next(error); }
  });

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
  app.get("/api/staff-attendance", requireAuth, async (req, res, next) => {
    try {
      const user = req.user as User;
      const schoolId = req.query.schoolId ? parseInt(req.query.schoolId as string) : user.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School ID required" });

      const filters: any = {};
      if (req.query.staffId) filters.staffId = parseInt(req.query.staffId as string);
      if (req.query.date) filters.date = req.query.date as string;
      if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom as string;
      if (req.query.dateTo) filters.dateTo = req.query.dateTo as string;
      if (req.query.status) filters.status = req.query.status as string;

      let logs = await storage.getStaffAttendanceLogs(schoolId, filters);

      if (user.role !== "org_admin" && user.role !== "school_admin") {
        logs = logs.filter(l => l.userId === user.id);
      }

      res.json(logs);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff-attendance/today", requireAuth, async (req, res, next) => {
    try {
      const user = req.user as User;
      const today = new Date().toISOString().split("T")[0];
      const log = await storage.getStaffAttendanceLogByUserAndDate(user.id, today);
      res.json(log || null);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/staff-attendance/clock-in", requireAuth, async (req, res, next) => {
    try {
      const user = req.user as User;
      if (!user.schoolId) return res.status(400).json({ message: "No school assigned" });

      const today = new Date().toISOString().split("T")[0];
      const existing = await storage.getStaffAttendanceLogByUserAndDate(user.id, today);
      if (existing) return res.status(400).json({ message: "Already clocked in today" });

      const { latitude, longitude } = req.body;

      const [school] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, user.schoolId));
      if (school?.latitude && school?.longitude && latitude && longitude) {
        const distance = getDistanceMeters(
          parseFloat(latitude), parseFloat(longitude),
          parseFloat(school.latitude), parseFloat(school.longitude)
        );
        if (distance > 100) {
          return res.status(400).json({ message: `You are ${Math.round(distance)}m away from school. You must be within 100m to clock in.` });
        }
      }

      const staffMembers = await storage.getStaff(user.schoolId);
      const staffRecord = staffMembers.find(s => s.userId === user.id);
      if (!staffRecord) return res.status(400).json({ message: "Staff record not found" });

      const now = new Date();
      const day = now.getDay();
      const isWeekend = day === 0 || day === 6;
      const startHour = isWeekend ? 8 : 7;
      const startMinute = isWeekend ? 0 : 20;
      const startTime = new Date(now);
      startTime.setHours(startHour, startMinute, 0, 0);
      const status = now > startTime ? "late" : "on_time";

      const log = await storage.createStaffAttendanceLog({
        schoolId: user.schoolId,
        staffId: staffRecord.id,
        userId: user.id,
        date: today,
        clockIn: now,
        status,
        clockInLatitude: latitude || null,
        clockInLongitude: longitude || null,
      });

      res.status(201).json(log);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/staff-attendance/clock-out", requireAuth, async (req, res, next) => {
    try {
      const user = req.user as User;
      const today = new Date().toISOString().split("T")[0];
      const existing = await storage.getStaffAttendanceLogByUserAndDate(user.id, today);
      if (!existing) return res.status(400).json({ message: "You haven't clocked in today" });
      if (existing.clockOut) return res.status(400).json({ message: "Already clocked out today" });

      const { latitude, longitude } = req.body;
      const now = new Date();

      const updated = await storage.updateStaffAttendanceLog(existing.id, {
        clockOut: now,
        clockOutLatitude: latitude || null,
        clockOutLongitude: longitude || null,
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/staff-attendance/grid", requireAuth, async (req, res, next) => {
    try {
      const user = req.user as User;
      const schoolId = user.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School ID required" });

      const dateFrom = (req.query.dateFrom as string) || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
      const dateTo = (req.query.dateTo as string) || new Date().toISOString().split("T")[0];

      const logs = await storage.getStaffAttendanceLogs(schoolId, { dateFrom, dateTo });
      const staffMembers = await storage.getStaff(schoolId);

      const dates: string[] = [];
      const start = new Date(dateFrom + "T00:00:00");
      const end = new Date(dateTo + "T00:00:00");
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().split("T")[0]);
      }

      const staffGrid = staffMembers.map(s => {
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
      if (isNewlyPublished) {
        const channels: string[] = updated.channels || [];
        const shouldSendInApp = channels.includes("in_app") || channels.length === 0;
        if (shouldSendInApp) {
          await createBroadcastNotifications({
            schoolId: updated.schoolId!,
            targetAudience: updated.targetAudience || "all",
            title: updated.title,
            message: updated.content,
            channel: "newsletter",
            actorUserId: currentUser.id,
            link: `/newsletters`,
          });
        }

        if (channels.includes("email")) {
          try {
            const schoolId = updated.schoolId!;
            const audience = updated.targetAudience || "all";
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
              communicationService.sendBulkEmail(allRecipients, updated.title, updated.content, {
                schoolId,
                recipientType: "staff",
                sentBy: currentUser.id,
                category: "newsletter",
              }).catch(err => console.error("[Newsletter] Email send error:", err));
            }
          } catch (err) {
            console.error("[Newsletter] Failed to send emails:", err);
          }
        }

        if (channels.includes("sms")) {
          try {
            const schoolId = updated.schoolId!;
            const audience = updated.targetAudience || "all";
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

            const plainText = updated.content.replace(/<[^>]*>/g, '');
            if (allRecipients.length > 0) {
              communicationService.sendBulkSms(allRecipients, plainText.length > 160 ? plainText.substring(0, 157) + "..." : plainText, {
                schoolId,
                recipientType: "staff",
                sentBy: currentUser.id,
                category: "newsletter",
              }).catch(err => console.error("[Newsletter] SMS send error:", err));
            }
          } catch (err) {
            console.error("[Newsletter] Failed to send SMS:", err);
          }
        }
      }

      res.json(updated);
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

  const SCHOOL_ASSIGNABLE_ACCESS_GROUP_NAMES = new Set([
    "Teacher",
    "Assistant Teacher",
    "Quality Control Officer",
    "Librarian",
    "Accountant",
  ]);

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
    return groups.filter(group => SCHOOL_ASSIGNABLE_ACCESS_GROUP_NAMES.has(group.name));
  }

  async function getAssignableAccessGroupForUser(currentUser: User, accessGroupId: number) {
    const group = await storage.getAccessGroup(accessGroupId);
    if (!group) return { allowed: false as const, error: 'Access group not found' };
    if (currentUser.role === 'org_admin') return { allowed: true as const, group };
    if (!SCHOOL_ASSIGNABLE_ACCESS_GROUP_NAMES.has(group.name)) {
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

  const sendNotificationSchema = z.object({
    channel: z.enum(["email", "sms", "in_app"]).optional(),
    channels: z.array(z.enum(["email", "sms", "in_app"])).optional(),
    recipientType: z.enum(["staff", "student", "parent"]),
    recipientIds: z.array(z.number()),
    subject: z.string().optional(),
    message: z.string(),
    schoolId: z.number().optional(),
  });

  app.post("/api/communication/send", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const data = sendNotificationSchema.parse(req.body);
      
      // Support both single channel (legacy) and multiple channels
      const channelsToUse = data.channels || (data.channel ? [data.channel] : []);
      
      if (channelsToUse.length === 0) {
        return res.status(400).json({ message: "No channels specified" });
      }
      
      // Use provided schoolId (from frontend context) or fall back to user's schoolId
      const targetSchoolId = data.schoolId || currentUser.schoolId || 0;
      
      let recipients: Array<{ id: number; email?: string | null; phone?: string | null; name: string }> = [];
      
      if (data.recipientType === "staff") {
        const staffList = await storage.getStaffBySchool(targetSchoolId);
        recipients = staffList
          .filter(s => data.recipientIds.includes(s.id))
          .map(s => ({ id: s.id, email: s.email, phone: s.phone, name: `${s.firstName} ${s.lastName}` }));
      } else if (data.recipientType === "student") {
        const studentList = await storage.getStudentsBySchool(targetSchoolId);
        recipients = studentList
          .filter(s => data.recipientIds.includes(s.id))
          .map(s => ({ id: s.id, email: s.email, phone: s.phone, name: `${s.firstName} ${s.lastName}` }));
      } else if (data.recipientType === "parent") {
        const parentList = await storage.getParentsBySchool(targetSchoolId);
        recipients = parentList
          .filter(p => data.recipientIds.includes(p.id))
          .map(p => ({ id: p.id, email: p.email, phone: p.phone, name: `${p.firstName} ${p.lastName}` }));
      }

      if (recipients.length === 0) {
        return res.status(400).json({ message: "No valid recipients found" });
      }

      let totalSent = 0;
      let totalFailed = 0;
      const allErrors: string[] = [];

      for (const channel of channelsToUse) {
        if (channel === "email") {
          const emailRecipients = recipients.filter(r => r.email).map(r => ({ email: r.email!, id: r.id, name: r.name }));
          if (emailRecipients.length > 0) {
            const result = await communicationService.sendBulkEmail(emailRecipients, data.subject || "Notification", data.message, {
              schoolId: currentUser.schoolId || undefined,
              recipientType: data.recipientType,
              sentBy: currentUser.id,
              category: "notices",
            });
            totalSent += result.sent;
            totalFailed += result.failed;
            if (result.errors) allErrors.push(...result.errors);
          }
        } else if (channel === "sms") {
          const smsRecipients = recipients.filter(r => r.phone).map(r => ({ phone: r.phone!, id: r.id, name: r.name }));
          if (smsRecipients.length > 0) {
            const result = await communicationService.sendBulkSms(smsRecipients, data.message, {
              schoolId: currentUser.schoolId || undefined,
              recipientType: data.recipientType,
              sentBy: currentUser.id,
              category: "notices",
            });
            totalSent += result.sent;
            totalFailed += result.failed;
            if (result.errors) allErrors.push(...result.errors);
          }
        } else if (channel === "in_app") {
          const { createInAppNotifications } = await import("./communication");
          await createInAppNotifications({
            recipientType: data.recipientType,
            recipientIds: data.recipientIds,
            title: data.subject || "Notification",
            message: data.message,
            channel: "in_app",
            schoolId: targetSchoolId || undefined,
            actorUserId: currentUser.id,
          });
          totalSent += recipients.length;
        }
      }

      res.json({ success: true, sent: totalSent, failed: totalFailed, errors: allErrors });
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
      const types = await storage.getAssessmentTypes();
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
      const examList = await storage.getExams();
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
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      
      if (!examData.schoolId && schoolId) {
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
      const dateFrom = req.query.dateFrom as string || null;
      const dateTo = req.query.dateTo as string || null;
      const termFilter = req.query.termFilter as string || null;

      if (!classId || !subjectId) {
        return res.status(400).json({ message: "classId and subjectId are required" });
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

      const allAssessments = await storage.getAssessmentsByClass(classId);
      let filtered = allAssessments.filter(a => a.subjectId === subjectId && a.schoolId === schoolId);

      if (dateFrom) {
        filtered = filtered.filter(a => a.assessmentDate && a.assessmentDate >= dateFrom);
      }
      if (dateTo) {
        filtered = filtered.filter(a => a.assessmentDate && a.assessmentDate <= dateTo);
      }

      if (termFilter && termFilter !== "none" && school) {
        const termDateRanges = getTermDateRanges(school);
        const range = termDateRanges[termFilter];
        if (range && range.start && range.end) {
          filtered = filtered.filter(a => {
            if (!a.assessmentDate) return false;
            return a.assessmentDate >= range.start && a.assessmentDate <= range.end;
          });
        }
      }

      filtered.sort((a, b) => (a.assessmentDate || "").localeCompare(b.assessmentDate || ""));

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

      const studentsInClass = await storage.getStudentsByClass(classId);
      const studentSubjectRows = await db.select().from(studentSubjectsSchema).where(
        eq(studentSubjectsSchema.subjectId, subjectId)
      );
      const enrolledStudentIdsForSubject = new Set(studentSubjectRows.map(r => r.studentId));
      const classStudentIds = new Set(studentsInClass.filter(s => s.schoolId === schoolId).map(s => s.id));
      const students = (enrolledStudentIdsForSubject.size > 0
        ? studentsInClass.filter(s => classStudentIds.has(s.id) && enrolledStudentIdsForSubject.has(s.id))
        : studentsInClass.filter(s => s.schoolId === schoolId)
      ).sort((a, b) => `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`));

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
        dateFrom,
        dateTo,
        termFilter,
        groups: Object.values(grouped),
        students: students.map(s => ({
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

      const comments = await storage.getAssessmentComments(schoolId, classId, subjectId);

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
        const classInfo = await ensureClassInSchool(Number(cid), schoolId, res);
        if (!classInfo) return;

        for (const sid of subjectIds) {
          const subjectInfo = await ensureSubjectInSchool(Number(sid), schoolId, res);
          if (!subjectInfo) return;

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
        const cls = await ensureClassInSchool(Number(cid), schoolId, res);
        if (!cls) return;

        for (const sid of subjectIds) {
          const subject = await ensureSubjectInSchool(Number(sid), schoolId, res);
          if (!subject) return;

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
          const classInfo = await ensureClassInSchool(Number(pair.classId), schoolId, res);
          if (!classInfo) return;

          const subjectInfo = await ensureSubjectInSchool(Number(pair.subjectId), schoolId, res);
          if (!subjectInfo) return;

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
      const search = req.query.search as string | undefined;

      if (classId) {
        const classInfo = await ensureClassInSchool(classId, schoolId, res);
        if (!classInfo) return;
      }
      if (subjectId) {
        const subjectInfo = await ensureSubjectInSchool(subjectId, schoolId, res);
        if (!subjectInfo) return;
      }

      let assessmentList;
      if (classId) {
        assessmentList = await storage.getAssessmentsByClass(classId);
      } else {
        assessmentList = await storage.getAllAssessments();
      }

      assessmentList = assessmentList.filter((a) => a.schoolId === schoolId);

      if (subjectId) {
        assessmentList = assessmentList.filter((a) => a.subjectId === subjectId);
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

      const assessmentWithName = {
        ...assessmentData,
        schoolId,
        classId: Number(assessmentData.classId),
        subjectId: Number(assessmentData.subjectId),
        assessmentTypeId: assessmentData.assessmentTypeId ? Number(assessmentData.assessmentTypeId) : null,
        examId: assessmentData.examId ? Number(assessmentData.examId) : null,
        name: assessmentData.name || assessmentData.topic,
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

      const { papers, schoolId: _ignoredSchoolId, ...assessmentData } = req.body;

      if (papers !== undefined && (!Array.isArray(papers) || papers.length < 1)) {
        return res.status(400).json({ message: "At least one paper is required" });
      }

      if (assessmentData.topic && !assessmentData.name) {
        assessmentData.name = assessmentData.topic;
      }

      const validatedRefs = await validateAssessmentPayloadForSchool(scoped.schoolId, assessmentData, res, scoped.assessment);
      if (!validatedRefs) return;

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

      // Get assessment papers
      const papers = await storage.getAssessmentPapers(assessmentId);

      // Get students in the class
      const students = await storage.getStudentsByClass(assessment.classId);

      // Get all marks for this assessment
      const marks = await storage.getAssessmentMarks(assessmentId);
      
      // Get paper marks for each assessment mark
      const marksWithPapers = await Promise.all(marks.map(async (mark) => {
        const paperMarks = await storage.getMarkPapers(mark.id);
        return { ...mark, paperMarks };
      }));
      
      // Build a map of studentId -> mark data
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
      const grades = getApplicableGradesForContext(allGrades, { profileKey, classId: assessment.classId });

      // Get comments for auto-comment lookup
      const comments = await storage.getAssessmentComments(assessment.schoolId || undefined, assessment.classId, assessment.subjectId);
      
      res.json({
        assessment,
        papers,
        students,
        marksByStudent,
        grades,
        comments,
        gradeProfileKey: profileKey,
      });
    } catch (error) {
      next(error);
    }
  });

  // Helper function to calculate grade from percentage
  function calculateGrade(percentage: number, grades: any[], subjectType?: string | null): { gradeId: number | null; gradeName: string } {
    const orderedGrades = [...grades].sort((a, b) => Number(b.upperLimit) - Number(a.upperLimit));
    const compatibleTyped = orderedGrades.filter((grade) => grade.gradeType && isSubjectTypeCompatibleWithGradeType(subjectType, grade.gradeType));
    const genericGrades = orderedGrades.filter((grade) => !grade.gradeType);
    const candidateSets = compatibleTyped.length > 0
      ? [compatibleTyped, genericGrades, orderedGrades]
      : [genericGrades, orderedGrades];

    for (const set of candidateSets) {
      for (const grade of set) {
        const lower = Number(grade.lowerLimit);
        const upper = Number(grade.upperLimit);
        if (Number.isNaN(lower) || Number.isNaN(upper)) continue;
        if (percentage >= lower && percentage <= upper) {
          return { gradeId: grade.id, gradeName: grade.gradeName };
        }
      }
    }

    return { gradeId: null, gradeName: "" };
  }

  // Save/update marks for a student
  app.post("/api/marks-entry", requireAuth, async (req, res, next) => {
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, Number(req.body.assessmentId));
      if (!scoped) return;

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
      if (student.classId !== classId) {
        return res.status(400).json({ message: "Student does not belong to the assessment class" });
      }

      // Get assessment papers to calculate weighted percentage
      const papers = await storage.getAssessmentPapers(assessment.id);
      
      // Calculate weighted percentage
      let totalWeightedScore = 0;
      let totalWeight = 0;
      
      for (const pm of paperMarks) {
        const paper = papers.find(p => p.id === pm.assessmentPaperId);
        if (paper && pm.markObtained !== null && pm.markObtained !== "") {
          const markPct = (parseFloat(pm.markObtained) / paper.paperMarks) * 100;
          const weight = parseFloat(paper.paperWeightPct as string);
          totalWeightedScore += (markPct * weight) / 100;
          totalWeight += weight;
        }
      }
      
      const percentage = totalWeight > 0 ? Math.round(totalWeightedScore) : null;
      
      // Get grade from percentage
      const allGrades = await storage.getGradesBySchool(schoolId);
      const { profileKey } = await resolveGradeProfileContext({
        schoolId,
        classId,
        subjectId,
        studentId: Number(studentId),
      });
      const grades = getApplicableGradesForContext(allGrades, { profileKey, classId });
      const subject = await storage.getSubject(subjectId);
      const { gradeId, gradeName } = percentage !== null ? calculateGrade(percentage, grades, subject?.subjectType) : { gradeId: null, gradeName: "" };
      
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
          attStatus: attStatus || "present",
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
          attStatus: attStatus || "present",
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
      await storage.setMarkPapers(mark.id, paperMarks);
      
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
      
      const exams = await storage.getExamsBySchool(schoolId);
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
      const allAssessments = await storage.getAssessmentsByExam(examId);
      
      const subjectIds = [...new Set(allAssessments.map(a => a.subjectId))];
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const subjects = subjectsData.filter(Boolean);
      
      const grades = await storage.getGradesBySchool(schoolId);
      
      const assessmentIds = allAssessments.map(a => a.id);
      const allMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      
      const marksMap = new Map<string, typeof allMarks[0]>();
      for (const mark of allMarks) {
        const key = `${mark.studentId}-${mark.assessmentId}`;
        marksMap.set(key, mark);
      }
      
      const teacherMap = new Map<string, string>();
      try {
        const allStaffSubjects = await db.select({
          staffId: staffSubjects.staffId,
          subjectId: staffSubjects.subjectId,
          classId: staffSubjects.classId,
        }).from(staffSubjects).where(
          eq(staffSubjects.classId, classId)
        );
        for (const ss of allStaffSubjects) {
          const staffMember = await storage.getStaff(ss.staffId);
          if (staffMember) {
            const user = staffMember.userId ? await storage.getUser(staffMember.userId) : null;
            const name = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : `Staff #${ss.staffId}`;
            teacherMap.set(`${ss.subjectId}-${ss.classId}`, name);
          }
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
          
          const pctRaw = mark.percentage ? parseFloat(mark.percentage) : null;
          if (pctRaw === null) continue;
          
          let gradeName = "";
          let gradePoints = 0;
          if (mark.gradeId) {
            const grade = grades.find(g => g.id === mark.gradeId);
            if (grade) {
              gradeName = grade.gradeName;
              gradePoints = grade.gradePoints ? parseFloat(grade.gradePoints as string) : 0;
            }
          }
          
          const comment = mark.customCommentText || mark.autoCommentSnapshot || "";
          
          if (!bySubject[subject.id]) bySubject[subject.id] = {};
          bySubject[subject.id][student.id] = pctRaw;
          
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
          subjectId: number;
          subjectName: string;
          mark: string;
          dev: string;
          classAvg: string;
          grade: string;
          rank: string;
          comment: string;
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
          const pct = row.percentage ?? 0;
          sumMarks += pct;
          nSubjects++;
          
          if (pct >= 60) passed++;
          
          points += Number.isFinite(row.gradePoints) ? row.gradePoints : 0;
          
          const avgVal = subjectAvg[row.subjectId];
          const classAvgStr = avgVal !== undefined
            ? parseFloat(avgVal.toFixed(1)).toString()
            : '';
          
          const rankStr = subjectRank[row.subjectId]?.[student.id] || '';
          
          const markStr = parseFloat(pct.toFixed(1)).toString();
          
          const prevKey = `${student.id}-${row.subjectId}`;
          const prevPct = prevPctMap[prevKey];
          let dev: string;
          if (prevPct === undefined) {
            dev = '+NEW';
          } else {
            const diff = Math.round(pct - prevPct);
            if (diff > 0) dev = `+${diff}`;
            else if (diff < 0) dev = `${diff}`;
            else dev = '0';
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
          
          chartSubjectLabels.push(row.subjectName);
          chartStudentMarks.push(parseFloat(pct.toFixed(1)));
          chartClassAvgs.push(avgVal !== undefined ? parseFloat(avgVal.toFixed(1)) : null);
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
        const studentInfo = students.find((student) => student.id === rc.student.id);
        let streamId = studentInfo?.streamId ?? classInfo?.streamId ?? null;
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
      
      const allAssessments = await storage.getAssessmentsByExam(examId);
      const grades = await storage.getGradesBySchool(schoolId);
      
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
          percentage = mark.percentage ? parseFloat(mark.percentage) : null;
          
          if (mark.gradeId) {
            const grade = grades.find(g => g.id === mark.gradeId);
            if (grade) {
              gradeName = grade.gradeName;
              gradePoints = grade.gradePoints ? parseFloat(grade.gradePoints as string) : 0;
            }
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
    const allAssessments = await storage.getAssessmentsByExam(examId);

    const subjectIds = [...new Set(allAssessments.map(a => a.subjectId))];
    const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
    const subjectsList = subjectsData.filter(Boolean);

    const grades = await storage.getGradesBySchool(schoolId);
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
    try {
      const allStaffSubjectsList = await db.select({
        staffId: staffSubjects.staffId,
        subjectId: staffSubjects.subjectId,
        classId: staffSubjects.classId,
      }).from(staffSubjects).where(eq(staffSubjects.classId, classInfo.id));
      for (const ss of allStaffSubjectsList) {
        const staffMember = await storage.getStaff(ss.staffId);
        if (staffMember) {
          const user = staffMember.userId ? await storage.getUser(staffMember.userId) : null;
          const tName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : `Staff #${ss.staffId}`;
          teacherMap.set(`${ss.subjectId}-${ss.classId}`, tName);
        }
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

        const pctRaw = mark.percentage ? parseFloat(mark.percentage as string) : null;
        if (pctRaw === null) continue;

        let gradeName = '';
        let gradePoints = 0;
        if (mark.gradeId) {
          const grade = grades.find(g => g.id === mark.gradeId);
          if (grade) {
            gradeName = grade.gradeName;
            gradePoints = grade.gradePoints ? parseFloat(grade.gradePoints as string) : 0;
          }
        }

        const comment = mark.customCommentText || mark.autoCommentSnapshot || '';

        if (!bySubject[subject.id]) bySubject[subject.id] = {};
        bySubject[subject.id][stu.id] = pctRaw;

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
      const pct = row.percentage ?? 0;
      sumMarks += pct;
      nSubjects++;
      if (pct >= 60) passed++;
      points += Number.isFinite(row.gradePoints) ? row.gradePoints : 0;

      const avgVal = subjectAvg[row.subjectId];
      const classAvgStr = avgVal !== undefined ? parseFloat(avgVal.toFixed(1)).toString() : '';
      const rankStr = subjectRank[row.subjectId]?.[studentId] || '';
      const markStr = parseFloat(pct.toFixed(1)).toString();
      const teacher = teacherMap.get(`${row.subjectId}-${classInfo.id}`) || '';

      const prevVal = pdfPrevPctMap[`${studentId}-${row.subjectId}`];
      let dev: string;
      if (prevVal === undefined) {
        dev = '+NEW';
      } else {
        const diff = Math.round(pct - prevVal);
        if (diff > 0) dev = `+${diff}`;
        else if (diff < 0) dev = `${diff}`;
        else dev = '0';
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
        streamName: studentStream?.name || classStream?.name,
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
    const allAssessments = await storage.getAssessmentsByExam(examId);
    const grades = await storage.getGradesBySchool(schoolId);
    const exam = await storage.getExam(examId);
    const termId = exam?.termId;
    const termName = termId ? `Term ${termId}` : '';

    const student = await storage.getStudent(studentId);
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

    const lines: Array<{ subject: string; pct: string; grade: string }> = [];
    let totalPct = 0;
    let subjectCount = 0;
    let totalGradePoints = 0;

    for (const assessment of allAssessments) {
      const subject = await storage.getSubject(assessment.subjectId);
      if (!subject) continue;

      const mark = await storage.getAssessmentMarkByStudentAssessment(studentId, assessment.id);
      if (!mark || mark.percentage === null || mark.percentage === undefined) continue;

      const pctNum = parseFloat(mark.percentage as string);
      if (isNaN(pctNum)) continue;

      const pctStr = pctNum % 1 === 0 ? String(Math.round(pctNum)) : pctNum.toFixed(1);
      let gradeName = '';
      let gradePoints = 0;

      if (mark.gradeId) {
        const grade = grades.find(g => g.id === mark.gradeId);
        if (grade) {
          gradeName = grade.gradeName;
          gradePoints = grade.gradePoints ? parseFloat(grade.gradePoints as string) : 0;
        }
      }

      lines.push({ subject: subject.name, pct: pctStr, grade: gradeName });
      totalPct += pctNum;
      totalGradePoints += gradePoints;
      subjectCount++;
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
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      
      const school = await storage.getSchool(schoolId);
      const classInfo = await storage.getClass(classId);
      const students = await storage.getStudentsByClass(classId);
      const exam = await storage.getExam(examId);
      const userId = (req.user as any).id;
      const schoolName = school?.name || 'School';
      const className = classInfo?.className || `Class ${classId}`;
      const examName = exam?.examName || `Exam ${examId}`;
      
      let sent = 0, skipped = 0, noParent = 0, noResults = 0, smsCount = 0, emailCount = 0;
      const errors: string[] = [];
      
      for (const student of students) {
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
      }
      
      res.json({ 
        success: true, 
        message: `Sent report cards for ${sent} student(s). Skipped ${skipped}. No parent: ${noParent}. No results: ${noResults}. [SMS: ${smsCount}, Email: ${emailCount}]`,
        details: { sent, skipped, noParent, noResults, smsCount, emailCount, errors: errors.slice(0, 10) },
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
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      
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

  // Get stream-level stats for an exam (progress, avg for each stream)
  app.get("/api/report-hub/stream-stats/:examId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const allStreams = await storage.getAllStreams();
      const allClasses = await storage.getAllClasses();
      const schoolClasses = allClasses.filter(c => c.schoolId === schoolId);

      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const assessmentIds = allAssessmentsRaw.map(a => a.id);

      let allMarks: any[] = [];
      if (assessmentIds.length > 0) {
        allMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      }

      const streamStats = await Promise.all(allStreams.map(async (stream) => {
        const streamClasses = schoolClasses.filter(c => c.streamId === stream.id);
        const classIds = streamClasses.map(c => c.id);

        if (classIds.length === 0) {
          return { streamId: stream.id, streamName: stream.name, classes: [], progressPct: null, avgPct: null, classCount: 0, studentCount: 0 };
        }

        let totalStudents = 0;
        const classesForStream: { id: number; name: string }[] = [];
        for (const cls of streamClasses) {
          classesForStream.push({ id: cls.id, name: cls.className });
          const classStudents = await storage.getStudentsByClass(cls.id);
          totalStudents += classStudents.length;
        }

        const streamMarks = allMarks.filter(m => classIds.includes(m.classId));
        const studentsWithMarks = new Set(
          streamMarks
            .filter(m => m.percentage !== null && m.percentage !== undefined)
            .map(m => m.studentId)
        );
        const progressPct = totalStudents > 0 ? Math.round((studentsWithMarks.size / totalStudents) * 100) : null;

        const marksWithPct = streamMarks.filter(m => m.percentage !== null && m.percentage !== undefined);
        const avgPct = marksWithPct.length > 0
          ? Math.round(marksWithPct.reduce((sum, m) => sum + parseFloat(m.percentage), 0) / marksWithPct.length)
          : null;

        return {
          streamId: stream.id,
          streamName: stream.name,
          classes: classesForStream,
          progressPct,
          avgPct,
          classCount: classIds.length,
          studentCount: totalStudents,
        };
      }));

      res.json(streamStats.filter(s => s.classCount > 0));
    } catch (error) {
      next(error);
    }
  });

  // Get class-level subject progress for an exam
  app.get("/api/report-hub/class-progress/:examId/:classId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const classId = parseInt(req.params.classId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const classInfo = await storage.getClass(classId);
      if (!classInfo) return res.status(404).json({ message: "Class not found" });
      if (classInfo.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const students = await storage.getStudentsByClass(classId);
      const totalStudents = students.length;

      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const classAssessments = allAssessmentsRaw.filter(a => a.classId === classId);

      const subjectIds = [...new Set(classAssessments.map(a => a.subjectId))];
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const validSubjects = subjectsData.filter(Boolean);

      const assessmentIds = classAssessments.map(a => a.id);
      let classMarks: any[] = [];
      if (assessmentIds.length > 0) {
        classMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      }

      const subjectProgress = validSubjects.map(subject => {
        if (!subject) return null;
        const subjectMarks = classMarks.filter(m => m.subjectId === subject.id);
        const studentsWithMarks = new Set(
          subjectMarks
            .filter(m => m.percentage !== null && m.percentage !== undefined)
            .map(m => m.studentId)
        );
        const progressPct = totalStudents > 0 ? Math.round((studentsWithMarks.size / totalStudents) * 100) : 0;

        const marksWithPct = subjectMarks.filter(m => m.percentage !== null && m.percentage !== undefined);
        const avgPct = marksWithPct.length > 0
          ? Math.round(marksWithPct.reduce((sum, m) => sum + parseFloat(m.percentage), 0) / marksWithPct.length)
          : null;

        return {
          subjectId: subject.id,
          subjectName: subject.name,
          totalStudents,
          markedCount: studentsWithMarks.size,
          progressPct,
          avgPct,
        };
      }).filter(Boolean);

      res.json({
        classId,
        className: classInfo.className,
        totalStudents,
        subjects: subjectProgress,
      });
    } catch (error) {
      next(error);
    }
  });

  // Missing marks for a class (grouped by subject)
  app.get("/api/report-hub/missing-marks/:examId/:classId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const classId = parseInt(req.params.classId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const classInfo = await storage.getClass(classId);
      if (!classInfo || classInfo.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const students = await storage.getStudentsByClass(classId);
      const totalStudents = students.length;

      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const classAssessments = allAssessmentsRaw.filter(a => a.classId === classId);

      const subjectIds = [...new Set(classAssessments.map(a => a.subjectId))];
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const validSubjects = subjectsData.filter(Boolean);

      const assessmentIds = classAssessments.map(a => a.id);
      let classMarks: any[] = [];
      if (assessmentIds.length > 0) {
        classMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      }

      const missingBySubject = validSubjects.map(subject => {
        if (!subject) return null;
        const subjectMarks = classMarks.filter(m => m.subjectId === subject.id);
        const markedStudentIds = new Set(
          subjectMarks
            .filter(m => m.percentage !== null && m.percentage !== undefined)
            .map(m => m.studentId)
        );

        const missing = students
          .filter(s => !markedStudentIds.has(s.id))
          .map(s => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, admissionNo: s.admissionNo }));

        return {
          subjectId: subject.id,
          subjectName: subject.name,
          totalStudents,
          missingCount: missing.length,
          missingStudents: missing,
        };
      }).filter(Boolean);

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

      const classInfo = await storage.getClass(classId);
      if (!classInfo || classInfo.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const students = await storage.getStudentsByClass(classId);
      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const classAssessments = allAssessmentsRaw.filter(a => a.classId === classId);

      const subjectIds = [...new Set(classAssessments.map(a => a.subjectId))];
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const validSubjects = subjectsData.filter(Boolean);
      const subjectCount = validSubjects.length;

      const assessmentIds = classAssessments.map(a => a.id);
      let classMarks: any[] = [];
      if (assessmentIds.length > 0) {
        classMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      }

      const rows = students.map(student => {
        const studentMarks = classMarks.filter(m => m.studentId === student.id);
        const cells: Record<number, number | null> = {};
        let sum = 0;
        let have = 0;

        for (const subject of validSubjects) {
          if (!subject) continue;
          const mark = studentMarks.find(m => m.subjectId === subject.id);
          const pct = mark?.percentage !== null && mark?.percentage !== undefined ? parseFloat(mark.percentage) : null;
          cells[subject.id] = pct;
          if (pct !== null) {
            sum += pct;
            have++;
          }
        }

        const avg = subjectCount > 0 ? sum / subjectCount : 0;

        return {
          studentName: `${student.firstName} ${student.lastName}`,
          admissionNo: student.admissionNo,
          cells,
          total: Math.round(sum),
          avg: Math.round(avg * 10) / 10,
          subjectsWithMarks: have,
        };
      });

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
        subjects: validSubjects.map(s => ({ id: s!.id, name: s!.name })),
        rows: rankedRows,
        totalStudents: students.length,
      });
    } catch (error) {
      next(error);
    }
  });

  // Class analytics
  app.get("/api/report-hub/class-analytics/:examId/:classId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseInt(req.params.examId);
      const classId = parseInt(req.params.classId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const classInfo = await storage.getClass(classId);
      if (!classInfo || classInfo.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const PASS_MARK = 50;
      const students = await storage.getStudentsByClass(classId);
      const totalStudents = students.length;
      const grades = await storage.getGradesBySchool(schoolId);

      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const classAssessments = allAssessmentsRaw.filter(a => a.classId === classId);

      const subjectIds = [...new Set(classAssessments.map(a => a.subjectId))];
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const validSubjects = subjectsData.filter(Boolean);

      const assessmentIds = classAssessments.map(a => a.id);
      let classMarks: any[] = [];
      if (assessmentIds.length > 0) {
        classMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      }

      const gradeCounts: Record<string, number> = {};
      const subjectStats: Record<number, { sum: number; have: number; pass: number; gradeCounts: Record<string, number> }> = {};

      for (const subject of validSubjects) {
        if (!subject) continue;
        subjectStats[subject.id] = { sum: 0, have: 0, pass: 0, gradeCounts: {} };
      }

      let enteredCells = 0;
      let overallSum = 0;

      for (const mark of classMarks) {
        if (mark.percentage === null || mark.percentage === undefined) continue;
        const pct = parseFloat(mark.percentage);

        enteredCells++;
        overallSum += pct;

        const gradeLabel = mark.gradeId ? (grades.find(g => g.id === mark.gradeId)?.name || "—") : "—";
        gradeCounts[gradeLabel] = (gradeCounts[gradeLabel] || 0) + 1;

        if (subjectStats[mark.subjectId]) {
          subjectStats[mark.subjectId].sum += pct;
          subjectStats[mark.subjectId].have++;
          if (pct >= PASS_MARK) subjectStats[mark.subjectId].pass++;
          subjectStats[mark.subjectId].gradeCounts[gradeLabel] = (subjectStats[mark.subjectId].gradeCounts[gradeLabel] || 0) + 1;
        }
      }

      const expectedCells = totalStudents * validSubjects.length;
      const completion = expectedCells > 0 ? Math.round((enteredCells / expectedCells) * 100) : 0;
      const overallAvg = expectedCells > 0 ? Math.round(overallSum / expectedCells) : 0;

      const subjectSummary = validSubjects.map(subject => {
        if (!subject) return null;
        const stats = subjectStats[subject.id];
        if (!stats) return null;
        const avg = stats.have > 0 ? Math.round(stats.sum / stats.have) : 0;
        const subCompletion = totalStudents > 0 ? Math.round((stats.have / totalStudents) * 100) : 0;
        const passRate = stats.have > 0 ? Math.round((stats.pass / stats.have) * 100) : 0;

        return {
          subjectId: subject.id,
          subjectName: subject.name,
          avg,
          completion: subCompletion,
          passRate,
          gradeCounts: stats.gradeCounts,
        };
      }).filter(Boolean);

      res.json({
        overallAvg,
        completion,
        enteredCells,
        expectedCells,
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

      const allClasses = await storage.getAllClasses();
      const streamClasses = allClasses.filter(c => c.schoolId === schoolId && c.streamId === streamId);
      const classIds = streamClasses.map(c => c.id);
      if (classIds.length === 0) return res.json({ subjects: [], rows: [], totalStudents: 0 });

      let allStudents: any[] = [];
      for (const cls of streamClasses) {
        const classStudents = await storage.getStudentsByClass(cls.id);
        allStudents = allStudents.concat(classStudents);
      }
      if (allStudents.length === 0) return res.json({ subjects: [], rows: [], totalStudents: 0 });

      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const streamAssessments = allAssessmentsRaw.filter(a => classIds.includes(a.classId));

      const assessmentIds = streamAssessments.map(a => a.id);
      let allMarks: any[] = [];
      if (assessmentIds.length > 0) {
        allMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      }

      const subjectFreq: Record<number, number> = {};
      for (const mark of allMarks) {
        if (mark.percentage !== null && mark.percentage !== undefined) {
          subjectFreq[mark.subjectId] = (subjectFreq[mark.subjectId] || 0) + 1;
        }
      }

      const topSubjectIds = Object.entries(subjectFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(e => parseInt(e[0]));

      const topSubjects = await Promise.all(topSubjectIds.map(id => storage.getSubject(id)));

      const perStudent: Record<number, { sum: number; cnt: number; top: Record<number, number | null> }> = {};
      for (const student of allStudents) {
        perStudent[student.id] = { sum: 0, cnt: 0, top: {} };
      }

      for (const mark of allMarks) {
        if (!perStudent[mark.studentId]) continue;
        if (mark.percentage !== null && mark.percentage !== undefined) {
          const pct = parseFloat(mark.percentage);
          perStudent[mark.studentId].sum += pct;
          perStudent[mark.studentId].cnt++;

          if (topSubjectIds.includes(mark.subjectId)) {
            perStudent[mark.studentId].top[mark.subjectId] = pct;
          }
        }
      }

      const ranked = allStudents
        .map(student => {
          const data = perStudent[student.id];
          const avg = data.cnt > 0 ? data.sum / data.cnt : -1;
          return { student, avg, total: data.sum, cnt: data.cnt, top: data.top };
        })
        .filter(r => r.avg >= 0)
        .sort((a, b) => {
          if (b.avg !== a.avg) return b.avg - a.avg;
          return b.total - a.total;
        });

      let strmPos = 0;
      let strmLastAvg: number | null = null;
      const rows = ranked.slice(0, 60).map((r, index) => {
        if (r.avg !== strmLastAvg) {
          strmPos = index + 1;
          strmLastAvg = r.avg;
        }
        return {
          studentName: `${r.student.firstName} ${r.student.lastName}`,
          admissionNo: r.student.admissionNo,
          total: `${Math.round(r.total)}/${r.cnt * 100}`,
          avg: `${Math.round(r.avg)}%`,
          position: `${strmPos}/${ranked.length}`,
          subjectMarks: topSubjectIds.map(sid => {
            const v = r.top[sid];
            return v !== null && v !== undefined ? `${Math.round(v)}%` : "\u2013";
          }),
        };
      });

      res.json({
        subjects: topSubjects.filter(Boolean).map(s => s!.name),
        rows,
        totalStudents: allStudents.length,
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

      const allClasses = await storage.getAllClasses();
      const streamClasses = allClasses.filter(c => c.schoolId === schoolId && c.streamId === streamId);
      const classIds = streamClasses.map(c => c.id);
      if (classIds.length === 0) return res.json({ rows: [] });

      const grades = await storage.getGradesBySchool(schoolId);

      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const streamAssessments = allAssessmentsRaw.filter(a => classIds.includes(a.classId));

      const assessmentIds = streamAssessments.map(a => a.id);
      let allMarks: any[] = [];
      if (assessmentIds.length > 0) {
        allMarks = await storage.getAssessmentMarksByAssessments(assessmentIds);
      }

      const bySubject: Record<number, { sum: number; cnt: number; pass: number; fail: number; gradeCounts: Record<string, number> }> = {};

      for (const mark of allMarks) {
        if (mark.percentage === null || mark.percentage === undefined) continue;
        const pct = parseFloat(mark.percentage);
        const subId = mark.subjectId;

        if (!bySubject[subId]) {
          bySubject[subId] = { sum: 0, cnt: 0, pass: 0, fail: 0, gradeCounts: {} };
        }

        bySubject[subId].sum += pct;
        bySubject[subId].cnt++;
        if (pct >= 50) bySubject[subId].pass++;
        else bySubject[subId].fail++;

        const gradeLabel = mark.gradeId ? (grades.find(g => g.id === mark.gradeId)?.name || "") : "";
        if (gradeLabel) {
          bySubject[subId].gradeCounts[gradeLabel] = (bySubject[subId].gradeCounts[gradeLabel] || 0) + 1;
        }
      }

      const rows = [];
      for (const [subId, stats] of Object.entries(bySubject)) {
        const subject = await storage.getSubject(parseInt(subId));
        if (!subject) continue;

        const avg = stats.cnt > 0 ? Math.round(stats.sum / stats.cnt) : 0;
        const total = stats.pass + stats.fail;
        const passRate = total > 0 ? Math.round((stats.pass / total) * 100) : 0;

        rows.push({
          subjectId: parseInt(subId),
          subjectName: subject.name,
          avg,
          passed: stats.pass,
          failed: stats.fail,
          passRate,
          gradeCounts: stats.gradeCounts,
        });
      }

      rows.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

      res.json({ rows });
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
      const allClassSubjects = await db.select().from(classSubjectsSchema).where(eq(classSubjectsSchema.classId, classId));
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
      const classStudents = allStudents
        .filter(s => s.classId === classId && s.schoolId === schoolId && s.status === "active")
        .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

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

      // Get student's subjects (via student_subjects or class_subjects fallback)
      const studentSubjectRows = await db.select().from(studentSubjectsSchema).where(eq(studentSubjectsSchema.studentId, studentId));
      let subjectIds: number[] = studentSubjectRows.map(ss => ss.subjectId);

      if (subjectIds.length === 0) {
        const classSubjectRows = await db.select().from(classSubjectsSchema).where(eq(classSubjectsSchema.classId, activeClassId));
        subjectIds = classSubjectRows.map(cs => cs.subjectId);
      }

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

  // Student: get my grades/marks
  app.get("/api/me/grades", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (currentUser.role !== "student") return res.status(403).json({ message: "Students only" });
      const allStudents = await storage.getAllStudents();
      const student = allStudents.find(s => s.userId === currentUser.id);
      if (!student) return res.status(404).json({ message: "Student record not found" });
      const marks = await storage.getMarksByStudent(student.id);
      const allAssessments = await storage.getAllAssessments();
      const allSubjects = await storage.getAllSubjects();
      const enrichedMarks = marks.map(mark => {
        const assessment = allAssessments.find(a => a.id === mark.assessmentId);
        const subject = assessment ? allSubjects.find(s => s.id === assessment.subjectId) : null;
        return {
          ...mark,
          assessmentName: assessment?.name || "Unknown",
          assessmentType: assessment?.type || "Unknown",
          subjectName: subject?.name || "Unknown",
          subjectCode: subject?.syllabusCode || null,
          term: assessment?.term || null,
          year: assessment?.year || null,
        };
      });
      res.json(enrichedMarks);
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

  // Parent: get children's grades
  app.get("/api/me/children-grades", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      if (currentUser.role !== "parent") return res.status(403).json({ message: "Parents only" });
      const allParents = await storage.getAllParents();
      const parent = allParents.find(p => p.userId === currentUser.id);
      if (!parent) return res.status(404).json({ message: "Parent record not found" });
      const children = await storage.getStudentsByParent(parent.id);
      const allAssessments = await storage.getAllAssessments();
      const allSubjects = await storage.getAllSubjects();
      const result = await Promise.all(children.map(async child => {
        const marks = await storage.getMarksByStudent(child.id);
        const enrichedMarks = marks.map(mark => {
          const assessment = allAssessments.find(a => a.id === mark.assessmentId);
          const subject = assessment ? allSubjects.find(s => s.id === assessment.subjectId) : null;
          return {
            ...mark,
            assessmentName: assessment?.name || "Unknown",
            assessmentType: assessment?.type || "Unknown",
            subjectName: subject?.name || "Unknown",
            subjectCode: subject?.syllabusCode || null,
            term: assessment?.term || null,
            year: assessment?.year || null,
          };
        });
        return { student: child, marks: enrichedMarks };
      }));
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

      const studentSubjectRows = await db.select().from(studentSubjectsSchema).where(eq(studentSubjectsSchema.studentId, studentId));
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
            const gradeMap = new Map(grades.map(g => [g.id, g]));

            const studentMarks = allMarks.filter(m => m.studentId === studentId);

            let totalPct = 0;
            let subjectCount = 0;
            let subjectsPassed = 0;
            let totalPoints = 0;

            resultsData = classAssessments.map(assessment => {
              const mark = studentMarks.find(m => m.assessmentId === assessment.id);
              const subject = subjectMap.get(assessment.subjectId);
              if (!mark || !subject) return null;

              const pct = mark.percentage ? parseFloat(mark.percentage as string) : null;
              const grade = mark.gradeId ? gradeMap.get(mark.gradeId) : null;
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
                .filter(m => m.assessmentId === assessment.id && m.percentage)
                .map(m => parseFloat(m.percentage as string))
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
                if (m && m.percentage) {
                  st += parseFloat(m.percentage as string);
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
            if (streamInfo && classInfo?.streamId) {
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
                    if (m && m.percentage) {
                      st += parseFloat(m.percentage as string);
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
