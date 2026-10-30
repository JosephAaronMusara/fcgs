import { useEffect, useMemo, useState } from "react";
import { Cloud, CloudOff, RefreshCcw, AlertTriangle, CheckCircle2, Clock3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { subscribeOfflineQueue, startOfflineSyncManager, syncOfflineQueue, retryOfflineQueueItem, removeOfflineQueueItem, type OfflineQueueSnapshot } from "@/lib/offlineQueue";

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function OfflineSyncStatus() {
  const [open, setOpen] = useState(false);
  const [dismissedBannerId, setDismissedBannerId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<OfflineQueueSnapshot>({ items: [], online: true, isSyncing: false, connectionState: "online" });

  useEffect(() => {
    startOfflineSyncManager();
    return subscribeOfflineQueue(setSnapshot);
  }, []);

  const counts = useMemo(() => {
    const pending = snapshot.items.filter((item) => item.status === "pending").length;
    const syncing = snapshot.items.filter((item) => item.status === "syncing").length;
    const failed = snapshot.items.filter((item) => item.status === "failed").length;
    const synced = snapshot.items.filter((item) => item.status === "synced").length;
    return { pending, syncing, failed, synced, active: pending + syncing + failed };
  }, [snapshot.items]);

  const status = !snapshot.online
    ? "offline"
    : counts.failed > 0
      ? "failed"
      : snapshot.isSyncing || counts.syncing > 0
        ? "syncing"
        : counts.pending > 0
          ? "pending"
          : "synced";

  const bannerId = `${status}:${counts.pending}:${counts.syncing}:${counts.failed}:${snapshot.online}`;
  const showBanner = status !== "synced" && dismissedBannerId !== bannerId;

  const config = {
    synced: { icon: CheckCircle2, label: "Synced", badge: "bg-green-600 text-white", banner: "bg-green-600 text-white", message: "All changes are synced." },
    syncing: { icon: RefreshCcw, label: "Syncing", badge: "bg-blue-600 text-white", banner: "bg-blue-600 text-white", message: `Syncing ${counts.syncing || counts.pending || 1} pending change${(counts.syncing || counts.pending) === 1 ? "" : "s"} in the background...` },
    pending: { icon: Clock3, label: `${counts.pending} Pending`, badge: "bg-amber-500 text-amber-950", banner: "bg-amber-500 text-amber-950", message: `${counts.pending} change${counts.pending === 1 ? " is" : "s are"} saved on this device and waiting to sync.` },
    failed: { icon: AlertTriangle, label: "Sync Error", badge: "bg-red-600 text-white", banner: "bg-red-600 text-white", message: `${counts.failed} change${counts.failed === 1 ? "" : "s"} could not sync. Tap the sync icon to review or retry.` },
    offline: { icon: CloudOff, label: counts.active ? `${counts.active} Offline` : "Offline", badge: "bg-orange-500 text-orange-950", banner: "bg-orange-500 text-orange-950", message: "You are offline. Your work is being saved on this device." },
  }[status];

  const Icon = config.icon;
  const cloudColor = snapshot.connectionState === "offline"
    ? "text-red-600 dark:text-red-400"
    : snapshot.connectionState === "connecting"
      ? "text-blue-600 dark:text-blue-400"
      : "text-green-600 dark:text-green-400";

  return (
    <>
      {showBanner && (
        <div className={`fixed left-1/2 top-3 z-[80] flex w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg ${config.banner}`} data-testid="offline-sync-banner">
          <Icon className={`h-4 w-4 shrink-0 ${status === "syncing" ? "animate-spin" : ""}`} />
          <span className="min-w-0 flex-1 truncate">{config.message}</span>
          <button type="button" onClick={() => setDismissedBannerId(bannerId)} className="rounded-full p-0.5 opacity-90 hover:bg-white/20" aria-label="Dismiss sync banner">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} className="relative" data-testid="button-sync-center">
        {status === "synced" ? <Cloud className={`h-4 w-4 ${cloudColor}`} /> : <Icon className={`h-4 w-4 ${cloudColor} ${status === "syncing" ? "animate-spin" : ""}`} />}
        {counts.active > 0 && (
          <span className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${config.badge}`} data-testid="badge-sync-count">
            {counts.active > 99 ? "99+" : counts.active}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2"><Cloud className="h-5 w-5" /> Pending Synchronisation</SheetTitle>
            <SheetDescription>Items saved on this device are kept here until they successfully sync.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Badge className={config.badge}>{config.label}</Badge>
            <Button size="sm" variant="outline" onClick={() => syncOfflineQueue()} disabled={!snapshot.online || snapshot.isSyncing} data-testid="button-sync-now">
              <RefreshCcw className={`mr-2 h-3.5 w-3.5 ${snapshot.isSyncing ? "animate-spin" : ""}`} /> Sync now
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {snapshot.items.length === 0 ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200">Everything is synced.</div>
            ) : snapshot.items.map((item) => {
              const itemClass = item.status === "failed" ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20" : item.status === "synced" ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20" : item.status === "syncing" ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20" : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20";
              return (
                <div key={item.id} className={`rounded-lg border p-3 ${itemClass}`} data-testid={`sync-item-${item.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{item.title}</div>
                      {item.subtitle && <div className="text-xs text-muted-foreground mt-0.5">{item.subtitle}</div>}
                      <div className="mt-1 text-[11px] text-muted-foreground">Saved {timeLabel(item.createdAt)}</div>
                      {item.lastError && <div className="mt-1 text-xs text-red-700 dark:text-red-300">{item.lastError}</div>}
                    </div>
                    <Badge variant="outline" className="capitalize">{item.status}</Badge>
                  </div>
                  {item.status === "failed" && (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => retryOfflineQueueItem(item.id)}>Retry</Button>
                      <Button size="sm" variant="ghost" onClick={() => removeOfflineQueueItem(item.id)}>Remove</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
