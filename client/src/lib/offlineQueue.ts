import { apiRequest, queryClient } from "@/lib/queryClient";

export type OfflineQueueStatus = "pending" | "syncing" | "failed" | "synced";
export type OfflineConnectionState = "online" | "offline" | "connecting";

export interface OfflineQueueItem {
  id: string;
  module: "attendance" | "marks" | string;
  title: string;
  subtitle?: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  body?: any;
  createdAt: string;
  updatedAt: string;
  status: OfflineQueueStatus;
  attempts: number;
  lastError?: string;
  keepSyncedUntil?: string;
  invalidateKeys?: string[];
}

export interface OfflineQueueSnapshot {
  items: OfflineQueueItem[];
  online: boolean;
  isSyncing: boolean;
  connectionState: OfflineConnectionState;
}

const STORAGE_KEY = "fcgs_offline_sync_queue_v1";
const SYNCED_KEEP_MS = 24 * 60 * 60 * 1000;
let isSyncing = false;
let started = false;
let connectionState: OfflineConnectionState = typeof navigator === "undefined" ? "online" : (navigator.onLine ? "online" : "offline");
const listeners = new Set<(snapshot: OfflineQueueSnapshot) => void>();

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {}
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readItems(): OfflineQueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch {
    return [];
  }
}

function writeItems(items: OfflineQueueItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  notify();
}

function cleanup(items: OfflineQueueItem[]) {
  const now = Date.now();
  return items.filter((item) => {
    if (item.status !== "synced") return true;
    if (!item.keepSyncedUntil) return false;
    return new Date(item.keepSyncedUntil).getTime() > now;
  });
}

function snapshot(): OfflineQueueSnapshot {
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  return {
    items: cleanup(readItems()),
    online,
    isSyncing,
    connectionState: !online ? "offline" : (isSyncing || connectionState === "connecting" ? "connecting" : "online"),
  };
}

function notify() {
  const snap = snapshot();
  listeners.forEach((listener) => listener(snap));
}

export function subscribeOfflineQueue(listener: (snapshot: OfflineQueueSnapshot) => void) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function getOfflineQueueSnapshot() {
  return snapshot();
}

export function enqueueOfflineRequest(input: Omit<OfflineQueueItem, "id" | "createdAt" | "updatedAt" | "status" | "attempts"> & { id?: string }) {
  const existing = cleanup(readItems());
  const createdAt = nowIso();
  const id = input.id || createId();
  const existingItem = existing.find((item) => item.id === id);
  const item: OfflineQueueItem = {
    ...input,
    id,
    createdAt: existingItem?.createdAt || createdAt,
    updatedAt: createdAt,
    status: "pending",
    attempts: existingItem?.attempts || 0,
    lastError: undefined,
  };
  const nextItems = existingItem
    ? existing.map((entry) => entry.id === id ? item : entry)
    : [...existing, item];
  writeItems(nextItems);
  if (typeof navigator === "undefined" || navigator.onLine) {
    window.setTimeout(() => syncOfflineQueue(), 250);
  }
  return item;
}

function updateItem(id: string, patch: Partial<OfflineQueueItem>) {
  const items = cleanup(readItems()).map((item) => (
    item.id === id ? { ...item, ...patch, updatedAt: nowIso() } : item
  ));
  writeItems(items);
}

export function removeOfflineQueueItem(id: string) {
  writeItems(cleanup(readItems()).filter((item) => item.id !== id));
}

export function retryOfflineQueueItem(id: string) {
  updateItem(id, { status: "pending", lastError: undefined });
  return syncOfflineQueue();
}

export async function syncOfflineQueue() {
  if (typeof window === "undefined") return;
  if (isSyncing) return;
  if (!navigator.onLine) {
    notify();
    return;
  }

  const pending = cleanup(readItems()).filter((item) => item.status === "pending" || item.status === "failed");
  if (pending.length === 0) {
    writeItems(cleanup(readItems()));
    return;
  }

  isSyncing = true;
  connectionState = "connecting";
  notify();

  try {
    for (const item of pending) {
      if (!navigator.onLine) break;
      updateItem(item.id, { status: "syncing", attempts: item.attempts + 1, lastError: undefined });
      try {
        const res = await apiRequest(item.method as any, item.url, item.body);
        if (!res.ok) {
          let message = `Sync failed with status ${res.status}`;
          try {
            const data = await res.clone().json();
            message = data?.message || message;
          } catch {}
          throw new Error(message);
        }
        updateItem(item.id, {
          status: "synced",
          lastError: undefined,
          keepSyncedUntil: new Date(Date.now() + SYNCED_KEEP_MS).toISOString(),
        });
        for (const key of item.invalidateKeys || []) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
      } catch (error: any) {
        updateItem(item.id, {
          status: "failed",
          lastError: error?.message || "Sync failed",
        });
      }
    }
  } finally {
    isSyncing = false;
    connectionState = navigator.onLine ? "online" : "offline";
    notify();
  }
}

export function startOfflineSyncManager() {
  if (started || typeof window === "undefined") return;
  started = true;
  const handleOnline = () => {
    connectionState = "connecting";
    notify();
    window.setTimeout(() => syncOfflineQueue(), 250);
  };
  const handleOffline = () => {
    connectionState = "offline";
    notify();
  };
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  window.setInterval(() => syncOfflineQueue(), 30000);
  window.setTimeout(() => syncOfflineQueue(), 1000);
}

export function isLikelyNetworkError(error: any) {
  const message = String(error?.message || error || "").toLowerCase();
  return !navigator.onLine || message.includes("failed to fetch") || message.includes("network") || message.includes("load failed");
}
