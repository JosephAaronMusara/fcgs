import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { CreateAccountForm } from "@/components/create-account-form";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Trash2, Phone, Mail, Download, Bell, Upload, Smartphone, BookOpen, GraduationCap, Home, UserCog, KeyRound, Eye, EyeOff, Shield, RotateCcw, Check, X, Camera, Users } from "lucide-react";
import type { Staff, Subject, Class as ClassType, User, Permission, AccessGroup, UserPermissionOverride } from "@shared/schema";
import { NotifyModal } from "@/components/notify-modal";
import { useAuth } from "@/lib/auth";
import * as XLSX from "xlsx";
import { ResidentialAreaInput } from "@/components/residential-area-input";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";

export default function StaffPage() {
  const { toast } = useToast();
  const { currentSchoolId } = useAuth();
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [isNotifyOpen, setIsNotifyOpen] = useState(false);
  const [selectedStaffIds, setSelectedStaffIds] = useState<number[]>([]);
  const [subjectsDialogStaff, setSubjectsDialogStaff] = useState<Staff | null>(null);
  const [classesDialogStaff, setClassesDialogStaff] = useState<Staff | null>(null);
  const [accountDialogStaff, setAccountDialogStaff] = useState<Staff | null>(null);
  const [accessRightsStaff, setAccessRightsStaff] = useState<Staff | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: staffList, isLoading } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
  });

  const { data: nextStaffNo } = useQuery<{ staffNo: string }>({
    queryKey: ["/api/staff/next-no"],
  });

  const { data: subjectsRaw } = useQuery<any>({
    queryKey: ["/api/subjects"],
  });
  const subjects: Subject[] = Array.isArray(subjectsRaw) ? subjectsRaw : (subjectsRaw?.items ?? []);

  const { data: classes } = useQuery<ClassType[]>({
    queryKey: ["/api/classes"],
  });

  const { data: accessGroups } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/access-groups"],
  });

  const { data: staffRolesList } = useQuery<Array<{ name: string; label: string }>>({
    queryKey: ["/api/staff-roles"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<Staff>) => {
      const res = await apiRequest("POST", "/api/staff", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff/next-no"] });
      setIsAddOpen(false);
      toast({ title: "Success", description: "Staff member added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Staff> }) => {
      const res = await apiRequest("PUT", `/api/staff/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      setEditingStaff(null);
      toast({ title: "Success", description: "Staff member updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/staff/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: "Success", description: "Staff member deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetMobileIdMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/staff/${id}/reset-mobile-id`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: "Success", description: "Mobile ID has been reset. Staff member can now log in from a new device." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (staffData: Array<Partial<Staff>>) => {
      const res = await apiRequest("POST", "/api/staff/import", { staff: staffData });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff/next-no"] });
      if (data.imported === 0 && data.total > 0) {
        toast({ 
          title: "Import Failed", 
          description: `No staff members were imported out of ${data.total}. ${data.errors?.[0] || "Check your file format."}`,
          variant: "destructive"
        });
      } else if (data.imported < data.total) {
        toast({ 
          title: "Partial Import", 
          description: `Imported ${data.imported} of ${data.total} staff members. ${data.total - data.imported} failed.`,
          variant: "destructive"
        });
      } else {
        toast({ 
          title: "Import Complete", 
          description: `Successfully imported ${data.imported} of ${data.total} staff members` 
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    },
  });

  const filteredStaff = staffList?.filter((s) =>
    `${s.firstName} ${s.lastName} ${s.email} ${s.staffNo} ${s.phone}`.toLowerCase().includes(search.toLowerCase())
  );

  const { sortedData: sortedStaff, sortConfig, requestSort } = useTableSort(filteredStaff);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      staffNo: formData.get("staffNo") as string,
      firstName: formData.get("firstName") as string,
      lastName: formData.get("lastName") as string,
      email: formData.get("email") as string || undefined,
      phone: formData.get("phone") as string || undefined,
      gender: formData.get("gender") as "male" | "female" | undefined,
      streetAddress: formData.get("streetAddress") as string || undefined,
      residentialArea: formData.get("residentialArea") as string || undefined,
      address: formData.get("address") as string || undefined,
      role: formData.get("role") as string || "teacher",
      status: formData.get("status") as "active" | "inactive" || "active",
      accessGroupId: formData.get("accessGroupId") ? parseInt(formData.get("accessGroupId") as string) : undefined,
    };

    if (editingStaff) {
      updateMutation.mutate({ id: editingStaff.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleExport = () => {
    if (!filteredStaff?.length) {
      toast({ title: "No data", description: "No staff members to export", variant: "destructive" });
      return;
    }

    const exportData = filteredStaff.map(s => ({
      "First Name": s.firstName,
      "Last Name": s.lastName,
      "Email": s.email || "",
      "phone": s.phone || "",
      "Gender": s.gender?.toUpperCase() || "",
      "Street Address": s.streetAddress || "",
      "Residential Area": s.residentialArea || "",
      "City": s.address || "",
      "Role": s.role || "",
      "Status": s.status || "active",
      "Staff No": s.staffNo,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Staff");
    const datePart = new Date().toISOString().split('T')[0];
    const searchLabel = search.trim() ? `_${search.trim().replace(/\s+/g, "_")}` : "";
    XLSX.writeFile(workbook, `Staff${searchLabel}_${datePart}.xlsx`);
    toast({ title: "Success", description: "Staff list downloaded successfully" });
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

        const staffData = jsonData.map((row, index) => ({
          firstName: row["First Name"] || row["first_name"] || row["FirstName"] || "",
          lastName: row["Last Name"] || row["last_name"] || row["LastName"] || "",
          email: row["Email"] || row["email"] || "",
          phone: row["phone"] || row["Phone"] || row["telephone"] || "",
          gender: (row["Gender"] || row["gender"] || "").toLowerCase() as "male" | "female" | undefined,
          streetAddress: row["Street Address"] || row["street_address"] || "",
          residentialArea: row["Residential Area"] || row["residential_area"] || "",
          address: row["City"] || row["Address"] || row["address"] || "",
          role: row["Role"] || row["role"] || "teacher",
          status: (row["Status"] || row["status"] || "active").toLowerCase() as "active" | "inactive",
        })).filter(s => s.firstName && s.lastName);

        if (staffData.length === 0) {
          toast({ title: "Error", description: "No valid staff data found in file", variant: "destructive" });
          return;
        }

        importMutation.mutate(staffData);
      } catch (error) {
        toast({ title: "Error", description: "Failed to parse file. Please ensure it's a valid Excel or CSV file.", variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const getNotifyRecipients = () => {
    const targetStaff = selectedStaffIds.length > 0 
      ? staffList?.filter(s => selectedStaffIds.includes(s.id))
      : filteredStaff;
    return (targetStaff || []).map(s => ({
      id: s.id,
      name: `${s.firstName} ${s.lastName}`,
      email: s.email,
      phone: s.phone,
    }));
  };

  const getAccessGroupName = (accessGroupId: number | null | undefined) => {
    if (!accessGroupId) return "-";
    const group = accessGroups?.find(g => g.id === accessGroupId);
    return group?.name || "-";
  };

  const getRoleDisplay = (role: string | null | undefined, accessGroupId: number | null | undefined) => {
    const groupName = getAccessGroupName(accessGroupId);
    if (groupName !== "-") return groupName;
    return role?.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()) || "Teacher";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-staff-title">School Staff</h1>
            <p className="text-muted-foreground">Manage school staff records and assignments</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search Staff..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 w-[200px]"
              data-testid="input-search-staff"
            />
          </div>

          <Button variant="outline" onClick={handleExport} data-testid="button-download-staff">
            <Download className="w-4 h-4 mr-2" />
            Download
          </Button>

          <Button variant="outline" onClick={() => setIsNotifyOpen(true)} data-testid="button-notify-staff">
            <Bell className="w-4 h-4 mr-2" />
            Notify
          </Button>
          <NotifyModal
            open={isNotifyOpen}
            onOpenChange={setIsNotifyOpen}
            recipientType="staff"
            recipients={getNotifyRecipients()}
            schoolId={currentSchoolId}
          />

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportFile}
            accept=".xlsx,.xls,.csv"
            className="hidden"
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-import-staff">
            <Upload className="w-4 h-4 mr-2" />
            Upload
          </Button>

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-staff">
                <Plus className="w-4 h-4 mr-2" />
                STAFF
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add New Staff Member</DialogTitle>
              </DialogHeader>
              <StaffForm
                onSubmit={handleSubmit}
                defaultStaffNo={nextStaffNo?.staffNo}
                isLoading={createMutation.isPending}
                accessGroups={accessGroups}
                staffRoles={staffRolesList}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[30px]">
                    <Checkbox 
                      checked={selectedStaffIds.length === filteredStaff?.length && filteredStaff?.length > 0}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedStaffIds(filteredStaff?.map(s => s.id) || []);
                        } else {
                          setSelectedStaffIds([]);
                        }
                      }}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <SortableTableHead sortKey="firstName" sortConfig={sortConfig} onSort={requestSort}>SCHOOL STAFF</SortableTableHead>
                  <SortableTableHead sortKey="gender" sortConfig={sortConfig} onSort={requestSort}>GENDER</SortableTableHead>
                  <SortableTableHead sortKey="residentialAddress" sortConfig={sortConfig} onSort={requestSort}>ADDRESS</SortableTableHead>
                  <TableHead>USER ACCOUNT</TableHead>
                  <SortableTableHead sortKey="accessGroupId" sortConfig={sortConfig} onSort={requestSort}>ACCESS LEVEL</SortableTableHead>
                  <SortableTableHead sortKey="isActive" sortConfig={sortConfig} onSort={requestSort}>STATUS</SortableTableHead>
                  <TableHead>ACTION</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sortedStaff ?? []).map((s) => (
                  <TableRow key={s.id} data-testid={`row-staff-${s.id}`}>
                    <TableCell>
                      <Checkbox 
                        checked={selectedStaffIds.includes(s.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedStaffIds([...selectedStaffIds, s.id]);
                          } else {
                            setSelectedStaffIds(selectedStaffIds.filter(id => id !== s.id));
                          }
                        }}
                        data-testid={`checkbox-staff-${s.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                          {s.firstName?.[0]}{s.lastName?.[0]}
                        </div>
                        <div>
                          <p className="font-medium">{s.gender === "male" ? "Mr." : s.gender === "female" ? "Ms." : ""} {s.firstName} {s.lastName}</p>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground">
                            {s.email && (
                              <span className="flex items-center gap-1">
                                <Mail className="w-3 h-3" />
                                {s.email}
                              </span>
                            )}
                            {s.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {s.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="uppercase">{s.gender || "-"}</TableCell>
                    <TableCell>{s.address || "-"}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAccountDialogStaff(s)}
                        data-testid={`button-manage-account-${s.id}`}
                      >
                        <UserCog className="h-4 w-4 mr-1" />
                        Manage
                      </Button>
                    </TableCell>
                    <TableCell>{getRoleDisplay(s.role, s.accessGroupId)}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : "secondary"} className={s.status === "active" ? "bg-green-500 hover:bg-green-600" : ""}>
                        {s.status?.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Dialog open={editingStaff?.id === s.id} onOpenChange={(open) => !open && setEditingStaff(null)}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingStaff(s)}
                              data-testid={`button-edit-staff-${s.id}`}
                            >
                              Edit
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-lg">
                            <DialogHeader>
                              <DialogTitle>Edit Staff Member</DialogTitle>
                            </DialogHeader>
                            <StaffForm
                              onSubmit={handleSubmit}
                              defaultValues={s}
                              isLoading={updateMutation.isPending}
                              accessGroups={accessGroups}
                              staffRoles={staffRolesList}
                            />
                          </DialogContent>
                        </Dialog>

                        <Dialog open={subjectsDialogStaff?.id === s.id} onOpenChange={(open) => !open && setSubjectsDialogStaff(null)}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSubjectsDialogStaff(s)}
                              data-testid={`button-subjects-staff-${s.id}`}
                            >
                              Subjects
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Assign Subjects - {s.firstName} {s.lastName}</DialogTitle>
                            </DialogHeader>
                            <StaffSubjectsForm staffId={s.id} subjects={subjects || []} onClose={() => setSubjectsDialogStaff(null)} />
                          </DialogContent>
                        </Dialog>

                        <Dialog open={classesDialogStaff?.id === s.id} onOpenChange={(open) => !open && setClassesDialogStaff(null)}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setClassesDialogStaff(s)}
                              data-testid={`button-classes-staff-${s.id}`}
                            >
                              Classes
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Assign Classes - {s.firstName} {s.lastName}</DialogTitle>
                            </DialogHeader>
                            <StaffClassesForm staffId={s.id} classes={classes || []} onClose={() => setClassesDialogStaff(null)} />
                          </DialogContent>
                        </Dialog>

                        <Button
                          variant="ghost"
                          size="sm"
                          disabled
                          data-testid={`button-hostels-staff-${s.id}`}
                        >
                          Hostels
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setAccessRightsStaff(s)}
                          data-testid={`button-access-rights-${s.id}`}
                        >
                          Access Rights
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm("This will reset the mobile device ID for this staff member. They will need to log in again from their device to re-register it.")) {
                              resetMobileIdMutation.mutate(s.id);
                            }
                          }}
                          data-testid={`button-reset-mobile-${s.id}`}
                        >
                          Reset Mobile ID
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm("Are you sure you want to delete this staff member?")) {
                              deleteMutation.mutate(s.id);
                            }
                          }}
                          data-testid={`button-delete-staff-${s.id}`}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredStaff?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No staff members found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* User Account Management Modal */}
      <Dialog open={accountDialogStaff !== null} onOpenChange={(open) => !open && setAccountDialogStaff(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>User Account Management</DialogTitle>
            <DialogDescription>
              Manage the user account associated with this staff member
            </DialogDescription>
          </DialogHeader>
          {accountDialogStaff && (
            <UserAccountModal 
              staff={accountDialogStaff} 
              onClose={() => setAccountDialogStaff(null)} 
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Access Rights Dialog */}
      <Dialog open={accessRightsStaff !== null} onOpenChange={(open) => !open && setAccessRightsStaff(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Access Rights - {accessRightsStaff?.firstName} {accessRightsStaff?.lastName}</DialogTitle>
            <DialogDescription>
              Modify individual permissions beyond the assigned access group. Changes override group defaults.
            </DialogDescription>
          </DialogHeader>
          {accessRightsStaff && (
            <AccessRightsPanel 
              staff={accessRightsStaff} 
              accessGroups={accessGroups}
              onClose={() => setAccessRightsStaff(null)} 
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StaffForm({
  onSubmit,
  defaultValues,
  defaultStaffNo,
  isLoading,
  accessGroups,
  staffRoles,
}: {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  defaultValues?: Staff;
  defaultStaffNo?: string;
  isLoading: boolean;
  accessGroups?: Array<{ id: number; name: string }>;
  staffRoles?: Array<{ name: string; label: string }>;
}) {
  const { toast } = useToast();
  const [photoPreview, setPhotoPreview] = useState<string | null>(defaultValues?.photo || null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPhotoPreview(defaultValues?.photo || null);
  }, [defaultValues?.id, defaultValues?.photo]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !defaultValues?.id) return;
    setIsUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await schoolFetch(`/api/staff/${defaultValues.id}/photo`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || "Upload failed");
      }
      const data = await res.json();
      setPhotoPreview(data.photo);
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: "Photo uploaded successfully" });
    } catch (err: any) {
      toast({ title: err?.message || "Failed to upload photo", variant: "destructive" });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex items-start gap-4 mb-2">
        <div className="flex flex-col items-center gap-1.5">
          <div
            className="w-20 h-20 rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden flex items-center justify-center bg-gray-50 dark:bg-gray-800 cursor-pointer"
            onClick={() => defaultValues?.id && photoInputRef.current?.click()}
            data-testid="button-upload-staff-photo"
          >
            {photoPreview ? (
              <img src={photoPreview} alt="Staff" className="w-full h-full object-cover" />
            ) : (
              <Camera className="w-8 h-8 text-gray-400" />
            )}
          </div>
          {defaultValues?.id && (
            <>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
                data-testid="input-staff-photo"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => photoInputRef.current?.click()}
                disabled={isUploadingPhoto}
                data-testid="button-change-staff-photo"
              >
                {isUploadingPhoto ? "Uploading..." : photoPreview ? "Change" : "Upload"}
              </Button>
            </>
          )}
        </div>
        <div className="flex-1 grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="staffNo">Staff No</Label>
          <Input
            id="staffNo"
            name="staffNo"
            defaultValue={defaultValues?.staffNo || defaultStaffNo}
            required
            data-testid="input-staff-no"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <Select name="role" defaultValue={defaultValues?.role || "teacher"}>
            <SelectTrigger data-testid="select-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {staffRoles && staffRoles.length > 0 ? (
                staffRoles.map((role) => (
                  <SelectItem key={role.name} value={role.name}>{role.label}</SelectItem>
                ))
              ) : (
                <>
                  <SelectItem value="teacher">Teacher</SelectItem>
                  <SelectItem value="assistant_teacher">Assistant Teacher</SelectItem>
                  <SelectItem value="administrator">Administrator</SelectItem>
                  <SelectItem value="accountant">Accountant</SelectItem>
                  <SelectItem value="librarian">Librarian</SelectItem>
                  <SelectItem value="quality_control_officer">Quality Control Officer</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
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
      <div className="grid grid-cols-2 gap-4">
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
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={defaultValues?.phone || ""}
            data-testid="input-phone"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="gender">Gender</Label>
          <Select name="gender" defaultValue={defaultValues?.gender || ""}>
            <SelectTrigger data-testid="select-gender">
              <SelectValue placeholder="Select gender" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select name="status" defaultValue={defaultValues?.status || "active"}>
            <SelectTrigger data-testid="select-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {accessGroups && accessGroups.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="accessGroupId">Access Group</Label>
          <Select name="accessGroupId" defaultValue={defaultValues?.accessGroupId?.toString() || ""}>
            <SelectTrigger data-testid="select-access-group">
              <SelectValue placeholder="Select access group" />
            </SelectTrigger>
            <SelectContent>
              {accessGroups.map(group => (
                <SelectItem key={group.id} value={group.id.toString()}>{group.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
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
      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-save-staff">
        {isLoading ? "Saving..." : defaultValues ? "Update Staff" : "Add Staff"}
      </Button>
    </form>
  );
}

function StaffSubjectsForm({ staffId, subjects, onClose }: { staffId: number; subjects: Subject[]; onClose: () => void }) {
  const { toast } = useToast();
  const [selectedSubjects, setSelectedSubjects] = useState<number[]>([]);
  const [subjectSearch, setSubjectSearch] = useState("");

  const { data: staffSubjects, isLoading } = useQuery<Array<{ id: number; subjectId: number }>>({
    queryKey: ["/api/staff-subjects", staffId],
    queryFn: async () => {
      const res = await schoolFetch(`/api/staff/${staffId}/subjects`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (subjectIds: number[]) => {
      const res = await apiRequest("PUT", `/api/staff/${staffId}/subjects`, { subjectIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff-subjects", staffId] });
      toast({ title: "Success", description: "Subjects updated successfully" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  useState(() => {
    if (staffSubjects) {
      setSelectedSubjects(staffSubjects.map(s => s.subjectId));
    }
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  const filteredSubjects = subjects.filter(s =>
    s.name.toLowerCase().includes(subjectSearch.toLowerCase())
  );
  const selectedSubjectObjects = subjects.filter(s => selectedSubjects.includes(s.id));

  return (
    <div className="space-y-4">
      {selectedSubjectObjects.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="selected-subjects-tags">
          {selectedSubjectObjects.map(subject => (
            <Badge key={subject.id} variant="secondary" className="gap-1 pr-1" data-testid={`tag-subject-${subject.id}`}>
              {subject.name} ({(subject as any).syllabusCode || ""})
              <button
                type="button"
                className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                onClick={() => setSelectedSubjects(selectedSubjects.filter(id => id !== subject.id))}
                data-testid={`button-remove-subject-${subject.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search subjects..."
          value={subjectSearch}
          onChange={(e) => setSubjectSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-subjects"
        />
      </div>
      <div className="border rounded-md max-h-[200px] overflow-y-auto">
        {filteredSubjects.length === 0 ? (
          <p className="text-sm text-muted-foreground p-3 text-center">No subjects found</p>
        ) : (
          filteredSubjects.map(subject => {
            const isSelected = selectedSubjects.includes(subject.id);
            return (
              <button
                key={subject.id}
                type="button"
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover-elevate transition-colors ${isSelected ? "bg-primary/10" : ""}`}
                onClick={() => {
                  if (isSelected) {
                    setSelectedSubjects(selectedSubjects.filter(id => id !== subject.id));
                  } else {
                    setSelectedSubjects([...selectedSubjects, subject.id]);
                  }
                }}
                data-testid={`button-select-subject-${subject.id}`}
              >
                {isSelected ? (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                ) : (
                  <div className="h-4 w-4 shrink-0" />
                )}
                <span>{subject.name} ({(subject as any).syllabusCode || ""})</span>
              </button>
            );
          })
        )}
      </div>
      <div className="flex gap-2">
        <Button 
          variant="outline"
          className="flex-1" 
          onClick={onClose}
          data-testid="button-cancel-subjects"
        >
          Cancel
        </Button>
        <Button 
          className="flex-1" 
          onClick={() => saveMutation.mutate(selectedSubjects)}
          disabled={saveMutation.isPending}
          data-testid="button-save-subjects"
        >
          {saveMutation.isPending ? "Saving..." : "Save Subjects"}
        </Button>
      </div>
    </div>
  );
}

function StaffClassesForm({ staffId, classes, onClose }: { staffId: number; classes: ClassType[]; onClose: () => void }) {
  const { toast } = useToast();
  const [selectedClasses, setSelectedClasses] = useState<number[]>([]);
  const [classSearch, setClassSearch] = useState("");

  const { data: staffClasses, isLoading } = useQuery<Array<{ id: number; classId: number }>>({
    queryKey: ["/api/staff-classes", staffId],
    queryFn: async () => {
      const res = await schoolFetch(`/api/staff/${staffId}/classes`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (classIds: number[]) => {
      const res = await apiRequest("PUT", `/api/staff/${staffId}/classes`, { classIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff-classes", staffId] });
      toast({ title: "Success", description: "Classes updated successfully" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  useState(() => {
    if (staffClasses) {
      setSelectedClasses(staffClasses.map(s => s.classId));
    }
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  const filteredClasses = classes.filter(c =>
    c.className.toLowerCase().includes(classSearch.toLowerCase())
  );
  const selectedClassObjects = classes.filter(c => selectedClasses.includes(c.id));

  return (
    <div className="space-y-4">
      {selectedClassObjects.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="selected-classes-tags">
          {selectedClassObjects.map(cls => (
            <Badge key={cls.id} variant="secondary" className="gap-1 pr-1" data-testid={`tag-class-${cls.id}`}>
              {cls.className}
              <button
                type="button"
                className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                onClick={() => setSelectedClasses(selectedClasses.filter(id => id !== cls.id))}
                data-testid={`button-remove-class-${cls.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search classes..."
          value={classSearch}
          onChange={(e) => setClassSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-classes"
        />
      </div>
      <div className="border rounded-md max-h-[200px] overflow-y-auto">
        {filteredClasses.length === 0 ? (
          <p className="text-sm text-muted-foreground p-3 text-center">No classes found</p>
        ) : (
          filteredClasses.map(cls => {
            const isSelected = selectedClasses.includes(cls.id);
            return (
              <button
                key={cls.id}
                type="button"
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover-elevate transition-colors ${isSelected ? "bg-primary/10" : ""}`}
                onClick={() => {
                  if (isSelected) {
                    setSelectedClasses(selectedClasses.filter(id => id !== cls.id));
                  } else {
                    setSelectedClasses([...selectedClasses, cls.id]);
                  }
                }}
                data-testid={`button-select-class-${cls.id}`}
              >
                {isSelected ? (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                ) : (
                  <div className="h-4 w-4 shrink-0" />
                )}
                <span>{cls.className}</span>
              </button>
            );
          })
        )}
      </div>
      <div className="flex gap-2">
        <Button 
          variant="outline"
          className="flex-1" 
          onClick={onClose}
          data-testid="button-cancel-classes"
        >
          Cancel
        </Button>
        <Button 
          className="flex-1" 
          onClick={() => saveMutation.mutate(selectedClasses)}
          disabled={saveMutation.isPending}
          data-testid="button-save-classes"
        >
          {saveMutation.isPending ? "Saving..." : "Save Classes"}
        </Button>
      </div>
    </div>
  );
}

function UserAccountModal({ 
  staff, 
  onClose 
}: { 
  staff: Staff; 
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const { data: userData, isLoading, refetch } = useQuery<User | null>({
    queryKey: ["/api/staff", staff.id, "user"],
    queryFn: async () => {
      const res = await schoolFetch(`/api/staff/${staff.id}/user`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch user");
      }
      return res.json();
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const res = await apiRequest("POST", `/api/staff/${staff.id}/user`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", staff.id, "user"] });
      refetch();
      setIsCreating(false);
      setUsername("");
      setNewPassword("");
      toast({ title: "Success", description: "User account created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("PUT", `/api/staff/${staff.id}/user/password`, { password });
      return res.json();
    },
    onSuccess: () => {
      setNewPassword("");
      toast({ title: "Success", description: "Password reset successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleAccountMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      const res = await apiRequest("PUT", `/api/staff/${staff.id}/user/status`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", staff.id, "user"] });
      refetch();
      toast({ title: "Success", description: "Account status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pb-4 border-b">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-lg font-medium">
          {staff.firstName?.[0]}{staff.lastName?.[0]}
        </div>
        <div>
          <p className="font-medium text-lg">{staff.firstName} {staff.lastName}</p>
          <p className="text-sm text-muted-foreground">{staff.email || "No email"}</p>
        </div>
      </div>

      {userData ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div>
              <p className="font-medium">Username</p>
              <p className="text-sm text-muted-foreground">{userData.username}</p>
            </div>
            <Badge variant={userData.isActive !== false ? "default" : "secondary"} className={userData.isActive !== false ? "bg-green-500" : ""}>
              {userData.isActive !== false ? "Active" : "Inactive"}
            </Badge>
          </div>

          <div className="space-y-2">
            <Label>Reset Password</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                onClick={() => resetPasswordMutation.mutate(newPassword)}
                disabled={!newPassword || resetPasswordMutation.isPending}
                data-testid="button-reset-password"
              >
                <KeyRound className="h-4 w-4 mr-1" />
                Reset
              </Button>
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t">
            <Button
              variant={userData.isActive !== false ? "destructive" : "default"}
              onClick={() => toggleAccountMutation.mutate(userData.isActive === false)}
              disabled={toggleAccountMutation.isPending}
              data-testid="button-toggle-account"
            >
              {userData.isActive !== false ? "Deactivate Account" : "Activate Account"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {isCreating ? (
            <CreateAccountForm
              entityType="staff"
              entityId={staff.id}
              entityName={`${staff.firstName} ${staff.lastName}`}
              defaultUsername={staff.email || staff.phone || ""}
              onSuccess={() => {
                setIsCreating(false);
                refetch();
              }}
              onCancel={() => setIsCreating(false)}
            />
          ) : (
            <div className="text-center py-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <UserCog className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground mb-4">No user account linked to this staff member</p>
              <Button onClick={() => setIsCreating(true)} data-testid="button-start-create-account">
                <Plus className="h-4 w-4 mr-2" />
                Create User Account
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AccessRightsPanel({
  staff,
  accessGroups,
  onClose,
}: {
  staff: Staff;
  accessGroups?: Array<{ id: number; name: string }>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [searchFilter, setSearchFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data: userData, isLoading: userLoading } = useQuery<User | null>({
    queryKey: ["/api/staff", staff.id, "user"],
    queryFn: async () => {
      const res = await schoolFetch(`/api/staff/${staff.id}/user`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch user");
      }
      return res.json();
    },
  });

  const { data: allPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/permissions"],
    enabled: !!userData,
  });

  const { data: effectivePermissions = [], refetch: refetchEffective } = useQuery<Array<{ permission: Permission; granted: boolean }>>({
    queryKey: ["/api/users", userData?.id, "permissions"],
    queryFn: async () => {
      const res = await schoolFetch(`/api/users/${userData!.id}/permissions`);
      if (!res.ok) throw new Error("Failed to fetch permissions");
      return res.json();
    },
    enabled: !!userData?.id,
  });

  const { data: overrides = [], refetch: refetchOverrides } = useQuery<UserPermissionOverride[]>({
    queryKey: ["/api/users", userData?.id, "permission-overrides"],
    queryFn: async () => {
      const res = await schoolFetch(`/api/users/${userData!.id}/permission-overrides`);
      if (!res.ok) throw new Error("Failed to fetch overrides");
      return res.json();
    },
    enabled: !!userData?.id,
  });

  const { data: userGroups = [] } = useQuery<AccessGroup[]>({
    queryKey: ["/api/users", userData?.id, "access-groups"],
    queryFn: async () => {
      const res = await schoolFetch(`/api/users/${userData!.id}/access-groups`);
      if (!res.ok) throw new Error("Failed to fetch groups");
      return res.json();
    },
    enabled: !!userData?.id,
  });

  const overrideMap = new Map(overrides.map(o => [o.permissionId, o.granted]));

  const togglePermissionMutation = useMutation({
    mutationFn: async ({ permissionId, granted }: { permissionId: number; granted: boolean }) => {
      const res = await apiRequest("POST", `/api/users/${userData!.id}/permission-overrides`, { permissionId, granted });
      return res.json();
    },
    onSuccess: () => {
      refetchEffective();
      refetchOverrides();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const removeOverrideMutation = useMutation({
    mutationFn: async (permissionId: number) => {
      const res = await apiRequest("DELETE", `/api/users/${userData!.id}/permission-overrides/${permissionId}`);
      return res.json();
    },
    onSuccess: () => {
      refetchEffective();
      refetchOverrides();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/users/${userData!.id}/permission-overrides`);
      return res.json();
    },
    onSuccess: () => {
      refetchEffective();
      refetchOverrides();
      toast({ title: "Success", description: "Access rights reset to group defaults" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (userLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="text-center py-8">
        <Shield className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-30" />
        <p className="font-medium text-muted-foreground">No user account found</p>
        <p className="text-sm text-muted-foreground">Create a user account first via the Manage button to configure access rights</p>
      </div>
    );
  }

  const categories = Array.from(new Set(allPermissions.map(p => p.category))).sort();

  const effectiveMap = new Map(effectivePermissions.map(ep => [ep.permission.id, ep.granted]));

  const allPermsWithStatus = allPermissions.map(p => ({
    permission: p,
    granted: effectiveMap.get(p.id) ?? false,
  }));

  const filteredPerms = allPermsWithStatus.filter(ep => {
    if (categoryFilter !== "all" && ep.permission.category !== categoryFilter) return false;
    if (searchFilter && !ep.permission.name.toLowerCase().includes(searchFilter.toLowerCase()) && !ep.permission.code.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    return true;
  });

  const sortedPerms = [...filteredPerms].sort((a, b) => {
    if (a.granted !== b.granted) return a.granted ? -1 : 1;
    return a.permission.name.localeCompare(b.permission.name);
  });

  const groupName = userGroups.length > 0 ? userGroups.map(g => g.name).join(", ") : "None";
  const overrideCount = overrides.length;

  const handleToggle = (permissionId: number, currentlyGranted: boolean) => {
    togglePermissionMutation.mutate({ permissionId, granted: !currentlyGranted });
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" data-testid="badge-access-group">
            <Shield className="h-3 w-3 mr-1" />
            Group: {groupName}
          </Badge>
          {overrideCount > 0 && (
            <Badge variant="outline" data-testid="badge-override-count">
              {overrideCount} custom {overrideCount === 1 ? "override" : "overrides"}
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (confirm("Reset all custom access rights to group defaults? This will remove all individual permission overrides.")) {
              resetAllMutation.mutate();
            }
          }}
          disabled={overrideCount === 0 || resetAllMutation.isPending}
          data-testid="button-reset-to-default"
        >
          <RotateCcw className="h-4 w-4 mr-1" />
          Reset to Group Default
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search permissions..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="pl-9"
            data-testid="input-search-permissions"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-permission-category">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <div className="flex flex-wrap gap-1.5">
          {sortedPerms.map(({ permission, granted }) => {
            const hasOverride = overrideMap.has(permission.id);
            return (
              <Badge
                key={permission.id}
                variant={granted ? "default" : "outline"}
                className={`cursor-pointer select-none gap-1 ${hasOverride ? "ring-1 ring-primary/50" : ""}`}
                onClick={() => handleToggle(permission.id, granted)}
                data-testid={`permission-chip-${permission.id}`}
                title={permission.description || permission.name}
              >
                {granted && <Check className="h-3 w-3" />}
                {permission.name}
                {hasOverride && <span className="text-[10px] opacity-70">(custom)</span>}
              </Badge>
            );
          })}
        </div>

        {sortedPerms.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Shield className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No permissions match your filter</p>
          </div>
        )}
      </div>
    </div>
  );
}
