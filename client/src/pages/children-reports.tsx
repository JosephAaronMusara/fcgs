import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BarChart3, Award, BookOpen, TrendingUp, GraduationCap, FileText } from "lucide-react";
import { useState, useMemo } from "react";
import type { Student } from "@shared/schema";

interface EnrichedMark {
  id: number;
  percentage: string | null;
  grade: string | null;
  comment: string | null;
  assessmentName: string;
  assessmentType: string;
  subjectName: string;
  subjectCode: string | null;
  term: string | null;
  year: string | null;
  publicationStatus?: "Published" | "Republished";
}

interface ChildGrades {
  student: Student;
  marks: EnrichedMark[];
}

export default function ChildrenReportsPage() {
  const { data, isLoading } = useQuery<ChildGrades[]>({
    queryKey: ["/api/me/children-grades"],
  });

  const [termFilter, setTermFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");

  const children = data || [];
  const firstChild = children.length > 0 ? children[0].student : null;
  const [activeChild, setActiveChild] = useState<string>("");

  const selectedChildId = activeChild || (firstChild ? String(firstChild.id) : "");
  const selectedChildData = children.find(c => String(c.student.id) === selectedChildId);

  const terms = useMemo(() => {
    if (!selectedChildData) return [];
    const unique = new Set<string>();
    selectedChildData.marks.forEach(m => {
      if (m.term && m.year) unique.add(`${m.year} - ${m.term}`);
    });
    return Array.from(unique).sort().reverse();
  }, [selectedChildData]);

  const subjects = useMemo(() => {
    if (!selectedChildData) return [];
    const unique = new Set<string>();
    selectedChildData.marks.forEach(m => unique.add(m.subjectName));
    return Array.from(unique).sort();
  }, [selectedChildData]);

  const filteredMarks = useMemo(() => {
    if (!selectedChildData) return [];
    let filtered = [...selectedChildData.marks];
    if (termFilter !== "all") {
      filtered = filtered.filter(m => `${m.year} - ${m.term}` === termFilter);
    }
    if (subjectFilter !== "all") {
      filtered = filtered.filter(m => m.subjectName === subjectFilter);
    }
    return filtered;
  }, [selectedChildData, termFilter, subjectFilter]);

  const overallAvg = useMemo(() => {
    const withPct = filteredMarks.filter(m => m.percentage);
    if (withPct.length === 0) return null;
    const avg = withPct.reduce((sum, m) => sum + parseFloat(m.percentage!), 0) / withPct.length;
    return Math.round(avg * 10) / 10;
  }, [filteredMarks]);

  const gradeColor = (grade: string | null) => {
    if (!grade) return "secondary" as const;
    if (["A*", "A", "1", "2"].includes(grade)) return "default" as const;
    if (["B", "C", "3", "4", "5"].includes(grade)) return "secondary" as const;
    return "destructive" as const;
  };

  if (isLoading) {
    return (
      <div className="p-3 sm:p-4 lg:p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-children-reports-title">Results & Reports</h1>
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
    <div className="p-3 sm:p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-children-reports-title">Results & Reports</h1>
        <p className="text-muted-foreground">Your children's academic performance</p>
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                  <FileText className="w-4 h-4" />Assessments
                </div>
                <p className="text-2xl font-bold">{filteredMarks.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                  <TrendingUp className="w-4 h-4" />Average
                </div>
                <p className="text-2xl font-bold">{overallAvg !== null ? `${overallAvg}%` : "—"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                  <BookOpen className="w-4 h-4" />Subjects
                </div>
                <p className="text-2xl font-bold">{subjects.length}</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Select value={termFilter} onValueChange={setTermFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-term-filter">
                <SelectValue placeholder="Filter by term" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Terms</SelectItem>
                {terms.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-subject-filter">
                <SelectValue placeholder="Filter by subject" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subjects</SelectItem>
                {subjects.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="w-5 h-5" />
                Grade Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filteredMarks.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>Assessment</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Percentage</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Comment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMarks.map(mark => (
                      <TableRow key={mark.id} data-testid={`row-grade-${mark.id}`}>
                        <TableCell>
                          <div>
                            <span className="font-medium">{mark.subjectName}</span>
                            {mark.subjectCode && (
                              <span className="text-muted-foreground text-xs ml-1">({mark.subjectCode})</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{mark.assessmentName}</span>
                        {mark.publicationStatus && <Badge className="bg-blue-600 text-white hover:bg-blue-600">{mark.publicationStatus}</Badge>}
                      </div>
                    </TableCell>
                        <TableCell><Badge variant="outline">{mark.assessmentType}</Badge></TableCell>
                        <TableCell className="font-mono">
                          {mark.percentage ? `${parseFloat(mark.percentage).toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell>
                          {mark.grade ? <Badge variant={gradeColor(mark.grade)}>{mark.grade}</Badge> : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[200px] truncate">
                          {mark.comment || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8">
                  <Award className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">No grade records found.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
