import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiRequest, queryClient, schoolFetch } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Banknote,
  Bus,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  CreditCard,
  FileCheck2,
  FileClock,
  FileText,
  Gauge,
  History,
  Lock,
  Map,
  MapPin,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Route,
  Search,
  Settings,
  ShieldCheck,
  TriangleAlert,
  UserRoundCheck,
  Users,
  WalletCards,
  XCircle,
} from "lucide-react";

type Bootstrap = {
  school: any;
  settings: any;
  routes: any[];
  points: any[];
  owners: any[];
  drivers: any[];
  vehicles: any[];
  servicePoints: any[];
  paths: any[];
  pathNodes: any[];
  students: any[];
  staff: any[];
  assignments: any[];
  payments: any[];
  paymentPlans: any[];
  refunds: any[];
  cashups: any[];
  subscriptions: any[];
  penalties: any[];
  advances: any[];
  incidents: any[];
  claims: any[];
  payouts: any[];
  audits: any[];
  dashboard: any;
};

type DialogState = { type: string; record?: any } | null;

type PathNodeDraft = {
  key: string;
  nodeType: "start" | "learner_stop" | "checkpoint" | "destination";
  name: string;
  latitude: number;
  longitude: number;
  stopOrder: number;
  expectedTime?: string | null;
  checkpointRadiusMeters?: number | null;
  notes?: string | null;
  learnerLinks?: Array<any>;
};

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().getMonth() + 1;
const money = (value: any) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const titleCase = (value: any) => String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const idValue = (value: any) => (value === "none" || value === "" || value == null ? null : Number(value));
const classNames = (...items: Array<string | false | null | undefined>) => items.filter(Boolean).join(" ");

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["paid", "approved", "active", "verified", "reconciled", "completed", "path_confirmed"].includes(status)) return "default";
  if (["reversed", "rejected", "cancelled", "suspended", "defaulted", "critical", "overdue"].includes(status)) return "destructive";
  if (["draft", "pending_start", "pending_first_payment", "requested", "submitted", "paused", "partially_paid"].includes(status)) return "secondary";
  return "outline";
}

export default function TransportPage() {
  const { currentSchoolId, user, hasAnyPermission } = useAuth();
  const { toast } = useToast();
  const [topTab, setTopTab] = useState(() => localStorage.getItem("transportTopTab") || "overview");
  const [operationsTab, setOperationsTab] = useState(() => localStorage.getItem("transportOperationsTab") || "learners");
  const [billingTab, setBillingTab] = useState(() => localStorage.getItem("transportBillingTab") || "payments");
  const [settlementsTab, setSettlementsTab] = useState(() => localStorage.getItem("transportSettlementsTab") || "claims");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [search, setSearch] = useState("");
  const [reportFrom, setReportFrom] = useState(() => `${new Date().getFullYear()}-${String(currentMonth()).padStart(2, "0")}-01`);
  const [reportTo, setReportTo] = useState(today());

  const isHqOversight = user?.role === "org_admin" && new URLSearchParams(window.location.search).get("mode") === "hq-oversight";
  const canManageFromHq = hasAnyPermission("transport.organization.manage");
  const can = (...permissions: string[]) => {
    const operationalRequest = permissions.some((permission) => permission !== "transport.view" && !permission.endsWith(".view"));
    if (isHqOversight && operationalRequest && !canManageFromHq) return false;
    return hasAnyPermission(...permissions);
  };
  const canManageLegacy = can("transport.create", "transport.edit", "transport.delete");
  const effectiveSchoolId = currentSchoolId ?? user?.schoolId ?? null;

  const openTransportPdf = useCallback(async (url: string): Promise<void> => {
    if (!effectiveSchoolId) {
      toast({
        title: "Select a school",
        description: "Open the school context before viewing a Transport PDF.",
        variant: "destructive",
      });
      return;
    }

    const requestUrl = new URL(url, window.location.origin);
    // The header is authoritative. The query value is a same-origin fallback for
    // deployments or browser flows that strip custom headers before the request
    // reaches the Transport router. The server validates both against the user.
    if (!requestUrl.searchParams.has("schoolId")) {
      requestUrl.searchParams.set("schoolId", String(effectiveSchoolId));
    }

    const popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.opener = null;
      popup.document.title = "Preparing PDF…";
      popup.document.body.innerHTML = '<div style="font-family:Arial,sans-serif;padding:24px">Generating PDF…</div>';
    }

    try {
      const response = await schoolFetch(`${requestUrl.pathname}${requestUrl.search}`, {
        headers: { "X-School-Id": String(effectiveSchoolId) },
      });
      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        const body = contentType.includes("application/json")
          ? await response.json().catch(() => null)
          : null;
        const text = body ? null : await response.text().catch(() => "");
        throw new Error(body?.message || text || "Unable to generate PDF");
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/pdf")) {
        throw new Error("The server did not return a PDF document.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (popup) {
        popup.location.replace(objectUrl);
      } else {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.target = "_blank";
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      toast({
        title: "Transport PDF failed",
        description: error instanceof Error ? error.message : "Unable to generate PDF",
        variant: "destructive",
      });
    }
  }, [effectiveSchoolId, toast]);

  useEffect(() => localStorage.setItem("transportTopTab", topTab), [topTab]);
  useEffect(() => localStorage.setItem("transportOperationsTab", operationsTab), [operationsTab]);
  useEffect(() => localStorage.setItem("transportBillingTab", billingTab), [billingTab]);
  useEffect(() => localStorage.setItem("transportSettlementsTab", settlementsTab), [settlementsTab]);

  const { data, isLoading, error, refetch } = useQuery<Bootstrap>({
    queryKey: ["/api/transport/bootstrap"],
    queryFn: async () => {
      const response = await schoolFetch("/api/transport/bootstrap");
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
  });

  const { data: reportData, refetch: refreshReport, isFetching: reportLoading } = useQuery<any>({
    queryKey: ["/api/transport/reports/summary", reportFrom, reportTo],
    queryFn: async () => {
      const response = await schoolFetch(`/api/transport/reports/summary?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    enabled: topTab === "reports",
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/transport/bootstrap"] });
    await refetch();
  };

  const mutate = useMutation({
    mutationFn: async ({ method = "POST", url, body }: { method?: string; url: string; body?: any }) => {
      const response = await apiRequest(method, url, body);
      return response.status === 204 ? null : response.json();
    },
    onSuccess: async (result: any, variables) => {
      await refresh();
      if (!variables.url.includes("/preview")) setDialog(null);
      toast({ title: "Transport record saved" });
      if (variables.url === "/api/transport/payments" && result?.payment?.id) {
        void openTransportPdf(`/api/transport/receipts/${result.payment.id}/print`);
      }
    },
    onError: (error: any) => {
      let description = error?.message || "Unable to complete this transport action.";
      try {
        const body = description.slice(description.indexOf("{") > -1 ? description.indexOf("{") : 0);
        const parsed = JSON.parse(body);
        description = parsed.message || description;
      } catch {}
      toast({ title: "Transport action failed", description, variant: "destructive" });
    },
  });

  const assignments = useMemo(() => {
    const query = search.toLowerCase().trim();
    return (data?.assignments || []).filter((assignment) => !query || `${assignment.firstName} ${assignment.lastName} ${assignment.admissionNo} ${assignment.routeName} ${assignment.vehicleRegistration}`.toLowerCase().includes(query));
  }, [data?.assignments, search]);

  const open = (type: string, record?: any) => setDialog({ type, record });

  if (isLoading) return <div className="p-6"><Card><CardContent className="p-8 text-center text-muted-foreground">Loading Transport workspace…</CardContent></Card></div>;
  if (error || !data) return <div className="p-6"><Alert variant="destructive"><TriangleAlert className="h-4 w-4"/><AlertTitle>Unable to load Transport</AlertTitle><AlertDescription>{error instanceof Error ? error.message : "No Transport data was returned."}</AlertDescription></Alert></div>;

  const d = data.dashboard || {};
  const expected = Number(d.expected || 0);
  const collected = Number(d.collected || 0);
  const outstanding = expected - collected;

  return (
    <div className="space-y-5 p-4 md:p-6">
      {isHqOversight && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>HQ Oversight Mode</AlertTitle>
          <AlertDescription>You are viewing {data.school?.name || "this school"} transport records with organisation oversight permissions. Operational actions remain hidden unless an exceptional management permission has been granted.</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Bus className="h-7 w-7"/>Transport</h1>
          <p className="text-muted-foreground">Operations, learner billing, service-provider settlements, reporting and audit controls.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refresh()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button>
          {(can("transport.charges.generate") || canManageLegacy) && <Button variant="outline" onClick={() => open("charge")}><WalletCards className="mr-2 h-4 w-4"/>Generate Charges</Button>}
          {(can("transport.payments.record") || canManageLegacy) && <Button onClick={() => open("payment")}><CreditCard className="mr-2 h-4 w-4"/>Record Payment</Button>}
        </div>
      </div>

      <Tabs value={topTab} onValueChange={setTopTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="w-max min-w-full justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="settlements">Settlements</TabsTrigger>
            <TabsTrigger value="reports">Reports & Audit</TabsTrigger>
            {(can("transport.settings.manage") || canManageLegacy) && <TabsTrigger value="settings">Settings</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-5">
          <Overview data={data} expected={expected} collected={collected} outstanding={outstanding} onOpen={open}/>
        </TabsContent>

        <TabsContent value="operations">
          <OperationsWorkspace
            data={data}
            assignments={assignments}
            search={search}
            setSearch={setSearch}
            tab={operationsTab}
            setTab={setOperationsTab}
            open={open}
            can={can}
            canManageLegacy={canManageLegacy}
            mutate={mutate}
          />
        </TabsContent>

        <TabsContent value="billing">
          <BillingWorkspace data={data} tab={billingTab} setTab={setBillingTab} open={open} can={can} canManageLegacy={canManageLegacy} mutate={mutate} openTransportPdf={openTransportPdf}/>
        </TabsContent>

        <TabsContent value="settlements">
          <SettlementsWorkspace data={data} tab={settlementsTab} setTab={setSettlementsTab} open={open} can={can} canManageLegacy={canManageLegacy} mutate={mutate} openTransportPdf={openTransportPdf}/>
        </TabsContent>

        <TabsContent value="reports">
          <ReportsAuditWorkspace
            data={data}
            reportData={reportData}
            reportFrom={reportFrom}
            reportTo={reportTo}
            setReportFrom={setReportFrom}
            setReportTo={setReportTo}
            refreshReport={refreshReport}
            loading={reportLoading}
            openTransportPdf={openTransportPdf}
          />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsWorkspace data={data} saving={mutate.isPending} onSave={(body: any) => mutate.mutate({ method: "PUT", url: "/api/transport/settings", body })}/>
        </TabsContent>
      </Tabs>

      {dialog && (
        <TransportDialog
          state={dialog}
          data={data}
          saving={mutate.isPending}
          close={() => setDialog(null)}
          submit={(method, url, body) => mutate.mutate({ method, url, body })}
        />
      )}
    </div>
  );
}

function Overview({ data, expected, collected, outstanding, onOpen }: any) {
  const d = data.dashboard || {};
  const cards = [
    ["Active learners", d.active_learners || 0, Users],
    ["Pending learners", d.pending_learners || 0, FileClock],
    ["Active routes", d.active_routes || 0, Route],
    ["Active vehicles", d.active_vehicles || 0, Bus],
    ["Total charged", `USD ${money(expected)}`, CircleDollarSign],
    ["Total collected", `USD ${money(collected)}`, Banknote],
    ["Outstanding", `USD ${money(outstanding)}`, WalletCards],
    ["Payouts due", `USD ${money(d.payouts_due)}`, CreditCard],
    ["Pending claims", d.pending_claims || 0, FileCheck2],
    ["Pending refunds", d.pending_refunds || 0, RefreshCw],
    ["Advances outstanding", `USD ${money(d.advances_outstanding)}`, Gauge],
  ];
  const expiringVehicles = data.vehicles.filter((vehicle: any) => {
    const limit = new Date(); limit.setDate(limit.getDate() + 45);
    return [vehicle.insuranceExpiry, vehicle.fitnessExpiry].some((date: string) => date && new Date(date) <= limit);
  });
  const expiringDrivers = data.drivers.filter((driver: any) => {
    const limit = new Date(); limit.setDate(limit.getDate() + 45);
    return driver.licenceExpiry && new Date(driver.licenceExpiry) <= limit;
  });
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {cards.map(([title, value, Icon]: any) => <Card key={title}><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs text-muted-foreground">{title}</p><p className="text-xl font-bold">{value}</p></div><Icon className="h-6 w-6 text-muted-foreground"/></CardContent></Card>)}
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Operational attention</CardTitle><CardDescription>Compliance and service records requiring review.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {expiringVehicles.length === 0 && expiringDrivers.length === 0 ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4"/>No documents expiring in the next 45 days.</div> : null}
          {expiringVehicles.map((vehicle: any) => <div key={`v-${vehicle.id}`} className="flex items-center justify-between rounded-md border p-3"><div><div className="font-medium">{vehicle.registrationNumber}</div><div className="text-xs text-muted-foreground">Insurance: {vehicle.insuranceExpiry || "—"} · Fitness: {vehicle.fitnessExpiry || "—"}</div></div><Badge variant="destructive">Review</Badge></div>)}
          {expiringDrivers.map((driver: any) => <div key={`d-${driver.id}`} className="flex items-center justify-between rounded-md border p-3"><div><div className="font-medium">{driver.firstName} {driver.lastName}</div><div className="text-xs text-muted-foreground">Licence expires {driver.licenceExpiry}</div></div><Badge variant="destructive">Review</Badge></div>)}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Quick actions</CardTitle><CardDescription>Common Transport workflows.</CardDescription></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" className="justify-start" onClick={() => onOpen("assignment")}><UserRoundCheck className="mr-2 h-4 w-4"/>Register learner service</Button>
          <Button variant="outline" className="justify-start" onClick={() => onOpen("path")}><Map className="mr-2 h-4 w-4"/>Vehicle Path Setup</Button>
          <Button variant="outline" className="justify-start" onClick={() => onOpen("incident")}><AlertTriangle className="mr-2 h-4 w-4"/>Log incident</Button>
          <Button variant="outline" className="justify-start" onClick={() => onOpen("cashup")}><ClipboardCheck className="mr-2 h-4 w-4"/>Prepare cash-up</Button>
          <Button variant="outline" className="justify-start" onClick={() => onOpen("claim")}><FileText className="mr-2 h-4 w-4"/>Generate claim</Button>
          <Button variant="outline" className="justify-start" onClick={() => onOpen("refund")}><RefreshCw className="mr-2 h-4 w-4"/>Request refund</Button>
        </CardContent>
      </Card>
    </div>
  </>;
}

function OperationsWorkspace({ data, assignments, search, setSearch, tab, setTab, open, can, canManageLegacy, mutate }: any) {
  const canEdit = canManageLegacy || can("transport.routes.edit", "transport.vehicles.edit", "transport.learners.edit_service");
  return <Tabs value={tab} onValueChange={setTab}>
    <div className="overflow-x-auto pb-1"><TabsList className="w-max justify-start">
      <TabsTrigger value="learners">Learners</TabsTrigger><TabsTrigger value="paths">Vehicle Path Setup</TabsTrigger><TabsTrigger value="routes">Routes</TabsTrigger><TabsTrigger value="vehicles">Vehicles</TabsTrigger><TabsTrigger value="drivers">Drivers</TabsTrigger><TabsTrigger value="owners">Owners</TabsTrigger><TabsTrigger value="incidents">Incidents</TabsTrigger>
    </TabsList></div>

    <TabsContent value="learners"><Card>
      <CardHeader className="gap-3 xl:flex-row xl:items-center xl:justify-between"><div><CardTitle>Learner transport services</CardTitle><CardDescription>Planning, service and financial states remain separate.</CardDescription></div><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"/><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search learner, route or vehicle" className="w-64 pl-8"/></div>{(can("transport.learners.enrol") || canManageLegacy) && <Button onClick={() => open("assignment")}><Plus className="mr-2 h-4 w-4"/>Register learner</Button>}</div></CardHeader>
      <CardContent><DataTable heads={["Learner", "Route", "Service location", "Vehicle(s)", "Service", "Planning", "Financial", "Balance", "Actions"]}>{assignments.map((assignment: any) => <TableRow key={assignment.id}>
        <TableCell><div className="font-medium">{assignment.firstName} {assignment.lastName}</div><div className="text-xs text-muted-foreground">{assignment.admissionNo} · {assignment.className || "No class"}</div></TableCell>
        <TableCell>{assignment.routeName}</TableCell>
        <TableCell><div>{assignment.pickupName || "—"}</div>{assignment.dropoffName && assignment.dropoffName !== assignment.pickupName && <div className="text-xs text-muted-foreground">Drop-off: {assignment.dropoffName}</div>}</TableCell>
        <TableCell><div>{assignment.vehicleRegistration || "—"}</div>{assignment.outboundVehicleRegistration && assignment.outboundVehicleRegistration !== assignment.vehicleRegistration && <div className="text-xs text-muted-foreground">Return: {assignment.outboundVehicleRegistration}</div>}</TableCell>
        <TableCell><StatusBadge value={assignment.serviceState}/><div className="mt-1 text-xs text-muted-foreground">{titleCase(assignment.serviceType)}</div></TableCell>
        <TableCell><StatusBadge value={assignment.planningStatus}/></TableCell>
        <TableCell><StatusBadge value={assignment.financialStatus}/></TableCell>
        <TableCell className={Number(assignment.balance) > 0 ? "font-medium text-destructive" : ""}>USD {money(assignment.balance)}</TableCell>
        <TableCell><div className="flex gap-1">{(can("transport.learners.transfer") || canManageLegacy) && assignment.isActive && <Button size="sm" variant="outline" onClick={() => open("transfer", assignment)}><ArrowRightLeft className="mr-1 h-3.5 w-3.5"/>Transfer</Button>}{canEdit && assignment.isActive && <Button size="sm" variant="ghost" onClick={() => open("state", assignment)}>State</Button>}</div></TableCell>
      </TableRow>)}</DataTable></CardContent>
    </Card></TabsContent>

    <TabsContent value="paths"><Card>
      <CardHeader className="flex-row items-center justify-between"><div><CardTitle>Vehicle Path Setup</CardTitle><CardDescription>Versioned, direction-specific paths built from learner GPS service points and mandatory checkpoints.</CardDescription></div>{(can("transport.paths.manage") || canManageLegacy) && <Button onClick={() => open("path")}><Plus className="mr-2 h-4 w-4"/>New path version</Button>}</CardHeader>
      <CardContent><DataTable heads={["Path", "Vehicle", "Route", "Direction", "Version", "Effective", "Nodes", "Status", "Action"]}>{data.paths.map((path: any) => {
        const vehicle = data.vehicles.find((row: any) => row.id === path.vehicleId);
        const route = data.routes.find((row: any) => row.id === path.routeId);
        const nodes = data.pathNodes.filter((row: any) => row.pathId === path.id);
        return <TableRow key={path.id}><TableCell className="font-medium">{path.name}</TableCell><TableCell>{vehicle?.registrationNumber || "—"}</TableCell><TableCell>{route?.name || "—"}</TableCell><TableCell>{titleCase(path.direction)}</TableCell><TableCell>v{path.versionNumber}</TableCell><TableCell>{path.effectiveFrom}{path.effectiveTo ? ` – ${path.effectiveTo}` : ""}</TableCell><TableCell>{nodes.length}<div className="text-xs text-muted-foreground">{nodes.filter((node: any) => node.nodeType === "checkpoint").length} checkpoints</div></TableCell><TableCell><StatusBadge value={path.status}/></TableCell><TableCell>{path.status === "draft" && (can("transport.paths.manage") || canManageLegacy) && <Button size="sm" onClick={() => mutate.mutate({ method: "PUT", url: `/api/transport/paths/${path.id}/activate` })}>Activate</Button>}</TableCell></TableRow>;
      })}</DataTable></CardContent>
    </Card></TabsContent>

    <TabsContent value="routes"><MasterTable title="Routes" description="Broad service corridors. Capacity is derived from vehicles, not entered on routes." button="Add route" canAdd={can("transport.routes.create") || canManageLegacy} onAdd={() => open("route")} heads={["Code", "Route", "Direction", "Monthly fee", "Status", "Actions"]} rows={data.routes.map((route: any) => <TableRow key={route.id}><TableCell>{route.code}</TableCell><TableCell className="font-medium">{route.name}</TableCell><TableCell>{titleCase(route.direction)}</TableCell><TableCell>USD {money(route.defaultFee)}</TableCell><TableCell><StatusBadge value={route.status || (route.isActive ? "active" : "retired")}/></TableCell><TableCell>{(can("transport.routes.edit") || canManageLegacy) && <Button size="sm" variant="outline" onClick={() => open("route", route)}><Pencil className="mr-1 h-3.5 w-3.5"/>Edit</Button>}</TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="vehicles"><MasterTable title="Vehicles" description="Vehicle capacity is the source of truth for seat controls." button="Add vehicle" canAdd={can("transport.vehicles.create") || canManageLegacy} onAdd={() => open("vehicle")} heads={["Registration", "Make / model", "Capacity", "Owner", "Driver", "Compliance", "Status", "Actions"]} rows={data.vehicles.map((vehicle: any) => {
      const owner = data.owners.find((row: any) => row.id === vehicle.ownerId);
      const driver = data.drivers.find((row: any) => row.id === vehicle.driverId);
      const complianceProblem = [vehicle.insuranceExpiry, vehicle.fitnessExpiry].some((date: string) => date && new Date(date) < new Date());
      return <TableRow key={vehicle.id}><TableCell className="font-medium">{vehicle.registrationNumber}</TableCell><TableCell>{vehicle.makeModel || "—"}</TableCell><TableCell>{vehicle.capacity}</TableCell><TableCell>{owner?.name || "—"}</TableCell><TableCell>{driver ? `${driver.firstName} ${driver.lastName}` : "—"}</TableCell><TableCell><Badge variant={complianceProblem ? "destructive" : "secondary"}>{complianceProblem ? "Expired" : "Current"}</Badge></TableCell><TableCell><StatusBadge value={vehicle.status || (vehicle.isActive ? "active" : "retired")}/></TableCell><TableCell>{(can("transport.vehicles.edit") || canManageLegacy) && <Button size="sm" variant="outline" onClick={() => open("vehicle", vehicle)}><Pencil className="mr-1 h-3.5 w-3.5"/>Edit</Button>}</TableCell></TableRow>;
    })}/></TabsContent>

    <TabsContent value="drivers"><MasterTable title="Drivers" description="Licence and engagement details are effective-dated." button="Add driver" canAdd={can("transport.drivers.manage") || canManageLegacy} onAdd={() => open("driver")} heads={["Driver", "Phone", "Licence", "Expiry", "Engagement", "Status", "Actions"]} rows={data.drivers.map((driver: any) => <TableRow key={driver.id}><TableCell className="font-medium">{driver.firstName} {driver.lastName}</TableCell><TableCell>{driver.phone || "—"}</TableCell><TableCell>{driver.licenceNumber || "—"}</TableCell><TableCell>{driver.licenceExpiry || "—"}</TableCell><TableCell>{titleCase(driver.engagementType)}</TableCell><TableCell><StatusBadge value={driver.isActive ? "active" : "retired"}/></TableCell><TableCell>{(can("transport.drivers.manage") || canManageLegacy) && <Button size="sm" variant="outline" onClick={() => open("driver", driver)}><Pencil className="mr-1 h-3.5 w-3.5"/>Edit</Button>}</TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="owners"><MasterTable title="Vehicle owners and service providers" description="Each school keeps its own isolated owner records and settlements." button="Add owner" canAdd={can("transport.owners.manage") || canManageLegacy} onAdd={() => open("owner")} heads={["Owner", "Type", "Contact", "Phone", "Status", "Actions"]} rows={data.owners.map((owner: any) => <TableRow key={owner.id}><TableCell className="font-medium">{owner.name}</TableCell><TableCell>{titleCase(owner.ownerType)}</TableCell><TableCell>{owner.contactPerson || "—"}</TableCell><TableCell>{owner.phone || "—"}</TableCell><TableCell><StatusBadge value={owner.isActive ? "active" : "retired"}/></TableCell><TableCell>{(can("transport.owners.manage") || canManageLegacy) && <Button size="sm" variant="outline" onClick={() => open("owner", owner)}><Pencil className="mr-1 h-3.5 w-3.5"/>Edit</Button>}</TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="incidents"><MasterTable title="Transport incidents" description="Operational incidents do not automatically redistribute claims or payouts." button="Log incident" canAdd={can("transport.incidents.manage") || canManageLegacy} onAdd={() => open("incident")} heads={["Incident", "Vehicle", "Type", "Occurred", "Severity", "Status", "Description"]} rows={data.incidents.map((incident: any) => <TableRow key={incident.id}><TableCell className="font-medium">{incident.incidentNumber}</TableCell><TableCell>{data.vehicles.find((vehicle: any) => vehicle.id === incident.vehicleId)?.registrationNumber || "—"}</TableCell><TableCell>{titleCase(incident.incidentType)}</TableCell><TableCell>{new Date(incident.occurredAt).toLocaleString()}</TableCell><TableCell><StatusBadge value={incident.severity}/></TableCell><TableCell><StatusBadge value={incident.status}/></TableCell><TableCell className="max-w-xs whitespace-normal">{incident.description}</TableCell></TableRow>)}/></TabsContent>
  </Tabs>;
}

function BillingWorkspace({ data, tab, setTab, open, can, canManageLegacy, mutate, openTransportPdf }: any) {
  const unclaimedPayments = data.payments.filter((payment: any) => !payment.reversedAt);
  return <Tabs value={tab} onValueChange={setTab}>
    <div className="overflow-x-auto pb-1"><TabsList className="w-max justify-start"><TabsTrigger value="payments">Payments & Receipts</TabsTrigger><TabsTrigger value="accounts">Learner Accounts</TabsTrigger><TabsTrigger value="plans">Payment Plans</TabsTrigger><TabsTrigger value="refunds">Credits & Refunds</TabsTrigger><TabsTrigger value="cashups">Cash-Up</TabsTrigger><TabsTrigger value="charges">Charges</TabsTrigger></TabsList></div>

    <TabsContent value="payments"><MasterTable title="Transport payments and immutable receipts" description="Issued receipts cannot be edited. Corrections use reversal and replacement." button="Record payment" canAdd={can("transport.payments.record") || canManageLegacy} onAdd={() => open("payment")} heads={["Receipt", "Learner", "Payment date", "Method", "Amount", "Allocated", "Credit", "Verification", "Claim / payout", "Actions"]} rows={data.payments.map((payment: any) => <TableRow key={payment.id}><TableCell><div className="font-medium">{payment.receiptNo}</div>{Number(payment.reprintCount) > 0 && <div className="text-xs text-muted-foreground">{payment.reprintCount} reprint(s)</div>}</TableCell><TableCell>{payment.firstName} {payment.lastName}<div className="text-xs text-muted-foreground">{payment.admissionNo}</div></TableCell><TableCell>{payment.paymentDate}</TableCell><TableCell>{titleCase(payment.paymentMethod)}</TableCell><TableCell>USD {money(payment.amount)}</TableCell><TableCell>USD {money(payment.allocatedAmount)}</TableCell><TableCell>USD {money(payment.unallocatedAmount)}</TableCell><TableCell><StatusBadge value={payment.reversedAt ? "reversed" : payment.verificationStatus}/></TableCell><TableCell>{payment.claimNumber || "—"}{payment.payoutNumber && <div className="text-xs text-muted-foreground">{payment.payoutNumber}</div>}</TableCell><TableCell><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => void openTransportPdf(`/api/transport/receipts/${payment.id}/print`)}><FileText className="mr-1 h-3.5 w-3.5"/>View PDF</Button>{!payment.reversedAt && payment.verificationStatus === "unverified" && (can("transport.payments.verify") || canManageLegacy) && <Button size="sm" variant="ghost" onClick={() => mutate.mutate({ url: `/api/transport/payments/${payment.id}/verify` })}>Verify</Button>}{!payment.reversedAt && !payment.claimId && (can("transport.payments.reverse") || can("transport.delete")) && <Button size="sm" variant="destructive" onClick={() => open("reversePayment", payment)}>Reverse</Button>}</div></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="accounts"><Card><CardHeader><CardTitle>Learner transport accounts</CardTitle><CardDescription>Charges, allocations, balances and unallocated future credit.</CardDescription></CardHeader><CardContent><DataTable heads={["Learner", "Service state", "Charged", "Adjustments", "Paid", "Balance", "Financial status"]}>{data.assignments.filter((row: any) => row.isActive).map((assignment: any) => <TableRow key={assignment.id}><TableCell className="font-medium">{assignment.firstName} {assignment.lastName}<div className="text-xs text-muted-foreground">{assignment.admissionNo}</div></TableCell><TableCell><StatusBadge value={assignment.serviceState}/></TableCell><TableCell>USD {money(assignment.charged)}</TableCell><TableCell>USD {money(assignment.adjustments)}</TableCell><TableCell>USD {money(assignment.paid)}</TableCell><TableCell className={Number(assignment.balance) > 0 ? "font-medium text-destructive" : Number(assignment.balance) < 0 ? "font-medium text-emerald-600" : ""}>USD {money(assignment.balance)}</TableCell><TableCell><StatusBadge value={assignment.financialStatus}/></TableCell></TableRow>)}</DataTable></CardContent></Card></TabsContent>

    <TabsContent value="plans"><MasterTable title="Payment plans" description="Approved plans keep eligible learners active while instalments remain current." button="Create payment plan" canAdd={can("transport.payment_plans.manage") || canManageLegacy} onAdd={() => open("paymentPlan")} heads={["Plan", "Learner", "Covered amount", "Instalment", "Frequency", "Start", "Status"]} rows={data.paymentPlans.map((plan: any) => <TableRow key={plan.id}><TableCell className="font-medium">{plan.planNumber}</TableCell><TableCell>{data.students.find((student: any) => student.id === plan.studentId)?.firstName || "—"} {data.students.find((student: any) => student.id === plan.studentId)?.lastName || ""}</TableCell><TableCell>USD {money(plan.coveredAmount)}</TableCell><TableCell>USD {money(plan.instalmentAmount)}</TableCell><TableCell>{titleCase(plan.frequency)}</TableCell><TableCell>{plan.startDate}</TableCell><TableCell><StatusBadge value={plan.status}/></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="refunds"><MasterTable title="Learner credits and refunds" description="Pause defaults to account credit; termination permits credit or approved external refund." button="Request refund / credit" canAdd={can("transport.refunds.request") || canManageLegacy} onAdd={() => open("refund")} heads={["Refund", "Learner", "Type", "Method", "Amount", "Effective", "Status", "Actions"]} rows={data.refunds.map((refund: any) => <TableRow key={refund.id}><TableCell className="font-medium">{refund.refundNumber}</TableCell><TableCell>{data.students.find((student: any) => student.id === refund.studentId)?.firstName || "—"} {data.students.find((student: any) => student.id === refund.studentId)?.lastName || ""}</TableCell><TableCell>{titleCase(refund.refundType)}</TableCell><TableCell>{titleCase(refund.method)}</TableCell><TableCell>USD {money(refund.amount)}</TableCell><TableCell>{refund.effectiveDate}</TableCell><TableCell><StatusBadge value={refund.status}/></TableCell><TableCell><div className="flex gap-1">{refund.status === "requested" && (can("transport.refunds.approve") || canManageLegacy) && <Button size="sm" onClick={() => mutate.mutate({ url: `/api/transport/refunds/${refund.id}/approve` })}>Approve</Button>}{refund.status === "approved" && refund.method !== "credit" && (can("transport.refunds.pay") || canManageLegacy) && <Button size="sm" variant="outline" onClick={() => open("payRefund", refund)}>Record payout</Button>}</div></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="cashups"><MasterTable title="Daily cash-up and reconciliation" description="Only reconciled payment allocations are claim-eligible when the setting is enabled." button="Prepare cash-up" canAdd={can("transport.cashups.prepare") || canManageLegacy} onAdd={() => open("cashup")} heads={["Cash-up", "Date", "Expected", "Actual", "Variance", "Status", "Actions"]} rows={data.cashups.map((cashup: any) => <TableRow key={cashup.id}><TableCell className="font-medium">{cashup.cashupNumber}</TableCell><TableCell>{cashup.cashupDate}</TableCell><TableCell>USD {money(Number(cashup.expectedCash) + Number(cashup.expectedNonCash))}</TableCell><TableCell>USD {money(Number(cashup.actualCash) + Number(cashup.actualNonCash))}</TableCell><TableCell className={Number(cashup.variance) !== 0 ? "font-medium text-destructive" : ""}>USD {money(cashup.variance)}</TableCell><TableCell><StatusBadge value={cashup.status}/></TableCell><TableCell><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => void openTransportPdf(`/api/transport/cashups/${cashup.id}/print`)}><FileText className="mr-1 h-3.5 w-3.5"/>View PDF</Button>{cashup.status === "draft" && <Button size="sm" variant="outline" onClick={() => mutate.mutate({ url: `/api/transport/cashups/${cashup.id}/submit` })}>Submit</Button>}{cashup.status === "submitted" && (can("transport.cashups.verify") || canManageLegacy) && <Button size="sm" onClick={() => mutate.mutate({ url: `/api/transport/cashups/${cashup.id}/verify` })}>Verify</Button>}</div></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="charges"><Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Monthly charges</CardTitle><CardDescription>Charges use service effective dates, month length and saved policy snapshots.</CardDescription></div>{(can("transport.charges.generate") || canManageLegacy) && <Button onClick={() => open("charge")}><Plus className="mr-2 h-4 w-4"/>Generate monthly charges</Button>}</CardHeader><CardContent><Alert><ShieldCheck className="h-4 w-4"/><AlertTitle>Monthly billing control</AlertTitle><AlertDescription>Joining dates are inclusive service days. Exit dates are the first non-service day. Existing monthly base charges are never silently overwritten.</AlertDescription></Alert><div className="mt-4 text-sm text-muted-foreground">Current assignment totals are shown under Learner Accounts. Detailed charge records remain protected by the monthly period and audit trail.</div></CardContent></Card></TabsContent>
  </Tabs>;
}

function SettlementsWorkspace({ data, tab, setTab, open, can, canManageLegacy, mutate, openTransportPdf }: any) {
  const [statementPeriod, setStatementPeriod] = useState(() => `${new Date().getFullYear()}-${String(currentMonth()).padStart(2, "0")}`);
  const [statementYear, statementMonth] = statementPeriod.split("-").map(Number);
  const statementClaims = data.claims.filter((claim: any) => Number(claim.serviceYear) === statementYear && Number(claim.serviceMonth) === statementMonth);
  return <Tabs value={tab} onValueChange={setTab}>
    <div className="overflow-x-auto pb-1"><TabsList className="w-max justify-start"><TabsTrigger value="claims">Claims</TabsTrigger><TabsTrigger value="payouts">Payout Slips</TabsTrigger><TabsTrigger value="subscriptions">Subscriptions</TabsTrigger><TabsTrigger value="penalties">Penalties</TabsTrigger><TabsTrigger value="advances">Advances</TabsTrigger><TabsTrigger value="statement">Monthly Statement</TabsTrigger></TabsList></div>

    <TabsContent value="claims"><MasterTable title="Vehicle claims" description="Claims use reconciled, unclaimed payment allocations attributable to the selected vehicle and service month." button="Generate claim" canAdd={can("transport.claims.generate") || canManageLegacy} onAdd={() => open("claim")} heads={["Claim", "Vehicle", "Service month", "Current", "Prior-period", "Gross", "Deductions", "Net", "Status", "Actions"]} rows={data.claims.map((claim: any) => <TableRow key={claim.id}><TableCell className="font-medium">{claim.claimNumber}</TableCell><TableCell>{data.vehicles.find((vehicle: any) => vehicle.id === claim.vehicleId)?.registrationNumber || "—"}</TableCell><TableCell>{claim.serviceYear}-{String(claim.serviceMonth).padStart(2, "0")}</TableCell><TableCell>USD {money(claim.currentPeriodAmount)}</TableCell><TableCell>USD {money(claim.priorPeriodAmount)}</TableCell><TableCell>USD {money(claim.grossAmount)}</TableCell><TableCell>USD {money(claim.deductionAmount)}</TableCell><TableCell className="font-semibold">USD {money(claim.netAmount)}</TableCell><TableCell><StatusBadge value={claim.status}/></TableCell><TableCell><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => void openTransportPdf(`/api/transport/claims/${claim.id}/print`)}><FileText className="mr-1 h-3.5 w-3.5"/>View PDF</Button>{claim.status === "draft" && <Button size="sm" variant="outline" onClick={() => mutate.mutate({ url: `/api/transport/claims/${claim.id}/status`, body: { status: "submitted" } })}>Submit</Button>}{claim.status === "submitted" && (can("transport.claims.verify") || canManageLegacy) && <Button size="sm" variant="outline" onClick={() => mutate.mutate({ url: `/api/transport/claims/${claim.id}/status`, body: { status: "verified" } })}>Verify</Button>}{claim.status === "verified" && (can("transport.claims.approve") || canManageLegacy) && <Button size="sm" onClick={() => mutate.mutate({ url: `/api/transport/claims/${claim.id}/status`, body: { status: "approved" } })}>Approve</Button>}{claim.status === "approved" && !data.payouts.some((payout: any) => payout.claimId === claim.id) && (can("transport.payouts.generate") || canManageLegacy) && <Button size="sm" onClick={() => mutate.mutate({ url: `/api/transport/claims/${claim.id}/payout` })}>Generate payout</Button>}</div></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="payouts"><MasterTable title="Payout slips" description="Gross, deductions and net paid are fixed snapshots. Net payout never becomes negative." heads={["Payout", "Claim", "Gross", "Deductions", "Net", "Paid", "Status", "Actions"]} rows={data.payouts.map((payout: any) => <TableRow key={payout.id}><TableCell className="font-medium">{payout.payoutNumber}</TableCell><TableCell>{data.claims.find((claim: any) => claim.id === payout.claimId)?.claimNumber || "—"}</TableCell><TableCell>USD {money(payout.grossAmount)}</TableCell><TableCell>USD {money(payout.deductionAmount)}</TableCell><TableCell className="font-semibold">USD {money(payout.netAmount)}</TableCell><TableCell>USD {money(payout.amountPaid)}</TableCell><TableCell><StatusBadge value={payout.status}/></TableCell><TableCell><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => void openTransportPdf(`/api/transport/payouts/${payout.id}/print`)}><FileText className="mr-1 h-3.5 w-3.5"/>View PDF</Button>{payout.status !== "paid" && (can("transport.payouts.pay") || canManageLegacy) && <Button size="sm" onClick={() => open("payPayout", payout)}>Record payment</Button>}</div></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="subscriptions"><MasterTable title="Subscription rules" description="Effective-dated fixed or percentage deductions, with optional vehicle overrides." button="Add subscription rule" canAdd={can("transport.settings.manage") || canManageLegacy} onAdd={() => open("subscription")} heads={["Applies to", "Type", "Value", "Minimum", "Maximum", "Effective", "Status"]} rows={data.subscriptions.map((rule: any) => <TableRow key={rule.id}><TableCell>{rule.vehicleId ? data.vehicles.find((vehicle: any) => vehicle.id === rule.vehicleId)?.registrationNumber : "All vehicles"}</TableCell><TableCell>{titleCase(rule.ruleType)}</TableCell><TableCell>{rule.ruleType === "fixed" ? `USD ${money(rule.value)}` : `${money(rule.value)}%`}</TableCell><TableCell>{rule.minimumAmount == null ? "—" : `USD ${money(rule.minimumAmount)}`}</TableCell><TableCell>{rule.maximumAmount == null ? "—" : `USD ${money(rule.maximumAmount)}`}</TableCell><TableCell>{rule.effectiveFrom}{rule.effectiveTo ? ` – ${rule.effectiveTo}` : ""}</TableCell><TableCell><StatusBadge value={rule.isActive ? "active" : "retired"}/></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="penalties"><MasterTable title="Vehicle penalties" description="Configurable categories become controlled deductions on the relevant school payout." button="Add penalty" canAdd={can("transport.penalties.manage") || canManageLegacy} onAdd={() => open("penalty")} heads={["Penalty", "Vehicle", "Category", "Incident date", "Period", "Amount", "Status", "Reason"]} rows={data.penalties.map((penalty: any) => <TableRow key={penalty.id}><TableCell className="font-medium">{penalty.penaltyNumber}</TableCell><TableCell>{data.vehicles.find((vehicle: any) => vehicle.id === penalty.vehicleId)?.registrationNumber || "—"}</TableCell><TableCell>{titleCase(penalty.category)}</TableCell><TableCell>{penalty.incidentDate}</TableCell><TableCell>{penalty.effectiveYear}-{String(penalty.effectiveMonth).padStart(2, "0")}</TableCell><TableCell>USD {money(penalty.amount)}</TableCell><TableCell><StatusBadge value={penalty.status}/></TableCell><TableCell className="max-w-xs whitespace-normal">{penalty.reason}</TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="advances"><MasterTable title="Vehicle advances" description="Recovery rules protect a configurable owner take-home and never create a negative payout." button="Request advance" canAdd={can("transport.advances.request") || canManageLegacy} onAdd={() => open("advance")} heads={["Advance", "Vehicle", "Original", "Outstanding", "Recovery", "Starts", "Status", "Purpose", "Actions"]} rows={data.advances.map((advance: any) => <TableRow key={advance.id}><TableCell className="font-medium">{advance.advanceNumber}</TableCell><TableCell>{data.vehicles.find((vehicle: any) => vehicle.id === advance.vehicleId)?.registrationNumber || "—"}</TableCell><TableCell>USD {money(advance.amount)}</TableCell><TableCell>USD {money(advance.outstandingAmount)}</TableCell><TableCell>{titleCase(advance.recoveryMethod)} · {advance.recoveryMethod === "percentage" ? `${money(advance.recoveryValue)}%` : `USD ${money(advance.recoveryValue)}`}</TableCell><TableCell>{advance.recoveryStartYear}-{String(advance.recoveryStartMonth).padStart(2, "0")}</TableCell><TableCell><StatusBadge value={advance.status}/></TableCell><TableCell className="max-w-xs whitespace-normal">{advance.purpose}</TableCell><TableCell><div className="flex flex-wrap gap-1">{advance.status === "requested" && (can("transport.advances.approve") || canManageLegacy) && <Button size="sm" onClick={() => mutate.mutate({ url: `/api/transport/advances/${advance.id}/approve` })}>Approve</Button>}{advance.status === "approved" && (can("transport.advances.disburse") || canManageLegacy) && <Button size="sm" onClick={() => open("disburseAdvance", advance)}>Disburse</Button>}</div></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="statement"><Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Monthly Transport Settlement Statement</CardTitle><CardDescription>Consolidated school-level summary of vehicle claims and payouts.</CardDescription></div><div className="flex items-end gap-2"><Field label="Service month"><Input type="month" value={statementPeriod} onChange={(event) => setStatementPeriod(event.target.value)}/></Field><Button variant="outline" onClick={() => void openTransportPdf(`/api/transport/settlements/statement/print?year=${statementYear}&month=${statementMonth}`)}><FileText className="mr-2 h-4 w-4"/>View PDF</Button></div></div></CardHeader><CardContent><DataTable heads={["Vehicle", "Claim", "Service month", "Gross", "Deductions", "Net", "Paid", "Outstanding", "Status"]}>{statementClaims.map((claim: any) => {
      const payout = data.payouts.find((row: any) => row.claimId === claim.id);
      return <TableRow key={claim.id}><TableCell>{data.vehicles.find((vehicle: any) => vehicle.id === claim.vehicleId)?.registrationNumber || "—"}</TableCell><TableCell>{claim.claimNumber}</TableCell><TableCell>{claim.serviceYear}-{String(claim.serviceMonth).padStart(2, "0")}</TableCell><TableCell>USD {money(claim.grossAmount)}</TableCell><TableCell>USD {money(claim.deductionAmount)}</TableCell><TableCell>USD {money(claim.netAmount)}</TableCell><TableCell>USD {money(payout?.amountPaid)}</TableCell><TableCell>USD {money(Number(claim.netAmount) - Number(payout?.amountPaid || 0))}</TableCell><TableCell><StatusBadge value={payout?.status || claim.status}/></TableCell></TableRow>;
    })}</DataTable></CardContent></Card></TabsContent>
  </Tabs>;
}

function ReportsAuditWorkspace({ data, reportData, reportFrom, reportTo, setReportFrom, setReportTo, refreshReport, loading, openTransportPdf }: any) {
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>Periodic totals</CardTitle><CardDescription>Daily, weekly, fortnightly, monthly and custom reporting are represented by explicit date ranges.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap items-end gap-3"><Field label="From"><Input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)}/></Field><Field label="To"><Input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)}/></Field><Button onClick={() => refreshReport()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4"/>Apply period</Button><Button variant="outline" onClick={() => void openTransportPdf(`/api/transport/reports/summary/print?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`)}><FileText className="mr-2 h-4 w-4"/>View PDF</Button><PresetPeriods onApply={(from: string, to: string) => { setReportFrom(from); setReportTo(to); }}/></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[["Charged", reportData?.summary?.charged], ["Received", reportData?.summary?.received], ["Refunds", reportData?.summary?.refunds], ["Claim gross", reportData?.summary?.claim_gross], ["Payout net", reportData?.summary?.payout_net]].map(([label, value]) => <Card key={label as string}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-bold">USD {money(value)}</div></CardContent></Card>)}</div>
      <DataTable heads={["Payment method", "Transactions", "Amount"]}>{(reportData?.byMethod || []).map((row: any) => <TableRow key={row.method}><TableCell>{titleCase(row.method)}</TableCell><TableCell>{row.count}</TableCell><TableCell>USD {money(row.amount)}</TableCell></TableRow>)}</DataTable>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Transport audit trail</CardTitle><CardDescription>Detailed Transport-specific events supplement the portal-wide activity log.</CardDescription></CardHeader><CardContent><DataTable heads={["Date & time", "Entity", "Action", "Reason", "User", "Record"]}>{data.audits.map((audit: any) => <TableRow key={audit.id}><TableCell>{new Date(audit.createdAt).toLocaleString()}</TableCell><TableCell>{titleCase(audit.entityType)}</TableCell><TableCell><StatusBadge value={audit.action}/></TableCell><TableCell className="max-w-xs whitespace-normal">{audit.reason || "—"}</TableCell><TableCell>{audit.userId || "System"}</TableCell><TableCell>{audit.entityId || "—"}</TableCell></TableRow>)}</DataTable></CardContent></Card>
  </div>;
}

function SettingsWorkspace({ data, saving, onSave }: any) {
  const [form, setForm] = useState<any>(() => ({ ...data.settings }));
  useEffect(() => setForm({ ...data.settings }), [data.settings]);
  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  return <Card><CardHeader><CardTitle>Transport settings</CardTitle><CardDescription>School-specific, effective operational policies. Currency remains USD for this release.</CardDescription></CardHeader><CardContent className="space-y-6">
    <SettingsSection title="Responsibility and location planning">
      <EntitySelect label="Transport Manager" items={data.staff} value={form.transportManagerStaffId} onChange={(value: any) => set("transportManagerStaffId", idValue(value))} itemText={(row: any) => `${row.firstName} ${row.lastName} (${row.position || "Staff"})`} optional/>
      <NumberField label="Suggested stop grouping distance (metres)" value={form.stopGroupingDistanceMeters} onChange={(value: any) => set("stopGroupingDistanceMeters", value)} min={1}/>
      <NumberField label="Default checkpoint radius (metres)" value={form.defaultCheckpointRadiusMeters} onChange={(value: any) => set("defaultCheckpointRadiusMeters", value)} min={1}/>
      <Field label="Map provider"><Input value="OpenStreetMap (testing)" disabled/></Field>
    </SettingsSection>
    <SettingsSection title="Pricing and prorating">
      <NumberField label="Inbound-only percentage" value={form.inboundOneWayPercent} onChange={(value: any) => set("inboundOneWayPercent", value)} min={0} max={100} step="0.01"/>
      <NumberField label="Outbound-only percentage" value={form.outboundOneWayPercent} onChange={(value: any) => set("outboundOneWayPercent", value)} min={0} max={100} step="0.01"/>
      <NumberField label="Full charge through joining day" value={form.joiningFullChargeThroughDay} onChange={(value: any) => set("joiningFullChargeThroughDay", value)} min={0} max={31}/>
      <NumberField label="No-refund remaining-day threshold" value={form.refundNoCreditRemainingDays} onChange={(value: any) => set("refundNoCreditRemainingDays", value)} min={0} max={31}/>
    </SettingsSection>
    <SettingsSection title="Pending seats, arrears and payment plans">
      <BooleanField label="Reserve seats for pending registrations" value={form.pendingSeatReservationEnabled} onChange={(value: any) => set("pendingSeatReservationEnabled", value)}/>
      <NumberField label="Pending seat reservation days" value={form.pendingSeatReservationDays} onChange={(value: any) => set("pendingSeatReservationDays", value)} min={0}/>
      <NumberField label="Overdue warning after days" value={form.overdueWarningDays} onChange={(value: any) => set("overdueWarningDays", value)} min={0}/>
      <NumberField label="Suspension eligibility after days" value={form.suspensionEligibilityDays} onChange={(value: any) => set("suspensionEligibilityDays", value)} min={0}/>
      <NumberField label="Required suspension notice days" value={form.suspensionNoticeDays} onChange={(value: any) => set("suspensionNoticeDays", value)} min={0}/>
      <NumberField label="Minimum suspension balance (USD)" value={form.minimumSuspensionBalance} onChange={(value: any) => set("minimumSuspensionBalance", value)} min={0} step="0.01"/>
      <NumberField label="Missed instalments before plan default" value={form.paymentPlanMissedInstalmentsToDefault} onChange={(value: any) => set("paymentPlanMissedInstalmentsToDefault", value)} min={1}/>
    </SettingsSection>
    <SettingsSection title="Receipts, reconciliation and reporting">
      <Field label="Currency"><Input value="USD" disabled/></Field>
      <Field label="Receipt prefix"><Input value={form.receiptPrefix || ""} onChange={(event) => set("receiptPrefix", event.target.value.toUpperCase())}/></Field>
      <NumberField label="Receipt sequence length" value={form.receiptSequenceLength} onChange={(value: any) => set("receiptSequenceLength", value)} min={3} max={12}/>
      <BooleanField label="Reset receipt sequence yearly" value={form.receiptResetYearly} onChange={(value: any) => set("receiptResetYearly", value)}/>
      <BooleanField label="Print both copies on one page" value={form.printCopiesOnOnePage} onChange={(value: any) => set("printCopiesOnOnePage", value)}/>
      <BooleanField label="Require reconciliation before claim" value={form.requireCashupForClaim} onChange={(value: any) => set("requireCashupForClaim", value)}/>
      <Field label="Fortnight anchor date"><Input type="date" value={form.fortnightAnchorDate || ""} onChange={(event) => set("fortnightAnchorDate", event.target.value || null)}/></Field>
      <Choice label="Reporting week starts on" value={form.reportWeekStartsOn ?? 1} onChange={(value: any) => set("reportWeekStartsOn", Number(value))} items={[[1,"Monday"],[2,"Tuesday"],[3,"Wednesday"],[4,"Thursday"],[5,"Friday"],[6,"Saturday"],[0,"Sunday"]]}/>
      <Field label="Deduction priority"><Input value={Array.isArray(form.deductionPriority) ? form.deductionPriority.join(", ") : (form.deductionPriority || "")} onChange={(event) => set("deductionPriority", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="refund, subscription, penalty, advance, other"/><p className="text-xs text-muted-foreground">First item is deducted first.</p></Field>
      <Field label="Receipt footer"><Textarea value={form.receiptFooter || ""} onChange={(event) => set("receiptFooter", event.target.value)}/></Field>
    </SettingsSection>
    <div className="flex justify-end"><Button disabled={saving} onClick={() => onSave(form)}><Settings className="mr-2 h-4 w-4"/>{saving ? "Saving…" : "Save Transport Settings"}</Button></div>
  </CardContent></Card>;
}

function TransportDialog({ state, data, saving, close, submit }: { state: DialogState; data: Bootstrap; saving: boolean; close: () => void; submit: (method: string, url: string, body: any) => void }) {
  if (!state) return null;
  if (state.type === "path") return <PathSetupDialog data={data} saving={saving} close={close} submit={submit}/>;
  if (["servicePoint", "assignment"].includes(state.type)) return <LearnerRegistrationDialog type={state.type} record={state.record} data={data} saving={saving} close={close} submit={submit}/>;

  const initial = buildInitialForm(state.type, state.record, data);
  const [form, setForm] = useState<any>(initial);
  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const editing = Boolean(state.record && ["route", "vehicle", "driver", "owner"].includes(state.type));
  const config = dialogConfig(state.type, state.record);

  const doSubmit = () => {
    const body: any = { ...form };
    for (const key of Object.keys(body)) if (body[key] === "") delete body[key];
    if (state.type === "vehicle" && editing) { body.effectiveDate ||= today(); body.changeReason ||= "Vehicle record updated"; }
    submit(editing ? "PUT" : "POST", editing ? `${config.url}/${state.record.id}` : config.url, body);
  };

  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{config.title}</DialogTitle><DialogDescription>{config.description}</DialogDescription></DialogHeader>
    <div className="grid gap-4 md:grid-cols-2">{renderDialogFields(state.type, form, set, data, state.record)}</div>
    <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={saving} onClick={doSubmit}>{saving ? "Saving…" : config.action}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function LearnerRegistrationDialog({ type, record, data, saving, close, submit }: any) {
  const [form, setForm] = useState<any>(() => buildInitialForm(type, record, data));
  const [sameLocation, setSameLocation] = useState(true);
  const [servicePointStep, setServicePointStep] = useState<"pickup" | "dropoff">("pickup");
  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const selectedStudentPoints = data.servicePoints.filter((point: any) => Number(point.studentId) === Number(form.studentId) && point.isActive);
  const selectedRoute = data.routes.find((route: any) => Number(route.id) === Number(form.routeId));

  useEffect(() => {
    if (!selectedRoute || form.baseMonthlyFee) return;
    set("baseMonthlyFee", selectedRoute.defaultFee);
    const percent = form.serviceType === "pickup" ? Number(data.settings.inboundOneWayPercent) : form.serviceType === "dropoff" ? Number(data.settings.outboundOneWayPercent) : 100;
    set("agreedFee", (Number(selectedRoute.defaultFee || 0) * percent / 100).toFixed(2));
  }, [selectedRoute, form.serviceType]);

  const saveServicePoint = (pointType: string, coordinates: { latitude: number; longitude: number }, extra: any) => {
    const payload = { studentId: Number(form.studentId), pointType, name: extra.name || `${pointType === "dropoff" ? "Drop-off" : "Pickup"} point`, latitude: coordinates.latitude, longitude: coordinates.longitude, address: extra.address || null, landmark: extra.landmark || null, instructions: extra.instructions || null, privacyClass: extra.privacyClass || "private_household", effectiveFrom: form.startDate || today(), isTemporary: false };
    fetchJson("POST", "/api/transport/service-points", payload).then(async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/transport/bootstrap"] });
      if (pointType === "pickup" || pointType === "both") set("pickupServicePointId", created.id);
      if (pointType === "dropoff" || pointType === "both") set("dropoffServicePointId", created.id);
    });
  };

  const submitAssignment = () => {
    const body = { ...form, studentId: Number(form.studentId), routeId: Number(form.routeId), vehicleId: idValue(form.vehicleId), outboundVehicleId: idValue(form.outboundVehicleId) || idValue(form.vehicleId), driverId: idValue(form.driverId), inboundPathId: idValue(form.inboundPathId), outboundPathId: idValue(form.outboundPathId), pickupServicePointId: idValue(form.pickupServicePointId), dropoffServicePointId: idValue(form.dropoffServicePointId) || idValue(form.pickupServicePointId), baseMonthlyFee: Number(form.baseMonthlyFee || 0), agreedFee: Number(form.agreedFee || 0) };
    submit("POST", "/api/transport/assignments", body);
  };

  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>Register learner for transport</DialogTitle><DialogDescription>Registration and path planning may proceed while payment remains pending.</DialogDescription></DialogHeader>
    <div className="grid gap-4 md:grid-cols-2">
      <EntitySelect label="Learner" items={data.students.filter((student: any) => !data.assignments.some((assignment: any) => assignment.studentId === student.id && assignment.isActive))} value={form.studentId} onChange={(value: any) => set("studentId", idValue(value))} itemText={(student: any) => `${student.firstName} ${student.lastName} (${student.admissionNo})`}/>
      <EntitySelect label="Route" items={data.routes.filter((route: any) => route.isActive)} value={form.routeId} onChange={(value: any) => { set("routeId", idValue(value)); const route = data.routes.find((row: any) => row.id === idValue(value)); if (route) { set("baseMonthlyFee", route.defaultFee); set("agreedFee", route.defaultFee); } }} itemText={(route: any) => `${route.code} · ${route.name}`}/>
      <Choice label="Service type" value={form.serviceType} onChange={(value: any) => set("serviceType", value)} items={[["both", "Two-way"], ["pickup", `Inbound only (${money(data.settings.inboundOneWayPercent)}%)`], ["dropoff", `Outbound only (${money(data.settings.outboundOneWayPercent)}%)`]]}/>
      <Field label="Effective service start date"><Input type="date" value={form.startDate} onChange={(event) => set("startDate", event.target.value)}/></Field>
      <NumberField label="Full two-way monthly fee (USD)" value={form.baseMonthlyFee} onChange={(value: any) => set("baseMonthlyFee", value)} min={0} step="0.01"/>
      <NumberField label="Agreed monthly fee (USD)" value={form.agreedFee} onChange={(value: any) => set("agreedFee", value)} min={0} step="0.01"/>
      <EntitySelect label="Inbound vehicle" items={data.vehicles.filter((vehicle: any) => vehicle.isActive)} value={form.vehicleId} onChange={(value: any) => set("vehicleId", idValue(value))} itemText={(vehicle: any) => `${vehicle.registrationNumber} · ${vehicle.capacity} seats`} optional/>
      {form.serviceType === "both" && <EntitySelect label="Outbound vehicle" items={data.vehicles.filter((vehicle: any) => vehicle.isActive)} value={form.outboundVehicleId} onChange={(value: any) => set("outboundVehicleId", idValue(value))} itemText={(vehicle: any) => `${vehicle.registrationNumber} · ${vehicle.capacity} seats`} optional/>}
      <EntitySelect label="Inbound path" items={data.paths.filter((path: any) => path.status === "active" && path.direction === "pickup" && (!form.vehicleId || path.vehicleId === Number(form.vehicleId)))} value={form.inboundPathId} onChange={(value: any) => set("inboundPathId", idValue(value))} itemText={(path: any) => `${path.name} v${path.versionNumber}`} optional/>
      {(form.serviceType === "both" || form.serviceType === "dropoff") && <EntitySelect label="Outbound path" items={data.paths.filter((path: any) => path.status === "active" && path.direction === "dropoff" && (!(form.outboundVehicleId || form.vehicleId) || path.vehicleId === Number(form.outboundVehicleId || form.vehicleId)))} value={form.outboundPathId} onChange={(value: any) => set("outboundPathId", idValue(value))} itemText={(path: any) => `${path.name} v${path.versionNumber}`} optional/>}
      <div className="md:col-span-2 rounded-md border p-3"><div className="flex items-center justify-between"><div><div className="font-medium">Pickup and drop-off locations</div><div className="text-xs text-muted-foreground">GPS coordinates may be captured by map click or manual entry.</div></div><div className="flex items-center gap-2"><Checkbox checked={sameLocation} onCheckedChange={(checked) => setSameLocation(Boolean(checked))}/><Label>Use same location</Label></div></div></div>
      {form.studentId && <>
        <EntitySelect label="Saved pickup point" items={selectedStudentPoints.filter((point: any) => ["pickup", "both"].includes(point.pointType))} value={form.pickupServicePointId} onChange={(value: any) => { set("pickupServicePointId", idValue(value)); if (sameLocation) set("dropoffServicePointId", idValue(value)); }} itemText={(point: any) => point.name} optional/>
        {!sameLocation && <EntitySelect label="Saved drop-off point" items={selectedStudentPoints.filter((point: any) => ["dropoff", "both"].includes(point.pointType))} value={form.dropoffServicePointId} onChange={(value: any) => set("dropoffServicePointId", idValue(value))} itemText={(point: any) => point.name} optional/>}
        <div className={classNames("rounded-md border p-3", sameLocation ? "md:col-span-2" : "")}><MapPointForm title={sameLocation ? "Create pickup/drop-off point" : "Create pickup point"} onSave={(coords, extra) => saveServicePoint(sameLocation ? "both" : "pickup", coords, extra)}/></div>
        {!sameLocation && <div className="rounded-md border p-3"><MapPointForm title="Create drop-off point" onSave={(coords, extra) => saveServicePoint("dropoff", coords, extra)}/></div>}
      </>}
      <Choice label="Initial service state" value={form.serviceState} onChange={(value: any) => set("serviceState", value)} items={[["pending_start", "Pending start / payment"], ["active", "Approved to start"], ["active_payment_plan", "Active on payment plan"]]}/>
      <Choice label="Planning status" value={form.planningStatus} onChange={(value: any) => set("planningStatus", value)} items={[["pending_path_assignment", "Pending path assignment"], ["provisionally_assigned", "Provisionally assigned"], ["assigned_to_path", "Assigned to path"], ["path_confirmed", "Path confirmed"]]}/>
      <Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field>
    </div>
    <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={saving || !form.studentId || !form.routeId || !form.pickupServicePointId} onClick={submitAssignment}>{saving ? "Saving…" : "Register learner"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function PathSetupDialog({ data, saving, close, submit }: any) {
  const [form, setForm] = useState<any>({ routeId: null, vehicleId: null, direction: "pickup", name: "", effectiveFrom: today(), estimatedDistanceKm: "", estimatedDurationMinutes: "", notes: "" });
  const [nodes, setNodes] = useState<PathNodeDraft[]>([]);
  const [nodeType, setNodeType] = useState<PathNodeDraft["nodeType"]>("learner_stop");
  const [nodeName, setNodeName] = useState("");
  const [selectedServicePointIds, setSelectedServicePointIds] = useState<number[]>([]);
  const [routedGeometry, setRoutedGeometry] = useState<Array<[number, number]>>([]);
  const [routingStatus, setRoutingStatus] = useState<"idle" | "routing" | "road" | "fallback">("idle");
  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (nodes.length < 2) { setRoutedGeometry([]); setRoutingStatus("idle"); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setRoutingStatus("routing");
      try {
        const response = await apiRequest("POST", "/api/transport/maps/route", { coordinates: nodes.map((node) => ({ latitude: node.latitude, longitude: node.longitude })) });
        const payload = await response.json();
        if (cancelled) return;
        const geometry = (payload.geometry?.coordinates || []).map(([longitude, latitude]: [number, number]) => [latitude, longitude] as [number, number]);
        setRoutedGeometry(geometry);
        setForm((current: any) => ({ ...current, estimatedDistanceKm: payload.distanceKm, estimatedDurationMinutes: payload.durationMinutes }));
        setRoutingStatus("road");
      } catch {
        if (!cancelled) { setRoutedGeometry([]); setRoutingStatus("fallback"); }
      }
    }, 600);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [nodes]);

  const addNodeAt = (latitude: number, longitude: number) => {
    const next: PathNodeDraft = { key: `${Date.now()}-${Math.random()}`, nodeType, name: nodeName || titleCase(nodeType), latitude, longitude, stopOrder: nodes.length + 1, checkpointRadiusMeters: nodeType === "checkpoint" ? Number(data.settings.defaultCheckpointRadiusMeters || 50) : null, learnerLinks: [] };
    setNodes((current) => [...current, next]); setNodeName("");
  };

  const addLearnerPoints = () => {
    const points = data.servicePoints.filter((point: any) => selectedServicePointIds.includes(point.id));
    const threshold = Number(data.settings.stopGroupingDistanceMeters || 30);
    const groups: any[][] = [];
    for (const point of points) {
      const nearby = groups.find((group) => haversineMeters(Number(group[0].latitude), Number(group[0].longitude), Number(point.latitude), Number(point.longitude)) <= threshold);
      if (nearby) nearby.push(point); else groups.push([point]);
    }
    const created = groups.map((group, index) => {
      const latitude = group.reduce((sum, point) => sum + Number(point.latitude), 0) / group.length;
      const longitude = group.reduce((sum, point) => sum + Number(point.longitude), 0) / group.length;
      const links = group.map((point) => {
        const assignment = data.assignments.find((row: any) => row.studentId === point.studentId && row.isActive);
        return assignment ? { assignmentId: assignment.id, servicePointId: point.id, boardsHere: form.direction === "pickup", alightsHere: form.direction === "dropoff", effectiveFrom: form.effectiveFrom } : null;
      }).filter(Boolean);
      return { key: `sp-${Date.now()}-${index}`, nodeType: "learner_stop" as const, name: group.length > 1 ? `Shared stop (${group.length} learners)` : group[0].name, latitude, longitude, stopOrder: nodes.length + index + 1, learnerLinks: links };
    });
    setNodes((current) => [...current, ...created]); setSelectedServicePointIds([]);
  };

  const move = (index: number, direction: -1 | 1) => {
    const next = [...nodes]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setNodes(next.map((node, order) => ({ ...node, stopOrder: order + 1 })));
  };

  const save = () => submit("POST", "/api/transport/paths", { ...form, routeId: Number(form.routeId), vehicleId: Number(form.vehicleId), estimatedDistanceKm: form.estimatedDistanceKm === "" ? null : Number(form.estimatedDistanceKm), estimatedDurationMinutes: form.estimatedDurationMinutes === "" ? null : Number(form.estimatedDurationMinutes), geometry: routedGeometry.length ? routedGeometry : nodes.map((node) => [node.latitude, node.longitude]), nodes: nodes.map(({ key, ...node }) => node) });

  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[95vh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>Vehicle Path Setup</DialogTitle><DialogDescription>Create a new effective-dated path version from learner service points, checkpoints, start and destination nodes. GPS verification is intentionally deferred.</DialogDescription></DialogHeader>
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <EntitySelect label="Route" items={data.routes.filter((route: any) => route.isActive)} value={form.routeId} onChange={(value: any) => set("routeId", idValue(value))} itemText={(route: any) => `${route.code} · ${route.name}`}/>
        <EntitySelect label="Vehicle" items={data.vehicles.filter((vehicle: any) => vehicle.isActive)} value={form.vehicleId} onChange={(value: any) => set("vehicleId", idValue(value))} itemText={(vehicle: any) => `${vehicle.registrationNumber} · ${vehicle.capacity} seats`}/>
        <Choice label="Direction" value={form.direction} onChange={(value: any) => set("direction", value)} items={[["pickup", "Inbound / pickup"], ["dropoff", "Outbound / drop-off"]]}/>
        <Field label="Path name"><Input value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="e.g. Waterfalls Morning Path"/></Field>
        <Field label="Effective from"><Input type="date" value={form.effectiveFrom} onChange={(event) => set("effectiveFrom", event.target.value)}/></Field>
        <div className="rounded-md border p-3 space-y-3"><div className="font-medium">Add map node</div><Choice label="Node type" value={nodeType} onChange={setNodeType} items={[["start", "Starting point"], ["learner_stop", "Learner stop"], ["checkpoint", "Mandatory checkpoint"], ["destination", "Destination / end"]]}/><Field label="Node name"><Input value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="Click the map after naming"/></Field><p className="text-xs text-muted-foreground">The next map click adds this node. Checkpoints force the plotted path through their coordinates.</p></div>
        <div className="rounded-md border p-3 space-y-3"><div className="font-medium">Add learner service points</div><div className="max-h-44 space-y-2 overflow-y-auto">{data.servicePoints.filter((point: any) => point.isActive && data.assignments.some((assignment: any) => assignment.studentId === point.studentId && assignment.isActive)).map((point: any) => { const student = data.students.find((row: any) => row.id === point.studentId); return <label key={point.id} className="flex items-start gap-2 text-sm"><Checkbox checked={selectedServicePointIds.includes(point.id)} onCheckedChange={(checked) => setSelectedServicePointIds((current) => checked ? [...current, point.id] : current.filter((id) => id !== point.id))}/><span>{point.name}<span className="block text-xs text-muted-foreground">{student ? `${student.firstName} ${student.lastName}` : "Learner"}</span></span></label>; })}</div><Button type="button" variant="outline" className="w-full" disabled={!selectedServicePointIds.length} onClick={addLearnerPoints}>Group and add selected points</Button><p className="text-xs text-muted-foreground">Points within {data.settings.stopGroupingDistanceMeters}m are suggested as one stop. Review the grouped marker and order before saving.</p></div>
      </div>
      <div className="space-y-4">
        <LeafletMap nodes={nodes} routedGeometry={routedGeometry} onMapClick={addNodeAt}/>
        <div className="text-xs text-muted-foreground">{routingStatus === "routing" ? "Plotting the road route…" : routingStatus === "road" ? "Road route plotted through the selected nodes using the free test routing service." : routingStatus === "fallback" ? "Road routing is unavailable; showing a straight-line fallback. The saved stop order is unchanged." : "Add at least two nodes to plot the path."}</div>
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Ordered path nodes</CardTitle></CardHeader><CardContent><div className="space-y-2">{nodes.length === 0 && <p className="text-sm text-muted-foreground">Add at least a start and destination node.</p>}{nodes.map((node, index) => <div key={node.key} className="flex items-center gap-2 rounded-md border p-2"><div className="w-7 text-center text-xs font-semibold">{index + 1}</div><Badge variant="outline">{titleCase(node.nodeType)}</Badge><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{node.name}</div><div className="text-xs text-muted-foreground">{node.latitude.toFixed(6)}, {node.longitude.toFixed(6)}{node.learnerLinks?.length ? ` · ${node.learnerLinks.length} learner(s)` : ""}</div></div><Button size="icon" variant="ghost" onClick={() => move(index, -1)} disabled={index === 0}><ArrowUp className="h-4 w-4"/></Button><Button size="icon" variant="ghost" onClick={() => move(index, 1)} disabled={index === nodes.length - 1}><ArrowDown className="h-4 w-4"/></Button><Button size="icon" variant="ghost" onClick={() => setNodes((current) => current.filter((item) => item.key !== node.key).map((item, order) => ({ ...item, stopOrder: order + 1 })))}><XCircle className="h-4 w-4"/></Button></div>)}</div></CardContent></Card>
        <div className="grid gap-4 md:grid-cols-3"><NumberField label="Estimated distance (km)" value={form.estimatedDistanceKm} onChange={(value: any) => set("estimatedDistanceKm", value)} min={0} step="0.01"/><NumberField label="Estimated duration (minutes)" value={form.estimatedDurationMinutes} onChange={(value: any) => set("estimatedDurationMinutes", value)} min={0}/><Field label="Notes"><Input value={form.notes} onChange={(event) => set("notes", event.target.value)}/></Field></div>
      </div>
    </div>
    <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={saving || !form.routeId || !form.vehicleId || !form.name || nodes.length < 2} onClick={save}>{saving ? "Saving…" : "Save draft path version"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function LeafletMap({ nodes, routedGeometry, onMapClick }: { nodes: PathNodeDraft[]; routedGeometry: Array<[number, number]>; onMapClick: (lat: number, lng: number) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const defaultLat = nodes[0]?.latitude ?? -17.8292;
    const defaultLng = nodes[0]?.longitude ?? 31.0522;
    const map = L.map(containerRef.current).setView([defaultLat, defaultLng], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    map.on("click", (event) => onMapClickRef.current(event.latlng.lat, event.latlng.lng));
    mapRef.current = map; layerRef.current = layer;
    setTimeout(() => map.invalidateSize(), 0);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current; const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const latLngs = nodes.map((node) => L.latLng(node.latitude, node.longitude));
    nodes.forEach((node, index) => {
      const fillColor = node.nodeType === "checkpoint" ? "#f59e0b" : node.nodeType === "learner_stop" ? "#2563eb" : "#16a34a";
      L.circleMarker([node.latitude, node.longitude], { radius: 8, fillColor, fillOpacity: 0.9, color: "#fff", weight: 2 }).bindTooltip(`${index + 1}. ${node.name}`, { permanent: false }).addTo(layer);
    });
    const displayedLine = routedGeometry.length > 1 ? routedGeometry.map(([lat, lng]) => L.latLng(lat, lng)) : latLngs;
    if (displayedLine.length > 1) L.polyline(displayedLine, { color: "#111827", weight: 4, opacity: 0.75 }).addTo(layer);
    if (latLngs.length) map.fitBounds(L.latLngBounds(latLngs), { padding: [30, 30], maxZoom: 16 });
  }, [nodes, routedGeometry]);
  return <div ref={containerRef} className="h-[480px] w-full overflow-hidden rounded-lg border bg-muted"/>;
}

function MapPointForm({ title, onSave }: { title: string; onSave: (coords: { latitude: number; longitude: number }, extra: any) => void }) {
  const [name, setName] = useState(""); const [landmark, setLandmark] = useState(""); const [instructions, setInstructions] = useState(""); const [privacyClass, setPrivacyClass] = useState("private_household"); const [lat, setLat] = useState<number | null>(null); const [lng, setLng] = useState<number | null>(null);
  return <div className="space-y-3"><div className="font-medium">{title}</div><div className="grid gap-2 sm:grid-cols-2"><Field label="Location name"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Home gate / shops / landmark"/></Field><Field label="Landmark"><Input value={landmark} onChange={(event) => setLandmark(event.target.value)}/></Field><NumberField label="Latitude" value={lat ?? ""} onChange={(value: any) => setLat(value === "" ? null : Number(value))} min={-90} max={90} step="0.0000001"/><NumberField label="Longitude" value={lng ?? ""} onChange={(value: any) => setLng(value === "" ? null : Number(value))} min={-180} max={180} step="0.0000001"/></div><Choice label="Privacy" value={privacyClass} onChange={setPrivacyClass} items={[["private_household", "Private household"], ["shared_household", "Shared household"], ["public_common", "Public/common stop"]]}/><Field label="Driver instructions"><Textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Road side, gate colour, safety notes…"/></Field><MiniMapPicker latitude={lat} longitude={lng} onPick={(latitude, longitude) => { setLat(latitude); setLng(longitude); }}/><Button type="button" variant="outline" className="w-full" disabled={lat == null || lng == null || !name} onClick={() => onSave({ latitude: lat!, longitude: lng! }, { name, landmark, instructions, privacyClass })}><MapPin className="mr-2 h-4 w-4"/>Save this service point</Button></div>;
}

function MiniMapPicker({ latitude, longitude, onPick }: { latitude: number | null; longitude: number | null; onPick: (lat: number, lng: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null); const mapRef = useRef<L.Map | null>(null); const markerRef = useRef<L.CircleMarker | null>(null);
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current).setView([latitude ?? -17.8292, longitude ?? 31.0522], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
    map.on("click", (event) => onPick(event.latlng.lat, event.latlng.lng)); mapRef.current = map; setTimeout(() => map.invalidateSize(), 0);
    return () => { map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current; if (!map || latitude == null || longitude == null) return;
    markerRef.current?.remove(); markerRef.current = L.circleMarker([latitude, longitude], { radius: 8, fillColor: "#2563eb", fillOpacity: 1, color: "#fff", weight: 2 }).addTo(map); map.panTo([latitude, longitude]);
  }, [latitude, longitude]);
  return <div><div ref={ref} className="h-48 rounded-md border"/><p className="mt-1 text-xs text-muted-foreground">Click the map to set the exact point.</p></div>;
}

function renderDialogFields(type: string, form: any, set: (key: string, value: any) => void, data: Bootstrap, record?: any) {
  if (type === "route") return <><Field label="Route name"><Input value={form.name || ""} onChange={(event) => set("name", event.target.value)}/></Field><Field label="Route code"><Input value={form.code || ""} onChange={(event) => set("code", event.target.value.toUpperCase())}/></Field><Choice label="General direction" value={form.direction} onChange={(value: any) => set("direction", value)} items={[["both", "Both directions"], ["pickup", "Inbound only"], ["dropoff", "Outbound only"]]}/><NumberField label="Default two-way monthly fee (USD)" value={form.defaultFee} onChange={(value: any) => set("defaultFee", value)} min={0} step="0.01"/><Choice label="Status" value={form.status} onChange={(value: any) => { set("status", value); set("isActive", value !== "retired"); }} items={[["draft", "Draft"], ["pending_approval", "Pending approval"], ["active", "Active"], ["suspended", "Suspended"], ["retired", "Retired"]]}/><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></>;
  if (type === "vehicle") return <><Field label="Registration number"><Input value={form.registrationNumber || ""} onChange={(event) => set("registrationNumber", event.target.value.toUpperCase())}/></Field><Field label="Make / model"><Input value={form.makeModel || ""} onChange={(event) => set("makeModel", event.target.value)}/></Field><NumberField label="Capacity" value={form.capacity} onChange={(value: any) => set("capacity", value)} min={1}/><Choice label="Ownership" value={form.ownershipType} onChange={(value: any) => set("ownershipType", value)} items={[["school", "School-owned"], ["staff", "Staff-owned"], ["contracted", "Contracted"]]}/><EntitySelect label="Owner" items={data.owners} value={form.ownerId} onChange={(value: any) => set("ownerId", idValue(value))} itemText={(owner: any) => owner.name} optional/><EntitySelect label="Current driver" items={data.drivers} value={form.driverId} onChange={(value: any) => set("driverId", idValue(value))} itemText={(driver: any) => `${driver.firstName} ${driver.lastName}`} optional/><Field label="Insurance expiry"><Input type="date" value={form.insuranceExpiry || ""} onChange={(event) => set("insuranceExpiry", event.target.value)}/></Field><Field label="Fitness expiry"><Input type="date" value={form.fitnessExpiry || ""} onChange={(event) => set("fitnessExpiry", event.target.value)}/></Field><Choice label="Status" value={form.status} onChange={(value: any) => { set("status", value); set("isActive", value === "active"); }} items={[["draft", "Draft"], ["active", "Active"], ["suspended", "Suspended"], ["retired", "Retired"]]}/>{record && <><Field label="Effective date of owner/driver change"><Input type="date" value={form.effectiveDate || today()} onChange={(event) => set("effectiveDate", event.target.value)}/></Field><Field label="Change reason"><Input value={form.changeReason || ""} onChange={(event) => set("changeReason", event.target.value)}/></Field></>}<div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></div></>;
  if (type === "driver") return <><Field label="First name"><Input value={form.firstName || ""} onChange={(event) => set("firstName", event.target.value)}/></Field><Field label="Last name"><Input value={form.lastName || ""} onChange={(event) => set("lastName", event.target.value)}/></Field><Field label="Phone"><Input value={form.phone || ""} onChange={(event) => set("phone", event.target.value)}/></Field><Field label="National ID"><Input value={form.nationalId || ""} onChange={(event) => set("nationalId", event.target.value)}/></Field><Field label="Licence number"><Input value={form.licenceNumber || ""} onChange={(event) => set("licenceNumber", event.target.value)}/></Field><Field label="Licence expiry"><Input type="date" value={form.licenceExpiry || ""} onChange={(event) => set("licenceExpiry", event.target.value)}/></Field><Choice label="Engagement" value={form.engagementType} onChange={(value: any) => set("engagementType", value)} items={[["internal", "Internal"], ["external", "External"]]}/><BooleanField label="Active" value={form.isActive} onChange={(value: any) => set("isActive", value)}/><Field label="Effective from"><Input type="date" value={form.effectiveFrom || ""} onChange={(event) => set("effectiveFrom", event.target.value)}/></Field><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></>;
  if (type === "owner") return <><Field label="Owner / company name"><Input value={form.name || ""} onChange={(event) => set("name", event.target.value)}/></Field><Choice label="Type" value={form.ownerType} onChange={(value: any) => set("ownerType", value)} items={[["individual", "Individual"], ["company", "Company"]]}/><Field label="Contact person"><Input value={form.contactPerson || ""} onChange={(event) => set("contactPerson", event.target.value)}/></Field><Field label="Phone"><Input value={form.phone || ""} onChange={(event) => set("phone", event.target.value)}/></Field><Field label="National ID / registration"><Input value={form.nationalIdOrRegistration || ""} onChange={(event) => set("nationalIdOrRegistration", event.target.value)}/></Field><Field label="Payment details"><Textarea value={form.paymentDetails || ""} onChange={(event) => set("paymentDetails", event.target.value)}/></Field><BooleanField label="Active" value={form.isActive} onChange={(value: any) => set("isActive", value)}/><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></>;
  if (type === "transfer") return <><div className="md:col-span-2 rounded-md border bg-muted/40 p-3 text-sm"><b>Current assignment:</b> {record.firstName} {record.lastName} · {record.routeName} · {record.vehicleRegistration || "No vehicle"}</div><Field label="Transfer effective date"><Input type="date" value={form.effectiveDate} onChange={(event) => set("effectiveDate", event.target.value)}/></Field><Choice label="Transfer type" value={form.transferType} onChange={(value: any) => set("transferType", value)} items={[["vehicle", "Vehicle only"], ["stop", "Stop only"], ["path", "Path only"], ["route", "Route"], ["service_type", "Service type"], ["temporary", "Temporary"], ["permanent", "Permanent"]]}/><EntitySelect label="New route" items={data.routes.filter((route: any) => route.isActive)} value={form.routeId} onChange={(value: any) => set("routeId", idValue(value))} itemText={(route: any) => route.name}/><EntitySelect label="New inbound vehicle" items={data.vehicles.filter((vehicle: any) => vehicle.isActive)} value={form.vehicleId} onChange={(value: any) => set("vehicleId", idValue(value))} itemText={(vehicle: any) => vehicle.registrationNumber} optional/><EntitySelect label="New outbound vehicle" items={data.vehicles.filter((vehicle: any) => vehicle.isActive)} value={form.outboundVehicleId} onChange={(value: any) => set("outboundVehicleId", idValue(value))} itemText={(vehicle: any) => vehicle.registrationNumber} optional/><Choice label="Service type" value={form.serviceType} onChange={(value: any) => set("serviceType", value)} items={[["both", "Two-way"], ["pickup", "Inbound only"], ["dropoff", "Outbound only"]]}/><NumberField label="New full monthly fee" value={form.baseMonthlyFee} onChange={(value: any) => set("baseMonthlyFee", value)} min={0} step="0.01"/><NumberField label="New agreed monthly fee" value={form.agreedFee} onChange={(value: any) => set("agreedFee", value)} min={0} step="0.01"/><div className="md:col-span-2"><Field label="Mandatory reason"><Textarea value={form.reason || ""} onChange={(event) => set("reason", event.target.value)}/></Field></div></>;
  if (type === "state") return <><div className="md:col-span-2 rounded-md border bg-muted/40 p-3 text-sm"><b>{record.firstName} {record.lastName}</b> is currently {titleCase(record.serviceState)}.</div><Choice label="New service state" value={form.state} onChange={(value: any) => set("state", value)} items={[["active", "Active"], ["active_arrears", "Active – arrears"], ["active_payment_plan", "Active – payment plan"], ["suspension_pending", "Suspension pending"], ["suspended", "Suspended"], ["paused", "Paused voluntarily"], ["terminated", "Terminated"], ["completed", "Completed"]]}/><Field label="Effective date"><Input type="date" value={form.effectiveDate} onChange={(event) => set("effectiveDate", event.target.value)}/></Field>{["paused", "terminated"].includes(form.state) && <Choice label="Credit / refund method" value={form.refundMethod} onChange={(value: any) => set("refundMethod", value)} items={[["credit", "Learner transport credit"], ["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["mobile_money", "Mobile money"], ["original_method", "Original payment method"]]}/>}<div className="md:col-span-2"><Field label="Mandatory reason"><Textarea value={form.reason || ""} onChange={(event) => set("reason", event.target.value)}/></Field></div></>;
  if (type === "charge") return <><Field label="Academic year"><Input type="number" value={form.academicYear} onChange={(event) => set("academicYear", event.target.value)}/></Field><Choice label="Term" value={form.term} onChange={(value: any) => set("term", value)} items={[["term1", "Term 1"], ["term2", "Term 2"], ["term3", "Term 3"]]}/><NumberField label="Service month" value={form.month} onChange={(value: any) => set("month", value)} min={1} max={12}/><Field label="Due date"><Input type="date" value={form.dueDate || ""} onChange={(event) => set("dueDate", event.target.value)}/></Field><div className="md:col-span-2"><Alert><ShieldCheck className="h-4 w-4"/><AlertTitle>Prorating is automatic</AlertTitle><AlertDescription>Joining and exit effective dates, month length, leap years and saved policy values are applied automatically. Holidays are not excluded.</AlertDescription></Alert></div></>;
  if (type === "payment") return <><EntitySelect label="Learner" items={data.students} value={form.studentId} onChange={(value: any) => set("studentId", idValue(value))} itemText={(student: any) => `${student.firstName} ${student.lastName} (${student.admissionNo})`}/><NumberField label="Amount (USD)" value={form.amount} onChange={(value: any) => set("amount", value)} min={0.01} step="0.01"/><Field label="Payment date"><Input type="date" value={form.paymentDate} onChange={(event) => set("paymentDate", event.target.value)}/></Field><Choice label="Payment method" value={form.paymentMethod} onChange={(value: any) => set("paymentMethod", value)} items={[["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["mobile_money", "Mobile money"], ["card", "Card"], ["cheque", "Cheque"], ["other", "Other"]]}/><Field label="Academic year"><Input type="number" value={form.academicYear} onChange={(event) => set("academicYear", event.target.value)}/></Field><Choice label="Term" value={form.term} onChange={(value: any) => set("term", value)} items={[["term1", "Term 1"], ["term2", "Term 2"], ["term3", "Term 3"]]}/><NumberField label="Specified month (0 for arrears/credit)" value={form.month} onChange={(value: any) => set("month", value)} min={0} max={12}/><Choice label="Allocation policy" value={form.allocationMode} onChange={(value: any) => set("allocationMode", value)} items={[["oldest_first", "Oldest outstanding charge first"], ["future_credit", "Hold entirely as future credit"]]}/><Field label="Transaction / bank reference"><Input value={form.externalReference || ""} onChange={(event) => set("externalReference", event.target.value)}/></Field><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></>;
  if (type === "reversePayment") return <div className="md:col-span-2"><Alert variant="destructive"><AlertTriangle className="h-4 w-4"/><AlertTitle>Reverse immutable receipt {record.receiptNo}</AlertTitle><AlertDescription>The original remains in the audit trail and is marked REVERSED. It cannot be edited.</AlertDescription></Alert><div className="mt-4"><Field label="Mandatory reversal reason"><Textarea value={form.reason || ""} onChange={(event) => set("reason", event.target.value)}/></Field></div></div>;
  if (type === "paymentPlan") return <><EntitySelect label="Learner assignment" items={data.assignments.filter((assignment: any) => assignment.isActive || ["suspended", "paused"].includes(assignment.serviceState))} value={form.assignmentId} onChange={(value: any) => { const assignment = data.assignments.find((row: any) => row.id === idValue(value)); set("assignmentId", idValue(value)); set("studentId", assignment?.studentId); set("coveredAmount", Math.max(0, Number(assignment?.balance || 0))); }} itemText={(assignment: any) => `${assignment.firstName} ${assignment.lastName} · USD ${money(assignment.balance)}`}/><NumberField label="Covered amount" value={form.coveredAmount} onChange={(value: any) => set("coveredAmount", value)} min={0.01} step="0.01"/><NumberField label="Instalment amount" value={form.instalmentAmount} onChange={(value: any) => set("instalmentAmount", value)} min={0.01} step="0.01"/><Choice label="Frequency" value={form.frequency} onChange={(value: any) => set("frequency", value)} items={[["weekly", "Weekly"], ["fortnightly", "Fortnightly (14 days)"], ["monthly", "Monthly"], ["custom", "Custom"]]}/><Field label="Start date"><Input type="date" value={form.startDate} onChange={(event) => set("startDate", event.target.value)}/></Field><Field label="Final due date"><Input type="date" value={form.finalDueDate || ""} onChange={(event) => set("finalDueDate", event.target.value)}/></Field><NumberField label="Grace days" value={form.graceDays} onChange={(value: any) => set("graceDays", value)} min={0}/><Field label="Payer acknowledgement"><Textarea value={form.payerAcknowledgement || ""} onChange={(event) => set("payerAcknowledgement", event.target.value)}/></Field></>;
  if (type === "refund") return <><EntitySelect label="Learner" items={data.students} value={form.studentId} onChange={(value: any) => { set("studentId", idValue(value)); const assignment = data.assignments.find((row: any) => row.studentId === idValue(value) && row.isActive); set("assignmentId", assignment?.id || null); }} itemText={(student: any) => `${student.firstName} ${student.lastName} (${student.admissionNo})`}/><Choice label="Refund / credit type" value={form.refundType} onChange={(value: any) => set("refundType", value)} items={[["pause_credit", "Pause – learner transport credit"], ["termination_refund", "Termination refund"], ["overpayment", "Overpayment"], ["manual_adjustment", "Manual adjustment"]]}/><NumberField label="Amount (USD)" value={form.amount} onChange={(value: any) => set("amount", value)} min={0.01} step="0.01"/><Field label="Effective date"><Input type="date" value={form.effectiveDate} onChange={(event) => set("effectiveDate", event.target.value)}/></Field><Choice label="Method" value={form.method} onChange={(value: any) => set("method", value)} items={[["credit", "Learner transport credit"], ["cash", "Cash refund"], ["bank_transfer", "Bank transfer"], ["mobile_money", "Mobile money"], ["original_method", "Original payment method"]]}/><Field label="Reason"><Textarea value={form.reason || ""} onChange={(event) => set("reason", event.target.value)}/></Field></>;
  if (type === "payRefund") return <><div className="md:col-span-2 rounded-md border p-3"><b>{record.refundNumber}</b> · USD {money(record.amount)}</div><Field label="Payment reference"><Input value={form.externalReference || ""} onChange={(event) => set("externalReference", event.target.value)}/></Field></>;
  if (type === "cashup") return <><Field label="Cash-up date"><Input type="date" value={form.cashupDate} onChange={(event) => set("cashupDate", event.target.value)}/></Field><div className="md:col-span-2"><Field label="Payments to include"><div className="max-h-56 overflow-y-auto rounded-md border p-3 space-y-2">{data.payments.filter((payment: any) => !payment.reversedAt && payment.verificationStatus !== "reconciled").map((payment: any) => <label key={payment.id} className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><Checkbox checked={(form.paymentIds || []).includes(payment.id)} onCheckedChange={(checked) => set("paymentIds", checked ? [...(form.paymentIds || []), payment.id] : (form.paymentIds || []).filter((id: number) => id !== payment.id))}/><span>{payment.receiptNo} · {payment.firstName} {payment.lastName}</span></span><span>USD {money(payment.amount)}</span></label>)}</div></Field></div><NumberField label="Actual cash submitted" value={form.actualCash} onChange={(value: any) => set("actualCash", value)} min={0} step="0.01"/><NumberField label="Actual non-cash verified" value={form.actualNonCash} onChange={(value: any) => set("actualNonCash", value)} min={0} step="0.01"/><Field label="Deposit / reconciliation reference"><Input value={form.depositReference || ""} onChange={(event) => set("depositReference", event.target.value)}/></Field><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></>;
  if (type === "subscription") return <><EntitySelect label="Vehicle override" items={data.vehicles} value={form.vehicleId} onChange={(value: any) => set("vehicleId", idValue(value))} itemText={(vehicle: any) => vehicle.registrationNumber} optional optionalLabel="All vehicles (school default)"/><Choice label="Rule type" value={form.ruleType} onChange={(value: any) => set("ruleType", value)} items={[["fixed", "Fixed amount"], ["percentage", "Percentage of gross"], ["percentage_with_limits", "Percentage with minimum/maximum"]]}/><NumberField label={form.ruleType === "fixed" ? "Value (USD)" : "Value (%)"} value={form.value} onChange={(value: any) => set("value", value)} min={0.01} step="0.01"/><NumberField label="Minimum amount (optional)" value={form.minimumAmount} onChange={(value: any) => set("minimumAmount", value)} min={0} step="0.01"/><NumberField label="Maximum amount (optional)" value={form.maximumAmount} onChange={(value: any) => set("maximumAmount", value)} min={0} step="0.01"/><Field label="Effective from"><Input type="date" value={form.effectiveFrom} onChange={(event) => set("effectiveFrom", event.target.value)}/></Field><Field label="Effective to"><Input type="date" value={form.effectiveTo || ""} onChange={(event) => set("effectiveTo", event.target.value)}/></Field><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></>;
  if (type === "penalty") return <><EntitySelect label="Vehicle" items={data.vehicles} value={form.vehicleId} onChange={(value: any) => { const vehicle = data.vehicles.find((row: any) => row.id === idValue(value)); set("vehicleId", idValue(value)); set("ownerId", vehicle?.ownerId || null); }} itemText={(vehicle: any) => vehicle.registrationNumber}/><Field label="Penalty category"><Input value={form.category || ""} onChange={(event) => set("category", event.target.value)} placeholder="Configurable category name"/></Field><Field label="Incident date"><Input type="date" value={form.incidentDate} onChange={(event) => set("incidentDate", event.target.value)}/></Field><NumberField label="Amount (USD)" value={form.amount} onChange={(value: any) => set("amount", value)} min={0.01} step="0.01"/><Field label="Effective year"><Input type="number" value={form.effectiveYear} onChange={(event) => set("effectiveYear", event.target.value)}/></Field><NumberField label="Effective month" value={form.effectiveMonth} onChange={(value: any) => set("effectiveMonth", value)} min={1} max={12}/><div className="md:col-span-2"><Field label="Reason"><Textarea value={form.reason || ""} onChange={(event) => set("reason", event.target.value)}/></Field></div></>;
  if (type === "advance") return <><EntitySelect label="Vehicle" items={data.vehicles} value={form.vehicleId} onChange={(value: any) => { const vehicle = data.vehicles.find((row: any) => row.id === idValue(value)); set("vehicleId", idValue(value)); set("ownerId", vehicle?.ownerId || null); }} itemText={(vehicle: any) => vehicle.registrationNumber}/><NumberField label="Advance amount (USD)" value={form.amount} onChange={(value: any) => set("amount", value)} min={0.01} step="0.01"/><Field label="Request date"><Input type="date" value={form.requestDate} onChange={(event) => set("requestDate", event.target.value)}/></Field><Field label="Disbursement date"><Input type="date" value={form.disbursementDate || ""} onChange={(event) => set("disbursementDate", event.target.value)}/></Field><Choice label="Recovery method" value={form.recoveryMethod} onChange={(value: any) => set("recoveryMethod", value)} items={[["fixed_instalment", "Fixed instalment"], ["percentage", "Percentage of gross"], ["full_available", "Full available amount"], ["manual_schedule", "Manual schedule"]]}/><NumberField label={form.recoveryMethod === "percentage" ? "Recovery percentage" : "Recovery amount"} value={form.recoveryValue} onChange={(value: any) => set("recoveryValue", value)} min={0.01} step="0.01"/><Field label="Recovery start year"><Input type="number" value={form.recoveryStartYear} onChange={(event) => set("recoveryStartYear", event.target.value)}/></Field><NumberField label="Recovery start month" value={form.recoveryStartMonth} onChange={(value: any) => set("recoveryStartMonth", value)} min={1} max={12}/><NumberField label="Minimum owner take-home" value={form.minimumOwnerTakeHome} onChange={(value: any) => set("minimumOwnerTakeHome", value)} min={0} step="0.01"/><NumberField label="Maximum monthly recovery" value={form.maximumMonthlyRecovery} onChange={(value: any) => set("maximumMonthlyRecovery", value)} min={0} step="0.01"/><div className="md:col-span-2"><Field label="Purpose"><Textarea value={form.purpose || ""} onChange={(event) => set("purpose", event.target.value)}/></Field></div></>;
  if (type === "disburseAdvance") return <><Field label="Disbursement date"><Input type="date" value={form.disbursementDate || ""} onChange={(event) => set("disbursementDate", event.target.value)}/></Field><Field label="Payment / bank reference"><Input value={form.disbursementReference || ""} onChange={(event) => set("disbursementReference", event.target.value)}/></Field></>;
  if (type === "incident") return <><EntitySelect label="Vehicle" items={data.vehicles} value={form.vehicleId} onChange={(value: any) => set("vehicleId", idValue(value))} itemText={(vehicle: any) => vehicle.registrationNumber}/><EntitySelect label="Driver" items={data.drivers} value={form.driverId} onChange={(value: any) => set("driverId", idValue(value))} itemText={(driver: any) => `${driver.firstName} ${driver.lastName}`} optional/><EntitySelect label="Route" items={data.routes} value={form.routeId} onChange={(value: any) => set("routeId", idValue(value))} itemText={(route: any) => route.name} optional/><EntitySelect label="Vehicle path" items={data.paths} value={form.pathId} onChange={(value: any) => set("pathId", idValue(value))} itemText={(path: any) => `${path.name} v${path.versionNumber}`} optional/><Field label="Incident type"><Input value={form.incidentType || ""} onChange={(event) => set("incidentType", event.target.value)} placeholder="Breakdown, accident, delay, route deviation…"/></Field><Choice label="Severity" value={form.severity} onChange={(value: any) => set("severity", value)} items={[["low", "Low"], ["medium", "Medium"], ["high", "High"], ["critical", "Critical"]]}/><Field label="Date and time"><Input type="datetime-local" value={form.occurredAt} onChange={(event) => set("occurredAt", event.target.value)}/></Field><div className="md:col-span-2"><Field label="Description"><Textarea value={form.description || ""} onChange={(event) => set("description", event.target.value)}/></Field></div><div className="md:col-span-2"><Field label="How it was handled"><Textarea value={form.resolution || ""} onChange={(event) => set("resolution", event.target.value)}/></Field></div></>;
  if (type === "claim") return <><EntitySelect label="Vehicle" items={data.vehicles.filter((vehicle: any) => vehicle.isActive)} value={form.vehicleId} onChange={(value: any) => set("vehicleId", idValue(value))} itemText={(vehicle: any) => vehicle.registrationNumber}/><Field label="Service year"><Input type="number" value={form.serviceYear} onChange={(event) => set("serviceYear", event.target.value)}/></Field><NumberField label="Service month" value={form.serviceMonth} onChange={(value: any) => set("serviceMonth", value)} min={1} max={12}/><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field><div className="md:col-span-2"><Alert><Receipt className="h-4 w-4"/><AlertTitle>Claim protection</AlertTitle><AlertDescription>Only eligible allocations that are valid, reconciled when required, not reversed/refunded and not previously claimed will be included.</AlertDescription></Alert></div></>;
  if (type === "payPayout") return <><div className="md:col-span-2 rounded-md border p-3"><b>{record.payoutNumber}</b> · Net USD {money(record.netAmount)} · Already paid USD {money(record.amountPaid)}</div><Field label="Payment date"><Input type="date" value={form.paymentDate} onChange={(event) => set("paymentDate", event.target.value)}/></Field><Choice label="Payment method" value={form.paymentMethod} onChange={(value: any) => set("paymentMethod", value)} items={[["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["mobile_money", "Mobile money"], ["other", "Other"]]}/><NumberField label="Amount now" value={form.amount} onChange={(value: any) => set("amount", value)} min={0.01} step="0.01"/><Field label="Payment reference"><Input value={form.paymentReference || ""} onChange={(event) => set("paymentReference", event.target.value)}/></Field></>;
  return <div className="md:col-span-2 text-sm text-muted-foreground">No fields are configured for this action.</div>;
}

function buildInitialForm(type: string, record: any, data: Bootstrap) {
  const year = new Date().getFullYear(); const base: any = { ...record };
  const defaults: Record<string, any> = {
    route: { direction: "both", defaultFee: 0, billingFrequency: "monthly", status: "active", isActive: true },
    vehicle: { ownershipType: "school", capacity: 1, status: "active", isActive: true, effectiveDate: today() },
    driver: { engagementType: "internal", isActive: true, effectiveFrom: today() },
    owner: { ownerType: "individual", isActive: true, effectiveFrom: today() },
    assignment: { startDate: today(), serviceType: "both", serviceState: "pending_start", planningStatus: "pending_path_assignment", financialStatus: "pending_first_payment", baseMonthlyFee: 0, agreedFee: 0 },
    transfer: { ...record, effectiveDate: today(), transferType: "permanent", reason: "" },
    state: { state: record?.serviceState || "active", effectiveDate: today(), reason: "", refundMethod: "credit" },
    charge: { academicYear: year, term: data.school.currentTerm || "term1", month: currentMonth(), dueDate: today() },
    payment: { academicYear: year, term: data.school.currentTerm || "term1", month: 0, paymentDate: today(), paymentMethod: "cash", allocationMode: "oldest_first", amount: "" },
    reversePayment: { reason: "" },
    paymentPlan: { coveredAmount: "", instalmentAmount: "", frequency: "monthly", startDate: today(), graceDays: 0 },
    refund: { refundType: "overpayment", method: "credit", effectiveDate: today(), amount: "", reason: "" },
    payRefund: { externalReference: "" },
    cashup: { cashupDate: today(), paymentIds: [], actualCash: 0, actualNonCash: 0 },
    subscription: { vehicleId: null, ruleType: "fixed", value: "", effectiveFrom: today() },
    penalty: { incidentDate: today(), amount: "", effectiveYear: year, effectiveMonth: currentMonth(), reason: "" },
    advance: { amount: "", requestDate: today(), recoveryMethod: "fixed_instalment", recoveryValue: "", recoveryStartYear: year, recoveryStartMonth: currentMonth(), minimumOwnerTakeHome: 0 },
    incident: { severity: "medium", occurredAt: new Date().toISOString().slice(0, 16), affectedStudentIds: [] },
    claim: { serviceYear: year, serviceMonth: currentMonth() },
    payPayout: { paymentDate: today(), paymentMethod: "bank_transfer", amount: Math.max(0, Number(record?.netAmount || 0) - Number(record?.amountPaid || 0)) },
    disburseAdvance: { disbursementDate: today(), disbursementReference: "" },
  };
  return { ...(defaults[type] || {}), ...base };
}

function dialogConfig(type: string, record?: any) {
  const editing = Boolean(record && ["route", "vehicle", "driver", "owner"].includes(type));
  const configs: Record<string, any> = {
    route: { title: `${editing ? "Edit" : "Add"} route`, description: "Routes are broad service corridors; vehicle-specific stops belong to Vehicle Path Setup.", url: "/api/transport/routes", action: editing ? "Save changes" : "Add route" },
    vehicle: { title: `${editing ? "Edit" : "Add"} vehicle`, description: "Owner and driver changes are recorded with effective dates.", url: "/api/transport/vehicles", action: editing ? "Save changes" : "Add vehicle" },
    driver: { title: `${editing ? "Edit" : "Add"} driver`, description: "Maintain compliance and effective engagement dates.", url: "/api/transport/drivers", action: editing ? "Save changes" : "Add driver" },
    owner: { title: `${editing ? "Edit" : "Add"} vehicle owner`, description: "School-isolated service-provider details.", url: "/api/transport/owners", action: editing ? "Save changes" : "Add owner" },
    transfer: { title: "Transfer learner", description: "Policy B recalculates old and new service portions where fees differ.", url: `/api/transport/assignments/${record?.id}/transfer`, action: "Confirm transfer" },
    state: { title: "Change learner service state", description: "Pause, suspension and termination are date-effective and audited.", url: `/api/transport/assignments/${record?.id}/state`, action: "Apply state change" },
    charge: { title: "Generate monthly transport charges", description: "Existing charges for the same learner assignment and month are skipped.", url: "/api/transport/charges/generate", action: "Generate charges" },
    payment: { title: "Record transport payment", description: "Payment date and service effective date are independent. Two immutable receipt copies print after saving.", url: "/api/transport/payments", action: "Record and print receipt" },
    reversePayment: { title: "Reverse payment and receipt", description: "A reversal preserves the original receipt and audit history.", url: `/api/transport/payments/${record?.id}/reverse`, action: "Reverse receipt" },
    paymentPlan: { title: "Create payment plan", description: "The learner remains active while the approved plan is current.", url: "/api/transport/payment-plans", action: "Create plan" },
    refund: { title: "Request learner credit or refund", description: "Pause defaults to credit; termination may use an approved external method.", url: "/api/transport/refunds", action: "Submit request" },
    payRefund: { title: "Record refund payout", description: "Record the external refund reference after approval.", url: `/api/transport/refunds/${record?.id}/pay`, action: "Record payout" },
    cashup: { title: "Prepare daily cash-up", description: "Reconcile actual cash and non-cash amounts against issued receipts.", url: "/api/transport/cashups", action: "Create cash-up" },
    subscription: { title: "Add subscription rule", description: "Create an effective-dated school default or vehicle-specific override.", url: "/api/transport/subscriptions", action: "Add rule" },
    penalty: { title: "Add vehicle penalty", description: "The category is configurable text and becomes a controlled payout deduction.", url: "/api/transport/penalties", action: "Add penalty" },
    advance: { title: "Request vehicle advance", description: "The request must be approved and separately disbursed before recovery begins.", url: "/api/transport/advances", action: "Submit request" },
    disburseAdvance: { title: "Disburse vehicle advance", description: "Record the date and external reference for the approved advance.", url: `/api/transport/advances/${record?.id}/disburse`, action: "Record disbursement" },
    incident: { title: "Log transport incident", description: "Record breakdowns and how they were handled without automatic financial redistribution.", url: "/api/transport/incidents", action: "Log incident" },
    claim: { title: "Generate vehicle claim", description: "Each school generates a separate claim for its own learners, receipts and payout deductions.", url: "/api/transport/claims/generate", action: "Generate claim" },
    payPayout: { title: "Record vehicle payout", description: "Partial payments are supported; net balances never become negative.", url: `/api/transport/payouts/${record?.id}/pay`, action: "Record payment" },
  };
  return configs[type] || { title: "Transport action", description: "", url: "", action: "Save" };
}

function PresetPeriods({ onApply }: { onApply: (from: string, to: string) => void }) {
  const preset = (kind: string) => {
    const now = new Date(); const end = new Date(now); const start = new Date(now);
    if (kind === "today") {}
    if (kind === "week") start.setDate(now.getDate() - 6);
    if (kind === "fortnight") start.setDate(now.getDate() - 13);
    if (kind === "month") start.setDate(1);
    onApply(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  };
  return <div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => preset("today")}>Daily</Button><Button size="sm" variant="outline" onClick={() => preset("week")}>Weekly</Button><Button size="sm" variant="outline" onClick={() => preset("fortnight")}>Fortnightly</Button><Button size="sm" variant="outline" onClick={() => preset("month")}>Monthly</Button></div>;
}

function MasterTable({ title, description, button, canAdd, onAdd, heads, rows }: any) {
  return <Card><CardHeader className="gap-3 lg:flex-row lg:items-center lg:justify-between"><div><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</div>{canAdd && button && <Button onClick={onAdd}><Plus className="mr-2 h-4 w-4"/>{button}</Button>}</CardHeader><CardContent><DataTable heads={heads}>{rows}</DataTable></CardContent></Card>;
}

function DataTable({ heads, children }: { heads: string[]; children: any }) {
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow>{heads.map((head) => <TableHead key={head} className="whitespace-nowrap">{head}</TableHead>)}</TableRow></TableHeader><TableBody>{children?.length === 0 ? <TableRow><TableCell colSpan={heads.length} className="py-8 text-center text-muted-foreground">No records found.</TableCell></TableRow> : children}</TableBody></Table></div>;
}

function StatusBadge({ value }: { value: any }) { const status = String(value || "unknown"); return <Badge variant={statusVariant(status)} className="whitespace-nowrap">{titleCase(status)}</Badge>; }
function Field({ label, children }: { label: string; children: any }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function NumberField({ label, value, onChange, min, max, step = "1" }: any) { return <Field label={label}><Input type="number" value={value ?? ""} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)}/></Field>; }
function Choice({ label, value, onChange, items }: any) { return <Field label={label}><Select value={String(value ?? "")} onValueChange={onChange}><SelectTrigger><SelectValue placeholder={`Select ${label.toLowerCase()}`}/></SelectTrigger><SelectContent>{items.map(([itemValue, itemLabel]: any) => <SelectItem key={itemValue} value={String(itemValue)}>{itemLabel}</SelectItem>)}</SelectContent></Select></Field>; }
function EntitySelect({ label, items, value, onChange, itemText, optional, optionalLabel = "None" }: any) { return <Field label={label}><Select value={value == null ? (optional ? "none" : undefined) : String(value)} onValueChange={onChange}><SelectTrigger><SelectValue placeholder={`Select ${label.toLowerCase()}`}/></SelectTrigger><SelectContent>{optional && <SelectItem value="none">{optionalLabel}</SelectItem>}{items.map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{itemText(item)}</SelectItem>)}</SelectContent></Select></Field>; }
function BooleanField({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <div className="flex min-h-10 items-center gap-3 rounded-md border px-3 py-2"><Checkbox checked={Boolean(value)} onCheckedChange={(checked) => onChange(Boolean(checked))}/><Label>{label}</Label></div>; }
function SettingsSection({ title, children }: { title: string; children: any }) { return <section className="space-y-3"><div><h3 className="font-semibold">{title}</h3><Separator className="mt-2"/></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{children}</div></section>; }

async function fetchJson(method: string, url: string, body?: any) {
  const response = await apiRequest(method, url, body);
  return response.json();
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6371000; const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
