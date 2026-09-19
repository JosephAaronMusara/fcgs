import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bus, CalendarCheck, CreditCard, FileText, GraduationCap, Home, ShieldCheck } from "lucide-react";

const money = (value: number | string | null | undefined) => `USD ${Number(value || 0).toFixed(2)}`;
const dateTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "—";

type Summary = {
  student: { id: number; schoolId?: number; schoolName?: string | null; schoolShortCode?: string | null; admissionNo: string; firstName: string; lastName: string; photo?: string | null; className?: string | null; status?: string | null };
  attendance: { rate: number; total: number; recent: any[] };
  finance: { balance: number; status: string; snapshotAt?: string | null; temporaryAccessOverride?: any | null };
  access: { enrolled: boolean; entryPolicy: string; policyReason?: string | null; manuallyRestricted?: boolean; recentEvents: any[]; earlyRelease?: any | null };
  transport: any | null;
  boarding: { isBoarding: boolean; isDayScholar: boolean; hostel?: { name: string } | null };
};

type ParentDashboard = { parent: { firstName: string; lastName: string }; children: Summary[] };

function StatusBadge({ value }: { value: string }) {
  const label = value.replaceAll("_", " ");
  return <Badge variant={value === "in_arrears" || value === "deny" ? "destructive" : "secondary"} className="capitalize">{label}</Badge>;
}

function StudentOverview({ summary, parentView = false }: { summary: Summary; parentView?: boolean }) {
  const lastAccess = summary.access.recentEvents?.[0];
  return (
    <Card data-testid={`portal-student-card-${summary.student.id}`}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{summary.student.firstName} {summary.student.lastName}</CardTitle>
            <p className="text-sm text-muted-foreground">{summary.student.schoolName ? `${summary.student.schoolName} · ` : ""}{summary.student.admissionNo}{summary.student.className ? ` · ${summary.student.className}` : ""}</p>
          </div>
          <Badge variant={summary.student.status === "active" ? "default" : "secondary"}>{summary.student.status || "active"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border p-3"><div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarCheck className="h-4 w-4"/>Attendance</div><div className="mt-1 text-xl font-semibold">{summary.attendance.rate}%</div><div className="text-xs text-muted-foreground">{summary.attendance.total} recorded days</div></div>
          <div className="rounded-lg border p-3"><div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4"/>Gate access</div><div className="mt-1"><StatusBadge value={summary.access.manuallyRestricted ? "restricted" : summary.access.entryPolicy}/></div><div className="mt-1 text-xs text-muted-foreground">{lastAccess ? `${lastAccess.direction || "scan"} · ${dateTime(lastAccess.occurredAt)}` : "No recent Gate event"}</div></div>
          <div className="rounded-lg border p-3"><div className="flex items-center gap-2 text-sm text-muted-foreground"><CreditCard className="h-4 w-4"/>Finance</div><div className="mt-1 flex items-center gap-2"><span className="font-semibold">{money(summary.finance.balance)}</span><StatusBadge value={summary.finance.status}/></div>{summary.finance.temporaryAccessOverride && <div className="mt-1 text-xs text-muted-foreground">Temporary Gate access until {dateTime(summary.finance.temporaryAccessOverride.expiresAt)}</div>}</div>
          <div className="rounded-lg border p-3"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Bus className="h-4 w-4"/>Transport</div><div className="mt-1 font-medium">{summary.transport?.route?.name || "Not registered"}</div><div className="text-xs text-muted-foreground">{summary.transport?.vehicle?.registrationNumber || summary.transport?.outboundVehicle?.registrationNumber || "No vehicle assigned"}</div></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-muted/40 p-3"><div className="flex items-center gap-2 font-medium"><Home className="h-4 w-4"/>Boarding / Hostel</div><p className="mt-1 text-sm text-muted-foreground">{summary.boarding.isBoarding ? (summary.boarding.hostel?.name || "Boarding student — hostel not assigned") : "Day scholar"}</p></div>
          <div className="rounded-lg bg-muted/40 p-3"><div className="font-medium">Current access note</div><p className="mt-1 text-sm text-muted-foreground">{summary.access.policyReason || "No access restriction recorded"}{summary.access.earlyRelease ? ` · Early release valid until ${dateTime(summary.access.earlyRelease.validUntil)}` : ""}</p></div>
        </div>
        {parentView && <div className="flex flex-wrap gap-2"><Link href="/children-attendance"><Button variant="outline" size="sm">Attendance</Button></Link><Link href="/children-reports"><Button variant="outline" size="sm"><FileText className="mr-2 h-4 w-4"/>Reports</Button></Link><Link href="/fees"><Button variant="outline" size="sm">Finance</Button></Link></div>}
      </CardContent>
    </Card>
  );
}

export default function PortalDashboardPage() {
  const { user } = useAuth();
  const parent = user?.role === "parent";
  const query = useQuery<any>({ queryKey: [parent ? "/api/me/parent-dashboard" : "/api/me/student-dashboard"], enabled: user?.role === "parent" || user?.role === "student" });
  if (query.isLoading) return <div className="space-y-4 p-4 sm:p-6"><Skeleton className="h-10 w-72"/><Skeleton className="h-64 w-full"/></div>;
  if (query.isError || !query.data) return <div className="p-6"><Card><CardContent className="py-10 text-center text-muted-foreground">Unable to load your portal dashboard.</CardContent></Card></div>;
  const summaries: Summary[] = parent ? (query.data as ParentDashboard).children : [query.data as Summary];
  return <div className="space-y-6 p-3 sm:p-4 lg:p-6">
    <div><h1 className="text-3xl font-bold">{parent ? "Parent Dashboard" : "Student Dashboard"}</h1><p className="text-muted-foreground">{parent ? "A secure view of your linked children, attendance, Gate access, finance and school services." : "Your attendance, Gate access, finance and school services in one place."}</p></div>
    {summaries.length ? <div className="space-y-5">{summaries.map((summary) => <StudentOverview key={summary.student.id} summary={summary} parentView={parent}/>)}</div> : <Card><CardContent className="py-12 text-center"><GraduationCap className="mx-auto mb-3 h-10 w-10 text-muted-foreground"/><p className="text-muted-foreground">No linked student record is available.</p></CardContent></Card>}
  </div>;
}
