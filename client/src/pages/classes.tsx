import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Trash2, Users, ArrowRightLeft, X, BookOpen, School } from "lucide-react";
import type { Class as ClassType, Stream, Subject, Staff, Student, School as SchoolType } from "@shared/schema";
import { useAuth } from "@/lib/auth";

interface ClassWithDetails extends ClassType {
  studentCount?: number;
  subjects?: Subject[];
  stream?: Stream;
  classTeacher?: Staff;
}

interface ClassGradingConfiguration {
  classId: number;
  ready: boolean;
  state: "ready" | "needs_configuration";
  autoAttachedGradeRows: number;
  message: string;
  profiles: Array<{
    profileKey: string | null;
    profileLabel: string;
    ready: boolean;
    state: string;
    resolutionSource: string;
    message: string;
  }>;
}

interface ClassMutationResponse extends ClassType {
  gradingConfiguration?: ClassGradingConfiguration;
}

export default function ClassroomsPage() {
  const { toast } = useToast();
  const { currentSchoolId } = useAuth();
  const [search, setSearch] = useState("");
  const [streamFilter, setStreamFilter] = useState<string>("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassWithDetails | null>(null);
  const [isMigrateOpen, setIsMigrateOpen] = useState(false);
  const [migrateSourceClassId, setMigrateSourceClassId] = useState<number | null>(null);
  const [deleteClass, setDeleteClass] = useState<ClassWithDetails | null>(null);

  const { data: schools } = useQuery<SchoolType[]>({
    queryKey: ["/api/schools"],
  });

  const currentSchool = schools?.find(s => s.id === currentSchoolId);
  const schoolType = currentSchool?.schoolType || "secondary";

  const { data: classList, isLoading } = useQuery<ClassType[]>({
    queryKey: ["/api/classes"],
  });

  const { data: gradingConfigurations = [] } = useQuery<ClassGradingConfiguration[]>({
    queryKey: ["/api/classes/grading-configuration", currentSchoolId],
    queryFn: async () => {
      const response = await schoolFetch("/api/classes/grading-configuration");
      if (!response.ok) throw new Error("Failed to load class grading configuration");
      return response.json();
    },
    enabled: !!currentSchoolId,
  });

  const { data: streams } = useQuery<Stream[]>({
    queryKey: [`/api/streams?schoolType=${schoolType}`],
    enabled: !!currentSchool,
  });

  const { data: subjectsResponse } = useQuery<{ items: Subject[]; total: number }>({
    queryKey: ["/api/subjects?perPage=500"],
    staleTime: 0,
  });
  const subjects = subjectsResponse?.items;

  const { data: staff } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
  });

  const { data: allStudents } = useQuery<Student[]>({
    queryKey: ["/api/students"],
  });

  const { data: allClassSubjects } = useQuery<Array<{ id: number; classId: number; subjectId: number }>>({
    queryKey: ["/api/class-subjects/all"],
  });

  const createMutation = useMutation({
    mutationFn: async ({ classData, subjectIds }: { classData: Partial<ClassType>; subjectIds: number[] }) => {
      const res = await apiRequest("POST", "/api/classes", classData);
      const newClass = await res.json() as ClassMutationResponse;
      let gradingConfiguration = newClass.gradingConfiguration;
      if (subjectIds.length > 0) {
        const subjectsResponse = await apiRequest("PUT", `/api/classes/${newClass.id}/subjects`, { subjectIds });
        const subjectsPayload = await subjectsResponse.json();
        gradingConfiguration = subjectsPayload.gradingConfiguration || gradingConfiguration;
      }
      return { ...newClass, gradingConfiguration };
    },
    onSuccess: (createdClass) => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/classes/grading-configuration"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subjects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/class-subjects/all"] });
      setIsAddOpen(false);
      const grading = createdClass.gradingConfiguration;
      toast({
        title: grading?.ready ? "Class added" : "Class added — grading setup required",
        description: grading?.message || "Class added successfully",
        variant: grading && !grading.ready ? "destructive" : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ClassType> }) => {
      const res = await apiRequest("PUT", `/api/classes/${id}`, data);
      return res.json();
    },
    onSuccess: (updatedClass: ClassMutationResponse) => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/classes/grading-configuration"] });
      setEditingClass(null);
      const grading = updatedClass.gradingConfiguration;
      toast({
        title: grading?.ready ? "Class updated" : "Class updated — grading setup required",
        description: grading?.message || "Class updated successfully",
        variant: grading && !grading.ready ? "destructive" : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/classes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/classes/grading-configuration"] });
      setDeleteClass(null);
      toast({ title: "Success", description: "Class deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateSubjectsMutation = useMutation({
    mutationFn: async ({ classId, subjectIds }: { classId: number; subjectIds: number[] }) => {
      const response = await apiRequest("PUT", `/api/classes/${classId}/subjects`, { subjectIds });
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/classes/grading-configuration"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subjects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/class-subjects/all"] });
      const grading = result?.gradingConfiguration as ClassGradingConfiguration | undefined;
      toast({
        title: grading?.ready ? "Class subjects updated" : "Subjects updated — grading setup required",
        description: grading?.message || "Class subjects updated",
        variant: grading && !grading.ready ? "destructive" : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const migrateMutation = useMutation({
    mutationFn: async ({ fromClassId, toClassId, studentIds }: { fromClassId: number; toClassId: number; studentIds?: number[] }) => {
      const res = await apiRequest("POST", `/api/classes/${fromClassId}/migrate`, { toClassId, studentIds });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      setIsMigrateOpen(false);
      setMigrateSourceClassId(null);
      toast({ title: "Success", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getStreamName = (streamId: number | null) => {
    if (!streamId) return "N/A";
    const stream = streams?.find(s => s.id === streamId);
    return stream?.name || "Unknown";
  };

  const getTeacherName = (teacherId: number | null) => {
    if (!teacherId) return "Not assigned";
    const teacher = staff?.find(s => s.id === teacherId);
    return teacher ? `${teacher.firstName} ${teacher.lastName}` : "Unknown";
  };

  const getStudentCount = (classId: number) => {
    return allStudents?.filter(s => s.classId === classId).length ?? 0;
  };

  const getSubjectCount = (classId: number) => {
    return allClassSubjects?.filter(cs => cs.classId === classId).length ?? 0;
  };

  const getStudentsInClass = (classId: number) => {
    return allStudents?.filter(s => s.classId === classId) ?? [];
  };

  const getSubjectsForClass = (classId: number): Subject[] => {
    const csIds = allClassSubjects?.filter(cs => cs.classId === classId).map(cs => cs.subjectId) ?? [];
    return subjects?.filter(s => csIds.includes(s.id)) ?? [];
  };

  const getStreamSortKey = (streamId: number | null) => {
    if (!streamId) return 99;
    const stream = streams?.find(s => s.id === streamId);
    if (!stream) return 99;
    return stream.sortOrder ?? 50;
  };

  const getStreamDisplayName = (streamId: number) => {
    const stream = streams?.find(s => s.id === streamId);
    if (!stream) return "Unknown";
    const name = stream.name.toLowerCase().trim();
    if (name === "form 5") return "Lower 6 (Form 5)";
    if (name === "form 6") return "Upper 6 (Form 6)";
    return stream.name;
  };

  const filteredClasses = classList?.filter(c => {
    const matchesSearch = c.className.toLowerCase().includes(search.toLowerCase()) ||
      (c.shortCode?.toLowerCase().includes(search.toLowerCase()));
    const matchesStream = streamFilter === "all" || c.streamId?.toString() === streamFilter;
    return matchesSearch && matchesStream;
  });

  const groupedByStream = (() => {
    if (!filteredClasses) return [];
    const groups: { streamId: number | null; streamName: string; sortKey: number; classes: ClassType[] }[] = [];
    const map = new Map<string, ClassType[]>();
    for (const c of filteredClasses) {
      const key = String(c.streamId ?? "null");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    map.forEach((classes, key) => {
      const streamId = key === "null" ? null : parseInt(key);
      groups.push({
        streamId,
        streamName: streamId ? getStreamDisplayName(streamId) : "Unassigned",
        sortKey: getStreamSortKey(streamId),
        classes: classes.sort((a: ClassType, b: ClassType) => a.className.localeCompare(b.className)),
      });
    });
    groups.sort((a, b) => a.sortKey - b.sortKey);
    return groups;
  })();

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <School className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-page-title">Classrooms</h1>
            <p className="text-muted-foreground">Manage classes and assign subjects</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => { setMigrateSourceClassId(null); setIsMigrateOpen(true); }} variant="outline" data-testid="button-migrate-students">
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            Migrate Students
          </Button>
          <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-class">
            <Plus className="w-4 h-4 mr-2" />
            Add Class
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search classes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-classes"
              />
            </div>
            <Select value={streamFilter} onValueChange={setStreamFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-stream-filter">
                <SelectValue placeholder="All Streams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Streams</SelectItem>
                {streams
                  ?.slice()
                  .sort((a, b) => (getStreamSortKey(a.id) - getStreamSortKey(b.id)))
                  .map(stream => (
                  <SelectItem key={stream.id} value={stream.id.toString()}>
                    {getStreamDisplayName(stream.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="p-4 sm:p-6">
                <Skeleton className="h-6 w-48 mb-2" />
                <Skeleton className="h-4 w-32 mb-4" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : groupedByStream.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No classes found. Add a class to get started.
        </div>
      ) : (
        <div className="space-y-8">
          {groupedByStream.map(group => (
            <div key={group.streamId ?? "unassigned"} data-testid={`section-stream-${group.streamId ?? "unassigned"}`}>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-lg font-semibold" data-testid={`text-stream-heading-${group.streamId ?? "unassigned"}`}>
                  {group.streamName}
                </h2>
                <Badge variant="outline">{group.classes.length} {group.classes.length === 1 ? "class" : "classes"}</Badge>
                <div className="flex-1 border-t border-border" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {group.classes.map(classItem => (
                  <ClassCard
                    key={classItem.id}
                    classItem={classItem}
                    streamName={group.streamName}
                    teacherName={getTeacherName(classItem.classTeacherId)}
                    studentCount={getStudentCount(classItem.id)}
                    subjectCount={getSubjectCount(classItem.id)}
                    classSubjects={getSubjectsForClass(classItem.id)}
                    classStudents={getStudentsInClass(classItem.id)}
                    gradingConfiguration={gradingConfigurations.find((item) => item.classId === classItem.id)}
                    onEdit={() => setEditingClass(classItem)}
                    onDelete={() => setDeleteClass(classItem)}
                    onMigrate={() => {
                      setMigrateSourceClassId(classItem.id);
                      setIsMigrateOpen(true);
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddClassDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        streams={streams}
        staff={staff}
        subjects={subjects}
        onSubmit={(data, subjectIds) => createMutation.mutate({ classData: { ...data, schoolId: currentSchoolId }, subjectIds })}
        isPending={createMutation.isPending}
      />

      {editingClass && (
        <EditClassDialog
          open={!!editingClass}
          onOpenChange={(open) => !open && setEditingClass(null)}
          classItem={editingClass}
          streams={streams}
          staff={staff}
          subjects={subjects}
          onSubmit={(data) => updateMutation.mutate({ id: editingClass.id, data })}
          onUpdateSubjects={(subjectIds) => updateSubjectsMutation.mutate({ classId: editingClass.id, subjectIds })}
          isPending={updateMutation.isPending || updateSubjectsMutation.isPending}
        />
      )}

      <MigrateStudentsDialog
        open={isMigrateOpen}
        onOpenChange={(open) => {
          setIsMigrateOpen(open);
          if (!open) setMigrateSourceClassId(null);
        }}
        initialFromClassId={migrateSourceClassId}
        classList={classList}
        allStudents={allStudents}
        onMigrate={(fromClassId, toClassId, studentIds) => migrateMutation.mutate({ fromClassId, toClassId, studentIds })}
        isPending={migrateMutation.isPending}
      />

      {deleteClass && (
        <Dialog open={!!deleteClass} onOpenChange={(open) => !open && setDeleteClass(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Class</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{deleteClass.className}"? 
                This action cannot be undone.
                {getStudentCount(deleteClass.id) > 0 && (
                  <span className="block mt-2 text-destructive">
                    Warning: This class has {getStudentCount(deleteClass.id)} student(s). 
                    Consider migrating them first.
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteClass(null)}>Cancel</Button>
              <Button 
                variant="destructive" 
                onClick={() => deleteMutation.mutate(deleteClass.id)}
                disabled={deleteMutation.isPending}
                data-testid="button-confirm-delete"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

interface SubjectManagementResponse {
  all: Subject[];
  selected: string[];
  directSelected: string[];
  removed: string[];
  inheritedSelected: string[];
}

function ClassCard({
  classItem,
  streamName,
  teacherName,
  studentCount,
  subjectCount,
  classSubjects,
  classStudents,
  gradingConfiguration,
  onEdit,
  onDelete,
  onMigrate,
}: {
  classItem: ClassType;
  streamName: string;
  teacherName: string;
  studentCount: number;
  subjectCount: number;
  classSubjects: Subject[];
  classStudents: Student[];
  gradingConfiguration?: ClassGradingConfiguration;
  onEdit: () => void;
  onDelete: () => void;
  onMigrate: () => void;
}) {
  const [showSubjects, setShowSubjects] = useState(false);
  const [showStudents, setShowStudents] = useState(false);

  return (
    <>
      <Card className="hover-elevate" data-testid={`card-class-${classItem.id}`}>
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-start justify-between mb-4 gap-4">
            <div>
              <h3 className="font-semibold text-lg" data-testid={`text-class-name-${classItem.id}`}>
                {classItem.className}
                {classItem.shortCode ? (
                  <span className="text-muted-foreground ml-2">({classItem.shortCode})</span>
                ) : null}
              </h3>
              <p className="text-sm text-muted-foreground">{streamName}</p>
              {gradingConfiguration ? (
                <Badge
                  variant={gradingConfiguration.ready ? "secondary" : "destructive"}
                  className="mt-2"
                  title={gradingConfiguration.message}
                  data-testid={`badge-grading-${classItem.id}`}
                >
                  {gradingConfiguration.ready ? "Grading ready" : "Grading setup needed"}
                </Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className="cursor-pointer"
                onClick={() => setShowSubjects(true)}
                data-testid={`badge-subjects-${classItem.id}`}
              >
                <BookOpen className="w-3 h-3 mr-1" />
                {subjectCount}
              </Badge>
              <Badge
                variant="secondary"
                className="cursor-pointer"
                onClick={() => setShowStudents(true)}
                data-testid={`badge-students-${classItem.id}`}
              >
                <Users className="w-3 h-3 mr-1" />
                {studentCount}
              </Badge>
            </div>
          </div>

          <div className="text-sm text-muted-foreground mb-4 space-y-1">
            <p>Teacher: {teacherName}</p>
            {classItem.capacity ? <p>Capacity: {classItem.capacity}</p> : null}
          </div>

          <div className="flex flex-wrap gap-2 mb-5 min-h-[28px]">
            {classSubjects.slice(0, 3).map((subject) => (
              <Badge key={subject.id} variant="secondary">
                {subject.shortCode || subject.name}
              </Badge>
            ))}
            {classSubjects.length > 3 ? (
              <Badge variant="outline">+{classSubjects.length - 3} more</Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-4 text-sm mb-4">
            <Button
              variant="ghost"
              size="sm"
              className="p-0 h-auto text-primary hover:bg-transparent hover:underline"
              onClick={onEdit}
              data-testid={`button-edit-class-${classItem.id}`}
            >
              <Pencil className="w-3 h-3 mr-1" />
              Edit Details
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="p-0 h-auto text-destructive hover:bg-transparent hover:underline"
              onClick={onDelete}
              data-testid={`button-delete-class-${classItem.id}`}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Delete
            </Button>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={onMigrate}
            data-testid={`button-migrate-${classItem.id}`}
          >
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            Migrate
          </Button>
        </CardContent>
      </Card>

      <Dialog open={showSubjects} onOpenChange={setShowSubjects}>
        <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>{classItem.className.toUpperCase()} SUBJECTS</DialogTitle>
          </DialogHeader>
          <ClassSubjectsDialog
            classId={classItem.id}
            className={classItem.className}
            onClose={() => setShowSubjects(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showStudents} onOpenChange={setShowStudents}>
        <DialogContent className="max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>{classItem.className} - Students ({studentCount})</DialogTitle>
          </DialogHeader>
          {classStudents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No students in this class.</p>
          ) : (
            <div className="space-y-1">
              {classStudents.map((st, i) => (
                <div key={st.id} className="flex items-center gap-3 py-2 px-3 rounded-md bg-muted/50" data-testid={`row-student-${st.id}`}>
                  <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium overflow-hidden shrink-0">
                    {st.photo ? (
                      <img src={st.photo} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span>{st.firstName?.[0]}{st.lastName?.[0]}</span>
                    )}
                  </div>
                  <span className="text-sm font-medium">{st.firstName} {st.lastName}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{st.admissionNo}</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ClassSubjectsDialog({
  classId,
  className,
  onClose,
}: {
  classId: number;
  className: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [selectedSubjects, setSelectedSubjects] = useState<number[]>([]);
  const [directSubjectIds, setDirectSubjectIds] = useState<number[]>([]);
  const [removedSubjectIds, setRemovedSubjectIds] = useState<number[]>([]);
  const [inheritedSubjectIds, setInheritedSubjectIds] = useState<number[]>([]);
  const [subjectSearch, setSubjectSearch] = useState("");

  const { data, isLoading } = useQuery<SubjectManagementResponse>({
    queryKey: ["/api/classes", classId, "subjects"],
  });

  useEffect(() => {
    if (!data) return;
    setSelectedSubjects((data.selected ?? []).map(Number));
    setDirectSubjectIds((data.directSelected ?? []).map(Number));
    setRemovedSubjectIds((data.removed ?? []).map(Number));
    setInheritedSubjectIds((data.inheritedSelected ?? []).map(Number));
    setSubjectSearch("");
  }, [data]);

  const allSubjects = data?.all ?? [];
  const selectedSubjectObjects = allSubjects
    .filter((subject) => selectedSubjects.includes(subject.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const normalizedQuery = subjectSearch.trim().toLowerCase();
  const matchingSubjects = normalizedQuery
    ? allSubjects
        .filter((subject) => !selectedSubjects.includes(subject.id))
        .filter((subject) => {
          const haystack = `${subject.name} ${subject.shortCode ?? ""}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/classes/${classId}/subjects`, {
        subjectIds: selectedSubjects,
        directSubjectIds,
        removedSubjectIds,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/classes"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/class-subjects/all"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/classes", classId, "subjects"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/students"] }),
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "/api/students" && query.queryKey[2] === "subjects" }),
        queryClient.invalidateQueries({ queryKey: ["/api/assessments"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/record-of-marks"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/qc-records/subjects"] }),
      ]);
      toast({ title: "Success", description: `Subjects updated for ${className}` });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const removeSubject = (subjectId: number) => {
    setSelectedSubjects((prev) => prev.filter((id) => id !== subjectId));
    setDirectSubjectIds((prev) => prev.filter((id) => id !== subjectId));
    if (inheritedSubjectIds.includes(subjectId)) {
      setRemovedSubjectIds((prev) => (prev.includes(subjectId) ? prev : [...prev, subjectId]));
    } else {
      setRemovedSubjectIds((prev) => prev.filter((id) => id !== subjectId));
    }
  };

  const addSubject = (subjectId: number) => {
    setSelectedSubjects((prev) => (prev.includes(subjectId) ? prev : [...prev, subjectId]));
    if (inheritedSubjectIds.includes(subjectId)) {
      setRemovedSubjectIds((prev) => prev.filter((id) => id !== subjectId));
    } else {
      setDirectSubjectIds((prev) => (prev.includes(subjectId) ? prev : [...prev, subjectId]));
    }
    setSubjectSearch("");
  };

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="border rounded-md p-3 min-h-[120px] max-h-[300px] overflow-y-auto">
        <div className="flex flex-wrap gap-2">
          {selectedSubjectObjects.map((subject) => (
            <Badge key={subject.id} variant="secondary" className="text-sm py-1.5 px-3 gap-1" data-testid={`badge-class-subject-${subject.id}`}>
              {subject.name} {subject.shortCode ? `(${subject.shortCode})` : ""}
              <button
                type="button"
                onClick={() => removeSubject(subject.id)}
                className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                data-testid={`button-remove-class-subject-${subject.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {selectedSubjectObjects.length === 0 && (
            <p className="text-sm text-muted-foreground">No subjects assigned. Use the search below to add subjects.</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={subjectSearch}
            onChange={(event) => setSubjectSearch(event.target.value)}
            placeholder="Search and add a subject..."
            className="pl-9"
            data-testid="input-search-class-subjects"
          />
        </div>
        {subjectSearch.trim() !== "" ? (
          <div className="border rounded-md bg-popover shadow-sm max-h-48 overflow-y-auto">
            {matchingSubjects.length > 0 ? (
              matchingSubjects.map((subject) => (
                <button
                  key={subject.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                  onClick={() => addSubject(subject.id)}
                  data-testid={`button-add-class-subject-${subject.id}`}
                >
                  {subject.name} {subject.shortCode ? `(${subject.shortCode})` : ""}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">No matching subjects found.</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-submit-class-subjects">
          {saveMutation.isPending ? "Saving..." : "Submit"}
        </Button>
      </div>
    </div>
  );
}

function AddClassDialog({
  open,
  onOpenChange,
  streams,
  staff,
  subjects,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  streams?: Stream[];
  staff?: Staff[];
  subjects?: Subject[];
  onSubmit: (data: Partial<ClassType>, subjectIds: number[]) => void;
  isPending: boolean;
}) {
  const [formData, setFormData] = useState({
    className: "",
    shortCode: "",
    streamId: "",
    classTeacherId: "",
    capacity: "40",
  });
  const [selectedSubjects, setSelectedSubjects] = useState<number[]>([]);
  const [subjectSearch, setSubjectSearch] = useState("");
  const [selectAll, setSelectAll] = useState(false);

  const selectedStreamId = formData.streamId ? parseInt(formData.streamId) : null;

  const streamCompatibleSubjects = subjects?.filter(s => {
    if (!selectedStreamId) return true;
    if (!s.streamIds || s.streamIds.length === 0) return true;
    return s.streamIds.includes(selectedStreamId);
  });

  const filteredSubjects = streamCompatibleSubjects?.filter(s =>
    s.name.toLowerCase().includes(subjectSearch.toLowerCase()) ||
    (s.shortCode?.toLowerCase().includes(subjectSearch.toLowerCase()))
  );

  useEffect(() => {
    if (selectedStreamId && subjects) {
      const streamSubjectIds = subjects
        .filter(s => {
          if (s.streamId === selectedStreamId) return true;
          if (s.streamIds && s.streamIds.includes(selectedStreamId)) return true;
          return false;
        })
        .map(s => s.id);
      const universalSubjectIds = subjects
        .filter(s => (!s.streamIds || s.streamIds.length === 0) && !s.streamId)
        .map(s => s.id);
      setSelectedSubjects(prev => {
        const kept = prev.filter(id => universalSubjectIds.includes(id));
        const merged = new Set([...kept, ...streamSubjectIds]);
        return Array.from(merged);
      });
    } else {
      const compatibleIds = new Set(streamCompatibleSubjects?.map(s => s.id) || []);
      setSelectedSubjects(prev => prev.filter(id => compatibleIds.has(id)));
    }
  }, [selectedStreamId, subjects]);

  const handleToggleSubject = (subjectId: number) => {
    setSelectedSubjects(prev =>
      prev.includes(subjectId)
        ? prev.filter(id => id !== subjectId)
        : [...prev, subjectId]
    );
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedSubjects([]);
    } else {
      setSelectedSubjects(streamCompatibleSubjects?.map(s => s.id) || []);
    }
    setSelectAll(!selectAll);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      className: formData.className,
      shortCode: formData.shortCode || undefined,
      streamId: formData.streamId ? parseInt(formData.streamId) : undefined,
      classTeacherId: formData.classTeacherId ? parseInt(formData.classTeacherId) : undefined,
      capacity: parseInt(formData.capacity) || 40,
    }, selectedSubjects);
    setFormData({ className: "", shortCode: "", streamId: "", classTeacherId: "", capacity: "40" });
    setSelectedSubjects([]);
    setSelectAll(false);
    setSubjectSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add New Class</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="className">Class Name *</Label>
              <Input
                id="className"
                value={formData.className}
                onChange={(e) => setFormData(p => ({ ...p, className: e.target.value }))}
                placeholder="e.g., Form 1 AMBER"
                required
                data-testid="input-class-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shortCode">Short Code</Label>
              <Input
                id="shortCode"
                value={formData.shortCode}
                onChange={(e) => setFormData(p => ({ ...p, shortCode: e.target.value }))}
                placeholder="e.g., 1 AMB"
                data-testid="input-short-code"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="streamId">Stream/Form</Label>
              <Select value={formData.streamId} onValueChange={(v) => setFormData(p => ({ ...p, streamId: v }))}>
                <SelectTrigger data-testid="select-stream">
                  <SelectValue placeholder="Select stream" />
                </SelectTrigger>
                <SelectContent>
                  {streams?.map(stream => (
                    <SelectItem key={stream.id} value={stream.id.toString()}>
                      {stream.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="capacity">Capacity</Label>
              <Input
                id="capacity"
                type="number"
                value={formData.capacity}
                onChange={(e) => setFormData(p => ({ ...p, capacity: e.target.value }))}
                data-testid="input-capacity"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="classTeacherId">Class Teacher</Label>
            <Select value={formData.classTeacherId} onValueChange={(v) => setFormData(p => ({ ...p, classTeacherId: v }))}>
              <SelectTrigger data-testid="select-class-teacher">
                <SelectValue placeholder="Select teacher" />
              </SelectTrigger>
              <SelectContent>
                {staff?.filter(
                  s =>
                      s.role === "teacher" ||
                      s.role === "assistant_teacher" ||
                      s.role === "quality_control_officer"
                  ).map(s => (
                  <SelectItem key={s.id} value={s.id.toString()}>
                    {s.firstName} {s.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Subjects</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="addSelectAll"
                  checked={selectAll}
                  onCheckedChange={() => handleSelectAll()}
                />
                <Label htmlFor="addSelectAll" className="text-sm font-normal cursor-pointer">
                  Select All
                </Label>
              </div>
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search subjects..."
                value={subjectSearch}
                onChange={(e) => setSubjectSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
                data-testid="input-add-search-subjects"
              />
            </div>
            <div className="border rounded-md p-3 min-h-[80px] max-h-[150px] overflow-y-auto">
              <div className="flex flex-wrap gap-2">
                {filteredSubjects?.slice().sort((a, b) => {
                  const aSelected = selectedSubjects.includes(a.id) ? 0 : 1;
                  const bSelected = selectedSubjects.includes(b.id) ? 0 : 1;
                  return aSelected - bSelected;
                }).map(subject => {
                  const isSelected = selectedSubjects.includes(subject.id);
                  return (
                    <Badge
                      key={subject.id}
                      variant={isSelected ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => handleToggleSubject(subject.id)}
                      data-testid={`badge-add-subject-${subject.id}`}
                    >
                      {subject.shortCode || subject.name} ({subject.syllabusCode || ""})
                      {isSelected && <X className="w-3 h-3 ml-1" />}
                    </Badge>
                  );
                })}
                {filteredSubjects?.length === 0 && (
                  <p className="text-sm text-muted-foreground">No subjects found</p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending} data-testid="button-submit-class">
              {isPending ? "Adding..." : "Add Class"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditClassDialog({
  open,
  onOpenChange,
  classItem,
  streams,
  staff,
  subjects,
  onSubmit,
  onUpdateSubjects,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classItem: ClassType;
  streams?: Stream[];
  staff?: Staff[];
  subjects?: Subject[];
  onSubmit: (data: Partial<ClassType>) => void;
  onUpdateSubjects: (subjectIds: number[]) => void;
  isPending: boolean;
}) {
  const [formData, setFormData] = useState({
    className: classItem.className,
    shortCode: classItem.shortCode || "",
    streamId: classItem.streamId?.toString() || "",
    classTeacherId: classItem.classTeacherId?.toString() || "",
    capacity: classItem.capacity?.toString() || "40",
  });
  const [selectedSubjects, setSelectedSubjects] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [subjectSearch, setSubjectSearch] = useState("");

  const { data: classSubjects } = useQuery<SubjectManagementResponse>({
    queryKey: ["/api/classes", classItem.id, "subjects"],
    queryFn: async () => {
      const res = await schoolFetch(`/api/classes/${classItem.id}/subjects`);
      return res.json();
    },
  });

  useEffect(() => {
    if (classSubjects?.selected) {
      setSelectedSubjects(classSubjects.selected.map(Number));
    }
  }, [classSubjects]);

  const editStreamId = classItem.streamId;

  const streamCompatibleSubjects = subjects?.filter(s => {
    if (!editStreamId) return true;
    if (!s.streamIds || s.streamIds.length === 0) return true;
    return s.streamIds.includes(editStreamId);
  });

  const filteredSubjects = streamCompatibleSubjects?.filter(s =>
    s.name.toLowerCase().includes(subjectSearch.toLowerCase()) ||
    (s.shortCode?.toLowerCase().includes(subjectSearch.toLowerCase()))
  );

  const handleToggleSubject = (subjectId: number) => {
    setSelectedSubjects(prev => 
      prev.includes(subjectId) 
        ? prev.filter(id => id !== subjectId)
        : [...prev, subjectId]
    );
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedSubjects([]);
    } else {
      setSelectedSubjects(streamCompatibleSubjects?.map(s => s.id) || []);
    }
    setSelectAll(!selectAll);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      className: formData.className,
      shortCode: formData.shortCode || undefined,
      streamId: formData.streamId ? parseInt(formData.streamId) : undefined,
      classTeacherId: formData.classTeacherId ? parseInt(formData.classTeacherId) : undefined,
      capacity: parseInt(formData.capacity) || 40,
    });
    onUpdateSubjects(selectedSubjects);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Class Details for #{classItem.id}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Class Name</Label>
              <Input
                value={formData.className}
                onChange={(e) => setFormData(p => ({ ...p, className: e.target.value }))}
                data-testid="input-edit-class-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Short Code</Label>
              <Input
                value={formData.shortCode}
                onChange={(e) => setFormData(p => ({ ...p, shortCode: e.target.value }))}
                data-testid="input-edit-short-code"
              />
            </div>
            <div className="space-y-2">
              <Label>Capacity</Label>
              <Input
                type="number"
                value={formData.capacity}
                onChange={(e) => setFormData(p => ({ ...p, capacity: e.target.value }))}
                data-testid="input-edit-capacity"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Subjects</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="editSelectAll"
                  checked={selectAll}
                  onCheckedChange={() => handleSelectAll()}
                />
                <Label htmlFor="editSelectAll" className="text-sm font-normal cursor-pointer">
                  Select All
                </Label>
              </div>
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search subjects..."
                value={subjectSearch}
                onChange={(e) => setSubjectSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
                data-testid="input-edit-search-subjects"
              />
            </div>
            <div className="border rounded-md p-3 min-h-[80px] max-h-[150px] overflow-y-auto">
              <div className="flex flex-wrap gap-2">
                {filteredSubjects?.slice().sort((a, b) => {
                  const aSelected = selectedSubjects.includes(a.id) ? 0 : 1;
                  const bSelected = selectedSubjects.includes(b.id) ? 0 : 1;
                  return aSelected - bSelected;
                }).map(subject => {
                  const isSelected = selectedSubjects.includes(subject.id);
                  return (
                    <Badge
                      key={subject.id}
                      variant={isSelected ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => handleToggleSubject(subject.id)}
                      data-testid={`badge-subject-${subject.id}`}
                    >
                      {subject.shortCode || subject.name} ({subject.syllabusCode || ""})
                      {isSelected && <X className="w-3 h-3 ml-1" />}
                    </Badge>
                  );
                })}
                {filteredSubjects?.length === 0 && (
                  <p className="text-sm text-muted-foreground">No subjects found</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Stream/Form</Label>
              <Select value={formData.streamId} onValueChange={(v) => setFormData(p => ({ ...p, streamId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select stream" />
                </SelectTrigger>
                <SelectContent>
                  {streams?.map(stream => (
                    <SelectItem key={stream.id} value={stream.id.toString()}>
                      {stream.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Class Teacher</Label>
              <Select value={formData.classTeacherId} onValueChange={(v) => setFormData(p => ({ ...p, classTeacherId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select teacher" />
                </SelectTrigger>
                <SelectContent>
                  {staff?.filter(
                    s =>
                        s.role === "teacher" ||
                        s.role === "assistant_teacher" ||
                        s.role === "quality_control_officer"
                    ).map(s => (
                    <SelectItem key={s.id} value={s.id.toString()}>
                      {s.firstName} {s.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending} data-testid="button-save-class">
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MigrateStudentsDialog({
  open,
  onOpenChange,
  initialFromClassId,
  classList,
  allStudents,
  onMigrate,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFromClassId?: number | null;
  classList?: ClassType[];
  allStudents?: Student[];
  onMigrate: (fromClassId: number, toClassId: number, studentIds?: number[]) => void;
  isPending: boolean;
}) {
  const [fromClassId, setFromClassId] = useState("");
  const [toClassId, setToClassId] = useState("");
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);
  const [migrateAll, setMigrateAll] = useState(true);

  useEffect(() => {
    if (!open) return;
    setFromClassId(initialFromClassId ? initialFromClassId.toString() : "");
    setToClassId("");
    setSelectedStudents([]);
    setMigrateAll(true);
  }, [open, initialFromClassId]);

  const studentsInSource = fromClassId
    ? (allStudents?.filter(s => s.classId === parseInt(fromClassId)) ?? [])
    : [];

  const destinationClasses = classList?.filter(c => c.id.toString() !== fromClassId);

  const handleFromClassChange = (value: string) => {
    setFromClassId(value);
    setToClassId("");
    setSelectedStudents([]);
    setMigrateAll(true);
  };

  const handleToggleStudent = (studentId: number) => {
    setSelectedStudents(prev => 
      prev.includes(studentId) 
        ? prev.filter(id => id !== studentId)
        : [...prev, studentId]
    );
  };

  const handleSubmit = () => {
    if (!fromClassId || !toClassId) return;
    onMigrate(
      parseInt(fromClassId),
      parseInt(toClassId),
      migrateAll ? undefined : selectedStudents.length > 0 ? selectedStudents : undefined
    );
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setFromClassId("");
      setToClassId("");
      setSelectedStudents([]);
      setMigrateAll(true);
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Migrate Students Between Classes</DialogTitle>
          <DialogDescription>
            Select a source class and a destination class to move students.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Source Class *</Label>
            <Select value={fromClassId} onValueChange={handleFromClassChange}>
              <SelectTrigger data-testid="select-source-class">
                <SelectValue placeholder="Select source class" />
              </SelectTrigger>
              <SelectContent>
                {classList?.map(c => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.className} {c.shortCode && `(${c.shortCode})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Destination Class *</Label>
            <Select value={toClassId} onValueChange={setToClassId} disabled={!fromClassId}>
              <SelectTrigger data-testid="select-destination-class">
                <SelectValue placeholder="Select destination class" />
              </SelectTrigger>
              <SelectContent>
                {destinationClasses?.map(c => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.className} {c.shortCode && `(${c.shortCode})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {fromClassId && (
            <>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="migrateAll"
                  checked={migrateAll}
                  onCheckedChange={(checked) => setMigrateAll(!!checked)}
                />
                <Label htmlFor="migrateAll" className="cursor-pointer">
                  Migrate all students ({studentsInSource.length})
                </Label>
              </div>

              {!migrateAll && (
                <div className="border rounded-md p-3 max-h-48 overflow-y-auto">
                  {studentsInSource.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No students in this class</p>
                  ) : (
                    <div className="space-y-2">
                      {studentsInSource.map(student => (
                        <div key={student.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`student-${student.id}`}
                            checked={selectedStudents.includes(student.id)}
                            onCheckedChange={() => handleToggleStudent(student.id)}
                          />
                          <Label htmlFor={`student-${student.id}`} className="cursor-pointer text-sm">
                            {student.firstName} {student.lastName} ({student.admissionNo})
                          </Label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button 
            onClick={handleSubmit}
            disabled={!fromClassId || !toClassId || isPending || (!migrateAll && selectedStudents.length === 0)}
            data-testid="button-confirm-migrate"
          >
            {isPending ? "Migrating..." : "Migrate Students"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
