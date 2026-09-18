import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { CreateAccountForm } from "@/components/create-account-form";
import { LoginDetailsBulkDialog } from "@/components/login-details-bulk-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Trash2, Download, Bell, Users, UserCog, Upload, UserCheck, Eye, Phone, Mail, ChevronLeft, ChevronRight } from "lucide-react";
import { NotifyModal } from "@/components/notify-modal";
import { useAuth } from "@/lib/auth";
import * as XLSX from "xlsx";
import { blobToXlsxImageDataUrl, exportXlsxWithEmbeddedImages } from "@/lib/xlsx-embedded-images";
import { ResidentialAreaInput } from "@/components/residential-area-input";
import type { Parent, Student, User } from "@shared/schema";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import { RecordPhotoActions } from "@/components/record-photo-actions";

type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function ParentsPage() {
  const { toast } = useToast();
  const { currentSchoolId, hasPermission } = useAuth();
  
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [viewingParent, setViewingParent] = useState<Parent | null>(null);
  const [editingParent, setEditingParent] = useState<Parent | null>(null);
  const [isNotifyOpen, setIsNotifyOpen] = useState(false);
  const [studentsDialogParent, setStudentsDialogParent] = useState<Parent | null>(null);
  const [userAccountParent, setUserAccountParent] = useState<Parent | null>(null);
  const [linkedStudentIds, setLinkedStudentIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [debouncedSearch, pageSize]);

  const { data: parentPageData, isLoading } = useQuery<PaginatedResponse<Parent & { childrenCount?: number }>>({
    queryKey: ["/api/parents", page, pageSize, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({
        paginated: "true",
        page: page.toString(),
        pageSize: pageSize.toString(),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await schoolFetch(`/api/parents?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load parents");
      return res.json();
    },
    placeholderData: (previousData) => previousData,
  });

  const parents = parentPageData?.items || [];
  const totalParents = parentPageData?.total || 0;
  const totalPages = parentPageData?.totalPages || 1;

  const shouldLoadStudents = isAddOpen || !!editingParent || !!viewingParent || !!studentsDialogParent;
  const { data: students } = useQuery<Student[]>({
    queryKey: ["/api/students"],
    enabled: shouldLoadStudents,
  });

  const linkStudentsToParent = async (parentId: number) => {
    const currentLinked = (students || []).filter(s => s.parentId === parentId).map(s => s.id);
    const toLink = linkedStudentIds.filter(id => !currentLinked.includes(id));
    const toUnlink = currentLinked.filter(id => !linkedStudentIds.includes(id));

    for (const studentId of toLink) {
      await apiRequest("PUT", `/api/students/${studentId}`, { parentId });
    }
    for (const studentId of toUnlink) {
      await apiRequest("PUT", `/api/students/${studentId}`, { parentId: null });
    }
    if (toLink.length > 0 || toUnlink.length > 0) {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: Partial<Parent>) => {
      const res = await apiRequest("POST", "/api/parents", data);
      return res.json();
    },
    onSuccess: async (newParent: Parent) => {
      await linkStudentsToParent(newParent.id);
      queryClient.invalidateQueries({ queryKey: ["/api/parents"] });
      setIsAddOpen(false);
      setLinkedStudentIds([]);
      toast({ title: "Success", description: "Parent added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Parent> }) => {
      const res = await apiRequest("PUT", `/api/parents/${id}`, data);
      return res.json();
    },
    onSuccess: async (updatedParent: Parent) => {
      await linkStudentsToParent(updatedParent.id);
      queryClient.invalidateQueries({ queryKey: ["/api/parents"] });
      setEditingParent(null);
      setLinkedStudentIds([]);
      toast({ title: "Success", description: "Parent updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/parents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parents"] });
      toast({ title: "Success", description: "Parent deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async ({ rows, fileName }: { rows: Array<Record<string, unknown>>; fileName?: string }) => {
      const res = await apiRequest("POST", "/api/parents/import", { parents: rows, fileName });
      return res.json();
    },
    onSuccess: (data: { imported: number; skipped: number; total: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/parents"] });
      let description = `Imported ${data.imported} of ${data.total} parents.`;
      if (data.skipped > 0) description += ` Skipped ${data.skipped}.`;
      toast({ title: "Import Complete", description });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filteredParents = parents;

  const { sortedData: sortedParents, sortConfig, requestSort } = useTableSort(filteredParents);

  const getChildrenCount = (parent: Parent & { childrenCount?: number }) => {
    if (typeof parent.childrenCount === "number") return parent.childrenCount;
    return students?.filter(s => s.parentId === parent.id).length || 0;
  };

  const getLinkedStudents = (parentId: number) => {
    return students?.filter(s => s.parentId === parentId) || [];
  };

  const displayValue = (value: unknown) => {
    const text = String(value ?? "").trim();
    return text && text !== "-" && text !== "—" ? text : "___";
  };

  const getParentInitials = (parent: Parent) =>
    `${parent.firstName?.[0] || ""}${parent.lastName?.[0] || ""}`.toUpperCase() || "P";

  const getRelationshipLabel = (relationship: Parent["relationship"]) =>
    relationship ? String(relationship).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Parent";

  const getParentAddressLine = (parent: Parent) =>
    `${parent.streetAddress || "___"}, ${parent.residentialArea || "___"}, ${parent.address || "___"}`;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(filteredParents?.map((p) => p.id) || []);
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter((i) => i !== id));
    }
  };

  const getNotifyRecipients = () => {
    const selected = selectedIds.length > 0 ? selectedIds : [];
    return (filteredParents || [])
      .filter((p) => selected.length === 0 || selected.includes(p.id))
      .map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        email: p.email || undefined,
        phone: p.phone || undefined,
      }));
  };

  const handleExport = async () => {
    const params = new URLSearchParams({ paginated: "true", page: "1", pageSize: "100000" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    const exportRes = await schoolFetch(`/api/parents?${params.toString()}`);
    if (!exportRes.ok) {
      toast({ title: "Export failed", description: "Could not load parent data for export", variant: "destructive" });
      return;
    }
    const exportPage = (await exportRes.json()) as PaginatedResponse<Parent & { childrenCount?: number }>;
    const exportParents = exportPage.items || [];
    if (!exportParents.length) {
      toast({ title: "Error", description: "No parents to export", variant: "destructive" });
      return;
    }
    const rows: Array<Record<string, string>> = [];
    for (const p of exportParents) {
      let photoDataUrl = "";
      if (p.photo) {
        try { const response = await schoolFetch(`/api/parents/${p.id}/photo/download`); if (response.ok) photoDataUrl = await blobToXlsxImageDataUrl(await response.blob()); } catch { /* keep export usable if one photo is unavailable */ }
      }
      rows.push({
        Photo: photoDataUrl,
        "First Name": p.firstName || "",
        "Last Name": p.lastName || "",
        Phone: p.phone || "",
        Email: p.email || "",
        Relationship: p.relationship || "",
        Occupation: p.occupation || "",
        "Street Address": p.streetAddress || "",
        "Residential Area": p.residentialArea || "",
        "Address / City": p.address || "",
        "Children Count": String(getChildrenCount(p)),
      });
    }
    const searchLabel = debouncedSearch ? `_search_${debouncedSearch.replace(/\s+/g, "_")}` : "";
    exportXlsxWithEmbeddedImages({
      filename: `Parents${searchLabel}_${new Date().toISOString().split("T")[0]}.xlsx`,
      sheetName: "Parents",
      columns: Object.keys(rows[0]),
      rows,
      columnWidths: { Photo: 10, "First Name": 18, "Last Name": 18, Phone: 18, Email: 30, Relationship: 18, Occupation: 22, "Street Address": 28, "Residential Area": 24, "Address / City": 26, "Children Count": 14 },
    });
    toast({ title: "Success", description: "Parent list downloaded as XLSX with embedded profile photos and text-safe contact details." });
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Array<Record<string, string>>;

        const parentData = jsonData.map((row) => ({
          firstName: (row["First Name"] || row["first_name"] || row["FirstName"] || "").trim(),
          lastName: (row["Last Name"] || row["last_name"] || row["LastName"] || "").trim(),
          phone: row["Phone"] || row["phone"] || "",
          email: row["Email"] || row["email"] || "",
          relationship: row["Relationship"] || row["relationship"] || "",
          occupation: row["Occupation"] || row["occupation"] || "",
          streetAddress: row["Street Address"] || row["street_address"] || "",
          residentialArea: row["Residential Area"] || row["residential_area"] || "",
          address: row["City"] || row["Address"] || row["address"] || "",
        })).filter((p) => p.firstName && p.lastName);

        if (parentData.length === 0) {
          toast({ title: "Error", description: "No valid parent data found in file", variant: "destructive" });
          return;
        }

        toast({ title: "Importing", description: `Processing ${parentData.length} parents...` });
        importMutation.mutate({ rows: parentData, fileName: file.name });
      } catch {
        toast({ title: "Error", description: "Failed to parse file", variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      firstName: formData.get("firstName") as string,
      lastName: formData.get("lastName") as string,
      email: (formData.get("email") as string) || null,
      phone: formData.get("phone") as string,
      streetAddress: (formData.get("streetAddress") as string) || null,
      residentialArea: (formData.get("residentialArea") as string) || null,
      address: (formData.get("address") as string) || null,
      occupation: (formData.get("occupation") as string) || null,
      relationship: (formData.get("relationship") as string) || "parent",
    };

    if (editingParent) {
      updateMutation.mutate({ id: editingParent.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <UserCheck className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-parents-title">Parents & Guardians</h1>
            <p className="text-muted-foreground">Manage parent and guardian records</p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button variant="outline" onClick={handleExport} data-testid="button-download-parents">
            <Download className="w-4 h-4 mr-2" />
            Download
          </Button>

          <Button variant="outline" onClick={() => setIsNotifyOpen(true)} data-testid="button-notify-parents">
            <Bell className="w-4 h-4 mr-2" />
            Notify
          </Button>
          <NotifyModal
            open={isNotifyOpen}
            onOpenChange={setIsNotifyOpen}
            recipientType="parent"
            recipients={getNotifyRecipients()}
            schoolId={currentSchoolId}
            selectedIds={selectedIds}
            search={debouncedSearch}
          />

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportFile}
            accept=".xlsx,.xls,.csv"
            className="hidden"
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-import-parents">
            <Upload className="w-4 h-4 mr-2" />
            Upload
          </Button>

          <LoginDetailsBulkDialog
            recipientType="parent"
            selectedIds={selectedIds}
            search={debouncedSearch}
          />

          <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (open) setLinkedStudentIds([]); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-parent">
                <Plus className="w-4 h-4 mr-2" />
                PARENT
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
              <DialogHeader>
                <DialogTitle>Add New Parent</DialogTitle>
              </DialogHeader>
              <ParentForm
                onSubmit={handleSubmit}
                isLoading={createMutation.isPending}
                students={students}
                linkedStudentIds={linkedStudentIds}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div className="relative w-full min-w-0 sm:flex-1 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search parents (name, phone, email)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                data-testid="input-search-parents"
              />
            </div>
            <Badge variant="secondary" className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {totalParents} Parents
            </Badge>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedIds.length === filteredParents?.length && filteredParents?.length > 0}
                        onCheckedChange={handleSelectAll}
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <SortableTableHead sortKey="name" sortConfig={sortConfig} onSort={requestSort}>PARENT</SortableTableHead>
                    <SortableTableHead sortKey="phone" sortConfig={sortConfig} onSort={requestSort}>PHONE</SortableTableHead>
                    <SortableTableHead sortKey="email" sortConfig={sortConfig} onSort={requestSort}>EMAIL</SortableTableHead>
                    <TableHead>CHILDREN</TableHead>
                    <TableHead>USER ACCOUNT</TableHead>
                    <TableHead className="text-right">ACTION</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sortedParents ?? []).map((p) => (
                    <TableRow key={p.id} data-testid={`row-parent-${p.id}`}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(p.id)}
                          onCheckedChange={(checked) => handleSelectOne(p.id, !!checked)}
                          data-testid={`checkbox-parent-${p.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <RecordPhotoActions
                            entity="parents"
                            recordId={p.id}
                            firstName={p.firstName}
                            lastName={p.lastName}
                            recordNumber={`PARENT-${p.id}`}
                            photo={p.photo}
                            initials={getParentInitials(p)}
                            canManage={hasPermission("parents.edit") || hasPermission("parents.manage_photo")}
                          />
                          <div>
                            <p className="font-medium">{p.firstName} {p.lastName}</p>
                            <p className="text-xs text-muted-foreground capitalize">{p.relationship || "Parent"}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{p.phone || "—"}</TableCell>
                      <TableCell>{p.email || "—"}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setStudentsDialogParent(p)}
                          data-testid={`button-children-${p.id}`}
                        >
                          <Users className="w-4 h-4 mr-1" />
                          {getChildrenCount(p)} Student{getChildrenCount(p) !== 1 ? "s" : ""}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setUserAccountParent(p)}
                          data-testid={`button-account-${p.id}`}
                        >
                          <UserCog className="w-4 h-4 mr-1" />
                          Manage
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                      <div className="flex flex-nowrap items-center justify-end gap-1">
                        <Dialog open={viewingParent?.id === p.id} onOpenChange={(open) => !open && setViewingParent(null)}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setViewingParent(p)}
                              data-testid={`button-view-parent-${p.id}`}
                              title="View"
                              aria-label="View"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
                            <DialogHeader>
                              <DialogTitle>View Parent</DialogTitle>
                            </DialogHeader>
                            <ParentView
                              parent={p}
                              linkedStudents={getLinkedStudents(p.id)}
                              onEdit={() => {
                                setViewingParent(null);
                                setEditingParent(p);
                                setLinkedStudentIds((students || []).filter(s => s.parentId === p.id).map(s => s.id));
                              }}
                            />
                          </DialogContent>
                        </Dialog>

                        <Dialog open={editingParent?.id === p.id} onOpenChange={(open) => !open && setEditingParent(null)}>
                          <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
                            <DialogHeader>
                              <DialogTitle>Edit Parent</DialogTitle>
                            </DialogHeader>
                            <ParentForm
                              onSubmit={handleSubmit}
                              defaultValues={p}
                              isLoading={updateMutation.isPending}
                              students={students || []}
                              linkedStudentIds={linkedStudentIds}
                            />
                          </DialogContent>
                        </Dialog>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm("Are you sure you want to delete this parent?")) {
                              deleteMutation.mutate(p.id);
                            }
                          }}
                          data-testid={`button-delete-parent-${p.id}`}
                          title="Delete"
                          aria-label="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                    </TableRow>
                  ))}
                  {filteredParents?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No parents found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
                </Table>
              </div>

              <div className="mobile-record-list">
                {(sortedParents ?? []).map((p) => {
                  const childrenCount = getChildrenCount(p);
                  const relationshipLabel = getRelationshipLabel(p.relationship);
                  const addressLine = getParentAddressLine(p);

                  return (
                    <div key={p.id} className="mobile-record-card" data-testid={`mobile-card-parent-${p.id}`}>
                      <div className="mobile-record-title-row">
                        <Checkbox
                          checked={selectedIds.includes(p.id)}
                          onCheckedChange={(checked) => handleSelectOne(p.id, !!checked)}
                          className="mt-0.5 shrink-0"
                          data-testid={`mobile-checkbox-parent-${p.id}`}
                        />

                        <p className="mobile-record-title">
                          <span className="break-words">{p.firstName || "___"} {p.lastName || "___"}: </span>
                          <span>{relationshipLabel}</span>
                        </p>
                      </div>

                      <div className="mobile-record-media-row pl-6">
                        <div className="flex shrink-0 flex-col items-stretch gap-1">
                          <RecordPhotoActions
                            entity="parents"
                            recordId={p.id}
                            firstName={p.firstName}
                            lastName={p.lastName}
                            recordNumber={`PARENT-${p.id}`}
                            photo={p.photo}
                            initials={getParentInitials(p)}
                            canManage={hasPermission("parents.edit") || hasPermission("parents.manage_photo")}
                            className="mobile-record-avatar"
                          />
                        </div>

                        <div className="mobile-record-details">
                          <div className="mobile-record-details-grid mobile-record-two-col">
                            <div className="mobile-record-field">
                              <Phone className="h-3 w-3 shrink-0" />
                              <span className="shrink-0">:</span>
                              <span className="mobile-record-truncate">{p.phone || "___"}</span>
                            </div>
                            <div className="mobile-record-field">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="shrink-0">:</span>
                              <span className="mobile-record-truncate">{p.email || "___"}</span>
                            </div>
                          </div>

                          <div className="mobile-record-details-grid mobile-record-two-col mt-1">
                            <span className="mobile-record-truncate"><span className="mobile-record-label">Occupation:</span> {displayValue(p.occupation)}</span>
                            <span className="mobile-record-truncate"><span className="mobile-record-label">Children:</span> {childrenCount} Student{childrenCount !== 1 ? "s" : ""}</span>
                          </div>

                          <div className="mt-1 min-w-0">
                            <span className="block truncate"><span className="mobile-record-label">Address:</span> {addressLine}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mobile-record-actions-wrap">
                        <div className="mobile-record-actions">
                          <Button
                            variant="outline"
                            size="sm"
                            className="mobile-record-action-button"
                            onClick={() => setUserAccountParent(p)}
                            data-testid={`mobile-button-account-${p.id}`}
                            title="Manage User Account"
                            aria-label="Manage User Account"
                          >
                            <UserCog className="mobile-record-action-icon" />
                            <span className="mobile-record-action-text">Manage</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mobile-record-action-button"
                            onClick={() => setViewingParent(p)}
                            data-testid={`mobile-button-view-parent-${p.id}`}
                            title="View"
                            aria-label="View"
                          >
                            <Eye className="mobile-record-action-icon" />
                            <span className="mobile-record-action-text">View</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mobile-record-action-button"
                            onClick={() => setStudentsDialogParent(p)}
                            data-testid={`mobile-button-children-${p.id}`}
                            title="Linked Students"
                            aria-label="Linked Students"
                          >
                            <Users className="mobile-record-action-icon" />
                            <span className="mobile-record-action-text">Students</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="mobile-record-delete-button text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm("Are you sure you want to delete this parent?")) {
                                deleteMutation.mutate(p.id);
                              }
                            }}
                            data-testid={`mobile-button-delete-parent-${p.id}`}
                            title="Delete"
                            aria-label="Delete"
                          >
                            <Trash2 className="mobile-record-action-icon" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredParents?.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No parents found
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing {totalParents === 0 ? 0 : (page - 1) * pageSize + 1}
                  -{Math.min(page * pageSize, totalParents)} of {totalParents} parents
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={pageSize.toString()} onValueChange={(value) => setPageSize(parseInt(value, 10))}>
                    <SelectTrigger className="h-9 w-[120px]" data-testid="select-parents-page-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option.toString()}>{option} / page</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Linked Students Modal */}
      <Dialog open={!!studentsDialogParent} onOpenChange={(open) => !open && setStudentsDialogParent(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Linked Students</DialogTitle>
            <DialogDescription>
              Children of {studentsDialogParent?.firstName} {studentsDialogParent?.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {studentsDialogParent && getLinkedStudents(studentsDialogParent.id).length > 0 ? (
              getLinkedStudents(studentsDialogParent.id).map((student) => (
                <div key={student.id} className="flex items-center gap-3 p-2 rounded-lg border">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                    {student.firstName?.[0]}{student.lastName?.[0]}
                  </div>
                  <div>
                    <p className="font-medium">{student.firstName} {student.lastName}</p>
                    <p className="text-xs text-muted-foreground">{student.admissionNo}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center text-muted-foreground py-4">No students linked to this parent.</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setStudentsDialogParent(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Account Modal */}
      {userAccountParent && (
        <ParentUserAccountModal
          parent={userAccountParent}
          open={!!userAccountParent}
          onClose={() => setUserAccountParent(null)}
        />
      )}

    </div>
  );
}


function ParentView({
  parent,
  linkedStudents,
  onEdit,
}: {
  parent: Parent;
  linkedStudents: Student[];
  onEdit: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-md border bg-muted flex items-center justify-center text-lg font-semibold">
          {parent.firstName?.[0]}{parent.lastName?.[0]}
        </div>
        <div>
          <h3 className="text-lg font-semibold">{parent.firstName} {parent.lastName}</h3>
          <p className="text-sm text-muted-foreground capitalize">{parent.relationship || "Parent"}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Phone</Label>
          <div className="rounded-md border px-3 py-2 text-sm">{parent.phone || "-"}</div>
        </div>
        <div className="space-y-1">
          <Label>Email</Label>
          <div className="rounded-md border px-3 py-2 text-sm break-all">{parent.email || "-"}</div>
        </div>
        <div className="space-y-1">
          <Label>Relationship</Label>
          <div className="rounded-md border px-3 py-2 text-sm capitalize">{parent.relationship || "-"}</div>
        </div>
        <div className="space-y-1">
          <Label>Occupation</Label>
          <div className="rounded-md border px-3 py-2 text-sm">{parent.occupation || "-"}</div>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Address</Label>
          <div className="rounded-md border px-3 py-2 text-sm">{parent.address || parent.streetAddress || "-"}</div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Linked Students</Label>
        {linkedStudents.length === 0 ? (
          <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">No linked students</div>
        ) : (
          <div className="space-y-2">
            {linkedStudents.map((student) => (
              <div key={student.id} className="rounded-md border px-3 py-2 text-sm">
                <div className="font-medium">{student.firstName} {student.lastName}</div>
                <div className="text-muted-foreground">Admission No: {student.admissionNo || "-"}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={onEdit} data-testid={`button-edit-parent-from-view-${parent.id}`}>
          Edit
        </Button>
      </div>
    </div>
  );
}

function ParentForm({
  onSubmit,
  defaultValues,
  isLoading,
  students,
  linkedStudentIds,
}: {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  defaultValues?: Parent;
  isLoading: boolean;
  students?: Student[];
  linkedStudentIds: number[];
}) {

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First Name</Label>
          <Input
            id="firstName"
            name="firstName"
            defaultValue={defaultValues?.firstName}
            required
            data-testid="input-first-name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last Name</Label>
          <Input
            id="lastName"
            name="lastName"
            defaultValue={defaultValues?.lastName}
            required
            data-testid="input-last-name"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone Number</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={defaultValues?.phone}
            required
            data-testid="input-phone"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={defaultValues?.email || ""}
            data-testid="input-email"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="relationship">Relationship</Label>
          <Input
            id="relationship"
            name="relationship"
            placeholder="e.g., Father, Mother, Guardian"
            defaultValue={defaultValues?.relationship || "parent"}
            data-testid="input-relationship"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="occupation">Occupation</Label>
          <Input
            id="occupation"
            name="occupation"
            defaultValue={defaultValues?.occupation || ""}
            data-testid="input-occupation"
          />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="streetAddress">Street Address</Label>
          <Input
            id="streetAddress"
            name="streetAddress"
            placeholder="House number & street"
            defaultValue={defaultValues?.streetAddress || ""}
            data-testid="input-street-address"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="residentialArea">Residential Area / Suburb</Label>
          <ResidentialAreaInput defaultValue={defaultValues?.residentialArea || ""} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="address">City</Label>
        <Input
          id="address"
          name="address"
          placeholder="e.g. Harare, Marondera"
          defaultValue={defaultValues?.address || ""}
          data-testid="input-address"
        />
      </div>
      <div className="space-y-2">
        <Label>Linked Students</Label>
        <div className="border rounded-md">
          {linkedStudentIds.length > 0 ? (
            <div className="divide-y">
              {linkedStudentIds.map(id => {
                const s = (students || []).find(st => st.id === id);
                if (!s) return null;
                return (
                  <div key={id} className="flex items-center gap-2 px-3 py-2" data-testid={`linked-student-${id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.firstName} {s.lastName}</p>
                      <p className="text-xs text-muted-foreground">{s.admissionNo}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-3">
              No students linked to this parent
              </p>
            )}
          </div>
        </div>
      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-save-parent">
        {isLoading ? "Saving..." : defaultValues ? "Update Parent" : "Add Parent"}
      </Button>
    </form>
  );
}

function ParentUserAccountModal({
  parent,
  open,
  onClose,
}: {
  parent: Parent;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);

  const { data: accountData, isLoading, refetch } = useQuery<{ user: User | null }>({
    queryKey: ["/api/parents", parent.id, "user"],
    queryFn: async () => {
      const res = await schoolFetch(`/api/parents/${parent.id}/user`);
      if (!res.ok) return { user: null };
      return res.json();
    },
    enabled: open,
  });

  const createAccountMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const res = await apiRequest("POST", `/api/parents/${parent.id}/user`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parents", parent.id, "user"] });
      setIsCreating(false);
      toast({ title: "Success", description: "User account created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("PUT", `/api/parents/${parent.id}/user/password`, { password });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Password reset successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      const res = await apiRequest("PUT", `/api/parents/${parent.id}/user/status`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Success", description: "Account status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createAccountMutation.mutate({
      username: formData.get("username") as string,
      password: formData.get("password") as string,
    });
  };

  const handleResetPassword = () => {
    const newPassword = prompt("Enter new password (min 6 characters):");
    if (newPassword && newPassword.length >= 6) {
      resetPasswordMutation.mutate(newPassword);
    } else if (newPassword) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
    }
  };

  const user = accountData?.user;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>User Account</DialogTitle>
          <DialogDescription>
            {parent.firstName} {parent.lastName}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : user ? (
          <div className="space-y-4">
            <div className="p-4 border rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Username</span>
                <span className="font-medium">{user.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Role</span>
                <Badge variant="secondary">{user.role}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={user.isActive ? "default" : "destructive"}>
                  {user.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleResetPassword} disabled={resetPasswordMutation.isPending}>
                Reset Password
              </Button>
              <Button
                variant={user.isActive ? "destructive" : "default"}
                size="sm"
                onClick={() => toggleStatusMutation.mutate(!user.isActive)}
                disabled={toggleStatusMutation.isPending}
              >
                {user.isActive ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </div>
        ) : isCreating ? (
          <CreateAccountForm
            entityType="parents"
            entityId={parent.id}
            entityName={`${parent.firstName} ${parent.lastName}`}
            defaultUsername={parent.phone?.replace(/\D/g, "").slice(-9) || parent.email || ""}
            onSuccess={() => {
              setIsCreating(false);
              queryClient.invalidateQueries({ queryKey: ["/api/parents", parent.id, "user"] });
            }}
            onCancel={() => setIsCreating(false)}
          />
        ) : (
          <div className="text-center py-4">
            <p className="text-muted-foreground mb-4">No user account exists for this parent.</p>
            <Button onClick={() => setIsCreating(true)}>Create User Account</Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
