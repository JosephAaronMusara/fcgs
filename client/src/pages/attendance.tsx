import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { enqueueOfflineRequest, isLikelyNetworkError } from "@/lib/offlineQueue";
import { saveLocalDraft, removeLocalDraft } from "@/lib/localDrafts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  Check,
  X,
  Save,
  Download,
  Upload,
  ClipboardList,
  ClipboardCheck,
  Users,
  Loader2,
  Bell,
  BellOff,
  Search,
} from "lucide-react";
import type { Class, Student } from "@shared/schema";

interface ArrearsStudent {
  id: number;
  name: string;
  balance: number;
  status: string;
}

interface ArrearsData {
  students: ArrearsStudent[];
  att_date: string;
  class_name: string;
  present_count: number;
  arrears_present_count: number;
  all_present_paid: boolean;
}

interface AttendanceRecordLite {
  id?: number;
  studentId: number;
  classId: number;
  date: string;
  status: string;
  reason?: string | null;
  notifyParent?: boolean | null;
}

interface AttendanceGridStudent {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  name: string;
  admissionNo: string;
  classId: number;
  className?: string | null;
  statuses: Record<string, string>;
  records?: Record<string, AttendanceRecordLite>;
}

interface GridData {
  dates: string[];
  students: AttendanceGridStudent[];
  present: number;
  absent: number;
  total: number;
}

interface AttendanceState {
  status: string;
  reason: string;
}

const STATUS_PALETTE: Record<string, string> = {
  present: "#16A34A",
  absent: "#EF4444",
  sick: "#F97316",
  fees: "#1D4ED8",
  suspended: "#A855F7",
  absconding: "#06B6D4",
  excused: "#6B7280",
  late: "#92400E",
};

const STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  sick: "Sick",
  fees: "Fees",
  suspended: "Suspended",
  absconding: "Absconding",
  excused: "Excused",
  late: "Late",
};

const STATUS_ICONS: Record<string, string> = {
  present: "P",
  absent: "A",
  sick: "S",
  fees: "$",
  suspended: "!",
  absconding: "Ab",
  excused: "E",
  late: "L",
};

const ABSENT_REASONS = ["No Reason", "Excused", "Fees", "Sick", "Suspended", "Absconding", "Late"];
const ABSENT_LIKE = new Set(["absent", "sick", "fees", "suspended", "absconding", "excused", "late"]);

function reasonToSlug(label: string): string {
  switch (label) {
    case "Excused": return "excused";
    case "Fees": return "fees";
    case "Sick": return "sick";
    case "Suspended": return "suspended";
    case "Absconding": return "absconding";
    case "Late": return "late";
    default: return "absent";
  }
}

function normalizeStudentName(student: Pick<AttendanceGridStudent, "firstName" | "lastName" | "name">) {
  const fullName = [student.firstName, student.lastName].filter(Boolean).join(" ").trim();
  return fullName || student.name || "Unnamed Student";
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function studentMatchesSearch(student: AttendanceGridStudent, searchTerm: string) {
  const needle = searchTerm.trim().toLowerCase();
  if (!needle) return true;
  return [normalizeStudentName(student), student.admissionNo, student.className]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function sortStudents(students: AttendanceGridStudent[]) {
  return [...students].sort((a, b) => {
    const aName = normalizeStudentName(a).toLowerCase();
    const bName = normalizeStudentName(b).toLowerCase();
    return aName.localeCompare(bName, undefined, { sensitivity: "base" }) || String(a.admissionNo || "").localeCompare(String(b.admissionNo || ""));
  });
}

export default function AttendancePage() {
  const { toast } = useToast();
  const [selectedClass, setSelectedClass] = useState("all");
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);
  const [markDialogOpen, setMarkDialogOpen] = useState(false);
  const [singleEditTarget, setSingleEditTarget] = useState<{ student: AttendanceGridStudent; date: string } | null>(null);
  const [notifyParent, setNotifyParent] = useState(true);
  const [attendanceState, setAttendanceState] = useState<Record<number, AttendanceState>>({});
  const attendanceStateTouchedRef = useRef(false);
  const markDialogStateKeyRef = useRef<string | null>(null);
  const [arrearsModalOpen, setArrearsModalOpen] = useState(false);
  const [arrearsData, setArrearsData] = useState<ArrearsData | null>(null);

  const { data: classes } = useQuery<Class[]>({ queryKey: ["/api/classes"] });

  const { data: gridData, isLoading: gridLoading } = useQuery<GridData>({
    queryKey: ["/api/attendance/grid", selectedClass, dateFrom, dateTo],
    enabled: Boolean(dateFrom && dateTo),
  });

  const { data: existingRecords } = useQuery<AttendanceRecordLite[]>({
    queryKey: ["/api/attendance/by-class", selectedClass, selectedDate],
    enabled: selectedClass !== "all" && markDialogOpen,
  });

  const selectedClassName = useMemo(() => {
    if (!classes || selectedClass === "all") return "";
    return classes.find(c => c.id.toString() === selectedClass)?.className || "";
  }, [selectedClass, classes]);

  const visibleStudents = useMemo(() => {
    if (selectedClass === "all") return [];
    const rawStudents = gridData?.students ?? [];
    return sortStudents(rawStudents.filter((student) => studentMatchesSearch(student, studentSearch)));
  }, [gridData?.students, selectedClass, studentSearch]);

  const studentsForMarking = useMemo(() => {
    if (selectedClass === "all") return [];
    return visibleStudents.filter((student) => student.classId?.toString() === selectedClass);
  }, [selectedClass, visibleStudents]);

  useEffect(() => {
    if (!markDialogOpen) return;

    const stateKey = `${selectedClass}-${selectedDate}-${studentsForMarking.map((student) => student.id).join(",")}`;
    const newState: Record<number, AttendanceState> = {};
    studentsForMarking.forEach((student) => {
      const existing = existingRecords?.find((r) => r.studentId === student.id) || student.records?.[selectedDate];
      newState[student.id] = {
        status: existing?.status || "",
        reason: existing?.reason || "",
      };
    });

    const isSameMarkingSession = markDialogStateKeyRef.current === stateKey;
    setAttendanceState((currentState) => {
      if (!isSameMarkingSession || !attendanceStateTouchedRef.current) {
        return newState;
      }

      const preservedState: Record<number, AttendanceState> = { ...newState };
      Object.keys(currentState).forEach((studentIdKey) => {
        const studentId = Number(studentIdKey);
        if (preservedState[studentId]) {
          preservedState[studentId] = currentState[studentId];
        }
      });
      return preservedState;
    });
    markDialogStateKeyRef.current = stateKey;
  }, [markDialogOpen, selectedClass, selectedDate, studentsForMarking, existingRecords]);

  useEffect(() => {
    if (!singleEditTarget) return;
    attendanceStateTouchedRef.current = false;
    markDialogStateKeyRef.current = null;
    const existing = singleEditTarget.student.records?.[singleEditTarget.date];
    setSelectedDate(singleEditTarget.date);
    setAttendanceState({
      [singleEditTarget.student.id]: {
        status: existing?.status || "",
        reason: existing?.reason || "",
      },
    });
  }, [singleEditTarget]);

  const invalidateAttendanceQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/by-class"] });
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/grid"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
  };

  const handleOpenMarkDialog = () => {
    if (selectedClass === "all") {
      toast({
        title: "Select a class first",
        description: "Choose a class before marking the register for a group of students.",
        variant: "destructive",
      });
      return;
    }
    if (studentsForMarking.length === 0) {
      toast({
        title: "No students to mark",
        description: studentSearch.trim()
          ? "No students match the current search within the selected class."
          : "No students are available in the selected class.",
        variant: "destructive",
      });
      return;
    }
    attendanceStateTouchedRef.current = false;
    markDialogStateKeyRef.current = null;
    setAttendanceState({});
    queryClient.removeQueries({ queryKey: ["/api/attendance/by-class", selectedClass, selectedDate] });
    setMarkDialogOpen(true);
  };

  const handleCloseMarkDialog = () => {
    setMarkDialogOpen(false);
    setAttendanceState({});
    attendanceStateTouchedRef.current = false;
    markDialogStateKeyRef.current = null;
    invalidateAttendanceQueries();
  };

  const handleCloseSingleEdit = () => {
    setSingleEditTarget(null);
    setAttendanceState({});
    attendanceStateTouchedRef.current = false;
    markDialogStateKeyRef.current = null;
    invalidateAttendanceQueries();
  };

  const handleStatusToggle = (studentId: number, status: "present" | "absent") => {
    attendanceStateTouchedRef.current = true;
    setAttendanceState(prev => ({
      ...prev,
      [studentId]: {
        status,
        reason: status === "present" ? "" : prev[studentId]?.reason || "",
      },
    }));
  };

  const handleReasonSelect = (studentId: number, reason: string) => {
    attendanceStateTouchedRef.current = true;
    const slug = reasonToSlug(reason);
    setAttendanceState(prev => ({
      ...prev,
      [studentId]: { status: slug, reason },
    }));
  };

  const handleMarkAllPresent = () => {
    attendanceStateTouchedRef.current = true;
    const targetStudents = singleEditTarget ? [singleEditTarget.student] : studentsForMarking;
    const newState: Record<number, AttendanceState> = {};
    targetStudents.forEach((student) => {
      newState[student.id] = { status: "present", reason: "" };
    });
    setAttendanceState(newState);
  };

  const buildAttendancePayload = () => {
    const targetStudents = singleEditTarget ? [singleEditTarget.student] : studentsForMarking;
    const targetStudentIds = new Set(targetStudents.map((student) => student.id));
    const records = Object.entries(attendanceState)
      .filter(([studentId, val]) => targetStudentIds.has(Number(studentId)) && val.status !== "")
      .map(([studentId, val]) => {
        const student = targetStudents.find((item) => item.id === Number(studentId));
        if (!student?.classId) throw new Error("Selected student does not have a class assigned");
        return {
          studentId: Number(studentId),
          classId: Number(student.classId),
          date: singleEditTarget?.date || selectedDate,
          status: val.status,
          reason: val.reason || "",
          notifyParent,
        };
      });

    if (records.length === 0) throw new Error("No attendance marked");

    return {
      records,
      notifyParent,
      className: singleEditTarget?.student.className || selectedClassName || "Selected class",
      date: singleEditTarget?.date || selectedDate,
    };
  };

  const queueAttendancePayload = useCallback((payload: ReturnType<typeof buildAttendancePayload>) => {
    const classId = payload.records[0]?.classId || selectedClass || "unknown";
    const draftKey = `attendance:${classId}:${payload.date}`;
    saveLocalDraft(draftKey, "attendance", `Attendance Register - ${payload.className}`, payload);
    enqueueOfflineRequest({
      id: `attendance:${classId}:${payload.date}`,
      module: "attendance",
      title: "Attendance Register",
      subtitle: `${payload.className} • ${payload.date} • ${payload.records.length} record${payload.records.length === 1 ? "" : "s"}`,
      method: "POST",
      url: "/api/attendance/bulk",
      body: { records: payload.records, notifyParent: payload.notifyParent },
      invalidateKeys: ["/api/attendance/by-class", "/api/attendance/grid", "/api/dashboard/stats"],
    });
    return draftKey;
  }, [selectedClass]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildAttendancePayload();
      const draftKey = `attendance:${payload.records[0]?.classId || selectedClass}:${payload.date}`;
      saveLocalDraft(draftKey, "attendance", `Attendance Register - ${payload.className}`, payload);

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        queueAttendancePayload(payload);
        return { offlineQueued: true };
      }

      try {
        const res = await apiRequest("POST", "/api/attendance/bulk", {
          records: payload.records,
          notifyParent: payload.notifyParent,
        });
        removeLocalDraft(draftKey);
        return res.json();
      } catch (error) {
        if (!isLikelyNetworkError(error)) throw error;
        queueAttendancePayload(payload);
        return { offlineQueued: true };
      }
    },
    onSuccess: (data: any) => {
      if (data?.offlineQueued) {
        toast({ title: "Saved offline", description: "Attendance is saved on this device and will sync automatically when the network returns." });
      } else {
        toast({ title: "Saved", description: "Attendance saved successfully" });
      }
      if (singleEditTarget) {
        handleCloseSingleEdit();
      } else {
        handleCloseMarkDialog();
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });


  useEffect(() => {
    if (!attendanceStateTouchedRef.current) return;
    if (!markDialogOpen && !singleEditTarget) return;
    try {
      const payload = buildAttendancePayload();
      const draftKey = `attendance:${payload.records[0]?.classId || selectedClass}:${payload.date}`;
      saveLocalDraft(draftKey, "attendance", `Attendance Register - ${payload.className}`, payload);
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        queueAttendancePayload(payload);
      }
    } catch {
      // Incomplete drafts are ignored until at least one mark exists.
    }
  }, [attendanceState, markDialogOpen, singleEditTarget, notifyParent, queueAttendancePayload]);

  const handleDownload = () => {
    if (!gridData) return;
    const headers = ["Student", "Admission No", "Class", ...gridData.dates.map(formatDateLabel)];
    const rows = visibleStudents.map(s => [
      normalizeStudentName(s),
      s.admissionNo,
      s.className || "",
      ...gridData.dates.map(d => STATUS_LABELS[s.statuses?.[d]] || ""),
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => {
    let present = 0;
    let absent = 0;
    visibleStudents.forEach((student) => {
      gridData?.dates.forEach((date) => {
        const status = student.statuses?.[date];
        if (status === "present") present += 1;
        if (status && status !== "present") absent += 1;
      });
    });
    return { present, absent, total: present + absent };
  }, [visibleStudents, gridData?.dates]);

  const totalMarked = Object.values(attendanceState).filter(v => v.status).length;
  const presentCount = Object.values(attendanceState).filter(v => v.status === "present").length;
  const absentCount = Object.values(attendanceState).filter(v => v.status && v.status !== "present").length;

  const renderStatusPill = (status?: string, student?: AttendanceGridStudent, date?: string) => {
    if (!status) {
      return (
        <button
          type="button"
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-dashed px-1.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
          onClick={() => student && date && setSingleEditTarget({ student, date })}
          aria-label="Mark blank attendance cell"
        >
          —
        </button>
      );
    }
    const color = STATUS_PALETTE[status] || "#6B7280";
    return (
      <button
        type="button"
        className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white shadow-sm transition-transform hover:scale-105"
        style={{ backgroundColor: color }}
        title={STATUS_LABELS[status] || status}
        onClick={() => student && date && setSingleEditTarget({ student, date })}
        data-testid={`button-edit-attendance-${student?.id}-${date}`}
      >
        {STATUS_ICONS[status] || status.charAt(0).toUpperCase()}
      </button>
    );
  };

  const renderMarkingRows = (targetStudents: AttendanceGridStudent[]) => (
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
      {targetStudents.length > 0 ? (
        <div>
          {targetStudents.map((student, idx) => {
            const st = attendanceState[student.id];
            const isPresent = st?.status === "present";
            const isAbsent = st?.status ? ABSENT_LIKE.has(st.status) : false;
            return (
              <div
                key={student.id}
                className="border-b last:border-b-0"
                data-testid={`attendance-row-${student.id}`}
              >
                <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 px-3.5 py-2.5 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:items-center">
                  <div className="text-sm text-muted-foreground font-medium">{idx + 1}</div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate">{normalizeStudentName(student)}</div>
                    <div className="text-xs text-muted-foreground">
                      {student.admissionNo}{student.className ? ` • ${student.className}` : ""}
                    </div>
                  </div>
                  <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end">
                    <button
                      type="button"
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-colors min-w-[96px] text-center sm:min-w-[100px] ${
                        isPresent
                          ? "bg-[#0b1b3e] border-[#0b1b3e] text-white"
                          : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-foreground"
                      }`}
                      onClick={() => handleStatusToggle(student.id, "present")}
                      data-testid={`button-status-present-${student.id}`}
                    >
                      <Check className="w-3 h-3 inline mr-1" />
                      Present
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-colors min-w-[96px] text-center sm:min-w-[100px] ${
                        isAbsent
                          ? "bg-[#7f1d1d] border-[#7f1d1d] text-white"
                          : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-foreground"
                      }`}
                      onClick={() => handleStatusToggle(student.id, "absent")}
                      data-testid={`button-status-absent-${student.id}`}
                    >
                      <X className="w-3 h-3 inline mr-1" />
                      Absent
                    </button>
                  </div>
                </div>

                {isAbsent && (
                  <div className="px-3.5 pb-2.5 flex flex-wrap gap-1.5">
                    {ABSENT_REASONS.map((reason) => {
                      const slug = reasonToSlug(reason);
                      const isActive = st?.status === slug || (reason === "No Reason" && st?.status === "absent");
                      return (
                        <button
                          key={reason}
                          type="button"
                          className={`px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                            isActive
                              ? reason === "No Reason"
                                ? "bg-[#0B1B3E] text-white border-[#0B1B3E]"
                                : "bg-[#B91C1C] text-white border-[#B91C1C]"
                              : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-foreground"
                          }`}
                          onClick={() => handleReasonSelect(student.id, reason)}
                          data-testid={`button-reason-${reason.toLowerCase().replace(/\s/g, '-')}-${student.id}`}
                        >
                          {reason}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-6 text-center text-muted-foreground">No students available for the current filters.</div>
      )}
    </div>
  );

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2" style={{ color: "#1b2a5c" }} data-testid="text-attendance-title">
            <ClipboardList className="h-8 w-8" style={{ color: "#1b2a5c" }} />
            Attendance Register
          </h1>
          <p className="text-muted-foreground">Mark and review student attendance records</p>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:flex lg:items-center">
          <Button variant="outline" data-testid="button-import-attendance">
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>
          <Button variant="outline" onClick={handleDownload} disabled={!gridData} data-testid="button-export-attendance">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Card>
          <CardContent className="p-2 sm:p-4 flex items-center gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2 rounded-full bg-green-100 dark:bg-green-900/30">
              <ClipboardCheck className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground sm:text-sm">Present</p>
              <p className="text-lg font-bold sm:text-2xl" data-testid="text-present-count">{stats.present}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-2 sm:p-4 flex items-center gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2 rounded-full bg-red-100 dark:bg-red-900/30">
              <X className="w-4 h-4 sm:w-5 sm:h-5 text-red-600" />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground sm:text-sm">Absent / Other</p>
              <p className="text-lg font-bold sm:text-2xl" data-testid="text-absent-count">{stats.absent}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-2 sm:p-4 flex items-center gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
              <Users className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground sm:text-sm">Total</p>
              <p className="text-lg font-bold sm:text-2xl" data-testid="text-total-count">{visibleStudents.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-[minmax(180px,240px)_150px_150px_minmax(260px,1fr)_auto] lg:items-end">
            <div className="min-w-0 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Class</label>
              <Select value={selectedClass} onValueChange={setSelectedClass}>
                <SelectTrigger className="w-full" data-testid="select-attendance-class">
                  <SelectValue placeholder="Select Class" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Select Class</SelectItem>
                  {classes?.map(c => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.className}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full" data-testid="input-date-from" />
            </div>
            <div className="min-w-0 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full" data-testid="input-date-to" />
            </div>
            <div className="col-span-2 min-w-0 space-y-1.5 lg:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">Search student</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Search name, admission no. or class..."
                  className="pl-9"
                  data-testid="input-attendance-student-search"
                />
              </div>
            </div>
            <Button onClick={handleOpenMarkDialog} className="w-full self-end lg:w-auto" data-testid="button-mark-attendance">
              <Calendar className="w-4 h-4 mr-2" />
              Mark
            </Button>
          </div>

          <div className="mt-3 flex w-full flex-wrap items-center justify-start gap-1.5 rounded-md border bg-muted/20 px-2 py-2 text-xs sm:justify-between sm:gap-2 sm:px-4 lg:px-6" data-testid="attendance-status-legend">
            {Object.entries(STATUS_LABELS).map(([status, label]) => (
              <Badge key={status} variant="outline" className="gap-1 px-2 py-1 sm:flex-1 sm:justify-center sm:px-3">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_PALETTE[status] }} />
                {STATUS_ICONS[status]} = {label}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {studentSearch.trim() && selectedClass !== "all" && (
            <div className="mb-4 text-sm text-muted-foreground">
              Showing <strong>{visibleStudents.length}</strong> matching student{visibleStudents.length === 1 ? "" : "s"}{selectedClass !== "all" ? ` in ${selectedClassName}` : ""}.
            </div>
          )}

          <div className="overflow-x-auto rounded-md border max-w-full">
            {gridLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : gridData && gridData.dates.length > 0 ? (
              <Table className="w-max min-w-max table-auto">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-20 w-max min-w-[120px] bg-card px-2 text-[11px] sm:text-xs whitespace-nowrap">Student</TableHead>
                    {selectedClass === "all" && <TableHead className="w-[96px] min-w-[96px] px-2 text-[11px] sm:text-xs">Class</TableHead>}
                    {gridData.dates.map(date => (
                      <TableHead key={date} className="w-[58px] min-w-[58px] px-1 text-center text-[11px] sm:text-xs whitespace-nowrap">{formatDateLabel(date)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleStudents.length > 0 ? visibleStudents.map(student => (
                    <TableRow key={student.id} className="text-[11px] sm:text-xs md:text-sm">
                      <TableCell className="sticky left-0 z-10 w-max min-w-[120px] bg-card px-2 py-1.5 font-medium whitespace-nowrap">
                        <div className="min-w-0 whitespace-nowrap">
                          <div className="whitespace-nowrap text-[11px] leading-tight sm:text-xs md:text-sm">{normalizeStudentName(student)}</div>
                          <div className="whitespace-nowrap text-[10px] leading-tight text-muted-foreground sm:text-[11px] md:text-xs">{student.admissionNo}</div>
                        </div>
                      </TableCell>
                      {selectedClass === "all" && <TableCell className="w-[96px] min-w-[96px] px-2 py-1.5 text-[11px] text-muted-foreground truncate sm:text-xs md:text-sm">{student.className || "—"}</TableCell>}
                      {gridData.dates.map(date => (
                        <TableCell key={date} className="w-[58px] min-w-[58px] px-1 py-1.5 text-center">
                          {renderStatusPill(student.statuses?.[date], student, date)}
                        </TableCell>
                      ))}
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={gridData.dates.length + (selectedClass === "all" ? 2 : 1)} className="h-24 text-center text-muted-foreground">
                        {selectedClass === "all" ? "Select a class to view attendance records." : "No students match the current filters."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            ) : (
              <div className="p-10 text-center text-muted-foreground">
                <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No attendance data found for this period.</p>
              </div>
            )}
          </div>

        </CardContent>
      </Card>

      <Dialog open={markDialogOpen} onOpenChange={(open) => !open && handleCloseMarkDialog()}>
        <DialogContent className="w-[calc(100dvw-2rem)] max-w-5xl max-h-[calc(100dvh-2rem)] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="sr-only">
            <DialogTitle>Mark Attendance</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between bg-[#0b1b3e] text-white px-4 py-3">
            <div>
              <div className="font-bold text-sm" data-testid="text-drawer-title">
                ATTENDANCE REGISTER FOR {selectedClassName.toUpperCase()}
              </div>
              <div className="text-xs opacity-80 mt-0.5">
                {studentSearch.trim() ? "Marking only the currently searched/visible students." : "Mark attendance inline."}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleCloseMarkDialog} className="text-white hover:bg-white/20" data-testid="button-drawer-close">
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="flex flex-col gap-3 border-b bg-muted/30 px-4 py-2.5 sm:flex-row sm:items-center">
            <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-full sm:w-[160px]" data-testid="input-attendance-date" />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer" data-testid="radio-notify-yes">
                <input type="radio" name="notify-parent" checked={notifyParent} onChange={() => setNotifyParent(true)} className="accent-primary" />
                <Bell className="w-3.5 h-3.5" />
                Notify Parents
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer" data-testid="radio-notify-no">
                <input type="radio" name="notify-parent" checked={!notifyParent} onChange={() => setNotifyParent(false)} className="accent-primary" />
                <BellOff className="w-3.5 h-3.5" />
                Do not Notify Parents
              </label>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap">
              <Button variant="outline" size="sm" onClick={handleMarkAllPresent} data-testid="button-mark-all-present">
                <Check className="w-4 h-4 mr-1" />
                All Present
              </Button>
              <Button variant="outline" size="sm" onClick={handleCloseMarkDialog} data-testid="button-cancel">Cancel</Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-attendance">
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save
              </Button>
            </div>
          </div>

          {totalMarked > 0 && (
            <div className="px-4 py-2 text-sm bg-green-50 dark:bg-green-950/30 border-b flex items-center gap-3">
              <span>
                Marked: <strong>{totalMarked}</strong> | Present: <strong className="text-green-600">{presentCount}</strong> | Absent: <strong className="text-red-600">{absentCount}</strong>
              </span>
            </div>
          )}

          {renderMarkingRows(studentsForMarking)}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(singleEditTarget)} onOpenChange={(open) => !open && handleCloseSingleEdit()}>
        <DialogContent className="w-[calc(100dvw-2rem)] max-w-3xl max-h-[calc(100dvh-2rem)] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="sr-only">
            <DialogTitle>Edit Attendance</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between bg-[#0b1b3e] text-white px-4 py-3">
            <div>
              <div className="font-bold text-sm" data-testid="text-single-edit-title">
                EDIT ATTENDANCE FOR {singleEditTarget ? normalizeStudentName(singleEditTarget.student).toUpperCase() : "STUDENT"}
              </div>
              <div className="text-xs opacity-80 mt-0.5">
                {singleEditTarget?.date ? formatDateLabel(singleEditTarget.date) : "Selected day"} {singleEditTarget?.student.className ? `• ${singleEditTarget.student.className}` : ""}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleCloseSingleEdit} className="text-white hover:bg-white/20" data-testid="button-single-edit-close">
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="flex flex-col gap-3 border-b bg-muted/30 px-4 py-2.5 sm:flex-row sm:items-center">
            <Input type="date" value={singleEditTarget?.date || selectedDate} disabled className="w-full sm:w-[160px]" data-testid="input-single-edit-date" />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer" data-testid="radio-single-notify-yes">
                <input type="radio" name="single-notify-parent" checked={notifyParent} onChange={() => setNotifyParent(true)} className="accent-primary" />
                <Bell className="w-3.5 h-3.5" />
                Notify Parents
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer" data-testid="radio-single-notify-no">
                <input type="radio" name="single-notify-parent" checked={!notifyParent} onChange={() => setNotifyParent(false)} className="accent-primary" />
                <BellOff className="w-3.5 h-3.5" />
                Do not Notify Parents
              </label>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap">
              <Button variant="outline" size="sm" onClick={handleMarkAllPresent} data-testid="button-single-mark-present">
                <Check className="w-4 h-4 mr-1" />
                Present
              </Button>
              <Button variant="outline" size="sm" onClick={handleCloseSingleEdit} data-testid="button-single-cancel">Cancel</Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-single-attendance">
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save
              </Button>
            </div>
          </div>

          {singleEditTarget ? renderMarkingRows([singleEditTarget.student]) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={arrearsModalOpen} onOpenChange={setArrearsModalOpen}>
        <DialogContent className="w-[calc(100dvw-2rem)] max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Fees Arrears Alert</DialogTitle>
          </DialogHeader>
          {arrearsData && (
            <div className="space-y-4">
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4">
                <p className="text-sm">
                  <strong>{arrearsData.arrears_present_count}</strong> of <strong>{arrearsData.present_count}</strong> present students in {arrearsData.class_name} have outstanding fees.
                </p>
              </div>
              <div className="max-h-80 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {arrearsData.students.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell>{student.name}</TableCell>
                        <TableCell>{student.status}</TableCell>
                        <TableCell className="text-right">${student.balance.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
