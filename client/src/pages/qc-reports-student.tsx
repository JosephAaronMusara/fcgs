import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, useSearch } from "wouter";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { LanguageCheckButton } from "@/features/language-tools";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import {
  ArrowLeft, Save, CheckCircle2, Clock, Loader2, Download,
  CalendarDays, BookOpen, TrendingUp, MessageSquare, Smile, Meh, Frown, FileText, Info
} from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

interface MonthCalendar {
  key: string;
  year: number;
  month: number;
  label: string;
}

interface AttendanceData {
  counts: Record<string, number>;
  byDate: Record<string, string>;
  months: MonthCalendar[];
  totalDays: number;
  presentDays: number;
}

interface WrittenWorkRow {
  subject: string;
  subjectId: number;
  tests: number;
  exercises: number;
  fortnight: number;
  total: number;
}

interface PerformanceRow {
  subject: string;
  subjectId: number;
  avg: number | null;
  grade: string;
  comment: string;
}

interface PerfSeriesRow {
  subject: string;
  tests: number;
  exercises: number;
  fortnight: number;
}

interface AssessmentPerformanceSeries {
  assessmentTypes: Array<{ key: string; label: string }>;
  rows: Array<{ subject: string; subjectId: number; values: Record<string, number | null> }>;
}

interface QcReportData {
  id?: number;
  qcStatus: string;
  attendanceComment: string | null;
  behaviourComment: string | null;
  behaviourRating: string | null;
  studyHabitsComment: string | null;
  subjectComments: Record<string, string> | null;
  notes: string | null;
}

interface StudentReportData {
  student: { id: number; firstName: string; lastName: string; admissionNo: string | null; photo: string | null; gender?: string | null };
  className: string;
  classId: number;
  term: number;
  year: string;
  termStart: string;
  termEnd: string;
  school: { name: string; logo: string | null; stamp: string | null; phone: string | null; principalName: string | null };
  attendance: AttendanceData;
  writtenWork: WrittenWorkRow[];
  performance: PerformanceRow[];
  perfSeries: PerfSeriesRow[];
  assessmentPerformanceSeries?: AssessmentPerformanceSeries;
  qcReport: QcReportData | null;
}

const ATT_COLORS: Record<string, { bg: string; letter: string; label: string }> = {
  present:    { bg: "#22c55e", letter: "P", label: "present" },
  absent:     { bg: "#ef4444", letter: "A", label: "absent" },
  sick:       { bg: "#8b5cf6", letter: "S", label: "sick" },
  fees:       { bg: "#111827", letter: "F", label: "fees" },
  suspended:  { bg: "#64748b", letter: "S", label: "suspended" },
  absconding: { bg: "#f97316", letter: "A", label: "absconding" },
  excused:    { bg: "#0ea5e9", letter: "E", label: "excused" },
  late:       { bg: "#f59e0b", letter: "L", label: "late" },
};

function getAttStatus(raw: string): string {
  const k = raw.toLowerCase().trim();
  if (k.includes("present"))  return "present";
  if (k.includes("sick"))     return "sick";
  if (k.includes("fees"))     return "fees";
  if (k.includes("suspend"))  return "suspended";
  if (k.includes("abscond"))  return "absconding";
  if (k.includes("excuse"))   return "excused";
  if (k.includes("late"))     return "late";
  if (k.includes("absent"))   return "absent";
  return "";
}

function FundahCalendar({ month, attendanceByDate }: { month: MonthCalendar; attendanceByDate: Record<string, string> }) {
  const daysInMonth = new Date(month.year, month.month, 0).getDate();
  const firstDayOfWeek = new Date(month.year, month.month - 1, 1).getDay();
  const weekLabels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const weeks: (number | null)[][] = [];
  let currentWeek: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) currentWeek.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  return (
    <div className="qc-att-month">
      <div className="qc-att-month-title">{month.label} {month.year}</div>
      <table>
        <thead>
          <tr>
            {weekLabels.map(d => <th key={d}>{d}</th>)}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((day, di) => {
                if (day === null) return <td key={`e-${di}`} />;
                const dateStr = `${month.year}-${String(month.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const rawStatus = attendanceByDate[dateStr];
                const statusKey = rawStatus ? getAttStatus(rawStatus) : "";
                const cls = statusKey ? `qc-att-${statusKey}` : "qc-att-none";
                return (
                  <td key={day} className={`qc-att-day ${cls}`}>
                    <span>{day}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BEHAVIOUR_OPTIONS = [
  { key: "good", label: "Good", Icon: Smile, colorClass: "qc-br-good" },
  { key: "fair", label: "Fair", Icon: Meh, colorClass: "qc-br-fair" },
  { key: "bad", label: "Bad", Icon: Frown, colorClass: "qc-br-bad" },
] as const;

export default function QCReportsStudentPage() {
  const [, navigate] = useLocation();
  const params = useParams<{ studentId: string }>();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const studentId = params.studentId;
  const classId = searchParams.get("classId") || "";
  const term = searchParams.get("term") || "";
  const year = searchParams.get("year") || "";
  const { toast } = useToast();
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const handleDownloadPdf = useCallback(async () => {
    if (!studentId || !classId || !term || !year || isDownloadingPdf) return;

    // Open the tab synchronously so browsers do not treat the eventual PDF
    // navigation as an unsolicited popup after the authenticated fetch awaits.
    const previewWindow = window.open("about:blank", "_blank");
    setIsDownloadingPdf(true);

    try {
      const pdfUrl = `/api/qc-reports/pdf/${studentId}?classId=${encodeURIComponent(classId)}&term=${encodeURIComponent(term)}&year=${encodeURIComponent(year)}`;
      const response = await schoolFetch(pdfUrl);

      if (!response.ok) {
        let message = `Failed to generate QC report (${response.status})`;
        try {
          const payload = await response.json();
          if (payload?.message) message = payload.message;
        } catch {
          // Keep the status-based message when the error is not JSON.
        }
        throw new Error(message);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/pdf")) {
        throw new Error("The QC report endpoint did not return a PDF.");
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.replace(blobUrl);
      } else {
        const link = document.createElement("a");
        link.href = blobUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.click();
      }

      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error: any) {
      if (previewWindow && !previewWindow.closed) previewWindow.close();
      toast({
        title: "Unable to open QC report",
        description: error?.message || "Failed to generate the QC report PDF.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingPdf(false);
    }
  }, [studentId, classId, term, year, isDownloadingPdf, toast]);

  const [attendanceComment, setAttendanceComment] = useState("");
  const [behaviourComment, setBehaviourComment] = useState("");
  const [behaviourRating, setBehaviourRating] = useState("");
  const [studyHabitsComment, setStudyHabitsComment] = useState("");
  const [subjectComments, setSubjectComments] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [qcStatus, setQcStatus] = useState("not_started");
  const [reportId, setReportId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportIdRef = useRef<number | null>(null);
  const initializedContextRef = useRef("");
  const draftRef = useRef({
    attendanceComment: "", behaviourComment: "", behaviourRating: "", studyHabitsComment: "",
    subjectComments: {} as Record<string, string>, notes: "", qcStatus: "not_started",
  });

  const queryUrl = `/api/qc-reports/student/${studentId}?classId=${classId}&term=${term}&year=${year}`;

  const { data, isLoading } = useQuery<StudentReportData>({
    queryKey: [queryUrl],
  });

  useEffect(() => {
    if (!data) return;
    const contextKey = `${studentId}:${classId}:${term}:${year}`;
    if (initializedContextRef.current === contextKey) return;
    initializedContextRef.current = contextKey;
    const next = {
      attendanceComment: data.qcReport?.attendanceComment || "",
      behaviourComment: data.qcReport?.behaviourComment || "",
      behaviourRating: data.qcReport?.behaviourRating || "",
      studyHabitsComment: data.qcReport?.studyHabitsComment || "",
      subjectComments: data.qcReport?.subjectComments || {},
      notes: data.qcReport?.notes || "",
      qcStatus: data.qcReport?.qcStatus || "not_started",
    };
    draftRef.current = next;
    setAttendanceComment(next.attendanceComment);
    setBehaviourComment(next.behaviourComment);
    setBehaviourRating(next.behaviourRating);
    setStudyHabitsComment(next.studyHabitsComment);
    setSubjectComments(next.subjectComments);
    setNotes(next.notes);
    setQcStatus(next.qcStatus);
    const nextReportId = data.qcReport?.id || null;
    reportIdRef.current = nextReportId;
    setReportId(nextReportId);
  }, [data, studentId, classId, term, year]);

  useEffect(() => { reportIdRef.current = reportId; }, [reportId]);

  const doAutosave = useCallback(async () => {
    if (!data) return;
    const draft = draftRef.current;
    try {
      setIsSaving(true);
      const payload = {
        attendanceComment: draft.attendanceComment,
        behaviourComment: draft.behaviourComment,
        behaviourRating: draft.behaviourRating || null,
        studyHabitsComment: draft.studyHabitsComment,
        subjectComments: draft.subjectComments,
        notes: draft.notes,
        qcStatus: draft.qcStatus || "in_progress",
      };
      if (reportIdRef.current) {
        await apiRequest("PATCH", `/api/qc-reports/autosave/${reportIdRef.current}`, payload);
      } else {
        const res = await apiRequest("POST", "/api/qc-reports/save", {
          ...payload, studentId: parseInt(studentId), classId: parseInt(classId), termNumber: parseInt(term), year,
        });
        const result = await res.json();
        reportIdRef.current = result.id;
        setReportId(result.id);
      }
      setLastSaved(new Date());
    } catch { /* autosave must never interrupt typing */ } finally {
      setIsSaving(false);
    }
  }, [data, studentId, classId, term, year]);

  const scheduleAutosave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(doAutosave, 2000);
  }, [doAutosave]);

  useEffect(() => () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); }, []);

  const saveMutation = useMutation({
    mutationFn: async (status: string) => {
      const payload = {
        qcStatus: status,
        attendanceComment,
        behaviourComment,
        behaviourRating: behaviourRating || null,
        studyHabitsComment,
        subjectComments,
        notes,
      };
      let res;
      if (reportId) {
        res = await apiRequest("PATCH", `/api/qc-reports/autosave/${reportId}`, payload);
      } else {
        res = await apiRequest("POST", "/api/qc-reports/save", {
          ...payload,
          studentId: parseInt(studentId),
          classId: parseInt(classId),
          termNumber: parseInt(term),
          year,
        });
      }
      return res.json();
    },
    onSuccess: (result: any) => {
      const savedId = result?.id ?? result?.report?.id ?? reportIdRef.current;
      if (savedId) {
        reportIdRef.current = Number(savedId);
        setReportId(Number(savedId));
      }
      setLastSaved(new Date());
      toast({ title: "Report saved", description: "QC report has been saved successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/qc-reports"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save report.", variant: "destructive" });
    },
  });

  const handleField = useCallback((field: "attendanceComment" | "behaviourComment" | "behaviourRating" | "studyHabitsComment" | "notes" | "qcStatus", setter: (v: string) => void, value: string) => {
    draftRef.current = { ...draftRef.current, [field]: value };
    setter(value);
    scheduleAutosave();
  }, [scheduleAutosave]);

  const handleSubjectComment = useCallback((subjectId: string, value: string) => {
    const next = { ...draftRef.current.subjectComments, [subjectId]: value };
    draftRef.current = { ...draftRef.current, subjectComments: next };
    setSubjectComments(next);
    scheduleAutosave();
  }, [scheduleAutosave]);

  const chartData = useMemo(() => {
    const series = data?.assessmentPerformanceSeries;
    if (series?.rows?.length && series.assessmentTypes?.length) {
      const palette = ["#1b2a5c", "#c62828", "#b7791f", "#2f855a", "#6b46c1", "#0f766e"];
      return {
        labels: series.rows.map((row) => row.subject),
        datasets: series.assessmentTypes.map((type, index) => ({
          label: type.label,
          data: series.rows.map((row) => row.values[type.key] ?? null),
          backgroundColor: palette[index % palette.length],
        })),
      };
    }
    if (!data?.perfSeries?.length) return null;
    return {
      labels: data.perfSeries.map(r => r.subject),
      datasets: [
        { label: "Tests", data: data.perfSeries.map(r => r.tests), backgroundColor: "#1b2a5c" },
        { label: "Exercises", data: data.perfSeries.map(r => r.exercises), backgroundColor: "#2f855a" },
        { label: "Fortnight", data: data.perfSeries.map(r => r.fortnight), backgroundColor: "#b7791f" },
      ],
    };
  }, [data?.assessmentPerformanceSeries, data?.perfSeries]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 60, font: { size: 10 } } },
      y: { beginAtZero: true, max: 100, title: { display: true, text: "Marks (%)", font: { size: 10 } } },
    },
    plugins: {
      legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } },
    },
  }), []);

  if (isLoading) {
    return (
      <div className="qc-wrap p-4 md:p-6 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-60 mb-4" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (!data) return null;

  const legendCounts: Record<string, number> = {
    present: 0, absent: 0, sick: 0, fees: 0,
    suspended: 0, absconding: 0, excused: 0, late: 0,
  };
  Object.entries(data.attendance.counts).forEach(([status, count]) => {
    const key = getAttStatus(status);
    if (key && key in legendCounts) legendCounts[key] += count;
  });

  const attendedDays = legendCounts.present;
  const totalDays = data.attendance.totalDays;

  return (
    <div className="qc-wrap p-4 md:p-6 max-w-5xl mx-auto" data-testid="qc-reports-student">
      <div className="qc-card">
        <div className="qc-toolbar">
          <div className="qc-actions">
            <button
              className="qc-btn"
              onClick={() => navigate(`/qc-reports/class/${classId}?term=${term}&year=${year}`)}
              data-testid="button-back"
            >
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
            <button
              className="qc-btn qc-btn-ok"
              onClick={() => navigate(`/qc-reports/class/${classId}?term=${term}&year=${year}&view=reports`)}
              data-testid="button-reports"
            >
              <FileText className="h-3 w-3" /> Reports
            </button>
          </div>
          <div className="qc-actions">
            {isSaving && (
              <span className="qc-autosave-indicator flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving...
              </span>
            )}
            {lastSaved && !isSaving && (
              <span className="qc-autosave-indicator flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" style={{ color: "#16a34a" }} />
                Saved {lastSaved.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
              </span>
            )}
            <button
              className="qc-btn qc-btn-dl"
              onClick={handleDownloadPdf}
              disabled={isDownloadingPdf}
              data-testid="button-download-pdf"
            >
              {isDownloadingPdf ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              {isDownloadingPdf ? " Opening PDF..." : " Download PDF"}
            </button>
            <button
              className="qc-btn"
              onClick={() => saveMutation.mutate("in_progress")}
              disabled={saveMutation.isPending}
              data-testid="button-save-draft"
            >
              <Save className="h-3 w-3" /> Save Draft
            </button>
            <button
              className="qc-btn qc-btn-ok"
              onClick={() => saveMutation.mutate("complete")}
              disabled={saveMutation.isPending}
              data-testid="button-complete"
            >
              <CheckCircle2 className="h-3 w-3" /> Complete
            </button>
          </div>
        </div>

        <div className="qc-report" id="qcSingleReport">
          {data.school.logo && (
            <div className="qc-watermark">
              <img src={data.school.logo} alt="" />
            </div>
          )}

          <div className="qc-report-inner">
            {/* Report Header */}
            <div className="qc-report-head">
              <div className="qc-brand">
                {data.school.logo && <img src={data.school.logo} alt="" />}
                <div>
                  <div className="qc-brand-name">{data.school.name}</div>
                  {data.school.phone && <div className="qc-brand-sub">{data.school.phone}</div>}
                  <div className="qc-brand-sub2">Student QC Report</div>
                </div>
              </div>

              {data.student.photo ? (
                <img className="qc-stu-photo" src={data.student.photo} alt="" />
              ) : (
                <div className="qc-stu-photo" />
              )}
            </div>

            {/* Student Info */}
            <div className="qc-info" data-testid="text-student-info">
              <div><b>Name:</b> {data.student.firstName} {data.student.lastName}{data.student.admissionNo ? ` (Reg. No. ${data.student.admissionNo})` : ""}</div>
              <div><b>Class:</b> {data.className}</div>
              <div><b>Term:</b> Term {data.term}, {data.year}</div>
            </div>

            {/* Attendance Section */}
            <div className="qc-section-title" data-testid="section-attendance">
              <CalendarDays className="h-4 w-4" /> Attendances
            </div>
            <div className="qc-att-header">
              Attendances (Attended <b>{attendedDays}</b> out of <b>{totalDays}</b> school Days)
            </div>

            <div className="qc-att-line">
              {Object.entries(ATT_COLORS).map(([key, { bg, letter, label }]) => (
                <span key={key} className="qc-att-badge">
                  <span className="qc-att-box" style={{ background: bg }}>{letter}</span>
                  {label}({legendCounts[key] || 0})
                </span>
              ))}
            </div>

            {data.attendance.months.length > 0 && (
              <div className="qc-att-months">
                {data.attendance.months.map(month => (
                  <FundahCalendar key={month.key} month={month} attendanceByDate={data.attendance.byDate} />
                ))}
              </div>
            )}

            {/* Attendance & Behaviour Section */}
            <div className="qc-section-title" data-testid="section-behaviour">
              <MessageSquare className="h-4 w-4" /> Attendance & Behaviour
            </div>
            <div className="qc-beh-grid">
              <div className="qc-field">
                <label>Attendance Comment</label>
                <textarea
                  className="qc-perf-input"
                  value={attendanceComment}
                  onChange={e => handleField("attendanceComment", setAttendanceComment, e.target.value)}
                  placeholder="Type attendance comment..."
                  data-testid="input-attendance-comment"
                  style={{ minHeight: "90px", resize: "vertical" }}
                />
                <div className="mt-2"><LanguageCheckButton fields={[{ id: "qc-language-attendance", label: "Attendance comment", text: attendanceComment, onChange: (value) => handleField("attendanceComment", setAttendanceComment, value), student: { id: data.student.id, firstName: data.student.firstName, lastName: data.student.lastName, gender: data.student.gender } }]} /></div>
              </div>

              <div>
                <div className="qc-field">
                  <label>Behaviour Comment</label>
                  <textarea
                    className="qc-perf-input"
                    value={behaviourComment}
                    onChange={e => handleField("behaviourComment", setBehaviourComment, e.target.value)}
                    placeholder="Type behaviour comment..."
                    data-testid="input-behaviour-comment"
                    style={{ minHeight: "90px", resize: "vertical" }}
                  />
                  <div className="mt-2"><LanguageCheckButton fields={[{ id: "qc-language-behaviour", label: "Behaviour comment", text: behaviourComment, onChange: (value) => handleField("behaviourComment", setBehaviourComment, value), student: { id: data.student.id, firstName: data.student.firstName, lastName: data.student.lastName, gender: data.student.gender } }]} /></div>
                </div>

                <div className="qc-field" style={{ marginTop: "8px" }}>
                  <label>Behaviour Rating</label>
                  <div className="qc-beh-rating-options">
                    {BEHAVIOUR_OPTIONS.map(({ key, label, Icon, colorClass }) => (
                      <button
                        key={key}
                        type="button"
                        className={`qc-beh-pill ${behaviourRating === key ? "qc-beh-pill-active" : ""}`}
                        onClick={() => handleField("behaviourRating", setBehaviourRating, key)}
                        data-testid={`button-rating-${key}`}
                      >
                        <Icon className={`h-5 w-5 qc-beh-icon ${colorClass}`} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="qc-autosave-indicator">Changes are saved automatically.</div>
            </div>

            {/* Written Work Section */}
            <div className="qc-section-title" data-testid="section-written-work">
              <BookOpen className="h-4 w-4" /> Written Work
            </div>

            <div className="qc-ww-layout">
              <div>
                <div style={{ fontSize: "12px", marginBottom: "4px", color: "var(--qc-muted)" }}>Class Work Reporting</div>
                <table className="qc-ww-table">
                  <thead>
                    <tr>
                      <th style={{ width: "46%" }}>Subject</th>
                      <th style={{ width: "18%" }}>Tests</th>
                      <th style={{ width: "18%" }}>Exercises</th>
                      <th style={{ width: "18%" }}>Fortnight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.writtenWork.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ color: "var(--qc-muted)" }}>No subject mappings found for this learner.</td>
                      </tr>
                    ) : (
                      data.writtenWork.map(row => (
                        <tr key={row.subjectId} data-testid={`row-written-${row.subjectId}`}>
                          <td style={{ color: "var(--qc-blue-900)", fontWeight: 700 }}>{row.subject}</td>
                          <td>{row.tests}</td>
                          <td>{row.exercises}</td>
                          <td>{row.fortnight}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div>
                <div className="qc-ww-chart-title">Subject Performance</div>
                <div className="qc-ww-chart-wrap">
                  <div className="qc-ww-y-label">Marks(%)</div>
                  {chartData ? (
                    <div style={{ height: "230px" }}>
                      <Bar data={chartData} options={chartOptions as any} />
                    </div>
                  ) : (
                    <div style={{ height: "230px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--qc-muted)", fontSize: "12px" }}>
                      No performance data for chart
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Student Performance Section */}
            <div className="qc-section-title" data-testid="section-performance">
              <TrendingUp className="h-4 w-4" /> Student Performance (Subjects & Comments)
            </div>

            {data.performance.length === 0 ? (
              <div className="qc-perf-text" style={{ color: "var(--qc-muted)" }}>No performance data found for this learner yet.</div>
            ) : (
              <table className="qc-perf-table">
                <thead>
                  <tr>
                    <th style={{ width: "22%" }}>Subject</th>
                    <th style={{ width: "12%" }}>Average</th>
                    <th style={{ width: "8%" }}>Grade</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {data.performance.map(row => {
                    const avg = row.avg;
                    const w = avg !== null ? Math.max(0, Math.min(100, avg)) : 0;
                    return (
                      <tr key={row.subjectId} data-testid={`row-perf-${row.subjectId}`}>
                        <td style={{ fontWeight: 900, color: "var(--qc-blue-900)" }}>{row.subject}</td>
                        <td>
                          <div className="qc-perf-bar"><span style={{ width: `${w}%` }} /></div>
                          <div className="qc-perf-val">{avg !== null ? `${avg}%` : "-"}</div>
                        </td>
                        <td style={{ fontWeight: 700 }}>{row.grade || "-"}</td>
                        <td>
                          <textarea
                            className="qc-perf-input qc-subject-comment-input"
                            rows={3}
                            value={subjectComments[String(row.subjectId)] ?? row.comment ?? ""}
                            onChange={e => handleSubjectComment(String(row.subjectId), e.target.value)}
                            placeholder="Type comment for this subject..."
                            data-testid={`input-subject-comment-${row.subjectId}`}
                            style={{ minHeight: "72px", resize: "vertical", whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}
                          />
                          <div className="mt-2"><LanguageCheckButton fields={[{ id: `qc-language-subject-${row.subjectId}`, label: `${row.subject} comment`, text: subjectComments[String(row.subjectId)] ?? row.comment ?? "", onChange: (value) => handleSubjectComment(String(row.subjectId), value), student: { id: data.student.id, firstName: data.student.firstName, lastName: data.student.lastName, gender: data.student.gender } }]} /></div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* QC Form */}
            <div className="qc-form">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div className="qc-field">
                  <label>QC Status</label>
                  <select
                    value={qcStatus}
                    onChange={e => handleField("qcStatus", setQcStatus, e.target.value)}
                    data-testid="select-qc-status"
                  >
                    <option value="not_started">Not started</option>
                    <option value="in_progress">In progress</option>
                    <option value="complete">Complete</option>
                  </select>
                </div>
                <div className="qc-field">
                  <label>Study Habits</label>
                  <textarea
                    value={studyHabitsComment}
                    onChange={e => handleField("studyHabitsComment", setStudyHabitsComment, e.target.value)}
                    placeholder="Comment on study habits..."
                    data-testid="input-study-habits"
                    style={{ minHeight: "60px" }}
                  />
                  <div className="mt-2"><LanguageCheckButton fields={[{ id: "qc-language-study-habits", label: "Study habits", text: studyHabitsComment, onChange: (value) => handleField("studyHabitsComment", setStudyHabitsComment, value), student: { id: data.student.id, firstName: data.student.firstName, lastName: data.student.lastName, gender: data.student.gender } }]} /></div>
                </div>
              </div>

              <div className="qc-form-actions">
                <button
                  className="qc-btn qc-btn-ok"
                  onClick={() => saveMutation.mutate(qcStatus === "complete" ? "complete" : "in_progress")}
                  disabled={saveMutation.isPending}
                  data-testid="button-save-qc"
                >
                  <Save className="h-3 w-3" /> Save QC Notes
                </button>
                <button
                  className="qc-btn qc-btn-dl"
                  onClick={handleDownloadPdf}
                  disabled={isDownloadingPdf}
                  data-testid="button-download-pdf-bottom"
                >
                  {isDownloadingPdf ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  {isDownloadingPdf ? " Opening PDF..." : " Download PDF"}
                </button>
              </div>
            </div>

            {/* Signature Footer */}
            {(data.school.stamp || data.school.logo) && (
              <div className="qc-sign-footer">
                <div className="qc-sign-box">
                  {data.school.stamp && <img className="qc-sign-img" src={data.school.stamp} alt="School stamp" />}
                  <div className="qc-sign-line" />
                  <div className="qc-sign-label">School Stamp</div>
                </div>
                <div className="qc-sign-box">
                  <div className="qc-sign-line" />
                  <div className="qc-sign-label">Signature</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
