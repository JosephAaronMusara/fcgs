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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight, X, FileText } from "lucide-react";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import { useAuth } from "@/lib/auth";
import type { Grade, Class as ClassType, School } from "@shared/schema";
import { getGradeProfileLabel, getGradeTypeOptionsForProfile, getGradingProfilesForSchool, isEcdStream, normalizeExamBoard, normalizeSchoolType, resolvePrimaryGroupingFromStream, resolveSecondaryGroupingFromStream, type GradeProfileKey } from "@shared/academic-profiles";


interface Stream {
  id: number;
  name: string;
  description: string | null;
  schoolType: string | null;
  sortOrder: number | null;
}

interface GradesResponse {
  items: Grade[];
  total: number;
  page: number;
  perPage: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export default function GradesPage() {
  const { toast } = useToast();
  const { currentSchoolId } = useAuth();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage] = useState(10);
  const [activeTab, setActiveTab] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingGrade, setEditingGrade] = useState<Grade | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: school } = useQuery<School>({
    queryKey: ["/api/schools/current", currentSchoolId],
    enabled: !!currentSchoolId,
    queryFn: async () => {
      const res = await schoolFetch("/api/schools/current");
      if (!res.ok) throw new Error("Failed to fetch current school");
      return res.json();
    },
  });

  const { data: classesResponse } = useQuery<any>({
    queryKey: ["/api/classes", currentSchoolId],
    enabled: !!currentSchoolId,
    queryFn: async () => {
      const res = await schoolFetch("/api/classes");
      if (!res.ok) throw new Error("Failed to fetch classes");
      return res.json();
    },
  });
  const classes: ClassType[] = Array.isArray(classesResponse)
    ? classesResponse
    : (classesResponse?.items ?? []);

  const schoolType = normalizeSchoolType(school?.schoolType);
  const examinationBoard = normalizeExamBoard(school?.examinationBoard);
  const gradingProfiles = useMemo(() => getGradingProfilesForSchool(schoolType, examinationBoard), [schoolType, examinationBoard]);

  const { data: streamsResponse } = useQuery<any>({
    queryKey: ["/api/streams", schoolType, currentSchoolId],
    enabled: !!schoolType,
    queryFn: async () => {
      const res = await schoolFetch(`/api/streams?schoolType=${schoolType}`);
      if (!res.ok) throw new Error("Failed to fetch streams");
      return res.json();
    },
  });
  const streams: Stream[] = Array.isArray(streamsResponse)
    ? streamsResponse
    : (streamsResponse?.items ?? []);

  useEffect(() => {
    if (!activeTab && gradingProfiles.length > 0) {
      setActiveTab(gradingProfiles[0].key);
    }
  }, [activeTab, gradingProfiles]);

  const { data, isLoading, refetch } = useQuery<GradesResponse>({
    queryKey: ["/api/grades", currentSchoolId, page, perPage, debouncedSearch, activeTab],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        perPage: perPage.toString(),
        search: debouncedSearch,
        gradeLevel: activeTab
      });
      const res = await schoolFetch(`/api/grades?${params}`);
      if (!res.ok) throw new Error("Failed to fetch grades");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (gradeData: Partial<Grade>) => {
      const res = await apiRequest("POST", "/api/grades", gradeData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/grades"] });
      setIsAddOpen(false);
      toast({ title: "Success", description: "Grade added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, gradeData }: { id: number; gradeData: Partial<Grade> }) => {
      const res = await apiRequest("PUT", `/api/grades/${id}`, gradeData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/grades"] });
      setEditingGrade(null);
      toast({ title: "Success", description: "Grade updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/grades/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/grades"] });
      toast({ title: "Success", description: "Grade deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (formData: {
    gradeName: string;
    gradeLevel: GradeProfileKey;
    classIds: number[];
    appliesAll: boolean;
    lowerLimit: number;
    upperLimit: number;
    gradePoints?: string;
    gradeStatus?: string;
    gradeType?: string;
  }) => {
    const gradeData = {
      ...formData,
      gradePoints: formData.gradePoints || undefined,
      gradeStatus: formData.gradeStatus || undefined,
      gradeType: formData.gradeType || undefined,
    };

    if (editingGrade) {
      updateMutation.mutate({ id: editingGrade.id, gradeData });
    } else {
      createMutation.mutate(gradeData);
    }
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setPage(1);
  };

  const tabLabels = Object.fromEntries(gradingProfiles.map((profile) => [profile.key, profile.label]));

  const gradesList = data?.items || [];
  const { sortedData: sortedGrades, sortConfig, requestSort } = useTableSort(gradesList);
  const grades = sortedGrades ?? [];
  const total = data?.total || 0;
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = total === 0 ? 0 : Math.min(page * perPage, total);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-grades-title">Grading System</h1>
            <p className="text-muted-foreground">Define assessment grade boundaries and points</p>
          </div>
        </div>
        <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-grade">
          <Plus className="w-4 h-4 mr-2" />
          Add Grade
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search grades..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                data-testid="input-search-grades"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="mb-4 flex flex-wrap h-auto justify-start">
              {gradingProfiles.map((profile) => (
                <TabsTrigger key={profile.key} value={profile.key} data-testid={`tab-${profile.key}`}>
                  {profile.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value={activeTab}>
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
                        <SortableTableHead sortKey="grade" sortConfig={sortConfig} onSort={requestSort}>Grade</SortableTableHead>
                        <SortableTableHead sortKey="points" sortConfig={sortConfig} onSort={requestSort}>Points</SortableTableHead>
                        <SortableTableHead sortKey="status" sortConfig={sortConfig} onSort={requestSort}>Status</SortableTableHead>
                        <SortableTableHead sortKey="gradeType" sortConfig={sortConfig} onSort={requestSort}>Type</SortableTableHead>
                        <SortableTableHead sortKey="minPercentage" sortConfig={sortConfig} onSort={requestSort}>Range</SortableTableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grades.map((g) => (
                        <TableRow key={g.id} data-testid={`row-grade-${g.id}`}>
                          <TableCell>
                            <div>
                              <span className="font-bold text-lg">{g.gradeName}</span>
                              {g.gradeStatus && (
                                <span className="text-muted-foreground ml-2">({g.gradeStatus})</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{g.gradePoints || "-"}</TableCell>
                          <TableCell>
                            {g.gradeStatus && (
                              <Badge
                                variant={g.gradeStatus === "PASS" ? "default" : "secondary"}
                              >
                                {g.gradeStatus}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{g.gradeType || "-"}</TableCell>
                          <TableCell>
                            {g.lowerLimit}% - {g.upperLimit}%
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingGrade(g)}
                                data-testid={`button-edit-grade-${g.id}`}
                              >
                                <Pencil className="w-4 h-4 mr-1" />
                                Edit Grade
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive"
                                onClick={() => {
                                  if (confirm("Are you sure you want to delete this grade?")) {
                                    deleteMutation.mutate(g.id);
                                  }
                                }}
                                data-testid={`button-delete-grade-${g.id}`}
                              >
                                <Trash2 className="w-4 h-4 mr-1" />
                                Delete Grade
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {grades.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            No grades found for {tabLabels[activeTab as keyof typeof tabLabels]}
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
                      </Button>
                      <span className="text-sm font-medium px-2" data-testid="text-current-page">
                        {page}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => p + 1)}
                        disabled={!data?.hasNext}
                        data-testid="button-next-page"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <GradeDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending}
        title="Add Grade"
        classes={classes || []}
        streams={streams}
        defaultGradeLevel={activeTab as GradeProfileKey}
        examinationBoard={examinationBoard}
        schoolType={schoolType}
        profileLabel={tabLabels[activeTab] || getGradeProfileLabel(activeTab)}
      />

      {editingGrade && (
        <GradeDialog
          open={true}
          onOpenChange={(open) => !open && setEditingGrade(null)}
          onSubmit={handleSubmit}
          isLoading={updateMutation.isPending}
          title={`Assessment Grade Details for #${editingGrade.id}`}
          defaultValues={editingGrade}
          classes={classes || []}
          streams={streams}
          defaultGradeLevel={(editingGrade.gradeLevel || activeTab) as GradeProfileKey}
          examinationBoard={examinationBoard}
          schoolType={schoolType}
          profileLabel={getGradeProfileLabel(editingGrade.gradeLevel || activeTab)}
        />
      )}
    </div>
  );
}

function GradeDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
  title,
  defaultValues,
  classes,
  streams,
  defaultGradeLevel,
  examinationBoard,
  schoolType,
  profileLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    gradeName: string;
    gradeLevel: GradeProfileKey;
    classIds: number[];
    appliesAll: boolean;
    lowerLimit: number;
    upperLimit: number;
    gradePoints?: string;
    gradeStatus?: string;
    gradeType?: string;
  }) => void;
  isLoading: boolean;
  title: string;
  defaultValues?: Grade;
  classes: ClassType[];
  streams: Stream[];
  defaultGradeLevel: GradeProfileKey;
  examinationBoard: string;
  schoolType: "primary" | "secondary";
  profileLabel: string;
}) {
  const [formData, setFormData] = useState({
    gradeName: defaultValues?.gradeName || "",
    gradeLevel: defaultValues?.gradeLevel || defaultGradeLevel,
    classIds: (defaultValues?.classIds as number[]) || [],
    appliesAll: defaultValues?.appliesAll || false,
    lowerLimit: defaultValues?.lowerLimit?.toString() || "",
    upperLimit: defaultValues?.upperLimit?.toString() || "",
    gradePoints: defaultValues?.gradePoints || "",
    gradeStatus: defaultValues?.gradeStatus || "",
    gradeType: defaultValues?.gradeType || "",
  });

  useEffect(() => {
    if (open) {
      setFormData({
        gradeName: defaultValues?.gradeName || "",
        gradeLevel: defaultValues?.gradeLevel || defaultGradeLevel,
        classIds: (defaultValues?.classIds as number[]) || [],
        appliesAll: defaultValues?.appliesAll || false,
        lowerLimit: defaultValues?.lowerLimit?.toString() || "",
        upperLimit: defaultValues?.upperLimit?.toString() || "",
        gradePoints: defaultValues?.gradePoints || "",
        gradeStatus: defaultValues?.gradeStatus || "",
        gradeType: defaultValues?.gradeType || "",
      });
    }
  }, [open, defaultValues, defaultGradeLevel]);

  const streamMap = useMemo(() => new Map(streams.map((stream) => [stream.id, stream.name])), [streams]);

  const allowedClasses = useMemo(() => {
    return classes.filter((klass) => {
      const streamName = streamMap.get(klass.streamId ?? -1);
      if (!streamName) return false;
      switch (formData.gradeLevel) {
        case "SEC_ZIM_A":
        case "SEC_CAM_A":
        case "A_Level":
          return resolveSecondaryGroupingFromStream(streamName) === "ADVANCED";
        case "SEC_ZIM_O":
        case "SEC_CAM_O":
        case "SEC_CAM_IGCSE":
        case "O_Level":
        case "IGCSE":
          return resolveSecondaryGroupingFromStream(streamName) === "LOWER";
        case "PRI_ZIM_ECD":
        case "PRI_CAM_ECD":
          return isEcdStream(streamName);
        case "PRI_ZIM_G12":
        case "PRI_CAM_G12":
          return resolvePrimaryGroupingFromStream(streamName) === "G12";
        case "PRI_ZIM_G37":
        case "PRI_CAM_G37":
          return resolvePrimaryGroupingFromStream(streamName) === "G37";
        default:
          return true;
      }
    });
  }, [classes, formData.gradeLevel, streamMap]);

  const allowedClassIds = useMemo(() => new Set(allowedClasses.map((klass) => klass.id)), [allowedClasses]);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      classIds: prev.classIds.filter((id) => allowedClassIds.has(id)),
      gradeType: getGradeTypeOptionsForProfile(prev.gradeLevel, schoolType, examinationBoard).includes(prev.gradeType) ? prev.gradeType : "",
    }));
  }, [allowedClassIds, schoolType, examinationBoard]);

  const gradeTypeOptions = useMemo(
    () => getGradeTypeOptionsForProfile(formData.gradeLevel, schoolType, examinationBoard),
    [formData.gradeLevel, schoolType, examinationBoard],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      gradeName: formData.gradeName,
      gradeLevel: formData.gradeLevel as GradeProfileKey,
      classIds: formData.appliesAll ? [] : formData.classIds.filter((id) => allowedClassIds.has(id)),
      appliesAll: formData.appliesAll,
      lowerLimit: Number(formData.lowerLimit),
      upperLimit: Number(formData.upperLimit),
      gradePoints: formData.gradePoints || undefined,
      gradeStatus: formData.gradeStatus || undefined,
      gradeType: formData.gradeType || undefined,
    });
  };

  const toggleClass = (classId: number) => {
    setFormData(p => ({
      ...p,
      classIds: p.classIds.includes(classId)
        ? p.classIds.filter(id => id !== classId)
        : [...p.classIds, classId]
    }));
  };

  const removeClassId = (classId: number) => {
    setFormData(p => ({
      ...p,
      classIds: p.classIds.filter(id => id !== classId)
    }));
  };

  const selectedClasses = allowedClasses.filter(c => formData.classIds.includes(c.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-muted-foreground">{profileLabel}</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="gradeName">Grade Name (e.g., A, B, C or 1, 2...)</Label>
              <Input
                id="gradeName"
                value={formData.gradeName}
                onChange={(e) => setFormData(p => ({ ...p, gradeName: e.target.value }))}
                placeholder="A"
                maxLength={16}
                required
                data-testid="input-grade-name"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Class(es)</Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="appliesAll"
                    checked={formData.appliesAll}
                    onCheckedChange={(checked) => setFormData(p => ({ ...p, appliesAll: !!checked }))}
                    data-testid="checkbox-applies-all"
                  />
                  <Label htmlFor="appliesAll" className="text-sm font-normal">All</Label>
                </div>
              </div>
              {!formData.appliesAll && (
                <div className="border rounded-md p-2 min-h-[80px] max-h-[120px] overflow-y-auto">
                  <div className="flex flex-wrap gap-1 mb-2">
                    {selectedClasses.map(c => (
                      <Badge key={c.id} variant="secondary" className="gap-1">
                        {c.className}
                        <X 
                          className="w-3 h-3 cursor-pointer" 
                          onClick={() => removeClassId(c.id)}
                        />
                      </Badge>
                    ))}
                  </div>
                  <Select onValueChange={(v) => toggleClass(parseInt(v))}>
                    <SelectTrigger data-testid="select-classes">
                      <SelectValue placeholder="Add class..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedClasses.filter(c => !formData.classIds.includes(c.id)).map(c => (
                        <SelectItem key={c.id} value={c.id.toString()}>
                          {c.className}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lowerLimit">Lower Limit (%)</Label>
              <Input
                id="lowerLimit"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={formData.lowerLimit}
                onChange={(e) => setFormData(p => ({ ...p, lowerLimit: e.target.value }))}
                placeholder="e.g., 70"
                required
                data-testid="input-lower-limit"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="upperLimit">Upper Limit (%)</Label>
              <Input
                id="upperLimit"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={formData.upperLimit}
                onChange={(e) => setFormData(p => ({ ...p, upperLimit: e.target.value }))}
                placeholder="e.g., 100"
                required
                data-testid="input-upper-limit"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="gradePoints">Grade Points</Label>
              <Input
                id="gradePoints"
                type="number"
                min="0"
                step="1"
                value={formData.gradePoints}
                onChange={(e) => setFormData(p => ({ ...p, gradePoints: e.target.value }))}
                placeholder="e.g., 5"
                data-testid="input-grade-points"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gradeStatus">Grade Status</Label>
              <Select 
                value={formData.gradeStatus || "none"} 
                onValueChange={(v) => setFormData(p => ({ ...p, gradeStatus: v === "none" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-grade-status">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select...</SelectItem>
                  <SelectItem value="PASS">PASS</SelectItem>
                  <SelectItem value="FAIL">FAIL</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gradeType">Grade Type (Optional)</Label>
            <Select 
              value={formData.gradeType || "none"} 
              onValueChange={(v) => setFormData(p => ({ ...p, gradeType: v === "none" ? "" : v }))}
            >
              <SelectTrigger data-testid="select-grade-type">
                <SelectValue placeholder="Grade Type (Optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Grade Type (Optional)</SelectItem>
                {gradeTypeOptions.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} data-testid="button-save-grade">
              {isLoading ? "Saving..." : defaultValues ? "Update" : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
