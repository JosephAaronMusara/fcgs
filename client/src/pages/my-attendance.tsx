import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, CheckCircle, XCircle, Clock, TrendingUp } from "lucide-react";
import { useState, useMemo } from "react";
import type { AttendanceRecord } from "@shared/schema";

const statusColors: Record<string, string> = {
  present: "text-green-600",
  absent: "text-red-600",
  late: "text-amber-600",
  sick: "text-orange-600",
  fees: "text-purple-600",
  suspended: "text-red-800",
  absconding: "text-red-900",
};

const statusBadgeVariant = (status: string) => {
  if (status === "present") return "default" as const;
  if (status === "late") return "secondary" as const;
  return "destructive" as const;
};

export default function MyAttendancePage() {
  const [monthFilter, setMonthFilter] = useState<string>("all");

  const { data: records, isLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/me/attendance"],
  });

  const months = useMemo(() => {
    if (!records) return [];
    const uniqueMonths = new Set<string>();
    records.forEach(r => {
      const d = new Date(r.date);
      uniqueMonths.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });
    return Array.from(uniqueMonths).sort().reverse();
  }, [records]);

  const filteredRecords = useMemo(() => {
    if (!records) return [];
    let filtered = [...records].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (monthFilter !== "all") {
      filtered = filtered.filter(r => {
        const d = new Date(r.date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === monthFilter;
      });
    }
    return filtered;
  }, [records, monthFilter]);

  const stats = useMemo(() => {
    const source = filteredRecords;
    const total = source.length;
    const present = source.filter(r => r.status === "present").length;
    const absent = source.filter(r => r.status === "absent").length;
    const late = source.filter(r => r.status === "late").length;
    const other = total - present - absent - late;
    const rate = total > 0 ? Math.round((present / total) * 100) : 0;
    return { total, present, absent, late, other, rate };
  }, [filteredRecords]);

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-my-attendance-title">My Attendance</h1>
          <p className="text-muted-foreground">Your attendance records</p>
        </div>
        <Select value={monthFilter} onValueChange={setMonthFilter}>
          <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-month-filter">
            <SelectValue placeholder="Filter by month" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            {months.map(m => (
              <SelectItem key={m} value={m}>
                {new Date(m + "-01").toLocaleDateString("en-US", { year: "numeric", month: "long" })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-5">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingUp className="w-4 h-4" />
              Attendance Rate
            </div>
            <p className="text-2xl font-bold" data-testid="text-attendance-rate">{stats.rate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <ClipboardCheck className="w-4 h-4" />
              Total Days
            </div>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-green-600 text-sm mb-1">
              <CheckCircle className="w-4 h-4" />
              Present
            </div>
            <p className="text-2xl font-bold">{stats.present}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-red-600 text-sm mb-1">
              <XCircle className="w-4 h-4" />
              Absent
            </div>
            <p className="text-2xl font-bold">{stats.absent}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-amber-600 text-sm mb-1">
              <Clock className="w-4 h-4" />
              Late
            </div>
            <p className="text-2xl font-bold">{stats.late}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Attendance Records</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredRecords.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => (
                  <TableRow key={record.id} data-testid={`row-attendance-${record.id}`}>
                    <TableCell>
                      {new Date(record.date).toLocaleDateString("en-US", {
                        weekday: "short",
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(record.status)}>
                        {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {record.reason || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8">
              <ClipboardCheck className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">No attendance records found.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
