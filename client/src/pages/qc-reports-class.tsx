import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams, useSearch } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, ClipboardList, FileText, Users, Eye, Plus,
  CheckCircle2, Clock, AlertCircle, Search, TrendingUp
} from "lucide-react";

interface StudentRow {
  id: number;
  admissionNo: string | null;
  firstName: string;
  lastName: string;
  photo: string | null;
  hasReport: boolean;
  reportId: number | null;
  qcStatus: string;
}

interface ClassData {
  classId: number;
  className: string;
  term: number;
  year: string;
  students: StudentRow[];
}

interface SubjectProgressRow {
  subjectId: number;
  subjectName: string;
  totalStudents: number;
  completedComments: number;
  progressPct: number;
}

interface SubjectProgressData {
  classId: number;
  className: string;
  term: number;
  year: string;
  overallProgressPct: number;
  totalStudents: number;
  totalReports: number;
  subjects: SubjectProgressRow[];
}

function statusPill(status: string) {
  switch (status) {
    case "completed":
      return (
        <span className="qc-pill qc-pill-ok">
          <CheckCircle2 className="h-3 w-3" /> Completed
        </span>
      );
    case "in_progress":
      return (
        <span className="qc-pill qc-pill-mid">
          <Clock className="h-3 w-3" /> In Progress
        </span>
      );
    default:
      return (
        <span className="qc-pill qc-pill-bad">
          <AlertCircle className="h-3 w-3" /> Not Started
        </span>
      );
  }
}

function ProgressCircle({ pct }: { pct: number }) {
  const cls = pct >= 80 ? "qc-pct-circle-ok" : pct >= 40 ? "qc-pct-circle-mid" : "qc-pct-circle-bad";
  return (
    <span className={`qc-pct-circle ${cls}`} data-testid="pill-progress">
      {pct}%
    </span>
  );
}

export default function QCReportsClassPage() {
  const [, navigate] = useLocation();
  const params = useParams<{ classId: string }>();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const classId = params.classId;
  const term = searchParams.get("term") || "";
  const year = searchParams.get("year") || "";
  const view = searchParams.get("view") || "students";
  const [searchQuery, setSearchQuery] = useState("");

  const classQueryUrl = `/api/qc-reports/class/${classId}?term=${term}&year=${year}`;
  const progressQueryUrl = `/api/qc-reports/class/${classId}/subject-progress?term=${term}&year=${year}`;

  const { data, isLoading } = useQuery<ClassData>({
    queryKey: [classQueryUrl],
    enabled: view !== "progress",
  });

  const { data: progressData, isLoading: progressLoading } = useQuery<SubjectProgressData>({
    queryKey: [progressQueryUrl],
    enabled: view === "progress",
  });

  const filteredStudents = data?.students.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = `${s.firstName} ${s.lastName}`.toLowerCase();
    return name.includes(q) || (s.admissionNo || "").toLowerCase().includes(q);
  }) || [];

  const completedCount = data?.students.filter(s => s.qcStatus === "completed").length || 0;
  const totalCount = data?.students.length || 0;

  return (
    <div className="qc-wrap p-4 md:p-6 max-w-6xl mx-auto" data-testid="qc-reports-class">
      <div className="qc-card">
        {view === "progress" ? (
          <>
            <div style={{ textAlign: "center", marginBottom: "6px" }}>
              <div style={{ fontWeight: 950, color: "var(--qc-blue-900)", fontSize: "18px" }} data-testid="text-progress-title">
                Quality Control Reports
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: "14px" }}>
              <button
                className="qc-btn"
                onClick={() => navigate("/qc-reports")}
                data-testid="button-return-back"
                style={{ borderColor: "rgba(239,68,68,0.3)", color: "#dc2626", background: "rgba(239,68,68,0.06)" }}
              >
                <ArrowLeft className="h-3 w-3" /> Return Back
              </button>
            </div>

            <div style={{ borderTop: "1px solid var(--qc-border)", paddingTop: "14px" }}>
              <div style={{ textAlign: "center", marginBottom: "8px", fontWeight: 700, color: "var(--qc-text)", fontSize: "14px" }} data-testid="text-class-name">
                {progressLoading ? <Skeleton className="h-5 w-40 mx-auto" /> : progressData?.className}
              </div>

              {progressData && (
                <div className="qc-bar-full" style={{ marginBottom: "14px" }}>
                  <span style={{ width: `${Math.max(progressData.overallProgressPct, 3)}%` }} />
                  <div className="qc-bar-full-label">{progressData.overallProgressPct}%</div>
                </div>
              )}

              {progressLoading && (
                <div className="space-y-2 mt-4">
                  {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              )}

              {progressData && progressData.subjects.length === 0 && (
                <div className="text-center py-8">
                  <TrendingUp className="h-10 w-10 mx-auto mb-2" style={{ color: "var(--qc-muted)" }} />
                  <p style={{ color: "var(--qc-muted)", fontSize: "13px" }}>No subjects assigned to this class yet.</p>
                </div>
              )}

              {progressData && progressData.subjects.length > 0 && (
                <table className="qc-table">
                  <thead>
                    <tr>
                      <th style={{ width: "50%" }}>Subject</th>
                      <th style={{ width: "25%", textAlign: "center" }}>Progress</th>
                      <th style={{ width: "25%", textAlign: "center" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progressData.subjects.map((subj: SubjectProgressRow) => (
                      <tr key={subj.subjectId} data-testid={`row-subject-${subj.subjectId}`}>
                        <td className="qc-class-name">{subj.subjectName}</td>
                        <td style={{ textAlign: "center" }}><ProgressCircle pct={subj.progressPct} /></td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            className="qc-btn"
                            onClick={() => navigate(`/qc-reports/class/${classId}?term=${term}&year=${year}&view=reports`)}
                            data-testid={`button-subject-reports-${subj.subjectId}`}
                          >
                            <FileText className="h-3 w-3" /> Reports
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : view === "students" ? (
          <>
            <div className="qc-toolbar">
              <div className="qc-actions">
                <button
                  className="qc-btn"
                  onClick={() => navigate("/qc-reports")}
                  data-testid="button-back"
                >
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>
                <button
                  className="qc-btn"
                  onClick={() => navigate(`/qc-reports/class/${classId}?term=${term}&year=${year}&view=reports`)}
                  data-testid="button-open-reports"
                >
                  <FileText className="h-3 w-3" /> Open Reports
                </button>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "16px", fontWeight: 950, color: "var(--qc-blue-900)" }} data-testid="text-class-title">
                  <Users className="h-4 w-4 inline-block mr-1" />
                  {isLoading ? <Skeleton className="h-5 w-32 inline-block" /> : data?.className}
                </div>
                {data && (
                  <div style={{ fontSize: "12px", color: "var(--qc-muted)" }}>
                    QC Students — Term {data.term}, {data.year} | {completedCount}/{totalCount} completed
                  </div>
                )}
              </div>
              <div style={{ minWidth: 200 }}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--qc-muted)" }} />
                  <input
                    className="qc-search pl-8"
                    type="text"
                    placeholder="Search student..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    data-testid="input-search-student"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </div>

            {isLoading && (
              <div className="space-y-2 mt-4">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            )}

            {data && filteredStudents.length === 0 && (
              <div className="text-center py-8">
                <Users className="h-10 w-10 mx-auto mb-2" style={{ color: "var(--qc-muted)" }} />
                <p style={{ color: "var(--qc-muted)", fontSize: "13px" }}>
                  {searchQuery ? "No students match your search." : "No active students in this class."}
                </p>
              </div>
            )}

            {data && filteredStudents.length > 0 && (
              <table className="qc-table">
                <thead>
                  <tr>
                    <th style={{ width: "42%" }}>Student</th>
                    <th style={{ width: "18%" }}>Admission</th>
                    <th style={{ width: "20%" }}>QC Status</th>
                    <th style={{ width: "20%" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map(student => (
                    <tr key={student.id} data-testid={`row-student-${student.id}`}>
                      <td className="qc-class-name">{student.firstName} {student.lastName}</td>
                      <td style={{ fontSize: "12px" }}>{student.admissionNo || "-"}</td>
                      <td>{statusPill(student.qcStatus)}</td>
                      <td>
                        <div className="qc-actions">
                          <button
                            className="qc-btn qc-btn-ok"
                            onClick={() => navigate(`/qc-reports/student/${student.id}?classId=${data.classId}&term=${data.term}&year=${data.year}`)}
                            data-testid={`button-view-${student.id}`}
                          >
                            <Eye className="h-3 w-3" /> View
                          </button>
                          {!student.hasReport && (
                            <button
                              className="qc-btn"
                              onClick={() => navigate(`/qc-reports/student/${student.id}?classId=${data.classId}&term=${data.term}&year=${data.year}`)}
                              data-testid={`button-start-${student.id}`}
                            >
                              <Plus className="h-3 w-3" /> Start
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="qc-note">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              Use "View" to open/download the QC report.
            </div>
          </>
        ) : (
          <>
            <div className="qc-toolbar">
              <div className="qc-actions">
                <button
                  className="qc-btn"
                  onClick={() => navigate("/qc-reports")}
                  data-testid="button-back"
                >
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>
                <button
                  className="qc-btn qc-btn-ok"
                  onClick={() => navigate(`/qc-reports/class/${classId}?term=${term}&year=${year}&view=students`)}
                  data-testid="button-students-view"
                >
                  <Users className="h-3 w-3" /> Students
                </button>
                <span style={{ fontWeight: 950, color: "var(--qc-blue-900)", fontSize: "14px" }}>
                  <FileText className="h-4 w-4 inline-block mr-1" />
                  {data?.className} — Term {data?.term}, {data?.year}
                </span>
              </div>

              <div className="qc-actions" style={{ flex: 1 }}>
                <div className="relative" style={{ flex: 1, minWidth: 200 }}>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--qc-muted)" }} />
                  <input
                    className="qc-search pl-8"
                    type="text"
                    placeholder="Search student QC report..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    data-testid="input-search-report"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </div>

            {isLoading && (
              <div className="space-y-4 mt-4">
                {[1, 2].map(i => <Skeleton key={i} className="h-48 w-full" />)}
              </div>
            )}

            {data && filteredStudents.length === 0 && (
              <div className="text-center py-8">
                <FileText className="h-10 w-10 mx-auto mb-2" style={{ color: "var(--qc-muted)" }} />
                <p style={{ color: "var(--qc-muted)", fontSize: "13px" }}>No reports to display.</p>
              </div>
            )}

            {data && filteredStudents.map(student => (
              <div key={student.id} className="qc-report mb-4" data-testid={`report-preview-${student.id}`}>
                <div style={{
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--qc-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  flexWrap: "wrap"
                }}>
                  <div style={{ fontWeight: 950, color: "var(--qc-blue-900)" }}>
                    {student.firstName} {student.lastName}
                  </div>
                  <div className="qc-actions">
                    <button
                      className="qc-btn qc-btn-ok"
                      onClick={() => navigate(`/qc-reports/student/${student.id}?classId=${data.classId}&term=${data.term}&year=${data.year}`)}
                      data-testid={`button-view-edit-${student.id}`}
                    >
                      <Eye className="h-3 w-3" /> View / Edit
                    </button>
                    {!student.hasReport && (
                      <button
                        className="qc-btn"
                        onClick={() => navigate(`/qc-reports/student/${student.id}?classId=${data.classId}&term=${data.term}&year=${data.year}`)}
                        data-testid={`button-start-report-${student.id}`}
                      >
                        <Plus className="h-3 w-3" /> Start
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ padding: "14px", fontSize: "12px", color: "var(--qc-muted)" }}>
                  {student.hasReport
                    ? `Report ${student.qcStatus === "completed" ? "completed" : "in progress"} — click View / Edit to open`
                    : "No report started yet — click Start to create"}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
