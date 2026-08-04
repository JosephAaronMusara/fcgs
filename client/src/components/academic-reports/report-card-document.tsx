import { useState, useEffect, useRef, type ReactNode, type CSSProperties } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Download, Send, ArrowRight, TrendingUp, TrendingDown, School, Loader2 } from "lucide-react";
import type { Exam, Class, Subject } from "@shared/schema";

let sharedReportQrPromise: Promise<string> | null = null;

function getSharedReportQrDataUrl(): Promise<string> {
  if (!sharedReportQrPromise) {
    sharedReportQrPromise = QRCode.toDataURL("https://www.firstchoicegroup.co.zw", {
      width: 300,
      margin: 0,
      errorCorrectionLevel: "M",
    }).catch(() => "");
  }
  return sharedReportQrPromise!;
}

interface PublicationState {
  isPublished: boolean;
  status: "Published" | "Republished" | "Unpublished";
  publicationVersion?: number;
  publishedAt?: string | null;
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

type ReportCardSubjectCommentDraftMap = Record<string, string>;

type ReportCardCommentStatus = "idle" | "saving" | "saved" | "error";

export interface ReportCardData {
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
        minHeight: "calc(297mm - 4mm - 16px)",
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

function ReportAssetImage({
  src,
  alt,
  className,
  style,
  fallback,
  testId,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  style?: CSSProperties;
  fallback: ReactNode;
  testId?: string;
}) {
  const [failed, setFailed] = useState(false);
  const assetTimeoutRef = useRef<number | null>(null);

  const clearAssetTimeout = () => {
    if (assetTimeoutRef.current !== null) {
      window.clearTimeout(assetTimeoutRef.current);
      assetTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    clearAssetTimeout();
    setFailed(false);
    if (!src) return;
    assetTimeoutRef.current = window.setTimeout(() => {
      assetTimeoutRef.current = null;
      setFailed(true);
    }, 10_000);
    return clearAssetTimeout;
  }, [src]);

  if (!src || failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      data-testid={testId}
      data-pdf-asset="true"
      onLoad={clearAssetTimeout}
      onError={() => {
        clearAssetTimeout();
        setFailed(true);
      }}
    />
  );
}

export function ReportCardSlip({
  data,
  studentReport,
  onSendIndividual,
  onDownloadIndividual,
  sendingId,
  downloadingId,
  editableComments,
  commentValues,
  commentSaveStates,
  onCommentChange,
  subjectCommentValues,
  subjectCommentSaveStates,
  onSubjectCommentChange,
  canSendIndividual,
  documentMode = false,
  downloadStage = "idle",
}: {
  data: ReportCardData;
  studentReport: ReportStudent;
  onSendIndividual: (studentId: number) => void;
  onDownloadIndividual: (studentId: number) => void;
  sendingId: number | null;
  downloadingId: number | null;
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
  canSendIndividual: boolean;
  documentMode?: boolean;
  downloadStage?: "idle" | "saving" | "generating";
}) {
  const { student, subjects, summary } = studentReport;
  const { school } = data;
  const name = `${student.firstName} ${student.lastName}`;
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [qrReady, setQrReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSharedReportQrDataUrl().then((value) => {
      if (!cancelled) { setQrDataUrl(value); setQrReady(true); }
    }).catch(() => {
      if (!cancelled) { setQrDataUrl(""); setQrReady(true); }
    });
    return () => { cancelled = true; };
  }, []);

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

  // PDF pagination now moves complete sections to the next A4 page, so the
  // header and charts no longer need to be compressed when a report is long.
  const graphPlotHeight = 92;
  const graphLabelHeight = 55;
  const headerSideWidth = 112;
  const headerImageSize = 91;
  const headerGap = 8;
  const headerSchoolNameSize = 14;
  const headerInfoSize = 11;
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
      className={`${documentMode ? "w-full" : "w-full max-w-full overflow-x-auto overscroll-x-contain pb-2"} report-card-student-document`}
      style={documentMode ? undefined : { WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}
      data-testid={`scroll-report-card-${student.id}`}
    >
      <div className={documentMode ? "w-full" : "min-w-[780px]"}>
        <div
          className="report-slip bg-white dark:bg-gray-900 rounded-lg mb-8 shadow-lg p-2 print:shadow-none print:rounded-none print:mb-0 print:p-0"
          style={documentMode ? undefined : { pageBreakInside: "avoid", pageBreakAfter: "always" }}
          data-report-qr-ready={qrReady ? "true" : "false"}
        >
      <div
        className="report-slip-inner report-slip-page report-slip-page--main border border-gray-300 dark:border-gray-600 py-2.5 px-1.5 relative report-slip-page-flow"
        style={{ fontSize: "12px", minHeight: "calc(293mm - 2px)" }}
      >
        {school.logo && (
          <ReportAssetImage
            src={school.logo}
            alt=""
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] opacity-[0.08] pointer-events-none z-0"
            fallback={null}
          />
        )}

        <div className="relative z-10 report-content-flow">
          <div className="report-primary-section">
          <div className="grid items-center" style={{ gridTemplateColumns: `${headerSideWidth}px 1fr ${headerSideWidth}px`, gap: `${headerGap}px` }}>
            <div className="text-left">
              <ReportAssetImage
                src={school.logo}
                alt="School logo"
                className="object-contain"
                style={{ width: `${headerImageSize}px`, height: `${headerImageSize}px` }}
                testId="img-school-logo"
                fallback={(
                  <div className="border border-gray-400 rounded-lg flex items-center justify-center" style={{ width: `${headerImageSize}px`, height: `${headerImageSize}px` }}>
                    <School className="w-10 h-10 text-gray-400" />
                  </div>
                )}
              />
            </div>

            <div className="text-center">
              <div
                className="font-bold text-gray-900 dark:text-gray-100"
                style={{ fontSize: `${headerSchoolNameSize}px` }}
                data-testid="text-school-name"
              >
                {school.name}
              </div>
              {school.phone && (
                <div className="mt-0.5 text-gray-700 dark:text-gray-300" style={{ fontSize: `${headerInfoSize}px` }}>
                  <strong>Call Centre:</strong> {school.phone}
                </div>
              )}
              {school.email && (
                <div className="mt-0.5 text-gray-700 dark:text-gray-300" style={{ fontSize: `${headerInfoSize}px` }}>
                  <strong>Email:</strong> {school.email}
                </div>
              )}
              {school.address && (
                <div className="mt-0.5 text-gray-700 dark:text-gray-300" style={{ fontSize: `${headerInfoSize}px` }}>
                  <strong>Address:</strong> {school.address}
                </div>
              )}
            </div>

            <div className="text-right">
              <ReportAssetImage
                src={student.photo}
                alt="Student photo"
                className="rounded-lg border border-gray-400 object-cover inline-block"
                style={{ width: `${headerImageSize}px`, height: `${headerImageSize}px` }}
                testId={`img-student-photo-${student.id}`}
                fallback={(
                  <div className="rounded-lg border border-gray-400 inline-flex items-center justify-center text-[10px] text-gray-500" style={{ width: `${headerImageSize}px`, height: `${headerImageSize}px` }}>
                    PHOTO
                  </div>
                )}
              />
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
                className="w-full border-collapse text-[10px] mt-0.5"
                data-testid="table-summary"
              >
                <thead>
                  <tr>
                    <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[10px] leading-tight">
                      Total Marks
                    </th>
                    <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[10px] leading-tight">
                      Average Mark
                    </th>
                    <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[10px] leading-tight">
                      Subject Passed
                    </th>
                    <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[10px] leading-tight">
                      Points
                    </th>
                    {data.school.showClassPositionOnReports && (
                      <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[10px] leading-tight">
                        Class Position
                      </th>
                    )}
                    <th className="border-b border-gray-400 dark:border-gray-500 px-2.5 py-0.5 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[10px] leading-tight">
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
                      {Number(summary.subjectsUnresolved || 0) > 0 && (
                        <div className="text-[8px] font-medium text-amber-700 dark:text-amber-300">
                          Unresolved: {summary.subjectsUnresolved}
                        </div>
                      )}
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

          {summary.positionStatus === "UNRESOLVED" && (
            <div className="mt-1 text-center text-[8px] font-semibold text-amber-700 dark:text-amber-300">
              Position pending: complete and resolve all configured grading results.
            </div>
          )}

          <table
            className="report-subject-table w-full table-fixed border-collapse mt-1 text-[10px]"
            data-testid={`table-subjects-${student.id}`}
          >
            <thead className="report-subject-table-head">
              <tr>
                <th className="w-[22%] border-b border-gray-400 dark:border-gray-500 px-1.5 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-left text-[10px]">
                  Subject
                </th>
                <th className="w-[7%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[10px] whitespace-nowrap">
                  Mark %
                </th>
                <th className="w-[8%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[10px] whitespace-nowrap">
                  Dev.
                </th>
                <th className="w-[10%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[10px] whitespace-nowrap">
                  Class Avg %
                </th>
                <th className="w-[5%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[10px] whitespace-nowrap">
                  Grade
                </th>
                <th className="w-[6%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-center text-[10px] whitespace-nowrap">
                  Rank
                </th>
                <th className="w-[45%] border-b border-gray-400 dark:border-gray-500 px-1.5 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-left text-[10px]">
                  Comment
                </th>
                <th className="w-[13%] border-b border-gray-400 dark:border-gray-500 px-1 py-1 bg-gray-500 dark:bg-gray-700 text-white font-semibold text-left text-[10px] whitespace-nowrap">
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
                  <tr key={subj.subjectId} className="report-subject-row">
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
          </div>

          <div className="report-section report-section--graphs mt-1">
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

          <div className="mt-1.5 text-[9px] space-y-1.5 leading-snug report-comments-stack">
            <div className="report-section report-section--class-comment">
              {editableComments ? (
                <>
                  <div className="font-semibold mb-0.5">Class Teacher's Comment:</div>
                  <Textarea
                    value={displayedClassTeacherComment}
                    onChange={(e) => onCommentChange?.(student.id, "class_teacher", e.target.value)}
                    rows={2}
                    className="min-h-[56px] text-[10px] leading-snug resize-none bg-white"
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
            <div className="report-section report-section--principal-comment">
              {editableComments ? (
                <>
                  <div className="font-semibold mb-0.5">Head/Principal's Comment:</div>
                  <Textarea
                    value={displayedPrincipalComment}
                    onChange={(e) => onCommentChange?.(student.id, "principal", e.target.value)}
                    rows={2}
                    className="min-h-[56px] text-[10px] leading-snug resize-none bg-white"
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

            <div className="report-section report-section--footer grid grid-cols-[0.9fr_1.55fr_0.95fr] gap-3 pt-2 text-[11px] items-stretch report-footer-row">
            <div className="flex">
              <div
                className="border border-gray-300 dark:border-gray-600 p-2 h-full w-full flex items-center justify-center report-footer-box"
                style={{ minHeight: `${footerBlockHeight}px` }}
              >
                <ReportAssetImage
                  src={school.stamp}
                  alt="School Stamp & Principal's Signature"
                  className="max-w-[168px] w-auto h-auto block"
                  style={{ maxHeight: `${stampImageMaxHeight}px` }}
                  testId="img-stamp"
                  fallback={<div className="text-[10px] text-gray-500 text-center">Stamp/Signature not set in School Settings.</div>}
                />
              </div>
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
                <ReportAssetImage
                  className="object-contain"
                  style={{ width: `${qrCodeSize}px`, height: `${qrCodeSize}px` }}
                  alt="QR Code"
                  src={qrDataUrl}
                  testId="img-qr-code"
                  fallback={<div className="border border-gray-300 text-[9px] text-gray-500 flex items-center justify-center" style={{ width: `${qrCodeSize}px`, height: `${qrCodeSize}px` }}>QR</div>}
                />
                <div className="text-[9px] text-gray-600 dark:text-gray-400 text-center leading-none whitespace-nowrap w-full">
                  www.firstchoicegroup.co.zw
                </div>
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
      {!documentMode && (
      <div className="flex justify-end gap-2 mt-2 print:hidden flex-wrap">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDownloadIndividual(student.id)}
          disabled={downloadingId === student.id}
          data-testid={`button-download-${student.id}`}
        >
          {downloadingId === student.id ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <Download className="w-4 h-4 mr-1" />
          )}
          {downloadingId === student.id ? (downloadStage === "saving" ? "Saving changes…" : "Generating PDF…") : "Download PDF"}
        </Button>
        {canSendIndividual && (
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
        )}
      </div>
      )}
        </div>
      </div>
    </div>
  );
}
