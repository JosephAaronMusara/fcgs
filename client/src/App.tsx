import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Archive, ArrowLeft, Bell, Clock, Eye, Mail, MapPin, MessageSquare, Newspaper, RotateCcw } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import Login from "@/pages/login";
import ForceResetPassword from "@/pages/force-reset-password";
import ResetPasswordToken from "@/pages/reset-password-token";
import Dashboard from "@/pages/dashboard";
import OrgDashboard from "@/pages/org-dashboard";
import StaffPage from "@/pages/staff";
import StudentsPage from "@/pages/students";
import ParentsPage from "@/pages/parents";
import ClassesPage from "@/pages/classes";
import SubjectsPage from "@/pages/subjects";
import GradesPage from "@/pages/grades";
import AssessmentsPage from "@/pages/assessments";
import MarksEntryPage from "@/pages/marks-entry";
import AcademicReportsPage from "@/pages/academic-reports";
import AttendancePage from "@/pages/attendance";
import FeesPage from "@/pages/fees";
import DisciplinePage from "@/pages/discipline";
import ClinicPage from "@/pages/clinic";
import MarksPage from "@/pages/marks";
import MyChildrenPage from "@/pages/my-children";
import SchoolSettingsPage from "@/pages/school-settings";
import LibraryPage from "@/pages/library";
import TimetablePage from "@/pages/timetable";
import CalendarPage from "@/pages/calendar";
import LogbookPage from "@/pages/logbook";
import POSPage from "@/pages/pos";
import NewslettersPage from "@/pages/newsletters";
import SchemesPage from "@/pages/schemes";
import HostelPage from "@/pages/hostel";
import HostelsPage from "@/pages/hostels";
import ApplicationsPage from "@/pages/applications";
import MessagesPage from "@/pages/messages";
import ApplyPage from "@/pages/apply";
import QCReportsPage from "@/pages/qc-reports";
import QCReportsClassPage from "@/pages/qc-reports-class";
import QCReportsStudentPage from "@/pages/qc-reports-student";
import RecordOfMarksPage from "@/pages/record-of-marks";
import MyClassesPage from "@/pages/my-classes";
import MyAttendancePage from "@/pages/my-attendance";
import MyGradesPage from "@/pages/my-grades";
import MyProfilePage from "@/pages/my-profile";
import MyNotificationsPage from "@/pages/my-notifications";
import MyNewslettersPage from "@/pages/my-newsletters";
import ChildrenAttendancePage from "@/pages/children-attendance";
import ChildrenReportsPage from "@/pages/children-reports";
import Student360Page from "@/pages/student-360";
import Staff360Page from "@/pages/staff-360";
import KundAiPage from "@/pages/kundai";
import TransportPage from "@/pages/transport";
import ArrearsPage from "@/pages/arrears";
import SchoolExpensesPage from "@/pages/school-expenses";
import SchoolIncomesPage from "@/pages/school-incomes";
import ProductsPage from "@/pages/products";
import FinancialStatementsPage from "@/pages/financial-statements";
import DiscussionForumPage from "@/pages/discussion-forum";
import LearningMaterialsPage from "@/pages/learning-materials";
import NotFound from "@/pages/not-found";


type RoutePermissionRule = {
  pattern: RegExp;
  permissions?: string[];
  allowRoles?: string[];
};

const ROUTE_PERMISSION_RULES: RoutePermissionRule[] = [
  { pattern: /^\/dashboard$/, permissions: ["dashboard.view"] },
  { pattern: /^\/student-360$/, permissions: ["students.view"] },
  { pattern: /^\/staff-360$/, permissions: ["staff.view"] },
  { pattern: /^\/staff$/, permissions: ["staff.view"] },
  { pattern: /^\/students$/, permissions: ["students.view"] },
  { pattern: /^\/parents$/, permissions: ["parents.view"] },
  { pattern: /^\/classes$/, permissions: ["classes.view"] },
  { pattern: /^\/subjects$/, permissions: ["subjects.view"] },
  { pattern: /^\/grades$/, permissions: ["grades.view"] },
  { pattern: /^\/assessments$/, permissions: ["assessments.view"] },
  { pattern: /^\/marks-entry$/, permissions: ["marks.view", "marks.create"] },
  { pattern: /^\/academic-reports$/, permissions: ["reports.view"] },
  { pattern: /^\/qc-reports(\/.*)?$/, permissions: ["qc_reports.view"] },
  { pattern: /^\/attendance$/, permissions: ["attendance.view"] },
  { pattern: /^\/fees$/, permissions: ["fees.view"], allowRoles: ["parent"] },
  { pattern: /^\/clinic$/, permissions: ["clinic.view"] },
  { pattern: /^\/discipline$/, permissions: ["discipline.view"] },
  { pattern: /^\/marks$/, permissions: ["marks.view"] },
  { pattern: /^\/record-of-marks$/, permissions: ["record_of_marks.view"] },
  { pattern: /^\/kundai$/, permissions: ["kundai.view"] },
  { pattern: /^\/transport$/, permissions: ["transport.view"] },
  { pattern: /^\/arrears$/, permissions: ["arrears.view"] },
  { pattern: /^\/school-expenses$/, permissions: ["school_expenses.view"] },
  { pattern: /^\/school-incomes$/, permissions: ["school_incomes.view"] },
  { pattern: /^\/products$/, permissions: ["products.view"] },
  { pattern: /^\/financial-statements$/, permissions: ["financial_statements.view"] },
  { pattern: /^\/discussion-forum$/, permissions: ["discussion_forum.view"] },
  { pattern: /^\/learning-materials$/, permissions: ["learning_materials.view"] },
  { pattern: /^\/settings$/, permissions: ["settings.view"] },
  { pattern: /^\/library$/, permissions: ["library.view"] },
  { pattern: /^\/calendar$/, permissions: ["calendar.view"] },
  { pattern: /^\/timetable$/, permissions: ["timetable.view"] },
  { pattern: /^\/logbook$/, permissions: ["logbook.view"] },
  { pattern: /^\/pos$/, permissions: ["pos.view"] },
  { pattern: /^\/newsletters$/, permissions: ["newsletters.view"] },
  { pattern: /^\/schemes$/, permissions: ["schemes.view"] },
  { pattern: /^\/hostel$/, permissions: ["hostel.view"] },
  { pattern: /^\/hostels$/, permissions: ["hostels.view"] },
  { pattern: /^\/applications$/, permissions: ["applications.view"] },
  { pattern: /^\/messages$/, permissions: ["communication.view"] },
  { pattern: /^\/my-classes$/, allowRoles: ["student"] },
  { pattern: /^\/my-attendance$/, allowRoles: ["student"] },
  { pattern: /^\/my-grades$/, allowRoles: ["student"] },
  { pattern: /^\/my-profile$/, allowRoles: ["student", "parent"] },
  { pattern: /^\/my-notifications$/, allowRoles: ["student", "parent"] },
  { pattern: /^\/my-newsletters$/, allowRoles: ["student", "parent"] },
  { pattern: /^\/children$/, allowRoles: ["parent"] },
  { pattern: /^\/children-attendance$/, allowRoles: ["parent"] },
  { pattern: /^\/children-reports$/, allowRoles: ["parent"] },
];

function getPermissionRuleForPath(path: string): RoutePermissionRule | undefined {
  return ROUTE_PERMISSION_RULES.find(rule => rule.pattern.test(path));
}

function ProtectedRoute({ 
  component: Component 
}: { 
  component: React.ComponentType;
}) {
  const { user, isLoading, isInSchoolContext, hasAnyPermission } = useAuth();
  const [location, setLocation] = useLocation();

  const shouldRedirectLogin = !isLoading && !user;
  const shouldRedirectReset = !isLoading && user?.mustResetPassword;
  const shouldRedirectOrg = !isLoading && user?.role === "org_admin" && !isInSchoolContext;

  useEffect(() => {
    if (shouldRedirectLogin) {
      setLocation("/login");
    } else if (shouldRedirectReset) {
      setLocation("/force-reset-password");
    } else if (shouldRedirectOrg) {
      setLocation("/org");
    }
  }, [shouldRedirectLogin, shouldRedirectReset, shouldRedirectOrg, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user || user.mustResetPassword || (user.role === "org_admin" && !isInSchoolContext)) {
    return null;
  }

  const permissionRule = getPermissionRuleForPath(location);
  const roleAllowed = permissionRule?.allowRoles ? permissionRule.allowRoles.includes(user.role) : false;
  const permissionAllowed = permissionRule?.permissions?.length ? hasAnyPermission(...permissionRule.permissions) : true;
  if ((permissionRule && !roleAllowed && !permissionAllowed) || !permissionRule) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return <Component />;
}

interface Notification {
  id: number;
  organizationId: number | null;
  schoolId: number | null;
  userId: number | null;
  type: string;
  title: string;
  message: string;
  severity: string | null;
  channel: string | null;
  link: string | null;
  actorUserId: number | null;
  readAt: Date | null;
  createdAt: Date | null;
}

function getTimeAgo(dateStr: string | Date | null): string {
  if (!dateStr) return "";
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function getSeverityColor(severity: string | null): string {
  switch (severity) {
    case "critical": return "bg-red-500";
    case "high": return "bg-orange-500";
    case "medium": return "bg-yellow-500";
    case "low": return "bg-blue-500";
    default: return "bg-muted-foreground";
  }
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 && days === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function TerminationBanner() {
  const { schoolTermination } = useAuth();
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    if (!schoolTermination?.terminationAt || schoolTermination.terminationStatus === "archived") return;

    const update = () => {
      const remaining = new Date(schoolTermination.terminationAt).getTime() - Date.now();
      setCountdown(formatCountdown(Math.max(0, remaining)));
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [schoolTermination?.terminationAt, schoolTermination?.terminationStatus]);

  if (!schoolTermination) return null;

  if (schoolTermination.terminationStatus === "archived") {
    return (
      <div className="bg-orange-500 dark:bg-orange-600 text-orange-950 dark:text-orange-50 px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2 shrink-0" data-testid="banner-archived">
        <Archive className="h-4 w-4 shrink-0" />
        <span>This school has been archived. You are viewing it in <strong>read-only mode</strong>. No changes can be made.</span>
      </div>
    );
  }

  if (schoolTermination.terminationStatus !== "pending") return null;

  return (
    <div className="bg-yellow-500 dark:bg-yellow-600 text-yellow-950 dark:text-yellow-50 px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2 shrink-0" data-testid="banner-termination">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>This school is being terminated in <strong>{countdown}</strong>. Please download all the information you may need. The system is in read-only mode.</span>
    </div>
  );
}

function AutoLogoutWarning() {
  const { schoolTermination, logout } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [logoutCountdown, setLogoutCountdown] = useState("");

  useEffect(() => {
    if (!schoolTermination?.terminationAt || schoolTermination.terminationStatus === "archived") return;

    const check = () => {
      const terminationTime = new Date(schoolTermination.terminationAt).getTime();
      const now = Date.now();
      const hoursLeft = (terminationTime - now) / (1000 * 60 * 60);

      if (hoursLeft <= 1 && hoursLeft > 0) {
        logout();
        return;
      }

      const lockoutTime = terminationTime - (60 * 60 * 1000);
      const warningTime = lockoutTime - (15 * 60 * 1000);
      const minutesToLockout = (lockoutTime - now) / (1000 * 60);

      if (now >= warningTime && now < lockoutTime) {
        if (!acknowledged) {
          setShowWarning(true);
        }
        setLogoutCountdown(formatCountdown(lockoutTime - now));
      }

      if (minutesToLockout <= 0) {
        logout();
      }
    };

    check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [schoolTermination?.terminationAt, acknowledged, logout]);

  if (!showWarning) return null;

  return (
    <Dialog open={showWarning} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
            <AlertTriangle className="h-5 w-5" />
            Automatic Logout Warning
          </DialogTitle>
          <DialogDescription>
            This school is being terminated. You will be automatically logged out in <strong className="text-foreground">{logoutCountdown}</strong>.
            Please save or download any information you need before the session ends.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            onClick={() => {
              setAcknowledged(true);
              setShowWarning(false);
            }}
            data-testid="button-acknowledge-logout-warning"
          >
            I understand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ArchivedSchool {
  id: number;
  name: string;
  shortCode: string | null;
  archivedAt: string | null;
  terminationRequestedAt: string | null;
  schoolType: string | null;
}

function ArchivedSchoolsPanel() {
  const { user, enterSchool } = useAuth();
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

  const { data: archivedSchools, isLoading } = useQuery<ArchivedSchool[]>({
    queryKey: ["/api/archived-schools"],
    enabled: open && user?.role === "org_admin",
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (schoolId: number) => {
      await apiRequest("POST", `/api/schools/${schoolId}/unarchive`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/archived-schools"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schools"] });
    },
  });

  const handleEnterSchool = (schoolId: number) => {
    enterSchool(schoolId);
    setOpen(false);
    setLocation("/");
  };

  if (user?.role !== "org_admin") return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        data-testid="button-archived-schools"
      >
        <Archive className="h-4 w-4" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5" />
              Archived Schools
            </SheetTitle>
            <SheetDescription>Schools that have been archived after termination. You can enter any archived school in read-only mode to view its data.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {isLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
              </div>
            ) : archivedSchools && archivedSchools.length > 0 ? (
              archivedSchools.map((school) => (
                <Card key={school.id} data-testid={`archived-school-${school.id}`}>
                  <CardContent className="p-4">
                    <div className="min-w-0">
                      <h4 className="font-medium text-sm truncate">{school.name}</h4>
                      {school.shortCode && (
                        <p className="text-xs text-muted-foreground">{school.shortCode}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="secondary" className="text-[10px]">
                          {school.schoolType || "secondary"}
                        </Badge>
                        {school.archivedAt && (
                          <span className="text-[11px] text-muted-foreground">
                            Archived {getTimeAgo(school.archivedAt)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleEnterSchool(school.id)}
                          data-testid={`button-enter-archived-${school.id}`}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          View School (Read Only)
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => unarchiveMutation.mutate(school.id)}
                          disabled={unarchiveMutation.isPending}
                          data-testid={`button-unarchive-${school.id}`}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Restore
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-archived">
                No archived schools
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, exitSchool, currentSchoolId } = useAuth();
  const [, setLocation] = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  
  const [currentTime, setCurrentTime] = useState(() =>
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Harare",
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    })
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleString("en-US", {
          timeZone: "Africa/Harare",
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const { data: school } = useQuery<{ id: number; name: string; address: string | null; motto: string | null; logo: string | null }>({
    queryKey: ['/api/schools', currentSchoolId],
    enabled: !!currentSchoolId,
  });

  const { data: unreadCount } = useQuery<{ count: number }>({
    queryKey: ['/api/notifications/unread-count'],
  });

  const { data: notifications } = useQuery<Notification[]>({
    queryKey: ['/api/notifications'],
    enabled: notificationsOpen,
  });

  const { data: allSchoolsList } = useQuery<{ id: number; name: string; shortCode: string }[]>({
    queryKey: ['/api/public/schools'],
    enabled: notificationsOpen && user?.role === "org_admin",
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/read-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
    },
  });

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const handleBackToOrg = () => {
    exitSchool();
    setLocation("/org");
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TerminationBanner />
          <header className="flex items-center gap-4 px-4 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            {user?.role === "org_admin" && currentSchoolId && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleBackToOrg}
                className="text-muted-foreground"
                data-testid="button-back-to-org"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to HQ
              </Button>
            )}
            <div className="flex-1 flex items-center gap-3 min-w-0">
              {currentSchoolId && school && (
                <>
                  {school.logo ? (
                    <img src={school.logo} alt="Logo" className="w-8 h-8 object-contain shrink-0 rounded-md" data-testid="img-header-school-logo" />
                  ) : (
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                      <MapPin className="w-4 h-4 text-primary" />
                    </div>
                  )}
                  <span className="font-bold text-sm truncate" data-testid="text-header-school-name">{school.name}</span>
                  {school.address && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 hidden md:flex">
                      <MapPin className="w-3 h-3" />
                      <span className="truncate max-w-[200px]">{school.address}</span>
                    </span>
                  )}
                  {school.motto && (
                    <span className="text-xs text-muted-foreground italic truncate hidden lg:inline" data-testid="text-header-school-motto">{school.motto}</span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap hidden sm:flex" data-testid="text-header-clock">
                <Clock className="w-3.5 h-3.5" />
                <span>{currentTime} (CAT)</span>
              </div>
              <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setNotificationsOpen(true)}
                  className="relative"
                  data-testid="button-notifications"
                >
                  <Bell className="h-4 w-4" />
                  {(unreadCount?.count ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center" data-testid="badge-unread-count">
                      {unreadCount!.count > 99 ? "99+" : unreadCount!.count}
                    </span>
                  )}
                </Button>
                <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
                  <SheetHeader>
                    <SheetTitle>Notifications</SheetTitle>
                    <SheetDescription>Your recent notifications</SheetDescription>
                  </SheetHeader>
                  <div className="mt-4">
                    {(unreadCount?.count ?? 0) > 0 && (
                      <div className="mb-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => markAllReadMutation.mutate()}
                          disabled={markAllReadMutation.isPending}
                          data-testid="button-mark-all-read"
                        >
                          Mark all as read
                        </Button>
                      </div>
                    )}
                    <div className="space-y-2">
                      {notifications && notifications.length > 0 ? (
                        notifications.map((notification) => (
                          <div
                            key={notification.id}
                            className={`p-3 rounded-md cursor-pointer hover-elevate ${!notification.readAt ? "bg-muted/50" : ""}`}
                            onClick={() => {
                              if (!notification.readAt) {
                                markReadMutation.mutate(notification.id);
                              }
                            }}
                            data-testid={`notification-item-${notification.id}`}
                          >
                            <div className="flex items-start gap-2">
                              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${getSeverityColor(notification.severity)}`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className={`text-sm font-medium truncate ${!notification.readAt ? "font-semibold" : ""}`} data-testid={`text-notification-title-${notification.id}`}>
                                    {notification.title}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                                    {getTimeAgo(notification.createdAt)}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2" data-testid={`text-notification-message-${notification.id}`}>
                                  {notification.message}
                                </p>
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  {notification.channel && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 leading-4" data-testid={`badge-channel-${notification.id}`}>
                                      {notification.channel === "email" && <Mail className="h-3 w-3 mr-0.5 inline" />}
                                      {notification.channel === "sms" && <MessageSquare className="h-3 w-3 mr-0.5 inline" />}
                                      {notification.channel === "newsletter" && <Newspaper className="h-3 w-3 mr-0.5 inline" />}
                                      {notification.channel === "in_app" && <Bell className="h-3 w-3 mr-0.5 inline" />}
                                      {notification.channel === "email" ? "Email" : notification.channel === "sms" ? "SMS" : notification.channel === "newsletter" ? "Newsletter" : notification.channel === "in_app" ? "In-App" : notification.channel}
                                    </Badge>
                                  )}
                                  {user?.role === "org_admin" && notification.schoolId && allSchoolsList && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 leading-4" data-testid={`badge-school-${notification.id}`}>
                                      {allSchoolsList.find(s => s.id === notification.schoolId)?.shortCode || allSchoolsList.find(s => s.id === notification.schoolId)?.name || "School"}
                                    </Badge>
                                  )}
                                  {notification.severity && notification.severity !== "info" && (
                                    <Badge variant="secondary" className="text-[10px]">
                                      {notification.severity}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-notifications">
                          No notifications
                        </p>
                      )}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>
      </div>
      <AutoLogoutWarning />
    </SidebarProvider>
  );
}

function AuthenticatedRoutes() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
        <Route path="/student-360" component={() => <ProtectedRoute component={Student360Page} />} />
        <Route path="/staff-360" component={() => <ProtectedRoute component={Staff360Page} />} />
        <Route path="/staff" component={() => <ProtectedRoute component={StaffPage} />} />
        <Route path="/students" component={() => <ProtectedRoute component={StudentsPage} />} />
        <Route path="/parents" component={() => <ProtectedRoute component={ParentsPage} />} />
        <Route path="/classes" component={() => <ProtectedRoute component={ClassesPage} />} />
        <Route path="/subjects" component={() => <ProtectedRoute component={SubjectsPage} />} />
        <Route path="/grades" component={() => <ProtectedRoute component={GradesPage} />} />
        <Route path="/assessments" component={() => <ProtectedRoute component={AssessmentsPage} />} />
        <Route path="/marks-entry" component={() => <ProtectedRoute component={MarksEntryPage} />} />
        <Route path="/academic-reports" component={() => <ProtectedRoute component={AcademicReportsPage} />} />
        <Route path="/qc-reports" component={() => <ProtectedRoute component={QCReportsPage} />} />
        <Route path="/qc-reports/class/:classId" component={() => <ProtectedRoute component={QCReportsClassPage} />} />
        <Route path="/qc-reports/student/:studentId" component={() => <ProtectedRoute component={QCReportsStudentPage} />} />
        <Route path="/attendance" component={() => <ProtectedRoute component={AttendancePage} />} />
        <Route path="/fees" component={() => <ProtectedRoute component={FeesPage} />} />
        <Route path="/clinic" component={() => <ProtectedRoute component={ClinicPage} />} />
        <Route path="/discipline" component={() => <ProtectedRoute component={DisciplinePage} />} />
        <Route path="/marks" component={() => <ProtectedRoute component={MarksPage} />} />
        <Route path="/record-of-marks" component={() => <ProtectedRoute component={RecordOfMarksPage} />} />
        <Route path="/kundai" component={() => <ProtectedRoute component={KundAiPage} />} />
        <Route path="/transport" component={() => <ProtectedRoute component={TransportPage} />} />
        <Route path="/arrears" component={() => <ProtectedRoute component={ArrearsPage} />} />
        <Route path="/school-expenses" component={() => <ProtectedRoute component={SchoolExpensesPage} />} />
        <Route path="/school-incomes" component={() => <ProtectedRoute component={SchoolIncomesPage} />} />
        <Route path="/products" component={() => <ProtectedRoute component={ProductsPage} />} />
        <Route path="/financial-statements" component={() => <ProtectedRoute component={FinancialStatementsPage} />} />
        <Route path="/discussion-forum" component={() => <ProtectedRoute component={DiscussionForumPage} />} />
        <Route path="/learning-materials" component={() => <ProtectedRoute component={LearningMaterialsPage} />} />
        <Route path="/children" component={() => <ProtectedRoute component={MyChildrenPage} />} />
        <Route path="/settings" component={() => <ProtectedRoute component={SchoolSettingsPage} />} />
        <Route path="/library" component={() => <ProtectedRoute component={LibraryPage} />} />
        <Route path="/calendar" component={() => <ProtectedRoute component={CalendarPage} />} />
        <Route path="/timetable" component={() => <ProtectedRoute component={TimetablePage} />} />
        <Route path="/logbook" component={() => <ProtectedRoute component={LogbookPage} />} />
        <Route path="/pos" component={() => <ProtectedRoute component={POSPage} />} />
        <Route path="/newsletters" component={() => <ProtectedRoute component={NewslettersPage} />} />
        <Route path="/schemes" component={() => <ProtectedRoute component={SchemesPage} />} />
        <Route path="/hostel" component={() => <ProtectedRoute component={HostelPage} />} />
        <Route path="/hostels" component={() => <ProtectedRoute component={HostelsPage} />} />
        <Route path="/applications" component={() => <ProtectedRoute component={ApplicationsPage} />} />
        <Route path="/messages" component={() => <ProtectedRoute component={MessagesPage} />} />
        <Route path="/my-classes" component={() => <ProtectedRoute component={MyClassesPage} />} />
        <Route path="/my-attendance" component={() => <ProtectedRoute component={MyAttendancePage} />} />
        <Route path="/my-grades" component={() => <ProtectedRoute component={MyGradesPage} />} />
        <Route path="/my-profile" component={() => <ProtectedRoute component={MyProfilePage} />} />
        <Route path="/my-notifications" component={() => <ProtectedRoute component={MyNotificationsPage} />} />
        <Route path="/my-newsletters" component={() => <ProtectedRoute component={MyNewslettersPage} />} />
        <Route path="/children-attendance" component={() => <ProtectedRoute component={ChildrenAttendancePage} />} />
        <Route path="/children-reports" component={() => <ProtectedRoute component={ChildrenReportsPage} />} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function Router() {
  const { user, isLoading, isInSchoolContext } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/apply" component={ApplyPage} />
      <Route path="/reset-password" component={ResetPasswordToken} />
      <Route path="/force-reset-password">
        {user?.mustResetPassword ? (
          <ForceResetPassword />
        ) : user ? (
          <Redirect to="/dashboard" />
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
      <Route path="/login">
        {user ? (
          user.mustResetPassword ? (
            <Redirect to="/force-reset-password" />
          ) : user.role === "org_admin" && !isInSchoolContext ? (
            <Redirect to="/org" />
          ) : (
            <Redirect to="/dashboard" />
          )
        ) : (
          <Login />
        )}
      </Route>
      <Route path="/org">
        {user ? (
          user.role === "org_admin" ? (
            <OrgDashboard />
          ) : (
            <Redirect to="/dashboard" />
          )
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
      <Route path="/">
        {user ? (
          user.role === "org_admin" && !isInSchoolContext ? (
            <Redirect to="/org" />
          ) : (
            <Redirect to="/dashboard" />
          )
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
      <Route>
        {user ? <AuthenticatedRoutes /> : <Redirect to="/login" />}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Router />
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
