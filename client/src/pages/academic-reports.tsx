import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import { getCompatibleGradeProfileKeys, getGradingProfilesForSchool, getGradeProfileLabel, normalizeExamBoard, normalizeSchoolType, profileMatchesStreamName } from "@shared/academic-profiles";
import { EcdAssessmentTab } from "@/components/academic-reports/ecd-assessment-tab";

type ViewMode = "hub" | "class-level" | "report-cards";

interface StreamStat {
  streamId: number;
  streamName: string;
  classes: { id: number; name: string }[];
  progressPct: number | null;
  avgPct: number | null;
  classCount: number;
  studentCount: number;
}

interface SubjectProgress {
  subjectId: number;
  subjectName: string;
  totalStudents: number;
  markedCount: number;
  progressPct: number;
  avgPct: number | null;
}

interface ClassProgressData {
  classId: number;
  className: string;
  totalStudents: number;
  subjects: SubjectProgress[];
}

interface MissingMarkSubject {
  subjectId: number;
  subjectName: string;
  totalStudents: number;
  missingCount: number;
  missingStudents: { id: number; name: string; admissionNo: string }[];
}

interface MeritRow {
  studentName: string;
  admissionNo: string;
  cells: Record<number, number | null>;
  total: number;
  avg: number;
  subjectsWithMarks: number;
  position: string;
}

interface MeritData {
  subjects: { id: number; name: string }[];
  rows: MeritRow[];
  totalStudents: number;
}

interface AnalyticsData {
  overallAvg: number;
  completion: number;
  enteredCells: number;
  expectedCells: number;
  gradeCounts: Record<string, number>;
  subjectSummary: {
    subjectId: number;
    subjectName: string;
    avg: number;
    completion: number;
    passRate: number;
    gradeCounts: Record<string, number>;
  }[];
  totalStudents: number;
  passMark: number;
}

interface StreamMeritData {
  subjects: string[];
  rows: {
    studentName: string;
    admissionNo: string;
    total: string;
    avg: string;
    position: string;
    subjectMarks: string[];
  }[];
  totalStudents: number;
}

interface StreamAnalyticsData {
  rows: {
    subjectId: number;
    subjectName: string;
    avg: number;
    passed: number;
    failed: number;
    passRate: number;
    gradeCounts: Record<string, number>;
  }[];
}

interface ReportSubject {
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

interface EcdReportSection {
  code: string;
  name: string;
  items: Array<{ itemText: string; rating: string | null }>;
}

interface ReportStudent {
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
    points: string;
    classPosition?: string;
    overallPosition: string;
    classSize: number;
    averagePercentage: number | null;
    totalSubjects: number;
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

interface ReportCardData {
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
}



type ReportCommentGradeOption = {
  id: number;
  gradeName: string;
  gradeLevel: string;
  lowerLimit: number;
  upperLimit: number;
  gradePoints: number;
  gradeStatus: string;
  gradeType: string;
};

function formatReportCommentGradeLabel(grade: Pick<ReportCommentGradeOption, "gradeName" | "gradeStatus" | "lowerLimit" | "upperLimit">) {
  return `${grade.gradeName} (${grade.gradeStatus}) • ${grade.lowerLimit}% - ${grade.upperLimit}%`;
}
function normalizeReportCommentProfileToken(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function getReportCommentProfileTokens(profileKey?: string | null) {
  if (!profileKey) return new Set<string>();
  const keys = Array.from(new Set([profileKey, ...getCompatibleGradeProfileKeys(profileKey)]));
  const tokens = new Set<string>();
  keys.forEach((key) => {
    const normalizedKey = normalizeReportCommentProfileToken(key);
    if (normalizedKey) tokens.add(normalizedKey);
    const label = getGradeProfileLabel(key);
    const normalizedLabel = normalizeReportCommentProfileToken(label);
    if (normalizedLabel) tokens.add(normalizedLabel);
  });
  return tokens;
}

function reportCommentGradeMatchesTab(gradeLevel: string | null | undefined, activeTab?: string | null) {
  if (!activeTab) return true;
  const normalizedGradeLevel = normalizeReportCommentProfileToken(gradeLevel);
  if (!normalizedGradeLevel) return false;
  return getReportCommentProfileTokens(activeTab).has(normalizedGradeLevel);
}

function DevCell({ dev }: { dev: string }) {
  if (dev === "0" || dev === "0%") {
    return (
      <span className="text-blue-700 dark:text-blue-400 font-semibold">
        <ArrowRight className="w-3 h-3 inline" />
      </span>
    );
  }
  if (dev.startsWith("-")) {
    return (
      <span className="text-red-600 dark:text-red-400 font-semibold whitespace-nowrap">
        <TrendingDown className="w-3 h-3 inline" /> {dev.replace("-", "")}
      </span>
    );
  }
  return (
    <span className="text-green-600 dark:text-green-400 font-semibold whitespace-nowrap">
      <TrendingUp className="w-3 h-3 inline" />{" "}
      {dev.replace("+", "").replace("NEW", "NEW")}
    </span>
  );
}

const ECD_DISPLAY_RATINGS = [
  { value: "YES", label: "YES" },
  { value: "ALMOST", label: "ALMOST" },
  { value: "NO", label: "NO" },
] as const;

function EcdChecklistTable({
  section,
  stretch = false,
}: {
  section: EcdReportSection;
  stretch?: boolean;
}) {
  const itemCount = Math.max(section.items.length, 1);
  const totalRows = itemCount + 1;
  const rowHeight = stretch ? `calc(100% / ${totalRows})` : undefined;
  const sectionTitle = `${section.code}. ${section.name.toUpperCase()}`;

  return (
    <div
      className={`rounded-sm border border-gray-300 dark:border-gray-600 overflow-hidden bg-white dark:bg-gray-900 ${stretch ? "h-full min-h-0" : ""}`}
    >
      <table className="w-full h-full border-collapse table-fixed text-[8.5px] leading-tight">
        <thead>
          <tr style={stretch ? { height: rowHeight } : undefined}>
            <th className="border border-gray-300 dark:border-gray-600 bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 text-left w-[64%] text-[9.5px] font-semibold uppercase leading-tight">
              {sectionTitle} <span className="normal-case">(checklist items)</span>
            </th>
            {ECD_DISPLAY_RATINGS.map((rating) => (
              <th
                key={rating.value}
                className="border border-gray-300 dark:border-gray-600 bg-gray-200 dark:bg-gray-800 px-1 py-0.5 text-center w-[12%] text-[9px] font-semibold leading-tight"
              >
                {rating.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.items.map((item, index) => (
            <tr
              key={`${section.code}-${index}`}
              style={stretch ? { height: rowHeight } : undefined}
            >
              <td className="border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 align-middle">
                {item.itemText}
              </td>
              {ECD_DISPLAY_RATINGS.map((rating) => (
                <td
                  key={rating.value}
                  className="border border-gray-300 dark:border-gray-600 px-1 py-0.5 text-center align-middle font-bold"
                >
                  {item.rating === rating.value ? "✓" : ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EcdChecklistSection({
  sections,
  studentName,
  admissionNo,
  className,
  examName,
}: {
  sections: EcdReportSection[];
  studentName: string;
  admissionNo: string;
  className: string;
  examName: string;
}) {
  if (!sections.length) return null;

  const gridTemplateRows = sections
    .map((section) => `minmax(0, ${Math.max(section.items.length + 2, 6)}fr)`)
    .join(" ");

  return (
    <div
      className="report-slip-inner report-slip-page report-slip-page--ecd border border-gray-300 dark:border-gray-600 p-3 relative overflow-hidden bg-white dark:bg-gray-900"
      style={{
        fontSize: "12px",
        minHeight: "calc(297mm - 10mm - 16px)",
        pageBreakBefore: "always",
        breakBefore: "page",
      }}
    >
      <div className="relative z-10 h-full flex flex-col">
        <div className="text-center mb-3">
          <div className="text-[16px] font-bold">ECD Assessment</div>
          <div className="mt-1 text-[8.5px] text-gray-700 dark:text-gray-300 flex items-center justify-center gap-3 flex-wrap">
            <span><strong>Name:</strong> {studentName}</span>
            <span><strong>Reg No:</strong> {admissionNo}</span>
            <span><strong>Class:</strong> {className}</span>
            <span><strong>Exam:</strong> {examName}</span>
          </div>
        </div>

        <div
          className="grid grid-cols-1 gap-2 flex-1 min-h-0"
          style={{ gridTemplateRows }}
        >
          {sections.map((section) => (
            <EcdChecklistTable key={section.code} section={section} stretch />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportCardSlip({
  data,
  studentReport,
  onSendIndividual,
  onPrintIndividual,
  sendingId,
  editableComments,
  commentValues,
  commentSaveStates,
  onCommentChange,
  subjectCommentValues,
  subjectCommentSaveStates,
  onSubjectCommentChange,
}: {
  data: ReportCardData;
  studentReport: ReportStudent;
  onSendIndividual: (studentId: number) => void;
  onPrintIndividual: (studentId: number) => void;
  sendingId: number | null;
  editableComments: boolean;
  commentValues?: { principal: string; class_teacher: string };
  commentSaveStates?: { principal: ReportCardCommentStatus; class_teacher: ReportCardCommentStatus };
  onCommentChange?: (studentId: number, commentType: ReportCardCommentType, value: string) => void;
  subjectCommentValues?: ReportCardSubjectCommentDraftMap;
  subjectCommentSaveStates?: Record<string, ReportCardCommentStatus>;
  onSubjectCommentChange?: (
    studentId: number,
    subject: Pick<ReportSubject, "assessmentId" | "subjectId">,
    value: string,
  ) => void;
}) {
  const { student, subjects, summary } = studentReport;
  const { school } = data;
  const name = `${student.firstName} ${student.lastName}`;
  const { toast } = useToast();

  const parseGraphNumber = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    const cleaned = value.replace(/[^0-9.-]/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const subjectChartLabels = subjects.map((subj) => subj.subjectName);
  const subjectChartStudentMarks = subjects.map((subj) => {
    const parsed = parseGraphNumber(subj.mark);
    return Math.max(parsed ?? 0, 0);
  });
  const subjectChartClassAvgs = subjects.map((subj) => {
    const parsed = parseGraphNumber(subj.classAvg);
    return parsed === null ? null : Math.max(parsed, 0);
  });

  const displayedClassTeacherComment =
    commentValues?.class_teacher ?? studentReport.classTeacherComment ?? "";
  const displayedPrincipalComment =
    commentValues?.principal ?? studentReport.principalComment ?? "";

  const principalInfoItems = [
    school.principalName,
    school.principalPhone ? `Mobile: ${school.principalPhone}` : null,
    school.email ? `Email: ${school.email}` : null,
  ].filter((value): value is string => Boolean(value));

  const totalCommentCharacters = (
    `${displayedClassTeacherComment} ${displayedPrincipalComment}`.trim().length
  );
  const layoutPressure =
    Math.max(subjects.length - 6, 0) * 7 +
    Math.max(Math.ceil(totalCommentCharacters / 140) - 1, 0) * 6 +
    Math.max(principalInfoItems.length - 4, 0) * 4;

  const graphPlotHeight = Math.max(70, 92 - layoutPressure);
  const graphLabelHeight = Math.max(33, 55 - Math.floor(layoutPressure / 2));
  const footerBlockHeight = Math.max(88, 34 + principalInfoItems.length * 18);
  const stampImageMaxHeight = Math.max(64, footerBlockHeight - 16);
  const qrCodeSize = Math.max(78, footerBlockHeight - 18);
  const qrCaptionWidth = Math.max(qrCodeSize + 16, 138);

  const getSubjectCommentKey = (subject: Pick<ReportSubject, "assessmentId" | "subjectId">) =>
    `${student.id}:${subject.assessmentId ?? `subject-${subject.subjectId}`}`;

  const getSubjectCommentValue = (subject: ReportSubject) => {
    const key = getSubjectCommentKey(subject);
    return subjectCommentValues?.[key] ?? subject.comment ?? "";
  };

  const getSubjectCommentSaveState = (subject: ReportSubject) => {
    const key = getSubjectCommentKey(subject);
    return subjectCommentSaveStates?.[key] || "idle";
  };

  const getSaveStateLabel = (state?: ReportCardCommentStatus) => {
    if (state === "saving") return "Saving...";
    if (state === "saved") return "Saved";
    if (state === "error") return "Save failed";
    return "";
  };

  return (
    <div
      className="report-slip bg-white dark:bg-gray-900 rounded-lg mb-8 shadow-lg p-2 print:shadow-none print:rounded-none print:mb-0 print:p-0"
      style={{ pageBreakInside: "avoid", pageBreakAfter: "always" }}
    >
      <div
        className="report-slip-inner report-slip-page report-slip-page--main border border-gray-300 dark:border-gray-600 py-2.5 px-1.5 relative overflow-hidden flex flex-col"
        style={{ fontSize: "12px", minHeight: "calc(287mm - 2px)" }}
      >
        {school.logo && (
          <img
            src={school.logo}
            alt=""
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] opacity-[0.08] pointer-events-none z-0"
            aria-hidden="true"
          />
        )}

        <div className="relative z-10">
          <div className="grid grid-cols-[112px_1fr_112px] items-center gap-2">
            <div className="text-left">
              {school.logo ? (
                <img
                  src={school.logo}
                  alt="School logo"
                  className="w-[91px] h-[91px] object-contain"
                  data-testid="img-school-logo"
                />
              ) : (
                <div className="w-[91px] h-[91px] border border-gray-400 rounded-lg flex items-center justify-center">
                  <School className="w-10 h-10 text-gray-400" />
                </div>
              )}
            </div>

            <div className="text-center">
              <div
                className="text-sm font-bold text-gray-900 dark:text-gray-100"
                data-testid="text-school-name"
              >
                {school.name}
              </div>
              {school.phone && (
                <div className="text-[11px] mt-0.5 text-gray-700 dark:text-gray-300">
                  <strong>Call Centre:</strong> {school.phone}
                </div>
              )}
              {school.email && (
                <div className="text-[11px] mt-0.5 text-gray-700 dark:text-gray-300">
                  <strong>Email:</strong> {school.email}
                </div>
              )}
              {school.address && (
                <div className="text-[11px] mt-0.5 text-gray-700 dark:text-gray-300">
                  <strong>Address:</strong> {school.address}
                </div>
              )}
            </div>

            <div className="text-right">
              {student.photo ? (
                <img
                  src={student.photo}
                  alt="Student photo"
                  className="w-[91px] h-[91px] rounded-lg border border-gray-400 object-cover inline-block"
                  data-testid={`img-student-photo-${student.id}`}
                />
              ) : (
                <div className="w-[91px] h-[91px] rounded-lg border border-gray-400 inline-flex items-center justify-center text-[10px] text-gray-500">
                  PHOTO
                </div>
              )}
            </div>
          </div>

          <hr
            className="border-none border-t border-dashed border-gray-400 my-2"
            style={{ borderTop: "1px dashed #999" }}
          />

          <div className="font-bold mb-1 text-[15.5px] uppercase leading-tight">
            Academic Results Slip for
          </div>
          <div className="mb-0.5 w-full text-[15.5px] flex justify-between flex-wrap gap-x-2 gap-y-0.5 leading-tight">
            <span>
              <strong>Name:</strong> {name}
              &nbsp;&nbsp;
              <span className="text-gray-500 text-[13px]">
                (Reg No: {student.admissionNo})
              </span>
            </span>
            <span>
              <strong>Class:</strong> {data.class.className}
            </span>
          </div>

          <div className="h-1" />

          <div className="flex gap-2 mb-1.5 flex-wrap">
            <div className="flex-1 min-w-[45%] pt-0">
              <div className="mb-0 text-center font-extrabold text-[15.5px] leading-tight">
                <strong>Exam:</strong> {data.exam.examName}
              </div>
              <table
                className="w-full border-collapse text-[9px] mt-0.5"
                data-testid="table-summary"
              >
                <thead>
                  <tr>
                    <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[9px] leading-tight">
                      Total Marks
                    </th>
                    <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[9px] leading-tight">
                      Average Mark
                    </th>
                    <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[9px] leading-tight">
                      Subject Passed
                    </th>
                    <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[9px] leading-tight">
                      Points
                    </th>
                    {data.school.showClassPositionOnReports && (
                      <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[9px] leading-tight">
                        Class Position
                      </th>
                    )}
                    <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[9px] leading-tight">
                      Overall Position
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-gray-100/75 dark:bg-gray-800/75">
                    <td
                      className="px-2.5 py-1 text-center text-gray-700 dark:text-gray-300 font-bold text-[10px] leading-tight"
                      data-testid="text-total-marks"
                    >
                      {summary.totalMark}
                    </td>
                    <td
                      className="px-2.5 py-1 text-center text-gray-700 dark:text-gray-300 font-bold text-[10px] leading-tight"
                      data-testid="text-avg-mark"
                    >
                      {summary.avgMark}
                    </td>
                    <td
                      className="px-2.5 py-1 text-center text-gray-700 dark:text-gray-300 font-bold text-[10px] leading-tight"
                      data-testid="text-subjects-passed"
                    >
                      {summary.subjectsPassed}
                    </td>
                    <td
                      className="px-2.5 py-1 text-center text-gray-700 dark:text-gray-300 font-bold text-[10px] leading-tight"
                      data-testid="text-points"
                    >
                      {summary.points}
                    </td>
                    {data.school.showClassPositionOnReports && (
                      <td
                        className="px-2.5 py-1 text-center text-gray-700 dark:text-gray-300 font-bold text-[10px] leading-tight"
                        data-testid="text-class-position"
                      >
                        {summary.classPosition || "–"}
                      </td>
                    )}
                    <td
                      className="px-2.5 py-1 text-center text-gray-700 dark:text-gray-300 font-bold text-[10px] leading-tight"
                      data-testid="text-position"
                    >
                      {summary.overallPosition || "–"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <table
            className="w-full table-fixed border-collapse mt-1 text-[9px]"
            data-testid={`table-subjects-${student.id}`}
          >
            <thead>
              <tr>
                <th className="w-[22%] border-b border-gray-400 dark:border-gray-500 px-1.5 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-left text-[9px]">
                  Subject
                </th>
                <th className="w-[7%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[9px] whitespace-nowrap">
                  Mark %
                </th>
                <th className="w-[8%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[9px] whitespace-nowrap">
                  Dev.
                </th>
                <th className="w-[10%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[9px] whitespace-nowrap">
                  Class Avg %
                </th>
                <th className="w-[5%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[9px] whitespace-nowrap">
                  Grade
                </th>
                <th className="w-[6%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[9px] whitespace-nowrap">
                  Rank
                </th>
                <th className="w-[45%] border-b border-gray-400 dark:border-gray-500 px-1.5 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-left text-[9px]">
                  Comment
                </th>
                <th className="w-[13%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-left text-[9px] whitespace-nowrap">
                  Teacher
                </th>
              </tr>
            </thead>
            <tbody>
              {subjects.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="border border-gray-300 dark:border-gray-600 px-1.5 py-2.5 text-center text-gray-500"
                  >
                    No marks found for this student under this exam.
                  </td>
                </tr>
              ) : (
                subjects.map((subj) => (
                  <tr key={subj.subjectId}>
                    <td className="border border-gray-300 dark:border-gray-600 px-1.5 py-1 text-left break-words">
                      {subj.subjectName}
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 px-1 py-1 text-center whitespace-nowrap">
                      {subj.mark}
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 px-1 py-1 text-center whitespace-nowrap">
                      <DevCell dev={subj.dev} />
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 px-1 py-1 text-center whitespace-nowrap">
                      {subj.classAvg}
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 px-1 py-1 text-center whitespace-nowrap">
                      {subj.grade}
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 px-1 py-1 text-center whitespace-nowrap">
                      {subj.rank}
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 px-1.5 py-1 text-left whitespace-normal break-words align-top">
                      {editableComments ? (
                        <>
                          <Textarea
                            value={getSubjectCommentValue(subj)}
                            onChange={(e) => onSubjectCommentChange?.(student.id, subj, e.target.value)}
                            rows={3}
                            className="min-h-[68px] border-0 p-0 text-[10px] leading-snug resize-none bg-transparent shadow-none focus-visible:ring-0"
                            data-testid={`textarea-subject-comment-${student.id}-${subj.assessmentId ?? subj.subjectId}`}
                          />
                          <div className="text-[9px] text-gray-500 mt-1 text-right min-h-[12px]">
                            {getSaveStateLabel(getSubjectCommentSaveState(subj))}
                          </div>
                        </>
                      ) : (
                        <span className="whitespace-pre-wrap">{getSubjectCommentValue(subj)}</span>
                      )}
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 px-1 py-1 text-left whitespace-normal break-words">
                      {subj.teacher}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="mt-1 text-[10.5px] flex flex-wrap gap-3 justify-center leading-tight">
            <span className="text-green-600 dark:text-green-400">
              <TrendingUp className="w-3 h-3 inline" /> Positive Performance
            </span>
            <span className="text-red-600 dark:text-red-400">
              <TrendingDown className="w-3 h-3 inline" /> Negative Performance
            </span>
            <span className="text-blue-700 dark:text-blue-400">
              <ArrowRight className="w-3 h-3 inline" /> Constant Performance
            </span>
          </div>

          <div className="report-graphs-row grid grid-cols-2 gap-2 mt-2">
            <div
              className="report-graph-card border border-gray-300 dark:border-gray-600 rounded-sm p-1"
              style={{ background: "rgba(0,0,0,0.04)" }}
            >
              <div className="flex items-center justify-center gap-5 mb-0.5 leading-tight">
                <div className="text-[10.5px] font-semibold text-center leading-tight">
                  Subject Performance vs Class
                </div>
                <div className="flex gap-2 text-[7.5px] items-center leading-tight">
                  <span className="flex items-center gap-1">
                    <span
                      className="w-2 h-2 inline-block rounded-sm"
                      style={{
                        background: "linear-gradient(180deg, #7CB9F7, #5B9FE8)",
                      }}
                    />{" "}
                    Student
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="w-4 h-0.5 inline-block rounded"
                      style={{ background: "#4CAF50" }}
                    />
                    <span
                      className="w-1.5 h-1.5 inline-block rounded-full"
                      style={{ background: "#4CAF50" }}
                    />{" "}
                    Class Avg
                  </span>
                </div>
              </div>

              <div className="flex flex-col overflow-hidden">
                <div className="flex" style={{ height: `${graphPlotHeight}px` }}>
                  <div
                    className="flex flex-col justify-between py-0.5 pr-0.5 flex-shrink-0"
                    style={{ width: "22px" }}
                  >
                    {[100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0].map((v) => (
                      <span
                        key={v}
                        className="text-[5px] text-gray-400 text-right leading-none"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                  <div className="flex-1 relative border-l border-gray-300 dark:border-gray-600 border-b">
                    {subjectChartLabels.length > 0 ? (
                      (() => {
                        const count = subjectChartLabels.length;
                        const slots = Math.max(count, 10);
                        const gap = 2;
                        return (
                          <>
                            <div
                              className="absolute inset-0 flex items-end justify-start"
                              style={{
                                gap: `${gap}px`,
                                padding: "0 2px 0 2px",
                              }}
                            >
                              {subjectChartLabels.map(
                                (label, i) => {
                                  const studentMark =
                                    subjectChartStudentMarks[i] || 0;
                                  const barH = Math.max(studentMark, 0);
                                  const barWidth = `calc((100% - ${(slots - 1) * gap + 4}px) / ${slots})`;
                                  return (
                                    <div
                                      key={i}
                                      className="flex flex-col items-center justify-end h-full flex-shrink-0"
                                      style={{ width: barWidth }}
                                      title={`${label}: ${studentMark}%`}
                                    >
                                      <div
                                        className="w-full rounded-t-sm relative"
                                        style={{
                                          height: `${barH}%`,
                                          background:
                                            "linear-gradient(180deg, #7CB9F7 0%, #5B9FE8 100%)",
                                        }}
                                      >
                                        <span className="absolute top-0.5 left-1/2 -translate-x-1/2 text-[6px] font-semibold text-white whitespace-nowrap z-10">
                                          {studentMark}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                },
                              )}
                            </div>
                            {subjectChartClassAvgs.some(
                              (v) => v !== null,
                            ) && (
                              <svg
                                className="absolute inset-0 z-10 pointer-events-none overflow-visible"
                                style={{ opacity: 0 }}
                                preserveAspectRatio="xMinYMin meet"
                                viewBox={`0 0 1000 1000`}
                              >
                                <polyline
                                  fill="none"
                                  stroke="#4CAF50"
                                  strokeWidth="6"
                                  strokeLinejoin="round"
                                  strokeLinecap="round"
                                  points={subjectChartClassAvgs
                                    .map((avg, i) => {
                                      if (avg === null) return null;
                                      const slotW = 1000 / slots;
                                      const x = i * slotW + slotW / 2;
                                      const y = 1000 - (avg / 100) * 1000;
                                      return `${x},${y}`;
                                    })
                                    .filter(Boolean)
                                    .join(" ")}
                                />
                                {subjectChartClassAvgs.map((avg, i) => {
                                  if (avg === null) return null;
                                  const slotW = 1000 / slots;
                                  const x = i * slotW + slotW / 2;
                                  const y = 1000 - (avg / 100) * 1000;
                                  return (
                                    <circle
                                      key={i}
                                      cx={x}
                                      cy={y}
                                      r="10"
                                      fill="#4CAF50"
                                      stroke="#fff"
                                      strokeWidth="4"
                                    />
                                  );
                                })}
                              </svg>
                            )}
                          </>
                        );
                      })()
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-[10px]">
                        No data
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginLeft: "22px",
                  height: `${graphLabelHeight}px`,
                  position: "relative",
                  overflow: "visible",
                }}
              >
                <div
                  className="flex justify-start"
                  style={{
                    gap: "2px",
                    padding: "0 2px",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                  }}
                >
                  {(() => {
                    const count = subjectChartLabels.length;
                    const slots = Math.max(count, 10);
                    const barWidth = `calc((100% - ${(slots - 1) * 2 + 4}px) / ${slots})`;
                    return subjectChartLabels.map((label, i) => (
                      <div
                        key={i}
                        className="flex-shrink-0"
                        style={{
                          width: barWidth,
                          height: `${graphLabelHeight}px`,
                          position: "relative",
                          overflow: "visible",
                        }}
                      >
                        <div
                          className="text-[5.5px] leading-[1.2] text-gray-500"
                          style={{
                            position: "absolute",
                            top: "3px",
                            left: "50%",
                            transform: "rotate(-90deg) translateX(-100%)",
                            transformOrigin: "top left",
                            textAlign: "right" as const,
                            width: "50px",
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical" as const,
                          }}
                        >
                          {label}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>

            <div
              className="report-graph-card border border-gray-300 dark:border-gray-600 rounded-sm p-1"
              style={{ background: "rgba(0,0,0,0.04)" }}
            >
              <div className="flex items-center justify-center gap-5 mb-0.5 leading-tight">
                <div className="text-[10.5px] font-semibold text-center leading-tight">
                  Term Average Trend
                </div>
                <div className="flex gap-2 text-[7.5px] items-center leading-tight">
                  <span className="flex items-center gap-1">
                    <span
                      className="w-2 h-2 inline-block rounded-sm"
                      style={{
                        background: "linear-gradient(180deg, #A8B5C8, #8D9BB0)",
                      }}
                    />{" "}
                    Term Average
                  </span>
                </div>
              </div>

              <div className="flex flex-col overflow-hidden">
                <div className="flex" style={{ height: `${graphPlotHeight}px` }}>
                  <div
                    className="flex flex-col justify-between py-0.5 pr-0.5 flex-shrink-0"
                    style={{ width: "22px" }}
                  >
                    {[100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0].map((v) => (
                      <span
                        key={v}
                        className="text-[5px] text-gray-400 text-right leading-none"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                  <div className="flex-1 relative border-l border-gray-300 dark:border-gray-600 border-b">
                    {(() => {
                      const labels = studentReport.chartOvertimeLabels || [];
                      const avgs = studentReport.chartOvertimeAvgs || [];
                      const count = labels.length;
                      if (count === 0)
                        return (
                          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-[10px]">
                            No data
                          </div>
                        );
                      const slots = Math.max(count, 10);
                      const gap = 2;
                      return (
                        <div
                          className="absolute inset-0 flex items-end justify-start"
                          style={{ gap: `${gap}px`, padding: "0 2px 0 2px" }}
                        >
                          {labels.map((label, i) => {
                            const avg = avgs[i] || 0;
                            const barH = Math.max(avg, 0);
                            const barWidth = `calc((100% - ${(slots - 1) * gap + 4}px) / ${slots})`;
                            return (
                              <div
                                key={i}
                                className="flex flex-col items-center justify-end h-full flex-shrink-0"
                                style={{ width: barWidth }}
                                title={`${label}: ${avg}%`}
                              >
                                <div
                                  className="w-full rounded-t-sm relative"
                                  style={{
                                    height: `${barH}%`,
                                    background:
                                      "linear-gradient(180deg, #A8B5C8 0%, #8D9BB0 100%)",
                                  }}
                                >
                                  <span className="absolute top-0.5 left-1/2 -translate-x-1/2 text-[6px] font-semibold text-white whitespace-nowrap z-10">
                                    {avg}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginLeft: "22px",
                  height: `${graphLabelHeight}px`,
                  position: "relative",
                  overflow: "visible",
                }}
              >
                <div
                  className="flex justify-start"
                  style={{
                    gap: "2px",
                    padding: "0 2px",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                  }}
                >
                  {(() => {
                    const labels = studentReport.chartOvertimeLabels || [];
                    const count = labels.length;
                    const slots = Math.max(count, 10);
                    const barWidth = `calc((100% - ${(slots - 1) * 2 + 4}px) / ${slots})`;
                    return labels.map((label, i) => (
                      <div
                        key={i}
                        className="flex-shrink-0"
                        style={{
                          width: barWidth,
                          height: `${graphLabelHeight}px`,
                          position: "relative",
                          overflow: "visible",
                        }}
                      >
                        <div
                          className="text-[5.5px] leading-[1.2] text-gray-500"
                          style={{
                            position: "absolute",
                            top: "3px",
                            left: "50%",
                            transform: "rotate(-90deg) translateX(-100%)",
                            transformOrigin: "top left",
                            textAlign: "right" as const,
                            width: "50px",
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical" as const,
                          }}
                        >
                          {label}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-1.5 text-[9px] space-y-1.5 leading-snug">
            <div>
              {editableComments ? (
                <>
                  <div className="font-semibold mb-0.5">Class Teacher's Comment:</div>
                  <Textarea
                    value={displayedClassTeacherComment}
                    onChange={(e) => onCommentChange?.(student.id, "class_teacher", e.target.value)}
                    rows={2}
                    className="min-h-[56px] text-[9px] leading-snug resize-none bg-white"
                    data-testid={`textarea-class-teacher-comment-${student.id}`}
                  />
                  <div className="text-[10px] text-gray-500 mt-1 text-right min-h-[14px]">
                    {getSaveStateLabel(commentSaveStates?.class_teacher)}
                  </div>
                </>
              ) : (
                <p className="my-0.5 leading-snug">
                  <span className="font-semibold">Class Teacher's Comment: </span>
                  <span className="whitespace-pre-wrap">{displayedClassTeacherComment}</span>
                </p>
              )}
            </div>
            <div>
              {editableComments ? (
                <>
                  <div className="font-semibold mb-0.5">Head/Principal's Comment:</div>
                  <Textarea
                    value={displayedPrincipalComment}
                    onChange={(e) => onCommentChange?.(student.id, "principal", e.target.value)}
                    rows={2}
                    className="min-h-[56px] text-[9px] leading-snug resize-none bg-white"
                    data-testid={`textarea-principal-comment-${student.id}`}
                  />
                  <div className="text-[10px] text-gray-500 mt-1 text-right min-h-[14px]">
                    {getSaveStateLabel(commentSaveStates?.principal)}
                  </div>
                </>
              ) : (
                <p className="my-0.5 leading-snug">
                  <span className="font-semibold">Head/Principal's Comment: </span>
                  <span className="whitespace-pre-wrap">{displayedPrincipalComment}</span>
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-[0.9fr_1.55fr_0.95fr] gap-3 mt-auto pt-2 text-[11px] items-stretch report-footer-row">
            <div className="flex">
              {school.stamp ? (
                <div
                  className="border border-gray-300 dark:border-gray-600 p-2 h-full w-full flex items-center justify-center report-footer-box"
                  style={{ minHeight: `${footerBlockHeight}px` }}
                >
                  <img
                    src={school.stamp}
                    alt="School Stamp & Principal's Signature"
                    className="max-w-[168px] w-auto h-auto block"
                    style={{ maxHeight: `${stampImageMaxHeight}px` }}
                    data-testid="img-stamp"
                  />
                </div>
              ) : (
                <div
                  className="border border-gray-300 dark:border-gray-600 p-2 h-full w-full flex items-center justify-center text-[10px] text-gray-500 report-footer-box"
                  style={{ minHeight: `${footerBlockHeight}px` }}
                >
                  Stamp/Signature not set in School Settings.
                </div>
              )}
            </div>

            <div
              className="flex flex-col justify-start gap-1 report-principal-info"
              style={{ minHeight: `${footerBlockHeight}px` }}
            >
              <strong>School Principal</strong>
              {principalInfoItems.map((item) => (
                <div key={item}>{item}</div>
              ))}
            </div>

            <div className="flex justify-end pr-2">
              <div
                className="flex flex-col items-center justify-between h-full report-qr-block"
                style={{ minHeight: `${footerBlockHeight}px`, width: `${qrCaptionWidth}px` }}
              >
                <img
                  className="object-contain"
                  style={{ width: `${qrCodeSize}px`, height: `${qrCodeSize}px` }}
                  alt="QR Code"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent("https://www.firstchoicegroup.co.zw")}`}
                  data-testid="img-qr-code"
                />
                <div className="text-[9px] text-gray-600 dark:text-gray-400 text-center leading-none whitespace-nowrap w-full">
                  www.firstchoicegroup.co.zw
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {studentReport.ecdSections && studentReport.ecdSections.length > 0 && (
        <EcdChecklistSection
          sections={studentReport.ecdSections}
          studentName={name}
          admissionNo={student.admissionNo}
          className={data.class.className}
          examName={data.exam.examName}
        />
      )}
      <div className="flex justify-end gap-2 mt-2 print:hidden flex-wrap">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onPrintIndividual(student.id)}
          data-testid={`button-download-${student.id}`}
        >
          <Download className="w-4 h-4 mr-1" />
          Download
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSendIndividual(student.id)}
          disabled={sendingId === student.id}
          data-testid={`button-send-${student.id}`}
        >
          {sendingId === student.id ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <Send className="w-4 h-4 mr-1" />
          )}
          Send Individual Report Card
        </Button>
      </div>
    </div>
  );
}

function ProgressBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">–</span>;
  const cls = pct >= 80 ? "qc-pct-circle-ok" : pct >= 40 ? "qc-pct-circle-mid" : "qc-pct-circle-bad";
  return (
    <span className={`qc-pct-circle ${cls}`} data-testid="pill-progress">
      {pct}%
    </span>
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
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{classLabel} — Missing Marks</DialogTitle>
          <DialogDescription>
            Students who have not been marked, grouped by subject
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
                    <span
                      className="font-semibold"
                      data-testid={`text-missing-subject-${sub.subjectId}`}
                    >
                      {sub.subjectName}
                    </span>
                    <span className="text-sm text-red-600 dark:text-red-400 font-medium">
                      {sub.missingCount}/{sub.totalStudents} missing
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {sub.missingStudents.map((s) => (
                      <div key={s.id} className="text-sm p-2 border rounded-md">
                        {s.name}
                        {s.admissionNo && (
                          <span className="text-muted-foreground ml-1">
                            ({s.admissionNo})
                          </span>
                        )}
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{classLabel} — Merit List</DialogTitle>
          <DialogDescription>
            Sorted by average (missing marks count as 0)
          </DialogDescription>
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
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm border-collapse"
              data-testid="table-merit-list"
            >
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 font-semibold">Student</th>
                  {data.subjects.map((s) => (
                    <th key={s.id} className="text-center p-2 font-semibold">
                      {s.name}
                    </th>
                  ))}
                  <th className="text-center p-2 font-semibold">Total</th>
                  <th className="text-center p-2 font-semibold">Average</th>
                  <th className="text-center p-2 font-semibold">Pos</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, idx) => (
                  <tr key={idx} className="border-b hover-elevate">
                    <td className="p-2">
                      <div className="font-medium">{row.studentName}</div>
                      {row.admissionNo && (
                        <div className="text-xs text-muted-foreground">
                          {row.admissionNo}
                        </div>
                      )}
                    </td>
                    {data.subjects.map((s) => (
                      <td key={s.id} className="text-center p-2">
                        {row.cells[s.id] !== null &&
                        row.cells[s.id] !== undefined
                          ? `${Math.round(row.cells[s.id]!)}%`
                          : "–"}
                      </td>
                    ))}
                    <td className="text-center p-2">{row.total}</td>
                    <td className="text-center p-2 font-semibold">
                      {Math.round(row.avg)}%
                    </td>
                    <td className="text-center p-2">{row.position}</td>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{classLabel} — Analytics</DialogTitle>
          <DialogDescription>
            Grade distribution and subject performance summary
          </DialogDescription>
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                  <div className="text-2xl font-bold">{data.enteredCells}</div>
                  <div className="text-xs text-muted-foreground">
                    Marks Entered
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

            {Object.keys(data.gradeCounts).length > 0 && (
              <div>
                <h4 className="font-semibold mb-2">Grade Distribution</h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.gradeCounts)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([grade, count]) => (
                      <div
                        key={grade}
                        className="border rounded-md px-3 py-1.5 text-sm"
                      >
                        <span className="font-semibold">{grade}</span>: {count}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {data.subjectSummary.length > 0 && (
              <div>
                <h4 className="font-semibold mb-2">Subject Summary</h4>
                <div className="overflow-x-auto">
                  <table
                    className="w-full text-sm border-collapse"
                    data-testid="table-analytics-subjects"
                  >
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Subject</th>
                        <th className="text-center p-2">Avg</th>
                        <th className="text-center p-2">Completion</th>
                        <th className="text-center p-2">Pass Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.subjectSummary.map((s) => (
                        <tr key={s.subjectId} className="border-b">
                          <td className="p-2">{s.subjectName}</td>
                          <td className="text-center p-2 font-semibold">
                            {s.avg}%
                          </td>
                          <td className="text-center p-2">{s.completion}%</td>
                          <td className="text-center p-2">{s.passRate}%</td>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{streamName} — Stream Merit List</DialogTitle>
          <DialogDescription>
            Top students across all classes in this stream
          </DialogDescription>
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
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm border-collapse"
              data-testid="table-stream-merit"
            >
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 font-semibold">Student</th>
                  {data.subjects.map((s, i) => (
                    <th key={i} className="text-center p-2 font-semibold">
                      {s}
                    </th>
                  ))}
                  <th className="text-center p-2 font-semibold">Total</th>
                  <th className="text-center p-2 font-semibold">Average</th>
                  <th className="text-center p-2 font-semibold">Pos</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="p-2">
                      <div className="font-medium">{row.studentName}</div>
                      {row.admissionNo && (
                        <div className="text-xs text-muted-foreground">
                          {row.admissionNo}
                        </div>
                      )}
                    </td>
                    {row.subjectMarks.map((val, i) => (
                      <td key={i} className="text-center p-2">
                        {val}
                      </td>
                    ))}
                    <td className="text-center p-2">{row.total}</td>
                    <td className="text-center p-2 font-semibold">{row.avg}</td>
                    <td className="text-center p-2">{row.position}</td>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{streamName} — Stream Analytics</DialogTitle>
          <DialogDescription>
            Subject grade breakdown and pass rates across the stream
          </DialogDescription>
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
                <tr className="border-b">
                  <th className="text-left p-2 font-semibold">Subject</th>
                  <th className="text-center p-2 font-semibold">Avg</th>
                  <th className="text-center p-2 font-semibold">Passed</th>
                  <th className="text-center p-2 font-semibold">Failed</th>
                  <th className="text-center p-2 font-semibold">Pass Rate</th>
                  {["A*", "A", "B", "C", "D", "E", "F"].map((g) => (
                    <th key={g} className="text-center p-2 font-semibold">
                      {g}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.subjectId} className="border-b">
                    <td className="p-2">{row.subjectName}</td>
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
                    {["A*", "A", "B", "C", "D", "E", "F"].map((g) => (
                      <td key={g} className="text-center p-2">
                        {row.gradeCounts[g] || 0}
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
}) {
  const { data: streamStats, isLoading } = useQuery<StreamStat[]>({
    queryKey: ["/api/report-hub/stream-stats", String(exam.id)],
  });

  if (isLoading) {
    return (
      <div className="mb-8">
        <h3
          className="text-center font-semibold text-sm uppercase mb-3 text-foreground"
          data-testid={`text-exam-title-${exam.id}`}
        >
          {exam.examName}
        </h3>
        <Card>
          <CardContent className="p-4">
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeStats = (streamStats || []).filter((s) => s.classCount > 0);

  if (activeStats.length === 0) return null;

  return (
    <div className="mb-8" data-testid={`section-exam-${exam.id}`}>
      <h3
        className="text-center font-semibold text-sm uppercase mb-3 text-foreground"
        data-testid={`text-exam-title-${exam.id}`}
      >
        {exam.examName}
      </h3>
      <div
        className="overflow-hidden"
        style={{ border: "1.5px solid rgba(27, 42, 92, 0.25)", borderRadius: "14px" }}
      >
          <div className="overflow-visible">
            <table
              className="w-full text-sm"
              style={{ borderCollapse: "separate", borderSpacing: 0 }}
              data-testid={`table-stream-hub-${exam.id}`}
            >
              <thead>
                <tr className="border-b" style={{ backgroundColor: "rgba(27, 42, 92, 0.1)" }}>
                  <th className="text-left p-3 font-semibold">Stream</th>
                  <th className="text-center p-3 font-semibold">Progress</th>
                  <th className="text-center p-3 font-semibold">Avg Mark</th>
                  <th className="text-right p-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeStats.map((stat) => {
                  const hasData =
                    stat.progressPct !== null && stat.progressPct > 0;
                  const avgLabel =
                    stat.avgPct !== null ? `${stat.avgPct}%` : "–";

                  return (
                    <tr
                      key={stat.streamId}
                      className="border-b"
                      data-testid={`row-stream-${exam.id}-${stat.streamId}`}
                    >
                      <td className="p-3">
                        <div className="font-medium">{stat.streamName}</div>
                      </td>
                      <td className="text-center p-3">
                        <ProgressBadge pct={stat.progressPct} />
                      </td>
                      <td className="text-center p-3">
                        <span className={`font-semibold ${
                          stat.avgPct === null
                            ? "text-muted-foreground"
                            : stat.avgPct >= 80
                              ? "text-green-600 dark:text-green-400"
                              : stat.avgPct >= 40
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-red-600 dark:text-red-400"
                        }`}>
                          {avgLabel}
                        </span>
                      </td>
                      <td className="text-right p-3">
                        {hasData ? (
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  data-testid={`button-options-${exam.id}-${stat.streamId}`}
                                >
                                  Options{" "}
                                  <ChevronDown className="w-3 h-3 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="min-w-[200px]"
                              >
                                <DropdownMenuItem
                                  onClick={() =>
                                    onNavigateClassLevel(
                                      String(exam.id),
                                      exam.examName,
                                      stat.streamId,
                                      stat.streamName,
                                    )
                                  }
                                  data-testid={`button-class-level-${exam.id}-${stat.streamId}`}
                                >
                                  <Eye className="w-4 h-4 mr-2" /> View at Class
                                  Level
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    onOpenStreamModal(
                                      exam.id,
                                      stat.streamId,
                                      stat.streamName,
                                      "merit",
                                    )
                                  }
                                  data-testid={`button-stream-merit-${exam.id}-${stat.streamId}`}
                                >
                                  <Trophy className="w-4 h-4 mr-2" /> Stream
                                  Merit List
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    onOpenStreamModal(
                                      exam.id,
                                      stat.streamId,
                                      stat.streamName,
                                      "analytics",
                                    )
                                  }
                                  data-testid={`button-stream-analytics-${exam.id}-${stat.streamId}`}
                                >
                                  <BarChart3 className="w-4 h-4 mr-2" /> Stream
                                  Analytics
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-white border-[#1b2a5c] no-default-hover-elevate"
                                  style={{ backgroundColor: "#1b2a5c" }}
                                  data-testid={`button-reports-${exam.id}-${stat.streamId}`}
                                >
                                  <FileText className="w-4 h-4 mr-1" />
                                  Reports{" "}
                                  <ChevronDown className="w-3 h-3 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="min-w-[180px]"
                              >
                                {stat.classes.length === 0 ? (
                                  <DropdownMenuItem disabled>
                                    No classes found
                                  </DropdownMenuItem>
                                ) : (
                                  stat.classes.map((cls) => (
                                    <DropdownMenuItem
                                      key={cls.id}
                                      onClick={() =>
                                        onNavigateReports(
                                          String(exam.id),
                                          String(cls.id),
                                          cls.name,
                                        )
                                      }
                                      data-testid={`button-report-class-${exam.id}-${cls.id}`}
                                    >
                                      {cls.name}
                                    </DropdownMenuItem>
                                  ))
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      </div>
    </div>
  );
}

export default function AcademicReportsPage() {
  const { currentSchoolId } = useAuth();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>("hub");
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [selectedExamName, setSelectedExamName] = useState<string>("");
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedClassName, setSelectedClassName] = useState<string>("");
  const [selectedStreamId, setSelectedStreamId] = useState<number | null>(null);
  const [selectedStreamName, setSelectedStreamName] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [printStudentId, setPrintStudentId] = useState<number | null>(null);
  const originalTitleRef = useRef<string | null>(null);
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
    enabled: !!currentSchoolId,
  });

  const { data: exams = [], isLoading: examsLoading } = useQuery<Exam[]>({
    queryKey: ["/api/report-cards/exams"],
    enabled: !!currentSchoolId,
  });

  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
    enabled: !!currentSchoolId,
  });

  const { data: currentSchool } = useQuery<any>({
    queryKey: ["/api/schools/current", currentSchoolId],
    enabled: !!currentSchoolId,
    queryFn: async () => {
      const res = await fetch("/api/schools/current", {
        credentials: "include",
        headers: currentSchoolId ? { "X-School-Id": String(currentSchoolId) } : undefined,
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

  const studentsForPrint = useMemo(() => {
    if (!printStudentId) return filteredStudents;
    return filteredStudents.filter((rc) => rc.student.id === printStudentId);
  }, [filteredStudents, printStudentId]);

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
  ) => {
    if (!selectedExamId) return;

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
  ) => {
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

  useEffect(() => {
    const handleAfterPrint = () => {
      if (originalTitleRef.current !== null) {
        document.title = originalTitleRef.current;
        originalTitleRef.current = null;
      }
      setPrintStudentId(null);
    };

    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

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
        title: "Report Cards Sent",
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


  const triggerPrintPreview = (title: string, studentId: number | null = null) => {
    originalTitleRef.current = document.title;
    document.title = title;
    setPrintStudentId(studentId);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  };

  const handlePrintAll = () => {
    const examLabel = selectedExamName?.replace(/\s+/g, "_") || "Exam";
    const classLabel = selectedClassName?.replace(/\s+/g, "_") || "Class";
    triggerPrintPreview(`Report_Cards_${classLabel}_${examLabel}`);
  };

  const handlePrintIndividual = (studentId: number) => {
    const rc = filteredStudents.find((row) => row.student.id === studentId);
    if (!rc) return;

    const studentName = `${rc.student.firstName}_${rc.student.lastName}`.replace(/\s+/g, "_");
    const examLabel = selectedExamName?.replace(/\s+/g, "_") || "Exam";
    const classLabel = selectedClassName?.replace(/\s+/g, "_") || "Class";
    triggerPrintPreview(`Report_Card_${studentName}_${classLabel}_${examLabel}`, studentId);
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
      <style>{`
        @media print {
          body > *:not(#report-print-portal) { display: none !important; }
          #report-print-portal { display: block !important; position: static !important; }
          .print-hide-for-print { display: none !important; }
          @page { size: A4; margin: 5mm; }
          .report-slip { box-shadow: none !important; border-radius: 0 !important; margin-bottom: 0 !important; page-break-after: always; background: white !important; color: black !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-slip-page--main { min-height: calc(287mm - 2px) !important; height: calc(287mm - 2px) !important; }
          .report-graphs-row { align-items: stretch !important; }
          .report-footer-row { align-items: stretch !important; }
          .report-footer-box, .report-principal-info, .report-qr-block { height: 100% !important; }
          .report-slip th { background: #6b7280 !important; color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-slip tbody tr[class*="bg-gray-100"] { background: #f3f4f6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-slip tbody tr[class*="bg-gray-100"] td { background: #f3f4f6 !important; -webkit-print-color-adjust: exact; }
          .report-slip-inner { border: 1px solid #ccc !important; }
          .report-slip [class*="text-green"] { color: #16a34a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-slip [class*="text-red"] { color: #dc2626 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-slip [class*="text-amber"] { color: #d97706 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-slip [class*="text-blue"] { color: #2563eb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-slip [class*="text-gray"] { color: #6b7280 !important; }
          .report-slip tr[style*="rgba(27, 42, 92"] { background: rgba(27, 42, 92, 0.1) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-slip [class*="bg-green-600"] { background: #16a34a !important; color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-slip svg polyline, .report-slip svg line, .report-slip svg circle { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-slip [style*="linear-gradient"] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-slip div[style*="background"] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        @media screen {
          .print-only { display: none; }
          #report-print-portal { position: absolute; left: -9999px; top: 0; width: 210mm; }
        }
      `}</style>
      <div className="print-hide-for-print p-6 max-w-[1100px] mx-auto">
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
                            <div>
                              {typeExams.map((exam) => (
                                <ExamStreamTable
                                  key={exam.id}
                                  exam={exam}
                                  onNavigateClassLevel={navigateToClassLevel}
                                  onNavigateReports={navigateToReports}
                                  onOpenStreamModal={openStreamModal}
                                />
                              ))}
                            </div>
                          )}
                        </TabsContent>
                      );
                    })}

                    {unassigned.length > 0 && (
                      <TabsContent
                        value="unassigned"
                        data-testid="tab-content-at-unassigned"
                      >
                        <div>
                          {unassigned.map((exam) => (
                            <ExamStreamTable
                              key={exam.id}
                              exam={exam}
                              onNavigateClassLevel={navigateToClassLevel}
                              onNavigateReports={navigateToReports}
                              onOpenStreamModal={openStreamModal}
                            />
                          ))}
                        </div>
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
                <h2 className="text-lg font-semibold">
                  {selectedClassName} — Report Cards
                </h2>
                <p className="text-sm text-muted-foreground">
                  {selectedExamName}
                </p>
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
                      onClick={handlePrintAll}
                      data-testid="button-download-all"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download All
                    </Button>
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
                  onPrintIndividual={handlePrintIndividual}
                  sendingId={sendingId}
                  editableComments
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
                />
              ))}
            </div>
            {createPortal(
              <div id="report-print-portal">
                {studentsForPrint.map((rc) => (
                  <ReportCardSlip
                    key={`print-${rc.student.id}`}
                    data={reportCardData}
                    studentReport={rc}
                    onSendIndividual={handleSendIndividual}
                    onPrintIndividual={handlePrintIndividual}
                    sendingId={sendingId}
                    editableComments={false}
                    commentValues={reportCardCommentDrafts[rc.student.id]}
                    commentSaveStates={{ principal: "idle", class_teacher: "idle" }}
                    subjectCommentValues={reportCardSubjectCommentDrafts}
                    subjectCommentSaveStates={reportCardSubjectCommentStatuses}
                  />
                ))}
              </div>,
              document.body
            )}
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
  const { data, isLoading } = useQuery<ClassProgressData>({
    queryKey: ["/api/report-hub/class-progress", examId, classId],
    enabled: !!examId && !!classId,
  });

  return (
    <Card data-testid={`card-class-${classId}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">
            {classLabel} — {examName}
          </CardTitle>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={onMissingMarks}
              data-testid={`button-missing-${classId}`}
            >
              <AlertTriangle className="w-4 h-4 mr-1" /> Missing Marks
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onMerit}
              data-testid={`button-merit-${classId}`}
            >
              <Trophy className="w-4 h-4 mr-1" /> Merit List
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onAnalytics}
              data-testid={`button-analytics-${classId}`}
            >
              <BarChart3 className="w-4 h-4 mr-1" /> Analytics
            </Button>
            <Button
              size="sm"
              onClick={onReports}
              data-testid={`button-reports-${classId}`}
            >
              <FileText className="w-4 h-4 mr-1" /> Reports
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !data || data.subjects.length === 0 ? (
          <div className="py-4 text-center text-muted-foreground text-sm">
            No assessments/subjects found for this class in the selected exam
            yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              data-testid={`table-class-progress-${classId}`}
            >
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-2 font-semibold">Subject</th>
                  <th className="text-center p-2 font-semibold">Progress</th>
                  <th className="text-center p-2 font-semibold">Avg Mark</th>
                </tr>
              </thead>
              <tbody>
                {data.subjects.map((sub: any) => (
                  <tr key={sub.subjectId} className="border-b">
                    <td className="p-2">
                      <div>{sub.subjectName}</div>
                      <div className="text-xs text-muted-foreground">
                        Students: {sub.totalStudents}
                      </div>
                    </td>
                    <td className="text-center p-2">
                      <ProgressBadge pct={sub.progressPct} />
                    </td>
                    <td className="text-center p-2">
                      {sub.avgPct !== null ? `${sub.avgPct}%` : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  const [commentText, setCommentText] = useState("");
  const [selectedGradeId, setSelectedGradeId] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState("");
  const [dupModalOpen, setDupModalOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [missingTargets, setMissingTargets] = useState<any[]>([]);
  const [pendingText, setPendingText] = useState("");
  const [pendingGradeOption, setPendingGradeOption] = useState<ReportCommentGradeOption | null>(null);
  const isClassTeacher = commentType === "class_teacher";

  const { data: comments = [], isLoading } = useQuery<ReportComment[]>({
    queryKey: ["/api/report-comments", currentSchoolId, commentType],
    enabled: open && !!currentSchoolId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await schoolFetch(`/api/report-comments?commentType=${commentType}`);
      if (!res.ok) throw new Error("Failed to load report comments");
      return res.json();
    },
  });

  const { data: classesData = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes", currentSchoolId, "report-comments"],
    enabled: open && !!currentSchoolId,
    queryFn: async () => {
      const res = await schoolFetch("/api/classes");
      if (!res.ok) throw new Error("Failed to load classes");
      return res.json();
    },
  });

  const { data: staffData = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", currentSchoolId, "report-comments"],
    enabled: open && !!currentSchoolId,
    queryFn: async () => {
      const res = await schoolFetch("/api/staff");
      if (!res.ok) throw new Error("Failed to load staff");
      return res.json();
    },
  });

  const { data: gradesResponse } = useQuery<{ items: Grade[] } | Grade[]>({
    queryKey: ["/api/grades", currentSchoolId, "report-comments"],
    enabled: open && !!currentSchoolId,
    queryFn: async () => {
      const params = new URLSearchParams({ page: "1", perPage: "500" });
      const res = await schoolFetch(`/api/grades?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load grades");
      return res.json();
    },
  });
  const gradesData = Array.isArray(gradesResponse) ? gradesResponse : (gradesResponse?.items ?? []);

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

  const { data: streamsData = [] } = useQuery<Stream[]>({
    queryKey: ["/api/streams", resolvedSchoolType, currentSchoolId, "report-comments"],
    enabled: open && !!currentSchoolId && !!resolvedSchoolType,
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

    const validTabs = new Set(profileTabs.map((profile) => profile.key));
    setActiveTab((previous) => (validTabs.has(previous) ? previous : profileTabs[0].key));
  }, [profileTabs]);

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

  const gradeRankMap: Record<string, number> = { "A*": 0, A: 1, B: 2, C: 3, D: 4, E: 5, U: 6 };
  const sortedGrades = useMemo(() => {
    return [...gradesData].sort((a, b) => {
      const rankA = gradeRankMap[a.gradeName.toUpperCase().replace(/\s/g, "")] ?? 999;
      const rankB = gradeRankMap[b.gradeName.toUpperCase().replace(/\s/g, "")] ?? 999;
      if (rankA !== rankB) return rankA - rankB;
      return (b.upperLimit ?? 0) - (a.upperLimit ?? 0);
    });
  }, [gradesData]);

  const filteredGrades = useMemo<ReportCommentGradeOption[]>(() => {
    const matchedGrades = sortedGrades.filter((grade) => reportCommentGradeMatchesTab(grade.gradeLevel, activeTab));
    const blankProfileGrades = sortedGrades.filter((grade) => !normalizeReportCommentProfileToken(grade.gradeLevel));

    const sourceGrades =
      matchedGrades.length > 0
        ? matchedGrades
        : blankProfileGrades.length > 0
          ? blankProfileGrades
          : resolvedSchoolType === "primary"
            ? sortedGrades
            : matchedGrades;

    return sourceGrades.map((grade) => ({
      id: grade.id,
      gradeName: grade.gradeName,
      gradeLevel: grade.gradeLevel,
      lowerLimit: Number(grade.lowerLimit ?? 0),
      upperLimit: Number(grade.upperLimit ?? 0),
      gradePoints: Number(grade.gradePoints ?? 0),
      gradeStatus: grade.gradeStatus,
      gradeType: grade.gradeType,
    }));
  }, [sortedGrades, activeTab, resolvedSchoolType]);

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

  const filteredComments = useMemo(() => {
    return comments.filter((comment) => {
      if (comment.commentType !== commentType) return false;
      if (activeTab) {
        const linkedGrade = comment.gradeId ? fetchedGradeMap.get(comment.gradeId) : undefined;
        const commentProfile = linkedGrade?.gradeLevel || comment.gradeLevel || null;
        if (!reportCommentGradeMatchesTab(commentProfile, activeTab)) {
          const visibleGradeNames = new Set(filteredGrades.map((grade) => grade.gradeName.trim().toLowerCase()));
          const fallbackGradeName = (comment.commentGrade || "").trim().toLowerCase();
          if (!fallbackGradeName || !visibleGradeNames.has(fallbackGradeName)) return false;
        }
      }
      if (isClassTeacher && selectedClassIds.length > 0 && !selectedClassIds.includes(comment.classId || -1)) return false;
      return true;
    });
  }, [comments, activeTab, selectedClassIds, isClassTeacher, commentType, fetchedGradeMap, filteredGrades]);

  const sortedComments = useMemo(() => {
    return [...filteredComments].sort((a, b) => {
      const gradeA = findCommentGradeOption(a);
      const gradeB = findCommentGradeOption(b);
      return (gradeB?.upperLimit ?? 0) - (gradeA?.upperLimit ?? 0);
    });
  }, [filteredComments, findCommentGradeOption]);

  const refreshComments = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/report-comments", currentSchoolId, commentType] });
    await queryClient.refetchQueries({ queryKey: ["/api/report-comments", currentSchoolId, commentType], exact: true });
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
        (!activeTab || commentProfile === activeTab)
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
      return commentProfile === activeTab;
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
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle data-testid="text-report-comments-title">{title}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {isClassTeacher
                ? "Comments are matched by grading system, class, and overall average grade band."
                : "Comments are matched by grading system and overall average grade band."}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
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
        <DialogContent className="max-w-xl max-h-[88vh] flex flex-col">
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
