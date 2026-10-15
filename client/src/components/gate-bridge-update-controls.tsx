import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { schoolFetch, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
const json = async(r:Response)=>{const value=await r.json().catch(()=>({}));if(!r.ok)throw new Error(value.message||`HTTP ${r.status}`);return value;};
type UpdateSettings={autoEnabled:boolean; mode:"scheduled"|"as_soon_as_safe"; checkIntervalHours:number; releaseTrack:"pilot"|"general"; maintenanceFrom:string;maintenanceTo:string;timeZone:string;maxDeferralHours:number};
type Event={id:number;attemptId:string;stage:string;origin:string;status:string;errorCode?:string|null;message?:string|null;occurredAt:string};
type Request={id:number;status:string;origin:string;requestedAt:string;failureCode?:string|null;failureReason?:string|null;rolledBack?:boolean|null};
type UpdateState={settings:UpdateSettings;bridge:{id:number;version:string|null;agentVersion:string|null;lastAgentSeenAt:string|null;lastAgentError?:string|null};latestRelease:{releaseId:string;version:string;rolloutStage:string}|null;requests:Request[];events:Event[]};
function useBridgeUpdateState(id:number){return useQuery<UpdateState>({queryKey:["bridge-updates",id],queryFn:()=>schoolFetch(`/api/access-control/bridges/${id}/updates`).then(json),refetchInterval:10000});}
export function GateBridgeRemoteUpdateCard({bridge}:{bridge:{id:number;name:string;softwareVersion:string|null}}){
 const {toast}=useToast();const {hasPermission}=useAuth();const canManage=hasPermission("access_control.bridge_updates.manage");
 const q=useBridgeUpdateState(bridge.id);const [confirm,setConfirm]=useState(false);
 const request=useMutation({mutationFn:()=>schoolFetch(`/api/access-control/bridges/${bridge.id}/updates/remote`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmInterruption:true})}).then(json),onSuccess:()=>{setConfirm(false);queryClient.invalidateQueries({queryKey:["bridge-updates",bridge.id]});toast({title:"Remote update requested",description:"The Windows Update Agent will verify the signed release and wait until operations are safe."});},onError:(err:Error)=>toast({title:"Request not accepted",description:err.message,variant:"destructive"})});
 const state=q.data;const pending=state?.requests.find(r=>["queued","running"].includes(r.status));
 return <div className="space-y-3 rounded-md border p-3 text-sm">
 <div className="flex flex-wrap items-center justify-between gap-2"><strong>Remote Gate Bridge Update</strong><Badge variant="outline">{state?.latestRelease?`Approved ${state.latestRelease.version}`:"No signed release approved"}</Badge></div>
 <div className="grid gap-2 sm:grid-cols-2"><span>Installed: {state?.bridge.version||bridge.softwareVersion||"Unknown"}</span><span>Update Agent: {state?.bridge.agentVersion||"Not installed / no heartbeat"}</span><span>Last agent check: {state?.bridge.lastAgentSeenAt?new Date(state.bridge.lastAgentSeenAt).toLocaleString():"Not reported"}</span><span>Update status: {pending?`${pending.status} (#${pending.id})`:state?.requests[0]?.status||"Idle"}</span></div>
 {state?.bridge.lastAgentError&&<p className="text-destructive">Agent error: {state.bridge.lastAgentError}</p>}
 {state?.requests[0]?.failureReason&&<p className="text-destructive">Last failure: {state.requests[0].failureReason}</p>}
 <div className="max-h-40 space-y-1 overflow-auto rounded bg-muted/20 p-2 text-xs">{(state?.events||[]).slice(0,15).map(e=><div key={e.id}><span className="text-muted-foreground">{new Date(e.occurredAt).toLocaleTimeString()}</span> · {e.origin} · {e.stage} · {e.status}{e.errorCode?` [${e.errorCode}]`:""}{e.message?` — ${e.message}`:""}</div>)}{!state?.events.length&&"No update attempts reported"}</div>
 {canManage&&<Button size="sm" disabled={!state?.latestRelease||state?.latestRelease.version===bridge.softwareVersion||!!pending||request.isPending} onClick={()=>setConfirm(true)}>Update Bridge Remotely Now</Button>}
 <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Confirm Remote Gate Bridge Update</DialogTitle><DialogDescription>This sends a remote update request to the Windows computer running <strong>{bridge.name}</strong>. The Bridge service will temporarily stop, interrupting gate commands and recognition callbacks. Physical access must remain supervised. Mandatory signed-package, quiescence and rollback checks cannot be bypassed.</DialogDescription></DialogHeader><div className="space-y-1 text-sm"><p>Current version: {bridge.softwareVersion||"Unknown"}</p><p>Target approved version: {state?.latestRelease?.version||"Unavailable"}</p></div><DialogFooter><Button variant="outline" onClick={()=>setConfirm(false)}>Cancel</Button><Button disabled={request.isPending} onClick={()=>request.mutate()}>Confirm Remote Update Request</Button></DialogFooter></DialogContent></Dialog>
 </div>;
}
export function GateBridgeUpdateSettingsCard({bridge}:{bridge:{id:number;name:string}}){
 const {hasPermission}=useAuth();const {toast}=useToast();const canManage=hasPermission("access_control.bridge_updates.manage");
 const q=useBridgeUpdateState(bridge.id);
 const [settings,setSettings]=useState<UpdateSettings|null>(null);
 useEffect(()=>{if(q.data?.settings)setSettings({...q.data.settings});},[q.data?.settings]);
 const save=useMutation({mutationFn:()=>schoolFetch(`/api/access-control/bridges/${bridge.id}/updates/settings`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(settings)}).then(json),onSuccess:()=>{queryClient.invalidateQueries({queryKey:["bridge-updates",bridge.id]});toast({title:"Bridge update settings saved"});},onError:(e:Error)=>toast({title:"Settings rejected",description:e.message,variant:"destructive"})});
 const set=(next:Partial<UpdateSettings>)=>setSettings(s=>s?{...s,...next}:s);
 return <Card><CardHeader><CardTitle className="text-base">Gate Bridge Automatic Updates — {bridge.name}</CardTitle><CardDescription>All configurable update policies are kept under Settings. Unattended installation stays disabled until the signed update agent is trusted and tested.</CardDescription></CardHeader><CardContent className="space-y-4">
 {q.isError&&<p className="text-destructive">Update policy not available: ensure the additive migration is installed.</p>}
 {settings&&<><div className="flex items-center justify-between gap-3"><Label htmlFor={`bridge-auto-${bridge.id}`}>Automatic updates</Label><Switch id={`bridge-auto-${bridge.id}`} checked={settings.autoEnabled} disabled={!canManage} onCheckedChange={v=>set({autoEnabled:v})}/></div>
 <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Installation mode</Label><Select value={settings.mode} onValueChange={v=>set({mode:v as UpdateSettings["mode"]})} disabled={!canManage}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="scheduled">Scheduled window (default)</SelectItem><SelectItem value="as_soon_as_safe">As soon as safe</SelectItem></SelectContent></Select></div>
 <div className="space-y-2"><Label>Check for releases</Label><Select value={String(settings.checkIntervalHours)} onValueChange={v=>set({checkIntervalHours:Number(v)})} disabled={!canManage}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{[1,3,6,12,24].map(h=><SelectItem key={h} value={String(h)}>Every {h} hour{h===1?"":"s"}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Slots begin at midnight in the configured timezone.</p></div>
 <div className="space-y-2"><Label>Release rollout track</Label><Select value={settings.releaseTrack} onValueChange={v=>set({releaseTrack:v as UpdateSettings["releaseTrack"]})} disabled={!canManage}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="general">General (after pilot approval)</SelectItem><SelectItem value="pilot">Pilot (controlled early rollout)</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">Use Pilot only on nominated test Bridge computers.</p></div>
 <div className="space-y-1"><Label>Maintenance window start</Label><Input type="time" value={settings.maintenanceFrom} disabled={!canManage} onChange={e=>set({maintenanceFrom:e.target.value})}/></div>
 <div className="space-y-1"><Label>Maintenance window end</Label><Input type="time" value={settings.maintenanceTo} disabled={!canManage} onChange={e=>set({maintenanceTo:e.target.value})}/></div>
 <div className="space-y-1"><Label>Timezone</Label><Input value={settings.timeZone} disabled={!canManage} onChange={e=>set({timeZone:e.target.value})}/></div>
 <div className="space-y-1"><Label>Maximum postponement (hours)</Label><Input type="number" min={1} max={168} value={settings.maxDeferralHours} disabled={!canManage} onChange={e=>set({maxDeferralHours:Number(e.target.value)})}/></div></div>
 <p className="text-xs text-muted-foreground">Signature verification, safe shutdown, automatic rollback, failure reporting and release approval are mandatory and cannot be switched off.</p>
 {canManage&&<div className="flex justify-end"><Button disabled={save.isPending} onClick={()=>save.mutate()}>{save.isPending?"Saving…":"Save Update Settings"}</Button></div>}</>}
 </CardContent></Card>;
}
