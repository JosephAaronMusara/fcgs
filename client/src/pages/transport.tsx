import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiRequest, queryClient, schoolFetch } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import TransportRecordDetails from "@/components/transport/transport-record-details";
import StaffOwnerSelector from "@/components/transport/staff-owner-selector";
import ServiceLocationEditor, { emptyServiceLocation, type ServiceLocationDraft } from "@/components/transport/service-location-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableMultiSelect, SearchableSelect } from "@/components/ui/searchable-select";
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
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Copy,
  CreditCard,
  FileCheck2,
  FileClock,
  FileText,
  Gauge,
  History,
  Lock,
  Map as MapIcon,
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
  currentUserId?: number | null;
  settings: any;
  routes: any[];
  points: any[];
  owners: any[];
  drivers: any[];
  allOwners: any[];
  allDrivers: any[];
  vehicles: any[];
  allVehicles: any[];
  organizationRoutes: any[];
  destinationMasters: any[];
  vehicleDestinations: any[];
  vehicleSchoolAssociations: any[];
  organizationSchools: any[];
  servicePoints: any[];
  paths: any[];
  pathNodes: any[];
  pathNodeLearners: any[];
  students: any[];
  paymentEligibleStudents: any[];
  staff: any[];
  assignments: any[];
  learnerAccounts: any[];
  payments: any[];
  refunds: any[];
  cashups: any[];
  billingRuns: any[];
  subscriptions: any[];
  subscriptionPolicies: any[];
  penalties: any[];
  advances: any[];
  advanceRepayments: any[];
  incidents: any[];
  claims: any[];
  payouts: any[];
  audits: any[];
  organizationSettings: any;
  operatingDriverHistory: any[];
  vehicleReplacementHistory: any[];
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
  reverseExpectedTime?: string | null;
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
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const serviceTypeLabel = (value: any) => value === "pickup" ? "School-bound" : value === "dropoff" ? "Home-bound" : value === "both" ? "Two-way" : titleCase(value);
const directionLabel = (value: any) => value === "pickup" ? "School-bound" : value === "dropoff" ? "Home-bound" : value === "both" ? "Both directions" : titleCase(value);
const readableError = (error: any) => {
  const message = String(error?.message || "Unable to complete action");
  const brace = message.indexOf("{");
  if (brace >= 0) {
    try { return JSON.parse(message.slice(brace))?.message || message; } catch {}
  }
  return message.replace(/^\d+:\s*/, "");
};

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["paid", "approved", "active", "verified", "reconciled", "completed", "path_confirmed", "matched", "resolved", "hq_confirmed"].includes(status)) return "default";
  if (["reversed", "rejected", "cancelled", "suspended", "suspended_arrears", "defaulted", "critical", "overdue", "disputed", "hq_discrepancy"].includes(status)) return "destructive";
  if (["draft", "pending_start", "pending_first_payment", "pending_vehicle_reassignment", "requested", "submitted", "paused", "partially_paid"].includes(status)) return "secondary";
  return "outline";
}

export default function TransportPage() {
  const { currentSchoolId, user, isLoading: authLoading, hasAnyPermission } = useAuth();
  const { toast } = useToast();
  const [topTab, setTopTab] = useState(() => localStorage.getItem("transportTopTab") || "overview");
  const [operationsTab, setOperationsTab] = useState(() => localStorage.getItem("transportOperationsTab") || "learners");
  const [billingTab, setBillingTab] = useState(() => localStorage.getItem("transportBillingTab") || "payments");
  const [settlementsTab, setSettlementsTab] = useState(() => localStorage.getItem("transportSettlementsTab") || "claims");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [billingWizardTrigger, setBillingWizardTrigger] = useState(0);
  const [unsavedTransportSettings,setUnsavedTransportSettings] = useState(false);
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

  const hasSchoolScope = effectiveSchoolId != null;

  const { data, isLoading, error, refetch } = useQuery<Bootstrap>({
    queryKey: ["/api/transport/bootstrap", effectiveSchoolId],
    enabled: hasSchoolScope,
    queryFn: async () => {
      const response = await schoolFetch("/api/transport/bootstrap", {
        headers: { "X-School-Id": String(effectiveSchoolId) },
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
  });

  const { data: reportData, refetch: refreshReport, isFetching: reportLoading } = useQuery<any>({
    queryKey: ["/api/transport/reports/summary", effectiveSchoolId, reportFrom, reportTo],
    enabled: hasSchoolScope && topTab === "reports",
    queryFn: async () => {
      const response = await schoolFetch(`/api/transport/reports/summary?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`, {
        headers: { "X-School-Id": String(effectiveSchoolId) },
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
  });

  const refresh = async () => {
    if (!hasSchoolScope) return;
    await queryClient.invalidateQueries({ queryKey: ["/api/transport/reports/summary", effectiveSchoolId] });
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
      if (variables.url === "/api/transport/payments" && result?.payment?.id) {
        const reinstatementState = result?.reinstatement?.serviceState;
        toast({
          title: "Transport payment recorded",
          description: reinstatementState === "active"
            ? "Qualifying arrears were cleared and Transport service was automatically reinstated."
            : reinstatementState === "pending_vehicle_reassignment"
              ? "Qualifying arrears were cleared, but the reserved seat had already been released. Vehicle reassignment is required before service resumes."
              : undefined,
        });
        void openTransportPdf(`/api/transport/receipts/${result.payment.id}/print`);
      } else {
        toast({ title: "Transport record saved" });
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

  if (authLoading || (hasSchoolScope && isLoading)) return <div className="p-6"><Card><CardContent className="p-8 text-center text-muted-foreground">Loading Transport workspace…</CardContent></Card></div>;
  if (!hasSchoolScope) return <div className="p-6"><Alert><MapPin className="h-4 w-4"/><AlertTitle>Select a school</AlertTitle><AlertDescription>Open a school from HQ before entering the Transport workspace.</AlertDescription></Alert></div>;
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
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button className="w-full sm:w-auto" variant="outline" onClick={() => refresh()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button>
          {can("transport.charges.generate", "transport.create") && <Button className="w-full sm:w-auto" variant="outline" onClick={() => {setTopTab("billing");setBillingTab("billingRuns");setBillingWizardTrigger(v=>v+1);}}><WalletCards className="mr-2 h-4 w-4"/>Process Monthly Billing</Button>}
          {(can("transport.payments.record") || canManageLegacy) && <Button className="w-full sm:w-auto" onClick={() => open("payment")}><CreditCard className="mr-2 h-4 w-4"/>Record Payment</Button>}
        </div>
      </div>

      <Tabs value={topTab} onValueChange={next=>{if(topTab==="settings" && next!=="settings" && unsavedTransportSettings && !window.confirm("You have unsaved Transport settings. Discard the changes and leave Settings?"))return;setTopTab(next)}}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="w-max min-w-full justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="settlements">Settlements</TabsTrigger>
            <TabsTrigger value="reports">Reports & Audit</TabsTrigger>
            {can("transport.settings.manage", "transport.edit") && <TabsTrigger value="settings">Settings</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-5">
          <Overview data={data} onOpen={open}/>
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
          <BillingWorkspace wizardTrigger={billingWizardTrigger} data={data} tab={billingTab} setTab={setBillingTab} open={open} can={can} canManageLegacy={canManageLegacy} mutate={mutate} openTransportPdf={openTransportPdf}/>
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
          <SettingsWorkspace data={data} canEdit={can("transport.settings.manage", "transport.edit")} onUnsavedChange={setUnsavedTransportSettings} saving={mutate.isPending} onSave={(body: any) => mutate.mutateAsync({ method: "PUT", url: "/api/transport/settings", body })}/>
        </TabsContent>
      </Tabs>

      {dialog && (
        <TransportDialog
          state={dialog}
          data={data}
          saving={mutate.isPending}
          close={() => setDialog(null)}
          submit={(method, url, body) => mutate.mutate({ method, url, body })}
          canManageDocuments={can("transport.documents.manage") || canManageLegacy}
          canManageCompliance={can("transport.compliance.manage", "transport.vehicles.override_compliance") || canManageLegacy}
        />
      )}
    </div>
  );
}

function Overview({ data, onOpen }: any) {
  const now = new Date();
  const monthStart = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-01`;
  const monthEnd = (date: Date) => new Date(date.getFullYear(), date.getMonth()+1, 0).toISOString().slice(0,10);
  const [periodMode, setPeriodMode] = useState("current");
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth()+1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [customFrom, setCustomFrom] = useState(monthStart(now));
  const [customTo, setCustomTo] = useState(today());
  const [drilldown, setDrilldown] = useState<{ title: string; rows: any[]; kind: string } | null>(null);
  const period = useMemo(() => {
    if (periodMode === "previous") { const d = new Date(now.getFullYear(), now.getMonth()-1, 1); return { from: monthStart(d), to: monthEnd(d) }; }
    if (periodMode === "month") { const d = new Date(selectedYear, selectedMonth-1, 1); return { from: monthStart(d), to: monthEnd(d) }; }
    if (periodMode === "custom") return { from: customFrom, to: customTo };
    return { from: monthStart(now), to: monthEnd(now) };
  }, [periodMode, selectedMonth, selectedYear, customFrom, customTo]);
  const { data: overview, isFetching } = useQuery<any>({
    queryKey: ["/api/transport/overview", period.from, period.to],
    queryFn: async () => { const response = await schoolFetch(`/api/transport/overview?from=${period.from}&to=${period.to}`); if (!response.ok) throw new Error(await response.text()); return response.json(); },
  });
  const summary = overview?.summary || {};
  const records = overview?.records || {};
  const cards = [
    ["Active learners", summary.activeLearners || 0, Users, records.activeLearners || [], "learners"],
    ["Active destinations", summary.activeDestinations || 0, Route, [], "destinations"],
    ["Active vehicles", summary.activeVehicles || 0, Bus, records.activeVehicles || [], "vehicles"],
    ["Total charged", `USD ${money(summary.totalCharged)}`, CircleDollarSign, records.charges || [], "charges"],
    ["Total collected", `USD ${money(summary.totalCollected)}`, Banknote, records.payments || [], "payments"],
    ["Outstanding", `USD ${money(summary.outstanding)}`, WalletCards, records.activeLearners || [], "learners"],
    ["Payouts due", `USD ${money(summary.payoutsDue)}`, CreditCard, records.payoutsDue || [], "claims"],
    ["Pending claims", summary.pendingClaims || 0, FileCheck2, records.pendingClaims || [], "claims"],
    ["Pending refunds", summary.pendingRefunds || 0, RefreshCw, records.pendingRefunds || [], "refunds"],
    ["Advances outstanding", `USD ${money(summary.advancesOutstanding)}`, Gauge, records.advances || [], "advances"],
    ["Suspended for arrears", Number(data.dashboard?.suspendedArrears || 0), Lock, (data.assignments || []).filter((row:any)=>row.serviceState==="suspended_arrears"), "learners"],
    ["At risk next billing", Number(data.dashboard?.atRiskNextBilling || 0), AlertTriangle, (data.assignments || []).filter((row:any)=>!["suspended_arrears","pending_vehicle_reassignment","terminated","completed"].includes(String(row.serviceState || "")) && Number(row.currentMonthOutstanding || 0) > Number(data.organizationSettings?.minimumArrearsSuspensionBalance || 0)), "learners"],
  ];
  const configuredThresholds = Array.isArray(data.settings?.complianceNotificationDays) ? data.settings.complianceNotificationDays.map(Number) : [30,14,7,1,0];
  const maximumWarningDays = Math.max(0, ...configuredThresholds.filter((value: number) => value >= 0));
  const expiringVehicles = data.vehicles.filter((vehicle: any) => { const limit = new Date(); limit.setDate(limit.getDate()+maximumWarningDays); return [vehicle.registrationExpiry,vehicle.insuranceExpiry,vehicle.fitnessExpiry,vehicle.radioLicenceExpiry].some((date: string) => date && new Date(date) <= limit); });
  const expiringDrivers = data.drivers.filter((driver: any) => { const limit = new Date(); limit.setDate(limit.getDate()+maximumWarningDays); return driver.licenceExpiry && new Date(driver.licenceExpiry) <= limit; });
  const show = (title: string, rows: any[], kind: string) => setDrilldown({ title, rows, kind });
  return <>
    <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-52"><Field label="Overview Period"><SearchableSelect value={periodMode} onValueChange={setPeriodMode} options={[{value:"current",label:"Current Month"},{value:"previous",label:"Previous Month"},{value:"month",label:"Choose Month / Year"},{value:"custom",label:"Custom Period"}]}/></Field></div>
      {periodMode === "month" && <><div className="min-w-44"><MonthSelector value={selectedMonth} onChange={setSelectedMonth}/></div><Field label="Year"><Input type="number" className="w-28" value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}/></Field></>}
      {periodMode === "custom" && <><Field label="From"><Input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)}/></Field><Field label="To"><Input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)}/></Field></>}
      <div className="pb-2 text-sm text-muted-foreground">{MONTHS[new Date(`${period.from}T00:00:00`).getMonth()]} {new Date(`${period.from}T00:00:00`).getFullYear()}{period.from !== period.to && periodMode === "custom" ? ` · ${period.from} to ${period.to}` : ""}{isFetching ? " · Updating…" : ""}</div>
    </CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      {cards.map(([title,value,Icon,rows,kind]: any) => <button type="button" key={title} className="rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => show(title, rows, kind)}><Card className="h-full transition-colors hover:bg-muted/40"><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs text-muted-foreground">{title}</p><p className="text-xl font-bold">{value}</p></div><Icon className="h-6 w-6 text-muted-foreground"/></CardContent></Card></button>)}
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Operational attention</CardTitle><CardDescription>Click a record to open it directly.</CardDescription></CardHeader><CardContent className="space-y-3">
        {expiringVehicles.length===0 && expiringDrivers.length===0 ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4"/>No compliance dates are due within the configured warning window.</div> : null}
        {expiringVehicles.map((vehicle: any) => <button type="button" key={`v-${vehicle.id}`} className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-muted/40" onClick={() => onOpen("details",{entityType:"vehicle",entityId:vehicle.id})}><div><div className="font-medium">{vehicle.registrationNumber}</div><div className="text-xs text-muted-foreground">Registration: {vehicle.registrationExpiry || "—"} · Insurance: {vehicle.insuranceExpiry || "—"} · Fitness: {vehicle.fitnessExpiry || "—"} · Radio: {vehicle.radioLicenceExpiry || "—"}</div></div><Badge variant="destructive">Review</Badge></button>)}
        {expiringDrivers.map((driver: any) => <button type="button" key={`d-${driver.id}`} className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-muted/40" onClick={() => onOpen("details",{entityType:"driver",entityId:driver.id})}><div><div className="font-medium">{driver.firstName} {driver.lastName}</div><div className="text-xs text-muted-foreground">Licence expires {driver.licenceExpiry}</div></div><Badge variant="destructive">Review</Badge></button>)}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Quick actions</CardTitle><CardDescription>Common Transport workflows.</CardDescription></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2"><Button variant="outline" className="justify-start" onClick={() => onOpen("assignment")}><UserRoundCheck className="mr-2 h-4 w-4"/>Register learner service</Button><Button variant="outline" className="justify-start" onClick={() => onOpen("incident")}><AlertTriangle className="mr-2 h-4 w-4"/>Log incident</Button><Button variant="outline" className="justify-start" onClick={() => onOpen("cashup")}><ClipboardCheck className="mr-2 h-4 w-4"/>Prepare cash-up</Button><Button variant="outline" className="justify-start" onClick={() => onOpen("claim")}><FileText className="mr-2 h-4 w-4"/>Generate claim</Button><Button variant="outline" className="justify-start" onClick={() => onOpen("refund")}><RefreshCw className="mr-2 h-4 w-4"/>Request refund</Button></CardContent></Card>
    </div>
    <Dialog open={Boolean(drilldown)} onOpenChange={(open) => !open && setDrilldown(null)}><DialogContent className="max-h-[80vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>{drilldown?.title}</DialogTitle><DialogDescription>Records contributing to the selected overview period.</DialogDescription></DialogHeader><DataTable heads={["Record","Details","Amount / Status"]}>{(drilldown?.rows || []).map((row:any,index:number) => <TableRow key={row.id || index}><TableCell className="font-medium">{row.receiptNo || row.claimNumber || row.refundNumber || row.vehicleRegistration || `${row.firstName || ""} ${row.lastName || ""}`.trim() || `Record ${index+1}`}</TableCell><TableCell>{row.admissionNo || row.ownerName || row.destinationName || row.status || "—"}</TableCell><TableCell>{row.amount != null ? `USD ${money(row.amount)}` : row.netAmount != null ? `USD ${money(row.netAmount)}` : row.outstanding != null ? `USD ${money(row.outstanding)}` : row.learnerCount != null ? `${row.learnerCount} learner(s)` : <StatusBadge value={row.serviceState || row.status || "active"}/>}</TableCell></TableRow>)}</DataTable></DialogContent></Dialog>
  </>;
}

function OperationsWorkspace({ data, assignments, search, setSearch, tab, setTab, open, can, canManageLegacy, mutate }: any) {
  const canEdit = canManageLegacy || can("transport.routes.edit", "transport.vehicles.edit", "transport.learners.edit_service");
  const canEditLearnerService = canManageLegacy || can("transport.learners.edit_service");
  const [learnerStatus, setLearnerStatus] = useState("all");
  const [destinationUsage, setDestinationUsage] = useState<{ route: any; mode: "students" | "vehicles" | "points" } | null>(null);
  const visibleAssignments = assignments.filter((row:any) =>
    learnerStatus === "all"
    || (learnerStatus === "active" && row.isActive && !["suspended_arrears","pending_vehicle_reassignment"].includes(String(row.serviceState || "")))
    || (learnerStatus === "pending" && row.serviceState === "pending_start")
    || (learnerStatus === "suspended_arrears" && row.serviceState === "suspended_arrears")
    || (learnerStatus === "pending_vehicle_reassignment" && row.serviceState === "pending_vehicle_reassignment")
    || (learnerStatus === "inactive" && !row.isActive && !["pending_start","suspended_arrears","pending_vehicle_reassignment"].includes(String(row.serviceState || "")))
    || (learnerStatus === "arrears" && Number(row.balance) > 0)
  );
  return <><Tabs value={tab} onValueChange={setTab}>
    <div className="overflow-x-auto pb-1"><TabsList className="w-max justify-start">
      <TabsTrigger value="learners">Learners</TabsTrigger><TabsTrigger value="vehicles">Vehicles</TabsTrigger><TabsTrigger value="drivers">Drivers</TabsTrigger><TabsTrigger value="owners">Owners</TabsTrigger><TabsTrigger value="routes">Destinations</TabsTrigger><TabsTrigger value="servicePoints">Pick-Up/Drop-Off Points</TabsTrigger><TabsTrigger value="incidents">Incidents</TabsTrigger>
    </TabsList></div>

    <TabsContent value="learners"><Card>
      <CardHeader className="gap-3"><div><CardTitle>Learner transport services</CardTitle><CardDescription>Destination, vehicle, service and financial states remain separate and date-effective.</CardDescription></div><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:flex-nowrap"><div className="relative w-full min-w-0 sm:max-w-sm sm:flex-[2_1_240px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search learner, destination or vehicle" aria-label="Search learner transport services" className="h-11 w-full pl-10 sm:h-9"/></div><div className="w-full min-w-0 sm:w-52 sm:shrink-0"><SearchableSelect className="h-11 sm:h-9" value={learnerStatus} onValueChange={setLearnerStatus} options={[{value:"all",label:"All services"},{value:"active",label:"Active"},{value:"pending",label:"Pending start"},{value:"suspended_arrears",label:"Suspended — Arrears"},{value:"pending_vehicle_reassignment",label:"Needs Vehicle Reassignment"},{value:"inactive",label:"Inactive / Cancelled"},{value:"arrears",label:"In arrears"}]} placeholder="Filter status"/></div>{(can("transport.learners.enrol") || canManageLegacy) && <Button className="min-h-11 w-full shrink-0 sm:ml-auto sm:min-h-9 sm:w-auto" onClick={() => open("assignment")}><Plus className="mr-2 h-4 w-4"/>Register learner</Button>}</div></CardHeader>
      <CardContent><DataTable heads={["Learner", "Destination", "Service location", "Vehicle", "Service", "Planning", "Financial", "Balance", "Actions"]}>{visibleAssignments.map((assignment: any) => <TableRow key={assignment.id}>
        <TableCell><button type="button" className="text-left font-medium hover:underline" onClick={() => open("learnerAccount", { studentId: assignment.studentId })}>{assignment.firstName} {assignment.lastName}</button><div className="text-xs text-muted-foreground">{assignment.admissionNo} · {assignment.className || "No class"}</div></TableCell>
        <TableCell>{assignment.routeName}</TableCell>
        <TableCell>{(() => {
          const pickupRequired = assignment.serviceType !== "dropoff";
          const dropoffRequired = assignment.serviceType !== "pickup";
          const locationPending = (pickupRequired && !assignment.pickupServicePointId) || (dropoffRequired && !assignment.dropoffServicePointId);
          if (locationPending) return <Badge variant="secondary">Pick/Drop Point pending</Badge>;
          return <><div>{assignment.pickupName || assignment.dropoffName || "—"}</div>{assignment.dropoffName && assignment.dropoffName !== assignment.pickupName && <div className="text-xs text-muted-foreground">Home-bound: {assignment.dropoffName}</div>}</>;
        })()}</TableCell>
        <TableCell>{assignment.vehicleRegistration || assignment.outboundVehicleRegistration || "—"}</TableCell>
        <TableCell>{assignment.cancellationEffectiveDate ? <StatusBadge value={assignment.isActive ? (assignment.cancellationEffectiveDate === today() ? "ends_today" : "cancellation_scheduled") : "cancelled"}/> : <StatusBadge value={assignment.serviceState || (assignment.isActive ? "active" : "inactive")}/>}<div className="mt-1 text-xs text-muted-foreground">{serviceTypeLabel(assignment.serviceType)} · {assignment.cancellationEffectiveDate ? `${assignment.isActive ? (assignment.cancellationEffectiveDate === today() ? "Ends today" : "Ends") : "Ended"} ${assignment.cancellationEffectiveDate}` : assignment.endDate ? `Ended ${assignment.endDate}` : `From ${assignment.startDate}`}</div>{assignment.serviceState === "suspended_arrears" && <div className="mt-1 text-xs text-destructive">Qualifying arrears: USD {money(assignment.qualifyingArrears)}{assignment.oldestOverdueMonth ? ` · oldest ${assignment.oldestOverdueMonth}` : ""}{assignment.seatReleasedAt ? " · seat released" : assignment.seatReservedUntil ? ` · seat reserved through ${assignment.seatReservedUntil}` : " · seat reserved"}</div>}{assignment.serviceState === "pending_vehicle_reassignment" && <div className="mt-1 text-xs text-amber-700">Arrears cleared · vehicle reassignment required</div>}</TableCell>
        <TableCell><StatusBadge value={assignment.planningStatus}/></TableCell><TableCell><StatusBadge value={assignment.financialStatus}/></TableCell>
        <TableCell className={Number(assignment.balance) > 0 ? "font-medium text-destructive" : Number(assignment.balance) < 0 ? "font-medium text-emerald-600" : ""}>USD {money(assignment.balance)}</TableCell>
        <TableCell><div className="flex flex-wrap gap-1">{(() => {
          const pickupRequired = assignment.serviceType !== "dropoff";
          const dropoffRequired = assignment.serviceType !== "pickup";
          const locationPending = (pickupRequired && !assignment.pickupServicePointId) || (dropoffRequired && !assignment.dropoffServicePointId);
          return canEditLearnerService && assignment.isActive && locationPending ? <Button size="sm" variant="outline" onClick={() => open("assignmentServicePoint", assignment)}><MapPin className="mr-1 h-3.5 w-3.5"/>Add Service Pick/Drop Point</Button> : null;
        })()}{(can("transport.learners.transfer") || canManageLegacy) && assignment.isActive && !assignment.cancellationEffectiveDate && <Button size="sm" variant="outline" onClick={() => open("transfer", assignment)}><ArrowRightLeft className="mr-1 h-3.5 w-3.5"/>Transfer</Button>}{canEdit && assignment.isActive && !assignment.cancellationEffectiveDate && <Button size="sm" variant="ghost" onClick={() => open("state", assignment)}>State</Button>}{canEdit && assignment.isActive && !assignment.cancellationEffectiveDate && <Button size="sm" variant="destructive" onClick={() => open("cancelService", assignment)}>Cancel Service</Button>}</div></TableCell>
      </TableRow>)}</DataTable></CardContent>
    </Card></TabsContent>

    <TabsContent value="servicePoints"><SavedPointsWorkspace data={data} open={open} can={can} canManageLegacy={canManageLegacy} mutate={mutate}/></TabsContent>

    <TabsContent value="vehicles"><MasterTable title="Vehicles associated with this school" description="Shows organisation vehicle records associated with this school, even when they currently have no learner assignments. The wider organisation vehicle pool remains available in selectors." button="Add Transport vehicle" canAdd={can("transport.vehicles.create") || canManageLegacy} onAdd={() => open("vehicle")} heads={["Registration", "Source", "Make/Model", "Capacity", "Destinations", "Occupants", "Owner", "Driver", "Compliance", "Status", "Actions"]} rows={data.vehicles.map((vehicle: any) => {
      const owner = data.owners.find((row: any) => row.id === vehicle.ownerId); const driver = data.drivers.find((row: any) => row.id === vehicle.driverId);
      const activeTemporaryReplacement = (data.vehicleReplacementHistory || []).find((row:any)=>Number(row.originalVehicleId)===Number(vehicle.id) && row.replacementType === "temporary" && !row.effectiveTo);
      const sourceLabel = vehicle.sourceType === "fcgs_asset" ? "FCGS Asset / Fleet" : vehicle.ownershipType === "contracted" || vehicle.ownershipType === "staff" ? "Outsourced / Transport-only" : "Transport-only";
      return <TableRow key={vehicle.id}><TableCell><button type="button" className="font-medium hover:underline" onClick={() => open("details", { entityType:"vehicle", entityId:vehicle.id })}>{vehicle.registrationNumber}</button></TableCell><TableCell><div className="space-y-1"><Badge variant={vehicle.sourceType === "fcgs_asset" ? "default" : "outline"}>{sourceLabel}</Badge>{vehicle.sourceType === "fcgs_asset" && vehicle.assetNumber && <div className="text-xs text-muted-foreground">Asset {vehicle.assetNumber}</div>}</div></TableCell><TableCell>{vehicle.makeModel || "—"}</TableCell><TableCell>{vehicle.capacity}<div className="text-xs text-muted-foreground">{vehicle.schoolboundSeatsAvailable} school-bound · {vehicle.homeboundSeatsAvailable} home-bound free</div></TableCell><TableCell>{(vehicle.destinations || []).length ? <Button size="sm" variant="outline" onClick={() => open("vehicleDestinations", vehicle)}><MapPin className="mr-1 h-3.5 w-3.5"/>{Number((vehicle.destinations || []).length)}</Button> : <span className="text-muted-foreground">Not configured</span>}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => open("vehicleOccupants", vehicle)}><Users className="mr-1 h-3.5 w-3.5"/>{Number(vehicle.occupantCount || 0)}</Button></TableCell><TableCell>{vehicle.ownershipType === "school" ? data.school.name : owner?.name || "—"}{owner?.isStaffOwner && <Badge variant="outline" className="ml-1">Staff Owner</Badge>}</TableCell><TableCell>{driver ? <div><div>{driver.firstName} {driver.lastName}</div><div className="text-xs text-muted-foreground">Primary</div>{vehicle.currentOperatingDriver && Number(vehicle.currentOperatingDriver.id)!==Number(vehicle.driverId) && <div className="mt-1 text-xs text-amber-700">Operating: {vehicle.currentOperatingDriver.firstName} {vehicle.currentOperatingDriver.lastName}</div>}{(vehicle.alternativeDrivers||[]).length>0 && <div className="text-xs text-muted-foreground">{vehicle.alternativeDrivers.length} alternative(s)</div>}</div> : "—"}</TableCell><TableCell><StatusBadge value={vehicle.complianceStatus || "unknown"}/></TableCell><TableCell><StatusBadge value={vehicle.status || (vehicle.isActive ? "active" : "retired")}/></TableCell><TableCell><div className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" onClick={() => open("vehicleRoute", vehicle)}><Route className="mr-1 h-3.5 w-3.5"/>View Route</Button><Button size="sm" variant="ghost" onClick={() => open("details", { entityType:"vehicle", entityId:vehicle.id })}>View details</Button>{(can("transport.vehicles.edit") || canManageLegacy) && <><Button size="sm" variant="outline" onClick={() => open("vehicle", vehicle)}><Pencil className="mr-1 h-3.5 w-3.5"/>Edit Details</Button><Button size="sm" variant="outline" onClick={() => open("changePrimaryDriver", vehicle)}>Change Driver</Button>{(vehicle.alternativeDrivers||[]).length>0 && Number(vehicle.currentOperatingDriverId||vehicle.driverId)===Number(vehicle.driverId) && <Button size="sm" variant="outline" onClick={() => open("activateAlternativeDriver", vehicle)}>Alternative Cover</Button>}{vehicle.currentOperatingDriver && Number(vehicle.currentOperatingDriver.id)!==Number(vehicle.driverId) && <Button size="sm" variant="outline" onClick={() => open("returnPrimaryDriver", vehicle)}>Return Primary</Button>}<Button size="sm" variant="outline" onClick={() => open("changeVehicleOwner", vehicle)}>Change Owner</Button><Button size="sm" variant="outline" onClick={() => open("replaceVehicle", vehicle)}>Replace Vehicle</Button>{activeTemporaryReplacement && <Button size="sm" variant="outline" onClick={() => open("returnOriginalVehicle", activeTemporaryReplacement)}>Return Original</Button>}</>}</div></TableCell></TableRow>;
    })}/></TabsContent>

    <TabsContent value="drivers"><MasterTable title="Drivers" description="Shows organisation driver records associated with this school. Other organisation drivers remain available in selectors when establishing a valid school relationship." button="Add driver" canAdd={can("transport.drivers.manage") || canManageLegacy} onAdd={() => open("driver")} heads={["Driver", "Phone", "Owner / employer", "Licence", "Expiry", "Compliance", "Engagement", "Status", "Actions"]} rows={data.drivers.map((driver:any) => { const owner=(data.allOwners || data.owners).find((row:any)=>row.id===driver.ownerId); return <TableRow key={driver.id}><TableCell><button type="button" className="font-medium hover:underline" onClick={() => open("details",{entityType:"driver",entityId:driver.id})}>{driver.firstName} {driver.lastName}</button></TableCell><TableCell>{driver.phone || "—"}</TableCell><TableCell>{owner?.name || (driver.engagementType === "internal" ? "FCGS" : "—")}</TableCell><TableCell>{driver.licenceNumber || "—"}</TableCell><TableCell>{driver.licenceExpiry || "—"}</TableCell><TableCell><StatusBadge value={driver.complianceStatus || "unknown"}/></TableCell><TableCell>{titleCase(driver.engagementType)}</TableCell><TableCell><StatusBadge value={driver.isActive ? "active" : "retired"}/></TableCell><TableCell><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => open("details",{entityType:"driver",entityId:driver.id})}>View details</Button>{(can("transport.drivers.manage") || canManageLegacy) && <Button size="sm" variant="outline" onClick={() => open("driver",driver)}><Pencil className="mr-1 h-3.5 w-3.5"/>Edit</Button>}</div></TableCell></TableRow>; })}/></TabsContent>

    <TabsContent value="routes"><MasterTable title="Destinations" description="Parent service destinations. Student and vehicle usage is organisation-wide; Pick-Up/Drop-Off Points are the child service locations used within each destination." button="Add destination" canAdd={can("transport.routes.create") || canManageLegacy} onAdd={() => open("route")} heads={["Code", "Destination", "Service direction", "Monthly fee", "Students", "Vehicles", "Status", "Actions"]} rows={data.routes.map((route:any) => <TableRow key={route.id}><TableCell>{route.code}</TableCell><TableCell><button type="button" className="font-medium hover:underline" onClick={() => setDestinationUsage({ route, mode: "points" })}>{route.name}</button><div className="text-xs text-muted-foreground">{Number(route.servicePointUsageCount || 0)} active service point(s)</div></TableCell><TableCell>{directionLabel(route.direction)}</TableCell><TableCell>USD {money(route.defaultFee)}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setDestinationUsage({ route, mode: "students" })}><Users className="mr-1 h-3.5 w-3.5"/>{Number(route.studentUsageCount || 0)}</Button></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setDestinationUsage({ route, mode: "vehicles" })}><Bus className="mr-1 h-3.5 w-3.5"/>{Number(route.vehicleUsageCount || 0)}</Button></TableCell><TableCell><StatusBadge value={route.status || (route.isActive ? "active" : "retired")}/></TableCell><TableCell><div className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" onClick={() => setDestinationUsage({ route, mode: "points" })}>View</Button>{(can("transport.routes.edit") || canManageLegacy) && <Button size="sm" variant="outline" onClick={() => open("route",route)}><Pencil className="mr-1 h-3.5 w-3.5"/>Edit</Button>}</div></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="owners"><MasterTable title="Vehicle owners and service providers" description="Shows organisation owner/provider records associated with this school. Other organisation providers remain available in selectors and are associated rather than duplicated." button="Add owner" canAdd={can("transport.owners.manage") || canManageLegacy} onAdd={() => open("owner")} heads={["Owner", "Type", "Owner's phone", "Email", "Alternative contact", "Status", "Actions"]} rows={data.owners.map((owner:any) => <TableRow key={owner.id}><TableCell><button type="button" className="font-medium hover:underline" onClick={() => open("details",{entityType:"owner",entityId:owner.id})}>{owner.name}</button>{owner.isStaffOwner && <Badge variant="outline" className="ml-1">Staff Owner</Badge>}</TableCell><TableCell>{titleCase(owner.ownerType)}</TableCell><TableCell>{owner.phone || "—"}</TableCell><TableCell>{owner.email || "—"}</TableCell><TableCell>{owner.alternativeContactName || owner.contactPerson || "—"}{owner.alternativeContactPhone && <div className="text-xs text-muted-foreground">{owner.alternativeContactPhone}</div>}</TableCell><TableCell><StatusBadge value={owner.isActive ? "active" : "retired"}/></TableCell><TableCell><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => open("details",{entityType:"owner",entityId:owner.id})}>View details</Button>{(can("transport.owners.manage") || canManageLegacy) && <Button size="sm" variant="outline" onClick={() => open("owner",owner)}><Pencil className="mr-1 h-3.5 w-3.5"/>Edit</Button>}</div></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="incidents"><MasterTable title="Transport incidents" description="Incident time is entered by the user; logged time and user are automatic and immutable." button="Log incident" canAdd={can("transport.incidents.manage") || canManageLegacy} onAdd={() => open("incident")} heads={["Incident", "Vehicle", "Driver", "Destination", "Incident Date/Time", "Logged Date/Time", "Severity", "Status", "Description"]} rows={data.incidents.map((incident:any) => { const driver=data.drivers.find((item:any)=>item.id===incident.driverId); const destination=data.routes.find((item:any)=>item.id===incident.routeId); return <TableRow key={incident.id}><TableCell className="font-medium">{incident.incidentNumber}{incident.assignmentOverride && <Badge variant="outline" className="ml-1">Override</Badge>}</TableCell><TableCell>{data.allVehicles.find((vehicle:any)=>vehicle.id===incident.vehicleId)?.registrationNumber || "—"}</TableCell><TableCell>{driver ? `${driver.firstName} ${driver.lastName}` : "—"}</TableCell><TableCell>{destination?.name || "—"}</TableCell><TableCell>{new Date(incident.occurredAt).toLocaleString()}</TableCell><TableCell>{new Date(incident.createdAt).toLocaleString()}</TableCell><TableCell><StatusBadge value={incident.severity}/></TableCell><TableCell><StatusBadge value={incident.status}/></TableCell><TableCell className="max-w-xs whitespace-normal">{incident.description}</TableCell></TableRow>; })}/></TabsContent>
  </Tabs><DestinationUsageDialog usage={destinationUsage} setUsage={setDestinationUsage} openRecord={open}/></>;
}

function DestinationUsageDialog({ usage, setUsage, openRecord }: any) {
  const { data, isFetching, error } = useQuery<any>({
    queryKey: ["/api/transport/destinations/usage", usage?.route?.id],
    queryFn: async () => {
      const response = await schoolFetch(`/api/transport/destinations/${usage.route.id}/usage`);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    enabled: Boolean(usage?.route?.id),
  });
  return <Dialog open={Boolean(usage)} onOpenChange={(openState) => !openState && setUsage(null)}>
    <DialogContent className="max-h-[86vh] max-w-6xl overflow-y-auto">
      <DialogHeader><DialogTitle>{usage?.route?.name || "Destination"}</DialogTitle><DialogDescription>Organisation-wide active usage for this destination. Pick-Up/Drop-Off Points are the child service locations associated through active student or Fleet services.</DialogDescription></DialogHeader>
      {isFetching ? <div className="py-8 text-center text-muted-foreground">Loading destination usage…</div> : error ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4"/><AlertTitle>Unable to load destination</AlertTitle><AlertDescription>{error instanceof Error ? error.message : "Please try again"}</AlertDescription></Alert> : <Tabs value={usage?.mode || "students"} onValueChange={(mode) => setUsage((current:any) => current ? { ...current, mode } : current)}>
        <TabsList><TabsTrigger value="students">Students ({data?.students?.length || 0})</TabsTrigger><TabsTrigger value="vehicles">Vehicles ({data?.vehicles?.length || 0})</TabsTrigger><TabsTrigger value="points">Pick-Up/Drop-Off Points ({data?.points?.length || 0})</TabsTrigger></TabsList>
        <TabsContent value="students"><DataTable heads={["Learner", "School", "Class", "Service", "Pick-Up Point", "Drop-Off Point"]}>{(data?.students || []).map((student:any) => <TableRow key={student.studentId}><TableCell><div className="font-medium">{student.name}</div><div className="text-xs text-muted-foreground">{student.admissionNo || "—"}</div></TableCell><TableCell>{student.schoolName || "—"}</TableCell><TableCell>{student.className || "—"}</TableCell><TableCell>{serviceTypeLabel(student.serviceType)}</TableCell><TableCell>{student.pickupPoint || "—"}</TableCell><TableCell>{student.dropoffPoint || "—"}</TableCell></TableRow>)}</DataTable></TabsContent>
        <TabsContent value="vehicles"><DataTable heads={["Vehicle", "Source", "Base / School", "Owner", "Driver", "Status", "Actions"]}>{(data?.vehicles || []).map((vehicle:any) => <TableRow key={`${vehicle.source}-${vehicle.id}`}><TableCell><div className="font-medium">{vehicle.registration || "—"}</div>{vehicle.makeModel && <div className="text-xs text-muted-foreground">{vehicle.makeModel}</div>}</TableCell><TableCell><Badge variant={vehicle.source === "FCGS Fleet" ? "default" : "outline"}>{vehicle.source}</Badge></TableCell><TableCell>{vehicle.baseSchool || "—"}</TableCell><TableCell>{vehicle.owner || "—"}</TableCell><TableCell>{vehicle.driver || "—"}</TableCell><TableCell><StatusBadge value={vehicle.status || "active"}/></TableCell><TableCell>{vehicle.transportVehicleId ? <Button size="sm" variant="ghost" onClick={() => openRecord("details", { entityType: "vehicle", entityId: vehicle.transportVehicleId })}>View details</Button> : <span className="text-xs text-muted-foreground">Fleet record</span>}</TableCell></TableRow>)}</DataTable></TabsContent>
        <TabsContent value="points"><DataTable heads={["Pick-Up/Drop-Off Point", "Coordinates", "Privacy", "Status"]}>{(data?.points || []).map((point:any) => <TableRow key={point.id}><TableCell><div className="font-medium">{point.name}</div><div className="text-xs text-muted-foreground">{point.landmark || "—"}</div></TableCell><TableCell className="text-xs">{point.latitude != null && point.longitude != null ? `${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}` : "—"}</TableCell><TableCell>{titleCase(point.privacyClass)}</TableCell><TableCell><StatusBadge value={point.isActive === false ? "inactive" : "active"}/></TableCell></TableRow>)}</DataTable></TabsContent>
      </Tabs>}
    </DialogContent>
  </Dialog>;
}

function SavedPointsWorkspace({ data, open, can, canManageLegacy, mutate }: any) {
  const [usage, setUsage] = useState<{ point: any; mode: "students" | "vehicles" } | null>(null);
  const { data: usageData, isFetching } = useQuery<any>({
    queryKey: ["/api/transport/service-points/usage", usage?.point?.id],
    queryFn: async () => {
      const response = await schoolFetch(`/api/transport/service-points/${usage!.point.id}/usage`);
      if (!response.ok) throw new Error("Unable to load Pick-Up/Drop-Off Point usage");
      return response.json();
    },
    enabled: Boolean(usage?.point?.id),
  });
  const mayManage = can("transport.stops.manage") || canManageLegacy;
  return <Card>
    <CardHeader className="gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div><CardTitle>Pick-Up/Drop-Off Points</CardTitle><CardDescription>Organisation-wide saved service locations. New points saved during learner or vehicle-occupant registration appear here automatically and are immediately reusable across schools.</CardDescription></div>
      {mayManage && <Button onClick={() => open("servicePoint")}><Plus className="mr-2 h-4 w-4"/>Add Pick-Up/Drop-Off Point</Button>}
    </CardHeader>
    <CardContent>
      <DataTable heads={["Location", "Coordinates", "Privacy", "Entered At", "Students", "Vehicles", "Status", "Actions"]}>
        {data.servicePoints.map((point: any) => <TableRow key={point.id}>
          <TableCell><div className="font-medium">{point.name}</div><div className="text-xs text-muted-foreground">{point.landmark || "—"}</div></TableCell>
          <TableCell className="text-xs">{Number(point.latitude).toFixed(6)}, {Number(point.longitude).toFixed(6)}</TableCell>
          <TableCell><Badge variant="outline">{point.privacyClass === "public_common" ? "Public/Common Stop" : point.privacyClass === "shared_household" ? "Shared Household" : "Private Household"}</Badge></TableCell>
          <TableCell>{point.originSchoolName || `School #${point.schoolId}`}</TableCell>
          <TableCell><Button size="sm" variant="outline" onClick={() => setUsage({ point, mode: "students" })}><Users className="mr-1 h-3.5 w-3.5"/>{Number(point.studentUsageCount || 0)}</Button></TableCell>
          <TableCell><Button size="sm" variant="outline" onClick={() => setUsage({ point, mode: "vehicles" })}><Bus className="mr-1 h-3.5 w-3.5"/>{Number(point.vehicleUsageCount || 0)}</Button></TableCell>
          <TableCell><StatusBadge value={point.isActive === false ? "inactive" : "active"}/></TableCell>
          <TableCell><div className="flex gap-1">{mayManage && <Button size="sm" variant="outline" onClick={() => open("servicePoint", point)}><Pencil className="mr-1 h-3.5 w-3.5"/>Edit</Button>}{mayManage && <Button size="sm" variant="destructive" disabled={Number(point.studentUsageCount || 0) > 0 || Number(point.vehicleUsageCount || 0) > 0} onClick={() => { if (window.confirm(`Delete saved point ${point.name}?`)) mutate.mutate({ method: "DELETE", url: `/api/transport/service-points/${point.id}` }); }}>Delete</Button>}</div></TableCell>
        </TableRow>)}
      </DataTable>
    </CardContent>
    <Dialog open={Boolean(usage)} onOpenChange={(openState) => !openState && setUsage(null)}>
      <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>{usage?.point?.name} · {usage?.mode === "students" ? "Students" : "Vehicles"}</DialogTitle><DialogDescription>{usage?.mode === "students" ? "Students currently using this saved point, including paid future service where applicable." : "Vehicles currently associated with this saved point."}</DialogDescription></DialogHeader>
        {isFetching ? <div className="py-6 text-center text-muted-foreground">Loading usage…</div> : usage?.mode === "students" ? <DataTable heads={["Student", "Class", "Parent / Contacts", "Vehicle / Driver", "School"]}>{(usageData?.students || []).map((student: any) => <TableRow key={student.studentId}><TableCell><div className="font-medium">{student.name}</div><div className="text-xs text-muted-foreground">{student.admissionNo || "—"}</div></TableCell><TableCell>{student.className || "—"}</TableCell><TableCell><div>{student.parentName || "—"}</div><div className="text-xs text-muted-foreground">{[student.parentPhone, student.parentEmail].filter(Boolean).join(" · ") || "No contact"}</div></TableCell><TableCell><div>{student.vehicle || "—"}</div><div className="text-xs text-muted-foreground">{student.driver || "—"}</div></TableCell><TableCell>{student.schoolName || "—"}</TableCell></TableRow>)}</DataTable> : <DataTable heads={["Vehicle", "Source", "Base / School", "Owner", "Driver", "Status", "Actions"]}>{(usageData?.vehicles || []).map((vehicle: any) => <TableRow key={`${vehicle.source}-${vehicle.id}`}><TableCell><div className="font-medium">{vehicle.registration || `#${vehicle.id}`}</div>{vehicle.makeModel && <div className="text-xs text-muted-foreground">{vehicle.makeModel}</div>}</TableCell><TableCell><Badge variant={vehicle.source === "FCGS Fleet" ? "default" : "outline"}>{vehicle.source}</Badge></TableCell><TableCell>{vehicle.baseSchool || "—"}</TableCell><TableCell>{vehicle.owner || "—"}</TableCell><TableCell>{vehicle.driver || "—"}</TableCell><TableCell><StatusBadge value={vehicle.status || "active"}/></TableCell><TableCell>{vehicle.transportVehicleId ? <Button size="sm" variant="ghost" onClick={() => open("details", { entityType:"vehicle", entityId:vehicle.transportVehicleId })}>View details</Button> : <span className="text-xs text-muted-foreground">Fleet record</span>}</TableCell></TableRow>)}</DataTable>}
      </DialogContent>
    </Dialog>
  </Card>;
}

function ReceiptPrintActions({ payment, defaultFormat, openTransportPdf }: { payment: any; defaultFormat: string; openTransportPdf: (url: string) => Promise<void> }) {
  const normalizedDefault = defaultFormat === "thermal80" ? "thermal80" : "a4";
  const defaultLabel = normalizedDefault === "thermal80" ? "80 mm Thermal" : "A4";
  const baseUrl = `/api/transport/receipts/${payment.id}/print`;
  return <div className="inline-flex items-center">
    <Button size="sm" variant="outline" className="rounded-r-none" onClick={() => void openTransportPdf(baseUrl)}>
      <FileText className="mr-1 h-3.5 w-3.5"/>Print Receipt
    </Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="rounded-l-none border-l-0 px-2" aria-label="Choose receipt print format">
          <ChevronDown className="h-3.5 w-3.5"/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>School default: {defaultLabel}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void openTransportPdf(baseUrl)}>Use school default</DropdownMenuItem>
        <DropdownMenuSeparator/>
        <DropdownMenuItem onSelect={() => void openTransportPdf(`${baseUrl}?format=thermal80`)}>Print as 80 mm Thermal</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void openTransportPdf(`${baseUrl}?format=a4`)}>Print as A4</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

function BillingWorkspace({ data, tab, setTab, open, can, canManageLegacy, mutate, openTransportPdf, wizardTrigger }: any) {
  const { toast } = useToast();
  const [creditOpen, setCreditOpen] = useState(false);
  const [billingDueDate,setBillingDueDate] = useState(today());
  const [billingOutcome,setBillingOutcome] = useState<any>(null);
  useEffect(()=>{if(wizardTrigger>0){setCreditPreview(null);setBillingOutcome(null);setCreditOpen(true)}},[wizardTrigger]);
  const [creditYear, setCreditYear] = useState(new Date().getFullYear());
  const [creditMonth, setCreditMonth] = useState(new Date().getMonth() + 1);
  const [includeLegacyCredits, setIncludeLegacyCredits] = useState(false);
  const [creditPreview, setCreditPreview] = useState<any>(null);
  const [creditLoading, setCreditLoading] = useState(false);
  const runBillingGeneration=async()=>{
    if (!billingDueDate || creditYear < 2020 || creditYear > 2200 || creditMonth < 1 || creditMonth > 12) return;
    if(!window.confirm(`Process missing charges for ${MONTHS[creditMonth-1]} ${creditYear}? Existing charges will be skipped. Eligible credits will be allocated automatically, while held and uncertain historical credits remain protected.`))return;
    setCreditLoading(true);
    try {
      const result=await mutate.mutateAsync({url:"/api/transport/charges/generate",body:{academicYear:creditYear,month:creditMonth,dueDate:billingDueDate}});
      setBillingOutcome(result);
      setCreditPreview(null);

    } catch { /* shared mutation displays the backend validation error */ }
    finally { setCreditLoading(false); }
  };
  const showCreditPreview = async () => {
    try {
      setCreditLoading(true);
      setCreditPreview(null);
      const params = new URLSearchParams({ year: String(creditYear), month: String(creditMonth), includeLegacy: String(includeLegacyCredits) });
      const response = await schoolFetch(`/api/transport/credits/reconcile-preview?${params}`);
      if (!response.ok) throw new Error(await response.text());
      setCreditPreview(await response.json());
    } catch (error: any) {
      toast({ title: 'Unable to preview Transport credits', description: readableError(error), variant: 'destructive' });
    } finally { setCreditLoading(false); }
  };
  const applyCreditPreview = async () => {
    if (!creditPreview || creditPreview.allocationCount < 1) return;
    try {
      setCreditLoading(true);
      const outcome = await mutate.mutateAsync({ url: '/api/transport/credits/reconcile', body: {
        year: creditPreview.year, month: creditPreview.month,
        includeLegacy: creditPreview.includeLegacy, expectedDigest: creditPreview.digest,
      } });
      toast({ title: 'Transport credits reconciled', description: `${outcome.allocationCount} allocation(s) · USD ${money(outcome.allocated)} applied. Cash-up and claim controls are unchanged.` });
      setCreditPreview(null);
      setCreditOpen(false);
      setIncludeLegacyCredits(false);
    } catch {
      // The existing Transport mutation reports the server's 409/validation reason.
      setCreditPreview(null); // Force a fresh preview when underlying credits change.
    } finally { setCreditLoading(false); }
  };
  const [accountFilter, setAccountFilter] = useState("all");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentFromDate, setPaymentFromDate] = useState("");
  const [paymentToDate, setPaymentToDate] = useState("");
  const [cashupAction, setCashupAction] = useState<{ cashup: any; mode: "submit" | "verify" } | null>(null);
  const [cashupDraftPrompt, setCashupDraftPrompt] = useState<any>(null);
  const [cashupDraftLoading, setCashupDraftLoading] = useState(false);
  const ownDraft = useMemo(() => (data.cashups || []).find((row: any) => row.status === "draft" && Number(row.cashierUserId) === Number(data.currentUserId)), [data.cashups, data.currentUserId]);
  const resumeCashupDraft = async (cashup: any) => {
    try {
      setCashupDraftLoading(true);
      const response = await schoolFetch(`/api/transport/cashups/${cashup.id}/detail`);
      if (!response.ok) throw new Error(await response.text());
      const detail = await response.json();
      open("cashupEdit", { ...detail.cashup, paymentIds: (detail.linkedPayments || []).map((row:any) => Number(row.id)), refundIds: (detail.linkedRefunds || []).map((row:any) => Number(row.id)), advanceRepaymentIds: (detail.linkedAdvanceRepayments || []).map((row:any) => Number(row.id)) });
      setCashupDraftPrompt(null);
    } catch (error:any) {
      toast({ title: "Unable to resume cash-up", description: readableError(error), variant: "destructive" });
    } finally { setCashupDraftLoading(false); }
  };
  const prepareCashup = () => ownDraft ? setCashupDraftPrompt(ownDraft) : open("cashup");
  const discardCashupDraft = async (cashup:any) => {
    const reason = window.prompt("Reason for discarding this draft cash-up:", "Draft discarded before submission");
    if (reason === null) return;
    mutate.mutate({ url: `/api/transport/cashups/${cashup.id}/discard`, body: { reason: reason.trim() || "Draft discarded before submission" } });
  };
  const accountRows = useMemo(() => (data.learnerAccounts || []).filter((row: any) => {
    const balance = Number(row.balance || 0);
    const active = ["active","pending_start","paused","suspended"].includes(String(row.serviceState || ""));
    if (accountFilter === "active") return active;
    if (accountFilter === "inactive") return !active;
    if (accountFilter === "fully_paid") return balance <= 0;
    if (accountFilter === "arrears") return balance > 0;
    return true;
  }), [data.learnerAccounts, accountFilter]);
  const paymentDateRangeInvalid = Boolean(paymentFromDate && paymentToDate && paymentFromDate > paymentToDate);
  const paymentDateFilterActive = Boolean(paymentFromDate || paymentToDate);
  const paymentDateUrl = `/api/transport/payments?${new URLSearchParams({ ...(paymentFromDate ? { from: paymentFromDate } : {}), ...(paymentToDate ? { to: paymentToDate } : {}) }).toString()}`;
  const { data: paymentDateData, isFetching: paymentDateLoading } = useQuery<{payments:any[]}>({
    queryKey: ["/api/transport/payments", paymentFromDate, paymentToDate],
    enabled: paymentDateFilterActive && !paymentDateRangeInvalid,
    queryFn: async () => {
      const response = await schoolFetch(paymentDateUrl);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
  });
  const paymentSource = paymentDateFilterActive ? (paymentDateData?.payments || []) : (data.payments || []);
  const paymentRows = useMemo(() => {
    if (paymentDateRangeInvalid) return [];
    const query = paymentSearch.trim().toLowerCase();
    return paymentSource.filter((payment:any) => {
      if (!query) return true;
      return [payment.receiptNo, payment.firstName, payment.lastName, payment.admissionNo, payment.externalReference]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [paymentSource, paymentSearch, paymentDateRangeInvalid]);
  return <><Tabs value={tab} onValueChange={setTab}>
    <div className="overflow-x-auto pb-1"><TabsList className="w-max justify-start"><TabsTrigger value="payments">Payments & Receipts</TabsTrigger><TabsTrigger value="accounts">Learner Accounts</TabsTrigger><TabsTrigger value="refunds">Credits & Refunds</TabsTrigger><TabsTrigger value="cashups">Cash-Up</TabsTrigger><TabsTrigger value="billingRuns">Billing Runs</TabsTrigger></TabsList></div>

    <TabsContent value="payments">
      <div className="space-y-3">
        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-[1fr_180px_180px_auto] lg:items-end">
          <Field label="Search payments">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/>
              <Input value={paymentSearch} onChange={(event) => setPaymentSearch(event.target.value)} placeholder="Receipt number, learner or admission number" className="pl-8"/>
            </div>
          </Field>
          <Field label="From date"><Input type="date" value={paymentFromDate} onChange={(event) => setPaymentFromDate(event.target.value)}/></Field>
          <Field label="To date"><Input type="date" value={paymentToDate} onChange={(event) => setPaymentToDate(event.target.value)}/></Field>
          <Button type="button" variant="outline" onClick={() => { setPaymentFromDate(""); setPaymentToDate(""); }}>Clear dates</Button>
        </div>
        {paymentDateRangeInvalid && <Alert variant="destructive"><AlertTriangle className="h-4 w-4"/><AlertTitle>Invalid date range</AlertTitle><AlertDescription>The From date cannot be after the To date.</AlertDescription></Alert>}
        {paymentDateFilterActive && !paymentDateRangeInvalid && paymentDateLoading && <p className="text-sm text-muted-foreground">Loading payments for the selected date range…</p>}
        <MasterTable title="Transport payments and immutable receipts" description="Issued receipts cannot be edited. Corrections use reversal and replacement. Date filters query the full school payment history by recorded payment date and are inclusive." button="Record payment" canAdd={can("transport.payments.record") || canManageLegacy} onAdd={() => open("payment")} heads={["Receipt", "Learner", "Payment date", "Method", "Amount", "Allocated", "Credit", "Verification", "Cash-up", "Claim / payout", "Actions"]} rows={paymentRows.map((payment: any) => <TableRow key={payment.id}><TableCell><button type="button" className="font-medium hover:underline" onClick={() => void openTransportPdf(`/api/transport/receipts/${payment.id}/print`)}>{payment.receiptNo}</button>{Number(payment.reprintCount) > 0 && <div className="text-xs text-muted-foreground">{payment.reprintCount} reprint(s)</div>}</TableCell><TableCell><button type="button" className="text-left hover:underline" onClick={() => open("learnerAccount", { studentId: payment.studentId, firstName: payment.firstName, lastName: payment.lastName })}>{payment.firstName} {payment.lastName}</button><div className="text-xs text-muted-foreground">{payment.admissionNo}</div></TableCell><TableCell>{payment.paymentDate}</TableCell><TableCell>{titleCase(payment.paymentMethod)}</TableCell><TableCell>USD {money(payment.amount)}</TableCell><TableCell>USD {money(payment.allocatedAmount)}</TableCell><TableCell>USD {money(payment.unallocatedAmount)}</TableCell><TableCell><StatusBadge value={payment.reversedAt ? "reversed" : payment.verificationStatus}/></TableCell><TableCell>{payment.cashupId ? <StatusBadge value={payment.cashupStatus || "included"}/> : "Available"}</TableCell><TableCell>{payment.claimNumber || "—"}{payment.payoutNumber && <div className="text-xs text-muted-foreground">{payment.payoutNumber}</div>}</TableCell><TableCell><div className="flex flex-wrap gap-1"><ReceiptPrintActions payment={payment} defaultFormat={data.settings?.receiptPrintFormat || "a4"} openTransportPdf={openTransportPdf}/>{!payment.reversedAt && payment.verificationStatus === "unverified" && (can("transport.payments.verify") || canManageLegacy) && <Button size="sm" variant="ghost" onClick={() => mutate.mutate({ url: `/api/transport/payments/${payment.id}/verify` })}>Verify</Button>}{!payment.reversedAt && !payment.claimId && (can("transport.payments.reverse") || can("transport.delete")) && <Button size="sm" variant="destructive" onClick={() => open("reversePayment", payment)}>Reverse</Button>}</div></TableCell></TableRow>)}/>
      </div>
    </TabsContent>

    <TabsContent value="accounts"><Card><CardHeader className="gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle>Learner transport accounts</CardTitle><CardDescription>One lifetime Transport account per learner. Open a row to view every service period and financial transaction.</CardDescription></div><SearchableSelect value={accountFilter} onValueChange={setAccountFilter} options={[{value:"all",label:"All accounts"},{value:"active",label:"Active"},{value:"inactive",label:"Inactive / Cancelled"},{value:"fully_paid",label:"Fully Paid / Credit"},{value:"arrears",label:"In Arrears"}]} placeholder="Filter accounts"/></CardHeader><CardContent><DataTable heads={["Learner", "Current status", "Destination / Vehicle", "Charged", "Adjustments", "Paid", "Balance", "Financial status"]}>{accountRows.map((row: any) => { const balance=Number(row.balance||0); return <TableRow key={row.studentId} className="cursor-pointer" onClick={() => open("learnerAccount", row)}><TableCell><button type="button" className="font-medium hover:underline" onClick={(event) => { event.stopPropagation(); open("learnerAccount", row); }}>{row.firstName} {row.lastName}</button><div className="text-xs text-muted-foreground">{row.admissionNo}{row.className ? ` · ${row.className}` : ""}</div></TableCell><TableCell><StatusBadge value={row.serviceState || "inactive"}/><div className="mt-1 text-xs text-muted-foreground">{row.endDate ? `Effective to ${row.endDate}` : row.startDate ? `From ${row.startDate}` : "—"}</div></TableCell><TableCell>{row.destinationName || "—"}<div className="text-xs text-muted-foreground">{row.vehicleRegistration || "—"}</div></TableCell><TableCell>USD {money(row.charges)}</TableCell><TableCell>USD {money(row.adjustments)}</TableCell><TableCell>USD {money(row.received)}</TableCell><TableCell className={balance > 0 ? "font-medium text-destructive" : balance < 0 ? "font-medium text-emerald-600" : "font-medium"}>USD {money(balance)}</TableCell><TableCell><StatusBadge value={balance > 0 ? "overdue" : balance < 0 ? "credit" : "paid"}/></TableCell></TableRow>; })}</DataTable></CardContent></Card></TabsContent>

    <TabsContent value="refunds"><MasterTable title="Learner credits and refunds" description="Account credits complete on approval. External refunds are paid by the school that collected the money and cash refunds reduce that school's cash in hand." button="Request refund / credit" canAdd={can("transport.refunds.request") || canManageLegacy} onAdd={() => open("refund")} heads={["Refund", "Learner", "Type", "Method", "Amount", "Effective", "Status", "Actions"]} rows={data.refunds.map((refund: any) => <TableRow key={refund.id}><TableCell className="font-medium">{refund.refundNumber}</TableCell><TableCell>{data.students.find((student: any) => student.id === refund.studentId)?.firstName || "—"} {data.students.find((student: any) => student.id === refund.studentId)?.lastName || ""}</TableCell><TableCell>{titleCase(refund.refundType)}</TableCell><TableCell>{titleCase(refund.method)}</TableCell><TableCell>USD {money(refund.amount)}</TableCell><TableCell>{refund.effectiveDate}</TableCell><TableCell><StatusBadge value={refund.status}/></TableCell><TableCell><div className="flex gap-1">{refund.status === "requested" && (can("transport.refunds.approve") || canManageLegacy) && <Button size="sm" onClick={() => mutate.mutate({ url: `/api/transport/refunds/${refund.id}/approve` })}>Approve</Button>}{["approved","approved_awaiting_payment"].includes(refund.status) && refund.method !== "credit" && (can("transport.refunds.pay") || canManageLegacy) && <Button size="sm" variant="outline" onClick={() => open("payRefund", refund)}>Record payout</Button>}</div></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="cashups"><MasterTable title="Daily cash handover" description="Reception selects the receipts/refunds; FCGS calculates the authoritative cash and non-cash handover amounts. Accounts verifies those same system totals or flags a discrepancy for investigation." button="Prepare cash-up" canAdd={can("transport.cashups.prepare") || canManageLegacy} onAdd={prepareCashup} heads={["Cash-up", "Date", "System handover", "Accounts verification", "Status", "Actions"]} rows={data.cashups.map((cashup: any) => <TableRow key={cashup.id}><TableCell className="font-medium">{cashup.cashupNumber}</TableCell><TableCell>{cashup.cashupDate}</TableCell><TableCell><div>Cash: USD {money(cashup.actualCash)}</div><div className="text-xs text-muted-foreground">Non-cash: USD {money(cashup.actualNonCash)}</div></TableCell><TableCell>{cashup.verifiedAt ? <><div className="font-medium">Verified</div><div className="text-xs text-muted-foreground">USD {money(Number(cashup.actualCash || 0) + Number(cashup.actualNonCash || 0))}</div></> : cashup.accountsDiscrepancyReason ? <><Badge variant="destructive">Discrepancy flagged</Badge><div className="mt-1 max-w-[240px] text-xs text-muted-foreground">{cashup.accountsDiscrepancyReason}</div></> : "Awaiting Accounts"}</TableCell><TableCell><StatusBadge value={cashup.status}/></TableCell><TableCell><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => void openTransportPdf(`/api/transport/cashups/${cashup.id}/print`)}><FileText className="mr-1 h-3.5 w-3.5"/>{cashup.status === "draft" ? "Preview Cash-Up" : "View Acknowledgement"}</Button>{cashup.status === "draft" && Number(cashup.cashierUserId) === Number(data.currentUserId) && <><Button size="sm" variant="outline" disabled={cashupDraftLoading} onClick={() => void resumeCashupDraft(cashup)}>Open / Edit Draft</Button><Button size="sm" variant="destructive" onClick={() => void discardCashupDraft(cashup)}>Discard Draft</Button><Button size="sm" onClick={() => setCashupAction({ cashup, mode:"submit" })}>Submit & Sign</Button></>}{cashup.status === "submitted" && (can("transport.cashups.verify") || canManageLegacy) && <Button size="sm" onClick={() => setCashupAction({ cashup, mode:"verify" })}>Accounts Verify</Button>}</div></TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="billingRuns">
      <MasterTable title="Billing Runs" description="Process monthly charges and eligible existing credits from one guided action. Completed runs and receipts remain auditable." button="Process Monthly Billing" canAdd={can("transport.charges.generate", "transport.create")} onAdd={() => {setCreditPreview(null);setBillingOutcome(null);setCreditOpen(true);}} heads={["Run", "Service month", "Started", "Generated", "Skipped", "Suspended", "Seats released", "Failed", "Total", "Status"]} rows={(data.billingRuns || []).map((run: any) => <TableRow key={run.id}><TableCell className="font-medium">{run.runNumber || `Run ${run.id}`}</TableCell><TableCell>{MONTHS[Number(run.serviceMonth || 1)-1]} {run.serviceYear}</TableCell><TableCell>{run.createdAt ? new Date(run.createdAt).toLocaleString() : "—"}</TableCell><TableCell>{run.generatedCount ?? run.successCount ?? 0}</TableCell><TableCell>{run.skippedCount ?? 0}</TableCell><TableCell>{Number(run.details?.newlySuspended || 0)}</TableCell><TableCell>{Number(run.details?.seatsReleasedImmediately || 0)}</TableCell><TableCell>{run.failedCount ?? 0}</TableCell><TableCell>USD {money(run.totalAmount)}{Number(run.details?.creditAllocationCount || 0) > 0 && <div className="text-xs text-muted-foreground">Credit allocated: USD {money(run.details.creditAllocationTotal)} ({run.details.creditAllocationCount})</div>}</TableCell><TableCell><StatusBadge value={run.status || "completed"}/></TableCell></TableRow>)}/>
    </TabsContent>
  </Tabs>
  <Dialog open={creditOpen} onOpenChange={(isOpen) => { if (!creditLoading) { setCreditOpen(isOpen); setCreditPreview(null); } }}>
    <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle>Process Monthly Billing</DialogTitle>
      <DialogDescription>Charges and existing credits are handled in one guided workflow. Existing financial controls, held future credit and frozen settlement periods remain protected.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberField label="Service year" value={creditYear} min={2020} max={2200} onChange={(v: string) => { setCreditYear(Number(v)); setCreditPreview(null); setBillingOutcome(null); }}/>
          <MonthSelector label="Service month" value={creditMonth} onChange={(v: any) => { setCreditMonth(Number(v)); setCreditPreview(null); setBillingOutcome(null); }}/>
        </div>
        {billingOutcome && <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" role="status"><p className="font-semibold">Monthly billing processed</p><p>Generated {Number(billingOutcome.created||0)} charge(s); skipped {Number(billingOutcome.skipped||0)}; total generated USD {money(billingOutcome.total)}.</p><p>Automatic credit allocations: {Number(billingOutcome.creditAllocationCount||0)} · USD {money(billingOutcome.creditAllocationTotal)}.</p><p className="text-muted-foreground">You may now review remaining eligible credits below if necessary. Previously reconciled claims are not modified.</p></div>}
        {!(data.billingRuns || []).some((run:any) => Number(run.serviceYear)===creditYear && Number(run.serviceMonth)===creditMonth && String(run.status||"completed")==="completed") ? <div className="space-y-3 rounded-lg border p-4">
          <p className="font-medium">Monthly charges have not been completed for this period</p>
          <p className="text-sm text-muted-foreground">Generate any missing charges for {MONTHS[creditMonth-1]} {creditYear}. The existing billing engine skips duplicate charges and automatically allocates eligible credits. Deliberately held credits are not touched.</p>
          <Field label="Charge due date"><Input type="date" value={billingDueDate} onChange={e=>setBillingDueDate(e.target.value)}/></Field>
          <Button type="button" disabled={creditLoading||!billingDueDate||creditYear<2020||creditMonth<1||creditMonth>12||!can("transport.charges.generate", "transport.create")} onClick={()=>void runBillingGeneration()}>{creditLoading ? "Processing…" : "Confirm & Process Monthly Billing"}</Button>
        </div> : <div className="space-y-3 rounded-lg border p-4"><p className="font-medium">Billing run found for this service period</p><p className="text-sm text-muted-foreground">Review credits against existing charges. This month is the upper limit: eligible earlier unpaid charges may also receive credit. Reconciliation does not regenerate charges or alter locked claims.</p>
        <details className="rounded border p-3 text-sm"><summary className="cursor-pointer font-medium">New learners since the last billing run?</summary><p className="mt-2 text-muted-foreground">If learners were enrolled after billing was completed, the existing engine can generate only missing charges. Already billed learners are skipped. This is not necessary for ordinary credit reconciliation.</p>
          <div className="mt-3 space-y-2"><Field label="Charge due date"><Input type="date" value={billingDueDate} onChange={e=>setBillingDueDate(e.target.value)}/></Field><Button type="button" variant="outline" disabled={creditLoading||!billingDueDate||!can("transport.charges.generate", "transport.create")} onClick={()=>void runBillingGeneration()}>Process missing charges</Button></div>
        </details>
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={includeLegacyCredits}
            onChange={(e) => { setIncludeLegacyCredits(e.target.checked); setCreditPreview(null); }}/>
          <span><span className="font-medium">Include old receipts with unrecorded allocation intent</span><br/>
          Older payments were saved without their selected allocation policy. Leave off unless you have confirmed that these credits may settle the oldest eligible charges. The preview identifies their impact. Historical receipts and cash-ups will not change.</span>
        </label>
        <div className="flex justify-end"><Button variant="outline" type="button" disabled={creditLoading || creditYear < 2020 || creditMonth < 1 || creditMonth > 12} onClick={() => void showCreditPreview()}>{creditLoading ? 'Calculating…' : 'Preview allocation'}</Button></div>
        {creditPreview && <div className="space-y-3 rounded-md border p-4">
          <p className="font-medium">Reconciliation preview — through {MONTHS[creditPreview.month - 1]} {creditPreview.year}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <InfoBox label="To allocate" value={`USD ${money(creditPreview.totalToAllocate)}`}/>
            <InfoBox label="Allocations / learners" value={`${creditPreview.allocationCount} / ${creditPreview.studentCount}`}/>
            <InfoBox label="Unallocated afterward" value={`USD ${money(creditPreview.remainingUnallocated)}`}/>
          </div>
          <p className="text-xs text-muted-foreground">Excluded: held credit USD {money(creditPreview.excluded?.held)}, legacy unclassified USD {money(creditPreview.excluded?.legacy)}, refunded funds USD {money(creditPreview.excluded?.refunded)}, specifically designated USD {money(creditPreview.excluded?.specific)}. Locked settlement periods are not changed.</p>
          {creditPreview.includeLegacy && <Alert><AlertTriangle className="h-4 w-4"/><AlertTitle>Historical payment intent not recorded</AlertTitle><AlertDescription>You are explicitly authorizing oldest-eligible-charge allocation for old receipts whose original allocation choice cannot be proven. Check the preview before applying.</AlertDescription></Alert>}
          {creditPreview.allocationCount === 0 ? <p className="text-sm text-muted-foreground">No eligible credits can be allocated under these settings. Existing claims will remain unchanged.</p> : <>
            <div className="max-h-44 overflow-y-auto rounded-md border text-sm">
              {(creditPreview.allocations || []).slice(0, 150).map((row:any, i:number) => <div key={`${row.paymentId}-${row.chargeId}-${i}`} className="flex flex-wrap justify-between gap-2 border-b px-3 py-1.5 last:border-0"><span>Receipt #{row.paymentId} → Charge #{row.chargeId} · {MONTHS[Number(row.serviceMonth)-1]} {row.serviceYear}</span><strong>USD {money(row.amount)}</strong></div>)}
              {(creditPreview.allocations || []).length > 150 && <div className="p-2 text-muted-foreground">Showing first 150 allocations of {creditPreview.allocationCount}.</div>}
            </div>
            <p className="text-xs text-muted-foreground">The server rechecks balances before committing; a changed preview cannot be applied. Cash-up reconciliation remains mandatory for claims where configured.</p>
          </>}
        </div>}
        </div>}
      </div>
      <DialogFooter><Button variant="outline" type="button" disabled={creditLoading} onClick={() => { setCreditOpen(false); setCreditPreview(null); }}>Close</Button>
        {(data.billingRuns || []).some((run:any) => Number(run.serviceYear)===creditYear && Number(run.serviceMonth)===creditMonth && String(run.status||"completed")==="completed") && <Button type="button" disabled={!creditPreview || creditPreview.allocationCount === 0 || creditLoading || !can("transport.charges.generate", "transport.create")} onClick={() => void applyCreditPreview()}>{creditLoading ? 'Applying…' : `Apply ${creditPreview?.allocationCount || 0} allocation(s)`}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
  <Dialog open={Boolean(cashupDraftPrompt)} onOpenChange={(value) => !value && setCashupDraftPrompt(null)}><DialogContent><DialogHeader><DialogTitle>Unfinished cash-up found</DialogTitle><DialogDescription>You already have an unfinished draft cash-up{cashupDraftPrompt?.cashupDate ? ` for ${cashupDraftPrompt.cashupDate}` : ""}. Resume it, or deliberately prepare another cash-up if this is a separate handover.</DialogDescription></DialogHeader><DialogFooter className="gap-2 sm:justify-end"><Button variant="outline" onClick={() => setCashupDraftPrompt(null)}>Cancel</Button><Button variant="outline" onClick={() => { setCashupDraftPrompt(null); open("cashup"); }}>Prepare Another Cash-Up</Button><Button disabled={cashupDraftLoading} onClick={() => void resumeCashupDraft(cashupDraftPrompt)}>{cashupDraftLoading ? "Loading…" : "Resume Draft"}</Button></DialogFooter></DialogContent></Dialog>
  <CashupActionDialog action={cashupAction} close={() => setCashupAction(null)}/></>;
}

function CashupActionDialog({ action, close }: any) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [discrepancyReason, setDiscrepancyReason] = useState("");
  const [operation, setOperation] = useState<"verify" | "flag">("verify");
  useEffect(() => { setPassword(""); setNotes(""); setDiscrepancyReason(""); setOperation("verify"); }, [action?.cashup?.id, action?.mode]);
  const { data, isFetching } = useQuery<any>({
    queryKey: ["/api/transport/cashups/detail", action?.cashup?.id],
    queryFn: async () => {
      const response = await schoolFetch(`/api/transport/cashups/${action.cashup.id}/detail`);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    enabled: Boolean(action?.cashup?.id),
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (action.mode === "submit") return fetchJson("POST", `/api/transport/cashups/${action.cashup.id}/submit`, { password });
      if (operation === "flag") return fetchJson("POST", `/api/transport/cashups/${action.cashup.id}/flag-discrepancy`, { discrepancyReason, notes: notes || null, password });
      return fetchJson("POST", `/api/transport/cashups/${action.cashup.id}/verify`, { notes: notes || null, password });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/transport/bootstrap"] });
      toast({ title: action?.mode === "submit" ? "Cash-up submitted and signed" : operation === "flag" ? "Discrepancy flagged for investigation" : "Cash-up verified and signed" });
      close();
    },
    onError: (error:any) => toast({ title: "Cash-up action failed", description: readableError(error), variant: "destructive" }),
  });
  const cash = Number(action?.cashup?.actualCash || 0);
  const nonCash = Number(action?.cashup?.actualNonCash || 0);
  const total = cash + nonCash;
  return <Dialog open={Boolean(action)} onOpenChange={(openState) => !openState && close()}><DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
    <DialogHeader><DialogTitle>{action?.mode === "submit" ? "Submit & Sign Cash-Up" : "Accounts Verification"}</DialogTitle><DialogDescription>{action?.mode === "submit" ? "Review the system-calculated handover and authorize your stored signature with your account password. The financial amounts cannot be changed." : "Review the exact system-calculated handover. Accounts can either Verify & Sign those figures or Flag Discrepancy without entering replacement amounts."}</DialogDescription></DialogHeader>
    {isFetching ? <div className="py-6 text-center text-muted-foreground">Loading cash-up…</div> : <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><InfoBox label="Cash-up" value={action?.cashup?.cashupNumber || "—"}/><InfoBox label="Date" value={action?.cashup?.cashupDate || "—"}/><InfoBox label="Cash handover" value={`USD ${money(cash)}`}/><InfoBox label="Non-cash handover" value={`USD ${money(nonCash)}`}/></div>
      <div className="rounded-md border bg-muted/30 p-4"><div className="text-sm text-muted-foreground">Authoritative system total</div><div className="mt-1 text-2xl font-semibold">USD {money(total)}</div><div className="mt-1 text-xs text-muted-foreground">Calculated from the receipts and applicable paid refunds included in this cash-up.</div></div>
      <Card><CardHeader><CardTitle className="text-base">Included receipts</CardTitle></CardHeader><CardContent><DataTable heads={["Receipt", "Learner", "Method", "Amount"]}>{(data?.linkedPayments || []).map((row:any) => <TableRow key={row.id}><TableCell className="font-medium">{row.receiptNo}</TableCell><TableCell>{row.firstName} {row.lastName}<div className="text-xs text-muted-foreground">{row.admissionNo}</div></TableCell><TableCell>{titleCase(row.paymentMethod)}</TableCell><TableCell>USD {money(row.amount)}</TableCell></TableRow>)}</DataTable></CardContent></Card>
      {action?.mode === "verify" && <>
        <div className="grid gap-2 sm:grid-cols-2"><Button type="button" variant={operation === "verify" ? "default" : "outline"} onClick={() => setOperation("verify")}>Verify & Sign</Button><Button type="button" variant={operation === "flag" ? "destructive" : "outline"} onClick={() => setOperation("flag")}>Flag Discrepancy</Button></div>
        {operation === "flag" && <Field label="Discrepancy reason"><Textarea value={discrepancyReason} onChange={(event) => setDiscrepancyReason(event.target.value)} placeholder="Describe what requires investigation. No replacement financial amount can be entered."/></Field>}
        <Field label="Accounts verification notes"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional notes about the review"/></Field>
      </>}
      <Field label="Account password"><Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your portal password to authorize this action"/></Field>
    </div>}
    <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button variant={action?.mode === "verify" && operation === "flag" ? "destructive" : "default"} disabled={mutation.isPending || !password || (action?.mode === "verify" && operation === "flag" && discrepancyReason.trim().length < 3)} onClick={() => mutation.mutate()}>{mutation.isPending ? "Authorizing…" : action?.mode === "submit" ? "Submit & Sign" : operation === "flag" ? "Flag Discrepancy" : "Verify & Sign"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function SettlementsWorkspace({ data, tab, setTab, open, can, canManageLegacy, mutate, openTransportPdf }: any) {
  const [claimStatus, setClaimStatus] = useState("all");
  const [payoutStatus, setPayoutStatus] = useState("all");
  const [claimDetail, setClaimDetail] = useState<any>(null);
  const [statementPeriod, setStatementPeriod] = useState(() => `${new Date().getFullYear()}-${String(currentMonth()).padStart(2, "0")}`);
  const [statementYear, statementMonth] = statementPeriod.split("-").map(Number);
  const statementClaims = data.claims.filter((claim: any) => Number(claim.serviceYear) === statementYear && Number(claim.serviceMonth) === statementMonth);
  const filteredClaims = data.claims.filter((claim:any) => (claimStatus === "all" || claim.status === claimStatus) && (payoutStatus === "all" || String(claim.payoutStatus || "not_paid") === payoutStatus));
  const mayReconcile = canManageLegacy || can("transport.claims.submit", "transport.claims.verify");
  const deadlines=useQuery<any>({queryKey:["/api/transport/settlement-deadlines",statementYear,statementMonth],queryFn:async()=>{const result=await schoolFetch(`/api/transport/settlement-deadlines?year=${statementYear}&month=${statementMonth}`);if(!result.ok)throw new Error(await result.text());return result.json();}});
  const showDeadline=(value:any)=>value?new Date(value).toLocaleString("en-ZW",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Africa/Harare"}):"—";
  return <><Tabs value={tab} onValueChange={setTab}>
    <div className="overflow-x-auto pb-1"><TabsList className="w-max justify-start"><TabsTrigger value="claims">Claims</TabsTrigger><TabsTrigger value="payouts">Payouts</TabsTrigger><TabsTrigger value="subscriptions">Subscriptions</TabsTrigger><TabsTrigger value="penalties">Penalties</TabsTrigger><TabsTrigger value="advances">Advances</TabsTrigger><TabsTrigger value="statement">Monthly Statement</TabsTrigger></TabsList></div>

    <TabsContent value="claims"><Card><CardHeader className="gap-3 xl:flex-row xl:items-end xl:justify-between"><div><CardTitle>School Vehicle Claims</CardTitle><CardDescription>Generate, verify and submit claims for HQ settlement. <span className="inline-block text-xs" title="Payments received after the payment cut-off, after HQ submission, or without the required cash-up verification are included in a later eligible settlement cycle.">Settlement deadline: {showDeadline(deadlines.data?.claimDeadline)} · Payment cut-off: {showDeadline(deadlines.data?.paymentDeadline)} · Deferred amounts: next eligible cycle.</span></CardDescription></div><div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end xl:w-auto xl:flex-nowrap"><div className="w-full sm:w-44"><Field label="Claim status"><SearchableSelect className="h-11 sm:h-9" value={claimStatus} onValueChange={setClaimStatus} options={["all","draft","disputed","submitted","paid","rejected","cancelled"].map(value=>({value,label:value==="all"?"All statuses":titleCase(value)}))}/></Field></div><div className="w-full sm:w-48"><Field label="Payout status"><SearchableSelect className="h-11 sm:h-9" value={payoutStatus} onValueChange={setPayoutStatus} options={["all","not_paid","partially_paid","paid"].map(value=>({value,label:value==="all"?"All payout statuses":titleCase(value)}))}/></Field></div>{(can("transport.claims.generate") || canManageLegacy)&&<Button className="min-h-11 w-full sm:min-h-9 sm:w-auto" onClick={()=>open("claim")}><Plus className="mr-2 h-4 w-4"/>Generate Claim</Button>}</div></CardHeader><CardContent><DataTable heads={["Claim","Vehicle","Service month","Gross","Deductions","Net","Reconciliation","Claim status","HQ claim","Payout","Outstanding","Actions"]}>{filteredClaims.map((claim:any)=>{const paid=Number(claim.paidAmount||0), net=Number(claim.netAmount||0); return <TableRow key={claim.id}><TableCell><button className="font-medium hover:underline" type="button" onClick={()=>setClaimDetail(claim)}>{claim.claimNumber}</button>{claim.manualClaimReference&&<div className="text-xs text-muted-foreground">Manual: {claim.manualClaimReference}</div>}</TableCell><TableCell>{(data.allVehicles||data.vehicles).find((v:any)=>v.id===claim.vehicleId)?.registrationNumber||"—"}</TableCell><TableCell>{MONTHS[Number(claim.serviceMonth)-1]} {claim.serviceYear}</TableCell><TableCell>USD {money(claim.grossAmount)}</TableCell><TableCell>USD {money(claim.deductionAmount)}</TableCell><TableCell className="font-semibold">USD {money(claim.netAmount)}</TableCell><TableCell><StatusBadge value={claim.reconciliationStatus || "not_reconciled"}/></TableCell><TableCell><StatusBadge value={claim.status}/></TableCell><TableCell>{claim.hqClaimNumber ? <span className="font-medium">{claim.hqClaimNumber}</span> : "—"}</TableCell><TableCell><StatusBadge value={claim.payoutStatus||"not_paid"}/><div className="mt-1 text-xs text-muted-foreground">Paid USD {money(paid)}</div></TableCell><TableCell>USD {money(Math.max(0,net-paid))}</TableCell><TableCell><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={()=>setClaimDetail(claim)}>View claim</Button><Button size="sm" variant="ghost" onClick={()=>void openTransportPdf(`/api/transport/claims/${claim.id}/print`)}><FileText className="mr-1 h-3.5 w-3.5"/>PDF</Button><Button size="sm" variant="ghost" onClick={()=>void openTransportPdf(`/api/transport/claims/${claim.id}/print?driverSummary=1`)}>Driver summary</Button>{mayReconcile && ["draft","disputed"].includes(String(claim.status)) && <Button size="sm" variant="outline" onClick={()=>setClaimDetail({...claim, initialMode: claim.status === "disputed" ? "resolve" : "reconcile"})}>{claim.status === "disputed" ? "Resolve dispute" : "Reconcile"}</Button>}{claim.status==="draft"&&["matched","resolved"].includes(String(claim.reconciliationStatus))&&mayReconcile&&<Button size="sm" onClick={()=>mutate.mutate({url:`/api/transport/claims/${claim.id}/status`,body:{status:"submitted"}})}>Submit to HQ</Button>}</div></TableCell></TableRow>})}</DataTable></CardContent></Card></TabsContent>

    <TabsContent value="payouts"><Card><CardHeader><CardTitle>Provider Payouts</CardTitle><CardDescription>Once a reconciled school claim is submitted, HQ prepares the payable and records the actual provider disbursement. This view shows the resulting payment status for this school's attributable claims.</CardDescription></CardHeader><CardContent><DataTable heads={["Claim","HQ Claim","Vehicle","Net attributable","Payout status","Paid at HQ","Outstanding"]}>{data.claims.filter((claim:any)=>["submitted","verified","approved","paid"].includes(String(claim.status))).map((claim:any)=>{const net=Number(claim.netAmount||0),paid=Number(claim.paidAmount||0);return <TableRow key={claim.id}><TableCell><button type="button" className="font-medium hover:underline" onClick={()=>setClaimDetail(claim)}>{claim.claimNumber}</button></TableCell><TableCell>{claim.hqClaimNumber||"Awaiting HQ preparation"}</TableCell><TableCell>{(data.allVehicles||data.vehicles).find((v:any)=>v.id===claim.vehicleId)?.registrationNumber||"—"}</TableCell><TableCell>USD {money(net)}</TableCell><TableCell><StatusBadge value={claim.payoutStatus||"not_paid"}/></TableCell><TableCell>USD {money(paid)}</TableCell><TableCell>USD {money(Math.max(0,net-paid))}</TableCell></TableRow>})}</DataTable></CardContent></Card></TabsContent>

    <TabsContent value="subscriptions"><Card><CardHeader><CardTitle>Subscription Rules</CardTitle><CardDescription>Organisation policy managed at HQ. Rules are monthly, historical, and immutable once frozen into submitted accounting/settlement records.</CardDescription></CardHeader><CardContent><DataTable heads={["Scope","Rule","Value","Starts","Status","Notes"]}>{(data.subscriptionPolicies||[]).map((rule:any)=><TableRow key={rule.id}><TableCell>{rule.vehicleId ? (data.allVehicles||[]).find((v:any)=>v.id===rule.vehicleId)?.registrationNumber||`Vehicle ${rule.vehicleId}` : "Organisation default"}</TableCell><TableCell>{titleCase(rule.ruleType)}</TableCell><TableCell>{rule.ruleType==="fixed"?`USD ${money(rule.value)}`:`${money(rule.value)}%`}</TableCell><TableCell>{MONTHS[Number(rule.startMonth)-1]} {rule.startYear}</TableCell><TableCell><StatusBadge value={rule.status}/></TableCell><TableCell>{rule.notes||"—"}</TableCell></TableRow>)}</DataTable></CardContent></Card></TabsContent>
    <TabsContent value="penalties"><MasterTable title="Vehicle penalties" description="Configurable categories become controlled deductions on the relevant school payout." button="Add penalty" canAdd={can("transport.penalties.manage") || canManageLegacy} onAdd={() => open("penalty")} heads={["Penalty", "Vehicle", "Category", "Incident date", "Period", "Amount", "Status", "Reason"]} rows={data.penalties.map((penalty: any) => <TableRow key={penalty.id}><TableCell className="font-medium">{penalty.penaltyNumber}</TableCell><TableCell>{data.vehicles.find((vehicle: any) => vehicle.id === penalty.vehicleId)?.registrationNumber || "—"}</TableCell><TableCell>{titleCase(penalty.category)}</TableCell><TableCell>{penalty.incidentDate}</TableCell><TableCell>{penalty.effectiveYear}-{String(penalty.effectiveMonth).padStart(2, "0")}</TableCell><TableCell>USD {money(penalty.amount)}</TableCell><TableCell><StatusBadge value={penalty.status}/></TableCell><TableCell className="max-w-xs whitespace-normal">{penalty.reason}</TableCell></TableRow>)}/></TabsContent>

    <TabsContent value="advances"><MasterTable title="Vehicle advances" description="Recovery rules protect a configurable owner take-home and never create a negative payout." button="Request advance" canAdd={can("transport.advances.request") || canManageLegacy} onAdd={() => open("advance")} heads={["Advance", "Vehicle", "Original", "Outstanding", "Recovery", "Starts", "Status", "Purpose", "Actions"]} rows={data.advances.map((advance: any) => <TableRow key={advance.id}><TableCell className="font-medium">{advance.advanceNumber}</TableCell><TableCell>{data.vehicles.find((vehicle: any) => vehicle.id === advance.vehicleId)?.registrationNumber || "—"}</TableCell><TableCell>USD {money(advance.amount)}</TableCell><TableCell>USD {money(advance.outstandingAmount)}</TableCell><TableCell>{titleCase(advance.recoveryMethod)} · {advance.recoveryMethod === "percentage" ? `${money(advance.recoveryValue)}%` : `USD ${money(advance.recoveryValue)}`}</TableCell><TableCell>{advance.recoveryStartYear}-{String(advance.recoveryStartMonth).padStart(2, "0")}</TableCell><TableCell><StatusBadge value={advance.status}/></TableCell><TableCell className="max-w-xs whitespace-normal">{advance.purpose}</TableCell><TableCell><div className="flex flex-wrap gap-1">{advance.status === "requested" && (can("transport.advances.approve") || canManageLegacy) && <Button size="sm" onClick={() => mutate.mutate({ url: `/api/transport/advances/${advance.id}/approve` })}>Approve</Button>}{advance.status === "requested" && (can("transport.advances.approve") || canManageLegacy) && <Button size="sm" variant="destructive" onClick={() => open("rejectAdvance", advance)}>Reject</Button>}{advance.status === "approved" && (can("transport.advances.disburse") || canManageLegacy) && <Button size="sm" onClick={() => open("disburseAdvance", advance)}>Disburse</Button>}{["disbursed","recovering"].includes(advance.status) && Number(advance.outstandingAmount)>0 && can("transport.advances.repayments.record") && <Button size="sm" variant="outline" onClick={()=>open("advanceRepayment",advance)}>Record repayment</Button>}</div></TableCell></TableRow>)}/><div className="mt-3 rounded-md border p-3"><div className="mb-2 text-sm font-medium">Direct advance repayments · verified principal recoveries</div><div className="space-y-2">{(data.advanceRepayments||[]).map((r:any)=><div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-xs"><span>Advance #{r.advanceId} · USD {money(r.amount)} · {r.paymentDate} · {titleCase(r.paymentMethod)} · {r.paymentReference} · <StatusBadge value={r.status}/></span>{r.status==="pending"&&can("transport.advances.repayments.verify")&&<div className="flex gap-2"><Button size="sm" onClick={()=>open("verifyAdvanceRepayment",r)}>Verify</Button><Button size="sm" variant="outline" onClick={()=>open("rejectAdvanceRepayment",r)}>Reject</Button></div>}</div>)}</div></div></TabsContent>

    <TabsContent value="statement"><Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Monthly Transport Settlement Statement</CardTitle><CardDescription>Consolidated school-level summary of vehicle claims and HQ payout status.</CardDescription></div><div className="flex items-end gap-2"><Field label="Service month"><Input type="month" value={statementPeriod} onChange={(event) => setStatementPeriod(event.target.value)}/></Field><Button variant="outline" onClick={() => void openTransportPdf(`/api/transport/settlements/statement/print?year=${statementYear}&month=${statementMonth}`)}><FileText className="mr-2 h-4 w-4"/>View PDF</Button></div></div></CardHeader><CardContent><DataTable heads={["Vehicle", "Claim", "Service month", "Gross", "Deductions", "Net", "Paid", "Outstanding", "Status"]}>{statementClaims.map((claim: any) => {
      const payout = data.payouts.find((row: any) => row.claimId === claim.id);
      const paid = Number(claim.paidAmount || payout?.amountPaid || 0);
      return <TableRow key={claim.id}><TableCell>{data.vehicles.find((vehicle: any) => vehicle.id === claim.vehicleId)?.registrationNumber || "—"}</TableCell><TableCell><button className="font-medium hover:underline" onClick={()=>setClaimDetail(claim)}>{claim.claimNumber}</button></TableCell><TableCell>{claim.serviceYear}-{String(claim.serviceMonth).padStart(2, "0")}</TableCell><TableCell>USD {money(claim.grossAmount)}</TableCell><TableCell>USD {money(claim.deductionAmount)}</TableCell><TableCell>USD {money(claim.netAmount)}</TableCell><TableCell>USD {money(paid)}</TableCell><TableCell>USD {money(Math.max(0, Number(claim.netAmount) - paid))}</TableCell><TableCell><StatusBadge value={claim.payoutStatus || claim.status}/></TableCell></TableRow>;
    })}</DataTable></CardContent></Card></TabsContent>
  </Tabs><ClaimDetailDialog claim={claimDetail} close={()=>setClaimDetail(null)} mayReconcile={mayReconcile} openTransportPdf={openTransportPdf}/></>;
}

function ClaimDetailDialog({ claim, close, mayReconcile, openTransportPdf }: any) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"view"|"reconcile"|"resolve">("view");
  const [manualReference, setManualReference] = useState("");
  const [manualDocument, setManualDocument] = useState("");
  const [outcome, setOutcome] = useState("matched");
  const [notes, setNotes] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [resolution, setResolution] = useState("");
  useEffect(()=>{
    if (!claim) return;
    setMode(claim.initialMode || "view"); setManualReference(claim.manualClaimReference || ""); setManualDocument(claim.manualClaimDocument || ""); setOutcome(claim.reconciliationStatus === "disputed" ? "disputed" : "matched"); setNotes(claim.reconciliationNotes || ""); setDisputeReason(claim.disputeReason || ""); setResolution(claim.disputeResolution || "");
  },[claim?.id, claim?.initialMode]);
  const details = useQuery<any>({queryKey:["/api/transport/claims/detail",claim?.id],enabled:Boolean(claim?.id),queryFn:async()=>{const r=await schoolFetch(`/api/transport/claims/${claim.id}/detail`);if(!r.ok)throw new Error(await r.text());return r.json();}});
  const action = useMutation({mutationFn:async()=> mode === "resolve" ? fetchJson("POST",`/api/transport/claims/${claim.id}/resolve-dispute`,{resolution,notes:notes||null}) : fetchJson("POST",`/api/transport/claims/${claim.id}/reconcile`,{manualClaimReference:manualReference,manualClaimDocument:manualDocument||null,outcome,notes:notes||null,disputeReason:outcome==="disputed"?disputeReason||null:null}),onSuccess:async()=>{await queryClient.invalidateQueries({queryKey:["/api/transport/bootstrap"]});await details.refetch();toast({title:mode==="resolve"?"Claim dispute resolved":"Claim reconciliation saved"});setMode("view")},onError:(e:any)=>toast({title:"Claim action failed",description:readableError(e),variant:"destructive"})});
  const row=details.data?.claim || claim;
  const canSave = mode === "resolve" ? resolution.trim().length >= 3 : Boolean(manualReference.trim()) && (outcome !== "disputed" || Boolean(disputeReason.trim()));
  return <Dialog open={Boolean(claim)} onOpenChange={(openState)=>!openState&&close()}><DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>{row?.claimNumber || "Vehicle Claim"}</DialogTitle><DialogDescription>System claim, provider manual-claim reconciliation and the receipts that make up this claim.</DialogDescription></DialogHeader>{details.isFetching?<div className="py-8 text-center text-muted-foreground">Loading claim…</div>:details.error?<Alert variant="destructive"><AlertTriangle className="h-4 w-4"/><AlertTitle>Unable to load claim</AlertTitle><AlertDescription>{readableError(details.error)}</AlertDescription></Alert>:<div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><InfoBox label="Vehicle" value={details.data?.vehicle?.registrationNumber || "—"}/><InfoBox label="Provider / Owner" value={details.data?.owner?.name || "FCGS"}/><InfoBox label="Driver" value={details.data?.driver ? `${details.data.driver.firstName} ${details.data.driver.lastName}` : "—"}/><InfoBox label="Gross" value={`USD ${money(row?.grossAmount)}`}/><InfoBox label="Deductions" value={`USD ${money(row?.deductionAmount)}`}/><InfoBox label="Net payable" value={`USD ${money(row?.netAmount)}`}/></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><InfoBox label="Claim status" value={titleCase(row?.status)}/><InfoBox label="Reconciliation" value={titleCase(row?.reconciliationStatus || "not reconciled")}/><InfoBox label="Manual claim reference" value={row?.manualClaimReference || "Not captured"}/><InfoBox label="Service month" value={`${MONTHS[Number(row?.serviceMonth||1)-1]} ${row?.serviceYear||""}`}/></div>
    {row?.disputeReason&&<Alert variant={row?.reconciliationStatus==="resolved"?"default":"destructive"}><AlertTriangle className="h-4 w-4"/><AlertTitle>{row?.reconciliationStatus==="resolved"?"Resolved dispute":"Claim dispute"}</AlertTitle><AlertDescription>{row.disputeReason}{row.disputeResolution?` Resolution: ${row.disputeResolution}`:""}</AlertDescription></Alert>}
    {mode === "reconcile" && <Card><CardHeader><CardTitle className="text-base">Compare provider manual claim</CardTitle><CardDescription>Record the manual form reference and whether it agrees with the system-calculated claim.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2"><Field label="Manual claim reference"><Input value={manualReference} onChange={e=>setManualReference(e.target.value)} placeholder="e.g. provider form number"/></Field><Field label="Manual claim document / file reference"><Input value={manualDocument} onChange={e=>setManualDocument(e.target.value)} placeholder="Optional scanned-file or document reference"/></Field><Field label="Reconciliation outcome"><SearchableSelect value={outcome} onValueChange={setOutcome} options={[{value:"matched",label:"Matched — no dispute"},{value:"disputed",label:"Disputed — amounts/details differ"}]}/></Field>{outcome==="disputed"&&<Field label="Dispute reason"><Textarea value={disputeReason} onChange={e=>setDisputeReason(e.target.value)} placeholder="Describe the difference that must be resolved"/></Field>}<div className="md:col-span-2"><Field label="Reconciliation notes"><Textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional comparison notes"/></Field></div></CardContent></Card>}
    {mode === "resolve" && <Card><CardHeader><CardTitle className="text-base">Resolve claim dispute</CardTitle><CardDescription>Record the agreed resolution before the claim can be submitted to HQ.</CardDescription></CardHeader><CardContent className="space-y-3"><Field label="Resolution"><Textarea value={resolution} onChange={e=>setResolution(e.target.value)} placeholder="State the agreed correction or resolution"/></Field><Field label="Notes"><Textarea value={notes} onChange={e=>setNotes(e.target.value)}/></Field></CardContent></Card>}
    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">Receipts included in this claim</CardTitle><CardDescription>Click a receipt number to open the immutable Transport receipt.</CardDescription></div><Button variant="outline" size="sm" onClick={()=>void openTransportPdf(`/api/transport/claims/${claim.id}/print`)}><FileText className="mr-1 h-3.5 w-3.5"/>Claim PDF</Button></CardHeader><CardContent><DataTable heads={["Receipt","Learner","Class","Destination / Stop","Payment date","Method","Claim amount"]}>{(details.data?.allocations||[]).map((a:any)=><TableRow key={a.id}><TableCell><button className="font-medium hover:underline" onClick={()=>void openTransportPdf(`/api/transport/receipts/${a.paymentId}/print`)}>{a.receiptNo}</button></TableCell><TableCell>{a.firstName} {a.lastName}<div className="text-xs text-muted-foreground">{a.admissionNo}</div></TableCell><TableCell>{a.className||"—"}</TableCell><TableCell>{a.routeName||"—"}<div className="text-xs text-muted-foreground">{a.stopName||"—"}</div></TableCell><TableCell>{a.paymentDate}</TableCell><TableCell>{titleCase(a.paymentMethod)}</TableCell><TableCell>USD {money(a.amount)}</TableCell></TableRow>)}</DataTable></CardContent></Card>
  </div>}<DialogFooter><Button variant="outline" onClick={close}>Close</Button>{mode==="view"&&mayReconcile&&["draft","disputed"].includes(String(row?.status))&&<Button variant="outline" onClick={()=>setMode(row?.status==="disputed"?"resolve":"reconcile")}>{row?.status==="disputed"?"Resolve dispute":"Reconcile manual claim"}</Button>}{mode!=="view"&&<Button variant="outline" onClick={()=>setMode("view")}>Back</Button>}{mode!=="view"&&<Button disabled={action.isPending||!canSave} onClick={()=>action.mutate()}>{action.isPending?"Saving…":mode==="resolve"?"Save resolution":"Save reconciliation"}</Button>}</DialogFooter></DialogContent></Dialog>;
}

function ReportsAuditWorkspace({ data, reportData, reportFrom, reportTo, setReportFrom, setReportTo, refreshReport, loading, openTransportPdf }: any) {
  const current = new Date();
  const [statementMonth, setStatementMonth] = useState(`${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,"0")}`);
  const [statementStudentId, setStatementStudentId] = useState("");
  const [year, month] = statementMonth.split("-").map(Number);
  const statementFrom = `${year}-${String(month).padStart(2,"0")}-01`;
  const statementTo = `${year}-${String(month).padStart(2,"0")}-${String(new Date(year, month, 0).getDate()).padStart(2,"0")}`;
  const learnerStatement = useQuery<any>({
    queryKey:["/api/transport/reports/learner-statement",statementStudentId,statementFrom,statementTo],
    enabled:Boolean(statementStudentId),
    queryFn:async()=>{const r=await schoolFetch(`/api/transport/reports/learner-statement?studentId=${statementStudentId}&from=${statementFrom}&to=${statementTo}`);if(!r.ok)throw new Error(await r.text());return r.json();}
  });
  const learnerOptions=(data.learnerAccounts||[]).map((row:any)=>({value:String(row.studentId),label:`${row.firstName} ${row.lastName} · ${row.admissionNo||"No admission no."}`,searchText:`${row.firstName} ${row.lastName} ${row.admissionNo||""}`}));
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>Periodic totals</CardTitle><CardDescription>Daily, weekly, fortnightly, monthly and custom reporting are represented by explicit date ranges.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap items-end gap-3"><Field label="From"><Input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)}/></Field><Field label="To"><Input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)}/></Field><Button onClick={() => refreshReport()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4"/>Apply period</Button><Button variant="outline" onClick={() => void openTransportPdf(`/api/transport/reports/summary/print?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`)}><FileText className="mr-2 h-4 w-4"/>View PDF</Button><PresetPeriods onApply={(from: string, to: string) => { setReportFrom(from); setReportTo(to); }}/></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[["Charged", reportData?.summary?.charged], ["Received", reportData?.summary?.received], ["Refunds", reportData?.summary?.refunds], ["Claim gross", reportData?.summary?.claim_gross], ["Payout net", reportData?.summary?.payout_net]].map(([label, value]) => <Card key={label as string}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-bold">USD {money(value)}</div></CardContent></Card>)}</div>
      <DataTable heads={["Payment method", "Transactions", "Amount"]}>{(reportData?.byMethod || []).map((row: any) => <TableRow key={row.method}><TableCell>{titleCase(row.method)}</TableCell><TableCell>{row.count}</TableCell><TableCell>USD {money(row.amount)}</TableCell></TableRow>)}</DataTable>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Learner Transport Statement</CardTitle><CardDescription>Select a learner and month to see the opening balance and every Transport charge, receipt, credit/adjustment and refund transaction in that period. Receipt numbers remain clickable.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap items-end gap-3"><div className="min-w-72 flex-1"><Field label="Learner"><SearchableSelect value={statementStudentId} onValueChange={setStatementStudentId} options={learnerOptions} placeholder="Select learner" searchPlaceholder="Search learner or admission number…"/></Field></div><Field label="Statement month"><Input type="month" value={statementMonth} onChange={e=>setStatementMonth(e.target.value)}/></Field><Button variant="outline" disabled={!statementStudentId} onClick={()=>void openTransportPdf(`/api/transport/reports/learner-statement/print?studentId=${statementStudentId}&from=${statementFrom}&to=${statementTo}`)}><FileText className="mr-2 h-4 w-4"/>View Statement PDF</Button></div>
      {!statementStudentId?<p className="text-sm text-muted-foreground">Select a learner to generate the statement.</p>:learnerStatement.isFetching?<p className="text-sm text-muted-foreground">Loading learner statement…</p>:learnerStatement.error?<Alert variant="destructive"><AlertTriangle className="h-4 w-4"/><AlertTitle>Unable to load statement</AlertTitle><AlertDescription>{readableError(learnerStatement.error)}</AlertDescription></Alert>:<><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><InfoBox label="Opening balance" value={`USD ${money(learnerStatement.data?.openingBalance)}`}/><InfoBox label="Debits / charges" value={`USD ${money(learnerStatement.data?.totalCharges)}`}/><InfoBox label="Payments / credits" value={`USD ${money(learnerStatement.data?.totalCredits)}`}/><InfoBox label="Closing balance" value={`USD ${money(learnerStatement.data?.closingBalance)}`}/></div><DataTable heads={["Date","Reference","Transaction","Debit","Credit","Balance"]}>{(learnerStatement.data?.transactions||[]).map((row:any,index:number)=><TableRow key={`${row.kind}-${row.reference}-${index}`}><TableCell>{row.date}</TableCell><TableCell>{row.kind==="payment"&&row.recordId?<button className="font-medium hover:underline" onClick={()=>void openTransportPdf(`/api/transport/receipts/${row.recordId}/print`)}>{row.reference}</button>:<span className="font-medium">{row.reference}</span>}</TableCell><TableCell>{row.description}</TableCell><TableCell>{row.debit?`USD ${money(row.debit)}`:"—"}</TableCell><TableCell>{row.credit?`USD ${money(row.credit)}`:"—"}</TableCell><TableCell>USD {money(row.balance)}</TableCell></TableRow>)}</DataTable></>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Transport audit trail</CardTitle><CardDescription>Detailed Transport-specific events supplement the portal-wide activity log.</CardDescription></CardHeader><CardContent><DataTable heads={["Date & time", "Record", "Action", "Effective date", "Reason", "User", "Details"]}>{data.audits.map((audit: any) => <TableRow key={audit.id}><TableCell>{new Date(audit.createdAt).toLocaleString()}</TableCell><TableCell><span className="font-medium">{audit.recordReference || "—"}</span><div className="text-xs text-muted-foreground">{titleCase(audit.entityType)}{audit.entityId ? ` #${audit.entityId}` : ""}</div></TableCell><TableCell><StatusBadge value={audit.action}/></TableCell><TableCell>{audit.effectiveDate || "—"}</TableCell><TableCell className="max-w-xs whitespace-normal">{audit.reason || "—"}</TableCell><TableCell>{audit.userName || "System"}</TableCell><TableCell><details className="max-w-md"><summary className="cursor-pointer text-sm font-medium">View details</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{JSON.stringify({ before: audit.previousValues || null, after: audit.newValues || null, metadata: audit.metadata || null }, null, 2)}</pre></details></TableCell></TableRow>)}</DataTable></CardContent></Card>
  </div>;
}

function SettingsWorkspace({ data, saving, onSave, canEdit, onUnsavedChange }: any) {
  const [editing,setEditing]=useState(false);
  const [form, setForm] = useState<any>(() => ({ ...data.settings }));
  useEffect(() => { if(!editing)setForm({ ...data.settings }); }, [data.settings,editing]);
  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(form)!==JSON.stringify(data.settings);
  useEffect(()=>{onUnsavedChange?.(editing && dirty);return ()=>onUnsavedChange?.(false)},[editing,dirty,onUnsavedChange]);
  useEffect(()=>{if(!editing||!dirty)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=""};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard)},[editing,dirty]);
  const beginEdit=()=>{setForm({...data.settings});setEditing(true)};
  const cancelEdit=()=>{setForm({...data.settings});setEditing(false)};
  const commit=async()=>{
    if(!dirty)return;
    const sensitiveKeys=["oneWayPricingMode","inboundOneWayPercent","outboundOneWayPercent","inboundOneWayFixedAddition","outboundOneWayFixedAddition","joiningFullChargeThroughDay","refundNoCreditRemainingDays","receiptPrefix","receiptSequenceLength","receiptResetYearly","requireCashupForClaim","deductionPriority"];
    const sensitive=sensitiveKeys.filter(key=>JSON.stringify(form[key])!==JSON.stringify(data.settings?.[key]));
    if(sensitive.length && !window.confirm("Sensitive Transport policy change\n\nYou are changing pricing, receipt numbering, reconciliation or deduction settings. These changes may affect future financial operations. Historical financial records must remain unchanged.\n\nConfirm Save Changes?"))return;
    try { await onSave(form); setEditing(false); } catch { /* existing mutation displays the error */ }
  };
  const pricingValidationMessage = (() => {
    if ((form.oneWayPricingMode || "percentage") === "percentage") {
      const schoolBound = Number(form.inboundOneWayPercent);
      const homeBound = Number(form.outboundOneWayPercent);
      if (!Number.isFinite(schoolBound) || schoolBound < 50 || schoolBound > 100 || !Number.isFinite(homeBound) || homeBound < 50 || homeBound > 100) {
        return "School-bound and home-bound percentages must each be between 50% and 100%.";
      }
    } else {
      const schoolBound = Number(form.inboundOneWayFixedAddition);
      const homeBound = Number(form.outboundOneWayFixedAddition);
      if (!Number.isFinite(schoolBound) || schoolBound < 0 || !Number.isFinite(homeBound) || homeBound < 0) {
        return "School-bound and home-bound fixed additions must each be zero or greater.";
      }
    }
    return "";
  })();
  if (!editing) {
    const value=(v:any)=>v===null||v===undefined||v===""?"Not configured":typeof v==="boolean"?(v?"Enabled":"Disabled"):Array.isArray(v)?v.join(", "):String(v);
    const sections=[
      {title:"General & Operations",values:[["Transport Manager",data.staff?.find((staff:any)=>staff.id===Number(data.settings?.transportManagerStaffId))?.firstName?`${data.staff.find((staff:any)=>staff.id===Number(data.settings?.transportManagerStaffId)).firstName} ${data.staff.find((staff:any)=>staff.id===Number(data.settings?.transportManagerStaffId)).lastName}`:"Not assigned"],["Suggested stop grouping distance",`${value(data.settings?.stopGroupingDistanceMeters)} m`],["Saved-point suggestion radius",`${value(data.settings?.savedPointSuggestionRadiusMeters??50)} m`],["Default checkpoint radius",`${value(data.settings?.defaultCheckpointRadiusMeters)} m`],["Map provider","OpenStreetMap (testing)"]]},
      {title:"Pricing & Billing",values:[["One-way pricing",titleCase(data.settings?.oneWayPricingMode||"percentage")],["School-bound percentage",`${value(data.settings?.inboundOneWayPercent)}%`],["Home-bound percentage",`${value(data.settings?.outboundOneWayPercent)}%`],["School-bound addition",`USD ${value(data.settings?.inboundOneWayFixedAddition??0)}`],["Home-bound addition",`USD ${value(data.settings?.outboundOneWayFixedAddition??0)}`],["Full-charge joining day",value(data.settings?.joiningFullChargeThroughDay)],["No-refund remaining days",value(data.settings?.refundNoCreditRemainingDays)]]},
      {title:"Vehicle & Seat Policies",values:[["Reserve pending seats",value(data.settings?.pendingSeatReservationEnabled)],["Reservation duration",`${value(data.settings?.pendingSeatReservationDays)} days`]]},
      {title:"Receipts & Financial Controls",values:[["Currency","USD"],["Receipt prefix",value(data.settings?.receiptPrefix)],["Receipt sequence length",value(data.settings?.receiptSequenceLength)],["Reset receipt sequence yearly",value(data.settings?.receiptResetYearly)],["Default receipt format",value(data.settings?.receiptPrintFormat)],["Reconciliation required before claim",value(data.settings?.requireCashupForClaim)],["Deduction priority",value(data.settings?.deductionPriority)],["Receipt footer",value(data.settings?.receiptFooter)]]},
      {title:"Reporting",values:[["Fortnight anchor",value(data.settings?.fortnightAnchorDate)],["Week begins",["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][Number(data.settings?.reportWeekStartsOn??1)]||"Monday"]]}
    ];
    return <Card><CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>Transport settings</CardTitle><CardDescription>School-specific operational policies. Select a section to review details, or initiate Edit to change settings.</CardDescription></div>{canEdit&&<Button variant="outline" onClick={beginEdit}>Edit Settings</Button>}</CardHeader><CardContent className="space-y-3">{sections.map((section,i)=><details key={section.title} open={i===0} className="group rounded-lg border bg-background"><summary className="cursor-pointer list-item px-4 py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{section.title}</summary><dl className="grid gap-3 border-t px-4 py-4 sm:grid-cols-2 xl:grid-cols-3">{section.values.map(([label,val]:any)=><div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{val}</dd></div>)}</dl></details>)}</CardContent></Card>;
  }
  return <Card><CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>Edit Transport Settings</CardTitle><CardDescription>Review each change before saving. Sensitive financial policies require additional confirmation.</CardDescription></div><Button variant="outline" onClick={cancelEdit} disabled={saving}>Cancel</Button></CardHeader><CardContent className="space-y-6">
    <SettingsSection title="Responsibility and location planning">
      <EntitySelect label="Transport Manager" items={data.staff} value={form.transportManagerStaffId} onChange={(value: any) => set("transportManagerStaffId", idValue(value))} itemText={(row: any) => `${row.firstName} ${row.lastName} (${row.position || "Staff"})`} optional/>
      <NumberField label="Suggested stop grouping distance (metres)" value={form.stopGroupingDistanceMeters} onChange={(value: any) => set("stopGroupingDistanceMeters", value)} min={1}/>
      <NumberField label="Saved-point suggestion radius (metres)" value={form.savedPointSuggestionRadiusMeters ?? 50} onChange={(value: any) => set("savedPointSuggestionRadiusMeters", value)} min={1}/>
      <NumberField label="Default checkpoint radius (metres)" value={form.defaultCheckpointRadiusMeters} onChange={(value: any) => set("defaultCheckpointRadiusMeters", value)} min={1}/>
      <Field label="Map provider"><Input value="OpenStreetMap (testing)" disabled/></Field>
    </SettingsSection>
    <SettingsSection title="Pricing and prorating" gridClassName="md:grid-cols-2 lg:grid-cols-[150px_repeat(4,minmax(0,1fr))]">
      <Field label="Pricing method">
        <div className="space-y-2 pt-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="oneWayPricingMode" value="percentage" checked={(form.oneWayPricingMode || "percentage") === "percentage"} onChange={() => set("oneWayPricingMode", "percentage")}/>
            <span>Percentage</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="oneWayPricingMode" value="fixed_addition" checked={form.oneWayPricingMode === "fixed_addition"} onChange={() => set("oneWayPricingMode", "fixed_addition")}/>
            <span>Fixed addition</span>
          </label>
        </div>
      </Field>
      {(form.oneWayPricingMode || "percentage") === "percentage" ? <>
        <Field label="School-bound percentage"><Input type="number" value={form.inboundOneWayPercent ?? ""} min={50} max={100} step="0.01" onChange={(event) => set("inboundOneWayPercent", event.target.value)}/><p className="text-xs text-muted-foreground">Minimum 50% of the two-way charge.</p></Field>
        <Field label="Home-bound percentage"><Input type="number" value={form.outboundOneWayPercent ?? ""} min={50} max={100} step="0.01" onChange={(event) => set("outboundOneWayPercent", event.target.value)}/><p className="text-xs text-muted-foreground">Minimum 50% of the two-way charge.</p></Field>
      </> : <>
        <Field label="School-bound addition"><Input type="number" value={form.inboundOneWayFixedAddition ?? 0} min={0} step="0.01" onChange={(event) => set("inboundOneWayFixedAddition", event.target.value)}/><p className="text-xs text-muted-foreground">Added to half the two-way charge.</p></Field>
        <Field label="Home-bound addition"><Input type="number" value={form.outboundOneWayFixedAddition ?? 0} min={0} step="0.01" onChange={(event) => set("outboundOneWayFixedAddition", event.target.value)}/><p className="text-xs text-muted-foreground">Added to half the two-way charge.</p></Field>
      </>}
      <Field label="Full charge if joining by day"><Input type="number" value={form.joiningFullChargeThroughDay ?? ""} min={0} max={31} step="1" onChange={(event) => set("joiningFullChargeThroughDay", event.target.value)}/><p className="text-xs text-muted-foreground">Learners joining on or before this day are charged the full transport fee.</p></Field>
      <Field label="No refund if days remaining are"><Input type="number" value={form.refundNoCreditRemainingDays ?? ""} min={0} max={31} step="1" onChange={(event) => set("refundNoCreditRemainingDays", event.target.value)}/><p className="text-xs text-muted-foreground">No refund is calculated when this many days or fewer remain.</p></Field>
    </SettingsSection>
    <SettingsSection title="Pending seats and school operational timing">
      <BooleanField label="Reserve seats for pending registrations" value={form.pendingSeatReservationEnabled} onChange={(value: any) => set("pendingSeatReservationEnabled", value)}/>
      <NumberField label="Pending seat reservation days" value={form.pendingSeatReservationDays} onChange={(value: any) => set("pendingSeatReservationDays", value)} min={0}/>
    </SettingsSection>
    <SettingsSection title="Receipts, reconciliation and reporting">
      <Field label="Currency"><Input value="USD" disabled/></Field>
      <Field label="Receipt prefix"><Input value={form.receiptPrefix || ""} onChange={(event) => set("receiptPrefix", event.target.value.toUpperCase())}/></Field>
      <NumberField label="Receipt sequence length" value={form.receiptSequenceLength} onChange={(value: any) => set("receiptSequenceLength", value)} min={3} max={12}/>
      <BooleanField label="Reset receipt sequence yearly" value={form.receiptResetYearly} onChange={(value: any) => set("receiptResetYearly", value)}/>
      <Field label="Default receipt format">
        <Select value={String(form.receiptPrintFormat || "a4")} onValueChange={(value) => set("receiptPrintFormat", value)}>
          <SelectTrigger><SelectValue placeholder="Select receipt format"/></SelectTrigger>
          <SelectContent><SelectItem value="thermal80">80 mm Thermal</SelectItem><SelectItem value="a4">A4</SelectItem></SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Normal Print/Reprint uses this school default. The receipt action menu can override it for one print only.</p>
      </Field>
      <BooleanField label="Require reconciliation before claim" value={form.requireCashupForClaim} onChange={(value: any) => set("requireCashupForClaim", value)}/>
      <Field label="Fortnight anchor date"><Input type="date" value={form.fortnightAnchorDate || ""} onChange={(event) => set("fortnightAnchorDate", event.target.value || null)}/></Field>
      <Choice label="Reporting week starts on" value={form.reportWeekStartsOn ?? 1} onChange={(value: any) => set("reportWeekStartsOn", Number(value))} items={[[1,"Monday"],[2,"Tuesday"],[3,"Wednesday"],[4,"Thursday"],[5,"Friday"],[6,"Saturday"],[0,"Sunday"]]}/>
      <Field label="Deduction priority"><Input value={Array.isArray(form.deductionPriority) ? form.deductionPriority.join(", ") : (form.deductionPriority || "")} onChange={(event) => set("deductionPriority", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="refund, subscription, penalty, advance, other"/><p className="text-xs text-muted-foreground">First item is deducted first.</p></Field>
      <Field label="Receipt footer"><Textarea value={form.receiptFooter || ""} onChange={(event) => set("receiptFooter", event.target.value)}/></Field>
    </SettingsSection>
    {pricingValidationMessage && <p className="text-sm text-destructive">{pricingValidationMessage}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={saving} onClick={cancelEdit}>Cancel</Button><Button disabled={saving || !!pricingValidationMessage || !dirty || !canEdit} onClick={() => !pricingValidationMessage && void commit()}><Settings className="mr-2 h-4 w-4"/>{saving ? "Saving…" : "Save Changes"}</Button></div>
  </CardContent></Card>;
}

function clientCashupHandover(form: any, data: Bootstrap) {
  const paymentIds = new Set((form.paymentIds || []).map(Number));
  const refundIds = new Set((form.refundIds || []).map(Number));
  const repaymentIds = new Set((form.advanceRepaymentIds || []).map(Number));
  const selectedPayments = (data.payments || []).filter((payment: any) => paymentIds.has(Number(payment.id)) && !payment.reversedAt);
  const selectedRefunds = (data.refunds || []).filter((refund: any) => refundIds.has(Number(refund.id)) && refund.status === "paid" && refund.method !== "credit");
  const cash = (data.advanceRepayments || []).filter((r:any)=>repaymentIds.has(Number(r.id))&&r.paymentMethod==="cash"&&r.status==="pending").reduce((sum:number,r:any)=>sum+Number(r.amount||0),0)
    + selectedPayments.filter((payment: any) => payment.paymentMethod === "cash").reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0)
    - selectedRefunds.filter((refund: any) => refund.method === "cash").reduce((sum: number, refund: any) => sum + Number(refund.amount || 0), 0);
  const nonCash = selectedPayments.filter((payment: any) => payment.paymentMethod !== "cash").reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0)
    - selectedRefunds.filter((refund: any) => refund.method !== "cash").reduce((sum: number, refund: any) => sum + Number(refund.amount || 0), 0);
  return { cash, nonCash, invalid: cash < -0.009 || nonCash < -0.009 };
}

function TransportDialog({ state, data, saving, close, submit, canManageDocuments, canManageCompliance }: { state: DialogState; data: Bootstrap; saving: boolean; close: () => void; submit: (method: string, url: string, body: any) => void; canManageDocuments: boolean; canManageCompliance: boolean }) {
  if (!state) return null;
  if (state.type === "details") return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>Complete Transport record</DialogTitle><DialogDescription>Overview, relationships, documents, compliance, history and incidents.</DialogDescription></DialogHeader><TransportRecordDetails entityType={state.record?.entityType} entityId={Number(state.record?.entityId)} canManageDocuments={canManageDocuments} canManageCompliance={canManageCompliance}/></DialogContent></Dialog>;
  if (state.type === "assignment") return <LearnerRegistrationDialog record={state.record} data={data} saving={saving} close={close} submit={submit}/>;
  if (state.type === "assignmentServicePoint") return <LearnerServicePointDialog assignment={state.record} data={data} saving={saving} close={close} submit={submit}/>;
  if (state.type === "servicePoint") return <SavedPointDialog record={state.record} data={data} saving={saving} close={close} submit={submit}/>;
  if (state.type === "vehicleDestinations") return <VehicleDestinationsDialog vehicle={state.record} close={close}/>;
  if (state.type === "vehicleOccupants") return <VehicleOccupantsDialog vehicle={state.record} close={close}/>;
  if (state.type === "vehicleRoute") return <VehicleRouteDialog vehicle={state.record} close={close}/>;
  if (state.type === "learnerAccount") return <LearnerAccountDialog learner={state.record} close={close}/>;
  if (state.type === "cancelService") return <CancelServiceDialog assignment={state.record} saving={saving} close={close} submit={submit}/>;
  if (state.type === "rejectAdvance") return <RejectAdvanceDialog advance={state.record} saving={saving} close={close} submit={submit}/>;

  const initial = buildInitialForm(state.type, state.record, data);
  const [form, setForm] = useState<any>(initial);
  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const editing = Boolean(state.record && (["route", "vehicle", "driver", "owner"].includes(state.type) || state.type === "cashupEdit"));
  const config = dialogConfig(state.type, state.record);

  const vehicleDestinationRequired = state.type === "vehicle" && form.status === "active" && (!Array.isArray(form.destinationIds) || form.destinationIds.length === 0);
  const cashupHandover = ["cashup", "cashupEdit"].includes(state.type) ? clientCashupHandover(form, data) : null;
  const cashupHandoverInvalid = Boolean(cashupHandover?.invalid);

  const doSubmit = () => {
    if (vehicleDestinationRequired || cashupHandoverInvalid) return;
    const body: any = { ...form };
    for (const key of Object.keys(body)) if (body[key] === "") delete body[key];
    if (state.type === "vehicle" && editing) { body.effectiveDate ||= today(); body.changeReason ||= "Vehicle record updated"; }
    for (const key of ["effectiveAt", "expectedReturnAt"]) {
      if (body[key]) body[key] = new Date(body[key]).toISOString();
    }
    const actionTypes = new Set(["changePrimaryDriver", "activateAlternativeDriver", "returnPrimaryDriver", "changeVehicleOwner", "replaceVehicle", "returnOriginalVehicle"]);
    if (state.type === "cashupEdit") submit("PUT", config.url, body);
    else submit(actionTypes.has(state.type) ? "POST" : editing ? "PUT" : "POST", actionTypes.has(state.type) ? config.url : editing ? `${config.url}/${state.record.id}` : config.url, body);
  };

  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{config.title}</DialogTitle><DialogDescription>{config.description}</DialogDescription></DialogHeader>
    <div className="grid gap-4 md:grid-cols-2">{renderDialogFields(state.type, form, set, data, state.record)}</div>
    {vehicleDestinationRequired && <p className="text-sm text-destructive">Select at least one Destination before saving an active Transport vehicle.</p>}
    {cashupHandoverInvalid && <Alert variant="destructive"><AlertTriangle className="h-4 w-4"/><AlertTitle>Invalid handover selection</AlertTitle><AlertDescription>Selected refunds exceed the selected receipts in the matching cash or non-cash category. Adjust the selection before saving this cash-up.</AlertDescription></Alert>}
    <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={saving || vehicleDestinationRequired || cashupHandoverInvalid} onClick={doSubmit}>{saving ? "Saving…" : config.action}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function LearnerRegistrationDialog({ record, data, saving, close, submit }: any) {
  const defaultPrivacy: ServiceLocationDraft["privacyClass"] = String(data.school?.schoolType || "secondary").toLowerCase().includes("primary") ? "private_household" : "public_common";
  const [form, setForm] = useState<any>(() => buildInitialForm("assignment", record, data));
  const [sameLocation, setSameLocation] = useState(true);
  const [pickupLocation, setPickupLocation] = useState<ServiceLocationDraft>(() => emptyServiceLocation(defaultPrivacy));
  const [dropoffLocation, setDropoffLocation] = useState<ServiceLocationDraft>(() => emptyServiceLocation(defaultPrivacy));
  const [pickupServicePointId, setPickupServicePointId] = useState<number | null>(null);
  const [dropoffServicePointId, setDropoffServicePointId] = useState<number | null>(null);
  const [creatingPoints, setCreatingPoints] = useState(false);
  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const selectedRoute = data.routes.find((route: any) => Number(route.id) === Number(form.routeId));
  const pricingMode = String(data.settings.oneWayPricingMode || "percentage");
  const percentageFor = (serviceType: string) => serviceType === "pickup" ? Number(data.settings.inboundOneWayPercent || 60) : serviceType === "dropoff" ? Number(data.settings.outboundOneWayPercent || 60) : 100;
  const fixedAdditionFor = (serviceType: string) => serviceType === "pickup" ? Number(data.settings.inboundOneWayFixedAddition || 0) : serviceType === "dropoff" ? Number(data.settings.outboundOneWayFixedAddition || 0) : 0;
  const calculatedFeeFor = (serviceType: string, fullFee: number) => {
    if (serviceType === "both") return fullFee;
    return pricingMode === "fixed_addition"
      ? fullFee / 2 + fixedAdditionFor(serviceType)
      : fullFee * percentageFor(serviceType) / 100;
  };
  const pricingLabelFor = (serviceType: string) => {
    if (serviceType === "both") return "Two-way";
    const direction = serviceType === "pickup" ? "School-bound" : "Home-bound";
    return pricingMode === "fixed_addition"
      ? `${direction} (half + USD ${money(fixedAdditionFor(serviceType))})`
      : `${direction} (${money(percentageFor(serviceType))}%)`;
  };
  const expectedFee = calculatedFeeFor(form.serviceType, Number(form.baseMonthlyFee || 0));
  const savedPoints = (data.servicePoints || []).filter((point: any) => point.isActive !== false);
  const activeVehicles = (data.allVehicles || data.vehicles).filter((vehicle: any) => vehicle.isActive);
  const eligibleVehicles = activeVehicles.filter((vehicle: any) => {
    if (!form.routeId) return false;
    const routeMasterId = Number(selectedRoute?.destinationMasterId || 0);
    const servesDestination = routeMasterId > 0 ? (vehicle.destinationMasterIds || []).includes(routeMasterId) : (vehicle.destinationIds || []).includes(Number(form.routeId));
    if (!servesDestination) return false;
    const schoolbound = Number(vehicle.schoolboundSeatsAvailable ?? vehicle.capacity ?? 0);
    const homebound = Number(vehicle.homeboundSeatsAvailable ?? vehicle.capacity ?? 0);
    if (form.serviceType === "pickup") return schoolbound > 0;
    if (form.serviceType === "dropoff") return homebound > 0;
    return Math.min(schoolbound, homebound) > 0;
  });

  useEffect(() => {
    if (!selectedRoute) return;
    const full = Number(selectedRoute.defaultFee || 0);
    setForm((current: any) => ({ ...current, baseMonthlyFee: full, agreedFee: calculatedFeeFor(current.serviceType, full).toFixed(2) }));
  }, [form.routeId]);

  useEffect(() => {
    if (!form.routeId) return;
    const currentStillEligible = eligibleVehicles.some((vehicle: any) => Number(vehicle.id) === Number(form.vehicleId));
    if (eligibleVehicles.length === 1) {
      const onlyId = Number(eligibleVehicles[0].id);
      setForm((current: any) => ({ ...current, vehicleId: onlyId, outboundVehicleId: current.serviceType === "both" || current.serviceType === "dropoff" ? onlyId : null }));
    } else if (form.vehicleId && !currentStillEligible) {
      setForm((current: any) => ({ ...current, vehicleId: null, outboundVehicleId: null }));
    }
  }, [form.routeId, form.serviceType, data.allVehicles]);

  const changeServiceType = (serviceType: string) => {
    setForm((current: any) => {
      const full = Number(current.baseMonthlyFee || selectedRoute?.defaultFee || 0);
      const next: any = { ...current, serviceType, agreedFee: calculatedFeeFor(serviceType, full).toFixed(2) };
      if ((serviceType === "both" || serviceType === "dropoff") && current.vehicleId) next.outboundVehicleId = current.vehicleId;
      if (serviceType === "pickup") next.outboundVehicleId = null;
      return next;
    });
  };

  const changePrimaryVehicle = (value: any) => {
    const vehicleId = idValue(value);
    setForm((current: any) => ({ ...current, vehicleId, outboundVehicleId: current.serviceType === "pickup" ? null : vehicleId }));
  };

  const createPoint = async (pointType: "pickup" | "dropoff" | "both", location: ServiceLocationDraft) => {
    return fetchJson("POST", "/api/transport/service-points", {
      studentId: null, pointType, name: location.name.trim(), latitude: location.latitude, longitude: location.longitude,
      landmark: location.landmark.trim() || null, instructions: location.instructions.trim() || null,
      privacyClass: location.privacyClass, effectiveFrom: form.startDate || today(), isTemporary: false,
    });
  };

  const submitAssignment = async () => {
    const expected = Number(expectedFee.toFixed(2));
    const entered = Number(form.agreedFee || 0);
    if (Math.abs(entered - expected) > 0.009 && !window.confirm(`The Agreed Monthly Fee entered (USD ${money(entered)}) is not the configured ${pricingMode === "fixed_addition" ? "half-plus-addition" : "percentage"} amount (USD ${money(expected)}). Are you sure you want to register the student?`)) return;
    if (!locationCanSubmit) return;
    try {
      setCreatingPoints(true);
      let pickupId = pickupServicePointId;
      let dropoffId = sameLocation ? pickupId : dropoffServicePointId;
      if (locationReady) {
        if (!pickupId) {
          const created = await createPoint(sameLocation ? "both" : "pickup", pickupLocation);
          pickupId = Number(created.id);
          if (sameLocation) dropoffId = pickupId;
        }
        if (!sameLocation && !dropoffId) {
          const created = await createPoint("dropoff", dropoffLocation);
          dropoffId = Number(created.id);
        }
      } else {
        pickupId = null;
        dropoffId = null;
      }
      const body = {
        ...form, studentId: Number(form.studentId), routeId: Number(form.routeId),
        vehicleId: idValue(form.vehicleId), outboundVehicleId: form.serviceType === "pickup" ? null : idValue(form.vehicleId),
        driverId: idValue(form.driverId), inboundPathId: null, inboundPathTraversal: "forward",
        outboundPathId: null, outboundPathTraversal: "forward",
        pickupServicePointId: pickupId, dropoffServicePointId: sameLocation ? pickupId : dropoffId,
        baseMonthlyFee: Number(form.baseMonthlyFee || 0), agreedFee: entered,
      };
      submit("POST", "/api/transport/assignments", body);
    } finally { setCreatingPoints(false); }
  };

  const locationDraftHasContent = (location: ServiceLocationDraft) => Boolean(location.name.trim() || location.landmark.trim() || location.instructions.trim() || location.latitude != null || location.longitude != null);
  const pickupReady = Boolean(pickupServicePointId || (pickupLocation.name.trim() && pickupLocation.latitude != null && pickupLocation.longitude != null));
  const dropoffReady = Boolean(dropoffServicePointId || (dropoffLocation.name.trim() && dropoffLocation.latitude != null && dropoffLocation.longitude != null));
  const locationReady = pickupReady && Boolean(sameLocation || dropoffReady);
  const locationStarted = Boolean(pickupServicePointId || locationDraftHasContent(pickupLocation) || (!sameLocation && (dropoffServicePointId || locationDraftHasContent(dropoffLocation))));
  const locationCanSubmit = !locationStarted || locationReady;

  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>Register learner for transport</DialogTitle><DialogDescription>Service begins only when the Service Start Date is reached and the required Transport payment conditions are satisfied.</DialogDescription></DialogHeader>
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <EntitySelect label="Learner" items={data.students} value={form.studentId} onChange={(value: any) => set("studentId", idValue(value))} itemText={(student: any) => `${student.firstName} ${student.lastName} (${student.admissionNo})`}/>
        <EntitySelect label="Destination" items={data.routes.filter((route: any) => route.isActive)} value={form.routeId} onChange={(value: any) => set("routeId", idValue(value))} itemText={(route: any) => `${route.code} · ${route.name}`}/>
        <Choice label="Service Type" value={form.serviceType} onChange={changeServiceType} items={[["both", "Two-way"], ["pickup", pricingLabelFor("pickup")], ["dropoff", pricingLabelFor("dropoff")]]}/>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Service Start Date"><Input type="date" value={form.startDate} onChange={(event) => set("startDate", event.target.value)}/></Field>
        <NumberField label="Full Two-Way Service Fee" value={form.baseMonthlyFee} onChange={(value: any) => { const full = Number(value || 0); setForm((current: any) => ({ ...current, baseMonthlyFee: value, agreedFee: calculatedFeeFor(current.serviceType, full).toFixed(2) })); }} min={0} step="0.01"/>
        <NumberField label="Agreed Monthly Fee" value={form.agreedFee} onChange={(value: any) => set("agreedFee", value)} min={0} step="0.01"/>
      </div>

      <div>
        <EntitySelect label="Vehicle" items={eligibleVehicles} value={form.vehicleId} onChange={changePrimaryVehicle} itemText={(vehicle: any) => {
          const available = form.serviceType === "pickup" ? Number(vehicle.schoolboundSeatsAvailable ?? vehicle.capacity ?? 0) : form.serviceType === "dropoff" ? Number(vehicle.homeboundSeatsAvailable ?? vehicle.capacity ?? 0) : Math.min(Number(vehicle.schoolboundSeatsAvailable ?? vehicle.capacity ?? 0), Number(vehicle.homeboundSeatsAvailable ?? vehicle.capacity ?? 0));
          const schools = (vehicle.schoolsServed || []).map((school: any) => school.name).join(", ") || "No current school service";
          const operatingDriver = vehicle.currentOperatingDriver
            || data.drivers.find((driver: any) => Number(driver.id) === Number(vehicle.currentOperatingDriverId || vehicle.driverId));
          const driverLabel = operatingDriver
            ? `Driver: ${operatingDriver.firstName} ${operatingDriver.lastName}`
            : "No driver assigned";
          return `${vehicle.registrationNumber} · ${driverLabel} · ${available} seat${available === 1 ? "" : "s"} available · ${schools}`;
        }} optional optionalLabel={form.routeId ? "Select eligible vehicle" : "Select a destination first"}/>
        <p className="mt-1 text-xs text-muted-foreground">Only vehicles configured for this destination and with available capacity are shown. A single eligible vehicle is selected automatically.</p>
      </div>

      <div className="rounded-lg border p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-medium">Pick-Up/Drop-Off location</div><div className="text-xs text-muted-foreground">Optional during registration. Complete it now using a saved or new point, or leave the entire section blank and add it later from the learner's Transport service.</div></div><label className="flex items-center gap-2 text-sm"><Checkbox checked={sameLocation} onCheckedChange={(checked) => { const same = Boolean(checked); setSameLocation(same); if (same) setDropoffServicePointId(pickupServicePointId); }}/><span>Use same location</span></label></div>
        <ServiceLocationEditor title={sameLocation ? "Pick-Up/Drop-Off Point" : "Pick-Up Point"} value={pickupLocation} onChange={setPickupLocation} savedPoints={savedPoints.filter((point: any) => !point.pointType || point.pointType === "both" || (!sameLocation && point.pointType === "pickup"))} selectedPointId={pickupServicePointId} onSelectedPointIdChange={(id) => { setPickupServicePointId(id); if (sameLocation) setDropoffServicePointId(id); }} suggestionRadiusMeters={Number(data.settings.savedPointSuggestionRadiusMeters || 50)} showAddress={false}/>
      </div>
      {!sameLocation && <div className="rounded-lg border p-4"><ServiceLocationEditor title="Drop-Off Point" value={dropoffLocation} onChange={setDropoffLocation} savedPoints={savedPoints.filter((point: any) => !point.pointType || point.pointType === "both" || point.pointType === "dropoff")} selectedPointId={dropoffServicePointId} onSelectedPointIdChange={setDropoffServicePointId} suggestionRadiusMeters={Number(data.settings.savedPointSuggestionRadiusMeters || 50)} showAddress={false}/></div>}
      {locationStarted && !locationReady && <p className="text-sm text-destructive">Complete the location name and coordinates for each location you started, or clear the location fields to register the learner now and add the Pick/Drop Point later.</p>}
      <Field label="Notes"><Textarea className="min-h-24 w-full" value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field>
    </div>
    <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={saving || creatingPoints || !form.studentId || !form.routeId || !form.vehicleId || !locationCanSubmit} onClick={() => void submitAssignment()}>{saving || creatingPoints ? "Saving…" : "Register Learner"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function LearnerServicePointDialog({ assignment, data, saving, close, submit }: any) {
  const defaultPrivacy: ServiceLocationDraft["privacyClass"] = String(data.school?.schoolType || "secondary").toLowerCase().includes("primary") ? "private_household" : "public_common";
  const pointById = (id: number | null | undefined) => id ? (data.servicePoints || []).find((point: any) => Number(point.id) === Number(id)) : null;
  const draftFromPoint = (point: any) => point ? {
    name: point.name || "",
    address: "",
    landmark: point.landmark || "",
    latitude: point.latitude == null ? null : Number(point.latitude),
    longitude: point.longitude == null ? null : Number(point.longitude),
    privacyClass: point.privacyClass || defaultPrivacy,
    instructions: point.instructions || "",
  } : emptyServiceLocation(defaultPrivacy);
  const existingPickup = pointById(assignment.pickupServicePointId);
  const existingDropoff = pointById(assignment.dropoffServicePointId);
  const pickupRequired = assignment.serviceType !== "dropoff";
  const dropoffRequired = assignment.serviceType !== "pickup";
  const [sameLocation, setSameLocation] = useState(Boolean(pickupRequired && dropoffRequired && (!assignment.pickupServicePointId && !assignment.dropoffServicePointId || Number(assignment.pickupServicePointId) === Number(assignment.dropoffServicePointId))));
  const [pickupLocation, setPickupLocation] = useState<ServiceLocationDraft>(() => draftFromPoint(existingPickup));
  const [dropoffLocation, setDropoffLocation] = useState<ServiceLocationDraft>(() => draftFromPoint(existingDropoff));
  const [pickupServicePointId, setPickupServicePointId] = useState<number | null>(assignment.pickupServicePointId ? Number(assignment.pickupServicePointId) : null);
  const [dropoffServicePointId, setDropoffServicePointId] = useState<number | null>(assignment.dropoffServicePointId ? Number(assignment.dropoffServicePointId) : null);
  const [creatingPoints, setCreatingPoints] = useState(false);
  const savedPoints = (data.servicePoints || []).filter((point: any) => point.isActive !== false);

  const ready = (id: number | null, location: ServiceLocationDraft) => Boolean(id || (location.name.trim() && location.latitude != null && location.longitude != null));
  const pickupReady = !pickupRequired || ready(pickupServicePointId, pickupLocation);
  const dropoffReady = !dropoffRequired || (sameLocation ? ready(pickupServicePointId, pickupLocation) : ready(dropoffServicePointId, dropoffLocation));

  const createPoint = async (pointType: "pickup" | "dropoff" | "both", location: ServiceLocationDraft) => fetchJson("POST", "/api/transport/service-points", {
    studentId: null,
    pointType,
    name: location.name.trim(),
    latitude: location.latitude,
    longitude: location.longitude,
    landmark: location.landmark.trim() || null,
    instructions: location.instructions.trim() || null,
    privacyClass: location.privacyClass,
    effectiveFrom: assignment.startDate || today(),
    isTemporary: false,
  });

  const save = async () => {
    if (!pickupReady || !dropoffReady) return;
    try {
      setCreatingPoints(true);
      let pickupId = pickupRequired ? pickupServicePointId : null;
      let dropoffId = dropoffRequired ? (sameLocation ? pickupId : dropoffServicePointId) : null;
      if (pickupRequired && !pickupId) {
        const created = await createPoint(sameLocation && dropoffRequired ? "both" : "pickup", pickupLocation);
        pickupId = Number(created.id);
        if (sameLocation && dropoffRequired) dropoffId = pickupId;
      }
      if (dropoffRequired && !sameLocation && !dropoffId) {
        const created = await createPoint("dropoff", dropoffLocation);
        dropoffId = Number(created.id);
      }
      submit("PATCH", `/api/transport/assignments/${assignment.id}/service-points`, {
        pickupServicePointId: pickupId,
        dropoffServicePointId: dropoffId,
      });
    } finally {
      setCreatingPoints(false);
    }
  };

  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>Add Service Pick/Drop Point</DialogTitle><DialogDescription>{assignment.firstName} {assignment.lastName} · {assignment.routeName}. Add the operational Pick-Up/Drop-Off Point that was skipped during registration.</DialogDescription></DialogHeader>
    <div className="space-y-5">
      {pickupRequired && dropoffRequired && <label className="flex items-center gap-2 text-sm"><Checkbox checked={sameLocation} onCheckedChange={(checked) => { const same = Boolean(checked); setSameLocation(same); if (same) setDropoffServicePointId(pickupServicePointId); }}/><span>Use same location for Pick-Up and Drop-Off</span></label>}
      {pickupRequired && <div className="rounded-lg border p-4"><ServiceLocationEditor title={sameLocation && dropoffRequired ? "Pick-Up/Drop-Off Point" : "Pick-Up Point"} value={pickupLocation} onChange={setPickupLocation} required savedPoints={savedPoints.filter((point: any) => !point.pointType || point.pointType === "both" || (!sameLocation && point.pointType === "pickup"))} selectedPointId={pickupServicePointId} onSelectedPointIdChange={(id) => { setPickupServicePointId(id); if (sameLocation && dropoffRequired) setDropoffServicePointId(id); }} suggestionRadiusMeters={Number(data.settings.savedPointSuggestionRadiusMeters || 50)} showAddress={false}/></div>}
      {dropoffRequired && !sameLocation && <div className="rounded-lg border p-4"><ServiceLocationEditor title="Drop-Off Point" value={dropoffLocation} onChange={setDropoffLocation} required savedPoints={savedPoints.filter((point: any) => !point.pointType || point.pointType === "both" || point.pointType === "dropoff")} selectedPointId={dropoffServicePointId} onSelectedPointIdChange={setDropoffServicePointId} suggestionRadiusMeters={Number(data.settings.savedPointSuggestionRadiusMeters || 50)} showAddress={false}/></div>}
    </div>
    <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={saving || creatingPoints || !pickupReady || !dropoffReady} onClick={() => void save()}>{saving || creatingPoints ? "Saving…" : "Save Service Pick/Drop Point"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function SavedPointDialog({ record, data, saving, close, submit }: any) {
  const defaultPrivacy: ServiceLocationDraft["privacyClass"] = String(data.school?.schoolType || "secondary").toLowerCase().includes("primary") ? "private_household" : "public_common";
  const [location, setLocation] = useState<ServiceLocationDraft>(() => record ? { name: record.name || "", address: record.address || "", landmark: record.landmark || "", latitude: record.latitude == null ? null : Number(record.latitude), longitude: record.longitude == null ? null : Number(record.longitude), privacyClass: record.privacyClass || defaultPrivacy, instructions: record.instructions || "" } : emptyServiceLocation(defaultPrivacy));
  const [selectedPointId, setSelectedPointId] = useState<number | null>(record?.id || null);
  const chosen = selectedPointId ? data.servicePoints.find((point: any) => Number(point.id) === Number(selectedPointId)) : null;
  const targetId = record?.id || chosen?.id || null;
  const save = () => {
    const body = { studentId: null, pointType: record?.pointType || chosen?.pointType || "both", name: location.name.trim(), latitude: location.latitude, longitude: location.longitude, landmark: location.landmark.trim() || null, instructions: location.instructions.trim() || null, privacyClass: location.privacyClass, effectiveFrom: record?.effectiveFrom || chosen?.effectiveFrom || today(), isTemporary: false };
    submit(targetId ? "PUT" : "POST", targetId ? `/api/transport/service-points/${targetId}` : "/api/transport/service-points", body);
  };
  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>{record ? "Edit Pick-Up/Drop-Off Point" : "Add Pick-Up/Drop-Off Point"}</DialogTitle><DialogDescription>These saved points are shared across all schools in the organisation. A point in use cannot be deleted.</DialogDescription></DialogHeader><ServiceLocationEditor title="Saved Pick-Up/Drop-Off Point" value={location} onChange={setLocation} required savedPoints={data.servicePoints} selectedPointId={selectedPointId} onSelectedPointIdChange={(id) => { setSelectedPointId(id); if (id) { const point = data.servicePoints.find((row: any) => Number(row.id) === Number(id)); if (point) setLocation({ name: point.name || "", address: point.address || "", landmark: point.landmark || "", latitude: Number(point.latitude), longitude: Number(point.longitude), privacyClass: point.privacyClass || defaultPrivacy, instructions: point.instructions || "" }); } }} suggestionRadiusMeters={Number(data.settings.savedPointSuggestionRadiusMeters || 50)} showAddress={false}/><DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={saving || !location.name.trim() || location.latitude == null || location.longitude == null} onClick={save}>{saving ? "Saving…" : targetId ? "Save Changes" : "Add Pick-Up/Drop-Off Point"}</Button></DialogFooter></DialogContent></Dialog>;
}

function VehicleDestinationsDialog({ vehicle, close }: any) {
  const destinations = Array.isArray(vehicle?.destinations) ? vehicle.destinations : [];
  return <Dialog open onOpenChange={(isOpen) => !isOpen && close()}>
    <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{vehicle?.registrationNumber} · Destinations served</DialogTitle>
        <DialogDescription>Destinations currently configured for this vehicle. Select a destination to view its full Transport details.</DialogDescription>
      </DialogHeader>
      {destinations.length ? <DataTable heads={["Destination", "Code", "Direction", "Monthly Fee", "Service Points"]}>
        {destinations.map((destination: any) => <TableRow key={destination.id}>
          <TableCell className="font-medium">{destination.name}</TableCell>
          <TableCell>{destination.code || "—"}</TableCell>
          <TableCell>{directionLabel(destination.direction || destination.serviceDirection)}</TableCell>
          <TableCell>USD {money(destination.defaultFee)}</TableCell>
          <TableCell>{Number(destination.servicePointUsageCount || 0)}</TableCell>
        </TableRow>)}
      </DataTable> : <div className="py-8 text-center text-muted-foreground">No destinations are configured for this vehicle.</div>}
      <DialogFooter><Button variant="outline" onClick={close}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function VehicleOccupantsDialog({ vehicle, close }: any) {
  const query = useQuery<any>({ queryKey: ["/api/transport/vehicles", vehicle?.id, "occupants"], enabled: Boolean(vehicle?.id), queryFn: async () => { const response = await schoolFetch(`/api/transport/vehicles/${vehicle.id}/occupants`); if (!response.ok) throw new Error("Unable to load vehicle occupants"); return response.json(); } });
  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>{vehicle?.registrationNumber} · Occupants</DialogTitle><DialogDescription>Current and reserved occupants. Learners suspended for arrears remain visible while their seat is reserved; released seats no longer count toward active capacity.</DialogDescription></DialogHeader>{query.isLoading ? <div className="py-8 text-center text-muted-foreground">Loading occupants…</div> : <DataTable heads={["Learner", "School", "Route", "Service", "Service Start Date", "Status"]}>{(query.data?.occupants || []).map((row: any) => <TableRow key={row.assignmentId || row.id}><TableCell className="font-medium">{row.firstName} {row.lastName}<div className="text-xs text-muted-foreground">{row.admissionNo}</div></TableCell><TableCell>{row.schoolName || "—"}</TableCell><TableCell>{row.routeName || "—"}</TableCell><TableCell>{serviceTypeLabel(row.serviceType)}</TableCell><TableCell>{row.startDate || "—"}</TableCell><TableCell><StatusBadge value={row.serviceState || (row.isActive ? "active" : "inactive")}/>{row.serviceState==="suspended_arrears" && <div className="mt-1 text-xs text-destructive">{row.seatReleasedAt ? "Seat released" : row.seatReservedUntil ? `Seat reserved through ${row.seatReservedUntil}` : "Seat reserved"}</div>}{row.serviceState==="pending_vehicle_reassignment" && <div className="mt-1 text-xs text-amber-700">Vehicle reassignment required</div>}</TableCell></TableRow>)}</DataTable>}<DialogFooter><Button variant="outline" onClick={close}>Close</Button></DialogFooter></DialogContent></Dialog>;
}


function LearnerAccountDialog({ learner, close }: any) {
  const studentId = Number(learner?.studentId || learner?.id);
  const query = useQuery<any>({
    queryKey: ["/api/transport/learner-accounts", studentId],
    queryFn: async () => { const response = await schoolFetch(`/api/transport/learner-accounts/${studentId}`); if (!response.ok) throw new Error(await response.text()); return response.json(); },
    enabled: Boolean(studentId),
  });
  const account = query.data;
  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>{account?.learner ? `${account.learner.firstName} ${account.learner.lastName}` : `${learner?.firstName || "Learner"} ${learner?.lastName || ""}`} · Transport Account</DialogTitle><DialogDescription>Lifetime Transport statement for this learner at the current school. Historical service records remain unchanged when current configuration changes.</DialogDescription></DialogHeader>
    {query.isLoading ? <div className="py-10 text-center text-muted-foreground">Loading account statement…</div> : query.error ? <Alert variant="destructive"><TriangleAlert className="h-4 w-4"/><AlertTitle>Unable to load account</AlertTitle><AlertDescription>{query.error instanceof Error ? query.error.message : "Account statement unavailable"}</AlertDescription></Alert> : account && <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Stat label="Charges" value={`USD ${money(account.summary?.charges)}`}/><Stat label="Adjustments" value={`USD ${money(account.summary?.adjustments)}`}/><Stat label="Payments" value={`USD ${money(account.summary?.received)}`}/><Stat label="Refunded" value={`USD ${money(account.summary?.externalRefundsPaid)}`}/><Stat label="Balance" value={`USD ${money(account.summary?.balance)}`}/></div>
      <Card><CardHeader><CardTitle className="text-base">Account Statement</CardTitle><CardDescription>{account.learner?.admissionNo || ""}{account.learner?.className ? ` · ${account.learner.className}` : ""}{account.learner?.parentFirstName ? ` · Parent: ${account.learner.parentFirstName} ${account.learner.parentLastName || ""} ${account.learner.parentPhone || ""}` : ""}</CardDescription></CardHeader><CardContent><DataTable heads={["Date","Reference","Transaction","Debit","Credit","Running Balance"]}>{(account.transactions || []).map((line:any,index:number)=><TableRow key={`${line.kind}-${line.reference}-${index}`}><TableCell>{line.date}</TableCell><TableCell><span className="font-medium">{line.reference}</span></TableCell><TableCell>{line.description}</TableCell><TableCell>{line.debit ? `USD ${money(line.debit)}` : "—"}</TableCell><TableCell>{line.credit ? `USD ${money(line.credit)}` : "—"}</TableCell><TableCell className="font-medium">USD {money(line.balance)}</TableCell></TableRow>)}</DataTable></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Service History</CardTitle></CardHeader><CardContent><DataTable heads={["Start","Stop","Destination","Vehicle","Service","State","Financial"]}>{(account.assignments || []).map((row:any)=><TableRow key={row.id}><TableCell>{row.startDate}</TableCell><TableCell>{row.endDate || "Current"}</TableCell><TableCell>{row.destinationName || "—"}</TableCell><TableCell>{row.vehicleRegistration || row.homeboundVehicleRegistration || "—"}</TableCell><TableCell>{serviceTypeLabel(row.serviceType)}</TableCell><TableCell><StatusBadge value={row.serviceState}/></TableCell><TableCell><StatusBadge value={row.financialStatus}/></TableCell></TableRow>)}</DataTable></CardContent></Card>
    </div>}
    <DialogFooter><Button variant="outline" onClick={close}>Close</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function VehicleRouteDialog({ vehicle, close }: any) {
  const [direction, setDirection] = useState<"pickup"|"dropoff">("pickup");
  const [pins, setPins] = useState<Array<{latitude:number;longitude:number}>>([]);
  const [projection, setProjection] = useState<any>(null);
  const [projecting, setProjecting] = useState(false);
  const mapHost = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const query = useQuery<any>({ queryKey:["/api/transport/vehicles",vehicle?.id,"route",direction], queryFn:async()=>{ const response=await schoolFetch(`/api/transport/vehicles/${vehicle.id}/route?direction=${direction}`); if(!response.ok) throw new Error(await response.text()); return response.json(); }, enabled:Boolean(vehicle?.id) });
  const copyCoordinate = async (value:number) => { try { await navigator.clipboard.writeText(String(value)); } catch { /* browser may block clipboard; visible value remains selectable */ } };
  useEffect(()=>{ setPins([]); setProjection(null); },[direction]);
  useEffect(()=>{
    if (!mapHost.current || !query.data) return;
    if (mapRef.current) { mapRef.current.remove(); mapRef.current=null; }
    const map=L.map(mapHost.current,{zoomControl:true}); mapRef.current=map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap contributors"}).addTo(map);
    const layer=L.layerGroup().addTo(map); routeLayerRef.current=layer;
    const render=()=>{
      layer.clearLayers(); const data=projection || query.data; const geometry=Array.isArray(data?.geometry?.coordinates)?data.geometry.coordinates:data?.geometry;
      if(Array.isArray(geometry)&&geometry.length) L.polyline(geometry.map((pair:any)=>[Number(pair[1]),Number(pair[0])]),{weight:4}).addTo(layer);
      for(const node of query.data.nodes||[]) L.circleMarker([Number(node.latitude),Number(node.longitude)],{radius:6}).bindTooltip(node.name||node.type||"Route point").addTo(layer);
      pins.forEach((pin,index)=>L.marker([pin.latitude,pin.longitude]).bindTooltip(`Temporary pin ${index+1}`).addTo(layer));
      const bounds:L.LatLngExpression[]=[...(query.data.nodes||[]).map((n:any)=>[Number(n.latitude),Number(n.longitude)] as L.LatLngExpression),...pins.map(p=>[p.latitude,p.longitude] as L.LatLngExpression)];
      if(bounds.length) map.fitBounds(L.latLngBounds(bounds),{padding:[28,28]}); else map.setView([-17.8,31.05],11);
    }; render();
    map.on("click",(event:L.LeafletMouseEvent)=>setPins(current=>[...current,{latitude:Number(event.latlng.lat.toFixed(6)),longitude:Number(event.latlng.lng.toFixed(6))}]));
    return()=>{ map.remove(); mapRef.current=null; };
  },[query.data,direction]);
  useEffect(()=>{
    const map=mapRef.current, layer=routeLayerRef.current; if(!map||!layer||!query.data)return; layer.clearLayers(); const data=projection||query.data; const geometry=Array.isArray(data?.geometry?.coordinates)?data.geometry.coordinates:data?.geometry; if(Array.isArray(geometry)&&geometry.length)L.polyline(geometry.map((pair:any)=>[Number(pair[1]),Number(pair[0])]),{weight:4}).addTo(layer); for(const node of query.data.nodes||[])L.circleMarker([Number(node.latitude),Number(node.longitude)],{radius:6}).bindTooltip(node.name||node.type||"Route point").addTo(layer); pins.forEach((pin,index)=>L.marker([pin.latitude,pin.longitude]).bindTooltip(`Temporary pin ${index+1}`).addTo(layer));
  },[pins,projection]);
  const establish=async()=>{ if(!query.data?.nodes?.length||!pins.length)return; setProjecting(true); try{ const base=(query.data.nodes||[]).map((n:any)=>({latitude:Number(n.latitude),longitude:Number(n.longitude)})); const coords=direction==="pickup" && base.length>1 ? [...base.slice(0,-1),...pins,base[base.length-1]] : [...base,...pins]; const result=await fetchJson("POST","/api/transport/maps/route",{coordinates:coords}); setProjection(result); } finally{setProjecting(false);} };
  const shown=projection||query.data;
  return <Dialog open onOpenChange={(open)=>!open&&close()}><DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>{vehicle?.registrationNumber} · View Route</DialogTitle><DialogDescription>Read-only automatic route derived from learner locations and mandatory school checkpoints. Temporary pins are for lookup/projection only and are discarded when this window closes.</DialogDescription></DialogHeader>
    <div className="flex flex-wrap items-end gap-3"><Choice label="Direction" value={direction} onChange={(value:any)=>setDirection(value)} items={[["pickup","School-bound"],["dropoff","Home-bound"]]}/><Stat label="Estimated distance" value={`${money(shown?.distanceKm)} km`}/><Stat label="Estimated duration" value={`${Number(shown?.durationMinutes||0)} min`}/><Stat label="Routing" value={shown?.provider || "—"}/></div>
    {query.data?.warnings?.length>0&&<Alert><AlertTriangle className="h-4 w-4"/><AlertTitle>Route configuration attention</AlertTitle><AlertDescription>{query.data.warnings.join(" ")}</AlertDescription></Alert>}
    <div ref={mapHost} className="h-[430px] w-full overflow-hidden rounded-lg border" />
    <div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium">Temporary pins</div><div className="text-xs text-muted-foreground">Click the map to add one or more pins. Copy either coordinate for learner registration.</div></div><div className="flex gap-2"><Button variant="outline" disabled={!pins.length} onClick={()=>{setPins([]);setProjection(null);}}>Clear Pins</Button><Button disabled={!pins.length||projecting} onClick={()=>void establish()}>{projecting?"Establishing…":"Establish Route"}</Button></div></div>{pins.length? <DataTable heads={["Pin","Latitude","Longitude"]}>{pins.map((pin,index)=><TableRow key={index}><TableCell>Pin {index+1}</TableCell><TableCell><div className="flex items-center gap-1"><span>{pin.latitude.toFixed(6)}</span><Button size="icon" variant="ghost" onClick={()=>void copyCoordinate(pin.latitude)}><Copy className="h-3.5 w-3.5"/></Button></div></TableCell><TableCell><div className="flex items-center gap-1"><span>{pin.longitude.toFixed(6)}</span><Button size="icon" variant="ghost" onClick={()=>void copyCoordinate(pin.longitude)}><Copy className="h-3.5 w-3.5"/></Button></div></TableCell></TableRow>)}</DataTable>:<p className="text-sm text-muted-foreground">No temporary pins added.</p>}</div>
    <Field label="Notes"><Textarea value={vehicle?.routeNotes || ""} disabled placeholder="No saved vehicle route notes."/></Field>
    <DialogFooter><Button variant="outline" onClick={close}>Close</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function CancelServiceDialog({ assignment, saving, close, submit }: any) {
  const [stopServiceDate, setStopServiceDate] = useState(today());
  const [reason, setReason] = useState("");
  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Cancel Transport Service</DialogTitle><DialogDescription>The Stop Service Date is the learner's last day using the service. Historical registrations remain available in Learner Accounts.</DialogDescription></DialogHeader><Field label="Stop Service Date"><Input type="date" value={stopServiceDate} min={assignment?.startDate || undefined} onChange={(event) => setStopServiceDate(event.target.value)}/></Field><Field label="Reason for Cancellation"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this transport service ending?"/></Field><DialogFooter><Button variant="outline" onClick={close}>Keep Service</Button><Button variant="destructive" disabled={saving || !stopServiceDate || !reason.trim()} onClick={() => submit("POST", `/api/transport/assignments/${assignment.id}/cancel`, { stopServiceDate, reason: reason.trim() })}>{saving ? "Cancelling…" : "Cancel Service"}</Button></DialogFooter></DialogContent></Dialog>;
}

function RejectAdvanceDialog({ advance, saving, close, submit }: any) {
  const [reason, setReason] = useState("");
  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Reject Vehicle Advance</DialogTitle><DialogDescription>Rejection is audited and requires a reason.</DialogDescription></DialogHeader><Field label="Reason for Rejection"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this advance being rejected?"/></Field><DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button variant="destructive" disabled={saving || reason.trim().length < 3} onClick={() => submit("POST", `/api/transport/advances/${advance.id}/reject`, { reason: reason.trim() })}>{saving ? "Rejecting…" : "Reject Advance"}</Button></DialogFooter></DialogContent></Dialog>;
}

function renderDialogFields(type: string, form: any, set: (key: string, value: any) => void, data: Bootstrap, record?: any) {
  const selectableOwners = data.allOwners?.length ? data.allOwners : data.owners;
  const selectableDrivers = data.allDrivers?.length ? data.allDrivers : data.drivers;
  if (type === "route") return <><EntitySelect label="Organisation destination identity" items={data.destinationMasters || []} value={form.destinationMasterId} onChange={(value: any) => { const id = idValue(value); const master = (data.destinationMasters || []).find((item: any) => Number(item.id) === Number(id)); set("destinationMasterId", id); if (master) set("name", master.name); }} itemText={(destination: any) => destination.name} optional optionalLabel="Create a new destination identity"/><Field label="Destination name"><Input value={form.name || ""} onChange={(event) => set("name", event.target.value)}/></Field><Field label="Route code"><Input value={form.code || ""} onChange={(event) => set("code", event.target.value.toUpperCase())}/></Field><Choice label="General direction" value={form.direction} onChange={(value: any) => set("direction", value)} items={[["both", "Both directions"], ["pickup", "School-bound only"], ["dropoff", "Home-bound only"]]}/><NumberField label="Default two-way monthly fee (USD)" value={form.defaultFee} onChange={(value: any) => set("defaultFee", value)} min={0} step="0.01"/><Choice label="Status" value={form.status} onChange={(value: any) => { set("status", value); set("isActive", value !== "retired"); }} items={[["draft", "Draft"], ["pending_approval", "Pending approval"], ["active", "Active"], ["suspended", "Suspended"], ["retired", "Retired"]]}/><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></>;
  if (type === "vehicle") {
    const ownerItems = form.ownershipType === "staff"
      ? selectableOwners.filter((owner: any) => owner.isActive && owner.isStaffOwner)
      : form.ownershipType === "contracted"
        ? selectableOwners.filter((owner: any) => owner.isActive && !owner.isStaffOwner)
        : [];
    const allVehiclesForDriverAvailability = data.allVehicles?.length ? data.allVehicles : data.vehicles;
    const currentVehicleId = Number(record?.id || 0);
    const currentDriverId = Number(form.driverId || 0);
    const driverAssignedElsewhere = (driverId: number) => allVehiclesForDriverAvailability.some((vehicle: any) =>
      Boolean(vehicle.isActive)
      && Number(vehicle.id || 0) !== currentVehicleId
      && Number(vehicle.driverId || 0) === driverId
    );
    const driverAlternativeElsewhere = (driverId: number) => allVehiclesForDriverAvailability.some((vehicle: any) =>
      Boolean(vehicle.isActive)
      && Number(vehicle.id || 0) !== currentVehicleId
      && (vehicle.alternativeDriverIds || []).map(Number).includes(driverId)
    );
    const driverMatchesVehicleOwner = (driver: any) => form.ownershipType === "school"
      ? driver.engagementType === "internal"
      : driver.engagementType === "external" && Number(driver.ownerId || 0) === Number(form.ownerId || 0);
    const driverItems = selectableDrivers.filter((driver: any) => {
      const isCurrentDriver = currentDriverId > 0 && Number(driver.id) === currentDriverId;
      if (isCurrentDriver) return true;
      return Boolean(driver.isActive) && driverMatchesVehicleOwner(driver) && !driverAssignedElsewhere(Number(driver.id)) && !driverAlternativeElsewhere(Number(driver.id));
    });
    const driverLabel = (driver: any) => {
      const owner = selectableOwners.find((candidate: any) => Number(candidate.id) === Number(driver.ownerId || 0));
      const employer = driver.engagementType === "internal" ? "FCGS" : owner?.name;
      const current = currentDriverId > 0 && Number(driver.id) === currentDriverId;
      return `${driver.firstName} ${driver.lastName}${current ? " · Current driver" : ""}${employer ? ` · ${employer}` : ""}`;
    };
    const destinationSource = (data.organizationRoutes?.length ? data.organizationRoutes : data.routes)
      .filter((destination: any) => destination.isActive !== false && destination.status !== "retired");
    const destinationRepresentatives = new Map<string, any>();
    for (const destination of destinationSource) {
      const key = destination.destinationMasterId ? `master:${destination.destinationMasterId}` : `route:${destination.id}`;
      const current = destinationRepresentatives.get(key);
      if (!current || (Number(destination.schoolId) === Number(data.school?.id) && Number(current.schoolId) !== Number(data.school?.id))) destinationRepresentatives.set(key, destination);
    }
    const destinationOptions = Array.from(destinationRepresentatives.values()).map((destination: any) => ({
      value: String(destination.id),
      label: destination.name,
      searchText: `${destination.code || ""} ${destination.name || ""}`,
    }));
    return <>
      <Field label="Registration number"><Input value={form.registrationNumber || ""} maxLength={40} pattern="[A-Za-z0-9 ]+" title="Letters, numbers and spaces only" onChange={(event) => set("registrationNumber", event.target.value.replace(/[^A-Za-z0-9 ]/g, "").toUpperCase())}/><p className="text-xs text-muted-foreground">Letters, numbers and spaces only. This Transport record remains independent unless it was explicitly linked from Fleet.</p></Field>
      <Field label="Make / model"><Input value={form.makeModel || ""} onChange={(event) => set("makeModel", event.target.value)}/></Field>
      <div className="md:col-span-2"><Field label="Destinations"><SearchableMultiSelect values={(form.destinationIds || []).map((id: any) => String(id))} onValuesChange={(values) => set("destinationIds", values.map((value) => Number(value)))} options={destinationOptions} placeholder="Select destinations served" searchPlaceholder="Search destinations…" emptyText="No active destinations found" maxVisibleItems={8}/><p className="text-xs text-muted-foreground">Select every destination this vehicle serves. Learner registration only offers vehicles linked to the learner's selected destination, and full vehicles are excluded.</p></Field></div>
      <NumberField label="Capacity" value={form.capacity} onChange={(value: any) => set("capacity", value)} min={1}/>
      <Choice label="Ownership" value={form.ownershipType} onChange={(value: any) => { set("ownershipType", value); set("ownerId", null); set("driverId", null); set("alternativeDriverIds", []); }} items={[["school", "School-owned"], ["staff", "Staff-owned"], ["contracted", "Contracted"]]}/>
      {form.ownershipType === "school" ? <Field label="Owner"><Input value={data.school.name} disabled/></Field> : <EntitySelect label="Owner" items={ownerItems} value={form.ownerId} onChange={(value: any) => { set("ownerId", idValue(value)); set("driverId", null); set("alternativeDriverIds", []); }} itemText={(owner: any) => `${owner.name}${owner.isStaffOwner ? " · Staff Owner" : ""}`}/>}
      <EntitySelect label="Primary Driver" items={driverItems} value={form.driverId} onChange={(value: any) => { const id=idValue(value); set("driverId", id); set("alternativeDriverIds", (form.alternativeDriverIds || []).filter((driverId:number)=>driverId!==id)); }} itemText={driverLabel} optional/>
      <div className="md:col-span-2"><Field label="Alternative Drivers"><SearchableMultiSelect values={(form.alternativeDriverIds || []).map((id:any)=>String(id))} onValuesChange={(values)=>set("alternativeDriverIds", values.map(Number))} options={selectableDrivers.filter((driver:any)=>Boolean(driver.isActive) && driverMatchesVehicleOwner(driver) && Number(driver.id)!==Number(form.driverId||0) && !driverAssignedElsewhere(Number(driver.id))).map((driver:any)=>({value:String(driver.id),label:`${driver.firstName} ${driver.lastName}`,searchText:`${driver.firstName} ${driver.lastName} ${driver.licenceNumber||""}`}))} placeholder="Select alternative drivers" searchPlaceholder="Search drivers…" emptyText="No eligible alternative drivers" maxVisibleItems={6}/><p className="text-xs text-muted-foreground">An alternative may cover multiple vehicles, but cannot be a Primary Driver elsewhere and can actively operate only one vehicle at a time.</p></Field></div>
      <Field label="Registration expiry"><Input type="date" value={form.registrationExpiry || ""} onChange={(event) => set("registrationExpiry", event.target.value || null)}/></Field>
      <Field label="Insurance expiry"><Input type="date" value={form.insuranceExpiry || ""} onChange={(event) => set("insuranceExpiry", event.target.value || null)}/></Field>
      <Field label="Fitness expiry"><Input type="date" value={form.fitnessExpiry || ""} onChange={(event) => set("fitnessExpiry", event.target.value || null)}/></Field>
      <Field label="Radio licence expiry"><Input type="date" value={form.radioLicenceExpiry || ""} onChange={(event) => set("radioLicenceExpiry", event.target.value || null)}/></Field>
      <Choice label="Status" value={form.status} onChange={(value: any) => { set("status", value); set("isActive", value === "active"); }} items={[["draft", "Draft"], ["active", "Active"], ["suspended", "Suspended"], ["retired", "Retired"]]}/>
      {record && <><Field label="Effective date of owner/driver change"><Input type="date" value={form.effectiveDate || today()} onChange={(event) => set("effectiveDate", event.target.value)}/></Field><Field label="Change reason"><Input value={form.changeReason || ""} onChange={(event) => set("changeReason", event.target.value)}/></Field></>}
      <div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></div>
    </>;
  }
  if (type === "changePrimaryDriver") {
    const vehicle = record;
    const currentAltIds = new Set((vehicle.alternativeDriverIds || []).map(Number));
    const allVehicles = data.allVehicles?.length ? data.allVehicles : data.vehicles;
    const available = (data.allDrivers || data.drivers).filter((driver:any) => {
      const driverId = Number(driver.id);
      if (!driver.isActive || currentAltIds.has(driverId) || driverId === Number(vehicle.driverId || 0)) return false;
      const primaryElsewhere = allVehicles.some((candidate:any) => candidate.isActive && Number(candidate.id)!==Number(vehicle.id) && Number(candidate.driverId||0)===driverId);
      const alternativeElsewhere = allVehicles.some((candidate:any) => candidate.isActive && Number(candidate.id)!==Number(vehicle.id) && (candidate.alternativeDriverIds||[]).map(Number).includes(driverId));
      return !primaryElsewhere && !alternativeElsewhere;
    });
    return <><EntitySelect label="New Primary Driver" items={available} value={form.driverId} onChange={(value:any)=>set("driverId",idValue(value))} itemText={(driver:any)=>`${driver.firstName} ${driver.lastName}`}/><Field label="Effective date"><Input type="date" value={form.effectiveDate} onChange={e=>set("effectiveDate",e.target.value)}/></Field><div className="md:col-span-2"><Field label="Reason"><Textarea value={form.reason||""} onChange={e=>set("reason",e.target.value)}/></Field></div><div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes||""} onChange={e=>set("notes",e.target.value)}/></Field></div></>;
  }
  if (type === "activateAlternativeDriver") return <><EntitySelect label="Alternative Driver" items={record.alternativeDrivers || []} value={form.driverId} onChange={(value:any)=>set("driverId",idValue(value))} itemText={(driver:any)=>`${driver.firstName} ${driver.lastName}`}/><Field label="Cover starts"><Input type="datetime-local" value={form.effectiveAt||""} onChange={e=>set("effectiveAt",e.target.value)}/></Field><Field label="Expected return (optional)"><Input type="datetime-local" value={form.expectedReturnAt||""} onChange={e=>set("expectedReturnAt",e.target.value)}/></Field><div className="md:col-span-2"><Field label="Reason"><Textarea value={form.reason||""} onChange={e=>set("reason",e.target.value)}/></Field></div><div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes||""} onChange={e=>set("notes",e.target.value)}/></Field></div></>;
  if (type === "returnPrimaryDriver") return <><div className="md:col-span-2 rounded-md border bg-muted/40 p-3 text-sm">Return <b>{data.allDrivers.find((d:any)=>Number(d.id)===Number(record.driverId))?.firstName || "the Primary Driver"}</b> to active operation on {record.registrationNumber}.</div><Field label="Effective date/time"><Input type="datetime-local" value={form.effectiveAt||""} onChange={e=>set("effectiveAt",e.target.value)}/></Field><div className="md:col-span-2"><Field label="Reason"><Textarea value={form.reason||""} onChange={e=>set("reason",e.target.value)}/></Field></div></>;
  if (type === "changeVehicleOwner") {
    const owners=data.allOwners||data.owners; const drivers=data.allDrivers||data.drivers;
    const ownerItems=form.ownershipType==="school"?[]:owners.filter((o:any)=>o.isActive && (form.ownershipType==="staff"?o.isStaffOwner:!o.isStaffOwner));
    const compatible=drivers.filter((d:any)=>d.isActive && (form.ownershipType==="school"?d.engagementType==="internal":d.engagementType==="external"&&Number(d.ownerId||0)===Number(form.ownerId||0)));
    return <><Choice label="Ownership" value={form.ownershipType} onChange={(v:any)=>{set("ownershipType",v);set("ownerId",null);set("primaryDriverId",null);set("alternativeDriverIds",[]);}} items={[["school","School-owned"],["staff","Staff-owned"],["contracted","Contracted"]]}/>{form.ownershipType==="school"?<Field label="Owner"><Input value={data.school.name} disabled/></Field>:<EntitySelect label="New Owner" items={ownerItems} value={form.ownerId} onChange={(v:any)=>{set("ownerId",idValue(v));set("primaryDriverId",null);set("alternativeDriverIds",[]);}} itemText={(o:any)=>o.name}/>}<EntitySelect label="Primary Driver" items={compatible} value={form.primaryDriverId} onChange={(v:any)=>set("primaryDriverId",idValue(v))} itemText={(d:any)=>`${d.firstName} ${d.lastName}`} optional/><div className="md:col-span-2"><Field label="Alternative Drivers"><SearchableMultiSelect values={(form.alternativeDriverIds||[]).map(String)} onValuesChange={(v)=>set("alternativeDriverIds",v.map(Number))} options={compatible.filter((d:any)=>Number(d.id)!==Number(form.primaryDriverId||0)).map((d:any)=>({value:String(d.id),label:`${d.firstName} ${d.lastName}`}))} placeholder="Select alternatives"/></Field></div><Field label="Effective date"><Input type="date" value={form.effectiveDate} onChange={e=>set("effectiveDate",e.target.value)}/></Field><div className="md:col-span-2"><Field label="Reason"><Textarea value={form.reason||""} onChange={e=>set("reason",e.target.value)}/></Field></div></>;
  }
  if (type === "replaceVehicle") {
    const associatedSchoolIds = (data.vehicleSchoolAssociations || []).filter((link:any)=>Number(link.vehicleId)===Number(record.id) && link.isActive!==false).map((link:any)=>Number(link.schoolId));
    const schoolOptions = (data.organizationSchools || []).filter((school:any)=>associatedSchoolIds.includes(Number(school.id))).map((school:any)=>({value:String(school.id),label:school.name,searchText:school.name}));
    return <><EntitySelect label="Replacement Vehicle" items={(data.allVehicles||[]).filter((v:any)=>v.isActive&&Number(v.id)!==Number(record.id))} value={form.replacementVehicleId} onChange={(v:any)=>set("replacementVehicleId",idValue(v))} itemText={(v:any)=>`${v.registrationNumber} · ${v.capacity||0} seats`}/><Choice label="Replacement type" value={form.replacementType} onChange={(v:any)=>set("replacementType",v)} items={[["permanent","Permanent"],["temporary","Temporary"]]}/><div className="md:col-span-2"><Field label="Apply replacement to schools"><SearchableMultiSelect values={(form.schoolIds||[]).map(String)} onValuesChange={(values)=>set("schoolIds",values.map(Number))} options={schoolOptions} placeholder="Select associated schools" searchPlaceholder="Search schools…" emptyText="No associated schools found"/><p className="text-xs text-muted-foreground">Only the selected school associations and their active learner assignments move to the replacement vehicle.</p></Field></div><Field label="Effective date/time"><Input type="datetime-local" value={form.effectiveAt} onChange={e=>set("effectiveAt",e.target.value)}/></Field>{form.replacementType==="temporary"&&<Field label="Expected return"><Input type="datetime-local" value={form.expectedReturnAt||""} onChange={e=>set("expectedReturnAt",e.target.value)}/></Field>}<BooleanField label="Carry destination associations" value={Boolean(form.carryDestinations)} onChange={(v:any)=>set("carryDestinations",v)}/><BooleanField label="Carry owner" value={Boolean(form.carryOwner)} onChange={(v:any)=>set("carryOwner",v)}/><BooleanField label="Carry Primary Driver" value={Boolean(form.carryPrimaryDriver)} onChange={(v:any)=>set("carryPrimaryDriver",v)}/><BooleanField label="Carry Alternative Drivers" value={Boolean(form.carryAlternativeDrivers)} onChange={(v:any)=>set("carryAlternativeDrivers",v)}/><div className="md:col-span-2"><Field label="Reason"><Textarea value={form.reason||""} onChange={e=>set("reason",e.target.value)}/></Field></div><div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes||""} onChange={e=>set("notes",e.target.value)}/></Field></div></>;
  }
  if (type === "returnOriginalVehicle") return <><div className="md:col-span-2 rounded-md border bg-muted/40 p-3 text-sm">Return the original vehicle to service and move current school assignments back from the temporary replacement.</div><Field label="Effective date/time"><Input type="datetime-local" value={form.effectiveAt} onChange={e=>set("effectiveAt",e.target.value)}/></Field><div className="md:col-span-2"><Field label="Reason"><Textarea value={form.reason||""} onChange={e=>set("reason",e.target.value)}/></Field></div></>;
  if (type === "driver") return <><Field label="First name"><Input value={form.firstName || ""} onChange={(event) => set("firstName", event.target.value)}/></Field><Field label="Last name"><Input value={form.lastName || ""} onChange={(event) => set("lastName", event.target.value)}/></Field><Field label="Phone"><Input value={form.phone || ""} onChange={(event) => set("phone", event.target.value)}/></Field><Field label="Home address"><Textarea value={form.homeAddress || ""} onChange={(event) => set("homeAddress", event.target.value)}/></Field><Field label="National ID"><Input value={form.nationalId || ""} onChange={(event) => set("nationalId", event.target.value)}/></Field><Field label="Licence number"><Input value={form.licenceNumber || ""} onChange={(event) => set("licenceNumber", event.target.value)}/></Field><Field label="Licence expiry"><Input type="date" value={form.licenceExpiry || ""} onChange={(event) => set("licenceExpiry", event.target.value || null)}/></Field><Choice label="Engagement" value={form.engagementType} onChange={(value: any) => { set("engagementType", value); if (value === "internal") set("ownerId", null); }} items={[["internal", "Internal / school driver"], ["external", "External / owner-employed"]]}/>{form.engagementType === "external" && <EntitySelect label="Vehicle owner / employer" items={selectableOwners.filter((owner: any) => owner.isActive)} value={form.ownerId} onChange={(value: any) => set("ownerId", idValue(value))} itemText={(owner: any) => `${owner.name}${owner.isStaffOwner ? " · Staff Owner" : ""}`}/>}<BooleanField label="Active" value={form.isActive} onChange={(value: any) => set("isActive", value)}/><Field label="Effective from"><Input type="date" value={form.effectiveFrom || ""} onChange={(event) => set("effectiveFrom", event.target.value || null)}/></Field>{record && <><Field label="Relationship change effective date"><Input type="date" value={form.effectiveDate || today()} onChange={(event) => set("effectiveDate", event.target.value)}/></Field><Field label="Change reason"><Input value={form.changeReason || ""} onChange={(event) => set("changeReason", event.target.value)}/></Field></>}<div className="md:col-span-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">Driver photo and other attachments are uploaded from <b>View details → Documents & Images</b>. The primary image is displayed at the top of the driver record.</div><div className="md:col-span-2 border-t pt-3 text-sm font-semibold">Next of Kin</div><Field label="Full name"><Input value={form.nextOfKinName || ""} onChange={(event) => set("nextOfKinName", event.target.value)}/></Field><Field label="Relationship"><Input value={form.nextOfKinRelationship || ""} onChange={(event) => set("nextOfKinRelationship", event.target.value)}/></Field><Field label="Primary phone"><Input value={form.nextOfKinPhone || ""} onChange={(event) => set("nextOfKinPhone", event.target.value)}/></Field><Field label="Alternative phone"><Input value={form.nextOfKinAlternativePhone || ""} onChange={(event) => set("nextOfKinAlternativePhone", event.target.value)}/></Field><Field label="Email"><Input type="email" value={form.nextOfKinEmail || ""} onChange={(event) => set("nextOfKinEmail", event.target.value)}/></Field><Field label="Address"><Textarea value={form.nextOfKinAddress || ""} onChange={(event) => set("nextOfKinAddress", event.target.value)}/></Field><div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></div></>;
  if (type === "owner") return <><div className="md:col-span-2 grid gap-4 md:grid-cols-3"><BooleanField label="Owner is Staff Member" value={form.isStaffOwner} onChange={(value: any) => { set("isStaffOwner", value); set("ownerType", value ? "individual" : form.ownerType); if (!value) set("staffId", null); }}/><Choice label="Type" value={form.ownerType} onChange={(value: any) => { set("ownerType", value); if (value === "company") { set("isStaffOwner", false); set("staffId", null); } }} items={[["individual", "Individual"], ["company", "Company"]]}/>{form.isStaffOwner ? <Field label="Owner/Company Name"><StaffOwnerSelector value={form.staffId} onSelect={(staffMember) => { set("staffId", staffMember?.id || null); if (!staffMember) return; set("name", `${staffMember.firstName} ${staffMember.lastName}`); set("phone", staffMember.phone || ""); set("email", staffMember.email || ""); set("address", staffMember.address || ""); set("nationalIdOrRegistration", staffMember.nationalId || ""); }}/></Field> : <Field label="Owner/Company Name"><Input value={form.name || ""} onChange={(event) => set("name", event.target.value)}/></Field>}</div><Field label="Owner's Phone"><Input value={form.phone || ""} onChange={(event) => set("phone", event.target.value)}/></Field><Field label="Owner's Email"><Input type="email" value={form.email || ""} onChange={(event) => set("email", event.target.value)}/></Field><div className="md:col-span-2"><Field label="Owner's Address"><Textarea value={form.address || ""} onChange={(event) => set("address", event.target.value)}/></Field></div><Field label="National ID / Company Registration"><Input value={form.nationalIdOrRegistration || ""} onChange={(event) => set("nationalIdOrRegistration", event.target.value)}/></Field><Field label="Payment details"><Textarea value={form.paymentDetails || ""} onChange={(event) => set("paymentDetails", event.target.value)}/></Field><div className="md:col-span-2 border-t pt-3 text-sm font-semibold">Alternative contact</div><Field label="Name"><Input value={form.alternativeContactName || ""} onChange={(event) => set("alternativeContactName", event.target.value)}/></Field><Field label="Relationship / role"><Input value={form.alternativeContactRelationship || ""} onChange={(event) => set("alternativeContactRelationship", event.target.value)}/></Field><Field label="Phone"><Input value={form.alternativeContactPhone || ""} onChange={(event) => set("alternativeContactPhone", event.target.value)}/></Field><Field label="Email"><Input type="email" value={form.alternativeContactEmail || ""} onChange={(event) => set("alternativeContactEmail", event.target.value)}/></Field><Field label="Effective from"><Input type="date" value={form.effectiveFrom || ""} onChange={(event) => set("effectiveFrom", event.target.value || null)}/></Field><BooleanField label="Active" value={form.isActive} onChange={(value: any) => set("isActive", value)}/><div className="md:col-span-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">Owner attachments are managed from <b>View details → Documents & Images</b>.</div><div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></div></>;
  if (type === "transfer") return <><div className="md:col-span-2 rounded-md border bg-muted/40 p-3 text-sm"><b>Current assignment:</b> {record.firstName} {record.lastName} · {record.routeName} · {record.vehicleRegistration || "No vehicle"}</div><Field label="Transfer effective date"><Input type="date" value={form.effectiveDate} onChange={(event) => set("effectiveDate", event.target.value)}/></Field><Choice label="Transfer type" value={form.transferType} onChange={(value: any) => set("transferType", value)} items={[["vehicle", "Vehicle only"], ["stop", "Stop only"], ["path", "Path only"], ["route", "Route"], ["service_type", "Service type"], ["temporary", "Temporary"], ["permanent", "Permanent"]]}/><EntitySelect label="New route" items={data.routes.filter((route: any) => route.isActive)} value={form.routeId} onChange={(value: any) => set("routeId", idValue(value))} itemText={(route: any) => route.name}/><EntitySelect label={form.serviceType === "dropoff" ? "New Home-bound Vehicle" : "New School-bound Vehicle"} items={data.vehicles.filter((vehicle: any) => vehicle.isActive)} value={form.serviceType === "dropoff" ? form.outboundVehicleId : form.vehicleId} onChange={(value: any) => { const vehicleId = idValue(value); if (form.serviceType === "dropoff") set("outboundVehicleId", vehicleId); else { set("vehicleId", vehicleId); if (form.serviceType === "both") set("outboundVehicleId", vehicleId); } }} itemText={(vehicle: any) => vehicle.registrationNumber} optional/>{form.serviceType === "both" && <Field label="New Home-bound Vehicle"><Input value={data.vehicles.find((vehicle: any) => vehicle.id === Number(form.vehicleId))?.registrationNumber || "Auto-populates from School-bound Vehicle"} disabled/></Field>}<Choice label="Service type" value={form.serviceType} onChange={(value: any) => { set("serviceType", value); if (value === "both" && form.vehicleId) set("outboundVehicleId", form.vehicleId); }} items={[["both", "Two-way"], ["pickup", "School-bound"], ["dropoff", "Home-bound"]]}/><NumberField label="New full monthly fee" value={form.baseMonthlyFee} onChange={(value: any) => set("baseMonthlyFee", value)} min={0} step="0.01"/><NumberField label="New agreed monthly fee" value={form.agreedFee} onChange={(value: any) => set("agreedFee", value)} min={0} step="0.01"/><div className="md:col-span-2"><Field label="Mandatory reason"><Textarea value={form.reason || ""} onChange={(event) => set("reason", event.target.value)}/></Field></div></>;
  if (type === "state") return <><div className="md:col-span-2 rounded-md border bg-muted/40 p-3 text-sm"><b>{record.firstName} {record.lastName}</b> is currently {titleCase(record.serviceState)}.</div><Choice label="New service state" value={form.state} onChange={(value: any) => set("state", value)} items={[["active", "Active"], ["suspended", "Suspended"], ["paused", "Paused voluntarily"], ["terminated", "Terminated"], ["completed", "Completed"]]}/><Field label="Effective date"><Input type="date" value={form.effectiveDate} onChange={(event) => set("effectiveDate", event.target.value)}/></Field>{["paused", "terminated"].includes(form.state) && <Choice label="Credit / refund method" value={form.refundMethod} onChange={(value: any) => set("refundMethod", value)} items={[["credit", "Learner transport credit"], ["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["mobile_money", "Mobile money"], ["original_method", "Original payment method"]]}/>}<div className="md:col-span-2"><Field label="Mandatory reason"><Textarea value={form.reason || ""} onChange={(event) => set("reason", event.target.value)}/></Field></div></>;
  if (type === "charge") return <><Field label="Academic year"><Input type="number" value={form.academicYear} onChange={(event) => set("academicYear", event.target.value)}/></Field><MonthSelector label="Service Month" value={form.month} onChange={(value: any) => set("month", value)}/><Field label="Due date"><Input type="date" value={form.dueDate || ""} onChange={(event) => set("dueDate", event.target.value)}/></Field><div className="md:col-span-2"><Alert><ShieldCheck className="h-4 w-4"/><AlertTitle>Prorating is automatic</AlertTitle><AlertDescription>Joining and exit effective dates, month length, leap years and saved policy values are applied automatically. Holidays are not excluded.</AlertDescription></Alert></div></>;
  if (type === "payment") return <><EntitySelect label="Learner" items={data.paymentEligibleStudents || []} value={form.studentId} onChange={(value: any) => set("studentId", idValue(value))} itemText={(student: any) => `${student.firstName} ${student.lastName} (${student.admissionNo})`}/><NumberField label="Amount (USD)" value={form.amount} onChange={(value: any) => set("amount", value)} min={0.01} step="0.01"/><Field label="Payment date"><Input type="date" value={form.paymentDate} onChange={(event) => set("paymentDate", event.target.value)}/></Field><Choice label="Payment method" value={form.paymentMethod} onChange={(value: any) => set("paymentMethod", value)} items={[["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["mobile_money", "Mobile money"], ["card", "Card"], ["cheque", "Cheque"], ["other", "Other"]]}/><Field label="Academic year"><Input type="number" value={form.academicYear} onChange={(event) => set("academicYear", event.target.value)}/></Field><MonthSelector label="Service Month" value={form.month} onChange={(value: any) => set("month", value)} includeUnspecified/><Choice label="Allocation policy" value={form.allocationMode} onChange={(value: any) => set("allocationMode", value)} items={[["oldest_first", "Oldest outstanding charge first (also applies when a later charge is generated)"], ["future_credit", "Hold entirely as future credit (no automatic allocation)"]]}/><Field label="Transaction / bank reference"><Input value={form.externalReference || ""} onChange={(event) => set("externalReference", event.target.value)}/></Field><div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></div></>;
  if (type === "reversePayment") return <div className="md:col-span-2"><Alert variant="destructive"><AlertTriangle className="h-4 w-4"/><AlertTitle>Reverse immutable receipt {record.receiptNo}</AlertTitle><AlertDescription>The original remains in the audit trail and is marked REVERSED. It cannot be edited.</AlertDescription></Alert><div className="mt-4"><Field label="Mandatory reversal reason"><Textarea value={form.reason || ""} onChange={(event) => set("reason", event.target.value)}/></Field></div></div>;

  if (type === "refund") return <><EntitySelect label="Learner" items={data.students} value={form.studentId} onChange={(value: any) => { set("studentId", idValue(value)); const assignment = data.assignments.find((row: any) => row.studentId === idValue(value) && row.isActive); set("assignmentId", assignment?.id || null); }} itemText={(student: any) => `${student.firstName} ${student.lastName} (${student.admissionNo})`}/><Choice label="Refund / credit type" value={form.refundType} onChange={(value: any) => set("refundType", value)} items={[["pause_credit", "Pause – learner transport credit"], ["termination_refund", "Termination refund"], ["overpayment", "Overpayment"], ["manual_adjustment", "Manual adjustment"]]}/><NumberField label="Amount (USD)" value={form.amount} onChange={(value: any) => set("amount", value)} min={0.01} step="0.01"/><Field label="Effective date"><Input type="date" value={form.effectiveDate} onChange={(event) => set("effectiveDate", event.target.value)}/></Field><Choice label="Method" value={form.method} onChange={(value: any) => set("method", value)} items={[["credit", "Learner transport credit"], ["cash", "Cash refund"], ["bank_transfer", "Bank transfer"], ["mobile_money", "Mobile money"], ["original_method", "Original payment method"]]}/><Field label="Reason"><Textarea value={form.reason || ""} onChange={(event) => set("reason", event.target.value)}/></Field></>;
  if (type === "payRefund") return <><div className="md:col-span-2 rounded-md border p-3"><b>{record.refundNumber}</b> · USD {money(record.amount)}</div><Field label="Payment reference"><Input value={form.externalReference || ""} onChange={(event) => set("externalReference", event.target.value)}/></Field></>;
  if (type === "cashup" || type === "cashupEdit") {
    const selectedPaymentIds = (form.paymentIds || []).map(Number);
    const selectedRefundIds = (form.refundIds || []).map(Number);
    const eligiblePayments = data.payments
      .filter((payment: any) => !payment.reversedAt && (!payment.cashupId || selectedPaymentIds.includes(Number(payment.id))) && payment.verificationStatus !== "reconciled")
      .sort((a:any,b:any) => Number(b.paymentDate === form.cashupDate) - Number(a.paymentDate === form.cashupDate) || String(a.paymentDate).localeCompare(String(b.paymentDate)));
    const eligibleRefunds = data.refunds.filter((refund:any)=>refund.status === "paid" && refund.method !== "credit" && (!refund.accountedCashupId || selectedRefundIds.includes(Number(refund.id))));
    const sameDatePaymentIds = eligiblePayments.filter((payment:any) => payment.paymentDate === form.cashupDate).map((payment:any) => payment.id);
    const sameDateRefundIds = eligibleRefunds.filter((refund:any) => refund.effectiveDate === form.cashupDate).map((refund:any) => refund.id);
    const selectedPayments = eligiblePayments.filter((payment:any) => selectedPaymentIds.includes(Number(payment.id)));
    const selectedRefunds = eligibleRefunds.filter((refund:any) => selectedRefundIds.includes(Number(refund.id)));
    const { cash: cashTotal, nonCash: nonCashTotal, invalid: invalidHandover } = clientCashupHandover(form, data);
    return <>
      <Field label="Cash-up date"><Input type="date" value={form.cashupDate} onChange={(event) => set("cashupDate", event.target.value)}/></Field>
      <div className="md:col-span-2"><Field label="Payments to include"><div className="mb-2 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => set("paymentIds", sameDatePaymentIds)}>Select cash-up date</Button><Button type="button" size="sm" variant="outline" onClick={() => set("paymentIds", [])}>Deselect All</Button></div><div className="max-h-64 overflow-y-auto rounded-md border p-3 space-y-2">{eligiblePayments.map((payment: any) => <label key={payment.id} className={classNames("flex items-center justify-between gap-3 rounded px-1 py-1 text-sm", payment.paymentDate !== form.cashupDate && "bg-amber-50 dark:bg-amber-950/20")}><span className="flex items-center gap-2"><Checkbox checked={(form.paymentIds || []).includes(payment.id)} onCheckedChange={(checked) => set("paymentIds", checked ? Array.from(new Set([...(form.paymentIds || []), payment.id])) : (form.paymentIds || []).filter((id: number) => id !== payment.id))}/><span>{payment.receiptNo} · {payment.firstName} {payment.lastName}<span className="ml-2 text-xs text-muted-foreground">{payment.paymentDate}{payment.paymentDate !== form.cashupDate ? " · older/outstanding" : ""}</span></span></span><span>USD {money(payment.amount)}</span></label>)}</div><p className="mt-2 text-xs text-muted-foreground">Payments for the selected cash-up date are prioritised. Older outstanding receipts remain available for legitimate late cash-ups and are clearly marked.</p></Field></div>
      <div className="md:col-span-2"><Field label="Paid refunds to deduct"><div className="mb-2 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={()=>set("refundIds",sameDateRefundIds)}>Select cash-up date</Button><Button type="button" size="sm" variant="outline" onClick={()=>set("refundIds",[])}>Deselect All</Button></div><div className="max-h-44 overflow-y-auto rounded-md border p-3 space-y-2">{eligibleRefunds.length?eligibleRefunds.map((refund:any)=><label key={refund.id} className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><Checkbox checked={(form.refundIds||[]).includes(refund.id)} onCheckedChange={(checked)=>set("refundIds",checked?Array.from(new Set([...(form.refundIds||[]),refund.id])):(form.refundIds||[]).filter((id:number)=>id!==refund.id))}/><span>{refund.refundNumber} · {titleCase(refund.method)}<span className="ml-2 text-xs text-muted-foreground">{refund.effectiveDate}</span></span></span><span className="text-destructive">− USD {money(refund.amount)}</span></label>):<span className="text-sm text-muted-foreground">No paid external refunds awaiting cash-up.</span>}</div></Field></div>
      <div className="md:col-span-2"><Field label="Direct cash advance repayments"><div className="space-y-2 rounded-md border p-3">{(data.advanceRepayments||[]).filter((r:any)=>r.status==="pending"&&r.paymentMethod==="cash"&&(!r.cashupId||(form.advanceRepaymentIds||[]).includes(r.id))).map((r:any)=><label key={r.id} className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><Checkbox checked={(form.advanceRepaymentIds||[]).includes(r.id)} onCheckedChange={checked=>set("advanceRepaymentIds",checked?Array.from(new Set([...(form.advanceRepaymentIds||[]),r.id])):(form.advanceRepaymentIds||[]).filter((x:number)=>x!==r.id))}/><span>Advance #{r.advanceId} · {r.paymentReference} · {r.paymentDate}</span></span><b>USD {money(r.amount)}</b></label>)}<p className="text-xs text-muted-foreground">Select cash principal repayments received for inclusion in this cash-up. They do not count as transport income.</p></div></Field></div>
      <div className="md:col-span-2 grid gap-3 sm:grid-cols-3 rounded-md border bg-muted/30 p-4"><InfoBox label="Cash amount for handover" value={`USD ${money(cashTotal)}`}/><InfoBox label="Non-cash amount for handover" value={`USD ${money(nonCashTotal)}`}/><InfoBox label="Total handover" value={`USD ${money(cashTotal + nonCashTotal)}`}/><p className="sm:col-span-3 text-xs text-muted-foreground">These figures are calculated automatically from the selected transactions. They cannot be edited, and the server recalculates them independently before saving.</p>{invalidHandover && <p className="sm:col-span-3 text-sm font-medium text-destructive">Invalid selection: refunds exceed receipts in at least one payment category. The cash-up cannot be saved until this is corrected.</p>}</div>
      <Field label="Deposit / reconciliation reference"><Input value={form.depositReference || ""} onChange={(event) => set("depositReference", event.target.value)}/></Field>
      <Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field>
    </>;
  }
  if (type === "subscription") return <><EntitySelect label="Vehicle override" items={data.vehicles} value={form.vehicleId} onChange={(value: any) => set("vehicleId", idValue(value))} itemText={(vehicle: any) => vehicle.registrationNumber} optional optionalLabel="All vehicles (school default)"/><Choice label="Rule type" value={form.ruleType} onChange={(value: any) => set("ruleType", value)} items={[["fixed", "Fixed amount"], ["percentage", "Percentage of gross"], ["percentage_with_limits", "Percentage with minimum/maximum"]]}/><NumberField label={form.ruleType === "fixed" ? "Value (USD)" : "Value (%)"} value={form.value} onChange={(value: any) => set("value", value)} min={0.01} step="0.01"/><NumberField label="Minimum amount (optional)" value={form.minimumAmount} onChange={(value: any) => set("minimumAmount", value)} min={0} step="0.01"/><NumberField label="Maximum amount (optional)" value={form.maximumAmount} onChange={(value: any) => set("maximumAmount", value)} min={0} step="0.01"/><Field label="Effective from"><Input type="date" value={form.effectiveFrom} onChange={(event) => set("effectiveFrom", event.target.value)}/></Field><Field label="Effective to"><Input type="date" value={form.effectiveTo || ""} onChange={(event) => set("effectiveTo", event.target.value)}/></Field><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field></>;
  if (type === "penalty") return <><EntitySelect label="Vehicle" items={data.vehicles} value={form.vehicleId} onChange={(value: any) => { const vehicle = data.vehicles.find((row: any) => row.id === idValue(value)); set("vehicleId", idValue(value)); set("ownerId", vehicle?.ownerId || null); }} itemText={(vehicle: any) => vehicle.registrationNumber}/><Field label="Penalty category"><Input value={form.category || ""} onChange={(event) => set("category", event.target.value)} placeholder="Configurable category name"/></Field><Field label="Incident date"><Input type="date" value={form.incidentDate} onChange={(event) => set("incidentDate", event.target.value)}/></Field><NumberField label="Amount (USD)" value={form.amount} onChange={(value: any) => set("amount", value)} min={0.01} step="0.01"/><Field label="Effective year"><Input type="number" value={form.effectiveYear} onChange={(event) => set("effectiveYear", event.target.value)}/></Field><MonthSelector label="Effective Month" value={form.effectiveMonth} onChange={(value: any) => set("effectiveMonth", value)}/><div className="md:col-span-2"><Field label="Reason"><Textarea value={form.reason || ""} onChange={(event) => set("reason", event.target.value)}/></Field></div></>;
  if (type === "advanceRepayment") return <><div className="md:col-span-2 text-sm">Advance #{record.id} · Outstanding USD {money(record.outstandingAmount)}. Recording does not reduce the balance until independent Accounts verification.</div><NumberField label="Amount received (USD)" value={form.amount} onChange={(v:any)=>set("amount",v)} min={0.01} step="0.01"/><Field label="Date received"><Input type="date" value={form.paymentDate} onChange={e=>set("paymentDate",e.target.value)}/></Field><Choice label="Method" value={form.paymentMethod} onChange={(v:any)=>set("paymentMethod",v)} items={[["cash","Cash (include in cash-up)"],["bank_transfer","Bank transfer"],["mobile_money","Mobile money"],["other","Other"]]}/><Field label="Receipt / bank reference"><Input value={form.paymentReference||""} onChange={e=>set("paymentReference",e.target.value)}/></Field><div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes||""} onChange={e=>set("notes",e.target.value)}/></Field></div></>;
  if (type === "verifyAdvanceRepayment") return <><div className="md:col-span-2 text-sm">Independently confirm receipt of USD {money(record.amount)} by {titleCase(record.paymentMethod)}. Cash repayments must be included in an HQ-confirmed cash-up.</div><div className="md:col-span-2"><Field label="Verification evidence / notes"><Textarea value={form.verificationNotes||""} onChange={e=>set("verificationNotes",e.target.value)}/></Field></div></>;
  if (type === "rejectAdvanceRepayment") return <div className="md:col-span-2"><Field label="Reason for rejection"><Textarea value={form.reason||""} onChange={e=>set("reason",e.target.value)}/></Field></div>;
  if (type === "advance") return <><EntitySelect label="Vehicle" items={data.vehicles} value={form.vehicleId} onChange={(value: any) => { const vehicle = data.vehicles.find((row: any) => row.id === idValue(value)); set("vehicleId", idValue(value)); set("ownerId", vehicle?.ownerId || null); }} itemText={(vehicle: any) => vehicle.registrationNumber}/><NumberField label="Advance amount (USD)" value={form.amount} onChange={(value: any) => set("amount", value)} min={0.01} step="0.01"/><Field label="Request date"><Input type="date" value={form.requestDate} onChange={(event) => set("requestDate", event.target.value)}/></Field><Choice label="Recovery method" value={form.recoveryMethod} onChange={(value: any) => set("recoveryMethod", value)} items={[["fixed_instalment", "Fixed instalment"], ["percentage", "Percentage of gross"], ["full_available", "Full available amount"], ["manual_schedule", "Manual schedule"]]}/><NumberField label={form.recoveryMethod === "percentage" ? "Recovery percentage" : "Recovery amount"} value={form.recoveryValue} onChange={(value: any) => set("recoveryValue", value)} min={0.01} step="0.01"/><Field label="Recovery start year"><Input type="number" value={form.recoveryStartYear} onChange={(event) => set("recoveryStartYear", event.target.value)}/></Field><MonthSelector label="Recovery Start Month" value={form.recoveryStartMonth} onChange={(value: any) => set("recoveryStartMonth", value)}/><NumberField label="Minimum owner take-home" value={form.minimumOwnerTakeHome} onChange={(value: any) => set("minimumOwnerTakeHome", value)} min={0} step="0.01"/><NumberField label="Maximum monthly recovery" value={form.maximumMonthlyRecovery} onChange={(value: any) => set("maximumMonthlyRecovery", value)} min={0} step="0.01"/><div className="md:col-span-2"><Field label="Purpose"><Textarea value={form.purpose || ""} onChange={(event) => set("purpose", event.target.value)}/></Field></div></>;
  if (type === "disburseAdvance") return <><Field label="Disbursement date"><Input type="date" value={form.disbursementDate || ""} onChange={(event) => set("disbursementDate", event.target.value)}/></Field><Field label="Payment / bank reference"><Input value={form.disbursementReference || ""} onChange={(event) => set("disbursementReference", event.target.value)}/></Field></>;
  if (type === "incident") {
    const selectedVehicle = data.vehicles.find((vehicle: any) => vehicle.id === Number(form.vehicleId));
    const currentDriverId = Number(selectedVehicle?.currentOperatingDriverId || selectedVehicle?.driverId || 0);
    const currentDriver = data.allDrivers.find((driver: any) => driver.id === currentDriverId);
    const selectedDriver = data.drivers.find((driver: any) => driver.id === Number(form.driverId));
    const candidateVehicles = form.vehicleId ? data.vehicles : form.driverId ? data.vehicles.filter((vehicle: any) => Number(vehicle.currentOperatingDriverId || vehicle.driverId) === Number(form.driverId)) : data.vehicles;
    const paths = data.paths.filter((path: any) => path.status === "active" && (!form.vehicleId || path.vehicleId === Number(form.vehicleId)));
    const selectedPath = paths.find((path: any) => path.id === Number(form.pathId));
    const fieldsLocked = !form.assignmentOverride;
    return <><EntitySelect label="Vehicle" items={candidateVehicles} value={form.vehicleId} onChange={(value: any) => { const vehicle = data.vehicles.find((item: any) => item.id === idValue(value)); const vehiclePaths = data.paths.filter((path: any) => path.status === "active" && path.vehicleId === vehicle?.id); const onlyPath = vehiclePaths.length === 1 ? vehiclePaths[0] : null; set("vehicleId", idValue(value)); set("ownerId", vehicle?.ownerId || null); set("driverId", vehicle?.currentOperatingDriverId || vehicle?.driverId || null); set("pathId", onlyPath?.id || null); set("routeId", onlyPath?.routeId || null); set("pathTraversal", "forward"); }} itemText={(vehicle: any) => `${vehicle.registrationNumber} · ${vehicle.makeModel || "Vehicle"}`}/><EntitySelect label="Driver" items={form.assignmentOverride ? data.drivers : currentDriver ? [currentDriver] : selectedDriver ? [selectedDriver] : data.drivers} value={form.driverId} onChange={(value: any) => { const driverId = idValue(value); set("driverId", driverId); if (!form.vehicleId) { const matches = data.vehicles.filter((vehicle: any) => Number(vehicle.currentOperatingDriverId || vehicle.driverId) === driverId); if (matches.length === 1) { const vehicle = matches[0]; const vehiclePaths = data.paths.filter((path: any) => path.status === "active" && path.vehicleId === vehicle.id); const onlyPath = vehiclePaths.length === 1 ? vehiclePaths[0] : null; set("vehicleId", vehicle.id); set("ownerId", vehicle.ownerId || null); set("pathId", onlyPath?.id || null); set("routeId", onlyPath?.routeId || null); } } }} itemText={(driver: any) => `${driver.firstName} ${driver.lastName}`} optional/><EntitySelect label="Vehicle path" items={paths} value={form.pathId} onChange={(value: any) => { const path = paths.find((item: any) => item.id === idValue(value)); set("pathId", idValue(value)); set("routeId", path?.routeId || null); set("pathTraversal", "forward"); }} itemText={(path: any) => `${path.name} v${path.versionNumber}${path.isTwoWay ? " · Two-way" : ""}`} optional/><Choice label="Journey direction" value={form.pathTraversal || "forward"} onChange={(value: any) => set("pathTraversal", value)} items={selectedPath?.isTwoWay ? [["forward", "Forward"], ["reverse", "Reverse"]] : [["forward", "Forward"]]}/><Field label="Route"><Input value={data.routes.find((route: any) => route.id === Number(form.routeId))?.name || "Automatically derived from path"} disabled={fieldsLocked}/></Field><BooleanField label="Substitute driver or route deviation" value={form.assignmentOverride} onChange={(value: any) => set("assignmentOverride", value)}/>{form.assignmentOverride && <div className="md:col-span-2"><Field label="Mandatory override reason"><Textarea value={form.overrideReason || ""} onChange={(event) => set("overrideReason", event.target.value)} placeholder="Explain the substitute driver or route deviation."/></Field></div>}<Field label="Incident type"><Input value={form.incidentType || ""} onChange={(event) => set("incidentType", event.target.value)} placeholder="Breakdown, accident, delay, route deviation…"/></Field><Choice label="Severity" value={form.severity} onChange={(value: any) => set("severity", value)} items={[["low", "Low"], ["medium", "Medium"], ["high", "High"], ["critical", "Critical"]]}/><Field label="Incident Date/Time"><Input type="datetime-local" value={form.occurredAt} onChange={(event) => set("occurredAt", event.target.value)}/></Field><Field label="Logged Date/Time"><Input value="Automatically recorded when saved" disabled/></Field><div className="md:col-span-2"><Field label="Description"><Textarea value={form.description || ""} onChange={(event) => set("description", event.target.value)}/></Field></div><div className="md:col-span-2"><Field label="How it was handled"><Textarea value={form.resolution || ""} onChange={(event) => set("resolution", event.target.value)}/></Field></div></>;
  }
  if (type === "claim") return <><div className="md:col-span-2"><BooleanField label="All vehicles serving learners at this school" value={Boolean(form.allVehicles)} onChange={(value:any)=>{set("allVehicles",value); if(value)set("vehicleId",null);}}/></div>{!form.allVehicles&&<EntitySelect label="Vehicle" items={data.vehicles.filter((vehicle: any) => vehicle.isActive)} value={form.vehicleId} onChange={(value: any) => set("vehicleId", idValue(value))} itemText={(vehicle: any) => vehicle.registrationNumber}/>}<Field label="Service year"><Input type="number" value={form.serviceYear} onChange={(event) => set("serviceYear", event.target.value)}/></Field><MonthSelector label="Service Month" value={form.serviceMonth} onChange={(value: any) => set("serviceMonth", value)}/><Field label="Notes"><Textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></Field><div className="md:col-span-2"><Alert><Receipt className="h-4 w-4"/><AlertTitle>Claim protection</AlertTitle><AlertDescription>All Vehicles is scoped to this school's learners only. Vehicles serving several schools receive separate school claims; HQ alone consolidates them. Only eligible reconciled/unclaimed allocations are included.</AlertDescription></Alert></div></>;
  if (type === "payPayout") return <><div className="md:col-span-2 rounded-md border p-3"><b>{record.payoutNumber}</b> · Net USD {money(record.netAmount)} · Already paid USD {money(record.amountPaid)}</div><Field label="Payment date"><Input type="date" value={form.paymentDate} onChange={(event) => set("paymentDate", event.target.value)}/></Field><Choice label="Payment method" value={form.paymentMethod} onChange={(value: any) => set("paymentMethod", value)} items={[["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["mobile_money", "Mobile money"], ["other", "Other"]]}/><NumberField label="Amount now" value={form.amount} onChange={(value: any) => set("amount", value)} min={0.01} step="0.01"/><Field label="Payment reference"><Input value={form.paymentReference || ""} onChange={(event) => set("paymentReference", event.target.value)}/></Field></>;
  return <div className="md:col-span-2 text-sm text-muted-foreground">No fields are configured for this action.</div>;
}

function buildInitialForm(type: string, record: any, data: Bootstrap) {
  const year = new Date().getFullYear(); const base: any = { ...record };
  const defaults: Record<string, any> = {
    route: { direction: "both", defaultFee: 0, billingFrequency: "monthly", status: "active", isActive: true },
    vehicle: { ownershipType: "school", ownerId: null, driverId: null, alternativeDriverIds: [], destinationIds: [], capacity: 1, status: "active", isActive: true, effectiveDate: today() },
    changePrimaryDriver: { driverId: null, effectiveDate: today(), reason: "", notes: "" },
    activateAlternativeDriver: { driverId: null, effectiveAt: new Date().toISOString().slice(0,16), expectedReturnAt: "", reason: "", notes: "" },
    returnPrimaryDriver: { effectiveAt: new Date().toISOString().slice(0,16), reason: "Primary Driver returned to service", notes: "" },
    changeVehicleOwner: { ownershipType: record?.ownershipType || "school", ownerId: record?.ownerId || null, primaryDriverId: record?.driverId || null, alternativeDriverIds: record?.alternativeDriverIds || [], effectiveDate: today(), reason: "" },
    replaceVehicle: { replacementVehicleId: null, replacementType: "permanent", effectiveAt: new Date().toISOString().slice(0,16), expectedReturnAt: "", schoolIds: data.school?.id ? [Number(data.school.id)] : [], carryDestinations: true, carryOwner: false, carryPrimaryDriver: false, carryAlternativeDrivers: false, reason: "", notes: "" },
    returnOriginalVehicle: { effectiveAt: new Date().toISOString().slice(0,16), reason: "Original vehicle returned to service" },
    driver: { engagementType: "internal", ownerId: null, isActive: true, effectiveFrom: today(), effectiveDate: today() },
    owner: { ownerType: "individual", isStaffOwner: false, staffId: null, isActive: true, effectiveFrom: today() },
    assignment: { startDate: today(), serviceType: "both", serviceState: "pending_start", planningStatus: "pending_path_assignment", financialStatus: "pending_first_payment", inboundPathTraversal: "forward", outboundPathTraversal: "forward", baseMonthlyFee: 0, agreedFee: 0 },
    transfer: { ...record, effectiveDate: today(), transferType: "permanent", reason: "" },
    state: { state: record?.serviceState || "active", effectiveDate: today(), reason: "", refundMethod: "credit" },
    charge: { academicYear: year, term: "monthly", month: currentMonth(), dueDate: today() },
    payment: { academicYear: year, term: "monthly", month: 0, paymentDate: today(), paymentMethod: "cash", allocationMode: "oldest_first", amount: "" },
    reversePayment: { reason: "" },
    refund: { refundType: "overpayment", method: "credit", effectiveDate: today(), amount: "", reason: "" },
    payRefund: { externalReference: "" },
    cashup: { cashupDate: today(), paymentIds: [], refundIds: [], advanceRepaymentIds: [] },
    cashupEdit: { cashupDate: record?.cashupDate || today(), paymentIds: record?.paymentIds || [], refundIds: record?.refundIds || [], advanceRepaymentIds: record?.advanceRepaymentIds || [], depositReference: record?.depositReference || "", notes: record?.notes || "" },
    subscription: { vehicleId: null, ruleType: "fixed", value: "", effectiveFrom: today() },
    penalty: { incidentDate: today(), amount: "", effectiveYear: year, effectiveMonth: currentMonth(), reason: "" },
    advance: { amount: "", requestDate: today(), recoveryMethod: "fixed_instalment", recoveryValue: "", recoveryStartYear: year, recoveryStartMonth: currentMonth(), minimumOwnerTakeHome: 0 },
    incident: { severity: "medium", occurredAt: new Date().toISOString().slice(0, 16), pathTraversal: "forward", assignmentOverride: false, affectedStudentIds: [] },
    claim: { serviceYear: year, serviceMonth: currentMonth(), allVehicles: false, vehicleId: null },
    payPayout: { paymentDate: today(), paymentMethod: "bank_transfer", amount: Math.max(0, Number(record?.netAmount || 0) - Number(record?.amountPaid || 0)) },
    disburseAdvance: { disbursementDate: today(), disbursementReference: "" },
    advanceRepayment: { amount: Number(record?.outstandingAmount||0),paymentDate:today(),paymentMethod:"bank_transfer",paymentReference:"",notes:"" },
    verifyAdvanceRepayment: { verificationNotes:"" },
    rejectAdvanceRepayment: { reason:"" },
  };
  return { ...(defaults[type] || {}), ...base };
}

function dialogConfig(type: string, record?: any) {
  const editing = Boolean(record && ["route", "vehicle", "driver", "owner"].includes(type));
  const configs: Record<string, any> = {
    route: { title: `${editing ? "Edit" : "Add"} destination`, description: "Destinations define where the service goes. Vehicle routes are derived automatically from learner stops and mandatory school checkpoints.", url: "/api/transport/routes", action: editing ? "Save changes" : "Add route" },
    vehicle: { title: `${editing ? "Edit" : "Add"} Transport vehicle`, description: "This creates or edits an independent Transport service vehicle; it does not create an Asset/Fleet vehicle. FCGS assets should be made available from Fleet Management. Owner and driver changes are recorded with effective dates.", url: "/api/transport/vehicles", action: editing ? "Save changes" : "Add Transport vehicle" },
    changePrimaryDriver: { title: `Change Primary Driver · ${record?.registrationNumber || "Vehicle"}`, description: "Permanent Primary Driver changes are effective-dated and preserve the previous driver history.", url: `/api/transport/vehicles/${record?.id}/change-primary-driver`, action: "Change Primary Driver" },
    activateAlternativeDriver: { title: `Activate Alternative Driver · ${record?.registrationNumber || "Vehicle"}`, description: "Temporary cover does not replace the permanent Primary Driver relationship.", url: `/api/transport/vehicles/${record?.id}/activate-alternative-driver`, action: "Activate Cover" },
    returnPrimaryDriver: { title: `Return Primary Driver · ${record?.registrationNumber || "Vehicle"}`, description: "Close the temporary operating-driver period and return the permanent Primary Driver to service.", url: `/api/transport/vehicles/${record?.id}/return-primary-driver`, action: "Return Primary Driver" },
    changeVehicleOwner: { title: `Change Owner · ${record?.registrationNumber || "Vehicle"}`, description: "Owner changes are effective-dated and all Primary/Alternative Drivers are revalidated against the new employer.", url: `/api/transport/vehicles/${record?.id}/change-owner`, action: "Change Owner" },
    replaceVehicle: { title: `Replace Vehicle · ${record?.registrationNumber || "Vehicle"}`, description: "Choose a permanent or temporary physical replacement. Existing historical records remain linked to the vehicle that actually served at the time.", url: `/api/transport/vehicles/${record?.id}/replace`, action: "Confirm Replacement" },
    returnOriginalVehicle: { title: "Return Original Vehicle", description: "End the temporary replacement period and move current school assignments back to the original vehicle.", url: `/api/transport/vehicle-replacements/${record?.id}/return-original`, action: "Return Original Vehicle" },
    driver: { title: `${editing ? "Edit" : "Add"} driver`, description: "Maintain compliance and effective engagement dates.", url: "/api/transport/drivers", action: editing ? "Save changes" : "Add driver" },
    owner: { title: `${editing ? "Edit" : "Add"} vehicle owner`, description: "Organisation-wide vehicle-owner record. Staff owners can be selected from any school without changing isolation elsewhere.", url: "/api/transport/owners", action: editing ? "Save changes" : "Add owner" },
    transfer: { title: "Transfer learner", description: "Policy B recalculates old and new service portions where fees differ.", url: `/api/transport/assignments/${record?.id}/transfer`, action: "Confirm transfer" },
    state: { title: "Change learner service state", description: "Pause, suspension and termination are date-effective and audited.", url: `/api/transport/assignments/${record?.id}/state`, action: "Apply state change" },
    charge: { title: "Generate monthly transport charges", description: "Existing monthly charges are skipped; eligible payments received earlier are allocated automatically.", url: "/api/transport/charges/generate", action: "Generate charges" },
    payment: { title: "Record transport payment", description: "Payment date and service effective date are independent. Two immutable receipt copies print after saving.", url: "/api/transport/payments", action: "Record and print receipt" },
    reversePayment: { title: "Reverse payment and receipt", description: "A reversal preserves the original receipt and audit history.", url: `/api/transport/payments/${record?.id}/reverse`, action: "Reverse receipt" },
    refund: { title: "Request learner credit or refund", description: "Pause defaults to credit; termination may use an approved external method.", url: "/api/transport/refunds", action: "Submit request" },
    payRefund: { title: "Record refund payout", description: "Record the external refund reference after approval.", url: `/api/transport/refunds/${record?.id}/pay`, action: "Record payout" },
    cashup: { title: "Prepare daily cash-up", description: "Select the receipts/refunds being handed over and declare the amounts without seeing the system expected total.", url: "/api/transport/cashups", action: "Create cash-up" },
    cashupEdit: { title: `Edit Draft Cash-Up · ${record?.cashupNumber || ""}`, description: "Drafts may be corrected until Submit & Sign. Receipt/refund eligibility is revalidated when you save.", url: `/api/transport/cashups/${record?.id}`, action: "Save Draft" },
    subscription: { title: "Add subscription rule", description: "Create an effective-dated school default or vehicle-specific override.", url: "/api/transport/subscriptions", action: "Add rule" },
    penalty: { title: "Add vehicle penalty", description: "The category is configurable text and becomes a controlled payout deduction.", url: "/api/transport/penalties", action: "Add penalty" },
    advance: { title: "Request vehicle advance", description: "The request must be approved and separately disbursed before recovery begins.", url: "/api/transport/advances", action: "Submit request" },
    disburseAdvance: { title: "Disburse vehicle advance", description: "Record the date and external reference for the approved advance.", url: `/api/transport/advances/${record?.id}/disburse`, action: "Record disbursement" },
    advanceRepayment: {title:"Record direct advance repayment",description:"Principal recovery is not FCGS income. Accounts verification is required.",url:`/api/transport/advances/${record?.id}/repayments`,action:"Record repayment"},
    verifyAdvanceRepayment: {title:"Verify direct advance repayment",description:"Independent verification against the bank or the HQ-confirmed cash-up is required.",url:`/api/transport/advances/repayments/${record?.id}/verify`,action:"Verify repayment"},
    rejectAdvanceRepayment: {title:"Reject unverified advance repayment",description:"Provide a clear audit reason.",url:`/api/transport/advances/repayments/${record?.id}/reject`,action:"Reject repayment"},
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

function Stat({ label, value }: { label: string; value: any }) { return <div className="min-w-0 rounded-lg border bg-card px-3 py-2"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-0.5 truncate font-semibold">{value ?? "—"}</div></div>; }
function InfoBox({ label, value }: { label: string; value: any }) { return <div className="rounded-md border bg-card p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-semibold">{value ?? "—"}</div></div>; }
function StatusBadge({ value }: { value: any }) { const status = String(value || "unknown"); return <Badge variant={statusVariant(status)} className="whitespace-nowrap">{titleCase(status)}</Badge>; }
function Field({ label, children }: { label: string; children: any }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function NumberField({ label, value, onChange, min, max, step = "1" }: any) { return <Field label={label}><Input type="number" value={value ?? ""} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)}/></Field>; }
function Choice({ label, value, onChange, items }: any) { return <Field label={label}><Select value={String(value ?? "")} onValueChange={onChange}><SelectTrigger><SelectValue placeholder={`Select ${label.toLowerCase()}`}/></SelectTrigger><SelectContent>{items.map(([itemValue, itemLabel]: any) => <SelectItem key={itemValue} value={String(itemValue)}>{itemLabel}</SelectItem>)}</SelectContent></Select></Field>; }
function EntitySelect({ label, items, value, onChange, itemText, optional, optionalLabel = "None" }: any) { const options = [...(optional ? [{ value: "none", label: optionalLabel }] : []), ...items.map((item: any) => ({ value: String(item.id), label: itemText(item), searchText: itemText(item) }))]; return <Field label={label}><SearchableSelect value={value == null ? (optional ? "none" : "") : String(value)} onValueChange={onChange} options={options} placeholder={`Select ${label.toLowerCase()}`} searchPlaceholder={`Search ${label.toLowerCase()}…`} /></Field>; }
function MonthSelector({ label = "Service Month", value, onChange, includeUnspecified = false }: any) { const options = [...(includeUnspecified ? [{ value: "0", label: "Arrears / Future Credit" }] : []), ...MONTHS.map((month, index) => ({ value: String(index + 1), label: month, searchText: month }))]; return <Field label={label}><SearchableSelect value={String(value ?? (includeUnspecified ? 0 : currentMonth()))} onValueChange={(next) => onChange(Number(next))} options={options} placeholder={`Select ${label.toLowerCase()}`} searchPlaceholder="Search month…"/></Field>; }
function BooleanField({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <div className="flex min-h-10 items-center gap-3 rounded-md border px-3 py-2"><Checkbox checked={Boolean(value)} onCheckedChange={(checked) => onChange(Boolean(checked))}/><Label>{label}</Label></div>; }
function SettingsSection({ title, children, gridClassName = "md:grid-cols-2 xl:grid-cols-4" }: { title: string; children: any; gridClassName?: string }) { return <details open={title==="Responsibility and location planning"} className="rounded-xl border bg-card"><summary className="cursor-pointer px-4 py-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:px-5">{title}</summary><div className={`grid gap-4 border-t p-4 md:p-5 ${gridClassName}`}>{children}</div></details>; }

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
