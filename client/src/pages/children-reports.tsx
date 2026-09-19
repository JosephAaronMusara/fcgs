import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, GraduationCap } from "lucide-react";
import { schoolFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ReportCardSlip, type ReportCardData } from "@/components/academic-reports/report-card-document";

const REPORT_TYPES = [
  "End-of-Term Exam",
  "Mock Exam",
  "Monthly Test",
  "Fortnight Test",
  "End-of-Vacation Exam",
] as const;

type ReportType = (typeof REPORT_TYPES)[number];

type ChildReportIndex = {
  student: {
    id: number;
    admissionNo: string | null;
    firstName: string;
    lastName: string;
    photo?: string | null;
    schoolId: number;
    schoolName: string | null;
    schoolShortCode: string | null;
    classId: number | null;
  };
  reports: Array<{
    examId: number;
    examName: string;
    assessmentTypeId: number;
    assessmentType: ReportType;
    publishedAt: string | null;
    classId: number;
  }>;
};

function PublishedReportCard({ studentId, classId, examId }: { studentId: number; classId: number; examId: number }) {
  const { data, isLoading, error } = useQuery<ReportCardData>({
    queryKey: ["/api/report-cards/parent", examId, classId, studentId],
    queryFn: async () => {
      const params = new URLSearchParams({ studentIds: String(studentId), pdfData: "1" });
      const response = await schoolFetch(`/api/report-cards/${examId}/class/${classId}?${params.toString()}`);
      if (!response.ok) throw new Error((await response.text()) || "Could not load the report card");
      return response.json();
    },
  });

  if (isLoading) return <div className="space-y-3 py-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (error || !data) return <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Could not load this published report card.</div>;
  const studentReport = data.reportCards?.find((row: any) => Number(row?.student?.id) === Number(studentId));
  if (!studentReport) return <div className="rounded-md border p-4 text-sm text-muted-foreground">No published report is available for this examination yet.</div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(`/api/report-cards/${examId}/student/${studentId}/download?classId=${classId}`, "_blank", "noopener,noreferrer")}
        >
          <Download className="mr-2 h-4 w-4" /> Download report
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white p-2 sm:p-4">
        <div className="min-w-[820px]">
          <ReportCardSlip
            data={data}
            studentReport={studentReport}
            onSendIndividual={() => undefined}
            onDownloadIndividual={() => window.open(`/api/report-cards/${examId}/student/${studentId}/download?classId=${classId}`, "_blank", "noopener,noreferrer")}
            sendingId={null}
            downloadingId={null}
            editableComments={false}
            canSendIndividual={false}
          />
        </div>
      </div>
    </div>
  );
}

export default function ChildrenReportsPage() {
  const { data, isLoading } = useQuery<ChildReportIndex[]>({ queryKey: ["/api/me/children-reports"] });
  const children = data || [];
  const [selectedChild, setSelectedChild] = useState<string>("");
  const [reportType, setReportType] = useState<ReportType>(REPORT_TYPES[0]);
  const [openReport, setOpenReport] = useState<string>("");

  const activeChildId = selectedChild || (children[0] ? String(children[0].student.id) : "");
  const active = children.find((row) => String(row.student.id) === activeChildId) || children[0];
  const counts = useMemo(() => Object.fromEntries(REPORT_TYPES.map((type) => [type, active?.reports.filter((row) => row.assessmentType === type).length || 0])), [active]);
  const reports = active?.reports.filter((row) => row.assessmentType === reportType) || [];

  if (isLoading) {
    return <div className="space-y-4 p-4 sm:p-6"><Skeleton className="h-10 w-64" /><Skeleton className="h-20 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!children.length) {
    return (
      <div className="p-4 sm:p-6">
        <h1 className="mb-4 text-3xl font-bold">Results & Reports</h1>
        <Card><CardContent className="py-12 text-center"><GraduationCap className="mx-auto mb-4 h-12 w-12 text-muted-foreground" /><p className="text-muted-foreground">No children linked to your account.</p></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-3 sm:p-4 lg:p-6">
      <div>
        <h1 className="text-3xl font-bold">Results & Reports</h1>
        <p className="text-muted-foreground">Published report cards for your children.</p>
      </div>

      {children.length > 1 && (
        <Tabs value={activeChildId} onValueChange={(value) => { setSelectedChild(value); setOpenReport(""); }}>
          <TabsList className="h-auto flex-wrap justify-start">
            {children.map(({ student }) => (
              <TabsTrigger key={student.id} value={String(student.id)} className="h-auto py-2">
                <span className="text-left"><span className="block">{student.firstName} {student.lastName}</span><span className="block text-[11px] font-normal text-muted-foreground">{student.schoolShortCode || student.schoolName}</span></span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {active && (
        <Card><CardContent className="flex items-center justify-between gap-4 py-4"><div><div className="font-semibold">{active.student.firstName} {active.student.lastName}</div><div className="text-sm text-muted-foreground">{active.student.schoolName || "School"} · {active.student.admissionNo || "No admission number"}</div></div><FileText className="h-5 w-5 text-muted-foreground" /></CardContent></Card>
      )}

      <Tabs value={reportType} onValueChange={(value) => { setReportType(value as ReportType); setOpenReport(""); }}>
        <TabsList className="h-auto w-full flex-wrap justify-start bg-muted p-1">
          {REPORT_TYPES.map((type) => <TabsTrigger key={type} value={type}>{type} ({counts[type] || 0})</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {!reports.length ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No published report is available for this examination type yet.</CardContent></Card>
      ) : (
        <Accordion type="single" collapsible value={openReport} onValueChange={setOpenReport} className="space-y-3">
          {reports.map((report) => {
            const value = `${active.student.id}:${report.examId}`;
            return (
              <AccordionItem key={value} value={value} className="rounded-xl border bg-card px-5">
                <AccordionTrigger className="text-left text-base font-semibold uppercase hover:no-underline">{report.examName}</AccordionTrigger>
                <AccordionContent>
                  {openReport === value && <PublishedReportCard studentId={active.student.id} classId={report.classId} examId={report.examId} />}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
