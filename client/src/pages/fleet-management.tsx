import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryClient, schoolFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import ServiceLocationEditor, { emptyServiceLocation, type ServiceLocationDraft } from "@/components/transport/service-location-editor";
import { AlertTriangle, BatteryCharging, BusFront, CarFront, CheckCircle2, ClipboardCheck, Fuel, Gauge, Link2, Plus, RefreshCw, Route, ShieldCheck, UserRoundCheck, Wrench } from "lucide-react";

type Bootstrap = Record<string, any> & {
  scope: any; currentStaff: any; schools: any[]; staff: any[]; students: any[]; routes: any[]; servicePoints: any[]; transportSettings: any; vehicles: any[]; availableAssets: any[]; transportVehicles: any[]; transportDrivers: any[]; drivers: any[];
  requests: any[]; trips: any[]; allocations: any[]; occupants: any[]; fuel: any[]; inspections: any[]; maintenance: any[]; compliance: any[]; incidents: any[]; components: any[]; disposals: any[]; costs: any;
};
type DialogState = { type: string; record?: any } | null;
const today = () => new Date().toISOString().slice(0, 10);
const dateTimeLocal = (d = new Date(Date.now() + 60 * 60 * 1000)) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const money = (value: any) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const title = (value: any) => String(value ?? "—").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
const value = (form: FormData, key: string) => String(form.get(key) || "").trim();
const num = (form: FormData, key: string) => value(form, key) ? Number(value(form, key)) : null;
const checked = (form: FormData, key: string) => form.get(key) === "on";
const normalizedRegistration = (registration: any) => String(registration || "").toUpperCase().replace(/\s+/g, "");
const openTransportVehicleRegister = () => {
  localStorage.setItem("transportTopTab", "operations");
  localStorage.setItem("transportOperationsTab", "vehicles");
  window.location.href = "/transport";
};
const locationFromRecord = (record: any, prefix: "pickup" | "dropoff"): ServiceLocationDraft => ({
  name: record?.[`${prefix}Name`] || "",
  address: record?.[`${prefix}Address`] || "",
  landmark: record?.[`${prefix}Landmark`] || "",
  latitude: record?.[`${prefix}Latitude`] == null || record?.[`${prefix}Latitude`] === "" ? null : Number(record?.[`${prefix}Latitude`]),
  longitude: record?.[`${prefix}Longitude`] == null || record?.[`${prefix}Longitude`] === "" ? null : Number(record?.[`${prefix}Longitude`]),
  privacyClass: record?.[`${prefix}PrivacyClass`] || "private_household",
  instructions: record?.[`${prefix}Instructions`] || "",
});

export default function FleetManagementPage() {
  const { user, currentSchoolId, hasPermission, hasAnyPermission } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [search, setSearch] = useState("");
  const query = useQuery<Bootstrap>({
    queryKey: ["/api/fleet/bootstrap", currentSchoolId || "hq"],
    queryFn: async () => {
      const response = await schoolFetch("/api/fleet/bootstrap");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Failed to load Fleet Management");
      return payload;
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/fleet/bootstrap"] });
  const mutation = useMutation({
    mutationFn: async ({ method = "POST", url, body }: any) => {
      const response = await schoolFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Fleet action failed");
      return payload;
    },
    onSuccess: () => { setDialog(null); refresh(); toast({ title: "Fleet updated", description: "The Fleet record has been saved." }); },
    onError: (error: Error) => toast({ title: "Fleet action failed", description: error.message, variant: "destructive" }),
  });
  const data = query.data;
  const q = search.toLowerCase();
  const staffName = (id: number | null | undefined) => { const p = data?.staff.find((s) => s.id === id); return p ? `${p.firstName} ${p.lastName}` : "—"; };
  const schoolName = (id: number | null | undefined) => data?.schools.find((s) => s.id === id)?.name || (id ? `School #${id}` : "HQ");
  const vehicle = (id: number | null | undefined) => data?.vehicles.find((v) => v.id === id);
  const vehicleName = (id: number | null | undefined) => { const v = vehicle(id); return v ? `${v.details?.registrationNumber || v.asset?.assetNumber || `Vehicle ${v.id}`} · ${v.details?.make || ""} ${v.details?.model || v.asset?.name || ""}`.trim() : "—"; };
  const myTrips = data?.currentStaff ? data.trips.filter((trip) => trip.driverStaffId === data.currentStaff.id && ["allocated", "ready", "in_progress"].includes(trip.status)) : [];
  const pendingRequests = data?.requests.filter((r) => ["submitted", "pending_approval"].includes(r.status)) || [];
  const activeVehicles = data?.vehicles.filter((v) => !["disposed"].includes(v.status)) || [];
  const attentionVehicles = activeVehicles.filter((v) => ["inspection", "service_due", "maintenance", "broken_down", "accident_damaged", "suspended"].includes(v.status));
  const expiring = (data?.compliance || []).filter((doc) => new Date(`${doc.expiryDate}T23:59:59`).getTime() <= Date.now() + 30 * 86400000);
  const totalCost = data ? Number(data.costs.fuel) + Number(data.costs.maintenance) + Number(data.costs.incidents) + Number(data.costs.components) : 0;
  const vehicleReportRows = (data?.vehicles || []).map((v) => {
    const trips = (data?.trips || []).filter((t) => t.vehicleId === v.id && t.status === "completed");
    const km = trips.reduce((sum, t) => sum + Number(t.distanceKm || 0), 0);
    const fuelCost = (data?.fuel || []).filter((x) => x.vehicleId === v.id).reduce((sum, x) => sum + Number(x.totalCost || 0), 0);
    const maintenanceCost = (data?.maintenance || []).filter((x) => x.vehicleId === v.id).reduce((sum, x) => sum + Number(x.actualCost || 0), 0);
    const incidentCost = (data?.incidents || []).filter((x) => x.vehicleId === v.id).reduce((sum, x) => sum + Math.max(0, Number(x.estimatedDamage || 0) - Number(x.amountRecovered || 0)), 0);
    const componentCost = (data?.components || []).filter((x) => x.vehicleId === v.id).reduce((sum, x) => sum + Number(x.purchaseCost || 0), 0);
    const operatingCost = fuelCost + maintenanceCost + incidentCost + componentCost;
    const age = v.details?.manufactureYear ? new Date().getFullYear() - Number(v.details.manufactureYear) : null;
    const currentValue = Number(v.asset?.currentValue || 0);
    const replacementReview = (age != null && age >= 10) || v.currentOdometer >= 250000 || (currentValue > 0 && maintenanceCost + incidentCost >= currentValue * 0.5);
    return { ...v, tripCount: trips.length, km, fuelCost, maintenanceCost, incidentCost, componentCost, operatingCost, costPerKm: km > 0 ? operatingCost / km : null, age, replacementReview };
  });
  const tabs = useMemo(() => [
    ["overview", "Overview", hasPermission("fleet.dashboard.view") || hasPermission("fleet.view")],
    ["my-tasks", "My Fleet Tasks", !!data?.currentStaff],
    ["vehicles", "Vehicles", hasPermission("fleet.view")],
    ["occupants", "Vehicle Occupants", hasPermission("fleet.view")],
    ["requests", "Requests", hasAnyPermission("fleet.requests.create", "fleet.requests.manage")],
    ["trips", "Trips", hasAnyPermission("fleet.trips.manage", "fleet.trips.drive")],
    ["drivers", "Drivers", hasPermission("fleet.drivers.manage")],
    ["inspections", "Inspections", hasAnyPermission("fleet.inspections.perform", "fleet.inspections.manage")],
    ["maintenance", "Maintenance", hasAnyPermission("fleet.maintenance.request", "fleet.maintenance.manage")],
    ["fuel", "Fuel", hasAnyPermission("fleet.fuel.record", "fleet.fuel.manage")],
    ["compliance", "Compliance", hasAnyPermission("fleet.compliance.view", "fleet.compliance.manage")],
    ["incidents", "Incidents", hasAnyPermission("fleet.incidents.create", "fleet.incidents.manage")],
    ["components", "Tyres & Batteries", hasPermission("fleet.components.manage")],
    ["reports", "Reports", hasAnyPermission("fleet.reports.view", "fleet.costs.view")],
  ].filter(([, , visible]) => visible), [data?.currentStaff, hasAnyPermission, hasPermission]);

  if (query.isLoading) return <div className="flex min-h-[50vh] items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin" /></div>;
  if (query.error || !data) return <Card className="m-4"><CardHeader><CardTitle>Unable to load Fleet Management</CardTitle><CardDescription>{(query.error as Error)?.message}</CardDescription></CardHeader><CardContent><Button onClick={() => query.refetch()}>Retry</Button></CardContent></Card>;

  return <div className="space-y-4 p-3 md:p-6">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div><h1 className="text-2xl font-bold">Fleet Management</h1><p className="text-sm text-muted-foreground">Organisation vehicles, staff drivers, allocations, trips, safety, maintenance, compliance and operating records.</p></div>
      <div className="flex flex-wrap gap-2">
        {hasPermission("fleet.requests.create") && <Button onClick={() => setDialog({ type: "request" })}><Plus className="mr-2 h-4 w-4" />Request Vehicle</Button>}
        <Input className="w-full sm:w-72" placeholder="Search Fleet..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
    </div>

    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <div className="overflow-x-auto pb-1"><TabsList className="inline-flex h-auto min-w-max">{tabs.map(([key, label]) => <TabsTrigger key={String(key)} value={String(key)}>{label}</TabsTrigger>)}</TabsList></div>

      <TabsContent value="overview" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Fleet Vehicles" value={data.vehicles.length} icon={CarFront} />
          <Metric label="Available" value={data.vehicles.filter((v) => v.status === "available").length} icon={CheckCircle2} />
          <Metric label="Needs Attention" value={attentionVehicles.length} icon={AlertTriangle} />
          <Metric label="Pending Requests" value={pendingRequests.length} icon={Route} />
          <Metric label="Active Drivers" value={data.drivers.filter((d) => d.status === "active").length} icon={UserRoundCheck} />
          <Metric label="Open Maintenance" value={data.maintenance.filter((j) => !["completed", "cancelled"].includes(j.status)).length} icon={Wrench} />
          <Metric label="Compliance ≤30d" value={expiring.length} icon={ShieldCheck} />
          <Metric label="Recorded Operating Cost" value={`$${money(totalCost)}`} icon={Fuel} />
        </div>
        {data.availableAssets.length > 0 && hasPermission("fleet.vehicles.manage") && <Card><CardHeader><CardTitle>Vehicle assets ready for Fleet</CardTitle><CardDescription>These are already registered as vehicle assets. Activate them here instead of creating duplicate vehicle records.</CardDescription></CardHeader><CardContent><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{data.availableAssets.map((row) => <div key={row.asset.id} className="flex items-center justify-between rounded-lg border p-3"><div><p className="font-medium">{row.details?.registrationNumber || row.asset.assetNumber}</p><p className="text-xs text-muted-foreground">{row.details?.make} {row.details?.model} · {row.asset.name}</p></div><Button size="sm" onClick={() => setDialog({ type: "activateVehicle", record: row })}>Activate</Button></div>)}</div></CardContent></Card>}
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title="Operational attention"><SimpleTable heads={["Vehicle", "Status", "Odometer", "Custodian"]}>{attentionVehicles.slice(0, 10).map((v) => <TableRow key={v.id}><TableCell>{vehicleName(v.id)}</TableCell><TableCell><Status value={v.status} /></TableCell><TableCell>{v.currentOdometer.toLocaleString()} km</TableCell><TableCell>{staffName(v.custodianStaffId)}</TableCell></TableRow>)}</SimpleTable></Section>
          <Section title="Upcoming / expired compliance"><SimpleTable heads={["Vehicle", "Document", "Expiry", "Status"]}>{expiring.slice(0, 10).map((d) => <TableRow key={d.id}><TableCell>{vehicleName(d.vehicleId)}</TableCell><TableCell>{title(d.documentType)}</TableCell><TableCell>{d.expiryDate}</TableCell><TableCell><Status value={new Date(`${d.expiryDate}T23:59:59`) < new Date() ? "expired" : "expiring_soon"} /></TableCell></TableRow>)}</SimpleTable></Section>
        </div>
      </TabsContent>

      <TabsContent value="my-tasks" className="space-y-4">
        <Card><CardHeader><CardTitle>My Fleet Tasks</CardTitle><CardDescription>Driver-focused work area for your assigned journeys. Administrative permissions remain available in the other tabs.</CardDescription></CardHeader><CardContent className="space-y-3">
          {!myTrips.length && <p className="text-sm text-muted-foreground">You have no active assigned trips.</p>}
          {myTrips.map((trip) => <div key={trip.id} className="rounded-xl border p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2"><p className="font-semibold">{trip.purpose}</p><Status value={trip.status} /></div><p className="text-sm text-muted-foreground">{vehicleName(trip.vehicleId)} → {trip.destination}</p><p className="text-xs text-muted-foreground">Planned: {trip.plannedDepartureAt ? new Date(trip.plannedDepartureAt).toLocaleString() : "—"}</p></div><div className="flex flex-wrap gap-2">{["allocated", "ready"].includes(trip.status) && <Button onClick={() => setDialog({ type: "startTrip", record: trip })}>Start Trip</Button>}{trip.status === "in_progress" && <><Button variant="outline" onClick={() => setDialog({ type: "fuel", record: trip })}>Record Fuel</Button><Button variant="outline" onClick={() => setDialog({ type: "incident", record: trip })}>Report Problem</Button><Button onClick={() => setDialog({ type: "completeTrip", record: trip })}>Complete Trip</Button></>}</div></div></div>)}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="vehicles" className="space-y-3">
        <div className="flex flex-wrap justify-end gap-2">
          {hasPermission("fleet.vehicles.manage") && data.availableAssets.length > 0 && (
            <Button variant="outline" onClick={() => setDialog({ type: "activateVehicle" })}>
              Activate Existing Vehicle Asset
            </Button>
          )}
          {hasPermission("fleet.vehicles.manage") && (
            <Button onClick={() => setDialog({ type: "registerVehicle" })}>
              <Plus className="mr-2 h-4 w-4" />Register Vehicle
            </Button>
          )}
        </div>
        <Section title="Fleet vehicle register">
          <SimpleTable heads={["Vehicle", "Base / Home", "Registered At", "Allocation", "Primary Driver", "Odometer", "Status", "Transport", "Actions"]}>
            {data.vehicles.filter((v) => !q || vehicleName(v.id).toLowerCase().includes(q) || schoolName(v.baseSchoolId).toLowerCase().includes(q)).map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">
                  <Button variant="ghost" className="h-auto p-0 text-left font-medium hover:bg-transparent hover:underline" onClick={() => setDialog({ type: "viewVehicle", record: v })}>{vehicleName(v.id)}</Button>
                </TableCell>
                <TableCell>{schoolName(v.baseSchoolId || v.schoolId)}</TableCell>
                <TableCell>{schoolName(v.asset?.schoolId)}</TableCell>
                <TableCell>{title(v.allocationType)}</TableCell>
                <TableCell>{staffName(v.primaryDriverStaffId)}</TableCell>
                <TableCell>{Number(v.currentOdometer || 0).toLocaleString()} km</TableCell>
                <TableCell><Status value={v.status} /></TableCell>
                <TableCell>{v.transportVehicleId ? <div className="space-y-1"><Badge variant="default">Available</Badge><div className="text-xs text-muted-foreground">{data.transportVehicles.find((tv) => tv.id === v.transportVehicleId)?.registrationNumber || `Transport #${v.transportVehicleId}`}</div></div> : <Badge variant="outline">Not available</Badge>}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => setDialog({ type: "viewVehicle", record: v })}>View</Button>
                    {hasPermission("fleet.vehicles.manage") && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "editVehicle", record: v })}>Edit</Button>}
                    {hasPermission("fleet.vehicles.manage") && (v.transportVehicleId ? <Button size="sm" variant="outline" onClick={openTransportVehicleRegister}>View in Transport</Button> : <Button size="sm" variant="outline" onClick={() => setDialog({ type: "makeAvailableTransport", record: v })}><Link2 className="mr-1 h-3.5 w-3.5"/>Make Available in Transport</Button>)}
                    {hasPermission("fleet.occupants.manage") && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "occupant", record: { vehicleId: v.id } })}>Add Occupant</Button>}
                    {hasPermission("fleet.allocations.manage") && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "allocation", record: v })}>Allocate</Button>}
                    {hasPermission("fleet.odometer.record") && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "odometer", record: v })}>Odometer</Button>}
                    {hasPermission("fleet.inspections.perform") && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "inspection", record: v })}>Inspect</Button>}
                    {hasPermission("fleet.maintenance.request") && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "maintenance", record: v })}>Maintenance</Button>}
                    {hasPermission("fleet.disposal.recommend") && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "disposal", record: v })}>Replacement / Disposal</Button>}
                    {hasPermission("fleet.vehicles.suspend") && v.status !== "suspended" && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "suspend", record: v })}>Suspend</Button>}
                    {hasPermission("fleet.vehicles.release") && ["suspended", "inspection", "maintenance"].includes(v.status) && <Button size="sm" onClick={() => mutation.mutate({ url: `/api/fleet/vehicles/${v.id}/release`, body: {} })}>Release</Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </SimpleTable>
        </Section>
      </TabsContent>

      <TabsContent value="occupants" className="space-y-3">
        <div className="flex justify-end">
          {hasPermission("fleet.occupants.manage") && <Button onClick={() => setDialog({ type: "occupant" })}><Plus className="mr-2 h-4 w-4" />Add Vehicle Occupant</Button>}
        </div>
        <Section title="Regular vehicle occupants">
          <SimpleTable heads={["Vehicle", "Occupant", "Type", "Route", "Service", "Pick-up", "Drop-off", "Start", "Status", "Actions"]}>
            {data.occupants.filter((o) => !q || `${o.occupantName || ""} ${o.routeName || ""} ${vehicleName(o.vehicleId)}`.toLowerCase().includes(q)).map((o) => (
              <TableRow key={o.id}>
                <TableCell>{vehicleName(o.vehicleId)}</TableCell>
                <TableCell className="font-medium">{o.occupantName || "—"}</TableCell>
                <TableCell>{title(o.occupantType)}</TableCell>
                <TableCell>{o.routeName || "—"}</TableCell>
                <TableCell>{title(o.serviceType)}</TableCell>
                <TableCell className="max-w-[220px] whitespace-normal">{o.pickupName}{o.pickupLandmark ? ` · ${o.pickupLandmark}` : ""}</TableCell>
                <TableCell className="max-w-[220px] whitespace-normal">{o.dropoffName || "—"}{o.dropoffLandmark ? ` · ${o.dropoffLandmark}` : ""}</TableCell>
                <TableCell>{o.startDate}</TableCell>
                <TableCell><Status value={o.isActive ? "active" : "ended"} /></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {hasPermission("fleet.occupants.manage") && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "editOccupant", record: o })}>Edit</Button>}
                    {hasPermission("fleet.occupants.manage") && o.isActive && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "endOccupant", record: o })}>End</Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </SimpleTable>
        </Section>
      </TabsContent>

      <TabsContent value="requests" className="space-y-3">
        <div className="flex justify-end">{hasPermission("fleet.requests.create") && <Button onClick={() => setDialog({ type: "request" })}><Plus className="mr-2 h-4 w-4" />New Request</Button>}</div>
        <Section title="Vehicle requests"><SimpleTable heads={["Requester", "Purpose", "Destination", "Departure", "Passengers", "Status", "Actions"]}>{data.requests.map((r) => <TableRow key={r.id}><TableCell>{staffName(r.requesterStaffId)}</TableCell><TableCell>{r.purpose}</TableCell><TableCell>{r.destination}</TableCell><TableCell>{new Date(r.departureAt).toLocaleString()}</TableCell><TableCell>{r.passengerCount}</TableCell><TableCell><Status value={r.status} /></TableCell><TableCell><div className="flex gap-1">{hasPermission("fleet.requests.manage") && ["submitted", "pending_approval"].includes(r.status) && <><Button size="sm" onClick={() => mutation.mutate({ method: "PUT", url: `/api/fleet/requests/${r.id}/status`, body: { status: "approved" } })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setDialog({ type: "rejectRequest", record: r })}>Reject</Button></>}{hasPermission("fleet.trips.manage") && r.status === "approved" && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "trip", record: r })}>Allocate Trip</Button>}</div></TableCell></TableRow>)}</SimpleTable></Section>
      </TabsContent>

      <TabsContent value="trips"><Section title="Trips"><SimpleTable heads={["Trip", "Vehicle", "Driver", "Destination", "Planned", "Distance", "Status", "Actions"]}>{data.trips.map((t) => <TableRow key={t.id}><TableCell>#{t.id} · {t.purpose}</TableCell><TableCell>{vehicleName(t.vehicleId)}</TableCell><TableCell>{staffName(t.driverStaffId)}</TableCell><TableCell>{t.destination}</TableCell><TableCell>{t.plannedDepartureAt ? new Date(t.plannedDepartureAt).toLocaleString() : "—"}</TableCell><TableCell>{t.distanceKm != null ? `${t.distanceKm} km` : "—"}</TableCell><TableCell><Status value={t.status} /></TableCell><TableCell>{["allocated", "ready"].includes(t.status) && hasAnyPermission("fleet.trips.drive", "fleet.trips.manage") ? <Button size="sm" onClick={() => setDialog({ type: "startTrip", record: t })}>Start</Button> : t.status === "in_progress" && hasAnyPermission("fleet.trips.drive", "fleet.trips.manage") ? <Button size="sm" onClick={() => setDialog({ type: "completeTrip", record: t })}>Complete</Button> : null}</TableCell></TableRow>)}</SimpleTable></Section></TabsContent>

      <TabsContent value="drivers" className="space-y-3"><div className="flex justify-end"><Button onClick={() => setDialog({ type: "driver" })}><Plus className="mr-2 h-4 w-4" />Authorise Staff Driver</Button></div><Section title="Authorised Fleet drivers"><SimpleTable heads={["Staff", "Licence", "Class", "Expiry", "Status"]}>{data.drivers.map((d) => <TableRow key={d.id}><TableCell>{d.staff ? `${d.staff.firstName} ${d.staff.lastName}` : staffName(d.staffId)}</TableCell><TableCell>{d.licenceNumber}</TableCell><TableCell>{d.licenceClass}</TableCell><TableCell>{d.licenceExpiry}</TableCell><TableCell><Status value={d.status} /></TableCell></TableRow>)}</SimpleTable></Section></TabsContent>

      <TabsContent value="inspections" className="space-y-3"><div className="flex justify-end">{hasPermission("fleet.inspections.perform") && <Button onClick={() => setDialog({ type: "inspection" })}><ClipboardCheck className="mr-2 h-4 w-4" />New Inspection</Button>}</div><Section title="Vehicle inspections"><SimpleTable heads={["When", "Vehicle", "Type", "Odometer", "Result", "Defects"]}>{data.inspections.map((i) => <TableRow key={i.id}><TableCell>{new Date(i.inspectedAt).toLocaleString()}</TableCell><TableCell>{vehicleName(i.vehicleId)}</TableCell><TableCell>{title(i.inspectionType)}</TableCell><TableCell>{i.odometerKm != null ? `${i.odometerKm.toLocaleString()} km` : "—"}</TableCell><TableCell><Status value={i.result} /></TableCell><TableCell className="max-w-xs whitespace-normal">{i.defects || "—"}</TableCell></TableRow>)}</SimpleTable></Section></TabsContent>

      <TabsContent value="maintenance" className="space-y-3"><Section title="Connected maintenance jobs"><SimpleTable heads={["Reference", "Vehicle", "Type", "Issue", "Priority", "Est. Cost", "Actual", "Status", "Actions"]}>{data.maintenance.map((j) => <TableRow key={j.id}><TableCell>{j.referenceNumber}</TableCell><TableCell>{vehicleName(j.vehicleId)}</TableCell><TableCell>{title(j.jobType)}</TableCell><TableCell className="max-w-xs whitespace-normal">{j.issueDescription}</TableCell><TableCell><Status value={j.priority} /></TableCell><TableCell>${money(j.estimatedCost)}</TableCell><TableCell>${money(j.actualCost)}</TableCell><TableCell><Status value={j.status} /></TableCell><TableCell>{hasPermission("fleet.maintenance.manage") && !["completed", "cancelled"].includes(j.status) && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "updateMaintenance", record: j })}>Update</Button>}</TableCell></TableRow>)}</SimpleTable></Section></TabsContent>

      <TabsContent value="fuel" className="space-y-3"><div className="flex justify-end">{hasPermission("fleet.fuel.record") && <Button onClick={() => setDialog({ type: "fuel" })}><Plus className="mr-2 h-4 w-4" />Record Fuel</Button>}</div><Section title="Fuel transactions"><SimpleTable heads={["Date", "Vehicle", "Odometer", "Litres", "Rate", "Total", "Method", "Reference"]}>{data.fuel.map((f) => <TableRow key={f.id}><TableCell>{f.transactionDate}</TableCell><TableCell>{vehicleName(f.vehicleId)}</TableCell><TableCell>{f.odometerKm.toLocaleString()} km</TableCell><TableCell>{Number(f.litres).toFixed(2)}</TableCell><TableCell>${money(f.pricePerLitre)}</TableCell><TableCell>${money(f.totalCost)}</TableCell><TableCell>{title(f.paymentMethod)}</TableCell><TableCell>{f.receiptReference || "—"}</TableCell></TableRow>)}</SimpleTable></Section></TabsContent>

      <TabsContent value="compliance" className="space-y-3"><div className="flex justify-end">{hasPermission("fleet.compliance.manage") && <Button onClick={() => setDialog({ type: "compliance" })}><Plus className="mr-2 h-4 w-4" />Add Compliance</Button>}</div><Section title="Fleet compliance"><SimpleTable heads={["Vehicle", "Document", "Number", "Expiry", "Verification", "State"]}>{data.compliance.map((d) => <TableRow key={d.id}><TableCell>{vehicleName(d.vehicleId)}</TableCell><TableCell>{title(d.documentType)}</TableCell><TableCell>{d.documentNumber || "—"}</TableCell><TableCell>{d.expiryDate}</TableCell><TableCell><Status value={d.verificationStatus} /></TableCell><TableCell><Status value={new Date(`${d.expiryDate}T23:59:59`) < new Date() ? "expired" : new Date(`${d.expiryDate}T23:59:59`).getTime() < Date.now() + 30 * 86400000 ? "expiring_soon" : "valid"} /></TableCell></TableRow>)}</SimpleTable></Section></TabsContent>

      <TabsContent value="incidents" className="space-y-3"><div className="flex justify-end">{hasPermission("fleet.incidents.create") && <Button onClick={() => setDialog({ type: "incident" })}><Plus className="mr-2 h-4 w-4" />Report Incident</Button>}</div><Section title="Incidents, breakdowns & claims"><SimpleTable heads={["When", "Vehicle", "Type", "Description", "Damage", "Recovered", "Claim", "Status"]}>{data.incidents.map((i) => <TableRow key={i.id}><TableCell>{new Date(i.occurredAt).toLocaleString()}</TableCell><TableCell>{vehicleName(i.vehicleId)}</TableCell><TableCell>{title(i.incidentType)}</TableCell><TableCell className="max-w-xs whitespace-normal">{i.description}</TableCell><TableCell>${money(i.estimatedDamage)}</TableCell><TableCell>${money(i.amountRecovered)}</TableCell><TableCell>{i.insuranceClaimNumber || "—"}</TableCell><TableCell><Status value={i.status} /></TableCell></TableRow>)}</SimpleTable></Section></TabsContent>

      <TabsContent value="components" className="space-y-3"><div className="flex justify-end"><Button onClick={() => setDialog({ type: "component" })}><Plus className="mr-2 h-4 w-4" />Add Tyre / Battery</Button></div><Section title="Tyres & batteries"><SimpleTable heads={["Type", "Serial", "Brand / Spec", "Vehicle", "Position", "Purchase", "Warranty", "Status"]}>{data.components.map((c) => <TableRow key={c.id}><TableCell>{c.componentType === "battery" ? <BatteryCharging className="h-4 w-4" /> : "Tyre"}</TableCell><TableCell>{c.serialNumber}</TableCell><TableCell>{c.brand || "—"} {c.specification || ""}</TableCell><TableCell>{vehicleName(c.vehicleId)}</TableCell><TableCell>{c.wheelPosition || "—"}</TableCell><TableCell>${money(c.purchaseCost)}</TableCell><TableCell>{c.warrantyExpiry || "—"}</TableCell><TableCell><Status value={c.status} /></TableCell></TableRow>)}</SimpleTable></Section></TabsContent>

      <TabsContent value="reports" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Fuel Cost" value={`$${money(data.costs.fuel)}`} icon={Fuel} /><Metric label="Maintenance Cost" value={`$${money(data.costs.maintenance)}`} icon={Wrench} /><Metric label="Incident Net Cost" value={`$${money(data.costs.incidents)}`} icon={AlertTriangle} /><Metric label="Tyres & Batteries" value={`$${money(data.costs.components)}`} icon={BatteryCharging} /></div>
        <Section title="Vehicle utilisation & cost per kilometre"><SimpleTable heads={["Vehicle", "Completed Trips", "Recorded Distance", "Operating Cost", "Cost / km", "Age", "Odometer", "Replacement Planning"]}>{vehicleReportRows.map((v) => <TableRow key={v.id}><TableCell>{vehicleName(v.id)}</TableCell><TableCell>{v.tripCount}</TableCell><TableCell>{v.km.toLocaleString()} km</TableCell><TableCell>${money(v.operatingCost)}</TableCell><TableCell>{v.costPerKm == null ? "—" : `$${money(v.costPerKm)}`}</TableCell><TableCell>{v.age == null ? "—" : `${v.age} yr`}</TableCell><TableCell>{v.currentOdometer.toLocaleString()} km</TableCell><TableCell><Status value={v.replacementReview ? "review" : "retain"} /></TableCell></TableRow>)}</SimpleTable><p className="mt-3 text-xs text-muted-foreground">Replacement planning is advisory only. Initial review triggers are age ≥10 years, odometer ≥250,000 km, or recorded maintenance/incident cost ≥50% of current asset value. Management makes the final decision and these thresholds can be adjusted after testing.</p></Section>
        <Section title="Replacement / disposal review queue"><SimpleTable heads={["Vehicle", "Reason", "Odometer", "Maintenance Snapshot", "Asset Value Snapshot", "Status", "Actions"]}>{data.disposals.map((d) => <TableRow key={d.id}><TableCell>{vehicleName(d.vehicleId)}</TableCell><TableCell className="max-w-xs whitespace-normal">{d.reason}</TableCell><TableCell>{d.odometerSnapshot?.toLocaleString?.() || d.odometerSnapshot || "—"} km</TableCell><TableCell>${money(d.maintenanceCostSnapshot)}</TableCell><TableCell>${money(d.currentAssetValueSnapshot)}</TableCell><TableCell><Status value={d.status} /></TableCell><TableCell>{hasPermission("fleet.disposal.manage") && !["declined","completed"].includes(d.status) && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "reviewDisposal", record: d })}>Review</Button>}</TableCell></TableRow>)}</SimpleTable></Section>
      </TabsContent>
    </Tabs>

    {dialog && <FleetDialog state={dialog} data={data} busy={mutation.isPending} close={() => setDialog(null)} submit={(method, url, body) => mutation.mutate({ method, url, body })} />}
  </div>;
}

function FleetDialog({ state, data, busy, close, submit }: { state: DialogState; data: Bootstrap; busy: boolean; close: () => void; submit: (method: string, url: string, body: any) => void }) {
  const { hasPermission } = useAuth();
  if (!state) return null;
  const t = state.type; const r = state.record;
  if (["registerVehicle", "editVehicle", "activateVehicle"].includes(t)) return <VehicleEditorDialog mode={t} record={r} data={data} busy={busy} close={close} submit={submit} />;
  if (["occupant", "editOccupant"].includes(t)) return <OccupantEditorDialog record={r} data={data} busy={busy} close={close} submit={submit} />;
  if (t === "makeAvailableTransport") return <MakeAvailableInTransportDialog vehicle={r} data={data} busy={busy} close={close} submit={submit} />;
  if (t === "viewVehicle") return <VehicleDetailsDialog vehicle={r} data={data} busy={busy} canManage={hasPermission("fleet.vehicles.manage")} close={close} submit={submit} />;
  const on = (handler: (form: FormData) => void) => (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); handler(new FormData(event.currentTarget)); };
  const driverOptions = data.drivers.filter((d) => d.status === "active");
  const baseChecklist = ["tyres", "lights", "brakes", "mirrors", "windscreen", "leaks"];
  const checklist = (form: FormData) => Object.fromEntries(baseChecklist.map((key) => [key, checked(form, key)]));
  let titleText = "Fleet Action"; let description = ""; let body: ReactNode = null;
  const shell = (handler: (form: FormData) => void, children: ReactNode, action = "Save") => <form onSubmit={on(handler)} className="space-y-4">{children}<DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : action}</Button></DialogFooter></form>;

  if (t === "driver") { titleText = "Authorise Staff Driver"; description = "Fleet drivers are always existing staff records; no duplicate person is created."; body = shell((f) => submit("POST", "/api/fleet/drivers", { staffId: Number(value(f,"staffId")), licenceNumber: value(f,"licenceNumber"), licenceClass: value(f,"licenceClass"), licenceExpiry: value(f,"licenceExpiry"), defensiveDrivingExpiry: value(f,"defensiveDrivingExpiry") || null, permittedVehicleClasses: value(f,"vehicleClasses").split(",").map((x) => x.trim()).filter(Boolean), status: "active", notes: value(f,"notes") || null }), <><Field label="Staff member"><StaffSelect name="staffId" staff={data.staff.filter((s) => !data.drivers.some((d) => d.staffId === s.id))} required /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Licence number"><Input name="licenceNumber" required /></Field><Field label="Licence class"><Input name="licenceClass" placeholder="e.g. Class 2" required /></Field><Field label="Licence expiry"><Input name="licenceExpiry" type="date" required /></Field><Field label="Defensive driving expiry"><Input name="defensiveDrivingExpiry" type="date" /></Field></div><Field label="Permitted vehicle classes (comma separated)"><Input name="vehicleClasses" placeholder="sedan, pickup, minibus" /></Field><Field label="Notes"><Textarea name="notes" /></Field></>); }
  else if (t === "request") { titleText = "Vehicle Request"; description = "Request the transport need; Fleet will allocate the appropriate vehicle and driver."; body = shell((f) => submit("POST", "/api/fleet/requests", { purpose: value(f,"purpose"), destination: value(f,"destination"), departureAt: value(f,"departureAt"), expectedReturnAt: value(f,"expectedReturnAt"), passengerCount: Number(value(f,"passengerCount")), vehicleRequirement: value(f,"vehicleRequirement"), driverRequired: checked(f,"driverRequired"), specialRequirements: value(f,"specialRequirements") || null, emergencyOverride: checked(f,"emergencyOverride"), emergencyReason: value(f,"emergencyReason") || null }), <><div className="grid gap-3 sm:grid-cols-2"><Field label="Purpose"><Input name="purpose" required /></Field><Field label="Destination"><Input name="destination" required /></Field><Field label="Departure"><Input name="departureAt" type="datetime-local" defaultValue={dateTimeLocal()} required /></Field><Field label="Expected return"><Input name="expectedReturnAt" type="datetime-local" defaultValue={dateTimeLocal(new Date(Date.now() + 3*3600000))} required /></Field><Field label="Passengers"><Input name="passengerCount" type="number" min="1" defaultValue="1" required /></Field><Field label="Vehicle requirement"><NativeSelect name="vehicleRequirement" defaultValue="any"><option value="any">Any suitable vehicle</option><option value="sedan">Sedan</option><option value="pickup">Pickup</option><option value="minibus">Minibus</option><option value="bus">Bus</option><option value="truck">Truck</option><option value="4x4">4x4</option><option value="maintenance_vehicle">Maintenance vehicle</option></NativeSelect></Field></div><Check name="driverRequired" label="Driver required" defaultChecked /><Field label="Special requirements"><Textarea name="specialRequirements" /></Field>{hasPermission("fleet.requests.manage") && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><Check name="emergencyOverride" label="Emergency override — approve immediately" /><Field label="Emergency reason (required when override is used)"><Textarea name="emergencyReason" /></Field></div>}</> , "Submit Request"); }
  else if (t === "rejectRequest") { titleText = "Reject Vehicle Request"; body = shell((f) => submit("PUT", `/api/fleet/requests/${r.id}/status`, { status: "rejected", reason: value(f,"reason") }), <Field label="Reason"><Textarea name="reason" required /></Field>, "Reject"); }
  else if (t === "trip") { titleText = "Allocate Trip"; description = "Vehicle and driver schedule conflicts are checked by the server."; body = shell((f) => submit("POST", "/api/fleet/trips", { requestId: r?.id || null, vehicleId: Number(value(f,"vehicleId")), driverStaffId: Number(value(f,"driverStaffId")), purpose: value(f,"purpose"), destination: value(f,"destination"), plannedDepartureAt: value(f,"plannedDepartureAt") || null, expectedReturnAt: value(f,"expectedReturnAt") || null, passengerCount: Number(value(f,"passengerCount") || 1), notes: value(f,"notes") || null }), <><VehicleSelect name="vehicleId" vehicles={data.vehicles.filter((v) => ["available", "allocated"].includes(v.status))} required /><Field label="Driver"><NativeSelect name="driverStaffId" required defaultValue=""><option value="" disabled>Select driver</option>{driverOptions.map((d) => { const s = data.staff.find((x) => x.id === d.staffId); return <option key={d.id} value={d.staffId}>{s?.firstName} {s?.lastName}</option>; })}</NativeSelect></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Purpose"><Input name="purpose" defaultValue={r?.purpose || ""} required /></Field><Field label="Destination"><Input name="destination" defaultValue={r?.destination || ""} required /></Field><Field label="Departure"><Input name="plannedDepartureAt" type="datetime-local" defaultValue={r?.departureAt ? String(r.departureAt).slice(0,16) : dateTimeLocal()} /></Field><Field label="Expected return"><Input name="expectedReturnAt" type="datetime-local" defaultValue={r?.expectedReturnAt ? String(r.expectedReturnAt).slice(0,16) : dateTimeLocal(new Date(Date.now()+3*3600000))} /></Field><Field label="Passengers"><Input name="passengerCount" type="number" min="1" defaultValue={r?.passengerCount || 1} /></Field></div><Field label="Notes"><Textarea name="notes" /></Field></>, "Allocate"); }
  else if (t === "startTrip") { titleText = "Start Trip"; description = "Complete the safety check and confirm the starting odometer."; const v = data.vehicles.find((x) => x.id === r.vehicleId); body = shell((f) => submit("POST", `/api/fleet/trips/${r.id}/start`, { odometerKm: Number(value(f,"odometerKm")), checklist: checklist(f), defects: value(f,"defects") || null }), <><Field label={`Starting odometer (current ${v?.currentOdometer || 0} km)`}><Input name="odometerKm" type="number" min={v?.currentOdometer || 0} defaultValue={v?.currentOdometer || 0} required /></Field><Checklist /><Field label="Notes / minor observations"><Textarea name="defects" /></Field></>, "Start Trip"); }
  else if (t === "completeTrip") { titleText = "Complete Trip"; const v = data.vehicles.find((x) => x.id === r.vehicleId); body = shell((f) => submit("POST", `/api/fleet/trips/${r.id}/complete`, { odometerKm: Number(value(f,"odometerKm")), checklist: checklist(f), defects: value(f,"defects") || null, notes: value(f,"notes") || null }), <><Field label="Ending odometer"><Input name="odometerKm" type="number" min={Math.max(v?.currentOdometer || 0, r.startOdometer || 0)} required /></Field><Checklist /><Field label="Defects found on return"><Textarea name="defects" placeholder="Leave blank if none" /></Field><Field label="Trip notes"><Textarea name="notes" /></Field></>, "Complete Trip"); }
  else if (t === "allocation") { titleText = "Standing / Permanent Allocation"; body = shell((f) => submit("POST", "/api/fleet/allocations", { vehicleId: r.id, allocationType: value(f,"allocationType"), allocatedToType: value(f,"allocatedToType"), allocatedToStaffId: num(f,"allocatedToStaffId"), allocatedToSchoolId: num(f,"allocatedToSchoolId"), allocatedToName: value(f,"allocatedToName") || null, primaryDriverStaffId: num(f,"primaryDriverStaffId"), startsAt: value(f,"startsAt"), endsAt: value(f,"endsAt") || null, reason: value(f,"reason") || null }), <><div className="grid gap-3 sm:grid-cols-2"><Field label="Allocation type"><NativeSelect name="allocationType"><option value="staff">Permanent Staff Allocation</option><option value="department">Department Allocation</option><option value="school">School Allocation</option><option value="temporary">Temporary Allocation</option><option value="student_transport">Student Transport Allocation</option></NativeSelect></Field><Field label="Allocated to type"><NativeSelect name="allocatedToType"><option value="staff">Staff</option><option value="department">Department</option><option value="school">School</option><option value="student_transport">Student Transport</option></NativeSelect></Field><Field label="Staff / custodian"><StaffSelect name="allocatedToStaffId" staff={data.staff} /></Field><Field label="School"><NativeSelect name="allocatedToSchoolId" defaultValue={r.schoolId || ""}><option value="">Not changed</option>{data.schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field><Field label="Department / allocation name"><Input name="allocatedToName" /></Field><Field label="Primary driver"><NativeSelect name="primaryDriverStaffId" defaultValue=""><option value="">None</option>{driverOptions.map((d) => { const s=data.staff.find((x)=>x.id===d.staffId); return <option key={d.id} value={d.staffId}>{s?.firstName} {s?.lastName}</option>; })}</NativeSelect></Field><Field label="Starts"><Input name="startsAt" type="datetime-local" defaultValue={dateTimeLocal(new Date())} required /></Field><Field label="Ends (optional)"><Input name="endsAt" type="datetime-local" /></Field></div><Field label="Reason"><Textarea name="reason" /></Field></>, "Allocate Vehicle"); }
  else if (t === "odometer") { titleText = "Record Odometer"; body = shell((f) => submit("POST", "/api/fleet/odometer", { vehicleId: r?.id || Number(value(f,"vehicleId")), readingKm: Number(value(f,"readingKm")), readingType: value(f,"readingType"), notes: value(f,"notes") || null }), <>{!r && <VehicleSelect name="vehicleId" vehicles={data.vehicles} required />}<div className="grid gap-3 sm:grid-cols-2"><Field label="Reading (km)"><Input name="readingKm" type="number" min={r?.currentOdometer || 0} defaultValue={r?.currentOdometer || ""} required /></Field><Field label="Reading type"><NativeSelect name="readingType"><option value="manual">Manual Verification</option><option value="service">Service</option><option value="inspection">Inspection</option></NativeSelect></Field></div><Field label="Notes"><Textarea name="notes" /></Field></>); }
  else if (t === "inspection") { titleText = "Vehicle Inspection"; const selected = r; body = shell((f) => { const failed = checked(f,"failed"); const attention = checked(f,"attention"); submit("POST", "/api/fleet/inspections", { vehicleId: selected?.id || Number(value(f,"vehicleId")), inspectionType: value(f,"inspectionType"), odometerKm: num(f,"odometerKm"), checklist: checklist(f), result: failed ? "fail" : attention ? "attention" : "pass", defects: value(f,"defects") || null }); }, <>{!selected && <VehicleSelect name="vehicleId" vehicles={data.vehicles} required />}<div className="grid gap-3 sm:grid-cols-2"><Field label="Inspection type"><NativeSelect name="inspectionType"><option value="scheduled">Scheduled</option><option value="handover">Handover</option><option value="spot_check">Spot Check</option></NativeSelect></Field><Field label="Odometer"><Input name="odometerKm" type="number" min={selected?.currentOdometer || 0} defaultValue={selected?.currentOdometer || ""} /></Field></div><Checklist /><div className="grid gap-2 sm:grid-cols-2"><Check name="attention" label="Requires attention" /><Check name="failed" label="FAIL — suspend vehicle" /></div><Field label="Defects / findings"><Textarea name="defects" /></Field></>, "Record Inspection"); }
  else if (t === "fuel") { titleText = "Record Fuel"; const trip = r?.vehicleId ? r : null; const v = trip ? data.vehicles.find((x) => x.id === trip.vehicleId) : null; body = shell((f) => submit("POST", "/api/fleet/fuel", { vehicleId: Number(value(f,"vehicleId")), tripId: trip?.id || null, driverStaffId: trip?.driverStaffId || data.currentStaff?.id || null, transactionDate: value(f,"transactionDate"), odometerKm: Number(value(f,"odometerKm")), fuelType: value(f,"fuelType"), litres: Number(value(f,"litres")), pricePerLitre: Number(value(f,"pricePerLitre") || 0), totalCost: Number(value(f,"totalCost") || 0), supplier: value(f,"supplier") || null, paymentMethod: value(f,"paymentMethod"), receiptReference: value(f,"receiptReference") || null, fullTank: checked(f,"fullTank"), notes: value(f,"notes") || null }), <><VehicleSelect name="vehicleId" vehicles={data.vehicles} defaultValue={trip?.vehicleId} required disabled={!!trip} /><div className="grid gap-3 sm:grid-cols-2"><Field label="Date"><Input name="transactionDate" type="date" defaultValue={today()} required /></Field><Field label="Odometer"><Input name="odometerKm" type="number" min={v?.currentOdometer || 0} defaultValue={v?.currentOdometer || ""} required /></Field><Field label="Fuel type"><NativeSelect name="fuelType"><option value="petrol">Petrol</option><option value="diesel">Diesel</option><option value="other">Other</option></NativeSelect></Field><Field label="Litres"><Input name="litres" type="number" min="0.001" step="0.001" required /></Field><Field label="Price per litre"><Input name="pricePerLitre" type="number" min="0" step="0.01" /></Field><Field label="Total cost"><Input name="totalCost" type="number" min="0" step="0.01" /></Field><Field label="Supplier / station"><Input name="supplier" /></Field><Field label="Payment method"><NativeSelect name="paymentMethod"><option value="organisation_fuel_card">Organisation Fuel Card</option><option value="organisation_account">Organisation Supplier Account</option><option value="cash">Cash</option><option value="reimbursement">Reimbursement</option><option value="fuel_voucher">Fuel Voucher</option><option value="bulk_fuel">Bulk Fuel</option><option value="other">Other</option></NativeSelect></Field><Field label="Receipt reference"><Input name="receiptReference" /></Field></div><Check name="fullTank" label="Full-tank fill" /><Field label="Notes"><Textarea name="notes" /></Field></>); }
  else if (t === "maintenance") { titleText = "Report Maintenance / Defect"; body = shell((f) => submit("POST", "/api/fleet/maintenance", { vehicleId: r?.id || Number(value(f,"vehicleId")), jobType: value(f,"jobType"), issueDescription: value(f,"issueDescription"), odometerKm: num(f,"odometerKm"), priority: value(f,"priority"), serviceProvider: value(f,"serviceProvider") || null, estimatedCost: Number(value(f,"estimatedCost") || 0), notes: value(f,"notes") || null }), <>{!r && <VehicleSelect name="vehicleId" vehicles={data.vehicles} required />}<div className="grid gap-3 sm:grid-cols-2"><Field label="Job type"><NativeSelect name="jobType"><option value="repair">Repair</option><option value="service">Scheduled Service</option><option value="breakdown">Breakdown</option><option value="inspection_followup">Inspection Follow-up</option></NativeSelect></Field><Field label="Priority"><NativeSelect name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical / Suspend</option><option value="low">Low</option></NativeSelect></Field><Field label="Odometer"><Input name="odometerKm" type="number" min="0" defaultValue={r?.currentOdometer || ""} /></Field><Field label="Service provider"><Input name="serviceProvider" /></Field><Field label="Estimated cost"><Input name="estimatedCost" type="number" min="0" step="0.01" /></Field></div><Field label="Issue / work required"><Textarea name="issueDescription" required /></Field><Field label="Notes"><Textarea name="notes" /></Field></>); }
  else if (t === "updateMaintenance") { titleText = `Update ${r.referenceNumber}`; body = shell((f) => submit("PUT", `/api/fleet/maintenance/${r.id}`, { status: value(f,"status"), serviceProvider: value(f,"serviceProvider") || null, estimatedCost: Number(value(f,"estimatedCost") || 0), actualCost: Number(value(f,"actualCost") || 0), workCompleted: value(f,"workCompleted") || null, nextServiceDate: value(f,"nextServiceDate") || null, nextServiceOdometer: num(f,"nextServiceOdometer") }), <><div className="grid gap-3 sm:grid-cols-2"><Field label="Status"><NativeSelect name="status" defaultValue={r.status}><option value="reported">Reported</option><option value="approved">Approved</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></NativeSelect></Field><Field label="Service provider"><Input name="serviceProvider" defaultValue={r.serviceProvider || ""} /></Field><Field label="Estimated cost"><Input name="estimatedCost" type="number" min="0" step="0.01" defaultValue={r.estimatedCost || 0} /></Field><Field label="Actual cost"><Input name="actualCost" type="number" min="0" step="0.01" defaultValue={r.actualCost || 0} /></Field><Field label="Next service date"><Input name="nextServiceDate" type="date" defaultValue={r.nextServiceDate || ""} /></Field><Field label="Next service odometer"><Input name="nextServiceOdometer" type="number" min="0" defaultValue={r.nextServiceOdometer || ""} /></Field></div><Field label="Work completed"><Textarea name="workCompleted" defaultValue={r.workCompleted || ""} /></Field></>); }
  else if (t === "compliance") { titleText = "Add Vehicle Compliance"; body = shell((f) => submit("POST", "/api/fleet/compliance", { vehicleId: Number(value(f,"vehicleId")), documentType: value(f,"documentType"), documentNumber: value(f,"documentNumber") || null, issueDate: value(f,"issueDate") || null, expiryDate: value(f,"expiryDate"), issuingAuthority: value(f,"issuingAuthority") || null, verificationStatus: value(f,"verificationStatus"), notes: value(f,"notes") || null }), <><VehicleSelect name="vehicleId" vehicles={data.vehicles} required /><div className="grid gap-3 sm:grid-cols-2"><Field label="Document type"><NativeSelect name="documentType"><option value="vehicle_licence">Vehicle Licence</option><option value="insurance">Insurance</option><option value="certificate_of_fitness">Certificate of Fitness</option><option value="route_permit">Route Permit</option><option value="radio_licence">Radio Licence</option><option value="fire_extinguisher">Fire Extinguisher</option><option value="other">Other</option></NativeSelect></Field><Field label="Document number"><Input name="documentNumber" /></Field><Field label="Issue date"><Input name="issueDate" type="date" /></Field><Field label="Expiry date"><Input name="expiryDate" type="date" required /></Field><Field label="Issuing authority"><Input name="issuingAuthority" /></Field><Field label="Verification"><NativeSelect name="verificationStatus"><option value="unverified">Unverified</option><option value="verified">Verified</option></NativeSelect></Field></div><Field label="Notes"><Textarea name="notes" /></Field></>); }
  else if (t === "incident") { titleText = "Report Incident / Breakdown"; const trip = r?.vehicleId ? r : null; body = shell((f) => submit("POST", "/api/fleet/incidents", { vehicleId: trip?.vehicleId || Number(value(f,"vehicleId")), tripId: trip?.id || null, driverStaffId: trip?.driverStaffId || data.currentStaff?.id || null, incidentType: value(f,"incidentType"), occurredAt: value(f,"occurredAt"), location: value(f,"location") || null, description: value(f,"description"), injuriesReported: checked(f,"injuriesReported"), policeReportReference: value(f,"policeReportReference") || null, insuranceClaimNumber: value(f,"insuranceClaimNumber") || null, estimatedDamage: Number(value(f,"estimatedDamage") || 0), notes: value(f,"notes") || null }), <>{!trip && <VehicleSelect name="vehicleId" vehicles={data.vehicles} required />}<div className="grid gap-3 sm:grid-cols-2"><Field label="Type"><NativeSelect name="incidentType"><option value="accident">Accident</option><option value="breakdown">Breakdown</option><option value="damage">Damage</option><option value="tyre_failure">Tyre Failure</option><option value="security">Security Issue</option><option value="other">Other</option></NativeSelect></Field><Field label="When"><Input name="occurredAt" type="datetime-local" defaultValue={dateTimeLocal(new Date())} required /></Field><Field label="Location"><Input name="location" /></Field><Field label="Estimated damage"><Input name="estimatedDamage" type="number" min="0" step="0.01" /></Field><Field label="Police report reference"><Input name="policeReportReference" /></Field><Field label="Insurance claim number"><Input name="insuranceClaimNumber" /></Field></div><Check name="injuriesReported" label="Injuries reported" /><Field label="Description"><Textarea name="description" required /></Field><Field label="Notes"><Textarea name="notes" /></Field></>, "Report"); }
  else if (t === "component") { titleText = "Add Tyre / Battery"; body = shell((f) => submit("POST", "/api/fleet/components", { componentType: value(f,"componentType"), serialNumber: value(f,"serialNumber"), brand: value(f,"brand") || null, specification: value(f,"specification") || null, purchaseDate: value(f,"purchaseDate") || null, purchaseCost: Number(value(f,"purchaseCost") || 0), supplier: value(f,"supplier") || null, warrantyExpiry: value(f,"warrantyExpiry") || null, vehicleId: num(f,"vehicleId"), wheelPosition: value(f,"wheelPosition") || null, fittedAtOdometer: num(f,"fittedAtOdometer"), status: num(f,"vehicleId") ? "fitted" : "in_stock", condition: "new", notes: value(f,"notes") || null }), <><div className="grid gap-3 sm:grid-cols-2"><Field label="Component"><NativeSelect name="componentType"><option value="tyre">Tyre</option><option value="battery">Battery</option></NativeSelect></Field><Field label="Serial number"><Input name="serialNumber" required /></Field><Field label="Brand"><Input name="brand" /></Field><Field label="Specification / size"><Input name="specification" /></Field><Field label="Purchase date"><Input name="purchaseDate" type="date" /></Field><Field label="Purchase cost"><Input name="purchaseCost" type="number" min="0" step="0.01" /></Field><Field label="Supplier"><Input name="supplier" /></Field><Field label="Warranty expiry"><Input name="warrantyExpiry" type="date" /></Field></div><VehicleSelect name="vehicleId" vehicles={data.vehicles} /><div className="grid gap-3 sm:grid-cols-2"><Field label="Wheel position (tyres)"><Input name="wheelPosition" placeholder="e.g. Front Left" /></Field><Field label="Fitting odometer"><Input name="fittedAtOdometer" type="number" min="0" /></Field></div><Field label="Notes"><Textarea name="notes" /></Field></>); }
  else if (t === "disposal") { titleText = "Replacement / Disposal Recommendation"; description = "This creates a Fleet management recommendation. Final asset disposal remains controlled by Assets & Inventory."; body = shell((f) => submit("POST", "/api/fleet/disposals", { vehicleId: r.id, reason: value(f,"reason"), reviewNotes: value(f,"reviewNotes") || null }), <><Field label="Reason for replacement/disposal review"><Textarea name="reason" required /></Field><Field label="Supporting notes"><Textarea name="reviewNotes" /></Field></>, "Submit Recommendation"); }
  else if (t === "reviewDisposal") { titleText = "Review Replacement / Disposal"; body = shell((f) => submit("PUT", `/api/fleet/disposals/${r.id}/status`, { status: value(f,"status"), reviewNotes: value(f,"reviewNotes") || null }), <><Field label="Decision"><NativeSelect name="status" defaultValue={r.status === "recommended" ? "approved" : "handed_to_assets"}><option value="approved">Approve recommendation</option><option value="declined">Decline</option><option value="handed_to_assets">Hand to Assets & Inventory</option><option value="completed">Complete (only after Asset is disposed)</option></NativeSelect></Field><Field label="Review notes"><Textarea name="reviewNotes" defaultValue={r.reviewNotes || ""} /></Field></>, "Save Decision"); }
  else if (t === "endOccupant") { titleText = "End Vehicle Occupant Assignment"; description = `End ${r.occupantName || "this occupant"}'s regular assignment to this vehicle without deleting the history.`; body = shell((f) => submit("POST", `/api/fleet/occupants/${r.id}/end`, { endDate: value(f,"endDate"), notes: value(f,"notes") || null }), <><Field label="End date"><Input name="endDate" type="date" defaultValue={today()} min={r.startDate || undefined} required /></Field><Field label="Notes"><Textarea name="notes" defaultValue={r.notes || ""} /></Field></>, "End Assignment"); }
  else if (t === "suspend") { titleText = "Suspend Vehicle"; description = "Suspension blocks normal operation until an authorised release."; body = shell((f) => submit("POST", `/api/fleet/vehicles/${r.id}/suspend`, { reason: value(f,"reason") }), <Field label="Mandatory reason"><Textarea name="reason" required /></Field>, "Suspend Vehicle"); }

  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{titleText}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>{body}</DialogContent></Dialog>;
}

function VehicleEditorDialog({ mode, record, data, busy, close, submit }: { mode: string; record?: any; data: Bootstrap; busy: boolean; close: () => void; submit: (method: string, url: string, body: any) => void }) {
  const isEdit = mode === "editVehicle";
  const isActivate = mode === "activateVehicle";
  const initialAssetId = isActivate ? String(record?.asset?.id || data.availableAssets[0]?.asset?.id || "") : "";
  const [assetId, setAssetId] = useState(initialAssetId);
  const initialAsset = isActivate ? (data.availableAssets.find((x) => String(x.asset.id) === initialAssetId) || record) : record;
  const initialBaseSchoolId = record?.baseSchoolId || record?.schoolId || (isActivate ? initialAsset?.asset?.schoolId : data.scope?.schoolId) || "";
  const [baseSchoolId, setBaseSchoolId] = useState(String(initialBaseSchoolId));
  const selectedAsset = isActivate ? (data.availableAssets.find((x) => String(x.asset.id) === assetId) || initialAsset) : null;
  const details = isEdit ? (record?.details || {}) : {};
  const profile = isEdit ? record : {};
  const driverOptions = data.drivers.filter((d) => d.status === "active");
  const schoolOptions = data.schools.map((s) => ({ value: String(s.id), label: s.name, searchText: `${s.name} ${s.shortCode || ""}` }));
  const assetOptions = data.availableAssets.map((x) => ({
    value: String(x.asset.id),
    label: `${x.details?.registrationNumber || x.asset.assetNumber} — ${[x.details?.make, x.details?.model].filter(Boolean).join(" ") || x.asset.name}`,
    searchText: `${x.asset.assetNumber} ${x.details?.registrationNumber || ""} ${x.details?.vin || ""}`,
  }));
  const heading = isEdit ? `Edit ${details.registrationNumber || record?.asset?.assetNumber || "Vehicle"}` : isActivate ? "Activate Existing Vehicle Asset" : "Register Vehicle";
  const description = isActivate
    ? "Activate an existing vehicle asset for Fleet operations. Asset identity remains the source of truth."
    : "Vehicle identity is registered in Assets & Inventory and its operational profile is maintained by Fleet Management.";

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const body: any = {
      baseSchoolId: baseSchoolId ? Number(baseSchoolId) : null,
      capacity: Number(value(f, "capacity") || 1),
      allocationType: value(f, "allocationType") || "pool",
      custodianStaffId: num(f, "custodianStaffId"),
      primaryDriverStaffId: num(f, "primaryDriverStaffId"),
      currentOdometer: Number(value(f, "currentOdometer") || 0),
      status: value(f, "status") || "available",
      serviceIntervalKm: Number(value(f, "serviceIntervalKm") || 10000),
      serviceIntervalMonths: Number(value(f, "serviceIntervalMonths") || 6),
      lastServiceDate: value(f, "lastServiceDate") || null,
      lastServiceOdometer: num(f, "lastServiceOdometer"),
      nextServiceDate: value(f, "nextServiceDate") || null,
      nextServiceOdometer: num(f, "nextServiceOdometer"),
      notes: value(f, "notes") || null,
    };
    if (isActivate) body.assetId = Number(assetId);
    else Object.assign(body, {
      registrationNumber: value(f, "registrationNumber"),
      vin: value(f, "vin") || null,
      engineNumber: value(f, "engineNumber") || null,
      make: value(f, "make") || null,
      model: value(f, "model") || null,
      manufactureYear: num(f, "manufactureYear"),
      colour: value(f, "colour") || null,
      fuelType: value(f, "fuelType") || null,
      vehicleClass: value(f, "vehicleClass") || null,
    });
    submit(isEdit ? "PUT" : "POST", isEdit ? `/api/fleet/vehicles/${record.id}` : "/api/fleet/vehicles", body);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>{heading}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-5">
          {isActivate && (
            <Field label="Vehicle asset">
              <SearchableSelect
                value={assetId}
                onValueChange={(next) => {
                  setAssetId(next);
                  const asset = data.availableAssets.find((x) => String(x.asset.id) === next);
                  if (asset?.asset?.schoolId) setBaseSchoolId(String(asset.asset.schoolId));
                }}
                options={assetOptions}
                placeholder="Select existing vehicle asset"
                searchPlaceholder="Search registration, asset number or VIN…"
              />
              {selectedAsset && <p className="text-xs text-muted-foreground">{selectedAsset.details?.registrationNumber || selectedAsset.asset?.assetNumber} · {[selectedAsset.details?.make, selectedAsset.details?.model].filter(Boolean).join(" ") || selectedAsset.asset?.name}</p>}
            </Field>
          )}

          {!isActivate && (
            <div className="space-y-3 rounded-lg border p-4">
              <div><p className="font-medium">Vehicle identity</p><p className="text-xs text-muted-foreground">Registration may contain letters, numbers and spaces only. Standard and customised registrations are supported.</p></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Registration number"><Input name="registrationNumber" defaultValue={details.registrationNumber || ""} pattern="[A-Za-z0-9 ]+" maxLength={40} placeholder="ABC1234" required /></Field>
                <Field label="Make"><Input name="make" defaultValue={details.make || ""} /></Field>
                <Field label="Model"><Input name="model" defaultValue={details.model || ""} /></Field>
                <Field label="Manufacture year"><Input name="manufactureYear" type="number" min="1900" max="2200" defaultValue={details.manufactureYear || ""} /></Field>
                <Field label="Colour"><Input name="colour" defaultValue={details.colour || ""} /></Field>
                <Field label="Vehicle class"><Input name="vehicleClass" defaultValue={details.vehicleClass || ""} placeholder="e.g. minibus, pickup, sedan" /></Field>
                <Field label="Fuel type"><Input name="fuelType" defaultValue={details.fuelType || ""} placeholder="e.g. diesel" /></Field>
                <Field label="VIN"><Input name="vin" defaultValue={details.vin || ""} /></Field>
                <Field label="Engine number"><Input name="engineNumber" defaultValue={details.engineNumber || ""} /></Field>
              </div>
            </div>
          )}

          <div className="space-y-3 rounded-lg border p-4">
            <div><p className="font-medium">Operational profile</p><p className="text-xs text-muted-foreground">The school where a new vehicle is entered is its default Base/Home, but this searchable selector can be changed whenever required.</p></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Base / Home school">
                <SearchableSelect value={baseSchoolId} onValueChange={setBaseSchoolId} options={schoolOptions} placeholder="Select Base/Home school" searchPlaceholder="Search schools…" />
              </Field>
              <Field label="Capacity"><Input name="capacity" type="number" min="1" defaultValue={profile.capacity || 1} required /></Field>
              <Field label="Current odometer (km)"><Input name="currentOdometer" type="number" min="0" defaultValue={profile.currentOdometer || 0} required /></Field>
              <Field label="Allocation type"><NativeSelect name="allocationType" defaultValue={profile.allocationType || "pool"}><option value="pool">Pool Vehicle</option><option value="staff">Permanent Staff Allocation</option><option value="department">Department Allocation</option><option value="school">School Allocation</option><option value="temporary">Temporary Allocation</option><option value="student_transport">Student Transport Allocation</option></NativeSelect></Field>
              <Field label="Status"><NativeSelect name="status" defaultValue={profile.status || "available"}><option value="available">Available</option><option value="allocated">Allocated</option><option value="inspection">Inspection</option><option value="service_due">Service Due</option><option value="maintenance">Maintenance</option><option value="broken_down">Broken Down</option><option value="accident_damaged">Accident Damaged</option><option value="suspended">Suspended</option></NativeSelect></Field>
              <Field label="Custodian"><NativeSelect name="custodianStaffId" defaultValue={profile.custodianStaffId || ""}><option value="">None</option>{data.staff.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} ({s.staffNo || "staff"})</option>)}</NativeSelect></Field>
              <Field label="Primary driver"><NativeSelect name="primaryDriverStaffId" defaultValue={profile.primaryDriverStaffId || ""}><option value="">Not assigned</option>{driverOptions.map((d) => { const s = data.staff.find((x) => x.id === d.staffId); return <option key={d.id} value={d.staffId}>{s?.firstName} {s?.lastName}</option>; })}</NativeSelect></Field>
              <Field label="Service interval (km)"><Input name="serviceIntervalKm" type="number" min="1" defaultValue={profile.serviceIntervalKm || 10000} /></Field>
              <Field label="Service interval (months)"><Input name="serviceIntervalMonths" type="number" min="1" defaultValue={profile.serviceIntervalMonths || 6} /></Field>
              <Field label="Last service date"><Input name="lastServiceDate" type="date" defaultValue={profile.lastServiceDate || ""} /></Field>
              <Field label="Last service odometer"><Input name="lastServiceOdometer" type="number" min="0" defaultValue={profile.lastServiceOdometer || ""} /></Field>
              <Field label="Next service date"><Input name="nextServiceDate" type="date" defaultValue={profile.nextServiceDate || ""} /></Field>
              <Field label="Next service odometer"><Input name="nextServiceOdometer" type="number" min="0" defaultValue={profile.nextServiceOdometer || ""} /></Field>
            </div>
            <Field label="Notes"><Textarea name="notes" defaultValue={profile.notes || ""} /></Field>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button disabled={busy || !baseSchoolId || (isActivate && !assetId)}>{busy ? "Saving…" : isEdit ? "Save Vehicle" : isActivate ? "Activate Vehicle" : "Register Vehicle"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OccupantEditorDialog({ record, data, busy, close, submit }: { record?: any; data: Bootstrap; busy: boolean; close: () => void; submit: (method: string, url: string, body: any) => void }) {
  const isEdit = !!record?.id;
  const [vehicleId, setVehicleId] = useState(String(record?.vehicleId || data.vehicles[0]?.id || ""));
  const [occupantType, setOccupantType] = useState(String(record?.occupantType || "student"));
  const [personId, setPersonId] = useState(String(record?.studentId || record?.staffId || ""));
  const [routeChoice, setRouteChoice] = useState(String(record?.routeId || (record?.routeName ? "__custom__" : data.routes[0]?.id || "")));
  const [sameLocation, setSameLocation] = useState(record?.sameLocation !== false);
  const [pickupServicePointId, setPickupServicePointId] = useState<number | null>(record?.pickupServicePointId ? Number(record.pickupServicePointId) : null);
  const [dropoffServicePointId, setDropoffServicePointId] = useState<number | null>(record?.dropoffServicePointId ? Number(record.dropoffServicePointId) : null);
  const [pickupLocation, setPickupLocation] = useState<ServiceLocationDraft>(() => record?.id ? locationFromRecord(record, "pickup") : emptyServiceLocation());
  const [dropoffLocation, setDropoffLocation] = useState<ServiceLocationDraft>(() => record?.id ? locationFromRecord(record, "dropoff") : emptyServiceLocation());
  const vehicleOptions = data.vehicles.map((v) => ({ value: String(v.id), label: `${v.details?.registrationNumber || v.asset?.assetNumber || `Vehicle ${v.id}`} — ${[v.details?.make, v.details?.model].filter(Boolean).join(" ") || v.asset?.name || ""}`, searchText: `${v.asset?.assetNumber || ""} ${v.details?.registrationNumber || ""}` }));
  const routeOptions = [...data.routes.map((route) => ({ value: String(route.id), label: `${route.name} (${route.code})`, searchText: `${route.name} ${route.code}` })), { value: "__custom__", label: "Other / custom route" }];
  const personOptions = occupantType === "student"
    ? data.students.map((person) => ({ value: String(person.id), label: `${person.firstName} ${person.lastName} (${person.admissionNo})`, searchText: `${person.firstName} ${person.lastName} ${person.admissionNo}` }))
    : data.staff.map((person) => ({ value: String(person.id), label: `${person.firstName} ${person.lastName} (${person.staffNo || "staff"})`, searchText: `${person.firstName} ${person.lastName} ${person.staffNo || ""}` }));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const body = {
      vehicleId: Number(vehicleId),
      occupantType,
      studentId: occupantType === "student" ? Number(personId) : null,
      staffId: occupantType === "staff" ? Number(personId) : null,
      occupantName: occupantType === "other" ? value(f, "occupantName") : null,
      routeId: routeChoice && routeChoice !== "__custom__" ? Number(routeChoice) : null,
      routeName: routeChoice === "__custom__" ? value(f, "routeName") : null,
      serviceType: value(f, "serviceType") || "both",
      sameLocation,
      pickupServicePointId,
      dropoffServicePointId: sameLocation ? pickupServicePointId : dropoffServicePointId,
      pickupName: pickupLocation.name.trim(),
      pickupAddress: pickupLocation.address.trim() || null,
      pickupLandmark: pickupLocation.landmark.trim() || null,
      pickupLatitude: pickupLocation.latitude,
      pickupLongitude: pickupLocation.longitude,
      pickupPrivacyClass: pickupLocation.privacyClass,
      pickupInstructions: pickupLocation.instructions.trim() || null,
      dropoffName: sameLocation ? null : dropoffLocation.name.trim() || null,
      dropoffAddress: sameLocation ? null : dropoffLocation.address.trim() || null,
      dropoffLandmark: sameLocation ? null : dropoffLocation.landmark.trim() || null,
      dropoffLatitude: sameLocation ? null : dropoffLocation.latitude,
      dropoffLongitude: sameLocation ? null : dropoffLocation.longitude,
      dropoffPrivacyClass: sameLocation ? pickupLocation.privacyClass : dropoffLocation.privacyClass,
      dropoffInstructions: sameLocation ? null : dropoffLocation.instructions.trim() || null,
      startDate: value(f, "startDate"),
      endDate: value(f, "endDate") || null,
      notes: value(f, "notes") || null,
    };
    submit(isEdit ? "PUT" : "POST", isEdit ? `/api/fleet/occupants/${record.id}` : "/api/fleet/occupants", body);
  };

  const locationReady = pickupLocation.name.trim() && pickupLocation.latitude != null && pickupLocation.longitude != null
    && (sameLocation || (dropoffLocation.name.trim() && dropoffLocation.latitude != null && dropoffLocation.longitude != null));

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[94dvh] max-w-5xl overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? `Edit ${record.occupantName || "Vehicle Occupant"}` : "Add Vehicle Occupant"}</DialogTitle><DialogDescription>Regular occupants use the same route and complete map-based pick-up/drop-off location model as learner Transport registrations.</DialogDescription></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Vehicle"><SearchableSelect value={vehicleId} onValueChange={setVehicleId} options={vehicleOptions} placeholder="Select vehicle" searchPlaceholder="Search vehicles…" /></Field>
            <Field label="Occupant type"><NativeSelect value={occupantType} onChange={(event) => { setOccupantType(event.target.value); setPersonId(""); }}><option value="student">Student</option><option value="staff">Staff</option><option value="other">Other</option></NativeSelect></Field>
            {occupantType === "other" ? <Field label="Occupant name"><Input name="occupantName" defaultValue={record?.occupantName || ""} required /></Field> : <Field label={occupantType === "student" ? "Student" : "Staff member"}><SearchableSelect value={personId} onValueChange={setPersonId} options={personOptions} placeholder={`Select ${occupantType}`} searchPlaceholder={`Search ${occupantType === "student" ? "students" : "staff"}…`} /></Field>}
            <Field label="Route"><SearchableSelect value={routeChoice} onValueChange={setRouteChoice} options={routeOptions} placeholder="Select route" searchPlaceholder="Search routes…" /></Field>
            {routeChoice === "__custom__" && <Field label="Custom route name"><Input name="routeName" defaultValue={record?.routeId ? "" : record?.routeName || ""} required /></Field>}
            <Field label="Service"><NativeSelect name="serviceType" defaultValue={record?.serviceType || "both"}><option value="both">Pick-up & Drop-off</option><option value="pickup">Pick-up only</option><option value="dropoff">Drop-off only</option></NativeSelect></Field>
            <Field label="Start date"><Input name="startDate" type="date" defaultValue={record?.startDate || today()} required /></Field>
            <Field label="End date (optional)"><Input name="endDate" type="date" defaultValue={record?.endDate || ""} /></Field>
          </div>

          <div className="rounded-lg border p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">Service locations</p><p className="text-xs text-muted-foreground">Use map click or coordinates, plus address, landmark, privacy and driver instructions.</p></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sameLocation} onChange={(event) => setSameLocation(event.target.checked)} className="h-4 w-4" />Use same location for drop-off</label></div>
            <ServiceLocationEditor title={sameLocation ? "Pick-up / drop-off location" : "Pick-up location"} value={pickupLocation} onChange={setPickupLocation} required savedPoints={data.servicePoints || []} selectedPointId={pickupServicePointId} onSelectedPointIdChange={setPickupServicePointId} suggestionRadiusMeters={Number(data.transportSettings?.savedPointSuggestionRadiusMeters || 50)} />
          </div>

          {!sameLocation && <div className="rounded-lg border p-4"><ServiceLocationEditor title="Drop-off location" description="Use this when the return location differs from pick-up." value={dropoffLocation} onChange={setDropoffLocation} required savedPoints={data.servicePoints || []} selectedPointId={dropoffServicePointId} onSelectedPointIdChange={setDropoffServicePointId} suggestionRadiusMeters={Number(data.transportSettings?.savedPointSuggestionRadiusMeters || 50)} /></div>}
          <Field label="Notes"><Textarea name="notes" defaultValue={record?.notes || ""} /></Field>
          <DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button disabled={busy || !vehicleId || !routeChoice || !locationReady || (occupantType !== "other" && !personId)}>{busy ? "Saving…" : isEdit ? "Save Occupant" : "Add Occupant"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MakeAvailableInTransportDialog({ vehicle, data, busy, close, submit }: { vehicle: any; data: Bootstrap; busy: boolean; close: () => void; submit: (method: string, url: string, body: any) => void }) {
  const initialSchoolId = String(vehicle?.baseSchoolId || vehicle?.schoolId || data.scope?.schoolId || "");
  const [schoolId, setSchoolId] = useState(initialSchoolId);
  const [driverId, setDriverId] = useState("__none__");
  const registration = vehicle?.details?.registrationNumber || "";
  const allowedSchools = data.schools;
  const schoolOptions = allowedSchools.map((school) => ({ value: String(school.id), label: school.name, searchText: `${school.name} ${school.shortCode || ""}` }));
  const transportDriverOptions = [{ value: "__none__", label: "Not assigned yet" }, ...data.transportDrivers.map((driver) => ({ value: String(driver.id), label: `${driver.firstName} ${driver.lastName}${driver.licenceNumber ? ` · ${driver.licenceNumber}` : ""}`, searchText: `${driver.firstName} ${driver.lastName} ${driver.licenceNumber || ""}` }))];
  const matchingVehicle = data.transportVehicles.find((row) => normalizedRegistration(row.registrationNumber) === normalizedRegistration(registration));
  const selectedSchool = data.schools.find((school) => String(school.id) === schoolId);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    submit("POST", `/api/fleet/vehicles/${vehicle.id}/make-available-in-transport`, {
      schoolId: Number(schoolId),
      capacity: Number(value(f, "capacity") || vehicle.capacity || 1),
      linkExistingTransportVehicleId: matchingVehicle?.id || null,
      driverId: driverId === "__none__" ? null : Number(driverId),
      registrationExpiry: value(f, "registrationExpiry") || null,
      insuranceExpiry: value(f, "insuranceExpiry") || null,
      fitnessExpiry: value(f, "fitnessExpiry") || null,
      radioLicenceExpiry: value(f, "radioLicenceExpiry") || null,
      status: value(f, "status") || "active",
      notes: value(f, "notes") || null,
    });
  };

  if (vehicle.transportVehicleId) return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Already available in Transport</DialogTitle><DialogDescription>This Fleet asset is already linked to Transport vehicle #{vehicle.transportVehicleId}. The Transport record remains operationally independent from the asset record.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={close}>Close</Button><Button onClick={openTransportVehicleRegister}>View in Transport</Button></DialogFooter></DialogContent></Dialog>;

  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Make {registration || vehicle.asset?.assetNumber || "vehicle"} Available in Transport</DialogTitle><DialogDescription>This is an explicit opt-in. It does not make Transport dependent on Fleet: outsourced/Transport-only vehicles continue to exist independently.</DialogDescription></DialogHeader>
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4"><div className="grid gap-3 sm:grid-cols-3"><Detail label="Source" value="FCGS Asset / Fleet"/><Detail label="Asset" value={vehicle.asset?.assetNumber || `#${vehicle.assetId}`}/><Detail label="Registration" value={registration || "Registration required"}/></div></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Transport school / service"><SearchableSelect value={schoolId} onValueChange={(next) => { setSchoolId(next); setDriverId("__none__"); }} options={schoolOptions} placeholder="Select Transport school" searchPlaceholder="Search schools…" /></Field>
        <Field label="Transport capacity"><Input name="capacity" type="number" min="1" defaultValue={vehicle.capacity || 1} required /></Field>
        <Field label="Assigned Transport driver (optional)"><SearchableSelect value={driverId} onValueChange={setDriverId} options={transportDriverOptions} placeholder="Not assigned yet" searchPlaceholder="Search Transport drivers…" /></Field>
        <Field label="Transport status"><NativeSelect name="status" defaultValue="active"><option value="active">Active</option><option value="draft">Draft</option><option value="suspended">Suspended</option></NativeSelect></Field>
        <Field label="Registration expiry"><Input name="registrationExpiry" type="date" /></Field>
        <Field label="Insurance expiry"><Input name="insuranceExpiry" type="date" /></Field>
        <Field label="Fitness expiry"><Input name="fitnessExpiry" type="date" /></Field>
        <Field label="Radio licence expiry"><Input name="radioLicenceExpiry" type="date" /></Field>
      </div>
      {matchingVehicle && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm"><p className="font-medium">Existing Transport record found</p><p className="mt-1 text-muted-foreground">{matchingVehicle.registrationNumber} already exists in Transport at {data.schools.find((school) => school.id === matchingVehicle.schoolId)?.name || "another school"}. Saving will link that existing organisation-wide Transport record to this Fleet asset instead of creating a duplicate.</p></div>}
      <Field label="Transport notes"><Textarea name="notes" placeholder="Optional notes about how this FCGS vehicle will be used in the Transport service." /></Field>
      <div className="rounded-lg border p-3 text-xs text-muted-foreground">After saving, the vehicle appears in the normal Transport vehicle register alongside outsourced vehicles. Creating a Transport vehicle directly never creates an Asset/Fleet record.</div>
      <DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button disabled={busy || !schoolId || !registration}>{busy ? "Saving…" : matchingVehicle ? "Link Existing Transport Record" : "Make Available in Transport"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function VehicleDetailsDialog({ vehicle, data, busy, canManage, close, submit }: { vehicle: any; data: Bootstrap; busy: boolean; canManage: boolean; close: () => void; submit: (method: string, url: string, body: any) => void }) {
  const [showTransportDialog, setShowTransportDialog] = useState(false);
  const staffName = (id: number | null | undefined) => { const s = data.staff.find((x) => x.id === id); return s ? `${s.firstName} ${s.lastName}` : "—"; };
  const schoolName = (id: number | null | undefined) => data.schools.find((s) => s.id === id)?.name || (id ? `School #${id}` : "HQ");
  const occupants = data.occupants.filter((x) => x.vehicleId === vehicle.id);
  const trips = data.trips.filter((x) => x.vehicleId === vehicle.id);
  const maintenance = data.maintenance.filter((x) => x.vehicleId === vehicle.id);
  const fuel = data.fuel.filter((x) => x.vehicleId === vehicle.id);
  const compliance = data.compliance.filter((x) => x.vehicleId === vehicle.id);
  const incidents = data.incidents.filter((x) => x.vehicleId === vehicle.id);
  const components = data.components.filter((x) => x.vehicleId === vehicle.id);
  const transportRecord = data.transportVehicles.find((x) => x.id === vehicle.transportVehicleId);
  const registration = vehicle.details?.registrationNumber || vehicle.asset?.assetNumber || `Vehicle ${vehicle.id}`;
  const makeModel = [vehicle.details?.make, vehicle.details?.model].filter(Boolean).join(" ") || vehicle.asset?.name || "Vehicle";
  return <>
    <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[94dvh] max-w-6xl overflow-y-auto"><DialogHeader><DialogTitle>Vehicle Record</DialogTitle><DialogDescription>Fleet operational record linked to asset {vehicle.asset?.assetNumber || `#${vehicle.assetId}`}.</DialogDescription></DialogHeader>
      <div className="rounded-xl border bg-muted/30 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-semibold tracking-tight">{registration}</h2><Status value={vehicle.status} />{vehicle.transportVehicleId ? <Badge><Link2 className="mr-1 h-3.5 w-3.5"/>Available in Transport</Badge> : <Badge variant="outline">Fleet / Asset only</Badge>}</div>
            <p className="text-sm text-muted-foreground">{makeModel} · Asset {vehicle.asset?.assetNumber || `#${vehicle.assetId}`}</p>
          </div>
          {canManage && (vehicle.transportVehicleId
            ? <Button variant="outline" onClick={openTransportVehicleRegister}><Link2 className="mr-2 h-4 w-4"/>View in Transport</Button>
            : <Button onClick={() => setShowTransportDialog(true)}><Link2 className="mr-2 h-4 w-4"/>Make Available in Transport</Button>)}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Base / Home" value={schoolName(vehicle.baseSchoolId || vehicle.schoolId)} />
          <Detail label="Registered At" value={schoolName(vehicle.asset?.schoolId)} />
          <Detail label="Allocation" value={title(vehicle.allocationType)} />
          <Detail label="Primary Driver" value={staffName(vehicle.primaryDriverStaffId)} />
          <Detail label="Odometer" value={`${Number(vehicle.currentOdometer || 0).toLocaleString()} km`} />
          <Detail label="Capacity" value={vehicle.capacity} />
          <Detail label="Custodian" value={staffName(vehicle.custodianStaffId)} />
          <Detail label="Transport" value={transportRecord ? `${transportRecord.registrationNumber} · ${schoolName(transportRecord.schoolId)}` : "Not made available"} />
        </div>
      </div>
      <Tabs defaultValue="overview" className="mt-2"><div className="overflow-x-auto pb-1"><TabsList className="inline-flex h-auto min-w-max"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="occupants">Occupants ({occupants.length})</TabsTrigger><TabsTrigger value="trips">Trips</TabsTrigger><TabsTrigger value="maintenance">Maintenance</TabsTrigger><TabsTrigger value="fuel">Fuel</TabsTrigger><TabsTrigger value="compliance">Compliance</TabsTrigger><TabsTrigger value="incidents">Incidents</TabsTrigger><TabsTrigger value="components">Components</TabsTrigger></TabsList></div>
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Detail label="Registration" value={registration} /><Detail label="VIN" value={vehicle.details?.vin || "—"} /><Detail label="Engine Number" value={vehicle.details?.engineNumber || "—"} /><Detail label="Make / Model" value={makeModel} /><Detail label="Manufacture Year" value={vehicle.details?.manufactureYear || "—"} /><Detail label="Colour" value={vehicle.details?.colour || "—"} /><Detail label="Fuel Type" value={vehicle.details?.fuelType || "—"} /><Detail label="Vehicle Class" value={vehicle.details?.vehicleClass || "—"} /><Detail label="Service Interval" value={`${vehicle.serviceIntervalKm || 0} km / ${vehicle.serviceIntervalMonths || 0} months`} /><Detail label="Next Service" value={[vehicle.nextServiceDate, vehicle.nextServiceOdometer != null ? `${vehicle.nextServiceOdometer} km` : null].filter(Boolean).join(" · ") || "—"} /></div>
          <div className="rounded-lg border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">Transport availability</p><p className="mt-1 text-sm text-muted-foreground">Transport vehicles remain independent service records. This FCGS asset only enters Transport when explicitly made available.</p></div>{vehicle.transportVehicleId ? <div className="flex items-center gap-2"><Badge>Available</Badge><Button size="sm" variant="outline" onClick={openTransportVehicleRegister}>View Transport record</Button></div> : canManage ? <Button size="sm" onClick={() => setShowTransportDialog(true)}>Make Available in Transport</Button> : <Badge variant="outline">Not available</Badge>}</div>{transportRecord && <div className="mt-3 grid gap-2 sm:grid-cols-3"><Detail label="Transport school" value={schoolName(transportRecord.schoolId)}/><Detail label="Transport registration" value={transportRecord.registrationNumber}/><Detail label="Transport status"><Status value={transportRecord.status || (transportRecord.isActive ? "active" : "retired")}/></Detail></div>}</div>
          {vehicle.notes && <div className="rounded-lg border p-3 text-sm"><p className="mb-1 font-medium">Notes</p><p className="whitespace-pre-wrap text-muted-foreground">{vehicle.notes}</p></div>}
        </TabsContent>
        <TabsContent value="occupants"><SimpleTable heads={["Occupant", "Type", "Route", "Service", "Pick-up", "Drop-off", "Status"]}>{occupants.map((o) => <TableRow key={o.id}><TableCell>{o.occupantName}</TableCell><TableCell>{title(o.occupantType)}</TableCell><TableCell>{o.routeName || "—"}</TableCell><TableCell>{title(o.serviceType)}</TableCell><TableCell>{o.pickupName}</TableCell><TableCell>{o.dropoffName || "—"}</TableCell><TableCell><Status value={o.isActive ? "active" : "ended"} /></TableCell></TableRow>)}</SimpleTable></TabsContent>
        <TabsContent value="trips"><SimpleTable heads={["Trip", "Destination", "Driver", "Distance", "Status"]}>{trips.map((t) => <TableRow key={t.id}><TableCell>#{t.id} · {t.purpose}</TableCell><TableCell>{t.destination}</TableCell><TableCell>{staffName(t.driverStaffId)}</TableCell><TableCell>{t.distanceKm != null ? `${t.distanceKm} km` : "—"}</TableCell><TableCell><Status value={t.status} /></TableCell></TableRow>)}</SimpleTable></TabsContent>
        <TabsContent value="maintenance"><SimpleTable heads={["Reference", "Issue", "Actual Cost", "Status"]}>{maintenance.map((m) => <TableRow key={m.id}><TableCell>{m.referenceNumber}</TableCell><TableCell>{m.issueDescription}</TableCell><TableCell>${money(m.actualCost)}</TableCell><TableCell><Status value={m.status} /></TableCell></TableRow>)}</SimpleTable></TabsContent>
        <TabsContent value="fuel"><SimpleTable heads={["Date", "Odometer", "Litres", "Total"]}>{fuel.map((f) => <TableRow key={f.id}><TableCell>{f.transactionDate}</TableCell><TableCell>{f.odometerKm} km</TableCell><TableCell>{Number(f.litres || 0).toFixed(2)}</TableCell><TableCell>${money(f.totalCost)}</TableCell></TableRow>)}</SimpleTable></TabsContent>
        <TabsContent value="compliance"><SimpleTable heads={["Document", "Number", "Expiry", "Verification"]}>{compliance.map((d) => <TableRow key={d.id}><TableCell>{title(d.documentType)}</TableCell><TableCell>{d.documentNumber || "—"}</TableCell><TableCell>{d.expiryDate}</TableCell><TableCell><Status value={d.verificationStatus} /></TableCell></TableRow>)}</SimpleTable></TabsContent>
        <TabsContent value="incidents"><SimpleTable heads={["When", "Type", "Description", "Status"]}>{incidents.map((i) => <TableRow key={i.id}><TableCell>{new Date(i.occurredAt).toLocaleString()}</TableCell><TableCell>{title(i.incidentType)}</TableCell><TableCell>{i.description}</TableCell><TableCell><Status value={i.status} /></TableCell></TableRow>)}</SimpleTable></TabsContent>
        <TabsContent value="components"><SimpleTable heads={["Type", "Serial", "Brand / Spec", "Position", "Status"]}>{components.map((c) => <TableRow key={c.id}><TableCell>{title(c.componentType)}</TableCell><TableCell>{c.serialNumber}</TableCell><TableCell>{c.brand || "—"} {c.specification || ""}</TableCell><TableCell>{c.wheelPosition || "—"}</TableCell><TableCell><Status value={c.status} /></TableCell></TableRow>)}</SimpleTable></TabsContent>
      </Tabs>
      <DialogFooter><Button variant="outline" onClick={close}>Close</Button></DialogFooter>
    </DialogContent></Dialog>
    {showTransportDialog && <MakeAvailableInTransportDialog vehicle={vehicle} data={data} busy={busy} close={() => setShowTransportDialog(false)} submit={submit} />}
  </>;
}

function Detail({ label, value, children }: { label: string; value?: ReactNode; children?: ReactNode }) { return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><div className="mt-1 text-sm font-medium">{children ?? value ?? "—"}</div></div>; }

function Metric({ label, value, icon: Icon }: any) { return <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div><Icon className="h-6 w-6 text-muted-foreground" /></CardContent></Card>; }
function Section({ title: heading, children }: { title: string; children: ReactNode }) { return <Card><CardHeader className="pb-3"><CardTitle className="text-base">{heading}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>; }
function SimpleTable({ heads, children }: { heads: string[]; children: ReactNode }) { return <div className="overflow-x-auto"><Table><TableHeader><TableRow>{heads.map((h) => <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>)}</TableRow></TableHeader><TableBody>{children}</TableBody></Table></div>; }
function Status({ value }: { value: any }) { const v = String(value || "unknown"); const variant = ["available","active","approved","completed","valid","verified","pass"].includes(v) ? "default" : ["suspended","expired","critical","rejected","broken_down","accident_damaged"].includes(v) ? "destructive" : "secondary"; return <Badge variant={variant as any}>{title(v)}</Badge>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function NativeSelect({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" {...props}>{children}</select>; }
function StaffSelect({ name, staff, required = false }: { name: string; staff: any[]; required?: boolean }) { return <NativeSelect name={name} required={required} defaultValue=""><option value="">{required ? "Select staff member" : "None"}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} ({s.staffNo})</option>)}</NativeSelect>; }
function VehicleSelect({ name, vehicles, defaultValue = "", required = false, disabled = false }: { name: string; vehicles: any[]; defaultValue?: any; required?: boolean; disabled?: boolean }) { return <Field label="Vehicle"><NativeSelect name={name} defaultValue={defaultValue || ""} required={required} disabled={disabled}><option value="">{required ? "Select vehicle" : "None / keep in stock"}</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.details?.registrationNumber || v.asset?.assetNumber || `Vehicle ${v.id}`} — {v.details?.make || ""} {v.details?.model || v.asset?.name || ""}</option>)}</NativeSelect>{disabled && <input type="hidden" name={name} value={defaultValue} />}</Field>; }
function Check({ name, label, defaultChecked = false }: { name: string; label: string; defaultChecked?: boolean }) { return <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4" />{label}</label>; }
function Checklist() { return <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">Safety checklist — all must pass</p><div className="grid gap-2 sm:grid-cols-2">{[["tyres","Tyres"],["lights","Lights"],["brakes","Brakes"],["mirrors","Mirrors"],["windscreen","Windscreen"],["leaks","No visible leaks"]].map(([name,label]) => <Check key={name} name={name} label={label} defaultChecked />)}</div></div>; }
