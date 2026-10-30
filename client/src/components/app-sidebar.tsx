import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  UserCheck,
  BookOpen,
  Clock,
  School,
  ClipboardList,
  Calendar,
  FileText,
  DollarSign,
  LogOut,
  Settings,
  Library,
  ShoppingCart,
  Building,
  Bot,
  BookMarked,
  Receipt,
  TrendingUp,
  BarChart3,
  Shield,
  CalendarClock,
  ClipboardCheck,
  Banknote,
  Mail,
  Bus,
  Stethoscope,
  Megaphone,
  CreditCard,
  User,
  Bell,
  Package,
  ArrowRightLeft,
  CarFront,
  DoorOpen,
} from "lucide-react";
import type { School as SchoolType } from "@shared/schema";

type MenuItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPermissions?: string[];
  featureKey?: string;
  comingSoon?: boolean;
  badge?: string;
};

type MenuGroup = {
  label: string;
  items: MenuItem[];
};

const POS_MENU_PERMISSIONS = ["pos.view", "products.view"];
const SCHOOL_FINANCE_MENU_PERMISSIONS = [
  "fees.view",
  "school_expenses.view",
  "school_incomes.view",
  "financial_statements.view",
];
const ASSETS_INVENTORY_MENU_PERMISSIONS = ["assets.view", "inventory.view", "damage.view"];

const staffMenuGroups: MenuGroup[] = [
  {
    label: "Operations",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, requiredPermissions: ["dashboard.view"] },
      { title: "Calendar", url: "/calendar", icon: Calendar, requiredPermissions: ["calendar.view"] },
      { title: "Applications", url: "/applications", icon: FileText, requiredPermissions: ["applications.view"] },
      { title: "Internal Transfers", url: "/internal-transfers", icon: ArrowRightLeft, requiredPermissions: ["internal_transfers.view"] },
      { title: "Transport", url: "/transport", icon: Bus, requiredPermissions: ["transport.view"], featureKey: "enableTransport" },
      { title: "Fleet Management", url: "/fleet-management", icon: CarFront, requiredPermissions: ["fleet.view"], featureKey: "enableFleetManagement" },
      { title: "Access Control", url: "/access-control", icon: DoorOpen, requiredPermissions: ["access_control.view"], featureKey: "enableAccessControl" },
    ],
  },
  {
    label: "Human Resources",
    items: [
      { title: "School Staff", url: "/staff", icon: Users, requiredPermissions: ["staff.view"] },
      { title: "Timetable", url: "/timetable", icon: Calendar, requiredPermissions: ["timetable.view"] },
      { title: "Staff Attendance", url: "/logbook", icon: Clock, requiredPermissions: ["staff_attendance.view_own", "staff_attendance.view_all", "staff_attendance.view_logs", "staff_attendance.view_overview", "staff_attendance.clock_in", "staff_attendance.clock_out", "logbook.view"], featureKey: "enableELogbook" },
    ],
  },
  {
    label: "Library & E-Learning",
    items: [
      { title: "Kund-Ai", url: "/kundai", icon: Bot, requiredPermissions: ["kundai.view"] },
      { title: "Library", url: "/library", icon: Library, requiredPermissions: ["library.view"], featureKey: "enableELibrary" },
    ],
  },
  {
    label: "Student",
    items: [
      { title: "Student Records", url: "/students", icon: GraduationCap, requiredPermissions: ["students.view"] },
      { title: "Parent Records", url: "/parents", icon: UserCheck, requiredPermissions: ["parents.view"] },
      { title: "Clinic Records", url: "/clinic", icon: Stethoscope, requiredPermissions: ["clinic.view"], featureKey: "enableHostel" },
      { title: "Disciplinary Records", url: "/discipline", icon: Shield, requiredPermissions: ["discipline.view"] },
      { title: "Quality Control Reports", url: "/qc-reports", icon: ClipboardList, requiredPermissions: ["qc_reports.view"] },
      { title: "Class Attendance Register", url: "/attendance", icon: ClipboardCheck, requiredPermissions: ["attendance.view", "attendance.reports.view"] },
      { title: "Hostel Attendance Register", url: "/hostel", icon: Building, requiredPermissions: ["hostel.view"], featureKey: "enableHostel" },
    ],
  },
  {
    label: "Academics",
    items: [
      { title: "Grading", url: "/grades", icon: FileText, requiredPermissions: ["grades.view"] },
      { title: "Subjects", url: "/subjects", icon: BookOpen, requiredPermissions: ["subjects.view"] },
      { title: "Classrooms", url: "/classes", icon: School, requiredPermissions: ["classes.view"] },
      { title: "Assessments", url: "/assessments", icon: ClipboardList, requiredPermissions: ["assessments.view"] },
      { title: "Marks Entry", url: "/marks-entry", icon: FileText, requiredPermissions: ["marks.view", "marks.create"] },
      { title: "Record of Marks", url: "/record-of-marks", icon: CalendarClock, requiredPermissions: ["record_of_marks.view"] },
      { title: "Academic Reports", url: "/academic-reports", icon: FileText, requiredPermissions: ["reports.view"] },
    ],
  },
  {
    label: "Accounting & Finance",
    items: [
      { title: "Point of Sale", url: "/pos", icon: ShoppingCart, requiredPermissions: POS_MENU_PERMISSIONS, featureKey: "enableFinance" },
      { title: "School Finance", url: "/school-finance", icon: DollarSign, requiredPermissions: SCHOOL_FINANCE_MENU_PERMISSIONS, featureKey: "enableFinance" },
      { title: "Assets & Inventory", url: "/assets-inventory", icon: Package, requiredPermissions: ASSETS_INVENTORY_MENU_PERMISSIONS },
    ],
  },
  {
    label: "Our School",
    items: [
      { title: "Newsletters", url: "/newsletters", icon: FileText, requiredPermissions: ["newsletters.view"] },
      { title: "Boarding Hostels", url: "/hostels", icon: Building, requiredPermissions: ["hostels.view"], featureKey: "enableHostel" },
      { title: "Communication History", url: "/messages", icon: Mail, requiredPermissions: ["communication.view"] },
      { title: "School Configuration", url: "/settings", icon: Settings, requiredPermissions: ["settings.view"] },
    ],
  },
];

const studentMenuGroups: MenuGroup[] = [
  {
    label: "",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Learning",
    items: [
      { title: "My Classes", url: "/my-classes", icon: School },
      { title: "My Grades & Reports", url: "/my-grades", icon: BarChart3 },
    ],
  },
  {
    label: "Records",
    items: [
      { title: "My Attendance", url: "/my-attendance", icon: ClipboardCheck },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Finance & Access", url: "/my-finance", icon: CreditCard, featureKey: "enableFinance" },
    ],
  },
  {
    label: "Community",
    items: [
      { title: "Newsletters", url: "/my-newsletters", icon: Megaphone },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "My Profile", url: "/my-profile", icon: User },
      { title: "Notifications", url: "/my-notifications", icon: Bell },
    ],
  },
];

const parentMenuGroups: MenuGroup[] = [
  {
    label: "",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "My Children",
    items: [
      { title: "Profiles", url: "/children", icon: GraduationCap },
      { title: "Attendance", url: "/children-attendance", icon: ClipboardCheck },
      { title: "Results & Reports", url: "/children-reports", icon: BarChart3 },
    ],
  },
  {
    label: "Communication",
    items: [
      { title: "Newsletters", url: "/my-newsletters", icon: Megaphone },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Fees & Payments", url: "/fees", icon: CreditCard },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "My Profile", url: "/my-profile", icon: User },
      { title: "Notifications", url: "/my-notifications", icon: Bell },
    ],
  },
];

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { user, logout, currentSchoolId, hasAnyPermission } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();

  const { data: schools } = useQuery<SchoolType[]>({
    queryKey: ["/api/schools"],
    enabled: !!user,
  });

  const { data: parentDashboard } = useQuery<any>({
    queryKey: ["/api/me/parent-dashboard"],
    enabled: user?.role === "parent",
  });

  const { data: selfStaffProfile } = useQuery<any | null>({
    queryKey: ["/api/staff/self-profile", user?.id],
    enabled: !!user && !["student", "parent"].includes(String(user.role)),
    retry: false,
    queryFn: async () => {
      const response = await fetch("/api/staff/self-profile", { credentials: "include" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Unable to load linked staff profile");
      return response.json();
    },
  });

  const currentSchool = schools?.find(s => s.id === currentSchoolId) || schools?.find(s => s.id === user?.schoolId);

  const getMenuGroups = (): MenuGroup[] => {
    switch (user?.role) {
      case "student":
        return studentMenuGroups;
      case "parent":
        return parentMenuGroups;
      default:
        return staffMenuGroups;
    }
  };

  const allGroups = getMenuGroups();
  const applyPermissionFilter = user?.role !== "student" && user?.role !== "parent";

  const filteredGroups = allGroups.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (user?.role === "parent" && item.url === "/fees") {
        const financeEnabled = (parentDashboard?.children || []).some((row: any) => row?.student?.parentFeesPaymentsEnabled !== false);
        if (!financeEnabled) return false;
      }
      if (item.featureKey && currentSchool && (currentSchool as Record<string, unknown>)[item.featureKey] !== true) {
        return false;
      }
      if (applyPermissionFilter && item.requiredPermissions?.length) {
        return hasAnyPermission(...item.requiredPermissions);
      }
      return true;
    }),
  })).filter(group => group.items.length > 0);

  const getRoleLabel = () => {
    switch (user?.role) {
      case "org_admin":
        return "Organization Admin";
      case "school_admin":
        return "School Admin";
      case "teacher":
        return "Teacher";
      case "assistant_teacher":
        return "Assistant Teacher";
      case "quality_control_officer":
        return "Quality Control Officer";
      case "librarian":
        return "Librarian";
      case "student":
        return "Student";
      case "parent":
        return "Parent";
      default:
        return "User";
    }
  };

  const getBadgeClass = (badge?: string, comingSoon?: boolean) => {
    if (comingSoon) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400";
    if (badge === "In Production") return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400";
    return "";
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          {currentSchool?.logo ? (
            <img src={currentSchool.logo} alt="School Logo" className="w-10 h-10 rounded-lg object-contain" />
          ) : (
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <GraduationCap className="w-6 h-6 text-primary-foreground" />
            </div>
          )}
          <div>
            <h2 className="font-semibold text-sidebar-foreground">Navigation Menu</h2>
            <p className="text-xs text-sidebar-foreground/70">
              {user?.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user?.username} ({getRoleLabel()})
            </p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {filteredGroups.map((group, groupIdx) => (
          <SidebarGroup key={groupIdx}>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link
                        href={item.url}
                        data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                        onClick={() => {
                          if (isMobile) {
                            setOpenMobile(false);
                          }
                        }}
                      >
                        <item.icon className="w-4 h-4" />
                        <span className="flex-1">{item.title}</span>
                        {(item.comingSoon || item.badge) && (
                          <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 leading-4 no-default-hover-elevate no-default-active-elevate ${getBadgeClass(item.badge, item.comingSoon)}`}>
                            {item.comingSoon ? "Coming Soon" : item.badge}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-4">
        <button
          type="button"
          className="mb-3 flex w-full items-center gap-3 rounded-md p-1 text-left transition-colors hover:bg-sidebar-accent"
          onClick={() => {
            const target = user?.role === "student" || user?.role === "parent"
              ? "/my-profile"
              : selfStaffProfile?.id ? `/staff?staffId=${selfStaffProfile.id}&edit=1` : "/staff";
            setLocation(target);
            if (isMobile) setOpenMobile(false);
          }}
          title="Open my staff profile"
          data-testid="button-sidebar-profile"
        >
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary text-primary-foreground text-sm">
              {user?.firstName?.[0] || user?.username?.[0]?.toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-sidebar-foreground">
              {user?.firstName ? `${user.firstName} ${user.lastName || ""}` : user?.username}
            </p>
            <p className="text-xs text-sidebar-foreground/70">{getRoleLabel()}</p>
          </div>
        </button>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => logout()} data-testid="button-logout">
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
