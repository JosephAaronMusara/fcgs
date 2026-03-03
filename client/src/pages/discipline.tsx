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
import { useToast } from "@/hooks/use-toast";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import { Plus, AlertTriangle, Shield } from "lucide-react";
import type { DisciplineRecord, Student } from "@shared/schema";

export default function DisciplinePage() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);

  const { data: records, isLoading } = useQuery<DisciplineRecord[]>({
    queryKey: ["/api/discipline"],
  });

  const { data: students } = useQuery<Student[]>({
    queryKey: ["/api/students"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<DisciplineRecord>) => {
      const res = await apiRequest("POST", "/api/discipline", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/discipline"] });
      setIsAddOpen(false);
      toast({ title: "Success", description: "Discipline record added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const { sortedData: sortedRecords, sortConfig, requestSort } = useTableSort(records);

  const getStudentName = (studentId: number) => {
    const student = students?.find((s) => s.id === studentId);
    return student ? `${student.firstName} ${student.lastName}` : "-";
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      studentId: parseInt(formData.get("studentId") as string),
      incidentDate: formData.get("incidentDate") as string,
      incidentType: formData.get("incidentType") as string,
      description: formData.get("description") as string || undefined,
      actionTaken: formData.get("actionTaken") as string || undefined,
      severity: formData.get("severity") as string || "minor",
    };

    createMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-discipline-title">Disciplinary Reports</h1>
            <p className="text-muted-foreground">Track student discipline and incidents</p>
          </div>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-record">
              <Plus className="w-4 h-4 mr-2" />
              Add Record
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Discipline Record</DialogTitle>
            </DialogHeader>
            <DisciplineForm
              onSubmit={handleSubmit}
              students={students || []}
              isLoading={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            Discipline History
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
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead sortKey="studentId" sortConfig={sortConfig} onSort={requestSort}>Student</SortableTableHead>
                  <SortableTableHead sortKey="incidentDate" sortConfig={sortConfig} onSort={requestSort}>Date</SortableTableHead>
                  <SortableTableHead sortKey="incidentType" sortConfig={sortConfig} onSort={requestSort}>Incident Type</SortableTableHead>
                  <SortableTableHead sortKey="severity" sortConfig={sortConfig} onSort={requestSort}>Severity</SortableTableHead>
                  <SortableTableHead sortKey="actionTaken" sortConfig={sortConfig} onSort={requestSort}>Action Taken</SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sortedRecords ?? []).map((r) => (
                  <TableRow key={r.id} data-testid={`row-discipline-${r.id}`}>
                    <TableCell className="font-medium">{getStudentName(r.studentId)}</TableCell>
                    <TableCell>{r.incidentDate}</TableCell>
                    <TableCell>{r.incidentType}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.severity === "major"
                            ? "destructive"
                            : r.severity === "moderate"
                            ? "secondary"
                            : "outline"
                        }
                        className="capitalize"
                      >
                        {r.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{r.actionTaken || "-"}</TableCell>
                  </TableRow>
                ))}
                {records?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No discipline records found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DisciplineForm({
  onSubmit,
  students,
  isLoading,
}: {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  students: Student[];
  isLoading: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="studentId">Student</Label>
        <Select name="studentId" required>
          <SelectTrigger data-testid="select-student">
            <SelectValue placeholder="Select student" />
          </SelectTrigger>
          <SelectContent>
            {students.map((s) => (
              <SelectItem key={s.id} value={s.id.toString()}>
                {s.firstName} {s.lastName} ({s.admissionNo})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="incidentDate">Incident Date</Label>
          <Input
            id="incidentDate"
            name="incidentDate"
            type="date"
            defaultValue={new Date().toISOString().split("T")[0]}
            required
            data-testid="input-incident-date"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="severity">Severity</Label>
          <Select name="severity" defaultValue="minor">
            <SelectTrigger data-testid="select-severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minor">Minor</SelectItem>
              <SelectItem value="moderate">Moderate</SelectItem>
              <SelectItem value="major">Major</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="incidentType">Incident Type</Label>
        <Input
          id="incidentType"
          name="incidentType"
          placeholder="e.g., Late arrival, Fighting, Cheating"
          required
          data-testid="input-incident-type"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          placeholder="Describe the incident..."
          data-testid="input-description"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="actionTaken">Action Taken</Label>
        <Textarea
          id="actionTaken"
          name="actionTaken"
          placeholder="What action was taken?"
          data-testid="input-action-taken"
        />
      </div>
      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-save-record">
        {isLoading ? "Saving..." : "Add Record"}
      </Button>
    </form>
  );
}
