import type { Express, Request, Response } from "express";
import multer from "multer";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requireAuth, requireAnyPermission, requirePermission } from "./auth";
import { deletePrivateFile, savePrivateBuffer, streamPrivateFile } from "./private-files";
import { evaluateHighSchoolEligibility, evaluateRecruitmentRequirement, publicHighSchoolEligibilityPolicy } from "./recruitment-screening";
import {
  RECRUITMENT_CATEGORY_LABELS,
  RECRUITMENT_CATEGORIES,
  coreRecruitmentDocumentRequirements,
  isSupportedRecruitmentCategory,
  isHighSchoolCoreRequirementDefinition,
  recruitmentCategoryCode,
} from "@shared/recruitment";
import {
  organizations,
  recruitmentApplicationAnswers,
  recruitmentApplicationDocuments,
  recruitmentApplications,
  recruitmentApplicationStatusHistory,
  recruitmentDocumentCategories,
  recruitmentInterviews,
  recruitmentRejectionAttempts,
  recruitmentRequirements,
  recruitmentSettings,
  recruitmentVacancies,
  schools,
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
const optionalText = z.string().trim().optional().nullable();
const nullablePositiveInt = z.coerce.number().int().positive().optional().nullable();
const isoDateTime = z.string().datetime({ offset: true }).or(z.string().datetime()).optional().nullable();

const vacancyInput = z.object({
  schoolId: nullablePositiveInt,
  code: z.string().trim().min(2).max(30).transform((value) => value.toUpperCase()),
  title: z.string().trim().min(2),
  employmentCategory: z.enum(RECRUITMENT_CATEGORY_LABELS),
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

const publicApplicationInput = z.object({
  organizationId: z.coerce.number().int().positive(),
  vacancyId: nullablePositiveInt,
  applicationType: z.enum(["vacancy", "general"]),
  employmentCategory: z.enum(RECRUITMENT_CATEGORY_LABELS),
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
}).superRefine((value, ctx) => {
  if (value.highSchoolTeachingQualifiedMinimumALevelPoints > value.highSchoolMinimumALevelPoints) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["highSchoolTeachingQualifiedMinimumALevelPoints"], message: "The teaching-qualified minimum cannot exceed the standard A-Level minimum." });
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


function canAccessApplication(user: AuthedUser, application: Pick<typeof recruitmentApplications.$inferSelect, "schoolId" | "preferredSchoolIds">): boolean {
  if (user.role === "org_admin" || !user.schoolId) return true;
  if (application.schoolId === user.schoolId) return true;
  return Array.isArray(application.preferredSchoolIds) && application.preferredSchoolIds.includes(user.schoolId);
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

async function ensureSettings(organizationId: number) {
  const [existing] = await db.select().from(recruitmentSettings).where(eq(recruitmentSettings.organizationId, organizationId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(recruitmentSettings).values({ organizationId }).returning();
  return created;
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
  await ensureRecruitmentDocumentCategories(organization.id);
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
  const orgSchools = await db.select({ id: schools.id, name: schools.name, shortCode: schools.shortCode }).from(schools)
    .where(eq(schools.organizationId, organization.id)).orderBy(asc(schools.name));
  return {
    organization: { id: organization.id, name: organization.name, logo: organization.logo },
    settings,
    vacancies: openVacancies,
    requirements: activeRequirements,
    documentCategories: categories,
    schools: orgSchools,
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
    highSchoolEligibility: publicHighSchoolEligibilityPolicy({
      maxAge: context.settings.highSchoolMaxAge,
      minimumALevelPoints: context.settings.highSchoolMinimumALevelPoints,
      teachingQualifiedMinimumALevelPoints: context.settings.highSchoolTeachingQualifiedMinimumALevelPoints,
      teachingQualificationExceptionEnabled: context.settings.highSchoolTeachingQualificationExceptionEnabled,
    }),
    requirements: context.requirements.map(({ alternativePassKeywords: _keywords, alternativePassNote: _note, ...requirement }) => requirement),
  };
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

      const normalizedEmail = normalizeEmail(input.email);
      const normalizedPhone = normalizePhone(input.phone);
      const normalizedNationalId = normalizeNationalId(input.nationalId);
      const isHighSchoolApplication = recruitmentCategoryCode(input.employmentCategory) === "high_school_teaching";
      const applicableRequirements = context.requirements.filter((requirement) => {
        const inScope = requirement.vacancyId === input.vacancyId
          || (!requirement.vacancyId && requirement.employmentCategory === input.employmentCategory)
          || (!requirement.vacancyId && !requirement.employmentCategory);
        if (!inScope) return false;
        // Age, A-Level points and teaching-qualification eligibility are server-managed for High School.
        // Legacy generic rows for those rules are intentionally ignored to avoid double-screening.
        return !isHighSchoolApplication || !isHighSchoolCoreRequirementDefinition(requirement);
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

      const categoryCode = recruitmentCategoryCode(input.employmentCategory);
      if (!categoryCode) return res.status(400).json({ message: "Select a valid employment category." });
      const coreDocuments = coreRecruitmentDocumentRequirements(categoryCode, input.holdsTeachingQualification);
      const coreDocumentCodes = new Set(coreDocuments.map((document) => document.code));
      const missingCoreDocuments = coreDocuments.filter((document) => document.isRequired && !submittedCategoryCodes.includes(document.code));
      const missingRequiredDocuments = applicableCategories.filter((category) => category.isRequired && !submittedCategoryCodes.includes(category.code));

      const highSchoolEligibility = categoryCode === "high_school_teaching"
        ? evaluateHighSchoolEligibility({
            dateOfBirth: input.dateOfBirth,
            aLevelResults: input.aLevelResults,
            holdsTeachingQualification: input.holdsTeachingQualification,
            teachingCertificateUploaded: submittedCategoryCodes.includes("teaching_certificate"),
            policy: {
              maxAge: context.settings.highSchoolMaxAge,
              minimumALevelPoints: context.settings.highSchoolMinimumALevelPoints,
              teachingQualifiedMinimumALevelPoints: context.settings.highSchoolTeachingQualifiedMinimumALevelPoints,
              teachingQualificationExceptionEnabled: context.settings.highSchoolTeachingQualificationExceptionEnabled,
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
      const preferredSchoolIds = input.preferredSchoolIds.filter((id) => context.schools.some((school) => school.id === id));
      if (missingRequiredDocuments.length) failedCodes.push(...missingRequiredDocuments.map((category) => `document:${category.code}`));
      if (missingCoreDocuments.length) failedCodes.push(...missingCoreDocuments.map((document) => document.reasonCode));
      if (highSchoolEligibility && !highSchoolEligibility.passed) failedCodes.push(...highSchoolEligibility.failedCodes);

      const lockKey = `${input.organizationId}|${normalizedEmail}|${normalizedPhone}|${normalizedNationalId}`;
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
        const [duplicate] = await tx.select({ id: recruitmentApplications.id }).from(recruitmentApplications).where(and(
          eq(recruitmentApplications.organizationId, input.organizationId),
          or(
            eq(recruitmentApplications.normalizedEmail, normalizedEmail),
            eq(recruitmentApplications.normalizedPhone, normalizedPhone),
            eq(recruitmentApplications.normalizedNationalId, normalizedNationalId),
          ),
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
              holdsTeachingQualification: input.holdsTeachingQualification,
              preferredSchoolIds,
            },
          });
          return { rejected: true as const, reason: "criteria_failed" as const };
        }

        const [application] = await tx.insert(recruitmentApplications).values({
          organizationId: input.organizationId,
          schoolId: vacancy?.schoolId || (preferredSchoolIds.length === 1 ? preferredSchoolIds[0] : null),
          vacancyId: input.vacancyId || null,
          applicationType: input.applicationType,
          employmentCategory: input.employmentCategory,
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
          aLevelResults: input.aLevelResults,
          aLevelPoints: highSchoolEligibility?.aLevelPoints ?? null,
          holdsTeachingQualification: input.holdsTeachingQualification,
          eligibilityRoute: highSchoolEligibility?.route || "configured_requirements",
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
          notes: "Application submitted through the public Careers page.",
          changedByUserId: null,
          actorType: "applicant",
          actorLabel: `${input.firstName} ${input.lastName}`.trim(),
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
        return res.status(422).json({
          message: "This application could not be accepted. Please review the vacancy requirements or contact the recruitment office.",
          code: "APPLICATION_NOT_ACCEPTED",
        });
      }
      return res.status(201).json({
        message: "Your application has been submitted successfully.",
        reference: `REC-${String(result.applicationId).padStart(6, "0")}`,
      });
    } catch (error) {
      await Promise.all(savedKeys.map((key) => deletePrivateFile(key)));
      next(error);
    }
  });

  app.get("/api/recruitment/bootstrap", requireAuth, requirePermission("recruitment.view"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const user = userOf(req)!;
      const settings = await ensureSettings(organizationId);
      await ensureRecruitmentDocumentCategories(organizationId);
      const [canViewRejectedAttempts, canViewDocuments] = await Promise.all([
        (user.role === "org_admin" || !user.schoolId)
          ? userHasRecruitmentPermission(user.id, "recruitment.rejected_attempts.view")
          : Promise.resolve(false),
        userHasRecruitmentPermission(user.id, "recruitment.documents.view")
          .then(async (allowed) => allowed || userHasRecruitmentPermission(user.id, "recruitment.documents.manage")),
      ]);
      const [orgSchools, vacancies, requirements, categories, allApplications, rejectionAttempts, interviews] = await Promise.all([
        db.select({ id: schools.id, name: schools.name, shortCode: schools.shortCode }).from(schools).where(eq(schools.organizationId, organizationId)).orderBy(asc(schools.name)),
        db.select().from(recruitmentVacancies).where(eq(recruitmentVacancies.organizationId, organizationId)).orderBy(desc(recruitmentVacancies.createdAt)),
        db.select().from(recruitmentRequirements).where(eq(recruitmentRequirements.organizationId, organizationId)).orderBy(asc(recruitmentRequirements.displayOrder)),
        db.select().from(recruitmentDocumentCategories).where(eq(recruitmentDocumentCategories.organizationId, organizationId)).orderBy(asc(recruitmentDocumentCategories.displayOrder)),
        db.select().from(recruitmentApplications).where(eq(recruitmentApplications.organizationId, organizationId)).orderBy(desc(recruitmentApplications.submittedAt)),
        canViewRejectedAttempts
          ? db.select().from(recruitmentRejectionAttempts).where(eq(recruitmentRejectionAttempts.organizationId, organizationId)).orderBy(desc(recruitmentRejectionAttempts.attemptedAt)).limit(500)
          : Promise.resolve([]),
        db.select().from(recruitmentInterviews).orderBy(desc(recruitmentInterviews.scheduledAt)),
      ]);
      const visibleApplications = user.role === "org_admin" || !user.schoolId
        ? allApplications
        : allApplications.filter((application) => application.schoolId === user.schoolId || (Array.isArray(application.preferredSchoolIds) && application.preferredSchoolIds.includes(user.schoolId)));
      const applicationIds = visibleApplications.map((application) => application.id);
      const [answers, documents, history] = applicationIds.length ? await Promise.all([
        db.select().from(recruitmentApplicationAnswers).where(inArray(recruitmentApplicationAnswers.applicationId, applicationIds)),
        canViewDocuments
          ? db.select().from(recruitmentApplicationDocuments).where(and(inArray(recruitmentApplicationDocuments.applicationId, applicationIds), eq(recruitmentApplicationDocuments.isActive, true)))
          : Promise.resolve([]),
        db.select().from(recruitmentApplicationStatusHistory).where(inArray(recruitmentApplicationStatusHistory.applicationId, applicationIds)).orderBy(desc(recruitmentApplicationStatusHistory.changedAt)),
      ]) : [[], [], []];
      const visibleInterviews = interviews.filter((interview) => applicationIds.includes(interview.applicationId));
      const applications = visibleApplications.map((application) => ({
        ...application,
        answers: answers.filter((answer) => answer.applicationId === application.id),
        documents: documents.filter((document) => document.applicationId === application.id),
        history: history.filter((item) => item.applicationId === application.id),
        interviews: visibleInterviews.filter((interview) => interview.applicationId === application.id),
        vacancy: vacancies.find((vacancy) => vacancy.id === application.vacancyId) || null,
      }));
      res.json({
        settings,
        schools: orgSchools,
        vacancies: user.role === "org_admin" || !user.schoolId ? vacancies : vacancies.filter((vacancy) => !vacancy.schoolId || vacancy.schoolId === user.schoolId),
        requirements,
        documentCategories: categories,
        applications,
        rejectionAttempts,
        interviews: visibleInterviews,
        dashboard: {
          openVacancies: vacancies.filter((vacancy) => vacancy.status === "published").length,
          submitted: applications.filter((application) => application.status === "submitted").length,
          underReview: applications.filter((application) => application.status === "under_review").length,
          shortlisted: applications.filter((application) => application.status === "shortlisted").length,
          interviews: visibleInterviews.filter((interview) => new Date(interview.scheduledAt) >= new Date()).length,
          hired: applications.filter((application) => application.status === "hired").length,
          rejectedAttempts: rejectionAttempts.length,
        },
      });
    } catch (error) { next(error); }
  });

  app.post("/api/recruitment/vacancies", requireAuth, requirePermission("recruitment.vacancies.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const input = vacancyInput.parse(req.body);
      const user = userOf(req)!;
      if (user.role !== "org_admin" && user.schoolId && input.schoolId !== user.schoolId) {
        return res.status(403).json({ message: "School recruitment users may create vacancies only for their own school." });
      }
      if (input.schoolId) {
        const [school] = await db.select({ id: schools.id }).from(schools).where(and(eq(schools.id, input.schoolId), eq(schools.organizationId, organizationId))).limit(1);
        if (!school) return res.status(400).json({ message: "The selected school is outside your organization." });
      }
      const [created] = await db.insert(recruitmentVacancies).values({
        organizationId,
        ...input,
        schoolId: input.schoolId || null,
        locationText: input.locationText || null,
        opensAt: input.opensAt ? new Date(input.opensAt) : null,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        publishedAt: input.status === "published" ? new Date() : null,
        createdByUserId: userOf(req)!.id,
      }).returning();
      res.status(201).json(created);
    } catch (error) { next(error); }
  });

  app.put("/api/recruitment/vacancies/:id", requireAuth, requirePermission("recruitment.vacancies.manage"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const id = Number(req.params.id);
      const input = vacancyInput.parse(req.body);
      const user = userOf(req)!;
      const [existing] = await db.select().from(recruitmentVacancies).where(and(eq(recruitmentVacancies.id, id), eq(recruitmentVacancies.organizationId, organizationId))).limit(1);
      if (!existing) return res.status(404).json({ message: "Vacancy not found" });
      if (user.role !== "org_admin" && user.schoolId && (existing.schoolId !== user.schoolId || input.schoolId !== user.schoolId)) {
        return res.status(403).json({ message: "School recruitment users may update vacancies only for their own school." });
      }
      if (input.schoolId) {
        const [school] = await db.select({ id: schools.id }).from(schools).where(and(eq(schools.id, input.schoolId), eq(schools.organizationId, organizationId))).limit(1);
        if (!school) return res.status(400).json({ message: "The selected school is outside your organization." });
      }
      const [updated] = await db.update(recruitmentVacancies).set({
        ...input,
        schoolId: input.schoolId || null,
        opensAt: input.opensAt ? new Date(input.opensAt) : null,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        publishedAt: input.status === "published" ? existing.publishedAt || new Date() : existing.publishedAt,
        updatedAt: new Date(),
      }).where(eq(recruitmentVacancies.id, id)).returning();
      res.json(updated);
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

  app.put("/api/recruitment/applications/:id", requireAuth, requirePermission("recruitment.applications.process"), async (req, res, next) => {
    try {
      const organizationId = await organizationForUser(req);
      const id = Number(req.params.id);
      const input = z.object({
        status: z.enum(["submitted", "under_review", "shortlisted", "interview", "rejected", "hired", "withdrawn"]),
        recruiterNotes: optionalText,
      }).parse(req.body);
      const [existing] = await db.select().from(recruitmentApplications).where(and(eq(recruitmentApplications.id, id), eq(recruitmentApplications.organizationId, organizationId))).limit(1);
      if (!existing || !canAccessApplication(userOf(req)!, existing)) return res.status(404).json({ message: "Application not found" });
      const userId = userOf(req)!.id;
      const [updated] = await db.transaction(async (tx) => {
        const [row] = await tx.update(recruitmentApplications).set({
          status: input.status,
          recruiterNotes: input.recruiterNotes || null,
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(recruitmentApplications.id, id)).returning();
        await tx.insert(recruitmentApplicationStatusHistory).values({
          applicationId: id,
          previousStatus: existing.status,
          newStatus: input.status,
          notes: input.recruiterNotes || null,
          changedByUserId: userId,
          actorType: "staff",
          actorLabel: null,
        });
        return [row];
      });
      res.json(updated);
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
        notes: optionalText,
        outcome: optionalText,
      }).parse(req.body);
      const [application] = await db.select().from(recruitmentApplications).where(and(eq(recruitmentApplications.id, applicationId), eq(recruitmentApplications.organizationId, organizationId))).limit(1);
      if (!application || !canAccessApplication(userOf(req)!, application)) return res.status(404).json({ message: "Application not found" });
      const [created] = await db.insert(recruitmentInterviews).values({
        applicationId,
        scheduledAt: new Date(input.scheduledAt),
        location: input.location || null,
        interviewType: input.interviewType,
        panelUserIds: input.panelUserIds,
        notes: input.notes || null,
        outcome: input.outcome || null,
        createdByUserId: userOf(req)!.id,
      }).returning();
      res.status(201).json(created);
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
        notes: optionalText,
        outcome: optionalText,
      }).parse(req.body);
      const [existing] = await db.select({
        id: recruitmentInterviews.id,
        schoolId: recruitmentApplications.schoolId,
        preferredSchoolIds: recruitmentApplications.preferredSchoolIds,
      }).from(recruitmentInterviews)
        .innerJoin(recruitmentApplications, eq(recruitmentApplications.id, recruitmentInterviews.applicationId))
        .where(and(eq(recruitmentInterviews.id, interviewId), eq(recruitmentApplications.organizationId, organizationId))).limit(1);
      if (!existing || !canAccessApplication(userOf(req)!, existing)) return res.status(404).json({ message: "Interview not found" });
      const [updated] = await db.update(recruitmentInterviews).set({
        ...(input.scheduledAt ? { scheduledAt: new Date(input.scheduledAt) } : {}),
        ...(input.location !== undefined ? { location: input.location || null } : {}),
        ...(input.interviewType ? { interviewType: input.interviewType } : {}),
        ...(input.panelUserIds ? { panelUserIds: input.panelUserIds } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome || null } : {}),
        updatedAt: new Date(),
      }).where(eq(recruitmentInterviews.id, interviewId)).returning();
      res.json(updated);
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
