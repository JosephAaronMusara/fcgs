import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Save, RotateCcw, Eye, History, AlertTriangle } from "lucide-react";

type MessageTemplate = { id: number; templateKey: string; smsTemplate: string; emailSubjectTemplate?: string | null; emailBodyTemplate?: string | null; isDefaultCustomized?: boolean };
type TemplateHistoryRow = { id:number; action:string; previousSmsTemplate:string; previousEmailSubjectTemplate?:string|null; previousEmailBodyTemplate?:string|null; newSmsTemplate:string; newEmailSubjectTemplate?:string|null; newEmailBodyTemplate?:string|null; createdAt?:string|null };

const LABELS: Record<string,string> = {
  absence_initial: "Initial Absence",
  absence_reason_updated: "Absence Reason Updated",
  absence_amended_present: "Absence Amended to Present",
  fees_denial_reconciliation: "Fees Denial at Reconciliation",
  fees_denial_later_admitted: "Later Admission After Fees Denial",
};

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, { credentials: "include", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || "Request failed");
  return body;
}

export default function ParentAttendanceNotifications() {
  const { toast } = useToast();
  const { data: templateData, isLoading } = useQuery<{templates: MessageTemplate[]; placeholders: string[]}>( {
    queryKey: ["/api/access-control/message-templates"],
    queryFn: () => api("/api/access-control/message-templates"),
  });
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [preview, setPreview] = useState<{title:string;sms:string;emailSubject:string;emailBody:string;unsupported:string[]}|null>(null);
  const [historyKey, setHistoryKey] = useState<string|null>(null);

  useEffect(() => {
    if (templateData?.templates) setTemplates(templateData.templates.map(x => ({...x})));
  }, [templateData]);

  const saveTemplate = useMutation({
    mutationFn: async (t: MessageTemplate) => api(`/api/access-control/message-templates/${encodeURIComponent(t.templateKey)}`, {
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({smsTemplate:t.smsTemplate,emailSubjectTemplate:t.emailSubjectTemplate || null,emailBodyTemplate:t.emailBodyTemplate || t.smsTemplate}),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey:["/api/access-control/message-templates"]});
      toast({title:"Attendance notification template saved"});
    },
    onError: (e: Error) => toast({title:"Could not save template",description:e.message,variant:"destructive"}),
  });

  const restoreTemplate = useMutation({
    mutationFn: async (key: string) => api(`/api/access-control/message-templates/${encodeURIComponent(key)}/restore-default`, {method:"POST"}),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey:["/api/access-control/message-templates"]});
      toast({title:"Default template restored"});
    },
    onError: (e: Error) => toast({title:"Could not restore template",description:e.message,variant:"destructive"}),
  });

  const previewTemplate = useMutation({
    mutationFn: async (t:MessageTemplate) => api("/api/access-control/message-templates/preview", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({smsTemplate:t.smsTemplate,emailSubjectTemplate:t.emailSubjectTemplate||null,emailBodyTemplate:t.emailBodyTemplate||t.smsTemplate}),
    }),
    onSuccess:(r, t)=>setPreview({title:LABELS[t.templateKey]||t.templateKey,sms:r.preview.sms,emailSubject:r.preview.emailSubject,emailBody:r.preview.emailBody,unsupported:r.unsupportedPlaceholders||[]}),
    onError:(e:Error)=>toast({title:"Preview failed",description:e.message,variant:"destructive"}),
  });

  const {data:historyData}=useQuery<{history:TemplateHistoryRow[]}>( {
    queryKey:[`/api/access-control/message-templates/${historyKey||"_"}/history`],
    queryFn: () => api(`/api/access-control/message-templates/${encodeURIComponent(historyKey || "_")}/history`),
    enabled:!!historyKey,
  });

  const chars = useMemo(() => Object.fromEntries(templates.map(t => [t.templateKey, t.smsTemplate.length])), [templates]);
  const unsupportedFor = (t:MessageTemplate) => {
    const allowed=new Set(templateData?.placeholders||[]);
    const pattern=/\{\{([a-z0-9_]+)\}\}/gi;
    const values=[t.smsTemplate,t.emailSubjectTemplate||"",t.emailBodyTemplate||""];
    const bad=new Set<string>();
    for(const value of values){let match:RegExpExecArray|null;while((match=pattern.exec(value))) if(!allowed.has(match[1])) bad.add(match[1]);pattern.lastIndex=0;}
    return Array.from(bad);
  };

  if (isLoading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading attendance notification templates…</CardContent></Card>;

  return <>
    <Card>
      <CardHeader>
        <CardTitle>Parent Attendance Notifications</CardTitle>
        <CardDescription>
          Organisation-wide attendance notification templates used by all schools. Learner, school and attendance details are inserted automatically from the placeholders below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md border bg-muted/30 p-3 text-xs"><span className="font-medium">Available placeholders:</span> {(templateData?.placeholders || []).map(p => <Badge key={p} variant="outline" className="m-1 font-mono">{`{{${p}}}`}</Badge>)}</div>
        {templates.map((t,idx) => {
          const unsupported=unsupportedFor(t);
          return <div key={t.templateKey} className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium">{LABELS[t.templateKey] || t.templateKey}</div><div className="text-xs text-muted-foreground">SMS characters: {chars[t.templateKey] || 0}</div></div>{t.isDefaultCustomized && <Badge variant="secondary">Customized</Badge>}</div>
            <div className="space-y-2"><Label>SMS message</Label><Textarea rows={5} value={t.smsTemplate} onChange={e=>setTemplates(rows=>rows.map((x,i)=>i===idx?{...x,smsTemplate:e.target.value}:x))}/></div>
            <div className="space-y-2"><Label>Email subject</Label><Input value={t.emailSubjectTemplate || ""} onChange={e=>setTemplates(rows=>rows.map((x,i)=>i===idx?{...x,emailSubjectTemplate:e.target.value}:x))}/></div>
            <div className="space-y-2"><Label>Email body</Label><Textarea rows={7} value={t.emailBodyTemplate || ""} onChange={e=>setTemplates(rows=>rows.map((x,i)=>i===idx?{...x,emailBodyTemplate:e.target.value}:x))}/></div>
            {unsupported.length>0&&<div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/><div>Unsupported placeholder{unsupported.length>1?"s":""}: {unsupported.map(x=>`{{${x}}}`).join(", ")}. The template cannot be saved until these are corrected.</div></div>}
            <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={()=>setHistoryKey(t.templateKey)}><History className="mr-2 h-4 w-4"/>History</Button><Button variant="outline" onClick={()=>previewTemplate.mutate(t)}><Eye className="mr-2 h-4 w-4"/>Preview</Button><Button variant="outline" onClick={()=>restoreTemplate.mutate(t.templateKey)}><RotateCcw className="mr-2 h-4 w-4"/>Restore Default</Button><Button disabled={unsupported.length>0 || saveTemplate.isPending} onClick={()=>saveTemplate.mutate(t)}><Save className="mr-2 h-4 w-4"/>Save Template</Button></div>
          </div>;
        })}
      </CardContent>
    </Card>

    <Dialog open={!!preview} onOpenChange={(open)=>{if(!open)setPreview(null)}}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Rendered Preview · {preview?.title}</DialogTitle><DialogDescription>Preview values are examples only; live messages use the learner, school and attendance record.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>SMS</Label><div className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">{preview?.sms}</div></div><div><Label>Email subject</Label><div className="mt-1 rounded-md border bg-muted/30 p-3 text-sm font-medium">{preview?.emailSubject}</div></div><div><Label>Email body</Label><div className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">{preview?.emailBody}</div></div></div></DialogContent></Dialog>
    <Dialog open={!!historyKey} onOpenChange={(open)=>{if(!open)setHistoryKey(null)}}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Template Edit History</DialogTitle><DialogDescription>This organisation-level audit history is append-only and preserves each saved version and default restore.</DialogDescription></DialogHeader><div className="max-h-[60vh] space-y-3 overflow-y-auto">{(historyData?.history||[]).map(row=><div key={row.id} className="rounded-md border p-3"><div className="flex items-center justify-between gap-2"><Badge variant="outline" className="capitalize">{row.action.replaceAll("_"," ")}</Badge><span className="text-xs text-muted-foreground">{row.createdAt?new Date(row.createdAt).toLocaleString():""}</span></div><div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-md bg-muted/30 p-3"><div className="text-xs font-medium text-muted-foreground">Previous SMS</div><div className="mt-1 whitespace-pre-wrap text-sm">{row.previousSmsTemplate}</div><div className="mt-3 text-xs font-medium text-muted-foreground">Previous email subject</div><div className="mt-1 text-sm">{row.previousEmailSubjectTemplate || "—"}</div><div className="mt-3 text-xs font-medium text-muted-foreground">Previous email body</div><div className="mt-1 whitespace-pre-wrap text-sm">{row.previousEmailBodyTemplate || "—"}</div></div><div className="rounded-md border p-3"><div className="text-xs font-medium text-muted-foreground">New SMS</div><div className="mt-1 whitespace-pre-wrap text-sm">{row.newSmsTemplate}</div><div className="mt-3 text-xs font-medium text-muted-foreground">New email subject</div><div className="mt-1 text-sm">{row.newEmailSubjectTemplate || "—"}</div><div className="mt-3 text-xs font-medium text-muted-foreground">New email body</div><div className="mt-1 whitespace-pre-wrap text-sm">{row.newEmailBodyTemplate || "—"}</div></div></div></div>)}{historyData?.history?.length===0&&<div className="py-8 text-center text-sm text-muted-foreground">No edits have been saved yet.</div>}</div></DialogContent></Dialog>
  </>;
}
