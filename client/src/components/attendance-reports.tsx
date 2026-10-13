import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { schoolFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Download, FileSpreadsheet, Search, Users } from "lucide-react";
import type { Class, School } from "@shared/schema";

type ReportType = "overview" | "frequent" | "consecutive" | "non-attendance" | "stopped-attending" | "individual" | "classes";
type PeriodPreset = "today" | "week" | "month" | "term" | "custom";

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };
type StudentRow = {
  studentId: number;
  admissionNo: string;
  studentName: string;
  classId: number | null;
  className: string;
  currentStatus: string;
  expectedDays: number;
  recordedDays: number;
  presentDays: number;
  absentDays: number;
  notRecordedDays: number;
  attendancePercentage: number | null;
  dataCompletenessPercentage: number | null;
  perfectAttendance: boolean;
  lastPresent: string | null;
  consecutiveAbsentDays: number;
  absentDaysSinceLastPresent: number;
  attendanceIncomplete: boolean;
  historicalClassUncertain: boolean;
  reviewIndicator?: string;
  reasons: Record<string, number>;
};

type PagedRows = { rows: StudentRow[]; pagination: Pagination };
type OverviewResponse = {
  meta: { schoolName: string; from: string; to: string; calendarConfidence: string };
  summary: {
    studentsIncluded: number;
    studentsPresentAtLeastOnce: number;
    studentsAbsentAtLeastOnce: number;
    studentsWithPerfectAttendance: number;
    totalPresentDays: number;
    totalAbsentDays: number;
    unrecordedStudentDays: number;
    expectedSchoolDays: number;
  };
  students: PagedRows;
};
type AbsenteeismResponse = { meta: OverviewResponse["meta"]; frequent: PagedRows; consecutive: PagedRows };
type StudentListResponse = { meta: OverviewResponse["meta"]; students: PagedRows };
type ClassSummaryRow = { classId: number; className: string; students: number; presentDays: number; absentDays: number; notRecordedDays: number; attendanceRate: number | null; incompleteStudents: number; historicalUncertainty: number };
type ClassSummaryResponse = { meta: OverviewResponse["meta"]; classes: ClassSummaryRow[] };
type StudentHistoryResponse = { meta: OverviewResponse["meta"]; student: StudentRow; days: Array<{ date: string; status: string; reason: string | null; source: string | null; gateEvidenceLocked: boolean }> };

const REPORT_OPTIONS: Array<{ value: ReportType; label: string }> = [
  { value: "overview", label: "Attendance Overview" },
  { value: "frequent", label: "Frequent Absenteeism" },
  { value: "consecutive", label: "Consecutive Absences" },
  { value: "non-attendance", label: "Term Non-Attendance" },
  { value: "stopped-attending", label: "Stopped Attending" },
  { value: "individual", label: "Individual Attendance History" },
  { value: "classes", label: "Class Attendance Summary" },
];

function isoToday() { return new Date().toISOString().slice(0, 10); }
function mondayOfWeek(today: string) {
  const date = new Date(`${today}T00:00:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
}
function firstOfMonth(today: string) { return `${today.slice(0, 7)}-01`; }
function pct(value: number | null) { return value === null ? "—" : `${value.toFixed(1)}%`; }
function statusLabel(value: string) { return value === "not_recorded" ? "Not Recorded" : value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }

async function fetchJson<T>(url: string): Promise<T> {
  const response = await schoolFetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }
  return response.json();
}

export default function AttendanceReports() {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canExport = hasPermission("attendance.reports.export");
  const today = isoToday();
  const [reportType, setReportType] = useState<ReportType>("overview");
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [classId, setClassId] = useState("all");
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sortBy, setSortBy] = useState("studentName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedTerm, setSelectedTerm] = useState("term1");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [minAbsentDays, setMinAbsentDays] = useState(5);
  const [minConsecutiveDays, setMinConsecutiveDays] = useState(3);
  const [minStoppedDays, setMinStoppedDays] = useState(10);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);

  const { data: classes = [] } = useQuery<Class[]>({ queryKey: ["/api/classes"] });
  const { data: schools = [] } = useQuery<School[]>({ queryKey: ["/api/schools"] });
  const currentSchoolId = Number(localStorage.getItem("currentSchoolId") || 0);
  const currentSchool = schools.find((row) => row.id === currentSchoolId) || schools[0];

  useEffect(() => {
    const configured = String(currentSchool?.currentTerm || "term1");
    if (["term1", "term2", "term3"].includes(configured)) setSelectedTerm(configured);
  }, [currentSchool?.id, currentSchool?.currentTerm]);

  useEffect(() => {
    setPage(1);
  }, [reportType, period, classId, from, to, search, status, sortBy, sortDir, selectedTerm, minAbsentDays, minConsecutiveDays, minStoppedDays]);

  const applyTermRange = (term: string) => {
    const start = (currentSchool as any)?.[`${term}StartDate`] as string | null | undefined;
    const end = (currentSchool as any)?.[`${term}EndDate`] as string | null | undefined;
    if (start) setFrom(start);
    if (end && end < today) setTo(end); else setTo(today);
    if (!start) toast({ title: "Term dates unavailable", description: "Use a custom date range because the selected term start date is not configured.", variant: "destructive" });
  };

  const applyPeriod = (next: PeriodPreset) => {
    setPeriod(next);
    if (next === "custom") return;
    if (next === "today") { setFrom(today); setTo(today); return; }
    if (next === "week") { setFrom(mondayOfWeek(today)); setTo(today); return; }
    if (next === "month") { setFrom(firstOfMonth(today)); setTo(today); return; }
    if (next === "term") applyTermRange(selectedTerm);
  };

  const resetFilters = () => {
    setReportType("overview");
    setPeriod("month");
    setClassId("all");
    setFrom(firstOfMonth(today));
    setTo(today);
    setSearch("");
    setStatus("all");
    setSortBy("studentName");
    setSortDir("asc");
    setPage(1);
    setPageSize(50);
    setMinAbsentDays(5);
    setMinConsecutiveDays(3);
    setMinStoppedDays(10);
  };

  useEffect(() => {
    if (reportType === "non-attendance" && period !== "term") applyPeriod("term");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType]);

  useEffect(() => {
    if (period === "term") applyTermRange(selectedTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTerm]);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      from,
      to,
      classId,
      page: String(page),
      pageSize: String(pageSize),
      search,
      status,
      sortBy,
      sortDir,
      minAbsentDays: String(minAbsentDays),
      minConsecutiveDays: String(minConsecutiveDays),
      minStoppedDays: String(minStoppedDays),
    });
    let endpoint = "overview";
    if (reportType === "frequent" || reportType === "consecutive") endpoint = "absenteeism";
    if (reportType === "non-attendance") endpoint = "non-attendance";
    if (reportType === "stopped-attending") endpoint = "stopped-attending";
    if (reportType === "classes") endpoint = "classes";
    return `/api/attendance/reports/${endpoint}?${params.toString()}`;
  }, [from, to, classId, page, pageSize, search, status, sortBy, sortDir, minAbsentDays, minConsecutiveDays, minStoppedDays, reportType]);

  const reportQuery = useQuery<any>({
    queryKey: ["attendance-reports", query],
    queryFn: () => fetchJson<any>(query),
    enabled: Boolean(from && to),
  });

  const selectedHistoryUrl = selectedStudentId
    ? `/api/attendance/reports/student/${selectedStudentId}?${new URLSearchParams({ from, to, classId }).toString()}`
    : "";
  const historyQuery = useQuery<StudentHistoryResponse>({
    queryKey: ["attendance-report-student", selectedHistoryUrl],
    queryFn: () => fetchJson<StudentHistoryResponse>(selectedHistoryUrl),
    enabled: Boolean(selectedStudentId),
  });

  const exportReport = async (format: "xlsx" | "pdf") => {
    try {
      const report = reportType === "frequent" ? "absenteeism" : reportType === "consecutive" ? "consecutive" : reportType === "individual" ? "overview" : reportType;
      const params = new URLSearchParams({ from, to, classId, report, format, search, status, sortBy, sortDir, minAbsentDays: String(minAbsentDays), minConsecutiveDays: String(minConsecutiveDays), minStoppedDays: String(minStoppedDays) });
      const response = await schoolFetch(`/api/attendance/reports/export?${params.toString()}`);
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `attendance-report-${from}-to-${to}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: "Export failed", description: error instanceof Error ? error.message : "Unable to export report", variant: "destructive" });
    }
  };

  const renderPagination = (pagination?: Pagination) => {
    if (!pagination) return null;
    return (
      <div className="flex flex-col gap-2 border-t px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-muted-foreground">{pagination.total} matching student{pagination.total === 1 ? "" : "s"}</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
          <span>Page {pagination.page} of {pagination.totalPages}</span>
          <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      </div>
    );
  };

  const renderStudentRows = (paged?: PagedRows, mode: ReportType = reportType) => {
    if (!paged) return null;
    return (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Student</TableHead><TableHead>Admission No.</TableHead><TableHead>Class</TableHead>
                <TableHead className="text-right">Present</TableHead><TableHead className="text-right">Absent</TableHead><TableHead className="text-right">Not Recorded</TableHead>
                {mode === "consecutive" && <TableHead className="text-right">Consecutive</TableHead>}
                {mode === "consecutive" && <TableHead>Last Present</TableHead>}
                {(mode === "frequent" || mode === "consecutive") && <TableHead>Absence Reasons</TableHead>}
                {mode === "stopped-attending" && <TableHead>Last Present</TableHead>}
                {mode === "stopped-attending" && <TableHead className="text-right">Absent Since</TableHead>}
                {mode === "non-attendance" && <TableHead>Review Indicator</TableHead>}
                <TableHead className="text-right">Attendance %</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {paged.rows.map((row) => (
                  <TableRow key={row.studentId} className="cursor-pointer" onClick={() => setSelectedStudentId(row.studentId)}>
                    <TableCell className="font-medium">
                      {row.studentName}
                      {row.attendanceIncomplete && <div className="text-xs text-amber-700">Incomplete attendance data</div>}
                      {row.historicalClassUncertain && <div className="text-xs text-amber-700">Historical class needs review</div>}
                    </TableCell>
                    <TableCell>{row.admissionNo}</TableCell><TableCell>{row.className}</TableCell>
                    <TableCell className="text-right">{row.presentDays}</TableCell><TableCell className="text-right">{row.absentDays}</TableCell><TableCell className="text-right">{row.notRecordedDays}</TableCell>
                    {mode === "consecutive" && <TableCell className="text-right font-medium">{row.consecutiveAbsentDays}</TableCell>}
                    {mode === "consecutive" && <TableCell>{row.lastPresent || "—"}</TableCell>}
                    {(mode === "frequent" || mode === "consecutive") && <TableCell>{Object.entries(row.reasons || {}).length ? Object.entries(row.reasons).map(([reason, count]) => `${reason}: ${count}`).join(" · ") : "—"}</TableCell>}
                    {mode === "stopped-attending" && <TableCell>{row.lastPresent || "—"}</TableCell>}
                    {mode === "stopped-attending" && <TableCell className="text-right">{row.absentDaysSinceLastPresent}</TableCell>}
                    {mode === "non-attendance" && <TableCell><Badge variant={row.reviewIndicator === "Possible Non-Return" ? "destructive" : "secondary"}>{row.reviewIndicator}</Badge></TableCell>}
                    <TableCell className="text-right">{pct(row.attendancePercentage)}</TableCell><TableCell>{statusLabel(row.currentStatus)}</TableCell>
                  </TableRow>
                ))}
                {!paged.rows.length && <TableRow><TableCell colSpan={14} className="py-8 text-center text-muted-foreground">No students match the selected report filters.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          {renderPagination(paged.pagination)}
        </CardContent>
      </Card>
    );
  };

  const data = reportQuery.data;
  const overview = data as OverviewResponse | undefined;
  const absenteeism = data as AbsenteeismResponse | undefined;
  const studentList = data as StudentListResponse | undefined;
  const classSummary = data as ClassSummaryResponse | undefined;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle className="text-lg">Reporting Filters</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2"><Label>Report</Label><Select value={reportType} onValueChange={(value) => setReportType(value as ReportType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{REPORT_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>School</Label><Input value={currentSchool?.name || "Current school"} readOnly /><p className="text-xs text-muted-foreground">Uses the portal's authorised active-school context.</p></div>
          <div className="space-y-2"><Label>Class</Label><Select value={classId} onValueChange={setClassId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Classes</SelectItem>{classes.map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.className}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Reporting Period</Label><Select value={period} onValueChange={(value) => applyPeriod(value as PeriodPreset)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="today">Today</SelectItem><SelectItem value="week">This Week</SelectItem><SelectItem value="month">This Month</SelectItem><SelectItem value="term">This Term</SelectItem><SelectItem value="custom">Custom</SelectItem></SelectContent></Select></div>
          {period === "term" && <div className="space-y-2"><Label>Term</Label><Select value={selectedTerm} onValueChange={setSelectedTerm}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="term1">Term 1</SelectItem><SelectItem value="term2">Term 2</SelectItem><SelectItem value="term3">Term 3</SelectItem></SelectContent></Select></div>}
          <div className="space-y-2"><Label>Rows per page</Label><Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[25,50,100,200].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Start Date</Label><Input type="date" value={from} onChange={(event) => { setPeriod("custom"); setFrom(event.target.value); }} /></div>
          <div className="space-y-2"><Label>End Date</Label><Input type="date" value={to} onChange={(event) => { setPeriod("custom"); setTo(event.target.value); }} /></div>
          <div className="space-y-2 sm:col-span-2"><Label>Student search</Label><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or admission number" /></div></div>
          <div className="space-y-2"><Label>Attendance filter</Label><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Students</SelectItem><SelectItem value="present">Present at least once</SelectItem><SelectItem value="absent">Absent at least once</SelectItem><SelectItem value="not_recorded">Has missing records</SelectItem><SelectItem value="perfect">Perfect attendance</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label>Sort by</Label><Select value={sortBy} onValueChange={setSortBy}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="studentName">Student name</SelectItem><SelectItem value="presentDays">Present days</SelectItem><SelectItem value="absentDays">Absent days</SelectItem><SelectItem value="attendancePercentage">Attendance %</SelectItem><SelectItem value="className">Class</SelectItem><SelectItem value="lastPresent">Last present</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label>Sort direction</Label><Select value={sortDir} onValueChange={(value) => setSortDir(value as "asc" | "desc")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="asc">Ascending</SelectItem><SelectItem value="desc">Descending</SelectItem></SelectContent></Select></div>
          {reportType === "frequent" && <div className="space-y-2"><Label>Minimum absent days</Label><Input type="number" min={1} value={minAbsentDays} onChange={(event) => setMinAbsentDays(Math.max(1, Number(event.target.value) || 1))} /></div>}
          {reportType === "consecutive" && <div className="space-y-2"><Label>Minimum consecutive absence days</Label><Input type="number" min={1} value={minConsecutiveDays} onChange={(event) => setMinConsecutiveDays(Math.max(1, Number(event.target.value) || 1))} /></div>}
          {reportType === "stopped-attending" && <div className="space-y-2"><Label>Minimum absent days after last attendance</Label><Input type="number" min={1} value={minStoppedDays} onChange={(event) => setMinStoppedDays(Math.max(1, Number(event.target.value) || 1))} /></div>}
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4 lg:justify-end"><Button onClick={() => void reportQuery.refetch()}>Generate Report</Button><Button variant="outline" onClick={resetFilters}>Reset Filters</Button>{canExport && <><Button variant="outline" onClick={() => exportReport("xlsx")}><FileSpreadsheet className="mr-2 h-4 w-4" />Export Excel</Button><Button variant="outline" onClick={() => exportReport("pdf")}><Download className="mr-2 h-4 w-4" />Export PDF</Button></>}</div>
        </CardContent>
      </Card>

      {reportQuery.isLoading && <Card><CardContent className="p-8 text-center text-muted-foreground">Generating attendance report…</CardContent></Card>}
      {reportQuery.isError && <Card className="border-destructive"><CardContent className="flex gap-3 p-5 text-destructive"><AlertTriangle className="h-5 w-5" /><div><div className="font-medium">Unable to generate report</div><div className="text-sm">{reportQuery.error instanceof Error ? reportQuery.error.message : "Unknown reporting error"}</div></div></CardContent></Card>}
      {(data as any)?.meta?.calendarConfidence === "weekly_only" && <Card className="border-amber-300"><CardContent className="flex gap-3 p-4 text-sm"><AlertTriangle className="h-5 w-5 text-amber-600" /><div><div className="font-medium">Historical term boundaries are not available for this range</div><div className="text-muted-foreground">The report uses configured school weekdays and date overrides for the explicit date range. Missing attendance remains Not Recorded; it is never assumed absent.</div></div></CardContent></Card>}

      {reportType === "overview" && overview?.summary && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Students Included", overview.summary.studentsIncluded],
            ["Present at Least Once", overview.summary.studentsPresentAtLeastOnce],
            ["Absent at Least Once", overview.summary.studentsAbsentAtLeastOnce],
            ["Perfect Attendance", overview.summary.studentsWithPerfectAttendance],
            ["Total Present Days", overview.summary.totalPresentDays],
            ["Total Absent Days", overview.summary.totalAbsentDays],
            ["Unrecorded Student-Days", overview.summary.unrecordedStudentDays],
            ["School Days", overview.summary.expectedSchoolDays],
          ].map(([label, value]) => <Card key={String(label)}><CardContent className="p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-2xl font-bold">{value}</div></CardContent></Card>)}
        </div>
        {renderStudentRows(overview.students, "overview")}
      </>}

      {reportType === "frequent" && renderStudentRows(absenteeism?.frequent, "frequent")}
      {reportType === "consecutive" && renderStudentRows(absenteeism?.consecutive, "consecutive")}
      {reportType === "non-attendance" && renderStudentRows(studentList?.students, "non-attendance")}
      {reportType === "stopped-attending" && renderStudentRows(studentList?.students, "stopped-attending")}
      {reportType === "individual" && <>
        <Card><CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground"><Users className="h-5 w-5" />Search for a learner, then select the row to open the complete read-only attendance history.</CardContent></Card>
        {renderStudentRows((overview as OverviewResponse | undefined)?.students, "individual")}
      </>}

      {reportType === "classes" && classSummary?.classes && <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Class</TableHead><TableHead className="text-right">Students</TableHead><TableHead className="text-right">Present Days</TableHead><TableHead className="text-right">Absent Days</TableHead><TableHead className="text-right">Not Recorded</TableHead><TableHead className="text-right">Attendance Rate</TableHead><TableHead className="text-right">Incomplete Students</TableHead><TableHead className="text-right">Historical Uncertainty</TableHead><TableHead /></TableRow></TableHeader><TableBody>{classSummary.classes.map((row) => <TableRow key={row.classId}><TableCell className="font-medium">{row.className}</TableCell><TableCell className="text-right">{row.students}</TableCell><TableCell className="text-right">{row.presentDays}</TableCell><TableCell className="text-right">{row.absentDays}</TableCell><TableCell className="text-right">{row.notRecordedDays}</TableCell><TableCell className="text-right">{pct(row.attendanceRate)}</TableCell><TableCell className="text-right">{row.incompleteStudents}</TableCell><TableCell className="text-right">{row.historicalUncertainty}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => { setClassId(String(row.classId)); setReportType("overview"); setPage(1); }}>View Students</Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>}

      <Dialog open={Boolean(selectedStudentId)} onOpenChange={(open) => { if (!open) setSelectedStudentId(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>Individual Attendance History</DialogTitle></DialogHeader>
          {historyQuery.isLoading && <div className="py-8 text-center text-muted-foreground">Loading attendance history…</div>}
          {historyQuery.data && <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3"><div><div className="text-xs text-muted-foreground">Student</div><div className="font-semibold">{historyQuery.data.student.studentName}</div></div><div><div className="text-xs text-muted-foreground">Admission Number</div><div>{historyQuery.data.student.admissionNo}</div></div><div><div className="text-xs text-muted-foreground">Class</div><div>{historyQuery.data.student.className}</div></div><div><div className="text-xs text-muted-foreground">Present</div><div>{historyQuery.data.student.presentDays}</div></div><div><div className="text-xs text-muted-foreground">Absent</div><div>{historyQuery.data.student.absentDays}</div></div><div><div className="text-xs text-muted-foreground">Not Recorded</div><div>{historyQuery.data.student.notRecordedDays}</div></div><div><div className="text-xs text-muted-foreground">Attendance %</div><div>{pct(historyQuery.data.student.attendancePercentage)}</div></div><div><div className="text-xs text-muted-foreground">Last Presence</div><div>{historyQuery.data.student.lastPresent || "—"}</div></div><div><div className="text-xs text-muted-foreground">Current Status</div><div>{statusLabel(historyQuery.data.student.currentStatus)}</div></div></div>
            <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Reason</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{historyQuery.data.days.map((day) => <TableRow key={day.date}><TableCell>{day.date}</TableCell><TableCell>{statusLabel(day.status)}</TableCell><TableCell>{day.reason || "—"}</TableCell><TableCell>{day.source || "—"}{day.gateEvidenceLocked ? <Badge className="ml-2" variant="secondary">Gate confirmed</Badge> : null}</TableCell></TableRow>)}</TableBody></Table></div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
