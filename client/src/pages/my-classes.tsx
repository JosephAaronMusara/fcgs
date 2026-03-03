import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { School, BookOpen, User } from "lucide-react";

interface MyClassesData {
  student: {
    id: number;
    firstName: string;
    lastName: string;
    admissionNo: string;
    classId: number | null;
  };
  class: {
    id: number;
    name: string;
    level?: string;
    section?: string;
  } | null;
  subjects: Array<{
    id: number;
    name: string;
    syllabusCode?: string | null;
    teacherName?: string | null;
  }>;
}

export default function MyClassesPage() {
  const { data, isLoading } = useQuery<MyClassesData>({
    queryKey: ["/api/me/classes"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-my-classes-title">My Classes</h1>
        <p className="text-muted-foreground">Your class and subject information</p>
      </div>

      {data?.class ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2">
              <School className="w-5 h-5" />
              My Class
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center">
                <School className="w-7 h-7 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-class-name">{data.class.name}</p>
                {data.class.level && (
                  <p className="text-muted-foreground">{data.class.level}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <School className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">You are not assigned to any class.</p>
            <p className="text-sm text-muted-foreground mt-2">Please contact your school administrator.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            My Subjects
            {data?.subjects && (
              <Badge variant="secondary">{data.subjects.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data?.subjects && data.subjects.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Teacher</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.subjects.map((subject, index) => (
                  <TableRow key={subject.id} data-testid={`row-subject-${subject.id}`}>
                    <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="font-medium">{subject.name}</TableCell>
                    <TableCell>
                      {subject.syllabusCode ? (
                        <Badge variant="outline">{subject.syllabusCode}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {subject.teacherName ? (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3 text-muted-foreground" />
                          {subject.teacherName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not assigned</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8">
              <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">No subjects assigned yet.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
