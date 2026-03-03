import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  Check,
  X,
  Save,
  Download,
  Upload,
  ClipboardList,
  Users,
  Loader2,
  Bell,
  BellOff,
  Building,
} from "lucide-react";
import type { Hostel, Student } from "@shared/schema";

const STATUS_PALETTE: Record<string, string> = {
  present: "#16A34A",
  absent: "#EF4444",
  leave: "#F97316",
  sick: "#1D4ED8",
};

const STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  leave: "On Leave",
  sick: "Sick",
};

const STATUS_ICONS: Record<string, string> = {
  present: "P",
  absent: "A",
  leave: "L",
  sick: "S",
};

const ABSENT_REASONS = ["No Reason", "On Leave", "Sick"];
const ABSENT_LIKE = new Set(["absent", "leave", "sick"]);

function reasonToSlug(label: string): string {
  switch (label) {
    case "On Leave": return "leave";
    case "Sick": return "sick";
    default: return "absent";
  }
}

function reasonToNotes(label: string): string {
  if (label === "No Reason") return "";
  return label;
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

export default function HostelPage() {
  const { toast } = useToast();
  const [selectedHostel, setSelectedHostel] = useState("");
  const [selectedTimeSlot, setSelectedTimeSlot] = useState("evening");
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

  const { data: hostels = [], isLoading: hostelsLoading } = useQuery<Hostel[]>({
    queryKey: ["/api/hostels"],
  });

  const { data: students = [] } = useQuery<Student[]>({
    queryKey: ["/api/students"],
  });

  const hostelStudents = useMemo(() => {
    if (!selectedHostel) return [];
    return students.filter(s => s.isBoarding && s.hostelId === parseInt(selectedHostel));
  }, [students, selectedHostel]);

  const { data: existingRecords } = useQuery<any[]>({
    queryKey: ["/api/hostel/rollcall/by-hostel", selectedHostel, selectedDate, selectedTimeSlot],
    enabled: !!selectedHostel && drawerOpen,
  });

  const { data: gridData, isLoading: gridLoading } = useQuery<GridData>({
    queryKey: ["/api/hostel/rollcall/grid", selectedHostel, dateFrom, dateTo, selectedTimeSlot],
    enabled: !!selectedHostel && !drawerOpen,
  });

  const selectedHostelName = useMemo(() => {
    if (!selectedHostel || !hostels) return "";
    return hostels.find(h => h.id.toString() === selectedHostel)?.name || "";
  }, [selectedHostel, hostels]);

  useEffect(() => {
    if (!drawerOpen || hostelStudents.length === 0) return;
    const newState: Record<number, AttendanceState> = {};
    hostelStudents.forEach(s => {
      const existing = existingRecords?.find((r: any) => r.studentId === s.id);
      newState[s.id] = {
        status: existing?.status || "",
        reason: existing?.notes || "",
      };
    });
    setAttendanceState(newState);
  }, [drawerOpen, hostelStudents, existingRecords]);

  const handleOpenDrawer = () => {
    setAttendanceState({});
    queryClient.removeQueries({ queryKey: ["/api/hostel/rollcall/by-hostel", selectedHostel, selectedDate, selectedTimeSlot] });
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setAttendanceState({});
    queryClient.invalidateQueries({ queryKey: ["/api/hostel/rollcall/grid", selectedHostel] });
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
      [studentId]: { status: slug, reason: reasonToNotes(reason) },
    }));
  };

  const handleMarkAllPresent = () => {
    const newState: Record<number, AttendanceState> = {};
    hostelStudents.forEach(s => {
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
          date: selectedDate,
          timeSlot: selectedTimeSlot,
          status: val.status,
          notes: val.reason || "",
          notifyParent,
        }));

      if (records.length === 0) throw new Error("No attendance marked");

      return apiRequest("POST", "/api/hostel/rollcall/bulk", {
        records,
        notifyParent,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hostel/rollcall/by-hostel"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hostel/rollcall/grid", selectedHostel] });
      toast({ title: "Saved", description: "Hostel attendance saved successfully" });
      handleCloseDrawer();
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
    if (!selectedHostel) return;
    window.open(`/api/hostel/rollcall/export/${selectedHostel}/${dateFrom}/${dateTo}/${selectedTimeSlot}`, "_blank");
  };

  if (hostelsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (hostels.length === 0) {
    return (
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2" data-testid="text-no-hostels">No Hostels Created</h3>
            <p className="text-muted-foreground">Create hostels in Boarding Hostels module first, then assign boarding students.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Building className="h-8 w-8" style={{ color: "#1b2a5c" }} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-hostel-attendance-title">Hostel Attendance Register</h1>
          <p className="text-muted-foreground">Record and manage boarding student attendance</p>
        </div>
      </div>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              {selectedHostel && gridData && !drawerOpen && (
                <span className="text-sm text-muted-foreground ml-2" data-testid="text-summary">
                  Present: <span className="font-bold text-green-600">{gridData.present}</span>
                  {" | "}Absent: <span className="font-bold text-red-600">{gridData.absent}</span>
                  {" | "}Total: <span className="font-bold">{gridData.total}</span>
                </span>
              )}
            </div>

            <div className="flex items-end gap-2 flex-wrap">
              <Select value={selectedHostel} onValueChange={(v) => { setSelectedHostel(v); setDrawerOpen(false); setAttendanceState({}); }}>
                <SelectTrigger className="w-[200px]" data-testid="select-hostel">
                  <SelectValue placeholder="Select Hostel" />
                </SelectTrigger>
                <SelectContent>
                  {hostels.map((h) => (
                    <SelectItem key={h.id} value={h.id.toString()}>
                      {h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedTimeSlot} onValueChange={setSelectedTimeSlot}>
                <SelectTrigger className="w-[140px]" data-testid="select-timeslot">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="morning">Morning</SelectItem>
                  <SelectItem value="evening">Evening</SelectItem>
                  <SelectItem value="night">Night</SelectItem>
                </SelectContent>
              </Select>
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
                disabled={!selectedHostel}
                data-testid="button-mark"
              >
                <ClipboardList className="w-4 h-4 mr-1" />
                MARK
              </Button>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={!selectedHostel}
                data-testid="button-export"
              >
                <Download className="w-4 h-4 mr-1" />
                DOWNLOAD
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {drawerOpen && selectedHostel && (
        <Card className="overflow-visible">
          <div className="bg-[#0B1B3E] text-white px-4 py-3 flex items-center justify-between gap-4 rounded-t-md">
            <div>
              <div className="font-bold text-sm" data-testid="text-drawer-title">
                HOSTEL ATTENDANCE - {selectedHostelName.toUpperCase()} ({selectedTimeSlot.toUpperCase()})
              </div>
              <div className="text-xs opacity-80 mt-0.5">Mark attendance inline for boarding students.</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCloseDrawer}
              className="text-white hover:bg-white/20 no-default-hover-elevate"
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
            {hostelStudents.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No boarding students assigned to this hostel.
              </div>
            ) : (
              <div>
                {hostelStudents.map((student, idx) => {
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
            )}
          </div>
        </Card>
      )}

      {!drawerOpen && selectedHostel && (
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
                  <table className="w-full text-xs min-w-[800px]" data-testid="table-hostel-attendance-grid">
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
          ) : selectedHostel ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold text-lg mb-2" data-testid="text-no-records">No Attendance Records</h3>
                <p className="text-muted-foreground">
                  No hostel attendance data for this date range. Click MARK to start marking.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      {!selectedHostel && (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2" data-testid="text-select-hostel">Select a Hostel</h3>
            <p className="text-muted-foreground">
              Choose a hostel from the dropdown above to view or mark attendance.
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
    </div>
  );
}
