import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, useSearch } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import {
  ArrowLeft, Save, CheckCircle2, Clock, Loader2, Download,
  CalendarDays, BookOpen, TrendingUp, MessageSquare, Smile, Meh, Frown, FileText, Info
} from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

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
  student: { id: number; firstName: string; lastName: string; admissionNo: string | null; photo: string | null };
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

  const queryUrl = `/api/qc-reports/student/${studentId}?classId=${classId}&term=${term}&year=${year}`;

  const { data, isLoading } = useQuery<StudentReportData>({
    queryKey: [queryUrl],
  });

  useEffect(() => {
    if (data?.qcReport) {
      setAttendanceComment(data.qcReport.attendanceComment || "");
      setBehaviourComment(data.qcReport.behaviourComment || "");
      setBehaviourRating(data.qcReport.behaviourRating || "");
      setStudyHabitsComment(data.qcReport.studyHabitsComment || "");
      setSubjectComments(data.qcReport.subjectComments || {});
      setNotes(data.qcReport.notes || "");
      setQcStatus(data.qcReport.qcStatus || "not_started");
      setReportId(data.qcReport.id || null);
    }
  }, [data]);

  const doAutosave = useCallback(async () => {
    if (!data) return;
    try {
      setIsSaving(true);
      const payload = {
        attendanceComment,
        behaviourComment,
        behaviourRating: behaviourRating || null,
        studyHabitsComment,
        subjectComments,
        notes,
        qcStatus: qcStatus || "in_progress",
      };
      if (reportId) {
        await apiRequest("PATCH", `/api/qc-reports/autosave/${reportId}`, payload);
      } else {
        const res = await apiRequest("POST", "/api/qc-reports/save", {
          ...payload,
          studentId: parseInt(studentId),
          classId: parseInt(classId),
          termNumber: parseInt(term),
          year,
        });
        const result = await res.json();
        setReportId(result.id);
      }
      setLastSaved(new Date());
    } catch { /* silent */ } finally {
      setIsSaving(false);
    }
  }, [reportId, studentId, classId, term, year, attendanceComment, behaviourComment, behaviourRating, studyHabitsComment, subjectComments, notes, qcStatus, data]);

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
      setReportId(result.id);
      setLastSaved(new Date());
      toast({ title: "Report saved", description: "QC report has been saved successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/qc-reports"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save report.", variant: "destructive" });
    },
  });

  const handleField = useCallback((setter: (v: string) => void, value: string) => {
    setter(value);
    scheduleAutosave();
  }, [scheduleAutosave]);

  const handleSubjectComment = useCallback((subjectId: string, value: string) => {
    setSubjectComments(prev => ({ ...prev, [subjectId]: value }));
    scheduleAutosave();
  }, [scheduleAutosave]);

  const chartData = useMemo(() => {
    if (!data?.perfSeries?.length) return null;
    return {
      labels: data.perfSeries.map(r => r.subject),
      datasets: [
        { label: "Tests", data: data.perfSeries.map(r => r.tests), borderColor: "#0b4dff", tension: 0.35, pointRadius: 3 },
        { label: "Exercise", data: data.perfSeries.map(r => r.exercises), borderColor: "#16a34a", tension: 0.35, pointRadius: 3 },
        { label: "Fortnights", data: data.perfSeries.map(r => r.fortnight), borderColor: "#fbbf24", tension: 0.35, pointRadius: 3 },
      ],
    };
  }, [data?.perfSeries]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 60, font: { size: 10 } } },
      y: { beginAtZero: true, max: 100, title: { display: true, text: "Marks (%)", font: { size: 10 } } },
    },
    plugins: {
      legend: { display: false },
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
              onClick={() => {
                const pdfUrl = `/api/qc-reports/pdf/${studentId}?classId=${classId}&term=${term}&year=${year}`;
                window.open(pdfUrl, "_blank");
              }}
              data-testid="button-download-pdf"
            >
              <Download className="h-3 w-3" /> Download PDF
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
                  onChange={e => handleField(setAttendanceComment, e.target.value)}
                  placeholder="Type attendance comment..."
                  data-testid="input-attendance-comment"
                  style={{ minHeight: "90px", resize: "vertical" }}
                />
              </div>

              <div>
                <div className="qc-field">
                  <label>Behaviour Comment</label>
                  <textarea
                    className="qc-perf-input"
                    value={behaviourComment}
                    onChange={e => handleField(setBehaviourComment, e.target.value)}
                    placeholder="Type behaviour comment..."
                    data-testid="input-behaviour-comment"
                    style={{ minHeight: "90px", resize: "vertical" }}
                  />
                </div>

                <div className="qc-field" style={{ marginTop: "8px" }}>
                  <label>Behaviour Rating</label>
                  <div className="qc-beh-rating-options">
                    {BEHAVIOUR_OPTIONS.map(({ key, label, Icon, colorClass }) => (
                      <button
                        key={key}
                        type="button"
                        className={`qc-beh-pill ${behaviourRating === key ? "qc-beh-pill-active" : ""}`}
                        onClick={() => handleField(setBehaviourRating, key)}
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
                <div className="qc-ww-chart-legend">
                  <span className="qc-ww-legend-pill">
                    <span className="qc-ww-legend-box" style={{ background: "#0b4dff" }} /> Tests
                  </span>
                  <span className="qc-ww-legend-pill">
                    <span className="qc-ww-legend-box" style={{ background: "#16a34a" }} /> Exercise
                  </span>
                  <span className="qc-ww-legend-pill">
                    <span className="qc-ww-legend-box" style={{ background: "#fbbf24" }} /> Fortnights
                  </span>
                </div>
                <div className="qc-ww-chart-wrap">
                  <div className="qc-ww-y-label">Marks(%)</div>
                  {chartData ? (
                    <div style={{ height: "230px" }}>
                      <Line data={chartData} options={chartOptions as any} />
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
                          <input
                            className="qc-perf-input"
                            type="text"
                            value={subjectComments[String(row.subjectId)] ?? row.comment ?? ""}
                            onChange={e => handleSubjectComment(String(row.subjectId), e.target.value)}
                            placeholder="Type comment for this subject..."
                            data-testid={`input-subject-comment-${row.subjectId}`}
                          />
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
                    onChange={e => { setQcStatus(e.target.value); scheduleAutosave(); }}
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
                    onChange={e => handleField(setStudyHabitsComment, e.target.value)}
                    placeholder="Comment on study habits..."
                    data-testid="input-study-habits"
                    style={{ minHeight: "60px" }}
                  />
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
                  onClick={() => {
                    const pdfUrl = `/api/qc-reports/pdf/${studentId}?classId=${classId}&term=${term}&year=${year}`;
                    window.open(pdfUrl, "_blank");
                  }}
                  data-testid="button-download-pdf-bottom"
                >
                  <Download className="h-3 w-3" /> Download PDF
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
