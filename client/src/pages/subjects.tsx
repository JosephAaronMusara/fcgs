import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight, ChevronsUpDown, X, Check, BookOpen } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import type { Subject } from "@shared/schema";
import { getSubjectTypeOptionsForSchool, normalizeExamBoard, normalizeSchoolType, resolveSecondaryGroupingFromStream } from "@shared/academic-profiles";

interface SubjectsResponse {
  items: Subject[];
  total: number;
  page: number;
  perPage: number;
  hasPrev: boolean;
  hasNext: boolean;
}

interface Stream {
  id: number;
  name: string;
  description: string | null;
  schoolType: string | null;
  sortOrder: number | null;
}

interface SchoolInfo {
  id: number;
  schoolType: string | null;
  examinationBoard: string | null;
}

export default function SubjectsPage() {
  const { toast } = useToast();
  const { currentSchoolId } = useAuth();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(() => {
    const stored = localStorage.getItem("subjects_per_page");
    return stored ? parseInt(stored) : 10;
  });
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    localStorage.setItem("subjects_per_page", perPage.toString());
  }, [perPage]);

  const { data, isLoading } = useQuery<SubjectsResponse>({
    queryKey: ["/api/subjects", currentSchoolId, page, perPage, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        perPage: perPage.toString(),
        search: debouncedSearch
      });
      const res = await schoolFetch(`/api/subjects?${params}`);
      if (!res.ok) throw new Error("Failed to fetch subjects");
      return res.json();
    },
  });

  const { data: currentSchool } = useQuery<SchoolInfo>({
    queryKey: ["/api/schools/current", currentSchoolId],
    enabled: !!currentSchoolId,
    queryFn: async () => {
      const res = await schoolFetch("/api/schools/current");
      if (!res.ok) throw new Error("Failed to fetch current school");
      return res.json();
    },
  });
  const schoolType = normalizeSchoolType(currentSchool?.schoolType);
  const examinationBoard = normalizeExamBoard(currentSchool?.examinationBoard);

  const { data: streamsResponse } = useQuery<any>({
    queryKey: ["/api/streams", schoolType, currentSchoolId],
    enabled: !!currentSchool && !!schoolType,
    queryFn: async () => {
      const res = await schoolFetch(`/api/streams?schoolType=${schoolType}`);
      if (!res.ok) throw new Error("Failed to fetch streams");
      return res.json();
    },
  });
  const streams: Stream[] = Array.isArray(streamsResponse)
    ? streamsResponse
    : (streamsResponse?.items ?? []);

  const streamMap = new Map((streams || []).map(s => [s.id, s.name]));

  const createMutation = useMutation({
    mutationFn: async (subjectData: Partial<Subject>) => {
      const res = await apiRequest("POST", "/api/subjects", subjectData);
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/subjects"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/classes"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/class-subjects/all"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/students"] }),
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "/api/classes" && query.queryKey[2] === "subjects" }),
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "/api/students" && query.queryKey[2] === "subjects" }),
        queryClient.invalidateQueries({ queryKey: ["/api/qc-records/subjects"] }),
      ]);
      setIsAddOpen(false);
      toast({ title: "Success", description: "Subject added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, subjectData }: { id: number; subjectData: Partial<Subject> }) => {
      const res = await apiRequest("PUT", `/api/subjects/${id}`, subjectData);
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/subjects"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/classes"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/class-subjects/all"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/students"] }),
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "/api/classes" && query.queryKey[2] === "subjects" }),
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "/api/students" && query.queryKey[2] === "subjects" }),
        queryClient.invalidateQueries({ queryKey: ["/api/qc-records/subjects"] }),
      ]);
      setEditingSubject(null);
      toast({ title: "Success", description: "Subject updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/subjects/${id}`);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/subjects"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/classes"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/class-subjects/all"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/students"] }),
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "/api/classes" && query.queryKey[2] === "subjects" }),
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "/api/students" && query.queryKey[2] === "subjects" }),
        queryClient.invalidateQueries({ queryKey: ["/api/qc-records/subjects"] }),
      ]);
      toast({ title: "Success", description: "Subject deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (formData: { name: string; shortCode: string; syllabusCode?: string; subjectType?: string; description?: string; streamIds?: number[] }) => {
    const allowedSubjectTypes = getSubjectTypeOptionsForSchool(schoolType, examinationBoard);
    const subjectType = formData.subjectType && allowedSubjectTypes.includes(formData.subjectType)
      ? formData.subjectType as NonNullable<Subject["subjectType"]>
      : undefined;
    const subjectData: Partial<Subject> = {
      name: formData.name,
      shortCode: formData.shortCode,
      syllabusCode: formData.syllabusCode || null,
      subjectType,
      description: formData.description || undefined,
      streamIds: formData.streamIds && formData.streamIds.length > 0 ? formData.streamIds : null,
      streamId: formData.streamIds && formData.streamIds.length === 1 ? formData.streamIds[0] : null,
    };

    if (editingSubject) {
      updateMutation.mutate({ id: editingSubject.id, subjectData });
    } else {
      createMutation.mutate(subjectData);
    }
  };

  const subjectsList = data?.items || [];
  const { sortedData: sortedSubjects, sortConfig, requestSort } = useTableSort(subjectsList);
  const subjects = sortedSubjects ?? [];
  const total = data?.total || 0;
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = total === 0 ? 0 : Math.min(page * perPage, total);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <BookOpen className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-subjects-title">School Subjects</h1>
            <p className="text-muted-foreground">Manage academic subjects</p>
          </div>
        </div>
        <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-subject">
          <Plus className="w-4 h-4 mr-2" />
          Add Subject
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative w-full min-w-0 sm:flex-1 sm:min-w-[200px] sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search subjects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                data-testid="input-search-subjects"
              />
            </div>
            <Select value={perPage.toString()} onValueChange={(v) => { setPerPage(parseInt(v)); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-[130px]" data-testid="select-per-page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 / page</SelectItem>
                <SelectItem value="25">25 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead sortKey="name" sortConfig={sortConfig} onSort={requestSort}>Subject Name</SortableTableHead>
                    <SortableTableHead sortKey="shortCode" sortConfig={sortConfig} onSort={requestSort}>Short Code</SortableTableHead>
                    <SortableTableHead sortKey="syllabusCode" sortConfig={sortConfig} onSort={requestSort}>Syllabus Code</SortableTableHead>
                    <SortableTableHead sortKey="type" sortConfig={sortConfig} onSort={requestSort}>Type</SortableTableHead>
                    <SortableTableHead sortKey="streamId" sortConfig={sortConfig} onSort={requestSort}>Stream</SortableTableHead>
                    <SortableTableHead sortKey="description" sortConfig={sortConfig} onSort={requestSort}>Description</SortableTableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subjects.map((s) => (
                    <TableRow key={s.id} data-testid={`row-subject-${s.id}`}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{s.shortCode}</Badge>
                      </TableCell>
                      <TableCell data-testid={`text-syllabus-code-${s.id}`}>
                        {s.syllabusCode || <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell>
                        {s.subjectType ? (
                          <Badge
                            variant={
                              s.subjectType === "Cambridge"
                                ? "default"
                                : s.subjectType === "ZIMSEC"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {s.subjectType}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell data-testid={`text-stream-${s.id}`}>
                        {s.streamIds && s.streamIds.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {s.streamIds.map(sid => (
                              <Badge key={sid} variant="secondary">{streamMap.get(sid) || `Stream #${sid}`}</Badge>
                            ))}
                          </div>
                        ) : s.streamId ? (
                          <Badge variant="secondary">{streamMap.get(s.streamId) || `Stream #${s.streamId}`}</Badge>
                        ) : (
                          <Badge variant="outline">All Streams</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{s.description || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingSubject(s)}
                            data-testid={`button-edit-subject-${s.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm("Are you sure you want to delete this subject?")) {
                                deleteMutation.mutate(s.id);
                              }
                            }}
                            data-testid={`button-delete-subject-${s.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {subjects.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No subjects found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              
              <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
                <span className="text-sm text-muted-foreground" data-testid="text-pagination-info">
                  Showing {start}–{end} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p - 1)}
                    disabled={!data?.hasPrev}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Prev
                  </Button>
                  <span className="text-sm font-medium px-2" data-testid="text-current-page">
                    Page {page}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={!data?.hasNext}
                    data-testid="button-next-page"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <SubjectDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending}
        title="Add Subject"
        streams={streams || []}
        schoolType={schoolType}
        examinationBoard={examinationBoard}
      />

      {editingSubject && (
        <SubjectDialog
          open={true}
          onOpenChange={(open) => !open && setEditingSubject(null)}
          onSubmit={handleSubmit}
          isLoading={updateMutation.isPending}
          title="Edit Subject"
          defaultValues={editingSubject}
          streams={streams || []}
          schoolType={schoolType}
          examinationBoard={examinationBoard}
        />
      )}
    </div>
  );
}

function SubjectDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
  title,
  defaultValues,
  streams,
  schoolType,
  examinationBoard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; shortCode: string; syllabusCode?: string; subjectType?: string; description?: string; streamIds?: number[] }) => void;
  isLoading: boolean;
  title: string;
  defaultValues?: Subject;
  streams: Stream[];
  schoolType: "primary" | "secondary";
  examinationBoard: "ZIMSEC" | "Cambridge";
}) {
  const getDefaultStreamIds = () => {
    if (defaultValues?.streamIds && defaultValues.streamIds.length > 0) return defaultValues.streamIds;
    if (defaultValues?.streamId) return [defaultValues.streamId];
    return [];
  };

  const [formData, setFormData] = useState({
    name: defaultValues?.name || "",
    shortCode: defaultValues?.shortCode || "",
    syllabusCode: defaultValues?.syllabusCode || "",
    subjectType: defaultValues?.subjectType || "",
    description: defaultValues?.description || "",
    selectedStreamIds: getDefaultStreamIds(),
  });

  const subjectTypeOptions = useMemo(() => getSubjectTypeOptionsForSchool(schoolType, examinationBoard), [schoolType, examinationBoard]);

  useEffect(() => {
    if (open) {
      const ids = defaultValues?.streamIds && defaultValues.streamIds.length > 0
        ? defaultValues.streamIds
        : defaultValues?.streamId ? [defaultValues.streamId] : [];
      setFormData({
        name: defaultValues?.name || "",
        shortCode: defaultValues?.shortCode || "",
        syllabusCode: defaultValues?.syllabusCode || "",
        subjectType: defaultValues?.subjectType || "",
        description: defaultValues?.description || "",
        selectedStreamIds: ids,
      });
    }
  }, [open, defaultValues]);

  const isAllStreams = formData.selectedStreamIds.length === 0;

  const toggleOption = (value: string) => {
    if (value === "all") {
      setFormData(p => ({ ...p, selectedStreamIds: [] }));
    } else {
      const id = parseInt(value);
      setFormData(p => {
        const wasAll = p.selectedStreamIds.length === 0;
        if (wasAll) {
          return { ...p, selectedStreamIds: [id] };
        }
        return {
          ...p,
          selectedStreamIds: p.selectedStreamIds.includes(id)
            ? p.selectedStreamIds.filter(sid => sid !== id)
            : [...p.selectedStreamIds, id],
        };
      });
    }
  };

  const removeTag = (id: number) => {
    setFormData(p => ({
      ...p,
      selectedStreamIds: p.selectedStreamIds.filter(sid => sid !== id),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (schoolType === "secondary" && !formData.subjectType) {
      return;
    }

    if (schoolType === "secondary" && formData.selectedStreamIds.length > 0) {
      const selectedStreams = streams.filter((stream) => formData.selectedStreamIds.includes(stream.id));
      const levelGroups = new Set(selectedStreams.map((stream) => resolveSecondaryGroupingFromStream(stream.name)).filter(Boolean));
      if (levelGroups.size > 1) {
        return;
      }
    }

    onSubmit({
      ...formData,
      subjectType: formData.subjectType || undefined,
      streamIds: formData.selectedStreamIds,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Subject Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g., Mathematics"
                required
                data-testid="input-subject-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shortCode">Short Code</Label>
              <Input
                id="shortCode"
                value={formData.shortCode}
                onChange={(e) => setFormData(p => ({ ...p, shortCode: e.target.value }))}
                placeholder="e.g., MAT"
                required
                data-testid="input-short-code"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="syllabusCode">Syllabus Code</Label>
            <Input
              id="syllabusCode"
              value={formData.syllabusCode}
              onChange={(e) => setFormData(p => ({ ...p, syllabusCode: e.target.value }))}
              placeholder="e.g., 4030"
              data-testid="input-syllabus-code"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="subjectType">Subject Type{schoolType === "secondary" ? "" : " (Optional)"}</Label>
              <Select 
                value={formData.subjectType || "none"} 
                onValueChange={(v) => setFormData(p => ({ ...p, subjectType: v === "none" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-subject-type">
                  <SelectValue placeholder={schoolType === "secondary" ? "Select subject type" : "Subject Type (Optional)"} />
                </SelectTrigger>
                <SelectContent>
                  {schoolType === "primary" && (
                    <SelectItem value="none">Subject Type (Optional)</SelectItem>
                  )}
                  {schoolType === "secondary" && !formData.subjectType && (
                    <SelectItem value="none">Select subject type</SelectItem>
                  )}
                  {subjectTypeOptions.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Streams</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal h-auto min-h-[2.5rem]" data-testid="select-stream">
                    <div className="flex flex-wrap gap-1 flex-1">
                      {isAllStreams ? (
                        <Badge variant="secondary" className="flex items-center gap-1" data-testid="tag-stream-all">
                          All Streams
                          <X className="h-3 w-3 cursor-pointer" onClick={(e) => { e.stopPropagation(); }} />
                        </Badge>
                      ) : (
                        formData.selectedStreamIds.map(sid => {
                          const stream = streams.find(s => s.id === sid);
                          return stream ? (
                            <Badge key={sid} variant="secondary" className="flex items-center gap-1" data-testid={`tag-stream-${sid}`}>
                              {stream.name}
                              <X className="h-3 w-3 cursor-pointer" onClick={(e) => { e.stopPropagation(); removeTag(sid); }} />
                            </Badge>
                          ) : null;
                        })
                      )}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search streams..." />
                    <CommandList>
                      <CommandEmpty>No streams found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="all" onSelect={() => toggleOption("all")} data-testid="option-stream-all">
                          <Check className={`mr-2 h-4 w-4 ${isAllStreams ? "opacity-100" : "opacity-0"}`} />
                          All Streams
                        </CommandItem>
                        {streams.map(stream => (
                          <CommandItem
                            key={stream.id}
                            value={stream.name}
                            onSelect={() => toggleOption(stream.id.toString())}
                            data-testid={`option-stream-${stream.id}`}
                          >
                            <Check className={`mr-2 h-4 w-4 ${!isAllStreams && formData.selectedStreamIds.includes(stream.id) ? "opacity-100" : "opacity-0"}`} />
                            {stream.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
              placeholder="Brief description"
              data-testid="input-description"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} data-testid="button-save-subject">
              {isLoading ? "Saving..." : defaultValues ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
