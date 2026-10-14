import type { Express, Request, Response, NextFunction } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requirePermission } from "./auth";
import { storage } from "./storage";
import {
  feeTermInstallments,
  feeTermSchedules,
  feesImportBatches,
  schools,
  type User,
  type Student,
} from "@shared/schema";

const FEE_TIMEZONE = process.env.FCGS_TIMEZONE || "Africa/Harare";
const CACHE_TTL_MS = 60_000;

type FeeSchedulePosition = {
  configured: boolean;
  schoolId: number;
  academicYear: string | null;
  term: string;
  termLabel: string;
  termStartDate: string | null;
  termEndDate: string | null;
  asOfDate: string;
  scheduleId: number | null;
  totalTermFee: number;
  amountDueToDate: number;
  maxUpToDateBalance: number;
  nextThresholdDate: string | null;
  nextThresholdAmount: number | null;
  hasImportedBalances: boolean;
  installments: Array<{
    id: number;
    installmentNumber: number;
    amount: number;
    arrearsEffectiveDate: string;
  }>;
};

type CachedPosition = { loadedAt: number; dateKey: string; position: FeeSchedulePosition };
const positionCache = new Map<number, CachedPosition>();

function numericMoney(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export function feeDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FEE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function normalizeFeeTerm(value: unknown): "term1" | "term2" | "term3" {
  const normalized = String(value || "term1").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "2" || normalized === "term2") return "term2";
  if (normalized === "3" || normalized === "term3") return "term3";
  return "term1";
}

export function feeTermLabel(term: string): string {
  if (term === "term2") return "Term 2";
  if (term === "term3") return "Term 3";
  return "Term 1";
}

function termDates(school: typeof schools.$inferSelect, term: "term1" | "term2" | "term3") {
  if (term === "term2") return { start: school.term2StartDate, end: school.term2EndDate };
  if (term === "term3") return { start: school.term3StartDate, end: school.term3EndDate };
  return { start: school.term1StartDate, end: school.term1EndDate };
}

export function computeFeeStatus(balanceDue: number, maxUpToDateBalance: number): "fully_paid" | "up_to_date" | "in_arrears" {
  if (balanceDue <= 0.01) return "fully_paid";
  if (balanceDue <= maxUpToDateBalance + 0.01) return "up_to_date";
  return "in_arrears";
}

export function invalidateFeeScheduleCache(schoolId?: number) {
  if (schoolId) positionCache.delete(schoolId);
  else positionCache.clear();
}

export async function getCurrentFeePosition(schoolId: number, asOf = new Date()): Promise<FeeSchedulePosition> {
  const dateKey = feeDateKey(asOf);
  const cached = positionCache.get(schoolId);
  if (cached && cached.dateKey === dateKey && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.position;

  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error("School not found");

  const term = normalizeFeeTerm(school.currentTerm);
  const academicYear = school.currentAcademicYear ? String(school.currentAcademicYear) : null;
  const dates = termDates(school, term);

  let schedule: typeof feeTermSchedules.$inferSelect | undefined;
  if (academicYear) {
    [schedule] = await db.select().from(feeTermSchedules).where(and(
      eq(feeTermSchedules.schoolId, schoolId),
      eq(feeTermSchedules.academicYear, academicYear),
      eq(feeTermSchedules.term, term),
    )).limit(1);
  }

  const installmentRows = schedule
    ? await db.select().from(feeTermInstallments).where(eq(feeTermInstallments.scheduleId, schedule.id)).orderBy(asc(feeTermInstallments.installmentNumber))
    : [];
  const [previousImport] = await db.select({ id: feesImportBatches.id }).from(feesImportBatches).where(eq(feesImportBatches.schoolId, schoolId)).limit(1);
  const installments = installmentRows.map((row) => ({
    id: row.id,
    installmentNumber: row.installmentNumber,
    amount: numericMoney(row.amount),
    arrearsEffectiveDate: row.arrearsEffectiveDate,
  }));
  const totalTermFee = Math.round(installments.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
  const amountDueToDate = Math.round(installments.filter((row) => row.arrearsEffectiveDate <= dateKey).reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
  const maxUpToDateBalance = Math.max(0, Math.round((totalTermFee - amountDueToDate) * 100) / 100);
  const next = installments.find((row) => row.arrearsEffectiveDate > dateKey) || null;

  const position: FeeSchedulePosition = {
    configured: Boolean(schedule && installments.length),
    schoolId,
    academicYear,
    term,
    termLabel: feeTermLabel(term),
    termStartDate: dates.start || null,
    termEndDate: dates.end || null,
    asOfDate: dateKey,
    scheduleId: schedule?.id || null,
    totalTermFee,
    amountDueToDate,
    maxUpToDateBalance,
    nextThresholdDate: next?.arrearsEffectiveDate || null,
    nextThresholdAmount: next?.amount ?? null,
    hasImportedBalances: Boolean(previousImport),
    installments,
  };
  positionCache.set(schoolId, { loadedAt: Date.now(), dateKey, position });
  return position;
}

export async function resolveStudentFeePosition(student: Pick<Student, "schoolId" | "feesTotalTerm" | "feesPaidSoFar" | "feesBalance" | "feesMaxBalance" | "feesStatus">, asOf = new Date()) {
  const balance = numericMoney(student.feesBalance);
  if (student.schoolId) {
    const current = await getCurrentFeePosition(student.schoolId, asOf);
    if (current.configured) {
      return {
        configured: true,
        total: current.totalTermFee,
        paid: Math.max(0, Math.round((current.totalTermFee - balance) * 100) / 100),
        balance,
        maxBalance: current.maxUpToDateBalance,
        feesStatus: computeFeeStatus(balance, current.maxUpToDateBalance),
        position: current,
      };
    }
  }
  return {
    configured: false,
    total: numericMoney(student.feesTotalTerm),
    paid: numericMoney(student.feesPaidSoFar),
    balance,
    maxBalance: numericMoney(student.feesMaxBalance),
    feesStatus: String(student.feesStatus || "n/a"),
    position: null,
  };
}

async function schoolIdFromRequest(req: Request, res: Response): Promise<number | null> {
  const user = req.user as User;
  if (user.role !== "org_admin") return user.schoolId || null;
  const raw = req.headers["x-school-id"];
  const parsed = Number.parseInt(Array.isArray(raw) ? raw[0] : String(raw || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const school = await storage.getSchool(parsed);
  if (!school) { res.status(404).json({ message: "School not found" }); return null; }
  if (user.organizationId !== null && user.organizationId !== undefined) {
    if (school.organizationId !== user.organizationId) { res.status(403).json({ message: "School not in organization context" }); return null; }
  } else {
    const allowedSchoolIds = await storage.getUserSchoolAccess(user.id);
    if (!allowedSchoolIds.includes(parsed)) { res.status(403).json({ message: "School not assigned to this account" }); return null; }
  }
  return parsed;
}

function validDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function serializeScheduleForAudit(position: FeeSchedulePosition) {
  return {
    academicYear: position.academicYear,
    term: position.term,
    termStartDate: position.termStartDate,
    termEndDate: position.termEndDate,
    totalTermFee: position.totalTermFee,
    installments: position.installments.map((row) => ({ installmentNumber: row.installmentNumber, amount: row.amount, arrearsEffectiveDate: row.arrearsEffectiveDate })),
  };
}

export function registerFeeScheduleRoutes(app: Express) {
  app.get("/api/fees/schedule/current", requireAuth, requirePermission("fees.view"), async (req, res, next) => {
    try {
      const schoolId = await schoolIdFromRequest(req, res);
      if (!schoolId) { if (res.headersSent) return; return res.status(400).json({ message: "No school context" }); }
      res.json(await getCurrentFeePosition(schoolId));
    } catch (error) { next(error); }
  });

  app.put("/api/fees/schedule/current", requireAuth, requirePermission("fees.manage_structure"), async (req, res, next) => {
    try {
      const schoolId = await schoolIdFromRequest(req, res);
      if (!schoolId) { if (res.headersSent) return; return res.status(400).json({ message: "No school context" }); }
      const user = req.user as User;
      const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
      if (!school) return res.status(404).json({ message: "School not found" });
      const term = normalizeFeeTerm(school.currentTerm);
      const academicYear = school.currentAcademicYear ? String(school.currentAcademicYear) : "";
      const dates = termDates(school, term);
      if (!academicYear) return res.status(400).json({ message: "Configure the school's current academic year before creating a fee schedule." });
      if (!dates.start || !dates.end) return res.status(400).json({ message: `Configure ${feeTermLabel(term)} start and end dates before creating a fee schedule.` });

      const rawInstallments = Array.isArray(req.body?.installments) ? req.body.installments : [];
      if (rawInstallments.length !== 3) return res.status(400).json({ message: "The current fee schedule requires exactly three instalments." });
      const installments = rawInstallments.map((row: any, index: number) => ({
        installmentNumber: index + 1,
        amount: Number.parseFloat(String(row?.amount ?? "")),
        arrearsEffectiveDate: String(row?.arrearsEffectiveDate || "").trim(),
      }));
      for (const row of installments) {
        if (!Number.isFinite(row.amount) || row.amount <= 0) return res.status(400).json({ message: `Instalment ${row.installmentNumber} amount must be greater than zero.` });
        if (!validDateKey(row.arrearsEffectiveDate)) return res.status(400).json({ message: `Instalment ${row.installmentNumber} has an invalid arrears-effective date.` });
        if (row.arrearsEffectiveDate < dates.start || row.arrearsEffectiveDate > dates.end) return res.status(400).json({ message: `Instalment ${row.installmentNumber} arrears-effective date must fall within ${feeTermLabel(term)} (${dates.start} to ${dates.end}).` });
      }
      for (let index = 1; index < installments.length; index++) {
        if (installments[index].arrearsEffectiveDate <= installments[index - 1].arrearsEffectiveDate) return res.status(400).json({ message: "Instalment arrears-effective dates must be in strictly increasing order." });
      }

      invalidateFeeScheduleCache(schoolId);
      const before = await getCurrentFeePosition(schoolId);
      invalidateFeeScheduleCache(schoolId);

      const scheduleId = await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(feeTermSchedules).where(and(
          eq(feeTermSchedules.schoolId, schoolId),
          eq(feeTermSchedules.academicYear, academicYear),
          eq(feeTermSchedules.term, term),
        )).limit(1);
        let id = existing?.id;
        if (existing) {
          await tx.update(feeTermSchedules).set({ updatedByUserId: user.id, updatedAt: new Date() }).where(eq(feeTermSchedules.id, existing.id));
          await tx.delete(feeTermInstallments).where(eq(feeTermInstallments.scheduleId, existing.id));
        } else {
          const [created] = await tx.insert(feeTermSchedules).values({
            schoolId,
            organizationId: school.organizationId || null,
            academicYear,
            term,
            createdByUserId: user.id,
            updatedByUserId: user.id,
          }).returning({ id: feeTermSchedules.id });
          id = created.id;
        }
        await tx.insert(feeTermInstallments).values(installments.map((row) => ({
          scheduleId: id!,
          installmentNumber: row.installmentNumber,
          amount: row.amount.toFixed(2),
          arrearsEffectiveDate: row.arrearsEffectiveDate,
        })));
        return id!;
      });

      invalidateFeeScheduleCache(schoolId);
      const after = await getCurrentFeePosition(schoolId);
      void storage.createActivityLog({
        schoolId,
        organizationId: user.organizationId,
        userId: user.id,
        userName: user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user.username,
        userRole: user.role,
        action: before.configured ? "update" : "create",
        category: "fees",
        description: `${before.configured ? "Updated" : "Created"} ${after.termLabel} ${academicYear} fee instalment schedule`,
        targetType: "fee_term_schedule",
        targetId: scheduleId,
        targetName: `${after.termLabel} ${academicYear}`,
        metadata: { before: serializeScheduleForAudit(before), after: serializeScheduleForAudit(after) },
        ipAddress: req.ip || req.socket.remoteAddress || null,
      }).catch(() => undefined);
      res.json(after);
    } catch (error) { next(error); }
  });
}
