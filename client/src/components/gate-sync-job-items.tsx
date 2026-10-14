import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { schoolFetch } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";

type Item = { id: number; personLabel: string; personType: string; outcome: string; explanation: string | null; deviceIds: number[] | null };
export function GateJobItemsPanel({ jobs }: { jobs: Array<{ id: number; jobType: string; status: string }> }) {
  const [job, setJob] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const query = useQuery<{ items: Item[]; total: number; page: number }>({ queryKey: ["gate-job-items", job, status, page], enabled: Boolean(job), queryFn: async () => {
    const r = await schoolFetch(`/api/access-control/sync-jobs/${job}/items?status=${status}&page=${page}`);
    if (!r.ok) throw new Error("Could not retrieve job details"); return r.json();
  } });
  return <Card><CardHeader><CardTitle className="text-base">Job outcomes by person</CardTitle><CardDescription>Shows which people were queued, skipped or failed, with an explanation. Queued does not mean terminal-confirmed. Filter and page through the entire job.</CardDescription></CardHeader><CardContent className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2"><Select value={job} onValueChange={(value) => { setJob(value); setPage(1); }}><SelectTrigger><SelectValue placeholder="Select reconciliation or enrolment job" /></SelectTrigger><SelectContent>{jobs.map((row) => <SelectItem key={row.id} value={String(row.id)}>#{row.id} · {row.jobType} · {row.status}</SelectItem>)}</SelectContent></Select>
    <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All outcomes</SelectItem><SelectItem value="queued">Queued for terminal</SelectItem><SelectItem value="skipped">Skipped / already correct</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent></Select></div>
    {query.isError && <div className="text-sm text-destructive">Could not load job records.</div>}
    <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Outcome</TableHead><TableHead>Explanation</TableHead></TableRow></TableHeader><TableBody>{query.data?.items.length ? query.data.items.map((row) => <TableRow key={row.id}><TableCell><div>{row.personLabel}</div><div className="text-xs text-muted-foreground">{row.personType}</div></TableCell><TableCell><Badge variant={row.outcome === "failed" ? "destructive" : row.outcome === "queued" ? "default" : "secondary"}>{row.outcome}</Badge></TableCell><TableCell className="max-w-[460px] whitespace-normal text-xs">{row.explanation || "—"}</TableCell></TableRow>) : <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">{job ? "No matching results for this job" : "Select a job to inspect every outcome"}</TableCell></TableRow>}</TableBody></Table></div>
    {job && <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{query.data?.total ?? 0} matching records · Page {page}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page < 2} onClick={() => setPage(p => p - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={!query.data || page * 50 >= query.data.total} onClick={() => setPage(p => p + 1)}>Next</Button></div></div>}
  </CardContent></Card>;
}
