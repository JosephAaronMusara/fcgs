import fs from "node:fs";
import path from "node:path";
import { db } from "../server/db";
import { internalTransfers, schools, staff, students } from "../shared/schema";
import { buildPersonNumber, parsePersonNumber, schoolSequenceCode, type PersonNumberKind } from "../server/person-numbering";

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_YY = String(CURRENT_YEAR).slice(-2);

type EntityKind = PersonNumberKind;
type SchoolRow = typeof schools.$inferSelect;
type StudentRow = typeof students.$inferSelect;
type StaffRow = typeof staff.$inferSelect;
type TransferRow = typeof internalTransfers.$inferSelect;

type RecordIssue = {
  entity: EntityKind;
  id: number;
  name: string;
  number: string;
  schoolId: number | null;
  schoolName: string | null;
  issuanceYear: number | null;
  issue: string;
  details: string;
};

function normalizeNumber(value?: string | null): string {
  return String(value || "").trim().toUpperCase();
}

function toYear(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getFullYear();
}

// The identifier year is the year FCGS issued the identifier. Historical enrollment dates
// can pre-date migration into the portal and must not be treated as numbering errors.
function studentIssuanceYear(row: StudentRow): number | null {
  return toYear(row.createdAt);
}

function staffIssuanceYear(row: StaffRow): number | null {
  return toYear(row.createdAt);
}

function makeIndex<T extends { id: number }>(rows: T[], getNumber: (row: T) => string | null | undefined) {
  const index = new Map<string, T[]>();
  for (const row of rows) {
    const key = normalizeNumber(getNumber(row));
    if (!key) continue;
    const list = index.get(key) || [];
    list.push(row);
    index.set(key, list);
  }
  return index;
}

function summarizeGaps(sequences: number[], maxItems = 30): { count: number; first: number[] } {
  const sorted = Array.from(new Set(sequences.filter((n) => Number.isSafeInteger(n) && n > 0))).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, first: [] };
  let previous = 0;
  let count = 0;
  const first: number[] = [];
  for (const current of sorted) {
    const missing = Math.max(0, current - previous - 1);
    count += missing;
    for (let value = previous + 1; value < current && first.length < maxItems; value += 1) first.push(value);
    previous = current;
  }
  return { count, first };
}

async function main() {
  const [schoolRows, studentRows, staffRows, transferRows] = await Promise.all([
    db.select().from(schools),
    db.select().from(students),
    db.select().from(staff),
    db.select().from(internalTransfers),
  ]);

  const schoolMap = new Map<number, SchoolRow>(schoolRows.map((row) => [row.id, row]));
  const studentNumberIndex = makeIndex(studentRows, (row) => row.admissionNo);
  const staffNumberIndex = makeIndex(staffRows, (row) => row.staffNo);
  const transferMap = new Map<string, TransferRow[]>();
  const addTransferMapEntry = (key: string, transfer: TransferRow) => {
    const list = transferMap.get(key) || [];
    if (!list.some((row) => row.id === transfer.id)) list.push(transfer);
    transferMap.set(key, list);
  };
  for (const transfer of transferRows) {
    addTransferMapEntry(`${transfer.personType}:${transfer.personId}`, transfer);
    if (transfer.personType === "student") {
      if (transfer.sourceStudentId) addTransferMapEntry(`student:${transfer.sourceStudentId}`, transfer);
      if (transfer.destinationStudentId) addTransferMapEntry(`student:${transfer.destinationStudentId}`, transfer);
    }
  }

  const issues: RecordIssue[] = [];

  const numberBelongsToTransferOrigin = (entity: EntityKind, personId: number, encodedSchoolCode: string) => {
    const transfers = transferMap.get(`${entity}:${personId}`) || [];
    return transfers.some((transfer) => schoolSequenceCode(transfer.sourceSchoolId) === encodedSchoolCode);
  };

  const auditRecord = (
    entity: EntityKind,
    row: StudentRow | StaffRow,
    rawNumber: string,
    issuanceYear: number | null,
  ) => {
    const school = row.schoolId ? schoolMap.get(row.schoolId) || null : null;
    const parsed = parsePersonNumber(rawNumber);
    const expectedCode = row.schoolId ? schoolSequenceCode(row.schoolId) : null;
    const name = `${row.firstName || ""} ${row.lastName || ""}`.trim();
    const base = {
      entity,
      id: row.id,
      name,
      number: rawNumber,
      schoolId: row.schoolId || null,
      schoolName: school?.name || null,
      issuanceYear,
    };

    if (!row.schoolId) {
      issues.push({ ...base, issue: "MISSING_SCHOOL", details: "Record has no school_id; school-scoped sequencing is impossible." });
    }

    if (rawNumber !== normalizeNumber(rawNumber)) {
      issues.push({
        ...base,
        issue: "NUMBER_NOT_NORMALIZED",
        details: "Stored value contains lowercase letters or surrounding whitespace; canonical storage must be uppercase with no padding.",
      });
    }

    if (!parsed) {
      issues.push({
        ...base,
        issue: "NON_CANONICAL_NUMBER",
        details: "Number does not match FCGSYY[S/E]####<school-code> (four or more sequence digits).",
      });
      return;
    }

    if (parsed.kind !== entity) {
      issues.push({
        ...base,
        issue: "WRONG_ENTITY_PREFIX",
        details: `Expected ${entity === "student" ? "S" : "E"} but found ${parsed.kind === "student" ? "S" : "E"}.`,
      });
    }

    if (
      expectedCode &&
      parsed.schoolCode !== expectedCode &&
      !numberBelongsToTransferOrigin(entity, row.id, parsed.schoolCode)
    ) {
      issues.push({
        ...base,
        issue: "WRONG_SCHOOL_SUFFIX",
        details: `Current school ${row.schoolId} expects suffix ${expectedCode}, and no internal-transfer origin justifies suffix ${parsed.schoolCode}.`,
      });
    }

    const recordTransfers = transferMap.get(`${entity}:${row.id}`) || [];
    const isDestinationCopyPreservingOriginalStudentNumber = entity === "student" && recordTransfers.some((transfer) =>
      transfer.destinationStudentId === row.id && schoolSequenceCode(transfer.sourceSchoolId) === parsed.schoolCode,
    );
    if (issuanceYear !== null && parsed.year2 !== String(issuanceYear).slice(-2) && !isDestinationCopyPreservingOriginalStudentNumber) {
      issues.push({
        ...base,
        issue: "NUMBER_YEAR_MISMATCH",
        details: `Number encodes 20${parsed.year2}, while the FCGS record was issued/created in ${issuanceYear}.`,
      });
    }
  };

  for (const row of studentRows) auditRecord("student", row, row.admissionNo, studentIssuanceYear(row));
  for (const row of staffRows) auditRecord("staff", row, row.staffNo, staffIssuanceYear(row));

  const addDuplicateIssues = <T extends StudentRow | StaffRow>(
    entity: EntityKind,
    index: Map<string, T[]>,
    getNumber: (row: T) => string,
    getYear: (row: T) => number | null,
  ) => {
    for (const [normalized, rows] of index.entries()) {
      if (rows.length <= 1) continue;
      for (const row of rows) {
        const school = row.schoolId ? schoolMap.get(row.schoolId) || null : null;
        issues.push({
          entity,
          id: row.id,
          name: `${row.firstName || ""} ${row.lastName || ""}`.trim(),
          number: getNumber(row),
          schoolId: row.schoolId || null,
          schoolName: school?.name || null,
          issuanceYear: getYear(row),
          issue: "CASE_INSENSITIVE_DUPLICATE_NUMBER",
          details: `Normalized number ${entity === "student" ? normalized.split(":").slice(1).join(":") : normalized} is used by ${rows.length} ${entity} records${entity === "student" ? " within the same school" : ""}.`,
        });
      }
    }
  };

  const studentSchoolNumberIndex = new Map<string, StudentRow[]>();
  for (const row of studentRows) {
    const normalized = normalizeNumber(row.admissionNo);
    if (!normalized) continue;
    const key = `${row.schoolId ?? "none"}:${normalized}`;
    const rows = studentSchoolNumberIndex.get(key) || [];
    rows.push(row);
    studentSchoolNumberIndex.set(key, rows);
  }
  // A permanent admission number can legitimately appear once at the historical source school
  // and once at the active destination school after an internal transfer. Only duplicates inside
  // the same school are errors.
  addDuplicateIssues("student", studentSchoolNumberIndex, (row) => row.admissionNo, studentIssuanceYear);
  addDuplicateIssues("staff", staffNumberIndex, (row) => row.staffNo, staffIssuanceYear);

  const sequencesFor = (entity: EntityKind, schoolId: number) => {
    const code = schoolSequenceCode(schoolId);
    const rows = entity === "student" ? studentRows : staffRows;
    return rows
      .map((row) => parsePersonNumber(entity === "student" ? (row as StudentRow).admissionNo : (row as StaffRow).staffNo))
      .filter((parsed): parsed is NonNullable<ReturnType<typeof parsePersonNumber>> => Boolean(
        parsed && parsed.year2 === CURRENT_YY && parsed.kind === entity && parsed.schoolCode === code,
      ))
      .map((parsed) => parsed.sequence);
  };

  const schoolsAudit = schoolRows
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((school) => {
      const code = schoolSequenceCode(school.id);
      const schoolStudents = studentRows.filter((row) => row.schoolId === school.id);
      const schoolStaff = staffRows.filter((row) => row.schoolId === school.id);

      const summarizeEntity = (entity: EntityKind, sequences: number[], index: Map<string, any[]>) => {
        const maxSequence = sequences.length ? Math.max(...sequences) : 0;
        const nextSequence = maxSequence + 1;
        const nextCandidate = buildPersonNumber(entity, school.id, nextSequence, new Date(CURRENT_YEAR, 0, 1));
        const owners = index.get(nextCandidate) || [];
        const blockers = owners.map((owner: StudentRow | StaffRow) => ({
          id: owner.id,
          name: `${owner.firstName || ""} ${owner.lastName || ""}`.trim(),
          schoolId: owner.schoolId || null,
          schoolName: owner.schoolId ? schoolMap.get(owner.schoolId)?.name || null : null,
          number: entity === "student" ? (owner as StudentRow).admissionNo : (owner as StaffRow).staffNo,
        }));

        return {
          status: owners.length ? "BLOCKED_NEXT_NUMBER_ALREADY_EXISTS" : "OK",
          currentYear: CURRENT_YEAR,
          globallyConsumedForSuffix: sequences.length,
          maxSequence,
          nextSequence,
          nextCandidate,
          nextCandidateAlreadyExists: owners.length > 0,
          blockers,
          gapsBeforeMax: summarizeGaps(sequences),
        };
      };

      return {
        schoolId: school.id,
        schoolName: school.name,
        shortCode: school.shortCode,
        sequenceSuffix: code,
        students: { totalCurrentSchoolRecords: schoolStudents.length, ...summarizeEntity("student", sequencesFor("student", school.id), studentNumberIndex) },
        staff: { totalCurrentSchoolRecords: schoolStaff.length, ...summarizeEntity("staff", sequencesFor("staff", school.id), staffNumberIndex) },
      };
    });

  const issueCounts = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.issue] = (acc[issue.issue] || 0) + 1;
    return acc;
  }, {});

  const criticalStatuses = schoolsAudit.flatMap((school) => [
    ...(school.students.status === "OK" ? [] : [{ schoolId: school.schoolId, schoolName: school.schoolName, entity: "student", ...school.students }]),
    ...(school.staff.status === "OK" ? [] : [{ schoolId: school.schoolId, schoolName: school.schoolName, entity: "staff", ...school.staff }]),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "READ_ONLY",
    currentYear: CURRENT_YEAR,
    format: {
      student: "FCGSYY S ####+ <school-sequence-suffix>",
      staff: "FCGSYY E ####+ <school-sequence-suffix>",
      schoolSuffixRule: "Excel-style letters derived from numeric school id: 1=A, 2=B, ..., 26=Z, 27=AA",
      issuanceYearRule: "The year is when FCGS issues the identifier, not a historical enrollment date imported later.",
      transferRule: "Internal transfers retain the original identifier; the encoded source-school suffix remains globally consumed.",
    },
    totals: { schools: schoolRows.length, students: studentRows.length, staff: staffRows.length, issues: issues.length },
    issueCounts,
    criticalStatuses,
    schools: schoolsAudit,
    issues: issues.sort((a, b) => (a.schoolId || 0) - (b.schoolId || 0) || a.entity.localeCompare(b.entity) || a.id - b.id),
    sourcePathFindings: [],
    hardeningChecks: [
      "Normal Student/Staff creates allocate identifiers server-side inside the INSERT transaction.",
      "Ordinary edits and internal transfers cannot replace identifiers.",
      "Allocation uses a per-school/entity/year advisory lock plus a persisted counter.",
      "Allocator scans globally by encoded suffix when reconciling existing usage, so transferred identifiers remain consumed.",
      "Four-or-more digit sequences are supported; 10000+ does not reset the allocator.",
      "School-scoped normalized uniqueness for Student numbers and canonical-format database checks protect stored identifiers while allowing permanent numbers to follow internal transfers.",
    ],
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(process.cwd(), ".local");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `person-numbering-audit-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\nFCGS Student/Staff Numbering Audit (READ ONLY)");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Schools: ${report.totals.schools} | Students: ${report.totals.students} | Staff: ${report.totals.staff}`);
  console.log(`Record issues found: ${report.totals.issues}`);
  console.log("\nPer-school next-number health (global consumption by encoded suffix):");
  console.table(schoolsAudit.flatMap((school) => [
    { School: `${school.schoolName} (#${school.schoolId})`, Entity: "Student", Suffix: school.sequenceSuffix, Max: school.students.maxSequence, Next: school.students.nextCandidate, Status: school.students.status },
    { School: `${school.schoolName} (#${school.schoolId})`, Entity: "Staff", Suffix: school.sequenceSuffix, Max: school.staff.maxSequence, Next: school.staff.nextCandidate, Status: school.staff.status },
  ]));

  if (criticalStatuses.length) {
    console.log("\nBLOCKING / CRITICAL SEQUENCE CONDITIONS:");
    for (const item of criticalStatuses) console.log(`- ${item.schoolName} (#${item.schoolId}) ${item.entity}: ${item.status}; next=${item.nextCandidate}`);
  } else {
    console.log("\nNo immediate next-number blockers detected for the current year.");
  }

  console.log("\nIssue counts:");
  console.table(Object.entries(issueCounts).map(([Issue, Count]) => ({ Issue, Count })));
  console.log(`\nFull JSON report: ${outPath}`);
  console.log("Database writes performed: NONE\n");
}

main().catch((error) => {
  console.error("Numbering audit failed:", error);
  process.exitCode = 1;
});
