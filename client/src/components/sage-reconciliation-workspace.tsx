import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { schoolFetch, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
 approveSageSelectionsInBatches,
 SAGE_APPROVAL_CHUNK_SIZE,
 normalizeSageApprovalCode,
 SageBulkApprovalError,
 type SageApprovalProgress,
} from "@/lib/sage-bulk-approval";

const parse = async (r: Response) => { const j = await r.json(); if (!r.ok) throw new Error(j.message || "Request failed"); return j; };
type Candidate = { studentId: number; name: string; admissionNo?: string | null; score: number; evidence: string[] };
type SageRow = { id: number; rowNumber: number; rowDisposition: string; csvCustomerCode: string | null; csvName: string; csvGroup?: string | null; csvArea?: string | null; balanceDue: string; balanceProvided: boolean; mappingState: string; matchedStudentName?: string | null; validationError?: string | null; matchingCandidates?: Candidate[] | null };
type Student = {id:number; name:string; admissionNo?:string; status:string; feesCustomerId?:string | null};
type Batch = { id:number; fileName:string | null; status:string; sheetName:string | null; totalRows:number; matchedRows:number; unmatchedRows:number };
export default function SageReconciliationWorkspace({open,onOpenChange}: {open:boolean;onOpenChange:(open:boolean)=>void}) {
 const {toast}=useToast(); const {hasPermission}=useAuth(); const canApprove=hasPermission("fees.sage_mapping.manage");
 const [batchId,setBatchId]=useState(""); const [search,setSearch]=useState(""); const [rowLimit,setRowLimit]=useState(100);
 const [selected,setSelected]=useState<Record<number,number>>({}); const [studentSearch,setStudentSearch]=useState<Record<number,string>>({});
 const [approvalProgress,setApprovalProgress]=useState<SageApprovalProgress|null>(null);
 const [approvalNotice,setApprovalNotice]=useState<{kind:"success"|"error";text:string}|null>(null);
 const batchesQuery=useQuery<{batches:Batch[]}>({queryKey:["sage-reconciliation-batches"],queryFn:()=>schoolFetch("/api/fees/sage-reconciliation/batches").then(parse),enabled:open});
 const effectiveId=batchId || String(batchesQuery.data?.batches[0]?.id || "");
 const rowsQuery=useQuery<{items:SageRow[]}>({queryKey:["sage-reconciliation-items",effectiveId],queryFn:()=>schoolFetch(`/api/fees/import-file/${effectiveId}/items`).then(parse),enabled:open&&!!effectiveId});
 const studentsQuery=useQuery<{students:Student[]}>({queryKey:["sage-reconciliation-students"],queryFn:()=>schoolFetch("/api/fees/sage-reconciliation/students").then(parse),enabled:open&&canApprove});
 const batches=batchesQuery.data?.batches||[];
 const batch=batches.find(b=>String(b.id)===effectiveId);
 const rows=rowsQuery.data?.items||[];
 const outstanding=useMemo(()=>rows.filter(r=>r.rowDisposition!=="skipped"&&r.mappingState!=="confirmed"),[rows]);
 const visible=outstanding.filter(r=>`${r.csvCustomerCode} ${r.csvName} ${r.csvGroup} ${r.csvArea}`.toLowerCase().includes(search.toLowerCase())).slice(0,rowLimit);
 const availableStudents=studentsQuery.data?.students||[];
 const refreshAssociations=()=>{
  queryClient.invalidateQueries({queryKey:["sage-reconciliation-items",effectiveId]});
  queryClient.invalidateQueries({queryKey:["sage-reconciliation-batches"]});
  queryClient.invalidateQueries({queryKey:["sage-reconciliation-students"]});
  queryClient.invalidateQueries({queryKey:["/api/students"]});
 };
 const approve=useMutation({
  mutationFn:async()=>{
   setApprovalNotice(null);
   const byRow=new Map(outstanding.map(r=>[r.id,r]));
   const byStudent=new Map(availableStudents.map(s=>[s.id,s]));
   const selections=Object.entries(selected).map(([id,studentId])=>{
    const itemId=Number(id),row=byRow.get(itemId),student=byStudent.get(studentId);
    if(!row||row.rowDisposition!=="data"||row.validationError||!row.csvCustomerCode){
     throw new Error(`Sage row ${itemId} is no longer eligible for approval. Refresh the import and review it.`);
    }
    if(!student){
     throw new Error(`FCGS student ${studentId} is not in the current school's available records.`);
    }
    if(student.feesCustomerId&&normalizeSageApprovalCode(student.feesCustomerId)!==normalizeSageApprovalCode(row.csvCustomerCode)){
     throw new Error(`FCGS student ${studentId} already has a different Sage Evolution ID. Resolve that conflict separately.`);
    }
    return {itemId,studentId,customerCode:row.csvCustomerCode};
   });
   // The helper validates cross-chunk duplicates before making the first request.
   setApprovalProgress({approved:0,total:selections.length,completedBatches:0,totalBatches:Math.ceil(selections.length/SAGE_APPROVAL_CHUNK_SIZE)});
   return approveSageSelectionsInBatches(
    selections,
    async(chunk)=>schoolFetch(`/api/fees/sage-reconciliation/${effectiveId}/approve`,{
     method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({selections:chunk}),
    }).then(parse),
    (chunk,progress)=>{
     // Only committed links leave the selection. Unprocessed ones remain for review/retry.
     setSelected(prev=>{
      const next={...prev};
      for(const {itemId,studentId} of chunk)if(next[itemId]===studentId)delete next[itemId];
      return next;
     });
     setApprovalProgress(progress);
     refreshAssociations();
    },
   );
  },
  onSuccess:(progress)=>{
   const summary=`${progress.approved} Sage ID(s) verified in ${progress.completedBatches} transaction(s). Existing balances were NOT modified.`;
   setApprovalNotice({kind:"success",text:summary});
   toast({title:"Sage associations confirmed",description:summary});
  },
  onError:(error:Error)=>{
   const message=error instanceof SageBulkApprovalError
    ? `${error.progress.approved} of ${error.progress.total} Sage links confirmed. ${error.progress.total-error.progress.approved} are not yet confirmed in this run. Request ${error.failedBatchNumber} of ${error.progress.totalBatches} failed: ${error.message}. Review the refreshed results before retrying; an interrupted request may have been committed by the server.`
    : `No approvals were submitted: ${error.message}`;
   setApprovalNotice({kind:"error",text:message});
   toast({title:error instanceof SageBulkApprovalError&&error.progress.approved>0?"Partial Sage approval":"Approval declined",description:message,variant:"destructive"});
  },
  onSettled:refreshAssociations,
 });
 // If another session confirmed a selected account, remove it after reloading the server state.
 useEffect(()=>{
  if(approve.isPending||!rowsQuery.data)return;
  const confirmed=new Set(rowsQuery.data.items.filter(r=>r.mappingState==="confirmed").map(r=>r.id));
  if(!confirmed.size)return;
  setSelected(prev=>{
   if(!Object.keys(prev).some(id=>confirmed.has(Number(id))))return prev;
   const next={...prev};for(const id of confirmed)delete next[id];return next;
  });
 },[rowsQuery.data,approve.isPending]);
 const setRow=(rowId:number,id:number)=>{if(approve.isPending)return;setApprovalNotice(null);setSelected(prev=>({...prev,[rowId]:id}));};
 const unsetRow=(rowId:number)=>{if(approve.isPending)return;setApprovalNotice(null);setSelected(prev=>{const next={...prev};delete next[rowId];return next;});};
 const exportMappingTemplate=()=>{
  if(!batch||!outstanding.length)return;
  const safe=(value:unknown)=>{
   let text=String(value??"");
   // Avoid spreadsheet formula execution in CSV fields containing untrusted Sage names.
   if(/^[\s]*[=+@-]/.test(text))text="'"+text;
   return `"${text.replace(/"/g,'""')}"`;
  };
  const data=["SageRowID,SageCustomer,SageName,Group,Area,FCGSStudentID,Status"];
  for(const row of outstanding)data.push([row.id,row.csvCustomerCode,row.csvName,row.csvGroup,row.csvArea,selected[row.id]||"",row.validationError||row.mappingState].map(safe).join(","));
  const url=URL.createObjectURL(new Blob(["\uFEFF"+data.join("\r\n")],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=`fcgs_sage_mapping_batch_${batch.id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
 };
 const importMappingTemplate=async(file:File)=>{
  if(!canApprove||!batch)throw new Error("Sage approval permission required");
  const XLSX=await import("xlsx");
  const wb=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:false});
  const parsed=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:"",raw:false});
  if(parsed.length>2500)throw new Error("Maximum 2,500 mapping rows per template");
  const byId=new Map(outstanding.map(r=>[r.id,r]));const next:Record<number,number>={};const used=new Set<number>();
  for(const rec of parsed){
   const rawId=String(rec.SageRowID??"").trim(),rawStudent=String(rec.FCGSStudentID??"").trim();
   if(!rawStudent)continue;
   if(!/^\d+$/.test(rawId)||!/^\d+$/.test(rawStudent))throw new Error(`Invalid mapping row ID or student ID: ${rawId}`);
   const rowId=Number(rawId),studentId=Number(rawStudent),record=byId.get(rowId);
   if(!record||record.rowDisposition!=="data"||record.validationError)throw new Error(`Sage row ${rowId} is not eligible for confirmation`);
   if(String(record.csvCustomerCode||"").trim()!==String(rec.SageCustomer||"").trim())throw new Error(`Sage Customer changed for row ${rowId}. Export a fresh template.`);
   if(!availableStudents.some(st=>st.id===studentId))throw new Error(`FCGS student ${studentId} does not belong to this school's available student records`);
   if(used.has(studentId)||next[rowId])throw new Error(`Duplicate FCGS student or Sage row in mapping template: ${rowId}`);
   next[rowId]=studentId;used.add(studentId);
  }
  setSelected(next);
  setApprovalNotice(null);
  toast({title:"Mapping template loaded for review",description:`${Object.keys(next).length} selections prepared. Review them and explicitly confirm; nothing has been changed in the database.`});
 };

 const bulkUnambiguous=()=>{
  const picks:Record<number,number>={}; const used=new Set<number>();
  // Duplicate Sage codes must never be selected silently, even across request chunks.
  const counts=new Map<string,number>();
  for(const row of outstanding){
   if(row.rowDisposition!=="data"||row.validationError||!row.csvCustomerCode)continue;
   const code=normalizeSageApprovalCode(row.csvCustomerCode);
   counts.set(code,(counts.get(code)||0)+1);
  }
  for(const row of outstanding) {const c=row.matchingCandidates || [];
   if(row.rowDisposition!=="data"||row.validationError||!row.csvCustomerCode||counts.get(normalizeSageApprovalCode(row.csvCustomerCode))!==1)continue;
   if(c.length!==1 || c[0].score<95 || used.has(c[0].studentId)) continue;
   if(availableStudents.find(s=>s.id===c[0].studentId)?.feesCustomerId && availableStudents.find(s=>s.id===c[0].studentId)?.feesCustomerId?.toLowerCase()!==row.csvCustomerCode?.toLowerCase())continue;
   picks[row.id]=c[0].studentId;used.add(c[0].studentId);
  }
  setSelected(picks);
  setApprovalNotice(null);
  toast({title:"Suggestions selected for review",description:`${Object.keys(picks).length} distinct high-evidence, single-candidate suggestions selected. Review before confirming.`});
 };
 return <Dialog open={open} onOpenChange={next=>{if(!approve.isPending)onOpenChange(next);}}><DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100dvw-2rem)] max-w-6xl overflow-y-auto">
 <DialogHeader><DialogTitle>Sage Evolution Matching & Reconciliation</DialogTitle><DialogDescription>Review unlinked Sage accounts without changing balances. Only explicit confirmation establishes a new identity association. Imports can be reopened here after closing the upload dialog.</DialogDescription></DialogHeader>
 <div className="flex flex-wrap items-end gap-3"><div className="min-w-[220px] flex-1 space-y-1"><Label>Import batch</Label><Select disabled={approve.isPending} value={effectiveId} onValueChange={v=>{setBatchId(v);setSelected({});setApprovalNotice(null);}}><SelectTrigger><SelectValue placeholder="Select previous import" /></SelectTrigger><SelectContent>{batches.map(b=><SelectItem key={b.id} value={String(b.id)}>#{b.id} — {b.fileName} ({b.status})</SelectItem>)}</SelectContent></Select></div><div className="min-w-[180px] flex-1 space-y-1"><Label>Search Sage name / ID / form</Label><Input value={search} onChange={e=>{setSearch(e.target.value);setRowLimit(100);}} placeholder="Search unresolved records" /></div></div>
 {batch&&<div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{batch.sheetName||"CSV"}</Badge><Badge variant="secondary">{batch.status}</Badge><span>{outstanding.length} accounts require reconciliation · {batch.matchedRows} linked</span></div>}
 {!["preview","committed","completed_with_errors"].includes(batch?.status||"")&&<p className="text-sm text-amber-700">This is a historical import. You may still approve Sage identity links, but this never re-applies historical balances. Upload a current Sage export to refresh balances.</p>}
 <div className="flex flex-wrap items-center gap-2">
  <Button type="button" variant="outline" onClick={exportMappingTemplate} disabled={!batch||!outstanding.length}>Export unresolved mapping CSV</Button>
  {canApprove&&<Label className="cursor-pointer rounded-md border px-3 py-2 text-sm">Import reviewed mapping CSV / Excel<input disabled={approve.isPending} className="hidden" type="file" accept=".csv,.xlsx,.xls" onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;try{await importMappingTemplate(file);}catch(err){toast({title:"Template rejected",description:err instanceof Error?err.message:"Invalid file",variant:"destructive"});}}}/></Label>}
 </div>
 {canApprove&&["preview","committed","completed_with_errors"].includes(batch?.status||"")&&<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={approve.isPending} onClick={bulkUnambiguous}>Select unique strong suggestions</Button><Button type="button" disabled={!Object.keys(selected).length||approve.isPending} onClick={()=>approve.mutate()}>{approve.isPending?"Confirming Sage links…":`Confirm selected ${Object.keys(selected).length} Sage links`}</Button><Button type="button" variant="outline" disabled={approve.isPending||!Object.keys(selected).length} onClick={()=>{setSelected({});setApprovalNotice(null);}}>Clear selection</Button></div>}
 {approve.isPending&&approvalProgress&&<div role="status" aria-live="polite" className="rounded-md border bg-muted/50 p-3 text-sm">Confirming Sage associations: {approvalProgress.approved} of {approvalProgress.total} confirmed ({approvalProgress.completedBatches} of {approvalProgress.totalBatches} requests complete). Please keep this dialog open.</div>}
 {!approve.isPending&&approvalNotice&&<div role={approvalNotice.kind==="error"?"alert":"status"} className={`rounded-md border p-3 text-sm ${approvalNotice.kind==="error"?"border-destructive text-destructive":"border-green-600 text-foreground"}`}>{approvalNotice.text}</div>}
 <div className="max-h-[55vh] overflow-auto rounded-md border"><table className="w-full border-collapse text-sm"><thead className="sticky top-0 bg-background"><tr className="border-b text-left"><th className="p-2">Row / Customer</th><th className="p-2">Sage Name & Class</th><th className="p-2">Balance</th><th className="p-2">Suggested FCGS learner / review</th></tr></thead><tbody>{visible.map(row=>{
 const candidates=row.matchingCandidates||[]; const text=studentSearch[row.id]||"";
 const searched=text.trim().length>=2?availableStudents.filter(s=>`${s.name} ${s.admissionNo}`.toLowerCase().includes(text.toLowerCase())).slice(0,15):[];
 return <tr className="border-b align-top" key={row.id}><td className="p-2"><div>#{row.rowNumber}</div><strong>{row.csvCustomerCode}</strong></td><td className="p-2"><div>{row.csvName}</div><small className="text-muted-foreground">{row.csvGroup||"—"} · {row.csvArea||"—"}</small>{row.validationError&&<div className="text-destructive">{row.validationError}</div>}</td><td className="p-2">{row.balanceProvided?Number(row.balanceDue).toFixed(2):"Unknown (not supplied)"}</td><td className="min-w-[280px] space-y-2 p-2">{candidates.length>1&&<Badge variant="destructive">Multiple possible matches — manual review</Badge>}
 {row.rowDisposition==="invalid"&&<Badge variant="destructive">Invalid source row — correct in Sage export</Badge>}
 {candidates.length===0&&<Badge variant="outline">No suggested match</Badge>}
 {candidates.map(c=><label className="flex items-start gap-2" key={c.studentId}><input disabled={approve.isPending||!canApprove||!["preview","committed","completed_with_errors"].includes(batch?.status||"")} type="radio" name={`sage-${row.id}`} checked={selected[row.id]===c.studentId} onChange={()=>setRow(row.id,c.studentId)}/><span>{c.name} · {c.admissionNo||"—"} <small className="text-muted-foreground">({c.score}; {c.evidence.join(", ")})</small></span></label>)}
 {canApprove&&["preview","committed","completed_with_errors"].includes(batch?.status||"")&&<><Input disabled={approve.isPending} aria-label={`Search another learner for Sage row ${row.rowNumber}`} placeholder="Search FCGS students by name or admission no" value={text} onChange={e=>setStudentSearch(prev=>({...prev,[row.id]:e.target.value}))}/>{searched.map(s=><button disabled={approve.isPending} className="block w-full rounded border px-2 py-1 text-left text-xs hover:bg-muted" type="button" onClick={()=>{setRow(row.id,s.id);setStudentSearch(prev=>({...prev,[row.id]:`${s.name} (${s.admissionNo})`}))}} key={s.id}>{s.name} ({s.admissionNo})</button>)}</>}
  {canApprove&&selected[row.id]!==undefined&&<Button variant="ghost" size="sm" type="button" disabled={approve.isPending} onClick={()=>unsetRow(row.id)}>Remove this selection</Button>}
 </td></tr>;
 })}</tbody></table>{!visible.length&&<p className="p-4 text-sm text-muted-foreground">No unresolved accounts match your search.</p>}</div>
 {outstanding.length>rowLimit&&<Button variant="outline" type="button" onClick={()=>setRowLimit(n=>n+100)}>Show next 100 rows ({outstanding.length-rowLimit} remaining)</Button>}
 </DialogContent></Dialog>;
}
