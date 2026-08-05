import { useState, useMemo, useEffect, useRef, type ReactNode, type CSSProperties } from "react";
import QRCode from "qrcode";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, schoolFetch } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  Download,
  Send,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  School,
  Loader2,
  BarChart3,
  Users,
  AlertTriangle,
  Trophy,
  ChevronDown,
  Eye,
  Layers,
  MessageSquare,
  Lock,
  Unlock,
  X,
} from "lucide-react";
import type {
  Exam,
  Class,
  Subject,
  Stream,
  Grade,
  ReportComment,
  AssessmentType,
} from "@shared/schema";
import { filterItemsByStrictGradeProfileKey, getGradingProfilesForSchool, getGradeProfileLabel, gradeProfileMatchesStrict, normalizeExamBoard, normalizeSchoolType, profileMatchesStreamName, type GradeProfileKey } from "@shared/academic-profiles";
import { EcdAssessmentTab } from "@/components/academic-reports/ecd-assessment-tab";
import { ReportCardSlip } from "@/components/academic-reports/report-card-document";

type ViewMode = "hub" | "class-level" | "report-cards";

interface PublicationState {
  isPublished: boolean;
  status: "Published" | "Republished" | "Unpublished";
  publicationVersion?: number;
  publishedAt?: string | null;
}

interface StreamStat {
  streamId: number;
  streamName: string;
  classes: { id: number; name: string; isPublished?: boolean }[];
  progressPct: number | null;
  withMarksPct: number;
  acknowledgedPct: number;
  unrecordedPct: number;
  avgPct: number | null;
  classCount: number;
  studentCount: number;
  expectedEntries: number;
  withMarksCount: number;
  acknowledgedCount: number;
  partialCount: number;
  unrecordedCount: number;
  assessmentCreatedCount: number;
  assessmentMissingCount: number;
  publishedCount: number;
  allPublished: boolean;
  anyPublished: boolean;
  publicationStatus: "Published" | "Partially published" | "Unpublished";
}

interface SubjectProgress {
  subjectId: number;
  subjectName: string;
  assessmentId: number | null;
  assessmentCreated: boolean;
  teacherName?: string | null;
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
}

interface ClassProgressData {
  classId: number;
  className: string;
  totalStudents: number;
  subjects: SubjectProgress[];
  totals?: {
    expectedEntries: number;
    withMarks: number;
    acknowledged: number;
    partial: number;
    unrecorded: number;
    offeredSubjects: number;
    assessmentsCreated: number;
    assessmentsMissing: number;
  };
  publication: PublicationState;
}

interface MissingMarkSubject {
  subjectId: number;
  subjectName: string;
  assessmentCreated?: boolean;
  totalStudents: number;
  missingCount: number;
  missingStudents: { id: number; name: string; admissionNo: string; reason?: string }[];
}

interface MeritRow {
  studentName: string;
  admissionNo: string;
  cells: Record<number, number | null>;
  cellDisplays?: Record<number, string>;
  cellGrades?: Record<number, string>;
  total: number;
  totalDisplay?: string;
  avg: number;
  avgDisplay?: string;
  points?: number | string;
  pointsDisplay?: string;
  subjectsWithMarks: number;
  position: string;
}

interface MeritData {
  examName?: string;
  className?: string;
  subjects: { id: number; name: string }[];
  rows: MeritRow[];
  totalStudents: number;
  showPointsColumn?: boolean;
}

interface AnalyticsData {
  examName?: string;
  className?: string;
  overallAvg: number;
  completion: number;
  enteredCells: number;
  expectedCells: number;
  gradeColumns: string[];
  gradeCounts: Record<string, number>;
  subjectSummary: {
    subjectId: number;
    subjectName: string;
    teacherName?: string | null;
    avg: number;
    completion: number;
    passed: number;
    failed: number;
    passRate: number;
    gradeCounts: Record<string, number>;
  }[];
  totalStudents: number;
  passMark: number;
}

interface StreamMeritData {
  examName?: string;
  streamName?: string;
  subjects: string[];
  rows: {
    studentName: string;
    admissionNo: string;
    total: string;
    avg: string;
    points?: string | number;
    position: string;
    subjectMarks: string[];
  }[];
  totalStudents: number;
  showPointsColumn?: boolean;
}

interface StreamAnalyticsData {
  examName?: string;
  streamName?: string;
  gradeColumns: string[];
  rows: {
    subjectId: number;
    subjectName: string;
    teacherName?: string | null;
    avg: number;
    passed: number;
    failed: number;
    passRate: number;
    gradeCounts: Record<string, number>;
  }[];
}

export interface ReportSubject {
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
}

export interface EcdReportSection {
  code: string;
  name: string;
  items: Array<{ itemText: string; rating: string | null }>;
}

export interface ReportStudent {
  student: {
    id: number;
    admissionNo: string;
    firstName: string;
    lastName: string;
    gender: string;
    photo: string | null;
  };
  subjects: ReportSubject[];
  summary: {
    totalMark: string;
    avgMark: string;
    subjectsPassed: string;
    subjectsFailed?: number;
    subjectsUnresolved?: number;
    points: string;
    classPosition?: string;
    overallPosition: string;
    classSize: number;
    averagePercentage: number | null;
    totalSubjects: number;
    positionStatus?: "READY" | "UNRESOLVED";
    positionIssues?: string[];
  };
  chartSubjectLabels: string[];
  chartStudentMarks: number[];
  chartClassAvgs: (number | null)[];
  chartOvertimeLabels: string[];
  chartOvertimeAvgs: number[];
  ecdSections?: EcdReportSection[];
  principalComment?: string;
  classTeacherComment?: string;
  principalCommentPool?: string;
  classTeacherCommentPool?: string;
}

type ReportCardCommentType = "principal" | "class_teacher";
type ReportCardCommentDraftMap = Record<number, { principal: string; class_teacher: string }>;
type ReportCardSubjectCommentDraftMap = Record<string, string>;
type ReportCardCommentStatus = "idle" | "saving" | "saved" | "error";

export interface ReportCardData {
  positionRankingMode?: "none" | "average_percentage" | "average_grade_points" | null;
  school: {
    id: number;
    name: string;
    logo: string | null;
    stamp: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    principalName: string | null;
    principalPhone: string | null;
    currentAcademicYear: string | null;
    currentTerm: string | null;
    examinationBoard: string | null;
    showClassPositionOnReports?: boolean;
  };
  class: Class;
  exam: Exam;
  subjects: Subject[];
  reportCards: ReportStudent[];
  publication: PublicationState;
}

function sanitizeExcelFilePart(value: string | undefined | null) {
  const cleaned = (value || "").toString().trim();
  return (cleaned || "Report")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function sanitizeExcelSheetName(value: string | undefined | null) {
  const cleaned = (value || "Sheet1").toString().trim();
  return (cleaned || "Sheet1")
    .replace(/[\[\]\*\?\/:\\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 31);
}

function escapeExcelXml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type ExcelCellValue = string | number | null | undefined;

function formatMeritCellForDisplay(
  row: Pick<MeritRow, "cells" | "cellDisplays" | "cellGrades">,
  subjectId: number,
) {
  const explicitDisplay = row.cellDisplays?.[subjectId];
  const explicitGrade = row.cellGrades?.[subjectId];
  if (explicitDisplay) {
    if (explicitGrade && !/[()]/.test(explicitDisplay)) {
      return `${explicitDisplay} (${explicitGrade})`;
    }
    return explicitDisplay;
  }

  const value = row.cells?.[subjectId];
  if (value === null || value === undefined) return "-";

  const rounded = Math.round(value);
  const grade = row.cellGrades?.[subjectId];
  return grade ? `${rounded}% (${grade})` : `${rounded}%`;
}

function excelXmlCell(value: ExcelCellValue, styleId?: "Bold" | "Header") {
  const style = styleId ? ` ss:StyleID="${styleId}"` : "";
  if (value === null || value === undefined || value === "") {
    return `<Cell${style}/>`;
  }

  const isNumber = typeof value === "number" && Number.isFinite(value);
  const type = isNumber ? "Number" : "String";
  return `<Cell${style}><Data ss:Type="${type}">${escapeExcelXml(value)}</Data></Cell>`;
}

function normalizeXlsxFilename(filename: string) {
  const cleanFilename = String(filename || "academic_report").trim() || "academic_report";
  if (/\.xlsx$/i.test(cleanFilename)) return cleanFilename;
  return `${cleanFilename.replace(/\.xls$/i, "")}.xlsx`;
}

function excelColumnName(index: number) {
  let dividend = index + 1;
  let columnName = "";
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return columnName;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function concatUint8Arrays(parts: Uint8Array[]) {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function createStoredZip(files: Array<{ path: string; data: string | Uint8Array }>) {
  const encoder = new TextEncoder();
  const fileParts: Uint8Array[] = [];
  const centralDirectoryParts: Uint8Array[] = [];
  let offset = 0;

  files.forEach((file) => {
    const filenameBytes = encoder.encode(file.path);
    const dataBytes = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const checksum = crc32(dataBytes);

    const localHeader: number[] = [];
    writeUint32(localHeader, 0x04034b50);
    writeUint16(localHeader, 20);
    writeUint16(localHeader, 0);
    writeUint16(localHeader, 0);
    writeUint16(localHeader, 0);
    writeUint16(localHeader, 0);
    writeUint32(localHeader, checksum);
    writeUint32(localHeader, dataBytes.length);
    writeUint32(localHeader, dataBytes.length);
    writeUint16(localHeader, filenameBytes.length);
    writeUint16(localHeader, 0);

    const localPart = concatUint8Arrays([new Uint8Array(localHeader), filenameBytes, dataBytes]);
    fileParts.push(localPart);

    const centralHeader: number[] = [];
    writeUint32(centralHeader, 0x02014b50);
    writeUint16(centralHeader, 20);
    writeUint16(centralHeader, 20);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint32(centralHeader, checksum);
    writeUint32(centralHeader, dataBytes.length);
    writeUint32(centralHeader, dataBytes.length);
    writeUint16(centralHeader, filenameBytes.length);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint32(centralHeader, 0);
    writeUint32(centralHeader, offset);

    centralDirectoryParts.push(concatUint8Arrays([new Uint8Array(centralHeader), filenameBytes]));
    offset += localPart.length;
  });

  const centralDirectory = concatUint8Arrays(centralDirectoryParts);
  const endRecord: number[] = [];
  writeUint32(endRecord, 0x06054b50);
  writeUint16(endRecord, 0);
  writeUint16(endRecord, 0);
  writeUint16(endRecord, files.length);
  writeUint16(endRecord, files.length);
  writeUint32(endRecord, centralDirectory.length);
  writeUint32(endRecord, offset);
  writeUint16(endRecord, 0);

  return new Blob([concatUint8Arrays([...fileParts, centralDirectory, new Uint8Array(endRecord)])], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function buildXlsxSheetXml(args: {
  sheetName: string;
  rows: ExcelCellValue[][];
  boldRowIndexes?: number[];
  headerRowIndexes?: number[];
  columnWidths?: number[];
  freezeFirstColumn?: boolean;
}) {
  const boldRows = new Set(args.boldRowIndexes || []);
  const headerRows = new Set(args.headerRowIndexes || []);
  const normalizedRows = args.rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : cell)));

  const cols = args.columnWidths?.length
    ? `<cols>${args.columnWidths
        .map((width, index) => {
          const excelWidth = Math.max(8, Math.round(width / 7));
          return `<col min="${index + 1}" max="${index + 1}" width="${excelWidth}" customWidth="1"/>`;
        })
        .join("")}</cols>`
    : "";

  const sheetViews = args.freezeFirstColumn
    ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" topLeftCell="B1" activePane="topRight" state="frozen"/><selection pane="topRight" activeCell="B1" sqref="B1"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;

  const sheetData = normalizedRows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const shouldBold = boldRows.has(rowIndex) || headerRows.has(rowIndex);
      const cells = row
        .map((value, columnIndex) => {
          if (value === "") return "";
          const cellRef = `${excelColumnName(columnIndex)}${rowNumber}`;
          const style = shouldBold ? ' s="1"' : "";
          if (typeof value === "number" && Number.isFinite(value)) {
            return `<c r="${cellRef}"${style}><v>${value}</v></c>`;
          }
          return `<c r="${cellRef}" t="inlineStr"${style}><is><t>${escapeExcelXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${sheetViews}${cols}<sheetData>${sheetData}</sheetData></worksheet>`;
}

function downloadExcelXmlWorkbook(args: {
  filename: string;
  sheetName: string;
  rows: ExcelCellValue[][];
  boldRowIndexes?: number[];
  headerRowIndexes?: number[];
  columnWidths?: number[];
  freezeFirstColumn?: boolean;
}) {
  const safeSheetName = sanitizeExcelSheetName(args.sheetName);
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeExcelXml(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;

  const blob = createStoredZip([
    { path: "[Content_Types].xml", data: contentTypesXml },
    { path: "_rels/.rels", data: rootRelsXml },
    { path: "xl/workbook.xml", data: workbookXml },
    { path: "xl/_rels/workbook.xml.rels", data: workbookRelsXml },
    { path: "xl/styles.xml", data: stylesXml },
    {
      path: "xl/worksheets/sheet1.xml",
      data: buildXlsxSheetXml({
        sheetName: safeSheetName,
        rows: args.rows,
        boldRowIndexes: args.boldRowIndexes,
        headerRowIndexes: args.headerRowIndexes,
        columnWidths: args.columnWidths,
        freezeFirstColumn: args.freezeFirstColumn,
      }),
    },
  ]);

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = normalizeXlsxFilename(args.filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resolveAnalyticsGradeColumns(
  gradeColumns: string[] | undefined,
  rows: Array<{ gradeCounts?: Record<string, number> }> = [],
) {
  const ordered = new Set<string>();
  (gradeColumns || []).forEach((grade) => {
    if (grade) ordered.add(grade);
  });
  rows.forEach((row) => {
    Object.keys(row.gradeCounts || {}).forEach((grade) => {
      if (grade) ordered.add(grade);
    });
  });
  return Array.from(ordered);
}

function downloadAnalyticsWorkbook(args: {
  analysisType: "Class Analytics" | "Stream Analytics";
  examName: string;
  contextLabel: string;
  gradeColumns: string[];
  rows: Array<{
    subjectName: string;
    teacherName?: string | null;
    avg: number;
    completion?: number;
    passed: number;
    failed: number;
    passRate: number;
    gradeCounts: Record<string, number>;
  }>;
}) {
  const headers = [
    "Subject",
    "Teacher",
    "Avg (%)",
    ...(args.analysisType === "Class Analytics" ? ["Completion (%)"] : []),
    "Passed",
    "Failed",
    "Pass Rate (%)",
    ...args.gradeColumns,
  ];

  const body = args.rows.map((row) => [
    row.subjectName,
    row.teacherName || "—",
    row.avg,
    ...(args.analysisType === "Class Analytics" ? [row.completion ?? ""] : []),
    row.passed,
    row.failed,
    row.passRate,
    ...args.gradeColumns.map((grade) => row.gradeCounts?.[grade] || 0),
  ]);

  const filename = `${sanitizeExcelFilePart(args.contextLabel)}_${sanitizeExcelFilePart(args.examName)}_${args.analysisType.replace(/\s+/g, "_")}.xlsx`;
  downloadExcelXmlWorkbook({
    filename,
    sheetName: args.analysisType,
    rows: [
      [`${args.contextLabel} — ${args.analysisType}`],
      [`Exam: ${args.examName}`],
      [],
      headers,
      ...body,
    ],
    boldRowIndexes: [0, 1],
    headerRowIndexes: [3],
  });
}

function formatStudentNameWithAdmission(studentName: string, admissionNo?: string | null) {
  const cleanName = String(studentName || "").trim() || "Unnamed Student";
  const cleanAdmission = String(admissionNo || "").trim();
  return cleanAdmission ? `${cleanName} (${cleanAdmission})` : cleanName;
}

function downloadMeritWorkbook(args: {
  meritType: "Class Merit List" | "Stream Merit List";
  examName: string;
  contextLabel: string;
  subjects: string[];
  showPointsColumn?: boolean;
  rows: Array<{
    studentName: string;
    admissionNo?: string | null;
    subjectMarks: ExcelCellValue[];
    total: ExcelCellValue;
    avg: ExcelCellValue;
    points?: ExcelCellValue;
    position: ExcelCellValue;
  }>;
}) {
  const headers = [
    "Student",
    ...args.subjects,
    "Total",
    "Average",
    ...(args.showPointsColumn ? ["Points"] : []),
    "Pos",
  ];
  const body = args.rows.map((row) => [
    formatStudentNameWithAdmission(row.studentName, row.admissionNo),
    ...row.subjectMarks,
    row.total,
    row.avg,
    ...(args.showPointsColumn ? [row.points ?? ""] : []),
    row.position,
  ]);

  const subjectColumnWidths = args.subjects.map((subject) =>
    Math.min(115, Math.max(48, String(subject || "").length * 7)),
  );
  const longestStudentLabel = body.reduce(
    (max, row) => Math.max(max, String(row[0] || "").length),
    "Student".length,
  );
  const studentColumnWidth = Math.min(240, Math.max(150, longestStudentLabel * 6));

  const filename = `${sanitizeExcelFilePart(args.contextLabel)}_${sanitizeExcelFilePart(args.examName)}_${args.meritType.replace(/\s+/g, "_")}.xlsx`;
  downloadExcelXmlWorkbook({
    filename,
    sheetName: args.meritType,
    rows: [
      [`${args.contextLabel} — ${args.meritType}`],
      [`Exam: ${args.examName}`],
      [],
      headers,
      ...body,
    ],
    boldRowIndexes: [0, 1],
    headerRowIndexes: [3],
    columnWidths: [
      studentColumnWidth,
      ...subjectColumnWidths,
      64,
      70,
      ...(args.showPointsColumn ? [58] : []),
      48,
    ],
    freezeFirstColumn: true,
  });
}


type ReportCommentGradeOption = {
  id: number;
  gradeName: string;
  gradeLevel: string;
  lowerLimit: number;
  upperLimit: number;
  gradePoints: number;
  gradeStatus: string | null;
  gradeType: string | null;
};

function formatReportCommentGradeLabel(grade: Pick<ReportCommentGradeOption, "gradeName" | "gradeStatus" | "lowerLimit" | "upperLimit">) {
  return `${grade.gradeName} (${grade.gradeStatus || "Unspecified"}) • ${grade.lowerLimit}% - ${grade.upperLimit}%`;
}
function normalizeReportCommentProfileToken(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function reportCommentGradeMatchesTab(gradeLevel: string | null | undefined, activeTab?: string | null) {
  return gradeProfileMatchesStrict(gradeLevel, activeTab);
}

function clampDisplayPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function ProgressBadge({
  pct,
  withMarksPct,
  acknowledgedPct,
  assessmentCreated = true,
  title,
}: {
  pct: number | null;
  withMarksPct?: number;
  acknowledgedPct?: number;
  assessmentCreated?: boolean;
  title?: string;
}) {
  if (!assessmentCreated) {
    return (
      <span
        className="inline-flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-muted-foreground/35 text-xl font-bold text-muted-foreground"
        title={title || "Assessment not created"}
        aria-label="Assessment not created"
      >
        ×
      </span>
    );
  }

  const safePct = clampDisplayPercent(pct) ?? 0;
  const green = Math.max(0, Math.min(100, clampDisplayPercent(withMarksPct) ?? safePct));
  const yellow = Math.max(0, Math.min(100 - green, clampDisplayPercent(acknowledgedPct) ?? 0));
  const background = `conic-gradient(#22c55e 0 ${green}%, #eab308 ${green}% ${green + yellow}%, hsl(var(--muted)) ${green + yellow}% 100%)`;

  return (
    <span
      className="relative inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
      style={{ background }}
      title={title || `${green}% with marks, ${yellow}% acknowledged not written, ${Math.max(0, 100 - green - yellow)}% not recorded`}
      data-testid="pill-progress"
    >
      <span className="absolute inset-[4px] rounded-full bg-background" />
      <span className="relative z-10 text-sm font-semibold">{safePct}%</span>
    </span>
  );
}

function ProgressLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground" aria-label="Recording progress key">
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-green-500" /> With marks</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-yellow-500" /> Acknowledged not written</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-muted" /> Not recorded</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 font-bold">×</span> Assessment not created</span>
    </div>
  );
}

function PublicationBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const published = status === "Published" || status === "Republished";
  return (
    <Badge className={published ? "bg-blue-600 text-white hover:bg-blue-600" : "bg-muted text-muted-foreground hover:bg-muted"}>
      {status}
    </Badge>
  );
}

function MissingMarksDialog({
  open,
  onOpenChange,
  examId,
  classId,
  className: classLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  examId: number;
  classId: number;
  className: string;
}) {
  const { data, isLoading } = useQuery<MissingMarkSubject[]>({
    queryKey: ["/api/report-hub/missing-marks", examId, classId],
    enabled: open && !!examId && !!classId,
  });

  const missingOnly = (data || []).filter((s) => s.missingCount > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>{classLabel} — Missing Marks</DialogTitle>
          <DialogDescription>
            Incomplete entries, partial papers, and offered subjects whose assessment has not been created.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : missingOnly.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <AlertTriangle className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No missing marks found — all subjects are complete.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {missingOnly.map((sub) => (
              <Card key={sub.subjectId}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold" data-testid={`text-missing-subject-${sub.subjectId}`}>{sub.subjectName}</span>
                      {sub.assessmentCreated === false && <Badge variant="secondary">Assessment not created</Badge>}
                    </div>
                    <span className="text-sm text-red-600 dark:text-red-400 font-medium">
                      {sub.missingCount}/{sub.totalStudents} missing
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {sub.missingStudents.map((s) => (
                      <div key={s.id} className="text-sm p-2 border rounded-md">
                        <div>{s.name}{s.admissionNo && <span className="text-muted-foreground ml-1">({s.admissionNo})</span>}</div>
                        {s.reason && <div className="mt-1 text-xs text-muted-foreground">{s.reason}</div>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ClassMeritDialog({
  open,
  onOpenChange,
  examId,
  classId,
  className: classLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  examId: number;
  classId: number;
  className: string;
}) {
  const { data, isLoading } = useQuery<MeritData>({
    queryKey: ["/api/report-hub/class-merit", examId, classId],
    enabled: open && !!examId && !!classId,
  });

  const effectiveClassName = data?.className || classLabel;
  const effectiveExamName = data?.examName || "Selected Exam";

  const handleDownloadExcel = () => {
    if (!data || data.rows.length === 0) return;
    downloadMeritWorkbook({
      meritType: "Class Merit List",
      examName: effectiveExamName,
      contextLabel: effectiveClassName,
      subjects: data.subjects.map((subject) => subject.name),
      showPointsColumn: !!data.showPointsColumn,
      rows: data.rows.map((row) => ({
        studentName: row.studentName,
        admissionNo: row.admissionNo,
        subjectMarks: data.subjects.map((subject) => {
          return formatMeritCellForDisplay(row, subject.id);
        }),
        total: row.totalDisplay || row.total,
        avg: row.avgDisplay || `${Math.round(row.avg)}%`,
        points: row.pointsDisplay ?? row.points ?? "",
        position: row.position,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-fit sm:w-fit min-w-[min(720px,calc(100dvw-2rem))] max-w-[calc(100dvw-2rem)] sm:max-w-[calc(100dvw-3rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
        <DialogHeader className="space-y-3 pr-10">
          <div>
            <DialogTitle>{effectiveClassName} — Merit List</DialogTitle>
            <DialogDescription>
              Sorted by average (missing marks count as 0)
            </DialogDescription>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap text-sm text-muted-foreground">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                <strong className="text-foreground">Class:</strong> {effectiveClassName}
              </span>
              <span>
                <strong className="text-foreground">Exam:</strong> {effectiveExamName}
              </span>
            </div>
            {!isLoading && data && data.rows.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleDownloadExcel}>
                <Download className="w-4 h-4 mr-2" />
                Download Excel
              </Button>
            )}
          </div>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Users className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No merit data available yet.</p>
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-md border">
            <table
              className="w-max text-sm border-collapse"
              data-testid="table-merit-list"
            >
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="sticky left-0 z-20 bg-muted/50 text-left px-2 py-2 font-semibold border-r whitespace-nowrap min-w-[220px]">Student</th>
                  {data.subjects.map((s) => (
                    <th key={s.id} className="text-center px-2 py-2 font-semibold border-r whitespace-nowrap">
                      {s.name}
                    </th>
                  ))}
                  <th className="text-center px-2 py-2 font-semibold border-r whitespace-nowrap">Total</th>
                  <th className="text-center px-2 py-2 font-semibold border-r whitespace-nowrap">Average</th>
                  {data.showPointsColumn && (
                    <th className="text-center px-2 py-2 font-semibold border-r whitespace-nowrap">Points</th>
                  )}
                  <th className="text-center px-2 py-2 font-semibold whitespace-nowrap">Pos</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, idx) => (
                  <tr key={idx} className="border-b bg-white dark:bg-background">
                    <td className="sticky left-0 z-10 bg-white dark:bg-background px-2 py-2 border-r whitespace-nowrap min-w-[220px]">
                      <div className="font-medium">{formatStudentNameWithAdmission(row.studentName, row.admissionNo)}</div>
                    </td>
                    {data.subjects.map((s) => (
                      <td key={s.id} className="text-center px-2 py-2 border-r whitespace-nowrap">
                        {formatMeritCellForDisplay(row, s.id)}
                      </td>
                    ))}
                    <td className="text-center px-2 py-2 border-r whitespace-nowrap">{row.totalDisplay || row.total}</td>
                    <td className="text-center px-2 py-2 border-r font-semibold whitespace-nowrap">
                      {row.avgDisplay || `${Math.round(row.avg)}%`}
                    </td>
                    {data.showPointsColumn && (
                      <td className="text-center px-2 py-2 border-r whitespace-nowrap">{row.pointsDisplay ?? row.points ?? "–"}</td>
                    )}
                    <td className="text-center px-2 py-2 whitespace-nowrap">{row.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ClassAnalyticsDialog({
  open,
  onOpenChange,
  examId,
  classId,
  className: classLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  examId: number;
  classId: number;
  className: string;
}) {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/report-hub/class-analytics", examId, classId],
    enabled: open && !!examId && !!classId,
  });

  const gradeColumns = useMemo(
    () => resolveAnalyticsGradeColumns(data?.gradeColumns, data?.subjectSummary),
    [data],
  );

  const effectiveClassName = data?.className || classLabel;
  const effectiveExamName = data?.examName || "Selected Exam";

  const handleDownloadExcel = () => {
    if (!data || data.subjectSummary.length === 0) return;
    downloadAnalyticsWorkbook({
      analysisType: "Class Analytics",
      examName: effectiveExamName,
      contextLabel: effectiveClassName,
      gradeColumns,
      rows: data.subjectSummary,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
        <DialogHeader className="space-y-3 pr-10">
          <div>
            <DialogTitle>{effectiveClassName} — Class Analytics</DialogTitle>
            <DialogDescription>
              Subject grade breakdown and pass rates for this class
            </DialogDescription>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap text-sm text-muted-foreground">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                <strong className="text-foreground">Class:</strong> {effectiveClassName}
              </span>
              <span>
                <strong className="text-foreground">Exam:</strong> {effectiveExamName}
              </span>
            </div>
            {!isLoading && data && data.subjectSummary.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleDownloadExcel}>
                <Download className="w-4 h-4 mr-2" />
                Download Excel
              </Button>
            )}
          </div>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !data ? (
          <div className="py-8 text-center text-muted-foreground">
            No data available.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold">{data.overallAvg}%</div>
                  <div className="text-xs text-muted-foreground">
                    Overall Average
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold">{data.completion}%</div>
                  <div className="text-xs text-muted-foreground">
                    Completion
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold">{data.totalStudents}</div>
                  <div className="text-xs text-muted-foreground">Students</div>
                </CardContent>
              </Card>
            </div>


            {data.subjectSummary.length > 0 && (
              <div>
                <h4 className="font-semibold mb-2">Subject Summary</h4>
                <div className="overflow-x-auto">
                  <table
                    className="w-full text-sm border-collapse"
                    data-testid="table-analytics-subjects"
                  >
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2">Subject</th>
                        <th className="text-left p-2">Teacher</th>
                        <th className="text-center p-2">Avg</th>
                        <th className="text-center p-2">Completion</th>
                        <th className="text-center p-2">Passed</th>
                        <th className="text-center p-2">Failed</th>
                        <th className="text-center p-2">Pass Rate</th>
                        {gradeColumns.map((grade) => (
                          <th key={grade} className="text-center p-2">
                            {grade}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.subjectSummary.map((s) => (
                        <tr key={s.subjectId} className="border-b">
                          <td className="p-2">{s.subjectName}</td>
                          <td className="p-2">{s.teacherName || "—"}</td>
                          <td className="text-center p-2 font-semibold">
                            {s.avg}%
                          </td>
                          <td className="text-center p-2">{s.completion}%</td>
                          <td className="text-center p-2 text-green-600 dark:text-green-400">
                            {s.passed}
                          </td>
                          <td className="text-center p-2 text-red-600 dark:text-red-400">
                            {s.failed}
                          </td>
                          <td className="text-center p-2">{s.passRate}%</td>
                          {gradeColumns.map((grade) => (
                            <td key={grade} className="text-center p-2">
                              {s.gradeCounts?.[grade] || 0}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StreamMeritDialog({
  open,
  onOpenChange,
  examId,
  streamId,
  streamName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  examId: number;
  streamId: number;
  streamName: string;
}) {
  const { data, isLoading } = useQuery<StreamMeritData>({
    queryKey: ["/api/report-hub/stream-merit", examId, streamId],
    enabled: open && !!examId && !!streamId,
  });

  const effectiveStreamName = data?.streamName || streamName;
  const effectiveExamName = data?.examName || "Selected Exam";

  const handleDownloadExcel = () => {
    if (!data || data.rows.length === 0) return;
    downloadMeritWorkbook({
      meritType: "Stream Merit List",
      examName: effectiveExamName,
      contextLabel: effectiveStreamName,
      subjects: data.subjects,
      showPointsColumn: !!data.showPointsColumn,
      rows: data.rows.map((row) => ({
        studentName: row.studentName,
        admissionNo: row.admissionNo,
        subjectMarks: row.subjectMarks,
        total: row.total,
        avg: row.avg,
        points: row.points ?? "",
        position: row.position,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-fit sm:w-fit min-w-[min(720px,calc(100dvw-2rem))] max-w-[calc(100dvw-2rem)] sm:max-w-[calc(100dvw-3rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
        <DialogHeader className="space-y-3 pr-10">
          <div>
            <DialogTitle>{effectiveStreamName} — Stream Merit List</DialogTitle>
            <DialogDescription>
              Top students across all classes in this stream
            </DialogDescription>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap text-sm text-muted-foreground">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                <strong className="text-foreground">Stream:</strong> {effectiveStreamName}
              </span>
              <span>
                <strong className="text-foreground">Exam:</strong> {effectiveExamName}
              </span>
            </div>
            {!isLoading && data && data.rows.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleDownloadExcel}>
                <Download className="w-4 h-4 mr-2" />
                Download Excel
              </Button>
            )}
          </div>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Trophy className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No merit data available.</p>
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-md border">
            <table
              className="w-max text-sm border-collapse"
              data-testid="table-stream-merit"
            >
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="sticky left-0 z-20 bg-muted/50 text-left px-2 py-2 font-semibold border-r whitespace-nowrap min-w-[220px]">Student</th>
                  {data.subjects.map((s, i) => (
                    <th key={i} className="text-center px-2 py-2 font-semibold border-r whitespace-nowrap">
                      {s}
                    </th>
                  ))}
                  <th className="text-center px-2 py-2 font-semibold border-r whitespace-nowrap">Total</th>
                  <th className="text-center px-2 py-2 font-semibold border-r whitespace-nowrap">Average</th>
                  {data.showPointsColumn && (
                    <th className="text-center px-2 py-2 font-semibold border-r whitespace-nowrap">Points</th>
                  )}
                  <th className="text-center px-2 py-2 font-semibold whitespace-nowrap">Pos</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, idx) => (
                  <tr key={idx} className="border-b bg-white dark:bg-background">
                    <td className="sticky left-0 z-10 bg-white dark:bg-background px-2 py-2 border-r whitespace-nowrap min-w-[220px]">
                      <div className="font-medium">{formatStudentNameWithAdmission(row.studentName, row.admissionNo)}</div>
                    </td>
                    {row.subjectMarks.map((val, i) => (
                      <td key={i} className="text-center px-2 py-2 border-r whitespace-nowrap">
                        {val || "-"}
                      </td>
                    ))}
                    <td className="text-center px-2 py-2 border-r whitespace-nowrap">{row.total}</td>
                    <td className="text-center px-2 py-2 border-r font-semibold whitespace-nowrap">{row.avg}</td>
                    {data.showPointsColumn && (
                      <td className="text-center px-2 py-2 border-r whitespace-nowrap">{row.points ?? "–"}</td>
                    )}
                    <td className="text-center px-2 py-2 whitespace-nowrap">{row.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StreamAnalyticsDialog({
  open,
  onOpenChange,
  examId,
  streamId,
  streamName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  examId: number;
  streamId: number;
  streamName: string;
}) {
  const { data, isLoading } = useQuery<StreamAnalyticsData>({
    queryKey: ["/api/report-hub/stream-analytics", examId, streamId],
    enabled: open && !!examId && !!streamId,
  });

  const gradeColumns = useMemo(
    () => resolveAnalyticsGradeColumns(data?.gradeColumns, data?.rows),
    [data],
  );

  const effectiveStreamName = data?.streamName || streamName;
  const effectiveExamName = data?.examName || "Selected Exam";

  const handleDownloadExcel = () => {
    if (!data || data.rows.length === 0) return;
    downloadAnalyticsWorkbook({
      analysisType: "Stream Analytics",
      examName: effectiveExamName,
      contextLabel: effectiveStreamName,
      gradeColumns,
      rows: data.rows,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
        <DialogHeader className="space-y-3 pr-10">
          <div>
            <DialogTitle>{effectiveStreamName} — Stream Analytics</DialogTitle>
            <DialogDescription>
              Subject grade breakdown and pass rates across the stream
            </DialogDescription>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap text-sm text-muted-foreground">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                <strong className="text-foreground">Stream:</strong> {effectiveStreamName}
              </span>
              <span>
                <strong className="text-foreground">Exam:</strong> {effectiveExamName}
              </span>
            </div>
            {!isLoading && data && data.rows.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleDownloadExcel}>
                <Download className="w-4 h-4 mr-2" />
                Download Excel
              </Button>
            )}
          </div>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No analytics data available.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm border-collapse"
              data-testid="table-stream-analytics"
            >
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 font-semibold">Subject</th>
                  <th className="text-left p-2 font-semibold">Teacher</th>
                  <th className="text-center p-2 font-semibold">Avg</th>
                  <th className="text-center p-2 font-semibold">Passed</th>
                  <th className="text-center p-2 font-semibold">Failed</th>
                  <th className="text-center p-2 font-semibold">Pass Rate</th>
                  {gradeColumns.map((grade) => (
                    <th key={grade} className="text-center p-2 font-semibold">
                      {grade}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.subjectId} className="border-b">
                    <td className="p-2">{row.subjectName}</td>
                    <td className="p-2">{row.teacherName || "—"}</td>
                    <td className="text-center p-2 font-semibold">
                      {row.avg}%
                    </td>
                    <td className="text-center p-2 text-green-600 dark:text-green-400">
                      {row.passed}
                    </td>
                    <td className="text-center p-2 text-red-600 dark:text-red-400">
                      {row.failed}
                    </td>
                    <td className="text-center p-2">{row.passRate}%</td>
                    {gradeColumns.map((grade) => (
                      <td key={grade} className="text-center p-2">
                        {row.gradeCounts?.[grade] || 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExamStreamTable({
  exam,
  onNavigateClassLevel,
  onNavigateReports,
  onOpenStreamModal,
  showTitle = true,
}: {
  exam: Exam;
  onNavigateClassLevel: (
    examId: string,
    examName: string,
    streamId: number,
    streamName: string,
  ) => void;
  onNavigateReports: (
    examId: string,
    classId: string,
    className: string,
  ) => void;
  onOpenStreamModal: (
    examId: number,
    streamId: number,
    streamName: string,
    modal: "merit" | "analytics",
  ) => void;
  showTitle?: boolean;
}) {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canPublishStream = hasPermission("academic_reports.publish.stream");
  const canUnpublish = hasPermission("academic_reports.unpublish");
  const canSendStream = hasPermission("academic_reports.send.stream");

  const { data: streamStats, isLoading } = useQuery<StreamStat[]>({
    queryKey: ["/api/report-hub/stream-stats", String(exam.id)],
  });

  const publicationMutation = useMutation({
    mutationFn: async (payload: { streamId: number; publish: boolean; reason?: string }) => {
      const response = await apiRequest("POST", "/api/report-hub/publication/stream", {
        examId: exam.id,
        ...payload,
      });
      return response.json();
    },
    onSuccess: async (result: any, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/report-hub/stream-stats", String(exam.id)] }),
        queryClient.invalidateQueries({ queryKey: ["/api/report-hub/publication-status", exam.id] }),
        queryClient.invalidateQueries({ queryKey: ["/api/report-hub/class-progress"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marks-entry"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/report-cards"] }),
      ]);
      toast({
        title: variables.publish ? "Results published" : "Results unpublished",
        description: variables.publish
          ? `${result.changedClassIds?.length || 0} class${result.changedClassIds?.length === 1 ? "" : "es"} updated.`
          : "Teachers can edit the affected results again.",
      });
    },
    onError: (error: any) => toast({ title: "Unable to update publication", description: error?.message || "Please try again.", variant: "destructive" }),
  });

  const sendStreamMutation = useMutation({
    mutationFn: async (stat: StreamStat) => {
      const publishedClasses = stat.classes.filter((classInfo) => classInfo.isPublished);
      const results: any[] = [];
      for (const classInfo of publishedClasses) {
        const response = await apiRequest("POST", "/api/report-cards/send-all", {
          examId: exam.id,
          classId: classInfo.id,
          source: "stream",
          streamId: stat.streamId,
        });
        results.push(await response.json());
      }
      return { count: publishedClasses.length, results };
    },
    onSuccess: (result) => toast({
      title: "Report cards queued",
      description: `Reports were queued for ${result.count} published class${result.count === 1 ? "" : "es"}.`,
    }),
    onError: (error: any) => toast({ title: "Unable to send reports", description: error?.message || "Please try again.", variant: "destructive" }),
  });

  const changeStreamPublication = (stat: StreamStat) => {
    const requiredPermission = stat.allPublished
      ? "academic_reports.unpublish"
      : "academic_reports.publish.stream";
    if (!hasPermission(requiredPermission)) {
      toast({
        title: "Permission required",
        description: `Ask an administrator to grant ${requiredPermission} to your access group. Sign in again after the permission is assigned.`,
        variant: "destructive",
      });
      return;
    }

    if (stat.allPublished) {
      const reason = window.prompt(`Reason for unpublishing ${exam.examName} for ${stat.streamName}:`);
      if (!reason?.trim()) return;
      if (!window.confirm(`Unpublish ${exam.examName} for all ${stat.classCount} classes in ${stat.streamName}? Teachers will be able to modify marks again.`)) return;
      publicationMutation.mutate({ streamId: stat.streamId, publish: false, reason: reason.trim() });
      return;
    }

    const remaining = Math.max(0, stat.classCount - stat.publishedCount);
    const warning = [
      `Publish ${exam.examName} for ${stat.streamName}?`,
      `${remaining} remaining class${remaining === 1 ? "" : "es"} will be published.`,
      `${stat.assessmentCreatedCount} assessment${stat.assessmentCreatedCount === 1 ? "" : "s"} created; ${stat.assessmentMissingCount} offered subject${stat.assessmentMissingCount === 1 ? "" : "s"} without an assessment.`,
      `${stat.withMarksCount} entries have marks and ${stat.acknowledgedCount} are acknowledged not written.`,
      stat.partialCount + stat.unrecordedCount > 0
        ? `Warning: ${stat.partialCount + stat.unrecordedCount} learner-subject entr${stat.partialCount + stat.unrecordedCount === 1 ? "y has" : "ies have"} neither a completed mark nor an absent, sick, or excused status. Those subject rows will not appear on report cards. Confirming will publish anyway.`
        : "All expected learner-subject entries have a completed mark or an acknowledged not-written status.",
      "Publishing locks marks and assessment structure and makes the results visible in student and parent portals.",
    ].join("\n\n");
    if (window.confirm(warning)) publicationMutation.mutate({ streamId: stat.streamId, publish: true });
  };

  const sendStreamReports = (stat: StreamStat) => {
    if (!stat.publishedCount) return;
    if (!canSendStream) {
      toast({
        title: "Permission required",
        description: "Ask an administrator to grant academic_reports.send.stream to your access group. Sign in again after the permission is assigned.",
        variant: "destructive",
      });
      return;
    }
    if (!window.confirm(`Send report cards for the ${stat.publishedCount} published class${stat.publishedCount === 1 ? "" : "es"} in ${stat.streamName}? Unpublished classes will be excluded.`)) return;
    sendStreamMutation.mutate(stat);
  };

  if (isLoading) {
    return (
      <div className={showTitle ? "mb-8" : "mb-0"}>
        {showTitle && (
          <h3 className="text-center font-semibold text-sm uppercase mb-3 text-foreground" data-testid={`text-exam-title-${exam.id}`}>{exam.examName}</h3>
        )}
        <Card><CardContent className="p-4"><Skeleton className="h-40 w-full" /></CardContent></Card>
      </div>
    );
  }

  const activeStats = (streamStats || []).filter((stat) => stat.classCount > 0);
  if (!activeStats.length) return null;

  return (
    <div className={showTitle ? "mb-8" : "mb-0"} data-testid={`section-exam-${exam.id}`}>
      {showTitle && (
        <h3 className="text-center font-semibold text-sm uppercase mb-3 text-foreground" data-testid={`text-exam-title-${exam.id}`}>{exam.examName}</h3>
      )}
      <div className="overflow-hidden" style={{ border: "1.5px solid rgba(27, 42, 92, 0.25)", borderRadius: "14px" }}>
        <div
          className="max-w-full overflow-x-auto overscroll-x-contain"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}
          data-testid={`scroll-stream-hub-${exam.id}`}
        >
          <table className="w-full min-w-[600px] table-fixed text-sm sm:min-w-[760px]" style={{ borderCollapse: "separate", borderSpacing: 0 }} data-testid={`table-stream-hub-${exam.id}`}>
            <colgroup>
              <col className="w-[190px]" />
              <col className="w-[100px]" />
              <col className="w-[85px]" />
              <col className="w-[225px]" />
            </colgroup>
            <thead>
              <tr className="border-b" style={{ backgroundColor: "rgba(27, 42, 92, 0.1)" }}>
                <th className="px-2 py-2 text-left font-semibold sm:p-3">Stream</th>
                <th className="px-2 py-2 text-center font-semibold sm:p-3">Progress</th>
                <th className="px-2 py-2 text-center font-semibold sm:p-3">Avg Mark</th>
                <th className="px-2 py-2 text-right font-semibold sm:p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeStats.map((stat) => {
                const avgLabel = stat.avgPct !== null ? `${stat.avgPct}%` : "–";
                const actionIsUnpublish = stat.allPublished;
                const hasPublicationPermission = actionIsUnpublish ? canUnpublish : canPublishStream;
                return (
                  <tr key={stat.streamId} className="border-b" data-testid={`row-stream-${exam.id}-${stat.streamId}`}>
                    <td className="px-2 py-2 align-middle sm:p-3">
                      <div className="font-medium">{stat.streamName}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <PublicationBadge status={stat.publicationStatus} />
                        {stat.anyPublished && !stat.allPublished && <span className="text-xs text-muted-foreground">{stat.publishedCount} of {stat.classCount} classes</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center align-middle sm:p-3">
                      <ProgressBadge pct={stat.progressPct} withMarksPct={stat.withMarksPct} acknowledgedPct={stat.acknowledgedPct} />
                    </td>
                    <td className="px-2 py-2 text-center align-middle sm:p-3">
                      <span className={`font-semibold ${stat.avgPct === null ? "text-muted-foreground" : stat.avgPct >= 80 ? "text-green-600 dark:text-green-400" : stat.avgPct >= 40 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>{avgLabel}</span>
                    </td>
                    <td className="px-2 py-2 text-right align-middle sm:p-3">
                      <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" data-testid={`button-options-${exam.id}-${stat.streamId}`}>Options <ChevronDown className="w-3 h-3 ml-1" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[230px]">
                            <DropdownMenuItem
                              onClick={() => changeStreamPublication(stat)}
                              disabled={publicationMutation.isPending}
                              title={!hasPublicationPermission ? `Requires ${actionIsUnpublish ? "academic_reports.unpublish" : "academic_reports.publish.stream"}` : undefined}
                              data-testid={`button-publish-stream-${exam.id}-${stat.streamId}`}
                            >
                              {actionIsUnpublish ? <Unlock className="w-4 h-4 mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                              {actionIsUnpublish ? "Unpublish" : "Publish"}
                              {!hasPublicationPermission && <span className="ml-auto text-[10px] text-muted-foreground">Permission required</span>}
                            </DropdownMenuItem>
                            {stat.anyPublished && (
                              <DropdownMenuItem
                                onClick={() => sendStreamReports(stat)}
                                disabled={sendStreamMutation.isPending}
                                title={!canSendStream ? "Requires academic_reports.send.stream" : undefined}
                                data-testid={`button-send-stream-${exam.id}-${stat.streamId}`}
                              >
                                <Send className="w-4 h-4 mr-2" /> Send Report{stat.anyPublished && !stat.allPublished ? ` — ${stat.publishedCount} published classes` : ""}
                                {!canSendStream && <span className="ml-auto text-[10px] text-muted-foreground">Permission required</span>}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => onNavigateClassLevel(String(exam.id), exam.examName, stat.streamId, stat.streamName)} data-testid={`button-class-level-${exam.id}-${stat.streamId}`}>
                              <Eye className="w-4 h-4 mr-2" /> View at Class Level
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onOpenStreamModal(exam.id, stat.streamId, stat.streamName, "merit")} data-testid={`button-stream-merit-${exam.id}-${stat.streamId}`}>
                              <Trophy className="w-4 h-4 mr-2" /> Stream Merit List
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onOpenStreamModal(exam.id, stat.streamId, stat.streamName, "analytics")} data-testid={`button-stream-analytics-${exam.id}-${stat.streamId}`}>
                              <BarChart3 className="w-4 h-4 mr-2" /> Stream Analytics
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="text-white border-[#1b2a5c] no-default-hover-elevate" style={{ backgroundColor: "#1b2a5c" }} data-testid={`button-reports-${exam.id}-${stat.streamId}`}>
                              <FileText className="w-4 h-4 mr-1" /> Reports <ChevronDown className="w-3 h-3 ml-1" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[180px]">
                            {stat.classes.map((classInfo) => (
                              <DropdownMenuItem key={classInfo.id} onClick={() => onNavigateReports(String(exam.id), String(classInfo.id), classInfo.name)} data-testid={`button-report-class-${exam.id}-${classInfo.id}`}>
                                <School className="w-4 h-4 mr-2" /> {classInfo.name}{classInfo.isPublished ? " • Published" : ""}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t px-3 py-2"><ProgressLegend /></div>
      </div>
    </div>
  );
}


type ExamStreamAccordionProps = {
  exams: Exam[];
  onNavigateClassLevel: (
    examId: string,
    examName: string,
    streamId: number,
    streamName: string,
  ) => void;
  onNavigateReports: (
    examId: string,
    classId: string,
    className: string,
  ) => void;
  onOpenStreamModal: (
    examId: number,
    streamId: number,
    streamName: string,
    modal: "merit" | "analytics",
  ) => void;
};

function ExamStreamAccordion({
  exams,
  onNavigateClassLevel,
  onNavigateReports,
  onOpenStreamModal,
}: ExamStreamAccordionProps) {
  const [openExamId, setOpenExamId] = useState<number | null>(null);

  useEffect(() => {
    if (openExamId !== null && !exams.some((exam) => Number(exam.id) === Number(openExamId))) {
      setOpenExamId(null);
    }
  }, [exams, openExamId]);

  return (
    <div className="space-y-3">
      {exams.map((exam) => {
        const isOpen = Number(openExamId) === Number(exam.id);
        return (
          <div
            key={exam.id}
            className="overflow-hidden rounded-xl border bg-card"
            data-testid={`accordion-exam-${exam.id}`}
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-muted/40 sm:px-4"
              onClick={() => setOpenExamId(isOpen ? null : Number(exam.id))}
              aria-expanded={isOpen}
              data-testid={`button-toggle-exam-${exam.id}`}
            >
              <span className="font-semibold text-sm uppercase text-foreground">{exam.examName}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && (
              <div className="border-t p-2 sm:p-3">
                <ExamStreamTable
                  exam={exam}
                  onNavigateClassLevel={onNavigateClassLevel}
                  onNavigateReports={onNavigateReports}
                  onOpenStreamModal={onOpenStreamModal}
                  showTitle={false}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AcademicReportsPage() {
  const { currentSchoolId, user, hasPermission } = useAuth();
  const schoolScopeId = currentSchoolId || user?.schoolId || null;
  const { toast } = useToast();
  const canSendClassReports = hasPermission("academic_reports.send.class");

  const [viewMode, setViewMode] = useState<ViewMode>("hub");
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [selectedExamName, setSelectedExamName] = useState<string>("");
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedClassName, setSelectedClassName] = useState<string>("");
  const [selectedStreamId, setSelectedStreamId] = useState<number | null>(null);
  const [selectedStreamName, setSelectedStreamName] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [downloadingFiltered, setDownloadingFiltered] = useState(false);
  const [pdfStage, setPdfStage] = useState<"idle" | "saving" | "generating">("idle");
  const [reportCardCommentDrafts, setReportCardCommentDrafts] =
    useState<ReportCardCommentDraftMap>({});
  const [, setReportCardCommentPools] =
    useState<ReportCardCommentDraftMap>({});
  const [reportCardCommentStatuses, setReportCardCommentStatuses] =
    useState<Record<string, ReportCardCommentStatus>>({});
  const reportCardCommentPoolsRef = useRef<ReportCardCommentDraftMap>({});
  const reportCardCommentTimeoutsRef = useRef<Record<string, number>>({});
  const [reportCardSubjectCommentDrafts, setReportCardSubjectCommentDrafts] =
    useState<ReportCardSubjectCommentDraftMap>({});
  const [reportCardSubjectCommentStatuses, setReportCardSubjectCommentStatuses] =
    useState<Record<string, ReportCardCommentStatus>>({});
  const reportCardSubjectCommentPoolsRef = useRef<ReportCardSubjectCommentDraftMap>({});
  const reportCardSubjectCommentTimeoutsRef = useRef<Record<string, number>>({});

  const [missingMarksOpen, setMissingMarksOpen] = useState(false);
  const [meritOpen, setMeritOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [streamMeritOpen, setStreamMeritOpen] = useState(false);
  const [streamAnalyticsOpen, setStreamAnalyticsOpen] = useState(false);
  const [principalCommentsOpen, setPrincipalCommentsOpen] = useState(false);
  const [classTeacherCommentsOpen, setClassTeacherCommentsOpen] =
    useState(false);
  const [modalExamId, setModalExamId] = useState(0);
  const [modalClassId, setModalClassId] = useState(0);
  const [modalClassName, setModalClassName] = useState("");
  const [modalStreamId, setModalStreamId] = useState(0);
  const [modalStreamName, setModalStreamName] = useState("");

  const { data: assessmentTypes = [], isLoading: atLoading } = useQuery<
    AssessmentType[]
  >({
    queryKey: ["/api/assessment-types"],
    enabled: !!schoolScopeId,
  });

  const { data: exams = [], isLoading: examsLoading } = useQuery<Exam[]>({
    queryKey: ["/api/report-cards/exams"],
    enabled: !!schoolScopeId,
  });

  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
    enabled: !!schoolScopeId,
  });

  const { data: currentSchool } = useQuery<any>({
    queryKey: ["/api/schools/current", schoolScopeId],
    enabled: !!schoolScopeId,
    queryFn: async () => {
      const res = await fetch("/api/schools/current", {
        credentials: "include",
        headers: schoolScopeId ? { "X-School-Id": String(schoolScopeId) } : undefined,
      });
      if (!res.ok) throw new Error("Failed to load current school");
      return res.json();
    },
  });
  const isPrimarySchool = normalizeSchoolType(currentSchool?.schoolType) === "primary";

  const { data: reportCardData, isLoading: reportLoading } =
    useQuery<ReportCardData>({
      queryKey: ["/api/report-cards", selectedExamId, "class", selectedClassId],
      enabled:
        viewMode === "report-cards" && !!selectedExamId && !!selectedClassId,
      staleTime: 0,
      refetchOnMount: "always",
    });

  const filteredStudents = useMemo(() => {
    if (!reportCardData) return [];
    if (!searchTerm.trim()) return reportCardData.reportCards;
    const term = searchTerm.toLowerCase();
    return reportCardData.reportCards.filter((rc) => {
      const name =
        `${rc.student.firstName} ${rc.student.lastName}`.toLowerCase();
      const adm = (rc.student.admissionNo || "").toLowerCase();
      return name.includes(term) || adm.includes(term);
    });
  }, [reportCardData, searchTerm]);


  useEffect(() => {
    if (!reportCardData) {
      setReportCardCommentDrafts({});
      setReportCardCommentPools({});
      setReportCardCommentStatuses({});
      reportCardCommentPoolsRef.current = {};
      setReportCardSubjectCommentDrafts({});
      setReportCardSubjectCommentStatuses({});
      reportCardSubjectCommentPoolsRef.current = {};
      return;
    }

    const nextDrafts: ReportCardCommentDraftMap = {};
    const nextPools: ReportCardCommentDraftMap = {};
    const nextSubjectDrafts: ReportCardSubjectCommentDraftMap = {};
    const nextSubjectPools: ReportCardSubjectCommentDraftMap = {};
    for (const rc of reportCardData.reportCards) {
      nextDrafts[rc.student.id] = {
        principal: rc.principalComment || "",
        class_teacher: rc.classTeacherComment || "",
      };
      nextPools[rc.student.id] = {
        principal: rc.principalCommentPool || "",
        class_teacher: rc.classTeacherCommentPool || "",
      };
      for (const subject of rc.subjects) {
        const key = `${rc.student.id}:${subject.assessmentId ?? `subject-${subject.subjectId}`}`;
        nextSubjectDrafts[key] = subject.comment || "";
        nextSubjectPools[key] = subject.commentPool || "";
      }
    }
    setReportCardCommentDrafts(nextDrafts);
    setReportCardCommentPools(nextPools);
    reportCardCommentPoolsRef.current = nextPools;
    setReportCardCommentStatuses({});
    setReportCardSubjectCommentDrafts(nextSubjectDrafts);
    setReportCardSubjectCommentStatuses({});
    reportCardSubjectCommentPoolsRef.current = nextSubjectPools;
  }, [reportCardData]);

  useEffect(() => {
    return () => {
      Object.values(reportCardCommentTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      Object.values(reportCardSubjectCommentTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
    };
  }, []);

  const saveReportCardCommentOverride = async (
    studentId: number,
    commentType: ReportCardCommentType,
    value: string,
  ): Promise<boolean> => {
    if (!selectedExamId) return true;

    const statusKey = `${studentId}:${commentType}`;
    setReportCardCommentStatuses((prev) => ({
      ...prev,
      [statusKey]: "saving",
    }));

    try {
      await apiRequest("POST", "/api/report-card-comment-overrides", {
        examId: Number(selectedExamId),
        studentId,
        commentType,
        commentText: value,
      });

      if (!value.trim()) {
        const fallback = reportCardCommentPoolsRef.current[studentId]?.[commentType] || "";
        setReportCardCommentDrafts((prev) => ({
          ...prev,
          [studentId]: {
            principal: prev[studentId]?.principal || "",
            class_teacher: prev[studentId]?.class_teacher || "",
            [commentType]: fallback,
          },
        }));
      }

      setReportCardCommentStatuses((prev) => ({
        ...prev,
        [statusKey]: "saved",
      }));
      return true;
    } catch (error: any) {
      setReportCardCommentStatuses((prev) => ({
        ...prev,
        [statusKey]: "error",
      }));
      toast({
        title: "Autosave failed",
        description: error?.message || "Failed to save report card comment.",
        variant: "destructive",
      });
      return false;
    }
  };

  const getSubjectDraftKey = (
    studentId: number,
    subject: Pick<ReportSubject, "assessmentId" | "subjectId">,
  ) => `${studentId}:${subject.assessmentId ?? `subject-${subject.subjectId}`}`;

  const saveReportCardSubjectComment = async (
    studentId: number,
    subject: Pick<ReportSubject, "assessmentId" | "subjectId">,
    value: string,
  ): Promise<boolean> => {
    const statusKey = getSubjectDraftKey(studentId, subject);
    setReportCardSubjectCommentStatuses((prev) => ({
      ...prev,
      [statusKey]: "saving",
    }));

    try {
      const response = await apiRequest("POST", "/api/report-card-subject-comments", {
        studentId,
        assessmentId: subject.assessmentId ?? null,
        subjectId: subject.subjectId,
        examId: selectedExamId ? Number(selectedExamId) : null,
        classId: selectedClassId ? Number(selectedClassId) : null,
        commentText: value,
      });
      const result = await response.json();
      const resolvedComment = typeof result?.commentText === "string" ? result.commentText : "";
      const resolvedPool = typeof result?.commentPool === "string" ? result.commentPool : "";

      reportCardSubjectCommentPoolsRef.current = {
        ...reportCardSubjectCommentPoolsRef.current,
        [statusKey]: resolvedPool,
      };

      setReportCardSubjectCommentDrafts((prev) => ({
        ...prev,
        [statusKey]: resolvedComment,
      }));
      setReportCardSubjectCommentStatuses((prev) => ({
        ...prev,
        [statusKey]: "saved",
      }));
      return true;
    } catch (error: any) {
      setReportCardSubjectCommentStatuses((prev) => ({
        ...prev,
        [statusKey]: "error",
      }));
      toast({
        title: "Autosave failed",
        description: error?.message || "Failed to save subject comment.",
        variant: "destructive",
      });
      return false;
    }
  };

  const handleReportCardSubjectCommentChange = (
    studentId: number,
    subject: Pick<ReportSubject, "assessmentId" | "subjectId">,
    value: string,
  ) => {
    const statusKey = getSubjectDraftKey(studentId, subject);

    setReportCardSubjectCommentDrafts((prev) => ({
      ...prev,
      [statusKey]: value,
    }));
    setReportCardSubjectCommentStatuses((prev) => ({
      ...prev,
      [statusKey]: "idle",
    }));

    const existingTimeout = reportCardSubjectCommentTimeoutsRef.current[statusKey];
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    reportCardSubjectCommentTimeoutsRef.current[statusKey] = window.setTimeout(() => {
      void saveReportCardSubjectComment(studentId, subject, value);
    }, 700);
  };

  const handleReportCardCommentChange = (
    studentId: number,
    commentType: ReportCardCommentType,
    value: string,
  ) => {
    setReportCardCommentDrafts((prev) => ({
      ...prev,
      [studentId]: {
        principal: prev[studentId]?.principal || "",
        class_teacher: prev[studentId]?.class_teacher || "",
        [commentType]: value,
      },
    }));

    const statusKey = `${studentId}:${commentType}`;
    setReportCardCommentStatuses((prev) => ({
      ...prev,
      [statusKey]: "idle",
    }));

    const existingTimeout = reportCardCommentTimeoutsRef.current[statusKey];
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    reportCardCommentTimeoutsRef.current[statusKey] = window.setTimeout(() => {
      void saveReportCardCommentOverride(studentId, commentType, value);
    }, 700);
  };


  const flushPendingReportChanges = async (studentIds: number[]) => {
    if (!reportCardData || reportCardData.publication?.isPublished) return;
    if (!selectedExamId || !selectedClassId) return;
    setPdfStage("saving");
    const selected = new Set(studentIds);

    for (const [key, timeoutId] of Object.entries(reportCardCommentTimeoutsRef.current)) {
      const studentId = Number(key.split(":", 1)[0]);
      if (selected.has(studentId)) {
        window.clearTimeout(timeoutId as number);
        delete reportCardCommentTimeoutsRef.current[key];
      }
    }
    for (const [key, timeoutId] of Object.entries(reportCardSubjectCommentTimeoutsRef.current)) {
      const studentId = Number(key.split(":", 1)[0]);
      if (selected.has(studentId)) {
        window.clearTimeout(timeoutId as number);
        delete reportCardSubjectCommentTimeoutsRef.current[key];
      }
    }

    const overall: Array<{
      studentId: number;
      commentType: ReportCardCommentType;
      commentText: string;
    }> = [];
    const subjectsToSave: Array<{
      studentId: number;
      assessmentId: number;
      subjectId: number;
      commentText: string;
      draftKey: string;
    }> = [];

    for (const report of reportCardData.reportCards) {
      if (!selected.has(report.student.id)) continue;
      const comments = reportCardCommentDrafts[report.student.id];
      if (comments) {
        for (const commentType of ["principal", "class_teacher"] as const) {
          const statusKey = `${report.student.id}:${commentType}`;
          const status = reportCardCommentStatuses[statusKey];
          if (status && status !== "saved") {
            overall.push({
              studentId: report.student.id,
              commentType,
              commentText: comments[commentType] || "",
            });
          }
        }
      }
      for (const subject of report.subjects) {
        const draftKey = getSubjectDraftKey(report.student.id, subject);
        const status = reportCardSubjectCommentStatuses[draftKey];
        if (status && status !== "saved" && subject.assessmentId) {
          subjectsToSave.push({
            studentId: report.student.id,
            assessmentId: subject.assessmentId,
            subjectId: subject.subjectId,
            commentText: reportCardSubjectCommentDrafts[draftKey] ?? subject.comment ?? "",
            draftKey,
          });
        }
      }
    }

    if (!overall.length && !subjectsToSave.length) return;

    setReportCardCommentStatuses((previous) => {
      const next = { ...previous };
      overall.forEach((row) => { next[`${row.studentId}:${row.commentType}`] = "saving"; });
      return next;
    });
    setReportCardSubjectCommentStatuses((previous) => {
      const next = { ...previous };
      subjectsToSave.forEach((row) => { next[row.draftKey] = "saving"; });
      return next;
    });

    try {
      const response = await apiRequest("POST", "/api/report-card-comments/bulk", {
        examId: Number(selectedExamId),
        classId: Number(selectedClassId),
        overall,
        subjects: subjectsToSave.map(({ draftKey: _draftKey, ...row }) => row),
      });
      const result = await response.json();

      setReportCardCommentStatuses((previous) => {
        const next = { ...previous };
        overall.forEach((row) => { next[`${row.studentId}:${row.commentType}`] = "saved"; });
        return next;
      });
      setReportCardSubjectCommentStatuses((previous) => {
        const next = { ...previous };
        subjectsToSave.forEach((row) => { next[row.draftKey] = "saved"; });
        return next;
      });

      const subjectResults = Array.isArray(result?.subjects) ? result.subjects : [];
      if (subjectResults.length) {
        setReportCardSubjectCommentDrafts((previous) => {
          const next = { ...previous };
          for (const row of subjectResults) {
            const key = `${Number(row.studentId)}:${Number(row.assessmentId)}`;
            next[key] = typeof row.commentText === "string" ? row.commentText : "";
            reportCardSubjectCommentPoolsRef.current[key] = typeof row.commentPool === "string" ? row.commentPool : "";
          }
          return next;
        });
      }
    } catch (error: any) {
      setReportCardCommentStatuses((previous) => {
        const next = { ...previous };
        overall.forEach((row) => { next[`${row.studentId}:${row.commentType}`] = "error"; });
        return next;
      });
      setReportCardSubjectCommentStatuses((previous) => {
        const next = { ...previous };
        subjectsToSave.forEach((row) => { next[row.draftKey] = "error"; });
        return next;
      });
      throw new Error(error?.message || "Some report changes could not be saved. Correct the failed comments before generating the PDF.");
    }
  };

  const downloadPdfResponse = async (response: Response, fallbackFilename: string) => {
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.message || "Failed to generate PDF");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plainFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const filename = encodedFilename ? decodeURIComponent(encodedFilename) : plainFilename || fallbackFilename;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  };

  const handleSendAll = async () => {
    if (!reportCardData || filteredStudents.length === 0) return;
    if (
      !confirm(
        "Send report cards to ALL parents for the currently loaded report cards?",
      )
    )
      return;

    setSendingAll(true);
    try {
      const res = await apiRequest("POST", "/api/report-cards/send-all", {
        examId: parseInt(selectedExamId),
        classId: parseInt(selectedClassId),
      });
      const result = await res.json();
      toast({
        title: result.queued ? "Report Cards Queued" : "Report Cards Sent",
        description: result.message || "Sent successfully",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to send report cards",
        variant: "destructive",
      });
    } finally {
      setSendingAll(false);
    }
  };

  const handleSendIndividual = async (studentId: number) => {
    if (!confirm("Send this student's report card to all linked parents?"))
      return;

    setSendingId(studentId);
    try {
      const res = await apiRequest("POST", "/api/report-cards/send-one", {
        examId: parseInt(selectedExamId),
        classId: parseInt(selectedClassId),
        studentId,
      });
      const result = await res.json();
      toast({
        title: "Report Card Sent",
        description: result.message || "Sent successfully",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to send report card",
        variant: "destructive",
      });
    } finally {
      setSendingId(null);
    }
  };


  const handleDownloadIndividual = async (studentId: number) => {
    const rc = filteredStudents.find((row) => row.student.id === studentId);
    if (!rc || !selectedExamId || !selectedClassId) return;

    setDownloadingId(studentId);
    try {
      await flushPendingReportChanges([studentId]);
      setPdfStage("generating");
      const params = new URLSearchParams({ classId: selectedClassId });
      const response = await schoolFetch(`/api/report-cards/${selectedExamId}/student/${studentId}/download?${params.toString()}`);
      const studentName = `${rc.student.firstName}_${rc.student.lastName}`.replace(/\s+/g, "_");
      const examLabel = selectedExamName?.replace(/\s+/g, "_") || "Exam";
      const classLabel = selectedClassName?.replace(/\s+/g, "_") || "Class";
      await downloadPdfResponse(response, `Report_Card_${studentName}_${classLabel}_${examLabel}.pdf`);
    } catch (error: any) {
      toast({ title: "Download failed", description: error?.message || "Failed to download this report card.", variant: "destructive" });
    } finally {
      setDownloadingId(null);
      setPdfStage("idle");
    }
  };

  const handleDownloadFiltered = async () => {
    if (!selectedExamId || !selectedClassId || filteredStudents.length === 0) return;
    const studentIds = filteredStudents.map((report) => report.student.id);
    setDownloadingFiltered(true);
    try {
      await flushPendingReportChanges(studentIds);
      setPdfStage("generating");
      const response = await schoolFetch(`/api/report-cards/${selectedExamId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: Number(selectedClassId), studentIds }),
      });
      const examLabel = selectedExamName?.replace(/\s+/g, "_") || "Exam";
      const classLabel = selectedClassName?.replace(/\s+/g, "_") || "Class";
      await downloadPdfResponse(response, `${searchTerm.trim() ? "Filtered_" : ""}Report_Cards_${classLabel}_${examLabel}.pdf`);
    } catch (error: any) {
      toast({ title: "Download failed", description: error?.message || "Failed to download the filtered report cards.", variant: "destructive" });
    } finally {
      setDownloadingFiltered(false);
      setPdfStage("idle");
    }
  };

  const navigateToClassLevel = (
    examId: string,
    examName: string,
    streamId: number,
    streamName: string,
  ) => {
    setSelectedExamId(examId);
    setSelectedExamName(examName);
    setSelectedStreamId(streamId);
    setSelectedStreamName(streamName);
    setViewMode("class-level");
  };

  const navigateToReports = (
    examId: string,
    classId: string,
    className: string,
  ) => {
    setSelectedExamId(examId);
    setSelectedClassId(classId);
    setSelectedClassName(className);
    const exam = exams.find((e) => String(e.id) === examId);
    setSelectedExamName(exam?.examName || "");
    setSearchTerm("");
    setViewMode("report-cards");
  };

  const goBackToHub = () => {
    setViewMode("hub");
    setSelectedClassId("");
    setSelectedClassName("");
    setSelectedStreamId(null);
    setSelectedStreamName("");
    setSearchTerm("");
  };

  const goBackToClassLevel = () => {
    setViewMode("class-level");
    setSearchTerm("");
  };

  const openClassModal = (
    examId: number,
    classId: number,
    className: string,
    modal: "missing" | "merit" | "analytics",
  ) => {
    setModalExamId(examId);
    setModalClassId(classId);
    setModalClassName(className);
    if (modal === "missing") setMissingMarksOpen(true);
    if (modal === "merit") setMeritOpen(true);
    if (modal === "analytics") setAnalyticsOpen(true);
  };

  const openStreamModal = (
    examId: number,
    streamId: number,
    streamName: string,
    modal: "merit" | "analytics",
  ) => {
    setModalExamId(examId);
    setModalStreamId(streamId);
    setModalStreamName(streamName);
    if (modal === "merit") setStreamMeritOpen(true);
    if (modal === "analytics") setStreamAnalyticsOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1100px] px-3 py-4 sm:p-6">
        {viewMode === "hub" && (
          <>
            <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8" style={{ color: "#1b2a5c" }} />
                <div>
                  <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-hub-title">Academic Reports</h1>
                  <p className="text-muted-foreground">View and manage student academic performance reports</p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => setPrincipalCommentsOpen(true)}
                  data-testid="button-principal-comments"
                >
                  <MessageSquare className="w-4 h-4 mr-1.5" />
                  Principal's Comments
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setClassTeacherCommentsOpen(true)}
                  data-testid="button-class-teacher-comments"
                >
                  <MessageSquare className="w-4 h-4 mr-1.5" />
                  Class Teacher's Comments
                </Button>
              </div>
            </div>

            <ReportCommentsModal
              open={principalCommentsOpen}
              onOpenChange={setPrincipalCommentsOpen}
              commentType="principal"
              title="Head/Principal's Comments"
              schoolType={currentSchool?.schoolType}
              examinationBoard={currentSchool?.examinationBoard}
            />
            <ReportCommentsModal
              open={classTeacherCommentsOpen}
              onOpenChange={setClassTeacherCommentsOpen}
              commentType="class_teacher"
              title="Class Teacher's Comments"
              schoolType={currentSchool?.schoolType}
              examinationBoard={currentSchool?.examinationBoard}
            />

            {examsLoading || atLoading ? (
              <div className="space-y-8">
                {[1, 2, 3].map((i) => (
                  <div key={i}>
                    <Skeleton className="h-6 w-48 mx-auto mb-3" />
                    <Card>
                      <CardContent className="p-4">
                        <Skeleton className="h-40 w-full" />
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            ) : assessmentTypes.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-semibold text-lg mb-2">
                    No Assessment Types Found
                  </h3>
                  <p className="text-muted-foreground">
                    Create assessment types in the Assessments Manager to see
                    reports here.
                  </p>
                </CardContent>
              </Card>
            ) : (
              (() => {
                const examsByType = new Map<number, Exam[]>();
                const unassigned: Exam[] = [];
                exams.forEach((exam) => {
                  if (exam.assessmentTypeId) {
                    const list = examsByType.get(exam.assessmentTypeId) || [];
                    list.push(exam);
                    examsByType.set(exam.assessmentTypeId, list);
                  } else {
                    unassigned.push(exam);
                  }
                });

                const defaultTab = isPrimarySchool
                  ? "ecd-assessment"
                  : assessmentTypes[0]?.id?.toString() || "unassigned";

                return (
                  <Tabs defaultValue={defaultTab} className="w-full">
                    <TabsList
                      className="flex flex-wrap h-auto gap-1 w-full justify-start"
                      data-testid="tabs-assessment-types"
                    >
                      {isPrimarySchool && (
                        <TabsTrigger value="ecd-assessment" data-testid="tab-ecd-assessment">
                          ECD Assessment
                        </TabsTrigger>
                      )}
                      {assessmentTypes.map((at) => (
                        <TabsTrigger
                          key={at.id}
                          value={at.id.toString()}
                          data-testid={`tab-at-${at.id}`}
                        >
                          {at.name}
                          {(examsByType.get(at.id) || []).length > 0 && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              ({(examsByType.get(at.id) || []).length})
                            </span>
                          )}
                        </TabsTrigger>
                      ))}
                      {unassigned.length > 0 && (
                        <TabsTrigger
                          value="unassigned"
                          data-testid="tab-at-unassigned"
                        >
                          Other
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            ({unassigned.length})
                          </span>
                        </TabsTrigger>
                      )}
                    </TabsList>

                    {isPrimarySchool && (
                      <TabsContent value="ecd-assessment" data-testid="tab-content-ecd-assessment">
                        <EcdAssessmentTab exams={exams} assessmentTypes={assessmentTypes} />
                      </TabsContent>
                    )}

                    {assessmentTypes.map((at) => {
                      const typeExams = examsByType.get(at.id) || [];
                      return (
                        <TabsContent
                          key={at.id}
                          value={at.id.toString()}
                          data-testid={`tab-content-at-${at.id}`}
                        >
                          {typeExams.length === 0 ? (
                            <Card>
                              <CardContent className="py-12 text-center">
                                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                                <h3 className="font-semibold text-lg mb-2">
                                  No Exams Yet
                                </h3>
                                <p className="text-muted-foreground">
                                  No exams have been created under {at.name}.
                                  Create exams in the Assessments Manager and
                                  assign them to this assessment type.
                                </p>
                              </CardContent>
                            </Card>
                          ) : (
                            <ExamStreamAccordion
                              exams={typeExams}
                              onNavigateClassLevel={navigateToClassLevel}
                              onNavigateReports={navigateToReports}
                              onOpenStreamModal={openStreamModal}
                            />
                          )}
                        </TabsContent>
                      );
                    })}

                    {unassigned.length > 0 && (
                      <TabsContent
                        value="unassigned"
                        data-testid="tab-content-at-unassigned"
                      >
                        <ExamStreamAccordion
                          exams={unassigned}
                          onNavigateClassLevel={navigateToClassLevel}
                          onNavigateReports={navigateToReports}
                          onOpenStreamModal={openStreamModal}
                        />
                      </TabsContent>
                    )}
                  </Tabs>
                );
              })()
            )}
          </>
        )}

        {viewMode === "class-level" && (
          <>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <Button
                variant="outline"
                onClick={goBackToHub}
                data-testid="button-back-to-hub"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to Hub
              </Button>
              <div>
                <h2 className="text-lg font-semibold">
                  {selectedStreamName} — Class Level
                </h2>
                <p className="text-sm text-muted-foreground">
                  {selectedExamName}
                </p>
              </div>
            </div>

            {(() => {
              const streamClasses = classes.filter(
                (c) => c.streamId === selectedStreamId,
              );
              if (streamClasses.length === 0) {
                return (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Layers className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">
                        No classes found in this stream.
                      </p>
                    </CardContent>
                  </Card>
                );
              }

              return (
                <div className="space-y-6">
                  {streamClasses.map((cls) => (
                    <ClassLevelBlock
                      key={cls.id}
                      examId={selectedExamId}
                      examName={selectedExamName}
                      classId={cls.id}
                      className={cls.className}
                      onReports={() =>
                        navigateToReports(
                          selectedExamId,
                          String(cls.id),
                          cls.className,
                        )
                      }
                      onMissingMarks={() =>
                        openClassModal(
                          parseInt(selectedExamId),
                          cls.id,
                          cls.className,
                          "missing",
                        )
                      }
                      onMerit={() =>
                        openClassModal(
                          parseInt(selectedExamId),
                          cls.id,
                          cls.className,
                          "merit",
                        )
                      }
                      onAnalytics={() =>
                        openClassModal(
                          parseInt(selectedExamId),
                          cls.id,
                          cls.className,
                          "analytics",
                        )
                      }
                    />
                  ))}
                </div>
              );
            })()}
          </>
        )}

        {viewMode === "report-cards" && (
          <>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <Button
                variant="outline"
                onClick={selectedStreamId ? goBackToClassLevel : goBackToHub}
                data-testid="button-back-from-reports"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold">{selectedClassName} — Report Cards</h2>
                  {reportCardData?.publication && <PublicationBadge status={reportCardData.publication.status} />}
                </div>
                <p className="text-sm text-muted-foreground">{selectedExamName}</p>
              </div>
            </div>

            {reportLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <Skeleton className="h-12 w-12 rounded-full" />
                        <div className="flex-1">
                          <Skeleton className="h-5 w-40 mb-2" />
                          <Skeleton className="h-4 w-24" />
                        </div>
                        <Skeleton className="h-10 w-20" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : reportCardData && reportCardData.reportCards.length > 0 ? (
              <>
                <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
                  <div className="flex-1 max-w-[360px]">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search student by name or admission number..."
                        className="pl-9"
                        data-testid="input-search-student"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      onClick={handleDownloadFiltered}
                      disabled={downloadingFiltered || filteredStudents.length === 0}
                      data-testid="button-download-reports"
                    >
                      {downloadingFiltered ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                      {downloadingFiltered ? (pdfStage === "saving" ? "Saving changes…" : "Preparing download…") : (searchTerm.trim() ? `Download (${filteredStudents.length})` : "Download All")}
                    </Button>
                    {canSendClassReports && reportCardData.publication?.isPublished && (
                      <Button
                        variant="outline"
                        onClick={handleSendAll}
                        disabled={sendingAll}
                        data-testid="button-send-all"
                      >
                        {sendingAll ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4 mr-2" />
                        )}
                        Send All Report Cards
                      </Button>
                    )}
                  </div>
                </div>



                <div className="flex flex-wrap gap-4 text-xs mb-4 text-muted-foreground">
                  <span>
                    <strong>Exam:</strong> {reportCardData.exam.examName}
                  </span>
                  <span>
                    <strong>Class:</strong> {reportCardData.class.className}
                  </span>
                  <span>
                    <strong>Students:</strong> {filteredStudents.length}
                  </span>
                </div>
              </>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3
                    className="font-semibold text-lg mb-2"
                    data-testid="text-no-reports"
                  >
                    No Report Cards Available
                  </h3>
                  <p className="text-muted-foreground">
                    No marks have been entered for this exam and class
                    combination.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
      {viewMode === "report-cards" &&
        reportCardData &&
        filteredStudents.length > 0 && (
          <>
            <div className="print-hide-for-print">
              {filteredStudents.map((rc) => (
                <ReportCardSlip
                  key={rc.student.id}
                  data={reportCardData}
                  studentReport={rc}
                  onSendIndividual={handleSendIndividual}
                  onDownloadIndividual={handleDownloadIndividual}
                  sendingId={sendingId}
                  downloadingId={downloadingId}
                  editableComments={!reportCardData.publication?.isPublished}
                  canSendIndividual={canSendClassReports && reportCardData.publication?.isPublished === true}
                  commentValues={reportCardCommentDrafts[rc.student.id]}
                  commentSaveStates={{
                    principal:
                      reportCardCommentStatuses[`${rc.student.id}:principal`] || "idle",
                    class_teacher:
                      reportCardCommentStatuses[`${rc.student.id}:class_teacher`] || "idle",
                  }}
                  onCommentChange={handleReportCardCommentChange}
                  subjectCommentValues={reportCardSubjectCommentDrafts}
                  subjectCommentSaveStates={reportCardSubjectCommentStatuses}
                  onSubjectCommentChange={handleReportCardSubjectCommentChange}
                  downloadStage={pdfStage}
                />
              ))}
            </div>
          </>
        )}
      <MissingMarksDialog
        open={missingMarksOpen}
        onOpenChange={setMissingMarksOpen}
        examId={modalExamId}
        classId={modalClassId}
        className={modalClassName}
      />
      <ClassMeritDialog
        open={meritOpen}
        onOpenChange={setMeritOpen}
        examId={modalExamId}
        classId={modalClassId}
        className={modalClassName}
      />
      <ClassAnalyticsDialog
        open={analyticsOpen}
        onOpenChange={setAnalyticsOpen}
        examId={modalExamId}
        classId={modalClassId}
        className={modalClassName}
      />
      <StreamMeritDialog
        open={streamMeritOpen}
        onOpenChange={setStreamMeritOpen}
        examId={modalExamId}
        streamId={modalStreamId}
        streamName={modalStreamName}
      />
      <StreamAnalyticsDialog
        open={streamAnalyticsOpen}
        onOpenChange={setStreamAnalyticsOpen}
        examId={modalExamId}
        streamId={modalStreamId}
        streamName={modalStreamName}
      />
    </div>
  );
}

function ClassLevelBlock({
  examId,
  examName,
  classId,
  className: classLabel,
  onReports,
  onMissingMarks,
  onMerit,
  onAnalytics,
}: {
  examId: string;
  examName: string;
  classId: number;
  className: string;
  onReports: () => void;
  onMissingMarks: () => void;
  onMerit: () => void;
  onAnalytics: () => void;
}) {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canPublish = hasPermission("academic_reports.publish.class");
  const canUnpublish = hasPermission("academic_reports.unpublish");
  const canSend = hasPermission("academic_reports.send.class");

  const { data, isLoading } = useQuery<ClassProgressData>({
    queryKey: ["/api/report-hub/class-progress", examId, classId],
    enabled: !!examId && !!classId,
  });

  const publicationMutation = useMutation({
    mutationFn: async (payload: { publish: boolean; reason?: string }) => {
      const response = await apiRequest("POST", "/api/report-hub/publication/class", {
        examId: Number(examId),
        classId,
        ...payload,
      });
      return response.json();
    },
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/report-hub/class-progress", examId, classId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/report-hub/stream-stats", examId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/report-hub/publication-status", Number(examId)] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marks-entry"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/report-cards"] }),
      ]);
      toast({
        title: variables.publish ? "Results published" : "Results unpublished",
        description: variables.publish
          ? `${examName} is now read-only for ${classLabel} and visible in student and parent portals.`
          : `Teachers can edit ${examName} for ${classLabel} again.`,
      });
    },
    onError: (error: any) => toast({ title: "Unable to update publication", description: error?.message || "Please try again.", variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/report-cards/send-all", {
        examId: Number(examId),
        classId,
        source: "class",
      });
      return response.json();
    },
    onSuccess: (result: any) => toast({ title: result.queued ? "Report cards queued" : "Report cards sent", description: result.message || "The report cards are being delivered." }),
    onError: (error: any) => toast({ title: "Unable to send reports", description: error?.message || "Please try again.", variant: "destructive" }),
  });

  const changePublication = () => {
    if (!data) return;
    const requiredPermission = data.publication?.isPublished
      ? "academic_reports.unpublish"
      : "academic_reports.publish.class";
    if (!hasPermission(requiredPermission)) {
      toast({
        title: "Permission required",
        description: `Ask an administrator to grant ${requiredPermission} to your access group. Sign in again after the permission is assigned.`,
        variant: "destructive",
      });
      return;
    }

    if (data.publication?.isPublished) {
      const reason = window.prompt(`Reason for unpublishing ${examName} for ${classLabel}:`);
      if (!reason?.trim()) return;
      if (!window.confirm(`Unpublish ${examName} for ${classLabel}? Teachers will be able to modify marks again and the report will no longer be visible in student and parent portals.`)) return;
      publicationMutation.mutate({ publish: false, reason: reason.trim() });
      return;
    }

    const totals = data.totals;
    const warning = [
      `Publish ${examName} for ${classLabel}?`,
      totals ? `${totals.assessmentsCreated} of ${totals.offeredSubjects} offered subjects have assessments. ${totals.assessmentsMissing} assessment${totals.assessmentsMissing === 1 ? " is" : "s are"} not created.` : "",
      totals ? `${totals.withMarks} entries have marks and ${totals.acknowledged} are acknowledged not written.` : "",
      totals && totals.partial + totals.unrecorded > 0
        ? `Warning: ${totals.partial + totals.unrecorded} learner-subject entr${totals.partial + totals.unrecorded === 1 ? "y has" : "ies have"} neither a completed mark nor an absent, sick, or excused status. Those subject rows will not appear on report cards. Confirming will publish anyway.`
        : totals
          ? "All expected learner-subject entries have a completed mark or an acknowledged not-written status."
          : "",
      "Publishing locks marks and assessment structure and makes the report visible in student and parent portals.",
    ].filter(Boolean).join("\n\n");
    if (window.confirm(warning)) publicationMutation.mutate({ publish: true });
  };

  const sendReports = () => {
    if (!data?.publication?.isPublished) return;
    if (!canSend) {
      toast({
        title: "Permission required",
        description: "Ask an administrator to grant academic_reports.send.class to your access group. Sign in again after the permission is assigned.",
        variant: "destructive",
      });
      return;
    }
    if (window.confirm(`Send ${examName} report cards for ${classLabel} through the configured communication channels?`)) sendMutation.mutate();
  };

  const publicationIsLocked = data?.publication?.isPublished === true;
  const hasPublicationPermission = publicationIsLocked ? canUnpublish : canPublish;

  return (
    <Card data-testid={`card-class-${classId}`}>
      <CardHeader className="px-3 pb-2 sm:px-6">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-base">{classLabel} — {examName}</CardTitle>
            {data?.publication && <PublicationBadge status={data.publication.status} />}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={changePublication}
              disabled={publicationMutation.isPending || isLoading}
              data-testid={`button-publish-class-${classId}`}
              title={!hasPublicationPermission ? `Requires ${publicationIsLocked ? "academic_reports.unpublish" : "academic_reports.publish.class"}` : undefined}
            >
              {publicationIsLocked ? <Unlock className="w-4 h-4 mr-1" /> : <Lock className="w-4 h-4 mr-1" />}
              {publicationIsLocked ? "Unpublish" : "Publish"}
              {!hasPublicationPermission && <span className="ml-1 text-[10px] text-muted-foreground">(permission required)</span>}
            </Button>
            {publicationIsLocked && (
              <Button
                variant="outline"
                size="sm"
                onClick={sendReports}
                disabled={sendMutation.isPending}
                data-testid={`button-send-class-${classId}`}
                title={!canSend ? "Requires academic_reports.send.class" : undefined}
              >
                {sendMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />} Send Report
                {!canSend && <span className="ml-1 text-[10px] text-muted-foreground">(permission required)</span>}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onMissingMarks} data-testid={`button-missing-${classId}`}>
              <AlertTriangle className="w-4 h-4 mr-1" /> Missing Marks
            </Button>
            <Button variant="outline" size="sm" onClick={onMerit} data-testid={`button-merit-${classId}`}>
              <Trophy className="w-4 h-4 mr-1" /> Merit List
            </Button>
            <Button variant="outline" size="sm" onClick={onAnalytics} data-testid={`button-analytics-${classId}`}>
              <BarChart3 className="w-4 h-4 mr-1" /> Analytics
            </Button>
            <Button size="sm" onClick={onReports} data-testid={`button-reports-${classId}`}>
              <FileText className="w-4 h-4 mr-1" /> Reports
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-4 sm:px-6 sm:pb-6">
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((index) => <Skeleton key={index} className="h-8 w-full" />)}</div>
        ) : !data || data.subjects.length === 0 ? (
          <div className="py-4 text-center text-muted-foreground text-sm">No subjects are currently assigned to this class.</div>
        ) : (
          <>
            <div className="mb-3"><ProgressLegend /></div>
            <div
              className="max-w-full overflow-x-auto overscroll-x-contain"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}
              data-testid={`scroll-class-progress-${classId}`}
            >
              <table className="w-full min-w-[560px] table-fixed text-sm sm:min-w-[720px]" data-testid={`table-class-progress-${classId}`}>
                <colgroup>
                  <col className="w-[210px]" />
                  <col className="w-[150px]" />
                  <col className="w-[110px]" />
                  <col className="w-[90px]" />
                </colgroup>
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-2 py-2 text-left font-semibold">Subject</th>
                    <th className="px-2 py-2 text-left font-semibold">Teacher</th>
                    <th className="px-2 py-2 text-center font-semibold">Progress</th>
                    <th className="px-2 py-2 text-center font-semibold">Avg Mark</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subjects.map((subject) => (
                    <tr key={subject.subjectId} className="border-b">
                      <td className="px-2 py-2 align-middle">
                        <div>{subject.subjectName}</div>
                        <div className="text-xs text-muted-foreground">Students: {subject.totalStudents}</div>
                        {!subject.assessmentCreated && <div className="text-xs font-medium text-muted-foreground">Assessment not created</div>}
                        {subject.partialCount > 0 && <div className="text-xs text-amber-700 dark:text-amber-400">{subject.partialCount} partial paper entr{subject.partialCount === 1 ? "y" : "ies"}</div>}
                      </td>
                      <td className="px-2 py-2 align-middle">{subject.teacherName ? <span className="text-sm">{subject.teacherName}</span> : <span className="text-sm text-muted-foreground">—</span>}</td>
                      <td className="px-2 py-2 text-center align-middle">
                        <ProgressBadge
                          pct={subject.progressPct}
                          withMarksPct={subject.withMarksPct}
                          acknowledgedPct={subject.acknowledgedPct}
                          assessmentCreated={subject.assessmentCreated}
                          title={!subject.assessmentCreated ? "Assessment not created" : undefined}
                        />
                      </td>
                      <td className="px-2 py-2 text-center align-middle">{subject.avgPct !== null ? `${subject.avgPct}%` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}


function MultiSelectPicker({
  label,
  options,
  selected,
  onChange,
  testId,
}: {
  label: string;
  options: { id: number; name: string }[];
  selected: number[];
  onChange: (ids: number[]) => void;
  testId: string;
}) {
  const [filterText, setFilterText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter((o) => !filterText || o.name.toLowerCase().includes(filterText.toLowerCase()));

  const toggle = (id: number) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  const remove = (id: number) => {
    onChange(selected.filter((s) => s !== id));
  };

  return (
    <div ref={ref} className="relative" data-testid={testId}>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <div
        className="flex flex-wrap gap-1 items-center border rounded-md px-2 py-1.5 min-h-[36px] cursor-text bg-background"
        onClick={() => setIsOpen(true)}
      >
        {selected.map((id) => {
          const opt = options.find((o) => o.id === id);
          return (
            <Badge key={id} variant="secondary" className="text-xs gap-1">
              {opt?.name || id}
              <X className="w-3 h-3 cursor-pointer" onClick={(e) => { e.stopPropagation(); remove(id); }} />
            </Badge>
          );
        })}
        <input
          className="flex-1 min-w-[80px] border-none outline-none bg-transparent text-sm"
          placeholder={selected.length === 0 ? "Tap to select..." : ""}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onFocus={() => setIsOpen(true)}
        />
      </div>
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-[200px] overflow-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No options</div>
          ) : (
            filtered.map((o) => (
              <div
                key={o.id}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-accent text-sm ${selected.includes(o.id) ? "bg-accent/50" : ""}`}
                onClick={() => toggle(o.id)}
              >
                <span>{o.name}</span>
                {selected.includes(o.id) && <span className="text-primary font-bold">✓</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ReportCommentsModal({
  open,
  onOpenChange,
  commentType,
  title,
  schoolType: currentSchoolType,
  examinationBoard: currentExaminationBoard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commentType: "principal" | "class_teacher";
  title: string;
  schoolType?: string | null;
  examinationBoard?: string | null;
}) {
  const { toast } = useToast();
  const { currentSchoolId, user } = useAuth();
  const schoolScopeId = currentSchoolId || user?.schoolId || null;
  const [commentText, setCommentText] = useState("");
  const [selectedGradeId, setSelectedGradeId] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<GradeProfileKey | "">("");
  const [dupModalOpen, setDupModalOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [missingTargets, setMissingTargets] = useState<any[]>([]);
  const [pendingText, setPendingText] = useState("");
  const [pendingGradeOption, setPendingGradeOption] = useState<ReportCommentGradeOption | null>(null);
  const isClassTeacher = commentType === "class_teacher";

  const { data: comments = [], isLoading } = useQuery<ReportComment[]>({
    queryKey: ["/api/report-comments", schoolScopeId, commentType],
    enabled: open && !!schoolScopeId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await schoolFetch(`/api/report-comments?commentType=${commentType}`);
      if (!res.ok) throw new Error("Failed to load report comments");
      return res.json();
    },
  });

  const { data: classesData = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes", schoolScopeId, "report-comments"],
    enabled: open && !!schoolScopeId,
    queryFn: async () => {
      const res = await schoolFetch("/api/classes");
      if (!res.ok) throw new Error("Failed to load classes");
      return res.json();
    },
  });

  const { data: staffData = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", schoolScopeId, "report-comments"],
    enabled: open && !!schoolScopeId,
    queryFn: async () => {
      const res = await schoolFetch("/api/staff");
      if (!res.ok) throw new Error("Failed to load staff");
      return res.json();
    },
  });

  const { data: gradesData = [] } = useQuery<Grade[]>({
    queryKey: ["/api/grades", schoolScopeId, "report-comments"],
    enabled: open && !!schoolScopeId,
    queryFn: async () => {
      const allGrades: Grade[] = [];
      let page = 1;
      const perPage = 500;

      while (page <= 20) {
        const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
        const res = await schoolFetch(`/api/grades?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load grades");
        const data = await res.json();

        if (Array.isArray(data)) return data;

        const items = Array.isArray(data?.items) ? data.items : [];
        allGrades.push(...items);

        if (!data?.hasNext || items.length === 0) break;
        page += 1;
      }

      return allGrades;
    },
  });

  const resolvedSchoolType = useMemo(
    () => (currentSchoolType ? normalizeSchoolType(currentSchoolType) : null),
    [currentSchoolType],
  );
  const resolvedExaminationBoard = useMemo(
    () => (currentExaminationBoard ? normalizeExamBoard(currentExaminationBoard) : null),
    [currentExaminationBoard],
  );
  const profileTabs = useMemo(() => {
    if (!resolvedSchoolType || !resolvedExaminationBoard) return [];
    return getGradingProfilesForSchool(resolvedSchoolType, resolvedExaminationBoard);
  }, [resolvedSchoolType, resolvedExaminationBoard]);

  const profileKeysWithGrades = useMemo(() => {
    const keys = new Set<GradeProfileKey>();
    profileTabs.forEach((profile) => {
      if (gradesData.some((grade) => reportCommentGradeMatchesTab(grade.gradeLevel, profile.key))) {
        keys.add(profile.key);
      }
    });
    return keys;
  }, [profileTabs, gradesData]);

  const { data: streamsData = [] } = useQuery<Stream[]>({
    queryKey: ["/api/streams", resolvedSchoolType, schoolScopeId, "report-comments"],
    enabled: open && !!schoolScopeId && !!resolvedSchoolType,
    queryFn: async () => {
      const res = await schoolFetch(`/api/streams?schoolType=${resolvedSchoolType}`);
      if (!res.ok) throw new Error("Failed to load streams");
      return res.json();
    },
  });

  useEffect(() => {
    if (profileTabs.length === 0) {
      setActiveTab("");
      return;
    }

    const validTabs = new Set<GradeProfileKey>(profileTabs.map((profile) => profile.key));
    const firstProfileWithGrades =
      profileTabs.find((profile) => profileKeysWithGrades.has(profile.key))?.key || profileTabs[0].key;

    setActiveTab((previous) => {
      if (!previous || !validTabs.has(previous)) return firstProfileWithGrades;
      if (profileKeysWithGrades.size > 0 && !profileKeysWithGrades.has(previous)) {
        return firstProfileWithGrades;
      }
      return previous;
    });
  }, [profileTabs, profileKeysWithGrades]);

  useEffect(() => {
    setSelectedGradeId("");
    setSelectedClassIds([]);
  }, [activeTab]);

  const allClasses: Class[] = Array.isArray(classesData) ? classesData : [];
  const streamMap = useMemo(() => new Map((streamsData || []).map((stream) => [stream.id, stream.name])), [streamsData]);
  const currentStaff = Array.isArray(staffData) ? staffData.find((staff: any) => staff.userId === user?.id) : undefined;

  const filteredClasses = useMemo(() => {
    const scoped = allClasses.filter((klass: any) => {
      if (!activeTab) return true;
      const streamName = klass.streamId ? streamMap.get(klass.streamId) : klass.className;
      return profileMatchesStreamName(activeTab, streamName);
    });
    if (!isClassTeacher) return scoped;
    if (!currentStaff?.id) return scoped;
    const assigned = scoped.filter((klass: any) => klass.classTeacherId === currentStaff.id);
    return assigned.length > 0 ? assigned : scoped;
  }, [allClasses, activeTab, streamMap, isClassTeacher, currentStaff?.id]);

  const classMap = useMemo(() => {
    const m: Record<number, string> = {};
    allClasses.forEach((c: any) => {
      m[c.id] = c.className;
    });
    return m;
  }, [allClasses]);

  const fetchedGradeMap = useMemo(() => {
    const m = new Map<number, Grade>();
    gradesData.forEach((grade) => m.set(grade.id, grade));
    return m;
  }, [gradesData]);

  const sortedGrades = useMemo(() => {
    return [...gradesData].sort((a, b) => {
      const upperDiff = Number(b.upperLimit ?? 0) - Number(a.upperLimit ?? 0);
      if (upperDiff !== 0) return upperDiff;

      const lowerDiff = Number(b.lowerLimit ?? 0) - Number(a.lowerLimit ?? 0);
      if (lowerDiff !== 0) return lowerDiff;

      return String(a.gradeName || "").localeCompare(String(b.gradeName || ""), undefined, { numeric: true });
    });
  }, [gradesData]);

  const filteredGrades = useMemo<ReportCommentGradeOption[]>(() => {
    const sourceGrades = filterItemsByStrictGradeProfileKey(sortedGrades, activeTab);
    const unique = new Map<string, ReportCommentGradeOption>();

    sourceGrades.forEach((grade) => {
      const option: ReportCommentGradeOption = {
        id: grade.id,
        gradeName: grade.gradeName,
        gradeLevel: grade.gradeLevel,
        lowerLimit: Number(grade.lowerLimit ?? 0),
        upperLimit: Number(grade.upperLimit ?? 0),
        gradePoints: Number(grade.gradePoints ?? 0),
        gradeStatus: grade.gradeStatus,
        gradeType: grade.gradeType,
      };
      const key = [
        normalizeReportCommentProfileToken(option.gradeName),
        option.lowerLimit,
        option.upperLimit,
        normalizeReportCommentProfileToken(option.gradeStatus),
      ].join("|");
      if (!unique.has(key)) unique.set(key, option);
    });

    return Array.from(unique.values());
  }, [sortedGrades, activeTab]);

  const selectableGradeMap = useMemo(() => {
    const m = new Map<number, ReportCommentGradeOption>();
    filteredGrades.forEach((grade) => m.set(grade.id, grade));
    return m;
  }, [filteredGrades]);

  const findCommentGradeOption = useMemo(() => {
    return (comment: ReportComment) => {
      const linkedGrade = comment.gradeId ? fetchedGradeMap.get(comment.gradeId) : undefined;
      if (linkedGrade) {
        return {
          id: linkedGrade.id,
          gradeName: linkedGrade.gradeName,
          gradeLevel: linkedGrade.gradeLevel,
          lowerLimit: Number(linkedGrade.lowerLimit ?? 0),
          upperLimit: Number(linkedGrade.upperLimit ?? 0),
          gradePoints: Number(linkedGrade.gradePoints ?? 0),
          gradeStatus: linkedGrade.gradeStatus,
          gradeType: linkedGrade.gradeType,
        } as ReportCommentGradeOption;
      }
      return filteredGrades.find((grade) => grade.gradeName === comment.commentGrade) || null;
    };
  }, [fetchedGradeMap, filteredGrades]);

  const getCommentLevelLabel = (comment: ReportComment) => {
    const linkedGrade = comment.gradeId ? fetchedGradeMap.get(comment.gradeId) : undefined;
    const profileKey =
      linkedGrade?.gradeLevel ||
      comment.gradeLevel ||
      findCommentGradeOption(comment)?.gradeLevel ||
      activeTab;

    if (!profileKey) return "—";
    return getGradeProfileLabel(profileKey);
  };

  const filteredComments = useMemo(() => {
    return comments.filter((comment) => {
      if (comment.commentType !== commentType) return false;
      if (activeTab) {
        const linkedGrade = comment.gradeId ? fetchedGradeMap.get(comment.gradeId) : undefined;
        const commentProfile = linkedGrade?.gradeLevel || comment.gradeLevel || null;
        if (!reportCommentGradeMatchesTab(commentProfile, activeTab)) return false;
      }
      if (isClassTeacher && selectedClassIds.length > 0 && !selectedClassIds.includes(comment.classId || -1)) return false;
      return true;
    });
  }, [comments, activeTab, selectedClassIds, isClassTeacher, commentType, fetchedGradeMap]);

  const sortedComments = useMemo(() => {
    return [...filteredComments].sort((a, b) => {
      if (isClassTeacher) {
        const classDiff = String(classMap[Number(a.classId)] || "").localeCompare(
          String(classMap[Number(b.classId)] || ""),
          undefined,
          { numeric: true },
        );
        if (classDiff !== 0) return classDiff;
      }

      const gradeA = findCommentGradeOption(a);
      const gradeB = findCommentGradeOption(b);
      const upperDiff = Number(gradeB?.upperLimit ?? 0) - Number(gradeA?.upperLimit ?? 0);
      if (upperDiff !== 0) return upperDiff;
      const lowerDiff = Number(gradeB?.lowerLimit ?? 0) - Number(gradeA?.lowerLimit ?? 0);
      if (lowerDiff !== 0) return lowerDiff;
      return Number(a.id) - Number(b.id);
    });
  }, [filteredComments, findCommentGradeOption, isClassTeacher, classMap]);

  const refreshComments = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/report-comments", schoolScopeId, commentType] });
    await queryClient.refetchQueries({ queryKey: ["/api/report-comments", schoolScopeId, commentType], exact: true });
  };

  const createMutation = useMutation({
    mutationFn: async (data: {
      gradeId?: number | null;
      commentGrade?: string;
      gradeLevel: string;
      commentText: string;
      commentType: string;
      classId?: number;
      classIds?: number[];
    }) => {
      if (data.commentType === "class_teacher") {
        const classIds = Array.from(new Set((data.classIds || []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)));
        if (classIds.length === 0 && data.classId) {
          classIds.push(Number(data.classId));
        }
        const responses = [];
        for (const classId of classIds) {
          const res = await apiRequest("POST", "/api/report-comments", { ...data, classId, classIds: [classId] });
          responses.push(await res.json());
        }
        return responses;
      }
      const res = await apiRequest("POST", "/api/report-comments", data);
      return res.json();
    },
    onSuccess: async () => {
      await refreshComments();
      setCommentText("");
      setSelectedGradeId("");
      setSelectedClassIds([]);
      toast({ title: "Success", description: "Comment saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const overwriteMutation = useMutation({
    mutationFn: async () => {
      if (!pendingGradeOption) throw new Error("No pending grade selected");

      const selectedDuplicates = duplicates.filter((item) => item.selected);
      for (const item of selectedDuplicates) {
        await apiRequest("DELETE", `/api/report-comments/${item.id}`);
      }

      let created = 0;
      if (isClassTeacher) {
        const classIdsToCreate = Array.from(new Set([
          ...selectedDuplicates.map((item) => Number(item.classId)).filter((value) => Number.isFinite(value) && value > 0),
          ...missingTargets.map((target: any) => Number(target.classId)).filter((value: number) => Number.isFinite(value) && value > 0),
        ]));
        if (classIdsToCreate.length > 0) {
          for (const classId of classIdsToCreate) {
            const res = await apiRequest("POST", "/api/report-comments", {
              gradeId: pendingGradeOption.id,
              commentGrade: pendingGradeOption.gradeName,
              gradeLevel: activeTab,
              commentText: pendingText,
              commentType,
              classId,
              classIds: [classId],
            });
            await res.json();
          }
          created = classIdsToCreate.length;
        }
      } else if (selectedDuplicates.length > 0 || missingTargets.length > 0) {
        const res = await apiRequest("POST", "/api/report-comments", {
          gradeId: pendingGradeOption.id,
          commentGrade: pendingGradeOption.gradeName,
          gradeLevel: activeTab,
          commentText: pendingText,
          commentType,
        });
        await res.json();
        created = 1;
      }

      return { overwritten: selectedDuplicates.length, created };
    },
    onSuccess: async (data) => {
      await refreshComments();
      setDupModalOpen(false);
      setDuplicates([]);
      setMissingTargets([]);
      setPendingText("");
      setPendingGradeOption(null);
      setCommentText("");
      setSelectedGradeId("");
      setSelectedClassIds([]);
      toast({ title: "Success", description: `Overwrote ${data.overwritten || 0} & created ${data.created || 0}` });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/report-comments/${id}`);
    },
    onSuccess: async () => {
      await refreshComments();
      toast({ title: "Success", description: "Comment deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = async () => {
    if (!selectedGradeId) {
      toast({ title: "Error", description: "Select a grade", variant: "destructive" });
      return;
    }
    if (!commentText.trim()) {
      toast({ title: "Error", description: "Enter a comment", variant: "destructive" });
      return;
    }
    if (isClassTeacher && selectedClassIds.length === 0) {
      toast({ title: "Error", description: "Select at least one class", variant: "destructive" });
      return;
    }

    const gradeIdNum = parseInt(selectedGradeId, 10);
    const selectedGrade = selectableGradeMap.get(gradeIdNum);
    const matchesGrade = (comment: any) => {
      if (!selectedGrade) return false;
      if (comment.gradeId && comment.gradeId === gradeIdNum) return true;
      const commentProfile = comment.gradeLevel || findCommentGradeOption(comment)?.gradeLevel || null;
      if (
        selectedGrade &&
        comment.commentGrade === selectedGrade.gradeName &&
        (!activeTab || reportCommentGradeMatchesTab(commentProfile, activeTab))
      ) {
        return true;
      }
      return false;
    };

    if (!selectedGrade) {
      toast({ title: "Error", description: "Select a grade", variant: "destructive" });
      return;
    }

    const payload = {
      gradeId: gradeIdNum,
      commentGrade: selectedGrade.gradeName,
      gradeLevel: activeTab,
      commentType,
      ...(isClassTeacher ? { classIds: selectedClassIds, classId: selectedClassIds[0] } : {}),
    };

    const scopedComments = comments.filter((comment) => {
      if (comment.commentType !== commentType) return false;
      if (!activeTab) return true;
      const commentProfile = comment.gradeLevel || findCommentGradeOption(comment)?.gradeLevel || null;
      return reportCommentGradeMatchesTab(commentProfile, activeTab);
    });

    if (isClassTeacher) {
      const duplicateItems: any[] = [];
      const newTargets: any[] = [];
      for (const classId of selectedClassIds) {
        const existing = scopedComments.find((comment: any) => Number(comment.classId) === classId && matchesGrade(comment));
        if (existing) {
          duplicateItems.push({
            id: existing.id,
            classId,
            className: classMap[classId] || "",
            gradeName: selectedGrade?.gradeName || existing.commentGrade,
            levelLabel: getCommentLevelLabel(existing),
            commentText: existing.commentText,
            selected: true,
          });
        } else {
          newTargets.push({ classId, className: classMap[classId] || "" });
        }
      }
      if (duplicateItems.length > 0) {
        setDuplicates(duplicateItems);
        setMissingTargets(newTargets);
        setPendingText(commentText.trim());
        setPendingGradeOption(selectedGrade);
        setDupModalOpen(true);
        return;
      }
      createMutation.mutate({ ...payload, commentText: commentText.trim() });
      return;
    }

    const existing = scopedComments.find((comment: any) => matchesGrade(comment));
    if (existing) {
      setDuplicates([{
        id: existing.id,
        gradeName: selectedGrade?.gradeName || existing.commentGrade,
        levelLabel: getCommentLevelLabel(existing),
        commentText: existing.commentText,
        selected: true,
      }]);
      setMissingTargets([]);
      setPendingText(commentText.trim());
      setPendingGradeOption(selectedGrade);
      setDupModalOpen(true);
      return;
    }

    createMutation.mutate({ ...payload, commentText: commentText.trim() });
  };

  const toggleDuplicate = (id: number) => {
    setDuplicates((prev) => prev.map((item) => item.id === id ? { ...item, selected: !item.selected } : item));
  };

  const handleOverwrite = () => {
    if (!pendingGradeOption) return;
    overwriteMutation.mutate();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[calc(100dvh-2rem)] flex flex-col">
          <DialogHeader>
            <DialogTitle data-testid="text-report-comments-title">{title}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {isClassTeacher
                ? "Comments are matched by grading system, class, and overall average grade band."
                : "Comments are matched by grading system and overall average grade band."}
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              const profile = profileTabs.find((candidate) => candidate.key === value);
              if (profile) setActiveTab(profile.key);
            }}
            className="flex-1 min-h-0 flex flex-col"
          >
            <TabsList className="flex flex-wrap h-auto justify-start">
              {profileTabs.map((profile) => (
                <TabsTrigger key={profile.key} value={profile.key} data-testid={`tab-report-comments-${profile.key}`}>
                  {profile.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className={`mt-4 grid grid-cols-1 ${isClassTeacher ? "md:grid-cols-3" : "md:grid-cols-2"} gap-3`}>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Grade</Label>
                <Select value={selectedGradeId || "none"} onValueChange={(value) => setSelectedGradeId(value === "none" ? "" : value)}>
                  <SelectTrigger data-testid="select-report-comment-grade">
                    <SelectValue placeholder="Select Grade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select Grade</SelectItem>
                    {filteredGrades.map((grade) => (
                      <SelectItem key={grade.id} value={String(grade.id)}>{formatReportCommentGradeLabel(grade)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isClassTeacher && (
                <MultiSelectPicker
                  label="Classes"
                  options={filteredClasses.map((c: any) => ({ id: c.id, name: c.className }))}
                  selected={selectedClassIds}
                  onChange={setSelectedClassIds}
                  testId="multi-select-report-comment-classes"
                />
              )}
              <div className="flex items-end">
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs w-full">
                  Active Tab: <span className="font-semibold">{getGradeProfileLabel(activeTab)}</span>
                </div>
              </div>
            </div>

            <div className="mt-3 border rounded-md p-3 space-y-3">
              <Textarea
                placeholder="Enter the comment"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="resize-none"
                rows={2}
                data-testid="textarea-report-comment"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-report-comment">Cancel</Button>
                <Button onClick={handleSave} disabled={createMutation.isPending || overwriteMutation.isPending} data-testid="button-submit-report-comment">
                  {(createMutation.isPending || overwriteMutation.isPending) ? "Saving..." : "Submit"}
                </Button>
              </div>
            </div>

            <div className="mt-4 flex-1 min-h-0 overflow-y-auto border rounded-md">
              {isLoading ? (
                <div className="space-y-2 p-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : sortedComments.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No comments yet for this grading tab.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {isClassTeacher && <TableHead className="text-center">Class</TableHead>}
                      <TableHead className="text-center">Level</TableHead>
                      <TableHead className="text-center">Grade</TableHead>
                      <TableHead>Comment</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedComments.map((comment) => {
                      const grade = findCommentGradeOption(comment);
                      return (
                        <TableRow key={comment.id}>
                          {isClassTeacher && <TableCell className="text-center">{comment.classId ? classMap[comment.classId] || "—" : "—"}</TableCell>}
                          <TableCell className="text-center">{getCommentLevelLabel(comment)}</TableCell>
                          <TableCell className="text-center">{grade?.gradeName || comment.commentGrade}</TableCell>
                          <TableCell className="text-sm">{comment.commentText}</TableCell>
                          <TableCell className="text-center">
                            <Button variant="outline" size="sm" className="text-destructive border-destructive" onClick={() => deleteMutation.mutate(comment.id)} disabled={deleteMutation.isPending} data-testid={`button-delete-report-comment-${comment.id}`}>
                              Delete
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={dupModalOpen} onOpenChange={(open) => { if (!open) { setDupModalOpen(false); setDuplicates([]); setMissingTargets([]); setPendingText(""); setPendingGradeOption(null); } }}>
        <DialogContent className="max-w-xl max-h-[calc(100dvh-2rem)] flex flex-col">
          <DialogHeader>
            <DialogTitle>Existing Comments Found</DialogTitle>
            <DialogDescription>Select which existing comments to overwrite with the new text. Missing targets will be created automatically.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto border rounded-md p-2 space-y-2">
            {duplicates.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-3 p-2 rounded-md border cursor-pointer ${item.selected ? "border-primary bg-accent/30" : "border-border"}`}
                onClick={() => toggleDuplicate(item.id)}
                data-testid={`dup-report-comment-${item.id}`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs ${item.selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"}`}>
                  {item.selected ? "✓" : ""}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    {isClassTeacher && item.className ? <><span className="font-semibold">{item.className}</span> — </> : null}
                    {item.levelLabel ? <><span>{item.levelLabel}</span> — </> : null}
                    <span className="italic">{item.gradeName}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{item.commentText}</p>
                </div>
              </div>
            ))}
          </div>

          {missingTargets.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {missingTargets.length} new comment(s) will also be created for targets without existing comments.
            </p>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => { setDupModalOpen(false); setDuplicates([]); setMissingTargets([]); }}>Cancel</Button>
            <Button onClick={handleOverwrite} disabled={overwriteMutation.isPending || (duplicates.filter((item) => item.selected).length === 0 && missingTargets.length === 0)} data-testid="button-confirm-report-comment-overwrite">
              {overwriteMutation.isPending ? "Processing..." : duplicates.filter((item) => item.selected).length > 0
                ? `Overwrite ${duplicates.filter((item) => item.selected).length} & Create ${missingTargets.length}`
                : missingTargets.length > 0 ? `Create ${missingTargets.length} New` : "Nothing to do"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
