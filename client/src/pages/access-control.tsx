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
import {
  Activity,
  CheckCircle2,
  CircleOff,
  Copy,
  DoorOpen,
  KeyRound,
  Network,
  Plus,
  RefreshCw,
  Router,
  Server,
  ShieldCheck,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";

type Bridge = {
  id: number;
  name: string;
  isActive: boolean;
  isOnline: boolean;
  lastHeartbeatAt: string | null;
  lastIpAddress: string | null;
  softwareVersion: string | null;
  lastError: string | null;
};

type Device = {
  id: number;
  bridgeId: number;
  deviceKey: string;
  name: string;
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
  bridgeName: string;
  requestedByName: string;
};

type Bootstrap = {
  bridges: Bridge[];
  devices: Device[];
  commands: Command[];
};

type TokenReveal = { bridgeName: string; token: string; message: string } | null;
type OpenTarget = Device | null;

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function humanize(value: string | null | undefined) {
  return String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function StatusBadge({ status }: { status: string }) {
  const good = ["online", "succeeded"].includes(status);
  const bad = ["offline", "failed", "expired"].includes(status);
  return <Badge variant={good ? "default" : bad ? "destructive" : "secondary"}>{humanize(status)}</Badge>;
}

export default function AccessControlPage() {
  const { currentSchoolId, hasPermission } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("devices");
  const [bridgeDialogOpen, setBridgeDialogOpen] = useState(false);
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [tokenReveal, setTokenReveal] = useState<TokenReveal>(null);
  const [openTarget, setOpenTarget] = useState<OpenTarget>(null);
  const [rotateTarget, setRotateTarget] = useState<Bridge | null>(null);
  const [openReason, setOpenReason] = useState("Connection and gate operation test");

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

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/access-control/bootstrap"] });

  const bridgeMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await schoolFetch("/api/access-control/bridges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
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

  const deviceMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const response = await schoolFetch("/api/access-control/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Failed to register gate device");
      return payload;
    },
    onSuccess: () => {
      setDeviceDialogOpen(false);
      toast({ title: "Gate device registered", description: "Add its Device Key to the local Gate Bridge configuration before testing." });
      refresh();
    },
    onError: (error) => toast({ title: "Device not registered", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
  });

  const commandMutation = useMutation({
    mutationFn: async ({ device, type, reason }: { device: Device; type: "open" | "test"; reason?: string }) => {
      const response = await schoolFetch(`/api/access-control/devices/${device.id}/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(type === "open" ? { reason } : {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || `Failed to ${type === "open" ? "open gate" : "test device"}`);
      return { device, type, payload };
    },
    onSuccess: ({ device, type }) => {
      if (type === "open") {
        setOpenTarget(null);
        toast({ title: "Open command sent", description: `${device.name} must acknowledge the command through its Gate Bridge before it is recorded as successful.` });
      } else {
        toast({ title: "Connection test queued", description: `FCGS is asking ${device.name} for its version information.` });
      }
      refresh();
    },
    onError: (error) => toast({ title: "Gate command not sent", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
  });

  const data = query.data || { bridges: [], devices: [], commands: [] };
  const onlineBridges = data.bridges.filter((bridge) => bridge.isOnline).length;
  const onlineDevices = data.devices.filter((device) => device.isOnline).length;
  const pendingCommands = data.commands.filter((command) => ["pending", "processing"].includes(command.status)).length;
  const bridgeById = useMemo(() => new Map(data.bridges.map((bridge) => [bridge.id, bridge])), [data.bridges]);

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
          <p className="mt-1 text-sm text-muted-foreground">Gate Bridges and face-recognition terminals. Manual opening is audited and commands expire quickly if a bridge is unavailable.</p>
        </div>
        <Button variant="outline" onClick={() => refresh()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Server} label="Gate Bridges" value={`${onlineBridges}/${data.bridges.length}`} detail="online" />
        <Metric icon={Wifi} label="Face Terminals" value={`${onlineDevices}/${data.devices.length}`} detail="online" />
        <Metric icon={Activity} label="Commands" value={String(pendingCommands)} detail="pending / processing" />
        <Metric icon={ShieldCheck} label="Control Mode" value="Manual" detail="fees enforcement not enabled" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Connection path</CardTitle>
          <CardDescription>Nothing on port 9090 is exposed to the public Internet.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">FCGS Portal</Badge><span>→ HTTPS →</span><Badge variant="outline">Gate Bridge</Badge><span>→ School LAN →</span><Badge variant="outline">Face Terminal :9090</Badge><span>→ Open Gate Signal →</span><Badge variant="outline">Turnstile Controller</Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 md:w-[480px]">
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="bridges">Gate Bridges</TabsTrigger>
          <TabsTrigger value="history">Command History</TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="space-y-4">
          <div className="flex justify-end">
            {hasPermission("access_control.manage_devices") && <Button onClick={() => setDeviceDialogOpen(true)} disabled={!data.bridges.length}><Plus className="mr-2 h-4 w-4" />Register Face Terminal</Button>}
          </div>
          {!data.bridges.length && <SetupCallout text="Create a Gate Bridge first. The bridge is the local service that securely connects FCGS to terminals on the school LAN." />}
          {!data.devices.length ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No face-recognition terminals are registered for this school yet.</CardContent></Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {data.devices.map((device) => {
                const bridge = bridgeById.get(device.bridgeId);
                const version = device.lastVersionInfo || {};
                return (
                  <Card key={device.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <CardTitle className="flex items-center gap-2 text-base"><DoorOpen className="h-4 w-4" />{device.name}</CardTitle>
                          <CardDescription>{device.location || humanize(device.direction)} · {bridge?.name || "Bridge unavailable"}</CardDescription>
                        </div>
                        <StatusBadge status={device.isOnline ? "online" : device.lastConnectionStatus || "offline"} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-2 text-sm sm:grid-cols-2">
                        <Info label="Device Key" value={device.deviceKey} mono onCopy={() => copy(device.deviceKey)} />
                        <Info label="Local address" value={device.localAddress ? `${device.localAddress}:${device.localPort}` : "Stored on bridge only"} />
                        <Info label="Direction" value={humanize(device.direction)} />
                        <Info label="Protocol" value={device.protocol.toUpperCase()} />
                        <Info label="Serial number" value={device.deviceSn || String(version.cpuserial || "—")} />
                        <Info label="App / system version" value={String(version.appver || version.sysver || "Not queried yet")} />
                        <Info label="Last terminal contact" value={formatTime(device.lastSeenAt)} />
                        <Info label="Bridge status" value={device.bridgeOnline ? "Online" : "Offline"} />
                      </div>
                      {device.lastError && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{device.lastError}</div>}
                      <div className="flex flex-wrap gap-2">
                        {hasPermission("access_control.control_gates") && (
                          <>
                            <Button variant="outline" onClick={() => commandMutation.mutate({ device, type: "test" })} disabled={!device.bridgeOnline || commandMutation.isPending}>
                              <Network className="mr-2 h-4 w-4" />Test Connection
                            </Button>
                            <Button onClick={() => { setOpenReason("Connection and gate operation test"); setOpenTarget(device); }} disabled={!device.bridgeOnline || commandMutation.isPending}>
                              <DoorOpen className="mr-2 h-4 w-4" />Open Gate
                            </Button>
                          </>
                        )}
                      </div>
                      {!device.bridgeOnline && <p className="text-xs text-muted-foreground">Manual gate commands are disabled while the Gate Bridge is offline; FCGS will not queue a stale opening command for later execution.</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="bridges" className="space-y-4">
          <div className="flex justify-end">
            {hasPermission("access_control.manage_devices") && <Button onClick={() => setBridgeDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Create Gate Bridge</Button>}
          </div>
          <SetupCallout text="The Gate Bridge is a lightweight service on an always-on computer at the school. Its credential is shown once; terminal admin passwords remain only on that local computer." />
          <div className="grid gap-4 xl:grid-cols-2">
            {data.bridges.map((bridge) => (
              <Card key={bridge.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div><CardTitle className="flex items-center gap-2 text-base"><Router className="h-4 w-4" />{bridge.name}</CardTitle><CardDescription>{bridge.softwareVersion || "Bridge has not connected yet"}</CardDescription></div>
                    <StatusBadge status={bridge.isOnline ? "online" : "offline"} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <Info label="Last heartbeat" value={formatTime(bridge.lastHeartbeatAt)} />
                  <Info label="Last public IP" value={bridge.lastIpAddress || "—"} />
                  {bridge.lastError && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{bridge.lastError}</div>}
                  {hasPermission("access_control.manage_devices") && <Button size="sm" variant="outline" onClick={() => setRotateTarget(bridge)} disabled={rotateMutation.isPending}><KeyRound className="mr-2 h-4 w-4" />Rotate Bridge Token</Button>}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent gate commands</CardTitle><CardDescription>“Open” is recorded as successful only after the local bridge confirms that the face terminal accepted the command.</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Device</TableHead><TableHead>Command</TableHead><TableHead>Requested By</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.commands.length ? data.commands.map((command) => (
                    <TableRow key={command.id}>
                      <TableCell className="whitespace-nowrap">{formatTime(command.requestedAt)}</TableCell>
                      <TableCell><div className="font-medium">{command.deviceName}</div><div className="text-xs text-muted-foreground">{command.bridgeName}</div></TableCell>
                      <TableCell>{command.commandType === "open_gate" ? "Open Gate" : "Connection Test"}</TableCell>
                      <TableCell>{command.requestedByName}</TableCell>
                      <TableCell className="max-w-[260px] whitespace-normal">{command.requestReason || "—"}</TableCell>
                      <TableCell><StatusBadge status={command.status} /></TableCell>
                      <TableCell className="max-w-[300px] whitespace-normal text-xs">{command.errorMessage || (command.status === "succeeded" ? "Acknowledged by Gate Bridge" : "—")}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No gate commands have been sent yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <BridgeDialog open={bridgeDialogOpen} onOpenChange={setBridgeDialogOpen} pending={bridgeMutation.isPending} onSubmit={(name) => bridgeMutation.mutate(name)} />
      <DeviceDialog open={deviceDialogOpen} onOpenChange={setDeviceDialogOpen} bridges={data.bridges} pending={deviceMutation.isPending} onSubmit={(body) => deviceMutation.mutate(body)} />

      <Dialog open={!!openTarget} onOpenChange={(open) => !open && setOpenTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Open {openTarget?.name}?</DialogTitle><DialogDescription>This performs a real physical gate-open command. Enter the reason so the action is traceable.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label htmlFor="gate-open-reason">Reason</Label><Textarea id="gate-open-reason" value={openReason} onChange={(e) => setOpenReason(e.target.value)} className="min-h-[90px]" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenTarget(null)}>Cancel</Button><Button onClick={() => openTarget && commandMutation.mutate({ device: openTarget, type: "open", reason: openReason })} disabled={openReason.trim().length < 3 || commandMutation.isPending}><DoorOpen className="mr-2 h-4 w-4" />{commandMutation.isPending ? "Sending…" : "Open Gate"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rotateTarget} onOpenChange={(open) => !open && setRotateTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rotate Gate Bridge token?</DialogTitle><DialogDescription>The existing token will stop working immediately. Only rotate it if you are ready to update the local Gate Bridge configuration.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setRotateTarget(null)}>Cancel</Button><Button variant="destructive" onClick={() => rotateTarget && rotateMutation.mutate(rotateTarget)} disabled={rotateMutation.isPending}>{rotateMutation.isPending ? "Rotating…" : "Rotate Token"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!tokenReveal} onOpenChange={(open) => !open && setTokenReveal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save Gate Bridge token</DialogTitle><DialogDescription>{tokenReveal?.message}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Label>{tokenReveal?.bridgeName}</Label>
            <div className="flex gap-2"><Input value={tokenReveal?.token || ""} readOnly className="font-mono text-xs" /><Button type="button" variant="outline" size="icon" onClick={() => tokenReveal && copy(tokenReveal.token)}><Copy className="h-4 w-4" /></Button></div>
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">Put this value in <code>FCGS_GATE_BRIDGE_TOKEN</code> on the school Gate Bridge. FCGS stores only a one-way hash of it.</div>
          </div>
          <DialogFooter><Button onClick={() => setTokenReveal(null)}>I have saved it</Button></DialogFooter>
        </DialogContent>
      </Dialog>
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
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit(String(form.get("name") || "").trim());
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Create Gate Bridge</DialogTitle><DialogDescription>Create one bridge for this school/campus network. A one-time credential will be generated.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="bridge-name">Bridge name</Label><Input id="bridge-name" name="name" required minLength={2} placeholder="Main Campus Gate Bridge" /></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create Bridge"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function DeviceDialog({ open, onOpenChange, bridges, pending, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; bridges: Bridge[]; pending: boolean; onSubmit: (body: Record<string, unknown>) => void }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      bridgeId: Number(form.get("bridgeId")),
      name: String(form.get("name") || "").trim(),
      location: String(form.get("location") || "").trim() || null,
      direction: String(form.get("direction") || "entry"),
      protocol: "http",
      localAddress: String(form.get("localAddress") || "").trim() || null,
      localPort: Number(form.get("localPort") || 9090),
      deviceSn: String(form.get("deviceSn") || "").trim() || null,
      macAddress: String(form.get("macAddress") || "").trim() || null,
    });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl"><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>Register Face Terminal</DialogTitle><DialogDescription>FCGS stores identification and status data. The terminal admin password remains only in the local Gate Bridge configuration.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Gate Bridge</Label><Select name="bridgeId" required><SelectTrigger><SelectValue placeholder="Select bridge" /></SelectTrigger><SelectContent>{bridges.filter((b) => b.isActive).map((bridge) => <SelectItem key={bridge.id} value={String(bridge.id)}>{bridge.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="device-name">Device name</Label><Input id="device-name" name="name" required minLength={2} placeholder="Main Gate Entry" /></div><div className="space-y-2"><Label htmlFor="device-location">Location</Label><Input id="device-location" name="location" placeholder="Front entrance" /></div><div className="space-y-2"><Label>Direction</Label><Select name="direction" defaultValue="entry"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="entry">Entry</SelectItem><SelectItem value="exit">Exit</SelectItem><SelectItem value="bidirectional">Bidirectional</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="device-ip">Local IP (reference)</Label><Input id="device-ip" name="localAddress" placeholder="192.168.1.50" /></div><div className="space-y-2"><Label htmlFor="device-port">HTTP port</Label><Input id="device-port" name="localPort" type="number" min={1} max={65535} defaultValue={9090} /></div><div className="space-y-2"><Label htmlFor="device-sn">Device serial</Label><Input id="device-sn" name="deviceSn" placeholder="Optional" /></div><div className="space-y-2"><Label htmlFor="device-mac">MAC address</Label><Input id="device-mac" name="macAddress" placeholder="Optional" /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Registering…" : "Register Device"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
