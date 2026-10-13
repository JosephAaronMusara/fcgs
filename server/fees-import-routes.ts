import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import multer from "multer";
import { parse as csvParse } from "csv-parse/sync";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requirePermission, requireRole } from "./auth";
import { storage } from "./storage";
import { syncStudentPolicy } from "./access-control-operations";
import { feesImportBatches, feesImportItems, students as studentsTable, schools, type User } from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const STALE_PROCESSING_MINUTES = 5;
const CONCURRENCY = 4;
const MAX_PREVIEW_ITEMS = 2500;

const NAME_HEADERS = new Set(["name", "student", "student name", "learner", "learner name", "customer name", "pupil", "pupil name"]);
const BALANCE_HEADERS = new Set(["balance", "balance due", "fees balance", "outstanding balance", "amount due", "outstanding", "balance outstanding"]);
const CUSTOMER_HEADERS = new Set(["customer", "customer id", "customer code", "account", "account no", "account number", "customer number"]);
const GROUP_HEADERS = new Set(["group", "form", "stream", "grade"]);
const AREA_HEADERS = new Set(["area", "class", "class name", "classroom"]);
const SUMMARY_NAME_RE = /^(?:sub\s*total|subtotal|grand\s+total|total(?:\s+(?:balance|due|fees|amount))?|balance\s+total|carried\s+forward|brought\s+forward|page\s+total|overall\s+total)\b/i;

type MatchMethod = "customer_code" | "exact_name" | "fuzzy_name" | "unmatched" | "skipped" | "invalid";
type RowDisposition = "data" | "skipped" | "invalid";
type ParsedRow = {
  rowNumber: number;
  sourceSheet: string | null;
  customer: string;
  name: string;
  group: string;
  area: string;
  balanceDue: number;
  matchedStudent: any | null;
  matchMethod: MatchMethod;
  calculatedStatus: string | null;
  rowDisposition: RowDisposition;
  skipReason: string | null;
  validationError: string | null;
};

type ParsedTabularFile = {
  detectedFormat: "csv" | "xlsx" | "xls";
  fileHash: string;
  selectedSheet: string | null;
  candidateSheets: string[];
  matrix: unknown[][] | null;
  formulaAt?: (rowIndex: number, colIndex: number) => string | null;
};

type HeaderMap = { headerRowIndex: number; customer: number | null; name: number; group: number | null; area: number | null; balance: number };

let processorBusy = false;

async function schoolIdFromRequest(req: Request, res: Response): Promise<number | null> {
  const user = req.user as User;
  if (user.role !== "org_admin") return user.schoolId || null;

  const raw = req.headers["x-school-id"];
  const parsed = Number.parseInt(Array.isArray(raw) ? raw[0] : String(raw || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  const school = await storage.getSchool(parsed);
  if (!school) {
    res.status(404).json({ message: "School not found" });
    return null;
  }
  if (user.organizationId !== null && user.organizationId !== undefined) {
    if (school.organizationId !== user.organizationId) {
      res.status(403).json({ message: "School not in organization context" });
      return null;
    }
  } else {
    const allowedSchoolIds = await storage.getUserSchoolAccess(user.id);
    if (!allowedSchoolIds.includes(parsed)) {
      res.status(403).json({ message: "School not assigned to this account" });
      return null;
    }
  }
  return parsed;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function parseMoney(value: unknown): number | null {
  let text = cellText(value);
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  text = text.replace(/\bUSD\b/gi, "").replace(/[$,\s]/g, "");
  if (!/^[-+]?\d*(?:\.\d+)?$/.test(text) || !/[0-9]/.test(text)) return null;
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function mapHeader(row: unknown[]): Omit<HeaderMap, "headerRowIndex"> | null {
  const mapped: Omit<HeaderMap, "headerRowIndex"> = { customer: null, name: -1, group: null, area: null, balance: -1 };
  row.forEach((value, index) => {
    const header = normalizeHeader(value);
    if (CUSTOMER_HEADERS.has(header)) mapped.customer = index;
    else if (NAME_HEADERS.has(header)) mapped.name = index;
    else if (GROUP_HEADERS.has(header)) mapped.group = index;
    else if (AREA_HEADERS.has(header)) mapped.area = index;
    else if (BALANCE_HEADERS.has(header)) mapped.balance = index;
  });
  if (mapped.name < 0 || mapped.balance < 0) return null;
  return mapped;
}

function findHeader(matrix: unknown[][]): HeaderMap | null {
  const max = Math.min(matrix.length, 25);
  for (let rowIndex = 0; rowIndex < max; rowIndex++) {
    const mapped = mapHeader(matrix[rowIndex] || []);
    if (mapped) return { ...mapped, headerRowIndex: rowIndex, name: mapped.name, balance: mapped.balance };
  }
  return null;
}

function detectFileFormat(file: Express.Multer.File): "csv" | "xlsx" | "xls" {
  const buffer = file.buffer;
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return "xlsx";
  if (buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0 && buffer[4] === 0xa1 && buffer[5] === 0xb1 && buffer[6] === 0x1a && buffer[7] === 0xe1) return "xls";
  const ext = file.originalname.toLowerCase().split(".").pop();
  if (ext === "xlsx") return "xlsx";
  if (ext === "xls") return "xls";
  return "csv";
}

async function parseTabularFile(file: Express.Multer.File, requestedSheet?: string | null): Promise<ParsedTabularFile> {
  const detectedFormat = detectFileFormat(file);
  const fileHash = crypto.createHash("sha256").update(file.buffer).digest("hex");
  if (detectedFormat === "csv") {
    let matrix: unknown[][];
    try {
      matrix = csvParse(file.buffer.toString("utf8").replace(/^\uFEFF/, ""), {
        relax_column_count: true,
        skip_empty_lines: false,
        trim: true,
      }) as unknown[][];
    } catch (error) {
      throw new Error(`Unable to parse CSV file: ${error instanceof Error ? error.message : "invalid CSV"}`);
    }
    return { detectedFormat, fileHash, selectedSheet: null, candidateSheets: [], matrix };
  }

  const XLSX = await import("xlsx");
  let workbook: any;
  try {
    workbook = XLSX.read(file.buffer, { type: "buffer", cellFormula: true, cellDates: false, raw: false });
  } catch (error) {
    throw new Error(`Unable to parse Excel workbook: ${error instanceof Error ? error.message : "invalid workbook"}`);
  }
  const candidates = workbook.SheetNames.filter((sheetName: string) => {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) as unknown[][];
    return Boolean(findHeader(matrix));
  });
  if (!candidates.length) throw new Error('No worksheet contains recognizable learner "Name" and "Balance" columns.');
  if (requestedSheet && !candidates.includes(requestedSheet)) throw new Error("The selected worksheet does not contain recognizable Name and Balance columns.");
  if (!requestedSheet && candidates.length > 1) {
    return { detectedFormat, fileHash, selectedSheet: null, candidateSheets: candidates, matrix: null };
  }
  const selectedSheet = requestedSheet || candidates[0];
  const sheet = workbook.Sheets[selectedSheet];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) as unknown[][];
  const formulaAt = (rowIndex: number, colIndex: number) => {
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
    return sheet[address]?.f ? String(sheet[address].f) : null;
  };
  return { detectedFormat, fileHash, selectedSheet, candidateSheets: candidates, matrix, formulaAt };
}

function isRepeatedHeaderRow(row: unknown[], header: HeaderMap) {
  return NAME_HEADERS.has(normalizeHeader(row[header.name])) && BALANCE_HEADERS.has(normalizeHeader(row[header.balance]));
}

function classifyRow(row: unknown[], rowIndex: number, header: HeaderMap, formulaAt?: (row: number, col: number) => string | null) {
  const nonBlank = row.some((value) => cellText(value) !== "");
  if (!nonBlank) return { disposition: "skipped" as const, reason: "Blank row" };
  if (isRepeatedHeaderRow(row, header)) return { disposition: "skipped" as const, reason: "Repeated column header" };
  const name = cellText(row[header.name]);
  const balanceText = cellText(row[header.balance]);
  const formula = formulaAt?.(rowIndex, header.balance) || "";
  if (SUMMARY_NAME_RE.test(name) || /^SUM\s*\(/i.test(formula) || /^=\s*SUM\s*\(/i.test(balanceText)) {
    return { disposition: "skipped" as const, reason: formula ? "Summary/subtotal formula row" : "Summary/subtotal row" };
  }
  if (!name && !balanceText) return { disposition: "skipped" as const, reason: "Blank learner row" };
  if (!name) return { disposition: "invalid" as const, reason: "Learner name is missing" };
  const balance = parseMoney(balanceText);
  if (balance === null) return { disposition: "invalid" as const, reason: "Balance is not a valid number" };
  return { disposition: "data" as const, reason: null, balance };
}

function computeFeesStatusKey(balanceDue: number, maxBalance: number): string {
  if (balanceDue <= 0.01) return "fully_paid";
  if (maxBalance > 0 && balanceDue <= maxBalance + 0.01) return "up_to_date";
  return "in_arrears";
}

async function parseAndMatchFile(file: Express.Multer.File, schoolId: number, termMaxBalance: number, requestedSheet?: string | null) {
  const parsed = await parseTabularFile(file, requestedSheet);
  if (!parsed.matrix) return { parsed, header: null, rows: [] as ParsedRow[] };
  const header = findHeader(parsed.matrix);
  if (!header) throw new Error('File must contain recognizable "Name" and "Balance" columns.');
  const allStudents = await storage.getStudentsBySchool(schoolId);
  const rows: ParsedRow[] = [];

  for (let matrixIndex = header.headerRowIndex + 1; matrixIndex < parsed.matrix.length; matrixIndex++) {
    const row = parsed.matrix[matrixIndex] || [];
    const rowNumber = matrixIndex + 1;
    const classification = classifyRow(row, matrixIndex, header, parsed.formulaAt);
    const customer = header.customer !== null ? cellText(row[header.customer]) : "";
    const name = cellText(row[header.name]);
    const group = header.group !== null ? cellText(row[header.group]) : "";
    const area = header.area !== null ? cellText(row[header.area]) : "";

    if (classification.disposition === "skipped") {
      rows.push({ rowNumber, sourceSheet: parsed.selectedSheet, customer, name, group, area, balanceDue: 0, matchedStudent: null, matchMethod: "skipped", calculatedStatus: null, rowDisposition: "skipped", skipReason: classification.reason, validationError: null });
      continue;
    }
    if (classification.disposition === "invalid") {
      rows.push({ rowNumber, sourceSheet: parsed.selectedSheet, customer, name, group, area, balanceDue: 0, matchedStudent: null, matchMethod: "invalid", calculatedStatus: null, rowDisposition: "invalid", skipReason: null, validationError: classification.reason });
      continue;
    }

    const balanceDue = classification.balance;
    let matchedStudent: any = null;
    let matchMethod: MatchMethod = "unmatched";
    if (customer) {
      matchedStudent = allStudents.find((student) => String(student.feesCustomerId || "").trim().toLowerCase() === customer.toLowerCase());
      if (matchedStudent) matchMethod = "customer_code";
    }
    if (!matchedStudent) {
      const nameLower = name.toLowerCase();
      matchedStudent = allStudents.find((student) => `${student.firstName} ${student.lastName}`.trim().toLowerCase() === nameLower);
      if (matchedStudent) matchMethod = "exact_name";
    }
    if (!matchedStudent) {
      const nameLower = name.toLowerCase();
      matchedStudent = allStudents.find((student) => {
        const fullName = `${student.firstName} ${student.lastName}`.trim().toLowerCase();
        return fullName.length >= 4 && nameLower.length >= 4 && (fullName.includes(nameLower) || nameLower.includes(fullName));
      });
      if (matchedStudent) matchMethod = "fuzzy_name";
    }
    rows.push({ rowNumber, sourceSheet: parsed.selectedSheet, customer, name, group, area, balanceDue, matchedStudent, matchMethod, calculatedStatus: matchedStudent ? computeFeesStatusKey(balanceDue, termMaxBalance) : null, rowDisposition: "data", skipReason: null, validationError: null });
  }
  return { parsed, header, rows };
}

function previewStats(rows: ParsedRow[]) {
  const dataRows = rows.filter((row) => row.rowDisposition === "data");
  return {
    totalRows: rows.length,
    matchedRows: dataRows.filter((row) => row.matchedStudent).length,
    customerCodeMatches: dataRows.filter((row) => row.matchMethod === "customer_code").length,
    exactNameMatches: dataRows.filter((row) => row.matchMethod === "exact_name").length,
    fuzzyNameMatches: dataRows.filter((row) => row.matchMethod === "fuzzy_name").length,
    unmatchedRows: dataRows.filter((row) => row.matchMethod === "unmatched").length,
    skippedRows: rows.filter((row) => row.rowDisposition === "skipped").length,
    invalidRows: rows.filter((row) => row.rowDisposition === "invalid").length,
  };
}

async function duplicateForHash(schoolId: number, hash: string) {
  const [duplicate] = await db.select({ id: feesImportBatches.id, fileName: feesImportBatches.fileName, status: feesImportBatches.status, committedAt: feesImportBatches.committedAt, previewedAt: feesImportBatches.previewedAt })
    .from(feesImportBatches)
    .where(and(eq(feesImportBatches.schoolId, schoolId), eq(feesImportBatches.fileHash, hash)))
    .orderBy(desc(feesImportBatches.id))
    .limit(1);
  return duplicate || null;
}

async function processBatch(batchId: number) {
  const [batch] = await db.select().from(feesImportBatches).where(eq(feesImportBatches.id, batchId)).limit(1);
  if (!batch || batch.status !== "processing") return;
  const items = await db.select().from(feesImportItems).where(and(eq(feesImportItems.batchId, batchId), eq(feesImportItems.rowDisposition, "data"))).orderBy(asc(feesImportItems.rowNumber), asc(feesImportItems.id));
  const matched = items.filter((item) => item.matchedStudentId && !item.validationError);
  let processed = Number(batch.processedRows || 0);
  let failed = Number(batch.failedRows || 0);
  const snapshotAt = new Date();
  const termTotalFee = Number.parseFloat(batch.termTotalFee || "0") || 0;
  const termMaxBalance = Number.parseFloat(batch.termMaxBalance || "0") || 0;

  for (let start = processed; start < matched.length; start += CONCURRENCY) {
    const slice = matched.slice(start, start + CONCURRENCY);
    const results = await Promise.all(slice.map(async (item) => {
      try {
        const balanceDue = Number.parseFloat(item.balanceDue || "0") || 0;
        const paid = Math.max(0, termTotalFee - balanceDue);
        const updateData: Record<string, any> = {
          feesTotalTerm: termTotalFee.toFixed(2),
          feesPaidSoFar: paid.toFixed(2),
          feesBalance: balanceDue.toFixed(2),
          feesMaxBalance: termMaxBalance.toFixed(2),
          feesStatus: item.calculatedStatus || computeFeesStatusKey(balanceDue, termMaxBalance),
          feesSource: "student_payments_csv",
          feesSnapshotAt: snapshotAt,
          feesImportBatchId: batch.id,
        };
        if (item.csvCustomerCode) updateData.feesCustomerId = item.csvCustomerCode;
        const updated = await db.update(studentsTable).set(updateData).where(and(eq(studentsTable.id, item.matchedStudentId!), eq(studentsTable.schoolId, batch.schoolId))).returning({ id: studentsTable.id });
        if (!updated.length) throw new Error("Matched learner is no longer in the import school");
        await syncStudentPolicy(item.matchedStudentId!, batch.uploadedByUserId || null, `Student fee balance import #${batch.id}`).catch(() => undefined);
        return true;
      } catch (error) {
        await db.update(feesImportItems).set({ validationError: `Processing failed: ${error instanceof Error ? error.message : "unknown error"}` }).where(eq(feesImportItems.id, item.id)).catch(() => undefined);
        return false;
      }
    }));
    processed += slice.length;
    failed += results.filter((ok) => !ok).length;
    await db.update(feesImportBatches).set({
      processedRows: processed,
      failedRows: failed,
      progressMessage: `Processed ${processed} of ${matched.length} matched learner rows`,
      lastProgressAt: new Date(),
    }).where(eq(feesImportBatches.id, batch.id));
  }

  const completedAt = new Date();
  await db.update(feesImportBatches).set({
    status: failed > 0 ? "completed_with_errors" : "committed",
    processedRows: matched.length,
    failedRows: failed,
    progressMessage: failed > 0 ? `Completed with ${failed} processing error(s)` : `Completed: ${matched.length} learner balance(s) updated`,
    processingCompletedAt: completedAt,
    committedAt: completedAt,
    lastProgressAt: completedAt,
  }).where(eq(feesImportBatches.id, batch.id));
}

async function claimNextBatch(): Promise<number | null> {
  const result: any = await db.execute(sql`
    UPDATE fees_import_batches
    SET status = 'processing',
        processing_started_at = COALESCE(processing_started_at, NOW()),
        last_progress_at = NOW(),
        progress_message = 'Background import started',
        last_error = NULL
    WHERE id = (
      SELECT id
      FROM fees_import_batches
      WHERE status = 'queued'
         OR (status = 'processing' AND COALESCE(last_progress_at, processing_started_at, previewed_at) < NOW() - (${STALE_PROCESSING_MINUTES} * INTERVAL '1 minute'))
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `);
  return result.rows?.[0]?.id ? Number(result.rows[0].id) : null;
}

export async function runFeeImportProcessorTick() {
  if (processorBusy) return;
  processorBusy = true;
  try {
    const batchId = await claimNextBatch();
    if (!batchId) return;
    try {
      await processBatch(batchId);
    } catch (error) {
      await db.update(feesImportBatches).set({
        status: "failed",
        lastError: error instanceof Error ? error.message : "Background processing failed",
        progressMessage: "Import failed during background processing",
        lastProgressAt: new Date(),
        processingCompletedAt: new Date(),
      }).where(eq(feesImportBatches.id, batchId)).catch(() => undefined);
    }
  } finally {
    processorBusy = false;
  }
}

function batchPublicView(batch: typeof feesImportBatches.$inferSelect) {
  const processableRows = Math.max(0, Number(batch.matchedRows || 0));
  return {
    id: batch.id,
    fileName: batch.fileName,
    detectedFormat: batch.detectedFormat,
    fileHash: batch.fileHash,
    sheetName: batch.sheetName,
    status: batch.status,
    totalRows: Number(batch.totalRows || 0),
    matchedRows: Number(batch.matchedRows || 0),
    unmatchedRows: Number(batch.unmatchedRows || 0),
    skippedRows: Number(batch.skippedRows || 0),
    invalidRows: Number(batch.invalidRows || 0),
    processedRows: Number(batch.processedRows || 0),
    failedRows: Number(batch.failedRows || 0),
    progressPercent: processableRows ? Math.min(100, Math.round((Number(batch.processedRows || 0) / processableRows) * 100)) : batch.status === "committed" ? 100 : 0,
    progressMessage: batch.progressMessage,
    lastError: batch.lastError,
    previewedAt: batch.previewedAt,
    processingStartedAt: batch.processingStartedAt,
    processingCompletedAt: batch.processingCompletedAt,
    committedAt: batch.committedAt,
  };
}

async function previewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const schoolId = await schoolIdFromRequest(req, res);
    if (!schoolId) { if (res.headersSent) return; return res.status(400).json({ message: "No school context" }); }
    if (!req.file) return res.status(400).json({ message: "No fee balance file uploaded" });
    const termTotalFee = Number.parseFloat(String(req.body.term_total_fee || "0"));
    const termMaxBalance = Number.parseFloat(String(req.body.term_max_balance || "0"));
    if (!Number.isFinite(termTotalFee) || termTotalFee < 0) return res.status(400).json({ message: "Term total fee amount must be a valid non-negative number" });
    if (!Number.isFinite(termMaxBalance) || termMaxBalance < 0) return res.status(400).json({ message: "Maximum allowed balance must be a valid non-negative number" });
    const requestedSheet = String(req.body.sheet_name || "").trim() || null;
    const { parsed, rows } = await parseAndMatchFile(req.file, schoolId, termMaxBalance, requestedSheet);
    if (!parsed.matrix) {
      return res.json({ success: true, requiresSheetSelection: true, detectedFormat: parsed.detectedFormat, candidateSheets: parsed.candidateSheets });
    }
    if (rows.length > MAX_PREVIEW_ITEMS) return res.status(400).json({ message: `The file contains ${rows.length} rows. The current safe preview limit is ${MAX_PREVIEW_ITEMS} rows.` });
    const stats = previewStats(rows);
    const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
    const duplicate = await duplicateForHash(schoolId, parsed.fileHash);
    const [batch] = await db.insert(feesImportBatches).values({
      schoolId,
      organizationId: school?.organizationId || null,
      fileName: req.file.originalname,
      source: "student_payments_file",
      detectedFormat: parsed.detectedFormat,
      fileHash: parsed.fileHash,
      sheetName: parsed.selectedSheet,
      termTotalFee: termTotalFee.toFixed(2),
      termMaxBalance: termMaxBalance.toFixed(2),
      status: "preview",
      ...stats,
      progressMessage: "Preview ready — confirm to start background processing",
      uploadedByUserId: (req.user as User).id,
    }).returning();
    if (rows.length) {
      await db.insert(feesImportItems).values(rows.map((row) => ({
        batchId: batch.id,
        rowNumber: row.rowNumber,
        sourceSheet: row.sourceSheet,
        rowDisposition: row.rowDisposition,
        skipReason: row.skipReason,
        validationError: row.validationError,
        csvCustomerCode: row.customer || null,
        csvName: row.name || "",
        csvGroup: row.group || null,
        csvArea: row.area || null,
        balanceDue: row.balanceDue.toFixed(2),
        matchedStudentId: row.matchedStudent?.id || null,
        matchedAdmissionNo: row.matchedStudent?.admissionNo || null,
        matchedStudentName: row.matchedStudent ? `${row.matchedStudent.firstName} ${row.matchedStudent.lastName}`.trim() : null,
        matchMethod: row.matchMethod,
        calculatedStatus: row.calculatedStatus,
      })));
    }
    res.json({
      success: true,
      requiresSheetSelection: false,
      batch: batchPublicView(batch),
      stats,
      detectedFormat: parsed.detectedFormat,
      selectedSheet: parsed.selectedSheet,
      candidateSheets: parsed.candidateSheets,
      duplicate: duplicate ? { ...duplicate, message: `This exact file was previously uploaded as import #${duplicate.id}${duplicate.committedAt ? ` and completed at ${new Date(duplicate.committedAt).toLocaleString()}` : ` with status ${duplicate.status}`}.` } : null,
      items: rows.map((row) => ({
        rowNumber: row.rowNumber,
        sourceSheet: row.sourceSheet,
        rowDisposition: row.rowDisposition,
        skipReason: row.skipReason,
        validationError: row.validationError,
        csvCustomerCode: row.customer,
        csvName: row.name,
        csvGroup: row.group,
        csvArea: row.area,
        balanceDue: row.balanceDue,
        matchedStudentId: row.matchedStudent?.id || null,
        matchedAdmissionNo: row.matchedStudent?.admissionNo || null,
        matchedStudentName: row.matchedStudent ? `${row.matchedStudent.firstName} ${row.matchedStudent.lastName}`.trim() : null,
        matchMethod: row.matchMethod,
        calculatedStatus: row.calculatedStatus,
      })),
    });
  } catch (error) { next(error); }
}

async function commitHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const schoolId = await schoolIdFromRequest(req, res);
    if (!schoolId) { if (res.headersSent) return; return res.status(400).json({ message: "No school context" }); }
    const batchId = Number.parseInt(String(req.params.batchId), 10);
    const [batch] = await db.select().from(feesImportBatches).where(and(eq(feesImportBatches.id, batchId), eq(feesImportBatches.schoolId, schoolId))).limit(1);
    if (!batch) return res.status(404).json({ message: "Fee balance import preview not found" });
    if (["queued", "processing", "committed", "completed_with_errors"].includes(batch.status)) return res.status(202).json({ success: true, batch: batchPublicView(batch) });
    if (batch.fileHash) {
      const [existingDuplicate] = await db.select({ id: feesImportBatches.id, status: feesImportBatches.status, committedAt: feesImportBatches.committedAt })
        .from(feesImportBatches)
        .where(and(
          eq(feesImportBatches.schoolId, schoolId),
          eq(feesImportBatches.fileHash, batch.fileHash),
          ne(feesImportBatches.id, batch.id),
          inArray(feesImportBatches.status, ["queued", "processing", "committed", "completed_with_errors"]),
        ))
        .orderBy(desc(feesImportBatches.id))
        .limit(1);
      if (existingDuplicate && req.body?.allowDuplicateFile !== true) {
        return res.status(409).json({
          message: `This exact file is already associated with import #${existingDuplicate.id} (${existingDuplicate.status}). Explicitly confirm that you intend to import the same file again.`,
          duplicateBatchId: existingDuplicate.id,
        });
      }
    }
    if (Number(batch.invalidRows || 0) > 0 && req.body?.allowInvalidRows !== true) {
      return res.status(409).json({ message: "The preview contains invalid rows. Review them before confirming, or explicitly allow valid matched rows to continue while invalid rows are skipped." });
    }
    const [queued] = await db.update(feesImportBatches).set({ status: "queued", processedRows: 0, failedRows: 0, lastError: null, progressMessage: "Queued for background processing", lastProgressAt: new Date() }).where(and(eq(feesImportBatches.id, batch.id), eq(feesImportBatches.status, "preview"))).returning();
    void runFeeImportProcessorTick();
    return res.status(202).json({ success: true, batch: batchPublicView(queued || batch) });
  } catch (error) { next(error); }
}

export function registerFeesImportRoutes(app: Express) {
  app.post("/api/fees/import-file/preview", requireAuth, requireRole("school_admin", "org_admin"), requirePermission("fees.import"), upload.single("fees_file"), previewHandler);
  app.post("/api/fees/import-csv/preview", requireAuth, requireRole("school_admin", "org_admin"), requirePermission("fees.import"), upload.single("fees_csv"), previewHandler);

  app.post("/api/fees/import-file/:batchId/commit", requireAuth, requireRole("school_admin", "org_admin"), requirePermission("fees.import"), commitHandler);
  app.post("/api/fees/import-csv/:batchId/commit", requireAuth, requireRole("school_admin", "org_admin"), requirePermission("fees.import"), commitHandler);

  app.get("/api/fees/import-file/:batchId/status", requireAuth, requirePermission("fees.import"), async (req, res, next) => {
    try {
      const schoolId = await schoolIdFromRequest(req, res); if (!schoolId) { if (res.headersSent) return; return res.status(400).json({ message: "No school context" }); }
      const batchId = Number.parseInt(String(req.params.batchId), 10);
      const [batch] = await db.select().from(feesImportBatches).where(and(eq(feesImportBatches.id, batchId), eq(feesImportBatches.schoolId, schoolId))).limit(1);
      if (!batch) return res.status(404).json({ message: "Fee balance import not found" });
      res.json({ batch: batchPublicView(batch) });
    } catch (error) { next(error); }
  });

  app.get("/api/fees/import-file/:batchId/items", requireAuth, requirePermission("fees.import"), async (req, res, next) => {
    try {
      const schoolId = await schoolIdFromRequest(req, res); if (!schoolId) { if (res.headersSent) return; return res.status(400).json({ message: "No school context" }); }
      const batchId = Number.parseInt(String(req.params.batchId), 10);
      const [batch] = await db.select().from(feesImportBatches).where(and(eq(feesImportBatches.id, batchId), eq(feesImportBatches.schoolId, schoolId))).limit(1);
      if (!batch) return res.status(404).json({ message: "Fee balance import not found" });
      const items = await db.select().from(feesImportItems).where(eq(feesImportItems.batchId, batch.id));
      res.json({ batch: batchPublicView(batch), items });
    } catch (error) { next(error); }
  });

  app.post("/api/fees/import-csv", requireAuth, requireRole("school_admin", "org_admin"), requirePermission("fees.import"), (_req, res) => {
    res.status(410).json({ message: "The legacy synchronous CSV importer has been retired. Use the preview-based fee balance import workflow." });
  });
}
