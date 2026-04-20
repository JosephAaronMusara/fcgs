import { useState, useRef, useEffect, useMemo } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Trash2, GraduationCap, Download, Bell, Upload, BookOpen, UserCog, KeyRound, Eye, EyeOff, ArrowRightLeft, UserPlus, Camera, X, ChevronDown } from "lucide-react";
import type { Student, Class, Parent, Subject, Stream, User, School, Hostel, Staff } from "@shared/schema";
import { NotifyModal } from "@/components/notify-modal";
import { useAuth } from "@/lib/auth";
import * as XLSX from "xlsx";
import { ResidentialAreaInput } from "@/components/residential-area-input";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";

export default function StudentsPage() {
  const { toast } = useToast();
  const { currentSchoolId } = useAuth();
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [viewingStudent, setViewingStudent] = useState<Student | null>(null);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [isNotifyOpen, setIsNotifyOpen] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [subjectsDialogStudent, setSubjectsDialogStudent] = useState<Student | null>(null);
  const [accountDialogStudent, setAccountDialogStudent] = useState<Student | null>(null);
  const [transferDialogStudent, setTransferDialogStudent] = useState<Student | null>(null);
  const [quickAddParentOpen, setQuickAddParentOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: students, isLoading } = useQuery<Student[]>({
    queryKey: ["/api/students"],
  });

  const { data: classes } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
  });

  const { data: parents, refetch: refetchParents } = useQuery<Parent[]>({
    queryKey: ["/api/parents"],
  });

  const { data: streams } = useQuery<Stream[]>({
    queryKey: ["/api/streams"],
  });

  const { data: subjects } = useQuery<Subject[]>({
    queryKey: ["/api/subjects"],
  });

  const { data: nextAdmissionNo } = useQuery<{ admissionNo: string }>({
    queryKey: ["/api/students/next-admission-no"],
  });

  const { data: staff } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
  });

  const { data: school } = useQuery<School>({
    queryKey: ["/api/schools/current"],
    enabled: !!currentSchoolId,
  });

  const isBoardingSchool = school?.enableHostel || false;

  const { data: hostels } = useQuery<Hostel[]>({
    queryKey: ["/api/hostels"],
    enabled: isBoardingSchool,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<Student>) => {
      const res = await apiRequest("POST", "/api/students", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      queryClient.invalidateQueries({ queryKey: ["/api/students/next-admission-no"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setIsAddOpen(false);
      toast({ title: "Success", description: "Student added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Student> }) => {
      const res = await apiRequest("PUT", `/api/students/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      setEditingStudent(null);
      toast({ title: "Success", description: "Student updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/students/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Success", description: "Student deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const transferMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/students/${id}/transfer`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      setTransferDialogStudent(null);
      toast({ title: "Success", description: "Student transferred successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (studentData: Array<Record<string, unknown>>) => {
      const res = await apiRequest("POST", "/api/students/import", { students: studentData });
      return res.json();
    },
    onSuccess: (data: { imported: number; skipped: number; parentsCreated: number; classesCreated: number; total: number; errors?: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      queryClient.invalidateQueries({ queryKey: ["/api/students/next-admission-no"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      
      let description = `Imported ${data.imported} of ${data.total} students.`;
      if (data.parentsCreated > 0) description += ` Created ${data.parentsCreated} parents.`;
      if (data.classesCreated > 0) description += ` Created ${data.classesCreated} classes.`;
      if (data.skipped > 0) description += ` Skipped ${data.skipped} (duplicates/errors).`;
      
      toast({ title: "Import Complete", description });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createParentMutation = useMutation({
    mutationFn: async (data: Partial<Parent>) => {
      const res = await apiRequest("POST", "/api/parents", data);
      return res.json();
    },
    onSuccess: () => {
      refetchParents();
      setQuickAddParentOpen(false);
      toast({ title: "Success", description: "Parent added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filteredStudents = students?.filter((s) => {
    const matchesSearch = `${s.firstName} ${s.lastName} ${s.admissionNo}`.toLowerCase().includes(search.toLowerCase());
    const matchesClass = classFilter === "all" || s.classId?.toString() === classFilter;
    const matchesStatus = statusFilter === "all" || s.status === statusFilter;
    return matchesSearch && matchesClass && matchesStatus;
  });

  const { sortedData: sortedStudents, sortConfig, requestSort } = useTableSort(filteredStudents);

  const getClassName = (classId: number | null) => {
    if (!classId) return "-";
    const cls = classes?.find((c) => c.id === classId);
    return cls?.className || "-";
  };

  const getHostelName = (student: Student) => {
    if (!isBoardingSchool) return null;
    if (student.isDayScholar) return "N/A";
    if (!student.hostelId) return "Unassigned";
    const hostel = hostels?.find((h) => h.id === student.hostelId);
    return hostel?.name || "Unassigned";
  };

  const getParentName = (parentId: number | null) => {
    if (!parentId) return "-";
    const parent = parents?.find((p) => p.id === parentId);
    return parent ? `${parent.firstName} ${parent.lastName}` : "-";
  };

  const getNotifyRecipients = () => {
    const selectedStudents = selectedStudentIds.length > 0 
      ? students?.filter(s => selectedStudentIds.includes(s.id)) 
      : filteredStudents;
    
    return selectedStudents?.map(s => ({
      id: s.id,
      name: `${s.firstName} ${s.lastName}`,
      email: s.email || undefined,
      phone: s.phone || undefined,
    })) || [];
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data: Partial<Student> = {
      admissionNo: formData.get("admissionNo") as string,
      firstName: formData.get("firstName") as string,
      lastName: formData.get("lastName") as string,
      email: formData.get("email") as string || undefined,
      phone: formData.get("phone") as string || undefined,
      gender: formData.get("gender") as "male" | "female" | undefined,
      dateOfBirth: formData.get("dateOfBirth") as string || undefined,
      streetAddress: formData.get("streetAddress") as string || undefined,
      residentialArea: formData.get("residentialArea") as string || undefined,
      address: formData.get("address") as string || undefined,
      classId: formData.get("classId") ? parseInt(formData.get("classId") as string) : undefined,
      parentId: formData.get("parentId") ? parseInt(formData.get("parentId") as string) : undefined,
      streamId: formData.get("streamId") ? parseInt(formData.get("streamId") as string) : undefined,
      status: formData.get("status") as "active" | "inactive" | "transferred" | "graduated" || "active",
      enrollmentDate: formData.get("enrollmentDate") as string || new Date().toISOString().split("T")[0],
      isDayScholar: formData.get("isDayScholar") === "true",
      isBoarding: formData.get("isDayScholar") === "false",
      hostelId: formData.get("hostelId") ? parseInt(formData.get("hostelId") as string) : null,
    };

    if (editingStudent) {
      updateMutation.mutate({ id: editingStudent.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleExport = () => {
    if (!filteredStudents?.length) {
      toast({ title: "No data", description: "No students to export", variant: "destructive" });
      return;
    }

    const exportData = filteredStudents.map(s => ({
      "Admission No": s.admissionNo,
      "First Name": s.firstName,
      "Last Name": s.lastName,
      "Email": s.email || "",
      "Phone": s.phone || "",
      "Gender": s.gender?.toUpperCase() || "",
      "Date of Birth": s.dateOfBirth || "",
      "Street Address": s.streetAddress || "",
      "Residential Area": s.residentialArea || "",
      "City": s.address || "",
      "Class": getClassName(s.classId),
      ...(isBoardingSchool ? { "Hostel": getHostelName(s) || "N/A" } : {}),
      "Parent": getParentName(s.parentId),
      "Status": s.status || "active",
      "Enrollment Date": s.enrollmentDate || "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Students");
    const datePart = new Date().toISOString().split('T')[0];
    const classLabel = classFilter !== "all" ? `_${getClassName(parseInt(classFilter)).replace(/\s+/g, "_")}` : "";
    const statusLabel = statusFilter !== "all" ? `_${statusFilter}` : "";
    const searchLabel = search.trim() ? `_search_${search.trim().replace(/\s+/g, "_")}` : "";
    XLSX.writeFile(workbook, `Students${classLabel}${statusLabel}${searchLabel}_${datePart}.xlsx`);
    toast({ title: "Success", description: "Student list downloaded successfully" });
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

        const normalizeGender = (g: string | undefined): "male" | "female" | undefined => {
          if (!g) return undefined;
          const lower = g.toLowerCase().trim();
          if (lower === "male" || lower === "m") return "male";
          if (lower === "female" || lower === "f") return "female";
          return undefined;
        };

        const studentData = jsonData.map(row => ({
          admissionNo: row["Reg No."] || row["Admission No"] || row["admission_no"] || row["RegNo"] || "",
          firstName: (row["First Name"] || row["first_name"] || row["FirstName"] || "").trim(),
          lastName: (row["Last Name"] || row["last_name"] || row["LastName"] || "").trim(),
          email: row["Email"] || row["email"] || "",
          phone: row["Phone"] || row["phone"] || "",
          gender: normalizeGender(row["Gender"] || row["gender"]),
          dateOfBirth: row["D.O.B"] || row["Date of Birth"] || row["dob"] || row["DOB"] || "",
          streetAddress: row["Street Address"] || row["street_address"] || "",
          residentialArea: row["Residential Area"] || row["residential_area"] || "",
          address: row["City"] || row["Address"] || row["address"] || "",
          status: (row["Status"] || row["status"] || "active").toLowerCase() as "active" | "inactive" | "transferred" | "graduated",
          className: row["Class"] || row["class"] || "",
          parentName: row["Parent Name"] || row["parent_name"] || "",
          parentPhone: row["Parent Phone"] || row["parent_phone"] || "",
          parentEmail: row["Parent Email"] || row["parent_email"] || "",
          parentRelationship: row["Relationship With Guardian"] || row["relationship"] || "",
          enrollmentDate: row["Enrolled On"] || row["enrollment_date"] || "",
          religion: row["Religion"] || row["religion"] || "",
          transferReason: row["Transfer Reason"] || "",
        })).filter(s => s.firstName && s.lastName);

        if (studentData.length === 0) {
          toast({ title: "Error", description: "No valid student data found in file", variant: "destructive" });
          return;
        }

        toast({ title: "Importing", description: `Processing ${studentData.length} students...` });
        importMutation.mutate(studentData);
      } catch (error) {
        toast({ title: "Error", description: "Failed to parse file", variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleQuickAddParent = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createParentMutation.mutate({
      firstName: formData.get("parentFirstName") as string,
      lastName: formData.get("parentLastName") as string,
      phone: formData.get("parentPhone") as string,
      email: formData.get("parentEmail") as string || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <GraduationCap className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-students-title">Student Records</h1>
            <p className="text-muted-foreground">Manage student enrollment and information</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={handleExport} data-testid="button-download-students">
            <Download className="w-4 h-4 mr-2" />
            Download
          </Button>

          <Button variant="outline" onClick={() => setIsNotifyOpen(true)} data-testid="button-notify-students">
            <Bell className="w-4 h-4 mr-2" />
            Notify
          </Button>
          <NotifyModal
            open={isNotifyOpen}
            onOpenChange={setIsNotifyOpen}
            recipientType="student"
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
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-import-students">
            <Upload className="w-4 h-4 mr-2" />
            Upload
          </Button>

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-student">
                <Plus className="w-4 h-4 mr-2" />
                STUDENT
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Student</DialogTitle>
              </DialogHeader>
              <StudentForm
                onSubmit={handleSubmit}
                classes={classes || []}
                parents={parents || []}
                staff={staff || []}
                streams={streams || []}
                defaultAdmissionNo={nextAdmissionNo?.admissionNo}
                isLoading={createMutation.isPending}
                onQuickAddParent={() => setQuickAddParentOpen(true)}
                isBoardingSchool={isBoardingSchool}
                hostels={hostels || []}
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
                placeholder="Search students..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                data-testid="input-search-students"
              />
            </div>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-class-filter">
                <SelectValue placeholder="All Classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {classes?.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.className}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[150px]" data-testid="select-status-filter">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="transferred">Transferred</SelectItem>
                <SelectItem value="graduated">Graduated</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="secondary" className="flex items-center gap-1">
              <GraduationCap className="w-3 h-3" />
              {filteredStudents?.length || 0} Students
            </Badge>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox 
                        checked={selectedStudentIds.length === filteredStudents?.length && filteredStudents?.length > 0}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedStudentIds(filteredStudents?.map(s => s.id) || []);
                          } else {
                            setSelectedStudentIds([]);
                          }
                        }}
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <SortableTableHead sortKey="firstName" sortConfig={sortConfig} onSort={requestSort}>STUDENT</SortableTableHead>
                    <SortableTableHead sortKey="admissionNo" sortConfig={sortConfig} onSort={requestSort}>ADMISSION NO</SortableTableHead>
                    <SortableTableHead sortKey="classId" sortConfig={sortConfig} onSort={requestSort}>CLASS</SortableTableHead>
                    {isBoardingSchool && <SortableTableHead sortKey="hostelId" sortConfig={sortConfig} onSort={requestSort}>HOSTEL</SortableTableHead>}
                    <TableHead>PARENT</TableHead>
                    <TableHead>USER ACCOUNT</TableHead>
                    <SortableTableHead sortKey="status" sortConfig={sortConfig} onSort={requestSort}>STATUS</SortableTableHead>
                    <TableHead>ACTION</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sortedStudents ?? []).map((s) => (
                    <TableRow key={s.id} data-testid={`row-student-${s.id}`}>
                      <TableCell>
                        <Checkbox 
                          checked={selectedStudentIds.includes(s.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedStudentIds([...selectedStudentIds, s.id]);
                            } else {
                              setSelectedStudentIds(selectedStudentIds.filter(id => id !== s.id));
                            }
                          }}
                          data-testid={`checkbox-student-${s.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium overflow-hidden">
                            {s.photo ? (
                              <img src={s.photo} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span>{s.firstName?.[0]}{s.lastName?.[0]}</span>
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{s.firstName} {s.lastName}</p>
                            <p className="text-xs text-muted-foreground capitalize">{s.gender || ""}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{s.admissionNo}</TableCell>
                      <TableCell>{getClassName(s.classId)}</TableCell>
                      {isBoardingSchool && (
                        <TableCell data-testid={`text-hostel-${s.id}`}>
                          <span className={s.isDayScholar ? "text-muted-foreground" : ""}>
                            {getHostelName(s)}
                          </span>
                        </TableCell>
                      )}
                      <TableCell className="text-sm">{getParentName(s.parentId)}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAccountDialogStudent(s)}
                          data-testid={`button-account-student-${s.id}`}
                        >
                          <UserCog className="w-3 h-3 mr-1" />
                          Manage
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            s.status === "active"
                              ? "default"
                              : s.status === "graduated"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Dialog
                            open={viewingStudent?.id === s.id}
                            onOpenChange={(open) => !open && setViewingStudent(null)}
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setViewingStudent(s)}
                                data-testid={`button-view-student-${s.id}`}
                                title="View"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>View Student</DialogTitle>
                              </DialogHeader>
                              <StudentView
                                student={s}
                                className={getClassName(s.classId)}
                                parentName={getParentName(s.parentId)}
                                streamName={streams?.find((st) => st.id === s.streamId)?.name || "-"}
                                hostelName={getHostelName(s) || "-"}
                                isBoardingSchool={isBoardingSchool}
                              />
                            </DialogContent>
                          </Dialog>

                          <Dialog
                            open={editingStudent?.id === s.id}
                            onOpenChange={(open) => !open && setEditingStudent(null)}
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditingStudent(s)}
                                data-testid={`button-edit-student-${s.id}`}
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>Edit Student</DialogTitle>
                              </DialogHeader>
                              <StudentForm
                                onSubmit={handleSubmit}
                                classes={classes || []}
                                parents={parents || []}
                                staff={staff || []}
                                streams={streams || []}
                                defaultValues={s}
                                isLoading={updateMutation.isPending}
                                onQuickAddParent={() => setQuickAddParentOpen(true)}
                                isBoardingSchool={isBoardingSchool}
                                hostels={hostels || []}
                              />
                            </DialogContent>
                          </Dialog>

                          <Dialog
                            open={subjectsDialogStudent?.id === s.id}
                            onOpenChange={(open) => !open && setSubjectsDialogStudent(null)}
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setSubjectsDialogStudent(s)}
                                data-testid={`button-subjects-student-${s.id}`}
                                title="Subjects"
                              >
                                <BookOpen className="w-4 h-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>{`${s.firstName} ${s.lastName}`.toUpperCase()} SUBJECTS</DialogTitle>
                              </DialogHeader>
                              {subjectsDialogStudent && (
                                <AssignSubjectsDialog
                                  studentId={s.id}
                                  studentName={`${s.firstName} ${s.lastName}`.toUpperCase()}
                                  onClose={() => setSubjectsDialogStudent(null)}
                                />
                              )}
                            </DialogContent>
                          </Dialog>

                          <Dialog
                            open={transferDialogStudent?.id === s.id}
                            onOpenChange={(open) => !open && setTransferDialogStudent(null)}
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setTransferDialogStudent(s)}
                                data-testid={`button-transfer-student-${s.id}`}
                                title="Transfer"
                              >
                                <ArrowRightLeft className="w-4 h-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Transfer Student</DialogTitle>
                                <DialogDescription>
                                  Are you sure you want to mark {s.firstName} {s.lastName} as transferred?
                                </DialogDescription>
                              </DialogHeader>
                              <DialogFooter>
                                <Button variant="outline" onClick={() => setTransferDialogStudent(null)}>
                                  Cancel
                                </Button>
                                <Button 
                                  onClick={() => transferMutation.mutate(s.id)}
                                  disabled={transferMutation.isPending}
                                >
                                  {transferMutation.isPending ? "Transferring..." : "Confirm Transfer"}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm("Are you sure you want to delete this student?")) {
                                deleteMutation.mutate(s.id);
                              }
                            }}
                            data-testid={`button-delete-student-${s.id}`}
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredStudents?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No students found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {accountDialogStudent && (
        <StudentAccountDialog
          student={accountDialogStudent}
          onClose={() => setAccountDialogStudent(null)}
        />
      )}

      <Dialog open={quickAddParentOpen} onOpenChange={setQuickAddParentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick Add Parent</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleQuickAddParent} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="parentFirstName">First Name</Label>
                <Input id="parentFirstName" name="parentFirstName" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="parentLastName">Last Name</Label>
                <Input id="parentLastName" name="parentLastName" required />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="parentPhone">Phone</Label>
                <Input id="parentPhone" name="parentPhone" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="parentEmail">Email</Label>
                <Input id="parentEmail" name="parentEmail" type="email" />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={createParentMutation.isPending}>
              {createParentMutation.isPending ? "Adding..." : "Add Parent"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function StudentView({
  student,
  className,
  parentName,
  streamName,
  hostelName,
  isBoardingSchool,
}: {
  student: Student;
  className: string;
  parentName: string;
  streamName: string;
  hostelName: string;
  isBoardingSchool: boolean;
}) {
  const studentType = student.isDayScholar ? "Day Scholar" : "Boarder";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 overflow-hidden rounded-md border bg-muted flex items-center justify-center">
          {student.photo ? (
            <img src={student.photo} alt={`${student.firstName} ${student.lastName}`} className="h-full w-full object-cover" />
          ) : (
            <span className="text-lg font-semibold">{student.firstName?.[0]}{student.lastName?.[0]}</span>
          )}
        </div>
        <div>
          <h3 className="text-lg font-semibold">{student.firstName} {student.lastName}</h3>
          <p className="text-sm text-muted-foreground">Admission No: {student.admissionNo}</p>
          <p className="text-sm text-muted-foreground">Status: {student.status || "-"}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Student Type</Label>
          <div className="rounded-md border px-3 py-2 text-sm">{studentType}</div>
        </div>
        <div className="space-y-1">
          <Label>Class</Label>
          <div className="rounded-md border px-3 py-2 text-sm">{className}</div>
        </div>
        <div className="space-y-1">
          <Label>Stream</Label>
          <div className="rounded-md border px-3 py-2 text-sm">{streamName}</div>
        </div>
        {isBoardingSchool && !student.isDayScholar && (
          <div className="space-y-1">
            <Label>Hostel</Label>
            <div className="rounded-md border px-3 py-2 text-sm">{hostelName}</div>
          </div>
        )}
        <div className="space-y-1">
          <Label>Parent / Guardian</Label>
          <div className="rounded-md border px-3 py-2 text-sm">{parentName}</div>
        </div>
        <div className="space-y-1">
          <Label>Gender</Label>
          <div className="rounded-md border px-3 py-2 text-sm capitalize">{student.gender || "-"}</div>
        </div>
        <div className="space-y-1">
          <Label>Date of Birth</Label>
          <div className="rounded-md border px-3 py-2 text-sm">{student.dateOfBirth || "-"}</div>
        </div>
        <div className="space-y-1">
          <Label>Enrollment Date</Label>
          <div className="rounded-md border px-3 py-2 text-sm">{student.enrollmentDate || "-"}</div>
        </div>
        <div className="space-y-1">
          <Label>Phone</Label>
          <div className="rounded-md border px-3 py-2 text-sm">{student.phone || "-"}</div>
        </div>
        <div className="space-y-1">
          <Label>Email</Label>
          <div className="rounded-md border px-3 py-2 text-sm break-all">{student.email || "-"}</div>
        </div>
      </div>
    </div>
  );
}

function StudentForm({
  onSubmit,
  classes,
  parents,
  staff,
  streams,
  defaultValues,
  defaultAdmissionNo,
  isLoading,
  onQuickAddParent,
  isBoardingSchool,
  hostels,
}: {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  classes: Class[];
  parents: Parent[];
  staff: Staff[];
  streams: Stream[];
  defaultValues?: Student;
  defaultAdmissionNo?: string;
  isLoading: boolean;
  onQuickAddParent: () => void;
  isBoardingSchool: boolean;
  hostels: Hostel[];
}) {
  const defaultParent = defaultValues?.parentId
    ? parents.find(p => p.id === defaultValues.parentId)
    : undefined;

  const [parentSearch, setParentSearch] = useState(
    defaultParent ? `${defaultParent.firstName} ${defaultParent.lastName}` : ""
  );
  const [selectedParentId, setSelectedParentId] = useState<number | null>(
    defaultValues?.parentId || null
  );
  const [showParentSuggestions, setShowParentSuggestions] = useState(false);
  const [isCreatingParentFromStaff, setIsCreatingParentFromStaff] = useState(false);

  const parentSuggestions = parentSearch.trim().length >= 1
    ? [
        ...parents
          .filter(p =>
            `${p.firstName} ${p.lastName} ${p.phone || ""} ${p.email || ""}`.toLowerCase().includes(parentSearch.toLowerCase())
          )
          .map(p => ({ type: "parent" as const, id: p.id, name: `${p.firstName} ${p.lastName}`, detail: p.phone || p.email || "", source: p })),
        ...staff
          .filter(s =>
            `${s.firstName} ${s.lastName} ${s.phone || ""} ${s.email || ""}`.toLowerCase().includes(parentSearch.toLowerCase())
          )
          .filter(s => !parents.some(p =>
            p.firstName.toLowerCase() === s.firstName.toLowerCase() &&
            p.lastName.toLowerCase() === s.lastName.toLowerCase() &&
            (p.phone === s.phone || p.email === s.email)
          ))
          .map(s => ({ type: "staff" as const, id: s.id, name: `${s.firstName} ${s.lastName}`, detail: s.phone || s.email || "", source: s })),
      ]
    : [];

  const handleSelectParent = (suggestion: typeof parentSuggestions[0]) => {
    if (suggestion.type === "parent") {
      setSelectedParentId(suggestion.id);
      setParentSearch(suggestion.name);
      setShowParentSuggestions(false);
    } else {
      setIsCreatingParentFromStaff(true);
      const staffMember = suggestion.source as Staff;
      apiRequest("POST", "/api/parents", {
        firstName: staffMember.firstName,
        lastName: staffMember.lastName,
        phone: staffMember.phone || "",
        email: staffMember.email || undefined,
        address: staffMember.address || undefined,
        streetAddress: staffMember.streetAddress || undefined,
        residentialArea: staffMember.residentialArea || undefined,
        relationship: "parent",
      }).then(res => res.json()).then((newParent: Parent) => {
        setSelectedParentId(newParent.id);
        setParentSearch(`${newParent.firstName} ${newParent.lastName}`);
        setShowParentSuggestions(false);
        setIsCreatingParentFromStaff(false);
        queryClient.invalidateQueries({ queryKey: ["/api/parents"] });
      }).catch(() => {
        setIsCreatingParentFromStaff(false);
      });
    }
  };

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
      const res = await schoolFetch(`/api/students/${defaultValues.id}/photo`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || "Upload failed");
      }
      const data = await res.json();
      setPhotoPreview(data.photo);
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      toast({ title: "Photo uploaded successfully" });
    } catch (err: any) {
      toast({ title: err?.message || "Failed to upload photo", variant: "destructive" });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const getDefaultDayScholar = () => {
    if (defaultValues !== undefined) {
      return defaultValues.isDayScholar ? "true" : "false";
    }
    return isBoardingSchool ? "false" : "true";
  };

  const getDefaultGender = () => defaultValues?.gender || "";

  const [studentTypeValue, setStudentTypeValue] = useState<string>(getDefaultDayScholar());
  const [selectedHostelId, setSelectedHostelId] = useState<string>(defaultValues?.hostelId?.toString() || "none");
  const [selectedGender, setSelectedGender] = useState<string>(getDefaultGender());

  useEffect(() => {
    setStudentTypeValue(getDefaultDayScholar());
  }, [defaultValues?.id, isBoardingSchool]);

  useEffect(() => {
    setSelectedHostelId(defaultValues?.hostelId?.toString() || "none");
  }, [defaultValues?.id, defaultValues?.hostelId]);

  useEffect(() => {
    setSelectedGender(getDefaultGender());
  }, [defaultValues?.id, defaultValues?.gender]);

  useEffect(() => {
    if (studentTypeValue === "true") {
      setSelectedHostelId("none");
    }
  }, [studentTypeValue]);

  const filteredHostels = useMemo(() => {
    if (!selectedGender) return hostels;
    return hostels.filter((hostel) => !hostel.gender || hostel.gender === selectedGender);
  }, [hostels, selectedGender]);

  useEffect(() => {
    if (selectedHostelId === "none") return;
    const selectedHostel = hostels.find((hostel) => hostel.id.toString() === selectedHostelId);
    if (selectedHostel?.gender && selectedGender && selectedHostel.gender !== selectedGender) {
      setSelectedHostelId("none");
    }
  }, [selectedGender, selectedHostelId, hostels]);

  const showHostelField = isBoardingSchool && studentTypeValue === "false";
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="mb-2 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-1.5">
          <div
            className="w-20 h-20 rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden flex items-center justify-center bg-gray-50 dark:bg-gray-800 cursor-pointer"
            onClick={() => defaultValues?.id && photoInputRef.current?.click()}
            data-testid="button-upload-student-photo"
          >
            {photoPreview ? (
              <img src={photoPreview} alt="Student" className="w-full h-full object-cover" />
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
                data-testid="input-student-photo"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => photoInputRef.current?.click()}
                disabled={isUploadingPhoto}
                data-testid="button-change-student-photo"
              >
                {isUploadingPhoto ? "Uploading..." : photoPreview ? "Change" : "Upload"}
              </Button>
            </>
          )}
        </div>
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="admissionNo">Admission No</Label>
          <Input
            id="admissionNo"
            name="admissionNo"
            defaultValue={defaultValues?.admissionNo || defaultAdmissionNo}
            required
            data-testid="input-admission-no"
          />
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
              <SelectItem value="transferred">Transferred</SelectItem>
              <SelectItem value="graduated">Graduated</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="isDayScholar">Student Type</Label>
          <Select name="isDayScholar" value={studentTypeValue} onValueChange={setStudentTypeValue}>
            <SelectTrigger data-testid="select-day-scholar">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="false">Boarder</SelectItem>
              <SelectItem value="true">Day Scholar</SelectItem>
            </SelectContent>
          </Select>
        </div>
        </div>
      </div>
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
          <Label htmlFor="gender">Gender</Label>
          <input type="hidden" name="gender" value={selectedGender} />
          <Select value={selectedGender} onValueChange={setSelectedGender}>
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
          <Label htmlFor="dateOfBirth">Date of Birth</Label>
          <Input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            defaultValue={defaultValues?.dateOfBirth || ""}
            data-testid="input-dob"
          />
        </div>
      </div>
      <div className={`grid grid-cols-1 gap-4 ${isBoardingSchool ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <div className="space-y-2">
          <Label htmlFor="classId">Class</Label>
          <Select name="classId" defaultValue={defaultValues?.classId?.toString() || ""}>
            <SelectTrigger data-testid="select-class">
              <SelectValue placeholder="Select class" />
            </SelectTrigger>
            <SelectContent>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()}>
                  {c.className}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {showHostelField && (
          <div className="space-y-2">
            <Label htmlFor="hostelId">Hostel</Label>
            <input type="hidden" name="hostelId" value={selectedHostelId === "none" ? "" : selectedHostelId} />
            <Select value={selectedHostelId} onValueChange={setSelectedHostelId}>
              <SelectTrigger data-testid="select-hostel">
                <SelectValue placeholder="Select hostel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {filteredHostels.map(h => (
                  <SelectItem key={h.id} value={h.id.toString()}>
                    {h.name} {h.gender ? `(${h.gender === "male" ? "Boys" : "Girls"})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="streamId">Stream</Label>
          <Select name="streamId" defaultValue={defaultValues?.streamId?.toString() || ""}>
            <SelectTrigger data-testid="select-stream">
              <SelectValue placeholder="Select stream" />
            </SelectTrigger>
            <SelectContent>
              {streams.map((st) => (
                <SelectItem key={st.id} value={st.id.toString()}>
                  {st.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="parentSearch">Parent/Guardian</Label>
          <Button type="button" variant="ghost" size="sm" onClick={onQuickAddParent}>
            <UserPlus className="w-3 h-3 mr-1" />
            Quick Add
          </Button>
        </div>
        <input type="hidden" name="parentId" value={selectedParentId || ""} />
        <div className="relative">
          <Input
            id="parentSearch"
            placeholder="Type name or phone to search..."
            value={parentSearch}
            onChange={(e) => {
              setParentSearch(e.target.value);
              setShowParentSuggestions(true);
              if (!e.target.value.trim()) {
                setSelectedParentId(null);
              }
            }}
            onFocus={() => {
              if (parentSearch.trim().length >= 1) setShowParentSuggestions(true);
            }}
            onBlur={() => {
              setTimeout(() => setShowParentSuggestions(false), 200);
            }}
            data-testid="input-parent-search"
          />
          {selectedParentId && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs"
              onClick={() => {
                setSelectedParentId(null);
                setParentSearch("");
              }}
              data-testid="button-clear-parent"
            >
              Clear
            </button>
          )}
          {showParentSuggestions && parentSuggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
              {parentSuggestions.map((suggestion) => (
                <div
                  key={`${suggestion.type}-${suggestion.id}`}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover-elevate"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectParent(suggestion)}
                  data-testid={`suggestion-${suggestion.type}-${suggestion.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{suggestion.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{suggestion.detail}</p>
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {suggestion.type === "parent" ? "Parent" : "Staff"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          {isCreatingParentFromStaff && (
            <p className="text-xs text-muted-foreground mt-1">Creating parent record from staff...</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <Label htmlFor="enrollmentDate">Enrollment Date</Label>
        <Input
          id="enrollmentDate"
          name="enrollmentDate"
          type="date"
          defaultValue={defaultValues?.enrollmentDate || new Date().toISOString().split("T")[0]}
          data-testid="input-enrollment-date"
        />
      </div>
      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-save-student">
        {isLoading ? "Saving..." : defaultValues ? "Update Student" : "Add Student"}
      </Button>
    </form>
  );
}

function AssignSubjectsDialog({
  studentId,
  studentName,
  onClose,
}: {
  studentId: number;
  studentName: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [selectedSubjects, setSelectedSubjects] = useState<number[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const { data, isLoading } = useQuery<{ all: Subject[]; selected: string[] }>({
    queryKey: ["/api/students", studentId, "subjects"],
  });

  useEffect(() => {
    if (data?.selected) {
      setSelectedSubjects(data.selected.map(Number));
    }
  }, [data?.selected]);

  const allSubjects = data?.all || [];
  const selectedSubjectObjects = allSubjects.filter(s => selectedSubjects.includes(s.id));
  const availableSubjects = allSubjects.filter(s => !selectedSubjects.includes(s.id));

  const saveMutation = useMutation({
    mutationFn: async (subjectIds: number[]) => {
      await apiRequest("PUT", `/api/students/${studentId}/subjects`, { subjectIds });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/students", studentId, "subjects"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/qc-records/subjects"] }),
      ]);

      toast({ title: "Success", description: "Subjects updated successfully" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const removeSubject = (subjectId: number) => {
    setSelectedSubjects(prev => prev.filter(id => id !== subjectId));
  };

  const addSubject = (subjectId: number) => {
    setSelectedSubjects(prev => [...prev, subjectId]);
    setDropdownOpen(false);
  };

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="border rounded-md p-3 min-h-[120px] max-h-[300px] overflow-y-auto">
        <div className="flex flex-wrap gap-2">
          {selectedSubjectObjects.map((subject) => (
            <Badge
              key={subject.id}
              variant="secondary"
              className="text-sm py-1.5 px-3 gap-1"
              data-testid={`badge-subject-${subject.id}`}
            >
              {subject.name} {subject.shortCode ? `(${subject.shortCode})` : ""}
              <button
                onClick={() => removeSubject(subject.id)}
                className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                data-testid={`button-remove-subject-${subject.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {selectedSubjectObjects.length === 0 && (
            <p className="text-sm text-muted-foreground">No subjects assigned. Use the dropdown below to add subjects.</p>
          )}
        </div>
      </div>

      {availableSubjects.length > 0 && (
        <div className="relative">
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            data-testid="button-add-subject-dropdown"
          >
            <span className="text-muted-foreground">Add a subject...</span>
            <ChevronDown className="h-4 w-4" />
          </Button>
          {dropdownOpen && (
            <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
              {availableSubjects.map((subject) => (
                <button
                  key={subject.id}
                  className="w-full text-left px-3 py-2 text-sm hover-elevate cursor-pointer"
                  onClick={() => addSubject(subject.id)}
                  data-testid={`button-add-subject-${subject.id}`}
                >
                  {subject.name} {subject.shortCode ? `(${subject.shortCode})` : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} data-testid="button-cancel-subjects">
          Cancel
        </Button>
        <Button 
          onClick={() => saveMutation.mutate(selectedSubjects)}
          disabled={saveMutation.isPending}
          data-testid="button-submit-subjects"
        >
          {saveMutation.isPending ? "Saving..." : "Submit"}
        </Button>
      </div>
    </div>
  );
}

function StudentAccountDialog({
  student,
  onClose,
}: {
  student: Student;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const { data: linkedUser, isLoading, refetch } = useQuery<User | null>({
    queryKey: ["/api/students", student.id, "user"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/students/${student.id}/user`);
        if (res.ok) {
          return res.json();
        }
        return null;
      } catch {
        return null;
      }
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const res = await apiRequest("POST", `/api/students/${student.id}/user`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Account created successfully" });
      refetch();
      setIsCreating(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("PUT", `/api/students/${student.id}/user/password`, { password });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Password reset successfully" });
      setNewPassword("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      const res = await apiRequest("PUT", `/api/students/${student.id}/user/status`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Account status updated" });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateAccount = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createAccountMutation.mutate({
      username: formData.get("username") as string,
      password: formData.get("password") as string,
    });
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>User Account - {student.firstName} {student.lastName}</DialogTitle>
        </DialogHeader>
        
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : linkedUser ? (
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Username</span>
                <span className="font-medium">{linkedUser.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={linkedUser.isActive ? "default" : "secondary"}>
                  {linkedUser.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Reset Password</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <Button 
                  onClick={() => resetPasswordMutation.mutate(newPassword)}
                  disabled={!newPassword || resetPasswordMutation.isPending}
                >
                  <KeyRound className="w-4 h-4 mr-1" />
                  Reset
                </Button>
              </div>
            </div>

            <Button
              variant={linkedUser.isActive ? "destructive" : "default"}
              className="w-full"
              onClick={() => toggleStatusMutation.mutate(!linkedUser.isActive)}
              disabled={toggleStatusMutation.isPending}
            >
              {linkedUser.isActive ? "Deactivate Account" : "Activate Account"}
            </Button>
          </div>
        ) : isCreating ? (
          <CreateAccountForm
            entityType="students"
            entityId={student.id}
            entityName={`${student.firstName} ${student.lastName}`}
            defaultUsername={student.admissionNo?.toLowerCase() || ""}
            onSuccess={() => {
              setIsCreating(false);
              refetch();
            }}
            onCancel={() => setIsCreating(false)}
          />
        ) : (
          <div className="text-center py-4 space-y-4">
            <p className="text-muted-foreground">No user account linked to this student.</p>
            <Button onClick={() => setIsCreating(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Create User Account
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
