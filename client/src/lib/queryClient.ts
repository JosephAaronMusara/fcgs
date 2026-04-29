import { QueryClient, QueryFunction } from "@tanstack/react-query";
import {
  getUserActivityHeaders,
  markSessionRefresh,
  notifySessionExpired,
} from "./session";

function shouldNotifyUnauthorized(url: string): boolean {
  const path = url.split("?")[0];
  return (
    path.startsWith("/api/") &&
    path !== "/api/auth/user" &&
    path !== "/api/auth/login" &&
    path !== "/api/auth/logout" &&
    path !== "/api/auth/register" &&
    path !== "/api/auth/reset-password-with-token" &&
    !path.startsWith("/api/public/")
  );
}

async function throwIfResNotOk(res: Response, url: string) {
  if (!res.ok) {
    if (res.status === 401 && shouldNotifyUnauthorized(url)) {
      notifySessionExpired("unauthorized");
    }

    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export function getSchoolContextHeaders(): Record<string, string> {
  const schoolId = localStorage.getItem("currentSchoolId");
  return schoolId ? { "X-School-Id": schoolId } : {};
}

export function schoolFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const schoolId = localStorage.getItem("currentSchoolId");
  if (schoolId && !headers.has("X-School-Id")) {
    headers.set("X-School-Id", schoolId);
  }

  for (const [key, value] of Object.entries(getUserActivityHeaders())) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: options.credentials ?? "include",
  }).then((res) => {
    if (res.ok && headers.has("X-FCGS-User-Activity")) {
      markSessionRefresh();
    }
    if (res.status === 401 && shouldNotifyUnauthorized(url)) {
      notifySessionExpired("unauthorized");
    }
    return res;
  });
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers = new Headers({
    ...getSchoolContextHeaders(),
    ...getUserActivityHeaders(),
  });

  if (data && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (res.ok && (url === "/api/auth/keep-alive" || headers.has("X-FCGS-User-Activity"))) {
    markSessionRefresh();
  }

  await throwIfResNotOk(res, url);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const headers = new Headers({
      ...getSchoolContextHeaders(),
      ...getUserActivityHeaders(),
    });

    const res = await fetch(url, {
      credentials: "include",
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (res.ok && headers.has("X-FCGS-User-Activity")) {
      markSessionRefresh();
    }

    await throwIfResNotOk(res, url);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
