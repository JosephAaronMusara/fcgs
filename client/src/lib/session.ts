export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_WARNING_AFTER_MS = 25 * 60 * 1000;
export const SESSION_FINAL_COUNTDOWN_MS = SESSION_TIMEOUT_MS - SESSION_WARNING_AFTER_MS;
export const ACTIVE_SESSION_KEEP_ALIVE_INTERVAL_MS = 5 * 60 * 1000;
export const RECENT_USER_ACTIVITY_WINDOW_MS = 2 * 60 * 1000;
export const USER_ACTIVITY_HEADER = "X-FCGS-User-Activity";

export const SESSION_EXPIRED_EVENT = "fcgs:session-expired";
export const SESSION_LOGOUT_EVENT = "fcgs:session-logout";

const LAST_USER_ACTIVITY_KEY = "fcgs:last-user-activity-at";
const LAST_SESSION_REFRESH_KEY = "fcgs:last-session-refresh-at";
const SESSION_EVENT_KEY = "fcgs:session-event";

let lastExpiredNotificationAt = 0;

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readNumber(key: string): number | null {
  if (!canUseBrowserStorage()) return null;
  const value = window.localStorage.getItem(key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function writeNumber(key: string, value: number): void {
  if (!canUseBrowserStorage()) return;
  window.localStorage.setItem(key, value.toString());
}

function publishSessionEvent(type: "expired" | "logout", reason?: string): void {
  if (!canUseBrowserStorage()) return;
  window.localStorage.setItem(
    SESSION_EVENT_KEY,
    JSON.stringify({ type, reason, timestamp: Date.now(), nonce: Math.random() }),
  );
}

export function getLastUserActivityAt(): number | null {
  return readNumber(LAST_USER_ACTIVITY_KEY);
}

export function getLastSessionRefreshAt(): number | null {
  return readNumber(LAST_SESSION_REFRESH_KEY);
}

export function markUserActivity(timestamp = Date.now()): void {
  writeNumber(LAST_USER_ACTIVITY_KEY, timestamp);
}

export function markSessionRefresh(timestamp = Date.now()): void {
  writeNumber(LAST_SESSION_REFRESH_KEY, timestamp);
}

export function clearSessionTracking(): void {
  if (!canUseBrowserStorage()) return;
  window.localStorage.removeItem(LAST_USER_ACTIVITY_KEY);
  window.localStorage.removeItem(LAST_SESSION_REFRESH_KEY);
}

export function getUserActivityHeaders(): Record<string, string> {
  const lastActivityAt = getLastUserActivityAt();
  if (!lastActivityAt) return {};

  if (Date.now() - lastActivityAt <= RECENT_USER_ACTIVITY_WINDOW_MS) {
    return { [USER_ACTIVITY_HEADER]: "true" };
  }

  return {};
}

export function notifySessionExpired(reason = "expired"): void {
  if (!canUseBrowserStorage()) return;

  const now = Date.now();
  if (now - lastExpiredNotificationAt < 2000) {
    return;
  }

  lastExpiredNotificationAt = now;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { reason } }));
  publishSessionEvent("expired", reason);
}

export function notifySessionLogout(reason = "manual"): void {
  if (!canUseBrowserStorage()) return;
  window.dispatchEvent(new CustomEvent(SESSION_LOGOUT_EVENT, { detail: { reason } }));
  publishSessionEvent("logout", reason);
}

export function parseSessionStorageEvent(event: StorageEvent): { type: "expired" | "logout"; reason?: string } | null {
  if (event.key !== SESSION_EVENT_KEY || !event.newValue) return null;

  try {
    const parsed = JSON.parse(event.newValue);
    if (parsed?.type === "expired" || parsed?.type === "logout") {
      return { type: parsed.type, reason: parsed.reason };
    }
  } catch (error) {
    return null;
  }

  return null;
}
