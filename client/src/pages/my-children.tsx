import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GraduationCap, Calendar, DollarSign } from "lucide-react";
import type { Student, AttendanceRecord, FeesPayment } from "@shared/schema";

export default function MyChildrenPage() {
  const { user } = useAuth();

  const { data: students, isLoading } = useQuery<Student[]>({
    queryKey: ["/api/students/by-parent", user?.id],
    enabled: !!user?.id,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-my-children-title">My Children</h1>
        <p className="text-muted-foreground">View your children's academic information</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : students && students.length > 0 ? (
        <div className="space-y-6">
          {students.map((student) => (
            <ChildCard key={student.id} student={student} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <GraduationCap className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No children linked to your account.</p>
            <p className="text-sm text-muted-foreground mt-2">Please contact the school administrator.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ChildCard({ student }: { student: Student }) {
  const { data: attendance } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/attendance/by-student", student.id],
  });

  const { data: fees } = useQuery<FeesPayment[]>({
    queryKey: ["/api/fees", { studentId: student.id }],
  });

  const presentCount = attendance?.filter((a) => a.status === "present").length || 0;
  const totalAttendance = attendance?.length || 0;
  const attendanceRate = totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : 0;

  const totalPaid = fees?.reduce((sum, f) => sum + parseFloat(f.amount), 0) || 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center font-medium text-primary text-lg">
              {student.firstName[0]}{student.lastName[0]}
            </div>
            <div>
              <CardTitle>{student.firstName} {student.lastName}</CardTitle>
              <CardDescription className="flex items-center gap-2">
                <span className="font-mono">{student.admissionNo}</span>
                <Badge variant={student.status === "active" ? "default" : "secondary"}>
                  {student.status}
                </Badge>
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <Calendar className="w-8 h-8 text-green-600" />
            <div>
              <p className="text-sm text-muted-foreground">Attendance</p>
              <p className="text-lg font-bold text-green-600">{attendanceRate}%</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <DollarSign className="w-8 h-8 text-blue-600" />
            <div>
              <p className="text-sm text-muted-foreground">Total Paid</p>
              <p className="text-lg font-bold text-blue-600">USD ${totalPaid.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {attendance && attendance.length > 0 && (
          <div className="mt-4">
            <h4 className="font-medium mb-2">Recent Attendance</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.slice(0, 5).map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>{record.date}</TableCell>
                    <TableCell>
                      <Badge
                        variant={record.status === "present" ? "default" : "secondary"}
                        className="capitalize"
                      >
                        {record.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
