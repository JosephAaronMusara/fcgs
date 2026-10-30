export interface LocalDraft<T = any> {
  key: string;
  module: string;
  title: string;
  data: T;
  updatedAt: string;
}

const PREFIX = "fcgs_local_draft:";

export function saveLocalDraft<T>(key: string, module: string, title: string, data: T) {
  if (typeof window === "undefined") return;
  const draft: LocalDraft<T> = { key, module, title, data, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(draft));
}

export function loadLocalDraft<T = any>(key: string): LocalDraft<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function removeLocalDraft(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${PREFIX}${key}`);
}
