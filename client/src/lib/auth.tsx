import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "./queryClient";

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
  logout: () => Promise<void>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentSchoolId, setCurrentSchoolId] = useState<number | null>(() => {
    const stored = localStorage.getItem("currentSchoolId");
    return stored ? parseInt(stored) : null;
  });

  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: Infinity,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ username, password, loginRole }: { username: string; password: string; loginRole?: string }) => {
      const response = await apiRequest("POST", "/api/auth/login", { username, password, loginRole });
      return response.json();
    },
    onSuccess: (data) => {
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
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
      queryClient.clear();
      setCurrentSchoolId(null);
      localStorage.removeItem("currentSchoolId");
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: RegisterData) => {
      const response = await apiRequest("POST", "/api/auth/register", data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/user"], data);
    },
  });

  const login = async (username: string, password: string, loginRole?: string) => {
    await loginMutation.mutateAsync({ username, password, loginRole });
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  const register = async (data: RegisterData) => {
    await registerMutation.mutateAsync(data);
  };

  const enterSchool = (schoolId: number) => {
    setCurrentSchoolId(schoolId);
    localStorage.setItem("currentSchoolId", schoolId.toString());
    queryClient.invalidateQueries();
  };

  const exitSchool = () => {
    setCurrentSchoolId(null);
    localStorage.removeItem("currentSchoolId");
    queryClient.invalidateQueries();
  };

  const isInSchoolContext = user?.role === "org_admin" ? currentSchoolId !== null : true;

  const schoolTermination = user?.schoolTermination ?? null;
  const permissions = user?.effectivePermissions ?? [];
  const hasPermission = (permission: string) => permissions.includes(permission);
  const hasAnyPermission = (...permissionCodes: string[]) => permissionCodes.some(permission => permissions.includes(permission));

  return (
    <AuthContext.Provider value={{ 
      user: user ?? null, 
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
    }}>
      {children}
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
