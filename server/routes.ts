import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { setupAuth, requireAuth, requirePermission, requireAnyPermission, requireRole } from "./auth";
import { storage, PosSaleProcessingError } from "./storage";
import { compareStudentsByFirstName, sortStudentsByFirstName, studentFirstNameOrder } from "./student-sort";
import { db } from "./db";
import { staffSubjects, users, qcReports, qcRecords, assessmentMarks as assessmentMarksSchema, assessmentComments as assessmentCommentsSchema, assessments as assessmentsSchema, assessmentTypes as assessmentTypesSchema, assessmentPapers as assessmentPapersSchema, assessmentMarkPapers as assessmentMarkPapersSchema, assessmentPublications, assessmentPublicationEvents, classSubjects as classSubjectsSchema, studentSubjects as studentSubjectsSchema, students as studentsTable, staff as staffTable, classes as classesTable, subjects as subjectsTable, libraryLoans as libraryLoansTable, timetableSlots as timetableSlotsTable, staffRoles, organizations, userSchoolAccess, reportComments, communicationJobs, libraryShelves as libraryShelvesTable, classTeacherAssignments as classTeacherAssignmentsTable, userAccessGroups, gradeProfileSettings, ecdAssessmentRecords, ecdAssessmentResponses } from "@shared/schema";
import multer from "multer";
import { parse as csvParse } from "csv-parse/sync";
import { eq, and, or, inArray, sql, like, desc, isNull, count as drizzleCount } from "drizzle-orm";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerCalendarRoutes } from "./calendar-routes";
import { registerTransportRoutes } from "./transport-routes";
import { registerTransportDocumentRoutes } from "./transport-document-routes";
import { registerAssetsInventoryRoutes } from "./assets-inventory-routes";
import { registerHqOperationsRoutes } from "./hq-operations-routes";
import { registerRecruitmentRoutes } from "./recruitment-routes";
import { communicationService, createInAppNotifications } from "./communication";
import { renderAppRoutePdf, reportPdfFilename } from "./pdf-renderer";
import { academicReportDataCacheDirectory, academicReportPdfCacheDirectory, academicReportPreparationDirectory, queueAcademicReportCacheCleanup, readBufferCache, readJsonCache, reportBrandingFingerprint, reportCacheKey, reportCommentsFingerprint, reportGradingConfigurationFingerprint, writeBufferCache, writeJsonCache } from "./academic-report-cache";
import { getProfileAwareGradeCandidates, parseFinitePercentage, resolveGradeForPercentage } from "./grade-resolution";
import { AssessmentPaperReconciliationError, reconcileAssessmentPapersAndMarks } from "./assessment-paper-reconciliation";
import { acquireAssessmentMutationLock } from "./assessment-mutation-lock";
import { ASSESSMENT_CARDINALITY, inferAssessmentTypePolicy, isSinglePerExamAssessmentType, selectCanonicalAssessments } from "./assessment-policy";
import { assessClassSubjectGradeConfiguration, planExactProfileClassAttachment, resolveExpectedGradeProfile, type GradeConfigurationProfileStatus } from "./grading-configuration";
import { calculateConfiguredPositionMap, normalizeGradeStatus, parseGradePoints, resolveExactConfiguredGrade, storedGradeMatchesExactContext, type PositionRankingMode, type RankingCandidate, type RankingSubjectResult } from "./grading-engine";
import { isTemporarilyExcludedFromStrictGrading } from "./grading-exclusions";
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
  insertNewsletterSchema,
  insertHostelSchema, insertHostelRollCallSchema, insertStudentApplicationSchema,
  hostels as hostelsTable,
  insertPermissionSchema, insertAccessGroupSchema,
  type User, type AccessGroup, type Staff, type InsertStudent, type InsertActivityLog, type InsertStaffAttendanceLog
} from "@shared/schema";
import { ECD_DOMAIN_SEEDS, GRADE_PROFILE_KEYS, filterItemsByGradeProfileKey, getGradingProfilesForSchool, getGradeProfileLabel, getGradeTypeOptionsForProfile, getStrictGradeProfileKeys, getSubjectTypeOptionsForSchool, gradeProfileMatchesStrict, isEcdStream, isSubjectTypeCompatibleWithGradeType, normalizeExamBoard, normalizeSchoolType, profileMatchesStreamName, resolveAcademicPositionRankingMode, resolveOperationalGradeProfile, resolveSecondaryGroupingFromStream, subjectMatchesGradeProfile, type AcademicPositionRankingMode, type GradeProfileKey } from "@shared/academic-profiles";

function requestText(value: unknown): string {
  if (Array.isArray(value)) return requestText(value[0]);
  return typeof value === "string" ? value : "";
}

function requestId(value: unknown): number {
  return Number.parseInt(requestText(value), 10);
}

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

const posSaleRequestSchema = z.object({
  paymentMethod: z.string().trim().min(1).max(50).default("cash"),
  customerName: z.string().trim().max(200).nullable().optional(),
  studentId: z.coerce.number().int().positive().nullable().optional(),
  items: z.array(z.object({
    itemId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive().max(100000),
  })).min(1),
});

const PASSWORD_RULES = {
  minLength: 8,
  requireLowercase: true,
  requireUppercase: true,
  requireSpecial: true,
};

async function resolveGradeProfileContext(args: {
  schoolId: number;
  classId: number;
  subjectId: number;
}): Promise<{
  profileKey: GradeProfileKey | null;
  gradingSubjectType: string | null;
  substitutionPolicy: string | null;
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
  const excluded = isTemporarilyExcludedFromStrictGrading(subject);
  const operationalProfile = excluded
    ? { profileKey: null, effectiveSubjectType: null, substitutionPolicy: null }
    : resolveOperationalGradeProfile({
        schoolType: school?.schoolType,
        examinationBoard: school?.examinationBoard,
        streamName,
        subjectType: subject?.subjectType,
        subjectName: subject?.name,
      });
  return {
    profileKey: operationalProfile.profileKey,
    gradingSubjectType: operationalProfile.effectiveSubjectType,
    substitutionPolicy: operationalProfile.substitutionPolicy,
    school,
    classInfo,
    subject,
    streamName,
  };
}

function isSubjectAvailableForClass(subject: any, classInfo: any): boolean {
  const classStreamId = classInfo?.streamId ? Number(classInfo.streamId) : null;
  const subjectStreamIds = Array.isArray(subject?.streamIds) && subject.streamIds.length > 0
    ? subject.streamIds.map((id: any) => Number(id))
    : subject?.streamId ? [Number(subject.streamId)] : [];

  if (!classStreamId || subjectStreamIds.length === 0) return true;
  return subjectStreamIds.includes(classStreamId);
}

function getApplicableGradesForContext(grades: any[], args: { profileKey: string | null | undefined; classId: number }) {
  return getProfileAwareGradeCandidates(grades, args.profileKey, args.classId);
}

function getClassSubjectGradeCandidates(args: {
  allGrades: any[];
  school: any;
  classInfo: any;
  classStreamName?: string | null;
  subject: any;
}) {
  const excluded = isTemporarilyExcludedFromStrictGrading(args.subject);
  if (excluded) {
    return {
      profileKey: null,
      gradingSubjectType: null,
      substitutionPolicy: null,
      grades: [] as any[],
      excluded: true,
    };
  }
  const operationalProfile = resolveOperationalGradeProfile({
    schoolType: args.school?.schoolType,
    examinationBoard: args.school?.examinationBoard,
    streamName: args.classStreamName || null,
    subjectType: args.subject?.subjectType,
    subjectName: args.subject?.name,
  });
  return {
    profileKey: operationalProfile.profileKey,
    gradingSubjectType: operationalProfile.effectiveSubjectType,
    substitutionPolicy: operationalProfile.substitutionPolicy,
    grades: operationalProfile.profileKey
      ? getApplicableGradesForContext(args.allGrades, {
          profileKey: operationalProfile.profileKey,
          classId: Number(args.classInfo?.id || 0),
        })
      : [],
    excluded: false,
  };
}


type ClassGradingConfigurationSummary = {
  classId: number;
  ready: boolean;
  state: "ready" | "needs_configuration";
  autoAttachedGradeRows: number;
  profiles: GradeConfigurationProfileStatus[];
  message: string;
};

type AssessmentPaperValidationResult = {
  valid: boolean;
  message: string;
  normalizedPapers: Array<{
    id?: number;
    paperName: string;
    paperMarks: number;
    paperWeightPct: string;
    sortOrder?: number;
  }>;
};

function validateAssessmentPapers(papers: unknown): AssessmentPaperValidationResult {
  if (!Array.isArray(papers) || papers.length < 1) {
    return { valid: false, message: "At least one paper is required", normalizedPapers: [] };
  }

  const normalizedPapers: AssessmentPaperValidationResult["normalizedPapers"] = [];
  const paperNames = new Set<string>();
  const paperIds = new Set<number>();
  let totalWeight = 0;

  for (let index = 0; index < papers.length; index += 1) {
    const paper = papers[index] as any;
    const paperName = String(paper?.paperName || "").trim();
    const paperMarks = Number(paper?.paperMarks);
    const paperWeightPct = Number(paper?.paperWeightPct);
    const paperId = paper?.id === undefined || paper?.id === null || paper?.id === ""
      ? undefined
      : Number(paper.id);

    if (paperId !== undefined) {
      if (!Number.isInteger(paperId) || paperId <= 0) {
        return { valid: false, message: `Paper ${index + 1} has an invalid ID`, normalizedPapers: [] };
      }
      if (paperIds.has(paperId)) {
        return { valid: false, message: `Paper ${index + 1} was submitted more than once`, normalizedPapers: [] };
      }
      paperIds.add(paperId);
    }

    if (!paperName) {
      return { valid: false, message: `Paper ${index + 1} requires a name`, normalizedPapers: [] };
    }
    const normalizedName = paperName.toLowerCase();
    if (paperNames.has(normalizedName)) {
      return { valid: false, message: `Paper names must be unique. "${paperName}" is repeated.`, normalizedPapers: [] };
    }
    paperNames.add(normalizedName);

    if (!Number.isFinite(paperMarks) || !Number.isInteger(paperMarks) || paperMarks <= 0) {
      return { valid: false, message: `${paperName} must have a positive whole-number maximum mark`, normalizedPapers: [] };
    }
    if (!Number.isFinite(paperWeightPct) || paperWeightPct <= 0 || paperWeightPct > 100) {
      return { valid: false, message: `${paperName} must have a weight greater than 0% and not more than 100%`, normalizedPapers: [] };
    }

    totalWeight += paperWeightPct;
    normalizedPapers.push({
      ...(paperId !== undefined ? { id: paperId } : {}),
      paperName,
      paperMarks,
      paperWeightPct: paperWeightPct.toFixed(2),
      sortOrder: index,
    });
  }

  if (Math.abs(totalWeight - 100) >= 0.01) {
    return {
      valid: false,
      message: `Paper weights must total exactly 100% (currently ${totalWeight.toFixed(2)}%)`,
      normalizedPapers: [],
    };
  }

  return { valid: true, message: "Assessment papers are valid", normalizedPapers };
}

function mergeGradeConfigurationStatuses(statuses: GradeConfigurationProfileStatus[]): GradeConfigurationProfileStatus[] {
  const grouped = new Map<string, GradeConfigurationProfileStatus>();
  for (const status of statuses) {
    const key = `${status.profileKey || "none"}::${status.subjectType || "generic"}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...status, subjectIds: [...status.subjectIds] });
      continue;
    }
    existing.subjectIds = Array.from(new Set([...existing.subjectIds, ...status.subjectIds]));
  }
  return Array.from(grouped.values());
}

async function getClassGradingConfiguration(args: {
  classId: number;
  subjectIds?: number[];
  autoAttach?: boolean;
  expectedSchoolId?: number;
}): Promise<ClassGradingConfigurationSummary> {
  const classInfo = await storage.getClass(args.classId);
  if (!classInfo || !classInfo.schoolId || (args.expectedSchoolId && classInfo.schoolId !== args.expectedSchoolId)) {
    return {
      classId: args.classId,
      ready: false,
      state: "needs_configuration",
      autoAttachedGradeRows: 0,
      profiles: [],
      message: "Class or school context was not found.",
    };
  }

  const [school, stream, schoolGrades, schoolSubjects, profileSettingsRows] = await Promise.all([
    storage.getSchool(classInfo.schoolId),
    classInfo.streamId ? storage.getStream(classInfo.streamId) : Promise.resolve(undefined),
    storage.getGradesBySchool(classInfo.schoolId),
    storage.getSubjectsBySchool(classInfo.schoolId),
    db.select().from(gradeProfileSettings).where(eq(gradeProfileSettings.schoolId, classInfo.schoolId)),
  ]);

  if (Array.isArray(args.subjectIds) && args.subjectIds.length === 0) {
    return {
      classId: classInfo.id,
      ready: true,
      state: "ready",
      autoAttachedGradeRows: 0,
      profiles: [],
      message: "No strict-grading subjects require configuration.",
    };
  }

  const requestedSubjectIds = Array.isArray(args.subjectIds)
    ? Array.from(new Set(args.subjectIds.map(Number).filter(Number.isFinite)))
    : (await storage.getClassSubjects(classInfo.id)).map((row) => Number(row.subjectId));
  const requestedSubjects = schoolSubjects.filter((subject) => requestedSubjectIds.includes(subject.id));
  const selectedSubjects = requestedSubjects.filter((subject) => !isTemporarilyExcludedFromStrictGrading(subject));
  if (requestedSubjects.length > 0 && selectedSubjects.length === 0) {
    return {
      classId: classInfo.id,
      ready: true,
      state: "ready",
      autoAttachedGradeRows: 0,
      profiles: [],
      message: "All requested subjects are temporarily excluded from strict grading.",
    };
  }
  const contexts = selectedSubjects.length > 0
    ? selectedSubjects.map((subject) => ({
        subjectType: subject.subjectType || null,
        subjectName: subject.name || null,
        subjectIds: [subject.id],
      }))
    : [{ subjectType: null, subjectName: null, subjectIds: [] as number[] }];

  let autoAttachedGradeRows = 0;
  if (args.autoAttach) {
    const rowsToAttach = new Set<number>();
    for (const context of contexts) {
      const operationalProfile = resolveOperationalGradeProfile({
        schoolType: school?.schoolType,
        examinationBoard: school?.examinationBoard,
        streamName: stream?.name || null,
        subjectType: context.subjectType,
        subjectName: context.subjectName,
      });
      const plan = planExactProfileClassAttachment({
        grades: schoolGrades,
        profileKey: operationalProfile.profileKey,
        classId: classInfo.id,
        subjectType: operationalProfile.effectiveSubjectType,
      });
      if (plan.safe) {
        plan.rowsToAttach.forEach((gradeId) => rowsToAttach.add(gradeId));
      }
    }

    if (rowsToAttach.size > 0) {
      autoAttachedGradeRows = await storage.attachClassToGrades(classInfo.id, Array.from(rowsToAttach));
      console.info("[GRADE_PROFILE_AUTO_ATTACHED]", {
        classId: classInfo.id,
        schoolId: classInfo.schoolId,
        gradeRows: autoAttachedGradeRows,
        gradeIds: Array.from(rowsToAttach),
      });
    }
  }

  const effectiveGrades = autoAttachedGradeRows > 0
    ? await storage.getGradesBySchool(classInfo.schoolId)
    : schoolGrades;
  const statuses = mergeGradeConfigurationStatuses(contexts.map((context) => {
    const profileKey = resolveExpectedGradeProfile({
      schoolType: school?.schoolType,
      examinationBoard: school?.examinationBoard,
      streamName: stream?.name || null,
      subjectType: context.subjectType,
      subjectName: context.subjectName,
    });
    const profileSetting = profileSettingsRows.find((row: any) => String(row.gradeLevel) === String(profileKey || "")) || null;
    return assessClassSubjectGradeConfiguration({
      grades: effectiveGrades,
      classId: classInfo.id,
      schoolType: school?.schoolType,
      examinationBoard: school?.examinationBoard,
      streamName: stream?.name || null,
      subjectType: context.subjectType,
      subjectName: context.subjectName,
      subjectIds: context.subjectIds,
      profileSetting,
    });
  }));
  const ready = statuses.length > 0 && statuses.every((status) => status.ready);
  const problem = statuses.find((status) => !status.ready);

  return {
    classId: classInfo.id,
    ready,
    state: ready ? "ready" : "needs_configuration",
    autoAttachedGradeRows,
    profiles: statuses,
    message: ready
      ? autoAttachedGradeRows > 0
        ? "The class grading profile was attached automatically and is ready."
        : "The class grading configuration is ready."
      : problem?.message || "The class grading configuration requires attention.",
  };
}

async function requireAssessmentGradingConfiguration(args: {
  schoolId: number;
  classId: number;
  subjectId: number;
  res: Response;
}): Promise<ClassGradingConfigurationSummary | null> {
  const configuration = await getClassGradingConfiguration({
    classId: args.classId,
    subjectIds: [args.subjectId],
    autoAttach: true,
    expectedSchoolId: args.schoolId,
  });
  if (configuration.ready) return configuration;

  args.res.status(422).json({
    message: `${configuration.message} Configure a complete grading profile before creating or moving this assessment.`,
    code: "GRADE_CONFIGURATION_INVALID",
    gradingConfiguration: configuration,
  });
  return null;
}

function resolveStoredAssessmentGrade(args: {
  mark: any;
  percentage: number | null;
  applicableGrades: any[];
  allGrades: any[];
  expectedProfileKey?: string | null;
  classId: number;
  subjectType?: string | null;
}) {
  if (args.percentage === null || !args.expectedProfileKey) return null;
  const linkedGrade = args.mark?.gradeId
    ? args.allGrades.find((grade) => Number(grade.id) === Number(args.mark.gradeId))
    : null;
  return resolveExactConfiguredGrade({
    percentage: args.percentage,
    expectedProfileKey: args.expectedProfileKey,
    classId: args.classId,
    subjectType: args.subjectType,
    exactProfileGrades: args.applicableGrades,
    storedGrade: linkedGrade,
  }).grade;
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

function resolveSharedPointsDirection(profileKeys: Iterable<string>, settingsRows: any[]): "higher_is_better" | "lower_is_better" | null {
  const keys = Array.from(new Set(Array.from(profileKeys).filter(Boolean)));
  if (!keys.length) return null;
  const directionByProfile = new Map(
    settingsRows.map((row: any) => [String(row.gradeLevel || ""), String(row.pointsDirection || "")]),
  );
  const directions = keys.map((key) => directionByProfile.get(key)).filter(Boolean);
  if (directions.length !== keys.length) return null;
  const uniqueDirections = new Set(directions);
  if (uniqueDirections.size !== 1) return null;
  const direction = directions[0];
  return direction === "higher_is_better" || direction === "lower_is_better" ? direction : null;
}

function emptyAcademicPositionMap(rankingMode: AcademicPositionRankingMode | null = null) {
  return {
    size: 0,
    map: new Map<number, string>(),
    records: new Map(),
    unresolved: new Map<number, string[]>(),
    rankingMode,
  };
}

function unresolvedAcademicPositionMap(studentIds: number[], reason: string) {
  return {
    ...emptyAcademicPositionMap(null),
    unresolved: new Map(studentIds.map((studentId) => [studentId, [reason]])),
  };
}

function parsePositionNumber(value?: string | null): number | null {
  const position = Number(String(value || "").split("/")[0]);
  return Number.isInteger(position) && position > 0 ? position : null;
}

async function calculateClassPositionMap(examId: number, schoolId: number, classId: number) {
  const [school, classInfo, allAssessments, allGrades, schoolSubjects, settingsRows, students] = await Promise.all([
    storage.getSchool(schoolId),
    storage.getClass(classId),
    storage.getAssessmentsByExam(examId),
    storage.getGradesBySchool(schoolId),
    storage.getSubjectsBySchool(schoolId),
    db.select().from(gradeProfileSettings).where(eq(gradeProfileSettings.schoolId, schoolId)),
    storage.getStudentsByClass(classId),
  ]);
  if (!classInfo) return emptyAcademicPositionMap();
  const stream = classInfo.streamId ? await storage.getStream(classInfo.streamId) : undefined;
  const academicRankingMode = resolveAcademicPositionRankingMode({
    schoolType: school?.schoolType,
    streamName: stream?.name || null,
  });
  if (academicRankingMode === "none") return emptyAcademicPositionMap("none");
  if (!academicRankingMode) {
    return unresolvedAcademicPositionMap(students.map((student: any) => Number(student.id)), "position_stream_unrecognized");
  }
  const rawAssessments = allAssessments.filter((assessment: any) => Number(assessment.classId) === Number(classId));
  if (!rawAssessments.length) return emptyAcademicPositionMap(academicRankingMode);
  const allMarks = await storage.getAssessmentMarksByAssessments(rawAssessments.map((assessment: any) => Number(assessment.id)));
  const assessments = selectCanonicalAssessments(rawAssessments, allMarks).assessments;
  const assessmentIds = new Set(assessments.map((assessment: any) => Number(assessment.id)));
  const marks = allMarks.filter((mark: any) => assessmentIds.has(Number(mark.assessmentId)));
  const marksMap = new Map(marks.map((mark: any) => [`${Number(mark.studentId)}-${Number(mark.assessmentId)}`, mark]));
  const subjectMap = new Map(schoolSubjects.map((subject: any) => [Number(subject.id), subject]));
  const expectedSubjectIds = Array.from(new Set(assessments.map((assessment: any) => Number(assessment.subjectId))))
    .filter((subjectId) => {
      const subject = subjectMap.get(subjectId);
      return !!subject && !isTemporarilyExcludedFromStrictGrading(subject);
    });
  const assessmentBySubject = new Map(assessments.map((assessment: any) => [Number(assessment.subjectId), assessment]));
  const gradeContextBySubject = new Map<number, { profileKey: GradeProfileKey | null; gradingSubjectType: string | null; grades: any[] }>();
  const profileKeys = new Set<string>();
  for (const subjectId of expectedSubjectIds) {
    const subject = subjectMap.get(subjectId);
    if (!subject) continue;
    const context = getClassSubjectGradeCandidates({
      allGrades,
      school,
      classInfo,
      classStreamName: stream?.name || null,
      subject,
    });
    gradeContextBySubject.set(subjectId, context);
    if (context.profileKey) profileKeys.add(context.profileKey);
  }
  const studentIds = students.map((student: any) => Number(student.id));
  const studentSubjectRows = studentIds.length
    ? await db.select({ studentId: studentSubjectsSchema.studentId, subjectId: studentSubjectsSchema.subjectId })
      .from(studentSubjectsSchema)
      .where(inArray(studentSubjectsSchema.studentId, studentIds))
    : [];
  const assignedByStudent = new Map<number, Set<number>>();
  for (const row of studentSubjectRows) {
    const assigned = assignedByStudent.get(Number(row.studentId)) || new Set<number>();
    assigned.add(Number(row.subjectId));
    assignedByStudent.set(Number(row.studentId), assigned);
  }
  const candidates: RankingCandidate[] = students.map((student: any) => {
    const assigned = assignedByStudent.get(Number(student.id));
    const studentExpectedSubjectIds = assigned?.size
      ? expectedSubjectIds.filter((subjectId) => assigned.has(Number(subjectId)))
      : expectedSubjectIds;
    return {
    id: Number(student.id),
    expectedSubjectIds: studentExpectedSubjectIds,
    results: studentExpectedSubjectIds.map((subjectId): RankingSubjectResult => {
      const assessment: any = assessmentBySubject.get(subjectId);
      const subject: any = subjectMap.get(subjectId);
      const context = gradeContextBySubject.get(subjectId);
      const mark: any = assessment ? marksMap.get(`${Number(student.id)}-${Number(assessment.id)}`) : null;
      const percentage = parseFinitePercentage(mark?.percentage);
      const storedGrade = mark?.gradeId ? allGrades.find((grade: any) => Number(grade.id) === Number(mark.gradeId)) : null;
      const resolution = resolveExactConfiguredGrade({
        percentage,
        expectedProfileKey: context?.profileKey || null,
        classId,
        subjectType: context?.gradingSubjectType || subject?.subjectType || null,
        exactProfileGrades: context?.grades || [],
        storedGrade,
      });
      return { subjectId, percentage, grade: resolution.grade, profileKey: context?.profileKey || null };
    }),
  };
  });
  const rankingMode: PositionRankingMode = academicRankingMode;
  const pointsDirection = rankingMode === "average_grade_points"
    ? resolveSharedPointsDirection(profileKeys, settingsRows)
    : null;
  return {
    ...calculateConfiguredPositionMap({ candidates, pointsDirection, rankingMode }),
    rankingMode: academicRankingMode,
  };
}

async function calculateStreamPositionMap(
  examId: number,
  schoolId: number,
  streamId?: number | null,
  options: { missingMarksAsZero?: boolean } = {},
) {
  if (!streamId) return emptyAcademicPositionMap();
  const [school, stream, allClasses, allAssessments, allGrades, schoolSubjects, settingsRows] = await Promise.all([
    storage.getSchool(schoolId),
    storage.getStream(streamId),
    storage.getClassesBySchool(schoolId),
    storage.getAssessmentsByExam(examId),
    storage.getGradesBySchool(schoolId),
    storage.getSubjectsBySchool(schoolId),
    db.select().from(gradeProfileSettings).where(eq(gradeProfileSettings.schoolId, schoolId)),
  ]);
  const classes = allClasses.filter((classInfo: any) => Number(classInfo.streamId) === Number(streamId));
  if (!classes.length) return emptyAcademicPositionMap();
  const academicRankingMode = resolveAcademicPositionRankingMode({
    schoolType: school?.schoolType,
    streamName: stream?.name || null,
  });
  if (academicRankingMode === "none") return emptyAcademicPositionMap("none");
  const classIds = new Set(classes.map((classInfo: any) => Number(classInfo.id)));
  const rawAssessments = allAssessments.filter((assessment: any) => classIds.has(Number(assessment.classId)));
  if (!rawAssessments.length) return emptyAcademicPositionMap(academicRankingMode);
  const allMarks = await storage.getAssessmentMarksByAssessments(rawAssessments.map((assessment: any) => Number(assessment.id)));
  const canonicalAssessments = selectCanonicalAssessments(rawAssessments, allMarks).assessments;
  const canonicalIds = new Set(canonicalAssessments.map((assessment: any) => Number(assessment.id)));
  const canonicalMarks = allMarks.filter((mark: any) => canonicalIds.has(Number(mark.assessmentId)));
  const subjectMap = new Map(schoolSubjects.map((subject: any) => [Number(subject.id), subject]));
  const marksMap = new Map(canonicalMarks.map((mark: any) => [`${Number(mark.studentId)}-${Number(mark.assessmentId)}`, mark]));
  const studentsByClass = new Map<number, any[]>();
  await Promise.all(classes.map(async (classInfo: any) => {
    studentsByClass.set(Number(classInfo.id), await storage.getStudentsByClass(Number(classInfo.id)));
  }));

  const allStreamStudents = Array.from(studentsByClass.values()).flat();
  const streamStudentIds = allStreamStudents.map((student: any) => Number(student.id));
  if (!academicRankingMode) {
    return unresolvedAcademicPositionMap(streamStudentIds, "position_stream_unrecognized");
  }
  const streamStudentSubjectRows = streamStudentIds.length
    ? await db.select({ studentId: studentSubjectsSchema.studentId, subjectId: studentSubjectsSchema.subjectId })
      .from(studentSubjectsSchema)
      .where(inArray(studentSubjectsSchema.studentId, streamStudentIds))
    : [];
  const streamAssignedByStudent = new Map<number, Set<number>>();
  for (const row of streamStudentSubjectRows) {
    const assigned = streamAssignedByStudent.get(Number(row.studentId)) || new Set<number>();
    assigned.add(Number(row.subjectId));
    streamAssignedByStudent.set(Number(row.studentId), assigned);
  }

  const candidates: RankingCandidate[] = [];
  const profileKeys = new Set<string>();
  for (const classInfo of classes) {
    const classAssessments = canonicalAssessments.filter((assessment: any) => Number(assessment.classId) === Number(classInfo.id));
    const expectedSubjectIds = Array.from(new Set(classAssessments.map((assessment: any) => Number(assessment.subjectId))))
      .filter((subjectId) => {
        const subject = subjectMap.get(subjectId);
        return !!subject && !isTemporarilyExcludedFromStrictGrading(subject);
      });
    const assessmentBySubject = new Map(classAssessments.map((assessment: any) => [Number(assessment.subjectId), assessment]));
    const gradeContextBySubject = new Map<number, { profileKey: GradeProfileKey | null; gradingSubjectType: string | null; grades: any[] }>();
    for (const subjectId of expectedSubjectIds) {
      const subject = subjectMap.get(subjectId);
      if (!subject) continue;
      const context = getClassSubjectGradeCandidates({
        allGrades,
        school,
        classInfo,
        classStreamName: stream?.name || null,
        subject,
      });
      gradeContextBySubject.set(subjectId, context);
      if (context.profileKey) profileKeys.add(context.profileKey);
    }
    for (const student of studentsByClass.get(Number(classInfo.id)) || []) {
      const assigned = streamAssignedByStudent.get(Number(student.id));
      const studentExpectedSubjectIds = assigned?.size
        ? expectedSubjectIds.filter((subjectId) => assigned.has(Number(subjectId)))
        : expectedSubjectIds;
      const results: RankingSubjectResult[] = [];
      for (const subjectId of studentExpectedSubjectIds) {
        const assessment: any = assessmentBySubject.get(subjectId);
        const subject: any = subjectMap.get(subjectId);
        const context = gradeContextBySubject.get(subjectId);
        const mark: any = assessment ? marksMap.get(`${Number(student.id)}-${Number(assessment.id)}`) : null;
        const recordedPercentage = parseFinitePercentage(mark?.percentage);
        const percentage = recordedPercentage ?? (options.missingMarksAsZero ? 0 : null);
        const linkedGrade = mark?.gradeId
          ? allGrades.find((grade: any) => Number(grade.id) === Number(mark.gradeId))
          : null;
        const resolved = resolveExactConfiguredGrade({
          percentage,
          expectedProfileKey: context?.profileKey || null,
          classId: Number(classInfo.id),
          subjectType: context?.gradingSubjectType || subject?.subjectType || null,
          exactProfileGrades: context?.grades || [],
          storedGrade: linkedGrade,
        });
        results.push({
          subjectId,
          percentage,
          grade: resolved.grade,
          profileKey: context?.profileKey || null,
        });
      }
      candidates.push({ id: Number(student.id), expectedSubjectIds: studentExpectedSubjectIds, results });
    }
  }

  const rankingMode: PositionRankingMode = academicRankingMode;
  const pointsDirection = rankingMode === "average_grade_points"
    ? resolveSharedPointsDirection(profileKeys, settingsRows)
    : null;
  return {
    ...calculateConfiguredPositionMap({ candidates, pointsDirection, rankingMode }),
    rankingMode: academicRankingMode,
  };
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

async function loadEcdSectionsForStudentsExam(args: {
  studentIds: number[];
  examId: number;
  isEndOfTermExam: boolean;
  classStreamName?: string | null;
  studentStreamNames?: Map<number, string | null | undefined>;
}) {
  const result = new Map<number, Array<{
    code: string;
    name: string;
    items: Array<{ itemText: string; rating: string | null }>;
  }>>();
  const studentIds = Array.from(new Set(args.studentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  if (!args.isEndOfTermExam || studentIds.length === 0) return result;

  const records = await db.select().from(ecdAssessmentRecords).where(and(
    eq(ecdAssessmentRecords.examId, args.examId),
    inArray(ecdAssessmentRecords.studentId, studentIds),
  ));
  const recordByStudent = new Map(records.map((record: any) => [Number(record.studentId), record]));
  const recordIds = records.map((record: any) => Number(record.id));
  const responses = recordIds.length
    ? await db.select().from(ecdAssessmentResponses).where(inArray(ecdAssessmentResponses.recordId, recordIds))
    : [];
  const responsesByRecord = new Map<number, Map<number, string | null>>();
  for (const response of responses as any[]) {
    const map = responsesByRecord.get(Number(response.recordId)) || new Map<number, string | null>();
    map.set(Number(response.itemId), response.rating || null);
    responsesByRecord.set(Number(response.recordId), map);
  }
  const [domains, items] = await Promise.all([
    storage.getEcdAssessmentDomains(),
    storage.getEcdAssessmentItems(),
  ]);
  const orderedDomains = [...domains].sort((a: any, b: any) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const itemsByDomain = new Map<number, any[]>();
  for (const item of items as any[]) {
    const rows = itemsByDomain.get(Number(item.domainId)) || [];
    rows.push(item);
    itemsByDomain.set(Number(item.domainId), rows);
  }
  for (const rows of itemsByDomain.values()) {
    rows.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }

  for (const studentId of studentIds) {
    const record: any = recordByStudent.get(studentId);
    const studentStreamName = args.studentStreamNames?.get(studentId) || null;
    const ecdContext = !!record || isEcdStream(studentStreamName) || isEcdStream(args.classStreamName);
    if (!ecdContext) continue;
    const responseMap = record ? responsesByRecord.get(Number(record.id)) || new Map<number, string | null>() : new Map<number, string | null>();
    result.set(studentId, orderedDomains.map((domain: any) => ({
      code: domain.code,
      name: domain.name,
      items: (itemsByDomain.get(Number(domain.id)) || []).map((item: any) => ({
        itemText: item.itemText,
        rating: responseMap.get(Number(item.id)) || null,
      })),
    })));
  }
  return result;
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
        targetId: requestId((req.params as Record<string, unknown>).id) || null,
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

  const currentUser = req.user as User;
  if (currentUser.role === "org_admin") {
    const school = await storage.getSchool(schoolId);
    if (!school) {
      res.status(404).json({ message: "School not found" });
      return null;
    }

    if (currentUser.organizationId !== null && currentUser.organizationId !== undefined) {
      if (school.organizationId !== currentUser.organizationId) {
        res.status(403).json({ message: "School not in organization context" });
        return null;
      }
    } else {
      const allowedSchoolIds = await storage.getUserSchoolAccess(currentUser.id);
      if (!allowedSchoolIds.includes(schoolId)) {
        res.status(403).json({ message: "School not assigned to this account" });
        return null;
      }
    }
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

async function ensureStaffInSchool(staffId: number, schoolId: number, res: Response) {
  const staffMember = await storage.getStaff(staffId);
  if (!staffMember || staffMember.schoolId !== schoolId) {
    res.status(403).json({ message: "Staff member not in school context" });
    return null;
  }
  return staffMember;
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
  const requestedAssessmentTypeId = assessmentData.assessmentTypeId !== undefined
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

  let exam: any = null;
  if (examId !== null && examId !== undefined && examId !== "") {
    exam = await ensureExamInSchool(Number(examId), schoolId, res);
    if (!exam) return null;
  }

  let assessmentType: any = null;
  const resolvedAssessmentTypeId = exam?.assessmentTypeId ?? requestedAssessmentTypeId ?? null;
  if (
    exam?.assessmentTypeId &&
    requestedAssessmentTypeId !== null &&
    requestedAssessmentTypeId !== undefined &&
    requestedAssessmentTypeId !== "" &&
    Number(requestedAssessmentTypeId) !== Number(exam.assessmentTypeId)
  ) {
    res.status(400).json({
      message: "The selected assessment type does not match the linked exercise/exam assessment type.",
      code: "ASSESSMENT_TYPE_EXAM_MISMATCH",
      details: {
        examAssessmentTypeId: Number(exam.assessmentTypeId),
        requestedAssessmentTypeId: Number(requestedAssessmentTypeId),
      },
    });
    return null;
  }

  if (resolvedAssessmentTypeId !== null && resolvedAssessmentTypeId !== undefined && resolvedAssessmentTypeId !== "") {
    assessmentType = await ensureAssessmentTypeInSchool(Number(resolvedAssessmentTypeId), schoolId, res);
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

  return {
    classInfo,
    subjectInfo,
    exam,
    assessmentType,
    resolvedAssessmentTypeId: resolvedAssessmentTypeId ? Number(resolvedAssessmentTypeId) : null,
  };
}

async function ensureAssessmentUniquenessPolicy(args: {
  schoolId: number;
  classId: number;
  subjectId: number;
  examId: number | null;
  assessmentType: any | null;
  excludeAssessmentId?: number | null;
  res: Response;
}) {
  const enforceExamUniqueness = Boolean(args.examId && isSinglePerExamAssessmentType(args.assessmentType));
  if (!enforceExamUniqueness || !args.examId) {
    return { enforceExamUniqueness: false };
  }

  const existing = (await storage.getAssessmentsByExam(args.examId)).find((assessment: any) =>
    Number(assessment.classId) === Number(args.classId) &&
    Number(assessment.subjectId) === Number(args.subjectId) &&
    Number(assessment.id) !== Number(args.excludeAssessmentId || 0)
  );

  if (existing) {
    args.res.status(409).json({
      message: "An assessment already exists for this class, subject and exercise/exam. Open the existing assessment instead of creating another one.",
      code: "ASSESSMENT_SINGLE_PER_EXAM_CONFLICT",
      details: {
        existingAssessmentId: Number(existing.id),
        examId: Number(args.examId),
        classId: Number(args.classId),
        subjectId: Number(args.subjectId),
        assessmentTypeId: args.assessmentType?.id ? Number(args.assessmentType.id) : null,
      },
    });
    return null;
  }

  return { enforceExamUniqueness: true };
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

async function ensureAssessmentCommentProfileAllowed(
  res: Response,
  schoolId: number,
  classInfo: any,
  subjectInfo: any,
  grade: any,
) {
  const school = await storage.getSchool(schoolId);
  if (!school) {
    res.status(404).json({ message: "School not found" });
    return null;
  }

  const stream = classInfo.streamId ? await storage.getStream(Number(classInfo.streamId)) : null;
  const streamName = stream?.name || classInfo.className || null;
  const expectedProfiles = getGradingProfilesForSchool(
    school.schoolType,
    school.examinationBoard,
  ).filter((profile) =>
    profileMatchesStreamName(profile.key, streamName) &&
    subjectMatchesGradeProfile({
      profileKey: profile.key,
      schoolType: school.schoolType,
      examinationBoard: school.examinationBoard,
      streamName,
      subjectType: subjectInfo.subjectType,
    })
  );

  if (expectedProfiles.length === 0) {
    res.status(400).json({
      message: "The selected subject type does not match the chosen class grading profile",
      code: "ASSESSMENT_COMMENT_SUBJECT_PROFILE_MISMATCH",
    });
    return null;
  }

  const selectedProfile = expectedProfiles.find((profile) =>
    gradeProfileMatchesStrict(grade.gradeLevel, profile.key)
  );
  if (!selectedProfile) {
    res.status(400).json({
      message: `The selected grade belongs to ${getGradeProfileLabel(grade.gradeLevel)}, but this class and subject require ${expectedProfiles.map((profile) => profile.label).join(" or ")}.`,
      code: "ASSESSMENT_COMMENT_GRADE_PROFILE_MISMATCH",
      details: {
        expectedProfiles: expectedProfiles.map((profile) => profile.key),
        selectedGradeProfile: grade.gradeLevel || null,
        classId: Number(classInfo.id),
        subjectId: Number(subjectInfo.id),
        gradeId: Number(grade.id),
      },
    });
    return null;
  }

  return selectedProfile.key;
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

function assessmentCommentPoolKey(classId: number, subjectId: number, gradeId: number): string {
  return `${Number(classId)}:${Number(subjectId)}:${Number(gradeId)}`;
}

function buildAssessmentCommentPoolMap(comments: Array<{ classId: number; subjectId: number; gradeId: number; id: number; commentText: string }>) {
  const result = new Map<string, (typeof comments)[number]>();
  for (const comment of comments) {
    const key = assessmentCommentPoolKey(comment.classId, comment.subjectId, comment.gradeId);
    const current = result.get(key);
    if (!current || Number(comment.id) > Number(current.id)) result.set(key, comment);
  }
  return result;
}

function resolveEffectiveAssessmentComment(args: {
  mark: any;
  statusComment?: string;
  currentPoolComment?: string | null;
  isPublished: boolean;
}): string {
  const statusComment = String(args.statusComment || "").trim();
  if (statusComment) return statusComment;

  const customComment = String(args.mark?.customCommentText || "").trim();
  const snapshot = String(args.mark?.autoCommentSnapshot || "").trim();
  const currentPoolComment = String(args.currentPoolComment || "").trim();
  const source = String(args.mark?.commentSource || "pool").trim().toLowerCase();

  if (source === "custom") return customComment;

  if (args.isPublished) {
    // Published pool-based reports use the frozen snapshot. The current pool is
    // retained only as a legacy fallback for old rows that predate snapshot hardening.
    return snapshot || currentPoolComment;
  }

  // Unpublished pool-based reports mirror Marks Entry: pool comments are live
  // until the publication transaction refreshes and freezes the snapshot.
  return currentPoolComment || snapshot;
}

async function syncAssessmentPoolCommentToUnpublishedMarks(args: {
  schoolId: number;
  classId: number;
  subjectId: number;
  gradeId: number;
  commentId: number | null;
  commentText: string | null;
}) {
  const assessmentRows = await db
    .select({
      id: assessmentsSchema.id,
      examId: assessmentsSchema.examId,
      classId: assessmentsSchema.classId,
    })
    .from(assessmentsSchema)
    .where(and(
      eq(assessmentsSchema.schoolId, args.schoolId),
      eq(assessmentsSchema.classId, args.classId),
      eq(assessmentsSchema.subjectId, args.subjectId),
    ));

  if (!assessmentRows.length) return { updatedMarks: 0 };

  const examIds = Array.from(new Set(
    assessmentRows
      .map((assessment) => Number(assessment.examId || 0))
      .filter((examId) => Number.isInteger(examId) && examId > 0),
  ));

  const publishedExamIds = new Set<number>();
  if (examIds.length > 0) {
    const publicationRows = await db
      .select({ examId: assessmentPublications.examId })
      .from(assessmentPublications)
      .where(and(
        eq(assessmentPublications.schoolId, args.schoolId),
        eq(assessmentPublications.classId, args.classId),
        eq(assessmentPublications.isPublished, true),
        inArray(assessmentPublications.examId, examIds),
      ));
    publicationRows.forEach((row) => publishedExamIds.add(Number(row.examId)));
  }

  const editableAssessmentIds = assessmentRows
    .filter((assessment) => !assessment.examId || !publishedExamIds.has(Number(assessment.examId)))
    .map((assessment) => Number(assessment.id));
  if (!editableAssessmentIds.length) return { updatedMarks: 0 };

  const updated = await db
    .update(assessmentMarksSchema)
    .set({
      commentId: args.commentId,
      autoCommentSnapshot: args.commentText,
    })
    .where(and(
      eq(assessmentMarksSchema.schoolId, args.schoolId),
      inArray(assessmentMarksSchema.assessmentId, editableAssessmentIds),
      eq(assessmentMarksSchema.gradeId, args.gradeId),
      eq(assessmentMarksSchema.commentSource, "pool"),
    ))
    .returning({ id: assessmentMarksSchema.id });

  return { updatedMarks: updated.length };
}

async function refreshAssessmentCommentSnapshotsForPublication(tx: any, args: {
  schoolId: number;
  examId: number;
  classId: number;
}) {
  const assessmentRows = await tx
    .select({
      id: assessmentsSchema.id,
      subjectId: assessmentsSchema.subjectId,
      classId: assessmentsSchema.classId,
    })
    .from(assessmentsSchema)
    .where(and(
      eq(assessmentsSchema.schoolId, args.schoolId),
      eq(assessmentsSchema.examId, args.examId),
      eq(assessmentsSchema.classId, args.classId),
    ));

  const assessmentIds = assessmentRows.map((assessment: any) => Number(assessment.id));
  if (!assessmentIds.length) return { reviewedMarks: 0, updatedMarks: 0 };

  const [markRows, commentRows] = await Promise.all([
    tx
      .select()
      .from(assessmentMarksSchema)
      .where(and(
        eq(assessmentMarksSchema.schoolId, args.schoolId),
        inArray(assessmentMarksSchema.assessmentId, assessmentIds),
        eq(assessmentMarksSchema.commentSource, "pool"),
      )),
    tx
      .select()
      .from(assessmentCommentsSchema)
      .where(and(
        eq(assessmentCommentsSchema.schoolId, args.schoolId),
        eq(assessmentCommentsSchema.classId, args.classId),
      )),
  ]);

  const assessmentById = new Map(assessmentRows.map((assessment: any) => [Number(assessment.id), assessment]));
  const poolMap = buildAssessmentCommentPoolMap(commentRows);
  let updatedMarks = 0;

  for (const mark of markRows) {
    const assessment: any = assessmentById.get(Number(mark.assessmentId));
    if (!assessment) continue;

    const statusComment = markStatusLabel(mark.attStatus);
    const poolComment = !statusComment && mark.gradeId
      ? poolMap.get(assessmentCommentPoolKey(args.classId, Number(assessment.subjectId), Number(mark.gradeId)))
      : null;
    const nextCommentId = statusComment ? null : poolComment?.id ?? null;
    const nextSnapshot = statusComment || poolComment?.commentText || null;

    if (
      Number(mark.commentId || 0) === Number(nextCommentId || 0) &&
      String(mark.autoCommentSnapshot || "") === String(nextSnapshot || "")
    ) {
      continue;
    }

    await tx
      .update(assessmentMarksSchema)
      .set({
        commentId: nextCommentId,
        autoCommentSnapshot: nextSnapshot,
      })
      .where(eq(assessmentMarksSchema.id, Number(mark.id)));
    updatedMarks += 1;
  }

  return { reviewedMarks: markRows.length, updatedMarks };
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

  const canonicalAssessmentSelection = selectCanonicalAssessments(assessments, assessmentMarks);
  const assessmentByClassSubject = new Map<string, any>();
  for (const assessment of canonicalAssessmentSelection.assessments) {
    assessmentByClassSubject.set(
      classSubjectKey(Number(assessment.classId), Number(assessment.subjectId)),
      assessment,
    );
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

const ACTIVE_GRADE_PROFILE_KEY_SET = new Set<string>(GRADE_PROFILE_KEYS as readonly string[]);
const POINTS_DIRECTION_VALUES = ["higher_is_better", "lower_is_better"] as const;

function normalizeRequiredGradePayload(payload: any, existing?: any) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const gradeLevel = String(merged.gradeLevel || "").trim();
  const gradeStatus = String(merged.gradeStatus || "").trim().toUpperCase();
  const gradePointsMissing = merged.gradePoints === null || merged.gradePoints === undefined || String(merged.gradePoints).trim() === "";
  const lowerLimitMissing = merged.lowerLimit === null || merged.lowerLimit === undefined || String(merged.lowerLimit).trim() === "";
  const upperLimitMissing = merged.upperLimit === null || merged.upperLimit === undefined || String(merged.upperLimit).trim() === "";
  const gradePoints = Number(merged.gradePoints);
  const rankOrder = Number(merged.rankOrder);
  const lowerLimit = Number(merged.lowerLimit);
  const upperLimit = Number(merged.upperLimit);

  if (!ACTIVE_GRADE_PROFILE_KEY_SET.has(gradeLevel)) {
    throw new Error("Select an exact current grading profile. Legacy and compatible profiles are not supported.");
  }
  if (!merged.gradeName || !String(merged.gradeName).trim()) throw new Error("Grade name is required");
  if (lowerLimitMissing || upperLimitMissing || !Number.isInteger(lowerLimit) || !Number.isInteger(upperLimit) || lowerLimit < 0 || upperLimit > 100 || lowerLimit > upperLimit) {
    throw new Error("Grade limits must be whole percentages between 0 and 100");
  }
  if (gradePointsMissing || !Number.isFinite(gradePoints)) throw new Error("Grade points are required");
  if (!Number.isInteger(rankOrder) || rankOrder <= 0) throw new Error("Rank order must be a positive whole number");
  if (gradeStatus !== "PASS" && gradeStatus !== "FAIL") throw new Error("Grade status must be PASS or FAIL");

  return {
    ...payload,
    gradeLevel,
    gradeStatus,
    gradePoints: String(gradePoints),
    rankOrder,
    lowerLimit,
    upperLimit,
  };
}

async function ensureGradeProfileAllowedForSchool(schoolId: number, gradeLevel: string, gradeType?: string | null) {
  const school = await storage.getSchool(schoolId);
  if (!school) throw new Error("School not found");
  const allowedProfiles = getGradingProfilesForSchool(school.schoolType, school.examinationBoard).map((profile) => profile.key);
  if (!allowedProfiles.includes(gradeLevel as GradeProfileKey)) {
    throw new Error("The selected grading profile does not belong to this school's phase and examination board");
  }
  if (gradeType) {
    const allowedTypes = getGradeTypeOptionsForProfile(gradeLevel, school.schoolType, school.examinationBoard);
    if (!allowedTypes.includes(gradeType)) {
      throw new Error("The selected grade type does not belong to this exact grading profile");
    }
  }
}

async function bumpGradeProfileConfigurationVersion(schoolId: number, gradeLevel?: string | null) {
  if (!gradeLevel || !ACTIVE_GRADE_PROFILE_KEY_SET.has(String(gradeLevel))) return;
  await db.update(gradeProfileSettings).set({
    configurationVersion: sql`${gradeProfileSettings.configurationVersion} + 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(gradeProfileSettings.schoolId, schoolId),
    eq(gradeProfileSettings.gradeLevel, gradeLevel as any),
  ));
}

async function ensureUniqueGradeRankOrder(args: {
  schoolId: number;
  gradeLevel: string;
  gradeType?: string | null;
  rankOrder: number;
  excludeGradeId?: number;
}) {
  const schoolGrades = await storage.getGradesBySchool(args.schoolId);
  const conflict = schoolGrades.find((grade: any) =>
    Number(grade.id) !== Number(args.excludeGradeId || 0) &&
    String(grade.gradeLevel || "") === args.gradeLevel &&
    String(grade.gradeType || "") === String(args.gradeType || "") &&
    Number(grade.rankOrder) === args.rankOrder
  );
  if (conflict) {
    throw new Error(`Rank order ${args.rankOrder} is already used by grade ${conflict.gradeName} in this profile${args.gradeType ? ` and grade type ${args.gradeType}` : ""}.`);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  function routeParam(value: unknown): string {
    return requestText(value);
  }

  function parseIdParam(value: unknown): number {
    return requestId(value);
  }

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
  registerTransportRoutes(app);
  registerTransportDocumentRoutes(app);
  registerAssetsInventoryRoutes(app);
  registerHqOperationsRoutes(app);
  registerRecruitmentRoutes(app);
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
      const userId = parseIdParam(req.params.id);
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
      const userId = parseIdParam(req.params.id);
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
      const userId = parseIdParam(req.params.id);
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
      const userId = parseIdParam(req.params.id);
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
      const userId = parseIdParam(req.params.id);
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
      const userId = parseIdParam(req.params.id);
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
        schoolMap = new Map(orgSchools.map(s => [s.id, s.name]));
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
      const staffMember = await storage.getStaff(parseIdParam(req.params.id));
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
      const updated = await storage.updateStaff(parseIdParam(req.params.id), payload);
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
      await storage.deleteStaff(parseIdParam(req.params.id));
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
      const targetStaffId = parseIdParam(req.params.id);
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
      const staffId = parseIdParam(req.params.id);
      const subjects = await storage.getStaffSubjects(staffId);
      res.json(subjects);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/staff/:id/subjects", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const staffId = parseIdParam(req.params.id);
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
      const staffId = parseIdParam(req.params.id);
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

      const staffId = parseIdParam(req.params.id);
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

      type StaffSubjectAssignmentInput = { classId: number; subjectId: number };
      const normalizedAssignments: StaffSubjectAssignmentInput[] = (bodyAssignments as unknown[]).map((row: any) => ({
        classId: Number(row?.classId),
        subjectId: Number(row?.subjectId),
      }));
      const normalizedReassignments = new Set<string>(
        (bodyReassignments as unknown[]).map((row: any) => `${Number(row?.classId)}-${Number(row?.subjectId)}`)
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
      const staffId = parseIdParam(req.params.id);
      const classes = await storage.getStaffClasses(staffId);
      res.json(classes);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/staff/:id/classes", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const staffId = parseIdParam(req.params.id);
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
      const staffId = parseIdParam(req.params.id);
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
      const staffId = parseIdParam(req.params.id);
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
      const staffId = parseIdParam(req.params.id);
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
      const staffId = parseIdParam(req.params.id);
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

  app.get("/api/classes/grading-configuration", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const classList = schoolId
        ? await storage.getClassesBySchool(schoolId)
        : await storage.getAllClasses();
      const statuses = await Promise.all(
        classList.map((classItem) => getClassGradingConfiguration({ classId: classItem.id })),
      );
      res.json(statuses);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/classes/:id", requireAuth, async (req, res, next) => {
    try {
      const classData = await storage.getClass(parseIdParam(req.params.id));
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
      const gradingConfiguration = await getClassGradingConfiguration({
        classId: newClass.id,
        subjectIds: [],
        autoAttach: true,
      });
      res.status(201).json({ ...newClass, gradingConfiguration });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/classes/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const updated = await storage.updateClass(parseIdParam(req.params.id), req.body);
      if (!updated) {
        return res.status(404).json({ message: "Class not found" });
      }
      const gradingConfiguration = await getClassGradingConfiguration({
        classId: updated.id,
        autoAttach: true,
      });
      res.json({ ...updated, gradingConfiguration });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/classes/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const classData = await storage.getClass(parseIdParam(req.params.id));
      if (!classData) {
        return res.status(404).json({ message: "Class not found" });
      }
      if (schoolId && classData.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteClass(parseIdParam(req.params.id));
      res.json({ message: "Class deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/classes/:id/student-count", requireAuth, async (req, res, next) => {
    try {
      const count = await storage.getStudentCountByClass(parseIdParam(req.params.id));
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
      const classId = parseIdParam(req.params.id);
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
      const classId = parseIdParam(req.params.id);
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
      const gradingConfiguration = await getClassGradingConfiguration({
        classId,
        subjectIds: Array.from(selected),
        autoAttach: true,
      });
      res.status(201).json({
        ...(await buildClassSubjectManagementPayload(classId)),
        gradingConfiguration,
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/classes/:id/subjects/:subjectId", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const classId = parseIdParam(req.params.id);
      const classData = await storage.getClass(classId);
      if (!classData) {
        return res.status(404).json({ message: "Class not found" });
      }
      if (schoolId && classData.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const subjectId = parseIdParam(req.params.subjectId);
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
      const classId = parseIdParam(req.params.id);
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
      const gradingConfiguration = await getClassGradingConfiguration({
        classId,
        subjectIds: selected,
        autoAttach: true,
      });
      res.json({
        message: "Class subjects updated",
        data: await buildClassSubjectManagementPayload(classId),
        gradingConfiguration,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/classes/:id/migrate", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const fromClassId = parseIdParam(req.params.id);
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
      const parent = await storage.getParent(parseIdParam(req.params.id));
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

  app.put("/api/parents/:id", requireAuth, requirePermission("parents.edit"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req) || currentUser.schoolId;
      const parentId = parseIdParam(req.params.id);
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
      const parentId = parseIdParam(req.params.id);
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
      const parentId = parseIdParam(req.params.id);
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
      const parentId = parseIdParam(req.params.id);
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
      const parentId = parseIdParam(req.params.id);
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
      const parentId = parseIdParam(req.params.id);
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
        schoolMap = new Map(orgSchools.map(s => [s.id, s.name]));
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
      const studentList = await storage.getStudentsByClass(parseIdParam(req.params.classId));
      res.json(studentList);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/students/by-parent/:parentId", requireAuth, async (req, res, next) => {
    try {
      const requestedParentId = parseIdParam(req.params.parentId);
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
      const student = await storage.getStudent(parseIdParam(req.params.id));
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

  app.put("/api/students/:id", requireAuth, requirePermission("students.edit"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req) || currentUser.schoolId;
      const studentId = parseIdParam(req.params.id);
      const existing = await storage.getStudent(studentId);
      if (!existing) {
        return res.status(404).json({ message: "Student not found" });
      }
      if (schoolId && existing.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { schoolId: _bodySchoolId, ...studentUpdateBody } = (req.body || {}) as Record<string, unknown>;
      const normalizedData: any = { ...studentUpdateBody };
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
      const studentId = parseIdParam(req.params.id);

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
      const id = parseIdParam(req.params.id);
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
      const studentId = parseIdParam(req.params.id);
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

  const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      if (!file.mimetype?.startsWith("image/")) return callback(new Error("Only image files are allowed"));
      callback(null, true);
    },
  });

  type PhotoRecord = {
    id: number;
    schoolId: number | null;
    firstName: string;
    lastName: string;
    photo?: string | null;
    admissionNo?: string | null;
    staffNo?: string | null;
    organizationId?: number | null;
    username?: string | null;
  };

  async function getPhotoLimitBytes(schoolId: number): Promise<number> {
    const school = await storage.getSchool(schoolId);
    if (school?.organizationId) {
      const org = await storage.getOrganization(school.organizationId);
      if (org?.photoUploadLimitMB) return org.photoUploadLimitMB * 1024 * 1024;
    }
    return 5 * 1024 * 1024;
  }

  async function assertPhotoRecordAccess(req: Request, record: PhotoRecord): Promise<number> {
    if (!record.schoolId) throw new Error("Record has no school context");
    const currentUser = req.user as User;
    const requestedSchoolId = getSchoolContext(req);
    if (requestedSchoolId && requestedSchoolId !== record.schoolId) throw new Error("Access denied");
    if (currentUser.role !== "org_admin" && currentUser.schoolId !== record.schoolId) throw new Error("Access denied");
    if (currentUser.role === "org_admin" && currentUser.organizationId) {
      const school = await storage.getSchool(record.schoolId);
      if (!school || school.organizationId !== currentUser.organizationId) throw new Error("Access denied");
    }
    return record.schoolId;
  }

  function photoExtension(file: Express.Multer.File): string {
    const mimeMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/heic": "heic",
      "image/heif": "heif",
    };
    if (mimeMap[file.mimetype]) return mimeMap[file.mimetype];
    const rawExt = path.extname(file.originalname || "").toLowerCase().replace(".", "");
    return /^[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : "jpg";
  }

  function safeProfileFileName(record: PhotoRecord, entity: "student" | "staff" | "parent" | "user", extension: string): string {
    const reference = entity === "student" ? record.admissionNo : entity === "staff" ? record.staffNo : entity === "user" ? `HQ-${record.id}` : `PARENT-${record.id}`;
    const base = `${record.firstName}_${record.lastName}_${reference || record.id}`
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return `${base || `${entity}_${record.id}`}.${extension}`;
  }

  async function saveProfilePhoto(args: {
    req: Request;
    record: PhotoRecord;
    entity: "student" | "staff" | "parent";
    folder: string;
    update: (photo: string) => Promise<unknown>;
  }): Promise<string> {
    if (!args.req.file) throw new Error("No image file uploaded");
    const schoolId = await assertPhotoRecordAccess(args.req, args.record);
    const limitBytes = await getPhotoLimitBytes(schoolId);
    if (args.req.file.size > limitBytes) throw new Error(`Photo exceeds the ${Math.round(limitBytes / (1024 * 1024))}MB upload limit`);
    const extension = photoExtension(args.req.file);
    const objectRoot = path.resolve(process.env.LOCAL_OBJECT_DIR || "/var/lib/fcgs/object_storage");
    const objectName = `uploads/${args.folder}/${args.record.id}-${Date.now()}.${extension}`;
    const absolutePath = path.resolve(objectRoot, objectName);
    if (!absolutePath.startsWith(`${objectRoot}${path.sep}`)) throw new Error("Invalid photo path");
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, args.req.file.buffer);
    const photoPath = `/objects/${objectName}`;
    await args.update(photoPath);
    return photoPath;
  }

  async function downloadProfilePhoto(res: Response, record: PhotoRecord, entity: "student" | "staff" | "parent" | "user") {
    if (!record.photo || !record.photo.startsWith("/objects/")) return res.status(404).json({ message: "No profile photo is available" });
    const objectRoot = path.resolve(process.env.LOCAL_OBJECT_DIR || "/var/lib/fcgs/object_storage");
    const relativePath = record.photo.replace(/^\/objects\//, "");
    const absolutePath = path.resolve(objectRoot, relativePath);
    if (!absolutePath.startsWith(`${objectRoot}${path.sep}`)) return res.status(400).json({ message: "Invalid photo path" });
    try {
      await fs.access(absolutePath);
    } catch {
      return res.status(404).json({ message: "Profile photo file was not found" });
    }
    const extension = path.extname(absolutePath).replace(".", "") || "jpg";
    return res.download(absolutePath, safeProfileFileName(record, entity, extension));
  }

  app.post("/api/students/:id/photo", requireAuth, requireAnyPermission("students.edit", "students.manage_photo"), photoUpload.single("photo"), async (req, res, next) => {
    try {
      const record = await storage.getStudent(parseIdParam(req.params.id));
      if (!record) return res.status(404).json({ message: "Student not found" });
      const photo = await saveProfilePhoto({ req, record, entity: "student", folder: "student-photos", update: (value) => storage.updateStudent(record.id, { photo: value }) });
      res.json({ photo });
    } catch (error) { next(error); }
  });

  app.get("/api/students/:id/photo/download", requireAuth, requireAnyPermission("students.view", "students.edit", "students.manage_photo"), async (req, res, next) => {
    try {
      const record = await storage.getStudent(parseIdParam(req.params.id));
      if (!record) return res.status(404).json({ message: "Student not found" });
      await assertPhotoRecordAccess(req, record);
      return downloadProfilePhoto(res, record, "student");
    } catch (error) { next(error); }
  });

  app.post("/api/staff/:id/photo", requireAuth, requireAnyPermission("staff.edit", "staff.manage_photo"), photoUpload.single("photo"), async (req, res, next) => {
    try {
      const record = await storage.getStaff(parseIdParam(req.params.id));
      if (!record) return res.status(404).json({ message: "Staff member not found" });
      const photo = await saveProfilePhoto({ req, record, entity: "staff", folder: "staff-photos", update: (value) => storage.updateStaff(record.id, { photo: value }) });
      res.json({ photo });
    } catch (error) { next(error); }
  });

  app.get("/api/staff/:id/photo/download", requireAuth, requireAnyPermission("staff.view", "staff.edit", "staff.manage_photo"), async (req, res, next) => {
    try {
      const record = await storage.getStaff(parseIdParam(req.params.id));
      if (!record) return res.status(404).json({ message: "Staff member not found" });
      await assertPhotoRecordAccess(req, record);
      return downloadProfilePhoto(res, record, "staff");
    } catch (error) { next(error); }
  });

  app.post("/api/parents/:id/photo", requireAuth, requireAnyPermission("parents.edit", "parents.manage_photo"), photoUpload.single("photo"), async (req, res, next) => {
    try {
      const record = await storage.getParent(parseIdParam(req.params.id));
      if (!record) return res.status(404).json({ message: "Parent not found" });
      const photo = await saveProfilePhoto({ req, record, entity: "parent", folder: "parent-photos", update: (value) => storage.updateParent(record.id, { photo: value }) });
      res.json({ photo });
    } catch (error) { next(error); }
  });

  app.get("/api/parents/:id/photo/download", requireAuth, requireAnyPermission("parents.view", "parents.edit", "parents.manage_photo"), async (req, res, next) => {
    try {
      const record = await storage.getParent(parseIdParam(req.params.id));
      if (!record) return res.status(404).json({ message: "Parent not found" });
      await assertPhotoRecordAccess(req, record);
      return downloadProfilePhoto(res, record, "parent");
    } catch (error) { next(error); }
  });

  app.post("/api/users/:id/photo", requireAuth, requireAnyPermission("users.edit", "users.manage_photo"), photoUpload.single("photo"), async (req, res, next) => {
    try {
      const record = await storage.getUser(parseIdParam(req.params.id));
      if (!record || record.role !== "org_admin") return res.status(404).json({ message: "HQ staff member not found" });
      const current = req.user as User;
      if (current.role !== "org_admin" || !current.organizationId || record.organizationId !== current.organizationId) return res.status(403).json({ message: "Access denied" });
      if (!req.file) return res.status(400).json({ message: "No image file uploaded" });
      const org = await storage.getOrganization(current.organizationId);
      const limitBytes = (org?.photoUploadLimitMB || 5) * 1024 * 1024;
      if (req.file.size > limitBytes) return res.status(400).json({ message: `Photo exceeds the ${Math.round(limitBytes / (1024 * 1024))}MB upload limit` });
      const extension = photoExtension(req.file);
      const objectRoot = path.resolve(process.env.LOCAL_OBJECT_DIR || "/var/lib/fcgs/object_storage");
      const objectName = `uploads/hq-staff-photos/${record.id}-${Date.now()}.${extension}`;
      const absolutePath = path.resolve(objectRoot, objectName);
      if (!absolutePath.startsWith(`${objectRoot}${path.sep}`)) return res.status(400).json({ message: "Invalid photo path" });
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, req.file.buffer);
      const photo = `/objects/${objectName}`;
      await storage.updateUser(record.id, { photo });
      res.json({ photo });
    } catch (error) { next(error); }
  });

  app.get("/api/users/:id/photo/download", requireAuth, requireAnyPermission("users.view", "users.edit", "users.manage_photo"), async (req, res, next) => {
    try {
      const record = await storage.getUser(parseIdParam(req.params.id));
      if (!record || record.role !== "org_admin") return res.status(404).json({ message: "HQ staff member not found" });
      const current = req.user as User;
      if (current.role !== "org_admin" || !current.organizationId || record.organizationId !== current.organizationId) return res.status(403).json({ message: "Access denied" });
      return downloadProfilePhoto(res, { ...record, schoolId: null, firstName: record.firstName || record.username, lastName: record.lastName || "", organizationId: record.organizationId }, "user");
    } catch (error) { next(error); }
  });

  app.put("/api/students/:id/subjects", requireAuth, requireRole("school_admin", "org_admin", "teacher"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req);
      const studentId = parseIdParam(req.params.id);
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
                phone: student.parentPhone?.trim() || "",
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
      const studentId = parseIdParam(req.params.id);
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
      const studentId = parseIdParam(req.params.id);
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
      const studentId = parseIdParam(req.params.id);
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
      const studentId = parseIdParam(req.params.id);
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
      const subject = await storage.getSubject(parseIdParam(req.params.id));
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
      const subject = await storage.getSubject(parseIdParam(req.params.id));
      if (!subject) {
        return res.status(404).json({ message: "Subject not found" });
      }
      if (schoolId && subject.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const validated = await validateSubjectPayloadForSchool(subject.schoolId, req.body, res, subject);
      if (!validated) return;
      const { name, shortCode, syllabusCode, subjectType, description, streamId, streamIds } = req.body;
      const updateData: Partial<z.infer<typeof insertSubjectSchema>> = {};
      if (name !== undefined) updateData.name = name;
      if (shortCode !== undefined) updateData.shortCode = shortCode;
      if (syllabusCode !== undefined) updateData.syllabusCode = syllabusCode;
      if (subjectType !== undefined) updateData.subjectType = subjectType;
      if (description !== undefined) updateData.description = description;
      if (streamId !== undefined) updateData.streamId = streamId;
      if (streamIds !== undefined) updateData.streamIds = streamIds;

      const updated = await storage.updateSubject(parseIdParam(req.params.id), updateData);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/subjects/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const subject = await storage.getSubject(parseIdParam(req.params.id));
      if (!subject) {
        return res.status(404).json({ message: "Subject not found" });
      }
      if (schoolId && subject.schoolId !== schoolId) {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteSubject(parseIdParam(req.params.id));
      res.json({ message: "Subject deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/grade-profile-settings", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const rows = await db.select().from(gradeProfileSettings).where(eq(gradeProfileSettings.schoolId, schoolId));
      res.json(rows.filter((row: any) => ACTIVE_GRADE_PROFILE_KEY_SET.has(String(row.gradeLevel || ""))));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/grade-profile-settings/:gradeLevel", requireAuth, requireRole("school_admin", "org_admin", "quality_control_officer"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const gradeLevel = String(req.params.gradeLevel || "").trim();
      const pointsDirection = String(req.body?.pointsDirection || "").trim();
      if (!ACTIVE_GRADE_PROFILE_KEY_SET.has(gradeLevel)) {
        return res.status(400).json({ message: "Only exact current grading profiles can be configured" });
      }
      await ensureGradeProfileAllowedForSchool(schoolId, gradeLevel);
      if (!POINTS_DIRECTION_VALUES.includes(pointsDirection as any)) {
        return res.status(400).json({ message: "Points direction must be higher_is_better or lower_is_better" });
      }
      const [saved] = await db.insert(gradeProfileSettings).values({
        schoolId,
        gradeLevel: gradeLevel as any,
        pointsDirection: pointsDirection as any,
        updatedByUserId: Number((req.user as any)?.id) || null,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [gradeProfileSettings.schoolId, gradeProfileSettings.gradeLevel],
        set: {
          pointsDirection: pointsDirection as any,
          configurationVersion: sql`${gradeProfileSettings.configurationVersion} + 1`,
          updatedByUserId: Number((req.user as any)?.id) || null,
          updatedAt: new Date(),
        },
      }).returning();
      res.json(saved);
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
      let filtered = schoolId ? gradeList.filter(g => g.schoolId === schoolId) : gradeList;
      if (gradeLevel) filtered = filterItemsByGradeProfileKey(filtered, gradeLevel);
      if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(g =>
          g.gradeName.toLowerCase().includes(searchLower) ||
          (g.gradeStatus && g.gradeStatus.toLowerCase().includes(searchLower))
        );
      }
      filtered.sort((a: any, b: any) => Number(a.rankOrder || Number.MAX_SAFE_INTEGER) - Number(b.rankOrder || Number.MAX_SAFE_INTEGER));
      const total = filtered.length;
      const start = (page - 1) * perPage;
      const items = filtered.slice(start, start + perPage);
      res.json({ items, total, page, perPage, hasPrev: page > 1, hasNext: start + perPage < total });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/grades", requireAuth, requireRole("school_admin", "org_admin", "teacher", "quality_control_officer"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      if (!schoolId) return res.status(400).json({ message: "School context required" });
      const normalized = normalizeRequiredGradePayload(req.body);
      await ensureGradeProfileAllowedForSchool(schoolId, normalized.gradeLevel, normalized.gradeType || null);
      await ensureUniqueGradeRankOrder({
        schoolId,
        gradeLevel: normalized.gradeLevel,
        gradeType: normalized.gradeType || null,
        rankOrder: normalized.rankOrder,
      });
      const data = insertGradeSchema.parse({ ...normalized, schoolId });
      const newGrade = await storage.createGrade(data);
      await bumpGradeProfileConfigurationVersion(schoolId, normalized.gradeLevel);
      res.status(201).json(newGrade);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid grade configuration", errors: error.errors });
      return res.status(400).json({ message: error?.message || "Unable to create grade" });
    }
  });

  app.put("/api/grades/:id", requireAuth, requireRole("school_admin", "org_admin", "teacher", "quality_control_officer"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const gradeId = parseIdParam(req.params.id);
      const grade = await storage.getGrade(gradeId);
      if (!grade) return res.status(404).json({ message: "Grade not found" });
      if (schoolId && grade.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      const normalized = normalizeRequiredGradePayload(req.body, grade);
      await ensureGradeProfileAllowedForSchool(Number(grade.schoolId), normalized.gradeLevel, normalized.gradeType ?? grade.gradeType ?? null);
      await ensureUniqueGradeRankOrder({
        schoolId: Number(grade.schoolId),
        gradeLevel: normalized.gradeLevel,
        gradeType: normalized.gradeType ?? grade.gradeType ?? null,
        rankOrder: normalized.rankOrder,
        excludeGradeId: gradeId,
      });
      const updateData: Record<string, any> = {};
      for (const key of ["gradeName", "gradeLevel", "classIds", "appliesAll", "lowerLimit", "upperLimit", "gradePoints", "gradeStatus", "gradeType", "rankOrder"]) {
        if ((normalized as any)[key] !== undefined) updateData[key] = (normalized as any)[key];
      }
      const updated = await storage.updateGrade(gradeId, updateData);
      await Promise.all(Array.from(new Set([String(grade.gradeLevel || ""), String(normalized.gradeLevel || "")]))
        .map((gradeLevel) => bumpGradeProfileConfigurationVersion(Number(grade.schoolId), gradeLevel)));
      res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ message: error?.message || "Unable to update grade" });
    }
  });

  app.delete("/api/grades/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const grade = await storage.getGrade(parseIdParam(req.params.id));
      if (!grade) return res.status(404).json({ message: "Grade not found" });
      if (schoolId && grade.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteGrade(parseIdParam(req.params.id));
      await bumpGradeProfileConfigurationVersion(Number(grade.schoolId), grade.gradeLevel);
      res.json({ message: "Grade deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/assessments/by-class/:classId", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const classId = parseIdParam(req.params.classId);
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
      const scoped = await getScopedAssessmentOrRespond(req, res, parseIdParam(req.params.id));
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
      const scoped = await getScopedAssessmentOrRespond(req, res, parseIdParam(req.params.assessmentId));
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

      const studentId = parseIdParam(req.params.studentId);
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
      const date = routeParam(req.params.date) || new Date().toISOString().split('T')[0];
      const records = await storage.getAttendanceByClass(parseIdParam(req.params.classId), date);
      res.json(records);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/attendance/by-student/:studentId", requireAuth, async (req, res, next) => {
    try {
      const records = await storage.getAttendanceByStudent(parseIdParam(req.params.studentId));
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

        const classIdsToMark = Array.from(new Set<number>(parsed.map((rec: any) => Number(rec.classId)).filter((classId: number) => Number.isFinite(classId))));
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
      const classParam = routeParam(req.params.classId);
      const showAllClasses = classParam === "all";
      const classId = showAllClasses ? null : Number.parseInt(classParam, 10);
      const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
      let from = routeParam(req.params.from) || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      let to = routeParam(req.params.to) || new Date().toISOString().split('T')[0];
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
      const classId = parseIdParam(req.params.classId);
      const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
      let from = routeParam(req.params.from) || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      let to = routeParam(req.params.to) || new Date().toISOString().split('T')[0];
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
      const updated = await storage.updateAttendance(parseIdParam(req.params.id), req.body);
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
      const id = parseIdParam(req.params.id);
      const updated = await storage.updateClinicRecord(id, req.body);
      if (!updated) return res.status(404).json({ message: "Record not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/clinic/:id", requireAuth, requireRole("school_admin"), async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id);
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
      const org = await storage.getOrganization(parseIdParam(req.params.id));
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
      const updated = await storage.updateOrganization(parseIdParam(req.params.id), data);
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
      const school = await storage.getSchool(parseIdParam(req.params.id));
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
      const updated = await storage.updateSchool(parseIdParam(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "School not found" });
      logActivity(req, { action: "update", category: "schools", description: `Updated school settings: ${updated.name}`, targetType: "school", targetId: updated.id, targetName: updated.name });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/schools/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const schoolId = parseIdParam(req.params.id);
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
      const schoolId = parseIdParam(req.params.id);
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
      const schoolId = parseIdParam(req.params.id);
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
      const schoolId = parseIdParam(req.params.id);
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
      const updated = await storage.markNotificationRead(parseIdParam(req.params.id));
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
      const copy = await storage.getLibraryBookCopyByQr(routeParam(req.params.qrCode));
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

      const existingAttachmentUrls = Array.isArray(copy.attachmentUrls)
        ? copy.attachmentUrls.filter((url): url is string => typeof url === "string")
        : [];
      const updated = await storage.updateLibraryBookCopy(copyId, {
        attachmentUrls: [...existingAttachmentUrls, attachmentUrl],
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
      const existingAttachmentUrls = Array.isArray(copy.attachmentUrls)
        ? copy.attachmentUrls.filter((url): url is string => typeof url === "string")
        : [];
      if (!existingAttachmentUrls.includes(attachmentUrl)) {
        return res.status(404).json({ message: "Attachment not found on this copy" });
      }

      const updatedUrls = existingAttachmentUrls.filter((url) => url !== attachmentUrl);
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
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const classIdText = requestText(req.query.classId);
      const classId = classIdText ? Number.parseInt(classIdText, 10) : undefined;
      if (classIdText && (!classId || Number.isNaN(classId))) {
        return res.status(400).json({ message: "Invalid class ID" });
      }
      if (classId && !(await ensureClassInSchool(classId, schoolId, res))) return;

      const slots = await storage.getTimetableSlots(schoolId, classId);
      res.json(slots);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/timetable", requireAuth, requireRole("school_admin", "org_admin", "teacher"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const body = (req.body || {}) as Record<string, unknown>;
      const data = insertTimetableSlotSchema.parse({
        ...body,
        schoolId,
        classId: Number(body.classId),
        subjectId: Number(body.subjectId),
        teacherId: body.teacherId === null || body.teacherId === undefined || body.teacherId === ""
          ? null
          : Number(body.teacherId),
        dayOfWeek: Number(body.dayOfWeek),
        startTime: requestText(body.startTime),
        endTime: requestText(body.endTime),
        room: requestText(body.room).trim() || null,
      });

      if (data.dayOfWeek < 1 || data.dayOfWeek > 5) {
        return res.status(400).json({ message: "Day of week must be between Monday and Friday" });
      }
      if (data.startTime >= data.endTime) {
        return res.status(400).json({ message: "End time must be later than start time" });
      }
      if (!(await ensureClassInSchool(data.classId, schoolId, res))) return;
      if (!(await ensureSubjectInSchool(data.subjectId, schoolId, res))) return;
      if (data.teacherId && !(await ensureStaffInSchool(data.teacherId, schoolId, res))) return;

      const newSlot = await storage.createTimetableSlot(data);
      res.status(201).json(newSlot);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/timetable/:id", requireAuth, requireRole("school_admin", "org_admin", "teacher"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const slotId = parseIdParam(req.params.id);
      const existing = await storage.getTimetableSlot(slotId);
      if (!existing) return res.status(404).json({ message: "Slot not found" });
      if (existing.schoolId !== schoolId) return res.status(403).json({ message: "Slot not in school context" });

      const body = (req.body || {}) as Record<string, unknown>;
      const data = insertTimetableSlotSchema.parse({
        schoolId,
        classId: body.classId === undefined ? existing.classId : Number(body.classId),
        subjectId: body.subjectId === undefined ? existing.subjectId : Number(body.subjectId),
        teacherId: body.teacherId === undefined
          ? existing.teacherId
          : body.teacherId === null || body.teacherId === "" ? null : Number(body.teacherId),
        dayOfWeek: body.dayOfWeek === undefined ? existing.dayOfWeek : Number(body.dayOfWeek),
        startTime: body.startTime === undefined ? existing.startTime : requestText(body.startTime),
        endTime: body.endTime === undefined ? existing.endTime : requestText(body.endTime),
        room: body.room === undefined ? existing.room : requestText(body.room).trim() || null,
        term: body.term === undefined ? existing.term : requestText(body.term).trim() || null,
        year: body.year === undefined || body.year === null || body.year === "" ? existing.year : Number(body.year),
      });

      if (data.dayOfWeek < 1 || data.dayOfWeek > 5) {
        return res.status(400).json({ message: "Day of week must be between Monday and Friday" });
      }
      if (data.startTime >= data.endTime) {
        return res.status(400).json({ message: "End time must be later than start time" });
      }
      if (!(await ensureClassInSchool(data.classId, schoolId, res))) return;
      if (!(await ensureSubjectInSchool(data.subjectId, schoolId, res))) return;
      if (data.teacherId && !(await ensureStaffInSchool(data.teacherId, schoolId, res))) return;

      const updated = await storage.updateTimetableSlot(slotId, data);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/timetable/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;

      const slotId = parseIdParam(req.params.id);
      const existing = await storage.getTimetableSlot(slotId);
      if (!existing) return res.status(404).json({ message: "Slot not found" });
      if (existing.schoolId !== schoolId) return res.status(403).json({ message: "Slot not in school context" });

      await storage.deleteTimetableSlot(slotId);
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
      const updated = await storage.updateLogbookEntry(parseIdParam(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Entry not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/logbook/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      await storage.deleteLogbookEntry(parseIdParam(req.params.id));
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
      const attendanceId = parseIdParam(req.params.id);
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
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const items = await storage.getPosItems(schoolId);
      res.json(items);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/pos/items/:id", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const item = await storage.getPosItem(parseIdParam(req.params.id));
      if (!item) return res.status(404).json({ message: "Item not found" });
      if (item.schoolId !== schoolId) return res.status(403).json({ message: "Item not in school context" });
      res.json(item);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/pos/items", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const body = (req.body || {}) as Record<string, unknown>;
      const data = insertPosItemSchema.parse({
        ...body,
        schoolId,
        stockQty: body.stockQty === undefined ? 0 : Number(body.stockQty),
      });
      if ((data.stockQty ?? 0) < 0) return res.status(400).json({ message: "Stock quantity cannot be negative" });
      const price = Number(data.price);
      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({ message: "Price must be a valid non-negative amount" });
      }
      const newItem = await storage.createPosItem(data);
      res.status(201).json(newItem);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/pos/items/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const itemId = parseIdParam(req.params.id);
      const existing = await storage.getPosItem(itemId);
      if (!existing) return res.status(404).json({ message: "Item not found" });
      if (existing.schoolId !== schoolId) return res.status(403).json({ message: "Item not in school context" });

      const { schoolId: _ignoredSchoolId, ...body } = (req.body || {}) as Record<string, unknown>;
      const normalized = {
        ...body,
        ...(body.stockQty === undefined ? {} : { stockQty: Number(body.stockQty) }),
      };
      const data = insertPosItemSchema.partial().parse(normalized);
      if (data.stockQty !== undefined && data.stockQty !== null && data.stockQty < 0) {
        return res.status(400).json({ message: "Stock quantity cannot be negative" });
      }
      if (data.price !== undefined) {
        const price = Number(data.price);
        if (!Number.isFinite(price) || price < 0) {
          return res.status(400).json({ message: "Price must be a valid non-negative amount" });
        }
      }
      const updated = await storage.updatePosItem(itemId, data);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/pos/items/:id", requireAuth, requireRole("school_admin", "org_admin"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const itemId = parseIdParam(req.params.id);
      const existing = await storage.getPosItem(itemId);
      if (!existing) return res.status(404).json({ message: "Item not found" });
      if (existing.schoolId !== schoolId) return res.status(403).json({ message: "Item not in school context" });
      await storage.deletePosItem(itemId);
      res.json({ message: "Item deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/pos/sales", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const sales = await storage.getPosSales(schoolId);
      res.json(sales);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/pos/sales", requireAuth, requireRole("school_admin", "org_admin", "teacher"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const parsed = posSaleRequestSchema.parse(req.body);
      if (parsed.studentId && !(await ensureStudentInSchool(parsed.studentId, schoolId, res))) return;

      const currentUser = req.user as User;
      const [seller] = await db.select({ id: staffTable.id, schoolId: staffTable.schoolId })
        .from(staffTable)
        .where(eq(staffTable.userId, currentUser.id))
        .limit(1);
      if (seller && seller.schoolId !== schoolId) {
        return res.status(403).json({ message: "Seller not in school context" });
      }

      const result = await storage.createPosSaleWithItems({
        schoolId,
        paymentMethod: parsed.paymentMethod,
        customerName: parsed.customerName,
        studentId: parsed.studentId,
        soldBy: seller?.id || null,
        items: parsed.items,
      });
      res.status(201).json({ ...result.sale, items: result.items });
    } catch (error) {
      if (error instanceof PosSaleProcessingError) {
        const status = error.code === "INSUFFICIENT_STOCK" ? 409 : 400;
        return res.status(status).json({ message: error.message, code: error.code });
      }
      next(error);
    }
  });

  app.get("/api/pos/sales/:id/items", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const saleId = parseIdParam(req.params.id);
      const sale = await storage.getPosSale(saleId);
      if (!sale) return res.status(404).json({ message: "Sale not found" });
      if (sale.schoolId !== schoolId) return res.status(403).json({ message: "Sale not in school context" });
      const items = await storage.getPosSaleItems(saleId);
      res.json(items);
    } catch (error) {
      next(error);
    }
  });

  const newsletterTargetSelectionSchema = z.object({
    targetAudience: z.enum(["all", "parents", "students", "staff"]).default("all"),
    targetScope: z.enum(["all", "streams", "classes", "individuals"]).default("all"),
    targetStreamIds: z.array(z.coerce.number().int().positive()).max(500).default([]),
    targetClassIds: z.array(z.coerce.number().int().positive()).max(1000).default([]),
    targetStudentIds: z.array(z.coerce.number().int().positive()).max(10000).default([]),
    targetStaffIds: z.array(z.coerce.number().int().positive()).max(5000).default([]),
  }).superRefine((value, ctx) => {
    if (value.targetAudience === "all" && value.targetScope !== "all") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetScope"], message: "Everyone can only use the All scope" });
    }
    if (value.targetAudience === "staff" && !["all", "individuals"].includes(value.targetScope)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetScope"], message: "Staff can be targeted as All Staff or selected staff members" });
    }
    if (value.targetScope === "streams" && value.targetStreamIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetStreamIds"], message: "Select at least one stream" });
    }
    if (value.targetScope === "classes" && value.targetClassIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetClassIds"], message: "Select at least one class" });
    }
    if (value.targetScope === "individuals") {
      const ids = value.targetAudience === "staff" ? value.targetStaffIds : value.targetStudentIds;
      if (ids.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [value.targetAudience === "staff" ? "targetStaffIds" : "targetStudentIds"], message: "Select at least one individual" });
      }
    }
  });

  type NewsletterTargetSelection = z.infer<typeof newsletterTargetSelectionSchema>;
  type NewsletterRecipientGroup = {
    recipientType: "parent" | "student" | "staff";
    recipients: Array<{ id: number; userId?: number | null; email?: string | null; phone?: string | null; name: string }>;
  };

  function uniquePositiveIds(values: unknown): number[] {
    return Array.from(new Set((Array.isArray(values) ? values : []).map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  }

  function normalizeNewsletterTargetSelection(value: NewsletterTargetSelection): NewsletterTargetSelection {
    const normalized: NewsletterTargetSelection = {
      targetAudience: value.targetAudience,
      targetScope: value.targetScope,
      targetStreamIds: uniquePositiveIds(value.targetStreamIds),
      targetClassIds: uniquePositiveIds(value.targetClassIds),
      targetStudentIds: uniquePositiveIds(value.targetStudentIds),
      targetStaffIds: uniquePositiveIds(value.targetStaffIds),
    };
    if (normalized.targetAudience === "all") normalized.targetScope = "all";
    if (normalized.targetScope !== "streams") normalized.targetStreamIds = [];
    if (normalized.targetScope !== "classes") normalized.targetClassIds = [];
    if (normalized.targetScope !== "individuals" || normalized.targetAudience === "staff") normalized.targetStudentIds = [];
    if (normalized.targetScope !== "individuals" || normalized.targetAudience !== "staff") normalized.targetStaffIds = [];
    return normalized;
  }

  function newsletterTargetFromRecord(record: any): NewsletterTargetSelection {
    return normalizeNewsletterTargetSelection(newsletterTargetSelectionSchema.parse({
      targetAudience: record?.targetAudience || "all",
      targetScope: record?.targetScope || "all",
      targetStreamIds: record?.targetStreamIds || [],
      targetClassIds: record?.targetClassIds || [],
      targetStudentIds: record?.targetStudentIds || [],
      targetStaffIds: record?.targetStaffIds || [],
    }));
  }

  async function resolveNewsletterRecipientGroups(
    currentUser: User,
    req: Request,
    schoolId: number,
    target: NewsletterTargetSelection,
  ): Promise<NewsletterRecipientGroup[]> {
    const recipientTypes: NewsletterRecipientGroup["recipientType"][] = target.targetAudience === "all"
      ? ["parent", "student", "staff"]
      : [target.targetAudience === "parents" ? "parent" : target.targetAudience === "students" ? "student" : "staff"];

    const groups: NewsletterRecipientGroup[] = [];
    for (const recipientType of recipientTypes) {
      const targetAudience = target.targetAudience === "all" ? "all" : target.targetScope;
      const { recipients } = await resolveCommunicationRecipients(currentUser, req, {
        recipientType,
        recipientIds: [],
        targetAudience,
        streamIds: target.targetStreamIds,
        classIds: target.targetClassIds,
        studentIds: target.targetStudentIds,
        staffIds: target.targetStaffIds,
        schoolId,
      } as any);
      const deduplicated = Array.from(new Map(recipients.map((recipient) => [recipient.id, recipient])).values());
      groups.push({ recipientType, recipients: deduplicated });
    }
    return groups;
  }

  function newsletterRecipientCounts(groups: NewsletterRecipientGroup[]) {
    const allRecipients = groups.flatMap((group) => group.recipients);
    return {
      total: allRecipients.length,
      email: allRecipients.filter((recipient) => !!recipient.email).length,
      sms: allRecipients.filter((recipient) => !!recipient.phone).length,
      inApp: new Set(allRecipients.map((recipient) => Number(recipient.userId)).filter((id) => Number.isInteger(id) && id > 0)).size,
    };
  }

  // Newsletter routes
  app.get("/api/newsletters", requireAuth, requirePermission("newsletters.view"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const newsletters = await storage.getNewsletters(schoolId);
      res.json(newsletters);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/newsletters/recipient-counts", requireAuth, requireAnyPermission("newsletters.view", "newsletters.create", "newsletters.edit"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const requestedAudience = String(req.query.audience || "all").toLowerCase();
      const targetAudience: NewsletterTargetSelection["targetAudience"] = requestedAudience === "parents"
        ? "parents"
        : requestedAudience === "students"
          ? "students"
          : requestedAudience === "staff"
            ? "staff"
            : "all";
      const target = normalizeNewsletterTargetSelection({
        targetAudience,
        targetScope: "all",
        targetStreamIds: [],
        targetClassIds: [],
        targetStudentIds: [],
        targetStaffIds: [],
      });
      const groups = await resolveNewsletterRecipientGroups(currentUser, req, schoolId, target);
      res.json(newsletterRecipientCounts(groups));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/newsletters/recipient-preview", requireAuth, requireAnyPermission("newsletters.create", "newsletters.edit"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const target = normalizeNewsletterTargetSelection(newsletterTargetSelectionSchema.parse(req.body || {}));
      const groups = await resolveNewsletterRecipientGroups(currentUser, req, schoolId, target);
      res.json(newsletterRecipientCounts(groups));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/newsletters", requireAuth, requirePermission("newsletters.create"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const { schoolId: _ignoredSchoolId, status: _ignoredStatus, publishedRecipientUserIds: _ignoredRecipientSnapshot, ...body } = (req.body || {}) as Record<string, unknown>;
      const target = normalizeNewsletterTargetSelection(newsletterTargetSelectionSchema.parse(body));
      const data = insertNewsletterSchema.parse({
        ...body,
        ...target,
        schoolId,
        isPublished: false,
        publishDate: null,
        publishedRecipientUserIds: [],
      });
      const newNewsletter = await storage.createNewsletter(data);
      res.status(201).json(newNewsletter);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/newsletters/:id", requireAuth, requirePermission("newsletters.edit"), async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const newsletterId = parseIdParam(req.params.id);
      const existing = await storage.getNewsletterById(newsletterId);
      if (!existing) return res.status(404).json({ message: "Newsletter not found" });
      if (existing.schoolId !== schoolId) return res.status(403).json({ message: "Newsletter not in school context" });

      const { schoolId: _ignoredSchoolId, createdBy: _ignoredCreatedBy, publishedRecipientUserIds: _ignoredRecipientSnapshot, status, ...body } = (req.body || {}) as Record<string, unknown>;
      const target = normalizeNewsletterTargetSelection(newsletterTargetSelectionSchema.parse({
        targetAudience: body.targetAudience ?? existing.targetAudience ?? "all",
        targetScope: body.targetScope ?? existing.targetScope ?? "all",
        targetStreamIds: body.targetStreamIds ?? existing.targetStreamIds ?? [],
        targetClassIds: body.targetClassIds ?? existing.targetClassIds ?? [],
        targetStudentIds: body.targetStudentIds ?? existing.targetStudentIds ?? [],
        targetStaffIds: body.targetStaffIds ?? existing.targetStaffIds ?? [],
      }));
      const legacyStatus = requestText(status).toLowerCase();
      const publishRequested = body.isPublished === true || legacyStatus === "published";
      const unpublishRequested = body.isPublished === false || legacyStatus === "draft";
      const normalizedBody: Record<string, unknown> = { ...body, ...target };
      if (publishRequested) {
        normalizedBody.isPublished = true;
        normalizedBody.publishDate = existing.publishDate || new Date();
      } else if (unpublishRequested) {
        normalizedBody.isPublished = false;
        normalizedBody.publishDate = null;
      } else if (body.publishDate) {
        normalizedBody.publishDate = new Date(requestText(body.publishDate));
      }
      let resolvedPublishGroups: NewsletterRecipientGroup[] | null = null;
      if (publishRequested) {
        resolvedPublishGroups = await resolveNewsletterRecipientGroups(currentUser, req, schoolId, target);
        const counts = newsletterRecipientCounts(resolvedPublishGroups);
        if (counts.total === 0) {
          return res.status(400).json({ message: "The selected newsletter audience has no recipients" });
        }
        normalizedBody.publishedRecipientUserIds = Array.from(new Set(
          resolvedPublishGroups.flatMap((group) => group.recipients)
            .map((recipient) => Number(recipient.userId))
            .filter((userId) => Number.isInteger(userId) && userId > 0),
        ));
      } else if (unpublishRequested) {
        normalizedBody.publishedRecipientUserIds = [];
      }
      const updateData = insertNewsletterSchema.partial().parse(normalizedBody);
      const updatedNewsletter = await storage.updateNewsletter(newsletterId, updateData);
      if (!updatedNewsletter) return res.status(404).json({ message: "Newsletter not found" });
      const updated = updatedNewsletter;

      const isNewlyPublished = publishRequested && !existing.isPublished && updated.schoolId;
      let communicationJobId: number | null = null;

      if (isNewlyPublished) {
        const channels: string[] = updated.channels || [];
        const publishSchoolId = updated.schoolId!;
        const audience = updated.targetAudience || "all";
        const targetScope = updated.targetScope || "all";
        const plainText = updated.content.replace(/<[^>]*>/g, '');
        const publishGroups = resolvedPublishGroups || await resolveNewsletterRecipientGroups(
          currentUser,
          req,
          publishSchoolId,
          newsletterTargetFromRecord(updated),
        );
        const shouldSendInApp = channels.includes("in_app") || channels.length === 0;
        const counts = newsletterRecipientCounts(publishGroups);
        const totalCount = (channels.includes("email") ? counts.email : 0)
          + (channels.includes("sms") ? counts.sms : 0)
          + (shouldSendInApp ? counts.inApp : 0);

        const job = await queueCommunicationBackgroundJob({
          schoolId: publishSchoolId,
          requestedBy: currentUser.id,
          jobType: "newsletter_publish",
          title: `Publish newsletter - ${updated.title}`,
          totalCount,
          metadata: { newsletterId: updated.id, channels, audience, targetScope, title: updated.title },
        }, async (jobId) => {
          let processed = 0;
          let sent = 0;
          let failed = 0;
          const errors: string[] = [];

          for (const group of publishGroups) {
            if (shouldSendInApp) {
              const inAppRecipients = group.recipients.filter((recipient) => !!recipient.userId);
              if (inAppRecipients.length > 0) {
                try {
                  await createInAppNotifications({
                    recipientType: group.recipientType,
                    recipientIds: inAppRecipients.map((recipient) => recipient.id),
                    title: updated.title,
                    message: updated.content,
                    channel: "newsletter",
                    schoolId: publishSchoolId,
                    actorUserId: currentUser.id,
                    link: "/my-newsletters",
                  });
                  sent += inAppRecipients.length;
                } catch (err) {
                  failed += inAppRecipients.length;
                  errors.push(`In-app ${group.recipientType}: ${err instanceof Error ? err.message : 'unknown error'}`);
                }
                processed += inAppRecipients.length;
                await updateCommunicationJobProgress(jobId, { processedCount: processed, successCount: sent, failedCount: failed });
              }
            }

            if (channels.includes("email")) {
              const emailRecipients = group.recipients
                .filter((recipient) => !!recipient.email)
                .map((recipient) => ({ email: recipient.email!, id: recipient.id, name: recipient.name }));
              if (emailRecipients.length > 0) {
                try {
                  const result = await communicationService.sendBulkEmail(emailRecipients, updated.title, updated.content, {
                    schoolId: publishSchoolId,
                    recipientType: group.recipientType,
                    sentBy: currentUser.id,
                    category: "newsletter",
                  });
                  sent += result.sent;
                  failed += result.failed;
                  if (result.errors) errors.push(...result.errors);
                } catch (err) {
                  failed += emailRecipients.length;
                  errors.push(`Email ${group.recipientType}: ${err instanceof Error ? err.message : 'unknown error'}`);
                }
                processed += emailRecipients.length;
                await updateCommunicationJobProgress(jobId, { processedCount: processed, successCount: sent, failedCount: failed });
              }
            }

            if (channels.includes("sms")) {
              const smsRecipients = group.recipients
                .filter((recipient) => !!recipient.phone)
                .map((recipient) => ({ phone: recipient.phone!, id: recipient.id, name: recipient.name }));
              if (smsRecipients.length > 0) {
                try {
                  const result = await communicationService.sendBulkSms(
                    smsRecipients,
                    plainText.length > 160 ? `${plainText.substring(0, 157)}...` : plainText,
                    {
                      schoolId: publishSchoolId,
                      recipientType: group.recipientType,
                      sentBy: currentUser.id,
                      category: "newsletter",
                    },
                  );
                  sent += result.sent;
                  failed += result.failed;
                  if (result.errors) errors.push(...result.errors);
                } catch (err) {
                  failed += smsRecipients.length;
                  errors.push(`SMS ${group.recipientType}: ${err instanceof Error ? err.message : 'unknown error'}`);
                }
                processed += smsRecipients.length;
                await updateCommunicationJobProgress(jobId, { processedCount: processed, successCount: sent, failedCount: failed });
              }
            }
          }

          return {
            processedCount: processed,
            successCount: sent,
            failedCount: failed,
            skippedCount: Math.max(0, totalCount - processed),
            errorSummary: errors.length ? errors.slice(0, 20).join("; ") : null,
            metadata: { sent, failed, errors: errors.slice(0, 10), audience, targetScope },
          };
        });
        communicationJobId = job.id;

        logActivity(req, {
          action: "create",
          category: "communication",
          description: `Queued published newsletter: ${updated.title}`,
          targetType: "communication_job",
          targetId: job.id,
          schoolId: publishSchoolId,
          metadata: { jobType: "newsletter_publish", newsletterId: updated.id, channels, audience, targetScope },
        });
      }


      res.json(communicationJobId ? { ...updated, communicationJobId, queued: true } : updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/newsletters/:id", requireAuth, requirePermission("newsletters.delete"), async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const newsletterId = parseIdParam(req.params.id);
      const existing = await storage.getNewsletterById(newsletterId);
      if (!existing) return res.status(404).json({ message: "Newsletter not found" });
      if (existing.schoolId !== schoolId) return res.status(403).json({ message: "Newsletter not in school context" });
      await storage.deleteNewsletter(newsletterId);
      res.json({ message: "Newsletter deleted successfully" });
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
      const id = parseIdParam(req.params.id);
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
      const hostelId = parseIdParam(req.params.id);
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
      const id = parseIdParam(req.params.id);
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
      const schoolIdParam = routeParam(req.query.schoolId);
      const schoolId = schoolIdParam ? Number.parseInt(schoolIdParam, 10) : getSchoolContext(req) || undefined;
      const date = routeParam(req.query.date) || undefined;
      const records = await storage.getHostelRollCall(schoolId, date);
      res.json(records);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/hostel/rollcall/by-hostel/:hostelId/:date/:timeSlot", requireAuth, async (req, res, next) => {
    try {
      const hostelId = parseIdParam(req.params.hostelId);
      const date = routeParam(req.params.date);
      const timeSlot = routeParam(req.params.timeSlot);
      const records = await storage.getHostelRollCallByHostel(hostelId, date, timeSlot);
      res.json(records);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/hostel/rollcall/grid/:hostelId/:from/:to/:timeSlot", requireAuth, async (req, res, next) => {
    try {
      const hostelId = parseIdParam(req.params.hostelId);
      const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
      let from = routeParam(req.params.from);
      let to = routeParam(req.params.to);
      const timeSlot = routeParam(req.params.timeSlot);
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
      const hostelId = parseIdParam(req.params.hostelId);
      const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
      let from = routeParam(req.params.from);
      let to = routeParam(req.params.to);
      const timeSlot = routeParam(req.params.timeSlot);
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
              link: "/hostel",
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
      const updated = await storage.updateStudentApplication(parseIdParam(req.params.id), req.body);
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
      const updated = await storage.updatePermission(parseIdParam(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Permission not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/permissions/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      await storage.deletePermission(parseIdParam(req.params.id));
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
      const group = visibleGroups.find(g => g.id === parseIdParam(req.params.id));
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
      const group = visibleGroups.find(g => g.id === parseIdParam(req.params.id));
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
      const updated = await storage.updateAccessGroup(parseIdParam(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Access group not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/access-groups/:id/permissions", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const { permissionIds } = req.body as { permissionIds: number[] };
      await storage.setAccessGroupPermissions(parseIdParam(req.params.id), permissionIds || []);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/access-groups/:id", requireAuth, requireRole("org_admin"), async (req, res, next) => {
    try {
      const groupId = parseIdParam(req.params.id);
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
      const id = parseIdParam(req.params.id);
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
      const id = parseIdParam(req.params.id);
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
      const targetUserId = parseIdParam(req.params.userId);
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
      const targetUserId = parseIdParam(req.params.userId);
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
      const targetUserId = parseIdParam(req.params.userId);
      const access = await checkTenantAccess(currentUser, targetUserId);
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }
      const groupId = parseIdParam(req.params.groupId);
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
      const targetUserId = parseIdParam(req.params.userId);
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
      const targetUserId = parseIdParam(req.params.userId);
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
      const targetUserId = parseIdParam(req.params.userId);
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
      const targetUserId = parseIdParam(req.params.userId);
      const access = await checkTenantAccess(currentUser, targetUserId);
      if (!access.allowed) {
        return res.status(403).json({ message: access.error });
      }
      await storage.removeUserPermissionOverride(targetUserId, parseIdParam(req.params.permissionId));
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
      const targetUserId = parseIdParam(req.params.userId);
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
      const requestedUserId = parseIdParam(req.params.userId);
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

      const hasPermission = await storage.userHasPermission(requestedUserId, routeParam(req.params.code));
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
      const jobId = parseIdParam(req.params.id);
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

  type NotifyRecipientForSend = { id: number; userId?: number | null; email?: string | null; phone?: string | null; name: string };

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
        selectedStaff = staffList.filter(s => matchesSearch([s.firstName, s.lastName, s.staffNo, s.role, s.phone, s.email], data.search));
      }
      recipients = selectedStaff.map(s => ({ id: s.id, userId: s.userId, email: s.email, phone: s.phone, name: `${s.firstName} ${s.lastName}` }));
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
      recipients = selectedStudents.map(s => ({ id: s.id, userId: (s as any).userId, email: s.email, phone: s.phone, name: `${s.firstName} ${s.lastName}` }));
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
      recipients = selectedParents.map(p => ({ id: p.id, userId: p.userId, email: p.email, phone: p.phone, name: `${p.firstName} ${p.lastName}` }));
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
  const assessmentTypeWriteSchema = z.object({
    schoolId: z.coerce.number().int().positive().nullable().optional(),
    name: z.string().trim().min(1),
    code: z.string().trim().min(1).max(100).optional().nullable(),
    assessmentCardinality: z.enum(["single_per_exam", "multiple_per_exam"]).optional().nullable(),
    reportAggregationMode: z.enum(["single", "best_coverage"]).optional().nullable(),
    description: z.string().optional().nullable(),
  });

  app.get("/api/assessment-types", requireAuth, async (req, res, next) => {
    try {
      const schoolId = getSchoolContext(req);
      const types = schoolId
        ? await storage.getAssessmentTypes(schoolId)
        : await storage.getAssessmentTypes();

      res.json(types.map((type) => ({
        ...type,
        ...inferAssessmentTypePolicy(type),
      })));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/assessment-types", requireAuth, async (req, res, next) => {
    try {
      const parsed = assessmentTypeWriteSchema.parse(req.body);
      const inferred = inferAssessmentTypePolicy(parsed);
      const created = await storage.createAssessmentType({
        ...parsed,
        code: parsed.code || inferred.code,
        assessmentCardinality: parsed.assessmentCardinality || inferred.assessmentCardinality,
        reportAggregationMode: parsed.reportAggregationMode || inferred.reportAggregationMode,
      } as any);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid assessment type", errors: error.errors });
      }
      next(error);
    }
  });

  app.put("/api/assessment-types/:id", requireAuth, async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id);
      const existing = await storage.getAssessmentType(id);
      if (!existing) return res.status(404).json({ message: "Assessment type not found" });

      const parsed = assessmentTypeWriteSchema.partial().parse(req.body);
      const merged = { ...existing, ...parsed };
      if (!merged.name?.trim()) return res.status(400).json({ message: "Assessment type name is required" });
      const inferred = inferAssessmentTypePolicy(merged);
      const nextCardinality = parsed.assessmentCardinality || existing.assessmentCardinality || inferred.assessmentCardinality;
      const nextAggregation = nextCardinality === ASSESSMENT_CARDINALITY.SINGLE_PER_EXAM
        ? "single"
        : parsed.reportAggregationMode || existing.reportAggregationMode || inferred.reportAggregationMode;
      const wasSingle = existing.assessmentCardinality === ASSESSMENT_CARDINALITY.SINGLE_PER_EXAM;
      const becomingSingle = !wasSingle && nextCardinality === ASSESSMENT_CARDINALITY.SINGLE_PER_EXAM;

      const linkedAssessments = (await storage.getAllAssessments()).filter(
        (assessment: any) => Number(assessment.assessmentTypeId) === id && assessment.examId,
      );

      if (becomingSingle) {
        const duplicateGroups = new Map<string, number[]>();
        for (const assessment of linkedAssessments) {
          const key = `${Number(assessment.examId)}:${Number(assessment.classId)}:${Number(assessment.subjectId)}`;
          const bucket = duplicateGroups.get(key) || [];
          bucket.push(Number(assessment.id));
          duplicateGroups.set(key, bucket);
        }
        const conflicts = Array.from(duplicateGroups.entries())
          .filter(([, assessmentIds]) => assessmentIds.length > 1)
          .map(([key, assessmentIds]) => ({ key, assessmentIds: assessmentIds.sort((a, b) => a - b) }));
        if (conflicts.length > 0) {
          return res.status(409).json({
            message: "This assessment type cannot be changed to single-per-exam while duplicate class/subject/exam assessments exist.",
            code: "ASSESSMENT_TYPE_POLICY_DUPLICATES",
            details: { conflicts },
          });
        }
      }

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(assessmentTypesSchema)
          .set({
            ...parsed,
            code: parsed.code || existing.code || inferred.code,
            assessmentCardinality: nextCardinality,
            reportAggregationMode: nextAggregation,
          })
          .where(eq(assessmentTypesSchema.id, id))
          .returning();

        if (nextCardinality === ASSESSMENT_CARDINALITY.MULTIPLE_PER_EXAM) {
          await tx
            .update(assessmentsSchema)
            .set({ enforceExamUniqueness: false })
            .where(eq(assessmentsSchema.assessmentTypeId, id));
        } else if (becomingSingle) {
          // The duplicate preflight above guarantees that every linked
          // class/subject/exam combination can safely be protected.
          await tx
            .update(assessmentsSchema)
            .set({ enforceExamUniqueness: true })
            .where(eq(assessmentsSchema.assessmentTypeId, id));
        }

        return row;
      });

      res.json(updated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid assessment type", errors: error.errors });
      }
      if (error?.code === "23505" && error?.constraint === "assessments_single_per_exam_subject_uidx") {
        return res.status(409).json({
          message: "The single-per-exam policy could not be applied because duplicate assessments still exist.",
          code: "ASSESSMENT_TYPE_POLICY_DUPLICATES",
        });
      }
      next(error);
    }
  });

  app.delete("/api/assessment-types/:id", requireAuth, async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id);
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
      const id = parseIdParam(req.params.id);
      const updated = await storage.updateExamType(id, req.body);
      if (!updated) return res.status(404).json({ message: "Exam type not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/exam-types/:id", requireAuth, async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id);
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
      const id = parseIdParam(req.params.id);
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
      const id = parseIdParam(req.params.id);
      const updated = await storage.updateExam(id, req.body);
      if (!updated) return res.status(404).json({ message: "Exam not found" });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/exams/:id", requireAuth, async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id);
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
      const scoped = await getScopedAssessmentOrRespond(req, res, parseIdParam(req.params.assessmentId));
      if (!scoped) return;

      const papers = await storage.getAssessmentPapers(scoped.assessment.id);
      res.json(papers);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/assessments/:assessmentId/papers", requireAuth, async (req, res, next) => {
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, parseIdParam(req.params.assessmentId));
      if (!scoped) return;
      if (await rejectIfAssessmentPublished(scoped.assessment, res)) return;

      const paperValidation = validateAssessmentPapers(req.body.papers);
      if (!paperValidation.valid) {
        return res.status(400).json({
          message: paperValidation.message,
          code: "ASSESSMENT_PAPERS_INVALID",
        });
      }

      const gradingConfiguration = await requireAssessmentGradingConfiguration({
        schoolId: scoped.schoolId,
        classId: Number(scoped.assessment.classId),
        subjectId: Number(scoped.assessment.subjectId),
        res,
      });
      if (!gradingConfiguration) return;

      const result = await reconcileAssessmentPapersAndMarks({
        assessmentId: scoped.assessment.id,
        papers: paperValidation.normalizedPapers,
        schoolId: scoped.schoolId,
        classId: Number(scoped.assessment.classId),
        subjectId: Number(scoped.assessment.subjectId),
        confirmPaperRemoval: req.body.confirmPaperRemoval === true,
      });

      logActivity(req, {
        schoolId: scoped.schoolId,
        action: "paper_configuration_update",
        category: "assessments",
        description: result.summary.recalculationPerformed
          ? `Updated assessment paper configuration and recalculated ${result.summary.totalMarks} learner result(s)`
          : "Updated assessment paper configuration without changing learner results",
        targetType: "assessment",
        targetId: scoped.assessment.id,
        targetName: scoped.assessment.topic,
        metadata: {
          beforePapers: result.beforePapers,
          afterPapers: result.papers,
          recalculation: result.summary,
        },
      });

      res.json(result.papers);
    } catch (error) {
      if (error instanceof AssessmentPaperReconciliationError) {
        return res.status(error.status).json({ message: error.message, code: error.code, details: error.details });
      }
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
          const profileAllowed = await ensureAssessmentCommentProfileAllowed(
            res,
            schoolId,
            pair.classInfo,
            pair.subjectInfo,
            grade,
          );
          if (!profileAllowed) return;

          const existing = await storage.findAssessmentComment(Number(cid), Number(sid), Number(grade.id));
          if (existing) continue;
          const createdComment = await storage.createAssessmentComment({
            schoolId,
            classId: Number(cid),
            subjectId: Number(sid),
            gradeId: Number(grade.id),
            commentText: commentText.trim(),
          });
          await syncAssessmentPoolCommentToUnpublishedMarks({
            schoolId,
            classId: Number(cid),
            subjectId: Number(sid),
            gradeId: Number(grade.id),
            commentId: Number(createdComment.id),
            commentText: createdComment.commentText,
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
          const profileAllowed = await ensureAssessmentCommentProfileAllowed(
            res,
            schoolId,
            pair.classInfo,
            pair.subjectInfo,
            grade,
          );
          if (!profileAllowed) return;
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
          const profileAllowed = await ensureAssessmentCommentProfileAllowed(
            res,
            schoolId,
            scopedComment.classInfo,
            scopedComment.subjectInfo,
            grade,
          );
          if (!profileAllowed) return;

          if (scopedComment.comment.gradeId === Number(grade.id)) {
            const updatedComment = await storage.updateAssessmentComment(scopedComment.comment.id, { commentText: commentText.trim() });
            if (updatedComment) {
              await syncAssessmentPoolCommentToUnpublishedMarks({
                schoolId,
                classId: Number(updatedComment.classId),
                subjectId: Number(updatedComment.subjectId),
                gradeId: Number(updatedComment.gradeId),
                commentId: Number(updatedComment.id),
                commentText: updatedComment.commentText,
              });
            }
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
          const profileAllowed = await ensureAssessmentCommentProfileAllowed(
            res,
            schoolId,
            allowedPair.classInfo,
            allowedPair.subjectInfo,
            grade,
          );
          if (!profileAllowed) return;

          const existing = await storage.findAssessmentComment(Number(pair.classId), Number(pair.subjectId), Number(grade.id));
          if (existing) continue;
          const createdComment = await storage.createAssessmentComment({
            schoolId,
            classId: Number(pair.classId),
            subjectId: Number(pair.subjectId),
            gradeId: Number(grade.id),
            commentText: commentText.trim(),
          });
          await syncAssessmentPoolCommentToUnpublishedMarks({
            schoolId,
            classId: Number(pair.classId),
            subjectId: Number(pair.subjectId),
            gradeId: Number(grade.id),
            commentId: Number(createdComment.id),
            commentText: createdComment.commentText,
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
      const scopedComment = await getScopedAssessmentCommentOrRespond(req, res, parseIdParam(req.params.id));
      if (!scopedComment) return;

      const { commentText } = req.body;
      if (!commentText?.trim()) return res.status(400).json({ message: "Comment text is required" });
      const updated = await storage.updateAssessmentComment(scopedComment.comment.id, { commentText: commentText.trim() });
      if (!updated) return res.status(404).json({ message: "Comment not found" });
      const syncResult = await syncAssessmentPoolCommentToUnpublishedMarks({
        schoolId: scopedComment.schoolId,
        classId: Number(updated.classId),
        subjectId: Number(updated.subjectId),
        gradeId: Number(updated.gradeId),
        commentId: Number(updated.id),
        commentText: updated.commentText,
      });
      res.json({ ...updated, syncedMarks: syncResult.updatedMarks });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/assessment-comments/:id", requireAuth, async (req, res, next) => {
    try {
      const scopedComment = await getScopedAssessmentCommentOrRespond(req, res, parseIdParam(req.params.id));
      if (!scopedComment) return;

      await syncAssessmentPoolCommentToUnpublishedMarks({
        schoolId: scopedComment.schoolId,
        classId: Number(scopedComment.comment.classId),
        subjectId: Number(scopedComment.comment.subjectId),
        gradeId: Number(scopedComment.comment.gradeId),
        commentId: null,
        commentText: null,
      });
      // Published rows keep their frozen snapshot, but the foreign-key link must
      // be cleared before the pool row can be deleted.
      await db
        .update(assessmentMarksSchema)
        .set({ commentId: null })
        .where(and(
          eq(assessmentMarksSchema.schoolId, scopedComment.schoolId),
          eq(assessmentMarksSchema.commentId, scopedComment.comment.id),
        ));
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
    return Array.from(new Set(rawClassIds
      .map((value: any) => typeof value === "object" && value !== null ? Number(value.id ?? value.value ?? value.classId) : Number(value))
      .filter((value: number) => Number.isFinite(value) && value > 0)));
  };

  const reportCommentMatchesGrade = (comment: any, gradeId: number | null, commentGrade: string, gradeLevel?: string | null) => {
    if (gradeId && comment.gradeId === gradeId) return true;
    return comment.commentGrade === commentGrade && (comment.gradeLevel || null) === (gradeLevel || null);
  };

  async function ensureReportCommentGradeProfileAllowed(
    res: Response,
    schoolId: number,
    grade: any,
    classInfo?: any | null,
  ) {
    const school = await storage.getSchool(schoolId);
    if (!school) {
      res.status(404).json({ message: "School not found" });
      return null;
    }

    const schoolProfiles = getGradingProfilesForSchool(school.schoolType, school.examinationBoard);
    const matchingProfiles = schoolProfiles.filter((profile) =>
      gradeProfileMatchesStrict(grade.gradeLevel, profile.key)
    );

    if (matchingProfiles.length === 0) {
      res.status(400).json({
        message: "The selected grade does not belong to a grading profile configured for this school",
        code: "REPORT_COMMENT_GRADE_PROFILE_MISMATCH",
        details: { gradeId: Number(grade.id), gradeLevel: grade.gradeLevel || null },
      });
      return null;
    }

    if (classInfo) {
      const stream = classInfo.streamId ? await storage.getStream(Number(classInfo.streamId)) : null;
      const streamName = stream?.name || classInfo.className || null;
      const classCompatibleProfiles = matchingProfiles.filter((profile) =>
        profileMatchesStreamName(profile.key, streamName)
      );

      if (classCompatibleProfiles.length === 0) {
        res.status(400).json({
          message: `The selected grade profile does not match ${classInfo.className || "the selected class"}.`,
          code: "REPORT_COMMENT_CLASS_PROFILE_MISMATCH",
          details: {
            classId: Number(classInfo.id),
            gradeId: Number(grade.id),
            gradeLevel: grade.gradeLevel || null,
          },
        });
        return null;
      }
      return classCompatibleProfiles[0].key;
    }

    return matchingProfiles[0].key;
  }

  function resolveReportCommentGradeForAverage(grades: any[], averagePercentage: number | null) {
    if (averagePercentage === null) return null;
    const resolution = resolveGradeForPercentage(Math.round(averagePercentage), grades);
    return resolution.ambiguous ? null : resolution.grade;
  }

  const REPORT_CARD_OVERRIDE_PREFIX = "__REPORT_CARD_OVERRIDE__";

  function findReportCommentForConfiguredGrade(args: {
    comments: any[];
    commentType: "principal" | "class_teacher";
    grade: any | null;
    profileKey?: string | null;
    classId?: number | null;
  }) {
    if (!args.grade) return "";
    const compatibleKeys = new Set(getStrictGradeProfileKeys(args.profileKey));
    const matches = args.comments.filter((comment) => {
      if (comment.commentType !== args.commentType) return false;
      if (String(comment.commentGrade || "").startsWith(`${REPORT_CARD_OVERRIDE_PREFIX}:`)) return false;

      if (args.commentType === "class_teacher") {
        if (!args.classId || Number(comment.classId) !== Number(args.classId)) return false;
      } else if (comment.classId !== null && comment.classId !== undefined) {
        return false;
      }

      if (comment.gradeId !== null && comment.gradeId !== undefined) {
        return Number(comment.gradeId) === Number(args.grade.id);
      }
      if ((comment.commentGrade || "") !== (args.grade.gradeName || "")) return false;
      if (!comment.gradeLevel) return true;
      if (compatibleKeys.size === 0) return comment.gradeLevel === args.profileKey;
      return compatibleKeys.has(comment.gradeLevel);
    });

    // Historical duplicates are resolved deterministically. The newest row is
    // treated as canonical until the integrity repair removes older duplicates.
    matches.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    return matches[0]?.commentText || "";
  }

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

  function getReportCardCommentOverrideMapFromRows(rows: any[], examId: number, studentIds?: number[]) {
    const allowedStudentIds = studentIds ? new Set(studentIds.map((id) => Number(id))) : null;
    const map = new Map<number, { principal?: string; class_teacher?: string }>();

    // Newest rows win deterministically if legacy duplicates exist.
    const orderedRows = [...rows].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    for (const row of orderedRows) {
      const parsed = parseReportCardOverrideKey(row.commentGrade);
      if (!parsed || parsed.examId !== examId) continue;
      if (allowedStudentIds && !allowedStudentIds.has(parsed.studentId)) continue;
      const entry = map.get(parsed.studentId) || {};
      if (row.commentType === "principal" && entry.principal === undefined) entry.principal = row.commentText || "";
      if (row.commentType === "class_teacher" && entry.class_teacher === undefined) entry.class_teacher = row.commentText || "";
      map.set(parsed.studentId, entry);
    }

    return map;
  }

  async function getReportCardCommentOverrideMap(schoolId: number, examId: number, studentIds?: number[]) {
    const rows = await db
      .select()
      .from(reportComments)
      .where(and(
        eq(reportComments.schoolId, schoolId),
        like(reportComments.commentGrade, `${REPORT_CARD_OVERRIDE_PREFIX}:%:${examId}`),
      ))
      .orderBy(desc(reportComments.id));
    return getReportCardCommentOverrideMapFromRows(rows, examId, studentIds);
  }

  function selectOverallCommentRowsForPublicationSnapshot(rows: any[], examId: number, classId: number) {
    return rows.filter((row) => {
      const override = parseReportCardOverrideKey(row.commentGrade);
      if (override) return override.examId === Number(examId);
      if (row.commentType === "principal") {
        return row.classId === null || row.classId === undefined;
      }
      if (row.commentType === "class_teacher") {
        return Number(row.classId) === Number(classId);
      }
      return false;
    });
  }

  function effectiveOverallCommentRows(publication: any, liveRows: any[]) {
    const snapshot = publication?.overallCommentRowsSnapshot;
    if (publication?.isPublished === true && Array.isArray(snapshot)) return snapshot;
    return liveRows;
  }

  async function loadOverallCommentRowsForPublicationSnapshot(executor: any, args: {
    schoolId: number;
    examId: number;
    classId: number;
  }) {
    // Pool and override writes take a ROW EXCLUSIVE table lock. Holding SHARE
    // here guarantees the publication snapshot is internally consistent and
    // cannot race a comment edit.
    await executor.execute(sql`LOCK TABLE report_comments IN SHARE MODE`);
    const rows = await executor
      .select()
      .from(reportComments)
      .where(eq(reportComments.schoolId, args.schoolId))
      .orderBy(desc(reportComments.id));
    return selectOverallCommentRowsForPublicationSnapshot(rows, args.examId, args.classId);
  }

  type ReportCommentPoolInput = {
    schoolId: number;
    gradeId: number | null;
    commentGrade: string;
    gradeLevel: string | null;
    commentText: string;
    commentType: "principal" | "class_teacher";
    classId?: number | null;
  };

  function reportCommentPoolConditions(input: ReportCommentPoolInput) {
    const conditions: any[] = [
      eq(reportComments.schoolId, input.schoolId),
      eq(reportComments.commentType, input.commentType as any),
    ];
    if (input.gradeId !== null) {
      conditions.push(eq(reportComments.gradeId, input.gradeId));
    } else {
      conditions.push(eq(reportComments.commentGrade, input.commentGrade));
      conditions.push(input.gradeLevel ? eq(reportComments.gradeLevel, input.gradeLevel as any) : isNull(reportComments.gradeLevel));
    }
    if (input.commentType === "class_teacher") {
      conditions.push(eq(reportComments.classId, Number(input.classId)));
    } else {
      conditions.push(isNull(reportComments.classId));
    }
    return conditions;
  }

  async function saveReportCommentPool(input: ReportCommentPoolInput) {
    const lockKey = [
      "report-comment-pool",
      input.commentType,
      input.gradeId ?? `${input.commentGrade}:${input.gradeLevel || ""}`,
      input.classId || 0,
    ].join(":");

    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${input.schoolId}, hashtext(${lockKey}))`);
      const existingRows = await tx
        .select()
        .from(reportComments)
        .where(and(...reportCommentPoolConditions(input)))
        .orderBy(desc(reportComments.id));
      const canonical = existingRows[0];
      const values = {
        schoolId: input.schoolId,
        gradeId: input.gradeId,
        commentGrade: input.commentGrade,
        gradeLevel: input.gradeLevel as any,
        subjectId: null,
        classId: input.commentType === "class_teacher" ? Number(input.classId) : null,
        commentText: input.commentText.trim(),
        commentType: input.commentType,
      } as any;

      let saved: any;
      if (canonical) {
        [saved] = await tx
          .update(reportComments)
          .set(values)
          .where(eq(reportComments.id, canonical.id))
          .returning();
      } else {
        [saved] = await tx.insert(reportComments).values(values).returning();
      }

      const duplicateIds = existingRows.slice(1).map((row) => Number(row.id));
      if (duplicateIds.length) {
        await tx.delete(reportComments).where(inArray(reportComments.id, duplicateIds));
      }
      return saved;
    });
  }

  async function deleteReportCommentPoolById(id: number, schoolId: number) {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(reportComments)
        .where(and(eq(reportComments.id, id), eq(reportComments.schoolId, schoolId)));
      if (!existing || String(existing.commentGrade || "").startsWith(`${REPORT_CARD_OVERRIDE_PREFIX}:`)) return false;
      const input: ReportCommentPoolInput = {
        schoolId,
        gradeId: existing.gradeId ? Number(existing.gradeId) : null,
        commentGrade: existing.commentGrade,
        gradeLevel: existing.gradeLevel || null,
        commentText: existing.commentText,
        commentType: existing.commentType,
        classId: existing.classId ? Number(existing.classId) : null,
      };
      const lockKey = [
        "report-comment-pool",
        input.commentType,
        input.gradeId ?? `${input.commentGrade}:${input.gradeLevel || ""}`,
        input.classId || 0,
      ].join(":");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, hashtext(${lockKey}))`);
      await tx.delete(reportComments).where(and(...reportCommentPoolConditions(input)));
      return true;
    });
  }

  async function persistReportCardOverride(executor: any, args: {
    schoolId: number;
    studentId: number;
    examId: number;
    classId: number | null;
    commentType: "principal" | "class_teacher";
    commentText: string;
  }) {
    const overrideKey = buildReportCardOverrideKey(args.studentId, args.examId);
    const lockKey = `report-card-override:${overrideKey}:${args.commentType}`;
    await executor.execute(sql`SELECT pg_advisory_xact_lock(${args.schoolId}, hashtext(${lockKey}))`);
    const existingRows = await executor
      .select()
      .from(reportComments)
      .where(and(
        eq(reportComments.schoolId, args.schoolId),
        eq(reportComments.commentType, args.commentType as any),
        eq(reportComments.commentGrade, overrideKey),
      ))
      .orderBy(desc(reportComments.id));

    const trimmed = args.commentText.trim();
    if (!trimmed) {
      const ids = existingRows.map((row: any) => Number(row.id));
      if (ids.length) await executor.delete(reportComments).where(inArray(reportComments.id, ids));
      return null;
    }

    const values = {
      schoolId: args.schoolId,
      gradeId: null,
      commentGrade: overrideKey,
      gradeLevel: null,
      subjectId: null,
      classId: args.commentType === "class_teacher" ? args.classId : null,
      commentText: trimmed,
      commentType: args.commentType,
    } as any;
    const canonical = existingRows[0];
    if (canonical) {
      await executor.update(reportComments).set(values).where(eq(reportComments.id, canonical.id));
    } else {
      await executor.insert(reportComments).values(values);
    }
    const duplicateIds = existingRows.slice(1).map((row: any) => Number(row.id));
    if (duplicateIds.length) await executor.delete(reportComments).where(inArray(reportComments.id, duplicateIds));
    return trimmed;
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
      const resolvedGradeId = Number(gradeId);
      if (!Number.isInteger(resolvedGradeId) || resolvedGradeId <= 0) {
        return res.status(400).json({ message: "gradeId is required" });
      }
      const selectedGrade = await ensureGradeInSchool(resolvedGradeId, schoolId, res);
      if (!selectedGrade) return;
      const profileAllowed = await ensureReportCommentGradeProfileAllowed(res, schoolId, selectedGrade);
      if (!profileAllowed) return;
      const resolvedCommentGrade = selectedGrade.gradeName;
      const resolvedGradeLevel = selectedGrade.gradeLevel;
      const createdComments = [];
      if (commentType === "class_teacher") {
        for (const selectedClassId of normalizedClassIds) {
          const classInfo = await ensureClassInSchool(selectedClassId, schoolId, res);
          if (!classInfo) return;
          const classProfileAllowed = await ensureReportCommentGradeProfileAllowed(res, schoolId, selectedGrade, classInfo);
          if (!classProfileAllowed) return;
          const comment = await saveReportCommentPool({
            schoolId,
            gradeId: resolvedGradeId,
            commentGrade: resolvedCommentGrade,
            gradeLevel: resolvedGradeLevel || null,
            commentText,
            commentType,
            classId: selectedClassId,
          });
          createdComments.push(comment);
        }
        return res.status(201).json(createdComments);
      }
      const comment = await saveReportCommentPool({
        schoolId,
        gradeId: resolvedGradeId,
        commentGrade: resolvedCommentGrade,
        gradeLevel: resolvedGradeLevel || null,
        commentText,
        commentType,
        classId: null,
      });
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
      const profileAllowed = await ensureReportCommentGradeProfileAllowed(res, schoolId, grade);
      if (!profileAllowed) return;
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
        const classProfileAllowed = await ensureReportCommentGradeProfileAllowed(res, schoolId, grade, classInfo);
        if (!classProfileAllowed) return;
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
      const profileAllowed = await ensureReportCommentGradeProfileAllowed(res, schoolId, grade);
      if (!profileAllowed) return;
      const resolvedGradeId = Number(grade.id);
      const resolvedCommentGrade = grade.gradeName;
      const resolvedGradeLevel = grade.gradeLevel || gradeLevel || null;

      let overwritten = 0;
      if (Array.isArray(overwriteIds)) {
        for (const id of overwriteIds) {
          const [existing] = await db.select().from(reportComments).where(and(eq(reportComments.id, Number(id)), eq(reportComments.schoolId, schoolId), eq(reportComments.commentType, commentType as any)));
          if (!existing) continue;
          if (commentType === "class_teacher") {
            const classInfo = existing.classId ? await ensureClassInSchool(Number(existing.classId), schoolId, res) : null;
            if (!classInfo) return;
            const classProfileAllowed = await ensureReportCommentGradeProfileAllowed(res, schoolId, grade, classInfo);
            if (!classProfileAllowed) return;
          }
          await saveReportCommentPool({
            schoolId,
            gradeId: resolvedGradeId,
            commentGrade: resolvedCommentGrade,
            gradeLevel: resolvedGradeLevel,
            commentText,
            commentType,
            classId: commentType === "class_teacher" ? Number(existing.classId) : null,
          });
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
            const classProfileAllowed = await ensureReportCommentGradeProfileAllowed(res, schoolId, grade, classInfo);
            if (!classProfileAllowed) return;
          }
          await saveReportCommentPool({
            schoolId,
            gradeId: resolvedGradeId,
            commentGrade: resolvedCommentGrade,
            gradeLevel: resolvedGradeLevel,
            commentText,
            commentType,
            classId,
          });
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
      const id = parseIdParam(req.params.id);
      const deleted = await deleteReportCommentPoolById(id, schoolId);
      if (!deleted) return res.status(404).json({ message: "Report comment not found" });
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

      const overrideText = await db.transaction((tx) => persistReportCardOverride(tx, {
        schoolId,
        studentId,
        examId,
        classId: student.classId ? Number(student.classId) : null,
        commentType,
        commentText,
      }));

      res.json({ ok: true, overrideText });
    } catch (error) {
      next(error);
    }
  });


  const reportCardBulkCommentSchema = z.object({
    examId: z.coerce.number().int().positive(),
    classId: z.coerce.number().int().positive(),
    overall: z.array(z.object({
      studentId: z.coerce.number().int().positive(),
      commentType: z.enum(["principal", "class_teacher"]),
      commentText: z.string(),
    })).max(1_000).default([]),
    subjects: z.array(z.object({
      studentId: z.coerce.number().int().positive(),
      assessmentId: z.coerce.number().int().positive(),
      subjectId: z.coerce.number().int().positive(),
      commentText: z.string(),
    })).max(5_000).default([]),
  });

  app.post("/api/report-card-comments/bulk", requireAuth, async (req, res, next) => {
    try {
      const schoolId = await requireSchoolScope(req, res);
      if (!schoolId) return;
      const input = reportCardBulkCommentSchema.parse(req.body);
      const [classInfo, exam] = await Promise.all([
        storage.getClass(input.classId),
        storage.getExam(input.examId),
      ]);
      if (!classInfo || Number(classInfo.schoolId) !== Number(schoolId)) {
        return res.status(404).json({ message: "Class not found" });
      }
      if (!exam || (exam.schoolId && Number(exam.schoolId) !== Number(schoolId))) {
        return res.status(404).json({ message: "Exam not found" });
      }
      if (await isClassExamPublished(input.examId, input.classId)) {
        return res.status(423).json({
          message: "This report has been published. Comments are read-only until it is unpublished.",
          code: "ASSESSMENT_PUBLISHED",
        });
      }

      const studentIds = Array.from(new Set([
        ...input.overall.map((row) => row.studentId),
        ...input.subjects.map((row) => row.studentId),
      ]));
      const classStudents = await storage.getStudentsByClass(input.classId);
      const classStudentMap = new Map(classStudents.map((student) => [Number(student.id), student] as const));
      const invalidStudentId = studentIds.find((studentId) => !classStudentMap.has(studentId));
      if (invalidStudentId) {
        return res.status(400).json({ message: `Learner ${invalidStudentId} does not belong to this class` });
      }

      const examAssessments = (await storage.getAssessmentsByExam(input.examId))
        .filter((assessment) => Number(assessment.classId) === Number(input.classId));
      const assessmentMap = new Map(examAssessments.map((assessment) => [Number(assessment.id), assessment] as const));
      for (const row of input.subjects) {
        const assessment = assessmentMap.get(row.assessmentId);
        if (!assessment || Number(assessment.subjectId) !== Number(row.subjectId) || Number(assessment.schoolId) !== Number(schoolId)) {
          return res.status(400).json({ message: `Assessment ${row.assessmentId} is not valid for this class and exam` });
        }
      }

      const assessmentIds = Array.from(new Set(input.subjects.map((row) => row.assessmentId)));
      const markRows = assessmentIds.length && studentIds.length
        ? await db.select().from(assessmentMarksSchema).where(and(
            eq(assessmentMarksSchema.schoolId, schoolId),
            inArray(assessmentMarksSchema.assessmentId, assessmentIds),
            inArray(assessmentMarksSchema.studentId, studentIds),
          ))
        : [];
      const markMap = new Map(markRows.map((mark) => [`${mark.studentId}:${mark.assessmentId}`, mark] as const));
      const missingMark = input.subjects.find((row) => !markMap.has(`${row.studentId}:${row.assessmentId}`));
      if (missingMark) {
        return res.status(404).json({ message: `Assessment mark not found for learner ${missingMark.studentId}` });
      }

      const poolCache = new Map<string, { id: number; commentText: string } | null>();
      for (const row of input.subjects) {
        const mark = markMap.get(`${row.studentId}:${row.assessmentId}`)!;
        const assessment = assessmentMap.get(row.assessmentId)!;
        if (!mark.gradeId) continue;
        const poolKey = `${assessment.classId}:${assessment.subjectId}:${mark.gradeId}`;
        if (!poolCache.has(poolKey)) {
          const pool = await storage.findAssessmentComment(
            Number(assessment.classId),
            Number(assessment.subjectId),
            Number(mark.gradeId),
          );
          poolCache.set(poolKey, pool ? { id: pool.id, commentText: pool.commentText } : null);
        }
      }

      const result = await db.transaction(async (tx) => {
        const overallResults: Array<{ studentId: number; commentType: "principal" | "class_teacher"; commentText: string }> = [];
        for (const row of input.overall) {
          const student = classStudentMap.get(row.studentId)!;
          const overrideText = await persistReportCardOverride(tx, {
            schoolId,
            studentId: row.studentId,
            examId: input.examId,
            classId: student.classId ? Number(student.classId) : null,
            commentType: row.commentType,
            commentText: row.commentText,
          });
          overallResults.push({
            studentId: row.studentId,
            commentType: row.commentType,
            commentText: overrideText || "",
          });
        }

        const subjectResults: Array<{ studentId: number; assessmentId: number; subjectId: number; commentText: string; commentPool: string }> = [];
        for (const row of input.subjects) {
          const assessment = assessmentMap.get(row.assessmentId)!;
          const mark = markMap.get(`${row.studentId}:${row.assessmentId}`)!;
          const poolKey = mark.gradeId ? `${assessment.classId}:${assessment.subjectId}:${mark.gradeId}` : "";
          const poolComment = poolKey ? poolCache.get(poolKey) || null : null;
          const trimmed = row.commentText.trim();
          const usePool = trimmed.length === 0;
          await tx.update(assessmentMarksSchema).set({
            commentId: usePool ? poolComment?.id ?? null : null,
            customCommentText: usePool ? null : trimmed,
            autoCommentSnapshot: poolComment?.commentText ?? null,
            commentSource: usePool ? "pool" : "custom",
            updatedAt: new Date(),
          }).where(and(
            eq(assessmentMarksSchema.id, mark.id),
            eq(assessmentMarksSchema.schoolId, schoolId),
          ));
          subjectResults.push({
            studentId: row.studentId,
            assessmentId: row.assessmentId,
            subjectId: row.subjectId,
            commentText: usePool ? poolComment?.commentText || "" : trimmed,
            commentPool: poolComment?.commentText || "",
          });
        }
        return { overall: overallResults, subjects: subjectResults };
      });

      return res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid report comments", errors: error.errors });
      }
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

      const {
        papers,
        confirmPaperRemoval: _ignoredPaperRemovalConfirmation,
        classIds: _ignoredClassIds,
        schoolId: _ignoredSchoolId,
        ...assessmentData
      } = req.body;
      const paperValidation = validateAssessmentPapers(papers);
      if (!paperValidation.valid) {
        return res.status(400).json({
          message: paperValidation.message,
          code: "ASSESSMENT_PAPERS_INVALID",
        });
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

      const gradingConfiguration = await requireAssessmentGradingConfiguration({
        schoolId,
        classId: Number(assessmentData.classId),
        subjectId: Number(assessmentData.subjectId),
        res,
      });
      if (!gradingConfiguration) return;

      const resolvedExamId = validatedRefs.exam ? Number(validatedRefs.exam.id) : null;
      const uniquenessPolicy = await ensureAssessmentUniquenessPolicy({
        schoolId,
        classId: Number(validatedRefs.classInfo.id),
        subjectId: Number(validatedRefs.subjectInfo.id),
        examId: resolvedExamId,
        assessmentType: validatedRefs.assessmentType,
        res,
      });
      if (!uniquenessPolicy) return;

      const assessmentWithName = {
        ...assessmentData,
        schoolId,
        classId: Number(validatedRefs.classInfo.id),
        subjectId: Number(validatedRefs.subjectInfo.id),
        assessmentTypeId: validatedRefs.resolvedAssessmentTypeId,
        examId: resolvedExamId,
        enforceExamUniqueness: uniquenessPolicy.enforceExamUniqueness,
        name: assessmentData.name || assessmentData.topic,
        isPublished: true,
      };

      const assessment = await storage.createAssessment(assessmentWithName);

      const papersWithAssessmentId = paperValidation.normalizedPapers.map((paper, index) => ({
        ...paper,
        assessmentId: assessment.id,
        sortOrder: index,
      }));
      await storage.setAssessmentPapers(assessment.id, papersWithAssessmentId);

      const savedPapers = await storage.getAssessmentPapers(assessment.id);
      res.status(201).json({ ...assessment, papers: savedPapers });
    } catch (error: any) {
      if (error?.code === "23505" && error?.constraint === "assessments_single_per_exam_subject_uidx") {
        return res.status(409).json({
          message: "An assessment already exists for this class, subject and exercise/exam.",
          code: "ASSESSMENT_SINGLE_PER_EXAM_CONFLICT",
        });
      }
      next(error);
    }
  });

  app.put("/api/assessments/:id", requireAuth, async (req, res, next) => {
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, parseIdParam(req.params.id));
      if (!scoped) return;
      if (await rejectIfAssessmentPublished(scoped.assessment, res)) return;

      const {
        papers,
        confirmPaperRemoval,
        classIds: _ignoredClassIds,
        schoolId: _ignoredSchoolId,
        ...assessmentData
      } = req.body;
      const paperValidation = papers === undefined ? null : validateAssessmentPapers(papers);
      if (paperValidation && !paperValidation.valid) {
        return res.status(400).json({
          message: paperValidation.message,
          code: "ASSESSMENT_PAPERS_INVALID",
        });
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

      const gradingConfiguration = await requireAssessmentGradingConfiguration({
        schoolId: scoped.schoolId,
        classId: resolvedClassId,
        subjectId: resolvedSubjectId,
        res,
      });
      if (!gradingConfiguration) return;

      const resolvedExamId = validatedRefs.exam ? Number(validatedRefs.exam.id) : null;
      const uniquenessPolicy = await ensureAssessmentUniquenessPolicy({
        schoolId: scoped.schoolId,
        classId: resolvedClassId,
        subjectId: resolvedSubjectId,
        examId: resolvedExamId,
        assessmentType: validatedRefs.assessmentType,
        excludeAssessmentId: Number(scoped.assessment.id),
        res,
      });
      if (!uniquenessPolicy) return;

      const updatePayload = {
        ...assessmentData,
        schoolId: scoped.schoolId,
        classId: resolvedClassId,
        subjectId: resolvedSubjectId,
        assessmentTypeId: validatedRefs.resolvedAssessmentTypeId,
        examId: resolvedExamId,
        enforceExamUniqueness: uniquenessPolicy.enforceExamUniqueness,
        isPublished: true,
      };

      if (paperValidation) {
        const result = await reconcileAssessmentPapersAndMarks({
          assessmentId: scoped.assessment.id,
          papers: paperValidation.normalizedPapers,
          assessmentPatch: updatePayload,
          schoolId: scoped.schoolId,
          classId: resolvedClassId,
          subjectId: resolvedSubjectId,
          confirmPaperRemoval: confirmPaperRemoval === true,
        });

        logActivity(req, {
          schoolId: scoped.schoolId,
          action: "paper_configuration_update",
          category: "assessments",
          description: result.summary.recalculationPerformed
            ? `Updated assessment and recalculated ${result.summary.totalMarks} learner result(s)`
            : "Updated assessment without changing learner results",
          targetType: "assessment",
          targetId: scoped.assessment.id,
          targetName: result.assessment.topic,
          metadata: {
            beforePapers: result.beforePapers,
            afterPapers: result.papers,
            recalculation: result.summary,
          },
        });

        return res.json({ ...result.assessment, papers: result.papers, recalculation: result.summary });
      }

      if (
        resolvedClassId !== Number(scoped.assessment.classId) ||
        resolvedSubjectId !== Number(scoped.assessment.subjectId)
      ) {
        const existingMarks = await storage.getAssessmentMarks(scoped.assessment.id);
        if (existingMarks.length > 0) {
          return res.status(409).json({
            message: "The class or subject cannot be changed after learner marks have been entered. Create a new assessment instead.",
            code: "ASSESSMENT_CONTEXT_CHANGE_BLOCKED",
            details: { markCount: existingMarks.length },
          });
        }
      }

      const updated = await storage.updateAssessment(scoped.assessment.id, updatePayload);
      if (!updated) return res.status(404).json({ message: "Assessment not found" });
      const savedPapers = await storage.getAssessmentPapers(scoped.assessment.id);
      res.json({ ...updated, papers: savedPapers });
    } catch (error: any) {
      if (error instanceof AssessmentPaperReconciliationError) {
        return res.status(error.status).json({ message: error.message, code: error.code, details: error.details });
      }
      if (error?.code === "23505" && error?.constraint === "assessments_single_per_exam_subject_uidx") {
        return res.status(409).json({
          message: "An assessment already exists for this class, subject and exercise/exam.",
          code: "ASSESSMENT_SINGLE_PER_EXAM_CONFLICT",
        });
      }
      next(error);
    }
  });

  // ==================== MARKS ENTRY ====================

  // Get marks entry data for an assessment (students with their marks)
  app.get("/api/marks-entry/:assessmentId", requireAuth, async (req, res, next) => {
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, parseIdParam(req.params.assessmentId));
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
    let releaseAssessmentLock: (() => void) | null = null;
    try {
      const scoped = await getScopedAssessmentOrRespond(req, res, Number(req.body.assessmentId));
      if (!scoped) return;
      if (await rejectIfAssessmentPublished(scoped.assessment, res)) return;
      releaseAssessmentLock = await acquireAssessmentMutationLock(scoped.assessment.id);

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

      // Get assessment papers to calculate weighted percentage. Existing assessments are
      // revalidated here so invalid legacy paper weights can never produce NaN percentages.
      const papers = await storage.getAssessmentPapers(assessment.id);
      const paperValidation = validateAssessmentPapers(papers);
      if (!paperValidation.valid) {
        return res.status(422).json({
          message: `${paperValidation.message}. Correct the assessment papers before entering marks.`,
          code: "ASSESSMENT_PAPERS_INVALID",
          assessmentId: assessment.id,
        });
      }

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
      // Temporarily excluded subjects keep their existing linked grade (the school's
      // interim alternative) and bypass the new exact-profile pipeline completely.
      const allGrades = await storage.getGradesBySchool(schoolId);
      const subject = await storage.getSubject(subjectId);
      const strictGradingExcluded = isTemporarilyExcludedFromStrictGrading(subject);
      const profileContext = strictGradingExcluded
        ? { profileKey: null as string | null, gradingSubjectType: null as string | null }
        : await resolveGradeProfileContext({ schoolId, classId, subjectId });
      const profileKey = profileContext.profileKey;
      const grades = profileKey
        ? getApplicableGradesForContext(allGrades, { profileKey, classId })
        : [];

      // Check if mark exists before resolving the grade so a temporary exclusion does
      // not erase the currently stored alternative grade when marks are edited.
      let existingMark = await storage.getAssessmentMarkByStudentAssessment(Number(studentId), assessment.id);
      if (existingMark && existingMark.schoolId !== schoolId) {
        return res.status(403).json({ message: "Mark not in school context" });
      }
      const existingExcludedGrade = strictGradingExcluded && existingMark?.gradeId
        ? allGrades.find((grade: any) => Number(grade.id) === Number(existingMark?.gradeId))
        : null;
      const gradeResolution = percentage !== null && !strictGradingExcluded
        ? calculateGrade(percentage, grades, profileContext.gradingSubjectType || subject?.subjectType)
        : {
            gradeId: existingExcludedGrade ? Number(existingExcludedGrade.id) : null,
            gradeName: existingExcludedGrade?.gradeName || "",
            ambiguous: false,
            matchingGradeIds: [] as number[],
          };
      const { gradeId, gradeName } = gradeResolution;

      if (percentage !== null && !strictGradingExcluded && (!gradeId || gradeResolution.ambiguous)) {
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
    } finally {
      if (releaseAssessmentLock) releaseAssessmentLock();
    }
  });

  // Delete a mark
  app.delete("/api/marks-entry/:markId", requireAuth, async (req, res, next) => {
    let releaseAssessmentLock: (() => void) | null = null;
    try {
      const scopedMark = await getScopedAssessmentMarkOrRespond(req, res, parseIdParam(req.params.markId));
      if (!scopedMark) return;
      if (await rejectIfAssessmentPublished(scopedMark.assessment, res)) return;
      releaseAssessmentLock = await acquireAssessmentMutationLock(scopedMark.assessment.id);

      await storage.deleteAssessmentMark(scopedMark.mark.id);
      res.json({ message: "Mark deleted successfully" });
    } catch (error) {
      next(error);
    } finally {
      if (releaseAssessmentLock) releaseAssessmentLock();
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

  const REPORT_DATA_TEMPLATE_VERSION = "report-data-v6-position-policy-and-order";
  const reportDataBuildInFlight = new Map<string, Promise<void>>();

  function reportDataCachePath(args: {
    schoolId: number;
    examId: number;
    classId: number;
    publicationVersion: number;
    gradingConfigurationFingerprint: string;
    brandingFingerprint: string;
    reportCommentsFingerprint: string;
    studentIds?: number[];
  }): string {
    const key = reportCacheKey({ templateVersion: REPORT_DATA_TEMPLATE_VERSION, ...args });
    return path.join(academicReportDataCacheDirectory(), `${key}.json`);
  }

  function filterCachedReportPayload(payload: any, studentIds: number[]): any {
    if (!studentIds.length) return payload;
    const requested = new Set(studentIds.map(Number));
    return {
      ...payload,
      reportCards: Array.isArray(payload?.reportCards)
        ? payload.reportCards.filter((card: any) => requested.has(Number(card?.student?.id)))
        : [],
    };
  }

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

  // Get report card data for a class and exam. The same handler powers the
  // interactive class view and the selected-learner PDF data endpoint.
  const handleClassReportCardData = async (req: Request, res: Response, next: NextFunction) => {
    const requestStartedAt = Date.now();
    const timingMarks: Array<{ name: string; duration: number }> = [];
    let previousMark = requestStartedAt;
    const markTiming = (name: string) => {
      const now = Date.now();
      timingMarks.push({ name, duration: now - previousMark });
      previousMark = now;
    };
    let dataBuildLock: { key: string; promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void } | null = null;
    try {
      const examId = parseIdParam(req.params.examId);
      const classId = parseIdParam(req.params.classId);
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
      const requestedStudentIds = Array.from(new Set(
        String(req.query.studentIds || "")
          .split(",")
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0),
      ));
      const classStudentIds = new Set(students.map((student) => Number(student.id)));
      if (requestedStudentIds.some((studentId) => !classStudentIds.has(studentId))) {
        return res.status(400).json({ message: "One or more selected learners do not belong to this class" });
      }
      if (currentUser?.role === "student" || currentUser?.role === "parent") {
        const isInternalIndividualPdfData = req.query.pdfData === "1" && requestedStudentIds.length === 1;
        if (!isInternalIndividualPdfData) {
          return res.status(403).json({ message: "Class-wide report data is not available in the student or parent portal" });
        }
        if (!(await ensurePublishedPortalAccess({
          user: currentUser,
          examId,
          classId,
          studentId: requestedStudentIds[0],
          res,
        }))) return;
      }
      const requestedStudentIdSet = new Set(requestedStudentIds);
      const [publication, profileSettingsForCache, gradesForCache, reportCommentRowsForCache] = await Promise.all([
        getClassExamPublication(examId, classId),
        db.select().from(gradeProfileSettings).where(eq(gradeProfileSettings.schoolId, schoolId)),
        storage.getGradesBySchool(schoolId),
        db.select().from(reportComments).where(eq(reportComments.schoolId, schoolId)),
      ]);
      const gradingConfigurationFingerprint = reportGradingConfigurationFingerprint(profileSettingsForCache, gradesForCache);
      const brandingFingerprint = reportBrandingFingerprint(school);
      const effectiveReportCommentRowsForCache = effectiveOverallCommentRows(publication, reportCommentRowsForCache);
      const overallCommentsFingerprint = reportCommentsFingerprint(effectiveReportCommentRowsForCache);
      const buildCanonicalFullClassPayload = publication?.isPublished === true;
      const reportStudents = buildCanonicalFullClassPayload
        ? students
        : requestedStudentIds.length
          ? students.filter((student) => requestedStudentIdSet.has(Number(student.id)))
          : students;
      const reportStudentIds = reportStudents.map((student) => Number(student.id));
      const reportStudentIdSet = new Set(reportStudentIds);
      if (publication?.isPublished === true) {
        const cacheArgs = {
          schoolId,
          examId,
          classId,
          publicationVersion: Number(publication.publicationVersion || 0),
          gradingConfigurationFingerprint,
          brandingFingerprint,
          reportCommentsFingerprint: overallCommentsFingerprint,
        };
        const fullCachePath = reportDataCachePath(cacheArgs);
        const selectedCachePath = requestedStudentIds.length
          ? reportDataCachePath({ ...cacheArgs, studentIds: requestedStudentIds })
          : fullCachePath;
        const cachedPayload = await readJsonCache<any>(fullCachePath)
          || (selectedCachePath !== fullCachePath ? await readJsonCache<any>(selectedCachePath) : null);
        if (cachedPayload) {
          const payload = filterCachedReportPayload(cachedPayload, requestedStudentIds);
          res.setHeader("X-Report-Data-Cache", "HIT");
          res.setHeader("Server-Timing", `cache;dur=${Date.now() - requestStartedAt}, total;dur=${Date.now() - requestStartedAt}`);
          if (req.query.pdfData === "1" || req.path.endsWith("/pdf-data")) {
            console.info(`[academic-pdf] report data cache hit exam=${examId} class=${classId} learners=${payload.reportCards?.length || 0}`);
          }
          return res.json(payload);
        }

        const existingBuild = reportDataBuildInFlight.get(fullCachePath);
        if (existingBuild) {
          console.info(`[academic-pdf] waiting for full-class report data exam=${examId} class=${classId}`);
          await existingBuild.catch(() => undefined);
          const payloadAfterWait = await readJsonCache<any>(fullCachePath);
          if (payloadAfterWait) {
            const payload = filterCachedReportPayload(payloadAfterWait, requestedStudentIds);
            res.setHeader("X-Report-Data-Cache", "HIT-WAIT");
            res.setHeader("Server-Timing", `cache_wait;dur=${Date.now() - requestStartedAt}, total;dur=${Date.now() - requestStartedAt}`);
            return res.json(payload);
          }
        }

        let resolveBuild!: () => void;
        let rejectBuild!: (error: unknown) => void;
        const buildPromise = new Promise<void>((resolve, reject) => {
          resolveBuild = resolve;
          rejectBuild = reject;
        });
        buildPromise.catch(() => undefined);
        dataBuildLock = { key: fullCachePath, promise: buildPromise, resolve: resolveBuild, reject: rejectBuild };
        reportDataBuildInFlight.set(fullCachePath, buildPromise);
      }
      markTiming("context");
      const rawAssessments = (await storage.getAssessmentsByExam(examId))
        .filter((assessment: any) => Number(assessment.classId) === Number(classId));
      const rawAssessmentIds = rawAssessments.map((assessment: any) => Number(assessment.id));
      const [allMarks, assessmentType, assessmentCommentRows] = await Promise.all([
        rawAssessmentIds.length > 0
          ? storage.getAssessmentMarksByAssessments(rawAssessmentIds)
          : Promise.resolve([]),
        exam.assessmentTypeId
          ? storage.getAssessmentType(Number(exam.assessmentTypeId))
          : Promise.resolve(undefined),
        storage.getAssessmentComments(schoolId, classId),
      ]);
      const canonicalAssessmentSelection = selectCanonicalAssessments(rawAssessments, allMarks);
      const allAssessments = canonicalAssessmentSelection.assessments;
      if (
        isSinglePerExamAssessmentType(assessmentType) &&
        canonicalAssessmentSelection.duplicatesByClassSubject.size > 0
      ) {
        console.warn("[academic-reports] Legacy duplicate formal assessments detected", {
          schoolId,
          examId,
          classId,
          duplicateGroups: Array.from(canonicalAssessmentSelection.duplicatesByClassSubject.entries()).map(([key, rows]) => ({
            key,
            assessmentIds: rows.map((row: any) => Number(row.id)),
          })),
        });
      }
      const assessmentCommentPool = buildAssessmentCommentPoolMap(assessmentCommentRows);

      const subjectIds = [...new Set(allAssessments.map((assessment: any) => Number(assessment.subjectId)))];
      const schoolSubjects = await storage.getSubjectsBySchool(schoolId);
      const requestedSubjectIdSet = new Set(subjectIds);
      const subjects = schoolSubjects.filter((subject: any) => requestedSubjectIdSet.has(Number(subject.id)));

      const grades = gradesForCache;
      const classStream = classInfo.streamId ? await storage.getStream(classInfo.streamId) : undefined;
      const gradeCandidatesBySubject = new Map<number, { profileKey: GradeProfileKey | null; gradingSubjectType: string | null; substitutionPolicy: string | null; grades: any[]; excluded: boolean }>();
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
          }),
        );
      }

      markTiming("current-data");

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
        }).from(staffSubjects).where(eq(staffSubjects.classId, classId));
        const staffIds = Array.from(new Set(
          allStaffSubjects.map((row) => Number(row.staffId)).filter((staffId) => Number.isInteger(staffId) && staffId > 0),
        ));
        const staffRows = staffIds.length
          ? await db.select().from(staffTable).where(inArray(staffTable.id, staffIds))
          : [];
        const userIds = Array.from(new Set(
          staffRows.map((row: any) => Number(row.userId)).filter((userId) => Number.isInteger(userId) && userId > 0),
        ));
        const userRows = userIds.length
          ? await db.select().from(users).where(inArray(users.id, userIds))
          : [];
        const usersById = new Map(userRows.map((row: any) => [Number(row.id), row]));
        const staffNames = new Map<number, string>();
        for (const staffMember of staffRows as any[]) {
          const user = staffMember.userId ? usersById.get(Number(staffMember.userId)) : null;
          const normalizedGender = String(staffMember.gender || "").toLowerCase();
          const title = normalizedGender === "male" ? "Mr." : normalizedGender === "female" ? "Ms." : "";
          const firstName = String(staffMember.firstName || user?.firstName || "").trim();
          const lastName = String(staffMember.lastName || user?.lastName || "").trim();
          const firstInitial = firstName ? `${firstName.charAt(0).toUpperCase()}.` : "";
          const displayName = lastName
            ? [title, firstInitial, lastName].filter(Boolean).join(" ").trim()
            : `${user?.firstName || staffMember.firstName || ""} ${user?.lastName || staffMember.lastName || ""}`.trim();
          staffNames.set(Number(staffMember.id), displayName || `Staff #${staffMember.id}`);
        }
        for (const assignment of allStaffSubjects) {
          teacherMap.set(
            `${assignment.subjectId}-${assignment.classId}`,
            staffNames.get(Number(assignment.staffId)) || `Staff #${assignment.staffId}`,
          );
        }
      } catch (error) {
        console.warn("[academic-reports] unable to bulk-load teacher names:", error);
      }

      const bySubject: Record<number, Record<number, number>> = {};

      const studentSubjectRows: Record<number, Record<number, {
        assessmentId: number;
        percentage: number | null;
        grade: string;
        gradePoints: number;
        gradeStatus: "PASS" | "FAIL" | "UNRESOLVED";
        rankOrder: number | null;
        profileKey: string | null;
        resolvedGrade: any | null;
        strictGradingExcluded: boolean;
        comment: string;
        commentPool: string;
        teacher: string;
        subjectId: number;
        subjectName: string;
      }>> = {};

      const studentIdSet = new Set(students.map(s => s.id));

      const assessmentBySubject = new Map(
        allAssessments.map((assessment: any) => [Number(assessment.subjectId), assessment]),
      );
      for (const subject of subjects) {
        if (!subject) continue;
        const assessment = assessmentBySubject.get(Number(subject.id));
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
          let gradeStatus: "PASS" | "FAIL" | "UNRESOLVED" = "UNRESOLVED";
          let rankOrder: number | null = null;
          const gradeContext = gradeCandidatesBySubject.get(Number(subject.id));
          const strictGradingExcluded = gradeContext?.excluded === true || isTemporarilyExcludedFromStrictGrading(subject);
          const linkedGrade = mark.gradeId
            ? grades.find((grade: any) => Number(grade.id) === Number(mark.gradeId))
            : null;
          const resolvedGrade = strictGradingExcluded
            ? linkedGrade
            : resolveStoredAssessmentGrade({
                mark,
                percentage: pctRaw,
                applicableGrades: gradeContext?.grades || [],
                allGrades: grades,
                expectedProfileKey: gradeContext?.profileKey || null,
                classId,
                subjectType: gradeContext?.gradingSubjectType || subject.subjectType,
              });
          if (resolvedGrade) {
            gradeName = resolvedGrade.gradeName;
            if (!strictGradingExcluded) {
              gradePoints = parseGradePoints(resolvedGrade.gradePoints) ?? 0;
              gradeStatus = normalizeGradeStatus(resolvedGrade.gradeStatus);
              rankOrder = Number.isInteger(Number(resolvedGrade.rankOrder)) ? Number(resolvedGrade.rankOrder) : null;
            }
          }

          const poolComment = mark.gradeId
            ? assessmentCommentPool.get(
                assessmentCommentPoolKey(classId, Number(subject.id), Number(mark.gradeId)),
              )
            : null;
          const comment = resolveEffectiveAssessmentComment({
            mark,
            statusComment,
            currentPoolComment: poolComment?.commentText,
            isPublished: publication?.isPublished === true,
          });

          if (pctRaw !== null && !strictGradingExcluded) {
            if (!bySubject[subject.id]) bySubject[subject.id] = {};
            bySubject[subject.id][student.id] = pctRaw;
          }

          if (!studentSubjectRows[student.id]) studentSubjectRows[student.id] = {};
          studentSubjectRows[student.id][subject.id] = {
            assessmentId: assessment.id,
            percentage: pctRaw,
            grade: gradeName,
            gradePoints,
            gradeStatus,
            rankOrder,
            profileKey: strictGradingExcluded ? null : gradeContext?.profileKey || null,
            resolvedGrade: strictGradingExcluded ? null : resolvedGrade || null,
            strictGradingExcluded,
            comment,
            commentPool: poolComment?.commentText || mark.autoCommentSnapshot || "",
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
        let position = 0;
        let previousPercentage: number | null = null;
        sorted.forEach(([sid, percentage], index) => {
          if (previousPercentage === null || Math.abs(Number(percentage) - previousPercentage) > 1e-9) {
            position = index + 1;
            previousPercentage = Number(percentage);
          }
          subjectRank[subjId][parseInt(sid)] = `${position}/${n}`;
        });
      }

      const prevPctMap: Record<string, number> = {};
      const overtimeMap: Record<number, Array<{ label: string; avg: number }>> = {};
      try {
        const allSchoolExams = await storage.getExamsBySchool(schoolId);
        const currentExamAssessmentTypeId = exam.assessmentTypeId;
        const chronoExams = [...allSchoolExams]
          .filter((candidate) => currentExamAssessmentTypeId ? candidate.assessmentTypeId === currentExamAssessmentTypeId : true)
          .sort((a, b) => {
            const dateA = a.startDate ? new Date(a.startDate).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            const dateB = b.startDate ? new Date(b.startDate).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
            return dateA - dateB;
          });
        const sortedPreviousExams = allSchoolExams
          .filter((candidate) => candidate.id !== examId)
          .sort((a, b) => {
            const dateA = a.startDate ? new Date(a.startDate).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            const dateB = b.startDate ? new Date(b.startDate).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
            return dateB - dateA;
          });
        const relevantExamIds = Array.from(new Set([
          ...chronoExams.map((candidate) => Number(candidate.id)),
          ...sortedPreviousExams.slice(0, 1).map((candidate) => Number(candidate.id)),
        ])).filter((id) => Number.isInteger(id) && id > 0);
        const historicalAssessments = relevantExamIds.length
          ? await db.select().from(assessmentsSchema).where(and(
              eq(assessmentsSchema.classId, classId),
              inArray(assessmentsSchema.examId, relevantExamIds),
            ))
          : [];
        const historicalAssessmentIds = historicalAssessments.map((assessment: any) => Number(assessment.id));
        const historicalMarks = historicalAssessmentIds.length
          ? reportStudentIds.length < students.length
            ? await db.select().from(assessmentMarksSchema).where(and(
                inArray(assessmentMarksSchema.assessmentId, historicalAssessmentIds),
                inArray(assessmentMarksSchema.studentId, reportStudentIds),
                eq(assessmentMarksSchema.schoolId, schoolId),
              ))
            : await storage.getAssessmentMarksByAssessments(historicalAssessmentIds)
          : [];
        const assessmentsByExam = new Map<number, any[]>();
        for (const assessment of historicalAssessments as any[]) {
          const key = Number(assessment.examId);
          const rows = assessmentsByExam.get(key) || [];
          rows.push(assessment);
          assessmentsByExam.set(key, rows);
        }
        const canonicalMarksByExam = new Map<number, any[]>();
        for (const examKey of relevantExamIds) {
          const examAssessments = assessmentsByExam.get(examKey) || [];
          const examAssessmentIds = new Set(examAssessments.map((assessment: any) => Number(assessment.id)));
          const examMarks = historicalMarks.filter((mark: any) => examAssessmentIds.has(Number(mark.assessmentId)));
          const canonicalIds = new Set(selectCanonicalAssessments(examAssessments, examMarks).assessments.map((assessment: any) => Number(assessment.id)));
          canonicalMarksByExam.set(examKey, examMarks.filter((mark: any) => canonicalIds.has(Number(mark.assessmentId))));
        }

        const prevExam = sortedPreviousExams[0];
        for (const mark of prevExam ? canonicalMarksByExam.get(Number(prevExam.id)) || [] : []) {
          if (!reportStudentIdSet.has(Number(mark.studentId))) continue;
          const percentage = parseFinitePercentage(mark.percentage);
          if (percentage !== null) prevPctMap[`${mark.studentId}-${mark.subjectId}`] = percentage;
        }

        for (const studentObj of reportStudents) {
          const studentOvertime: Array<{ label: string; avg: number }> = [];
          for (const historicalExam of chronoExams) {
            const studentPastMarks = (canonicalMarksByExam.get(Number(historicalExam.id)) || [])
              .filter((mark: any) => Number(mark.studentId) === Number(studentObj.id))
              .map((mark: any) => parseFinitePercentage(mark.percentage))
              .filter((value): value is number => value !== null);
            if (!studentPastMarks.length) continue;
            const avg = Math.round(studentPastMarks.reduce((sum, value) => sum + value, 0) / studentPastMarks.length);
            const termLabel = historicalExam.termId ? `T${historicalExam.termId}` : "";
            const label = termLabel ? `${termLabel} - ${historicalExam.examName}` : historicalExam.examName;
            studentOvertime.push({ label, avg });
          }
          overtimeMap[studentObj.id] = studentOvertime;
        }
      } catch (error) {
        console.warn("[academic-reports] unable to bulk-load historical report data:", error);
      }

      markTiming("historical-data");
      const uniqueStreamIds = new Set(
        reportStudents.map((student) => Number(student.streamId)).filter((id) => Number.isInteger(id) && id > 0),
      );
      const allStreamRows = uniqueStreamIds.size ? await storage.getAllStreams() : [];
      const studentStreams = new Map(
        allStreamRows.filter((streamRow: any) => uniqueStreamIds.has(Number(streamRow.id)))
          .map((streamRow: any) => [Number(streamRow.id), streamRow]),
      );

      const ecdSectionsByStudent = await loadEcdSectionsForStudentsExam({
        studentIds: reportStudents.map((student) => Number(student.id)),
        examId,
        isEndOfTermExam: assessmentType?.name === "End-of-Term Exam",
        classStreamName: classStream?.name || null,
        studentStreamNames: new Map(reportStudents.map((student) => [
          Number(student.id),
          student.streamId ? studentStreams.get(Number(student.streamId))?.name || null : null,
        ])),
      });

      const reportCards = reportStudents.map((student) => {
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
          gradeStatus: "PASS" | "FAIL" | "UNRESOLVED";
          rankOrder: number | null;
          profileKey: string | null;
          strictGradingExcluded: boolean;
        }> = [];

        const sortedSubjects = Object.values(rows).sort((a, b) =>
          a.subjectName.localeCompare(b.subjectName)
        );

        let sumMarks = 0;
        let passed = 0;
        let failed = 0;
        let unresolved = 0;
        let points = 0;
        let nSubjects = 0;

        const chartSubjectLabels: string[] = [];
        const chartStudentMarks: number[] = [];
        const chartClassAvgs: (number | null)[] = [];

        for (const row of sortedSubjects) {
          const pct = row.percentage;
          const hasNumericMark = pct !== null && Number.isFinite(pct);
          if (hasNumericMark && !row.strictGradingExcluded) {
            sumMarks += pct as number;
            nSubjects++;
            if (row.gradeStatus === "PASS") passed++;
            else if (row.gradeStatus === "FAIL") failed++;
            else unresolved++;
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
            gradeStatus: row.gradeStatus,
            rankOrder: row.rankOrder,
            profileKey: row.profileKey,
            strictGradingExcluded: row.strictGradingExcluded,
          });

          if (hasNumericMark && !row.strictGradingExcluded) {
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
        const ecdSections = ecdSectionsByStudent.get(Number(student.id)) || [];

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
            subjectsFailed: nSubjects > 0 ? failed : 0,
            subjectsUnresolved: nSubjects > 0 ? unresolved : 0,
            points: nSubjects > 0 && unresolved === 0 ? points.toString() : '',
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
      });

      const allReportComments = effectiveReportCommentRowsForCache.filter(
        (comment: any) => !String(comment.commentGrade || "").startsWith(`${REPORT_CARD_OVERRIDE_PREFIX}:`),
      );
      const allGrades = (await storage.getAllGrades()).filter((grade) => grade.schoolId === schoolId);

      for (const rc of reportCards) {
        const avg = rc.summary.averagePercentage;
        const resultProfileKeys = Array.from(new Set(
          rc.subjects.map((subject: any) => String(subject.profileKey || "")).filter(Boolean),
        ));
        const profileKey = resultProfileKeys.length === 1
          ? resultProfileKeys[0] as GradeProfileKey
          : null;
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

      const overrideMap = getReportCardCommentOverrideMapFromRows(
        effectiveReportCommentRowsForCache,
        examId,
        reportCards.map((rc) => rc.student.id),
      );
      for (const rc of reportCards) {
        const overrides = overrideMap.get(rc.student.id);
        if (overrides?.principal !== undefined) {
          (rc as any).principalComment = overrides.principal || "";
        }
        if (overrides?.class_teacher !== undefined) {
          (rc as any).classTeacherComment = overrides.class_teacher || "";
        }
      }

      const expectedSubjectIds = Array.from(new Set(
        subjects
          .filter((subject: any) => !isTemporarilyExcludedFromStrictGrading(subject))
          .map((subject: any) => Number(subject.id))
          .filter(Number.isFinite),
      ));
      const profileKeys = Array.from(new Set(Array.from(gradeCandidatesBySubject.values()).map((context) => context.profileKey).filter(Boolean))) as string[];
      const settingsRows = profileSettingsForCache;
      const academicRankingMode = resolveAcademicPositionRankingMode({
        schoolType: school?.schoolType,
        streamName: classStream?.name || null,
      });
      const pointsDirection = academicRankingMode === "average_grade_points"
        ? resolveSharedPointsDirection(profileKeys, settingsRows)
        : null;
      const rankingStudentIds = students.map((student) => Number(student.id));
      const rankingSubjectAssignments = rankingStudentIds.length
        ? await db.select({ studentId: studentSubjectsSchema.studentId, subjectId: studentSubjectsSchema.subjectId })
          .from(studentSubjectsSchema)
          .where(inArray(studentSubjectsSchema.studentId, rankingStudentIds))
        : [];
      const assignedSubjectsByStudent = new Map<number, Set<number>>();
      for (const assignment of rankingSubjectAssignments) {
        const assigned = assignedSubjectsByStudent.get(Number(assignment.studentId)) || new Set<number>();
        assigned.add(Number(assignment.subjectId));
        assignedSubjectsByStudent.set(Number(assignment.studentId), assigned);
      }
      const rankingCandidates: RankingCandidate[] = students.map((student) => {
        const assigned = assignedSubjectsByStudent.get(Number(student.id));
        const studentExpectedSubjectIds = assigned?.size
          ? expectedSubjectIds.filter((subjectId) => assigned.has(Number(subjectId)))
          : expectedSubjectIds;
        return {
        id: Number(student.id),
        expectedSubjectIds: studentExpectedSubjectIds,
        results: Object.values(studentSubjectRows[student.id] || {})
          .filter((row) => !row.strictGradingExcluded && studentExpectedSubjectIds.includes(Number(row.subjectId)))
          .map((row): RankingSubjectResult => ({
          subjectId: Number(row.subjectId),
          percentage: row.percentage,
          grade: row.resolvedGrade,
          profileKey: row.profileKey,
        })),
      };
      });
      const classPositionMap = academicRankingMode === "none"
        ? emptyAcademicPositionMap("none")
        : academicRankingMode
          ? {
              ...calculateConfiguredPositionMap({
                candidates: rankingCandidates,
                pointsDirection,
                rankingMode: academicRankingMode,
              }),
              rankingMode: academicRankingMode,
            }
          : unresolvedAcademicPositionMap(rankingStudentIds, "position_stream_unrecognized");
      const streamPositionMap = academicRankingMode === "none"
        ? emptyAcademicPositionMap("none")
        : await calculateStreamPositionMap(examId, schoolId, classInfo?.streamId || null);
      const classSize = classPositionMap.size;

      for (const rc of reportCards) {
        rc.summary.classSize = classSize;
        rc.summary.classPosition = academicRankingMode === "none" ? '' : classPositionMap.map.get(rc.student.id) || '';
        rc.summary.overallPosition = academicRankingMode === "none"
          ? ''
          : streamPositionMap.map.get(rc.student.id) || rc.summary.classPosition || '';
        (rc.summary as any).positionStatus = classPositionMap.unresolved.has(rc.student.id) ? "UNRESOLVED" : "READY";
        (rc.summary as any).positionIssues = classPositionMap.unresolved.get(rc.student.id) || [];
      }

      reportCards.sort((left, right) => {
        const leftPosition = parsePositionNumber(left.summary.classPosition);
        const rightPosition = parsePositionNumber(right.summary.classPosition);
        if (leftPosition !== null && rightPosition !== null && leftPosition !== rightPosition) {
          return leftPosition - rightPosition;
        }
        if (leftPosition !== null && rightPosition === null) return -1;
        if (leftPosition === null && rightPosition !== null) return 1;
        return compareStudentsByFirstName(left.student, right.student);
      });

      markTiming("assemble");
      const payload = {
        positionRankingMode: academicRankingMode,
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
      };
      markTiming("serialize");
      const totalDuration = Date.now() - requestStartedAt;
      const serverTiming = [...timingMarks, { name: "total", duration: totalDuration }]
        .map((item) => `${item.name};dur=${Math.max(0, item.duration)}`)
        .join(", ");
      res.setHeader("Server-Timing", serverTiming);
      if (req.query.pdfData === "1" || req.path.endsWith("/pdf-data")) {
        console.info(`[academic-pdf] report data exam=${examId} class=${classId} learners=${reportCards.length} totalMs=${totalDuration} ${serverTiming}`);
      }
      if (publication?.isPublished === true) {
        const cachePath = reportDataCachePath({
          schoolId,
          examId,
          classId,
          publicationVersion: Number(publication.publicationVersion || 0),
          gradingConfigurationFingerprint,
          brandingFingerprint,
          reportCommentsFingerprint: overallCommentsFingerprint,
        });
        let cachePersisted = false;
        try {
          await writeJsonCache(cachePath, payload);
          cachePersisted = true;
          queueAcademicReportCacheCleanup();
        } catch (cacheError) {
          // A cache filesystem problem must not make a valid report request fail.
          console.warn(`[academic-report-cache] unable to persist full-class data exam=${examId} class=${classId}:`, cacheError);
        }
        dataBuildLock?.resolve();
        res.setHeader("X-Report-Data-Cache", cachePersisted ? "MISS" : "MISS-NOT-STORED");
      } else {
        res.setHeader("X-Report-Data-Cache", "BYPASS");
      }
      res.json(filterCachedReportPayload(payload, requestedStudentIds));
    } catch (error) {
      dataBuildLock?.reject(error);
      next(error);
    } finally {
      if (dataBuildLock && reportDataBuildInFlight.get(dataBuildLock.key) === dataBuildLock.promise) {
        reportDataBuildInFlight.delete(dataBuildLock.key);
      }
    }
  };

  app.get("/api/report-cards/:examId/class/:classId", requireAuth, handleClassReportCardData);
  app.post("/api/report-cards/:examId/pdf-data", requireAuth, (req, res, next) => {
    const parsed = z.object({
      classId: z.coerce.number().int().positive(),
      studentIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
    }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid PDF report selection", errors: parsed.error.errors });
    }
    req.params.classId = String(parsed.data.classId);
    req.query.studentIds = Array.from(new Set(parsed.data.studentIds)).join(",");
    req.query.pdfData = "1";
    return handleClassReportCardData(req, res, next);
  });

  // Get individual student report card
  app.get("/api/report-cards/:examId/student/:studentId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseIdParam(req.params.examId);
      const studentId = parseIdParam(req.params.studentId);
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

      const rawAssessments = (await storage.getAssessmentsByExam(examId))
        .filter((assessment: any) => Number(assessment.classId) === Number(classInfo.id));
      const rawAssessmentIds = rawAssessments.map((assessment: any) => Number(assessment.id));
      const [allClassMarks, grades, classStream, publication, assessmentCommentRows] = await Promise.all([
        rawAssessmentIds.length > 0
          ? storage.getAssessmentMarksByAssessments(rawAssessmentIds)
          : Promise.resolve([]),
        storage.getGradesBySchool(schoolId),
        classInfo.streamId ? storage.getStream(classInfo.streamId) : Promise.resolve(undefined),
        getClassExamPublication(examId, Number(classInfo.id)),
        storage.getAssessmentComments(schoolId, Number(classInfo.id)),
      ]);
      const allAssessments = selectCanonicalAssessments(rawAssessments, allClassMarks).assessments;
      const marksByAssessment = new Map(
        allClassMarks
          .filter((mark: any) => Number(mark.studentId) === Number(studentId))
          .map((mark: any) => [Number(mark.assessmentId), mark]),
      );
      const assessmentCommentPool = buildAssessmentCommentPoolMap(assessmentCommentRows);

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

        const mark: any = marksByAssessment.get(Number(assessment.id));
        if (!mark) continue;

        const percentage = parseFinitePercentage(mark.percentage);
        const statusComment = markStatusLabel(mark.attStatus);
        if (percentage === null && !statusComment) continue;

        let gradeName = "";
        let gradePoints = 0;

        {
          const gradeContext = getClassSubjectGradeCandidates({
            allGrades: grades,
            school,
            classInfo,
            classStreamName: classStream?.name || null,
            subject,
          });
          const linkedGrade = mark.gradeId
            ? grades.find((grade: any) => Number(grade.id) === Number(mark.gradeId))
            : null;
          const resolvedGrade = gradeContext.excluded
            ? linkedGrade
            : resolveStoredAssessmentGrade({
                mark,
                percentage,
                applicableGrades: gradeContext.grades,
                allGrades: grades,
                expectedProfileKey: gradeContext.profileKey,
                classId: Number(classInfo.id),
                subjectType: gradeContext.gradingSubjectType || subject.subjectType,
              });
          if (resolvedGrade) {
            gradeName = resolvedGrade.gradeName;
            if (!gradeContext.excluded) {
              gradePoints = resolvedGrade.gradePoints ? parseFloat(resolvedGrade.gradePoints as string) : 0;
            }
          }

          if (percentage !== null && !gradeContext.excluded) {
            totalPercentage += percentage;
            totalGradePoints += gradePoints;
            subjectCount++;
          }
        }

        const poolComment = mark.gradeId
          ? assessmentCommentPool.get(
              assessmentCommentPoolKey(Number(classInfo.id), Number(subject.id), Number(mark.gradeId)),
            )
          : null;
        const comment = resolveEffectiveAssessmentComment({
          mark,
          statusComment,
          currentPoolComment: poolComment?.commentText,
          isPublished: publication?.isPublished === true,
        });

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
    const rawAssessments = (await storage.getAssessmentsByExam(examId))
      .filter((assessment: any) => !studentForClass?.classId || Number(assessment.classId) === Number(studentForClass.classId));
    const rawAssessmentIds = rawAssessments.map((assessment: any) => Number(assessment.id));
    const allAssessmentMarks = rawAssessmentIds.length > 0
      ? await storage.getAssessmentMarksByAssessments(rawAssessmentIds)
      : [];
    const allAssessments = selectCanonicalAssessments(rawAssessments, allAssessmentMarks).assessments;
    const marksByAssessment = new Map(
      allAssessmentMarks
        .filter((mark: any) => Number(mark.studentId) === Number(studentId))
        .map((mark: any) => [Number(mark.assessmentId), mark]),
    );
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

      const mark: any = marksByAssessment.get(Number(assessment.id));
      if (!mark) continue;

      const statusComment = markStatusLabel(mark.attStatus);
      const pctNum = parseFinitePercentage(mark.percentage);
      if (pctNum === null && !statusComment) continue;

      const pctStr = pctNum !== null
        ? (pctNum % 1 === 0 ? String(Math.round(pctNum)) : pctNum.toFixed(1))
        : '';
      let gradeName = '';
      let gradePoints = 0;

      const gradeContext = studentClass
        ? getClassSubjectGradeCandidates({
            allGrades: grades,
            school: schoolInfo,
            classInfo: studentClass,
            classStreamName: classStream?.name || null,
            subject,
          })
        : { profileKey: null, gradingSubjectType: null, substitutionPolicy: null, grades: [] as any[], excluded: false };
      const linkedGrade = mark.gradeId
        ? grades.find((grade: any) => Number(grade.id) === Number(mark.gradeId))
        : null;
      const resolvedGrade = gradeContext.excluded
        ? linkedGrade
        : resolveStoredAssessmentGrade({
            mark,
            percentage: pctNum,
            applicableGrades: gradeContext.grades,
            allGrades: grades,
            expectedProfileKey: gradeContext.profileKey,
            classId: Number(studentClass?.id || 0),
            subjectType: gradeContext.gradingSubjectType || subject.subjectType,
          });
      if (resolvedGrade) {
        gradeName = resolvedGrade.gradeName;
        if (!gradeContext.excluded) {
          gradePoints = resolvedGrade.gradePoints ? parseFloat(resolvedGrade.gradePoints as string) : 0;
        }
      }

      lines.push({ subject: subject.name, pct: pctStr, grade: gradeName, statusComment });
      if (pctNum !== null && !gradeContext.excluded) {
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


  const REPORT_PDF_TEMPLATE_VERSION = "report-card-v8-position-policy-ecd-layout";
  const REPORT_PDF_PREPARATION_VERSION = "report-card-preparation-v3-position-policy";
  type ReportPdfCacheStatus = "HIT" | "MISS" | "BYPASS";
  type ReportPdfPriority = "interactive" | "background";
  type ReportPdfContext = {
    shouldCache: boolean;
    publicationVersion: number;
    gradingConfigurationFingerprint: string;
    brandingFingerprint: string;
    reportCommentsFingerprint: string;
    publishedCommentSnapshotAvailable: boolean;
    schoolId: number;
    examId: number;
    classId: number;
  };
  type ReportPdfPreparationStatus = {
    version: 1;
    state: "idle" | "queued" | "running" | "ready" | "failed" | "interrupted";
    schoolId: number;
    examId: number;
    classId: number;
    publicationVersion: number;
    total: number;
    completed: number;
    failed: number;
    startedAt: string | null;
    updatedAt: string;
    finishedAt: string | null;
    message: string | null;
  };

  const reportPdfInFlight = new Map<string, Promise<{ buffer: Buffer; cacheStatus: ReportPdfCacheStatus }>>();
  const reportPreparationInFlight = new Map<string, Promise<void>>();

  async function loadReportPdfContext(args: { schoolId: number; examId: number; classId: number }): Promise<ReportPdfContext> {
    const [publication, school, settingsRows, gradeRows, reportCommentRows] = await Promise.all([
      getClassExamPublication(args.examId, args.classId),
      storage.getSchool(args.schoolId),
      db.select().from(gradeProfileSettings).where(eq(gradeProfileSettings.schoolId, args.schoolId)),
      storage.getGradesBySchool(args.schoolId),
      db.select().from(reportComments).where(eq(reportComments.schoolId, args.schoolId)),
    ]);
    const shouldCache = publication?.isPublished === true;
    const effectiveReportCommentRows = effectiveOverallCommentRows(publication, reportCommentRows);
    return {
      shouldCache,
      publicationVersion: Number(publication?.publicationVersion || 0),
      gradingConfigurationFingerprint: reportGradingConfigurationFingerprint(settingsRows, gradeRows),
      brandingFingerprint: reportBrandingFingerprint(school),
      reportCommentsFingerprint: reportCommentsFingerprint(effectiveReportCommentRows),
      publishedCommentSnapshotAvailable: shouldCache && Array.isArray(publication?.overallCommentRowsSnapshot),
      schoolId: args.schoolId,
      examId: args.examId,
      classId: args.classId,
    };
  }

  function reportPdfCachePath(context: ReportPdfContext, studentIds: number[]): string {
    const cacheKey = reportCacheKey({
      templateVersion: REPORT_PDF_TEMPLATE_VERSION,
      schoolId: context.schoolId,
      examId: context.examId,
      classId: context.classId,
      publicationVersion: context.publicationVersion,
      gradingConfigurationFingerprint: context.gradingConfigurationFingerprint,
      brandingFingerprint: context.brandingFingerprint,
      reportCommentsFingerprint: context.reportCommentsFingerprint,
      studentIds,
    });
    return path.join(academicReportPdfCacheDirectory(), `${cacheKey}.pdf`);
  }

  function reportPreparationStatusPath(context: ReportPdfContext): string {
    const key = reportCacheKey({
      templateVersion: REPORT_PDF_PREPARATION_VERSION,
      schoolId: context.schoolId,
      examId: context.examId,
      classId: context.classId,
      publicationVersion: context.publicationVersion,
      gradingConfigurationFingerprint: context.gradingConfigurationFingerprint,
      brandingFingerprint: context.brandingFingerprint,
      reportCommentsFingerprint: context.reportCommentsFingerprint,
    });
    return path.join(academicReportPreparationDirectory(), `${key}.json`);
  }

  async function reportPdfContextIsStable(context: ReportPdfContext): Promise<boolean> {
    if (!context.shouldCache || context.publishedCommentSnapshotAvailable) return context.shouldCache;
    const currentRows = await db.select().from(reportComments).where(eq(reportComments.schoolId, context.schoolId));
    return reportCommentsFingerprint(currentRows) === context.reportCommentsFingerprint;
  }

  async function renderReportPdfRoute(args: {
    req: Request;
    context: ReportPdfContext;
    studentIds: number[];
    priority: ReportPdfPriority;
  }): Promise<Buffer> {
    const params = new URLSearchParams({
      examId: String(args.context.examId),
      classId: String(args.context.classId),
      studentIds: args.studentIds.join(","),
    });
    return renderAppRoutePdf({
      req: args.req,
      schoolId: args.context.schoolId,
      route: `/pdf-render/report-cards?${params.toString()}`,
      priority: args.priority,
      pdfOptions: {
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "2mm", right: "2mm", bottom: "2mm", left: "2mm" },
      },
    });
  }

  async function generateCanonicalIndividualReportPdf(args: {
    req: Request;
    context: ReportPdfContext;
    studentId: number;
    priority: ReportPdfPriority;
  }): Promise<{ buffer: Buffer; cacheStatus: ReportPdfCacheStatus }> {
    const studentIds = [args.studentId];
    const cachePath = args.context.shouldCache ? reportPdfCachePath(args.context, studentIds) : null;
    if (cachePath) {
      const cached = await readBufferCache(cachePath);
      if (cached) return { buffer: cached, cacheStatus: "HIT" };
    }

    const inFlightKey = cachePath || `bypass:${args.context.schoolId}:${args.context.examId}:${args.context.classId}:${args.studentId}`;
    const existing = reportPdfInFlight.get(inFlightKey);
    if (existing) return existing;

    const job = (async (): Promise<{ buffer: Buffer; cacheStatus: ReportPdfCacheStatus }> => {
      const buffer = await renderReportPdfRoute({
        req: args.req,
        context: args.context,
        studentIds,
        priority: args.priority,
      });
      const cacheStable = await reportPdfContextIsStable(args.context);
      let cachePersisted = false;
      if (cachePath && cacheStable) {
        try {
          await writeBufferCache(cachePath, buffer);
          cachePersisted = true;
          queueAcademicReportCacheCleanup();
        } catch (cacheError) {
          // Serve the rendered PDF even when persistent caching is temporarily unavailable.
          console.warn(`[academic-report-cache] unable to persist learner PDF exam=${args.context.examId} class=${args.context.classId} student=${args.studentId}:`, cacheError);
        }
      }
      return { buffer, cacheStatus: cachePersisted ? "MISS" : "BYPASS" };
    })();
    reportPdfInFlight.set(inFlightKey, job);
    try {
      return await job;
    } finally {
      if (reportPdfInFlight.get(inFlightKey) === job) reportPdfInFlight.delete(inFlightKey);
    }
  }

  async function canonicalizeReportSelection(classId: number, requestedStudentIds: number[]): Promise<number[]> {
    const requested = new Set(requestedStudentIds.map(Number));
    const learners = await storage.getStudentsByClass(classId);
    return learners.map((student) => Number(student.id)).filter((studentId) => requested.has(studentId));
  }

  function logReportPdfSize(args: {
    context: ReportPdfContext;
    studentCount: number;
    buffer: Buffer;
    cacheStatus: ReportPdfCacheStatus;
    generationMs: number;
  }): void {
    const bytesPerLearner = Math.round(args.buffer.length / Math.max(1, args.studentCount));
    const warnTotalMb = Math.max(1, Number(process.env.ACADEMIC_REPORT_PDF_WARN_MB || 40));
    const warnBytesPerLearner = Math.max(100_000, Number(process.env.ACADEMIC_REPORT_PDF_WARN_BYTES_PER_LEARNER || 1_500_000));
    const message = `[academic-pdf] class-selection exam=${args.context.examId} class=${args.context.classId} learners=${args.studentCount} cache=${args.cacheStatus} generationMs=${args.generationMs} bytes=${args.buffer.length} bytesPerLearner=${bytesPerLearner}`;
    if (args.buffer.length > warnTotalMb * 1024 * 1024 || bytesPerLearner > warnBytesPerLearner) {
      console.warn(`${message} oversized=true`);
      return;
    }
    console.info(message);
  }

  async function generateReportCardChromiumPdf(args: {
    req: Request;
    schoolId: number;
    examId: number;
    classId: number;
    studentIds: number[];
    priority?: ReportPdfPriority;
    context?: ReportPdfContext;
  }): Promise<{ buffer: Buffer; cacheStatus: ReportPdfCacheStatus }> {
    const startedAt = Date.now();
    const priority = args.priority || "interactive";
    const requestedStudentIds = Array.from(new Set(args.studentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
    if (!requestedStudentIds.length) throw new Error("At least one learner is required for report PDF generation");
    const context = args.context || await loadReportPdfContext(args);
    const studentIds = await canonicalizeReportSelection(args.classId, requestedStudentIds);
    if (studentIds.length !== requestedStudentIds.length) {
      throw new Error("One or more selected learners do not belong to this class");
    }

    if (studentIds.length === 1) {
      const result = await generateCanonicalIndividualReportPdf({
        req: args.req,
        context,
        studentId: studentIds[0],
        priority,
      });
      logReportPdfSize({
        context,
        studentCount: 1,
        buffer: result.buffer,
        cacheStatus: result.cacheStatus,
        generationMs: Date.now() - startedAt,
      });
      return result;
    }

    const selectionCachePath = context.shouldCache ? reportPdfCachePath(context, studentIds) : null;
    if (selectionCachePath) {
      const cachedSelection = await readBufferCache(selectionCachePath);
      if (cachedSelection) {
        const result = { buffer: cachedSelection, cacheStatus: "HIT" as const };
        logReportPdfSize({
          context,
          studentCount: studentIds.length,
          buffer: result.buffer,
          cacheStatus: result.cacheStatus,
          generationMs: Date.now() - startedAt,
        });
        return result;
      }
    }

    const inFlightKey = selectionCachePath
      || `bypass-selection:${context.schoolId}:${context.examId}:${context.classId}:${studentIds.join(",")}`;
    const existing = reportPdfInFlight.get(inFlightKey);
    if (existing) {
      console.info(`[academic-pdf] joined in-flight single-pass selection exam=${args.examId} class=${args.classId} learners=${studentIds.length}`);
      return existing;
    }

    const job = (async (): Promise<{ buffer: Buffer; cacheStatus: ReportPdfCacheStatus }> => {
      // Render a class or filtered selection as one browser document and one
      // page.pdf() call. Standalone learner PDFs duplicate fonts and images
      // when merged, producing very large files and much slower downloads.
      const buffer = await renderReportPdfRoute({
        req: args.req,
        context,
        studentIds,
        priority,
      });
      const cacheStable = await reportPdfContextIsStable(context);
      let cachePersisted = false;
      if (selectionCachePath && cacheStable) {
        try {
          await writeBufferCache(selectionCachePath, buffer);
          cachePersisted = true;
          queueAcademicReportCacheCleanup();
        } catch (cacheError) {
          console.warn(`[academic-report-cache] unable to persist single-pass PDF exam=${args.examId} class=${args.classId}:`, cacheError);
        }
      }
      return {
        buffer,
        cacheStatus: cachePersisted ? "MISS" : "BYPASS",
      };
    })();
    reportPdfInFlight.set(inFlightKey, job);
    try {
      const result = await job;
      logReportPdfSize({
        context,
        studentCount: studentIds.length,
        buffer: result.buffer,
        cacheStatus: result.cacheStatus,
        generationMs: Date.now() - startedAt,
      });
      return result;
    } finally {
      if (reportPdfInFlight.get(inFlightKey) === job) reportPdfInFlight.delete(inFlightKey);
    }
  }

  async function writeReportPreparationStatus(filePath: string, status: ReportPdfPreparationStatus): Promise<void> {
    await writeJsonCache(filePath, status);
    queueAcademicReportCacheCleanup();
  }

  function makePreparationStatus(args: {
    context: ReportPdfContext;
    state: ReportPdfPreparationStatus["state"];
    total: number;
    completed?: number;
    failed?: number;
    startedAt?: string | null;
    finishedAt?: string | null;
    message?: string | null;
  }): ReportPdfPreparationStatus {
    return {
      version: 1,
      state: args.state,
      schoolId: args.context.schoolId,
      examId: args.context.examId,
      classId: args.context.classId,
      publicationVersion: args.context.publicationVersion,
      total: args.total,
      completed: args.completed || 0,
      failed: args.failed || 0,
      startedAt: args.startedAt ?? null,
      updatedAt: new Date().toISOString(),
      finishedAt: args.finishedAt ?? null,
      message: args.message ?? null,
    };
  }

  async function queuePublishedReportPdfGeneration(args: {
    req: Request;
    schoolId: number;
    examId: number;
    classId: number;
    force?: boolean;
  }): Promise<ReportPdfPreparationStatus> {
    if (process.env.PDF_PREGENERATE_ON_PUBLISH === "false") {
      const context = await loadReportPdfContext(args);
      return makePreparationStatus({ context, state: "idle", total: 0, message: "Automatic preparation is disabled." });
    }

    const cookieHeader = args.req.headers.cookie;
    const schoolHeader = args.req.headers["x-school-id"];
    const backgroundRequest = {
      headers: { cookie: cookieHeader, "x-school-id": schoolHeader },
      protocol: args.req.protocol,
      get: (name: string) => args.req.get(name),
    } as Request;
    const context = await loadReportPdfContext(args);
    if (!context.shouldCache) throw new Error("Publish the class reports before preparing the PDF cache");
    const learners = await storage.getStudentsByClass(args.classId);
    const studentIds = learners.map((student) => Number(student.id)).filter((id) => Number.isInteger(id) && id > 0);
    const statusPath = reportPreparationStatusPath(context);
    const fullClassCachePath = studentIds.length ? reportPdfCachePath(context, studentIds) : null;
    const existingStatus = await readJsonCache<ReportPdfPreparationStatus>(statusPath);
    const existingClassPdf = fullClassCachePath
      ? await fs.stat(fullClassCachePath).catch(() => null)
      : null;
    if (!args.force && existingStatus?.state === "ready" && existingStatus.total === studentIds.length && (studentIds.length === 0 || (existingClassPdf?.size || 0) > 0)) {
      return existingStatus;
    }
    if (reportPreparationInFlight.has(statusPath)) {
      return existingStatus || makePreparationStatus({ context, state: "running", total: studentIds.length });
    }

    if (args.force && fullClassCachePath) {
      await fs.rm(fullClassCachePath, { force: true }).catch(() => undefined);
    }

    const queuedStatus = makePreparationStatus({
      context,
      state: "queued",
      total: studentIds.length,
      message: "The full-class PDF will be prepared automatically.",
    });
    await writeReportPreparationStatus(statusPath, queuedStatus);

    const startedAt = new Date().toISOString();
    const job = new Promise<void>((resolve) => {
      setImmediate(() => {
        void (async () => {
          await writeReportPreparationStatus(statusPath, makePreparationStatus({
            context,
            state: "running",
            total: studentIds.length,
            startedAt,
            message: "Preparing the full-class PDF in one pass.",
          }));

          if (studentIds.length > 0) {
            await generateReportCardChromiumPdf({
              ...args,
              req: backgroundRequest,
              studentIds,
              priority: "background",
              context,
            });
          }

          await writeReportPreparationStatus(statusPath, makePreparationStatus({
            context,
            state: "ready",
            total: studentIds.length,
            completed: studentIds.length,
            failed: 0,
            startedAt,
            finishedAt: new Date().toISOString(),
            message: studentIds.length
              ? "The full-class download is ready. Individual reports generate automatically when requested."
              : "There are no learners in this class.",
          }));
          console.info(`[academic-pdf] automatic class PDF ready exam=${args.examId} class=${args.classId} learners=${studentIds.length}`);
        })().catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[academic-pdf] automatic class PDF preparation failed exam=${args.examId} class=${args.classId}:`, error);
          await writeReportPreparationStatus(statusPath, makePreparationStatus({
            context,
            state: "failed",
            total: studentIds.length,
            completed: 0,
            failed: studentIds.length || 1,
            startedAt,
            finishedAt: new Date().toISOString(),
            message,
          })).catch(() => undefined);
        }).finally(() => resolve());
      });
    });
    reportPreparationInFlight.set(statusPath, job);
    void job.finally(() => {
      if (reportPreparationInFlight.get(statusPath) === job) reportPreparationInFlight.delete(statusPath);
    });
    return queuedStatus;
  }

  async function getReportPreparationStatus(args: {
    schoolId: number;
    examId: number;
    classId: number;
  }): Promise<ReportPdfPreparationStatus> {
    const context = await loadReportPdfContext(args);
    const learners = await storage.getStudentsByClass(args.classId);
    const statusPath = reportPreparationStatusPath(context);
    const current = await readJsonCache<ReportPdfPreparationStatus>(statusPath);
    if (!current) return makePreparationStatus({ context, state: "idle", total: learners.length });
    if ((current.state === "queued" || current.state === "running") && !reportPreparationInFlight.has(statusPath)) {
      const lastUpdate = Date.parse(current.updatedAt);
      if (!Number.isFinite(lastUpdate) || Date.now() - lastUpdate > 2 * 60_000) {
        const interrupted = { ...current, state: "interrupted" as const, updatedAt: new Date().toISOString(), message: "Automatic class PDF preparation was interrupted and will be retried when requested." };
        await writeReportPreparationStatus(statusPath, interrupted);
        return interrupted;
      }
    }
    return current;
  }


  app.get("/api/report-cards/:examId/student/:studentId/download", requireAuth, async (req, res, next) => {
    try {
      const examId = parseIdParam(req.params.examId);
      const studentId = parseIdParam(req.params.studentId);
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

      const generatedPdf = await generateReportCardChromiumPdf({ req, schoolId, examId, classId: activeClassId, studentIds: [studentId] });
      const pdfBuffer = generatedPdf.buffer;
      res.setHeader("X-PDF-Cache", generatedPdf.cacheStatus);
      res.setHeader("X-PDF-Bytes", String(pdfBuffer.length));
      res.setHeader("X-PDF-Learners", "1");
      const safeStudentName = `${student.firstName}_${student.lastName}`.replace(/\s+/g, "_");
      const safeClassName = (classInfo.className || 'Class').replace(/\s+/g, "_");
      const safeExamName = (exam.examName || 'Exam').replace(/\s+/g, "_");

      const filename = reportPdfFilename(`Report_Card_${safeStudentName}_${safeClassName}_${safeExamName}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  });

  const reportCardPdfSelectionSchema = z.object({
    classId: z.coerce.number().int().positive(),
    studentIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
  });

  app.post("/api/report-cards/:examId/pdf", requireAuth, async (req, res, next) => {
    try {
      const examId = Number(req.params.examId);
      const parsed = reportCardPdfSelectionSchema.parse(req.body);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId || !currentUser) return res.status(400).json({ message: "School context required" });
      if (currentUser.role === "student" || currentUser.role === "parent") {
        return res.status(403).json({ message: "Batch report downloads are not available in this portal" });
      }

      const [classInfo, exam, classStudents] = await Promise.all([
        storage.getClass(parsed.classId),
        storage.getExam(examId),
        storage.getStudentsByClass(parsed.classId),
      ]);
      if (!classInfo || Number(classInfo.schoolId) !== Number(schoolId)) return res.status(404).json({ message: "Class not found" });
      if (!exam || (exam.schoolId && Number(exam.schoolId) !== Number(schoolId))) return res.status(404).json({ message: "Exam not found" });

      const validIds = new Set(classStudents.map((student: any) => Number(student.id)));
      const requestedIds: number[] = Array.from(new Set<number>(parsed.studentIds));
      if (requestedIds.some((id) => !validIds.has(id))) {
        return res.status(400).json({ message: "One or more selected learners do not belong to this class" });
      }

      const generatedPdf = await generateReportCardChromiumPdf({ req, schoolId, examId, classId: parsed.classId, studentIds: requestedIds });
      const pdfBuffer = generatedPdf.buffer;
      res.setHeader("X-PDF-Cache", generatedPdf.cacheStatus);
      res.setHeader("X-PDF-Bytes", String(pdfBuffer.length));
      res.setHeader("X-PDF-Learners", String(requestedIds.length));
      const selectionPrefix = requestedIds.length === classStudents.length ? "Report_Cards" : "Filtered_Report_Cards";
      const filename = reportPdfFilename(`${selectionPrefix}_${classInfo.className || "Class"}_${exam.examName || "Exam"}`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid report selection", errors: error.errors });
      next(error);
    }
  });

  app.get("/api/report-cards/:examId/pdf/status", requireAuth, async (req, res, next) => {
    try {
      const examId = Number(req.params.examId);
      const classId = Number(req.query.classId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId || !currentUser || !Number.isInteger(examId) || !Number.isInteger(classId)) {
        return res.status(400).json({ message: "School, exam and class context are required" });
      }
      if (currentUser.role === "student" || currentUser.role === "parent") {
        return res.status(403).json({ message: "Class preparation status is not available in this portal" });
      }
      const [publication, classInfo] = await Promise.all([
        getClassExamPublication(examId, classId),
        storage.getClass(classId),
      ]);
      if (!publication?.isPublished) return res.status(409).json({ message: "Publish the class reports before checking PDF preparation" });
      if (!classInfo || Number(classInfo.schoolId) !== Number(schoolId)) return res.status(404).json({ message: "Class not found" });
      return res.json(await getReportPreparationStatus({ schoolId, examId, classId }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/report-cards/:examId/pdf/prewarm", requireAuth, async (req, res, next) => {
    try {
      const examId = Number(req.params.examId);
      const classId = Number(req.body?.classId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId || !currentUser || !Number.isInteger(examId) || !Number.isInteger(classId)) {
        return res.status(400).json({ message: "School, exam and class context are required" });
      }
      if (!(await userHasAnyPermission(currentUser.id, ["academic_reports.publish.class", "academic_reports.publish.stream"]))) {
        return res.status(403).json({ message: "Permission required to prepare published report PDFs" });
      }
      const publication = await getClassExamPublication(examId, classId);
      if (!publication?.isPublished) return res.status(409).json({ message: "Publish the class reports before preparing the PDF cache" });
      const classInfo = await storage.getClass(classId);
      if (!classInfo || Number(classInfo.schoolId) !== Number(schoolId)) return res.status(404).json({ message: "Class not found" });
      const status = await queuePublishedReportPdfGeneration({ req, schoolId, examId, classId, force: req.body?.force === true });
      return res.status(202).json(status);
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
                const generatedPdf = await generateReportCardChromiumPdf({ req, schoolId, examId: Number(examId), classId: Number(classId), studentIds: [student.id] });
                const pdfBuffer = generatedPdf.buffer;
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
          const generatedPdf = await generateReportCardChromiumPdf({ req, schoolId, examId: Number(examId), classId: Number(classId), studentIds: [student.id] });
          const pdfBuffer = generatedPdf.buffer;
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

  async function getClassPublicationGradingIssues(args: {
    schoolId: number;
    examId: number;
    classId: number;
  }) {
    const rawAssessments = (await storage.getAssessmentsByExam(args.examId))
      .filter((assessment: any) => Number(assessment.classId) === Number(args.classId));
    const rawIds = rawAssessments.map((assessment: any) => Number(assessment.id));
    const allMarks = rawIds.length ? await storage.getAssessmentMarksByAssessments(rawIds) : [];
    const assessments = selectCanonicalAssessments(rawAssessments, allMarks).assessments;
    const assessmentIds = new Set(assessments.map((assessment: any) => Number(assessment.id)));
    const marks = allMarks.filter((mark: any) => assessmentIds.has(Number(mark.assessmentId)));
    const subjectIds = Array.from(new Set(assessments.map((assessment: any) => Number(assessment.subjectId))));
    const subjects = await storage.getSubjectsBySchool(args.schoolId);
    const subjectMap = new Map(subjects.map((subject: any) => [Number(subject.id), subject]));
    const strictSubjectIds = subjectIds.filter((subjectId) => {
      const subject = subjectMap.get(subjectId);
      return !!subject && !isTemporarilyExcludedFromStrictGrading(subject);
    });
    const configuration = await getClassGradingConfiguration({
      classId: args.classId,
      subjectIds: strictSubjectIds,
      autoAttach: false,
      expectedSchoolId: args.schoolId,
    });
    const issues: any[] = [];
    if (!configuration.ready) {
      issues.push({
        code: "GRADE_CONFIGURATION_INVALID",
        message: configuration.message,
        profiles: configuration.profiles,
      });
    }

    const [school, classInfo, grades] = await Promise.all([
      storage.getSchool(args.schoolId),
      storage.getClass(args.classId),
      storage.getGradesBySchool(args.schoolId),
    ]);
    const stream = classInfo?.streamId ? await storage.getStream(classInfo.streamId) : undefined;
    const assessmentMap = new Map(assessments.map((assessment: any) => [Number(assessment.id), assessment]));
    const contextMap = new Map<number, { profileKey: GradeProfileKey | null; gradingSubjectType: string | null; grades: any[] }>();
    for (const subjectId of subjectIds) {
      const subject = subjectMap.get(subjectId);
      if (!subject || !classInfo || isTemporarilyExcludedFromStrictGrading(subject)) continue;
      contextMap.set(subjectId, getClassSubjectGradeCandidates({
        allGrades: grades,
        school,
        classInfo,
        classStreamName: stream?.name || null,
        subject,
      }));
    }

    for (const mark of marks) {
      const percentage = parseFinitePercentage(mark.percentage);
      if (percentage === null) continue;
      const assessment: any = assessmentMap.get(Number(mark.assessmentId));
      const subject: any = assessment ? subjectMap.get(Number(assessment.subjectId)) : null;
      if (subject && isTemporarilyExcludedFromStrictGrading(subject)) continue;
      const context = assessment ? contextMap.get(Number(assessment.subjectId)) : null;
      const storedGrade = mark.gradeId
        ? grades.find((grade: any) => Number(grade.id) === Number(mark.gradeId))
        : null;
      if (storedGrade && !storedGradeMatchesExactContext({
        grade: storedGrade,
        expectedProfileKey: context?.profileKey || null,
        classId: args.classId,
        percentage,
        subjectType: context?.gradingSubjectType || subject?.subjectType || null,
      })) {
        issues.push({
          code: "STORED_GRADE_PROFILE_MISMATCH",
          studentId: Number(mark.studentId),
          subjectId: Number(assessment?.subjectId || mark.subjectId),
          assessmentId: Number(mark.assessmentId),
          percentage,
          expectedProfileKey: context?.profileKey || null,
          storedGradeId: Number(mark.gradeId),
          storedGradeProfileKey: storedGrade.gradeLevel || null,
        });
      }
      const resolution = resolveExactConfiguredGrade({
        percentage,
        expectedProfileKey: context?.profileKey || null,
        classId: args.classId,
        subjectType: context?.gradingSubjectType || subject?.subjectType || null,
        exactProfileGrades: context?.grades || [],
        storedGrade,
      });
      if (!resolution.grade || resolution.passStatus === "UNRESOLVED" || resolution.issues.length) {
        issues.push({
          code: "GRADE_RESULT_UNRESOLVED",
          studentId: Number(mark.studentId),
          subjectId: Number(assessment?.subjectId || mark.subjectId),
          assessmentId: Number(mark.assessmentId),
          percentage,
          expectedProfileKey: context?.profileKey || null,
          issues: resolution.issues,
        });
      }
    }

    const ranking = await calculateClassPositionMap(args.examId, args.schoolId, args.classId);
    const rankingConfigurationIssues = Array.from(ranking.unresolved.entries())
      .map(([studentId, reasons]) => ({
        studentId,
        reasons: reasons.filter((reason) =>
          !reason.startsWith("missing_result:") && reason !== "no_valid_results"
        ),
      }))
      .filter((row) => row.reasons.length > 0);
    if (rankingConfigurationIssues.length > 0) {
      issues.push({
        code: "POSITION_CONFIGURATION_UNRESOLVED",
        message: "Class position cannot be calculated using the configured points policy.",
        learners: rankingConfigurationIssues,
      });
    }

    return {
      ready: issues.length === 0,
      issues,
      configuration,
    };
  }

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
      let snapshotRefresh = { reviewedMarks: 0, updatedMarks: 0 };

      if (args.publish) {
        if (existing?.isPublished) {
          return {
            publication: existing,
            changed: false,
            action: existing.lastAction || "published",
            snapshotRefresh,
          };
        }
        snapshotRefresh = await refreshAssessmentCommentSnapshotsForPublication(tx, {
          schoolId: args.schoolId,
          examId: args.examId,
          classId: args.classId,
        });
        const overallCommentRowsSnapshot = await loadOverallCommentRowsForPublicationSnapshot(tx, {
          schoolId: args.schoolId,
          examId: args.examId,
          classId: args.classId,
        });
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
          overallCommentRowsSnapshot,
          updatedAt: now,
        };
        if (existing) {
          [publication] = await tx.update(assessmentPublications).set(values).where(eq(assessmentPublications.id, existing.id)).returning();
        } else {
          [publication] = await tx.insert(assessmentPublications).values(values).returning();
        }
      } else {
        if (!existing?.isPublished) {
          return {
            publication: existing,
            changed: false,
            action: "unpublished",
            snapshotRefresh,
          };
        }
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

      return { publication, changed: true, action, snapshotRefresh };
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
      const gradingAudit = data.publish
        ? await getClassPublicationGradingIssues({ schoolId, examId: data.examId, classId: data.classId })
        : null;
      if (data.publish && gradingAudit && !gradingAudit.ready) {
        return res.status(422).json({
          message: "Publication is blocked because one or more results cannot be resolved through the exact configured grading profile.",
          code: "GRADING_INTEGRITY_BLOCKED",
          gradingAudit,
        });
      }
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
        metadata: {
          examId: data.examId,
          classId: data.classId,
          reason: data.publish ? undefined : data.reason,
          summary: progress.totals,
          warningAcknowledged: data.publish && (progress.totals.partial + progress.totals.unrecorded > 0),
          snapshotRefresh: result.snapshotRefresh,
          gradingAudit,
        },
      });

      if (data.publish && result.publication?.isPublished) {
        void queuePublishedReportPdfGeneration({ req, schoolId, examId: data.examId, classId: data.classId }).catch((error) => {
          console.warn(`[academic-pdf] unable to queue class preparation exam=${data.examId} class=${data.classId}:`, error);
        });
      }

      res.json({
        changed: result.changed,
        action: result.action,
        isPublished: result.publication?.isPublished === true,
        status: result.publication?.isPublished ? (result.action === "republished" ? "Republished" : "Published") : "Unpublished",
        summary: progress.totals,
        warningAcknowledged: data.publish && (progress.totals.partial + progress.totals.unrecorded > 0),
        snapshotRefresh: result.snapshotRefresh,
        gradingAudit,
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
      const gradingAudits: Array<{ classId: number; className: string; audit: any }> = [];
      if (data.publish) {
        for (const classInfo of classes) {
          const current = progressContext.publicationByClass.get(Number(classInfo.id));
          if (current?.isPublished) continue;
          const audit = await getClassPublicationGradingIssues({ schoolId, examId: data.examId, classId: Number(classInfo.id) });
          if (!audit.ready) gradingAudits.push({ classId: Number(classInfo.id), className: classInfo.className, audit });
        }
        if (gradingAudits.length > 0) {
          return res.status(422).json({
            message: "Stream publication is blocked because one or more classes contain unresolved exact-profile grading results.",
            code: "GRADING_INTEGRITY_BLOCKED",
            gradingAudits,
          });
        }
      }

      const changedClasses: number[] = [];
      const summaries: any[] = [];
      const snapshotRefreshes: Array<{ classId: number; reviewedMarks: number; updatedMarks: number }> = [];
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
        if (data.publish && result.changed) {
          snapshotRefreshes.push({
            classId: Number(classInfo.id),
            reviewedMarks: Number(result.snapshotRefresh?.reviewedMarks || 0),
            updatedMarks: Number(result.snapshotRefresh?.updatedMarks || 0),
          });
        }
      }

      if (data.publish) {
        for (const classId of changedClasses) {
          void queuePublishedReportPdfGeneration({ req, schoolId, examId: data.examId, classId }).catch((error) => {
            console.warn(`[academic-pdf] unable to queue stream class preparation exam=${data.examId} class=${classId}:`, error);
          });
        }
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
        metadata: {
          examId: data.examId,
          streamId: data.streamId,
          changedClasses,
          reason: data.publish ? undefined : data.reason,
          summaries,
          warningAcknowledged: data.publish && summaries.some((summary) => (Number(summary.partial || 0) + Number(summary.unrecorded || 0)) > 0),
          snapshotRefreshes,
          gradingAudits,
        },
      });

      res.json({
        changedClassIds: changedClasses,
        classCount: classes.length,
        publishedCount: classes.filter((classInfo: any) => publishedClassIds.has(Number(classInfo.id))).length,
        allPublished,
        status: allPublished ? "Published" : "Unpublished",
        summaries,
        warningAcknowledged: data.publish && summaries.some((summary) => (Number(summary.partial || 0) + Number(summary.unrecorded || 0)) > 0),
        snapshotRefreshes,
        gradingAudits,
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
      const examId = parseIdParam(req.params.examId);
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
      const examId = parseIdParam(req.params.examId);
      const classId = parseIdParam(req.params.classId);
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
      const examId = parseIdParam(req.params.examId);
      const classId = parseIdParam(req.params.classId);
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

  // Class merit list. Primary and Secondary Forms 1-2 rank by average percentage.
  // Secondary Forms 3-6 use configured grade points/direction/distribution, then percentage.
  // ECD is intentionally not ranked. Missing expected marks count as 0 for merit calculations.
  app.get("/api/report-hub/class-merit/:examId/:classId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseIdParam(req.params.examId);
      const classId = parseIdParam(req.params.classId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const [classInfo, exam, school, allGrades, settingsRows, students, schoolSubjects] = await Promise.all([
        storage.getClass(classId),
        storage.getExam(examId),
        storage.getSchool(schoolId),
        storage.getGradesBySchool(schoolId),
        db.select().from(gradeProfileSettings).where(eq(gradeProfileSettings.schoolId, schoolId)),
        storage.getStudentsByClass(classId),
        storage.getSubjectsBySchool(schoolId),
      ]);
      if (!classInfo || classInfo.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });
      if (exam && exam.schoolId && exam.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

      const stream = classInfo.streamId ? await storage.getStream(classInfo.streamId) : undefined;
      const streamName = stream?.name || null;
      const academicRankingMode = resolveAcademicPositionRankingMode({
        schoolType: school?.schoolType,
        streamName,
      });
      const rawAssessments = (await storage.getAssessmentsByExam(examId))
        .filter((assessment: any) => Number(assessment.classId) === classId);
      const rawMarks = rawAssessments.length
        ? await storage.getAssessmentMarksByAssessments(rawAssessments.map((assessment: any) => Number(assessment.id)))
        : [];
      const assessments = selectCanonicalAssessments(rawAssessments, rawMarks).assessments;
      const canonicalAssessmentIds = new Set(assessments.map((assessment: any) => Number(assessment.id)));
      const marks = rawMarks.filter((mark: any) => canonicalAssessmentIds.has(Number(mark.assessmentId)));
      const assessedSubjectIds = Array.from(new Set(assessments.map((assessment: any) => Number(assessment.subjectId))));
      const subjectIdSet = new Set(assessedSubjectIds);
      const validSubjects = schoolSubjects.filter((subject: any) =>
        subjectIdSet.has(Number(subject.id)) && !isTemporarilyExcludedFromStrictGrading(subject)
      );
      const subjectIds = validSubjects.map((subject: any) => Number(subject.id));
      const subjectById = new Map(validSubjects.map((subject: any) => [Number(subject.id), subject]));
      const assessmentBySubject = new Map(assessments.map((assessment: any) => [Number(assessment.subjectId), assessment]));
      const marksMap = new Map(marks.map((mark: any) => [`${Number(mark.studentId)}-${Number(mark.assessmentId)}`, mark]));

      const studentIds = students.map((student: any) => Number(student.id));
      const assignmentRows = studentIds.length
        ? await db.select({ studentId: studentSubjectsSchema.studentId, subjectId: studentSubjectsSchema.subjectId })
          .from(studentSubjectsSchema)
          .where(inArray(studentSubjectsSchema.studentId, studentIds))
        : [];
      const assignedByStudent = new Map<number, Set<number>>();
      for (const row of assignmentRows) {
        const assigned = assignedByStudent.get(Number(row.studentId)) || new Set<number>();
        assigned.add(Number(row.subjectId));
        assignedByStudent.set(Number(row.studentId), assigned);
      }

      const gradeContextBySubject = new Map<number, { profileKey: GradeProfileKey | null; gradingSubjectType: string | null; grades: any[] }>();
      const profileKeys = new Set<string>();
      for (const subject of validSubjects as any[]) {
        const context = getClassSubjectGradeCandidates({
          allGrades,
          school,
          classInfo,
          classStreamName: streamName,
          subject,
        });
        gradeContextBySubject.set(Number(subject.id), context);
        if (context.profileKey) profileKeys.add(context.profileKey);
      }
      const pointsDirection = academicRankingMode === "average_grade_points"
        ? resolveSharedPointsDirection(profileKeys, settingsRows)
        : null;

      const candidateByStudent = new Map<number, RankingCandidate>();
      const displayByStudent = new Map<number, { totalPercentage: number; recordedCount: number; displays: Record<number, string> }>();
      for (const student of students as any[]) {
        const assigned = assignedByStudent.get(Number(student.id));
        const expectedSubjectIds = assigned?.size
          ? subjectIds.filter((subjectId) => assigned.has(subjectId))
          : subjectIds;
        const results: RankingSubjectResult[] = [];
        const displays: Record<number, string> = {};
        let totalPercentage = 0;
        let recordedCount = 0;
        for (const subjectId of expectedSubjectIds) {
          const assessment: any = assessmentBySubject.get(subjectId);
          const subject: any = subjectById.get(subjectId);
          const context = gradeContextBySubject.get(subjectId);
          const mark: any = assessment ? marksMap.get(`${Number(student.id)}-${Number(assessment.id)}`) : null;
          const recordedPercentage = parseFinitePercentage(mark?.percentage);
          const percentage = recordedPercentage ?? 0;
          const storedGrade = mark?.gradeId
            ? allGrades.find((grade: any) => Number(grade.id) === Number(mark.gradeId))
            : null;
          const resolution = resolveExactConfiguredGrade({
            percentage,
            expectedProfileKey: context?.profileKey || null,
            classId,
            subjectType: context?.gradingSubjectType || subject?.subjectType || null,
            exactProfileGrades: context?.grades || [],
            storedGrade,
          });
          results.push({ subjectId, percentage, grade: resolution.grade, profileKey: context?.profileKey || null });
          totalPercentage += percentage;
          if (recordedPercentage !== null) {
            recordedCount += 1;
            displays[subjectId] = formatMeritMarkDisplay(recordedPercentage, getGradeDisplayName(resolution.grade));
          }
        }
        candidateByStudent.set(Number(student.id), { id: Number(student.id), expectedSubjectIds, results });
        displayByStudent.set(Number(student.id), { totalPercentage, recordedCount, displays });
      }

      const candidates = Array.from(candidateByStudent.values());
      const ranking = academicRankingMode === "none"
        ? emptyAcademicPositionMap("none")
        : academicRankingMode
          ? calculateConfiguredPositionMap({
            candidates,
            pointsDirection,
            rankingMode: academicRankingMode,
          })
          : unresolvedAcademicPositionMap(studentIds, "position_stream_unrecognized");
      const showPointsColumn = academicRankingMode === "average_grade_points";
      const showPositionColumn = academicRankingMode !== "none";
      const rows = (students as any[]).map((student) => {
        const candidate = candidateByStudent.get(Number(student.id))!;
        const record = ranking.records.get(Number(student.id));
        const display = displayByStudent.get(Number(student.id))!;
        const expectedCount = candidate.results.length;
        const calculatedAverage = expectedCount > 0 ? display.totalPercentage / expectedCount : null;
        const averagePercentage = record?.averagePercentage ?? calculatedAverage;
        const position = ranking.map.get(Number(student.id)) || "";
        return {
          studentName: `${student.firstName} ${student.lastName}`,
          admissionNo: student.admissionNo,
          cells: Object.fromEntries(candidate.results.map((result) => [result.subjectId, result.percentage])),
          cellDisplays: display.displays,
          total: Math.round(display.totalPercentage),
          totalDisplay: expectedCount ? `${Math.round(display.totalPercentage)}/${expectedCount * 100}` : "-",
          avg: averagePercentage === null || averagePercentage === undefined ? null : Math.round(averagePercentage * 10) / 10,
          avgDisplay: averagePercentage === null || averagePercentage === undefined ? "-" : `${Math.round(averagePercentage)}%`,
          points: showPointsColumn ? record?.totalPoints ?? null : null,
          pointsDisplay: showPointsColumn && record?.totalPoints !== null && record?.totalPoints !== undefined ? formatMeritPoints(record.totalPoints) : "-",
          subjectsWithMarks: display.recordedCount,
          eligibleSubjectCount: expectedCount,
          position,
          positionStatus: !showPositionColumn ? "NOT_RANKED" : position ? "READY" : "UNRESOLVED",
          positionIssues: ranking.unresolved.get(Number(student.id)) || [],
        };
      });
      rows.sort((a, b) => {
        if (showPositionColumn) {
          const aPosition = a.position ? Number(a.position.split("/")[0]) : Number.MAX_SAFE_INTEGER;
          const bPosition = b.position ? Number(b.position.split("/")[0]) : Number.MAX_SAFE_INTEGER;
          if (aPosition !== bPosition) return aPosition - bPosition;
        } else {
          const averageDiff = Number(b.avg || 0) - Number(a.avg || 0);
          if (Math.abs(averageDiff) > 1e-9) return averageDiff;
        }
        return a.studentName.localeCompare(b.studentName);
      });

      res.json({
        examName: exam?.examName || "",
        className: classInfo.className,
        subjects: validSubjects.map((subject: any) => ({ id: subject.id, name: getReportSubjectLabel(subject) })),
        rows,
        totalStudents: students.length,
        rankedStudents: ranking.size,
        showPointsColumn,
        showPositionColumn,
        rankingMode: academicRankingMode,
        rankingPolicy: academicRankingMode === "average_grade_points"
          ? "CONFIGURED_GRADE_POINTS"
          : academicRankingMode === "average_percentage"
            ? "AVERAGE_PERCENTAGE"
            : academicRankingMode === "none"
              ? "NONE"
              : "UNRESOLVED",
        pointsDirection,
        missingMarksPolicy: "ZERO",
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

  function shouldShowMeritPointsColumn(context?: { schoolType?: string | null; streamName?: string | null; className?: string | null }) {
    return resolveAcademicPositionRankingMode({
      schoolType: context?.schoolType,
      streamName: context?.streamName || context?.className || null,
    }) === "average_grade_points";
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
      const priorityDiff = Number(a.resolutionProfilePriority ?? 0) - Number(b.resolutionProfilePriority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      const upperDiff = Number(b.upperLimit ?? -1) - Number(a.upperLimit ?? -1);
      if (upperDiff !== 0) return upperDiff;
      const lowerDiff = Number(b.lowerLimit ?? -1) - Number(a.lowerLimit ?? -1);
      if (lowerDiff !== 0) return lowerDiff;
      return getGradeDisplayName(a).localeCompare(getGradeDisplayName(b));
    });
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
    return uniqueGradesById(candidates);
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
    const resolution = resolveGradeForPercentage(pct, grades, subjectType);
    return resolution.ambiguous ? null : resolution.grade;
  }

  function resolveAnalyticsGradeForMark(mark: any, pct: number, candidateGrades: any[], subjectType?: string | null) {
    const exactPool = uniqueGradesById(candidateGrades);
    const linkedGrade = mark?.gradeId
      ? exactPool.find((grade) => Number(grade.id) === Number(mark.gradeId))
      : null;
    if (linkedGrade) {
      const lower = Number(linkedGrade.lowerLimit);
      const upper = Number(linkedGrade.upperLimit);
      const typeMatches = !linkedGrade.gradeType || isSubjectTypeCompatibleWithGradeType(subjectType, linkedGrade.gradeType);
      if (typeMatches && Number.isFinite(lower) && Number.isFinite(upper) && pct >= lower && pct <= upper) return linkedGrade;
    }
    return findGradeForPercentage(pct, exactPool, subjectType);
  }

  function getAnalyticsPassStatus(grade: any): "PASS" | "FAIL" | "UNRESOLVED" {
    return normalizeGradeStatus(grade?.gradeStatus);
  }

  // Class analytics
  app.get("/api/report-hub/class-analytics/:examId/:classId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseIdParam(req.params.examId);
      const classId = parseIdParam(req.params.classId);
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
      const rawClassAssessments = allAssessmentsRaw.filter(a => a.classId === classId);
      const rawAssessmentIds = rawClassAssessments.map(a => a.id);
      const rawClassMarks = rawAssessmentIds.length
        ? await storage.getAssessmentMarksByAssessments(rawAssessmentIds)
        : [];
      const classAssessments = selectCanonicalAssessments(rawClassAssessments, rawClassMarks).assessments;
      const canonicalAssessmentIds = new Set(classAssessments.map((assessment: any) => Number(assessment.id)));
      const classMarks = rawClassMarks.filter((mark: any) => canonicalAssessmentIds.has(Number(mark.assessmentId)));

      const subjectIds = [...new Set(classAssessments.map(a => a.subjectId))];
      const schoolSubjectRows = await storage.getSubjectsBySchool(schoolId);
      const subjectIdSet = new Set(subjectIds.map(Number));
      const validSubjects = schoolSubjectRows.filter((subject: any) =>
        subjectIdSet.has(Number(subject.id)) && !isTemporarilyExcludedFromStrictGrading(subject)
      );
      const validSubjectIdSet = new Set(validSubjects.map((subject: any) => Number(subject.id)));
      const teacherMap = await resolveClassSubjectTeacherNames(schoolId, classId, subjectIds.map((id) => Number(id)));

      const gradeCounts: Record<string, number> = {};
      const gradeColumns: string[] = [];
      const subjectStats: Record<number, {
        sum: number;
        have: number;
        expected: number;
        pass: number;
        fail: number;
        unresolved: number;
        gradeCounts: Record<string, number>;
        gradeCandidates: any[];
        subjectType?: string | null;
      }> = {};

      for (const subject of validSubjects) {
        if (!subject) continue;
        const operationalProfile = resolveOperationalGradeProfile({
          schoolType: school?.schoolType,
          examinationBoard: school?.examinationBoard,
          streamName,
          subjectType: subject.subjectType,
          subjectName: subject.name,
        });
        const applicableGrades = getApplicableGradesForContext(allGrades, {
          profileKey: operationalProfile.profileKey,
          classId,
        });
        const gradeCandidates = getAnalyticsGradeCandidates(
          applicableGrades,
          operationalProfile.effectiveSubjectType,
        );
        addAnalyticsGradeColumns(gradeColumns, gradeCandidates);

        const expected = students.filter((student: any) => studentSubjectIdsByStudent.get(student.id)?.has(subject.id)).length;
        subjectStats[subject.id] = {
          sum: 0,
          have: 0,
          expected,
          pass: 0,
          fail: 0,
          unresolved: 0,
          gradeCounts: {},
          gradeCandidates,
          subjectType: operationalProfile.effectiveSubjectType,
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

        const grade = resolveAnalyticsGradeForMark(mark, pct, stats.gradeCandidates, stats.subjectType);
        const gradeLabel = getGradeDisplayName(grade);
        if (gradeLabel) {
          gradeCounts[gradeLabel] = (gradeCounts[gradeLabel] || 0) + 1;
          stats.gradeCounts[gradeLabel] = (stats.gradeCounts[gradeLabel] || 0) + 1;
        }

        const passStatus = getAnalyticsPassStatus(grade);
        if (passStatus === "PASS") stats.pass++;
        else if (passStatus === "FAIL") stats.fail++;
        else stats.unresolved++;
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
          unresolved: stats.unresolved,
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
        passMark: null,
        passRule: "GRADE_STATUS",
      });
    } catch (error) {
      next(error);
    }
  });

  // Stream merit list
  app.get("/api/report-hub/stream-merit/:examId/:streamId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseIdParam(req.params.examId);
      const streamId = parseIdParam(req.params.streamId);
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
      const streamRankingMode = resolveAcademicPositionRankingMode({ schoolType: school?.schoolType, streamName });
      const showPointsColumn = shouldShowMeritPointsColumn({ schoolType: school?.schoolType, streamName });
      const showPositionColumn = streamRankingMode !== "none";
      const classIds = streamClasses.map(c => c.id);
      if (classIds.length === 0) return res.json({
        examName: exam?.examName || "",
        streamName,
        subjects: [],
        rows: [],
        totalStudents: 0,
        rankedStudents: 0,
        showPointsColumn,
        showPositionColumn,
        rankingMode: streamRankingMode,
        rankingPolicy: streamRankingMode === "average_grade_points" ? "CONFIGURED_GRADE_POINTS" : streamRankingMode === "average_percentage" ? "AVERAGE_PERCENTAGE" : streamRankingMode === "none" ? "NONE" : "UNRESOLVED",
        missingMarksPolicy: "ZERO",
      });

      const allGrades = await storage.getGradesBySchool(schoolId);

      let allStudents: any[] = [];
      for (const cls of streamClasses) {
        const classStudents = await storage.getStudentsByClass(cls.id);
        allStudents = allStudents.concat(classStudents);
      }
      if (allStudents.length === 0) return res.json({
        examName: exam?.examName || "",
        streamName,
        subjects: [],
        rows: [],
        totalStudents: 0,
        rankedStudents: 0,
        showPointsColumn,
        showPositionColumn,
        rankingMode: streamRankingMode,
        rankingPolicy: streamRankingMode === "average_grade_points" ? "CONFIGURED_GRADE_POINTS" : streamRankingMode === "average_percentage" ? "AVERAGE_PERCENTAGE" : streamRankingMode === "none" ? "NONE" : "UNRESOLVED",
        missingMarksPolicy: "ZERO",
      });

      const studentSubjectIdsByStudent = new Map<number, Set<number>>();
      await Promise.all(allStudents.map(async (student: any) => {
        const rows = await storage.getStudentSubjects(student.id);
        studentSubjectIdsByStudent.set(
          student.id,
          new Set(rows.map((row: any) => row.subjectId).filter((id: any) => id !== null && id !== undefined)),
        );
      }));

      const allAssessmentsRaw = await storage.getAssessmentsByExam(examId);
      const rawStreamAssessments = allAssessmentsRaw.filter(a => classIds.includes(a.classId));
      const rawAssessmentIds = rawStreamAssessments.map(a => a.id);
      const rawMarks = rawAssessmentIds.length
        ? await storage.getAssessmentMarksByAssessments(rawAssessmentIds)
        : [];
      const streamAssessments = selectCanonicalAssessments(rawStreamAssessments, rawMarks).assessments;
      const canonicalAssessmentIds = new Set(streamAssessments.map((assessment: any) => Number(assessment.id)));
      const allMarks = rawMarks.filter((mark: any) => canonicalAssessmentIds.has(Number(mark.assessmentId)));

      const subjectIds = Array.from(new Set(streamAssessments.map((assessment: any) => Number(assessment.subjectId))));
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const subjectById = new Map<number, any>();
      for (const subject of subjectsData) {
        if (subject && !isTemporarilyExcludedFromStrictGrading(subject)) subjectById.set(Number(subject.id), subject);
      }
      const validSubjectIds = subjectIds.filter((id) => subjectById.has(Number(id)));
      const validSubjectIdsByClass = new Map<number, number[]>();
      for (const classInfo of streamClasses) {
        validSubjectIdsByClass.set(
          Number(classInfo.id),
          Array.from(new Set(
            streamAssessments
              .filter((assessment: any) => Number(assessment.classId) === Number(classInfo.id))
              .map((assessment: any) => Number(assessment.subjectId))
              .filter((subjectId: number) => subjectById.has(subjectId)),
          )),
        );
      }

      const gradeCandidatesBySubjectClass = new Map<string, any[]>();
      const gradingSubjectTypeBySubjectClass = new Map<string, string | null>();
      const getSubjectClassGradeCandidates = (subject: any, classId: number) => {
        const key = `${subject.id}-${classId}`;
        const existing = gradeCandidatesBySubjectClass.get(key);
        if (existing) return existing;
        const operationalProfile = resolveOperationalGradeProfile({
          schoolType: school?.schoolType,
          examinationBoard: school?.examinationBoard,
          streamName,
          subjectType: subject.subjectType,
          subjectName: subject.name,
        });
        const applicableGrades = getApplicableGradesForContext(allGrades, {
          profileKey: operationalProfile.profileKey,
          classId,
        });
        const candidates = getAnalyticsGradeCandidates(
          applicableGrades,
          operationalProfile.effectiveSubjectType,
        );
        gradeCandidatesBySubjectClass.set(key, candidates);
        gradingSubjectTypeBySubjectClass.set(key, operationalProfile.effectiveSubjectType);
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
        const assignedSubjectIds = studentSubjectIdsByStudent.get(student.id) || new Set<number>();
        const classExpectedSubjectIds = validSubjectIdsByClass.get(Number(student.classId)) || [];
        const eligibleCount = assignedSubjectIds.size > 0
          ? classExpectedSubjectIds.filter((subjectId) => assignedSubjectIds.has(Number(subjectId))).length
          : classExpectedSubjectIds.length;
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
        const gradingSubjectType = gradingSubjectTypeBySubjectClass.get(`${subject.id}-${mark.classId}`) || subject.subjectType;
        const grade = resolveAnalyticsGradeForMark(mark, pct, gradeCandidates, gradingSubjectType);
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

      const streamRanking = await calculateStreamPositionMap(examId, schoolId, streamId, { missingMarksAsZero: true });
      const ranked = allStudents.map((student) => {
        const data = perStudent[student.id];
        const record = streamRanking.records.get(Number(student.id));
        const position = streamRanking.map.get(Number(student.id)) || "";
        return { student, data, record, position };
      });
      ranked.sort((a, b) => {
        if (showPositionColumn) {
          const aPosition = a.position ? Number(a.position.split("/")[0]) : Number.MAX_SAFE_INTEGER;
          const bPosition = b.position ? Number(b.position.split("/")[0]) : Number.MAX_SAFE_INTEGER;
          if (aPosition !== bPosition) return aPosition - bPosition;
        } else {
          const aAverage = a.record?.averagePercentage ?? (a.data?.eligibleCount ? a.data.sum / a.data.eligibleCount : 0);
          const bAverage = b.record?.averagePercentage ?? (b.data?.eligibleCount ? b.data.sum / b.data.eligibleCount : 0);
          if (Math.abs(bAverage - aAverage) > 1e-9) return bAverage - aAverage;
        }
        const aName = `${a.student.firstName} ${a.student.lastName}`;
        const bName = `${b.student.firstName} ${b.student.lastName}`;
        return aName.localeCompare(bName);
      });

      const rows = ranked.map(({ student, data, record, position }) => ({
        studentName: `${student.firstName} ${student.lastName}`,
        admissionNo: student.admissionNo,
        total: data?.eligibleCount ? `${Math.round(data.sum)}/${data.eligibleCount * 100}` : "-",
        avg: (() => {
          const average = record?.averagePercentage ?? (data?.eligibleCount ? data.sum / data.eligibleCount : null);
          return average === null || average === undefined ? "-" : `${Math.round(average)}%`;
        })(),
        points: showPointsColumn && record?.totalPoints !== null && record?.totalPoints !== undefined ? formatMeritPoints(record.totalPoints) : "-",
        position,
        positionStatus: !showPositionColumn ? "NOT_RANKED" : position ? "READY" : "UNRESOLVED",
        positionIssues: streamRanking.unresolved.get(Number(student.id)) || [],
        subjectMarks: validSubjectIds.map((subjectId) => data?.displays[subjectId] || "-"),
      }));

      res.json({
        examName: exam?.examName || "",
        streamName,
        subjects: validSubjectIds.map((subjectId) => getReportSubjectLabel(subjectById.get(Number(subjectId)))).filter(Boolean),
        rows,
        totalStudents: allStudents.length,
        rankedStudents: streamRanking.size,
        showPointsColumn,
        showPositionColumn,
        rankingMode: streamRankingMode,
        rankingPolicy: streamRankingMode === "average_grade_points"
          ? "CONFIGURED_GRADE_POINTS"
          : streamRankingMode === "average_percentage"
            ? "AVERAGE_PERCENTAGE"
            : streamRankingMode === "none"
              ? "NONE"
              : "UNRESOLVED",
        missingMarksPolicy: "ZERO",
        pointsDirection: streamRankingMode === "average_grade_points" ? resolveSharedPointsDirection(
          Array.from(new Set(Array.from(gradeCandidatesBySubjectClass.values()).flat().map((grade: any) => String(grade.gradeLevel || "")).filter(Boolean))),
          await db.select().from(gradeProfileSettings).where(eq(gradeProfileSettings.schoolId, schoolId)),
        ) : null,
      });
    } catch (error) {
      next(error);
    }
  });

  // Stream analytics
  app.get("/api/report-hub/stream-analytics/:examId/:streamId", requireAuth, async (req, res, next) => {
    try {
      const examId = parseIdParam(req.params.examId);
      const streamId = parseIdParam(req.params.streamId);
      const currentUser = await storage.getUser((req.user as any).id);
      const schoolId = getSchoolContext(req) || currentUser?.schoolId;
      if (!schoolId) return res.status(400).json({ message: "School context required" });

      const [school, exam, stream] = await Promise.all([
        storage.getSchool(schoolId),
        storage.getExam(examId),
        storage.getStream(streamId),
      ]);
      if (exam && exam.schoolId && exam.schoolId !== schoolId) return res.status(403).json({ message: "Access denied" });

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
      const rawStreamAssessments = allAssessmentsRaw.filter(a => classIds.includes(a.classId));
      const rawAssessmentIds = rawStreamAssessments.map(a => a.id);
      const rawMarks = rawAssessmentIds.length
        ? await storage.getAssessmentMarksByAssessments(rawAssessmentIds)
        : [];
      const streamAssessments = selectCanonicalAssessments(rawStreamAssessments, rawMarks).assessments;
      const canonicalAssessmentIds = new Set(streamAssessments.map((assessment: any) => Number(assessment.id)));
      const allMarks = rawMarks.filter((mark: any) => canonicalAssessmentIds.has(Number(mark.assessmentId)));

      const subjectIds = [...new Set(streamAssessments.map((assessment: any) => Number(assessment.subjectId)))];
      const subjectsData = await Promise.all(subjectIds.map(id => storage.getSubject(id)));
      const subjectById = new Map<number, any>();
      for (const subject of subjectsData) {
        if (subject && !isTemporarilyExcludedFromStrictGrading(subject)) subjectById.set(Number(subject.id), subject);
      }
      const teacherMap = await resolveStreamSubjectTeacherNames(schoolId, classIds, subjectIds.map((id) => Number(id)));

      const gradeColumns: string[] = [];
      const gradeCandidatesBySubjectClass = new Map<string, any[]>();
      const gradingSubjectTypeBySubjectClass = new Map<string, string | null>();
      const getSubjectClassGradeCandidates = (subject: any, classId: number) => {
        const key = `${subject.id}-${classId}`;
        const existing = gradeCandidatesBySubjectClass.get(key);
        if (existing) return existing;
        const operationalProfile = resolveOperationalGradeProfile({
          schoolType: school?.schoolType,
          examinationBoard: school?.examinationBoard,
          streamName,
          subjectType: subject.subjectType,
          subjectName: subject.name,
        });
        const applicableGrades = getApplicableGradesForContext(allGrades, {
          profileKey: operationalProfile.profileKey,
          classId,
        });
        const candidates = getAnalyticsGradeCandidates(
          applicableGrades,
          operationalProfile.effectiveSubjectType,
        );
        gradeCandidatesBySubjectClass.set(key, candidates);
        gradingSubjectTypeBySubjectClass.set(key, operationalProfile.effectiveSubjectType);
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
        unresolved: number;
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
        const gradingSubjectType = gradingSubjectTypeBySubjectClass.get(`${subject.id}-${mark.classId}`) || subject.subjectType;

        if (!bySubject[subId]) {
          bySubject[subId] = { sum: 0, cnt: 0, pass: 0, fail: 0, unresolved: 0, gradeCounts: {}, subjectType: gradingSubjectType };
        }

        bySubject[subId].sum += pct;
        bySubject[subId].cnt++;

        const grade = resolveAnalyticsGradeForMark(mark, pct, gradeCandidates, gradingSubjectType);
        const gradeLabel = getGradeDisplayName(grade);
        if (gradeLabel) {
          bySubject[subId].gradeCounts[gradeLabel] = (bySubject[subId].gradeCounts[gradeLabel] || 0) + 1;
        }

        const passStatus = getAnalyticsPassStatus(grade);
        if (passStatus === "PASS") bySubject[subId].pass++;
        else if (passStatus === "FAIL") bySubject[subId].fail++;
        else bySubject[subId].unresolved++;
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
          unresolved: stats.unresolved,
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
        passMark: null,
        passRule: "GRADE_STATUS",
      });
    } catch (error) {
      next(error);
    }
  });

  // Classes for a stream (for the Reports dropdown)
  app.get("/api/report-hub/stream-classes/:streamId", requireAuth, async (req, res, next) => {
    try {
      const streamId = parseIdParam(req.params.streamId);
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

      const classId = parseIdParam(req.params.classId);
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

      const classId = parseIdParam(req.params.classId);
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

      const studentId = parseIdParam(req.params.studentId);
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
        const latestMark = subjMarks.at(-1);
        const comment = latestMark?.customCommentText || latestMark?.autoCommentSnapshot || "";

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

      const reportId = parseIdParam(req.params.reportId);
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

      const studentId = parseIdParam(req.params.studentId);
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
      res.json({ ...student, className: classInfo?.className, parentName: parentInfo ? `${parentInfo.firstName} ${parentInfo.lastName}` : null });
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

    const [markRows, classInfo, school, allGrades, assessmentCommentRows] = await Promise.all([
      db.select().from(assessmentMarksSchema).where(eq(assessmentMarksSchema.studentId, student.id)),
      storage.getClass(Number(student.classId)),
      storage.getSchool(Number(student.schoolId)),
      storage.getGradesBySchool(Number(student.schoolId)),
      storage.getAssessmentComments(Number(student.schoolId), Number(student.classId)),
    ]);
    if (!classInfo) return [];
    const classStream = classInfo.streamId ? await storage.getStream(classInfo.streamId) : undefined;
    const assessmentCommentPool = buildAssessmentCommentPoolMap(assessmentCommentRows);

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
      const gradeContext = subject
        ? getClassSubjectGradeCandidates({
            allGrades,
            school,
            classInfo,
            classStreamName: classStream?.name || null,
            subject,
          })
        : { profileKey: null, gradingSubjectType: null, substitutionPolicy: null, grades: [] as any[], excluded: false };
      const linkedGrade = mark.gradeId
        ? allGrades.find((candidate: any) => Number(candidate.id) === Number(mark.gradeId))
        : null;
      const grade = subject
        ? gradeContext.excluded
          ? linkedGrade
          : resolveStoredAssessmentGrade({
              mark,
              percentage,
              applicableGrades: gradeContext.grades,
              allGrades,
              expectedProfileKey: gradeContext.profileKey,
              classId: Number(classInfo.id),
              subjectType: gradeContext.gradingSubjectType || subject.subjectType,
            })
        : null;
      const statusComment = markStatusLabel(mark.attStatus);
      if (percentage === null && !statusComment) continue;
      const poolComment = mark.gradeId
        ? assessmentCommentPool.get(
            assessmentCommentPoolKey(Number(student.classId), Number(assessment.subjectId), Number(mark.gradeId)),
          )
        : null;
      const comment = resolveEffectiveAssessmentComment({
        mark,
        statusComment,
        currentPoolComment: poolComment?.commentText,
        isPublished: true,
      });
      results.push({
        id: mark.id,
        percentage: mark.percentage,
        grade: statusComment ? null : grade?.gradeName || null,
        comment: comment || null,
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

  // Read-only newsletter feed for the exact audience captured at publication.
  app.get("/api/me/newsletters", requireAuth, async (req, res, next) => {
    try {
      const currentUser = req.user as User;
      const schoolId = getSchoolContext(req) || currentUser.schoolId;
      if (!schoolId) return res.json([]);
      const newsletters = await storage.getNewsletters(schoolId);
      const roleAudience = currentUser.role === "student"
        ? "students"
        : currentUser.role === "parent"
          ? "parents"
          : "staff";
      const published = newsletters.filter((newsletter: any) => {
        if (newsletter.isPublished !== true) return false;
        const recipientSnapshot = uniquePositiveIds(newsletter.publishedRecipientUserIds || []);
        if (recipientSnapshot.length > 0) return recipientSnapshot.includes(currentUser.id);
        const legacyAudience = String(newsletter.targetAudience || "all");
        return legacyAudience === "all" || legacyAudience === roleAudience;
      });
      res.json(published);
    } catch (error) { next(error); }
  });

  // ============= 360 Student Profile =============

  app.get("/api/student-profile/:studentId", requireAuth, async (req, res, next) => {
    try {
      const studentId = parseIdParam(req.params.studentId);
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
          const classAssessmentsRaw = examAssessments.filter(a => a.classId === student.classId);
          if (classAssessmentsRaw.length > 0) {
            const assessmentIds = classAssessmentsRaw.map(a => a.id);
            const allMarksRaw = await storage.getAssessmentMarksByAssessments(assessmentIds);
            const classAssessments = selectCanonicalAssessments(classAssessmentsRaw, allMarksRaw).assessments;
            const canonicalAssessmentIds = new Set(classAssessments.map((assessment: any) => Number(assessment.id)));
            const allMarks = allMarksRaw.filter((mark: any) => canonicalAssessmentIds.has(Number(mark.assessmentId)));
            const grades = await storage.getGradesBySchool(schoolId);
            const classStreamForGrades = classInfo?.streamId ? streamMap.get(classInfo.streamId) : null;

            const studentMarks = allMarks.filter(m => m.studentId === studentId);

            let totalPct = 0;
            let subjectCount = 0;
            let subjectsPassed = 0;
            let subjectsFailed = 0;
            let subjectsUnresolved = 0;
            let totalPoints = 0;

            resultsData = classAssessments.map(assessment => {
              const mark = studentMarks.find(m => m.assessmentId === assessment.id);
              const subject = subjectMap.get(assessment.subjectId);
              if (!mark || !subject) return null;

              const pct = parseFinitePercentage(mark.percentage);
              const gradeContext = classInfo
                ? getClassSubjectGradeCandidates({
                    allGrades: grades,
                    school,
                    classInfo,
                    classStreamName: classStreamForGrades?.name || null,
                    subject,
                  })
                : { profileKey: null, gradingSubjectType: null, substitutionPolicy: null, grades: [] as any[], excluded: false };
              const linkedGrade = mark.gradeId
                ? grades.find((candidate: any) => Number(candidate.id) === Number(mark.gradeId))
                : null;
              const grade = gradeContext.excluded
                ? linkedGrade
                : resolveStoredAssessmentGrade({
                    mark,
                    percentage: pct,
                    applicableGrades: gradeContext.grades,
                    allGrades: grades,
                    expectedProfileKey: gradeContext.profileKey,
                    classId: Number(classInfo?.id || 0),
                    subjectType: gradeContext.gradingSubjectType || subject.subjectType,
                  });
              const gradeName = grade?.gradeName || "";
              const gradePoints = gradeContext.excluded ? 0 : parseGradePoints(grade?.gradePoints) ?? 0;
              const passStatus = gradeContext.excluded ? "UNRESOLVED" : normalizeGradeStatus(grade?.gradeStatus);

              if (pct !== null && !gradeContext.excluded) {
                totalPct += pct;
                subjectCount++;
                totalPoints += gradePoints;
                if (passStatus === "PASS") subjectsPassed++;
                else if (passStatus === "FAIL") subjectsFailed++;
                else subjectsUnresolved++;
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

            const classPositions = await calculateClassPositionMap(examId, schoolId, Number(student.classId));
            const streamPositions = await calculateStreamPositionMap(examId, schoolId, classInfo?.streamId || null);
            const classPositionText = classPositions.map.get(studentId) || "";
            const streamPositionText = streamPositions.map.get(studentId) || "";
            const [classPositionValue, classPositionTotal] = classPositionText.split("/").map(Number);
            const [streamPositionValue, streamPositionTotal] = streamPositionText.split("/").map(Number);

            const totalMarks = subjectCount * 100;
            summaryStats = {
              totalMarks: `${Math.round(totalPct)}/${totalMarks}`,
              averageMark: subjectCount > 0 ? Math.round(totalPct / subjectCount) : 0,
              subjectsPassed: `${subjectsPassed}/${subjectCount}`,
              subjectsFailed,
              subjectsUnresolved,
              points: subjectsUnresolved === 0 ? totalPoints : null,
              classPosition: Number.isFinite(classPositionValue) && classPositionValue > 0 ? classPositionValue : null,
              totalInClass: Number.isFinite(classPositionTotal) && classPositionTotal > 0 ? classPositionTotal : null,
              streamPosition: Number.isFinite(streamPositionValue) && streamPositionValue > 0 ? streamPositionValue : null,
              totalInStream: Number.isFinite(streamPositionTotal) && streamPositionTotal > 0 ? streamPositionTotal : null,
              positionStatus: classPositions.unresolved.has(studentId) ? "UNRESOLVED" : "READY",
              positionIssues: classPositions.unresolved.get(studentId) || [],
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
        fees: attendance.filter(a => a.status === "fees").length,
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
      const staffId = parseIdParam(req.params.staffId);
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
