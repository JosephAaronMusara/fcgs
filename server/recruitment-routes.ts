import type { Express, Request, Response } from "express";
import multer from "multer";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requireAuth, requireAnyPermission, requirePermission } from "./auth";
import { deletePrivateFile, savePrivateBuffer, streamPrivateFile } from "./private-files";
import { communicationService } from "./communication";
import { evaluateHighSchoolEligibility, evaluatePrimarySchoolEligibility, evaluateRecruitmentRequirement, publicHighSchoolEligibilityPolicy, publicPrimarySchoolEligibilityPolicy } from "./recruitment-screening";
import {
  RECRUITMENT_CATEGORY_LABELS,
  RECRUITMENT_CATEGORIES,
  RECRUITMENT_DEPARTMENTS,
  HIGH_SCHOOL_RECRUITMENT_DEPARTMENTS,
  O_LEVEL_GRADES,
  examBoardMatches,
  formatExamBoards,
  normalizeExamBoard,
  normalizeExamBoardList,
  normalizeSubjectList,
  subjectsOverlap,
  coreRecruitmentDocumentRequirements,
  isSupportedRecruitmentDepartment,
  normalizeRecruitmentDepartment,
  isSupportedRecruitmentCategory,
  isHighSchoolCoreRequirementDefinition,
  isPrimarySchoolCoreRequirementDefinition,
  recruitmentCategoryCode,
} from "@shared/recruitment";
import {
  organizations,
  recruitmentApplicationAnswers,
  recruitmentApplicationDocuments,
  recruitmentApplications,
  recruitmentApplicationStatusHistory,
  recruitmentActivity,
  recruitmentDepartments,
  recruitmentExaminationBoards,
  recruitmentDocumentCategories,
  recruitmentInterviews,
  recruitmentNotificationConfigs,
  recruitmentNotificationLogs,
  recruitmentNotes,
  recruitmentRejectionAttempts,
  recruitmentRequirements,
  recruitmentSettings,
  recruitmentVacancies,
  recruitmentVacancyCandidates,
  recruitmentTalentRankingLists,
  recruitmentTalentRankings,
  schools,
  staff,
  subjects,
  users,
  permissions,
  accessGroupPermissions,
  userAccessGroups,
} from "@shared/schema";

type AuthedUser = {
  id: number;
  role?: string;
  schoolId?: number | null;
  organizationId?: number | null;
};

const userOf = (req: Request) => req.user as AuthedUser | undefined;

function requireRecruitmentHq(req: Request, res: Response, next: (error?: unknown) => void) {
  const user = userOf(req);
  if (!user) return res.status(401).json({ message: "Authentication required" });
  if (user.role !== "org_admin" && user.schoolId) {
    return res.status(403).json({ message: "Recruitment is managed from HQ." });
  }
  next();
}
const optionalText = z.string().trim().optional().nullable();
const nullablePositiveInt = z.coerce.number().int().positive().optional().nullable();
const isoDateTime = z.string().datetime({ offset: true }).or(z.string().datetime()).optional().nullable();

const vacancyInput = z.object({
  schoolId: nullablePositiveInt,
  code: z.string().trim().min(2).max(30).transform((value) => value.toUpperCase()),
  title: z.string().trim().min(2),
  employmentCategory: z.enum(RECRUITMENT_CATEGORY_LABELS),
  department: optionalText,
  examinationBoard: z.string().trim().min(1).max(100).optional().nullable(),
  subjects: z.array(z.string().trim().min(1).max(120)).max(20).optional().default([]),
  minimumYearsExperience: z.coerce.number().min(0).max(80).optional().nullable(),
  teachingQualificationRequired: z.boolean().optional().default(false),
  description: z.string().trim().min(1),
  locationText: optionalText,
  positionsAvailable: z.coerce.number().int().min(1).default(1),
  status: z.enum(["draft", "published", "closed", "archived"]).default("draft"),
  opensAt: isoDateTime,
  closesAt: isoDateTime,
});

const requirementInput = z.object({
  vacancyId: nullablePositiveInt,
  employmentCategory: z.enum(RECRUITMENT_CATEGORY_LABELS).optional().nullable(),
  code: z.string().trim().min(1).transform((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_")),
  label: z.string().trim().min(1),
  helpText: optionalText,
  inputType: z.enum(["boolean", "text", "number", "select"]).default("boolean"),
  acceptedValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional().default([]),
  minimumNumber: z.coerce.number().finite().optional().nullable(),
  maximumNumber: z.coerce.number().finite().optional().nullable(),
  isMandatory: z.boolean().default(false),
  autoRejectOnFail: z.boolean().default(false),
  alternativePassKeywords: z.array(z.string().trim().min(1)).optional().default([]),
  alternativePassNote: optionalText,
  displayOrder: z.coerce.number().int().min(0).default(100),
  isActive: z.boolean().default(true),
});

const documentCategoryInput = z.object({
  vacancyId: nullablePositiveInt,
  employmentCategory: z.enum(RECRUITMENT_CATEGORY_LABELS).optional().nullable(),
  code: z.string().trim().min(1).transform((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_")),
  label: z.string().trim().min(1),
  isRequired: z.boolean().default(false),
  allowsMultiple: z.boolean().default(false),
  displayOrder: z.coerce.number().int().min(0).default(100),
  isActive: z.boolean().default(true),
});

const departmentInput = z.object({
  name: z.string().trim().min(1).max(100),
  applicationCategory: z.enum(RECRUITMENT_CATEGORY_LABELS),
  isActive: z.boolean().default(true),
  displayOrder: z.coerce.number().int().min(0).default(100),
  responsibleUserId: nullablePositiveInt,
  applicantContactPhone: optionalText,
  applicantContactEmail: optionalText,
});

const examinationBoardInput = z.object({
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean().default(true),
  displayOrder: z.coerce.number().int().min(0).default(100),
});

const notificationConfigInput = z.object({
  eventKey: z.string().trim().min(1).max(100),
  applicationVariant: z.enum(["any", "general", "vacancy"]).default("any"),
  enabled: z.boolean().default(false),
  channel: z.enum(["none", "email", "sms", "both"]).default("none"),
  emailSubject: optionalText,
  emailTemplate: optionalText,
  smsTemplate: optionalText,
});

const publicApplicationInput = z.object({
  organizationId: z.coerce.number().int().positive(),
  vacancyId: nullablePositiveInt,
  applicationType: z.enum(["vacancy", "general"]),
  employmentCategory: z.enum(RECRUITMENT_CATEGORY_LABELS),
  department: optionalText,
  examinationBoard: z.string().trim().min(1).max(100).optional().nullable(), // legacy client compatibility
  examinationBoards: z.array(z.string().trim().min(1).max(100)).max(10).optional().default([]),
  declaredSubjects: z.array(z.string().trim().min(1).max(120)).max(20).optional().default([]),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().min(5),
  nationalId: z.string().trim().min(3),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  gender: optionalText,
  address: optionalText,
  preferredSchoolIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  qualifications: optionalText,
  yearsExperience: z.coerce.number().min(0).default(0),
  currentEmployer: optionalText,
  coverLetter: optionalText,
  holdsTeachingQualification: z.boolean().optional().default(false),
  aLevelResults: z.array(z.object({ subject: z.string().trim().min(1).max(120), grade: z.string().trim().min(1).max(2) })).max(20).optional().default([]),
  oLevelResults: z.array(z.object({
    subject: z.string().trim().min(1).max(120),
    grade: z.string().trim().min(1).max(3),
    sitting: z.coerce.number().int().min(1).max(10),
  })).max(30).optional().default([]),
  answers: z.record(z.string(), z.unknown()).optional().default({}),
  documentCategories: z.array(z.string()).optional().default([]),
});

const settingsInput = z.object({
  publicApplicationsOpen: z.boolean(),
  generalApplicationsOpen: z.boolean(),
  attachmentSizeLimitMB: z.coerce.number().int().min(1).max(50),
  careersPageTitle: z.string().trim().min(1),
  careersPageMessage: z.string().trim().min(1),
  generalApplicationCategories: z.array(z.string().trim().min(1).max(100)).optional().default(RECRUITMENT_CATEGORIES.map((category) => category.label)),
  highSchoolMaxAge: z.coerce.number().int().min(18).max(80),
  highSchoolMinimumALevelPoints: z.coerce.number().int().min(0).max(30),
  highSchoolTeachingQualifiedMinimumALevelPoints: z.coerce.number().int().min(0).max(30),
  highSchoolTeachingQualificationExceptionEnabled: z.boolean(),
  primaryTeachingQualificationRequired: z.boolean(),
  primaryMaximumOLevelSittings: z.coerce.number().int().min(1).max(10),
  primaryMinimumOLevelSubjects: z.coerce.number().int().min(1).max(20),
  primaryMinimumOLevelGrade: z.string().trim().transform((value) => value.toUpperCase()),
  primaryMandatoryOLevelSubjects: z.array(z.string().trim().min(1).max(120)).min(1).max(20).transform((values) => normalizeSubjectList(values)),
  primaryMandatoryOLevelGrade: z.string().trim().transform((value) => value.toUpperCase()),
}).superRefine((value, ctx) => {
  if (value.highSchoolTeachingQualifiedMinimumALevelPoints > value.highSchoolMinimumALevelPoints) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["highSchoolTeachingQualifiedMinimumALevelPoints"], message: "The teaching-qualified minimum cannot exceed the standard A-Level minimum." });
  }
  if (!O_LEVEL_GRADES.includes(value.primaryMinimumOLevelGrade as (typeof O_LEVEL_GRADES)[number])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["primaryMinimumOLevelGrade"], message: "Select a valid O-Level minimum grade." });
  }
  if (!O_LEVEL_GRADES.includes(value.primaryMandatoryOLevelGrade as (typeof O_LEVEL_GRADES)[number])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["primaryMandatoryOLevelGrade"], message: "Select a valid mandatory-subject O-Level grade." });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 20, fileSize: 50 * 1024 * 1024 },
});

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string): string {
  let normalized = value.replace(/[^0-9+]/g, "");
  if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`;
  if (normalized.startsWith("0") && !normalized.startsWith("00")) normalized = `+263${normalized.slice(1)}`;
  return normalized;
}

function normalizeNationalId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function scopeKey(vacancyId: number | null | undefined, employmentCategory: string | null | undefined): string {
  if (vacancyId) return `vacancy:${vacancyId}`;
  return `general:${String(employmentCategory || "all").trim().toLowerCase()}`;
}

async function organizationForUser(req: Request): Promise<number> {
  const user = userOf(req);
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (user.organizationId) return user.organizationId;
  if (user.schoolId) {
    const [school] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, user.schoolId)).limit(1);
    if (school?.organizationId) return school.organizationId;
  }
  throw Object.assign(new Error("No organization context is available for this user"), { status: 403 });
}


function canAccessApplication(user: AuthedUser, _application: Pick<typeof recruitmentApplications.$inferSelect, "schoolId" | "preferredSchoolIds">): boolean {
  return user.role === "org_admin" || !user.schoolId;
}

async function userHasRecruitmentPermission(userId: number, code: string): Promise<boolean> {
  const [row] = await db.select({ id: permissions.id })
    .from(userAccessGroups)
    .innerJoin(accessGroupPermissions, eq(accessGroupPermissions.accessGroupId, userAccessGroups.accessGroupId))
    .innerJoin(permissions, eq(permissions.id, accessGroupPermissions.permissionId))
    .where(and(eq(userAccessGroups.userId, userId), eq(permissions.code, code)))
    .limit(1);
  return Boolean(row);
}

async function validateVacancyScope(organizationId: number, vacancyId: number | null | undefined) {
  if (!vacancyId) return null;
  const [vacancy] = await db.select().from(recruitmentVacancies).where(and(
    eq(recruitmentVacancies.id, vacancyId),
    eq(recruitmentVacancies.organizationId, organizationId),
  )).limit(1);
  if (!vacancy) throw Object.assign(new Error("The selected vacancy is outside your organization."), { status: 400 });
  return vacancy;
}

async function normalizeVacancyForWrite(organizationId: number, input: z.infer<typeof vacancyInput>) {
  const category = recruitmentCategoryCode(input.employmentCategory);
  if (!category) throw Object.assign(new Error("Select a valid application category."), { status: 400 });
  let department: string | null = null;
  let examinationBoard: string | null = null;
  let subjects: string[] = [];
  if (category === "high_school_teaching") {
    department = normalizeRecruitmentDepartment(input.department);
    if (!department) throw Object.assign(new Error("Select a High School department."), { status: 400 });
    const configuredRows = await db.select({ id: recruitmentDepartments.id, name: recruitmentDepartments.name }).from(recruitmentDepartments).where(and(
      eq(recruitmentDepartments.organizationId, organizationId),
      eq(recruitmentDepartments.applicationCategory, "High School Teaching"),
      eq(recruitmentDepartments.isActive, true),
    ));
    const configured = configuredRows.find((row) => normalizeRecruitmentDepartment(row.name) === department);
    if (!configured) throw Object.assign(new Error("Select an active High School recruitment department."), { status: 400 });
    examinationBoard = await resolveConfiguredExaminationBoard(organizationId, input.examinationBoard);
    if (!examinationBoard) throw Object.assign(new Error("Select an active examination board for this teaching vacancy."), { status: 400 });
    subjects = normalizeSubjectList(input.subjects);
    if (!subjects.length) throw Object.assign(new Error("Add at least one teaching subject to this vacancy."), { status: 400 });
  } else if (category === "primary_teaching") {
    department = "Primary School";
    examinationBoard = await resolveConfiguredExaminationBoard(organizationId, input.examinationBoard);
    if (!examinationBoard) throw Object.assign(new Error("Select an active examination board for this teaching vacancy."), { status: 400 });
    subjects = normalizeSubjectList(input.subjects);
  }
  return {
    ...input,
    department,
    examinationBoard,
    subjects,
    minimumYearsExperience: input.minimumYearsExperience == null ? null : String(input.minimumYearsExperience),
    teachingQualificationRequired: category === "non_teaching" ? false : Boolean(input.teachingQualificationRequired),
  };
}

async function ensureSettings(organizationId: number) {
  const [existing] = await db.select().from(recruitmentSettings).where(eq(recruitmentSettings.organizationId, organizationId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(recruitmentSettings).values({ organizationId }).returning();
  return created;
}

async function ensureRecruitmentDepartments(organizationId: number): Promise<void> {
  await db.insert(recruitmentDepartments).values([
    { organizationId, name: "Primary School", applicationCategory: "Primary School Teaching", displayOrder: 10, isActive: true },
    { organizationId, name: "Sciences", applicationCategory: "High School Teaching", displayOrder: 20, isActive: true },
    { organizationId, name: "Commercials", applicationCategory: "High School Teaching", displayOrder: 30, isActive: true },
    { organizationId, name: "Arts", applicationCategory: "High School Teaching", displayOrder: 40, isActive: true },
    { organizationId, name: "Computer Sciences", applicationCategory: "High School Teaching", displayOrder: 50, isActive: true },
  ]).onConflictDoNothing();
}

async function ensureRecruitmentExaminationBoards(organizationId: number): Promise<void> {
  await db.insert(recruitmentExaminationBoards).values([
    { organizationId, name: "ZIMSEC", displayOrder: 10, isActive: true },
    { organizationId, name: "Cambridge", displayOrder: 20, isActive: true },
  ]).onConflictDoNothing();
}

async function activeRecruitmentExaminationBoards(organizationId: number) {
  await ensureRecruitmentExaminationBoards(organizationId);
  const rows = await db.select().from(recruitmentExaminationBoards).where(and(
    eq(recruitmentExaminationBoards.organizationId, organizationId),
    eq(recruitmentExaminationBoards.isActive, true),
  )).orderBy(asc(recruitmentExaminationBoards.displayOrder), asc(recruitmentExaminationBoards.name));
  // Historical deployments may contain a configured row literally named "Both".
  // It is no longer a selectable board; multi-board capability is stored explicitly.
  return rows.filter((row) => normalizeExamBoard(row.name) !== "Both");
}

async function resolveConfiguredExaminationBoard(organizationId: number, value: unknown): Promise<string | null> {
  const normalized = normalizeExamBoard(value);
  if (!normalized || normalized.toLowerCase() === "both") return null;
  const configured = await activeRecruitmentExaminationBoards(organizationId);
  const match = configured.find((row) => row.name.trim().toLowerCase() === normalized.toLowerCase());
  return match?.name || null;
}

async function resolveConfiguredExaminationBoards(organizationId: number, value: unknown): Promise<string[]> {
  const requested = normalizeExamBoardList(value);
  if (!requested.length) return [];
  const configured = await activeRecruitmentExaminationBoards(organizationId);
  const resolved: string[] = [];
  for (const board of requested) {
    const match = configured.find((row) => row.name.trim().toLowerCase() === board.toLowerCase());
    if (!match) return [];
    if (!resolved.some((existing) => existing.toLowerCase() === match.name.toLowerCase())) resolved.push(match.name);
  }
  return resolved;
}

function applicationExamBoards(application: Pick<typeof recruitmentApplications.$inferSelect, "examinationBoard" | "examinationBoards">): string[] {
  const structured = normalizeExamBoardList(application.examinationBoards);
  return structured.length ? structured : normalizeExamBoardList(application.examinationBoard);
}

async function ensureRecruitmentNotificationConfigs(organizationId: number): Promise<void> {
  const defaults = [
    { eventKey: "interview_scheduled", applicationVariant: "any", enabled: true, channel: "both", emailSubject: "FCGS Interview Scheduled", emailTemplate: "Dear {applicantName}, your {interviewMode} interview is scheduled for {interviewDate} at {interviewTime}. {interviewVenue} {interviewLink} {applicantInstructions}", smsTemplate: "FCGS: Your {interviewMode} interview is scheduled for {interviewDate} at {interviewTime}. {interviewVenue} {applicantInstructions}" },
    { eventKey: "interview_rescheduled", applicationVariant: "any", enabled: true, channel: "both", emailSubject: "FCGS Interview Rescheduled", emailTemplate: "Dear {applicantName}, your {interviewMode} interview has been rescheduled to {interviewDate} at {interviewTime}. {interviewVenue} {interviewLink} {applicantInstructions}", smsTemplate: "FCGS: Your {interviewMode} interview has been rescheduled to {interviewDate} at {interviewTime}. {interviewVenue} {applicantInstructions}" },
    { eventKey: "interview_cancelled", applicationVariant: "any", enabled: true, channel: "both", emailSubject: "FCGS Interview Cancelled", emailTemplate: "Dear {applicantName}, your interview scheduled for {interviewDate} at {interviewTime} has been cancelled. Please contact Recruitment if you need assistance.", smsTemplate: "FCGS: Your interview scheduled for {interviewDate} at {interviewTime} has been cancelled." },
  ];
  const applicantStatuses = ["under_review", "shortlisted", "interview", "rejected", "hired", "withdrawn"];
  for (const status of applicantStatuses) {
    const readable = status.replace(/_/g, " ");
    defaults.push(
      {
        eventKey: `status:${status}`,
        applicationVariant: "general",
        enabled: false,
        channel: "none",
        emailSubject: `FCGS Recruitment Update - ${readable}`,
        emailTemplate: `Dear {applicantName}, your application status is now {status}. Application category: {applicationCategory}. Department: {departmentName}. If you need assistance, contact {recruiterName} {recruiterPhone} {recruiterEmail}.`,
        smsTemplate: `FCGS Recruitment: Your application status is now {status}. Category: {applicationCategory}. Department: {departmentName}.`,
      },
      {
        eventKey: `status:${status}`,
        applicationVariant: "vacancy",
        enabled: false,
        channel: "none",
        emailSubject: `FCGS Recruitment Update - ${readable}`,
        emailTemplate: `Dear {applicantName}, your application for {vacancyTitle} at {schoolName} is now {status}. If you need assistance, contact {recruiterName} {recruiterPhone} {recruiterEmail}.`,
        smsTemplate: `FCGS Recruitment: Your application for {vacancyTitle} is now {status}.`,
      },
    );
  }
  for (const config of defaults) {
    await db.insert(recruitmentNotificationConfigs).values({ organizationId, ...config }).onConflictDoNothing();
  }
}

function candidateSubjects(application: typeof recruitmentApplications.$inferSelect): string[] {
  return normalizeSubjectList([...(Array.isArray(application.recruiterAssignedSubjects) ? application.recruiterAssignedSubjects : []), ...(Array.isArray(application.declaredSubjects) ? application.declaredSubjects : [])]);
}

function applicationMatchesVacancy(application: typeof recruitmentApplications.$inferSelect, vacancy: typeof recruitmentVacancies.$inferSelect): { matched: boolean; reasons: string[]; teachingQualificationMeets: boolean; experienceMeets: boolean } {
  if (["rejected", "hired", "withdrawn"].includes(String(application.status))) return { matched: false, reasons: [], teachingQualificationMeets: false, experienceMeets: false };
  if (application.employmentCategory !== vacancy.employmentCategory) return { matched: false, reasons: [], teachingQualificationMeets: false, experienceMeets: false };
  const category = recruitmentCategoryCode(vacancy.employmentCategory);
  const reasons = ["Application Category"];
  if (category === "high_school_teaching") {
    if (normalizeRecruitmentDepartment(application.department) !== normalizeRecruitmentDepartment(vacancy.department)) return { matched: false, reasons: [], teachingQualificationMeets: false, experienceMeets: false };
    reasons.push("Department");
    if (!examBoardMatches(applicationExamBoards(application), vacancy.examinationBoard)) return { matched: false, reasons: [], teachingQualificationMeets: false, experienceMeets: false };
    reasons.push("Examination Board");
    if (!subjectsOverlap(candidateSubjects(application), vacancy.subjects)) return { matched: false, reasons: [], teachingQualificationMeets: false, experienceMeets: false };
    reasons.push("Subject");
  } else if (category === "primary_teaching") {
    if (!examBoardMatches(applicationExamBoards(application), vacancy.examinationBoard)) return { matched: false, reasons: [], teachingQualificationMeets: false, experienceMeets: false };
    reasons.push("Examination Board");
  }
  const years = Number(application.yearsExperience || 0);
  const minimum = vacancy.minimumYearsExperience == null ? 0 : Number(vacancy.minimumYearsExperience);
  const teachingQualificationMeets = !vacancy.teachingQualificationRequired || Boolean(application.holdsTeachingQualification);
  const experienceMeets = years >= minimum;
  if (!teachingQualificationMeets || !experienceMeets) {
    return { matched: false, reasons: [], teachingQualificationMeets, experienceMeets };
  }
  if (vacancy.teachingQualificationRequired) reasons.push("Teaching Qualification");
  if (minimum > 0) reasons.push("Experience");
  return {
    matched: true,
    reasons,
    teachingQualificationMeets,
    experienceMeets,
  };
}

function candidateIdentityKey(application: typeof recruitmentApplications.$inferSelect): string {
  return application.normalizedNationalId || application.normalizedEmail || application.normalizedPhone || `application:${application.id}`;
}

async function refreshVacancySuggestions(organizationId: number, vacancy: typeof recruitmentVacancies.$inferSelect): Promise<number> {
  const applications = await db.select().from(recruitmentApplications)
    .where(eq(recruitmentApplications.organizationId, organizationId))
    .orderBy(desc(recruitmentApplications.submittedAt));

  // A person who already applied directly to this vacancy belongs in the Applications tab,
  // not in Suggested Candidates. Keep one representative application per remaining person.
  const directApplicantKeys = new Set(applications.filter((application) => application.vacancyId === vacancy.id).map(candidateIdentityKey));
  const selectedByIdentity = new Map<string, { application: typeof recruitmentApplications.$inferSelect; result: ReturnType<typeof applicationMatchesVacancy> }>();
  for (const application of applications) {
    const key = candidateIdentityKey(application);
    if (directApplicantKeys.has(key)) continue;
    if (selectedByIdentity.has(key)) continue;
    const result = applicationMatchesVacancy(application, vacancy);
    if (result.matched) selectedByIdentity.set(key, { application, result });
  }
  const matching = Array.from(selectedByIdentity.values());

  for (const row of matching) {
    await db.insert(recruitmentVacancyCandidates).values({
      vacancyId: vacancy.id,
      applicationId: row.application.id,
      stage: "suggested",
      matchReasons: row.result.reasons,
    }).onConflictDoUpdate({
      target: [recruitmentVacancyCandidates.vacancyId, recruitmentVacancyCandidates.applicationId],
      set: { matchReasons: row.result.reasons, updatedAt: new Date() },
    });
  }
  const eligibleIds = new Set(matching.map((row) => row.application.id));
  const current = await db.select().from(recruitmentVacancyCandidates).where(eq(recruitmentVacancyCandidates.vacancyId, vacancy.id));
  for (const row of current) {
    if (row.stage === "suggested" && !eligibleIds.has(row.applicationId)) {
      await db.delete(recruitmentVacancyCandidates).where(eq(recruitmentVacancyCandidates.id, row.id));
    }
  }
  return matching.length;
}

const ACTIVE_TALENT_APPLICATION_STATUSES = new Set(["shortlisted", "interview"]);
const EXIT_TALENT_APPLICATION_STATUSES = new Set(["rejected", "hired", "withdrawn"]);
const EXIT_TALENT_AVAILABILITY_STATUSES = new Set(["not_available", "hired", "withdrawn", "archived"]);
const PRIMARY_TALENT_SUBJECT = "Primary School";

async function lockTalentRankingList(tx: any, organizationId: number, department: string, subject: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(${organizationId}::integer, hashtext(${`${department}|${subject}`}))`);
  await tx.insert(recruitmentTalentRankingLists).values({ organizationId, department, subject, version: 0 }).onConflictDoNothing();
  const [list] = await tx.select().from(recruitmentTalentRankingLists).where(and(
    eq(recruitmentTalentRankingLists.organizationId, organizationId),
    eq(recruitmentTalentRankingLists.department, department),
    eq(recruitmentTalentRankingLists.subject, subject),
  )).limit(1);
  if (!list) throw Object.assign(new Error("Talent ranking list could not be initialized."), { status: 500 });
  return list;
}

async function bumpTalentRankingVersion(tx: any, listId: number) {
  const [updated] = await tx.update(recruitmentTalentRankingLists).set({
    version: sql`${recruitmentTalentRankingLists.version} + 1`,
    updatedAt: new Date(),
  }).where(eq(recruitmentTalentRankingLists.id, listId)).returning();
  return updated;
}

async function applicationHasActiveShortlistRelation(tx: any, applicationId: number): Promise<boolean> {
  const [row] = await tx.select({ id: recruitmentVacancyCandidates.id }).from(recruitmentVacancyCandidates).where(and(
    eq(recruitmentVacancyCandidates.applicationId, applicationId),
    inArray(recruitmentVacancyCandidates.stage, ["shortlisted", "final"]),
  )).limit(1);
  return Boolean(row);
}

async function applicationBelongsInTalentPool(tx: any, application: typeof recruitmentApplications.$inferSelect): Promise<boolean> {
  if (EXIT_TALENT_APPLICATION_STATUSES.has(String(application.status))) return false;
  if (EXIT_TALENT_AVAILABILITY_STATUSES.has(String(application.availabilityStatus || "available"))) return false;
  if (ACTIVE_TALENT_APPLICATION_STATUSES.has(String(application.status))) return true;
  return applicationHasActiveShortlistRelation(tx, application.id);
}

function desiredTalentRankingKeys(application: typeof recruitmentApplications.$inferSelect): Array<{ department: string; subject: string }> {
  const category = recruitmentCategoryCode(application.employmentCategory);
  const department = normalizeRecruitmentDepartment(application.department);
  if (category === "primary_teaching") return [{ department: "Primary School", subject: PRIMARY_TALENT_SUBJECT }];
  if (category !== "high_school_teaching" || !department) return [];
  return normalizeSubjectList(application.recruiterAssignedSubjects).map((subject) => ({ department, subject }));
}

async function appendTalentRanking(
  tx: any,
  options: { organizationId: number; applicationId: number; department: string; subject: string; actorUserId?: number | null; reason?: string },
) {
  const list = await lockTalentRankingList(tx, options.organizationId, options.department, options.subject);
  const [maxRow] = await tx.select({ maxPosition: sql<number>`coalesce(max(${recruitmentTalentRankings.position}), 0)` }).from(recruitmentTalentRankings).where(and(
    eq(recruitmentTalentRankings.organizationId, options.organizationId),
    eq(recruitmentTalentRankings.department, options.department),
    eq(recruitmentTalentRankings.subject, options.subject),
    eq(recruitmentTalentRankings.isActive, true),
  ));
  const nextPosition = Number(maxRow?.maxPosition || 0) + 1;
  const [row] = await tx.insert(recruitmentTalentRankings).values({
    organizationId: options.organizationId,
    applicationId: options.applicationId,
    department: options.department,
    subject: options.subject,
    position: nextPosition,
    isActive: true,
    removedAt: null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [
      recruitmentTalentRankings.organizationId,
      recruitmentTalentRankings.applicationId,
      recruitmentTalentRankings.department,
      recruitmentTalentRankings.subject,
    ],
    set: { position: nextPosition, isActive: true, removedAt: null, addedAt: new Date(), updatedAt: new Date() },
  }).returning();
  const version = await bumpTalentRankingVersion(tx, list.id);
  await tx.insert(recruitmentActivity).values({
    organizationId: options.organizationId,
    applicationId: options.applicationId,
    activityType: "talent_ranking_added",
    summary: `${options.department} · ${options.subject}: candidate added to the bottom of the shortlist at #${nextPosition}.`,
    details: { department: options.department, subject: options.subject, position: nextPosition, reason: options.reason || "shortlisted" },
    actorUserId: options.actorUserId || null,
  });
  return { row, version: Number(version?.version || list.version || 0) };
}

async function removeTalentRanking(
  tx: any,
  row: typeof recruitmentTalentRankings.$inferSelect,
  options: { actorUserId?: number | null; reason: string },
) {
  if (!row.isActive) return;
  const list = await lockTalentRankingList(tx, row.organizationId, row.department, row.subject);
  const oldPosition = Number(row.position);
  await tx.update(recruitmentTalentRankings).set({ isActive: false, removedAt: new Date(), updatedAt: new Date() }).where(eq(recruitmentTalentRankings.id, row.id));
  await tx.update(recruitmentTalentRankings).set({
    position: sql`${recruitmentTalentRankings.position} - 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(recruitmentTalentRankings.organizationId, row.organizationId),
    eq(recruitmentTalentRankings.department, row.department),
    eq(recruitmentTalentRankings.subject, row.subject),
    eq(recruitmentTalentRankings.isActive, true),
    sql`${recruitmentTalentRankings.position} > ${oldPosition}`,
  ));
  await bumpTalentRankingVersion(tx, list.id);
  await tx.insert(recruitmentActivity).values({
    organizationId: row.organizationId,
    applicationId: row.applicationId,
    activityType: "talent_ranking_removed",
    summary: `${row.department} · ${row.subject}: candidate removed from active ranking (previously #${oldPosition}).`,
    details: { department: row.department, subject: row.subject, previousPosition: oldPosition, reason: options.reason },
    actorUserId: options.actorUserId || null,
  });
}

async function syncApplicationTalentRankings(
  tx: any,
  organizationId: number,
  applicationId: number,
  options: { actorUserId?: number | null; reason?: string } = {},
) {
  const [application] = await tx.select().from(recruitmentApplications).where(and(
    eq(recruitmentApplications.id, applicationId),
    eq(recruitmentApplications.organizationId, organizationId),
  )).limit(1);
  if (!application) return;
  const shouldBeActive = await applicationBelongsInTalentPool(tx, application);
  const desired = shouldBeActive ? desiredTalentRankingKeys(application) : [];
  const desiredKeySet = new Set(desired.map((row) => `${row.department.toLowerCase()}\u0000${row.subject.toLowerCase()}`));
  const current = await tx.select().from(recruitmentTalentRankings).where(and(
    eq(recruitmentTalentRankings.organizationId, organizationId),
    eq(recruitmentTalentRankings.applicationId, applicationId),
    eq(recruitmentTalentRankings.isActive, true),
  ));
  for (const row of current) {
    const key = `${row.department.toLowerCase()}\u0000${row.subject.toLowerCase()}`;
    if (!desiredKeySet.has(key)) {
      await removeTalentRanking(tx, row, { actorUserId: options.actorUserId, reason: options.reason || (shouldBeActive ? "subject_removed" : "left_active_talent_pool") });
    }
  }
  const currentAfterRemoval = await tx.select().from(recruitmentTalentRankings).where(and(
    eq(recruitmentTalentRankings.organizationId, organizationId),
    eq(recruitmentTalentRankings.applicationId, applicationId),
    eq(recruitmentTalentRankings.isActive, true),
  ));
  const activeKeys = new Set(currentAfterRemoval.map((row: any) => `${row.department.toLowerCase()}\u0000${row.subject.toLowerCase()}`));
  for (const row of desired) {
    const key = `${row.department.toLowerCase()}\u0000${row.subject.toLowerCase()}`;
    if (!activeKeys.has(key)) {
      await appendTalentRanking(tx, { organizationId, applicationId, department: row.department, subject: row.subject, actorUserId: options.actorUserId, reason: options.reason });
    }
  }
}

async function ensureRecruitmentDocumentCategories(organizationId: number): Promise<void> {
  const [existing] = await db.select({ id: recruitmentDocumentCategories.id }).from(recruitmentDocumentCategories)
    .where(eq(recruitmentDocumentCategories.organizationId, organizationId)).limit(1);
  if (existing) return;
  const scope = scopeKey(null, null);
  await db.insert(recruitmentDocumentCategories).values([
    { organizationId, vacancyId: null, employmentCategory: null, scopeKey: scope, code: "curriculum_vitae", label: "Curriculum Vitae", isRequired: true, allowsMultiple: false, displayOrder: 10 },
    { organizationId, vacancyId: null, employmentCategory: null, scopeKey: scope, code: "national_id", label: "National ID or Passport", isRequired: true, allowsMultiple: false, displayOrder: 20 },
    { organizationId, vacancyId: null, employmentCategory: null, scopeKey: scope, code: "qualification_certificates", label: "Qualification Certificates", isRequired: true, allowsMultiple: true, displayOrder: 30 },
    { organizationId, vacancyId: null, employmentCategory: null, scopeKey: scope, code: "teaching_certificate", label: "Teaching Certificate", isRequired: false, allowsMultiple: true, displayOrder: 40 },
    { organizationId, vacancyId: null, employmentCategory: null, scopeKey: scope, code: "references", label: "References", isRequired: false, allowsMultiple: true, displayOrder: 50 },
    { organizationId, vacancyId: null, employmentCategory: null, scopeKey: scope, code: "other", label: "Other Supporting Document", isRequired: false, allowsMultiple: true, displayOrder: 999 },
  ]).onConflictDoNothing();
}

async function publicContext(organizationId?: number | null) {
  const [organization] = organizationId
    ? await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1)
    : await db.select().from(organizations).orderBy(asc(organizations.id)).limit(1);
  if (!organization) throw Object.assign(new Error("Recruitment organization was not found"), { status: 404 });
  const settings = await ensureSettings(organization.id);
  await Promise.all([ensureRecruitmentDocumentCategories(organization.id), ensureRecruitmentDepartments(organization.id), ensureRecruitmentExaminationBoards(organization.id), ensureRecruitmentNotificationConfigs(organization.id)]);
  const now = new Date();
  const vacancies = await db.select().from(recruitmentVacancies).where(and(
    eq(recruitmentVacancies.organizationId, organization.id),
    eq(recruitmentVacancies.status, "published"),
  )).orderBy(asc(recruitmentVacancies.title));
  const openVacancies = vacancies.filter((vacancy) => {
    if (!isSupportedRecruitmentCategory(vacancy.employmentCategory)) return false;
    if (vacancy.opensAt && new Date(vacancy.opensAt) > now) return false;
    if (vacancy.closesAt && new Date(vacancy.closesAt) < now) return false;
    return true;
  });
  const activeRequirements = await db.select().from(recruitmentRequirements).where(and(
    eq(recruitmentRequirements.organizationId, organization.id),
    eq(recruitmentRequirements.isActive, true),
  )).orderBy(asc(recruitmentRequirements.displayOrder), asc(recruitmentRequirements.id));
  const categories = await db.select().from(recruitmentDocumentCategories).where(and(
    eq(recruitmentDocumentCategories.organizationId, organization.id),
    eq(recruitmentDocumentCategories.isActive, true),
  )).orderBy(asc(recruitmentDocumentCategories.displayOrder), asc(recruitmentDocumentCategories.id));
  const [orgSchools, departments, examinationBoards] = await Promise.all([
    db.select({ id: schools.id, name: schools.name, shortCode: schools.shortCode }).from(schools)
      .where(eq(schools.organizationId, organization.id)).orderBy(asc(schools.name)),
    db.select().from(recruitmentDepartments).where(and(eq(recruitmentDepartments.organizationId, organization.id), eq(recruitmentDepartments.isActive, true))).orderBy(asc(recruitmentDepartments.displayOrder), asc(recruitmentDepartments.name)),
    activeRecruitmentExaminationBoards(organization.id),
  ]);
  return {
    organization: { id: organization.id, name: organization.name, logo: organization.logo },
    settings,
    vacancies: openVacancies,
    requirements: activeRequirements,
    documentCategories: categories,
    schools: orgSchools,
    departments,
    examinationBoards,
  };
}

function publicRecruitmentContextResponse(context: Awaited<ReturnType<typeof publicContext>>) {
  return {
    ...context,
    settings: {
      publicApplicationsOpen: context.settings.publicApplicationsOpen,
      generalApplicationsOpen: context.settings.generalApplicationsOpen,
      attachmentSizeLimitMB: context.settings.attachmentSizeLimitMB,
      careersPageTitle: context.settings.careersPageTitle,
      careersPageMessage: context.settings.careersPageMessage,
    },
    applicationCategories: RECRUITMENT_CATEGORIES,
    departments: context.departments,
    examinationBoards: context.examinationBoards.map((board) => board.name),
    highSchoolEligibility: publicHighSchoolEligibilityPolicy({
      maxAge: context.settings.highSchoolMaxAge,
      minimumALevelPoints: context.settings.highSchoolMinimumALevelPoints,
      teachingQualifiedMinimumALevelPoints: context.settings.highSchoolTeachingQualifiedMinimumALevelPoints,
      teachingQualificationExceptionEnabled: context.settings.highSchoolTeachingQualificationExceptionEnabled,
    }),
    primarySchoolEligibility: publicPrimarySchoolEligibilityPolicy({
      teachingQualificationRequired: context.settings.primaryTeachingQualificationRequired,
      maximumOLevelSittings: context.settings.primaryMaximumOLevelSittings,
      minimumOLevelSubjects: context.settings.primaryMinimumOLevelSubjects,
      minimumOLevelGrade: context.settings.primaryMinimumOLevelGrade,
      mandatoryOLevelSubjects: normalizeSubjectList(context.settings.primaryMandatoryOLevelSubjects),
      mandatoryOLevelGrade: context.settings.primaryMandatoryOLevelGrade,
    }),
    requirements: context.requirements.map(({ alternativePassKeywords: _keywords, alternativePassNote: _note, ...requirement }) => requirement),
  };
}

function templateValue(value: unknown): string {
  return String(value ?? "").trim();
}

function renderRecruitmentTemplate(template: string | null | undefined, values: Record<string, unknown>): string {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => templateValue(values[key]));
}

function safeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br />");
}

async function recruitmentTemplateValues(
  application: typeof recruitmentApplications.$inferSelect,
  options: { vacancy?: typeof recruitmentVacancies.$inferSelect | null; interview?: typeof recruitmentInterviews.$inferSelect | null } = {},
) {
  const vacancy = options.vacancy ?? (application.vacancyId
    ? await db.select().from(recruitmentVacancies).where(eq(recruitmentVacancies.id, application.vacancyId)).limit(1).then((rows) => rows[0] || null)
    : null);
  const school = vacancy?.schoolId
    ? await db.select({ name: schools.name }).from(schools).where(eq(schools.id, vacancy.schoolId)).limit(1).then((rows) => rows[0] || null)
    : null;
  const department = application.department
    ? await db.select().from(recruitmentDepartments).where(and(eq(recruitmentDepartments.organizationId, application.organizationId), eq(recruitmentDepartments.name, normalizeRecruitmentDepartment(application.department)))).limit(1).then((rows) => rows[0] || null)
    : null;
  const recruiter = department?.responsibleUserId
    ? await db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone })
      .from(users).where(eq(users.id, department.responsibleUserId)).limit(1).then((rows) => rows[0] || null)
    : null;
  const interview = options.interview || null;
  const scheduled = interview?.scheduledAt ? new Date(interview.scheduledAt) : null;
  const validScheduled = scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled : null;
  const recruiterName = [recruiter?.firstName, recruiter?.lastName].filter(Boolean).join(" ").trim() || "Recruitment Team";
  return {
    applicantName: `${application.firstName} ${application.lastName}`.trim(),
    firstName: application.firstName,
    lastName: application.lastName,
    applicationCategory: application.employmentCategory,
    departmentName: normalizeRecruitmentDepartment(application.department) || "",
    examinationBoard: formatExamBoards(applicationExamBoards(application)),
    status: String(application.status || "").replace(/_/g, " "),
    vacancyTitle: vacancy?.title || "",
    vacancyCode: vacancy?.code || "",
    schoolName: school?.name || "",
    recruiterName,
    recruiterPhone: department?.applicantContactPhone || recruiter?.phone || "",
    recruiterEmail: department?.applicantContactEmail || recruiter?.email || "",
    interviewDate: validScheduled ? validScheduled.toLocaleDateString("en-GB", { dateStyle: "full" }) : "",
    interviewTime: validScheduled ? validScheduled.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "",
    interviewMode: interview ? String(interview.interviewType || "in_person").replace(/_/g, " ") : "",
    interviewVenue: interview?.location || "",
    interviewLink: interview?.interviewLink || "",
    applicantInstructions: interview?.applicantInstructions || "",
  };
}

async function sendRecruitmentNotification(options: {
  organizationId: number;
  application: typeof recruitmentApplications.$inferSelect;
  eventKey: string;
  sentByUserId: number;
  interview?: typeof recruitmentInterviews.$inferSelect | null;
  vacancy?: typeof recruitmentVacancies.$inferSelect | null;
  channelOverride?: "email" | "sms";
}) {
  const variant = options.application.applicationType === "vacancy" ? "vacancy" : "general";
  const configs = await db.select().from(recruitmentNotificationConfigs).where(and(
    eq(recruitmentNotificationConfigs.organizationId, options.organizationId),
    eq(recruitmentNotificationConfigs.eventKey, options.eventKey),
  ));
  const config = configs.find((row) => row.applicationVariant === variant) || configs.find((row) => row.applicationVariant === "any");
  if (!config?.enabled || config.channel === "none") return { skipped: true, reason: "Notification disabled" };

  const values = await recruitmentTemplateValues(options.application, { vacancy: options.vacancy, interview: options.interview });
  const emailSubject = renderRecruitmentTemplate(config.emailSubject || "FCGS Recruitment Update", values).trim() || "FCGS Recruitment Update";
  const emailMessage = renderRecruitmentTemplate(config.emailTemplate, values).trim();
  const smsMessage = renderRecruitmentTemplate(config.smsTemplate, values).trim();
  const common = {
    schoolId: options.application.schoolId || undefined,
    recipientType: "recruitment_applicant",
    recipientId: options.application.id,
    recipientName: `${options.application.firstName} ${options.application.lastName}`.trim(),
    category: "recruitment",
    sentBy: options.sentByUserId,
  };
  const result: Record<string, unknown> = {};
  const sendEmail = options.channelOverride ? options.channelOverride === "email" : (config.channel === "email" || config.channel === "both");
  const sendSms = options.channelOverride ? options.channelOverride === "sms" : (config.channel === "sms" || config.channel === "both");

  if (sendEmail) {
    let delivery: any;
    if (!options.application.email) delivery = { success: false, error: "No email address" };
    else if (!emailMessage) delivery = { success: false, error: "Email template is empty" };
    else delivery = await communicationService.sendEmail({ ...common, to: options.application.email, subject: emailSubject, text: emailMessage, html: `<p>${safeHtmlText(emailMessage)}</p>` });
    result.email = delivery;
    await db.insert(recruitmentNotificationLogs).values({
      organizationId: options.organizationId,
      applicationId: options.application.id,
      vacancyId: options.vacancy?.id || options.application.vacancyId || null,
      interviewId: options.interview?.id || null,
      eventKey: options.eventKey,
      channel: "email",
      destination: options.application.email || null,
      status: delivery?.success ? "sent" : "failed",
      errorMessage: delivery?.success ? null : String(delivery?.error || "Email delivery failed"),
      sentAt: delivery?.success ? new Date() : null,
    });
  }

  if (sendSms) {
    let delivery: any;
    if (!options.application.phone) delivery = { success: false, error: "No phone number" };
    else if (!smsMessage) delivery = { success: false, error: "SMS template is empty" };
    else delivery = await communicationService.sendSms({ ...common, to: options.application.phone, message: smsMessage });
    result.sms = delivery;
    await db.insert(recruitmentNotificationLogs).values({
      organizationId: options.organizationId,
      applicationId: options.application.id,
      vacancyId: options.vacancy?.id || options.application.vacancyId || null,
      interviewId: options.interview?.id || null,
      eventKey: options.eventKey,
      channel: "sms",
      destination: options.application.phone || null,
      status: delivery?.success ? "sent" : "failed",
      errorMessage: delivery?.success ? null : String(delivery?.error || "SMS delivery failed"),
      sentAt: delivery?.success ? new Date() : null,
    });
  }
  return result;
}

export async function syncRecruitmentTalentRankingsForApplication(organizationId: number, applicationId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await syncApplicationTalentRankings(tx, organizationId, applicationId, { reason: "synchronization" });
  });
}

export async function syncAllRecruitmentTalentRankings(): Promise<{ applications: number }> {
  const rows = await db.select({ id: recruitmentApplications.id, organizationId: recruitmentApplications.organizationId }).from(recruitmentApplications).orderBy(asc(recruitmentApplications.id));
  for (const row of rows) await syncRecruitmentTalentRankingsForApplication(row.organizationId, row.id);
  return { applications: rows.length };
}

export function registerRecruitmentRoutes(app: Express): void {
  app.get("/api/public/recruitment/context", async (req, res, next) => {
    try {
      const organizationId = req.query.organizationId ? Number(req.query.organizationId) : null;
      const context = await publicContext(Number.isInteger(organizationId) && organizationId! > 0 ? organizationId : null);
      res.json(publicRecruitmentContextResponse(context));
    } catch (error) { next(error); }
  });

  app.post("/api/public/recruitment/applications", upload.array("documents", 20), async (req, res, next) => {
    const savedKeys: string[] = [];
    try {
      const rawApplication = typeof req.body.application === "string" ? JSON.parse(req.body.application) : req.body.application;
      const input = publicApplicationInput.parse(rawApplication);
      const context = await publicContext(input.organizationId);
      if (!context.settings.publicApplicationsOpen) return res.status(403).json({ message: "Recruitment applications are currently closed." });
      if (input.applicationType === "general" && !context.settings.generalApplicationsOpen) return res.status(403).json({ message: "General applications are currently closed." });
      if (input.applicationType === "vacancy" && !input.vacancyId) return res.status(400).json({ message: "Select an advertised vacancy." });
      const vacancy = input.vacancyId ? context.vacancies.find((row) => row.id === input.vacancyId) : null;
      if (input.vacancyId && !vacancy) return res.status(400).json({ message: "The selected vacancy is not open for applications." });
      if (vacancy && vacancy.employmentCategory !== input.employmentCategory) return res.status(400).json({ message: "The employment category does not match the selected vacancy." });
      if (input.applicationType === "general" && !isSupportedRecruitmentCategory(input.employmentCategory)) {
        return res.status(400).json({ message: "Select a valid employment category." });
      }
      const categoryCodeForDepartment = recruitmentCategoryCode(input.employmentCategory);
      const activeDepartments = context.departments.filter((department) => department.isActive);
      const effectiveDepartment = categoryCodeForDepartment === "primary_teaching"
        ? "Primary School"
        : categoryCodeForDepartment === "high_school_teaching"
          ? normalizeRecruitmentDepartment(vacancy?.department || input.department)
          : "";
      if (categoryCodeForDepartment === "high_school_teaching") {
        const configured = activeDepartments.some((department) => department.applicationCategory === "High School Teaching" && normalizeRecruitmentDepartment(department.name) === effectiveDepartment);
        if (!effectiveDepartment || !configured) return res.status(400).json({ message: "Select one valid High School department." });
      }
      const requestedExamBoards = input.examinationBoards.length
        ? input.examinationBoards
        : normalizeExamBoardList(input.examinationBoard);
      const effectiveExamBoards = (categoryCodeForDepartment === "high_school_teaching" || categoryCodeForDepartment === "primary_teaching")
        ? await resolveConfiguredExaminationBoards(input.organizationId, requestedExamBoards)
        : [];
      if ((categoryCodeForDepartment === "high_school_teaching" || categoryCodeForDepartment === "primary_teaching") && !effectiveExamBoards.length) {
        return res.status(400).json({ message: "Select at least one active examination board you are able to teach." });
      }
      if (vacancy?.examinationBoard && !examBoardMatches(effectiveExamBoards, vacancy.examinationBoard)) {
        return res.status(400).json({ message: "Your examination-board capability does not match this vacancy." });
      }
      const effectiveSubjects = normalizeSubjectList(input.declaredSubjects);
      if (categoryCodeForDepartment === "high_school_teaching" && effectiveSubjects.length === 0) {
        return res.status(400).json({ message: "Enter at least one subject you are able to teach." });
      }
      if (vacancy && categoryCodeForDepartment === "high_school_teaching" && !subjectsOverlap(effectiveSubjects, vacancy.subjects)) {
        return res.status(400).json({ message: "Your selected teaching subjects do not match this vacancy." });
      }
      if (input.dateOfBirth) {
        const dob = new Date(`${input.dateOfBirth}T00:00:00`);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (!Number.isNaN(dob.getTime()) && dob > today) return res.status(400).json({ message: "Date of birth cannot be in the future." });
      }

      const normalizedEmail = normalizeEmail(input.email);
      const normalizedPhone = normalizePhone(input.phone);
      const normalizedNationalId = normalizeNationalId(input.nationalId);
      const categoryCode = recruitmentCategoryCode(input.employmentCategory);
      const isHighSchoolApplication = categoryCode === "high_school_teaching";
      const isPrimarySchoolApplication = categoryCode === "primary_teaching";
      const applicableRequirements = context.requirements.filter((requirement) => {
        const inScope = requirement.vacancyId === input.vacancyId
          || (!requirement.vacancyId && requirement.employmentCategory === input.employmentCategory)
          || (!requirement.vacancyId && !requirement.employmentCategory);
        if (!inScope) return false;
        // Built-in teaching eligibility policies are server-managed. Legacy generic rows
        // for the same core rules are ignored to avoid double-screening.
        if (isHighSchoolApplication && isHighSchoolCoreRequirementDefinition(requirement)) return false;
        if (isPrimarySchoolApplication && isPrimarySchoolCoreRequirementDefinition(requirement)) return false;
        return true;
      });
      const applicableCategories = context.documentCategories.filter((category) => (
        category.vacancyId === input.vacancyId
        || (!category.vacancyId && category.employmentCategory === input.employmentCategory)
        || (!category.vacancyId && !category.employmentCategory)
      ));
      const files = (req.files as Express.Multer.File[] | undefined) || [];
      const submittedCategoryCodes = input.documentCategories.map((value) => String(value));
      if (files.length !== submittedCategoryCodes.length) return res.status(400).json({ message: "Every uploaded document must have a category." });
      if (files.some((file) => file.size > context.settings.attachmentSizeLimitMB * 1024 * 1024)) {
        return res.status(413).json({ message: `Each attachment must be ${context.settings.attachmentSizeLimitMB} MB or smaller.` });
      }

      if (!categoryCode) return res.status(400).json({ message: "Select a valid employment category." });
      const coreDocuments = coreRecruitmentDocumentRequirements(
        categoryCode,
        input.holdsTeachingQualification,
        context.settings.primaryTeachingQualificationRequired,
      );
      const coreDocumentCodes = new Set(coreDocuments.map((document) => document.code));
      const missingCoreDocuments = coreDocuments.filter((document) => document.isRequired && !submittedCategoryCodes.includes(document.code));
      const missingRequiredDocuments = applicableCategories.filter((category) => category.isRequired && !submittedCategoryCodes.includes(category.code));

      const highSchoolEligibility = categoryCode === "high_school_teaching"
        ? evaluateHighSchoolEligibility({
            dateOfBirth: input.dateOfBirth,
            aLevelResults: input.aLevelResults,
            holdsTeachingQualification: input.holdsTeachingQualification,
            // Uploads are reviewer evidence, not submission gates. A declared teaching qualification may
            // use the configured exception route even when the certificate will be supplied/reviewed later.
            teachingCertificateUploaded: input.holdsTeachingQualification,
            policy: {
              maxAge: context.settings.highSchoolMaxAge,
              minimumALevelPoints: context.settings.highSchoolMinimumALevelPoints,
              teachingQualifiedMinimumALevelPoints: context.settings.highSchoolTeachingQualifiedMinimumALevelPoints,
              teachingQualificationExceptionEnabled: context.settings.highSchoolTeachingQualificationExceptionEnabled,
            },
          })
        : null;
      const primarySchoolEligibility = categoryCode === "primary_teaching"
        ? evaluatePrimarySchoolEligibility({
            oLevelResults: input.oLevelResults,
            holdsTeachingQualification: input.holdsTeachingQualification,
            policy: {
              teachingQualificationRequired: context.settings.primaryTeachingQualificationRequired,
              maximumOLevelSittings: context.settings.primaryMaximumOLevelSittings,
              minimumOLevelSubjects: context.settings.primaryMinimumOLevelSubjects,
              minimumOLevelGrade: context.settings.primaryMinimumOLevelGrade,
              mandatoryOLevelSubjects: normalizeSubjectList(context.settings.primaryMandatoryOLevelSubjects),
              mandatoryOLevelGrade: context.settings.primaryMandatoryOLevelGrade,
            },
          })
        : null;

      const evaluated: Array<{
        requirement: typeof recruitmentRequirements.$inferSelect;
        answer: unknown;
        passed: boolean;
        alternativeAccepted: boolean;
        evaluationNote: string | null;
      }> = applicableRequirements.map((requirement) => {
        const answer = input.answers[requirement.code];
        const evaluation = evaluateRecruitmentRequirement(requirement, answer, input.qualifications);
        return { requirement, answer, ...evaluation };
      });
      const failedAutoReject = evaluated.filter(({ requirement, passed }) => requirement.isMandatory && requirement.autoRejectOnFail && !passed);
      const failedCodes = failedAutoReject.map(({ requirement }) => requirement.code);
      const preferredSchoolIds: number[] = [];
      // Requested documents are deliberately non-blocking. Keep the missing-document list for reviewer visibility,
      // but never reject an otherwise eligible application solely because an upload is absent.
      if (highSchoolEligibility && !highSchoolEligibility.passed) failedCodes.push(...highSchoolEligibility.failedCodes);
      if (primarySchoolEligibility && !primarySchoolEligibility.passed) failedCodes.push(...primarySchoolEligibility.failedCodes);

      const lockKey = `${input.organizationId}|${normalizedEmail}|${normalizedPhone}|${normalizedNationalId}`;
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
        const identityMatch = or(
          eq(recruitmentApplications.normalizedEmail, normalizedEmail),
          eq(recruitmentApplications.normalizedPhone, normalizedPhone),
          eq(recruitmentApplications.normalizedNationalId, normalizedNationalId),
        );
        const sameOpportunity = input.applicationType === "vacancy" && input.vacancyId
          ? eq(recruitmentApplications.vacancyId, input.vacancyId)
          : and(eq(recruitmentApplications.applicationType, "general"), eq(recruitmentApplications.employmentCategory, input.employmentCategory));
        const [duplicate] = await tx.select({ id: recruitmentApplications.id }).from(recruitmentApplications).where(and(
          eq(recruitmentApplications.organizationId, input.organizationId),
          identityMatch,
          sameOpportunity,
        )).limit(1);
        if (duplicate) {
          await tx.insert(recruitmentRejectionAttempts).values({
            organizationId: input.organizationId,
            vacancyId: input.vacancyId || null,
            applicationType: input.applicationType,
            employmentCategory: input.employmentCategory,
            firstName: input.firstName,
            lastName: input.lastName,
            normalizedEmail,
            normalizedPhone,
            normalizedNationalId,
            reasonCode: "duplicate",
            failedRequirementCodes: [],
            duplicateApplicationId: duplicate.id,
            screeningDetails: { categoryCode, duplicateMatched: true, preferredSchoolIds },
          });
          return { rejected: true as const, reason: "duplicate" as const };
        }
        if (failedCodes.length) {
          await tx.insert(recruitmentRejectionAttempts).values({
            organizationId: input.organizationId,
            vacancyId: input.vacancyId || null,
            applicationType: input.applicationType,
            employmentCategory: input.employmentCategory,
            firstName: input.firstName,
            lastName: input.lastName,
            normalizedEmail,
            normalizedPhone,
            normalizedNationalId,
            reasonCode: "criteria_failed",
            failedRequirementCodes: Array.from(new Set(failedCodes)),
            screeningDetails: {
              categoryCode,
              age: highSchoolEligibility?.age ?? null,
              aLevelPoints: highSchoolEligibility?.aLevelPoints ?? null,
              oLevelSittingCount: primarySchoolEligibility?.oLevelSittingCount ?? null,
              oLevelQualifyingSubjectCount: primarySchoolEligibility?.oLevelQualifyingSubjectCount ?? null,
              holdsTeachingQualification: input.holdsTeachingQualification,
              examinationBoards: effectiveExamBoards,
              preferredSchoolIds,
            },
          });
          return { rejected: true as const, reason: "criteria_failed" as const };
        }

        const [application] = await tx.insert(recruitmentApplications).values({
          organizationId: input.organizationId,
          schoolId: vacancy?.schoolId || null,
          vacancyId: input.vacancyId || null,
          applicationType: input.applicationType,
          employmentCategory: input.employmentCategory,
          department: effectiveDepartment || null,
          examinationBoard: effectiveExamBoards.length === 1 ? effectiveExamBoards[0] : null,
          examinationBoards: effectiveExamBoards,
          declaredSubjects: effectiveSubjects,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          nationalId: input.nationalId,
          dateOfBirth: input.dateOfBirth || null,
          gender: input.gender || null,
          address: input.address || null,
          preferredSchoolIds,
          qualifications: input.qualifications || null,
          yearsExperience: String(input.yearsExperience),
          currentEmployer: input.currentEmployer || null,
          coverLetter: input.coverLetter || null,
          ageAtSubmission: highSchoolEligibility?.age ?? null,
          aLevelResults: categoryCode === "high_school_teaching" ? input.aLevelResults : [],
          aLevelPoints: highSchoolEligibility?.aLevelPoints ?? null,
          oLevelResults: categoryCode === "primary_teaching" ? input.oLevelResults : [],
          oLevelSittingCount: primarySchoolEligibility?.oLevelSittingCount ?? null,
          oLevelQualifyingSubjectCount: primarySchoolEligibility?.oLevelQualifyingSubjectCount ?? null,
          holdsTeachingQualification: input.holdsTeachingQualification,
          eligibilityRoute: highSchoolEligibility?.route || primarySchoolEligibility?.route || "configured_requirements",
          normalizedEmail,
          normalizedPhone,
          normalizedNationalId,
          eligibilityStatus: "eligible",
          failedRequirementCodes: [],
          status: "submitted",
        }).returning();
        await tx.insert(recruitmentApplicationStatusHistory).values({
          applicationId: application.id,
          previousStatus: null,
          newStatus: "submitted",
          notes: [
            "Application submitted through the public Careers page.",
            [...missingRequiredDocuments.map((row) => row.label), ...missingCoreDocuments.map((row) => row.label)].length
              ? `Missing requested documents: ${[...missingRequiredDocuments.map((row) => row.label), ...missingCoreDocuments.map((row) => row.label)].join(", ")}`
              : null,
          ].filter(Boolean).join(" "),
          changedByUserId: null,
          actorType: "applicant",
          actorLabel: `${input.firstName} ${input.lastName}`.trim(),
        });
        await tx.insert(recruitmentActivity).values({
          organizationId: input.organizationId,
          applicationId: application.id,
          vacancyId: application.vacancyId || null,
          activityType: "application_submitted",
          summary: `${input.firstName} ${input.lastName}`.trim() + " submitted an application.",
          details: { applicationType: input.applicationType, category: input.employmentCategory },
          actorUserId: null,
        });
        if (evaluated.length) {
          await tx.insert(recruitmentApplicationAnswers).values(evaluated.map(({ requirement, answer, passed, alternativeAccepted, evaluationNote }) => ({
            applicationId: application.id,
            requirementId: requirement.id,
            answerValue: answer == null ? "" : answer,
            passed,
            alternativeAccepted,
            evaluationNote,
          })));
        }
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          const categoryCode = submittedCategoryCodes[index];
          const category = applicableCategories.find((row) => row.code === categoryCode);
          if (!category && !coreDocumentCodes.has(categoryCode) && categoryCode !== "other") {
            throw Object.assign(new Error(`Unknown document category: ${categoryCode}`), { status: 400 });
          }
          const saved = await savePrivateBuffer({
            namespace: "recruitment",
            scopeId: application.id,
            originalName: file.originalname,
            mimeType: file.mimetype,
            buffer: file.buffer,
          });
          savedKeys.push(saved.storageKey);
          await tx.insert(recruitmentApplicationDocuments).values({
            applicationId: application.id,
            categoryCode,
            ...saved,
          });
        }
        return { rejected: false as const, applicationId: application.id };
      });

      if (result.rejected) {
        const message = result.reason === "duplicate"
          ? "You already have an application for this same opportunity."
          : highSchoolEligibility && !highSchoolEligibility.passed
            ? highSchoolEligibility.failedCodes.includes("date_of_birth_future")
              ? "Date of birth cannot be in the future."
              : `This application does not meet the current High School Teaching eligibility requirements (${highSchoolEligibility.failedCodes.join(", ")}).`
            : primarySchoolEligibility && !primarySchoolEligibility.passed
              ? `This application does not meet the current Primary School Teaching eligibility requirements (${primarySchoolEligibility.failedCodes.join(", ")}).`
              : "This application could not be accepted because a mandatory recruitment requirement was not met.";
        return res.status(422).json({ message, code: "APPLICATION_NOT_ACCEPTED" });
      }
      await Promise.all(context.vacancies.map((openVacancy) => refreshVacancySuggestions(input.organizationId, openVacancy).catch(() => 0)));
      return res.status(201).json({
        message: "Your application has been submitted successfully.",
        reference: `REC-${String(result.applicationId).padStart(6, "0")}`,
      });
    } catch (error) {
      await Promise.all(savedKeys.map((key) => deletePrivateFile(key)));
      next(error);
    }
  });

  app.use("/api/recruitment", requireAuth, requireRecruitmentHq);

  app.get("/api/recruitment/bootstrap", requirePermission("recruitment.view"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const user = userOf(req)!;
      const settings = await ensureSettings(organizationId);
      await Promise.all([ensureRecruitmentDocumentCategories(organizationId), ensureRecruitmentDepartments(organizationId), ensureRecruitmentExaminationBoards(organizationId), ensureRecruitmentNotificationConfigs(organizationId)]);
      const [canViewRejectedAttempts, canViewDocuments] = await Promise.all([
        (user.role === "org_admin" || !user.schoolId)
          ? userHasRecruitmentPermission(user.id, "recruitment.rejected_attempts.view")
          : Promise.resolve(false),
        userHasRecruitmentPermission(user.id, "recruitment.documents.view")
          .then(async (allowed) => allowed || userHasRecruitmentPermission(user.id, "recruitment.documents.manage")),
      ]);
      const [orgSchools, vacancies, requirements, categories, allApplications, rejectionAttempts, interviews, departments, examinationBoardConfigs, vacancyCandidates, activity, notificationConfigs, recruiterStaff, talentRankingLists, talentRankings, recruitmentNoteRows, subjectCatalogRows] = await Promise.all([
        db.select({ id: schools.id, name: schools.name, shortCode: schools.shortCode }).from(schools).where(eq(schools.organizationId, organizationId)).orderBy(asc(schools.name)),
        db.select().from(recruitmentVacancies).where(eq(recruitmentVacancies.organizationId, organizationId)).orderBy(desc(recruitmentVacancies.createdAt)),
        db.select().from(recruitmentRequirements).where(eq(recruitmentRequirements.organizationId, organizationId)).orderBy(asc(recruitmentRequirements.displayOrder)),
        db.select().from(recruitmentDocumentCategories).where(eq(recruitmentDocumentCategories.organizationId, organizationId)).orderBy(asc(recruitmentDocumentCategories.displayOrder)),
        db.select().from(recruitmentApplications).where(eq(recruitmentApplications.organizationId, organizationId)).orderBy(desc(recruitmentApplications.submittedAt)),
        canViewRejectedAttempts
          ? db.select().from(recruitmentRejectionAttempts).where(eq(recruitmentRejectionAttempts.organizationId, organizationId)).orderBy(desc(recruitmentRejectionAttempts.attemptedAt)).limit(500)
          : Promise.resolve([]),
        db.select().from(recruitmentInterviews).orderBy(desc(recruitmentInterviews.scheduledAt)),
        db.select().from(recruitmentDepartments).where(eq(recruitmentDepartments.organizationId, organizationId)).orderBy(asc(recruitmentDepartments.displayOrder), asc(recruitmentDepartments.name)),
        db.select().from(recruitmentExaminationBoards).where(eq(recruitmentExaminationBoards.organizationId, organizationId)).orderBy(asc(recruitmentExaminationBoards.displayOrder), asc(recruitmentExaminationBoards.name)),
        db.select().from(recruitmentVacancyCandidates),
        db.select().from(recruitmentActivity).where(eq(recruitmentActivity.organizationId, organizationId)).orderBy(desc(recruitmentActivity.createdAt)).limit(1000),
        db.select().from(recruitmentNotificationConfigs).where(eq(recruitmentNotificationConfigs.organizationId, organizationId)).orderBy(asc(recruitmentNotificationConfigs.eventKey)),
        db.select({ id: staff.id, userId: staff.userId, firstName: staff.firstName, lastName: staff.lastName, email: staff.email, phone: staff.phone }).from(staff)
          .innerJoin(schools, eq(staff.schoolId, schools.id)).where(eq(schools.organizationId, organizationId)).orderBy(asc(staff.firstName), asc(staff.lastName)),
        db.select().from(recruitmentTalentRankingLists).where(eq(recruitmentTalentRankingLists.organizationId, organizationId)).orderBy(asc(recruitmentTalentRankingLists.department), asc(recruitmentTalentRankingLists.subject)),
        db.select().from(recruitmentTalentRankings).where(eq(recruitmentTalentRankings.organizationId, organizationId)).orderBy(asc(recruitmentTalentRankings.department), asc(recruitmentTalentRankings.subject), asc(recruitmentTalentRankings.position)),
        db.select().from(recruitmentNotes).where(eq(recruitmentNotes.organizationId, organizationId)).orderBy(desc(recruitmentNotes.createdAt)).limit(2000),
        db.select({ name: subjects.name }).from(subjects).innerJoin(schools, eq(subjects.schoolId, schools.id)).where(eq(schools.organizationId, organizationId)).orderBy(asc(subjects.name)),
      ]);
      const notificationLogs = await db.select().from(recruitmentNotificationLogs)
        .where(eq(recruitmentNotificationLogs.organizationId, organizationId))
        .orderBy(desc(recruitmentNotificationLogs.createdAt)).limit(500);
      const automaticRejectedCount = canViewRejectedAttempts
        ? Number((await db.select({ count: sql<number>`count(*)::int` }).from(recruitmentRejectionAttempts).where(eq(recruitmentRejectionAttempts.organizationId, organizationId)))[0]?.count || 0)
        : 0;
      const visibleApplications = allApplications;
      const organizationVacancyIds = new Set(vacancies.map((vacancy) => vacancy.id));
      const visibleVacancyCandidates = vacancyCandidates.filter((candidate) => organizationVacancyIds.has(candidate.vacancyId));
      const applicationIds = visibleApplications.map((application) => application.id);
      const [answers, documents, history] = applicationIds.length ? await Promise.all([
        db.select().from(recruitmentApplicationAnswers).where(inArray(recruitmentApplicationAnswers.applicationId, applicationIds)),
        canViewDocuments
          ? db.select().from(recruitmentApplicationDocuments).where(and(inArray(recruitmentApplicationDocuments.applicationId, applicationIds), eq(recruitmentApplicationDocuments.isActive, true)))
          : Promise.resolve([]),
        db.select().from(recruitmentApplicationStatusHistory).where(inArray(recruitmentApplicationStatusHistory.applicationId, applicationIds)).orderBy(desc(recruitmentApplicationStatusHistory.changedAt)),
      ]) : [[], [], []];
      const visibleInterviews = interviews.filter((interview) => applicationIds.includes(interview.applicationId));
      const applications = visibleApplications.map((application) => {
        const applicationDocuments = documents.filter((document) => document.applicationId === application.id);
        const categoryCode = recruitmentCategoryCode(application.employmentCategory);
        const applicableRequested = categories.filter((category) => (
          category.isActive
          && category.isRequired
          && (category.vacancyId === application.vacancyId
            || (!category.vacancyId && category.employmentCategory === application.employmentCategory)
            || (!category.vacancyId && !category.employmentCategory))
        ));
        const expectedCodes = new Set<string>([
          ...applicableRequested.map((row) => row.code),
          ...coreRecruitmentDocumentRequirements(
            categoryCode,
            Boolean(application.holdsTeachingQualification),
            settings.primaryTeachingQualificationRequired,
          ).filter((row) => row.isRequired).map((row) => row.code),
        ]);
        const submittedCodes = new Set(applicationDocuments.map((document) => document.categoryCode));
        const missingCodes = Array.from(expectedCodes).filter((code) => !submittedCodes.has(code));
        return {
          ...application,
          examinationBoards: applicationExamBoards(application),
          answers: answers.filter((answer) => answer.applicationId === application.id),
          documents: applicationDocuments,
          documentCompleteness: {
            submitted: Array.from(expectedCodes).filter((code) => submittedCodes.has(code)).length,
            expected: expectedCodes.size,
            missingCodes,
            isComplete: missingCodes.length === 0,
          },
          notes: recruitmentNoteRows.filter((note) => note.applicationId === application.id),
          history: history.filter((item) => item.applicationId === application.id),
          interviews: visibleInterviews.filter((interview) => interview.applicationId === application.id),
          vacancy: vacancies.find((vacancy) => vacancy.id === application.vacancyId) || null,
          activity: activity.filter((item) => item.applicationId === application.id),
        };
      });
      const recruiterRejectionUserIds = Array.from(new Set(applications
        .filter((application: any) => application.status === "rejected")
        .map((application: any) => (application.history || []).find((item: any) => item.newStatus === "rejected")?.changedByUserId || application.reviewedByUserId)
        .filter((id: any) => Number(id) > 0)
        .map(Number)));
      const recruiterRejectionUsers = recruiterRejectionUserIds.length
        ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username }).from(users).where(inArray(users.id, recruiterRejectionUserIds))
        : [];
      const visibleExaminationBoardConfigs = examinationBoardConfigs.filter((row) => normalizeExamBoard(row.name) !== "Both");
      const automaticRejectedEntries = rejectionAttempts.map((attempt: any) => ({
        id: `automatic-${attempt.id}`,
        source: "automatic",
        applicationId: null,
        firstName: attempt.firstName,
        lastName: attempt.lastName,
        vacancyId: attempt.vacancyId,
        employmentCategory: attempt.employmentCategory,
        reasonCode: attempt.reasonCode,
        reason: null,
        failedRequirementCodes: Array.isArray(attempt.failedRequirementCodes) ? attempt.failedRequirementCodes : [],
        rejectedAt: attempt.attemptedAt,
        rejectedByUserId: null,
        rejectedByLabel: "Automatic screening",
      }));
      const recruiterRejectedEntries = applications.filter((application: any) => application.status === "rejected").map((application: any) => {
        const rejectionHistory = (application.history || []).find((item: any) => item.newStatus === "rejected");
        const rejectedByUserId = rejectionHistory?.changedByUserId || application.reviewedByUserId || null;
        const recruiter = rejectedByUserId ? recruiterRejectionUsers.find((row: any) => Number(row.id) === Number(rejectedByUserId)) : null;
        return {
          id: `recruiter-${application.id}`,
          source: "recruiter",
          applicationId: application.id,
          firstName: application.firstName,
          lastName: application.lastName,
          vacancyId: application.vacancyId,
          employmentCategory: application.employmentCategory,
          reasonCode: "recruiter_rejected",
          reason: rejectionHistory?.notes || null,
          failedRequirementCodes: [],
          rejectedAt: rejectionHistory?.changedAt || application.reviewedAt || application.updatedAt || application.submittedAt,
          rejectedByUserId,
          rejectedByLabel: recruiter ? (`${recruiter.firstName || ""} ${recruiter.lastName || ""}`.trim() || recruiter.username) : "Recruiter",
        };
      });
      const rejectedEntries = [...automaticRejectedEntries, ...recruiterRejectedEntries].sort((a: any, b: any) => new Date(b.rejectedAt || 0).getTime() - new Date(a.rejectedAt || 0).getTime());
      res.json({
        settings,
        schools: orgSchools,
        recruiters: recruiterStaff.filter((row) => row.userId),
        departments,
        examinationBoardConfigs: visibleExaminationBoardConfigs,
        examinationBoards: visibleExaminationBoardConfigs.filter((row) => row.isActive).map((row) => row.name),
        subjectCatalog: Array.from(new Set(subjectCatalogRows.map((row) => String(row.name || "").trim()).filter(Boolean))),
        talentRankingLists,
        talentRankings,
        vacancies,
        vacancyCandidates: visibleVacancyCandidates,
        activity,
        notificationConfigs,
        notificationLogs,
        requirements,
        documentCategories: categories,
        applications,
        rejectionAttempts,
        rejectedEntries,
        interviews: visibleInterviews,
        dashboard: {
          openVacancies: vacancies.filter((vacancy) => vacancy.status === "published").length,
          submitted: applications.filter((application) => application.status === "submitted").length,
          underReview: applications.filter((application) => application.status === "under_review").length,
          shortlisted: applications.filter((application) => application.status === "shortlisted").length,
          interviews: visibleInterviews.filter((interview) => new Date(interview.scheduledAt) >= new Date()).length,
          hired: applications.filter((application) => application.status === "hired").length,
          rejectedAttempts: automaticRejectedCount + recruiterRejectedEntries.length,
        },
      });
    } catch (error) { next(error); }
  });

  app.post("/api/recruitment/vacancies", requireAuth, requirePermission("recruitment.vacancies.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const input = vacancyInput.parse(req.body);
      if (input.schoolId) {
        const [school] = await db.select({ id: schools.id }).from(schools).where(and(eq(schools.id, input.schoolId), eq(schools.organizationId, organizationId))).limit(1);
        if (!school) return res.status(400).json({ message: "The selected school is outside your organization." });
      }
      const normalized = await normalizeVacancyForWrite(organizationId, input);
      const [created] = await db.insert(recruitmentVacancies).values({
        organizationId,
        ...normalized,
        schoolId: normalized.schoolId || null,
        locationText: normalized.locationText || null,
        opensAt: normalized.opensAt ? new Date(normalized.opensAt) : null,
        closesAt: normalized.closesAt ? new Date(normalized.closesAt) : null,
        publishedAt: normalized.status === "published" ? new Date() : null,
        createdByUserId: userOf(req)!.id,
      }).returning();
      const suggestionCount = await refreshVacancySuggestions(organizationId, created);
      await db.insert(recruitmentActivity).values({ organizationId, vacancyId: created.id, activityType: "vacancy_created", summary: `Vacancy created with ${suggestionCount} suggested existing candidate(s).`, actorUserId: userOf(req)!.id });
      res.status(201).json({ ...created, suggestionCount });
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/vacancies/:id", requireAuth, requirePermission("recruitment.vacancies.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const id = Number(req.params.id);
      const input = vacancyInput.parse(req.body);
      const [existing] = await db.select().from(recruitmentVacancies).where(and(eq(recruitmentVacancies.id, id), eq(recruitmentVacancies.organizationId, organizationId))).limit(1);
      if (!existing) return res.status(404).json({ message: "Vacancy not found" });
      if (input.schoolId) {
        const [school] = await db.select({ id: schools.id }).from(schools).where(and(eq(schools.id, input.schoolId), eq(schools.organizationId, organizationId))).limit(1);
        if (!school) return res.status(400).json({ message: "The selected school is outside your organization." });
      }
      const normalized = await normalizeVacancyForWrite(organizationId, input);
      const [updated] = await db.update(recruitmentVacancies).set({
        ...normalized,
        schoolId: normalized.schoolId || null,
        opensAt: normalized.opensAt ? new Date(normalized.opensAt) : null,
        closesAt: normalized.closesAt ? new Date(normalized.closesAt) : null,
        publishedAt: normalized.status === "published" ? existing.publishedAt || new Date() : existing.publishedAt,
        updatedAt: new Date(),
      }).where(eq(recruitmentVacancies.id, id)).returning();
      const suggestionCount = await refreshVacancySuggestions(organizationId, updated);
      await db.insert(recruitmentActivity).values({ organizationId, vacancyId: id, activityType: "vacancy_updated", summary: `Vacancy updated; ${suggestionCount} existing candidate(s) currently match.`, actorUserId: userOf(req)!.id });
      res.json({ ...updated, suggestionCount });
    } catch (error) { next(error); }
  });


  app.post("/api/recruitment/departments", requireAuth, requirePermission("recruitment.settings.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const input = departmentInput.parse(req.body);
      const normalizedName = normalizeRecruitmentDepartment(input.name);
      const [created] = await db.insert(recruitmentDepartments).values({
        organizationId,
        ...input,
        name: normalizedName,
        responsibleUserId: input.responsibleUserId || null,
        applicantContactPhone: input.applicantContactPhone || null,
        applicantContactEmail: input.applicantContactEmail || null,
      }).returning();
      res.status(201).json(created);
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/departments/:id", requireAuth, requirePermission("recruitment.settings.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const id = Number(req.params.id);
      const input = departmentInput.parse(req.body);
      const [updated] = await db.update(recruitmentDepartments).set({
        ...input,
        name: normalizeRecruitmentDepartment(input.name),
        responsibleUserId: input.responsibleUserId || null,
        applicantContactPhone: input.applicantContactPhone || null,
        applicantContactEmail: input.applicantContactEmail || null,
        updatedAt: new Date(),
      }).where(and(eq(recruitmentDepartments.id, id), eq(recruitmentDepartments.organizationId, organizationId))).returning();
      if (!updated) return res.status(404).json({ message: "Recruitment department not found." });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.post("/api/recruitment/examination-boards", requireAuth, requirePermission("recruitment.settings.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const input = examinationBoardInput.parse(req.body);
      if (input.name.trim().toLowerCase() === "both") return res.status(400).json({ message: '"Both" is a retired legacy value. Configure actual examination boards individually.' });
      const [duplicate] = await db.select({ id: recruitmentExaminationBoards.id }).from(recruitmentExaminationBoards).where(and(
        eq(recruitmentExaminationBoards.organizationId, organizationId),
        sql`lower(trim(${recruitmentExaminationBoards.name})) = lower(trim(${input.name}))`,
      )).limit(1);
      if (duplicate) return res.status(409).json({ message: "An examination board with this name already exists." });
      const [created] = await db.insert(recruitmentExaminationBoards).values({ organizationId, ...input, name: input.name.trim() }).returning();
      res.status(201).json(created);
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/examination-boards/:id", requireAuth, requirePermission("recruitment.settings.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const id = Number(req.params.id);
      const input = examinationBoardInput.parse(req.body);
      if (input.name.trim().toLowerCase() === "both") return res.status(400).json({ message: '"Both" is a retired legacy value. Configure actual examination boards individually.' });
      const [duplicate] = await db.select({ id: recruitmentExaminationBoards.id }).from(recruitmentExaminationBoards).where(and(
        eq(recruitmentExaminationBoards.organizationId, organizationId),
        sql`lower(trim(${recruitmentExaminationBoards.name})) = lower(trim(${input.name}))`,
        sql`${recruitmentExaminationBoards.id} <> ${id}`,
      )).limit(1);
      if (duplicate) return res.status(409).json({ message: "An examination board with this name already exists." });
      if (!input.isActive) {
        const active = await db.select({ id: recruitmentExaminationBoards.id }).from(recruitmentExaminationBoards).where(and(
          eq(recruitmentExaminationBoards.organizationId, organizationId),
          eq(recruitmentExaminationBoards.isActive, true),
        ));
        if (active.length <= 1 && active.some((row) => row.id === id)) return res.status(400).json({ message: "At least one examination board must remain active." });
      }
      const [updated] = await db.update(recruitmentExaminationBoards).set({ ...input, name: input.name.trim(), updatedAt: new Date() }).where(and(
        eq(recruitmentExaminationBoards.id, id),
        eq(recruitmentExaminationBoards.organizationId, organizationId),
      )).returning();
      if (!updated) return res.status(404).json({ message: "Examination board not found." });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/notification-configs/:id", requireAuth, requirePermission("recruitment.settings.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const id = Number(req.params.id);
      const input = notificationConfigInput.parse(req.body);
      const [updated] = await db.update(recruitmentNotificationConfigs).set({
        ...input,
        emailSubject: input.emailSubject || null,
        emailTemplate: input.emailTemplate || null,
        smsTemplate: input.smsTemplate || null,
        updatedAt: new Date(),
      }).where(and(eq(recruitmentNotificationConfigs.id, id), eq(recruitmentNotificationConfigs.organizationId, organizationId))).returning();
      if (!updated) return res.status(404).json({ message: "Notification configuration not found." });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.post("/api/recruitment/notification-configs", requireAuth, requirePermission("recruitment.settings.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const input = notificationConfigInput.parse(req.body);
      const [saved] = await db.insert(recruitmentNotificationConfigs).values({
        organizationId,
        ...input,
        emailSubject: input.emailSubject || null,
        emailTemplate: input.emailTemplate || null,
        smsTemplate: input.smsTemplate || null,
      }).onConflictDoUpdate({
        target: [recruitmentNotificationConfigs.organizationId, recruitmentNotificationConfigs.eventKey, recruitmentNotificationConfigs.applicationVariant],
        set: {
          enabled: input.enabled,
          channel: input.channel,
          emailSubject: input.emailSubject || null,
          emailTemplate: input.emailTemplate || null,
          smsTemplate: input.smsTemplate || null,
          updatedAt: new Date(),
        },
      }).returning();
      res.json(saved);
    } catch (error) { next(error); }
  });

  app.post("/api/recruitment/notification-logs/:id/resend", requireAuth, requirePermission("recruitment.applications.process"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const id = Number(req.params.id);
      const [log] = await db.select().from(recruitmentNotificationLogs).where(and(
        eq(recruitmentNotificationLogs.id, id),
        eq(recruitmentNotificationLogs.organizationId, organizationId),
      )).limit(1);
      if (!log || !log.applicationId || !["email", "sms"].includes(log.channel)) {
        return res.status(404).json({ message: "Notification attempt not found." });
      }
      const [application] = await db.select().from(recruitmentApplications).where(and(
        eq(recruitmentApplications.id, log.applicationId),
        eq(recruitmentApplications.organizationId, organizationId),
      )).limit(1);
      if (!application) return res.status(404).json({ message: "Application not found." });
      const interview = log.interviewId
        ? await db.select().from(recruitmentInterviews).where(eq(recruitmentInterviews.id, log.interviewId)).limit(1).then((rows) => rows[0] || null)
        : null;
      const vacancy = log.vacancyId
        ? await db.select().from(recruitmentVacancies).where(and(eq(recruitmentVacancies.id, log.vacancyId), eq(recruitmentVacancies.organizationId, organizationId))).limit(1).then((rows) => rows[0] || null)
        : null;
      const result = await sendRecruitmentNotification({
        organizationId,
        application,
        eventKey: log.eventKey,
        sentByUserId: userOf(req)!.id,
        interview,
        vacancy,
        channelOverride: log.channel as "email" | "sms",
      });
      await db.insert(recruitmentActivity).values({
        organizationId,
        applicationId: application.id,
        vacancyId: log.vacancyId || application.vacancyId || null,
        activityType: "notification_resent",
        summary: `${log.channel.toUpperCase()} recruitment notification resent.`,
        details: { originalNotificationLogId: log.id, eventKey: log.eventKey },
        actorUserId: userOf(req)!.id,
      });
      res.json(result);
    } catch (error) { next(error); }
  });

  app.post("/api/recruitment/vacancies/:vacancyId/refresh-suggestions", requireAuth, requirePermission("recruitment.applications.process"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const vacancyId = Number(req.params.vacancyId);
      const [vacancy] = await db.select().from(recruitmentVacancies).where(and(
        eq(recruitmentVacancies.id, vacancyId),
        eq(recruitmentVacancies.organizationId, organizationId),
      )).limit(1);
      if (!vacancy) return res.status(404).json({ message: "Vacancy not found." });
      const suggestionCount = await refreshVacancySuggestions(organizationId, vacancy);
      res.json({ suggestionCount });
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/vacancies/:vacancyId/candidates/:applicationId", requireAuth, requirePermission("recruitment.applications.process"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const vacancyId = Number(req.params.vacancyId);
      const applicationId = Number(req.params.applicationId);
      const input = z.object({ stage: z.enum(["shortlisted", "final"]) }).parse(req.body);
      const [[vacancy], [application]] = await Promise.all([
        db.select().from(recruitmentVacancies).where(and(eq(recruitmentVacancies.id, vacancyId), eq(recruitmentVacancies.organizationId, organizationId))).limit(1),
        db.select().from(recruitmentApplications).where(and(eq(recruitmentApplications.id, applicationId), eq(recruitmentApplications.organizationId, organizationId))).limit(1),
      ]);
      if (!vacancy || !application) return res.status(404).json({ message: "Vacancy or candidate not found." });
      if (application.status === "rejected") return res.status(400).json({ message: "Rejected applications cannot be considered for vacancies." });
      const directApplication = application.vacancyId === vacancyId;
      const match = applicationMatchesVacancy(application, vacancy);
      if (!directApplication && !match.matched) return res.status(400).json({ message: "This candidate no longer satisfies the vacancy matching criteria." });

      const [existing] = await db.select().from(recruitmentVacancyCandidates).where(and(
        eq(recruitmentVacancyCandidates.vacancyId, vacancyId),
        eq(recruitmentVacancyCandidates.applicationId, applicationId),
      )).limit(1);
      if (input.stage === "final" && (!existing || !["shortlisted", "final"].includes(existing.stage))) {
        return res.status(400).json({ message: "Shortlist the candidate before adding them to Final Ranking." });
      }
      let finalRank: number | null = existing?.finalRank ?? null;
      if (input.stage === "final" && existing?.stage !== "final") {
        const finalRows = await db.select().from(recruitmentVacancyCandidates).where(and(
          eq(recruitmentVacancyCandidates.vacancyId, vacancyId),
          eq(recruitmentVacancyCandidates.stage, "final"),
        ));
        finalRank = finalRows.length + 1;
      }
      const [saved] = await db.insert(recruitmentVacancyCandidates).values({
        vacancyId,
        applicationId,
        stage: input.stage,
        matchReasons: directApplication ? ["Direct Vacancy Application"] : match.reasons,
        finalRank: input.stage === "final" ? finalRank : null,
        shortlistedAt: input.stage === "shortlisted" ? (existing?.shortlistedAt || new Date()) : (existing?.shortlistedAt || new Date()),
        rankedAt: input.stage === "final" ? new Date() : null,
      }).onConflictDoUpdate({
        target: [recruitmentVacancyCandidates.vacancyId, recruitmentVacancyCandidates.applicationId],
        set: {
          stage: input.stage,
          matchReasons: directApplication ? ["Direct Vacancy Application"] : match.reasons,
          finalRank: input.stage === "final" ? finalRank : null,
          shortlistedAt: existing?.shortlistedAt || new Date(),
          rankedAt: input.stage === "final" ? new Date() : null,
          updatedAt: new Date(),
        },
      }).returning();
      await db.insert(recruitmentActivity).values({
        organizationId,
        applicationId,
        vacancyId,
        activityType: input.stage === "final" ? "candidate_added_to_final_ranking" : "candidate_shortlisted_for_vacancy",
        summary: input.stage === "final" ? "Candidate added to Final Ranking." : "Candidate added to vacancy shortlist.",
        actorUserId: userOf(req)!.id,
      });
      await db.transaction(async (tx) => syncApplicationTalentRankings(tx, organizationId, applicationId, { actorUserId: userOf(req)!.id, reason: "vacancy_shortlisted" }));
      res.json(saved);
    } catch (error) { next(error); }
  });

  app.delete("/api/recruitment/vacancies/:vacancyId/candidates/:applicationId", requireAuth, requirePermission("recruitment.applications.process"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const vacancyId = Number(req.params.vacancyId);
      const applicationId = Number(req.params.applicationId);
      const [vacancy] = await db.select({ id: recruitmentVacancies.id }).from(recruitmentVacancies).where(and(
        eq(recruitmentVacancies.id, vacancyId),
        eq(recruitmentVacancies.organizationId, organizationId),
      )).limit(1);
      if (!vacancy) return res.status(404).json({ message: "Vacancy not found." });
      await db.delete(recruitmentVacancyCandidates).where(and(
        eq(recruitmentVacancyCandidates.vacancyId, vacancyId),
        eq(recruitmentVacancyCandidates.applicationId, applicationId),
      ));
      await db.insert(recruitmentActivity).values({
        organizationId, applicationId, vacancyId, activityType: "candidate_removed_from_vacancy",
        summary: "Candidate removed from the vacancy shortlist/final ranking.", actorUserId: userOf(req)!.id,
      });
      await db.transaction(async (tx) => syncApplicationTalentRankings(tx, organizationId, applicationId, { actorUserId: userOf(req)!.id, reason: "vacancy_shortlist_removed" }));
      const [vacancyRow] = await db.select().from(recruitmentVacancies).where(eq(recruitmentVacancies.id, vacancyId)).limit(1);
      if (vacancyRow) await refreshVacancySuggestions(organizationId, vacancyRow);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/vacancies/:vacancyId/final-ranking", requireAuth, requirePermission("recruitment.applications.process"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const vacancyId = Number(req.params.vacancyId);
      const input = z.object({ applicationIds: z.array(z.coerce.number().int().positive()).max(500) }).parse(req.body);
      const uniqueIds = Array.from(new Set(input.applicationIds));
      if (uniqueIds.length !== input.applicationIds.length) return res.status(400).json({ message: "Final Ranking contains duplicate candidates." });
      const [vacancy] = await db.select({ id: recruitmentVacancies.id }).from(recruitmentVacancies).where(and(
        eq(recruitmentVacancies.id, vacancyId),
        eq(recruitmentVacancies.organizationId, organizationId),
      )).limit(1);
      if (!vacancy) return res.status(404).json({ message: "Vacancy not found." });

      const finalRows = await db.select().from(recruitmentVacancyCandidates).where(and(
        eq(recruitmentVacancyCandidates.vacancyId, vacancyId),
        eq(recruitmentVacancyCandidates.stage, "final"),
      ));
      const finalIds = new Set(finalRows.map((row) => row.applicationId));
      if (uniqueIds.some((id) => !finalIds.has(id)) || finalRows.length !== uniqueIds.length) {
        return res.status(400).json({ message: "Final Ranking can only reorder candidates already added to Final Ranking." });
      }
      const rankedApplications = uniqueIds.length
        ? await db.select({ id: recruitmentApplications.id, status: recruitmentApplications.status }).from(recruitmentApplications)
            .where(and(eq(recruitmentApplications.organizationId, organizationId), inArray(recruitmentApplications.id, uniqueIds)))
        : [];
      if (rankedApplications.some((application) => application.status === "rejected")) {
        return res.status(400).json({ message: "Rejected candidates cannot be ranked." });
      }
      await db.transaction(async (tx) => {
        for (let index = 0; index < uniqueIds.length; index += 1) {
          await tx.update(recruitmentVacancyCandidates).set({
            finalRank: index + 1,
            rankedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(
            eq(recruitmentVacancyCandidates.vacancyId, vacancyId),
            eq(recruitmentVacancyCandidates.applicationId, uniqueIds[index]),
            eq(recruitmentVacancyCandidates.stage, "final"),
          ));
        }
        await tx.insert(recruitmentActivity).values({
          organizationId, vacancyId, activityType: "final_ranking_updated",
          summary: `Final ranking updated for ${uniqueIds.length} candidate(s).`,
          details: { applicationIds: uniqueIds }, actorUserId: userOf(req)!.id,
        });
      });
      res.json({ applicationIds: uniqueIds });
    } catch (error) { next(error); }
  });

  app.post("/api/recruitment/requirements", requireAuth, requirePermission("recruitment.requirements.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const input = requirementInput.parse(req.body);
      const scopedVacancy = await validateVacancyScope(organizationId, input.vacancyId);
      const user = userOf(req)!;
      if (user.role !== "org_admin" && user.schoolId && (!scopedVacancy || scopedVacancy.schoolId !== user.schoolId)) {
        return res.status(403).json({ message: "School recruitment users may configure requirements only for vacancies at their own school." });
      }
      const [created] = await db.insert(recruitmentRequirements).values({
        organizationId,
        ...input,
        vacancyId: input.vacancyId || null,
        employmentCategory: input.employmentCategory || null,
        scopeKey: scopeKey(input.vacancyId, input.employmentCategory),
        minimumNumber: input.minimumNumber == null ? null : String(input.minimumNumber),
        maximumNumber: input.maximumNumber == null ? null : String(input.maximumNumber),
      }).returning();
      res.status(201).json(created);
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/requirements/:id", requireAuth, requirePermission("recruitment.requirements.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const id = Number(req.params.id);
      const input = requirementInput.parse(req.body);
      const scopedVacancy = await validateVacancyScope(organizationId, input.vacancyId);
      const user = userOf(req)!;
      if (user.role !== "org_admin" && user.schoolId && (!scopedVacancy || scopedVacancy.schoolId !== user.schoolId)) {
        return res.status(403).json({ message: "School recruitment users may configure requirements only for vacancies at their own school." });
      }
      const [updated] = await db.update(recruitmentRequirements).set({
        ...input,
        vacancyId: input.vacancyId || null,
        employmentCategory: input.employmentCategory || null,
        scopeKey: scopeKey(input.vacancyId, input.employmentCategory),
        minimumNumber: input.minimumNumber == null ? null : String(input.minimumNumber),
        maximumNumber: input.maximumNumber == null ? null : String(input.maximumNumber),
        updatedAt: new Date(),
      }).where(and(eq(recruitmentRequirements.id, id), eq(recruitmentRequirements.organizationId, organizationId))).returning();
      if (!updated) return res.status(404).json({ message: "Requirement not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.post("/api/recruitment/document-categories", requireAuth, requirePermission("recruitment.requirements.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const input = documentCategoryInput.parse(req.body);
      const scopedVacancy = await validateVacancyScope(organizationId, input.vacancyId);
      const user = userOf(req)!;
      if (user.role !== "org_admin" && user.schoolId && (!scopedVacancy || scopedVacancy.schoolId !== user.schoolId)) {
        return res.status(403).json({ message: "School recruitment users may configure document categories only for vacancies at their own school." });
      }
      const [created] = await db.insert(recruitmentDocumentCategories).values({
        organizationId,
        ...input,
        vacancyId: input.vacancyId || null,
        employmentCategory: input.employmentCategory || null,
        scopeKey: scopeKey(input.vacancyId, input.employmentCategory),
      }).returning();
      res.status(201).json(created);
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/document-categories/:id", requireAuth, requirePermission("recruitment.requirements.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const id = Number(req.params.id);
      const input = documentCategoryInput.parse(req.body);
      const scopedVacancy = await validateVacancyScope(organizationId, input.vacancyId);
      const user = userOf(req)!;
      if (user.role !== "org_admin" && user.schoolId && (!scopedVacancy || scopedVacancy.schoolId !== user.schoolId)) {
        return res.status(403).json({ message: "School recruitment users may configure document categories only for vacancies at their own school." });
      }
      const [updated] = await db.update(recruitmentDocumentCategories).set({
        ...input,
        vacancyId: input.vacancyId || null,
        employmentCategory: input.employmentCategory || null,
        scopeKey: scopeKey(input.vacancyId, input.employmentCategory),
        updatedAt: new Date(),
      }).where(and(eq(recruitmentDocumentCategories.id, id), eq(recruitmentDocumentCategories.organizationId, organizationId))).returning();
      if (!updated) return res.status(404).json({ message: "Document category not found" });
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/talent-rankings/order", requireAuth, requirePermission("recruitment.applications.process"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const input = z.object({
        department: z.string().trim().min(1).max(120),
        subject: z.string().trim().min(1).max(120),
        applicationIds: z.array(z.coerce.number().int().positive()).max(1000),
        expectedVersion: z.coerce.number().int().min(0),
      }).parse(req.body);
      const department = normalizeRecruitmentDepartment(input.department);
      const subject = normalizeSubjectList([input.subject])[0] || input.subject.trim();
      const uniqueIds = Array.from(new Set(input.applicationIds));
      if (uniqueIds.length !== input.applicationIds.length) return res.status(400).json({ message: "Talent ranking contains duplicate candidates." });
      const result = await db.transaction(async (tx) => {
        const list = await lockTalentRankingList(tx, organizationId, department, subject);
        if (Number(list.version || 0) !== input.expectedVersion) {
          throw Object.assign(new Error("This ranking has been updated by another user. Refresh before changing the order."), { status: 409, code: "RANKING_VERSION_CONFLICT", currentVersion: Number(list.version || 0) });
        }
        const rows = await tx.select().from(recruitmentTalentRankings).where(and(
          eq(recruitmentTalentRankings.organizationId, organizationId),
          eq(recruitmentTalentRankings.department, department),
          eq(recruitmentTalentRankings.subject, subject),
          eq(recruitmentTalentRankings.isActive, true),
        )).orderBy(asc(recruitmentTalentRankings.position));
        const currentIds = rows.map((row: any) => Number(row.applicationId));
        if (currentIds.length !== uniqueIds.length || currentIds.some((id: number) => !uniqueIds.includes(id))) {
          throw Object.assign(new Error("This ranking changed while you were viewing it. Refresh before changing the order."), { status: 409, code: "RANKING_MEMBERSHIP_CONFLICT", currentVersion: Number(list.version || 0) });
        }
        const oldPositions = new Map(rows.map((row: any) => [Number(row.applicationId), Number(row.position)]));
        for (let index = 0; index < uniqueIds.length; index += 1) {
          await tx.update(recruitmentTalentRankings).set({ position: index + 1, updatedAt: new Date() }).where(and(
            eq(recruitmentTalentRankings.organizationId, organizationId),
            eq(recruitmentTalentRankings.department, department),
            eq(recruitmentTalentRankings.subject, subject),
            eq(recruitmentTalentRankings.applicationId, uniqueIds[index]),
            eq(recruitmentTalentRankings.isActive, true),
          ));
        }
        const updatedList = await bumpTalentRankingVersion(tx, list.id);
        for (let index = 0; index < uniqueIds.length; index += 1) {
          const applicationId = uniqueIds[index];
          const previousPosition = oldPositions.get(applicationId);
          const nextPosition = index + 1;
          if (previousPosition === nextPosition) continue;
          await tx.insert(recruitmentActivity).values({
            organizationId,
            applicationId,
            activityType: "talent_ranking_reordered",
            summary: `${department} · ${subject}: ranking changed from #${previousPosition} to #${nextPosition}.`,
            details: { department, subject, previousPosition, nextPosition },
            actorUserId: userOf(req)!.id,
          });
        }
        return { version: Number(updatedList?.version || Number(list.version || 0) + 1) };
      });
      res.json(result);
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/applications/:id", requireAuth, requirePermission("recruitment.applications.process"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const id = Number(req.params.id);
      const input = z.object({
        status: z.enum(["submitted", "under_review", "shortlisted", "interview", "rejected", "hired", "withdrawn"]),
        recruiterNotes: optionalText,
        rejectionReason: optionalText,
        recruiterAssignedSubjects: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
        availabilityStatus: z.enum(["available", "contacted", "not_available", "hired", "withdrawn", "archived"]).optional(),
        availabilityNotes: optionalText,
        markContacted: z.boolean().optional(),
      }).parse(req.body);
      const [existing] = await db.select().from(recruitmentApplications).where(and(eq(recruitmentApplications.id, id), eq(recruitmentApplications.organizationId, organizationId))).limit(1);
      if (!existing || !canAccessApplication(userOf(req)!, existing)) return res.status(404).json({ message: "Application not found" });
      const userId = userOf(req)!.id;
      const statusChanged = existing.status !== input.status;
      const rejectionReason = input.rejectionReason?.trim() || null;
      if (statusChanged && input.status === "rejected" && !rejectionReason) {
        return res.status(400).json({ message: "Enter a rejection reason before rejecting this application." });
      }
      const [updated] = await db.transaction(async (tx) => {
        const [row] = await tx.update(recruitmentApplications).set({
          status: input.status,
          ...(input.recruiterNotes !== undefined ? { recruiterNotes: input.recruiterNotes || null } : {}),
          ...(input.recruiterAssignedSubjects ? { recruiterAssignedSubjects: normalizeSubjectList(input.recruiterAssignedSubjects) } : {}),
          ...(input.availabilityStatus ? { availabilityStatus: input.availabilityStatus } : {}),
          ...(input.availabilityNotes !== undefined ? { availabilityNotes: input.availabilityNotes || null } : {}),
          ...(input.markContacted ? { lastContactedAt: new Date(), availabilityStatus: input.availabilityStatus || "contacted" } : {}),
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(recruitmentApplications.id, id)).returning();
        if (statusChanged) {
          await tx.insert(recruitmentApplicationStatusHistory).values({
            applicationId: id,
            previousStatus: existing.status,
            newStatus: input.status,
            notes: input.status === "rejected" ? rejectionReason : (input.recruiterNotes || null),
            changedByUserId: userId,
            actorType: "staff",
            actorLabel: null,
          });
          await tx.insert(recruitmentActivity).values({
            organizationId, applicationId: id, vacancyId: row.vacancyId || null, activityType: "status_changed",
            summary: `Application status changed from ${existing.status} to ${input.status}.`,
            details: { previousStatus: existing.status, newStatus: input.status, ...(input.status === "rejected" ? { rejectionSource: "recruiter", rejectionReason } : {}) }, actorUserId: userId,
          });
        } else if (input.recruiterNotes !== undefined && input.recruiterNotes !== existing.recruiterNotes) {
          await tx.insert(recruitmentActivity).values({ organizationId, applicationId: id, vacancyId: row.vacancyId || null, activityType: "recruitment_note_updated", summary: "Recruitment notes updated.", actorUserId: userId });
        }
        if (["rejected", "hired", "withdrawn"].includes(input.status)) {
          await tx.delete(recruitmentVacancyCandidates).where(eq(recruitmentVacancyCandidates.applicationId, id));
        }
        await syncApplicationTalentRankings(tx, organizationId, id, {
          actorUserId: userId,
          reason: statusChanged ? `status_${input.status}` : input.recruiterAssignedSubjects ? "subjects_updated" : input.availabilityStatus ? `availability_${input.availabilityStatus}` : "candidate_updated",
        });
        return [row];
      });

      let notifications: any = null;
      if (statusChanged) {
        notifications = await sendRecruitmentNotification({ organizationId, application: updated, eventKey: `status:${input.status}`, sentByUserId: userId }).catch((error) => ({ error: String(error) }));
      }
      if (!["rejected", "hired", "withdrawn"].includes(input.status)) {
        const vacancies = await db.select().from(recruitmentVacancies).where(eq(recruitmentVacancies.organizationId, organizationId));
        await Promise.all(vacancies.map((vacancy) => refreshVacancySuggestions(organizationId, vacancy).catch(() => 0)));
      }
      res.json({ ...updated, notifications });
    } catch (error) { next(error); }
  });

  app.post("/api/recruitment/applications/:id/notes", requireAuth, requirePermission("recruitment.applications.process"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const applicationId = Number(req.params.id);
      const input = z.object({ note: z.string().trim().min(1).max(10000) }).parse(req.body);
      const [application] = await db.select().from(recruitmentApplications).where(and(
        eq(recruitmentApplications.id, applicationId),
        eq(recruitmentApplications.organizationId, organizationId),
      )).limit(1);
      if (!application || !canAccessApplication(userOf(req)!, application)) return res.status(404).json({ message: "Application not found" });
      const [created] = await db.insert(recruitmentNotes).values({
        organizationId,
        applicationId,
        note: input.note,
        authorUserId: userOf(req)!.id,
      }).returning();
      await db.insert(recruitmentActivity).values({
        organizationId,
        applicationId,
        vacancyId: application.vacancyId || null,
        activityType: "recruitment_note_added",
        summary: "Recruitment note added.",
        details: { noteId: created.id },
        actorUserId: userOf(req)!.id,
      });
      res.status(201).json(created);
    } catch (error) { next(error); }
  });

  app.post("/api/recruitment/applications/:id/interviews", requireAuth, requirePermission("recruitment.interviews.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const applicationId = Number(req.params.id);
      const input = z.object({
        scheduledAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
        location: optionalText,
        interviewType: z.enum(["in_person", "online", "phone"]).default("in_person"),
        panelUserIds: z.array(z.coerce.number().int().positive()).optional().default([]),
        applicantInstructions: optionalText,
        internalNotes: optionalText,
        interviewLink: optionalText,
        outcome: optionalText,
      }).parse(req.body);
      const [application] = await db.select().from(recruitmentApplications).where(and(eq(recruitmentApplications.id, applicationId), eq(recruitmentApplications.organizationId, organizationId))).limit(1);
      if (!application || !canAccessApplication(userOf(req)!, application)) return res.status(404).json({ message: "Application not found" });
      const [created] = await db.insert(recruitmentInterviews).values({
        applicationId, scheduledAt: new Date(input.scheduledAt), location: input.location || null, interviewType: input.interviewType,
        panelUserIds: input.panelUserIds, applicantInstructions: input.applicantInstructions || null, internalNotes: input.internalNotes || null,
        interviewLink: input.interviewLink || null, status: "scheduled", outcome: input.outcome || null, createdByUserId: userOf(req)!.id,
      }).returning();
      await db.insert(recruitmentActivity).values({ organizationId, applicationId, vacancyId: application.vacancyId || null, activityType: "interview_scheduled", summary: `Interview scheduled for ${new Date(created.scheduledAt).toLocaleString("en-GB")}.`, actorUserId: userOf(req)!.id });
      const notifications = await sendRecruitmentNotification({ organizationId, application, eventKey: "interview_scheduled", interview: created, sentByUserId: userOf(req)!.id }).catch((error) => ({ error: String(error) }));
      res.status(201).json({ ...created, notifications });
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/settings", requireAuth, requirePermission("recruitment.settings.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const user = userOf(req)!;
      if (user.role !== "org_admin" && user.schoolId) {
        return res.status(403).json({ message: "Recruitment settings are managed at organization level." });
      }
      const input = settingsInput.parse(req.body);
      const [updated] = await db.insert(recruitmentSettings).values({ organizationId, ...input }).onConflictDoUpdate({
        target: recruitmentSettings.organizationId,
        set: { ...input, updatedAt: new Date() },
      }).returning();
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.post("/api/recruitment/applications/:id/documents", requireAuth, requirePermission("recruitment.documents.manage"), upload.single("file"), async (req, res, next) => {
    let savedKey: string | null = null;
    try {
      const organizationId = await organizationForUser(req);
      const applicationId = Number(req.params.id);
      const file = req.file;
      if (!file) return res.status(400).json({ message: "Select a document" });
      const categoryCode = String(req.body?.categoryCode || "other").trim().toLowerCase();
      const [application, settings] = await Promise.all([
        db.select().from(recruitmentApplications).where(and(eq(recruitmentApplications.id, applicationId), eq(recruitmentApplications.organizationId, organizationId))).limit(1).then((rows) => rows[0]),
        ensureSettings(organizationId),
      ]);
      if (!application || !canAccessApplication(userOf(req)!, application)) return res.status(404).json({ message: "Application not found" });
      if (file.size > settings.attachmentSizeLimitMB * 1024 * 1024) {
        return res.status(413).json({ message: `Each attachment must be ${settings.attachmentSizeLimitMB} MB or smaller.` });
      }
      const [category] = await db.select().from(recruitmentDocumentCategories).where(and(
        eq(recruitmentDocumentCategories.organizationId, organizationId),
        eq(recruitmentDocumentCategories.code, categoryCode),
        eq(recruitmentDocumentCategories.isActive, true),
        or(
          eq(recruitmentDocumentCategories.vacancyId, application.vacancyId || -1),
          eq(recruitmentDocumentCategories.scopeKey, scopeKey(null, application.employmentCategory)),
          eq(recruitmentDocumentCategories.scopeKey, scopeKey(null, null)),
        ),
      )).limit(1);
      if (!category && categoryCode !== "other") return res.status(400).json({ message: "Unknown document category" });
      const saved = await savePrivateBuffer({ namespace: "recruitment", scopeId: applicationId, originalName: file.originalname, mimeType: file.mimetype, buffer: file.buffer });
      savedKey = saved.storageKey;
      const [created] = await db.insert(recruitmentApplicationDocuments).values({ applicationId, categoryCode, ...saved }).returning();
      res.status(201).json(created);
    } catch (error) {
      if (savedKey) await deletePrivateFile(savedKey).catch(() => undefined);
      next(error);
    }
  });

  app.put("/api/recruitment/documents/:id/review", requireAuth, requirePermission("recruitment.documents.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const documentId = Number(req.params.id);
      const input = z.object({ reviewStatus: z.enum(["verified", "needs_attention", "rejected"]).nullable().optional(), reviewNotes: optionalText }).parse(req.body);
      const [document] = await db.select({ id: recruitmentApplicationDocuments.id, organizationId: recruitmentApplications.organizationId, schoolId: recruitmentApplications.schoolId, preferredSchoolIds: recruitmentApplications.preferredSchoolIds }).from(recruitmentApplicationDocuments).innerJoin(recruitmentApplications, eq(recruitmentApplications.id, recruitmentApplicationDocuments.applicationId)).where(eq(recruitmentApplicationDocuments.id, documentId)).limit(1);
      if (!document || document.organizationId !== organizationId || !canAccessApplication(userOf(req)!, document)) return res.status(404).json({ message: "Document not found" });
      const [updated] = await db.update(recruitmentApplicationDocuments).set({ reviewStatus: input.reviewStatus || null, reviewNotes: input.reviewNotes || null, reviewedByUserId: input.reviewStatus ? userOf(req)!.id : null, reviewedAt: input.reviewStatus ? new Date() : null }).where(eq(recruitmentApplicationDocuments.id, documentId)).returning();
      res.json(updated);
    } catch (error) { next(error); }
  });

  app.delete("/api/recruitment/documents/:id", requireAuth, requirePermission("recruitment.documents.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const documentId = Number(req.params.id);
      const [document] = await db.select({
        id: recruitmentApplicationDocuments.id,
        organizationId: recruitmentApplications.organizationId,
        schoolId: recruitmentApplications.schoolId,
        preferredSchoolIds: recruitmentApplications.preferredSchoolIds,
      }).from(recruitmentApplicationDocuments)
        .innerJoin(recruitmentApplications, eq(recruitmentApplications.id, recruitmentApplicationDocuments.applicationId))
        .where(eq(recruitmentApplicationDocuments.id, documentId)).limit(1);
      if (!document || document.organizationId !== organizationId || !canAccessApplication(userOf(req)!, document)) return res.status(404).json({ message: "Document not found" });
      await db.update(recruitmentApplicationDocuments).set({ isActive: false, archivedAt: new Date() }).where(eq(recruitmentApplicationDocuments.id, documentId));
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/interviews/:id", requireAuth, requirePermission("recruitment.interviews.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const interviewId = Number(req.params.id);
      const input = z.object({
        scheduledAt: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
        location: optionalText,
        interviewType: z.enum(["in_person", "online", "phone"]).optional(),
        panelUserIds: z.array(z.coerce.number().int().positive()).optional(),
        applicantInstructions: optionalText, internalNotes: optionalText, interviewLink: optionalText,
        status: z.enum(["scheduled", "completed", "cancelled"]).optional(), outcome: optionalText,
      }).parse(req.body);
      const [existing] = await db.select({
        id: recruitmentInterviews.id, applicationId: recruitmentInterviews.applicationId, scheduledAt: recruitmentInterviews.scheduledAt,
        status: recruitmentInterviews.status, schoolId: recruitmentApplications.schoolId, preferredSchoolIds: recruitmentApplications.preferredSchoolIds,
      }).from(recruitmentInterviews).innerJoin(recruitmentApplications, eq(recruitmentApplications.id, recruitmentInterviews.applicationId))
        .where(and(eq(recruitmentInterviews.id, interviewId), eq(recruitmentApplications.organizationId, organizationId))).limit(1);
      if (!existing || !canAccessApplication(userOf(req)!, existing)) return res.status(404).json({ message: "Interview not found" });
      const [updated] = await db.update(recruitmentInterviews).set({
        ...(input.scheduledAt ? { scheduledAt: new Date(input.scheduledAt) } : {}), ...(input.location !== undefined ? { location: input.location || null } : {}),
        ...(input.interviewType ? { interviewType: input.interviewType } : {}), ...(input.panelUserIds ? { panelUserIds: input.panelUserIds } : {}),
        ...(input.applicantInstructions !== undefined ? { applicantInstructions: input.applicantInstructions || null } : {}),
        ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes || null } : {}), ...(input.interviewLink !== undefined ? { interviewLink: input.interviewLink || null } : {}),
        ...(input.status ? { status: input.status } : {}), ...(input.outcome !== undefined ? { outcome: input.outcome || null } : {}), updatedAt: new Date(),
      }).where(eq(recruitmentInterviews.id, interviewId)).returning();
      const [application] = await db.select().from(recruitmentApplications).where(eq(recruitmentApplications.id, existing.applicationId)).limit(1);
      let eventKey: string | null = null;
      if (input.status === "cancelled" && existing.status !== "cancelled") eventKey = "interview_cancelled";
      else if (input.scheduledAt || input.location !== undefined || input.interviewType || input.interviewLink !== undefined) eventKey = "interview_rescheduled";
      let notifications: any = null;
      if (application && eventKey) {
        await db.insert(recruitmentActivity).values({ organizationId, applicationId: application.id, vacancyId: application.vacancyId || null, activityType: eventKey, summary: eventKey === "interview_cancelled" ? "Interview cancelled." : "Interview rescheduled or updated.", actorUserId: userOf(req)!.id });
        notifications = await sendRecruitmentNotification({ organizationId, application, eventKey, interview: updated, sentByUserId: userOf(req)!.id }).catch((error) => ({ error: String(error) }));
      }
      res.json({ ...updated, notifications });
    } catch (error) { next(error); }
  });

  app.get("/api/recruitment/documents/:id", requireAuth, requireAnyPermission("recruitment.documents.view", "recruitment.documents.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const documentId = Number(req.params.id);
      const [document] = await db.select({
        id: recruitmentApplicationDocuments.id,
        storageKey: recruitmentApplicationDocuments.storageKey,
        originalName: recruitmentApplicationDocuments.originalName,
        mimeType: recruitmentApplicationDocuments.mimeType,
        organizationId: recruitmentApplications.organizationId,
        schoolId: recruitmentApplications.schoolId,
        preferredSchoolIds: recruitmentApplications.preferredSchoolIds,
      }).from(recruitmentApplicationDocuments)
        .innerJoin(recruitmentApplications, eq(recruitmentApplications.id, recruitmentApplicationDocuments.applicationId))
        .where(and(eq(recruitmentApplicationDocuments.id, documentId), eq(recruitmentApplicationDocuments.isActive, true)))
        .limit(1);
      if (!document || document.organizationId !== organizationId || !canAccessApplication(userOf(req)!, document)) return res.status(404).json({ message: "Document not found" });
      await streamPrivateFile({
        res,
        storageKey: document.storageKey,
        mimeType: document.mimeType,
        originalName: document.originalName,
        disposition: req.query.inline === "1" ? "inline" : "attachment",
      });
    } catch (error) { next(error); }
  });
}
