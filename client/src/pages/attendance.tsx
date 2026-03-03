import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
  ChevronDown,
  ChevronUp,
  Bell,
  BellOff,
  AlertTriangle,
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

interface AttendanceState {
  status: string;
  reason: string;
}

interface GridData {
  dates: string[];
  students: Array<{
    id: number;
    name: string;
    admissionNo: string;
    statuses: Record<string, string>;
  }>;
  present: number;
  absent: number;
  total: number;
}

export default function AttendancePage() {
  const { toast } = useToast();
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifyParent, setNotifyParent] = useState(true);
  const [attendanceState, setAttendanceState] = useState<Record<number, AttendanceState>>({});
  const [arrearsModalOpen, setArrearsModalOpen] = useState(false);
  const [arrearsData, setArrearsData] = useState<ArrearsData | null>(null);

  const { data: classes } = useQuery<Class[]>({ queryKey: ["/api/classes"] });

  const { data: students, isLoading: studentsLoading } = useQuery<Student[]>({
    queryKey: ["/api/students/by-class", selectedClass],
    enabled: !!selectedClass,
  });

  const { data: existingRecords } = useQuery<any[]>({
    queryKey: ["/api/attendance/by-class", selectedClass, selectedDate],
    enabled: !!selectedClass && drawerOpen,
  });

  const { data: gridData, isLoading: gridLoading } = useQuery<GridData>({
    queryKey: ["/api/attendance/grid", selectedClass, dateFrom, dateTo],
    enabled: !!selectedClass && !drawerOpen,
  });

  const selectedClassName = useMemo(() => {
    if (!selectedClass || !classes) return "";
    return classes.find(c => c.id.toString() === selectedClass)?.className || "";
  }, [selectedClass, classes]);

  useEffect(() => {
    if (!drawerOpen || !students) return;
    const newState: Record<number, AttendanceState> = {};
    students.forEach(s => {
      const existing = existingRecords?.find((r: any) => r.studentId === s.id);
      newState[s.id] = {
        status: existing?.status || "",
        reason: existing?.reason || "",
      };
    });
    setAttendanceState(newState);
  }, [drawerOpen, students, existingRecords]);

  const handleOpenDrawer = () => {
    setAttendanceState({});
    queryClient.removeQueries({ queryKey: ["/api/attendance/by-class", selectedClass, selectedDate] });
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setAttendanceState({});
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/grid", selectedClass] });
  };

  const handleStatusToggle = (studentId: number, status: "present" | "absent") => {
    setAttendanceState(prev => ({
      ...prev,
      [studentId]: {
        status,
        reason: status === "present" ? "" : prev[studentId]?.reason || "",
      },
    }));
  };

  const handleReasonSelect = (studentId: number, reason: string) => {
    const slug = reasonToSlug(reason);
    setAttendanceState(prev => ({
      ...prev,
      [studentId]: { status: slug, reason },
    }));
  };

  const handleMarkAllPresent = () => {
    if (!students) return;
    const newState: Record<number, AttendanceState> = {};
    students.forEach(s => {
      newState[s.id] = { status: "present", reason: "" };
    });
    setAttendanceState(newState);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const records = Object.entries(attendanceState)
        .filter(([_, val]) => val.status !== "")
        .map(([studentId, val]) => ({
          studentId: parseInt(studentId),
          classId: parseInt(selectedClass),
          date: selectedDate,
          status: val.status,
          reason: val.reason || "",
          notifyParent,
        }));

      if (records.length === 0) throw new Error("No attendance marked");

      const res = await apiRequest("POST", "/api/attendance/bulk", {
        records,
        notifyParent,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/by-class"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/grid", selectedClass] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Saved", description: "Attendance saved successfully" });
      handleCloseDrawer();
      fetchFeesArrearsForClass(selectedClass, selectedDate);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const presentCount = useMemo(() => {
    return Object.values(attendanceState).filter(s => s.status === "present").length;
  }, [attendanceState]);

  const absentCount = useMemo(() => {
    return Object.values(attendanceState).filter(s => ABSENT_LIKE.has(s.status)).length;
  }, [attendanceState]);

  const totalMarked = presentCount + absentCount;

  const handleExport = () => {
    if (!selectedClass) return;
    window.open(`/api/attendance/export/${selectedClass}/${dateFrom}/${dateTo}`, "_blank");
  };

  const fetchFeesArrearsForClass = async (classId: string, attDate: string) => {
    if (!classId) return;
    try {
      const res = await apiRequest("POST", "/api/fees/arrears-for-class", { classId: parseInt(classId), date: attDate });
      const result = await res.json();
      if (!result || !result.success || !result.data) return;

      const data = result.data as ArrearsData;

      if (data.students.length === 0) {
        if (data.all_present_paid) {
          toast({ title: "Fees Check", description: "All students marked present are fully paid / up to date with fees." });
        }
        return;
      }

      setArrearsData(data);
      setArrearsModalOpen(true);
    } catch (err) {
      console.error("Fees arrears fetch error", err);
    }
  };

  const handleDownloadArrearsExcel = () => {
    if (!arrearsData) return;
    let csv = `Class,${arrearsData.class_name}\r\n`;
    csv += `Date,${arrearsData.att_date}\r\n\r\n`;
    csv += `No,Student,Balance due,Status\r\n`;
    arrearsData.students.forEach((row, idx) => {
      const name = (row.name || "").replace(/"/g, '""');
      const status = (row.status || "").replace(/"/g, '""');
      csv += `${idx + 1},"${name}",${row.balance.toFixed(2)},"${status}"\r\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const arrearsClassName = (arrearsData.class_name || "class").replace(/\s+/g, "_");
    a.download = `Fees_Arrears_${arrearsClassName}_${arrearsData.att_date || new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="h-8 w-8" style={{ color: "#1b2a5c" }} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-attendance-title">Attendance Register</h1>
          <p className="text-muted-foreground">Record and manage daily class attendance</p>
        </div>
      </div>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              {selectedClass && gridData && !drawerOpen && (
                <span className="text-sm text-muted-foreground ml-2" data-testid="text-summary">
                  Present: <span className="font-bold text-green-600">{gridData.present}</span>
                  {" | "}Absent: <span className="font-bold text-red-600">{gridData.absent}</span>
                  {" | "}Total: <span className="font-bold">{gridData.total}</span>
                </span>
              )}
            </div>

            <div className="flex items-end gap-2 flex-wrap">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">From</span>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-[150px]"
                  data-testid="input-date-from"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">To</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-[150px]"
                  data-testid="input-date-to"
                />
              </div>
              <Button
                onClick={handleOpenDrawer}
                disabled={!selectedClass}
                data-testid="button-mark"
              >
                <ClipboardList className="w-4 h-4 mr-1" />
                MARK
              </Button>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={!selectedClass}
                data-testid="button-export"
              >
                <Download className="w-4 h-4 mr-1" />
                DOWNLOAD
              </Button>
              <Select value={selectedClass} onValueChange={(v) => { setSelectedClass(v); setDrawerOpen(false); setAttendanceState({}); }}>
                <SelectTrigger className="w-[200px]" data-testid="select-class">
                  <SelectValue placeholder="Select Class" />
                </SelectTrigger>
                <SelectContent>
                  {classes?.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.className}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {drawerOpen && selectedClass && (
        <Card className="overflow-hidden">
          <div className="bg-[#0B1B3E] text-white px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="font-bold text-sm" data-testid="text-drawer-title">
                ATTENDANCE REGISTER FOR {selectedClassName.toUpperCase()}
              </div>
              <div className="text-xs opacity-80 mt-0.5">Mark attendance inline.</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCloseDrawer}
              className="text-white hover:bg-white/20"
              data-testid="button-drawer-close"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-muted/30 flex-wrap">
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-[160px]"
              data-testid="input-attendance-date"
            />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer" data-testid="radio-notify-yes">
                <input
                  type="radio"
                  name="notify-parent"
                  checked={notifyParent}
                  onChange={() => setNotifyParent(true)}
                  className="accent-primary"
                />
                <Bell className="w-3.5 h-3.5" />
                Notify Parents
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer" data-testid="radio-notify-no">
                <input
                  type="radio"
                  name="notify-parent"
                  checked={!notifyParent}
                  onChange={() => setNotifyParent(false)}
                  className="accent-primary"
                />
                <BellOff className="w-3.5 h-3.5" />
                Do not Notify Parents
              </label>
            </div>
            <div className="ml-auto flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleMarkAllPresent} data-testid="button-mark-all-present">
                <Check className="w-4 h-4 mr-1" />
                All Present
              </Button>
              <Button variant="outline" size="sm" onClick={handleCloseDrawer} data-testid="button-cancel">
                Cancel
              </Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-attendance">
                {saveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-1" />
                )}
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

          <div className="max-h-[60vh] overflow-auto">
            {studentsLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : students && students.length > 0 ? (
              <div>
                {students.map((student, idx) => {
                  const st = attendanceState[student.id];
                  const isPresent = st?.status === "present";
                  const isAbsent = st?.status ? ABSENT_LIKE.has(st.status) : false;
                  return (
                    <div
                      key={student.id}
                      className="border-b last:border-b-0"
                      data-testid={`attendance-row-${student.id}`}
                    >
                      <div className="grid grid-cols-[40px_1fr_auto] gap-2 items-center px-3.5 py-2.5">
                        <div className="text-sm text-muted-foreground font-medium">{idx + 1}</div>
                        <div className="min-w-0">
                          <div className="font-bold text-sm truncate">
                            {student.firstName} {student.lastName}
                          </div>
                          <div className="text-xs text-muted-foreground">{student.admissionNo}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-colors min-w-[100px] text-center ${
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
                            className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-colors min-w-[100px] text-center ${
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
              <div className="p-8 text-center text-muted-foreground">
                No students found in this class.
              </div>
            )}
          </div>
        </Card>
      )}

      {!drawerOpen && selectedClass && (
        <>
          {gridLoading ? (
            <Card>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              </CardContent>
            </Card>
          ) : gridData && gridData.students.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[800px]" data-testid="table-attendance-grid">
                    <thead>
                      <tr className="border-b">
                        <th className="sticky left-0 bg-card z-10 px-3 py-2 text-left font-semibold text-sm">Student</th>
                        {gridData.dates.map(date => {
                          const d = new Date(date + "T00:00:00");
                          const dayLabel = d.toLocaleDateString("en", { weekday: "short" });
                          const dateLabel = d.toLocaleDateString("en", { day: "2-digit", month: "short" });
                          return (
                            <th key={date} className="px-1 py-2 text-center font-medium whitespace-nowrap min-w-[50px]">
                              <div className="text-[10px] text-muted-foreground">{dayLabel}</div>
                              <div>{dateLabel}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {gridData.students.map((student) => (
                        <tr key={student.id} className="border-b last:border-b-0 hover-elevate">
                          <td className="sticky left-0 bg-card z-10 px-3 py-2 font-bold text-sm whitespace-nowrap">
                            {student.name}
                            <span className="text-[10px] text-muted-foreground ml-1.5">{student.admissionNo}</span>
                          </td>
                          {gridData.dates.map(date => {
                            const status = student.statuses[date];
                            if (!status) {
                              return (
                                <td key={date} className="px-1 py-2 text-center">
                                  <span
                                    className="inline-flex items-center justify-center w-[42px] h-7 rounded-full border border-dashed border-gray-300 dark:border-gray-700 text-transparent"
                                    data-testid={`cell-empty-${student.id}-${date}`}
                                  >
                                    -
                                  </span>
                                </td>
                              );
                            }
                            const color = STATUS_PALETTE[status] || "#e5e7eb";
                            const icon = STATUS_ICONS[status] || "?";
                            return (
                              <td key={date} className="px-1 py-2 text-center">
                                <span
                                  className="inline-flex items-center justify-center w-[42px] h-7 rounded-full text-white font-bold text-sm"
                                  style={{ backgroundColor: color }}
                                  title={`${STATUS_LABELS[status] || status} - ${date}`}
                                  data-testid={`cell-status-${student.id}-${date}`}
                                >
                                  {icon}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : selectedClass ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold text-lg mb-2">No Attendance Records</h3>
                <p className="text-muted-foreground">
                  No attendance data for this date range. Click MARK to start marking.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      {!selectedClass && (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2">Select a Class</h3>
            <p className="text-muted-foreground">
              Choose a class from the dropdown above to view or mark attendance.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground mr-1">Legend:</span>
        {Object.entries(STATUS_PALETTE).map(([slug, color]) => (
          <span
            key={slug}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full text-white font-medium"
            style={{ backgroundColor: color }}
          >
            {STATUS_LABELS[slug]}
          </span>
        ))}
      </div>

      <Dialog open={arrearsModalOpen} onOpenChange={setArrearsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" data-testid="dialog-arrears">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-arrears-title">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Fee Arrears Alert
            </DialogTitle>
          </DialogHeader>

          {arrearsData && (
            <div className="flex-1 overflow-hidden flex flex-col gap-3">
              <div className="text-sm space-y-1">
                <p data-testid="text-arrears-summary">
                  <strong>{arrearsData.arrears_present_count}</strong> student(s) marked <strong>present</strong> in{" "}
                  <strong>{arrearsData.class_name}</strong> on {arrearsData.att_date} are <strong>in arrears</strong> with school fees.
                </p>
              </div>

              <div className="flex-1 overflow-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">#</TableHead>
                      <TableHead>Student Name</TableHead>
                      <TableHead className="text-right">Balance Due</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {arrearsData.students.map((row, idx) => (
                      <TableRow key={row.id} data-testid={`arrears-row-${row.id}`}>
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right font-mono">${row.balance.toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant="destructive">{row.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="outline" onClick={handleDownloadArrearsExcel} data-testid="button-download-arrears">
                  <Download className="w-4 h-4 mr-1" />
                  Download CSV
                </Button>
                <Button onClick={() => setArrearsModalOpen(false)} data-testid="button-close-arrears">
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
