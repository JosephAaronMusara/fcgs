import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, getQueryFn } from "./queryClient";
import {
  ACTIVE_SESSION_KEEP_ALIVE_INTERVAL_MS,
  SESSION_EXPIRED_EVENT,
  SESSION_FINAL_COUNTDOWN_MS,
  SESSION_LOGOUT_EVENT,
  SESSION_TIMEOUT_MS,
  SESSION_WARNING_AFTER_MS,
  clearSessionTracking,
  getLastSessionRefreshAt,
  getLastUserActivityAt,
  markSessionRefresh,
  markUserActivity,
  notifySessionLogout,
  parseSessionStorageEvent,
} from "./session";

interface SchoolTermination {
  terminationAt: string;
  terminationStatus: string;
}

interface User {
  id: number;
  username: string;
  email: string | null;
  role: "org_admin" | "school_admin" | "teacher" | "quality_control_officer" | "assistant_teacher" | "librarian" | "student" | "parent";
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  schoolId: number | null;
  organizationId: number | null;
  mustResetPassword?: boolean;
  schoolTermination?: SchoolTermination | null;
  effectivePermissions?: string[];
}

type LogoutReason = "manual" | "timeout";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  currentSchoolId: number | null;
  setCurrentSchoolId: (id: number | null) => void;
  isInSchoolContext: boolean;
  schoolTermination: SchoolTermination | null;
  permissions: string[];
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
  login: (username: string, password: string, loginRole?: string) => Promise<void>;
  logout: (reason?: LogoutReason) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  enterSchool: (schoolId: number) => void;
  exitSchool: () => void;
}

interface RegisterData {
  username: string;
  password: string;
  email?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

function formatCountdown(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [currentSchoolId, setCurrentSchoolId] = useState<number | null>(() => {
    const stored = localStorage.getItem("currentSchoolId");
    return stored ? parseInt(stored) : null;
  });
  const [sessionWarningOpen, setSessionWarningOpen] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(SESSION_FINAL_COUNTDOWN_MS / 1000);
  const [isExtendingSession, setIsExtendingSession] = useState(false);
  const sessionWarningOpenRef = useRef(false);
  const lastActivityWriteAtRef = useRef(0);
  const keepAliveInFlightRef = useRef(false);
  const hasHandledSessionEndRef = useRef(false);
  const timeoutLogoutInFlightRef = useRef(false);

  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    sessionWarningOpenRef.current = sessionWarningOpen;
  }, [sessionWarningOpen]);

  const clearAuthenticatedClientState = useCallback(() => {
    queryClient.setQueryData(["/api/auth/user"], null);
    queryClient.clear();
    setCurrentSchoolId(null);
    localStorage.removeItem("currentSchoolId");
    clearSessionTracking();
    setSessionWarningOpen(false);
  }, []);

  const handleSessionEnded = useCallback((reason: "timeout" | "expired" | "logout" = "expired", showToast = true) => {
    if (hasHandledSessionEndRef.current) return;
    hasHandledSessionEndRef.current = true;
    clearAuthenticatedClientState();

    if (showToast) {
      toast({
        title: reason === "timeout" ? "Session timed out" : reason === "logout" ? "Signed out" : "Session expired",
        description:
          reason === "timeout"
            ? "You were signed out after 60 minutes of inactivity. Please log in again."
            : reason === "logout"
              ? "You were signed out in another tab."
              : "Your session is no longer active. Please log in again.",
      });
    }
  }, [clearAuthenticatedClientState, toast]);

  const extendSession = useCallback(async (showSuccessToast = false) => {
    if (keepAliveInFlightRef.current) return;

    keepAliveInFlightRef.current = true;
    setIsExtendingSession(true);

    try {
      await apiRequest("POST", "/api/auth/keep-alive");
      const now = Date.now();
      markUserActivity(now);
      markSessionRefresh(now);
      setSessionWarningOpen(false);
      setCountdownSeconds(SESSION_FINAL_COUNTDOWN_MS / 1000);
      hasHandledSessionEndRef.current = false;

      if (showSuccessToast) {
        toast({
          title: "Session extended",
          description: "You will remain signed in while you continue working.",
        });
      }
    } catch (error) {
      handleSessionEnded("expired", true);
    } finally {
      keepAliveInFlightRef.current = false;
      setIsExtendingSession(false);
    }
  }, [handleSessionEnded, toast]);

  const loginMutation = useMutation({
    mutationFn: async ({ username, password, loginRole }: { username: string; password: string; loginRole?: string }) => {
      const response = await apiRequest("POST", "/api/auth/login", { username, password, loginRole });
      return response.json();
    },
    onSuccess: (data) => {
      hasHandledSessionEndRef.current = false;
      timeoutLogoutInFlightRef.current = false;
      const now = Date.now();
      markUserActivity(now);
      markSessionRefresh(now);
      queryClient.setQueryData(["/api/auth/user"], data);
      if (data.role === "org_admin") {
        setCurrentSchoolId(null);
        localStorage.removeItem("currentSchoolId");
      } else if (data.schoolId) {
        setCurrentSchoolId(data.schoolId);
        localStorage.setItem("currentSchoolId", data.schoolId.toString());
      }
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async (reason: LogoutReason = "manual") => {
      try {
        await apiRequest("POST", "/api/auth/logout", { reason });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.startsWith("401:")) {
          throw error;
        }
      }
    },
    onSettled: (_data, _error, reason = "manual") => {
      clearAuthenticatedClientState();
      notifySessionLogout(reason);
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: RegisterData) => {
      const response = await apiRequest("POST", "/api/auth/register", data);
      return response.json();
    },
    onSuccess: (data) => {
      const now = Date.now();
      markUserActivity(now);
      markSessionRefresh(now);
      queryClient.setQueryData(["/api/auth/user"], data);
    },
  });

  const login = useCallback(async (username: string, password: string, loginRole?: string) => {
    await loginMutation.mutateAsync({ username, password, loginRole });
  }, [loginMutation.mutateAsync]);

  const logout = useCallback(async (reason: LogoutReason = "manual") => {
    await logoutMutation.mutateAsync(reason);
  }, [logoutMutation.mutateAsync]);

  const register = useCallback(async (data: RegisterData) => {
    await registerMutation.mutateAsync(data);
  }, [registerMutation.mutateAsync]);

  const enterSchool = useCallback((schoolId: number) => {
    setCurrentSchoolId(schoolId);
    localStorage.setItem("currentSchoolId", schoolId.toString());
    queryClient.invalidateQueries();
  }, []);

  const exitSchool = useCallback(() => {
    setCurrentSchoolId(null);
    localStorage.removeItem("currentSchoolId");
    queryClient.invalidateQueries();
  }, []);

  useEffect(() => {
    if (!user) {
      setSessionWarningOpen(false);
      return;
    }

    hasHandledSessionEndRef.current = false;
    timeoutLogoutInFlightRef.current = false;
    const now = Date.now();
    markUserActivity(now);
    void extendSession(false);
  }, [user?.id, extendSession]);

  useEffect(() => {
    if (!user) return;

    const activityEvents: Array<keyof WindowEventMap> = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "wheel", "pointerdown"];
    const recordActivity = () => {
      if (sessionWarningOpenRef.current) return;

      const now = Date.now();
      const previousActivityAt = getLastUserActivityAt();
      if (previousActivityAt && now - previousActivityAt >= SESSION_WARNING_AFTER_MS) return;
      if (now - lastActivityWriteAtRef.current < 1000) return;

      lastActivityWriteAtRef.current = now;
      markUserActivity(now);
    };

    const recordVisibleActivity = () => {
      if (document.visibilityState === "visible") {
        recordActivity();
      }
    };

    activityEvents.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }));
    document.addEventListener("visibilitychange", recordVisibleActivity);

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
      document.removeEventListener("visibilitychange", recordVisibleActivity);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const interval = window.setInterval(() => {
      const now = Date.now();
      const lastActivityAt = getLastUserActivityAt() ?? now;
      const idleMs = now - lastActivityAt;

      if (idleMs >= SESSION_TIMEOUT_MS) {
        setSessionWarningOpen(false);
        if (!timeoutLogoutInFlightRef.current) {
          timeoutLogoutInFlightRef.current = true;
          void logout("timeout");
        }
        return;
      }

      if (idleMs >= SESSION_WARNING_AFTER_MS) {
        setSessionWarningOpen(true);
        setCountdownSeconds(Math.ceil((SESSION_TIMEOUT_MS - idleMs) / 1000));
        return;
      }

      setSessionWarningOpen(false);
      setCountdownSeconds(SESSION_FINAL_COUNTDOWN_MS / 1000);

      const lastSessionRefreshAt = getLastSessionRefreshAt() ?? 0;
      const shouldKeepAlive =
        now - lastSessionRefreshAt >= ACTIVE_SESSION_KEEP_ALIVE_INTERVAL_MS &&
        now - lastActivityAt <= ACTIVE_SESSION_KEEP_ALIVE_INTERVAL_MS;

      if (shouldKeepAlive) {
        void extendSession(false);
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [extendSession, logout, user]);

  useEffect(() => {
    const handleExpired = () => handleSessionEnded("expired", true);
    const handleLogout = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      handleSessionEnded(reason === "timeout" ? "timeout" : "logout", reason !== "manual");
    };
    const handleStorage = (event: StorageEvent) => {
      const sessionEvent = parseSessionStorageEvent(event);
      if (!sessionEvent) return;

      if (sessionEvent.type === "expired") {
        handleSessionEnded("expired", true);
      } else if (sessionEvent.type === "logout") {
        handleSessionEnded(sessionEvent.reason === "timeout" ? "timeout" : "logout", sessionEvent.reason !== "manual");
      }
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    window.addEventListener(SESSION_LOGOUT_EVENT, handleLogout);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired);
      window.removeEventListener(SESSION_LOGOUT_EVENT, handleLogout);
      window.removeEventListener("storage", handleStorage);
    };
  }, [handleSessionEnded]);

  const normalizedUser = user ?? null;
  const isInSchoolContext = user?.role === "org_admin" ? currentSchoolId !== null : true;

  const schoolTermination = user?.schoolTermination ?? null;
  const permissions = useMemo(() => user?.effectivePermissions ?? [], [user?.effectivePermissions]);
  const hasPermission = useCallback((permission: string) => permissions.includes(permission), [permissions]);
  const hasAnyPermission = useCallback(
    (...permissionCodes: string[]) => permissionCodes.some(permission => permissions.includes(permission)),
    [permissions],
  );

  const contextValue = useMemo<AuthContextType>(() => ({
    user: normalizedUser,
    isLoading,
    currentSchoolId,
    setCurrentSchoolId,
    isInSchoolContext,
    schoolTermination,
    permissions,
    hasPermission,
    hasAnyPermission,
    login,
    logout,
    register,
    enterSchool,
    exitSchool,
  }), [
    normalizedUser,
    isLoading,
    currentSchoolId,
    isInSchoolContext,
    schoolTermination,
    permissions,
    hasPermission,
    hasAnyPermission,
    login,
    logout,
    register,
    enterSchool,
    exitSchool,
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
      <AlertDialog open={sessionWarningOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center justify-center gap-2 text-center sm:justify-start sm:text-left">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Session timeout warning
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center sm:text-left">
              You have been inactive for 50 minutes. For security, you will be signed out automatically in{" "}
              <span className="font-semibold text-foreground">{formatCountdown(countdownSeconds)}</span> unless you continue your session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void logout("manual")}
              disabled={isExtendingSession || logoutMutation.isPending}
              data-testid="button-session-logout-now"
            >
              Log out now
            </Button>
            <Button
              type="button"
              onClick={() => void extendSession(true)}
              disabled={isExtendingSession || logoutMutation.isPending}
              data-testid="button-session-stay-signed-in"
            >
              {isExtendingSession ? "Extending..." : "Stay signed in"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function useRequireAuth() {
  const { user, isLoading } = useAuth();
  return { user, isLoading, isAuthenticated: !!user };
}
