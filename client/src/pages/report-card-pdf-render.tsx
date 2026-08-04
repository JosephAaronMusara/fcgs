import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { schoolFetch } from "@/lib/queryClient";
import {
  ReportCardSlip,
  type ReportCardData,
  type ReportStudent,
} from "@/components/academic-reports/report-card-document";

const REPORT_PDF_CSS = `
  html, body, #root { margin: 0 !important; padding: 0 !important; background: #fff !important; color: #000 !important; }
  @page { size: A4 portrait; margin: 2mm; }
  .report-pdf-document { width: 206mm; margin: 0 auto; background: #fff; }
  .report-card-student-document { width: 100%; break-after: page; page-break-after: always; }
  .report-card-student-document:last-child { break-after: auto; page-break-after: auto; }
  .report-slip { box-shadow: none !important; border-radius: 0 !important; margin: 0 !important; padding: 0 !important; break-inside: auto !important; page-break-inside: auto !important; background: white !important; color: black !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-slip-page--main { min-height: calc(293mm - 2px) !important; height: auto !important; overflow: visible !important; display: block !important; }
  .report-content-flow { height: auto !important; display: block !important; }
  .report-slip-inner { border: 1px solid #ccc !important; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  .report-primary-section { break-inside: auto !important; page-break-inside: auto !important; }
  .report-subject-table { break-inside: auto !important; page-break-inside: auto !important; }
  .report-subject-table-head { display: table-header-group !important; }
  .report-subject-table tfoot { display: table-footer-group !important; }
  .report-subject-row, .report-subject-table tr { break-inside: avoid !important; page-break-inside: avoid !important; }
  .report-section { break-inside: avoid-page !important; page-break-inside: avoid !important; }
  .report-section--graphs, .report-section--class-comment, .report-section--principal-comment, .report-section--footer { width: 100%; }
  .report-graphs-row { align-items: stretch !important; }
  .report-footer-row { align-items: stretch !important; }
  .report-footer-box, .report-principal-info, .report-qr-block { height: 100% !important; }
  .report-slip th { background: #6b7280 !important; color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-slip tbody tr[class*="bg-gray-100"] { background: #f3f4f6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-slip tbody tr[class*="bg-gray-100"] td { background: #f3f4f6 !important; -webkit-print-color-adjust: exact; }
  .report-slip [class*="text-green"] { color: #16a34a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-slip [class*="text-red"] { color: #dc2626 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-slip [class*="text-amber"] { color: #d97706 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-slip [class*="text-blue"] { color: #2563eb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-slip [class*="text-gray"] { color: #6b7280 !important; }
  .report-slip tr[style*="rgba(27, 42, 92"] { background: rgba(27, 42, 92, 0.1) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-slip [class*="bg-green-600"] { background: #16a34a !important; color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-slip svg polyline, .report-slip svg line, .report-slip svg circle { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-slip [style*="linear-gradient"], .report-slip div[style*="background"] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

function parseIds(value: string | null): number[] {
  if (!value) return [];
  return Array.from(new Set(value.split(",").map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)));
}

async function waitForAssets(): Promise<void> {
  if ("fonts" in document) await document.fonts.ready;

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const reports = Array.from(document.querySelectorAll<HTMLElement>(".report-slip"));
    const qrReady = reports.length > 0 && reports.every((report) => report.dataset.reportQrReady === "true");
    const imagesReady = Array.from(document.images).every((image) => image.complete);
    if (qrReady && imagesReady) break;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }

  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export default function ReportCardPdfRenderPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const examId = Number(params.get("examId"));
  const classId = Number(params.get("classId"));
  const requestedStudentIds = useMemo(() => parseIds(params.get("studentIds")), [params]);

  const { data, error, isLoading } = useQuery<ReportCardData>({
    queryKey: ["/api/report-cards", examId, "pdf-data", classId, requestedStudentIds.join(",")],
    enabled: Number.isInteger(examId) && examId > 0 && Number.isInteger(classId) && classId > 0,
    queryFn: async () => {
      const response = await schoolFetch(`/api/report-cards/${examId}/pdf-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, studentIds: requestedStudentIds }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Unable to load report-card data");
      }
      return response.json();
    },
  });

  const reports = useMemo<ReportStudent[]>(() => {
    if (!data) return [];
    if (!requestedStudentIds.length) return data.reportCards;
    const requested = new Set(requestedStudentIds);
    return data.reportCards.filter((report) => requested.has(report.student.id));
  }, [data, requestedStudentIds]);

  useEffect(() => {
    document.documentElement.dataset.pdfReady = "false";
    delete document.documentElement.dataset.pdfError;

    if (error) {
      document.documentElement.dataset.pdfError = error instanceof Error ? error.message : String(error);
      document.documentElement.dataset.pdfReady = "true";
      return;
    }
    if (!data || isLoading) return;
    if (!reports.length) {
      document.documentElement.dataset.pdfError = "No report cards matched the requested learners.";
      document.documentElement.dataset.pdfReady = "true";
      return;
    }

    let cancelled = false;
    void waitForAssets().then(() => {
      if (!cancelled) document.documentElement.dataset.pdfReady = "true";
    });
    return () => { cancelled = true; };
  }, [data, error, isLoading, reports]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-white text-black"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (error || !data || reports.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-black p-8">
        <div className="max-w-xl border border-red-300 p-5 flex gap-3"><AlertTriangle className="h-5 w-5 text-red-700" /><span>{error instanceof Error ? error.message : "No report cards available."}</span></div>
      </div>
    );
  }

  return (
    <>
      <style>{REPORT_PDF_CSS}</style>
      <main className="report-pdf-document">
        {reports.map((report) => (
          <ReportCardSlip
            key={report.student.id}
            data={data}
            studentReport={report}
            onSendIndividual={() => undefined}
            onDownloadIndividual={() => undefined}
            sendingId={null}
            downloadingId={null}
            editableComments={false}
            canSendIndividual={false}
            documentMode
          />
        ))}
      </main>
    </>
  );
}
