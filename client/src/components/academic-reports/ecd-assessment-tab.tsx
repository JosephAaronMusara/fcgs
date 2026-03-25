import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { AssessmentType, Exam } from "@shared/schema";
import { ECD_RATINGS } from "@shared/academic-profiles";

interface EcdAssessmentTabProps {
  exams: Exam[];
  assessmentTypes: AssessmentType[];
}

interface EcdTemplateDomain {
  id: number;
  code: string;
  name: string;
  sortOrder: number | null;
  items: Array<{ id: number; domainId: number; itemText: string; sortOrder: number | null }>;
}

interface EcdContextClass {
  id: number;
  className: string;
  streamId: number | null;
  streamName: string;
}

interface EcdContextStudent {
  id: number;
  firstName: string;
  lastName: string;
  admissionNo: string;
  status: string;
  completedResponses: number;
}

export function EcdAssessmentTab({ exams, assessmentTypes }: EcdAssessmentTabProps) {
  const { toast } = useToast();
  const { currentSchoolId } = useAuth();
  const endOfTermTypeIds = useMemo(
    () => assessmentTypes.filter((type) => type.name === "End-of-Term Exam").map((type) => type.id),
    [assessmentTypes],
  );
  const endOfTermExams = useMemo(
    () => exams.filter((exam) => exam.assessmentTypeId && endOfTermTypeIds.includes(exam.assessmentTypeId)),
    [exams, endOfTermTypeIds],
  );

  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  useEffect(() => {
    if (!selectedExamId && endOfTermExams.length > 0) {
      setSelectedExamId(String(endOfTermExams[0].id));
    }
  }, [selectedExamId, endOfTermExams]);

  const { data: templateData, isLoading: templateLoading } = useQuery<{ domains: EcdTemplateDomain[] }>({
    queryKey: ["/api/ecd-assessment/template", currentSchoolId],
    enabled: true,
    queryFn: async () => {
      const res = await fetch("/api/ecd-assessment/template", {
        credentials: "include",
        headers: currentSchoolId ? { "X-School-Id": String(currentSchoolId) } : undefined,
      });
      if (!res.ok) throw new Error("Failed to load ECD template");
      return res.json();
    },
  });

  const { data: contextData, isLoading: contextLoading } = useQuery<{ ecdClasses: EcdContextClass[]; students: EcdContextStudent[]; isEndOfTermExam: boolean }>({
    queryKey: ["/api/ecd-assessment/context", currentSchoolId, selectedExamId, selectedClassId],
    enabled: !!selectedExamId,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedExamId) params.set("examId", selectedExamId);
      if (selectedClassId) params.set("classId", selectedClassId);
      const res = await fetch(`/api/ecd-assessment/context?${params.toString()}`, {
        credentials: "include",
        headers: currentSchoolId ? { "X-School-Id": String(currentSchoolId) } : undefined,
      });
      if (!res.ok) throw new Error(await res.text() || "Failed to load ECD context");
      return res.json();
    },
  });

  useEffect(() => {
    if (!selectedClassId && contextData?.ecdClasses?.length) {
      setSelectedClassId(String(contextData.ecdClasses[0].id));
    }
  }, [selectedClassId, contextData?.ecdClasses]);

  useEffect(() => {
    if (!selectedStudentId && contextData?.students?.length) {
      setSelectedStudentId(String(contextData.students[0].id));
    }
  }, [selectedStudentId, contextData?.students]);

  const { data: recordData, isLoading: recordLoading } = useQuery<{ record: { id: number; status: string } | null; responses: Array<{ itemId: number; rating: string | null }> }>({
    queryKey: ["/api/ecd-assessment/record", currentSchoolId, selectedExamId, selectedClassId, selectedStudentId],
    enabled: !!selectedExamId && !!selectedStudentId && !!selectedClassId,
    queryFn: async () => {
      const params = new URLSearchParams({ examId: selectedExamId, studentId: selectedStudentId, classId: selectedClassId });
      const res = await fetch(`/api/ecd-assessment/record?${params.toString()}`, {
        credentials: "include",
        headers: currentSchoolId ? { "X-School-Id": String(currentSchoolId) } : undefined,
      });
      if (!res.ok) throw new Error(await res.text() || "Failed to load ECD record");
      return res.json();
    },
  });

  const responseMap = useMemo(() => {
    const map = new Map<number, string | null>();
    (recordData?.responses || []).forEach((row) => map.set(row.itemId, row.rating));
    return map;
  }, [recordData?.responses]);

  const selectedClass = contextData?.ecdClasses?.find((item) => String(item.id) === selectedClassId);
  const selectedStudent = contextData?.students?.find((item) => String(item.id) === selectedStudentId);
  const currentStatus = recordData?.record?.status || selectedStudent?.status || "draft";

  const saveMutation = useMutation({
    mutationFn: async (payload: { itemId?: number; rating?: string | null; status?: string; clearAll?: boolean }) => {
      const res = await fetch("/api/ecd-assessment/record", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(currentSchoolId ? { "X-School-Id": String(currentSchoolId) } : {}),
        },
        body: JSON.stringify({
          examId: Number(selectedExamId),
          classId: Number(selectedClassId),
          studentId: Number(selectedStudentId),
          streamId: selectedClass?.streamId,
          ...payload,
        }),
      });
      if (!res.ok) {
        throw new Error(`${res.status}: ${(await res.text()) || "Failed to save ECD record"}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ecd-assessment/record", currentSchoolId, selectedExamId, selectedClassId, selectedStudentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ecd-assessment/context", currentSchoolId, selectedExamId, selectedClassId] });
      queryClient.invalidateQueries({ queryKey: ["/api/report-cards", selectedExamId, "class", selectedClassId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleStatusToggle = () => {
    saveMutation.mutate({ status: currentStatus === "published" ? "draft" : "published" });
  };

  const handleRatingToggle = (itemId: number, nextRating: string) => {
    const currentRating = responseMap.get(itemId) || null;
    saveMutation.mutate({ itemId, rating: currentRating === nextRating ? null : nextRating });
  };

  const handleClearReport = () => {
    saveMutation.mutate({ clearAll: true, status: "draft" });
    setClearConfirmOpen(false);
  };

  const totalItems = useMemo(
    () => (templateData?.domains || []).reduce((sum, domain) => sum + domain.items.length, 0),
    [templateData?.domains],
  );

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>ECD Assessment Entry</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selectedExamId} onValueChange={(value) => { setSelectedExamId(value); setSelectedClassId(""); setSelectedStudentId(""); }}>
            <SelectTrigger className="w-[220px]" data-testid="select-ecd-exam">
              <SelectValue placeholder="Select End-of-Term exam" />
            </SelectTrigger>
            <SelectContent>
              {endOfTermExams.map((exam) => (
                <SelectItem key={exam.id} value={String(exam.id)}>{exam.examName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedClassId} onValueChange={(value) => { setSelectedClassId(value); setSelectedStudentId(""); }} disabled={!contextData?.ecdClasses?.length}>
            <SelectTrigger className="w-[220px]" data-testid="select-ecd-class">
              <SelectValue placeholder="Select ECD class" />
            </SelectTrigger>
            <SelectContent>
              {(contextData?.ecdClasses || []).map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>{item.className}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedStudentId} onValueChange={setSelectedStudentId} disabled={!contextData?.students?.length}>
            <SelectTrigger className="min-w-[260px] max-w-[320px]" data-testid="select-ecd-student">
              <SelectValue placeholder="Select student" />
            </SelectTrigger>
            <SelectContent>
              {(contextData?.students || []).map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>{item.firstName} {item.lastName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-2">
            <Badge variant={currentStatus === "published" ? "default" : "secondary"} data-testid="badge-ecd-status">
              {currentStatus}
            </Badge>
            <Button variant="outline" onClick={() => setClearConfirmOpen(true)} disabled={!selectedStudentId || saveMutation.isPending} data-testid="button-ecd-clear-report">
              Clear Report
            </Button>
            <Button variant="outline" onClick={handleStatusToggle} disabled={!selectedStudentId || saveMutation.isPending} data-testid="button-ecd-toggle-status">
              {currentStatus === "published" ? "Mark Draft" : "Publish"}
            </Button>
          </div>
        </div>

        {selectedStudent && (
          <div className="text-xs text-muted-foreground" data-testid="text-ecd-progress">
            {selectedStudent.completedResponses}/{totalItems} rows completed for {selectedStudent.firstName} {selectedStudent.lastName}
          </div>
        )}

        {templateLoading || contextLoading || recordLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => <Skeleton key={item} className="h-20 w-full" />)}
          </div>
        ) : !contextData?.isEndOfTermExam ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Select an End-of-Term exam to capture ECD assessment ticks.
          </div>
        ) : !selectedClassId || !selectedStudentId ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Select an ECD class and a student to begin entering checklist ticks.
          </div>
        ) : (
          <div className="space-y-4">
            {(templateData?.domains || []).map((domain) => (
              <div key={domain.id} className="overflow-hidden rounded-lg border">
                <div className="bg-muted px-3 py-2 text-sm font-semibold">
                  {domain.code}. {domain.name}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60%]">Checklist Item</TableHead>
                      {ECD_RATINGS.map((rating) => (
                        <TableHead key={rating} className="text-center">{rating}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {domain.items.map((item) => {
                      const selectedRating = responseMap.get(item.id) || null;
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="py-2 text-sm">{item.itemText}</TableCell>
                          {ECD_RATINGS.map((rating) => {
                            const isSelected = selectedRating === rating;
                            return (
                              <TableCell key={rating} className="w-[90px] p-1 text-center">
                                <button
                                  type="button"
                                  className={`w-full rounded border px-2 py-2 text-xs font-semibold transition ${isSelected ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                                  onClick={() => handleRatingToggle(item.id, rating)}
                                  data-testid={`button-ecd-${item.id}-${rating}`}
                                >
                                  {isSelected ? "✓" : ""}
                                </button>
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this ECD report?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all ticks for the currently selected student and reset the report status to Draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearReport} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Clear report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
