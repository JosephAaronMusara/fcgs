import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { schoolFetch, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type FeeInstallment = {
  id?: number;
  installmentNumber: number;
  amount: number;
  arrearsEffectiveDate: string;
};

export type FeeSchedulePosition = {
  configured: boolean;
  schoolId: number;
  academicYear: string | null;
  term: string;
  termLabel: string;
  academicPeriod: string | null;
  calendarError: string | null;
  termStartDate: string | null;
  termEndDate: string | null;
  asOfDate: string;
  scheduleId: number | null;
  totalTermFee: number;
  amountDueToDate: number;
  maxUpToDateBalance: number;
  nextThresholdDate: string | null;
  nextThresholdAmount: number | null;
  hasImportedBalances: boolean;
  installments: FeeInstallment[];
};

type EditableInstallment = { amount: string; arrearsEffectiveDate: string };

function readableError(text: string, fallback: string) {
  try {
    const parsed = JSON.parse(text);
    return parsed.message || fallback;
  } catch {
    return text || fallback;
  }
}

function addMonthsFirstDay(dateKey: string, months: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  return next.toISOString().slice(0, 10);
}

function previousDay(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function defaultRows(position?: FeeSchedulePosition): EditableInstallment[] {
  if (position?.installments?.length === 3) {
    return position.installments.map((row) => ({ amount: row.amount.toFixed(2), arrearsEffectiveDate: row.arrearsEffectiveDate }));
  }
  const start = position?.termStartDate || "";
  return [
    { amount: "", arrearsEffectiveDate: start },
    { amount: "", arrearsEffectiveDate: start ? addMonthsFirstDay(start, 1) : "" },
    { amount: "", arrearsEffectiveDate: start ? addMonthsFirstDay(start, 2) : "" },
  ];
}

export default function FeeScheduleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<EditableInstallment[]>(() => defaultRows());

  const query = useQuery<FeeSchedulePosition>({
    queryKey: ["/api/fees/schedule/current"],
    queryFn: async () => {
      const response = await schoolFetch("/api/fees/schedule/current");
      const text = await response.text();
      if (!response.ok) throw new Error(readableError(text, "Unable to load the fee schedule"));
      return JSON.parse(text);
    },
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (open && query.data) setRows(defaultRows(query.data));
  }, [open, query.data]);

  const total = useMemo(() => Math.round(rows.reduce((sum, row) => {
    const value = Number.parseFloat(row.amount);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0) * 100) / 100, [rows]);

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await schoolFetch("/api/fees/schedule/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installments: rows, academicYear: query.data?.academicYear, term: query.data?.term }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(readableError(text, "Unable to save the fee schedule"));
      return JSON.parse(text) as FeeSchedulePosition;
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(["/api/fees/schedule/current"], data);
      await queryClient.invalidateQueries({ queryKey: ["/api/fees/summary"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      toast({ title: "Fee schedule saved", description: `${data.termLabel} ${data.academicYear || ""} total fees are $${data.totalTermFee.toFixed(2)}.` });
      onOpenChange(false);
    },
    onError: (error: Error) => toast({ title: "Fee schedule not saved", description: error.message, variant: "destructive" }),
  });

  const canSave = rows.every((row) => Number.parseFloat(row.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.arrearsEffectiveDate));
  const position = query.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" onClick={() => onOpenChange(true)}>
          <CalendarDays className="mr-2 h-4 w-4" />
          Fee Schedule
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Term Fee Schedule</DialogTitle>
          <DialogDescription>
            Configure the three instalments for the current school term. A parent becomes overdue from the arrears-effective date shown for each instalment.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="flex min-h-40 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading fee schedule…</div>
        ) : query.isError ? (
          <Alert variant="destructive"><AlertTitle>Unable to load fee schedule</AlertTitle><AlertDescription>{query.error instanceof Error ? query.error.message : "Please try again."}</AlertDescription></Alert>
        ) : position ? (
          <div className="space-y-5">
            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <div><span className="text-muted-foreground">Academic year:</span> <span className="font-medium">{position.academicYear || "Not configured"}</span></div>
                <div><span className="text-muted-foreground">Term:</span> <span className="font-medium">{position.termLabel}</span></div>
                <div><span className="text-muted-foreground">Term starts:</span> <span className="font-medium">{position.termStartDate || "Not configured"}</span></div>
                <div><span className="text-muted-foreground">Term ends:</span> <span className="font-medium">{position.termEndDate || "Not configured"}</span></div>
              </div>
              {position.calendarError && <p role="alert" className="mt-2 text-destructive">{position.calendarError}</p>}
              {!position.calendarError && !["term1", "term2", "term3"].includes(position.academicPeriod || "") &&
                <p role="status" className="mt-2 text-muted-foreground">No active school term. Term fee schedules cannot be saved during a vacation or an unconfigured period.</p>}
            </div>

            <div className="space-y-4">
              {rows.map((row, index) => (
                <div key={index} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[140px_1fr_1.2fr] sm:items-start">
                  <div className="pt-2 font-medium">Instalment {index + 1}</div>
                  <div className="space-y-2">
                    <Label htmlFor={`fee-installment-amount-${index}`}>Amount</Label>
                    <Input
                      id={`fee-installment-amount-${index}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={row.amount}
                      onChange={(event) => setRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, amount: event.target.value } : item))}
                      placeholder={index === 0 ? "290.00" : "280.00"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`fee-installment-date-${index}`}>Arrears effective from</Label>
                    <Input
                      id={`fee-installment-date-${index}`}
                      type="date"
                      min={position.termStartDate || undefined}
                      max={position.termEndDate || undefined}
                      value={row.arrearsEffectiveDate}
                      onChange={(event) => setRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, arrearsEffectiveDate: event.target.value } : item))}
                    />
                    <p className="text-xs text-muted-foreground">{row.arrearsEffectiveDate ? (index === 0 ? `Due at the beginning of term. Arrears apply from ${row.arrearsEffectiveDate}.` : `Payment deadline: ${previousDay(row.arrearsEffectiveDate)}. From ${row.arrearsEffectiveDate}, this instalment is overdue if unpaid.`) : "Enter the date from which this instalment becomes overdue."}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border bg-muted/30 p-4">
              <Label htmlFor="calculated-total-term-fees">Calculated Total Term Fees</Label>
              <Input id="calculated-total-term-fees" className="mt-2 font-semibold" value={total.toFixed(2)} readOnly tabIndex={-1} />
              <p className="mt-2 text-xs text-muted-foreground">This total is calculated automatically from the three instalments and is recalculated again by the server when you save.</p>
            </div>

            {position.configured && position.hasImportedBalances && (
              <Alert>
                <AlertTitle>This school already has imported fee balances</AlertTitle>
                <AlertDescription>Changing amounts or dates can immediately change which current learners are Up to Date or In Arrears. Historical fee-import snapshots will keep the figures used when those imports were created.</AlertDescription>
              </Alert>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!position || !!position.calendarError || !["term1", "term2", "term3"].includes(position.academicPeriod || "") || query.isLoading || mutation.isPending || !canSave || total <= 0} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Save Fee Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
