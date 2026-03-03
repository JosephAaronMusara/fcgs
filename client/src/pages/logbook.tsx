import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock, LogIn, LogOut, MapPin, AlertTriangle, CheckCircle2, XCircle, Download, Calendar } from "lucide-react";
import * as XLSX from "xlsx";
import type { StaffAttendanceLog, Staff } from "@shared/schema";

function formatTime(dateStr: string | Date | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatTimeDiff(clockIn: string | Date | null, referenceHour: number, referenceMinute: number): string {
  if (!clockIn) return "-";
  const d = new Date(clockIn);
  const ref = new Date(d);
  ref.setHours(referenceHour, referenceMinute, 0, 0);
  const diffMs = d.getTime() - ref.getTime();
  const totalMin = Math.abs(Math.floor(diffMs / 60000));
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return `${hrs}Hrs ${mins}min(s)`;
}

function formatClockOutDiff(clockOut: string | Date | null, expectedHour: number, expectedMinute: number): string {
  if (!clockOut) return "";
  const d = new Date(clockOut);
  const ref = new Date(d);
  ref.setHours(expectedHour, expectedMinute, 0, 0);
  const diffMs = d.getTime() - ref.getTime();
  const totalMin = Math.abs(Math.floor(diffMs / 60000));
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return `${hrs}Hrs ${mins}min(s)`;
}

function calculateDuration(clockIn: string | Date | null, clockOut: string | Date | null): string {
  if (!clockIn || !clockOut) return "-";
  const diff = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  return day === 0 || day === 6;
}

interface StaffGridData {
  dates: string[];
  staff: Array<{
    id: number;
    name: string;
    statuses: Record<string, string>;
  }>;
}

export default function LogbookPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "org_admin" || user?.role === "school_admin";
  const [activeTab, setActiveTab] = useState("attendance");

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "granted" | "denied">("idle");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const { data: todayLog, isLoading: todayLoading } = useQuery<StaffAttendanceLog | null>({
    queryKey: ["/api/staff-attendance/today"],
  });

  const { data: gridData, isLoading: gridLoading } = useQuery<StaffGridData>({
    queryKey: [`/api/staff-attendance/grid?dateFrom=${dateFrom}&dateTo=${dateTo}`],
    enabled: isAdmin,
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<StaffAttendanceLog[]>({
    queryKey: [`/api/staff-attendance?dateFrom=${dateFrom}&dateTo=${dateTo}`],
    enabled: activeTab === "logbook",
  });

  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
    enabled: isAdmin,
  });

  const requestLocation = () => {
    setGeoStatus("loading");
    if (!navigator.geolocation) {
      setGeoStatus("denied");
      toast({ title: "Geolocation not supported", description: "Your browser does not support geolocation.", variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setGeoStatus("granted");
      },
      () => {
        setGeoStatus("denied");
        toast({ title: "Location access denied", description: "Please enable location access to clock in.", variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const clockIn = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/staff-attendance/clock-in", {
        latitude: coords?.latitude?.toString() || null,
        longitude: coords?.longitude?.toString() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/staff-attendance") });
      toast({ title: "Clocked in successfully" });
    },
    onError: async (error: any) => {
      let message = "Failed to clock in";
      try { if (error.message) message = error.message; } catch {}
      toast({ title: message, variant: "destructive" });
    },
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/staff-attendance/clock-out", {
        latitude: coords?.latitude?.toString() || null,
        longitude: coords?.longitude?.toString() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/staff-attendance") });
      toast({ title: "Clocked out successfully" });
    },
    onError: async (error: any) => {
      let message = "Failed to clock out";
      try { if (error.message) message = error.message; } catch {}
      toast({ title: message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (geoStatus === "idle") {
      requestLocation();
    }
  }, []);

  const handleClockIn = () => {
    if (geoStatus !== "granted" || !coords) {
      toast({ title: "Location required", description: "Please allow location access before clocking in.", variant: "destructive" });
      requestLocation();
      return;
    }
    clockIn.mutate();
  };

  const handleClockOut = () => {
    if (geoStatus !== "granted" || !coords) {
      toast({ title: "Location required", description: "Please allow location access before clocking out.", variant: "destructive" });
      requestLocation();
      return;
    }
    clockOut.mutate();
  };

  const getStaffName = (log: StaffAttendanceLog) => {
    const s = staffList.find(st => st.id === log.staffId);
    return s ? `${s.firstName} ${s.lastName}` : `Staff #${log.staffId}`;
  };

  const formatDateDDMMYYYY = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const formatTimeHHMMSS = (dateStr: string | Date | null): string => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  };

  const exportAttendanceExcel = () => {
    if (!gridData) return;
    const dateHeaders = gridData.dates.map(d => {
      const dt = new Date(d + "T00:00:00");
      return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
    });
    const headerRow = ["School Staff", ...dateHeaders];
    const rows: any[][] = [headerRow];

    gridData.staff.forEach(s => {
      const row: any[] = [s.name];
      gridData.dates.forEach(d => {
        const status = s.statuses[d];
        row.push(status ? "present" : null);
      });
      rows.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance Report");

    const fromFormatted = formatDateDDMMYYYY(dateFrom).replace(/\//g, "_");
    const toFormatted = formatDateDDMMYYYY(dateTo).replace(/\//g, "_");
    XLSX.writeFile(wb, `Staff_Attendance_${fromFormatted}_${toFormatted}.xlsx`);
  };

  const exportLogBookExcel = () => {
    const headerRow = ["ID", "Date", "School Staff", "Clock In Time", "Clock Out Time", "Clock In Time Difference", "Clock Out Time Difference"];
    const rows: any[][] = [headerRow];

    (sortedLogs ?? []).forEach(log => {
      const weekend = isWeekend(log.date);
      const startHour = weekend ? 8 : 7;
      const startMinute = weekend ? 0 : 20;
      const endHour = 16;
      const endMinute = 30;

      const clockInTime = formatTimeHHMMSS(log.clockIn);
      const clockOutTime = log.clockOut ? formatTimeHHMMSS(log.clockOut) : "Not Clocked Out";
      const clockInDiff = log.clockIn ? formatTimeDiff(log.clockIn, startHour, startMinute) : "N/A";
      const clockOutDiff = log.clockOut ? formatClockOutDiff(log.clockOut, endHour, endMinute) : "N/A";

      rows.push([
        log.id,
        formatDateDDMMYYYY(log.date),
        isAdmin ? getStaffName(log) : `${user?.firstName} ${user?.lastName}`,
        clockInTime,
        clockOutTime,
        clockInDiff,
        clockOutDiff,
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet 1");

    const fromFormatted = formatDateDDMMYYYY(dateFrom).replace(/\//g, "_");
    const toFormatted = formatDateDDMMYYYY(dateTo).replace(/\//g, "_");
    XLSX.writeFile(wb, `Staff_Log_Book_(${fromFormatted}_-_${toFormatted}).xlsx`);
  };

  const handleDownload = () => {
    if (activeTab === "attendance") {
      exportAttendanceExcel();
    } else {
      exportLogBookExcel();
    }
  };

  const defaultSortedLogs = useMemo(() => {
    return [...logs].sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      if (a.clockIn && b.clockIn) {
        return new Date(b.clockIn).getTime() - new Date(a.clockIn).getTime();
      }
      return 0;
    });
  }, [logs]);

  const { sortedData: sortedLogs, sortConfig: logsSortConfig, requestSort: requestLogsSort } = useTableSort(defaultSortedLogs);

  if (todayLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Clock className="h-8 w-8" style={{ color: "#1b2a5c" }} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }}>Staff Attendance</h1>
          <p className="text-muted-foreground">Clock in, clock out, and view attendance records</p>
        </div>
      </div>
      <Card data-testid="card-clock-actions">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              {geoStatus === "granted" && coords ? (
                <span data-testid="text-location-status">Location acquired ({coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)})</span>
              ) : geoStatus === "loading" ? (
                <span data-testid="text-location-status">Acquiring location...</span>
              ) : geoStatus === "denied" ? (
                <span className="text-destructive" data-testid="text-location-status">Location denied - <button className="underline" onClick={requestLocation}>retry</button></span>
              ) : (
                <span data-testid="text-location-status">Location not requested</span>
              )}
            </div>

            <div className="flex-1" />

            {!todayLog ? (
              <Button
                onClick={handleClockIn}
                disabled={clockIn.isPending}
                data-testid="button-clock-in"
              >
                <LogIn className="h-4 w-4 mr-2" />
                {clockIn.isPending ? "Clocking In..." : "Clock In"}
              </Button>
            ) : !todayLog.clockOut ? (
              <div className="flex items-center gap-4">
                <div className="text-sm" data-testid="text-clock-in-time">
                  <span className="text-muted-foreground">Clocked in at:</span>{" "}
                  <span className="font-medium">{formatTime(todayLog.clockIn)}</span>
                  {" "}
                  {todayLog.status === "late" ? (
                    <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400" data-testid="badge-status-late">
                      <AlertTriangle className="h-3 w-3 mr-1" />Late
                    </Badge>
                  ) : (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400" data-testid="badge-status-ontime">
                      <CheckCircle2 className="h-3 w-3 mr-1" />On Time
                    </Badge>
                  )}
                </div>
                <Button
                  variant="destructive"
                  onClick={handleClockOut}
                  disabled={clockOut.isPending}
                  data-testid="button-clock-out"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  {clockOut.isPending ? "Clocking Out..." : "Clock Out"}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-4" data-testid="text-attendance-complete">
                <div className="text-sm">
                  <span className="text-muted-foreground">In:</span> <span className="font-medium">{formatTime(todayLog.clockIn)}</span>
                  {" | "}
                  <span className="text-muted-foreground">Out:</span> <span className="font-medium">{formatTime(todayLog.clockOut)}</span>
                  {" | "}
                  <span className="text-muted-foreground">Duration:</span> <span className="font-medium">{calculateDuration(todayLog.clockIn, todayLog.clockOut)}</span>
                </div>
                {todayLog.status === "late" ? (
                  <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400">
                    <AlertTriangle className="h-3 w-3 mr-1" />Late
                  </Badge>
                ) : todayLog.status === "absent" ? (
                  <Badge variant="destructive">
                    <XCircle className="h-3 w-3 mr-1" />Absent
                  </Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400">
                    <CheckCircle2 className="h-3 w-3 mr-1" />On Time
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList>
            <TabsTrigger value="attendance" data-testid="tab-staff-attendance">
              <Calendar className="h-4 w-4 mr-2" />
              Staff Attendance
            </TabsTrigger>
            <TabsTrigger value="logbook" data-testid="tab-log-book">
              <Clock className="h-4 w-4 mr-2" />
              Log Book
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={handleDownload} data-testid="button-download">
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[150px]"
              data-testid="input-date-from"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[150px]"
              data-testid="input-date-to"
            />
          </div>
        </div>

        <TabsContent value="attendance" className="mt-4">
          {gridLoading ? (
            <Card>
              <CardContent className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </CardContent>
            </Card>
          ) : gridData && gridData.staff.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[800px]" data-testid="table-staff-attendance-grid">
                    <thead>
                      <tr className="border-b">
                        <th className="sticky left-0 bg-card z-10 px-3 py-2 text-left font-semibold text-sm min-w-[140px]">Staff</th>
                        {gridData.dates.map(date => {
                          const d = new Date(date + "T00:00:00");
                          const dayNum = d.toLocaleDateString("en", { day: "2-digit" });
                          const monthNum = d.toLocaleDateString("en", { month: "2-digit" });
                          const weekend = isWeekend(date);
                          return (
                            <th key={date} className={`px-0.5 py-2 text-center font-medium whitespace-nowrap min-w-[38px] ${weekend ? "bg-muted/30" : ""}`}>
                              <div className="text-[10px] leading-tight">{dayNum}/{monthNum}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {gridData.staff.map((staffMember) => (
                        <tr key={staffMember.id} className="border-b last:border-b-0">
                          <td className="sticky left-0 bg-card z-10 px-3 py-2 font-medium text-sm whitespace-nowrap">
                            {staffMember.name}
                          </td>
                          {gridData.dates.map(date => {
                            const status = staffMember.statuses[date];
                            const weekend = isWeekend(date);

                            if (!status && weekend) {
                              return (
                                <td key={date} className="px-0.5 py-1.5 text-center bg-muted/30">
                                  <span className="inline-block w-7 h-7" />
                                </td>
                              );
                            }

                            if (!status) {
                              return (
                                <td key={date} className="px-0.5 py-1.5 text-center">
                                  <span
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-red-500"
                                    title={`Absent - ${date}`}
                                    data-testid={`cell-absent-${staffMember.id}-${date}`}
                                  />
                                </td>
                              );
                            }

                            if (status === "on_time") {
                              return (
                                <td key={date} className={`px-0.5 py-1.5 text-center ${weekend ? "bg-muted/30" : ""}`}>
                                  <span
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-green-500"
                                    title={`On Time - ${date}`}
                                    data-testid={`cell-ontime-${staffMember.id}-${date}`}
                                  />
                                </td>
                              );
                            }

                            if (status === "late") {
                              return (
                                <td key={date} className={`px-0.5 py-1.5 text-center ${weekend ? "bg-muted/30" : ""}`}>
                                  <span
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-yellow-400"
                                    title={`Late - ${date}`}
                                    data-testid={`cell-late-${staffMember.id}-${date}`}
                                  />
                                </td>
                              );
                            }

                            return (
                              <td key={date} className={`px-0.5 py-1.5 text-center ${weekend ? "bg-muted/30" : ""}`}>
                                <span
                                  className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-red-500"
                                  title={`${status} - ${date}`}
                                  data-testid={`cell-status-${staffMember.id}-${date}`}
                                />
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
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold text-lg mb-2" data-testid="text-no-grid-data">No Staff Attendance Data</h3>
                <p className="text-muted-foreground">
                  No staff attendance records found for the selected date range.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="logbook" className="mt-4">
          <Card data-testid="card-logbook-table">
            <CardContent className="p-0">
              {logsLoading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : (sortedLogs ?? []).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2" data-testid="text-no-records">No Attendance Records</h3>
                  <p className="text-muted-foreground">No records found for the selected date range</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50/50 dark:bg-blue-950/20">
                        <SortableTableHead sortKey="date" sortConfig={logsSortConfig} onSort={requestLogsSort} className="font-bold text-xs uppercase tracking-wider">Date</SortableTableHead>
                        <SortableTableHead sortKey="staffId" sortConfig={logsSortConfig} onSort={requestLogsSort} className="font-bold text-xs uppercase tracking-wider">School Staff</SortableTableHead>
                        <SortableTableHead sortKey="clockIn" sortConfig={logsSortConfig} onSort={requestLogsSort} className="font-bold text-xs uppercase tracking-wider">Clock In</SortableTableHead>
                        <TableHead className="font-bold text-xs uppercase tracking-wider">Clock Time Dif</TableHead>
                        <SortableTableHead sortKey="clockOut" sortConfig={logsSortConfig} onSort={requestLogsSort} className="font-bold text-xs uppercase tracking-wider">Clock Out</SortableTableHead>
                        <TableHead className="font-bold text-xs uppercase tracking-wider">Clock Time Diff</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(sortedLogs ?? []).map((log) => {
                        const clockInDate = log.clockIn ? new Date(log.clockIn) : null;
                        const clockOutDate = log.clockOut ? new Date(log.clockOut) : null;
                        const weekend = isWeekend(log.date);
                        const startHour = weekend ? 8 : 7;
                        const startMinute = weekend ? 0 : 20;
                        const endHour = 16;
                        const endMinute = 30;

                        const isLate = log.status === "late";
                        const clockInDiff = clockInDate ? formatTimeDiff(log.clockIn, startHour, startMinute) : "";
                        const clockOutDiff = clockOutDate ? formatClockOutDiff(log.clockOut, endHour, endMinute) : "";

                        const dateFormatted = new Date(log.date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

                        return (
                          <TableRow key={log.id} className="border-b" data-testid={`row-logbook-${log.id}`}>
                            <TableCell className="text-sm font-medium">{dateFormatted}</TableCell>
                            <TableCell className="text-sm">{isAdmin ? getStaffName(log) : `${user?.firstName} ${user?.lastName}`}</TableCell>
                            <TableCell className="text-sm">
                              {clockInDate ? (
                                <div className="flex items-center gap-2">
                                  <span className={`inline-block w-3 h-3 rounded-sm ${isLate ? "bg-yellow-400" : "bg-green-500"}`} />
                                  {formatTime(log.clockIn)}
                                </div>
                              ) : "-"}
                            </TableCell>
                            <TableCell>
                              {clockInDiff && (
                                <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                                  isLate
                                    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
                                    : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                                }`}>
                                  {clockInDiff}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              {clockOutDate ? formatTime(log.clockOut) : (
                                <span className="text-muted-foreground text-xs">Not clocked</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {clockOutDiff && (
                                <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                                  clockOutDate && clockOutDate.getHours() < endHour
                                    ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                                    : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                                }`}>
                                  {clockOutDiff}
                                </span>
                              )}
                            </TableCell>
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
      </Tabs>
    </div>
  );
}
