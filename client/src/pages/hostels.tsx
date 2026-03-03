import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Trash2, Users, Building } from "lucide-react";
import type { Hostel, Student } from "@shared/schema";

export default function HostelsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingHostel, setEditingHostel] = useState<Hostel | null>(null);
  const [deleteHostel, setDeleteHostel] = useState<Hostel | null>(null);

  const { data: hostelList, isLoading } = useQuery<Hostel[]>({
    queryKey: ["/api/hostels"],
  });

  const { data: allStudents } = useQuery<Student[]>({
    queryKey: ["/api/students"],
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
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
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
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
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
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getStudentCount = (hostelId: number) => {
    return allStudents?.filter(s => s.hostelId === hostelId && s.isBoarding).length ?? 0;
  };

  const filteredHostels = hostelList?.filter(h =>
    h.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Building className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-page-title">Boarding Hostels</h1>
            <p className="text-muted-foreground">Manage boarding hostels and dormitories</p>
          </div>
        </div>
        <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-hostel">
          <Plus className="w-4 h-4 mr-2" />
          Add Hostel
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
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
      ) : !filteredHostels || filteredHostels.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Building className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No hostels found. Add a hostel to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredHostels.map(hostel => (
            <Card key={hostel.id} className="hover-elevate" data-testid={`card-hostel-${hostel.id}`}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-lg">{hostel.name}</h3>
                    {hostel.gender && (
                      <p className="text-sm text-muted-foreground capitalize">{hostel.gender} hostel</p>
                    )}
                  </div>
                  <Badge variant="secondary">
                    <Users className="w-3 h-3 mr-1" />
                    {getStudentCount(hostel.id)}
                  </Badge>
                </div>

                <div className="text-sm text-muted-foreground mb-4">
                  {hostel.capacity && <p>Capacity: {hostel.capacity}</p>}
                  {hostel.description && <p className="mt-1">{hostel.description}</p>}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" className="p-0 h-auto text-primary hover:underline" onClick={() => setEditingHostel(hostel)} data-testid={`button-edit-hostel-${hostel.id}`}>
                    <Pencil className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="p-0 h-auto text-destructive hover:underline" onClick={() => setDeleteHostel(hostel)} data-testid={`button-delete-hostel-${hostel.id}`}>
                    <Trash2 className="w-3 h-3 mr-1" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <HostelFormDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        title="Add New Hostel"
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
      />

      {editingHostel && (
        <HostelFormDialog
          open={!!editingHostel}
          onOpenChange={(open) => !open && setEditingHostel(null)}
          title="Edit Hostel"
          defaultValues={editingHostel}
          onSubmit={(data) => updateMutation.mutate({ id: editingHostel.id, data })}
          isPending={updateMutation.isPending}
        />
      )}

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
                    Warning: This hostel has {getStudentCount(deleteHostel.id)} student(s) assigned.
                    Consider reassigning them first.
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteHostel(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(deleteHostel.id)}
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

function HostelFormDialog({
  open,
  onOpenChange,
  title,
  defaultValues,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  defaultValues?: Hostel;
  onSubmit: (data: Partial<Hostel>) => void;
  isPending: boolean;
}) {
  const [formData, setFormData] = useState({
    name: defaultValues?.name || "",
    capacity: defaultValues?.capacity?.toString() || "",
    gender: defaultValues?.gender || "",
    description: defaultValues?.description || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: formData.name,
      capacity: formData.capacity ? parseInt(formData.capacity) : undefined,
      gender: (formData.gender || undefined) as any,
      description: formData.description || undefined,
    });
    if (!defaultValues) {
      setFormData({ name: "", capacity: "", gender: "", description: "" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Hostel Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g., Boys Hostel A"
              required
              data-testid="input-hostel-name"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="capacity">Capacity</Label>
              <Input
                id="capacity"
                type="number"
                value={formData.capacity}
                onChange={(e) => setFormData(p => ({ ...p, capacity: e.target.value }))}
                placeholder="e.g., 50"
                data-testid="input-hostel-capacity"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Select value={formData.gender} onValueChange={(v) => setFormData(p => ({ ...p, gender: v }))}>
                <SelectTrigger data-testid="select-hostel-gender">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Boys</SelectItem>
                  <SelectItem value="female">Girls</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
              placeholder="Optional description..."
              data-testid="input-hostel-description"
            />
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
