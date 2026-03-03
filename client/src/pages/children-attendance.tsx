import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ClipboardCheck, CheckCircle, XCircle, Clock, TrendingUp, GraduationCap } from "lucide-react";
import { useState, useMemo } from "react";
import type { Student, AttendanceRecord } from "@shared/schema";

interface ChildAttendance {
  student: Student;
  records: AttendanceRecord[];
}

const statusBadgeVariant = (status: string) => {
  if (status === "present") return "default" as const;
  if (status === "late") return "secondary" as const;
  return "destructive" as const;
};

export default function ChildrenAttendancePage() {
  const { data, isLoading } = useQuery<ChildAttendance[]>({
    queryKey: ["/api/me/children-attendance"],
  });

  const [monthFilter, setMonthFilter] = useState<string>("all");

  const children = data || [];
  const firstChild = children.length > 0 ? children[0].student : null;
  const [activeChild, setActiveChild] = useState<string>("");

  const selectedChildId = activeChild || (firstChild ? String(firstChild.id) : "");
  const selectedChildData = children.find(c => String(c.student.id) === selectedChildId);

  const months = useMemo(() => {
    if (!selectedChildData) return [];
    const uniqueMonths = new Set<string>();
    selectedChildData.records.forEach(r => {
      const d = new Date(r.date);
      uniqueMonths.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });
    return Array.from(uniqueMonths).sort().reverse();
  }, [selectedChildData]);

  const filteredRecords = useMemo(() => {
    if (!selectedChildData) return [];
    let filtered = [...selectedChildData.records].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (monthFilter !== "all") {
      filtered = filtered.filter(r => {
        const d = new Date(r.date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === monthFilter;
      });
    }
    return filtered;
  }, [selectedChildData, monthFilter]);

  const stats = useMemo(() => {
    const total = filteredRecords.length;
    const present = filteredRecords.filter(r => r.status === "present").length;
    const absent = filteredRecords.filter(r => r.status === "absent").length;
    const late = filteredRecords.filter(r => r.status === "late").length;
    const rate = total > 0 ? Math.round((present / total) * 100) : 0;
    return { total, present, absent, late, rate };
  }, [filteredRecords]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-children-attendance-title">Children's Attendance</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <GraduationCap className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No children linked to your account.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-children-attendance-title">Children's Attendance</h1>
        <p className="text-muted-foreground">Track your children's school attendance</p>
      </div>

      {children.length > 1 && (
        <Tabs value={selectedChildId} onValueChange={setActiveChild}>
          <TabsList>
            {children.map(child => (
              <TabsTrigger key={child.student.id} value={String(child.student.id)} data-testid={`tab-child-${child.student.id}`}>
                {child.student.firstName} {child.student.lastName}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {selectedChildData && (
        <>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-4">
                <Avatar>
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {selectedChildData.student.firstName[0]}{selectedChildData.student.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">{selectedChildData.student.firstName} {selectedChildData.student.lastName}</p>
                  <p className="text-sm text-muted-foreground font-mono">{selectedChildData.student.admissionNo}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end">
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-month-filter">
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

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                  <TrendingUp className="w-4 h-4" />Rate
                </div>
                <p className="text-2xl font-bold">{stats.rate}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                  <ClipboardCheck className="w-4 h-4" />Total
                </div>
                <p className="text-2xl font-bold">{stats.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-green-600 text-sm mb-1">
                  <CheckCircle className="w-4 h-4" />Present
                </div>
                <p className="text-2xl font-bold">{stats.present}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-red-600 text-sm mb-1">
                  <XCircle className="w-4 h-4" />Absent
                </div>
                <p className="text-2xl font-bold">{stats.absent}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-amber-600 text-sm mb-1">
                  <Clock className="w-4 h-4" />Late
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
                    {filteredRecords.map(record => (
                      <TableRow key={record.id} data-testid={`row-attendance-${record.id}`}>
                        <TableCell>
                          {new Date(record.date).toLocaleDateString("en-US", {
                            weekday: "short", year: "numeric", month: "short", day: "numeric",
                          })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(record.status)}>
                            {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{record.reason || "—"}</TableCell>
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
        </>
      )}
    </div>
  );
}
