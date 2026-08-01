import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { schoolFetch, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Download, FileCheck2, FileUp, History, Link2, ShieldCheck } from "lucide-react";

const titleCase = (value: unknown) => String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

type Props = {
  entityType: "owner" | "driver" | "vehicle";
  entityId: number;
  canManageDocuments: boolean;
  canManageCompliance: boolean;
};

export default function TransportRecordDetails({ entityType, entityId, canManageDocuments, canManageCompliance }: Props) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [categoryCode, setCategoryCode] = useState("other");
  const [expiryDate, setExpiryDate] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideExpiry, setOverrideExpiry] = useState("");

  const recordQuery = useQuery<any>({
    queryKey: ["/api/transport/records", entityType, entityId],
    queryFn: async () => {
      const response = await schoolFetch(`/api/transport/records/${entityType}/${entityId}`);
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Unable to load Transport record");
      return response.json();
    },
  });
  const documentsQuery = useQuery<any>({
    queryKey: ["/api/transport/documents", entityType, entityId],
    queryFn: async () => {
      const response = await schoolFetch(`/api/transport/${entityType}/${entityId}/documents`);
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Unable to load documents");
      return response.json();
    },
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/transport/records", entityType, entityId] }),
      queryClient.invalidateQueries({ queryKey: ["/api/transport/documents", entityType, entityId] }),
      queryClient.invalidateQueries({ queryKey: ["/api/transport/bootstrap"] }),
    ]);
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Select a file");
      const form = new FormData();
      form.append("file", file);
      form.append("categoryCode", categoryCode);
      if (expiryDate) form.append("expiryDate", expiryDate);
      const response = await schoolFetch(`/api/transport/${entityType}/${entityId}/documents`, { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Upload failed");
      return response.json();
    },
    onSuccess: async () => {
      setFile(null); setExpiryDate("");
      await refresh();
      toast({ title: "Document uploaded" });
    },
    onError: (error: Error) => toast({ title: "Upload failed", description: error.message, variant: "destructive" }),
  });

  const archive = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await schoolFetch(`/api/transport/documents/${documentId}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Unable to archive document");
      return response.json();
    },
    onSuccess: refresh,
  });

  const override = useMutation({
    mutationFn: async () => {
      const response = await schoolFetch(`/api/transport/${entityType}/${entityId}/compliance-overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: overrideReason, expiresAt: overrideExpiry ? new Date(`${overrideExpiry}T23:59:59`).toISOString() : null }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Unable to create override");
      return response.json();
    },
    onSuccess: async () => { setOverrideReason(""); setOverrideExpiry(""); await refresh(); toast({ title: "Compliance override recorded" }); },
    onError: (error: Error) => toast({ title: "Override failed", description: error.message, variant: "destructive" }),
  });

  const payload = recordQuery.data;
  const record = payload?.record || {};
  const documentPayload = documentsQuery.data || { requirements: [], documents: [], compliance: null };
  const activeDocuments = useMemo(() => (documentPayload.documents || []).filter((item: any) => item.isActive), [documentPayload.documents]);
  const relationships = payload?.relationships || {};
  const historyRows = [
    ...(Array.isArray(relationships.ownerHistory) ? relationships.ownerHistory : []),
    ...(Array.isArray(relationships.driverHistory) ? relationships.driverHistory : []),
    ...(Array.isArray(relationships.vehicleHistory) ? relationships.vehicleHistory : []),
  ];
  const incidents = Array.isArray(relationships.incidents) ? relationships.incidents : [];
  const relationshipEntries = Object.entries(relationships).filter(([key]) => ![
    "ownerHistory", "driverHistory", "vehicleHistory", "incidents",
  ].includes(key));

  const openDocument = async (documentId: number) => {
    const openedWindow = window.open("about:blank", "_blank", "noopener");
    try {
      const response = await schoolFetch(`/api/transport/documents/${documentId}?inline=1`);
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Unable to open document");
      const objectUrl = URL.createObjectURL(await response.blob());
      if (openedWindow) openedWindow.location.href = objectUrl;
      else window.open(objectUrl, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      openedWindow?.close();
      toast({ title: "Document unavailable", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  if (recordQuery.isLoading) return <div className="py-10 text-center text-sm text-muted-foreground">Loading complete Transport record…</div>;
  if (recordQuery.error) return <div className="py-10 text-center text-sm text-destructive">{(recordQuery.error as Error).message}</div>;

  return <Tabs defaultValue="overview" className="space-y-4">
    <div className="overflow-x-auto"><TabsList className="w-max"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="relationships">Relationships</TabsTrigger><TabsTrigger value="documents">Documents & Images</TabsTrigger><TabsTrigger value="compliance">Compliance</TabsTrigger><TabsTrigger value="history">History</TabsTrigger><TabsTrigger value="incidents">Incidents</TabsTrigger></TabsList></div>

    <TabsContent value="overview"><Card><CardHeader><CardTitle className="flex items-center gap-2">{entityType === "vehicle" ? record.registrationNumber : entityType === "driver" ? `${record.firstName} ${record.lastName}` : record.name}{record.isStaffOwner && <Badge>Staff Owner</Badge>}</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">
      {Object.entries(record).filter(([key]) => !["id", "schoolId", "createdAt", "updatedAt", "notes"].includes(key)).map(([key, value]) => <div key={key} className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{titleCase(key)}</div><div className="break-words text-sm font-medium">{value == null || value === "" ? "—" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}</div></div>)}
      {record.notes && <div className="md:col-span-2 rounded-md border p-3"><div className="text-xs text-muted-foreground">Notes</div><div className="whitespace-pre-wrap text-sm">{record.notes}</div></div>}
    </CardContent></Card></TabsContent>

    <TabsContent value="relationships"><div className="grid gap-4 lg:grid-cols-2">
      {relationshipEntries.map(([key, rows]) => <Card key={key}><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4"/>{titleCase(key)}</CardTitle></CardHeader><CardContent className="space-y-2">{Array.isArray(rows) && rows.length ? rows.map((row: any, index: number) => <div key={row.id || index} className="rounded-md border p-3 text-sm">{row.registrationNumber || row.name || `${row.firstName || ""} ${row.lastName || ""}`.trim() || `Record ${row.id}`}{row.status && <Badge variant="outline" className="ml-2">{titleCase(row.status)}</Badge>}</div>) : <div className="text-sm text-muted-foreground">No linked records.</div>}</CardContent></Card>)}
    </div></TabsContent>

    <TabsContent value="documents"><Card><CardHeader><CardTitle className="flex items-center gap-2"><FileCheck2 className="h-5 w-5"/>Document checklist</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(documentPayload.requirements || []).map((requirement: any) => { const present = activeDocuments.some((document: any) => document.categoryCode === requirement.categoryCode); return <div key={requirement.id} className="flex items-center justify-between rounded-md border p-3"><div><div className="text-sm font-medium">{requirement.label}</div><div className="text-xs text-muted-foreground">{requirement.isRequired ? "Required" : "Optional"}{requirement.tracksExpiry ? " · Tracks expiry" : ""}</div></div><Badge variant={present ? "default" : requirement.isRequired ? "destructive" : "secondary"}>{present ? "Uploaded" : "Missing"}</Badge></div>; })}</div>
      {canManageDocuments && <div className="grid gap-3 rounded-md border p-4 md:grid-cols-4"><div className="space-y-2"><Label>Category</Label><Select value={categoryCode} onValueChange={setCategoryCode}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{(documentPayload.requirements || []).map((item: any) => <SelectItem key={item.categoryCode} value={item.categoryCode}>{item.label}</SelectItem>)}<SelectItem value="other">Other</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Expiry date</Label><Input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)}/></div><div className="space-y-2 md:col-span-2"><Label>Attachment</Label><div className="flex gap-2"><Input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)}/><Button disabled={!file || upload.isPending} onClick={() => upload.mutate()}><FileUp className="mr-2 h-4 w-4"/>{upload.isPending ? "Uploading…" : "Upload"}</Button></div></div></div>}
      <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead>File</TableHead><TableHead>Expiry</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{(documentPayload.documents || []).map((document: any) => <TableRow key={document.id}><TableCell>{titleCase(document.categoryCode)}</TableCell><TableCell>{document.originalName}</TableCell><TableCell>{document.expiryDate || "—"}</TableCell><TableCell><Badge variant={document.isActive ? "default" : "secondary"}>{document.isActive ? "Active" : "Archived"}</Badge></TableCell><TableCell><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => void openDocument(document.id)}><Download className="mr-1 h-3.5 w-3.5"/>Open</Button>{document.isActive && canManageDocuments && <Button size="sm" variant="ghost" onClick={() => archive.mutate(document.id)}>Archive</Button>}</div></TableCell></TableRow>)}</TableBody></Table></div>
    </CardContent></Card></TabsContent>

    <TabsContent value="compliance"><Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5"/>Compliance status <Badge variant={["expired", "missing"].includes(documentPayload.compliance?.status) ? "destructive" : "secondary"}>{titleCase(documentPayload.compliance?.status)}</Badge></CardTitle></CardHeader><CardContent className="space-y-4">
      {(documentPayload.compliance?.missingCategories || []).length > 0 && <div className="rounded-md border border-destructive/50 p-3 text-sm"><b>Missing:</b> {documentPayload.compliance.missingCategories.map(titleCase).join(", ")}</div>}
      {(documentPayload.compliance?.expired || []).map((item: any) => <div key={`${item.categoryCode}-${item.expiryDate}`} className="flex items-center gap-2 rounded-md border border-destructive/50 p-3 text-sm"><AlertTriangle className="h-4 w-4 text-destructive"/>{titleCase(item.categoryCode)} expired on {item.expiryDate}</div>)}
      {canManageCompliance && <div className="grid gap-3 rounded-md border p-4 md:grid-cols-3"><div className="space-y-2 md:col-span-2"><Label>Override reason</Label><Textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Explain the operational exception and corrective action."/></div><div className="space-y-2"><Label>Override expires</Label><Input type="date" value={overrideExpiry} onChange={(event) => setOverrideExpiry(event.target.value)}/><Button className="mt-2 w-full" disabled={overrideReason.trim().length < 3 || !overrideExpiry || override.isPending} onClick={() => override.mutate()}>Record override</Button></div></div>}
    </CardContent></Card></TabsContent>

    <TabsContent value="history"><Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5"/>Relationship and audit history</CardTitle></CardHeader><CardContent><div className="space-y-2">{historyRows.length ? historyRows.map((item: any, index: number) => <div key={item.id || index} className="rounded-md border p-3 text-sm"><div className="font-medium">{titleCase(item.action || item.reason || "Change")}</div><div className="text-xs text-muted-foreground">{item.effectiveFrom || item.createdAt || ""}{item.effectiveTo ? ` – ${item.effectiveTo}` : ""}</div></div>) : <div className="text-sm text-muted-foreground">No history recorded.</div>}</div></CardContent></Card></TabsContent>

    <TabsContent value="incidents"><Card><CardHeader><CardTitle>Linked incidents</CardTitle></CardHeader><CardContent><div className="space-y-2">{incidents.length ? incidents.map((item: any) => <div key={item.id} className="rounded-md border p-3 text-sm"><div className="flex items-center justify-between"><b>{item.incidentNumber}</b><Badge variant={item.severity === "critical" ? "destructive" : "secondary"}>{titleCase(item.severity)}</Badge></div><div>{item.description}</div><div className="text-xs text-muted-foreground">Incident: {new Date(item.occurredAt).toLocaleString()} · Logged: {new Date(item.createdAt).toLocaleString()}</div></div>) : <div className="text-sm text-muted-foreground">No linked incidents.</div>}</div></CardContent></Card></TabsContent>
  </Tabs>;
}
