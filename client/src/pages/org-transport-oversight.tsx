import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, BusFront, CircleDollarSign, Download, ExternalLink, Route, ShieldAlert, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SchoolTransportSummary = {
  schoolId: number;
  schoolName: string;
  shortCode: string;
  enabled: boolean;
  activeRoutes: number;
  activeVehicles: number;
  activeLearners: number;
  totalCharges: number;
  totalCollections: number;
  outstandingBalance: number;
  collectionRate: number;
  openIncidents: number;
  openClaims: number;
  complianceWarnings: number;
  status: "operating" | "not_configured";
};

type TransportOverview = {
  summary: Omit<SchoolTransportSummary, "schoolId" | "schoolName" | "shortCode" | "enabled" | "status"> & { schoolsOperating: number };
  schools: SchoolTransportSummary[];
  alerts: Array<{ schoolId: number; schoolName: string; type: string; count: number; severity: string; message: string }>;
  generatedAt: string;
};

function money(value: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

export default function OrgTransportOversightPage() {
  const { enterSchool, hasPermission } = useAuth();
  const [, setLocation] = useLocation();
  const { data, isLoading, error } = useQuery<TransportOverview>({
    queryKey: ["/api/hq/transport/overview"],
  });

  const openSchool = (schoolId: number) => {
    enterSchool(schoolId);
    setLocation("/transport?mode=hq-oversight");
  };

  const downloadExport = async () => {
    const response = await fetch("/api/hq/transport/overview.csv", { credentials: "include" });
    if (!response.ok) throw new Error("Unable to export transport oversight report");
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "hq-transport-oversight.csv";
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <div className="flex min-h-[360px] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" /></div>;
  }
  if (error || !data) {
    return <Card><CardContent className="p-8 text-center text-destructive">Unable to load organisation transport oversight.</CardContent></Card>;
  }

  const summary = data.summary;
  const cards = [
    { label: "Schools operating", value: summary.schoolsOperating, icon: BusFront },
    { label: "Active routes", value: summary.activeRoutes, icon: Route },
    { label: "Learners using transport", value: summary.activeLearners, icon: Users },
    { label: "Open incidents", value: summary.openIncidents, icon: AlertTriangle },
    { label: "Outstanding balances", value: money(summary.outstandingBalance), icon: CircleDollarSign },
    { label: "Compliance warnings", value: summary.complianceWarnings, icon: ShieldAlert },
  ];

  return (
    <div className="space-y-6" data-testid="hq-transport-oversight">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Transport Oversight</h2>
          <p className="text-sm text-muted-foreground">Organisation-wide read-only monitoring of outsourced school transport operations.</p>
        </div>
        {hasPermission("transport.organization.export") && (
          <Button variant="outline" onClick={() => void downloadExport()} data-testid="button-export-hq-transport">
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-5">
              <div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>
              <div className="rounded-full bg-primary/10 p-3"><Icon className="h-5 w-5 text-primary" /></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Collections overview</CardTitle>
          <CardDescription>Total charges {money(summary.totalCharges)} · collections {money(summary.totalCollections)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm"><span>Organisation collection rate</span><strong>{summary.collectionRate.toFixed(1)}%</strong></div>
          <Progress value={summary.collectionRate} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>School comparison</CardTitle>
          <CardDescription>Select a school to open its Transport workspace in HQ oversight mode.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>School</TableHead><TableHead>Routes</TableHead><TableHead>Vehicles</TableHead><TableHead>Learners</TableHead>
              <TableHead>Collection rate</TableHead><TableHead>Outstanding</TableHead><TableHead>Incidents</TableHead><TableHead>Compliance</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {data.schools.map((school) => (
                <TableRow key={school.schoolId}>
                  <TableCell><div className="font-medium">{school.schoolName}</div><Badge variant={school.status === "operating" ? "default" : "secondary"}>{school.status === "operating" ? "Operating" : "Not configured"}</Badge></TableCell>
                  <TableCell>{school.activeRoutes}</TableCell><TableCell>{school.activeVehicles}</TableCell><TableCell>{school.activeLearners}</TableCell>
                  <TableCell className="min-w-32"><div className="space-y-1"><span className="text-sm">{school.collectionRate.toFixed(1)}%</span><Progress value={school.collectionRate} /></div></TableCell>
                  <TableCell>{money(school.outstandingBalance)}</TableCell>
                  <TableCell>{school.openIncidents ? <Badge variant="destructive">{school.openIncidents}</Badge> : "0"}</TableCell>
                  <TableCell>{school.complianceWarnings ? <Badge variant="outline">{school.complianceWarnings}</Badge> : "0"}</TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => openSchool(school.schoolId)}><ExternalLink className="mr-1 h-3.5 w-3.5" /> View</Button></TableCell>
                </TableRow>
              ))}
              {!data.schools.length && <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">No schools are available.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Attention required</CardTitle><CardDescription>Items that HQ should follow up with the relevant school.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {data.alerts.slice(0, 20).map((alert, index) => (
            <div key={`${alert.schoolId}-${alert.type}-${index}`} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-medium">{alert.schoolName}</p><p className="text-sm text-muted-foreground">{alert.message}</p></div>
              <Button size="sm" variant="ghost" onClick={() => openSchool(alert.schoolId)}>Review school</Button>
            </div>
          ))}
          {!data.alerts.length && <p className="py-6 text-center text-sm text-muted-foreground">No organisation-level transport alerts.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
