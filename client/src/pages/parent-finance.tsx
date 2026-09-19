import { useQuery } from "@tanstack/react-query";
import { Clock3, CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const money = (value: unknown) => `USD ${Number(value || 0).toFixed(2)}`;

function snapshotLabel(value: string | null | undefined) {
  if (!value) return "Financial information has not yet been updated.";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Financial information has not yet been updated.";
  return `Financial information last updated: ${date.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}`;
}

export default function ParentFinancePage() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/me/parent-finance"] });
  if (isLoading) return <div className="space-y-4 p-4 sm:p-6"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  const children = data?.children || [];

  return (
    <div className="space-y-6 p-3 sm:p-4 lg:p-6">
      <div><h1 className="text-3xl font-bold">Fees & Payments</h1><p className="text-muted-foreground">Financial information for your linked children only.</p></div>
      {children.map((row: any) => (
        <Card key={row.student.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{row.student.firstName} {row.student.lastName}</CardTitle>
              <Badge variant={row.finance.status === "in_arrears" ? "destructive" : "secondary"} className="capitalize">{String(row.finance.status).replaceAll("_", " ")}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{row.student.schoolName ? `${row.student.schoolName} · ` : ""}{row.student.admissionNo}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/35 px-4 py-3 text-sm" data-testid={`fees-last-updated-${row.student.id}`}>
              <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{snapshotLabel(row.finance.snapshotAt)}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Term fees</div><div className="text-lg font-semibold">{money(row.finance.totalTerm)}</div></div>
              <div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Paid</div><div className="text-lg font-semibold">{money(row.finance.paidSoFar)}</div></div>
              <div className="rounded-lg border p-3"><div className="text-sm text-muted-foreground">Balance</div><div className="text-lg font-semibold">{money(row.finance.balance)}</div></div>
            </div>
            {row.finance.temporaryAccessOverride && <div className="rounded-lg border p-3 text-sm"><strong>Temporary financial Gate access:</strong> {row.finance.temporaryAccessOverride.reason} · expires {new Date(row.finance.temporaryAccessOverride.expiresAt).toLocaleString()}</div>}
            <div>
              <h3 className="mb-2 font-semibold">Payment history</h3>
              {row.finance.payments?.length ? (
                <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Receipt</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody>{row.finance.payments.map((payment: any) => <TableRow key={payment.id}><TableCell>{String(payment.paymentDate)}</TableCell><TableCell>{payment.receiptNo || "—"}</TableCell><TableCell>{payment.paymentMethod || "—"}</TableCell><TableCell className="text-right">{money(payment.amount)}</TableCell></TableRow>)}</TableBody></Table>
              ) : (
                <div className="rounded-lg bg-muted/40 p-5 text-center text-muted-foreground"><CreditCard className="mx-auto mb-2 h-6 w-6" />No payment records available.</div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      {!children.length && <Card><CardContent className="py-10 text-center text-muted-foreground">No linked children found.</CardContent></Card>}
    </div>
  );
}
