import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardList, Plus, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient, schoolFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { InfiniteYearPicker } from "@/components/ui/infinite-year-picker";

interface BootstrapResponse {
  currentAcademicYear: string;
  currentTerm: TermValue;
  classes: { id: number; className: string }[];
}

interface StudentOption {
  id: number;
  fullName: string;
  admissionNo: string | null;
}

interface SubjectOption {
  id: number;
  name: string;
}

interface QcRecordRow {
  id: number;
  schoolId: number;
  classId: number;
  studentId: number;
  subjectId: number;
  academicYear: string;
  term: TermValue;
  recordDate: string;
  descriptionComment: string;
  actionTaken: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

type TermValue = "term1" | "term2" | "term3";

interface RecordFormState {
  id?: number;
  classId: string;
  studentId: string;
  subjectId: string;
  academicYear: string;
  term: TermValue;
  recordDate: string;
  descriptionComment: string;
  actionTaken: string;
}

const TERM_OPTIONS: Array<{ value: TermValue; label: string }> = [
  { value: "term1", label: "Term 1" },
  { value: "term2", label: "Term 2" },
  { value: "term3", label: "Term 3" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyForm(overrides: Partial<RecordFormState> = {}): RecordFormState {
  return {
    classId: "",
    studentId: "",
    subjectId: "",
    academicYear: "",
    term: "term1",
    recordDate: todayIso(),
    descriptionComment: "",
    actionTaken: "",
    ...overrides,
  };
}

export default function QCReportsPage() {
  const { toast } = useToast();
  const { currentSchoolId, hasPermission, isInSchoolContext } = useAuth();
  const canCreate = hasPermission("qc_reports.create");
  const canEdit = hasPermission("qc_reports.edit");
  const canDelete = hasPermission("qc_reports.delete");

  const [selectedYear, setSelectedYear] = useState("");
  const [selectedTerm, setSelectedTerm] = useState<TermValue | "">("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [activeSubjectId, setActiveSubjectId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formState, setFormState] = useState<RecordFormState>(createEmptyForm());

  const { data: bootstrap, isLoading: bootstrapLoading } = useQuery<BootstrapResponse>({
    queryKey: ["/api/qc-records/bootstrap", currentSchoolId],
    enabled: !!currentSchoolId,
    queryFn: async () => {
      const res = await schoolFetch("/api/qc-records/bootstrap");
      if (!res.ok) throw new Error("Failed to load quality control defaults");
      return res.json();
    },
  });

  const { data: students = [], isLoading: studentsLoading } = useQuery<StudentOption[]>({
    queryKey: ["/api/qc-records/students", currentSchoolId, selectedClassId],
    enabled: !!currentSchoolId && !!selectedClassId,
    queryFn: async () => {
      const res = await schoolFetch(`/api/qc-records/students?classId=${selectedClassId}`);
      if (!res.ok) throw new Error("Failed to load students");
      return res.json();
    },
  });

  const { data: subjects = [], isLoading: subjectsLoading } = useQuery<SubjectOption[]>({
    queryKey: ["/api/qc-records/subjects", currentSchoolId, selectedStudentId],
    enabled: !!currentSchoolId && !!selectedStudentId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await schoolFetch(`/api/qc-records/subjects?studentId=${selectedStudentId}`);
      if (!res.ok) throw new Error("Failed to load subjects");
      return res.json();
    },
  });

  const { data: records = [], isLoading: recordsLoading } = useQuery<QcRecordRow[]>({
    queryKey: ["/api/qc-records", currentSchoolId, selectedStudentId, selectedYear, selectedTerm],
    enabled: !!currentSchoolId && !!selectedStudentId && !!selectedYear && !!selectedTerm,
    queryFn: async () => {
      const params = new URLSearchParams({
        studentId: selectedStudentId,
        academicYear: selectedYear,
        term: selectedTerm as TermValue,
      });
      const res = await schoolFetch(`/api/qc-records?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load quality control records");
      return res.json();
    },
  });

  useEffect(() => {
    if (!bootstrap) return;

    setSelectedYear((current) => current || bootstrap.currentAcademicYear);
    setSelectedTerm((current) => current || bootstrap.currentTerm);
  }, [bootstrap]);

  useEffect(() => {
    setSelectedStudentId("");
    setActiveSubjectId("");
  }, [selectedClassId]);

  useEffect(() => {
    if (!subjects.length) {
      setActiveSubjectId("");
      return;
    }

    setActiveSubjectId((current) => {
      if (current && subjects.some((subject) => String(subject.id) === current)) {
        return current;
      }
      return String(subjects[0].id);
    });
  }, [subjects]);

  const subjectsById = useMemo(() => {
    return new Map(subjects.map((subject) => [subject.id, subject]));
  }, [subjects]);

  const recordsBySubject = useMemo(() => {
    const grouped = new Map<number, QcRecordRow[]>();

    for (const subject of subjects) {
      grouped.set(subject.id, []);
    }

    for (const record of records) {
      const bucket = grouped.get(record.subjectId) ?? [];
      bucket.push(record);
      grouped.set(record.subjectId, bucket);
    }

    return grouped;
  }, [records, subjects]);

  const selectedClass = useMemo(
    () => bootstrap?.classes.find((item) => String(item.id) === selectedClassId) ?? null,
    [bootstrap?.classes, selectedClassId],
  );

  const selectedStudent = useMemo(
    () => students.find((item) => String(item.id) === selectedStudentId) ?? null,
    [students, selectedStudentId],
  );

  const activeSubject = useMemo(
    () => subjects.find((item) => String(item.id) === activeSubjectId) ?? null,
    [subjects, activeSubjectId],
  );

  const refreshRecords = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["/api/qc-records", currentSchoolId, selectedStudentId, selectedYear, selectedTerm],
    });
  };

  const createMutation = useMutation({
    mutationFn: async (payload: RecordFormState) => {
      await apiRequest("POST", "/api/qc-records", {
        classId: Number(payload.classId),
        studentId: Number(payload.studentId),
        subjectId: Number(payload.subjectId),
        academicYear: payload.academicYear,
        term: payload.term,
        recordDate: payload.recordDate,
        descriptionComment: payload.descriptionComment.trim(),
        actionTaken: payload.actionTaken.trim(),
      });
    },
    onSuccess: async () => {
      await refreshRecords();
      setDialogOpen(false);
      toast({ title: "Record added" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to add record",
        description: error?.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: RecordFormState) => {
      await apiRequest("PATCH", `/api/qc-records/${payload.id}`, {
        classId: Number(payload.classId),
        studentId: Number(payload.studentId),
        subjectId: Number(payload.subjectId),
        academicYear: payload.academicYear,
        term: payload.term,
        recordDate: payload.recordDate,
        descriptionComment: payload.descriptionComment.trim(),
        actionTaken: payload.actionTaken.trim(),
      });
    },
    onSuccess: async () => {
      await refreshRecords();
      setDialogOpen(false);
      toast({ title: "Record updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update record",
        description: error?.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (recordId: number) => {
      await apiRequest("DELETE", `/api/qc-records/${recordId}`);
    },
    onSuccess: async () => {
      await refreshRecords();
      toast({ title: "Record deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete record",
        description: error?.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const openCreateDialog = () => {
    if (!selectedClassId || !selectedStudentId || !activeSubjectId || !selectedTerm) {
      toast({
        title: "Select a class, student, and subject first",
        variant: "destructive",
      });
      return;
    }

    setFormState(
      createEmptyForm({
        classId: selectedClassId,
        studentId: selectedStudentId,
        subjectId: activeSubjectId,
        academicYear: selectedYear,
        term: selectedTerm as TermValue,
        recordDate: todayIso(),
      }),
    );
    setDialogOpen(true);
  };

  const openEditDialog = (record: QcRecordRow) => {
    setFormState(
      createEmptyForm({
        id: record.id,
        classId: String(record.classId),
        studentId: String(record.studentId),
        subjectId: String(record.subjectId),
        academicYear: record.academicYear,
        term: record.term,
        recordDate: record.recordDate,
        descriptionComment: record.descriptionComment,
        actionTaken: record.actionTaken ?? "",
      }),
    );
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!formState.recordDate || !formState.descriptionComment.trim()) {
      toast({
        title: "Date Recorded and Description/Comment are required",
        variant: "destructive",
      });
      return;
    }

    if (formState.id) {
      updateMutation.mutate(formState);
      return;
    }

    createMutation.mutate(formState);
  };

  const handleDelete = (recordId: number) => {
    if (!window.confirm("Delete this quality control record?")) return;
    deleteMutation.mutate(recordId);
  };

  if (!isInSchoolContext || !currentSchoolId) {
    return (
      <div className="p-4 md:p-6">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Select a school first to work with quality control records.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <Card className="shadow-sm">
        <CardContent className="p-4 md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <div className="mt-1 rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                <ClipboardList className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-3xl font-bold tracking-tight text-primary">Quality Control Records</h1>
                <p className="text-muted-foreground">Monitor teaching progress and curriculum coverage</p>
              </div>
            </div>

            <div className="flex flex-1 flex-wrap items-end gap-3 xl:justify-end">
              <div className="min-w-[150px] space-y-2">
                <Label>Academic Year</Label>
                {bootstrapLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <InfiniteYearPicker value={selectedYear} onValueChange={setSelectedYear} />
                )}
              </div>

              <div className="min-w-[150px] space-y-2">
                <Label>School Term</Label>
                <Select value={selectedTerm || undefined} onValueChange={(value) => setSelectedTerm(value as TermValue)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select term" />
                  </SelectTrigger>
                  <SelectContent>
                    {TERM_OPTIONS.map((term) => (
                      <SelectItem key={term.value} value={term.value}>
                        {term.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-[180px] space-y-2">
                <Label>Class</Label>
                <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent>
                    {bootstrap?.classes.map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.className}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-[220px] space-y-2">
                <Label>Student</Label>
                <Select value={selectedStudentId} onValueChange={setSelectedStudentId} disabled={!selectedClassId || studentsLoading}>
                  <SelectTrigger>
                    <SelectValue placeholder={!selectedClassId ? "Select class first" : studentsLoading ? "Loading students..." : "Select student"} />
                  </SelectTrigger>
                  <SelectContent>
                    {students.map((student) => (
                      <SelectItem key={student.id} value={String(student.id)}>
                        {student.fullName}{student.admissionNo ? ` (${student.admissionNo})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {canCreate && (
                <div className="space-y-2">
                  <Label className="opacity-0">Add</Label>
                  <Button onClick={openCreateDialog} disabled={!selectedStudentId || !activeSubjectId} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Record
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedStudentId ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Select a class and student to view quality control records by subject.
          </CardContent>
        </Card>
      ) : subjectsLoading ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-56 w-full" />
          </CardContent>
        </Card>
      ) : subjects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No subjects are assigned to this student.
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeSubjectId} onValueChange={setActiveSubjectId} className="space-y-4">
          <div className="overflow-x-auto">
            <TabsList className="h-auto w-max min-w-full justify-start gap-2 rounded-xl border bg-card p-2">
              {subjects.map((subject) => (
                <TabsTrigger key={subject.id} value={String(subject.id)} className="rounded-lg px-4 py-2">
                  {subject.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {subjects.map((subject) => {
            const subjectRecords = recordsBySubject.get(subject.id) ?? [];

            return (
              <TabsContent key={subject.id} value={String(subject.id)}>
                <Card>
                  <CardContent className="p-0">
                    <div className="border-b px-4 py-3 text-sm text-muted-foreground">
                      {selectedClass?.className || ""}
                      {selectedClass && selectedStudent ? " • " : ""}
                      {selectedStudent?.fullName || ""}
                      {selectedYear ? ` • ${selectedYear}` : ""}
                      {selectedTerm ? ` • ${TERM_OPTIONS.find((item) => item.value === selectedTerm)?.label}` : ""}
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[150px]">Date Recorded</TableHead>
                          <TableHead>Description/Comment</TableHead>
                          <TableHead className="w-[800px] min-w-[800px]">Action Taken</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recordsLoading ? (
                          Array.from({ length: 4 }).map((_, index) => (
                            <TableRow key={index}>
                              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                            </TableRow>
                          ))
                        ) : subjectRecords.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                              No records found for {subject.name}.
                            </TableCell>
                          </TableRow>
                        ) : (
                          subjectRecords.map((record) => (
                            <TableRow key={record.id}>
                              <TableCell className="align-top">{record.recordDate}</TableCell>
                              <TableCell className="align-top whitespace-pre-wrap">{record.descriptionComment}</TableCell>
                              <TableCell className="align-top">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="whitespace-pre-wrap">{record.actionTaken || "—"}</div>
                                  {(canEdit || canDelete) && (
                                    <div className="flex shrink-0 items-center gap-1">
                                      {canEdit && (
                                        <Button variant="ghost" size="sm" onClick={() => openEditDialog(record)} className="h-8 px-2">
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      )}
                                      {canDelete && (
                                        <Button variant="ghost" size="sm" onClick={() => handleDelete(record.id)} className="h-8 px-2 text-destructive hover:text-destructive" disabled={deleteMutation.isPending}>
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{formState.id ? "Edit Quality Control Record" : "Add Quality Control Record"}</DialogTitle>
            <DialogDescription>
              {selectedStudent?.fullName || "Selected student"}
              {activeSubject ? ` • ${activeSubject.name}` : subjectsById.get(Number(formState.subjectId)) ? ` • ${subjectsById.get(Number(formState.subjectId))?.name}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
              <div className="space-y-2">
                <Label>Date Recorded</Label>
                <Input
                  type="date"
                  value={formState.recordDate}
                  onChange={(event) => setFormState((current) => ({ ...current, recordDate: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Academic Year</Label>
                <Input value={formState.academicYear} readOnly className="bg-muted" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description/Comment</Label>
              <Textarea
                value={formState.descriptionComment}
                onChange={(event) => setFormState((current) => ({ ...current, descriptionComment: event.target.value }))}
                rows={5}
                placeholder="Enter description or comment"
              />
            </div>

            <div className="space-y-2">
              <Label>Action Taken</Label>
              <Textarea
                value={formState.actionTaken}
                onChange={(event) => setFormState((current) => ({ ...current, actionTaken: event.target.value }))}
                rows={5}
                placeholder="Enter action taken"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : formState.id ? "Update Record" : "Save Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
