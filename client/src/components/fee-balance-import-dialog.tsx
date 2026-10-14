import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { schoolFetch, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FeeSchedulePosition } from "@/components/fee-schedule-dialog";

type PreviewItem = {
  rowNumber: number;
  sourceSheet?: string | null;
  rowDisposition: "data" | "skipped" | "invalid";
  skipReason?: string | null;
  validationError?: string | null;
  csvCustomerCode?: string;
  csvName: string;
  csvGroup?: string;
  csvArea?: string;
  balanceDue: number;
  matchedStudentId?: number | null;
  matchedAdmissionNo?: string | null;
  matchedStudentName?: string | null;
  matchMethod: string;
  calculatedStatus?: string | null;
};

type BatchView = {
  id: number;
  fileName?: string | null;
  detectedFormat?: string | null;
  sheetName?: string | null;
  status: string;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  skippedRows: number;
  invalidRows: number;
  processedRows: number;
  failedRows: number;
  academicYear?: string | null;
  term?: string | null;
  feePositionDate?: string | null;
  termTotalFee?: number;
  amountDueToDate?: number;
  termMaxBalance?: number;
  progressPercent: number;
  progressMessage?: string | null;
  lastError?: string | null;
};

type PreviewResponse = {
  success: boolean;
  requiresSheetSelection: boolean;
  detectedFormat: string;
  candidateSheets?: string[];
  selectedSheet?: string | null;
  batch?: BatchView;
  stats?: {
    totalRows: number;
    matchedRows: number;
    customerCodeMatches: number;
    exactNameMatches: number;
    fuzzyNameMatches: number;
    unmatchedRows: number;
    skippedRows: number;
    invalidRows: number;
  };
  duplicate?: { id: number; fileName?: string | null; status: string; message: string } | null;
  items?: PreviewItem[];
};

function readableError(text: string, fallback: string) {
  try {
    const parsed = JSON.parse(text);
    return parsed.message || fallback;
  } catch {
    return text || fallback;
  }
}

export default function FeeBalanceImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [candidateSheets, setCandidateSheets] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [allowInvalidRows, setAllowInvalidRows] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const completionNotified = useRef<number | null>(null);

  const scheduleQuery = useQuery<FeeSchedulePosition>({
    queryKey: ["/api/fees/schedule/current"],
    queryFn: async () => {
      const response = await schoolFetch("/api/fees/schedule/current");
      const text = await response.text();
      if (!response.ok) throw new Error(readableError(text, "Unable to load the current fee schedule"));
      return JSON.parse(text);
    },
    enabled: open,
    staleTime: 0,
  });

  const reset = () => {
    setFile(null);
    setSelectedSheet("");
    setCandidateSheets([]);
    setPreview(null);
    setAllowInvalidRows(false);
    setConfirmDuplicate(false);
    completionNotified.current = null;
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a CSV or Excel file first.");
      const formData = new FormData();
      formData.set("fees_file", file);
      if (selectedSheet) formData.set("sheet_name", selectedSheet);
      const response = await schoolFetch("/api/fees/import-file/preview", { method: "POST", body: formData });
      const text = await response.text();
      if (!response.ok) throw new Error(readableError(text, "Unable to preview the fee balance file"));
      return JSON.parse(text) as PreviewResponse;
    },
    onSuccess: (data) => {
      if (data.requiresSheetSelection) {
        const sheets = data.candidateSheets || [];
        setCandidateSheets(sheets);
        setSelectedSheet(sheets[0] || "");
        setPreview(null);
        toast({ title: "Choose worksheet", description: "More than one worksheet contains recognizable Name and Balance columns. Select the intended worksheet, then preview again." });
        return;
      }
      setCandidateSheets(data.candidateSheets || []);
      setPreview(data);
      setConfirmDuplicate(false);
      setAllowInvalidRows(false);
    },
    onError: (error: Error) => toast({ title: "Preview failed", description: error.message, variant: "destructive" }),
  });

  const commitMutation = useMutation({
    mutationFn: async (batchId: number) => {
      const response = await schoolFetch(`/api/fees/import-file/${batchId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowInvalidRows, allowDuplicateFile: confirmDuplicate }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(readableError(text, "Unable to queue the import"));
      return JSON.parse(text) as { batch: BatchView };
    },
    onSuccess: ({ batch }) => {
      setPreview((current) => current ? { ...current, batch } : current);
      toast({ title: "Import queued", description: "The balance import is processing in the background. You can keep using the portal while it runs." });
    },
    onError: (error: Error) => toast({ title: "Import could not start", description: error.message, variant: "destructive" }),
  });

  const batchId = preview?.batch?.id || null;
  const batchStatus = preview?.batch?.status;
  const shouldPoll = Boolean(batchId && ["queued", "processing"].includes(batchStatus || ""));
  const statusQuery = useQuery<{ batch: BatchView }>({
    queryKey: ["fees-import-status", batchId],
    queryFn: async () => {
      const response = await schoolFetch(`/api/fees/import-file/${batchId}/status`);
      const text = await response.text();
      if (!response.ok) throw new Error(readableError(text, "Unable to read import status"));
      return JSON.parse(text);
    },
    enabled: Boolean(batchId && shouldPoll),
    refetchInterval: shouldPoll ? 1500 : false,
    staleTime: 0,
  });

  useEffect(() => {
    if (!statusQuery.data?.batch) return;
    const batch = statusQuery.data.batch;
    setPreview((current) => current ? { ...current, batch } : current);
    if (["committed", "completed_with_errors", "failed"].includes(batch.status) && completionNotified.current !== batch.id) {
      completionNotified.current = batch.id;
      queryClient.invalidateQueries({ queryKey: ["/api/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      if (batch.status === "committed") toast({ title: "Import complete", description: `${batch.processedRows} learner balance${batch.processedRows === 1 ? "" : "s"} updated successfully.` });
      else if (batch.status === "completed_with_errors") toast({ title: "Import completed with errors", description: `${batch.processedRows - batch.failedRows} updated, ${batch.failedRows} failed. Review the import before retrying anything.`, variant: "destructive" });
      else toast({ title: "Import failed", description: batch.lastError || "The background import failed.", variant: "destructive" });
    }
  }, [statusQuery.data, toast]);

  const exceptionRows = useMemo(() => (preview?.items || []).filter((row) => row.rowDisposition === "invalid" || row.matchMethod === "unmatched"), [preview?.items]);
  const skippedRows = useMemo(() => (preview?.items || []).filter((row) => row.rowDisposition === "skipped"), [preview?.items]);
  const isProcessing = ["queued", "processing"].includes(preview?.batch?.status || "");
  const isComplete = ["committed", "completed_with_errors"].includes(preview?.batch?.status || "");
  const duplicateBlocked = Boolean(preview?.duplicate && !confirmDuplicate);
  const invalidBlocked = Boolean((preview?.stats?.invalidRows || 0) > 0 && !allowInvalidRows);

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next && !isProcessing) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" onClick={() => onOpenChange(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Upload Balances
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100dvw-2rem)] max-w-5xl overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>Upload / Update Fee Balances</DialogTitle>
          <DialogDescription>
            Upload CSV or Excel (.csv, .xlsx, .xls). File type is detected automatically. Required columns are Name and Balance; common equivalent headings are recognized automatically.
          </DialogDescription>
        </DialogHeader>

        {!preview && (
          <div className="space-y-4">
            {scheduleQuery.isLoading ? (
              <div className="flex items-center justify-center rounded-lg border p-5 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading current fee schedule…</div>
            ) : scheduleQuery.isError ? (
              <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Fee schedule unavailable</AlertTitle><AlertDescription>{scheduleQuery.error instanceof Error ? scheduleQuery.error.message : "Unable to load the current fee schedule."}</AlertDescription></Alert>
            ) : !scheduleQuery.data?.configured ? (
              <Alert className="border-amber-400"><AlertTriangle className="h-4 w-4" /><AlertTitle>Fee schedule required</AlertTitle><AlertDescription>A fee schedule has not been configured for {scheduleQuery.data?.termLabel || "the current term"} {scheduleQuery.data?.academicYear || ""}. Configure the term fee schedule before importing balances.</AlertDescription></Alert>
            ) : (
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="mb-3 font-medium">Using {scheduleQuery.data.termLabel} {scheduleQuery.data.academicYear} Fee Schedule</div>
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><div className="text-xs text-muted-foreground">Total term fees</div><div className="font-semibold">${scheduleQuery.data.totalTermFee.toFixed(2)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Required paid to date</div><div className="font-semibold">${scheduleQuery.data.amountDueToDate.toFixed(2)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Up-to-date balance limit</div><div className="font-semibold">${scheduleQuery.data.maxUpToDateBalance.toFixed(2)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Fee position date</div><div className="font-semibold">{scheduleQuery.data.asOfDate}</div></div>
                </div>
              </div>
            )}
            <div className="space-y-2"><Label>Fee balance file</Label><Input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setCandidateSheets([]); setSelectedSheet(""); }} /></div>
            {candidateSheets.length > 1 && <div className="space-y-2"><Label>Worksheet</Label><Select value={selectedSheet} onValueChange={setSelectedSheet}><SelectTrigger><SelectValue placeholder="Choose worksheet" /></SelectTrigger><SelectContent>{candidateSheets.map((sheet) => <SelectItem key={sheet} value={sheet}>{sheet}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Multiple worksheets contain recognizable fee-balance columns, so the system will not guess which one you intend.</p></div>}
            <Button className="w-full" disabled={!file || !scheduleQuery.data?.configured || previewMutation.isPending} onClick={() => previewMutation.mutate()}>{previewMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Reading file…</> : <><FileSpreadsheet className="mr-2 h-4 w-4" />Preview Import</>}</Button>
          </div>
        )}

        {preview?.batch && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{String(preview.detectedFormat || preview.batch.detectedFormat || "file").toUpperCase()}</Badge>{preview.selectedSheet && <Badge variant="secondary">Sheet: {preview.selectedSheet}</Badge>}<span className="text-muted-foreground">{preview.batch.fileName}</span></div>

            {typeof preview.batch.termTotalFee === "number" && <div className="rounded-lg border bg-muted/30 p-3 text-sm"><span className="font-medium">Fee basis:</span> {preview.batch.term ? preview.batch.term.replace("term", "Term ") : "Current term"} {preview.batch.academicYear || ""} · Total ${preview.batch.termTotalFee.toFixed(2)} · Due ${Number(preview.batch.amountDueToDate || 0).toFixed(2)} · Up-to-date balance limit ${Number(preview.batch.termMaxBalance || 0).toFixed(2)}{preview.batch.feePositionDate ? ` · Position date ${preview.batch.feePositionDate}` : ""}</div>}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[["Rows detected", preview.stats?.totalRows || 0], ["Matched", preview.stats?.matchedRows || 0], ["Unmatched", preview.stats?.unmatchedRows || 0], ["Skipped summary/header", preview.stats?.skippedRows || 0], ["Invalid", preview.stats?.invalidRows || 0]].map(([label, value]) => <div key={String(label)} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-semibold">{value}</div></div>)}
            </div>

            {preview.duplicate && <Alert className="border-amber-400"><AlertTriangle className="h-4 w-4" /><AlertTitle>Exact file already seen</AlertTitle><AlertDescription><div>{preview.duplicate.message}</div><label className="mt-3 flex items-center gap-2"><Checkbox checked={confirmDuplicate} onCheckedChange={(value) => setConfirmDuplicate(value === true)} /><span>I intend to import this exact file again.</span></label></AlertDescription></Alert>}

            {(preview.stats?.invalidRows || 0) > 0 && <Alert className="border-destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Invalid rows require review</AlertTitle><AlertDescription><div>Invalid rows will never be imported. You may continue with the valid matched rows only after acknowledging this.</div><label className="mt-3 flex items-center gap-2"><Checkbox checked={allowInvalidRows} onCheckedChange={(value) => setAllowInvalidRows(value === true)} /><span>Continue with valid matched rows and skip the invalid rows shown below.</span></label></AlertDescription></Alert>}

            {isProcessing || isComplete || preview.batch.status === "failed" ? <Card><CardContent className="space-y-3 p-4"><div className="flex items-center justify-between gap-3"><div><div className="font-medium">Background import</div><div className="text-sm text-muted-foreground">{preview.batch.progressMessage || preview.batch.status}</div></div><Badge variant={preview.batch.status === "committed" ? "default" : preview.batch.status === "failed" ? "destructive" : "secondary"}>{preview.batch.status.replace(/_/g, " ")}</Badge></div><Progress value={preview.batch.progressPercent || 0} /><div className="text-xs text-muted-foreground">{preview.batch.processedRows} of {preview.batch.matchedRows} matched rows processed{preview.batch.failedRows ? ` · ${preview.batch.failedRows} failed` : ""}</div>{preview.batch.lastError && <div className="text-sm text-destructive">{preview.batch.lastError}</div>}</CardContent></Card> : null}

            {exceptionRows.length > 0 && <div className="space-y-2"><div className="font-medium">Rows requiring review</div><div className="max-h-64 overflow-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Name</TableHead><TableHead>Balance</TableHead><TableHead>Issue</TableHead></TableRow></TableHeader><TableBody>{exceptionRows.map((row) => <TableRow key={`${row.rowNumber}-${row.csvName}`}><TableCell>{row.rowNumber}</TableCell><TableCell>{row.csvName || "—"}</TableCell><TableCell>{row.rowDisposition === "invalid" ? "—" : row.balanceDue.toFixed(2)}</TableCell><TableCell>{row.validationError || "No learner match found"}</TableCell></TableRow>)}</TableBody></Table></div></div>}

            {skippedRows.length > 0 && <div className="space-y-2"><div className="font-medium">Skipped rows</div><p className="text-xs text-muted-foreground">Skipped rows are not counted as unmatched learners. Subtotals are detected from labels/formulas, never from the monetary amount alone.</p><div className="max-h-64 overflow-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Label / Name</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader><TableBody>{skippedRows.map((row) => <TableRow key={`${row.rowNumber}-${row.skipReason}`}><TableCell>{row.rowNumber}</TableCell><TableCell>{row.csvName || "—"}</TableCell><TableCell>{row.skipReason || "Skipped"}</TableCell></TableRow>)}</TableBody></Table></div></div>}

            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              {!isProcessing && !isComplete && preview.batch.status !== "failed" && <Button variant="outline" onClick={() => { setPreview(null); setCandidateSheets([]); setSelectedSheet(""); }}>Choose Different File</Button>}
              {preview.batch.status === "preview" && <Button disabled={duplicateBlocked || invalidBlocked || commitMutation.isPending || (preview.stats?.matchedRows || 0) === 0} onClick={() => commitMutation.mutate(preview.batch!.id)}>{commitMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting…</> : "Confirm & Start Import"}</Button>}
              {isComplete && <Button onClick={() => { onOpenChange(false); reset(); }}><CheckCircle2 className="mr-2 h-4 w-4" />Done</Button>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
