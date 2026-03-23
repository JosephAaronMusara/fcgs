
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Trash2, Users, Building, ArrowRightLeft } from "lucide-react";
import type { Hostel, Student, Stream, Staff } from "@shared/schema";

export default function HostelsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [streamFilter, setStreamFilter] = useState<string>("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingHostel, setEditingHostel] = useState<Hostel | null>(null);
  const [deleteHostel, setDeleteHostel] = useState<Hostel | null>(null);
  const [isManageOpen, setIsManageOpen] = useState(false);

  const { data: hostelList, isLoading } = useQuery<Hostel[]>({
    queryKey: ["/api/hostels"],
  });

  const { data: allStudents = [] } = useQuery<Student[]>({
    queryKey: ["/api/students"],
  });

  const { data: streams = [] } = useQuery<Stream[]>({
    queryKey: ["/api/streams"],
  });

  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<Hostel>) => {
      const res = await apiRequest("POST", "/api/hostels", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hostels"] });
      setIsAddOpen(false);
      toast({ title: "Success", description: "Hostel added successfully" });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Hostel> }) => {
      const res = await apiRequest("PUT", `/api/hostels/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hostels"] });
      setEditingHostel(null);
      toast({ title: "Success", description: "Hostel updated successfully" });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/hostels/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hostels"] });
      setDeleteHostel(null);
      toast({ title: "Success", description: "Hostel deleted successfully" });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const getStudentCount = (hostelId: number) => allStudents.filter((s) => s.hostelId === hostelId && s.isBoarding).length;
  const getStreamName = (streamId: number | null | undefined) => streams.find((s) => s.id === streamId)?.name || "Unassigned";
  const getHostelMasterName = (staffId: number | null | undefined) => {
    const member = staff.find((s) => s.id === staffId);
    return member ? `${member.firstName} ${member.lastName}` : "Not assigned";
  };

  const filteredHostels = useMemo(() => {
    return (hostelList || []).filter((h) => {
      const matchesSearch = h.name.toLowerCase().includes(search.toLowerCase());
      const matchesStream = streamFilter === "all" || h.streamId?.toString() === streamFilter;
      return matchesSearch && matchesStream;
    });
  }, [hostelList, search, streamFilter]);

  const groupedByStream = useMemo(() => {
    const groups = new Map<string, Hostel[]>();
    for (const hostel of filteredHostels) {
      const key = String(hostel.streamId || "null");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(hostel);
    }
    return Array.from(groups.entries()).map(([key, hostels]) => ({
      streamId: key === "null" ? null : parseInt(key),
      streamName: key === "null" ? "Unassigned" : getStreamName(parseInt(key)),
      hostels: hostels.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [filteredHostels, streams]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Building className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-page-title">Boarding Hostels</h1>
            <p className="text-muted-foreground">Manage hostel cards, boarding master/matron assignment, streams, and boarders.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => setIsManageOpen(true)} variant="outline" data-testid="button-manage-hostel-students">
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            Manage Students
          </Button>
          <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-hostel">
            <Plus className="w-4 h-4 mr-2" />
            Add Hostel
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search hostels..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-hostels"
              />
            </div>
            <Select value={streamFilter} onValueChange={setStreamFilter}>
              <SelectTrigger className="w-full sm:w-[220px]" data-testid="select-hostel-stream-filter">
                <SelectValue placeholder="Filter by stream" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Streams</SelectItem>
                {streams.map((stream) => (
                  <SelectItem key={stream.id} value={stream.id.toString()}>
                    {stream.name}
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
              <CardContent className="p-6">
                <Skeleton className="h-6 w-48 mb-2" />
                <Skeleton className="h-4 w-32 mb-4" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : groupedByStream.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Building className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No hostels found. Add a hostel to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedByStream.map((group) => (
            <div key={String(group.streamId)}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold" data-testid={`text-stream-group-${String(group.streamId)}`}>{group.streamName}</h2>
                <Badge variant="outline">{group.hostels.length} hostel{group.hostels.length === 1 ? "" : "s"}</Badge>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.hostels.map((hostel) => {
                  const studentCount = getStudentCount(hostel.id);
                  const capacity = hostel.capacity || 0;
                  const occupancyText = capacity > 0 ? `${studentCount}/${capacity}` : `${studentCount}`;
                  return (
                    <Card key={hostel.id} className="hover-elevate" data-testid={`card-hostel-${hostel.id}`}>
                      <CardContent className="p-6">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold text-lg">{hostel.name}</h3>
                            <p className="text-sm text-muted-foreground">{getStreamName(hostel.streamId)}</p>
                          </div>
                          <Badge variant="secondary">
                            <Users className="w-3 h-3 mr-1" />
                            {studentCount}
                          </Badge>
                        </div>

                        <div className="space-y-1 text-sm text-muted-foreground mb-4">
                          <p>Boarding Master / Matron: {getHostelMasterName(hostel.hostelMasterId)}</p>
                          <p>Occupancy: {occupancyText}</p>
                          {hostel.gender && <p className="capitalize">Gender: {hostel.gender}</p>}
                          {hostel.description && <p className="pt-1">{hostel.description}</p>}
                        </div>

                        <div className="flex flex-wrap gap-3">
                          <Button variant="ghost" size="sm" className="p-0 h-auto text-primary hover:underline" onClick={() => setEditingHostel(hostel)} data-testid={`button-edit-hostel-${hostel.id}`}>
                            <Pencil className="w-3 h-3 mr-1" />
                            Edit Details
                          </Button>
                          <Button variant="ghost" size="sm" className="p-0 h-auto text-destructive hover:underline" onClick={() => setDeleteHostel(hostel)} data-testid={`button-delete-hostel-${hostel.id}`}>
                            <Trash2 className="w-3 h-3 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <HostelFormDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        title="Add New Hostel"
        streams={streams}
        staff={staff}
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
      />

      {editingHostel && (
        <HostelFormDialog
          open={!!editingHostel}
          onOpenChange={(open) => !open && setEditingHostel(null)}
          title="Edit Hostel"
          defaultValues={editingHostel}
          streams={streams}
          staff={staff}
          onSubmit={(data) => updateMutation.mutate({ id: editingHostel.id, data })}
          isPending={updateMutation.isPending}
        />
      )}

      <ManageHostelStudentsDialog
        open={isManageOpen}
        onOpenChange={setIsManageOpen}
        hostelList={hostelList || []}
        allStudents={allStudents}
      />

      {deleteHostel && (
        <Dialog open={!!deleteHostel} onOpenChange={(open) => !open && setDeleteHostel(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Hostel</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{deleteHostel.name}"?
                This action cannot be undone.
                {getStudentCount(deleteHostel.id) > 0 && (
                  <span className="block mt-2 text-destructive">
                    This hostel has {getStudentCount(deleteHostel.id)} assigned student(s). Reassign or remove them first.
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteHostel(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => deleteMutation.mutate(deleteHostel.id)} disabled={deleteMutation.isPending} data-testid="button-confirm-delete">
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function HostelFormDialog({
  open,
  onOpenChange,
  title,
  defaultValues,
  streams,
  staff,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  defaultValues?: Hostel;
  streams: Stream[];
  staff: Staff[];
  onSubmit: (data: Partial<Hostel>) => void;
  isPending: boolean;
}) {
  const [formData, setFormData] = useState({
    name: "",
    capacity: "",
    gender: "",
    streamId: "",
    hostelMasterId: "",
    description: "",
  });

  useEffect(() => {
    setFormData({
      name: defaultValues?.name || "",
      capacity: defaultValues?.capacity?.toString() || "",
      gender: defaultValues?.gender || "",
      streamId: defaultValues?.streamId?.toString() || "",
      hostelMasterId: defaultValues?.hostelMasterId?.toString() || "",
      description: defaultValues?.description || "",
    });
  }, [defaultValues, open]);

  const eligibleStaff = staff.filter((s) => ["teacher", "head_of_department", "deputy_headmaster", "headmaster", "matron", "master"].includes((s.role || "").toLowerCase()) || true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: formData.name.trim(),
      capacity: formData.capacity ? parseInt(formData.capacity) : undefined,
      gender: (formData.gender || undefined) as any,
      streamId: formData.streamId ? parseInt(formData.streamId) : undefined,
      hostelMasterId: formData.hostelMasterId ? parseInt(formData.hostelMasterId) : undefined,
      description: formData.description || undefined,
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
              <Label htmlFor="name">Hostel Name *</Label>
              <Input id="name" value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} required data-testid="input-hostel-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="capacity">Capacity</Label>
              <Input id="capacity" type="number" value={formData.capacity} onChange={(e) => setFormData((p) => ({ ...p, capacity: e.target.value }))} data-testid="input-hostel-capacity" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Select value={formData.gender} onValueChange={(v) => setFormData((p) => ({ ...p, gender: v }))}>
                <SelectTrigger data-testid="select-hostel-gender"><SelectValue placeholder="Select gender" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Boys</SelectItem>
                  <SelectItem value="female">Girls</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="streamId">Stream</Label>
              <Select value={formData.streamId || "__none"} onValueChange={(v) => setFormData((p) => ({ ...p, streamId: v === "__none" ? "" : v }))}>
                <SelectTrigger data-testid="select-hostel-stream"><SelectValue placeholder="Select stream" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {streams.map((stream) => (
                    <SelectItem key={stream.id} value={stream.id.toString()}>{stream.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hostelMasterId">Boarding Master / Matron</Label>
            <Select value={formData.hostelMasterId || "__none"} onValueChange={(v) => setFormData((p) => ({ ...p, hostelMasterId: v === "__none" ? "" : v }))}>
              <SelectTrigger data-testid="select-hostel-master"><SelectValue placeholder="Select staff member" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {eligibleStaff.map((member) => (
                  <SelectItem key={member.id} value={member.id.toString()}>{member.firstName} {member.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={formData.description} onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))} data-testid="input-hostel-description" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending} data-testid="button-submit-hostel">
              {isPending ? "Saving..." : defaultValues ? "Update Hostel" : "Add Hostel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManageHostelStudentsDialog({
  open,
  onOpenChange,
  hostelList,
  allStudents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostelList: Hostel[];
  allStudents: Student[];
}) {
  const { toast } = useToast();
  const [selectedHostelId, setSelectedHostelId] = useState("");
  const [mode, setMode] = useState<"assign" | "remove">("assign");
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);

  useEffect(() => {
    if (!open) {
      setSelectedHostelId("");
      setMode("assign");
      setStudentSearch("");
      setSelectedStudents([]);
    }
  }, [open]);

  const targetHostelId = selectedHostelId ? parseInt(selectedHostelId) : null;

  const boarders = useMemo(() => {
    const q = studentSearch.toLowerCase().trim();
    return allStudents.filter((student) => {
      if (!student.isBoarding || student.isDayScholar) return false;
      const name = `${student.firstName} ${student.lastName} ${student.admissionNo}`.toLowerCase();
      const matchesSearch = !q || name.includes(q);
      if (!targetHostelId) return matchesSearch;
      if (mode === "assign") return matchesSearch && student.hostelId !== targetHostelId;
      return matchesSearch && student.hostelId === targetHostelId;
    });
  }, [allStudents, studentSearch, targetHostelId, mode]);

  const toggleStudent = (studentId: number) => {
    setSelectedStudents((prev) => prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]);
  };

  const manageMutation = useMutation({
    mutationFn: async () => {
      if (!targetHostelId) throw new Error("Select a hostel");
      const res = await apiRequest("POST", `/api/hostels/${targetHostelId}/manage-students`, {
        studentIds: selectedStudents,
        mode,
      });
      return res.json();
    },
    onSuccess: (data: { message?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hostels"] });
      toast({ title: "Success", description: data.message || "Hostel students updated" });
      onOpenChange(false);
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Hostel Students</DialogTitle>
          <DialogDescription>Assign boarders to a hostel or remove them from the selected hostel.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2 sm:col-span-2">
            <Label>Hostel</Label>
            <Select value={selectedHostelId} onValueChange={setSelectedHostelId}>
              <SelectTrigger data-testid="select-manage-hostel"><SelectValue placeholder="Select hostel" /></SelectTrigger>
              <SelectContent>
                {hostelList.map((hostel) => (
                  <SelectItem key={hostel.id} value={hostel.id.toString()}>{hostel.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Action</Label>
            <Select value={mode} onValueChange={(v: "assign" | "remove") => setMode(v)}>
              <SelectTrigger data-testid="select-hostel-manage-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="assign">Assign to hostel</SelectItem>
                <SelectItem value="remove">Remove from hostel</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Search Students</Label>
          <Input value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} placeholder="Search by name or admission number" data-testid="input-search-hostel-students" />
        </div>

        <div className="max-h-[320px] overflow-y-auto border rounded-md">
          {boarders.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No matching boarders found.</div>
          ) : (
            <div className="divide-y">
              {boarders.map((student) => (
                <label key={student.id} className="flex cursor-pointer items-center gap-3 p-3" data-testid={`row-manage-hostel-student-${student.id}`}>
                  <Checkbox checked={selectedStudents.includes(student.id)} onCheckedChange={() => toggleStudent(student.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{student.firstName} {student.lastName}</div>
                    <div className="text-xs text-muted-foreground">{student.admissionNo}</div>
                  </div>
                  <Badge variant="outline">{student.hostelId ? "Assigned" : "Unassigned"}</Badge>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!selectedHostelId || selectedStudents.length === 0 || manageMutation.isPending} onClick={() => manageMutation.mutate()} data-testid="button-submit-manage-hostel-students">
            {manageMutation.isPending ? "Saving..." : mode === "assign" ? "Assign Students" : "Remove Students"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
