import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, History, KeyRound, Link2, Loader2, RefreshCw, Send } from "lucide-react";
import { apiRequest, queryClient, schoolFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type RecipientType = "parent" | "student" | "staff";
type ExistingDelivery = "skip" | "send";

type DistributionRequest = {
  recipientType: RecipientType;
  recipientIds: number[];
  search?: string;
  classFilter?: string;
  statusFilter?: string;
  existingDelivery?: ExistingDelivery;
};

type PreviewException = { recipientId: number; recipientName: string; reasonCode: string; reason: string };
type DistributionPreview = {
  totalCount: number;
  existingCount: number;
  linkExistingCount?: number;
  createCount: number;
  linkedAfterCreateCount?: number;
  missingContactCount: number;
  attentionCount: number;
  exceptionCount: number;
  exceptions?: PreviewException[];
  scope: "selected" | "filtered";
  channels: { emailConfigured: boolean; smsConfigured: boolean; communicationsDisabled: boolean };
};

type DeliveryOutcome = { channel: "email" | "sms"; destination: string; success: boolean; error?: string | null };
type RecipientOutcome = {
  recipientId: number;
  recipientName: string;
  username?: string | null;
  status: "sent" | "failed" | "skipped";
  accountAction: "existing" | "created" | "linked" | "none";
  reasonCode?: string | null;
  reason?: string | null;
  deliveries?: DeliveryOutcome[];
};
type DistributionMetadata = {
  recipientType?: RecipientType;
  scope?: "selected" | "filtered";
  existingDelivery?: ExistingDelivery;
  createdCount?: number;
  existingSentCount?: number;
  linkedCount?: number;
  skippedExistingCount?: number;
  outcomes?: RecipientOutcome[];
};
type DistributionJob = {
  id: number;
  title: string;
  status: "queued" | "running" | "completed" | "failed";
  totalCount: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errorSummary?: string | null;
  metadata?: DistributionMetadata | null;
  requestedBy?: number | null;
  requestedByName?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

interface LoginDetailsBulkDialogProps {
  recipientType: RecipientType;
  selectedIds: number[];
  search?: string;
  classFilter?: string;
  statusFilter?: string;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
  triggerSize?: "default" | "sm" | "lg" | "icon";
}

function pluralLabel(type: RecipientType) {
  if (type === "staff") return "staff members";
  return `${type}s`;
}
function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function LoginDetailsBulkDialog({
  recipientType,
  selectedIds,
  search = "",
  classFilter = "all",
  statusFilter = "all",
  triggerLabel = "Send Login Details",
  triggerVariant = "outline",
  triggerSize = "default",
}: LoginDetailsBulkDialogProps) {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canViewDistribution = hasPermission("users.view") && hasPermission("communication.view");
  const canSendDistribution = hasPermission("users.create") && hasPermission("communication.send");
  const canUseDistribution = canViewDistribution && canSendDistribution;
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("send");
  const [jobId, setJobId] = useState<number | null>(null);
  const [selectedHistoryJobId, setSelectedHistoryJobId] = useState<number | null>(null);
  const [existingDelivery, setExistingDelivery] = useState<ExistingDelivery>("skip");
  const [deliveryChoiceTouched, setDeliveryChoiceTouched] = useState(false);
  const completionToastRef = useRef<number | null>(null);

  const baseRequest = useMemo<DistributionRequest>(() => ({ recipientType, recipientIds: selectedIds, search, classFilter, statusFilter }), [recipientType, selectedIds, search, classFilter, statusFilter]);
  const previewQuery = useQuery<DistributionPreview>({
    queryKey: ["/api/account-distribution/preview", recipientType, selectedIds.join(","), search, classFilter, statusFilter],
    enabled: open && canViewDistribution,
    staleTime: 0,
    queryFn: async () => (await apiRequest("POST", "/api/account-distribution/preview", baseRequest)).json(),
  });
  const historyQuery = useQuery<DistributionJob[]>({
    queryKey: ["/api/account-distribution/history", recipientType],
    enabled: open && canViewDistribution,
    staleTime: 0,
    queryFn: async () => {
      const response = await schoolFetch(`/api/account-distribution/history?recipientType=${encodeURIComponent(recipientType)}`);
      if (!response.ok) throw new Error("Failed to load login distribution history");
      return response.json();
    },
  });
  const historyDetailQuery = useQuery<DistributionJob>({
    queryKey: ["/api/account-distribution/history/detail", selectedHistoryJobId],
    enabled: open && canViewDistribution && !!selectedHistoryJobId,
    staleTime: 0,
    queryFn: async () => {
      const response = await schoolFetch(`/api/account-distribution/history/${selectedHistoryJobId}`);
      if (!response.ok) throw new Error("Failed to load distribution details");
      return response.json();
    },
  });
  const jobQuery = useQuery<DistributionJob>({
    queryKey: ["/api/communication/jobs", jobId],
    enabled: !!jobId,
    staleTime: 0,
    queryFn: async () => {
      const response = await schoolFetch(`/api/communication/jobs/${jobId}`);
      if (!response.ok) throw new Error("Failed to load distribution progress");
      return response.json();
    },
    refetchInterval: (query) => {
      const status = (query.state.data as DistributionJob | undefined)?.status;
      return status === "completed" || status === "failed" ? false : 1200;
    },
  });

  const preview = previewQuery.data;
  const existingLikeCount = (preview?.existingCount || 0) + (preview?.linkExistingCount || 0);
  const isMixed = Boolean(preview && preview.createCount > 0 && existingLikeCount > 0);
  useEffect(() => {
    if (!preview || deliveryChoiceTouched) return;
    setExistingDelivery(preview.createCount === 0 && existingLikeCount > 0 ? "send" : "skip");
  }, [preview, existingLikeCount, deliveryChoiceTouched]);

  const sendMutation = useMutation({
    mutationFn: async (request: DistributionRequest) => (await apiRequest("POST", "/api/account-distribution/send", request)).json() as Promise<{ jobId: number; message: string }>,
    onSuccess: (data) => {
      setJobId(data.jobId);
      setActiveTab("send");
      setSelectedHistoryJobId(null);
      completionToastRef.current = null;
      toast({ title: "Login details queued", description: data.message });
    },
    onError: (error: Error) => toast({ title: "Could not start distribution", description: error.message, variant: "destructive" }),
  });

  const currentJob = jobQuery.data;
  const isJobTerminal = currentJob?.status === "completed" || currentJob?.status === "failed";
  useEffect(() => {
    if (!currentJob || !isJobTerminal || completionToastRef.current === currentJob.id) return;
    completionToastRef.current = currentJob.id;
    queryClient.invalidateQueries({ queryKey: ["/api/account-distribution/history", recipientType] });
    queryClient.invalidateQueries({ queryKey: ["/api/account-distribution/preview", recipientType] });
    toast({
      title: currentJob.status === "completed" ? "Login distribution complete" : "Login distribution stopped",
      description: `${currentJob.successCount || 0} sent${currentJob.failedCount ? `; ${currentJob.failedCount} require attention` : ""}${currentJob.skippedCount ? `; ${currentJob.skippedCount} skipped` : ""}.`,
      variant: currentJob.status === "failed" ? "destructive" : "default",
    });
  }, [currentJob, isJobTerminal, recipientType, toast]);

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (value) {
      setJobId(null);
      setActiveTab("send");
      setDeliveryChoiceTouched(false);
      setSelectedHistoryJobId(null);
    }
  };
  const startDistribution = (recipientIdsOverride?: number[]) => {
    sendMutation.mutate({
      ...baseRequest,
      existingDelivery,
      recipientIds: recipientIdsOverride ?? baseRequest.recipientIds,
      ...(recipientIdsOverride ? { search: "", classFilter: "all", statusFilter: "all" } : {}),
    });
  };

  const progressPercent = currentJob?.totalCount ? Math.min(100, Math.round(((currentJob.processedCount || 0) / currentJob.totalCount) * 100)) : 0;
  const selectedHistoryJob = historyDetailQuery.data || null;
  const outcomes = selectedHistoryJob?.metadata?.outcomes || [];
  const failedOutcomes = outcomes.filter((row) => row.status === "failed");
  const sentOutcomes = outcomes.filter((row) => row.status === "sent");
  const skippedOutcomes = outcomes.filter((row) => row.status === "skipped");
  const retryIds = Array.from(new Set(failedOutcomes.map((row) => row.recipientId).filter(Number.isFinite)));
  const primaryActionLabel = preview && preview.createCount === 0 && existingLikeCount > 0 ? "Resend Login Details" : "Create & Send";

  if (!canUseDistribution) return null;

  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} onClick={() => handleOpenChange(true)} data-testid={`button-send-login-details-${recipientType}`}>
        <KeyRound className="mr-2 h-4 w-4" />{triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Send Login Details</DialogTitle>
            <DialogDescription>{selectedIds.length ? `Process the ${selectedIds.length} selected ${pluralLabel(recipientType)}.` : `Process all active ${pluralLabel(recipientType)} matching the current page filters.`}</DialogDescription>
          </DialogHeader>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList><TabsTrigger value="send" className="gap-2"><Send className="h-4 w-4" />Send</TabsTrigger><TabsTrigger value="history" className="gap-2"><History className="h-4 w-4" />History</TabsTrigger></TabsList>
            <TabsContent value="send" className="space-y-4">
              {previewQuery.isLoading ? <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Checking accounts...</div> : previewQuery.isError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Could not prepare the distribution preview. {previewQuery.error instanceof Error ? previewQuery.error.message : ""}</div>
              ) : preview ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Selected / matched</div><div className="text-2xl font-semibold">{preview.totalCount}</div></div>
                    <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Accounts to create</div><div className="text-2xl font-semibold">{preview.createCount}</div></div>
                    <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Existing accounts</div><div className="text-2xl font-semibold">{preview.existingCount}</div></div>
                    <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Existing accounts to link</div><div className="text-2xl font-semibold">{preview.linkExistingCount || 0}</div></div>
                  </div>

                  {isMixed && (
                    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                      <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">Not all selected users need new accounts</div><div className="text-sm">{preview.createCount} need accounts; {existingLikeCount} already have an FCGS account or can be linked to one.</div></div></div>
                      <div className="space-y-2">
                        <label className="flex cursor-pointer gap-3 rounded-md border bg-background p-3 text-foreground">
                          <input type="radio" name="existing-delivery" checked={existingDelivery === "skip"} onChange={() => { setExistingDelivery("skip"); setDeliveryChoiceTouched(true); }} />
                          <span><strong>Skip users with existing accounts (recommended)</strong><span className="block text-sm text-muted-foreground">Create accounts and send login details only to users without accounts. Any required cross-school parent account links will still be completed.</span></span>
                        </label>
                        <label className="flex cursor-pointer gap-3 rounded-md border bg-background p-3 text-foreground">
                          <input type="radio" name="existing-delivery" checked={existingDelivery === "send"} onChange={() => { setExistingDelivery("send"); setDeliveryChoiceTouched(true); }} />
                          <span><strong>Send to all selected users</strong><span className="block text-sm text-muted-foreground">Create missing accounts and resend login details once to each existing account.</span></span>
                        </label>
                      </div>
                    </div>
                  )}

                  {preview.linkExistingCount ? <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100"><Link2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{preview.linkExistingCount} parent record{preview.linkExistingCount === 1 ? "" : "s"} will be linked to an existing FCGS parent account instead of creating a duplicate account.</span></div> : null}
                  {preview.exceptionCount > 0 && <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><div className="font-medium text-destructive">{preview.exceptionCount} record{preview.exceptionCount === 1 ? "" : "s"} require attention and will not be processed.</div>{(preview.exceptions || []).slice(0, 8).map((row) => <div key={`${row.recipientId}-${row.reasonCode}`}><strong>{row.recipientName}:</strong> {row.reason}</div>)}</div>}
                  {!preview.channels.communicationsDisabled && !preview.channels.emailConfigured && !preview.channels.smsConfigured && <div className="flex gap-2 rounded-md border border-destructive/30 p-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Neither email nor SMS is configured on this server. No login details can currently be delivered.</div>}
                </>
              ) : null}

              {currentJob && (
                <div className="space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-medium">Current distribution</div><div className="text-sm text-muted-foreground">{currentJob.processedCount || 0} of {currentJob.totalCount || 0} processed</div></div><Badge variant={currentJob.status === "failed" ? "destructive" : currentJob.status === "completed" ? "secondary" : "outline"}>{currentJob.status}</Badge></div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} /></div>
                  {currentJob.status === "queued" || currentJob.status === "running" ? <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending continues in the background. You may close this window.</div> : (
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                      <div><span className="text-muted-foreground">Sent:</span> <strong>{currentJob.successCount || 0}</strong></div>
                      <div><span className="text-muted-foreground">Created:</span> <strong>{currentJob.metadata?.createdCount || 0}</strong></div>
                      <div><span className="text-muted-foreground">Linked:</span> <strong>{currentJob.metadata?.linkedCount || 0}</strong></div>
                      <div><span className="text-muted-foreground">Skipped:</span> <strong>{currentJob.skippedCount || 0}</strong></div>
                      <div><span className="text-muted-foreground">Exceptions:</span> <strong>{currentJob.failedCount || 0}</strong></div>
                    </div>
                  )}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
                {!isJobTerminal && !currentJob && <Button onClick={() => startDistribution()} disabled={sendMutation.isPending || previewQuery.isLoading || !preview || preview.totalCount === 0}>
                  {sendMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{primaryActionLabel}
                </Button>}
              </DialogFooter>
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <div className="flex items-center justify-between gap-3"><div><div className="font-medium">Login distribution history</div><div className="text-sm text-muted-foreground">Completed deliveries and exceptions remain available here.</div></div><Button variant="outline" size="sm" onClick={() => historyQuery.refetch()} disabled={historyQuery.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${historyQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button></div>
              {historyQuery.isLoading ? <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading history...</div> : !(historyQuery.data || []).length ? <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">No login distribution runs have been recorded yet.</div> : (
                <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Processed</TableHead><TableHead>Sent</TableHead><TableHead>New accounts</TableHead><TableHead>Exceptions</TableHead><TableHead>By</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{(historyQuery.data || []).map((job) => <TableRow key={job.id}><TableCell className="whitespace-nowrap">{formatDateTime(job.createdAt)}</TableCell><TableCell>{job.processedCount}/{job.totalCount}</TableCell><TableCell>{job.successCount}</TableCell><TableCell>{job.metadata?.createdCount || 0}</TableCell><TableCell>{job.failedCount || 0}</TableCell><TableCell>{job.requestedByName || "—"}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setSelectedHistoryJobId(job.id)}>View</Button></TableCell></TableRow>)}</TableBody></Table></div>
              )}
              {selectedHistoryJobId && historyDetailQuery.isLoading && <div className="flex items-center justify-center rounded-md border py-8 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading run details...</div>}
              {selectedHistoryJob && (
                <div className="space-y-4 rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-medium">Run #{selectedHistoryJob.id} details</div><div className="text-sm text-muted-foreground">{formatDateTime(selectedHistoryJob.createdAt)} · {selectedHistoryJob.requestedByName || "Unknown administrator"}</div></div>{retryIds.length > 0 && <Button variant="outline" size="sm" onClick={() => startDistribution(retryIds)} disabled={sendMutation.isPending}><RefreshCw className="mr-2 h-4 w-4" />Retry Failed ({retryIds.length})</Button>}</div>
                  {failedOutcomes.length > 0 && <div className="space-y-2"><div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Exceptions ({failedOutcomes.length})</div><div className="max-h-56 overflow-y-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Username</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader><TableBody>{failedOutcomes.map((row, index) => <TableRow key={`${row.recipientId}-${index}`}><TableCell>{row.recipientName}</TableCell><TableCell className="font-mono text-xs">{row.username || "—"}</TableCell><TableCell>{row.reason || "Could not send login details"}</TableCell></TableRow>)}</TableBody></Table></div></div>}
                  {sentOutcomes.length > 0 && <div className="space-y-2"><div className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" />Sent ({sentOutcomes.length})</div><div className="max-h-64 overflow-y-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Username</TableHead><TableHead>Account</TableHead><TableHead>Delivery</TableHead></TableRow></TableHeader><TableBody>{sentOutcomes.map((row, index) => <TableRow key={`${row.recipientId}-${index}`}><TableCell>{row.recipientName}</TableCell><TableCell className="font-mono text-xs">{row.username || "—"}</TableCell><TableCell>{row.accountAction === "created" ? "Created" : row.accountAction === "linked" ? "Linked" : "Existing"}</TableCell><TableCell className="text-xs">{(row.deliveries || []).filter((delivery) => delivery.success).map((delivery) => delivery.channel.toUpperCase()).join(", ") || "Sent"}</TableCell></TableRow>)}</TableBody></Table></div></div>}
                  {skippedOutcomes.length > 0 && <div className="text-sm text-muted-foreground">{skippedOutcomes.length} record{skippedOutcomes.length === 1 ? " was" : "s were"} skipped according to the selected delivery option or because the same portal account had already been processed.</div>}
                  {!outcomes.length && <div className="text-sm text-muted-foreground">Detailed recipient results were not recorded for this run.</div>}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
