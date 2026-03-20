import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight, AlertTriangle, FileText, Send, RotateCcw, X, Menu, MessageSquare, ClipboardList } from "lucide-react";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import type { Assessment, Subject, Class as ClassType, AssessmentType, Exam, Grade, AssessmentComment } from "@shared/schema";

interface AssessmentPaper {
  id?: number;
  paperName: string;
  paperMarks: number;
  paperWeightPct: string;
}

interface AssessmentWithPapers extends Assessment {
  papers: AssessmentPaper[];
}

export default function AssessmentsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage] = useState(10);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingAssessment, setEditingAssessment] = useState<AssessmentWithPapers | null>(null);
  const [filterClassId, setFilterClassId] = useState<string>("all");
  const [filterSubjectId, setFilterSubjectId] = useState<string>("all");
  
  // Exam, Assessment Types, and Comments dialog state
  const [isCommentsDialogOpen, setIsCommentsDialogOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: classes } = useQuery<ClassType[]>({
    queryKey: ["/api/classes"],
  });

  const { data: subjectsData } = useQuery<{ items: Subject[]; total: number }>({
    queryKey: ["/api/subjects"],
  });
  const subjects = subjectsData?.items;

  const { data: assessmentTypes } = useQuery<AssessmentType[]>({
    queryKey: ["/api/assessment-types"],
  });

  const { data: exams } = useQuery<Exam[]>({
    queryKey: ["/api/exams"],
  });

  const { data: gradesResponse } = useQuery<{ items: Grade[] }>({
    queryKey: ["/api/grades"],
  });
  const grades = gradesResponse?.items;

  const { data: assessmentComments } = useQuery<Array<AssessmentComment & { className: string; subjectName: string; gradeName: string }>>({
    queryKey: ["/api/assessment-comments"],
  });

  const { data: assessments, isLoading } = useQuery<AssessmentWithPapers[]>({
    queryKey: ["/api/assessments", filterClassId, filterSubjectId, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterClassId && filterClassId !== "all") {
        params.set("classId", filterClassId);
      }
      if (filterSubjectId && filterSubjectId !== "all") {
        params.set("subjectId", filterSubjectId);
      }
      if (debouncedSearch) {
        params.set("search", debouncedSearch);
      }
      const res = await schoolFetch(`/api/assessments?${params}`);
      if (!res.ok) throw new Error("Failed to fetch assessments");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/assessments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments"] });
      setIsAddOpen(false);
      toast({ title: "Success", description: "Assessment created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PUT", `/api/assessments/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments"] });
      setEditingAssessment(null);
      toast({ title: "Success", description: "Assessment updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/assessments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments"] });
      toast({ title: "Success", description: "Assessment deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async ({ id, publish }: { id: number; publish: boolean }) => {
      const res = await apiRequest("PUT", `/api/assessments/${id}`, { isPublished: publish });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments"] });
      toast({ 
        title: "Success", 
        description: variables.publish ? "Assessment published successfully" : "Assessment unpublished" 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filteredAssessments = (assessments || []).filter((a) => {
    const matchSearch = !debouncedSearch || 
      a.topic?.toLowerCase().includes(debouncedSearch.toLowerCase());
    const matchSubject = filterSubjectId === "all" || a.subjectId?.toString() === filterSubjectId;
    return matchSearch && matchSubject;
  });

  const { sortedData: sortedAssessments, sortConfig, requestSort } = useTableSort(filteredAssessments);
  const paginatedAssessments = (sortedAssessments ?? []).slice((page - 1) * perPage, page * perPage);
  const total = filteredAssessments.length;
  const totalPages = Math.ceil(total / perPage);

  const getClassName = (classId: number | null) => {
    return classes?.find(c => c.id === classId)?.className || "—";
  };

  const getSubjectName = (subjectId: number | null) => {
    return subjects?.find(s => s.id === subjectId)?.name || "—";
  };

  const getTypeName = (typeId: number | null | undefined) => {
    return assessmentTypes?.find(t => t.id === typeId)?.name || "—";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-assessments-title">Assessments Manager</h1>
            <p className="text-muted-foreground">Manage tests, exams and coursework</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setIsAddOpen(true)} data-testid="button-add-assessment">
            <Plus className="w-4 h-4 mr-2" />
            Assessment
          </Button>
          <Button variant="outline" onClick={() => setIsCommentsDialogOpen(true)} data-testid="button-manage-comments">
            <MessageSquare className="w-4 h-4 mr-2" />
            Comments
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by topic..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search"
            />
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:w-auto xl:flex-wrap">
            <Select value={filterClassId} onValueChange={setFilterClassId}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-filter-class">
                <SelectValue placeholder="All Classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {classes?.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>{c.className}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSubjectId} onValueChange={setFilterSubjectId}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-filter-subject">
                <SelectValue placeholder="All Subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subjects</SelectItem>
                {subjects?.map((s) => (
                  <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : paginatedAssessments.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No assessments found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead sortKey="topic" sortConfig={sortConfig} onSort={requestSort}>Topic</SortableTableHead>
                  <SortableTableHead sortKey="classId" sortConfig={sortConfig} onSort={requestSort}>Class</SortableTableHead>
                  <SortableTableHead sortKey="subjectId" sortConfig={sortConfig} onSort={requestSort}>Subject</SortableTableHead>
                  <SortableTableHead sortKey="assessmentTypeId" sortConfig={sortConfig} onSort={requestSort}>Type</SortableTableHead>
                  <SortableTableHead sortKey="date" sortConfig={sortConfig} onSort={requestSort}>Date</SortableTableHead>
                  <SortableTableHead sortKey="numberOfPapers" sortConfig={sortConfig} onSort={requestSort}>Papers</SortableTableHead>
                  <SortableTableHead sortKey="status" sortConfig={sortConfig} onSort={requestSort}>Status</SortableTableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedAssessments.map((a) => (
                  <TableRow key={a.id} data-testid={`row-assessment-${a.id}`}>
                    <TableCell className="font-medium">{a.topic}</TableCell>
                    <TableCell>{getClassName(a.classId)}</TableCell>
                    <TableCell>{getSubjectName(a.subjectId)}</TableCell>
                    <TableCell>{getTypeName(a.assessmentTypeId)}</TableCell>
                    <TableCell>
                      {a.assessmentDate ? new Date(a.assessmentDate).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{a.papers?.length || 0} papers</Badge>
                    </TableCell>
                    <TableCell>
                      {a.isPublished ? (
                        <Badge>Published</Badge>
                      ) : (
                        <Badge variant="outline">Draft</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => publishMutation.mutate({ id: a.id, publish: !a.isPublished })}
                          data-testid={`button-publish-${a.id}`}
                          title={a.isPublished ? "Unpublish assessment" : "Publish assessment"}
                        >
                          {a.isPublished ? (
                            <RotateCcw className="w-4 h-4" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingAssessment(a)}
                          data-testid={`button-edit-${a.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(a.id)}
                          data-testid={`button-delete-${a.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>Showing {((page - 1) * perPage) + 1} to {Math.min(page * perPage, total)} of {total}</span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  data-testid="button-next-page"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AssessmentDialog
        open={isAddOpen || !!editingAssessment}
        onOpenChange={(open) => {
          if (!open) {
            setIsAddOpen(false);
            setEditingAssessment(null);
          }
        }}
        assessment={editingAssessment}
        classes={classes || []}
        subjects={subjects || []}
        assessmentTypes={assessmentTypes || []}
        exams={exams || []}
        onSubmit={(data) => {
          if (editingAssessment) {
            updateMutation.mutate({ id: editingAssessment.id, data });
          } else {
            createMutation.mutate(data);
          }
        }}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />



      <CommentsDialog
        open={isCommentsDialogOpen}
        onOpenChange={setIsCommentsDialogOpen}
        comments={assessmentComments || []}
        subjects={subjects || []}
        classes={classes || []}
        grades={grades || []}
      />
    </div>
  );
}

interface AssessmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessment: AssessmentWithPapers | null;
  classes: ClassType[];
  subjects: Subject[];
  assessmentTypes: AssessmentType[];
  exams: Exam[];
  onSubmit: (data: any) => void;
  isSubmitting: boolean;
}

function AssessmentDialog({
  open,
  onOpenChange,
  assessment,
  classes,
  subjects,
  assessmentTypes,
  exams,
  onSubmit,
  isSubmitting,
}: AssessmentDialogProps) {
  const [topic, setTopic] = useState("");
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [assessmentTypeId, setAssessmentTypeId] = useState("");
  const [assessmentDate, setAssessmentDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [examId, setExamId] = useState("");
  const [papers, setPapers] = useState<AssessmentPaper[]>([]);
  const [touched, setTouched] = useState(false);

  const resetForm = () => {
    setTopic("");
    setClassId("");
    setSubjectId("");
    setAssessmentTypeId("");
    setAssessmentDate("");
    setDueDate("");
    setExamId("");
    setPapers([{ paperName: "Paper 1", paperMarks: 100, paperWeightPct: "100" }]);
    setTouched(false);
  };

  useEffect(() => {
    if (!open) {
      resetForm();
      return;
    }
    
    if (assessment) {
      setTopic(assessment.topic || "");
      setClassId(assessment.classId?.toString() || "");
      setSubjectId(assessment.subjectId?.toString() || "");
      setAssessmentTypeId(assessment.assessmentTypeId?.toString() || "");
      setAssessmentDate(assessment.assessmentDate || "");
      setDueDate(assessment.dueDate || "");
      setExamId(assessment.examId?.toString() || "");
      setPapers(assessment.papers?.length ? assessment.papers : [{ paperName: "Paper 1", paperMarks: 100, paperWeightPct: "100" }]);
      setTouched(false);
    } else {
      resetForm();
    }
  }, [assessment, open]);

  const addPaper = () => {
    setPapers([...papers, { paperName: `Paper ${papers.length + 1}`, paperMarks: 100, paperWeightPct: "0" }]);
  };

  const removePaper = (index: number) => {
    setPapers(papers.filter((_, i) => i !== index));
  };

  const updatePaper = (index: number, field: keyof AssessmentPaper, value: string | number) => {
    const updated = [...papers];
    (updated[index] as any)[field] = value;
    setPapers(updated);
  };

  const totalWeight = papers.reduce((sum, p) => sum + parseFloat(p.paperWeightPct || "0"), 0);
  const weightsValid = Math.abs(totalWeight - 100) < 0.01;

  const isTopicValid = topic.trim().length > 0;
  const isClassValid = classId !== "";
  const isSubjectValid = subjectId !== "";
  const isExamValid = examId !== "";
  const hasPapers = papers.length >= 1;

  const handleSubmit = () => {
    setTouched(true);
    
    if (!isTopicValid || !isClassValid || !isSubjectValid || !isExamValid || !weightsValid || !hasPapers) {
      return;
    }
    
    onSubmit({
      topic: topic.trim(),
      classId: parseInt(classId),
      subjectId: parseInt(subjectId),
      assessmentTypeId: assessmentTypeId ? parseInt(assessmentTypeId) : null,
      assessmentDate: assessmentDate || null,
      dueDate: dueDate || null,
      examId: parseInt(examId),
          papers: papers.map(p => ({
        paperName: p.paperName,
        paperMarks: p.paperMarks,
        paperWeightPct: p.paperWeightPct,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{assessment ? "Edit Assessment" : "New Assessment"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Topic *</Label>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., Chapter 5 Test"
                className={touched && !isTopicValid ? "border-destructive" : ""}
                data-testid="input-topic"
              />
              {touched && !isTopicValid && (
                <p className="text-destructive text-sm">Topic is required</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Assessment Date</Label>
              <Input
                type="date"
                value={assessmentDate}
                onChange={(e) => setAssessmentDate(e.target.value)}
                data-testid="input-date"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Class *</Label>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger className={touched && !isClassValid ? "border-destructive" : ""} data-testid="select-class">
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.className}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {touched && !isClassValid && (
                <p className="text-destructive text-sm">Class is required</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger className={touched && !isSubjectValid ? "border-destructive" : ""} data-testid="select-subject">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {touched && !isSubjectValid && (
                <p className="text-destructive text-sm">Subject is required</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Assessment Type</Label>
              <Select value={assessmentTypeId} onValueChange={(val) => {
                setAssessmentTypeId(val);
                setExamId("");
              }}>
                <SelectTrigger data-testid="select-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {assessmentTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Linked Exercise/Exam <span className="text-destructive">*</span></Label>
              <Select value={examId || ""} onValueChange={setExamId} disabled={!assessmentTypeId}>
                <SelectTrigger data-testid="select-exam" className={touched && !examId ? "border-destructive" : ""}>
                  <SelectValue placeholder={assessmentTypeId ? "Select exercise/exam" : "Select assessment type first"} />
                </SelectTrigger>
                <SelectContent>
                  {exams
                    .filter((e) => assessmentTypeId && e.assessmentTypeId?.toString() === assessmentTypeId)
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id.toString()}>{e.examName}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {touched && !examId && <p className="text-xs text-destructive">Exercise/Exam is required</p>}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Papers</Label>
              <Button variant="outline" size="sm" onClick={addPaper} data-testid="button-add-paper">
                <Plus className="w-3 h-3 mr-1" /> Add Paper
              </Button>
            </div>
            
            {touched && !hasPapers && (
              <div className="flex items-center gap-2 p-2 bg-destructive/10 text-destructive rounded-md text-sm">
                <AlertTriangle className="w-4 h-4" />
                At least one paper is required
              </div>
            )}
            
            {!weightsValid && papers.length > 0 && (
              <div className="flex items-center gap-2 p-2 bg-destructive/10 text-destructive rounded-md text-sm">
                <AlertTriangle className="w-4 h-4" />
                Paper weights must sum to exactly 100% (currently {totalWeight.toFixed(1)}%)
              </div>
            )}

            <div className="space-y-2">
              {papers.map((paper, index) => (
                <div key={index} className="flex items-center gap-2 p-3 border rounded-md">
                  <Input
                    value={paper.paperName}
                    onChange={(e) => updatePaper(index, "paperName", e.target.value)}
                    placeholder="Paper name"
                    className="flex-1"
                    data-testid={`input-paper-name-${index}`}
                  />
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      value={paper.paperMarks}
                      onChange={(e) => updatePaper(index, "paperMarks", parseInt(e.target.value) || 0)}
                      className="w-20"
                      data-testid={`input-paper-marks-${index}`}
                    />
                    <span className="text-muted-foreground text-sm">marks</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      value={paper.paperWeightPct}
                      onChange={(e) => updatePaper(index, "paperWeightPct", e.target.value)}
                      className="w-20"
                      step="0.01"
                      data-testid={`input-paper-weight-${index}`}
                    />
                    <span className="text-muted-foreground text-sm">%</span>
                  </div>
                  {papers.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removePaper(index)}
                      data-testid={`button-remove-paper-${index}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            data-testid="button-submit"
          >
            {isSubmitting ? "Saving..." : (assessment ? "Update" : "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


interface EnrichedComment extends AssessmentComment {
  className: string;
  subjectName: string;
  gradeName: string;
}

interface DuplicateItem {
  id: number;
  classId: number;
  subjectId: number;
  className: string;
  subjectName: string;
  gradeName: string;
  commentText: string;
  selected: boolean;
}

interface MissingPair {
  classId: number;
  subjectId: number;
  className: string;
  subjectName: string;
}

interface CommentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comments: EnrichedComment[];
  subjects: Subject[];
  classes: ClassType[];
  grades: Grade[];
}

function MultiSelectPicker({ label, options, selected, onChange, testId }: {
  label: string;
  options: { id: number; name: string }[];
  selected: number[];
  onChange: (ids: number[]) => void;
  testId: string;
}) {
  const [filterText, setFilterText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter(o =>
    !filterText || o.name.toLowerCase().includes(filterText.toLowerCase())
  );

  const toggle = (id: number) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  const remove = (id: number) => {
    onChange(selected.filter(s => s !== id));
  };

  return (
    <div ref={ref} className="relative" data-testid={testId}>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <div
        className="flex flex-wrap gap-1 items-center border rounded-md px-2 py-1.5 min-h-[36px] cursor-text bg-background"
        onClick={() => setIsOpen(true)}
      >
        {selected.map(id => {
          const opt = options.find(o => o.id === id);
          return (
            <Badge key={id} variant="secondary" className="text-xs gap-1">
              {opt?.name || id}
              <X className="w-3 h-3 cursor-pointer" onClick={(e) => { e.stopPropagation(); remove(id); }} />
            </Badge>
          );
        })}
        <input
          className="flex-1 min-w-[80px] border-none outline-none bg-transparent text-sm"
          placeholder={selected.length === 0 ? "Tap to select..." : ""}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onFocus={() => setIsOpen(true)}
        />
      </div>
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-[200px] overflow-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No options</div>
          ) : (
            filtered.map(o => (
              <div
                key={o.id}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer hover-elevate text-sm ${selected.includes(o.id) ? "bg-accent/50" : ""}`}
                onClick={() => toggle(o.id)}
              >
                <span>{o.name}</span>
                {selected.includes(o.id) && <span className="text-primary font-bold">✓</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CommentsDialog({ open, onOpenChange, comments, subjects, classes, grades }: CommentsDialogProps) {
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<number[]>([]);
  const [gradeId, setGradeId] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const [dupModalOpen, setDupModalOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateItem[]>([]);
  const [missingPairs, setMissingPairs] = useState<MissingPair[]>([]);
  const [pendingText, setPendingText] = useState("");
  const [pendingGradeId, setPendingGradeId] = useState<number>(0);

  const classOptions = (classes || []).map(c => ({ id: c.id, name: c.className }));
  const subjectOptions = (subjects || []).map(s => ({ id: s.id, name: s.name }));

  const gradeRankMap: Record<string, number> = { 'A*': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'U': 6 };
  const sortedGrades = [...(grades || [])].sort((a, b) => {
    const ra = gradeRankMap[a.gradeName.toUpperCase().replace(/\s/g, '')] ?? 999;
    const rb = gradeRankMap[b.gradeName.toUpperCase().replace(/\s/g, '')] ?? 999;
    return ra - rb;
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/assessment-comments", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessment-comments"] });
      setCommentText("");
      toast({ title: "Success", description: `Created ${data.created || 0} comment(s)` });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, commentText }: { id: number; commentText: string }) => {
      const res = await apiRequest("PUT", `/api/assessment-comments/${id}`, { commentText });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessment-comments"] });
      setEditingId(null);
      setEditText("");
      toast({ title: "Success", description: "Comment updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/assessment-comments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessment-comments"] });
      toast({ title: "Success", description: "Comment deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const overwriteMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/assessment-comments/overwrite-and-create", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessment-comments"] });
      setDupModalOpen(false);
      setDuplicates([]);
      setMissingPairs([]);
      setCommentText("");
      toast({ title: "Success", description: `Overwrote ${data.overwritten || 0} & created ${data.created || 0}` });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = async () => {
    if (!selectedClassIds.length) {
      toast({ title: "Error", description: "Pick at least one class", variant: "destructive" }); return;
    }
    if (!selectedSubjectIds.length) {
      toast({ title: "Error", description: "Pick at least one subject", variant: "destructive" }); return;
    }
    if (!gradeId) {
      toast({ title: "Error", description: "Pick a grade", variant: "destructive" }); return;
    }
    if (!commentText.trim()) {
      toast({ title: "Error", description: "Enter a comment", variant: "destructive" }); return;
    }

    try {
      const checkRes = await apiRequest("POST", "/api/assessment-comments/check-duplicates", {
        classIds: selectedClassIds,
        subjectIds: selectedSubjectIds,
        gradeId: parseInt(gradeId),
      });
      const checkData = await checkRes.json();

      if (checkData.duplicates?.length > 0) {
        setDuplicates(checkData.duplicates.map((d: any) => ({ ...d, selected: true })));
        setMissingPairs(checkData.missingPairs || []);
        setPendingText(commentText.trim());
        setPendingGradeId(parseInt(gradeId));
        setDupModalOpen(true);
      } else {
        createMutation.mutate({
          classIds: selectedClassIds,
          subjectIds: selectedSubjectIds,
          gradeId: parseInt(gradeId),
                  commentText: commentText.trim(),
        });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to check duplicates", variant: "destructive" });
    }
  };

  const handleOverwrite = () => {
    const selectedIds = duplicates.filter(d => d.selected).map(d => d.id);
    overwriteMutation.mutate({
      overwriteIds: selectedIds,
      missingPairs,
      gradeId: pendingGradeId,
      commentText: pendingText,
        });
  };

  const toggleDuplicate = (id: number) => {
    setDuplicates(prev => prev.map(d => d.id === id ? { ...d, selected: !d.selected } : d));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Assessment Comments</DialogTitle>
            <DialogDescription>Multi Class x Multi Subject / Single Grade</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MultiSelectPicker
              label="Classes (multi)"
              options={classOptions}
              selected={selectedClassIds}
              onChange={setSelectedClassIds}
              testId="multi-select-classes"
            />
            <MultiSelectPicker
              label="Subjects (multi)"
              options={subjectOptions}
              selected={selectedSubjectIds}
              onChange={setSelectedSubjectIds}
              testId="multi-select-subjects"
            />
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Grade (single)</Label>
              <Select value={gradeId || "none"} onValueChange={(val) => setGradeId(val === "none" ? "" : val)}>
                <SelectTrigger data-testid="select-comment-grade">
                  <SelectValue placeholder="Select Grade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select Grade</SelectItem>
                  {sortedGrades.map((g) => (
                    <SelectItem key={g.id} value={g.id.toString()}>{g.gradeName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 items-end">
            <Input
              placeholder="Write your comment here"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              className="flex-1"
              data-testid="input-comment-text"
            />
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              data-testid="button-submit-comment"
            >
              {createMutation.isPending ? "Saving..." : "Submit"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            One comment per Class x Subject for the chosen Grade. This keeps Marks auto-comments working.
          </p>

          <div className="flex-1 min-h-0 overflow-y-auto border rounded-md">
            {comments.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">No comments yet.</div>
            ) : (
              <div className="divide-y">
                {comments.map((c) => (
                  <div key={c.id} className="p-3" data-testid={`comment-item-${c.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-semibold">{c.className}</span>
                        <span className="text-muted-foreground"> — </span>
                        <span>{c.subjectName}</span>
                        <span className="text-muted-foreground"> — </span>
                        <span className="italic">{c.gradeName}</span>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { setEditingId(c.id); setEditText(c.commentText); }}
                          data-testid={`button-edit-comment-${c.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { if (confirm("Delete this comment?")) deleteMutation.mutate(c.id); }}
                          data-testid={`button-delete-comment-${c.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm mt-1 text-muted-foreground">{c.commentText}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editingId !== null} onOpenChange={(v) => { if (!v) { setEditingId(null); setEditText(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Comment</DialogTitle>
            <DialogDescription>Update the comment text</DialogDescription>
          </DialogHeader>
          <Input
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder="Update comment text"
            data-testid="input-edit-comment"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingId(null); setEditText(""); }}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editText.trim()) { toast({ title: "Error", description: "Comment cannot be empty", variant: "destructive" }); return; }
                if (editingId) updateMutation.mutate({ id: editingId, commentText: editText.trim() });
              }}
              disabled={updateMutation.isPending}
              data-testid="button-save-edit-comment"
            >
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dupModalOpen} onOpenChange={(v) => { if (!v) { setDupModalOpen(false); setDuplicates([]); setMissingPairs([]); } }}>
        <DialogContent className="max-w-xl max-h-[92vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Duplicate Comments Found</DialogTitle>
            <DialogDescription>Select which existing comments to overwrite with the new text. Missing pairs will be created automatically.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto border rounded-md p-2 space-y-2">
            {duplicates.map((d) => (
              <div
                key={d.id}
                className={`flex items-center gap-3 p-2 rounded-md border cursor-pointer ${d.selected ? "border-primary bg-accent/30" : "border-border"}`}
                onClick={() => toggleDuplicate(d.id)}
                data-testid={`dup-item-${d.id}`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs ${d.selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"}`}>
                  {d.selected ? "✓" : ""}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    <span className="font-semibold">{d.className}</span> — {d.subjectName} — <span className="italic">{d.gradeName}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{d.commentText}</p>
                </div>
              </div>
            ))}
          </div>

          {missingPairs.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {missingPairs.length} new comment(s) will also be created for pairs without existing comments.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDupModalOpen(false); setDuplicates([]); setMissingPairs([]); }}>Cancel</Button>
            <Button
              onClick={handleOverwrite}
              disabled={overwriteMutation.isPending || (duplicates.filter(d => d.selected).length === 0 && missingPairs.length === 0)}
              data-testid="button-confirm-overwrite"
            >
              {overwriteMutation.isPending ? "Processing..." : duplicates.filter(d => d.selected).length > 0
                ? `Overwrite ${duplicates.filter(d => d.selected).length} & Create ${missingPairs.length}`
                : missingPairs.length > 0 ? `Create ${missingPairs.length} New` : "Nothing to do"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
