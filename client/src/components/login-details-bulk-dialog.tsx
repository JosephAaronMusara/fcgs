import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, History, KeyRound, Loader2, RefreshCw, Send } from "lucide-react";
import { apiRequest, queryClient, schoolFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type RecipientType = "parent" | "student" | "staff";

type DistributionRequest = {
  recipientType: RecipientType;
  recipientIds: number[];
  search?: string;
  classFilter?: string;
  statusFilter?: string;
};

type DistributionPreview = {
  totalCount: number;
  existingCount: number;
  createCount: number;
  missingContactCount: number;
  attentionCount: number;
  exceptionCount: number;
  scope: "selected" | "filtered";
  channels: {
    emailConfigured: boolean;
    smsConfigured: boolean;
    communicationsDisabled: boolean;
  };
};

type DeliveryOutcome = {
  channel: "email" | "sms";
  destination: string;
  success: boolean;
  error?: string | null;
};

type RecipientOutcome = {
  recipientId: number;
  recipientName: string;
  username?: string | null;
  status: "sent" | "failed";
  accountAction: "existing" | "created" | "none";
  reasonCode?: string | null;
  reason?: string | null;
  deliveries?: DeliveryOutcome[];
};

type DistributionMetadata = {
  recipientType?: RecipientType;
  scope?: "selected" | "filtered";
  createdCount?: number;
  existingSentCount?: number;
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
}

function pluralLabel(type: RecipientType) {
  if (type === "staff") return "staff members";
  return `${type}s`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function LoginDetailsBulkDialog({
  recipientType,
  selectedIds,
  search = "",
  classFilter = "all",
  statusFilter = "all",
}: LoginDetailsBulkDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("send");
  const [jobId, setJobId] = useState<number | null>(null);
  const [selectedHistoryJobId, setSelectedHistoryJobId] = useState<number | null>(null);
  const completionToastRef = useRef<number | null>(null);

  const baseRequest = useMemo<DistributionRequest>(() => ({
    recipientType,
    recipientIds: selectedIds,
    search,
    classFilter,
    statusFilter,
  }), [recipientType, selectedIds, search, classFilter, statusFilter]);

  const previewQuery = useQuery<DistributionPreview>({
    queryKey: ["/api/account-distribution/preview", recipientType, selectedIds.join(","), search, classFilter, statusFilter],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/account-distribution/preview", baseRequest);
      return res.json();
    },
  });

  const historyQuery = useQuery<DistributionJob[]>({
    queryKey: ["/api/account-distribution/history", recipientType],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const res = await schoolFetch(`/api/account-distribution/history?recipientType=${encodeURIComponent(recipientType)}`);
      if (!res.ok) throw new Error("Failed to load login distribution history");
      return res.json();
    },
  });

  const historyDetailQuery = useQuery<DistributionJob>({
    queryKey: ["/api/account-distribution/history/detail", selectedHistoryJobId],
    enabled: open && !!selectedHistoryJobId,
    staleTime: 0,
    queryFn: async () => {
      const res = await schoolFetch(`/api/account-distribution/history/${selectedHistoryJobId}`);
      if (!res.ok) throw new Error("Failed to load distribution details");
      return res.json();
    },
  });

  const jobQuery = useQuery<DistributionJob>({
    queryKey: ["/api/communication/jobs", jobId],
    enabled: !!jobId,
    staleTime: 0,
    queryFn: async () => {
      const res = await schoolFetch(`/api/communication/jobs/${jobId}`);
      if (!res.ok) throw new Error("Failed to load distribution progress");
      return res.json();
    },
    refetchInterval: (query) => {
      const status = (query.state.data as DistributionJob | undefined)?.status;
      return status === "completed" || status === "failed" ? false : 1200;
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (request: DistributionRequest) => {
      const res = await apiRequest("POST", "/api/account-distribution/send", request);
      return res.json() as Promise<{ jobId: number; message: string }>;
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      setActiveTab("send");
      setSelectedHistoryJobId(null);
      completionToastRef.current = null;
      toast({ title: "Login details queued", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Could not start distribution", description: error.message, variant: "destructive" });
    },
  });

  const currentJob = jobQuery.data;
  useEffect(() => {
    if (!currentJob || (currentJob.status !== "completed" && currentJob.status !== "failed")) return;
    if (completionToastRef.current === currentJob.id) return;
    completionToastRef.current = currentJob.id;
    queryClient.invalidateQueries({ queryKey: ["/api/account-distribution/history", recipientType] });
    queryClient.invalidateQueries({ queryKey: ["/api/account-distribution/preview", recipientType] });
    const exceptions = (currentJob.failedCount || 0) + (currentJob.skippedCount || 0);
    toast({
      title: currentJob.status === "completed" ? "Login distribution complete" : "Login distribution stopped",
      description: `${currentJob.successCount || 0} sent successfully${exceptions ? `; ${exceptions} exception${exceptions === 1 ? "" : "s"}` : ""}.`,
      variant: currentJob.status === "failed" ? "destructive" : "default",
    });
  }, [currentJob, recipientType, toast]);

  useEffect(() => {
    if (!open) {
      setSelectedHistoryJobId(null);
      setActiveTab("send");
    }
  }, [open]);

  const preview = previewQuery.data;
  const selectedHistoryJob = historyDetailQuery.data || null;
  const outcomes = selectedHistoryJob?.metadata?.outcomes || [];
  const exceptions = outcomes.filter((row) => row.status === "failed");
  const successes = outcomes.filter((row) => row.status === "sent");
  const retryIds = Array.from(new Set(exceptions.map((row) => row.recipientId).filter((id) => Number.isFinite(id))));

  const startDistribution = (recipientIdsOverride?: number[]) => {
    sendMutation.mutate({
      ...baseRequest,
      recipientIds: recipientIdsOverride ?? baseRequest.recipientIds,
      ...(recipientIdsOverride ? { search: "", classFilter: "all", statusFilter: "all" } : {}),
    });
  };

  const progressPercent = currentJob?.totalCount
    ? Math.min(100, Math.round(((currentJob.processedCount || 0) / currentJob.totalCount) * 100))
    : 0;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid={`button-send-login-details-${recipientType}`}>
        <KeyRound className="w-4 h-4 mr-2" />
        Send Login Details
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Send Login Details</DialogTitle>
            <DialogDescription>
              {selectedIds.length > 0
                ? `Process the ${selectedIds.length} selected ${pluralLabel(recipientType)}.`
                : `Process all active ${pluralLabel(recipientType)} matching the current page filters.`}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList>
              <TabsTrigger value="send" className="gap-2"><Send className="h-4 w-4" />Send</TabsTrigger>
              <TabsTrigger value="history" className="gap-2"><History className="h-4 w-4" />History</TabsTrigger>
            </TabsList>

            <TabsContent value="send" className="space-y-4">
              {previewQuery.isLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Checking accounts...
                </div>
              ) : previewQuery.isError ? (
                <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
                  Could not prepare the distribution preview. {(previewQuery.error as Error)?.message || ""}
                </div>
              ) : preview ? (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">To process</div>
                      <div className="text-2xl font-semibold">{preview.totalCount}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Existing accounts</div>
                      <div className="text-2xl font-semibold">{preview.existingCount}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Accounts to create</div>
                      <div className="text-2xl font-semibold">{preview.createCount}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Cannot be contacted</div>
                      <div className="text-2xl font-semibold">{preview.missingContactCount}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Require attention</div>
                      <div className="text-2xl font-semibold">{preview.attentionCount}</div>
                    </div>
                  </div>

                  <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-2">
                    <p><strong>Existing accounts:</strong> the existing username is sent. The current password is not changed. A secure one-time reset link is included in case the user does not remember it.</p>
                    <p><strong>New accounts:</strong> the account is created automatically and a one-time password setup link, valid for 24 hours, is sent.</p>
                    <p><strong>Delivery:</strong> SMS and email are both used where valid contact details and configured channels are available.</p>
                  </div>

                  {preview.channels.communicationsDisabled && (
                    <div className="flex gap-2 rounded-md border border-destructive/30 p-3 text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      Communications are currently disabled by the IT Administrator. The operation can be recorded, but messages will fail until communications are enabled.
                    </div>
                  )}
                  {!preview.channels.communicationsDisabled && !preview.channels.emailConfigured && !preview.channels.smsConfigured && (
                    <div className="flex gap-2 rounded-md border border-destructive/30 p-3 text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      Neither email nor SMS is configured on this server. No login details can currently be delivered.
                    </div>
                  )}
                </>
              ) : null}

              {currentJob && (
                <div className="rounded-md border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-medium">Current distribution</div>
                      <div className="text-sm text-muted-foreground">{currentJob.processedCount || 0} of {currentJob.totalCount || 0} processed</div>
                    </div>
                    <Badge variant={currentJob.status === "failed" ? "destructive" : currentJob.status === "completed" ? "secondary" : "outline"}>
                      {currentJob.status}
                    </Badge>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
                  </div>
                  {(currentJob.status === "queued" || currentJob.status === "running") ? (
                    <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending continues in the background. You may close this window.</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
                      <div><span className="text-muted-foreground">Sent:</span> <strong>{currentJob.successCount || 0}</strong></div>
                      <div><span className="text-muted-foreground">Created:</span> <strong>{currentJob.metadata?.createdCount || 0}</strong></div>
                      <div><span className="text-muted-foreground">Exceptions:</span> <strong>{(currentJob.failedCount || 0) + (currentJob.skippedCount || 0)}</strong></div>
                      <div>
                        <Button variant="link" className="h-auto p-0" onClick={() => setActiveTab("history")}>View History</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
                <Button
                  onClick={() => startDistribution()}
                  disabled={sendMutation.isPending || previewQuery.isLoading || !preview || preview.totalCount === 0}
                >
                  {sendMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  Create & Send
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Login distribution history</div>
                  <div className="text-sm text-muted-foreground">Successful deliveries and exceptions remain available here after the completion message is dismissed.</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => historyQuery.refetch()} disabled={historyQuery.isFetching}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${historyQuery.isFetching ? "animate-spin" : ""}`} />Refresh
                </Button>
              </div>

              {historyQuery.isLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading history...</div>
              ) : (historyQuery.data || []).length === 0 ? (
                <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">No login distribution runs have been recorded yet.</div>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Processed</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead>New accounts</TableHead>
                        <TableHead>Exceptions</TableHead>
                        <TableHead>By</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(historyQuery.data || []).map((job) => (
                        <TableRow key={job.id}>
                          <TableCell className="whitespace-nowrap">{formatDateTime(job.createdAt)}</TableCell>
                          <TableCell>{job.processedCount}/{job.totalCount}</TableCell>
                          <TableCell>{job.successCount}</TableCell>
                          <TableCell>{job.metadata?.createdCount || 0}</TableCell>
                          <TableCell>{(job.failedCount || 0) + (job.skippedCount || 0)}</TableCell>
                          <TableCell>{job.requestedByName || "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => setSelectedHistoryJobId(job.id)}>View</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {selectedHistoryJobId && historyDetailQuery.isLoading && (
                <div className="flex items-center justify-center rounded-md border py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading run details...</div>
              )}

              {selectedHistoryJob && (
                <div className="rounded-md border p-4 space-y-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-medium">Run #{selectedHistoryJob.id} details</div>
                      <div className="text-sm text-muted-foreground">{formatDateTime(selectedHistoryJob.createdAt)} · {selectedHistoryJob.requestedByName || "Unknown administrator"}</div>
                    </div>
                    {retryIds.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => startDistribution(retryIds)} disabled={sendMutation.isPending}>
                        <RefreshCw className="h-4 w-4 mr-2" />Retry Failed ({retryIds.length})
                      </Button>
                    )}
                  </div>

                  {exceptions.length > 0 && (
                    <div className="space-y-2">
                      <div className="font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Exceptions ({exceptions.length})</div>
                      <div className="max-h-56 overflow-y-auto rounded-md border">
                        <Table>
                          <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Username</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {exceptions.map((row, index) => (
                              <TableRow key={`${row.recipientId}-${index}`}>
                                <TableCell>{row.recipientName}</TableCell>
                                <TableCell className="font-mono text-xs">{row.username || "—"}</TableCell>
                                <TableCell>{row.reason || "Could not send login details"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {successes.length > 0 && (
                    <div className="space-y-2">
                      <div className="font-medium flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Successful ({successes.length})</div>
                      <div className="max-h-64 overflow-y-auto rounded-md border">
                        <Table>
                          <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Username</TableHead><TableHead>Account</TableHead><TableHead>Delivery</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {successes.map((row, index) => (
                              <TableRow key={`${row.recipientId}-${index}`}>
                                <TableCell>{row.recipientName}</TableCell>
                                <TableCell className="font-mono text-xs">{row.username || "—"}</TableCell>
                                <TableCell>{row.accountAction === "created" ? "Created" : "Existing"}</TableCell>
                                <TableCell className="text-xs">
                                  {(row.deliveries || []).filter((delivery) => delivery.success).map((delivery) => delivery.channel.toUpperCase()).join(", ") || "Sent"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {outcomes.length === 0 && (
                    <div className="text-sm text-muted-foreground">Detailed recipient results were not recorded for this run.</div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
