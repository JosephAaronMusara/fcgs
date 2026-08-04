import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import { OPERATIONAL_GRADING_POLICY_VERSION } from "@shared/academic-profiles";
import { getTemporaryStrictGradingExclusions } from "./grading-exclusions";

const cleanupState = { lastRunAt: 0, running: null as Promise<void> | null };

function objectRoot(): string {
  return path.resolve(process.env.LOCAL_OBJECT_DIR?.trim() || path.join(process.cwd(), "object_storage"));
}

export function academicReportPdfCacheDirectory(): string {
  return path.join(objectRoot(), "private", "academic-report-pdf-cache");
}

export function academicReportDataCacheDirectory(): string {
  return path.join(objectRoot(), "private", "academic-report-data-cache");
}

export function academicReportPreparationDirectory(): string {
  return path.join(objectRoot(), "private", "academic-report-preparation");
}

export function reportBrandingFingerprint(school: any): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    name: school?.name || null,
    logo: school?.logo || null,
    stamp: school?.stamp || null,
    address: school?.address || null,
    phone: school?.phone || null,
    email: school?.email || null,
    principalName: school?.principalName || null,
    principalPhone: school?.principalPhone || null,
    showClassPositionOnReports: !!school?.showClassPositionOnReports,
  })).digest("hex").slice(0, 20);
}

export function reportGradingConfigurationFingerprint(settingsRows: any[], gradeRows: any[] = []): string {
  const settings = [...(settingsRows || [])]
    .map((row: any) => ({
      gradeLevel: String(row?.gradeLevel || row?.grade_level || ""),
      pointsDirection: String(row?.pointsDirection || row?.points_direction || ""),
      configurationVersion: Number(row?.configurationVersion || row?.configuration_version || 0),
    }))
    .sort((a, b) => a.gradeLevel.localeCompare(b.gradeLevel));
  const grades = [...(gradeRows || [])]
    .map((row: any) => ({
      id: Number(row?.id || 0),
      gradeLevel: String(row?.gradeLevel || row?.grade_level || ""),
      gradeType: String(row?.gradeType || row?.grade_type || ""),
      lowerLimit: Number(row?.lowerLimit ?? row?.lower_limit),
      upperLimit: Number(row?.upperLimit ?? row?.upper_limit),
      gradePoints: String(row?.gradePoints ?? row?.grade_points ?? ""),
      gradeStatus: String(row?.gradeStatus || row?.grade_status || ""),
      rankOrder: Number(row?.rankOrder ?? row?.rank_order ?? 0),
      appliesAll: Boolean(row?.appliesAll ?? row?.applies_all),
      classIds: Array.isArray(row?.classIds || row?.class_ids)
        ? [...(row.classIds || row.class_ids)].map(Number).sort((a, b) => a - b)
        : [],
    }))
    .sort((a, b) => a.id - b.id);
  const temporaryStrictGradingExclusions = getTemporaryStrictGradingExclusions();
  return crypto.createHash("sha256").update(JSON.stringify({
    settings,
    grades,
    temporaryStrictGradingExclusions,
    operationalGradingPolicyVersion: OPERATIONAL_GRADING_POLICY_VERSION,
  })).digest("hex").slice(0, 20);
}


export function reportCommentsFingerprint(rows: any[]): string {
  const comments = [...(rows || [])]
    .map((row: any) => ({
      id: Number(row?.id || 0),
      schoolId: Number(row?.schoolId ?? row?.school_id ?? 0),
      gradeId: row?.gradeId ?? row?.grade_id ?? null,
      commentGrade: String(row?.commentGrade ?? row?.comment_grade ?? ""),
      gradeLevel: row?.gradeLevel ?? row?.grade_level ?? null,
      subjectId: row?.subjectId ?? row?.subject_id ?? null,
      classId: row?.classId ?? row?.class_id ?? null,
      commentText: String(row?.commentText ?? row?.comment_text ?? ""),
      commentType: String(row?.commentType ?? row?.comment_type ?? ""),
      createdAt: row?.createdAt ?? row?.created_at ?? null,
    }))
    .sort((a, b) => a.id - b.id);

  return crypto.createHash("sha256")
    .update(JSON.stringify(comments))
    .digest("hex")
    .slice(0, 20);
}

export function reportCacheKey(args: {
  templateVersion: string;
  schoolId: number;
  examId: number;
  classId: number;
  publicationVersion: number;
  gradingConfigurationFingerprint: string;
  brandingFingerprint: string;
  reportCommentsFingerprint: string;
  studentIds?: number[];
}): string {
  const selection = args.studentIds
    ? Array.from(new Set(args.studentIds)).sort((a, b) => a - b).join(",")
    : "ALL";
  return crypto.createHash("sha256").update([
    args.templateVersion,
    args.schoolId,
    args.examId,
    args.classId,
    args.publicationVersion,
    args.gradingConfigurationFingerprint,
    args.brandingFingerprint,
    args.reportCommentsFingerprint,
    selection,
  ].join("|")).digest("hex");
}

export async function readJsonCache<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error: any) {
    if (error?.code !== "ENOENT") console.warn(`[academic-report-cache] Unable to read ${filePath}:`, error);
    return null;
  }
}

export async function writeJsonCache(filePath: string, value: unknown): Promise<void> {
  await writeAtomic(filePath, Buffer.from(JSON.stringify(value)));
}

export async function readBufferCache(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") console.warn(`[academic-report-cache] Unable to read ${filePath}:`, error);
    return null;
  }
}

export async function writeBufferCache(filePath: string, value: Buffer): Promise<void> {
  await writeAtomic(filePath, value);
}

async function writeAtomic(filePath: string, value: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporaryPath, value, { flag: "wx" });
    await fs.rename(temporaryPath, filePath).catch(async (error: any) => {
      // POSIX rename replaces the destination atomically. Windows can instead
      // report EEXIST/EPERM when the destination already exists, which matters
      // for preparation status files that are updated repeatedly.
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
      await fs.rm(filePath, { force: true });
      await fs.rename(temporaryPath, filePath);
    });
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

async function cleanDirectory(directory: string, cutoffMs: number): Promise<number> {
  let removed = 0;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: any) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || entry.name.endsWith(".tmp")) return;
    const filePath = path.join(directory, entry.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && stat.mtimeMs < cutoffMs) {
      await fs.unlink(filePath).catch(() => undefined);
      removed++;
    }
  }));
  return removed;
}

export function queueAcademicReportCacheCleanup(): void {
  const now = Date.now();
  const intervalMs = 24 * 60 * 60 * 1000;
  if (cleanupState.running || now - cleanupState.lastRunAt < intervalMs) return;
  cleanupState.lastRunAt = now;
  cleanupState.running = (async () => {
    const days = Math.max(1, Number(process.env.ACADEMIC_REPORT_CACHE_DAYS || 30));
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const [pdfRemoved, dataRemoved, preparationRemoved] = await Promise.all([
      cleanDirectory(academicReportPdfCacheDirectory(), cutoff),
      cleanDirectory(academicReportDataCacheDirectory(), cutoff),
      cleanDirectory(academicReportPreparationDirectory(), cutoff),
    ]);
    if (pdfRemoved || dataRemoved || preparationRemoved) {
      console.info(`[academic-report-cache] removed pdf=${pdfRemoved} data=${dataRemoved} preparation=${preparationRemoved}`);
    }
  })().catch((error) => {
    console.warn("[academic-report-cache] cleanup failed:", error);
  }).finally(() => {
    cleanupState.running = null;
  });
}
