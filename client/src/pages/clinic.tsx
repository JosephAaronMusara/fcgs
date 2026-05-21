import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import { Plus, Stethoscope, Download, Upload, Search, Trash2, Eye } from "lucide-react";
import type { ClinicRecord, Student, Staff } from "@shared/schema";

const VISIT_TYPES = [
  "General Checkup",
  "Illness",
  "Injury",
  "Follow-up",
  "Medication Administration",
  "Emergency",
  "Dental",
  "Eye/Vision",
  "Allergy Reaction",
  "Mental Health",
  "Other",
];

export default function ClinicPage() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [viewRecord, setViewRecord] = useState<ClinicRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");

  const { data: records, isLoading } = useQuery<ClinicRecord[]>({
    queryKey: ["/api/clinic"],
  });

  const { data: students } = useQuery<Student[]>({
    queryKey: ["/api/students"],
  });

  const { data: staffList } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<ClinicRecord>) => {
      const res = await apiRequest("POST", "/api/clinic", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic"] });
      setIsAddOpen(false);
      toast({ title: "Success", description: "Clinic record added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/clinic/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic"] });
      toast({ title: "Deleted", description: "Clinic record deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async ({ records, fileName }: { records: Partial<ClinicRecord>[]; fileName?: string }) => {
      const res = await apiRequest("POST", "/api/clinic/import", { records, fileName });
      return res.json();
    },
    onSuccess: (data: { imported: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic"] });
      toast({ title: "Import complete", description: `${data.imported} records imported successfully` });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const getStudentName = (studentId: number) => {
    const student = students?.find((s) => s.id === studentId);
    return student ? `${student.firstName} ${student.lastName}` : "-";
  };

  const getStudentAdmNo = (studentId: number) => {
    const student = students?.find((s) => s.id === studentId);
    return student?.admissionNo || "";
  };

  const getStaffName = (staffId: number | null) => {
    if (!staffId) return "-";
    const s = staffList?.find((st) => st.id === staffId);
    return s ? `${s.firstName} ${s.lastName}` : "-";
  };

  const filteredRecordsBase = records?.filter((r) => {
    const studentName = getStudentName(r.studentId).toLowerCase();
    const admNo = getStudentAdmNo(r.studentId).toLowerCase();
    const matchesSearch = !searchTerm || studentName.includes(searchTerm.toLowerCase()) || admNo.includes(searchTerm.toLowerCase());
    const matchesType = filterType === "all" || r.visitType === filterType;
    return matchesSearch && matchesType;
  });

  const { sortedData: sortedClinic, sortConfig, requestSort } = useTableSort(filteredRecordsBase);
  const filteredRecords = sortedClinic;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data: Record<string, unknown> = {
      studentId: parseInt(formData.get("studentId") as string),
      visitDate: formData.get("visitDate") as string,
      visitType: formData.get("visitType") as string,
      symptoms: formData.get("symptoms") as string || undefined,
      diagnosis: formData.get("diagnosis") as string || undefined,
      treatment: formData.get("treatment") as string || undefined,
      medicationGiven: formData.get("medicationGiven") as string || undefined,
      temperature: formData.get("temperature") as string || undefined,
      bloodPressure: formData.get("bloodPressure") as string || undefined,
      weight: formData.get("weight") as string || undefined,
      severity: formData.get("severity") as string || "mild",
      followUpRequired: formData.get("followUpRequired") === "on",
      followUpDate: formData.get("followUpDate") as string || undefined,
      parentNotified: formData.get("parentNotified") === "on",
      referredToHospital: formData.get("referredToHospital") === "on",
      hospitalName: formData.get("hospitalName") as string || undefined,
      attendedBy: formData.get("attendedBy") ? parseInt(formData.get("attendedBy") as string) : undefined,
      notes: formData.get("notes") as string || undefined,
    };
    createMutation.mutate(data as Partial<ClinicRecord>);
  };

  const handleExportCSV = () => {
    if (!filteredRecords?.length) return;
    const headers = ["Student", "Admission No", "Visit Date", "Visit Type", "Symptoms", "Diagnosis", "Treatment", "Medication", "Temperature", "Blood Pressure", "Weight", "Severity", "Follow-up Required", "Follow-up Date", "Parent Notified", "Referred to Hospital", "Hospital", "Attended By", "Notes"];
    const rows = filteredRecords.map((r) => [
      getStudentName(r.studentId),
      getStudentAdmNo(r.studentId),
      r.visitDate,
      r.visitType,
      r.symptoms || "",
      r.diagnosis || "",
      r.treatment || "",
      r.medicationGiven || "",
      r.temperature || "",
      r.bloodPressure || "",
      r.weight || "",
      r.severity || "",
      r.followUpRequired ? "Yes" : "No",
      r.followUpDate || "",
      r.parentNotified ? "Yes" : "No",
      r.referredToHospital ? "Yes" : "No",
      r.hospitalName || "",
      getStaffName(r.attendedBy),
      r.notes || "",
    ]);
    const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const typeLabel = filterType !== "all" ? `_${filterType.replace(/\s+/g, "_")}` : "";
    const searchLabel = searchTerm.trim() ? `_search_${searchTerm.trim().replace(/\s+/g, "_")}` : "";
    a.download = `Clinic_Records${typeLabel}${searchLabel}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) {
        toast({ title: "Error", description: "CSV must have a header row and at least one data row", variant: "destructive" });
        return;
      }
      const parseCSVLine = (line: string) => {
        const result: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
            else { inQuotes = !inQuotes; }
          } else if (ch === "," && !inQuotes) {
            result.push(current.trim());
            current = "";
          } else {
            current += ch;
          }
        }
        result.push(current.trim());
        return result;
      };

      const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
      const importData: Partial<ClinicRecord>[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length < 3) continue;

        const admNoIdx = headers.findIndex((h) => h.includes("admission") || h === "admno" || h === "admissionno");
        const studentNameIdx = headers.findIndex((h) => h === "student" || h === "studentname");
        const dateIdx = headers.findIndex((h) => h.includes("date") && h.includes("visit"));
        const typeIdx = headers.findIndex((h) => h.includes("type") || h.includes("visit"));

        let studentId: number | undefined;
        if (admNoIdx >= 0 && cols[admNoIdx]) {
          const found = students?.find((s) => s.admissionNo === cols[admNoIdx]);
          if (found) studentId = found.id;
        }
        if (!studentId && studentNameIdx >= 0 && cols[studentNameIdx]) {
          const parts = cols[studentNameIdx].split(" ");
          const found = students?.find((s) =>
            s.firstName.toLowerCase() === parts[0]?.toLowerCase() &&
            s.lastName.toLowerCase() === parts[parts.length - 1]?.toLowerCase()
          );
          if (found) studentId = found.id;
        }
        if (!studentId) continue;

        importData.push({
          studentId,
          visitDate: dateIdx >= 0 ? cols[dateIdx] : new Date().toISOString().split("T")[0],
          visitType: typeIdx >= 0 ? cols[typeIdx] : "General Checkup",
          symptoms: cols[headers.findIndex((h) => h === "symptoms")] || undefined,
          diagnosis: cols[headers.findIndex((h) => h === "diagnosis")] || undefined,
          treatment: cols[headers.findIndex((h) => h === "treatment")] || undefined,
          medicationGiven: cols[headers.findIndex((h) => h.includes("medication"))] || undefined,
          severity: cols[headers.findIndex((h) => h === "severity")] || "mild",
        } as Partial<ClinicRecord>);
      }

      if (importData.length === 0) {
        toast({ title: "Error", description: "No valid records found in CSV. Ensure student admission numbers match.", variant: "destructive" });
        return;
      }
      importMutation.mutate({ records: importData, fileName: file.name });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Stethoscope className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#1b2a5c" }} data-testid="text-clinic-title">Clinic Records</h1>
            <p className="text-muted-foreground">Track student clinic visits and medical records</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!filteredRecords?.length} data-testid="button-export-clinic">
            <Download className="w-4 h-4 mr-1" />
            Download CSV
          </Button>
          <label>
            <Button variant="outline" size="sm" asChild data-testid="button-import-clinic">
              <span>
                <Upload className="w-4 h-4 mr-1" />
                Upload CSV
              </span>
            </Button>
            <input type="file" accept=".csv" className="hidden" onChange={handleImportCSV} />
          </label>
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-clinic-record">
                <Plus className="w-4 h-4 mr-2" />
                Add Record
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
              <DialogHeader>
                <DialogTitle>Add Clinic Visit Record</DialogTitle>
              </DialogHeader>
              <ClinicForm
                onSubmit={handleSubmit}
                students={students || []}
                staffList={staffList || []}
                isLoading={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full flex-1 min-w-0 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by student name or admission no..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search-clinic"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-filter-type">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {VISIT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filteredRecords && (
          <Badge variant="secondary" data-testid="badge-record-count">
            {filteredRecords.length} record{filteredRecords.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-blue-500" />
            Visit History
          </CardTitle>
        </CardHeader>
        <CardContent>
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
                    <SortableTableHead sortKey="studentId" sortConfig={sortConfig} onSort={requestSort}>Student</SortableTableHead>
                    <SortableTableHead sortKey="visitDate" sortConfig={sortConfig} onSort={requestSort}>Date</SortableTableHead>
                    <SortableTableHead sortKey="visitType" sortConfig={sortConfig} onSort={requestSort}>Visit Type</SortableTableHead>
                    <SortableTableHead sortKey="severity" sortConfig={sortConfig} onSort={requestSort}>Severity</SortableTableHead>
                    <SortableTableHead sortKey="diagnosis" sortConfig={sortConfig} onSort={requestSort}>Diagnosis</SortableTableHead>
                    <SortableTableHead sortKey="referredToHospital" sortConfig={sortConfig} onSort={requestSort}>Referred</SortableTableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords?.map((r) => (
                    <TableRow key={r.id} data-testid={`row-clinic-${r.id}`}>
                      <TableCell>
                        <div>
                          <span className="font-medium">{getStudentName(r.studentId)}</span>
                          <span className="text-xs text-muted-foreground block">{getStudentAdmNo(r.studentId)}</span>
                        </div>
                      </TableCell>
                      <TableCell>{r.visitDate}</TableCell>
                      <TableCell>{r.visitType}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.severity === "critical" ? "destructive" :
                            r.severity === "severe" ? "destructive" :
                            r.severity === "moderate" ? "secondary" : "outline"
                          }
                          className="capitalize"
                        >
                          {r.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] break-words whitespace-normal">{r.diagnosis || "-"}</TableCell>
                      <TableCell>
                        {r.referredToHospital ? (
                          <Badge variant="destructive">Yes</Badge>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setViewRecord(r)}
                            data-testid={`button-view-clinic-${r.id}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm("Delete this clinic record?")) {
                                deleteMutation.mutate(r.id);
                              }
                            }}
                            data-testid={`button-delete-clinic-${r.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredRecords?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No clinic records found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewRecord} onOpenChange={() => setViewRecord(null)}>
        <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5" />
              Clinic Visit Details
            </DialogTitle>
          </DialogHeader>
          {viewRecord && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">Student</span>
                  <p className="font-medium">{getStudentName(viewRecord.studentId)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Admission No</span>
                  <p className="font-medium">{getStudentAdmNo(viewRecord.studentId)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Visit Date</span>
                  <p className="font-medium">{viewRecord.visitDate}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Visit Type</span>
                  <p className="font-medium">{viewRecord.visitType}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Severity</span>
                  <Badge variant={viewRecord.severity === "critical" || viewRecord.severity === "severe" ? "destructive" : viewRecord.severity === "moderate" ? "secondary" : "outline"} className="capitalize">
                    {viewRecord.severity}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Attended By</span>
                  <p className="font-medium">{getStaffName(viewRecord.attendedBy)}</p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                {viewRecord.temperature && <div><span className="text-muted-foreground">Temperature:</span> {viewRecord.temperature}</div>}
                {viewRecord.bloodPressure && <div><span className="text-muted-foreground">Blood Pressure:</span> {viewRecord.bloodPressure}</div>}
                {viewRecord.weight && <div><span className="text-muted-foreground">Weight:</span> {viewRecord.weight}</div>}
              </div>

              {viewRecord.symptoms && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Symptoms</span>
                  <p>{viewRecord.symptoms}</p>
                </div>
              )}
              {viewRecord.diagnosis && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Diagnosis</span>
                  <p>{viewRecord.diagnosis}</p>
                </div>
              )}
              {viewRecord.treatment && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Treatment</span>
                  <p>{viewRecord.treatment}</p>
                </div>
              )}
              {viewRecord.medicationGiven && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Medication Given</span>
                  <p>{viewRecord.medicationGiven}</p>
                </div>
              )}

              <div className="flex items-center gap-4 text-sm flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Follow-up:</span>
                  {viewRecord.followUpRequired ? (
                    <Badge variant="secondary">{viewRecord.followUpDate || "Required"}</Badge>
                  ) : "No"}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Parent Notified:</span>
                  {viewRecord.parentNotified ? "Yes" : "No"}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Referred:</span>
                  {viewRecord.referredToHospital ? (
                    <Badge variant="destructive">{viewRecord.hospitalName || "Yes"}</Badge>
                  ) : "No"}
                </div>
              </div>

              {viewRecord.notes && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Notes</span>
                  <p>{viewRecord.notes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClinicForm({
  onSubmit,
  students,
  staffList,
  isLoading,
}: {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  students: Student[];
  staffList: Staff[];
  isLoading: boolean;
}) {
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showHospital, setShowHospital] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");

  const filteredStudents = students.filter((s) => {
    if (!studentSearch) return true;
    const term = studentSearch.toLowerCase();
    return (
      s.firstName.toLowerCase().includes(term) ||
      s.lastName.toLowerCase().includes(term) ||
      (s.admissionNo && s.admissionNo.toLowerCase().includes(term))
    );
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="studentId">Student *</Label>
        <Select name="studentId" required>
          <SelectTrigger data-testid="select-clinic-student">
            <SelectValue placeholder="Select student" />
          </SelectTrigger>
          <SelectContent>
            <div className="p-2">
              <Input
                placeholder="Search students..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="mb-2"
                data-testid="input-search-student"
              />
            </div>
            {filteredStudents.slice(0, 50).map((s) => (
              <SelectItem key={s.id} value={s.id.toString()}>
                {s.firstName} {s.lastName} ({s.admissionNo})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="visitDate">Visit Date *</Label>
          <Input
            id="visitDate"
            name="visitDate"
            type="date"
            defaultValue={new Date().toISOString().split("T")[0]}
            required
            data-testid="input-visit-date"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="visitType">Visit Type *</Label>
          <Select name="visitType" defaultValue="General Checkup">
            <SelectTrigger data-testid="select-visit-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISIT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="severity">Severity</Label>
          <Select name="severity" defaultValue="mild">
            <SelectTrigger data-testid="select-clinic-severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mild">Mild</SelectItem>
              <SelectItem value="moderate">Moderate</SelectItem>
              <SelectItem value="severe">Severe</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="attendedBy">Attended By</Label>
          <Select name="attendedBy">
            <SelectTrigger data-testid="select-attended-by">
              <SelectValue placeholder="Select staff" />
            </SelectTrigger>
            <SelectContent>
              {staffList.map((s) => (
                <SelectItem key={s.id} value={s.id.toString()}>
                  {s.firstName} {s.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="temperature">Temperature</Label>
          <Input id="temperature" name="temperature" placeholder="e.g., 37.5°C" data-testid="input-temperature" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bloodPressure">Blood Pressure</Label>
          <Input id="bloodPressure" name="bloodPressure" placeholder="e.g., 120/80" data-testid="input-blood-pressure" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="weight">Weight</Label>
          <Input id="weight" name="weight" placeholder="e.g., 45kg" data-testid="input-weight" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="symptoms">Symptoms</Label>
        <Textarea id="symptoms" name="symptoms" placeholder="Describe symptoms..." data-testid="input-symptoms" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="diagnosis">Diagnosis</Label>
        <Textarea id="diagnosis" name="diagnosis" placeholder="Medical diagnosis..." data-testid="input-diagnosis" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="treatment">Treatment</Label>
        <Textarea id="treatment" name="treatment" placeholder="Treatment administered..." data-testid="input-treatment" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="medicationGiven">Medication Given</Label>
        <Input id="medicationGiven" name="medicationGiven" placeholder="e.g., Paracetamol 500mg" data-testid="input-medication" />
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-6 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              name="followUpRequired"
              checked={showFollowUp}
              onCheckedChange={(v) => setShowFollowUp(!!v)}
              data-testid="checkbox-followup"
            />
            <span className="text-sm">Follow-up Required</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox name="parentNotified" data-testid="checkbox-parent-notified" />
            <span className="text-sm">Parent Notified</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              name="referredToHospital"
              checked={showHospital}
              onCheckedChange={(v) => setShowHospital(!!v)}
              data-testid="checkbox-referred"
            />
            <span className="text-sm">Referred to Hospital</span>
          </label>
        </div>

        {showFollowUp && (
          <div className="space-y-2">
            <Label htmlFor="followUpDate">Follow-up Date</Label>
            <Input id="followUpDate" name="followUpDate" type="date" data-testid="input-followup-date" />
          </div>
        )}
        {showHospital && (
          <div className="space-y-2">
            <Label htmlFor="hospitalName">Hospital Name</Label>
            <Input id="hospitalName" name="hospitalName" placeholder="Name of hospital referred to" data-testid="input-hospital-name" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Additional Notes</Label>
        <Textarea id="notes" name="notes" placeholder="Any additional notes..." data-testid="input-clinic-notes" />
      </div>

      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-save-clinic-record">
        {isLoading ? "Saving..." : "Add Clinic Record"}
      </Button>
    </form>
  );
}
