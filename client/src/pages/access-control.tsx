import { useMemo, useState, type FormEvent } from "react";
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
import AccessControlOperationsPanel from "@/components/access-control-operations-panel";
import { GateSettingsPanel, GateHealthPanel } from "@/components/gate-health-settings";
import { GateBridgeRemoteUpdateCard, GateBridgeUpdateSettingsCard } from "@/components/gate-bridge-update-controls";
import {
  Activity,
  AlertTriangle,
  Copy,
  Download,
  DoorOpen,
  FileClock,
  KeyRound,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Router,
  Search,
  Server,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Wifi,
} from "lucide-react";

type LanePosition = "entry_lane_1" | "entry_lane_2" | "exit_lane_1" | "exit_lane_2";

type LaneDefinition = {
  value: LanePosition;
  label: string;
  direction: "entry" | "exit";
};

const DEFAULT_LANES: LaneDefinition[] = [
  { value: "entry_lane_1", label: "Entry Lane 1", direction: "entry" },
  { value: "entry_lane_2", label: "Entry Lane 2", direction: "entry" },
  { value: "exit_lane_1", label: "Exit Lane 1", direction: "exit" },
  { value: "exit_lane_2", label: "Exit Lane 2", direction: "exit" },
];

type Bridge = {
  id: number;
  name: string;
  isActive: boolean;
  isOnline: boolean;
  configurationRevision: number;
  lastSyncedRevision: number | null;
  lastConfigSyncAt: string | null;
  configSynchronized: boolean;
  lastHeartbeatAt: string | null;
  lastIpAddress: string | null;
  softwareVersion: string | null;
  lastError: string | null;
  installationId: string | null;
  machineName: string | null;
  pairedAt: string | null;
  lastServiceStartedAt: string | null;
  lastIdentityReconcileAt: string | null;
  callbackMode: "automatic" | "manual";
  callbackHost: string | null;
  callbackPort: number;
  activeCallbackUrl: string | null;
  callbackError: string | null;
  availableCallbackHosts?: Array<{ address: string; interfaceName: string }> | null;
};

type Gate = {
  id: number;
  bridgeId: number;
  name: string;
  description: string | null;
  gateTemplate: string;
  expectedTerminalCount: number;
  isActive: boolean;
  bridgeOnline: boolean;
};

type Device = {
  id: number;
  bridgeId: number;
  gateId: number | null;
  gateName: string | null;
  deviceKey: string;
  name: string;
  lanePosition: LanePosition | null;
  location: string | null;
  direction: "entry" | "exit" | "bidirectional";
  protocol: string;
  localAddress: string | null;
  localPort: number;
  deviceSn: string | null;
  macAddress: string | null;
  isActive: boolean;
  isOnline: boolean;
  bridgeOnline: boolean;
  lastSeenAt: string | null;
  lastConnectionStatus: string;
  lastVersionInfo: Record<string, any> | null;
  lastError: string | null;
};

type Command = {
  id: number;
  deviceId: number;
  commandType: string;
  status: string;
  requestReason: string | null;
  requestedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  result: Record<string, any> | null;
  deviceName: string;
  gateName: string | null;
  bridgeName: string;
  requestedByName: string;
};

type GateLog = {
  id: number;
  bridgeId: number | null;
  gateId: number | null;
  deviceId: number | null;
  severity: "info" | "warning" | "error" | "security";
  sourceType: string;
  eventType: string;
  message: string;
  details: Record<string, any> | null;
  occurredAt: string;
  bridgeName: string | null;
  gateName: string | null;
  deviceName: string | null;
};

type Bootstrap = {
  bridges: Bridge[];
  gates: Gate[];
  devices: Device[];
  commands: Command[];
  laneDefinitions?: LaneDefinition[];
};

type TokenReveal = { bridgeName: string; token: string; message: string } | null;
type GateBridgeRelease = {
  version: string;
  semver: string;
  platform: string;
  ready: boolean;
  expectedAssets: string[];
  assets: Array<{ name: string; size: number; sha256: string }>;
  signing: { requiredBeforeBroadRollout: boolean; configured: boolean; note: string };
};
type WindowsInstallResult = {
  bridge: { id: number; name: string; machineName: string | null; pairedAt: string | null };
  pairingCode: string;
  expiresAt: string;
  portalUrl: string;
  release: GateBridgeRelease;
  installerFileName: string;
  installerContent: string;
  instructions: string;
};
type TerminalDialogState = { device?: Device; gate?: Gate; lane?: LaneDefinition; allowAssignment?: boolean } | null;

type Issue = { key: string; title: string; detail: string; severity: "warning" | "error" };

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function humanize(value: string | null | undefined) {
  return String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function StatusBadge({ status }: { status: string }) {
  const good = ["online", "healthy", "succeeded", "synchronized"].includes(status);
  const bad = ["offline", "failed", "expired", "error"].includes(status);
  return <Badge variant={good ? "default" : bad ? "destructive" : "secondary"}>{humanize(status)}</Badge>;
}

function terminalStatus(device: Device | undefined) {
  if (!device) return "not_configured";
  if (!device.isActive) return "disabled";
  if (!device.bridgeOnline) return "unknown";
  if (device.lastConnectionStatus === "never_seen") return "not_tested";
  if (device.isOnline) return "online";
  if (device.lastConnectionStatus === "offline") return "offline";
  return "unknown";
}

function gateStatus(gate: Gate, devices: Device[]) {
  if (!gate.isActive) return "disabled";
  if (!gate.bridgeOnline) return "offline";
  const assigned = devices.filter((device) => device.gateId === gate.id && device.isActive);
  if (assigned.length < gate.expectedTerminalCount) return "setup_required";
  if (assigned.some((device) => terminalStatus(device) !== "online")) return "attention";
  return "healthy";
}

export default function AccessControlPage() {
  const { currentSchoolId, hasPermission } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState(() => hasPermission("access_control.view") ? "health" : "gates");
  const [bridgeDialogOpen, setBridgeDialogOpen] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installBridgeId, setInstallBridgeId] = useState("");
  const [installPortalUrl, setInstallPortalUrl] = useState("https://portal.firstchoicegroup.co.zw");
  const [installResult, setInstallResult] = useState<WindowsInstallResult | null>(null);
  const [gateDialogOpen, setGateDialogOpen] = useState(false);
  const [gateEditTarget, setGateEditTarget] = useState<Gate | null>(null);
  const [terminalDialog, setTerminalDialog] = useState<TerminalDialogState>(null);
  const [tokenReveal, setTokenReveal] = useState<TokenReveal>(null);
  const [openTarget, setOpenTarget] = useState<Device | null>(null);
  const [rotateTarget, setRotateTarget] = useState<Bridge | null>(null);
  const [callbackTarget, setCallbackTarget] = useState<Bridge | null>(null);
  const [callbackMode, setCallbackMode] = useState<"automatic" | "manual">("automatic");
  const [callbackHost, setCallbackHost] = useState("");
  const [openReason, setOpenReason] = useState("Connection and gate operation test");
  const [logSearch, setLogSearch] = useState("");
  const [logSeverity, setLogSeverity] = useState("all");
  const [logGateId, setLogGateId] = useState("all");
  const [logDeviceId, setLogDeviceId] = useState("all");
  const [logTarget, setLogTarget] = useState<GateLog | null>(null);

  const query = useQuery<Bootstrap>({
    queryKey: ["/api/access-control/bootstrap", currentSchoolId || "school"],
    queryFn: async () => {
      const response = await schoolFetch("/api/access-control/bootstrap");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Failed to load Access Control");
      return payload;
    },
    refetchInterval: 5000,
  });

  const logsQuery = useQuery<{ logs: GateLog[] }>({
    queryKey: ["/api/access-control/logs", currentSchoolId || "school"],
    queryFn: async () => {
      const response = await schoolFetch("/api/access-control/logs?limit=500");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Failed to load Access Control logs");
      return payload;
    },
    enabled: activeTab === "logs" && hasPermission("access_control.audit.view"),
    refetchInterval: activeTab === "logs" ? 5000 : false,
  });

  const releaseQuery = useQuery<GateBridgeRelease>({
    queryKey: ["/api/access-control/gate-bridge-release", currentSchoolId || "school"],
    queryFn: async () => {
      const response = await schoolFetch("/api/access-control/gate-bridge-release");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Failed to load Gate Bridge release information");
      return payload;
    },
    enabled: activeTab === "bridges" && hasPermission("access_control.view"),
    staleTime: 60_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/access-control/bootstrap"] });
    queryClient.invalidateQueries({ queryKey: ["/api/access-control/logs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/access-control/gate-bridge-release"] });
  };

  const bridgeMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await schoolFetch("/api/access-control/bridges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Failed to create Gate Bridge");
      return payload;
    },
    onSuccess: (payload) => {
      setBridgeDialogOpen(false);
      setTokenReveal({ bridgeName: payload.bridge.name, token: payload.token, message: payload.message });
      refresh();
    },
    onError: (error) => toast({ title: "Gate Bridge not created", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
  });

  const rotateMutation = useMutation({
    mutationFn: async (bridge: Bridge) => {
      const response = await schoolFetch(`/api/access-control/bridges/${bridge.id}/rotate-key`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Failed to rotate Gate Bridge token");
      return { bridge, payload };
    },
    onSuccess: ({ bridge, payload }) => {
      setRotateTarget(null);
      setTokenReveal({ bridgeName: bridge.name, token: payload.token, message: payload.message });
      refresh();
    },
    onError: (error) => toast({ title: "Token rotation failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
  });

  const installMutation = useMutation({
    mutationFn: async ({ bridgeId, portalUrl }: { bridgeId: number; portalUrl: string }) => {
      const response = await schoolFetch(`/api/access-control/bridges/${bridgeId}/install-windows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portalUrl: portalUrl.trim() || undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Failed to prepare the Windows Gate Bridge installer");
      return payload as WindowsInstallResult;
    },
    onSuccess: (payload) => {
      setInstallResult(payload);
      const blob = new Blob([payload.installerContent], { type: "application/x-msdos-program;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = payload.installerFileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Windows Gate Bridge installer ready", description: `The one-time installer for ${payload.bridge.name} was downloaded.` });
      refresh();
    },
    onError: (error) => toast({ title: "Installer not prepared", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
  });

  const gateMutation = useMutation({
    mutationFn: async ({ id, body }: { id?: number; body: Record<string, unknown> }) => {
      const response = await schoolFetch(id ? `/api/access-control/gates/${id}` : "/api/access-control/gates", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || `Failed to ${id ? "update" : "create"} Gate`);
      return { id, payload };
    },
    onSuccess: ({ id }) => {
      setGateDialogOpen(false);
      setGateEditTarget(null);
      toast({ title: id ? "Gate updated" : "Gate created", description: id ? "The Gate configuration will synchronize to its Gate Bridge automatically." : "The four standard terminal positions are ready to configure." });
      refresh();
    },
    onError: (error) => toast({ title: "Gate not saved", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
  });

  const terminalMutation = useMutation({
    mutationFn: async ({ deviceId, body, saveAndTest }: { deviceId?: number; body: Record<string, unknown>; saveAndTest: boolean }) => {
      const response = await schoolFetch(deviceId ? `/api/access-control/devices/${deviceId}` : "/api/access-control/devices", {
        method: deviceId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Failed to save face terminal");
      const savedDevice: Device = payload.device;
      let testError: string | null = null;
      if (saveAndTest) {
        const testResponse = await schoolFetch(`/api/access-control/devices/${savedDevice.id}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const testPayload = await testResponse.json().catch(() => ({}));
        if (!testResponse.ok) testError = testPayload?.message || "Connection test could not be queued";
      }
      return { savedDevice, saveAndTest, testError };
    },
    onSuccess: ({ savedDevice, saveAndTest, testError }) => {
      setTerminalDialog(null);
      if (testError) {
        toast({ title: "Terminal saved; test not queued", description: testError, variant: "destructive" });
      } else {
        toast({ title: "Terminal saved", description: saveAndTest ? `${savedDevice.name} was saved and its connection test was queued.` : "The Gate Bridge will receive this configuration automatically." });
      }
      refresh();
    },
    onError: (error) => toast({ title: "Terminal not saved", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
  });

  const commandMutation = useMutation({
    mutationFn: async ({ device, type, reason }: { device: Device; type: "open" | "test"; reason?: string }) => {
      const response = await schoolFetch(`/api/access-control/devices/${device.id}/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(type === "open" ? { reason } : {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || `Failed to ${type === "open" ? "open gate" : "test terminal"}`);
      return { device, type, commandId: Number(payload?.command?.id || 0) };
    },
    onSuccess: async ({ device, type, commandId }) => {
      if (type === "open") {
        setOpenTarget(null);
        toast({ title: "Opening requested", description: `Waiting for ${device.name} to acknowledge the urgent request (15-second start deadline).` });
        if (commandId > 0) {
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            try {
              const response = await schoolFetch(`/api/access-control/commands/${commandId}/status`);
              if (!response.ok) break;
              const status = await response.json();
              if (["succeeded", "failed", "expired", "uncertain"].includes(status.status)) {
                toast({ title: status.status === "succeeded" ? "Terminal accepted opening" : "Gate opening not confirmed",
                  description: status.status === "succeeded" ? `${device.name} acknowledged the opening command (physical gate feedback is not available).` : status.errorMessage || `Opening ${status.status}.`,
                  variant: status.status === "succeeded" ? "default" : "destructive" });
                refresh();
                return;
              }
            } catch { break; }
          }
          toast({ title: "Opening acknowledgement pending", description: "Check Command History; the terminal may still be completing an operation. No automatic retry was sent." });
        }
      } else {
        toast({ title: "Connection test queued", description: `FCGS is asking ${device.name} for identity/version information.` });
      }
      refresh();
    },
    onError: (error) => toast({ title: "Gate command not sent", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
  });

  const testGateMutation = useMutation({
    mutationFn: async (gate: Gate) => {
      const response = await schoolFetch(`/api/access-control/gates/${gate.id}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Failed to test Gate terminals");
      return { gate, payload };
    },
    onSuccess: ({ gate, payload }) => {
      toast({ title: `Testing ${gate.name}`, description: `${payload.queued.length} connection test(s) queued${payload.skipped.length ? `; ${payload.skipped.length} already in progress` : ""}.` });
      refresh();
    },
    onError: (error) => toast({ title: "Gate test not started", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
  });

  const data = query.data || { bridges: [], gates: [], devices: [], commands: [], laneDefinitions: DEFAULT_LANES };
  const lanes = data.laneDefinitions?.length ? data.laneDefinitions : DEFAULT_LANES;
  const callbackMutation = useMutation({
    mutationFn: async () => {
      if (!callbackTarget) throw new Error("Select a Bridge");
      const response = await schoolFetch(`/api/access-control/bridges/${callbackTarget.id}/callback`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callbackMode, callbackHost: callbackMode === "manual" ? callbackHost : null, callbackPort: 9191 }) });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.message || "Could not update callback address"); }
      return response.json();
    },
    onSuccess: () => { setCallbackTarget(null); queryClient.invalidateQueries({ queryKey: ["/api/access-control/bootstrap"] }); toast({ title: "Callback configuration saved", description: "The Bridge will apply the address to its terminals and report the outcome." }); },
    onError: (e) => toast({ title: "Callback configuration not saved", description: String(e), variant: "destructive" }),
  });

  const bridgeById = useMemo(() => new Map(data.bridges.map((bridge) => [bridge.id, bridge])), [data.bridges]);
  const gateById = useMemo(() => new Map(data.gates.map((gate) => [gate.id, gate])), [data.gates]);
  const devicesByGate = useMemo(() => {
    const map = new Map<number, Device[]>();
    for (const device of data.devices) {
      if (!device.gateId) continue;
      const list = map.get(device.gateId) || [];
      list.push(device);
      map.set(device.gateId, list);
    }
    return map;
  }, [data.devices]);

  const onlineBridges = data.bridges.filter((bridge) => bridge.isOnline).length;
  const onlineDevices = data.devices.filter((device) => device.isOnline).length;
  const healthyGates = data.gates.filter((gate) => gateStatus(gate, data.devices) === "healthy").length;
  const pendingCommands = data.commands.filter((command) => ["pending", "processing"].includes(command.status)).length;
  const unassignedDevices = data.devices.filter((device) => !device.gateId);

  const issues = useMemo<Issue[]>(() => {
    const next: Issue[] = [];
    for (const bridge of data.bridges) {
      if (bridge.isActive && !bridge.isOnline) next.push({ key: `bridge-${bridge.id}`, title: `${bridge.name} is offline`, detail: `Last heartbeat: ${formatTime(bridge.lastHeartbeatAt)}. Terminals behind this bridge are shown as unknown rather than falsely reported offline.`, severity: "error" });
      else if (bridge.isOnline && !bridge.configSynchronized) next.push({ key: `bridge-config-${bridge.id}`, title: `${bridge.name} has a configuration update pending`, detail: `Portal revision ${bridge.configurationRevision}; bridge reported revision ${bridge.lastSyncedRevision ?? "none"}.`, severity: "warning" });
    }
    for (const gate of data.gates) {
      const gateDevices = devicesByGate.get(gate.id) || [];
      const configured = gateDevices.filter((device) => device.isActive).length;
      if (configured < gate.expectedTerminalCount) next.push({ key: `gate-setup-${gate.id}`, title: `${gate.name} setup is incomplete`, detail: `${configured}/${gate.expectedTerminalCount} standard terminal positions are configured.`, severity: "warning" });
      if (gate.bridgeOnline) {
        for (const device of gateDevices.filter((row) => row.isActive)) {
          if (terminalStatus(device) === "offline") next.push({ key: `device-${device.id}`, title: `${gate.name} · ${device.name} is offline`, detail: `${device.localAddress || "No IP"}:${device.localPort} · ${device.lastError || `Last successful contact ${formatTime(device.lastSeenAt)}`}`, severity: "error" });
        }
      }
    }
    if (unassignedDevices.length) next.push({ key: "legacy-unassigned", title: `${unassignedDevices.length} existing terminal(s) need Gate assignment`, detail: "These terminals were registered before Gate grouping was introduced. Assign them to one of the four physical lane positions; they do not need to be recreated.", severity: "warning" });
    return next;
  }, [data.bridges, data.gates, devicesByGate, unassignedDevices.length]);

  const filteredLogs = useMemo(() => {
    const needle = logSearch.trim().toLowerCase();
    return (logsQuery.data?.logs || []).filter((row) => {
      if (logSeverity !== "all" && row.severity !== logSeverity) return false;
      if (logGateId !== "all" && String(row.gateId || "") !== logGateId) return false;
      if (logDeviceId !== "all" && String(row.deviceId || "") !== logDeviceId) return false;
      if (!needle) return true;
      return [row.message, row.eventType, row.bridgeName, row.gateName, row.deviceName, row.sourceType].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [logsQuery.data, logSearch, logSeverity, logGateId, logDeviceId]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Copied" });
    } catch {
      toast({ title: "Copy failed", description: "Select and copy the value manually.", variant: "destructive" });
    }
  };

  if (query.isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading Access Control…</div>;
  if (query.isError) return <div className="rounded-lg border border-destructive/30 p-6 text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Failed to load Access Control"}</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Access Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">Physical Gates, their four face terminals, Gate Bridges, commands and diagnostic logs. FCGS owns terminal IP/port configuration; credentials stay local to the bridge.</p>
        </div>
        <Button variant="outline" onClick={() => refresh()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={DoorOpen} label="Gates" value={`${healthyGates}/${data.gates.length}`} detail="healthy" />
        <Metric icon={Wifi} label="Face Terminals" value={`${onlineDevices}/${data.devices.length}`} detail="online" />
        <Metric icon={Server} label="Gate Bridges" value={`${onlineBridges}/${data.bridges.length}`} detail="online" />
        <Metric icon={ShieldAlert} label="Issues" value={String(issues.length)} detail={pendingCommands ? `${pendingCommands} command(s) pending` : "requiring attention"} />
      </div>

      {issues.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" />Access Control attention</CardTitle><CardDescription>Problems are separated by their real source so a bridge outage does not falsely look like four failed terminals.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {issues.slice(0, 8).map((issue) => <div key={issue.key} className={`rounded-md border p-3 text-sm ${issue.severity === "error" ? "border-destructive/30 bg-destructive/5" : "bg-muted/30"}`}><div className="font-medium">{issue.title}</div><div className="mt-1 text-xs text-muted-foreground">{issue.detail}</div></div>)}
            {issues.length > 8 && <div className="text-xs text-muted-foreground">+ {issues.length - 8} additional issue(s). Review the Gate cards below.</div>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Connection path</CardTitle><CardDescription>Terminal port 9090 remains private on the school LAN.</CardDescription></CardHeader>
        <CardContent><div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">FCGS Portal</Badge><span>→ HTTPS →</span><Badge variant="outline">School Gate Bridge</Badge><span>→ LAN →</span><Badge variant="outline">Entry / Exit Lane Terminal :9090</Badge><span>→ Open Gate Signal →</span><Badge variant="outline">Turnstile Controller</Badge></div></CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto w-max min-w-full justify-start gap-1 p-1 md:min-w-0">
            <TabsTrigger value="health" className="min-h-10 shrink-0">Terminal Health & Sync</TabsTrigger>
            <TabsTrigger value="people" className="min-h-10 shrink-0">People & Access</TabsTrigger>
            <TabsTrigger value="gates" className="min-h-10 shrink-0">Gates</TabsTrigger>
            <TabsTrigger value="bridges" className="min-h-10 shrink-0">Gate Bridges</TabsTrigger>
            <TabsTrigger value="history" className="min-h-10 shrink-0">Command History</TabsTrigger>
            <TabsTrigger value="logs" className="min-h-10 shrink-0" disabled={!hasPermission("access_control.audit.view")}>Logs</TabsTrigger>
            <TabsTrigger value="settings" className="min-h-10 shrink-0">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="health"><GateHealthPanel devices={data.devices} bridges={data.bridges} /></TabsContent>
        <TabsContent value="settings" className="space-y-4"><GateSettingsPanel canEdit={hasPermission("access_control.manage_devices")} />{data.bridges.map(bridge => <GateBridgeUpdateSettingsCard key={bridge.id} bridge={bridge} />)}</TabsContent>
        <TabsContent value="gates" className="space-y-4">
          <div className="flex justify-end">{hasPermission("access_control.manage_devices") && <Button onClick={() => setGateDialogOpen(true)} disabled={!data.bridges.length}><Plus className="mr-2 h-4 w-4" />Add Gate</Button>}</div>
          {!data.bridges.length && <SetupCallout text="Create a Gate Bridge first. It is the local service on the school network that securely connects FCGS to every Gate and terminal assigned to it." />}
          {!data.gates.length ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No physical Gates are configured for this school yet.</CardContent></Card> : (
            <div className="space-y-4">
              {data.gates.map((gate) => {
                const bridge = bridgeById.get(gate.bridgeId);
                const gateDevices = devicesByGate.get(gate.id) || [];
                const status = gateStatus(gate, data.devices);
                const onlineCount = gateDevices.filter((device) => terminalStatus(device) === "online").length;
                return (
                  <Card key={gate.id}>
                    <CardHeader className="pb-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div><CardTitle className="flex items-center gap-2 text-lg"><DoorOpen className="h-5 w-5" />{gate.name}</CardTitle><CardDescription>{gate.description || "Standard four-terminal Gate"} · {bridge?.name || "Bridge unavailable"}</CardDescription></div>
                        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={status} /><Badge variant="outline">{onlineCount}/{gate.expectedTerminalCount} online</Badge></div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {!gate.bridgeOnline && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><div className="font-medium">Gate Bridge offline</div><div className="mt-1 text-xs text-muted-foreground">Terminal states below are marked Unknown because FCGS cannot currently ask the school network whether they are reachable.</div></div>}
                      <div className="overflow-x-auto rounded-md border">
                        <Table>
                          <TableHeader><TableRow><TableHead>Physical Position</TableHead><TableHead>Network</TableHead><TableHead>Identity</TableHead><TableHead>Status</TableHead><TableHead>Last Contact</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {lanes.map((lane) => {
                              const device = gateDevices.find((row) => row.lanePosition === lane.value);
                              const status = terminalStatus(device);
                              const version = device?.lastVersionInfo || {};
                              return (
                                <TableRow key={lane.value}>
                                  <TableCell><div className="font-semibold">{lane.label}</div><div className="text-xs text-muted-foreground">{humanize(lane.direction)} terminal</div></TableCell>
                                  <TableCell>{device ? <><div className="font-mono text-xs">{device.localAddress ? `${device.localAddress}:${device.localPort}` : "No IP configured"}</div><div className="mt-1 text-xs text-muted-foreground">HTTP</div></> : <span className="text-sm text-muted-foreground">Not configured</span>}</TableCell>
                                  <TableCell>{device ? <><div className="text-xs">SN: {device.deviceSn || String(version.cpuserial || "Not learned")}</div><div className="mt-1 text-xs text-muted-foreground">MAC: {device.macAddress || String(version.macaddr || "Not learned")}</div></> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                                  <TableCell><StatusBadge status={status} />{device?.lastError && status === "offline" && <div className="mt-1 max-w-[260px] text-xs text-destructive">{device.lastError}</div>}</TableCell>
                                  <TableCell className="whitespace-nowrap text-xs">{device ? formatTime(device.lastSeenAt) : "—"}</TableCell>
                                  <TableCell>
                                    <div className="flex justify-end gap-2">
                                      {hasPermission("access_control.manage_devices") && <Button size="sm" variant="outline" onClick={() => setTerminalDialog({ device, gate, lane })}><Pencil className="mr-1 h-3.5 w-3.5" />{device ? "Edit" : "Configure"}</Button>}
                                      {device && hasPermission("access_control.control_gates") && <Button size="sm" variant="outline" onClick={() => commandMutation.mutate({ device, type: "test" })} disabled={!device.bridgeOnline || !device.isActive || commandMutation.isPending}><Network className="mr-1 h-3.5 w-3.5" />Test</Button>}
                                      {device && hasPermission("access_control.control_gates") && <Button size="sm" onClick={() => { setOpenReason("Connection and gate operation test"); setOpenTarget(device); }} disabled={!device.bridgeOnline || !device.isActive || commandMutation.isPending}><DoorOpen className="mr-1 h-3.5 w-3.5" />Open</Button>}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">Gate template: Entry Lane 1 · Entry Lane 2 · Exit Lane 1 · Exit Lane 2</div>
                        <div className="flex gap-2">
                          {hasPermission("access_control.manage_devices") && <Button size="sm" variant="outline" onClick={() => setGateEditTarget(gate)}><Settings2 className="mr-2 h-4 w-4" />Edit Gate</Button>}
                          {hasPermission("access_control.control_gates") && <Button size="sm" variant="outline" onClick={() => testGateMutation.mutate(gate)} disabled={!gate.bridgeOnline || testGateMutation.isPending}><Network className="mr-2 h-4 w-4" />Test All Terminals</Button>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {unassignedDevices.length > 0 && (
            <Card className="border-amber-500/40">
              <CardHeader><CardTitle className="text-base">Existing terminals awaiting Gate assignment</CardTitle><CardDescription>These are preserved from the earlier Access Control model. Assign each one to the correct physical position rather than recreating it.</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Existing Terminal</TableHead><TableHead>Address</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{unassignedDevices.map((device) => <TableRow key={device.id}><TableCell><div className="font-medium">{device.name}</div><div className="text-xs text-muted-foreground font-mono">{device.deviceKey}</div></TableCell><TableCell className="font-mono text-xs">{device.localAddress ? `${device.localAddress}:${device.localPort}` : "No address"}</TableCell><TableCell><StatusBadge status={terminalStatus(device)} /></TableCell><TableCell className="text-right"><Button size="sm" onClick={() => setTerminalDialog({ device, allowAssignment: true })}>Assign to Gate</Button></TableCell></TableRow>)}</TableBody></Table></CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="bridges" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {hasPermission("access_control.manage_devices") && (
              <>
                <Button variant="outline" onClick={() => setBridgeDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Create Gate Bridge</Button>
                <Button onClick={() => {
                  setInstallResult(null);
                  setInstallBridgeId(data.bridges[0] ? String(data.bridges[0].id) : "");
                  setInstallPortalUrl("https://portal.firstchoicegroup.co.zw");
                  setInstallDialogOpen(true);
                }} disabled={!data.bridges.length || releaseQuery.data?.ready === false}>
                  <Download className="mr-2 h-4 w-4" />Install Windows Gate Bridge Service
                </Button>
              </>
            )}
          </div>
          <SetupCallout text="The Gate Bridge is the production Windows Service on the school's always-on mini-PC/computer. FCGS supplies Gate/lane/IP/port configuration automatically; terminal administrator credentials stay encrypted on that computer." />
          {releaseQuery.data && !releaseQuery.data.ready && (
            <Card className="border-destructive/40"><CardContent className="py-4 text-sm"><div className="font-medium text-destructive">Windows Gate Bridge release is not ready</div><div className="mt-1 text-xs text-muted-foreground">The server is missing one or more Windows runtime/deployment assets. Installation is disabled until the release package is prepared.</div></CardContent></Card>
          )}
          {releaseQuery.data?.ready && releaseQuery.data.signing.requiredBeforeBroadRollout && !releaseQuery.data.signing.configured && (
            <Card className="border-amber-500/40"><CardContent className="py-4 text-sm"><div className="font-medium">Pilot release ready · code signing still required before broad rollout</div><div className="mt-1 text-xs text-muted-foreground">{releaseQuery.data.signing.note}</div></CardContent></Card>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            {data.bridges.map((bridge) => {
              const assignedGates = data.gates.filter((gate) => gate.bridgeId === bridge.id).length;
              const assignedDevices = data.devices.filter((device) => device.bridgeId === bridge.id).length;
              const updateAvailable = !!releaseQuery.data?.version && !!bridge.softwareVersion && bridge.softwareVersion !== releaseQuery.data.version;
              return <Card key={bridge.id}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Router className="h-4 w-4" />{bridge.name}</CardTitle><CardDescription>{bridge.softwareVersion || "Bridge has not connected yet"}{updateAvailable ? " · update available" : ""}</CardDescription></div><StatusBadge status={bridge.isOnline ? "online" : "offline"} /></div></CardHeader><CardContent className="space-y-4 text-sm"><div className="grid gap-3 sm:grid-cols-2"><Info label="Paired Windows PC" value={bridge.machineName || "Not paired through installer"} /><Info label="Paired at" value={formatTime(bridge.pairedAt)} /><Info label="Service started" value={formatTime(bridge.lastServiceStartedAt)} /><Info label="Last heartbeat" value={formatTime(bridge.lastHeartbeatAt)} /><Info label="Last public IP" value={bridge.lastIpAddress || "—"} /><Info label="Release" value={releaseQuery.data ? `${bridge.softwareVersion || "Not reported"} / ${releaseQuery.data.version}` : bridge.softwareVersion || "Not reported"} /><Info label="Assigned Gates" value={String(assignedGates)} /><Info label="Assigned terminals" value={String(assignedDevices)} /><Info label="Configuration" value={bridge.configSynchronized ? "Synchronized" : bridge.isOnline ? "Update pending" : "Unknown while offline"} /><Info label="Last config sync" value={formatTime(bridge.lastConfigSyncAt)} /><Info label="Last identity reconciliation" value={formatTime(bridge.lastIdentityReconcileAt)} /><Info label="Active recognition callback" value={bridge.activeCallbackUrl || "Awaiting Bridge report"} /><Info label="Detected addresses" value={(bridge.availableCallbackHosts || []).map((a) => `${a.interfaceName}: ${a.address}`).join(" · ") || "Awaiting Bridge report"} /><Info label="Installation ID" value={bridge.installationId || "—"} /></div><div className="rounded-md border bg-muted/30 p-3 text-xs"><div className="font-medium">Configuration revision</div><div className="mt-1 text-muted-foreground">Portal: {bridge.configurationRevision} · Bridge: {bridge.lastSyncedRevision ?? "not reported"}</div></div>{bridge.lastError && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{bridge.lastError}</div>}{hasPermission("access_control.manage_devices") && <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => { setInstallResult(null); setInstallBridgeId(String(bridge.id)); setInstallPortalUrl("https://portal.firstchoicegroup.co.zw"); setInstallDialogOpen(true); }} disabled={releaseQuery.data?.ready === false}><Download className="mr-2 h-4 w-4" />{bridge.pairedAt ? "Reinstall / Re-pair Service" : "Install Windows Service"}</Button><Button size="sm" variant="outline" onClick={() => { setCallbackTarget(bridge); setCallbackMode(bridge.callbackMode || "automatic"); setCallbackHost(bridge.callbackHost || ""); }}>Configure Callback</Button><Button size="sm" variant="outline" onClick={() => setRotateTarget(bridge)} disabled={rotateMutation.isPending}><KeyRound className="mr-2 h-4 w-4" />Rotate Bridge Token</Button></div>}<GateBridgeRemoteUpdateCard bridge={bridge} /></CardContent></Card>;
            })}
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card><CardHeader><CardTitle className="text-base">Recent gate commands</CardTitle><CardDescription>Manual opens and tests are successful only after the local Gate Bridge confirms that the target terminal accepted the command.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Gate / Terminal</TableHead><TableHead>Command</TableHead><TableHead>Requested By</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead>Result</TableHead></TableRow></TableHeader><TableBody>{data.commands.length ? data.commands.map((command) => <TableRow key={command.id}><TableCell className="whitespace-nowrap">{formatTime(command.requestedAt)}</TableCell><TableCell><div className="font-medium">{command.gateName ? `${command.gateName} · ` : ""}{command.deviceName}</div><div className="text-xs text-muted-foreground">{command.bridgeName}</div></TableCell><TableCell>{command.commandType === "open_gate" ? "Open Gate" : command.commandType === "get_version" ? "Connection Test" : humanize(command.commandType)}</TableCell><TableCell>{command.requestedByName}</TableCell><TableCell className="max-w-[260px] whitespace-normal">{command.requestReason || "—"}</TableCell><TableCell><StatusBadge status={command.status} /></TableCell><TableCell className="max-w-[300px] whitespace-normal text-xs">{command.errorMessage || (command.status === "succeeded" ? "Acknowledged by Gate Bridge" : "—")}</TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No gate commands have been sent yet.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
        </TabsContent>

        <TabsContent value="people" className="space-y-4">
          <AccessControlOperationsPanel />
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileClock className="h-4 w-4" />Access Control logs</CardTitle><CardDescription>Operational and security-relevant events from the portal, Gate Bridges and terminals. Routine successful polling is intentionally not stored as noise.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><div className="space-y-2"><Label>Search</Label><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={logSearch} onChange={(e) => setLogSearch(e.target.value)} placeholder="Event, Gate, terminal…" className="pl-9" /></div></div><div className="space-y-2"><Label>Severity</Label><Select value={logSeverity} onValueChange={setLogSeverity}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All severities</SelectItem><SelectItem value="info">Info</SelectItem><SelectItem value="warning">Warning</SelectItem><SelectItem value="error">Error</SelectItem><SelectItem value="security">Security</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Gate</Label><Select value={logGateId} onValueChange={(value) => { setLogGateId(value); setLogDeviceId("all"); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Gates</SelectItem>{data.gates.map((gate) => <SelectItem key={gate.id} value={String(gate.id)}>{gate.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Terminal</Label><Select value={logDeviceId} onValueChange={setLogDeviceId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All terminals</SelectItem>{data.devices.filter((device) => logGateId === "all" || String(device.gateId || "") === logGateId).map((device) => <SelectItem key={device.id} value={String(device.id)}>{device.gateName ? `${device.gateName} · ` : ""}{device.name}</SelectItem>)}</SelectContent></Select></div></div>{logsQuery.isLoading ? <div className="py-8 text-center text-sm text-muted-foreground">Loading logs…</div> : logsQuery.isError ? <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">{logsQuery.error instanceof Error ? logsQuery.error.message : "Failed to load logs"}</div> : <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Severity</TableHead><TableHead>Source</TableHead><TableHead>Event</TableHead><TableHead>Message</TableHead><TableHead className="text-right">Details</TableHead></TableRow></TableHeader><TableBody>{filteredLogs.length ? filteredLogs.map((row) => <TableRow key={row.id}><TableCell className="whitespace-nowrap text-xs">{formatTime(row.occurredAt)}</TableCell><TableCell><StatusBadge status={row.severity} /></TableCell><TableCell><div className="text-sm font-medium">{row.deviceName || row.gateName || row.bridgeName || humanize(row.sourceType)}</div>{row.deviceName && <div className="text-xs text-muted-foreground">{row.gateName || row.bridgeName || ""}</div>}</TableCell><TableCell className="text-xs">{humanize(row.eventType.replaceAll(".", "_"))}</TableCell><TableCell className="min-w-[320px] text-sm">{row.message}</TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => setLogTarget(row)}>View</Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No logs match these filters.</TableCell></TableRow>}</TableBody></Table></div>}</CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!callbackTarget} onOpenChange={(open) => { if (!open) setCallbackTarget(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Recognition Callback Address</DialogTitle><DialogDescription>Configure the address advertised to facial terminals. This does not change the Windows network interface or listener port.</DialogDescription></DialogHeader>
          <div className="space-y-4"><div className="space-y-2"><Label>Address selection</Label><Select value={callbackMode} onValueChange={(v) => setCallbackMode(v as "automatic" | "manual")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="automatic">Automatic detection</SelectItem><SelectItem value="manual">Manual IP address</SelectItem></SelectContent></Select></div>
          {callbackMode === "manual" && <div className="space-y-2"><Label htmlFor="callback-ip">Bridge IPv4 address</Label><Input id="callback-ip" value={callbackHost} onChange={(e) => setCallbackHost(e.target.value)} placeholder="192.168.1.x" />{(callbackTarget?.availableCallbackHosts || []).length > 0 && <div className="flex flex-wrap gap-2">{(callbackTarget?.availableCallbackHosts || []).map((a) => <Button key={`${a.interfaceName}:${a.address}`} variant="outline" size="sm" onClick={() => setCallbackHost(a.address)}>{a.interfaceName}: {a.address}</Button>)}</div>}</div>}
          <div className="text-sm text-muted-foreground">Recognition listener port: 9191 (managed by Windows Bridge installation). Ensure the address is reachable by all terminals.</div></div>
          <DialogFooter><Button variant="outline" onClick={() => setCallbackTarget(null)}>Cancel</Button><Button onClick={() => callbackMutation.mutate()} disabled={callbackMutation.isPending}>{callbackMutation.isPending ? "Saving…" : "Save Configuration"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={installDialogOpen} onOpenChange={(open) => { setInstallDialogOpen(open); if (!open) setInstallResult(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Install Windows Gate Bridge Service</DialogTitle>
            <DialogDescription>Prepare a one-time installer for the always-on Windows mini-PC. Reinstalling an already paired Bridge replaces its machine credential cleanly; it does not create another Bridge.</DialogDescription>
          </DialogHeader>
          {!installResult ? (
            <div className="space-y-4">
              <div className="space-y-2"><Label>Gate Bridge</Label><Select value={installBridgeId} onValueChange={setInstallBridgeId}><SelectTrigger><SelectValue placeholder="Select Gate Bridge" /></SelectTrigger><SelectContent>{data.bridges.map((bridge) => <SelectItem key={bridge.id} value={String(bridge.id)}>{bridge.name}{bridge.machineName ? ` · ${bridge.machineName}` : ""}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="gate-bridge-portal-url">Portal URL <span className="text-muted-foreground">(advanced)</span></Label><Input id="gate-bridge-portal-url" value={installPortalUrl} onChange={(event) => setInstallPortalUrl(event.target.value)} /><p className="text-xs text-muted-foreground">Production is the default. Only change this for an explicitly approved development/test deployment; non-local custom URLs must use HTTPS.</p></div>
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">The installer downloads the verified runtime, prompts locally for the face-terminal administrator credentials, stores secrets with Windows machine-scope encryption, installs automatic service recovery, and creates the LAN-only recognition callback firewall rule.</div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-4"><div className="text-sm font-medium">{installResult.bridge.name}</div><div className="mt-1 text-xs text-muted-foreground">{installResult.instructions}</div></div>
              <div className="grid gap-3 sm:grid-cols-2"><Info label="One-time pairing code" value={installResult.pairingCode} /><Info label="Expires" value={formatTime(installResult.expiresAt)} /><Info label="Release" value={installResult.release.version} /><Info label="Portal" value={installResult.portalUrl} /></div>
              <div className="rounded-md border border-amber-500/40 p-3 text-xs">Run the downloaded <strong>.cmd</strong> file on the intended Gate Bridge computer as Administrator before this pairing code expires. Generating another installer for this Bridge invalidates any earlier unused pairing code. Use the most recently downloaded installer before its pairing code expires.</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallDialogOpen(false)}>{installResult ? "Close" : "Cancel"}</Button>
            {!installResult && <Button disabled={!installBridgeId || installMutation.isPending || releaseQuery.data?.ready === false} onClick={() => installMutation.mutate({ bridgeId: Number(installBridgeId), portalUrl: installPortalUrl })}><Download className="mr-2 h-4 w-4" />{installMutation.isPending ? "Preparing…" : "Prepare & Download Installer"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BridgeDialog open={bridgeDialogOpen} onOpenChange={setBridgeDialogOpen} pending={bridgeMutation.isPending} onSubmit={(name) => bridgeMutation.mutate(name)} />
      <GateDialog open={gateDialogOpen || !!gateEditTarget} onOpenChange={(open) => { if (!open) { setGateDialogOpen(false); setGateEditTarget(null); } }} bridges={data.bridges} gate={gateEditTarget} pending={gateMutation.isPending} onSubmit={(body) => gateMutation.mutate({ id: gateEditTarget?.id, body })} />
      <TerminalDialog open={!!terminalDialog} onOpenChange={(open) => !open && setTerminalDialog(null)} state={terminalDialog} gates={data.gates} lanes={lanes} pending={terminalMutation.isPending} onSubmit={(deviceId, body, saveAndTest) => terminalMutation.mutate({ deviceId, body, saveAndTest })} />

      <Dialog open={!!openTarget} onOpenChange={(open) => !open && setOpenTarget(null)}><DialogContent><DialogHeader><DialogTitle>Open {openTarget?.gateName ? `${openTarget.gateName} · ` : ""}{openTarget?.name}?</DialogTitle><DialogDescription>This performs a real physical gate-open command. Enter the reason so the action is traceable in Command History and Logs.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="gate-open-reason">Reason</Label><Textarea id="gate-open-reason" value={openReason} onChange={(e) => setOpenReason(e.target.value)} className="min-h-[90px]" /></div><DialogFooter><Button variant="outline" onClick={() => setOpenTarget(null)}>Cancel</Button><Button onClick={() => openTarget && commandMutation.mutate({ device: openTarget, type: "open", reason: openReason })} disabled={openReason.trim().length < 3 || commandMutation.isPending}><DoorOpen className="mr-2 h-4 w-4" />{commandMutation.isPending ? "Sending…" : "Open Gate"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!rotateTarget} onOpenChange={(open) => !open && setRotateTarget(null)}><DialogContent><DialogHeader><DialogTitle>Rotate Gate Bridge token?</DialogTitle><DialogDescription>The existing token will stop working immediately. Only rotate it if you are ready to update that school Gate Bridge.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setRotateTarget(null)}>Cancel</Button><Button variant="destructive" onClick={() => rotateTarget && rotateMutation.mutate(rotateTarget)} disabled={rotateMutation.isPending}>{rotateMutation.isPending ? "Rotating…" : "Rotate Token"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!tokenReveal} onOpenChange={(open) => !open && setTokenReveal(null)}><DialogContent><DialogHeader><DialogTitle>Save Gate Bridge token</DialogTitle><DialogDescription>{tokenReveal?.message}</DialogDescription></DialogHeader><div className="space-y-3"><Label>{tokenReveal?.bridgeName}</Label><div className="flex gap-2"><Input value={tokenReveal?.token || ""} readOnly className="font-mono text-xs" /><Button type="button" variant="outline" size="icon" onClick={() => tokenReveal && copy(tokenReveal.token)}><Copy className="h-4 w-4" /></Button></div><div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">This token authenticates the school Gate Bridge. Terminal IP addresses no longer belong in the local bridge configuration; FCGS supplies them automatically.</div></div><DialogFooter><Button onClick={() => setTokenReveal(null)}>I have saved it</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!logTarget} onOpenChange={(open) => !open && setLogTarget(null)}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{logTarget ? humanize(logTarget.eventType.replaceAll(".", "_")) : "Log details"}</DialogTitle><DialogDescription>{logTarget ? formatTime(logTarget.occurredAt) : ""}</DialogDescription></DialogHeader>{logTarget && <div className="space-y-4 text-sm"><div className="grid gap-3 sm:grid-cols-2"><Info label="Severity" value={humanize(logTarget.severity)} /><Info label="Source" value={logTarget.deviceName || logTarget.gateName || logTarget.bridgeName || humanize(logTarget.sourceType)} /><Info label="Gate" value={logTarget.gateName || "—"} /><Info label="Terminal" value={logTarget.deviceName || "—"} /></div><div><div className="text-xs text-muted-foreground">Message</div><div className="mt-1 rounded-md border bg-muted/20 p-3">{logTarget.message}</div></div><div><div className="text-xs text-muted-foreground">Technical details</div><pre className="mt-1 max-h-[280px] overflow-auto rounded-md border bg-muted/20 p-3 text-xs">{JSON.stringify(logTarget.details || {}, null, 2)}</pre></div></div>}<DialogFooter><Button onClick={() => setLogTarget(null)}>Close</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: any; label: string; value: string; detail: string }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-md bg-muted p-2"><Icon className="h-5 w-5" /></div><div><div className="text-xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label} · {detail}</div></div></CardContent></Card>;
}

function Info({ label, value, mono, onCopy }: { label: string; value: string; mono?: boolean; onCopy?: () => void }) {
  return <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-0.5 flex min-w-0 items-center gap-1 font-medium ${mono ? "font-mono text-xs" : ""}`}><span className="truncate" title={value}>{value}</span>{onCopy && <button type="button" className="shrink-0 rounded p-1 hover:bg-muted" onClick={onCopy} aria-label={`Copy ${label}`}><Copy className="h-3.5 w-3.5" /></button>}</div></div>;
}

function SetupCallout({ text }: { text: string }) {
  return <div className="flex gap-3 rounded-lg border bg-muted/30 p-4 text-sm"><Server className="mt-0.5 h-4 w-4 shrink-0" /><div><div className="font-medium">Gate Bridge setup</div><div className="mt-1 text-muted-foreground">{text}</div></div></div>;
}

function BridgeDialog({ open, onOpenChange, pending, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; onSubmit: (name: string) => void }) {
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit(String(form.get("name") || "").trim()); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Create Gate Bridge</DialogTitle><DialogDescription>Create one bridge for this school/campus network. One bridge can manage several Gates and many terminals on the same LAN.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="bridge-name">Bridge name</Label><Input id="bridge-name" name="name" required minLength={2} placeholder="Prospect Gate Bridge" /></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create Bridge"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function GateDialog({ open, onOpenChange, bridges, gate, pending, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; bridges: Bridge[]; gate: Gate | null; pending: boolean; onSubmit: (body: Record<string, unknown>) => void }) {
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit(gate ? { name: String(form.get("name") || "").trim(), description: String(form.get("description") || "").trim() || null, isActive: String(form.get("isActive") || "true") === "true" } : { bridgeId: Number(form.get("bridgeId")), name: String(form.get("name") || "").trim(), description: String(form.get("description") || "").trim() || null }); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl"><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>{gate ? `Edit ${gate.name}` : "Add Gate"}</DialogTitle><DialogDescription>Each standard Gate has exactly four named physical terminal positions: Entry Lane 1, Entry Lane 2, Exit Lane 1 and Exit Lane 2.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">{!gate && <div className="space-y-2 sm:col-span-2"><Label>Gate Bridge</Label><Select name="bridgeId" required><SelectTrigger><SelectValue placeholder="Select bridge" /></SelectTrigger><SelectContent>{bridges.filter((b) => b.isActive).map((bridge) => <SelectItem key={bridge.id} value={String(bridge.id)}>{bridge.name}</SelectItem>)}</SelectContent></Select></div>}<div className="space-y-2 sm:col-span-2"><Label htmlFor="gate-name">Gate name</Label><Input id="gate-name" name="name" required minLength={2} defaultValue={gate?.name || ""} placeholder="Main Gate" /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="gate-description">Description / location</Label><Input id="gate-description" name="description" defaultValue={gate?.description || ""} placeholder="Front entrance" /></div>{gate && <div className="space-y-2 sm:col-span-2"><Label>Status</Label><Select name="isActive" defaultValue={gate.isActive ? "true" : "false"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">Active</SelectItem><SelectItem value="false">Disabled</SelectItem></SelectContent></Select></div>}</div><div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">The Gate Bridge assignment is fixed after Gate creation in this phase. Terminal IP changes and lane configuration are handled directly from the Gate card.</div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save Gate"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function TerminalDialog({ open, onOpenChange, state, gates, lanes, pending, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; state: TerminalDialogState; gates: Gate[]; lanes: LaneDefinition[]; pending: boolean; onSubmit: (deviceId: number | undefined, body: Record<string, unknown>, saveAndTest: boolean) => void }) {
  if (!state) return null;
  const device = state.device;
  const lockedGate = state.gate;
  const lockedLane = state.lane;
  const allowAssignment = !!state.allowAssignment;
  const defaultGateId = lockedGate?.id || device?.gateId || undefined;
  const defaultLane = lockedLane?.value || device?.lanePosition || undefined;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as any)?.submitter as HTMLButtonElement | undefined;
    const saveAndTest = submitter?.value === "save_test";
    onSubmit(device?.id, {
      gateId: Number(form.get("gateId")),
      lanePosition: String(form.get("lanePosition")),
      protocol: "http",
      localAddress: String(form.get("localAddress") || "").trim(),
      localPort: Number(form.get("localPort") || 9090),
      isActive: String(form.get("isActive") || "true") === "true",
    }, saveAndTest);
  };
  const version = device?.lastVersionInfo || {};
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-2xl"><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>{device ? "Edit Face Terminal" : `Configure ${lockedLane?.label || "Face Terminal"}`}</DialogTitle><DialogDescription>FCGS is the source of truth for Gate, physical lane, IP and port. Saving an IP change does not require editing the Gate Bridge environment file or restarting it.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">{allowAssignment ? <><div className="space-y-2"><Label>Gate</Label><Select name="gateId" required defaultValue={defaultGateId ? String(defaultGateId) : undefined}><SelectTrigger><SelectValue placeholder="Select Gate" /></SelectTrigger><SelectContent>{gates.filter((g) => g.isActive).map((gate) => <SelectItem key={gate.id} value={String(gate.id)}>{gate.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Physical position</Label><Select name="lanePosition" required defaultValue={defaultLane}><SelectTrigger><SelectValue placeholder="Select position" /></SelectTrigger><SelectContent>{lanes.map((lane) => <SelectItem key={lane.value} value={lane.value}>{lane.label}</SelectItem>)}</SelectContent></Select></div></> : <><input type="hidden" name="gateId" value={String(defaultGateId || "")} /><input type="hidden" name="lanePosition" value={String(defaultLane || "")} /><Info label="Gate" value={lockedGate?.name || device?.gateName || "—"} /><Info label="Physical position" value={lockedLane?.label || device?.name || "—"} /></>}<div className="space-y-2"><Label htmlFor="terminal-ip">IP address</Label><Input id="terminal-ip" name="localAddress" required defaultValue={device?.localAddress || ""} placeholder="192.168.1.51" /></div><div className="space-y-2"><Label htmlFor="terminal-port">HTTP port</Label><Input id="terminal-port" name="localPort" type="number" min={1} max={65535} defaultValue={device?.localPort || 9090} /></div><div className="space-y-2"><Label>Status</Label><Select name="isActive" defaultValue={device?.isActive === false ? "false" : "true"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">Active</SelectItem><SelectItem value="false">Disabled</SelectItem></SelectContent></Select></div><Info label="Protocol" value="HTTP" />{device && <><Info label="Device Key" value={device.deviceKey} mono /><Info label="Serial number" value={device.deviceSn || String(version.cpuserial || "Learned automatically after successful test")} /><Info label="MAC address" value={device.macAddress || String(version.macaddr || "Learned automatically after successful test")} /><Info label="Last successful contact" value={formatTime(device.lastSeenAt)} /></>}</div>{device?.lastError && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"><div className="font-medium">Last connection error</div><div className="mt-1">{device.lastError}</div></div>}<div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">Terminal username/password remain local to the school Gate Bridge. The bridge automatically downloads this IP/port configuration from FCGS every few seconds.</div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" value="save" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save"}</Button><Button type="submit" value="save_test" disabled={pending}><Network className="mr-2 h-4 w-4" />{pending ? "Saving…" : "Save & Test"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
