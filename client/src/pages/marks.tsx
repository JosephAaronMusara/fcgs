import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Save, FileText } from "lucide-react";
import type { Assessment, Student, Mark, Class, Subject } from "@shared/schema";

export default function MarksPage() {
  const { toast } = useToast();
  const [selectedAssessment, setSelectedAssessment] = useState<string>("");
  const [marksData, setMarksData] = useState<Record<number, string>>({});

  const { data: assessments } = useQuery<Assessment[]>({
    queryKey: ["/api/assessments"],
  });

  const { data: classes } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
  });

  const { data: subjects } = useQuery<Subject[]>({
    queryKey: ["/api/subjects"],
  });

  const selectedAssessmentData = assessments?.find((a) => a.id.toString() === selectedAssessment);

  const { data: students, isLoading: studentsLoading } = useQuery<Student[]>({
    queryKey: ["/api/students/by-class", selectedAssessmentData?.classId],
    enabled: !!selectedAssessmentData?.classId,
  });

  const { data: existingMarks } = useQuery<Mark[]>({
    queryKey: ["/api/marks/by-assessment", selectedAssessment],
    enabled: !!selectedAssessment,
  });

  const saveMutation = useMutation({
    mutationFn: async (marks: { studentId: number; assessmentId: number; marksObtained: string }[]) => {
      const res = await apiRequest("POST", "/api/marks/bulk", { marks });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marks"] });
      toast({ title: "Success", description: "Marks saved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleMarkChange = (studentId: number, value: string) => {
    setMarksData((prev) => ({ ...prev, [studentId]: value }));
  };

  const getExistingMark = (studentId: number) => {
    const mark = existingMarks?.find((m) => m.studentId === studentId);
    return mark?.marksObtained || null;
  };

  const getCurrentMark = (studentId: number) => {
    return marksData[studentId] ?? getExistingMark(studentId) ?? "";
  };

  const handleSaveAll = () => {
    if (!selectedAssessment) return;

    const marks = Object.entries(marksData)
      .filter(([_, value]) => value !== "")
      .map(([studentId, marksObtained]) => ({
        studentId: parseInt(studentId),
        assessmentId: parseInt(selectedAssessment),
        marksObtained,
      }));

    if (marks.length === 0) {
      toast({ title: "No changes", description: "Please enter marks for at least one student" });
      return;
    }

    saveMutation.mutate(marks);
  };

  const getClassName = (classId: number) => {
    return classes?.find((c) => c.id === classId)?.className || "";
  };

  const getSubjectName = (subjectId: number) => {
    return subjects?.find((s) => s.id === subjectId)?.name || "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-8 w-8" style={{ color: "#1b2a5c" }} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-marks-title">Marks Entry</h1>
          <p className="text-muted-foreground">Enter and manage student marks for assessments</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Select Assessment
          </CardTitle>
          <CardDescription>Choose an assessment to enter marks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2 flex-1 min-w-[300px]">
              <Label htmlFor="assessment">Assessment</Label>
              <Select value={selectedAssessment} onValueChange={(v) => { setSelectedAssessment(v); setMarksData({}); }}>
                <SelectTrigger data-testid="select-assessment">
                  <SelectValue placeholder="Select an assessment" />
                </SelectTrigger>
                <SelectContent>
                  {assessments?.map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.name} - {getSubjectName(a.subjectId)} ({getClassName(a.classId)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedAssessment && (
              <Button onClick={handleSaveAll} disabled={saveMutation.isPending} data-testid="button-save-marks">
                <Save className="w-4 h-4 mr-2" />
                {saveMutation.isPending ? "Saving..." : "Save Marks"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedAssessment && selectedAssessmentData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{selectedAssessmentData.name}</CardTitle>
                <CardDescription>
                  Total Marks: {selectedAssessmentData.totalMarks} | 
                  Type: {selectedAssessmentData.assessmentType} | 
                  Term: {selectedAssessmentData.term || "N/A"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {studentsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : students && students.length > 0 ? (
              <MarksTable students={students} getCurrentMark={getCurrentMark} selectedAssessmentData={selectedAssessmentData} handleMarkChange={handleMarkChange} />
            ) : (
              <p className="text-center py-8 text-muted-foreground">
                No students found in this class
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MarksTable({
  students,
  getCurrentMark,
  selectedAssessmentData,
  handleMarkChange,
}: {
  students: Student[];
  getCurrentMark: (studentId: number) => string;
  selectedAssessmentData: Assessment;
  handleMarkChange: (studentId: number, value: string) => void;
}) {
  const { sortedData, sortConfig, requestSort } = useTableSort(students);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableTableHead sortKey="admissionNo" sortConfig={sortConfig} onSort={requestSort}>Admission No</SortableTableHead>
          <SortableTableHead sortKey="firstName" sortConfig={sortConfig} onSort={requestSort}>Student Name</SortableTableHead>
          <TableHead>Marks Obtained</TableHead>
          <TableHead>Percentage</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(sortedData ?? []).map((student) => {
          const mark = getCurrentMark(student.id);
          const percentage = mark && selectedAssessmentData.totalMarks
            ? ((parseFloat(mark) / selectedAssessmentData.totalMarks) * 100).toFixed(1)
            : "-";
          return (
            <TableRow key={student.id} data-testid={`marks-row-${student.id}`}>
              <TableCell className="font-mono">{student.admissionNo}</TableCell>
              <TableCell className="font-medium">
                {student.firstName} {student.lastName}
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min="0"
                  max={selectedAssessmentData.totalMarks}
                  value={mark}
                  onChange={(e) => handleMarkChange(student.id, e.target.value)}
                  className="w-24"
                  placeholder="0"
                  data-testid={`input-mark-${student.id}`}
                />
              </TableCell>
              <TableCell>
                {percentage !== "-" ? `${percentage}%` : "-"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
