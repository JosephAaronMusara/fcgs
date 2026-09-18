import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { AlertTriangle, Calendar, CheckCircle2, Clock, Download, LogIn, LogOut, MapPin, ShieldAlert } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { School, Staff, StaffAttendanceLog } from "@shared/schema";

const GPS_ACCURACY_THRESHOLD_METERS = 150;
const LOCATION_ATTEMPT_LIMIT = 3;
const ATTENDANCE_PAGE_PERMISSIONS = [
  "staff_attendance.view_own",
  "staff_attendance.view_all",
  "staff_attendance.view_logs",
  "staff_attendance.view_overview",
  "staff_attendance.clock_in",
  "staff_attendance.clock_out",
  "logbook.view",
] as const;

type OverviewCellState = "blank" | "weekend" | "present" | "late" | "absent";

interface WorkdayConfig extends Pick<School,
  | "term1StartDate"
  | "term1EndDate"
  | "vac1StartDate"
  | "vac1EndDate"
  | "term2StartDate"
  | "term2EndDate"
  | "vac2StartDate"
  | "vac2EndDate"
  | "term3StartDate"
  | "term3EndDate"
> {}

interface StaffDaySchedule {
  isSchoolDay: boolean;
  staffStartTime: string;
  staffLateGraceMinutes: number;
  staffEndTime: string;
}

interface StaffGridData {
  dates: string[];
  schedules?: Record<string, StaffDaySchedule>;
  staff: Array<{
    id: number;
    name: string;
    statuses: Record<string, string>;
    records?: Record<string, StaffAttendanceLog>;
  }>;
}

interface AttendanceTotals {
  present: number;
  absent: number;
  late: number;
  excused: number;
}

interface SelectedAttendanceFocus {
  staffId: number;
  staffName: string;
  date: string;
}

interface AttendanceStripState {
  mode: "neutral" | "record" | "absent" | "weekend";
  staffName?: string;
  date?: string;
  log?: StaffAttendanceLog | null;
  message?: string;
}

function formatTime(value: string | Date | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatDateShort(value: string): string {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function parseScheduleTime(value: string | null | undefined, fallbackHour: number, fallbackMinute: number) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hour: fallbackHour, minute: fallbackMinute };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function expectedStart(dateStr: string, schedule?: StaffDaySchedule | null): { hour: number; minute: number } {
  if (schedule) return parseScheduleTime(schedule.staffStartTime, 7, 20);
  return isWeekend(dateStr) ? { hour: 8, minute: 0 } : { hour: 7, minute: 20 };
}

function expectedEnd(dateStr: string, schedule?: StaffDaySchedule | null): { hour: number; minute: number } | null {
  if (schedule && !schedule.isSchoolDay) return null;
  if (schedule) return parseScheduleTime(schedule.staffEndTime, 16, 0);
  return isWeekend(dateStr) ? null : { hour: 16, minute: 0 };
}

function formatTimeDifference(value: string | Date | null, refHour: number, refMinute: number): string {
  if (!value) return "";
  const actual = new Date(value);
  const reference = new Date(actual);
  reference.setHours(refHour, refMinute, 0, 0);
  const diffMinutes = Math.abs(Math.floor((actual.getTime() - reference.getTime()) / 60000));
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return `${hours}Hrs ${minutes}min(s)`;
}

function calculateDuration(clockIn: string | Date | null, clockOut: string | Date | null): string {
  if (!clockIn || !clockOut) return "-";
  const diff = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  if (diff <= 0) return "0h 0m";
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

const ATTENDANCE_DEVICE_TOKEN_KEY = "fcgs_attendance_device_token";

function buildDeviceSignature(): string {
  if (typeof window === "undefined") return "server";
  const nav = window.navigator;
  const screenPart = typeof window.screen !== "undefined" ? `${window.screen.width}x${window.screen.height}` : "unknown-screen";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown-tz";
  return [nav.userAgent, nav.language, nav.platform, screenPart, timezone].join("|").slice(0, 255);
}

function getOrCreateAttendanceDeviceToken(): string {
  if (typeof window === "undefined") return "server";

  try {
    const existing = window.localStorage.getItem(ATTENDANCE_DEVICE_TOKEN_KEY);
    if (existing && existing.trim()) return existing.trim().slice(0, 255);

    const token =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

    window.localStorage.setItem(ATTENDANCE_DEVICE_TOKEN_KEY, token);
    return token.slice(0, 255);
  } catch {
    return buildDeviceSignature();
  }
}

async function getLocationWithRetry(): Promise<{ latitude: number; longitude: number; accuracy: number; attemptCount: number }> {
  if (!navigator.geolocation) {
    throw new Error("Your browser does not support geolocation.");
  }

  let lastAccuracy = Number.POSITIVE_INFINITY;
  for (let attempt = 1; attempt <= LOCATION_ATTEMPT_LIMIT; attempt += 1) {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      });
    });

    lastAccuracy = position.coords.accuracy;
    if (position.coords.accuracy <= GPS_ACCURACY_THRESHOLD_METERS) {
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        attemptCount: attempt,
      };
    }
  }

  throw new Error(`Location accuracy is too low (${Math.round(lastAccuracy)}m). Move to an open area and try again.`);
}

function isWithinConfiguredWorkPeriods(date: string, school?: WorkdayConfig | null): boolean {
  if (!school) return true;
  const ranges: Array<[string | null | undefined, string | null | undefined]> = [
    [school.term1StartDate, school.term1EndDate],
    [school.vac1StartDate, school.vac1EndDate],
    [school.term2StartDate, school.term2EndDate],
    [school.vac2StartDate, school.vac2EndDate],
    [school.term3StartDate, school.term3EndDate],
  ];

  for (const [start, end] of ranges) {
    if (!start || !end) continue;
    if (date >= start && date <= end) return true;
  }

  return false;
}

function getOverviewStatus(
  status: string | undefined,
  date: string,
  today: string,
  firstClockInDate: string | null | undefined,
  school?: WorkdayConfig | null,
): OverviewCellState {
  if (date > today) return "blank";
  if (!firstClockInDate || date < firstClockInDate) return "blank";
  const withinConfiguredPeriod = isWithinConfiguredWorkPeriods(date, school);
  const weekend = isWeekend(date);

  if (status === "on_time" || status === "present") return "present";
  if (status === "late") return "late";
  if (status === "absent") return weekend && withinConfiguredPeriod ? "weekend" : withinConfiguredPeriod ? "absent" : "blank";

  if (!withinConfiguredPeriod) return "blank";
  if (weekend) return "weekend";
  return "absent";
}

export default function LogbookPage() {
  const { toast } = useToast();
  const { user, hasPermission, hasAnyPermission } = useAuth();

  const canViewOwn = hasAnyPermission("staff_attendance.view_own", "logbook.view");
  const canViewAll = hasPermission("staff_attendance.view_all");
  const canViewOverview = hasAnyPermission("staff_attendance.view_overview", "staff_attendance.view_all");
  const canViewLogs = hasAnyPermission("staff_attendance.view_logs", "staff_attendance.view_own", "staff_attendance.view_all", "logbook.view");
  const canClockIn = hasAnyPermission("staff_attendance.clock_in", "logbook.view");
  const canClockOut = hasAnyPermission("staff_attendance.clock_out", "logbook.view");

  const [activeTab, setActiveTab] = useState(canViewOverview ? "attendance" : "logbook");
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "granted" | "denied">("idle");
  const [lastLocation, setLastLocation] = useState<{ latitude: number; longitude: number; accuracy: number; attemptCount: number } | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("all");
  const [selectedFocus, setSelectedFocus] = useState<SelectedAttendanceFocus | null>(null);
  const [adminReasonTarget, setAdminReasonTarget] = useState<StaffAttendanceLog | null>(null);
  const [adminReason, setAdminReason] = useState("");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return toLocalIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    return toLocalIsoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  });

  useEffect(() => {
    if (!canViewOverview && activeTab === "attendance") {
      setActiveTab("logbook");
    }
  }, [canViewOverview, activeTab]);

  const selectedStaffIdNumber = selectedStaffId === "all" ? undefined : parseInt(selectedStaffId, 10);

  useEffect(() => {
    if (!selectedFocus) return;
    if (selectedStaffIdNumber && selectedFocus.staffId !== selectedStaffIdNumber) {
      setSelectedFocus(null);
    }
  }, [selectedStaffIdNumber, selectedFocus]);

  const { data: currentSchool } = useQuery<School>({
    queryKey: ["/api/schools/current"],
    enabled: hasAnyPermission(...ATTENDANCE_PAGE_PERMISSIONS),
  });

  const { data: todayLog, isLoading: todayLoading } = useQuery<StaffAttendanceLog | null>({
    queryKey: ["/api/staff-attendance/today"],
    enabled: canViewOwn || canClockIn || canClockOut,
  });

  const { data: gridData, isLoading: gridLoading } = useQuery<StaffGridData>({
    queryKey: [`/api/staff-attendance/grid?dateFrom=${dateFrom}&dateTo=${dateTo}${selectedStaffIdNumber ? `&staffId=${selectedStaffIdNumber}` : ""}`],
    enabled: canViewOverview,
  });

  const scheduleForDate = (date: string) => gridData?.schedules?.[date] || null;

  const { data: logs = [], isLoading: logsLoading } = useQuery<StaffAttendanceLog[]>({
    queryKey: [`/api/staff-attendance?dateFrom=${dateFrom}&dateTo=${dateTo}${selectedStaffIdNumber ? `&staffId=${selectedStaffIdNumber}` : ""}`],
    enabled: canViewLogs,
  });

  const { data: adminAllLogs = [] } = useQuery<StaffAttendanceLog[]>({
    queryKey: ["/api/staff-attendance"],
    enabled: canViewOverview || canViewAll,
  });

  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
    enabled: canViewAll,
  });

  const fetchLocation = async () => {
    setGeoStatus("loading");
    try {
      const result = await getLocationWithRetry();
      setLastLocation(result);
      setGeoStatus("granted");
      return result;
    } catch (error: any) {
      setGeoStatus("denied");
      throw new Error(error?.message || "Location access denied.");
    }
  };

  const ensureLocation = async () => {
    if (lastLocation && lastLocation.accuracy <= GPS_ACCURACY_THRESHOLD_METERS) {
      return lastLocation;
    }
    return fetchLocation();
  };

  const clockIn = useMutation({
    mutationFn: async () => {
      const location = await ensureLocation();
      return apiRequest("POST", "/api/staff-attendance/clock-in", {
        latitude: location.latitude.toString(),
        longitude: location.longitude.toString(),
        accuracy: Math.round(location.accuracy),
        attemptCount: location.attemptCount,
        deviceToken: getOrCreateAttendanceDeviceToken(),
        deviceSignature: buildDeviceSignature(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/staff-attendance") });
      toast({ title: "Clocked in successfully" });
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to clock in", variant: "destructive" });
    },
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      const location = await ensureLocation();
      return apiRequest("POST", "/api/staff-attendance/clock-out", {
        latitude: location.latitude.toString(),
        longitude: location.longitude.toString(),
        accuracy: Math.round(location.accuracy),
        attemptCount: location.attemptCount,
        deviceToken: getOrCreateAttendanceDeviceToken(),
        deviceSignature: buildDeviceSignature(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/staff-attendance") });
      toast({ title: "Clocked out successfully" });
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to clock out", variant: "destructive" });
    },
  });

  const adminReasonMutation = useMutation({
    mutationFn: async () => {
      if (!adminReasonTarget) throw new Error("Attendance record not selected");
      const res = await apiRequest("POST", `/api/staff-attendance/${adminReasonTarget.id}/admin-submit-reason`, { reason: adminReason.trim() });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/staff-attendance") });
      toast({ title: "Reason saved", description: "The attendance review item has been resolved and audited." });
      setAdminReasonTarget(null);
      setAdminReason("");
    },
    onError: (error: any) => toast({ title: error?.message || "Failed to save reason", variant: "destructive" }),
  });

  useEffect(() => {
    if (!(canClockIn || canClockOut || canViewOwn)) return;
    fetchLocation().catch((error: any) => {
      toast({ title: error?.message || "Unable to get location", variant: "destructive" });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canClockIn, canClockOut, canViewOwn]);

  const todayDate = useMemo(() => toLocalIsoDate(new Date()), []);

  const getStaffName = (log: StaffAttendanceLog) => {
    const staffMember = staffList.find((staff) => staff.id === log.staffId);
    return staffMember ? `${staffMember.firstName} ${staffMember.lastName}` : `Staff #${log.staffId}`;
  };

  const filterableStaff = useMemo(() => {
    if (!canViewAll) return [] as Array<{ id: number; name: string }>;
    if (staffList.length > 0) {
      return staffList.map((staff) => ({ id: staff.id, name: `${staff.firstName} ${staff.lastName}`.trim() }));
    }

    const map = new Map<number, string>();
    gridData?.staff.forEach((staffMember) => map.set(staffMember.id, staffMember.name));
    adminAllLogs.forEach((log) => {
      if (!map.has(log.staffId)) map.set(log.staffId, `Staff #${log.staffId}`);
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [canViewAll, staffList, gridData, adminAllLogs]);

  const getStaffNameById = (staffId: number) => {
    const fromList = filterableStaff.find((staffMember) => staffMember.id === staffId)?.name;
    if (fromList) return fromList;
    const fromGrid = gridData?.staff.find((staffMember) => staffMember.id === staffId)?.name;
    if (fromGrid) return fromGrid;
    const fromLogs = (canViewAll ? adminAllLogs : logs).find((log) => log.staffId === staffId);
    if (fromLogs) return getStaffName(fromLogs);
    return `Staff #${staffId}`;
  };

  const firstClockInByStaff = useMemo<Record<number, string | null>>(() => {
    const map: Record<number, string | null> = {};
    const sourceLogs = canViewAll || canViewOverview ? adminAllLogs : logs;
    for (const log of sourceLogs) {
      if (!log.clockIn) continue;
      if (!map[log.staffId] || log.date < map[log.staffId]!) {
        map[log.staffId] = log.date;
      }
    }
    return map;
  }, [adminAllLogs, logs, canViewAll, canViewOverview]);

  const staffTotals = useMemo<Record<number, AttendanceTotals>>(() => {
    if (!gridData) return {};
    return Object.fromEntries(
      gridData.staff.map((staffMember) => {
        const totals = gridData.dates.reduce<AttendanceTotals>((acc, date) => {
          const status = getOverviewStatus(staffMember.statuses[date], date, todayDate, firstClockInByStaff[staffMember.id], currentSchool);
          if (status === "present") acc.present += 1;
          if (status === "late") {
            acc.present += 1;
            acc.late += 1;
          }
          if (status === "absent") acc.absent += 1;
          return acc;
        }, { present: 0, absent: 0, late: 0, excused: 0 });
        return [staffMember.id, totals];
      })
    );
  }, [gridData, todayDate, firstClockInByStaff, currentSchool]);

  const defaultSortedLogs = useMemo(() => {
    return [...logs].sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      const aTime = a.clockIn ? new Date(a.clockIn).getTime() : 0;
      const bTime = b.clockIn ? new Date(b.clockIn).getTime() : 0;
      return bTime - aTime;
    });
  }, [logs]);

  const { sortedData: sortedLogs, sortConfig: logsSortConfig, requestSort: requestLogsSort } = useTableSort(defaultSortedLogs);
  const safeSortedLogs = sortedLogs ?? [];

  const activeLogsSource = canViewAll || canViewOverview ? adminAllLogs : logs;

  const attendanceStripState = useMemo<AttendanceStripState>(() => {
    if (selectedFocus) {
      const log = activeLogsSource.find((entry) => entry.staffId === selectedFocus.staffId && entry.date === selectedFocus.date) ?? null;
      const status = getOverviewStatus(log?.status, selectedFocus.date, todayDate, firstClockInByStaff[selectedFocus.staffId], currentSchool);
      if (status === "weekend") {
        return { mode: "weekend", staffName: selectedFocus.staffName, date: selectedFocus.date, log, message: "Weekend / non-compulsory workday" };
      }
      if (status === "absent") {
        return { mode: "absent", staffName: selectedFocus.staffName, date: selectedFocus.date, log, message: "No clock-in recorded" };
      }
      return { mode: "record", staffName: selectedFocus.staffName, date: selectedFocus.date, log };
    }

    if (selectedStaffIdNumber) {
      const log = activeLogsSource.find((entry) => entry.staffId === selectedStaffIdNumber && entry.date === todayDate) ?? null;
      const staffName = getStaffNameById(selectedStaffIdNumber);
      if (!log) {
        return { mode: "neutral", message: `${staffName} — no attendance record for today yet.` };
      }
      return { mode: "record", staffName, date: todayDate, log };
    }

    if (canViewAll || canViewOverview) {
      return { mode: "neutral", message: "Select a staff member and a day to view attendance details." };
    }

    if (user) {
      if (!todayLog) {
        return { mode: "neutral", message: "No attendance record for today yet." };
      }
      return {
        mode: "record",
        staffName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        date: todayDate,
        log: todayLog,
      };
    }

    return { mode: "neutral", message: "Select a staff member and a day to view attendance details." };
  }, [selectedFocus, selectedStaffIdNumber, activeLogsSource, todayDate, firstClockInByStaff, currentSchool, canViewAll, canViewOverview, user, todayLog]);

  const handleOverviewCellClick = (staffId: number, staffName: string, date: string, status: OverviewCellState) => {
    if (status === "blank") return;
    setSelectedFocus({ staffId, staffName, date });
  };

  const clearSelectedFocus = () => setSelectedFocus(null);

  const exportAttendanceExcel = () => {
    if (!gridData) return;
    const headerRow = ["School Staff", ...gridData.dates.map(formatDateShort), "Present", "Absent", "Late", "Excused"];
    const rows = [headerRow, ...gridData.staff.map((staffMember) => {
      const totals = staffTotals[staffMember.id] || { present: 0, absent: 0, late: 0, excused: 0 };
      return [
        staffMember.name,
        ...gridData.dates.map((date) => {
          const status = getOverviewStatus(staffMember.statuses[date], date, todayDate, firstClockInByStaff[staffMember.id], currentSchool);
          if (status === "blank") return "";
          if (status === "weekend") return "Weekend";
          if (status === "present") return "Present";
          if (status === "late") return "Late";
          return "Absent";
        }),
        totals.present,
        totals.absent,
        totals.late,
        totals.excused,
      ];
    })];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Attendance Overview");
    XLSX.writeFile(wb, `Staff_Attendance_Overview_${dateFrom}_to_${dateTo}.xlsx`);
  };

  const isClockOutBeforeExpected = (log: StaffAttendanceLog) => {
    if (!log.clockOut) return false;
    const end = expectedEnd(log.date, scheduleForDate(log.date));
    if (!end) return false;
    const actual = new Date(log.clockOut);
    const reference = new Date(actual);
    reference.setHours(end.hour, end.minute, 0, 0);
    return actual.getTime() < reference.getTime();
  };

  const getClockOutDifferenceLabel = (log: StaffAttendanceLog) => {
    const end = expectedEnd(log.date, scheduleForDate(log.date));
    if (!log.clockOut) return "";
    if (!end) return "Open";
    return formatTimeDifference(log.clockOut, end.hour, end.minute);
  };

  const exportLogsExcel = () => {
    const headerRow = ["ID", "Date", "School Staff", "Clock In", "Clock-in Time Dif", "Clock Out", "Clock-out Time Dif", "Status", "Auto Clocked Out", "Note / Reason"];
    const rows = [headerRow, ...safeSortedLogs.map((log) => {
      const start = expectedStart(log.date, scheduleForDate(log.date));
      return [
        log.id,
        formatDate(log.date),
        canViewAll ? getStaffName(log) : `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
        formatTime(log.clockIn),
        formatTimeDifference(log.clockIn, start.hour, start.minute),
        formatTime(log.clockOut),
        getClockOutDifferenceLabel(log),
        log.status,
        log.autoClockedOut ? "Yes" : "No",
        log.notes || "",
      ];
    })];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Attendance Logs");
    XLSX.writeFile(wb, `Staff_Attendance_Logs_${dateFrom}_to_${dateTo}.xlsx`);
  };

  if (todayLoading && (canViewOwn || canClockIn || canClockOut)) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Clock className="h-8 w-8" style={{ color: "#1b2a5c" }} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }}>Staff Attendance</h1>
          <p className="text-muted-foreground">Clock in, clock out, and review attendance records</p>
        </div>
      </div>

      {hasAnyPermission(...ATTENDANCE_PAGE_PERMISSIONS) && (
        <Card data-testid="card-clock-actions">
          <CardContent className="pt-4 pb-4 space-y-4">
            {(canViewOwn || canClockIn || canClockOut) && (
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {geoStatus === "granted" && lastLocation ? (
                    <span data-testid="text-location-status">
                      Location acquired ({lastLocation.latitude.toFixed(4)}, {lastLocation.longitude.toFixed(4)}) · accuracy {Math.round(lastLocation.accuracy)}m · attempts {lastLocation.attemptCount}
                    </span>
                  ) : geoStatus === "loading" ? (
                    <span data-testid="text-location-status">Acquiring accurate location...</span>
                  ) : geoStatus === "denied" ? (
                    <span className="text-destructive" data-testid="text-location-status">Location denied/weak - <button className="underline" onClick={() => fetchLocation().catch((error: any) => toast({ title: error?.message || "Unable to get location", variant: "destructive" }))}>retry</button></span>
                  ) : (
                    <span data-testid="text-location-status">Location not requested</span>
                  )}
                </div>
                <div className="flex-1" />
                {!todayLog ? (
                  canClockIn ? (
                    <Button onClick={() => clockIn.mutate()} disabled={clockIn.isPending} data-testid="button-clock-in">
                      <LogIn className="h-4 w-4 mr-2" />
                      {clockIn.isPending ? "Clocking In..." : "Clock In"}
                    </Button>
                  ) : null
                ) : !todayLog.clockOut ? (
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-sm" data-testid="text-clock-in-time">
                      <span className="text-muted-foreground">Clocked in at:</span> <span className="font-medium">{formatTime(todayLog.clockIn)}</span>{" "}
                      {todayLog.status === "late" ? (
                        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400"><AlertTriangle className="h-3 w-3 mr-1" />Late</Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400"><CheckCircle2 className="h-3 w-3 mr-1" />On Time</Badge>
                      )}
                    </div>
                    {canClockOut && (
                      <Button variant="destructive" onClick={() => clockOut.mutate()} disabled={clockOut.isPending} data-testid="button-clock-out">
                        <LogOut className="h-4 w-4 mr-2" />
                        {clockOut.isPending ? "Clocking Out..." : "Clock Out"}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-4 flex-wrap" data-testid="text-attendance-complete">
                    <div className="text-sm">
                      <span className="text-muted-foreground">In:</span> <span className="font-medium">{formatTime(todayLog.clockIn)}</span>
                      {" | "}
                      <span className="text-muted-foreground">Out:</span> <span className="font-medium">{formatTime(todayLog.clockOut)}</span>
                      {" | "}
                      <span className="text-muted-foreground">Duration:</span> <span className="font-medium">{calculateDuration(todayLog.clockIn, todayLog.clockOut)}</span>
                    </div>
                    {todayLog.autoClockedOut ? (
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"><ShieldAlert className="h-3 w-3 mr-1" />Auto Clocked Out</Badge>
                    ) : todayLog.status === "late" ? (
                      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400"><AlertTriangle className="h-3 w-3 mr-1" />Late</Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400"><CheckCircle2 className="h-3 w-3 mr-1" />On Time</Badge>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-lg border bg-muted/20 px-4 py-3" data-testid="card-selected-attendance-strip">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {selectedFocus ? `Viewing: ${formatDate(selectedFocus.date)}` : selectedStaffIdNumber ? `Today: ${formatDate(todayDate)}` : "Attendance Details"}
                  </div>
                  {attendanceStripState.staffName && <div className="text-sm font-semibold">{attendanceStripState.staffName}</div>}
                  {attendanceStripState.mode === "neutral" ? (
                    <p className="text-sm text-muted-foreground">{attendanceStripState.message}</p>
                  ) : attendanceStripState.mode === "weekend" ? (
                    <div className="text-sm text-muted-foreground">{attendanceStripState.message}</div>
                  ) : attendanceStripState.mode === "absent" ? (
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">Absent</Badge>
                      <span className="text-muted-foreground">{attendanceStripState.message}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 flex-wrap text-sm">
                      <span><span className="text-muted-foreground">In:</span> <span className="font-medium">{formatTime(attendanceStripState.log?.clockIn ?? null)}</span></span>
                      <span><span className="text-muted-foreground">Out:</span> <span className="font-medium">{formatTime(attendanceStripState.log?.clockOut ?? null)}</span></span>
                      <span><span className="text-muted-foreground">Duration:</span> <span className="font-medium">{calculateDuration(attendanceStripState.log?.clockIn ?? null, attendanceStripState.log?.clockOut ?? null)}</span></span>
                      {attendanceStripState.log?.autoClockedOut ? (
                        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"><ShieldAlert className="h-3 w-3 mr-1" />Auto Clocked Out</Badge>
                      ) : attendanceStripState.log?.status === "late" ? (
                        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400"><AlertTriangle className="h-3 w-3 mr-1" />Late</Badge>
                      ) : attendanceStripState.log ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400"><CheckCircle2 className="h-3 w-3 mr-1" />On Time</Badge>
                      ) : null}
                      {attendanceStripState.log?.notes ? <span className="text-muted-foreground">Reason: {attendanceStripState.log.notes}</span> : null}
                      {attendanceStripState.log?.source ? <Badge variant="outline">Source: {attendanceStripState.log.source}</Badge> : null}
                      {attendanceStripState.log?.firstGateEntryAt ? <span><span className="text-muted-foreground">First Gate Entry:</span> <span className="font-medium">{formatTime(attendanceStripState.log.firstGateEntryAt)}</span></span> : null}
                      {attendanceStripState.log?.lastGateExitAt ? <span><span className="text-muted-foreground">Last Gate Exit:</span> <span className="font-medium">{formatTime(attendanceStripState.log.lastGateExitAt)}</span></span> : null}
                      {attendanceStripState.log?.currentlyOnCampus !== null && attendanceStripState.log?.currentlyOnCampus !== undefined ? <Badge variant={attendanceStripState.log.currentlyOnCampus ? "default" : "secondary"}>{attendanceStripState.log.currentlyOnCampus ? "On Campus" : "Off Campus"}</Badge> : null}
                      {attendanceStripState.log?.missingClockOut ? <Badge variant="destructive">Review Required · Missing Clock Out</Badge> : null}
                      {attendanceStripState.log?.reasonRequired ? <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Reason Required</Badge> : null}
                      {canViewAll && attendanceStripState.log?.reasonRequired ? <Button size="sm" variant="outline" onClick={() => { setAdminReasonTarget(attendanceStripState.log || null); setAdminReason(""); }}>Capture Reason</Button> : null}
                    </div>
                  )}
                </div>
                {selectedFocus && (
                  <Button variant="outline" size="sm" onClick={clearSelectedFocus} data-testid="button-back-to-today">Back to Today</Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList>
            {canViewOverview && (
              <TabsTrigger value="attendance" data-testid="tab-staff-attendance-overview">
                <Calendar className="h-4 w-4 mr-2" />
                Staff Attendance Overview
              </TabsTrigger>
            )}
            {canViewLogs && (
              <TabsTrigger value="logbook" data-testid="tab-staff-attendance-logs">
                <Clock className="h-4 w-4 mr-2" />
                Staff Attendance Logs
              </TabsTrigger>
            )}
          </TabsList>

          <div className="flex items-center gap-2 flex-wrap">
            {((activeTab === "attendance" && canViewOverview) || (activeTab !== "attendance" && canViewLogs)) && (
              <Button variant="outline" onClick={activeTab === "attendance" ? exportAttendanceExcel : exportLogsExcel} data-testid="button-download">
                <Download className="h-4 w-4 mr-2" />Download
              </Button>
            )}
            {canViewAll && (
              <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                <SelectTrigger className="w-[220px]" data-testid="select-staff-filter">
                  <SelectValue placeholder="All staff members" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All staff members</SelectItem>
                  {filterableStaff.map((staffMember) => (
                    <SelectItem key={staffMember.id} value={String(staffMember.id)}>{staffMember.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[150px]" data-testid="input-date-from" />
            <span className="text-muted-foreground text-sm">to</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[150px]" data-testid="input-date-to" />
          </div>
        </div>

        {canViewOverview && (
          <TabsContent value="attendance" className="mt-4">
            {gridLoading ? (
              <Card><CardContent className="p-4 space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>
            ) : gridData && gridData.staff.length > 0 ? (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[980px]" data-testid="table-staff-attendance-grid">
                      <thead>
                        <tr className="border-b">
                          <th className="sticky left-0 bg-card z-10 px-3 py-2 text-left font-semibold text-sm min-w-[180px]">Staff</th>
                          {gridData.dates.map((date) => {
                            const weekendColumn = isWeekend(date);
                            const selectedColumn = selectedFocus?.date === date;
                            return (
                              <th
                                key={date}
                                className={`px-0.5 py-2 text-center font-medium whitespace-nowrap min-w-[38px] ${weekendColumn ? "bg-slate-100 dark:bg-slate-800/70" : ""} ${selectedColumn ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}
                              >
                                <div className={`text-[10px] leading-tight ${selectedColumn ? "font-semibold text-blue-700 dark:text-blue-300" : ""}`}>{formatDateShort(date)}</div>
                              </th>
                            );
                          })}
                          <th className="px-3 py-2 text-left font-semibold text-sm min-w-[170px]">Totals</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gridData.staff.map((staffMember) => {
                          const totals = staffTotals[staffMember.id] || { present: 0, absent: 0, late: 0, excused: 0 };
                          return (
                            <tr key={staffMember.id} className="border-b last:border-b-0">
                              <td className="sticky left-0 bg-card z-10 px-3 py-2 font-medium text-sm whitespace-nowrap">{staffMember.name}</td>
                              {gridData.dates.map((date) => {
                                const status = getOverviewStatus(staffMember.statuses[date], date, todayDate, firstClockInByStaff[staffMember.id], currentSchool);
                                const attendanceRecord = staffMember.records?.[date];
                                const gateBacked = Boolean(attendanceRecord && (attendanceRecord.firstGateEntryAt || attendanceRecord.lastGateExitAt || String(attendanceRecord.source || "").includes("gate")));
                                const weekendColumn = isWeekend(date);
                                const selectedColumn = selectedFocus?.date === date;
                                const selectedCell = selectedFocus?.date === date && selectedFocus?.staffId === staffMember.id;
                                const baseCellClass = `px-0.5 py-1.5 text-center ${weekendColumn ? "bg-slate-100 dark:bg-slate-800/70" : ""} ${selectedColumn ? "bg-blue-50 dark:bg-blue-950/20" : ""}`;
                                const interactiveClass = selectedCell ? "ring-2 ring-blue-500 ring-offset-1 ring-offset-background" : selectedColumn ? "ring-1 ring-blue-300" : "";
                                const inner = status === "present"
                                  ? <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${interactiveClass}`} title={`Present - ${date}`}><span className="w-5 h-5 rounded-[4px] bg-green-500" /></span>
                                  : status === "late"
                                  ? <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${interactiveClass}`} title={`Late - ${date}`}><span className="w-5 h-5 rounded-[4px] bg-yellow-400" /></span>
                                  : status === "absent"
                                  ? <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${interactiveClass}`} title={`Absent - ${date}`}><span className="w-5 h-5 rounded-[4px] bg-red-500" /></span>
                                  : <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${interactiveClass}`} title={`Weekend - ${date}`} />;

                                if (status === "blank") {
                                  return <td key={date} className={baseCellClass}><span className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${interactiveClass}`} title={`Blank - ${date}`} /></td>;
                                }

                                return (
                                  <td key={date} className={baseCellClass}>
                                    <button
                                      type="button"
                                      onClick={() => handleOverviewCellClick(staffMember.id, staffMember.name, date, status)}
                                      className="inline-flex items-center justify-center rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      data-testid={`button-overview-cell-${staffMember.id}-${date}`}
                                    >
                                      <span className="relative inline-flex">{inner}{gateBacked && <span className="absolute -right-1 -top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background text-primary ring-1 ring-primary"><ShieldAlert className="h-2.5 w-2.5" /></span>}</span>
                                    </button>
                                  </td>
                                );
                              })}
                              <td className="px-3 py-2 text-sm font-medium whitespace-nowrap">P:{totals.present} A:{totals.absent} L:{totals.late} E:{totals.excused}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card><CardContent className="py-12 text-center"><Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" /><h3 className="font-semibold text-lg mb-2">No Staff Attendance Data</h3><p className="text-muted-foreground">No staff attendance records found for the selected date range.</p></CardContent></Card>
            )}
          </TabsContent>
        )}

        {canViewLogs && (
          <TabsContent value="logbook" className="mt-4">
            <Card data-testid="card-logbook-table">
              <CardContent className="p-0">
                {logsLoading ? (
                  <div className="p-4 space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : safeSortedLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12"><Clock className="h-12 w-12 text-muted-foreground mb-4" /><h3 className="text-lg font-semibold mb-2">No Attendance Records</h3><p className="text-muted-foreground">No records found for the selected date range</p></div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-blue-50/50 dark:bg-blue-950/20">
                          <SortableTableHead sortKey="date" sortConfig={logsSortConfig} onSort={requestLogsSort} className="font-bold text-xs uppercase tracking-wider">Date</SortableTableHead>
                          <SortableTableHead sortKey="staffId" sortConfig={logsSortConfig} onSort={requestLogsSort} className="font-bold text-xs uppercase tracking-wider">School Staff</SortableTableHead>
                          <SortableTableHead sortKey="clockIn" sortConfig={logsSortConfig} onSort={requestLogsSort} className="font-bold text-xs uppercase tracking-wider">Clock In</SortableTableHead>
                          <TableHead className="font-bold text-xs uppercase tracking-wider">Clock-in Time Dif</TableHead>
                          <SortableTableHead sortKey="clockOut" sortConfig={logsSortConfig} onSort={requestLogsSort} className="font-bold text-xs uppercase tracking-wider">Clock Out</SortableTableHead>
                          <TableHead className="font-bold text-xs uppercase tracking-wider">Clock-out Time Dif</TableHead>
                          <TableHead className="font-bold text-xs uppercase tracking-wider">Gate Evidence</TableHead>
                          <TableHead className="font-bold text-xs uppercase tracking-wider">Campus / Review</TableHead>
                        <TableHead className="font-bold text-xs uppercase tracking-wider">Note / Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {safeSortedLogs.map((log) => {
                          const start = expectedStart(log.date, scheduleForDate(log.date));
                          const clockInDiff = formatTimeDifference(log.clockIn, start.hour, start.minute);
                          const clockOutDiff = getClockOutDifferenceLabel(log);
                          const weekend = isWeekend(log.date);
                          return (
                            <TableRow key={log.id} className="border-b" data-testid={`row-logbook-${log.id}`}>
                              <TableCell className="text-sm font-medium">{formatDate(log.date)}</TableCell>
                              <TableCell className="text-sm">{canViewAll ? getStaffName(log) : `${user?.firstName || ""} ${user?.lastName || ""}`.trim()}</TableCell>
                              <TableCell className="text-sm">
                                {log.clockIn ? <div className="flex items-center gap-2"><span className={`inline-block w-3 h-3 rounded-sm ${log.status === "late" ? "bg-yellow-400" : "bg-green-500"}`} />{formatTime(log.clockIn)}</div> : <span className="text-muted-foreground text-xs">-</span>}
                              </TableCell>
                              <TableCell>{clockInDiff ? <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${log.status === "late" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300" : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"}`}>{clockInDiff}</span> : null}</TableCell>
                              <TableCell className="text-sm">
                                {log.clockOut ? (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span>{formatTime(log.clockOut)}</span>
                                    {log.autoClockedOut && <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Auto Clocked Out</Badge>}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-xs">Not clocked</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {clockOutDiff ? (
                                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${weekend ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200" : isClockOutBeforeExpected(log) ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300" : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"}`}>
                                    {clockOutDiff}
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-xs">
                                {log.firstGateEntryAt || log.lastGateExitAt ? (
                                  <div className="space-y-1">
                                    {log.firstGateEntryAt ? <div>Entry {formatTime(log.firstGateEntryAt)}</div> : null}
                                    {log.lastGateExitAt ? <div>Exit {formatTime(log.lastGateExitAt)}</div> : null}
                                    <Badge variant="outline">{log.source || "gate"}</Badge>
                                  </div>
                                ) : <span className="text-muted-foreground">-</span>}
                              </TableCell>
                              <TableCell className="text-xs">
                                <div className="flex flex-col items-start gap-1">
                                  {log.currentlyOnCampus !== null && log.currentlyOnCampus !== undefined ? <Badge variant={log.currentlyOnCampus ? "default" : "secondary"}>{log.currentlyOnCampus ? "On Campus" : "Off Campus"}</Badge> : null}
                                  {log.missingClockOut ? <Badge variant="destructive">Missing Clock Out</Badge> : null}
                                  {log.reasonRequired ? <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Reason Required</Badge> : null}
                                  {canViewAll && log.reasonRequired ? <Button size="sm" variant="outline" onClick={() => { setAdminReasonTarget(log); setAdminReason(""); }}>Capture Reason</Button> : null}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm">{log.notes || <span className="text-muted-foreground text-xs">-</span>}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={Boolean(adminReasonTarget)} onOpenChange={(open) => { if (!open) { setAdminReasonTarget(null); setAdminReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Capture Attendance Reason</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {adminReasonTarget?.reasonType === "early_clock_out" ? "Record the reason for this staff member's early final departure." : "Record the reason for this staff member's late arrival."}
            </div>
            <Textarea value={adminReason} onChange={(event) => setAdminReason(event.target.value)} placeholder="Mandatory reason" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setAdminReasonTarget(null); setAdminReason(""); }}>Cancel</Button>
              <Button disabled={adminReason.trim().length < 3 || adminReasonMutation.isPending} onClick={() => adminReasonMutation.mutate()}>Save Reason</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
