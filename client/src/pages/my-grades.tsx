import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, TrendingUp, Award, BookOpen, Download } from "lucide-react";
import { useState, useMemo } from "react";

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
  examId?: number | null;
  examName?: string | null;
}

export default function MyGradesPage() {
  const [termFilter, setTermFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");

  const { data: marks, isLoading } = useQuery<EnrichedMark[]>({
    queryKey: ["/api/me/grades"],
  });
  const { data: dashboard } = useQuery<any>({ queryKey: ["/api/me/student-dashboard"] });

  const terms = useMemo(() => {
    if (!marks) return [];
    const unique = new Set<string>();
    marks.forEach(m => {
      if (m.term && m.year) unique.add(`${m.year} - ${m.term}`);
    });
    return Array.from(unique).sort().reverse();
  }, [marks]);

  const subjects = useMemo(() => {
    if (!marks) return [];
    const unique = new Set<string>();
    marks.forEach(m => unique.add(m.subjectName));
    return Array.from(unique).sort();
  }, [marks]);

  const filteredMarks = useMemo(() => {
    if (!marks) return [];
    let filtered = [...marks];
    if (termFilter !== "all") {
      filtered = filtered.filter(m => `${m.year} - ${m.term}` === termFilter);
    }
    if (subjectFilter !== "all") {
      filtered = filtered.filter(m => m.subjectName === subjectFilter);
    }
    return filtered;
  }, [marks, termFilter, subjectFilter]);

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
      <div className="space-y-6 p-4 sm:p-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-my-grades-title">My Grades</h1>
        <p className="text-muted-foreground">Your assessment results and grades</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <FileText className="w-4 h-4" />
              Total Assessments
            </div>
            <p className="text-2xl font-bold" data-testid="text-total-assessments">{filteredMarks.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingUp className="w-4 h-4" />
              Overall Average
            </div>
            <p className="text-2xl font-bold" data-testid="text-overall-average">
              {overallAvg !== null ? `${overallAvg}%` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <BookOpen className="w-4 h-4" />
              Subjects
            </div>
            <p className="text-2xl font-bold">{subjects.length}</p>
          </CardContent>
        </Card>
      </div>

      {dashboard?.student?.id && Array.from(new Map((marks || []).filter(m => m.examId).map(m => [m.examId, m])).values()).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Published Academic Reports</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Array.from(new Map((marks || []).filter(m => m.examId).map(m => [m.examId, m])).values()).map((mark) => (
              <Button key={mark.examId} variant="outline" size="sm" onClick={() => window.open(`/api/report-cards/${mark.examId}/student/${dashboard.student.id}/download`, "_blank", "noopener,noreferrer")}>
                <Download className="mr-2 h-4 w-4" />{mark.examName || mark.assessmentName}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center">
        <Select value={termFilter} onValueChange={setTermFilter}>
          <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-term-filter">
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
          <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-subject-filter">
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
                {filteredMarks.map((mark) => (
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
                    <TableCell>
                      <Badge variant="outline">{mark.assessmentType}</Badge>
                    </TableCell>
                    <TableCell className="font-mono">
                      {mark.percentage ? `${parseFloat(mark.percentage).toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell>
                      {mark.grade ? (
                        <Badge variant={gradeColor(mark.grade)}>{mark.grade}</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="max-w-[200px] text-muted-foreground break-words whitespace-normal">
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
    </div>
  );
}
