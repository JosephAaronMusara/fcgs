import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, schoolFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

type GateSettings = { reconciliationEnabled: boolean; reconciliationTime: string; timezone: string };
export function GateSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const query = useQuery<GateSettings>({ queryKey: ["/api/access-control/settings"], queryFn: async () => {
    const response = await schoolFetch("/api/access-control/settings");
    if (!response.ok) throw new Error("Could not load Access Control settings");
    return response.json();
  } });
  const [enabled, setEnabled] = useState(true);
  const [time, setTime] = useState("23:00");
  useEffect(() => { if (query.data) { setEnabled(query.data.reconciliationEnabled); setTime(query.data.reconciliationTime); } }, [query.data]);
  const save = useMutation({ mutationFn: async () => {
    const response = await schoolFetch("/api/access-control/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reconciliationEnabled: enabled, reconciliationTime: time }) });
    if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.message || "Could not save settings"); }
    return response.json();
  }, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/access-control/settings"] }); toast({ title: "Reconciliation schedule saved" }); }, onError: (e) => toast({ title: "Settings not saved", description: String(e), variant: "destructive" }) });
  return <Card><CardHeader><CardTitle>Access Control Settings</CardTitle><CardDescription>Daily full reconciliation verifies known identities without unnecessarily replacing enrolled faces. Live changes remain prioritised throughout the day.</CardDescription></CardHeader><CardContent className="max-w-xl space-y-5">
    {query.isError && <p className="text-sm text-destructive">Could not load settings.</p>}
    <div className="flex items-center justify-between gap-4 rounded-md border p-3"><div><Label htmlFor="gate-nightly-enabled">Nightly reconciliation</Label><div className="text-xs text-muted-foreground">One job per school per day. No overlapping jobs.</div></div><Switch id="gate-nightly-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} /></div>
    <div className="space-y-2"><Label htmlFor="gate-nightly-time">Reconciliation time (Africa/Harare)</Label><Input id="gate-nightly-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!canEdit || !enabled} /></div>
    <div className="flex items-center justify-between"><Badge variant="outline">Timezone: Africa/Harare</Badge>{canEdit && <Button onClick={() => save.mutate()} disabled={save.isPending || query.isLoading}>{save.isPending ? "Saving…" : "Save Settings"}</Button>}</div>
  </CardContent></Card>;
}

export type GateHealthData = {
  identities: { total: number; eligible: number; missing_photo: number };
  commandCounts: Array<{ device_id: number; status: string; count: number; oldest: string | null }>;
  identitySync: Array<{ device_id: number; sync_status: string; count: number }>;
  verificationCounts: Array<{ device_id: number; verification_status: string; count: number }>;
  eventCounts: Array<{ device_id: number; latest: string | null; total: number }>;
  verification: string;
};
export function GateHealthPanel({ devices, bridges }: { devices: Array<{ id: number; name: string; isOnline: boolean; lastConnectionStatus: string }>; bridges: Array<{ id: number; name: string; isOnline: boolean; callbackError?: string | null }> }) {
  const query = useQuery<GateHealthData>({ queryKey: ["/api/access-control/health"], queryFn: async () => {
    const response = await schoolFetch("/api/access-control/health");
    if (!response.ok) throw new Error("Could not load Gate health");
    return response.json();
  }, refetchInterval: 15_000 });
  const data = query.data;
  const sum = (deviceId: number, key: string, value: string, source: "commandCounts" | "identitySync") =>
    (data?.[source] || []).filter((row: any) => row.device_id === deviceId && row[key] === value).reduce((n, row: any) => n + Number(row.count || 0), 0);
  return <div className="space-y-4">
    {query.isError && <div className="text-destructive">Health reporting unavailable. Check the API and database migration.</div>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card><CardHeader className="pb-2"><CardDescription>Online terminals</CardDescription><CardTitle>{devices.filter((d) => d.isOnline).length} / {devices.length}</CardTitle></CardHeader></Card>
      <Card><CardHeader className="pb-2"><CardDescription>Active identities with photo references</CardDescription><CardTitle>{data?.identities.eligible ?? "—"}</CardTitle></CardHeader></Card>
      <Card><CardHeader className="pb-2"><CardDescription>Active identities without photos</CardDescription><CardTitle>{data?.identities.missing_photo ?? "—"}</CardTitle></CardHeader></Card>
      <Card><CardHeader className="pb-2"><CardDescription>Bridge health</CardDescription><CardTitle>{bridges.filter((b) => b.isOnline).length} / {bridges.length}</CardTitle></CardHeader></Card>
    </div>
    <p className="text-xs text-muted-foreground">Terminal status counts below reflect Portal command acknowledgements, not independently verified device inventory. Unknown is never treated as zero.</p>
    {bridges.filter((b) => b.callbackError).map((b) => <Card key={b.id} className="border-destructive/40"><CardContent className="pt-4 text-sm text-destructive">{b.name}: {b.callbackError}</CardContent></Card>)}
    <div className="grid gap-3 md:grid-cols-2">{devices.map((d) => {
      const event = data?.eventCounts.find((row) => row.device_id === d.id);
      const pending = sum(d.id, "status", "pending", "commandCounts");
      const active = sum(d.id, "status", "processing", "commandCounts");
      const failures = sum(d.id, "status", "failed", "commandCounts") + sum(d.id, "status", "uncertain", "commandCounts");
      const synced = sum(d.id, "sync_status", "synced", "identitySync");
      const verified = (data?.verificationCounts || []).filter((row) => row.device_id === d.id && row.verification_status === "verified").reduce((n, row) => n + Number(row.count), 0);
      const mismatches = (data?.verificationCounts || []).filter((row) => row.device_id === d.id && ["mismatch", "error"].includes(row.verification_status)).reduce((n, row) => n + Number(row.count), 0);
      const pendingIdentity = sum(d.id, "sync_status", "pending", "identitySync") + sum(d.id, "sync_status", "retry_pending", "identitySync");
      const oldestPending = (data?.commandCounts || []).find((row) => row.device_id === d.id && row.status === "pending")?.oldest;
      const lastVerified = (data?.verificationCounts || []).some((row) => row.device_id === d.id && row.verification_status === "verified");
      return <Card key={d.id}><CardHeader><div className="flex items-center justify-between"><CardTitle className="text-base">{d.name}</CardTitle><Badge variant={d.isOnline ? "default" : "destructive"}>{d.isOnline ? "Online" : "Not confirmed online"}</Badge></div></CardHeader><CardContent className="grid gap-2 text-sm sm:grid-cols-2">
        <div>Portal synced: <strong>{synced}</strong></div><div>Read-verified: <strong>{verified}</strong></div><div>Verification issues: <strong>{mismatches}</strong></div><div>Identity pending/retry: <strong>{pendingIdentity}</strong></div>
        <div>Commands pending: <strong>{pending}</strong></div><div>Commands executing: <strong>{active}</strong></div>
        <div>Failed/uncertain commands: <strong>{failures}</strong></div><div>Recorded recognitions: <strong>{event?.total ?? "—"}</strong></div>
        <div className="sm:col-span-2 text-xs text-muted-foreground">Oldest pending command: {oldestPending ? new Date(oldestPending).toLocaleString() : "None known"}</div>
        <div className="sm:col-span-2 text-xs text-muted-foreground">Identity read-back verification: {lastVerified ? "Some identities verified" : "Not yet verified"}</div>
        <div className="sm:col-span-2 text-xs text-muted-foreground">Last recognition recorded: {event?.latest ? new Date(event.latest).toLocaleString() : "Unknown"}</div>
      </CardContent></Card>;
    })}</div>
  </div>;
}
