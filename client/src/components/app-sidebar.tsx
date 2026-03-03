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
  FileSpreadsheet,
  Building,
  MessageSquare,
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
} from "lucide-react";
import type { School as SchoolType } from "@shared/schema";

type MenuItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  featureKey?: string;
  comingSoon?: boolean;
  badge?: string;
};

type MenuGroup = {
  label: string;
  items: MenuItem[];
};

const adminMenuGroups: MenuGroup[] = [
  {
    label: "Operations",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Applications", url: "/applications", icon: FileText },
      { title: "Transport", url: "#", icon: Bus, comingSoon: true, featureKey: "enableTransport" },
    ],
  },
  {
    label: "Human Resources",
    items: [
      { title: "School Staff", url: "/staff", icon: Users },
      { title: "Timetable", url: "#", icon: Calendar, comingSoon: true },
      { title: "Staff Attendance", url: "/logbook", icon: Clock, featureKey: "enableELogbook", badge: "In Production" },
    ],
  },
  {
    label: "Accounting & Finance",
    items: [
      { title: "Student Payments", url: "/fees", icon: DollarSign, featureKey: "enableFinance" },
      { title: "Parents With Arrears", url: "#", icon: Banknote, featureKey: "enableFinance", comingSoon: true },
      { title: "School Expenses", url: "#", icon: Receipt, featureKey: "enableFinance", comingSoon: true },
      { title: "School Incomes", url: "#", icon: TrendingUp, featureKey: "enableFinance", comingSoon: true },
      { title: "Products", url: "#", icon: ShoppingCart, featureKey: "enableFinance", comingSoon: true },
      { title: "Financial Statements", url: "#", icon: BarChart3, featureKey: "enableFinance", comingSoon: true },
    ],
  },
  {
    label: "Library & E-Learning",
    items: [
      { title: "Library", url: "/library", icon: Library, featureKey: "enableELibrary", badge: "In Production" },
      { title: "kundAi", url: "/kundai", icon: Bot, badge: "In Production" },
      { title: "Discussion Forum", url: "#", icon: MessageSquare, comingSoon: true },
      { title: "Learning Materials", url: "#", icon: BookMarked, comingSoon: true },
    ],
  },
  {
    label: "Student",
    items: [
      { title: "Student Records", url: "/students", icon: GraduationCap },
      { title: "Parent Records", url: "/parents", icon: UserCheck },
      { title: "Class Attendance Register", url: "/attendance", icon: ClipboardCheck },
      { title: "Hostel Attendance Register", url: "/hostel", icon: Building, featureKey: "enableHostel", badge: "In Production" },
      { title: "Clinic Records", url: "/clinic", icon: Stethoscope, featureKey: "enableHostel" },
      { title: "Disciplinary Reports", url: "/discipline", icon: Shield },
      { title: "Academic Reports", url: "/academic-reports", icon: FileText },
      { title: "Quality Control Reports", url: "/qc-reports", icon: ClipboardList },
    ],
  },
  {
    label: "Academics",
    items: [
      { title: "Subjects", url: "/subjects", icon: BookOpen },
      { title: "Grading System", url: "/grades", icon: FileText },
      { title: "Assessments Manager", url: "/assessments", icon: ClipboardList },
      { title: "Marks Entry", url: "/marks-entry", icon: FileText },
      { title: "Record of Marks", url: "/record-of-marks", icon: CalendarClock, badge: "In Production" },
    ],
  },
  {
    label: "Our School",
    items: [
      { title: "Newsletters", url: "/newsletters", icon: FileText },
      { title: "Messages History", url: "/messages", icon: Mail },
      { title: "Classrooms", url: "/classes", icon: School },
      { title: "Boarding Hostels", url: "/hostels", icon: Building, featureKey: "enableHostel", badge: "In Production" },
      { title: "School Configuration", url: "/settings", icon: Settings },
    ],
  },
];

const teacherMenuGroups: MenuGroup[] = [
  {
    label: "",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Human Resources",
    items: [
      { title: "Timetable", url: "#", icon: Calendar, comingSoon: true },
      { title: "Staff Attendance", url: "/logbook", icon: Clock, featureKey: "enableELogbook", badge: "In Production" },
    ],
  },
  {
    label: "Library & E-Learning",
    items: [
      { title: "Library", url: "/library", icon: Library, featureKey: "enableELibrary", badge: "In Production" },
    ],
  },
  {
    label: "Student",
    items: [
      { title: "Student Records", url: "/students", icon: GraduationCap },
      { title: "Class Attendance Register", url: "/attendance", icon: ClipboardCheck },
      { title: "Academic Reports", url: "/academic-reports", icon: FileText },
    ],
  },
  {
    label: "Academics",
    items: [
      { title: "Subjects", url: "/subjects", icon: BookOpen },
      { title: "Assessments Manager", url: "/assessments", icon: ClipboardList },
      { title: "Marks Entry", url: "/marks-entry", icon: FileText },
      { title: "Record of Marks", url: "/record-of-marks", icon: CalendarClock, badge: "In Production" },
    ],
  },
  {
    label: "Our School",
    items: [
      { title: "Classrooms", url: "/classes", icon: School },
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
      { title: "Timetable", url: "#", icon: Calendar, comingSoon: true },
      { title: "Learning Materials", url: "#", icon: BookMarked, comingSoon: true },
      { title: "Library", url: "/library", icon: Library, featureKey: "enableELibrary", badge: "In Production" },
      { title: "AI Study Helper", url: "#", icon: Bot, comingSoon: true },
    ],
  },
  {
    label: "Assessments",
    items: [
      { title: "My Grades", url: "/my-grades", icon: FileText },
      { title: "Assignments", url: "#", icon: ClipboardList, comingSoon: true },
      { title: "Reports", url: "#", icon: BarChart3, comingSoon: true },
    ],
  },
  {
    label: "Records",
    items: [
      { title: "My Attendance", url: "/my-attendance", icon: ClipboardCheck },
      { title: "Discipline", url: "#", icon: Shield, comingSoon: true },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Fees & Payments", url: "#", icon: CreditCard, featureKey: "enableFinance", comingSoon: true },
    ],
  },
  {
    label: "Community",
    items: [
      { title: "Newsletters", url: "/my-newsletters", icon: Megaphone },
      { title: "Discussion Forum", url: "#", icon: MessageSquare, comingSoon: true },
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
      { title: "Discipline", url: "#", icon: Shield, comingSoon: true },
      { title: "Timetable", url: "#", icon: Calendar, comingSoon: true },
      { title: "Homework", url: "#", icon: ClipboardList, comingSoon: true },
    ],
  },
  {
    label: "Communication",
    items: [
      { title: "Newsletters", url: "/my-newsletters", icon: Megaphone },
      { title: "Notices", url: "#", icon: Bell, comingSoon: true },
      { title: "Events / Calendar", url: "#", icon: Calendar, comingSoon: true },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Fees & Payments", url: "/fees", icon: CreditCard, featureKey: "enableFinance" },
      { title: "Arrears", url: "#", icon: Banknote, featureKey: "enableFinance", comingSoon: true },
      { title: "Statements & Invoices", url: "#", icon: Receipt, featureKey: "enableFinance", comingSoon: true },
    ],
  },
  {
    label: "Learning Support",
    items: [
      { title: "Library", url: "/library", icon: Library, featureKey: "enableELibrary", badge: "In Production" },
      { title: "AI Assistant", url: "#", icon: Bot, comingSoon: true },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "My Profile", url: "/my-profile", icon: User },
      { title: "Notifications", url: "/my-notifications", icon: Bell },
      { title: "Settings", url: "#", icon: Settings, comingSoon: true },
    ],
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout, currentSchoolId } = useAuth();

  const { data: schools } = useQuery<SchoolType[]>({
    queryKey: ["/api/schools"],
    enabled: !!user,
  });

  const currentSchool = schools?.find(s => s.id === currentSchoolId) || schools?.find(s => s.id === user?.schoolId);

  const getMenuGroups = (): MenuGroup[] => {
    switch (user?.role) {
      case "org_admin":
      case "school_admin":
        return adminMenuGroups;
      case "teacher":
        return teacherMenuGroups;
      case "student":
        return studentMenuGroups;
      case "parent":
        return parentMenuGroups;
      default:
        return adminMenuGroups;
    }
  };

  const allGroups = getMenuGroups();

  const filteredGroups = allGroups.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (!item.featureKey) return true;
      if (!currentSchool) return true;
      return (currentSchool as Record<string, unknown>)[item.featureKey] === true;
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
      case "student":
        return "Student";
      case "parent":
        return "Parent";
      default:
        return "User";
    }
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
                    {item.comingSoon ? (
                      <SidebarMenuButton
                        className="cursor-default opacity-60"
                        data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        <item.icon className="w-4 h-4" />
                        <span className="flex-1">{item.title}</span>
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 leading-4 no-default-hover-elevate no-default-active-elevate bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400">
                          Coming Soon
                        </Badge>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton asChild isActive={location === item.url}>
                        <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                          <item.icon className="w-4 h-4" />
                          <span className="flex-1">{item.title}</span>
                          {item.badge && (
                            <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 leading-4 no-default-hover-elevate no-default-active-elevate ${item.badge === "In Production" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" : item.badge === "Coming Soon" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400" : ""}`}>
                              {item.badge}
                            </Badge>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3 mb-3">
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
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => logout()}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
