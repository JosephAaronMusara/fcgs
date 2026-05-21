import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import type { Scheme, Subject, Grade } from "@shared/schema";

export default function SchemesPage() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [filterSubject, setFilterSubject] = useState<string>("all");
  const [filterGrade, setFilterGrade] = useState<string>("all");

  const { data: schemes = [], isLoading } = useQuery<Scheme[]>({
    queryKey: ["/api/schemes"],
  });

  const { data: subjects = [] } = useQuery<Subject[]>({
    queryKey: ["/api/subjects"],
  });

  const { data: grades = [] } = useQuery<Grade[]>({
    queryKey: ["/api/grades"],
  });

  const createScheme = useMutation({
    mutationFn: async (data: Partial<Scheme>) => {
      return apiRequest("POST", "/api/schemes", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schemes"] });
      setIsAddOpen(false);
      toast({ title: "Scheme entry added" });
    },
    onError: () => {
      toast({ title: "Failed to add scheme entry", variant: "destructive" });
    },
  });

  const deleteScheme = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/schemes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schemes"] });
      toast({ title: "Scheme entry deleted" });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createScheme.mutate({
      subjectId: parseInt(formData.get("subjectId") as string),
      gradeId: parseInt(formData.get("gradeId") as string),
      term: formData.get("term") as string,
      week: parseInt(formData.get("week") as string),
      topic: formData.get("topic") as string,
      subtopic: formData.get("subtopic") as string,
      objectives: formData.get("objectives") as string,
      activities: formData.get("activities") as string,
      resources: formData.get("resources") as string,
      assessment: formData.get("assessment") as string,
      schoolId: 1,
    });
  };

  const getSubjectName = (id: number) => subjects.find(s => s.id === id)?.name || "Unknown";
  const getGradeName = (id: number) => grades.find(g => g.id === id)?.name || "Unknown";

  const filteredSchemes = schemes.filter((scheme) => {
    const matchesSubject = filterSubject === "all" || scheme.subjectId.toString() === filterSubject;
    const matchesGrade = filterGrade === "all" || scheme.gradeId.toString() === filterGrade;
    return matchesSubject && matchesGrade;
  });

  const { sortedData: sortedSchemes, sortConfig: schemesSortConfig, requestSort: requestSchemesSort } = useTableSort(filteredSchemes);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }}>E-Schemes</h1>
            <p className="text-muted-foreground">Teaching schemes of work</p>
          </div>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-scheme">
              <Plus className="h-4 w-4 mr-2" />
              Add Entry
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
            <DialogHeader>
              <DialogTitle>Add Scheme Entry</DialogTitle>
              <DialogDescription>Add a new scheme of work entry</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="subjectId">Subject</Label>
                  <Select name="subjectId" required>
                    <SelectTrigger data-testid="select-subject">
                      <SelectValue placeholder="Select subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map((subject) => (
                        <SelectItem key={subject.id} value={subject.id.toString()}>
                          {subject.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gradeId">Grade/Form</Label>
                  <Select name="gradeId" required>
                    <SelectTrigger data-testid="select-grade">
                      <SelectValue placeholder="Select grade" />
                    </SelectTrigger>
                    <SelectContent>
                      {grades.map((grade) => (
                        <SelectItem key={grade.id} value={grade.id.toString()}>
                          {grade.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="term">Term</Label>
                  <Select name="term" required>
                    <SelectTrigger data-testid="select-term">
                      <SelectValue placeholder="Select term" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Term 1">Term 1</SelectItem>
                      <SelectItem value="Term 2">Term 2</SelectItem>
                      <SelectItem value="Term 3">Term 3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="week">Week Number</Label>
                <Input id="week" name="week" type="number" min="1" max="14" required data-testid="input-week" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="topic">Topic</Label>
                <Input id="topic" name="topic" required data-testid="input-topic" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subtopic">Sub-topic</Label>
                <Input id="subtopic" name="subtopic" data-testid="input-subtopic" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="objectives">Learning Objectives</Label>
                <Textarea id="objectives" name="objectives" data-testid="input-objectives" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="activities">Teaching/Learning Activities</Label>
                <Textarea id="activities" name="activities" data-testid="input-activities" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="resources">Resources</Label>
                  <Textarea id="resources" name="resources" data-testid="input-resources" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assessment">Assessment</Label>
                  <Textarea id="assessment" name="assessment" data-testid="input-assessment" />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createScheme.isPending} data-testid="button-submit-scheme">
                Add Entry
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-4 flex-wrap">
        <Select value={filterSubject} onValueChange={setFilterSubject}>
          <SelectTrigger className="w-[200px]" data-testid="select-filter-subject">
            <SelectValue placeholder="Filter by subject" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Subjects</SelectItem>
            {subjects.map((subject) => (
              <SelectItem key={subject.id} value={subject.id.toString()}>
                {subject.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterGrade} onValueChange={setFilterGrade}>
          <SelectTrigger className="w-[200px]" data-testid="select-filter-grade">
            <SelectValue placeholder="Filter by grade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Grades</SelectItem>
            {grades.map((grade) => (
              <SelectItem key={grade.id} value={grade.id.toString()}>
                {grade.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredSchemes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Scheme Entries</h3>
            <p className="text-muted-foreground">Add your first scheme of work entry</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Scheme of Work</CardTitle>
            <CardDescription>Weekly teaching plan</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead sortKey="week" sortConfig={schemesSortConfig} onSort={requestSchemesSort}>Week</SortableTableHead>
                  <SortableTableHead sortKey="subjectId" sortConfig={schemesSortConfig} onSort={requestSchemesSort}>Subject</SortableTableHead>
                  <SortableTableHead sortKey="gradeId" sortConfig={schemesSortConfig} onSort={requestSchemesSort}>Grade</SortableTableHead>
                  <SortableTableHead sortKey="term" sortConfig={schemesSortConfig} onSort={requestSchemesSort}>Term</SortableTableHead>
                  <SortableTableHead sortKey="topic" sortConfig={schemesSortConfig} onSort={requestSchemesSort}>Topic</SortableTableHead>
                  <TableHead>Objectives</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sortedSchemes ?? []).map((scheme) => (
                  <TableRow key={scheme.id} data-testid={`row-scheme-${scheme.id}`}>
                    <TableCell>
                      <Badge variant="outline">Week {scheme.week}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{getSubjectName(scheme.subjectId)}</TableCell>
                    <TableCell>{getGradeName(scheme.gradeId)}</TableCell>
                    <TableCell>{scheme.term}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{scheme.topic}</p>
                        {scheme.subtopic && (
                          <p className="text-sm text-muted-foreground">{scheme.subtopic}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{scheme.objectives}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteScheme.mutate(scheme.id)}
                        data-testid={`button-delete-scheme-${scheme.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
