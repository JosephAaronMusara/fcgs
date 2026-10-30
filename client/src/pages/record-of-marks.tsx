import { useMemo, useState } from "react";
import { InfiniteYearPicker } from "@/components/ui/infinite-year-picker";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, ClipboardList, FileSpreadsheet, CalendarClock } from "lucide-react";
import { schoolFetch } from "@/lib/queryClient";
import type { Class, Subject } from "@shared/schema";

interface PaperColumn {
  paperId: number | null;
  label: string;
  outOf: number;
  weightPct: number;
}

interface AssessmentColumn {
  id: number;
  name: string;
  date: string;
  rawDate: string;
  typeName: string;
  columns: PaperColumn[];
}

interface AssessmentGroup {
  typeName: string;
  assessments: AssessmentColumn[];
}

interface StudentRow {
  id: number;
  name: string;
  admissionNo: string;
}

interface MarkData {
  percentage: number | null;
  attStatus: string;
  paperMarks: Record<number, number | null>;
}

interface RecordOfMarksData {
  className: string;
  subjectName: string;
  academicYear: number;
  dateFrom: string | null;
  dateTo: string | null;
  termFilter: string | null;
  groups: AssessmentGroup[];
  students: StudentRow[];
  marks: Record<string, MarkData>;
}

interface ClassSubjectRow {
  id: number;
  classId: number;
  subjectId: number;
}

const TERM_OPTIONS = [
  { value: "none", label: "All Terms" },
  { value: "term1", label: "Term 1" },
  { value: "vac1", label: "Vacation 1" },
  { value: "term2", label: "Term 2" },
  { value: "vac2", label: "Vacation 2" },
  { value: "term3", label: "Term 3" },
];


export default function RecordOfMarksPage() {
  const currentYear = new Date().getFullYear();

  const [selectedAcademicYear, setSelectedAcademicYear] = useState(String(currentYear));
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedTerm, setSelectedTerm] = useState("none");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: classes } = useQuery<Class[]>({ queryKey: ["/api/classes"] });
  const { data: subjects } = useQuery<Subject[]>({
    queryKey: ["/api/subjects", "all-for-rom"],
    queryFn: async () => {
      const res = await schoolFetch("/api/subjects?perPage=500");
      if (!res.ok) throw new Error("Failed to load subjects");
      const data = await res.json();
      return data.items ?? [];
    },
  });
  const { data: classSubjectRows } = useQuery<ClassSubjectRow[]>({
    queryKey: ["/api/class-subjects/all", "record-of-marks"],
    queryFn: async () => {
      const res = await schoolFetch("/api/class-subjects/all");
      if (!res.ok) throw new Error("Failed to load class subjects");
      return res.json();
    },
  });

  const filteredSubjects = useMemo(() => {
    if (!selectedClass || !subjects) return [];
    const subjectIds = new Set((classSubjectRows || []).filter((row) => row.classId === Number(selectedClass)).map((row) => row.subjectId));
    return subjectIds.size > 0
      ? subjects.filter((subject) => subjectIds.has(subject.id))
      : subjects;
  }, [selectedClass, subjects, classSubjectRows]);

  const queryEnabled = !!selectedAcademicYear && !!selectedClass && !!selectedSubject;

  const { data: recordData, isLoading } = useQuery<RecordOfMarksData>({
    queryKey: ["/api/record-of-marks", selectedAcademicYear, selectedClass, selectedSubject, selectedTerm, dateFrom, dateTo],
    enabled: queryEnabled,
    queryFn: async () => {
      const params = new URLSearchParams({
        academicYear: selectedAcademicYear,
        classId: selectedClass,
        subjectId: selectedSubject,
      });
      if (selectedTerm !== "none") params.set("termFilter", selectedTerm);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const res = await schoolFetch(`/api/record-of-marks?${params}`);
      if (!res.ok) throw new Error("Failed to load record of marks");
      return res.json();
    },
  });

  const selectedClassName = useMemo(() => classes?.find((c) => c.id.toString() === selectedClass)?.className || "", [selectedClass, classes]);
  const selectedSubjectName = useMemo(() => subjects?.find((s) => s.id.toString() === selectedSubject)?.name || "", [selectedSubject, subjects]);

  const handleExportExcel = () => {
    if (!recordData || !recordData.groups.length) return;

    let csv = "";
    const headerLabel = `${selectedSubjectName} (${selectedClassName})`;
    const termLabel = selectedTerm !== "none" ? TERM_OPTIONS.find((t) => t.value === selectedTerm)?.label || selectedTerm : "All Terms";
    csv += `Record of Marks - ${headerLabel}\r\n`;
    csv += `Academic Year: ${selectedAcademicYear} | ${termLabel}${dateFrom || dateTo ? ` | Date Range: ${dateFrom || "..."} to ${dateTo || "..."}` : ""}\r\n\r\n`;

    const typeRow: string[] = [""];
    const assessmentRow: string[] = [""];
    const paperRow: string[] = ["Student Name"];

    for (const group of recordData.groups) {
      let groupColSpan = 0;
      for (const assessment of group.assessments) {
        const colCount = assessment.columns.length;
        groupColSpan += colCount;
        assessmentRow.push(assessment.name);
        for (let i = 1; i < colCount; i++) assessmentRow.push("");
        for (const col of assessment.columns) paperRow.push(`${col.label} (/${col.outOf})`);
      }
      typeRow.push(group.typeName);
      for (let i = 1; i < groupColSpan; i++) typeRow.push("");
    }

    csv += typeRow.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(",") + "\r\n";
    csv += assessmentRow.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(",") + "\r\n";
    csv += paperRow.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(",") + "\r\n";

    for (const student of recordData.students) {
      const row: string[] = [student.name];
      for (const group of recordData.groups) {
        for (const assessment of group.assessments) {
          const key = `${student.id}_${assessment.id}`;
          const markData = recordData.marks[key];
          for (const col of assessment.columns) {
            if (!markData) {
              row.push("");
            } else if (col.paperId !== null && markData.paperMarks) {
              const val = markData.paperMarks[col.paperId];
              row.push(val !== null && val !== undefined ? val.toString() : "");
            } else {
              row.push(markData.percentage !== null ? markData.percentage.toString() : "");
            }
          }
        }
      }
      csv += row.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(",") + "\r\n";
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const subjectClean = selectedSubjectName.replace(/\s+/g, "_");
    const classClean = selectedClassName.replace(/\s+/g, "_");
    a.download = `Record_of_Marks_${selectedAcademicYear}_${classClean}_${subjectClean}_${selectedTerm}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CalendarClock className="h-8 w-8" style={{ color: "#1b2a5c" }} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-rom-title">Record of Marks</h1>
          <p className="text-muted-foreground">View student marks across academic years, terms, and vacation terms</p>
        </div>
      </div>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="ml-auto">
              <Button variant="outline" onClick={handleExportExcel} disabled={!recordData || !recordData.groups.length} data-testid="button-export-excel">
                <Download className="w-4 h-4 mr-1" />
                Download
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <div className="mb-1 text-sm font-medium">Academic Year</div>
              <InfiniteYearPicker
                value={selectedAcademicYear}
                onValueChange={setSelectedAcademicYear}
                placeholder="Academic Year"
                className="w-[150px]"
                dataTestId="select-academic-year"
              />
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Class</div>
              <Select value={selectedClass} onValueChange={(v) => { setSelectedClass(v); setSelectedSubject(""); }}>
                <SelectTrigger className="w-[200px]" data-testid="select-class">
                  <SelectValue placeholder="Select Class" />
                </SelectTrigger>
                <SelectContent>
                  {classes?.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.className}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Subject</div>
              <Select value={selectedSubject} onValueChange={(v) => setSelectedSubject(v)} disabled={!selectedClass || !filteredSubjects.length}>
                <SelectTrigger className="w-[260px]" data-testid="select-subject">
                  <SelectValue placeholder={!selectedClass ? "Select class first" : "Select Subject"} />
                </SelectTrigger>
                <SelectContent>
                  {filteredSubjects.map((s) => (
                    <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">School Term</div>
              <Select value={selectedTerm} onValueChange={setSelectedTerm}>
                <SelectTrigger className="w-[170px]" data-testid="select-term-filter">
                  <SelectValue placeholder="School Term" />
                </SelectTrigger>
                <SelectContent>
                  {TERM_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Date From</div>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[160px]" data-testid="input-date-from" />
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Date To</div>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[160px]" data-testid="input-date-to" />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && queryEnabled && (
        <Card>
          <CardContent className="p-4">
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          </CardContent>
        </Card>
      )}

      {recordData && recordData.groups.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[800px]" data-testid="table-record-of-marks">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 bg-card z-10 px-3 py-2 text-left font-semibold text-sm border-r" rowSpan={3}>Student Name</th>
                    {recordData.groups.map((group, gi) => {
                      const colSpan = group.assessments.reduce((s, a) => s + a.columns.length, 0);
                      return (
                        <th key={gi} colSpan={colSpan} className="px-2 py-2 text-center font-bold text-sm border-b border-r bg-muted/30" data-testid={`header-type-${gi}`}>
                          {group.typeName}
                        </th>
                      );
                    })}
                  </tr>
                  <tr className="border-b">
                    {recordData.groups.map((group) =>
                      group.assessments.map((assessment) => (
                        <th key={assessment.id} colSpan={assessment.columns.length} className="px-2 py-1.5 text-center font-semibold text-xs border-r bg-muted/15" data-testid={`header-assessment-${assessment.id}`}>
                          <div className="font-bold">{assessment.name}</div>
                          <div className="text-[10px] text-muted-foreground">{assessment.date}</div>
                          <div className="text-[10px] text-muted-foreground italic">Type: {assessment.typeName.toLowerCase()}</div>
                        </th>
                      ))
                    )}
                  </tr>
                  <tr className="border-b bg-muted/10">
                    {recordData.groups.map((group) =>
                      group.assessments.map((assessment) =>
                        assessment.columns.map((col, ci) => (
                          <th key={`${assessment.id}-${ci}`} className="px-2 py-1.5 text-center font-semibold text-[11px] border-r whitespace-nowrap" data-testid={`header-paper-${assessment.id}-${ci}`}>
                            <div className="font-bold">{col.label}</div>
                            <div className="text-[10px] text-muted-foreground">Out of: {col.outOf} marks</div>
                          </th>
                        ))
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {recordData.students.map((student) => (
                    <tr key={student.id} className="border-b last:border-b-0 hover-elevate" data-testid={`row-student-${student.id}`}>
                      <td className="sticky left-0 bg-card z-10 px-3 py-2 font-medium text-sm whitespace-nowrap border-r">{student.name}</td>
                      {recordData.groups.map((group) =>
                        group.assessments.map((assessment) =>
                          assessment.columns.map((col, ci) => {
                            const key = `${student.id}_${assessment.id}`;
                            const markData = recordData.marks[key];
                            let value = "";
                            if (markData) {
                              if (col.paperId !== null && markData.paperMarks) {
                                const raw = markData.paperMarks[col.paperId];
                                if (raw !== null && raw !== undefined) value = raw.toString();
                              } else if (col.paperId === null && markData.percentage !== null) {
                                value = markData.percentage.toString();
                              }
                            }
                            return (
                              <td key={`${assessment.id}-${ci}`} className="px-2 py-2 text-center text-sm border-r tabular-nums" data-testid={`cell-mark-${student.id}-${assessment.id}-${ci}`}>
                                {value || <span className="text-muted-foreground/30">&mdash;</span>}
                              </td>
                            );
                          })
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : queryEnabled && !isLoading ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2">No Records Found</h3>
            <p className="text-muted-foreground">No assessments found for the selected academic year, class, subject, and filters.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardList className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2">Select Your Filters</h3>
            <p className="text-muted-foreground">Choose academic year, class, subject, term, and optional dates to view the record of marks.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
