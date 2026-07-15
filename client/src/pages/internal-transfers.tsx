import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowRightLeft, CheckCircle2, GraduationCap, Loader2, Search, UserCog, Users } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AccessGroup, Class, School, Staff, Student } from "@shared/schema";

type TransferRecord = {
  id: number;
  personType: "student" | "staff";
  personId: number;
  personName: string;
  sourceSchoolName: string;
  destinationSchoolName: string;
  sourceClassName?: string | null;
  destinationClassName?: string | null;
  sourceAdmissionNo?: string | null;
  destinationAdmissionNo?: string | null;
  sourceRole?: string | null;
  destinationRole?: string | null;
  reason: string;
  effectiveDate: string;
  completedAt?: string | null;
  warnings?: string[];
};

type StaffRoleOption = {
  id: number;
  name: string;
  label: string;
  accessGroupId?: number | null;
};

function fullName(person: { firstName?: string | null; lastName?: string | null }) {
  return `${person.firstName || ""} ${person.lastName || ""}`.trim() || "Unnamed";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Transfer failed";
  const match = message.match(/^\d+:\s*(.*)$/);
  if (!match) return message;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed.message || match[1];
  } catch {
    return match[1];
  }
}

function SchoolArrow({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{from}</span>
      <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">{to}</span>
    </div>
  );
}

export default function InternalTransfersPage() {
  const { user, currentSchoolId, hasPermission } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("students");
  const [studentSearch, setStudentSearch] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [studentForm, setStudentForm] = useState({
    studentId: "",
    destinationSchoolId: "",
    destinationClassId: "",
    admissionNo: "",
    effectiveDate: todayIso(),
    reason: "",
    notes: "",
  });
  const [staffForm, setStaffForm] = useState({
    staffId: "",
    destinationSchoolId: "",
    destinationRole: "",
    destinationAccessGroupId: "",
    effectiveDate: todayIso(),
    reason: "",
    notes: "",
  });

  const isHq = user?.role === "org_admin" && !currentSchoolId;
  const canTransferStudents = hasPermission("internal_transfers.transfer.student");
  const canTransferStaff = hasPermission("internal_transfers.transfer.staff");

  const { data: classes = [] } = useQuery<Class[]>({ queryKey: ["/api/classes"] });
  const { data: directorySchools = [] } = useQuery<School[]>({ queryKey: ["/api/schools"] });
  const { data: students = [], isLoading: studentsLoading } = useQuery<Student[]>({ queryKey: ["/api/students"] });
  const { data: staff = [], isLoading: staffLoading } = useQuery<Staff[]>({ queryKey: ["/api/staff"] });
  const { data: accessGroups = [] } = useQuery<AccessGroup[]>({ queryKey: ["/api/access-groups"] });
  const { data: staffRoles = [] } = useQuery<StaffRoleOption[]>({ queryKey: ["/api/staff-roles"] });
  const { data: transfers = [], isLoading: transfersLoading } = useQuery<TransferRecord[]>({ queryKey: ["/api/internal-transfers"] });

  const sourceStudent = students.find((item) => String(item.id) === studentForm.studentId);
  const sourceStaff = staff.find((item) => String(item.id) === staffForm.staffId);
  const selectedSourceSchoolId = activeTab === "students"
    ? sourceStudent?.schoolId
    : activeTab === "staff"
      ? sourceStaff?.schoolId
      : currentSchoolId || user?.schoolId;
  const destinationSchoolsUrl = selectedSourceSchoolId
    ? `/api/internal-transfers/destinations?sourceSchoolId=${selectedSourceSchoolId}`
    : "/api/internal-transfers/destinations";

  const {
    data: schools = [],
    isLoading: schoolsLoading,
    isError: schoolsError,
    error: schoolsQueryError,
  } = useQuery<School[]>({ queryKey: [destinationSchoolsUrl] });
  const {
    data: destinationClasses = [],
    isLoading: destinationClassesLoading,
  } = useQuery<Class[]>({
    queryKey: ["/api/internal-transfers/destinations", studentForm.destinationSchoolId, "classes"],
    enabled: Boolean(studentForm.destinationSchoolId),
  });

  const schoolById = useMemo(
    () => new Map([...directorySchools, ...schools].map((school) => [Number(school.id), school])),
    [directorySchools, schools],
  );
  const classById = useMemo(() => new Map(classes.map((item) => [item.id, item])), [classes]);
  const getSchoolName = (schoolId?: number | null) => {
    if (!schoolId) return "No school";
    return schoolById.get(Number(schoolId))?.name || `School #${schoolId}`;
  };

  const destinationStudentClasses = destinationClasses;
  const destinationSchoolsForStudent = schools.filter((school) => sourceStudent?.schoolId !== school.id);
  const destinationSchoolsForStaff = schools.filter((school) => sourceStaff?.schoolId !== school.id);

  const filteredStudents = students.filter((student) => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return true;
    return [fullName(student), student.admissionNo, getSchoolName(student.schoolId)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  }).slice(0, 80);

  const filteredStaff = staff.filter((member) => {
    const q = staffSearch.trim().toLowerCase();
    if (!q) return true;
    return [fullName(member), member.staffNo, member.role, getSchoolName(member.schoolId)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  }).slice(0, 80);

  const transferStudent = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/internal-transfers/students", {
        ...studentForm,
        studentId: Number(studentForm.studentId),
        destinationSchoolId: Number(studentForm.destinationSchoolId),
        destinationClassId: Number(studentForm.destinationClassId),
        admissionNo: studentForm.admissionNo.trim() || null,
        notes: studentForm.notes.trim() || null,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      queryClient.invalidateQueries({ queryKey: ["/api/internal-transfers"] });
      setStudentForm({ studentId: "", destinationSchoolId: "", destinationClassId: "", admissionNo: "", effectiveDate: todayIso(), reason: "", notes: "" });
      toast({
        title: "Student transferred",
        description: data?.warnings?.length ? data.warnings.join(" ") : "The student has been moved to the destination school.",
      });
    },
    onError: (error) => toast({ title: "Transfer failed", description: parseError(error), variant: "destructive" }),
  });

  const transferStaff = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/internal-transfers/staff", {
        ...staffForm,
        staffId: Number(staffForm.staffId),
        destinationSchoolId: Number(staffForm.destinationSchoolId),
        destinationAccessGroupId: staffForm.destinationAccessGroupId ? Number(staffForm.destinationAccessGroupId) : null,
        notes: staffForm.notes.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/internal-transfers"] });
      setStaffForm({ staffId: "", destinationSchoolId: "", destinationRole: "", destinationAccessGroupId: "", effectiveDate: todayIso(), reason: "", notes: "" });
      toast({ title: "Staff member transferred", description: "The staff record and linked account have been moved to the destination school." });
    },
    onError: (error) => toast({ title: "Transfer failed", description: parseError(error), variant: "destructive" }),
  });

  const canSubmitStudent = studentForm.studentId && studentForm.destinationSchoolId && studentForm.destinationClassId && studentForm.effectiveDate && studentForm.reason.trim().length >= 3;
  const canSubmitStaff = staffForm.staffId && staffForm.destinationSchoolId && staffForm.destinationRole && staffForm.destinationAccessGroupId && staffForm.effectiveDate && staffForm.reason.trim().length >= 3;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6" data-testid="page-internal-transfers">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ArrowRightLeft className="h-7 w-7" />
            Internal Transfers
          </h1>
          <p className="text-muted-foreground">
            Move students and staff between schools within the organisation without creating duplicate records.
          </p>
        </div>
        <Badge variant="outline" className="w-fit">School-to-school only</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <GraduationCap className="h-8 w-8 text-primary" />
            <div>
              <div className="text-2xl font-bold">{transfers.filter((item) => item.personType === "student").length}</div>
              <p className="text-sm text-muted-foreground">Student transfers</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <UserCog className="h-8 w-8 text-primary" />
            <div>
              <div className="text-2xl font-bold">{transfers.filter((item) => item.personType === "staff").length}</div>
              <p className="text-sm text-muted-foreground">Staff transfers</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-primary" />
            <div>
              <div className="text-2xl font-bold">{transfers.length}</div>
              <p className="text-sm text-muted-foreground">Completed records</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {!canTransferStudents && !canTransferStaff && (
        <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20">
          <CardContent className="p-4 text-sm">
            You can view completed transfers, but you do not have permission to complete student or staff transfers.
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 md:w-auto">
          <TabsTrigger value="students" disabled={!canTransferStudents}>Students</TabsTrigger>
          <TabsTrigger value="staff" disabled={!canTransferStaff}>Staff</TabsTrigger>
          <TabsTrigger value="history">Completed</TabsTrigger>
        </TabsList>

        <TabsContent value="students" className="space-y-4">
          {!canTransferStudents ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">You do not have permission to transfer students between schools.</CardContent></Card>
          ) : (
          <Card>
            <CardHeader>
              <CardTitle>Transfer student</CardTitle>
              <CardDescription>Select the current student, destination school and destination class.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
              <div className="space-y-3">
                <Label>Find student</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search name, admission no. or school" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} />
                </div>
                <div className="max-h-[420px] overflow-y-auto rounded-md border divide-y">
                  {studentsLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading students...</div>
                  ) : filteredStudents.length ? filteredStudents.map((student) => {
                    const selected = studentForm.studentId === String(student.id);
                    return (
                      <button
                        key={student.id}
                        type="button"
                        className={`w-full text-left p-3 hover:bg-muted/60 ${selected ? "bg-primary/10" : ""}`}
                        onClick={() => setStudentForm((prev) => ({ ...prev, studentId: String(student.id), destinationSchoolId: "", destinationClassId: "", admissionNo: "" }))}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{fullName(student)}</p>
                            <p className="text-xs text-muted-foreground">{student.admissionNo} • {getSchoolName(student.schoolId)}</p>
                          </div>
                          {selected && <Badge>Selected</Badge>}
                        </div>
                      </button>
                    );
                  }) : <div className="p-4 text-sm text-muted-foreground">No students found.</div>}
                </div>
              </div>

              <div className="space-y-4">
                {sourceStudent && (
                  <Card className="bg-muted/30">
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">Current student</p>
                      <p className="font-semibold">{fullName(sourceStudent)}</p>
                      <p className="text-sm text-muted-foreground">
                        {getSchoolName(sourceStudent.schoolId)}
                        {sourceStudent.classId ? ` • ${classById.get(sourceStudent.classId)?.className || "Class"}` : ""}
                      </p>
                    </CardContent>
                  </Card>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Destination school</Label>
                    <Select value={studentForm.destinationSchoolId} onValueChange={(value) => setStudentForm((prev) => ({ ...prev, destinationSchoolId: value, destinationClassId: "" }))} disabled={!sourceStudent || schoolsLoading || schoolsError}>
                      <SelectTrigger>
                        <SelectValue placeholder={schoolsLoading ? "Loading schools..." : schoolsError ? "Unable to load schools" : "Choose school"} />
                      </SelectTrigger>
                      <SelectContent>
                        {schoolsLoading ? (
                          <div className="px-2 py-3 text-sm text-muted-foreground">Loading destination schools...</div>
                        ) : schoolsError ? (
                          <div className="px-2 py-3 text-sm text-destructive">{parseError(schoolsQueryError)}</div>
                        ) : destinationSchoolsForStudent.length ? (
                          destinationSchoolsForStudent.map((school) => <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>)
                        ) : (
                          <div className="px-2 py-3 text-sm text-muted-foreground">No other schools are available in this organisation.</div>
                        )}
                      </SelectContent>
                    </Select>
                    {schoolsError && <p className="text-xs text-destructive">{parseError(schoolsQueryError)}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Destination class</Label>
                    <Select
                      value={studentForm.destinationClassId}
                      onValueChange={(value) => setStudentForm((prev) => ({ ...prev, destinationClassId: value }))}
                      disabled={!studentForm.destinationSchoolId || destinationClassesLoading}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={destinationClassesLoading ? "Loading destination classes..." : "Choose class"} />
                      </SelectTrigger>
                      <SelectContent>
                        {destinationStudentClasses.length ? destinationStudentClasses.map((item) => (
                          <SelectItem key={item.id} value={String(item.id)}>{item.className}</SelectItem>
                        )) : (
                          <div className="px-2 py-3 text-sm text-muted-foreground">
                            {studentForm.destinationSchoolId ? "No classes are configured for this school." : "Choose a destination school first."}
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>New admission number</Label>
                    <Input placeholder="Leave blank to keep current" value={studentForm.admissionNo} onChange={(e) => setStudentForm((prev) => ({ ...prev, admissionNo: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Effective date</Label>
                    <Input type="date" value={studentForm.effectiveDate} onChange={(e) => setStudentForm((prev) => ({ ...prev, effectiveDate: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Reason</Label>
                  <Textarea placeholder="Reason for the internal transfer" value={studentForm.reason} onChange={(e) => setStudentForm((prev) => ({ ...prev, reason: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea placeholder="Optional notes" value={studentForm.notes} onChange={(e) => setStudentForm((prev) => ({ ...prev, notes: e.target.value }))} />
                </div>
                <Button disabled={!canTransferStudents || !canSubmitStudent || transferStudent.isPending} onClick={() => transferStudent.mutate()}>
                  {transferStudent.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Complete Student Transfer
                </Button>
              </div>
            </CardContent>
          </Card>
          )}
        </TabsContent>

        <TabsContent value="staff" className="space-y-4">
          {!canTransferStaff ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">You do not have permission to transfer staff between schools.</CardContent></Card>
          ) : (
          <Card>
            <CardHeader>
              <CardTitle>Transfer staff member</CardTitle>
              <CardDescription>Workloads, class-teacher links and timetable teacher links are cleared during transfer.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
              <div className="space-y-3">
                <Label>Find staff member</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search name, staff no. role or school" value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)} />
                </div>
                <div className="max-h-[420px] overflow-y-auto rounded-md border divide-y">
                  {staffLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading staff...</div>
                  ) : filteredStaff.length ? filteredStaff.map((member) => {
                    const selected = staffForm.staffId === String(member.id);
                    return (
                      <button
                        key={member.id}
                        type="button"
                        className={`w-full text-left p-3 hover:bg-muted/60 ${selected ? "bg-primary/10" : ""}`}
                        onClick={() => setStaffForm((prev) => ({ ...prev, staffId: String(member.id), destinationSchoolId: "", destinationRole: member.role || "teacher", destinationAccessGroupId: member.accessGroupId ? String(member.accessGroupId) : "" }))}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{fullName(member)}</p>
                            <p className="text-xs text-muted-foreground">{member.staffNo} • {member.role || "staff"} • {getSchoolName(member.schoolId)}</p>
                          </div>
                          {selected && <Badge>Selected</Badge>}
                        </div>
                      </button>
                    );
                  }) : <div className="p-4 text-sm text-muted-foreground">No staff members found.</div>}
                </div>
              </div>

              <div className="space-y-4">
                {sourceStaff && (
                  <Card className="bg-muted/30">
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">Current staff member</p>
                      <p className="font-semibold">{fullName(sourceStaff)}</p>
                      <p className="text-sm text-muted-foreground">{sourceStaff.role || "staff"} • {getSchoolName(sourceStaff.schoolId)}</p>
                    </CardContent>
                  </Card>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Destination school</Label>
                    <Select value={staffForm.destinationSchoolId} onValueChange={(value) => setStaffForm((prev) => ({ ...prev, destinationSchoolId: value }))} disabled={!sourceStaff || schoolsLoading || schoolsError}>
                      <SelectTrigger>
                        <SelectValue placeholder={schoolsLoading ? "Loading schools..." : schoolsError ? "Unable to load schools" : "Choose school"} />
                      </SelectTrigger>
                      <SelectContent>
                        {schoolsLoading ? (
                          <div className="px-2 py-3 text-sm text-muted-foreground">Loading destination schools...</div>
                        ) : schoolsError ? (
                          <div className="px-2 py-3 text-sm text-destructive">{parseError(schoolsQueryError)}</div>
                        ) : destinationSchoolsForStaff.length ? (
                          destinationSchoolsForStaff.map((school) => <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>)
                        ) : (
                          <div className="px-2 py-3 text-sm text-muted-foreground">No other schools are available in this organisation.</div>
                        )}
                      </SelectContent>
                    </Select>
                    {schoolsError && <p className="text-xs text-destructive">{parseError(schoolsQueryError)}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Destination role</Label>
                    <Select value={staffForm.destinationRole} onValueChange={(value) => {
                      const role = staffRoles.find((item) => item.name === value);
                      setStaffForm((prev) => ({ ...prev, destinationRole: value, destinationAccessGroupId: role?.accessGroupId ? String(role.accessGroupId) : prev.destinationAccessGroupId }));
                    }} disabled={!sourceStaff}>
                      <SelectTrigger><SelectValue placeholder="Choose role" /></SelectTrigger>
                      <SelectContent>
                        {staffRoles.length ? staffRoles.map((role) => <SelectItem key={role.id} value={role.name}>{role.label || role.name}</SelectItem>) : (
                          <div className="px-2 py-3 text-sm text-muted-foreground">No staff roles are configured.</div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Destination access group</Label>
                    <Select value={staffForm.destinationAccessGroupId} onValueChange={(value) => setStaffForm((prev) => ({ ...prev, destinationAccessGroupId: value }))} disabled={!sourceStaff}>
                      <SelectTrigger><SelectValue placeholder="Choose access group" /></SelectTrigger>
                      <SelectContent>
                        {accessGroups.length ? accessGroups.map((group) => <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>) : (
                          <div className="px-2 py-3 text-sm text-muted-foreground">No access groups are configured.</div>
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Required. This group controls the transferred staff member's permissions.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Effective date</Label>
                    <Input type="date" value={staffForm.effectiveDate} onChange={(e) => setStaffForm((prev) => ({ ...prev, effectiveDate: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Reason</Label>
                  <Textarea placeholder="Reason for the internal transfer" value={staffForm.reason} onChange={(e) => setStaffForm((prev) => ({ ...prev, reason: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea placeholder="Optional notes" value={staffForm.notes} onChange={(e) => setStaffForm((prev) => ({ ...prev, notes: e.target.value }))} />
                </div>
                <Button disabled={!canTransferStaff || !canSubmitStaff || transferStaff.isPending} onClick={() => transferStaff.mutate()}>
                  {transferStaff.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Complete Staff Transfer
                </Button>
              </div>
            </CardContent>
          </Card>
          )}
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Completed transfers</CardTitle>
              <CardDescription>{isHq ? "Showing all schools in the organisation." : "Showing transfers involving the current school."}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead>Assignment</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transfersLoading ? (
                      <TableRow><TableCell colSpan={5}>Loading transfers...</TableCell></TableRow>
                    ) : transfers.length ? transfers.map((transfer) => (
                      <TableRow key={transfer.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {transfer.personType === "student" ? <GraduationCap className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                            <div>
                              <p className="font-medium">{transfer.personName}</p>
                              <Badge variant="outline" className="capitalize">{transfer.personType}</Badge>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><SchoolArrow from={transfer.sourceSchoolName} to={transfer.destinationSchoolName} /></TableCell>
                        <TableCell className="text-sm">
                          {transfer.personType === "student" ? (
                            <span>{transfer.sourceClassName || "No class"} → {transfer.destinationClassName || "No class"}</span>
                          ) : (
                            <span>{transfer.sourceRole || "staff"} → {transfer.destinationRole || "staff"}</span>
                          )}
                        </TableCell>
                        <TableCell>{transfer.effectiveDate?.slice(0, 10)}</TableCell>
                        <TableCell className="max-w-[260px] truncate" title={transfer.reason}>{transfer.reason}</TableCell>
                      </TableRow>
                    )) : (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No transfers recorded yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
