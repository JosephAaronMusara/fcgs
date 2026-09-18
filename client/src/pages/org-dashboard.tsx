import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import CalendarPage from "@/pages/calendar";
import InternalTransfersPage from "@/pages/internal-transfers";
import AssetsInventoryPage from "@/pages/assets-inventory";
import FleetManagementPage from "@/pages/fleet-management";
import OrgTransportOversightPage from "@/pages/org-transport-oversight";
import RecruitmentPage from "@/pages/recruitment";
import ParentAttendanceNotifications from "@/components/parent-attendance-notifications";
import { RecordPhotoActions } from "@/components/record-photo-actions";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InfiniteYearPicker } from "@/components/ui/infinite-year-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { 
  Building2, 
  Users, 
  LogOut, 
  Plus, 
  MapPin, 
  Shield,
  ChevronDown,
  ChevronRight,
  School as SchoolIcon,
  Search,
  User as UserIcon,
  GraduationCap,
  UserCircle,
  X,
  Check,
  ExternalLink,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Clock,
  Pencil,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  Power,
  UserCog,
  Settings,
  Upload,
  ImageIcon,
  Stamp,
  Mail,
  Phone,
  Archive,
  ArrowRightLeft,
  Menu,
  LayoutDashboard,
  PackageSearch,
  BusFront,
  CarFront,
  BriefcaseBusiness,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import type { School as SchoolType, User, Permission, Staff, Student, Parent, Notification, Organization, ActivityLog, AssessmentType, Exam, AccessGroup, StaffRole } from "@shared/schema";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Bell, Calendar, Save, ClipboardList, Download, ArrowLeft, ArrowRight, Tag, ChevronLeft, FileText, SlidersHorizontal, Languages } from "lucide-react";
import { LanguageCheckButton, getLanguageProviderMetadata, useLanguageToolsSettings, type LanguageToolsSettings } from "@/features/language-tools";

type OrgUser = User & { schoolAccess?: number[]; permissionOverrides?: { permissionId: number; granted: boolean }[] };
type UserPermissionState = { permission: Permission; granted: boolean; groupGranted: boolean; overrideGranted: boolean | null; source: "group" | "granted_override" | "denied_override" | "none" };

type SearchResults = {
  staff: Array<Staff & { schoolName: string }>;
  students: Array<Student & { schoolName: string }>;
  parents: Array<Parent & { schoolName: string | null }>;
};

function normalizeDate(dateValue: string | null | undefined): string {
  if (!dateValue) return "";
  return dateValue.slice(0, 10);
}

function normalizeTermValue(val: string | number | null | undefined): string {
  if (!val) return "term1";
  if (typeof val === "number") return `term${val}`;
  const s = String(val);
  if (["term1", "term2", "term3", "vac1", "vac2"].includes(s)) return s;
  if (/^\d+$/.test(s)) return `term${s}`;
  return "term1";
}

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function HqImageUpload({
  label, description, currentImage, onUploadComplete, icon, testIdPrefix, disabled = false,
}: {
  label: string; description: string; currentImage: string | null | undefined;
  onUploadComplete: (url: string) => void; icon: React.ReactNode;
  testIdPrefix: string; disabled?: boolean;
}) {
  const { uploadFile, isUploading, error } = useUpload({
    onSuccess: (response) => { onUploadComplete(response.objectPath); },
  });
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
  };
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-base font-medium">{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="h-24 w-24 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center overflow-hidden bg-muted/50">
          {currentImage ? (
            <img src={currentImage} alt={label} className="h-full w-full object-contain" data-testid={`img-${testIdPrefix}`} />
          ) : icon}
        </div>
        <div className="flex-1 space-y-2">
          <input type="file" accept="image/*" onChange={handleFileChange} disabled={isUploading} className="hidden" id={`file-${testIdPrefix}`} data-testid={`input-${testIdPrefix}-file`} />
          <Button type="button" variant="outline" disabled={disabled || isUploading} onClick={() => document.getElementById(`file-${testIdPrefix}`)?.click()} data-testid={`button-upload-${testIdPrefix}`}>
            <Upload className="h-4 w-4 mr-2" />
            {isUploading ? "Uploading..." : currentImage ? "Change Image" : "Upload Image"}
          </Button>
          {error && <p className="text-sm text-destructive">{error.message}</p>}
          {currentImage && <p className="text-xs text-muted-foreground">Image uploaded successfully</p>}
        </div>
      </div>
    </div>
  );
}

function getCountdown(terminationAt: string | Date | null): string {
  if (!terminationAt) return "";
  const end = new Date(terminationAt).getTime();
  const now = Date.now();
  const diff = end - now;
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
}


function LanguageToolsGlobalSettings() {
  const { toast } = useToast();
  const { settings, isLoading } = useLanguageToolsSettings();
  const [draft, setDraft] = useState<LanguageToolsSettings>(settings);
  const [testText, setTestText] = useState("She have worked very hard this term.");
  const [testFirstName, setTestFirstName] = useState("");
  const [testGender, setTestGender] = useState("");
  const { data: providers = [] } = useQuery({
    queryKey: ["language-provider-metadata"],
    queryFn: getLanguageProviderMetadata,
    staleTime: Infinity,
  });

  useEffect(() => setDraft(settings), [settings]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/language-tools/settings", draft);
      return res.json();
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["/api/language-tools/settings"], saved);
      toast({ title: "Language Tools settings saved" });
    },
    onError: (error: any) => toast({ title: "Failed to save Language Tools settings", description: error?.message, variant: "destructive" }),
  });

  const effectiveProvider = draft.primaryProvider || draft.fallbackProvider || "None";
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading Language Tools settings...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold">Language Tools</h3>
          <p className="text-sm text-muted-foreground">Configure the organisation-wide writing assistant. Providers are replaceable without changing module workflows.</p>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="language-tools-enabled"
            checked={draft.enabled}
            onCheckedChange={(checked) => setDraft((current) => ({ ...current, enabled: checked === true }))}
          />
          <Label htmlFor="language-tools-enabled">Enabled</Label>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Provider selection</CardTitle><CardDescription>Primary may be left as None; the fallback will then be the effective provider.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Primary provider</Label>
              <Select value={draft.primaryProvider ?? "none"} onValueChange={(value) => setDraft((current) => ({ ...current, primaryProvider: value === "none" ? null : value }))}>
                <SelectTrigger data-testid="select-language-primary"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">None</SelectItem>{providers.map((provider: any) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Offline fallback</Label>
              <Select value={draft.fallbackProvider ?? "none"} onValueChange={(value) => setDraft((current) => ({ ...current, fallbackProvider: value === "none" ? null : value }))}>
                <SelectTrigger data-testid="select-language-fallback"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">None</SelectItem>{providers.map((provider: any) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <span className="font-medium">Effective provider:</span> {effectiveProvider === "harper" ? "Harper" : effectiveProvider}
              {!draft.primaryProvider && draft.fallbackProvider ? <span className="ml-2 text-muted-foreground">(fallback active)</span> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Behaviour</CardTitle><CardDescription>Controls how suggestions are applied throughout the portal.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Language checking mode</Label>
              <Select value={draft.mode} onValueChange={(value: any) => setDraft((current) => ({ ...current, mode: value }))}>
                <SelectTrigger data-testid="select-language-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="review_all">Review All</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="auto_apply_safe">Auto-apply Safe</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>English dialect</Label><Input value="British English" disabled /></div>
            <label className="flex items-start gap-2 text-sm"><Checkbox checked={draft.studentNamePersonalization} onCheckedChange={(checked) => setDraft((current) => ({ ...current, studentNamePersonalization: checked === true }))} /><span><span className="font-medium">Student-name personalisation</span><span className="block text-muted-foreground">Offer a name at the start of a student comment when appropriate.</span></span></label>
            <label className="flex items-start gap-2 text-sm"><Checkbox checked={draft.genderPronounCheck} onCheckedChange={(checked) => setDraft((current) => ({ ...current, genderPronounCheck: checked === true }))} /><span><span className="font-medium">Gender/pronoun context check</span><span className="block text-muted-foreground">Warn when a pronoun may conflict with the selected student record.</span></span></label>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Provider capabilities</CardTitle><CardDescription>The writing UI adapts to provider capabilities; FCGS can queue bulk checks even when a provider has no native bulk API.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {providers.map((provider: any) => (
            <div key={provider.id} className="rounded-md border p-3">
              <div className="flex items-center gap-2"><span className="font-medium">{provider.name}</span>{provider.capabilities.offline ? <Badge variant="secondary">Offline</Badge> : null}<Badge variant="outline">{provider.capabilities.privacyMode}</Badge></div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">{["spelling","grammar","punctuation","style","bulk","generativeRewrite","supportsBritishEnglish"].map((key) => <Badge key={key} variant={provider.capabilities[key] ? "secondary" : "outline"}>{key}: {provider.capabilities[key] ? "yes" : "no"}</Badge>)}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Diagnostic tester</CardTitle><CardDescription>Exercise the currently configured provider without affecting any report or comment record.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2"><Label>Student first name (optional)</Label><Input value={testFirstName} onChange={(event) => setTestFirstName(event.target.value)} placeholder="e.g. Adele" /></div>
            <div className="space-y-2"><Label>Student gender (optional)</Label><Select value={testGender || "none"} onValueChange={(value) => setTestGender(value === "none" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="male">Male</SelectItem></SelectContent></Select></div>
          </div>
          <div className="space-y-2"><Label>Test text</Label><Textarea rows={5} value={testText} onChange={(event) => setTestText(event.target.value)} /></div>
          <LanguageCheckButton
            fields={[{ id: "diagnostic", label: "Diagnostic text", text: testText, onChange: setTestText, student: testFirstName || testGender ? { firstName: testFirstName || null, gender: testGender || null } : undefined }]}
            showProviderStatus
          />
        </CardContent>
      </Card>

      <div className="flex justify-end"><Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}><Save className="mr-2 h-4 w-4" />Save Language Tools Settings</Button></div>
    </div>
  );
}

export default function OrgDashboard() {
  const { user, logout, enterSchool, setCurrentSchoolId, hasPermission } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isAddSchoolOpen, setIsAddSchoolOpen] = useState(false);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [schoolToDelete, setSchoolToDelete] = useState<SchoolType | null>(null);
  const [, setTick] = useState(0);
  const [isPermissionsOpen, setIsPermissionsOpen] = useState(false);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<OrgUser | null>(null);
  const [selectedSchools, setSelectedSchools] = useState<number[]>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<number[]>([]);
  const permissionDraftInitializedForUserRef = useRef<number | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [isEditingPermissions, setIsEditingPermissions] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isManageAccountOpen, setIsManageAccountOpen] = useState(false);
  const [isOrgSettingsOpen, setIsOrgSettingsOpen] = useState(false);
  const [orgSettingsTab, setOrgSettingsTab] = useState("hq-info");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isInternalTransfersOpen, setIsInternalTransfersOpen] = useState(false);
  const [isTransportOversightOpen, setIsTransportOversightOpen] = useState(false);
  const [isAssetsInventoryOpen, setIsAssetsInventoryOpen] = useState(false);
  const [isFleetManagementOpen, setIsFleetManagementOpen] = useState(false);
  const [isRecruitmentOpen, setIsRecruitmentOpen] = useState(false);
  const [isHqNavOpen, setIsHqNavOpen] = useState(false);
  const currentYear = new Date().getFullYear();
  const [orgAcademicYear, setOrgAcademicYear] = useState<number>(currentYear);
  const [orgTerm, setOrgTerm] = useState<string>("term1");
  const [orgTermDates, setOrgTermDates] = useState({
    term1Start: "", term1End: "",
    vac1Start: "", vac1End: "",
    term2Start: "", term2End: "",
    vac2Start: "", vac2End: "",
    term3Start: "", term3End: "",
  });
  const [isEditingAcademic, setIsEditingAcademic] = useState(false);
  const [isAssessmentTypesDialogOpen, setIsAssessmentTypesDialogOpen] = useState(false);
  const [assessmentTypeName, setAssessmentTypeName] = useState("");
  const [assessmentTypeDesc, setAssessmentTypeDesc] = useState("");
  const [assessmentTypeCardinality, setAssessmentTypeCardinality] = useState<"single_per_exam" | "multiple_per_exam">("multiple_per_exam");
  const [editingAssessmentType, setEditingAssessmentType] = useState<AssessmentType | null>(null);
  const [isExamsDialogOpen, setIsExamsDialogOpen] = useState(false);
  const [examName, setExamName] = useState("");
  const [examAssessmentTypeId, setExamAssessmentTypeId] = useState<string>("");
  const [isEditingHqInfo, setIsEditingHqInfo] = useState(false);
  const [hqInfoValues, setHqInfoValues] = useState({
    name: "", email: "", phone: "", address: "", systemUrl: "",
  });
  const [hqBrandingValues, setHqBrandingValues] = useState({
    logo: "", stamp: "", motto: "",
  });
  const [isEditingHqBranding, setIsEditingHqBranding] = useState(false);
  const [isEditingFeatures, setIsEditingFeatures] = useState(false);
  const [featuresValues, setFeaturesValues] = useState({ photoUploadLimitMB: 5 });
  const [accountNewPassword, setAccountNewPassword] = useState("");
  const [showAccountPassword, setShowAccountPassword] = useState(false);
  const [isArchivedOpen, setIsArchivedOpen] = useState(false);
 
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const { data: schools = [], isLoading: schoolsLoading } = useQuery<SchoolType[]>({
    queryKey: ["/api/schools"],
  });

  const { data: orgUsers = [], isLoading: usersLoading } = useQuery<OrgUser[]>({
    queryKey: ["/api/users?role=org_admin"],
  });

  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/permissions"],
  });

  const { data: userSchoolAccess = [], isLoading: userSchoolAccessLoading } = useQuery<number[]>({
    queryKey: [`/api/users/${selectedUser?.id}/schools`],
    enabled: !!selectedUser,
  });

  const { data: userPermissionStates = [], isLoading: userPermissionStatesLoading } = useQuery<UserPermissionState[]>({
    queryKey: [`/api/users/${selectedUser?.id}/permissions`],
    enabled: !!selectedUser,
  });

  const { data: orgBranding } = useQuery<{ name: string; logo: string | null; motto: string | null; stamp: string | null; address: string | null; phone: string | null; email: string | null }>({
    queryKey: ["/api/public/org-branding"],
  });

  const { data: archivedSchools, isLoading: archivedLoading } = useQuery<{ id: number; name: string; shortCode: string | null; archivedAt: string | null; schoolType: string | null }[]>({
    queryKey: ["/api/archived-schools"],
    enabled: isArchivedOpen,
  });

  const unarchiveMutation = useMutation({
    mutationFn: async (schoolId: number) => {
      await apiRequest("POST", `/api/schools/${schoolId}/unarchive`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/archived-schools"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schools"] });
      toast({ title: "School restored", description: "The school has been restored from the archive." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const { data: allOrgs } = useQuery<Organization[]>({
    queryKey: ["/api/organizations"],
    enabled: !!user && !user.organizationId,
  });

  const resolvedOrgId = user?.organizationId || allOrgs?.[0]?.id;

  const { data: orgData } = useQuery<Organization>({
    queryKey: ["/api/organizations", resolvedOrgId],
    enabled: !!resolvedOrgId,
  });

  useEffect(() => {
    if (orgData) {
      setOrgAcademicYear(orgData.currentAcademicYear ? parseInt(orgData.currentAcademicYear) : currentYear);
      setOrgTerm(normalizeTermValue(orgData.currentTerm));
      setOrgTermDates({
        term1Start: normalizeDate(orgData.term1StartDate),
        term1End: normalizeDate(orgData.term1EndDate),
        vac1Start: normalizeDate((orgData as any).vac1StartDate),
        vac1End: normalizeDate((orgData as any).vac1EndDate),
        term2Start: normalizeDate(orgData.term2StartDate),
        term2End: normalizeDate(orgData.term2EndDate),
        vac2Start: normalizeDate((orgData as any).vac2StartDate),
        vac2End: normalizeDate((orgData as any).vac2EndDate),
        term3Start: normalizeDate(orgData.term3StartDate),
        term3End: normalizeDate(orgData.term3EndDate),
      });
      setHqInfoValues({
        name: orgData.name || "",
        email: orgData.email || "",
        phone: orgData.phone || "",
        address: orgData.address || "",
        systemUrl: orgData.systemUrl || "",
      });
      setHqBrandingValues({
        logo: orgData.logo || "",
        stamp: orgData.stamp || "",
        motto: orgData.motto || "",
      });
    }
  }, [orgData, currentYear]);


  const { data: assessmentTypes } = useQuery<AssessmentType[]>({
    queryKey: ["/api/assessment-types"],
  });

  const createAssessmentTypeMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      description: string | null;
      assessmentCardinality: "single_per_exam" | "multiple_per_exam";
      reportAggregationMode: "single" | "best_coverage";
    }) => {
      const res = await apiRequest("POST", "/api/assessment-types", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessment-types"] });
      setAssessmentTypeName("");
      setAssessmentTypeDesc("");
      setAssessmentTypeCardinality("multiple_per_exam");
      toast({ title: "Success", description: "Assessment type created" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateAssessmentTypeMutation = useMutation({
    mutationFn: async ({ id, data }: {
      id: number;
      data: {
        name: string;
        description: string | null;
        assessmentCardinality: "single_per_exam" | "multiple_per_exam";
        reportAggregationMode: "single" | "best_coverage";
      };
    }) => {
      const res = await apiRequest("PUT", `/api/assessment-types/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessment-types"] });
      setEditingAssessmentType(null);
      setAssessmentTypeName("");
      setAssessmentTypeDesc("");
      setAssessmentTypeCardinality("multiple_per_exam");
      toast({ title: "Success", description: "Assessment type updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteAssessmentTypeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/assessment-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessment-types"] });
      toast({ title: "Success", description: "Assessment type deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAssessmentTypeSubmit = () => {
    if (!assessmentTypeName.trim()) {
      toast({ title: "Error", description: "Type name is required", variant: "destructive" });
      return;
    }
    const payload = {
      name: assessmentTypeName.trim(),
      description: assessmentTypeDesc.trim() || null,
      assessmentCardinality: assessmentTypeCardinality,
      reportAggregationMode: assessmentTypeCardinality === "single_per_exam" ? "single" as const : "best_coverage" as const,
    };
    if (editingAssessmentType) {
      updateAssessmentTypeMutation.mutate({ id: editingAssessmentType.id, data: payload });
    } else {
      createAssessmentTypeMutation.mutate(payload);
    }
  };

  const { data: globalExams } = useQuery<Exam[]>({
    queryKey: ["/api/exams"],
  });

  const globalExamList = (globalExams || []).filter((exam) => exam.schoolId == null);

  const createExamMutation = useMutation({
    mutationFn: async (data: { examName: string; assessmentTypeId: number; schoolId?: number | null }) => {
      const res = await apiRequest("POST", "/api/exams", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exams"] });
      setExamName("");
      setExamAssessmentTypeId("");
      toast({ title: "Success", description: "Exercise/Exam created" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteExamMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/exams/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exams"] });
      toast({ title: "Success", description: "Exercise/Exam deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleExamSubmit = () => {
    if (!examName.trim()) {
      toast({ title: "Error", description: "Exercise/Exam name is required", variant: "destructive" });
      return;
    }
    if (!examAssessmentTypeId) {
      toast({ title: "Error", description: "Please select an assessment type", variant: "destructive" });
      return;
    }
    createExamMutation.mutate({
      examName: examName.trim(),
      assessmentTypeId: parseInt(examAssessmentTypeId),
      schoolId: null,
    });
  };

  const updateOrgSettings = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      if (!resolvedOrgId) throw new Error("Organization not found");
      return apiRequest("PUT", `/api/organizations/${resolvedOrgId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/org-branding"] });
      toast({ title: "Settings saved", description: "Organization settings updated successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const handleSaveOrgAcademic = () => {
    updateOrgSettings.mutate({
      currentAcademicYear: orgAcademicYear.toString(),
      currentTerm: orgTerm,
      term1StartDate: orgTermDates.term1Start || null,
      term1EndDate: orgTermDates.term1End || null,
      vac1StartDate: orgTermDates.vac1Start || null,
      vac1EndDate: orgTermDates.vac1End || null,
      term2StartDate: orgTermDates.term2Start || null,
      term2EndDate: orgTermDates.term2End || null,
      vac2StartDate: orgTermDates.vac2Start || null,
      vac2EndDate: orgTermDates.vac2End || null,
      term3StartDate: orgTermDates.term3Start || null,
      term3EndDate: orgTermDates.term3End || null,
    }, {
      onSuccess: () => setIsEditingAcademic(false),
    });
  };

  const handleCancelOrgAcademic = () => {
    if (orgData) {
      setOrgAcademicYear(orgData.currentAcademicYear ? parseInt(orgData.currentAcademicYear) : currentYear);
      setOrgTerm(normalizeTermValue(orgData.currentTerm));
      setOrgTermDates({
        term1Start: normalizeDate(orgData.term1StartDate),
        term1End: normalizeDate(orgData.term1EndDate),
        vac1Start: normalizeDate((orgData as any).vac1StartDate),
        vac1End: normalizeDate((orgData as any).vac1EndDate),
        term2Start: normalizeDate(orgData.term2StartDate),
        term2End: normalizeDate(orgData.term2EndDate),
        vac2Start: normalizeDate((orgData as any).vac2StartDate),
        vac2End: normalizeDate((orgData as any).vac2EndDate),
        term3Start: normalizeDate(orgData.term3StartDate),
        term3End: normalizeDate(orgData.term3EndDate),
      });
    }
    setIsEditingAcademic(false);
  };

  const { data: notificationsData = [], refetch: refetchNotifications } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });

  const { data: unreadCount } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 30000,
  });

  const markAsRead = useMutation({
    mutationFn: async (notificationId: number) => {
      return apiRequest("POST", `/api/notifications/${notificationId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/notifications/read-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const { data: searchResults, isLoading: searchLoading } = useQuery<SearchResults>({
    queryKey: [`/api/search?q=${encodeURIComponent(debouncedSearch)}`],
    enabled: debouncedSearch.length >= 2,
  });

  useEffect(() => {
    if (!selectedUser || !isPermissionsOpen) {
      permissionDraftInitializedForUserRef.current = null;
      return;
    }

    if (userSchoolAccessLoading || userPermissionStatesLoading) {
      return;
    }

    if (permissionDraftInitializedForUserRef.current === selectedUser.id) {
      return;
    }

    const initialSchoolIds = userSchoolAccess.length > 0
      ? userSchoolAccess
      : schools.map((school) => school.id);

    setSelectedSchools(initialSchoolIds);
    setSelectedPermissions(userPermissionStates.filter((state) => state.granted).map((state) => state.permission.id));
    permissionDraftInitializedForUserRef.current = selectedUser.id;
  }, [selectedUser, userSchoolAccess, userPermissionStates, schools, isPermissionsOpen, userSchoolAccessLoading, userPermissionStatesLoading]);

  const createSchool = useMutation({
    mutationFn: async (data: Partial<SchoolType>) => {
      const res = await apiRequest("POST", "/api/schools", data);
      return res.json();
    },
    onSuccess: (newSchool: SchoolType) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schools"] });
      setIsAddSchoolOpen(false);
      toast({ title: "School added successfully. Redirecting to settings..." });
      setCurrentSchoolId(newSchool.id);
      setLocation("/settings");
    },
    onError: () => {
      toast({ title: "Failed to add school", variant: "destructive" });
    },
  });

  const deleteSchool = useMutation({
    mutationFn: async (schoolId: number) => {
      return apiRequest("DELETE", `/api/schools/${schoolId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schools"] });
      setSchoolToDelete(null);
      toast({ title: "School scheduled for deletion. It will be permanently removed in 72 hours." });
    },
    onError: () => {
      toast({ title: "Failed to schedule school deletion", variant: "destructive" });
    },
  });

  const restoreSchool = useMutation({
    mutationFn: async (schoolId: number) => {
      return apiRequest("POST", `/api/schools/${schoolId}/restore`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schools"] });
      toast({ title: "School restored successfully" });
    },
    onError: () => {
      toast({ title: "Failed to restore school", variant: "destructive" });
    },
  });

  const createOrgUser = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return apiRequest("POST", "/api/auth/register", { ...data, role: "org_admin" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users?role=org_admin"] });
      setIsAddUserOpen(false);
      toast({ title: "User added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add user", variant: "destructive" });
    },
  });

  const updateUser = useMutation({
    mutationFn: async (data: { id: number; firstName: string; lastName: string; email: string }) => {
      return apiRequest("PUT", `/api/users/${data.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users?role=org_admin"] });
      setIsEditUserOpen(false);
      setSelectedUser(null);
      toast({ title: "User updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update user", variant: "destructive" });
    },
  });

  const deleteUser = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest("DELETE", `/api/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users?role=org_admin"] });
      setIsDeleteConfirmOpen(false);
      setSelectedUser(null);
      toast({ title: "User deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete user", variant: "destructive" });
    },
  });

  const updateUserPermissions = useMutation({
    mutationFn: async (data: { userId: number; schoolIds: number[]; permissionIds: number[] }) => {
      return apiRequest("PUT", `/api/users/${data.userId}/permissions`, {
        schoolIds: data.schoolIds,
        permissionIds: data.permissionIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users?role=org_admin"] });
      if (selectedUser) {
        queryClient.invalidateQueries({ queryKey: [`/api/users/${selectedUser.id}/schools`] });
        queryClient.invalidateQueries({ queryKey: [`/api/users/${selectedUser.id}/permissions`] });
      }
      permissionDraftInitializedForUserRef.current = null;
      setIsPermissionsOpen(false);
      setSelectedUser(null);
      toast({ title: "Permissions updated successfully" });
    },
    onError: async (error: any) => {
      let message = "Failed to update permissions";
      try {
        const body = await error?.response?.json?.();
        if (body?.message) message = body.message;
      } catch {}
      toast({ title: message, variant: "destructive" });
    },
  });

  const resetUserPassword = useMutation({
    mutationFn: async (data: { userId: number; password: string }) => {
      return apiRequest("PUT", `/api/users/${data.userId}/password`, { password: data.password });
    },
    onSuccess: () => {
      setAccountNewPassword("");
      toast({ title: "Password reset successfully" });
    },
    onError: () => {
      toast({ title: "Failed to reset password", variant: "destructive" });
    },
  });

  const toggleUserStatus = useMutation({
    mutationFn: async (data: { userId: number; isActive: boolean }) => {
      return apiRequest("PUT", `/api/users/${data.userId}/status`, { isActive: data.isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users?role=org_admin"] });
      toast({ title: "Account status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update account status", variant: "destructive" });
    },
  });

  const handleOpenManageAccount = (orgUser: OrgUser) => {
    setSelectedUser(orgUser);
    setAccountNewPassword("");
    setShowAccountPassword(false);
    setIsManageAccountOpen(true);
  };

  const handleEnterSchool = (schoolId: number) => {
    enterSchool(schoolId);
    setLocation("/dashboard");
  };

  const handleLogout = async () => {
    await logout();
    setLocation("/login");
  };

  const [newSchoolType, setNewSchoolType] = useState("secondary");
  const [newExamBoard, setNewExamBoard] = useState("ZIMSEC");
  const [newBoardingType, setNewBoardingType] = useState("day");

  const handleAddSchool = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createSchool.mutate({
      name: formData.get("name") as string,
      shortCode: formData.get("shortCode") as string,
      address: formData.get("address") as string,
      latitude: (formData.get("latitude") as string) || null,
      longitude: (formData.get("longitude") as string) || null,
      phone: formData.get("phone") as string,
      email: formData.get("email") as string,
      schoolType: newSchoolType,
      examinationBoard: newExamBoard,
      enableHostel: newBoardingType === "boarding",
    });
  };

  const handleAddUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createOrgUser.mutate({
      username: formData.get("email") as string,
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      firstName: formData.get("firstName") as string,
      lastName: formData.get("lastName") as string,
    });
  };

  const handleOpenEdit = (orgUser: OrgUser) => {
    setSelectedUser(orgUser);
    setEditFirstName(orgUser.firstName || "");
    setEditLastName(orgUser.lastName || "");
    setEditEmail(orgUser.email || "");
    setIsEditUserOpen(true);
  };

  const handleEditUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedUser) return;
    updateUser.mutate({
      id: selectedUser.id,
      firstName: editFirstName,
      lastName: editLastName,
      email: editEmail,
    });
  };

  const handleOpenPermissions = (orgUser: OrgUser) => {
    permissionDraftInitializedForUserRef.current = null;
    setSelectedUser(orgUser);
    setIsEditingPermissions(false);
    setIsPermissionsOpen(true);
  };

  const handleOpenDelete = (orgUser: OrgUser) => {
    setSelectedUser(orgUser);
    setIsDeleteConfirmOpen(true);
  };

  const handleSavePermissions = () => {
    if (!selectedUser) return;
    updateUserPermissions.mutate({
      userId: selectedUser.id,
      schoolIds: selectedSchools,
      permissionIds: selectedPermissions,
    });
  };

  const handleResetPermissionOverrides = () => {
    setSelectedPermissions(userPermissionStates.filter((state) => state.groupGranted).map((state) => state.permission.id));
  };

  const toggleSchool = (schoolId: number) => {
    setSelectedSchools(prev => 
      prev.includes(schoolId) 
        ? prev.filter(id => id !== schoolId)
        : [...prev, schoolId]
    );
  };

  const togglePermission = (permId: number) => {
    setSelectedPermissions(prev =>
      prev.includes(permId)
        ? prev.filter(id => id !== permId)
        : [...prev, permId]
    );
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const toggleAllInCategory = (category: string, checked: boolean) => {
    const categoryPermIds = permissions.filter(p => p.category === category).map(p => p.id);
    if (checked) {
      setSelectedPermissions(prev => Array.from(new Set([...prev, ...categoryPermIds])));
    } else {
      setSelectedPermissions(prev => prev.filter(id => !categoryPermIds.includes(id)));
    }
  };

  const isCategoryFullySelected = (category: string) => {
    const categoryPermIds = permissions.filter(p => p.category === category).map(p => p.id);
    return categoryPermIds.every(id => selectedPermissions.includes(id));
  };

  const isCategoryPartiallySelected = (category: string) => {
    const categoryPermIds = permissions.filter(p => p.category === category).map(p => p.id);
    return categoryPermIds.some(id => selectedPermissions.includes(id)) && !isCategoryFullySelected(category);
  };

  const permissionsByCategory = permissions.reduce((acc, perm) => {
    if (!acc[perm.category]) acc[perm.category] = [];
    acc[perm.category].push(perm);
    return acc;
  }, {} as Record<string, Permission[]>);

  const userPermissionStateMap = new Map(userPermissionStates.map((state) => [state.permission.id, state]));

  const getPermissionDisplayState = (permissionId: number) => {
    const state = userPermissionStateMap.get(permissionId);
    const selected = selectedPermissions.includes(permissionId);
    const groupGranted = state?.groupGranted === true;

    if (selected && groupGranted) return { checked: true, label: "Group", className: "bg-[#13294B] text-white border-transparent" };
    if (selected && !groupGranted) return { checked: true, label: "Granted Override", className: "bg-[#13294B] text-white border-transparent" };
    if (!selected && groupGranted) return { checked: false, label: "Denied Override", className: "bg-[#7A1E2C] text-white border-transparent" };
    return { checked: false, label: null, className: "" };
  };

  const allSchoolsEnabled = schools.length > 0 && selectedSchools.length === schools.length;
  const permissionsModalLoading = !!selectedUser && (userSchoolAccessLoading || userPermissionStatesLoading);

  const scrollToHqSection = (sectionId: string) => {
    setIsHqNavOpen(false);
    window.requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const hqNavigation = (mobile = false) => (
    <nav className="space-y-5" aria-label="HQ applications">
      <div>
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Organisation</p>
        <div className="space-y-1">
          <Button variant="ghost" className="w-full justify-start" onClick={() => scrollToHqSection("hq-overview")}><LayoutDashboard className="mr-2 h-4 w-4" />HQ Overview</Button>
          <Button variant="ghost" className="w-full justify-start" onClick={() => scrollToHqSection("hq-staff")}><Users className="mr-2 h-4 w-4" />HQ Staff</Button>
          <Button variant="ghost" className="w-full justify-start" onClick={() => { setIsArchivedOpen(true); if (mobile) setIsHqNavOpen(false); }}><Archive className="mr-2 h-4 w-4" />Archived Centres</Button>
        </div>
      </div>
      <div>
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operations</p>
        <div className="space-y-1">
          {hasPermission("calendar.view") && <Button variant="ghost" className="w-full justify-start" onClick={() => { setIsCalendarOpen(true); if (mobile) setIsHqNavOpen(false); }}><Calendar className="mr-2 h-4 w-4" />Calendar</Button>}
          <Button variant="ghost" className="w-full justify-start" onClick={() => { setIsInternalTransfersOpen(true); if (mobile) setIsHqNavOpen(false); }}><ArrowRightLeft className="mr-2 h-4 w-4" />Internal Transfers</Button>
          {(hasPermission("transport.organization.view") || hasPermission("transport.organization.reports") || hasPermission("transport.organization.manage")) && <Button variant="ghost" className="w-full justify-start" onClick={() => { setIsTransportOversightOpen(true); if (mobile) setIsHqNavOpen(false); }}><BusFront className="mr-2 h-4 w-4" />Transport</Button>}
          {(hasPermission("assets.view") || hasPermission("inventory.view")) && <Button variant="ghost" className="w-full justify-start" onClick={() => { setIsAssetsInventoryOpen(true); if (mobile) setIsHqNavOpen(false); }}><PackageSearch className="mr-2 h-4 w-4" />Assets & Inventory</Button>}
          {hasPermission("fleet.view") && <Button variant="ghost" className="w-full justify-start" onClick={() => { setIsFleetManagementOpen(true); if (mobile) setIsHqNavOpen(false); }}><CarFront className="mr-2 h-4 w-4" />Fleet Management</Button>}
          {hasPermission("recruitment.view") && <Button variant="ghost" className="w-full justify-start" onClick={() => { setIsRecruitmentOpen(true); if (mobile) setIsHqNavOpen(false); }}><BriefcaseBusiness className="mr-2 h-4 w-4" />Recruitment</Button>}
        </div>
      </div>
      <div>
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Governance</p>
        <div className="space-y-1">
          <Button variant="ghost" className="w-full justify-start" onClick={() => { setOrgSettingsTab("activity-logs"); setIsOrgSettingsOpen(true); if (mobile) setIsHqNavOpen(false); }}><ClipboardList className="mr-2 h-4 w-4" />Activity Logs</Button>
          <Button variant="ghost" className="w-full justify-start" onClick={() => { setOrgSettingsTab("access-rights"); setIsOrgSettingsOpen(true); if (mobile) setIsHqNavOpen(false); }}><Shield className="mr-2 h-4 w-4" />Access Groups & Permissions</Button>
          <Button variant="ghost" className="w-full justify-start" onClick={() => { setOrgSettingsTab("hq-info"); setIsOrgSettingsOpen(true); if (mobile) setIsHqNavOpen(false); }}><Settings className="mr-2 h-4 w-4" />Global Settings</Button>
        </div>
      </div>
    </nav>
  );

  if (schoolsLoading || usersLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r bg-card lg:flex">
        <div className="border-b px-5 py-5">
          <p className="text-sm font-semibold">HQ Applications</p>
          <p className="mt-1 text-xs text-muted-foreground">Organisation workspace</p>
        </div>
        <ScrollArea className="flex-1 px-3 py-4">{hqNavigation()}</ScrollArea>
      </aside>
      <div className="lg:pl-72">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
            {orgBranding?.logo ? (
              <img 
                src={orgBranding.logo} 
                alt="School Logo" 
                className="h-20 w-auto rounded-md object-contain"
                data-testid="img-org-logo"
              />
            ) : (
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                <GraduationCap className="h-6 w-6 text-primary" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold break-words" data-testid="text-welcome-heading">{orgBranding?.name || "First Choice Group Of Schools"}</h1>
              {orgBranding?.motto && (
                <p className="text-sm text-muted-foreground break-words" data-testid="text-org-motto">{orgBranding.motto}</p>
              )}
              {orgBranding?.address && (
                <p className="mt-0.5 flex flex-wrap items-start gap-1.5 text-sm text-muted-foreground" data-testid="text-org-address">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  {orgBranding.address}
                </p>
              )}
              {(orgBranding?.phone || orgBranding?.email) && (
                <div className="flex flex-wrap items-center gap-4 mt-0.5">
                  {orgBranding.phone && (
                    <span className="text-sm text-muted-foreground flex items-center gap-1.5 break-all" data-testid="text-org-phone">
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      {orgBranding.phone}
                    </span>
                  )}
                  {orgBranding.email && (
                    <span className="text-sm text-muted-foreground flex items-center gap-1.5 break-all" data-testid="text-org-email">
                      <Mail className="w-3.5 h-3.5 shrink-0" />
                      {orgBranding.email}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Button variant="outline" size="icon" className="lg:hidden" onClick={() => setIsHqNavOpen(true)} aria-label="Open HQ applications" data-testid="button-open-hq-navigation"><Menu className="h-5 w-5" /></Button>
            <Sheet open={isHqNavOpen} onOpenChange={setIsHqNavOpen}>
              <SheetContent side="left" className="w-[88vw] max-w-sm">
                <SheetHeader><SheetTitle>HQ Applications</SheetTitle><SheetDescription>Navigate organisation operations and governance.</SheetDescription></SheetHeader>
                <ScrollArea className="mt-6 h-[calc(100dvh-8rem)] pr-2">{hqNavigation(true)}</ScrollArea>
              </SheetContent>
            </Sheet>
            <Sheet open={isArchivedOpen} onOpenChange={setIsArchivedOpen}>
              <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Archive className="h-5 w-5" />
                    Archived Schools
                  </SheetTitle>
                  <SheetDescription>Schools that have been archived after termination. You can enter any archived school in read-only mode to view its data.</SheetDescription>
                </SheetHeader>
                <div className="mt-4 space-y-3">
                  {archivedLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
                    </div>
                  ) : archivedSchools && archivedSchools.length > 0 ? (
                    archivedSchools.map((s) => (
                      <Card key={s.id} data-testid={`archived-school-${s.id}`}>
                        <CardContent className="p-4">
                          <div className="min-w-0">
                            <h4 className="font-medium text-sm truncate">{s.name}</h4>
                            {s.shortCode && (
                              <p className="text-xs text-muted-foreground">{s.shortCode}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <Badge variant="secondary" className="text-[10px]">
                                {s.schoolType || "secondary"}
                              </Badge>
                              {s.archivedAt && (
                                <span className="text-[11px] text-muted-foreground">
                                  Archived {getTimeAgo(s.archivedAt)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => {
                                  enterSchool(s.id);
                                  setIsArchivedOpen(false);
                                  setLocation("/");
                                }}
                                data-testid={`button-enter-archived-${s.id}`}
                              >
                                <Eye className="h-3 w-3 mr-1" />
                                View School (Read Only)
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => unarchiveMutation.mutate(s.id)}
                                disabled={unarchiveMutation.isPending}
                                data-testid={`button-unarchive-${s.id}`}
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
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications">
                  <Bell className="h-5 w-5" />
                  {(unreadCount?.count ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center" data-testid="badge-unread-count">
                      {unreadCount!.count > 99 ? "99+" : unreadCount!.count}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 p-0">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <h3 className="font-semibold text-sm">Notifications</h3>
                  {notificationsData.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-start sm:justify-center"
                      onClick={() => markAllAsRead.mutate()}
                      disabled={markAllAsRead.isPending}
                      data-testid="button-mark-all-read"
                    >
                      Mark all read
                    </Button>
                  )}
                </div>
                <ScrollArea className="max-h-80">
                  {notificationsData.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Bell className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">No notifications</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {notificationsData.map((notif) => (
                        <div
                          key={notif.id}
                          className={`px-4 py-3 hover-elevate cursor-pointer ${!notif.readAt ? "bg-primary/5" : ""}`}
                          onClick={() => { if (!notif.readAt) markAsRead.mutate(notif.id); }}
                          data-testid={`notification-item-${notif.id}`}
                        >
                          <div className="flex items-start gap-2">
                            <div className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${!notif.readAt ? "bg-primary" : "bg-transparent"}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{notif.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {notif.createdAt ? new Date(notif.createdAt).toLocaleString("en-US", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : ""}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <Button 
              variant="ghost" 
              className="w-full justify-center text-red-500 sm:w-auto"
              onClick={handleLogout}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main id="hq-overview" className="container mx-auto scroll-mt-4 space-y-6 px-4 py-6 sm:space-y-8 sm:py-8">
        <Card id="hq-centres">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Centres / Schools
            </CardTitle>
            <Dialog open={isAddSchoolOpen} onOpenChange={setIsAddSchoolOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full sm:w-auto" data-testid="button-add-school">
                  <Plus className="h-4 w-4 mr-2" />
                  Add a School
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New School</DialogTitle>
                  <DialogDescription>Add a new school to your organization</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddSchool} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">School Name</Label>
                    <Input id="name" name="name" required data-testid="input-school-name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="shortCode">Short Code</Label>
                    <Input id="shortCode" name="shortCode" required placeholder="e.g., FCGS-HF" data-testid="input-school-code" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input id="address" name="address" data-testid="input-school-address" />
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="latitude">Latitude</Label>
                      <Input id="latitude" name="latitude" placeholder="e.g., -17.8292" data-testid="input-school-latitude" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="longitude">Longitude</Label>
                      <Input id="longitude" name="longitude" placeholder="e.g., 31.0522" data-testid="input-school-longitude" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" name="phone" data-testid="input-school-phone" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" name="email" type="email" data-testid="input-school-email" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>School Type</Label>
                      <Select value={newSchoolType} onValueChange={setNewSchoolType}>
                        <SelectTrigger data-testid="select-school-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="primary">Primary</SelectItem>
                          <SelectItem value="secondary">Secondary</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Examination Board</Label>
                      <Select value={newExamBoard} onValueChange={setNewExamBoard}>
                        <SelectTrigger data-testid="select-exam-board">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ZIMSEC">ZIMSEC</SelectItem>
                          <SelectItem value="Cambridge">Cambridge</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Boarding / Day</Label>
                      <Select value={newBoardingType} onValueChange={setNewBoardingType}>
                        <SelectTrigger data-testid="select-boarding-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="day">Day School</SelectItem>
                          <SelectItem value="boarding">Boarding School</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={createSchool.isPending}>
                    Add School
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {schools.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <SchoolIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No schools yet. Add your first school to get started.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {schools.map((school) => {
                  const isPending = school.terminationStatus === "pending";
                  const initiator = isPending && school.terminationByUserId
                    ? orgUsers.find(u => u.id === school.terminationByUserId)
                    : null;
                  const initiatorName = initiator
                    ? `${initiator.firstName || ""} ${initiator.lastName || ""}`.trim() || initiator.username
                    : "Unknown";

                  return (
                    <div
                      key={school.id}
                      className={`p-4 border rounded-lg ${isPending ? "border-destructive/50 bg-destructive/5" : "hover-elevate"}`}
                      data-testid={`school-card-${school.id}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className={`h-10 w-10 rounded-full flex items-center justify-center ${isPending ? "bg-destructive/10" : "bg-primary/10"}`}>
                            {isPending ? (
                              <AlertTriangle className="h-5 w-5 text-destructive" />
                            ) : (
                              <Building2 className="h-5 w-5 text-primary" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-medium break-words">{school.name}</h3>
                            <p className="flex flex-wrap items-start gap-1 text-sm text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              {school.address || "No address"}
                              {school.latitude && school.longitude && (
                                <span className="text-[10px] opacity-60 ml-1">({school.latitude}, {school.longitude})</span>
                              )}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 leading-4 no-default-hover-elevate no-default-active-elevate" data-testid={`badge-type-${school.id}`}>
                                {school.schoolType === "primary" ? "Primary" : "Secondary"}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 leading-4 no-default-hover-elevate no-default-active-elevate" data-testid={`badge-board-${school.id}`}>
                                {school.examinationBoard || "ZIMSEC"}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 leading-4 no-default-hover-elevate no-default-active-elevate" data-testid={`badge-boarding-${school.id}`}>
                                {school.enableHostel ? "Boarding" : "Day School"}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                          {!isPending && (
                            <>
                              <button
                                className="text-emerald-600 hover:text-emerald-700 hover:underline text-sm font-medium"
                                onClick={() => handleEnterSchool(school.id)}
                                data-testid={`button-enter-school-${school.id}`}
                              >
                                Enter School
                              </button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setSchoolToDelete(school)}
                                data-testid={`button-delete-school-${school.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
                          )}
                          {isPending && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => restoreSchool.mutate(school.id)}
                              disabled={restoreSchool.isPending}
                              data-testid={`button-restore-school-${school.id}`}
                            >
                              <RotateCcw className="h-4 w-4 mr-1" />
                              Restore
                            </Button>
                          )}
                        </div>
                      </div>
                      {isPending && (
                        <div className="mt-3 pt-3 border-t border-destructive/20">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm text-destructive font-medium" data-testid={`text-countdown-${school.id}`}>
                              <Clock className="h-4 w-4" />
                              <span>Archival in: {getCountdown(school.terminationAt)}</span>
                            </div>
                            <span className="text-xs text-muted-foreground" data-testid={`text-initiated-by-${school.id}`}>
                              Initiated by {initiatorName}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Global Search */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Global Search
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search staff, students, parents by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-9"
                data-testid="input-global-search"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchQuery("")}
                  data-testid="button-clear-search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {searchLoading && debouncedSearch.length >= 2 && (
              <div className="text-center py-4 text-muted-foreground">
                Searching...
              </div>
            )}

            {searchResults && debouncedSearch.length >= 2 && (
              <div className="space-y-4">
                {searchResults.staff.length === 0 && searchResults.students.length === 0 && searchResults.parents.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    No results found for "{debouncedSearch}"
                  </div>
                ) : (
                  <>
                    {searchResults.staff.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <UserIcon className="h-4 w-4" />
                          Staff ({searchResults.staff.length})
                        </h4>
                        <div className="border rounded-lg divide-y">
                          {searchResults.staff.map((staffMember) => (
                            <div
                              key={staffMember.id}
                              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                              data-testid={`search-result-staff-${staffMember.id}`}
                            >
                              <div className="flex-1">
                                <div className="font-medium">{staffMember.firstName} {staffMember.lastName}</div>
                                <div className="text-sm text-muted-foreground">
                                  {staffMember.email && <span>{staffMember.email}</span>}
                                  {staffMember.email && staffMember.phone && <span className="mx-2">•</span>}
                                  {staffMember.phone && <span>{staffMember.phone}</span>}
                                </div>
                              </div>
                              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                                <Badge variant="secondary" className="flex items-center gap-1">
                                  <SchoolIcon className="h-3 w-3" />
                                  {staffMember.schoolName}
                                </Badge>
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => {
                                    if (staffMember.schoolId) {
                                      enterSchool(staffMember.schoolId);
                                    }
                                    setLocation(`/staff-360?id=${staffMember.id}`);
                                  }}
                                  data-testid={`button-profile-staff-${staffMember.id}`}
                                >
                                  360 Profile
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (staffMember.schoolId) {
                                      enterSchool(staffMember.schoolId);
                                      setLocation("/staff");
                                    }
                                  }}
                                  data-testid={`button-visit-staff-${staffMember.id}`}
                                >
                                  <ExternalLink className="h-4 w-4 mr-1" />
                                  Visit
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResults.students.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <GraduationCap className="h-4 w-4" />
                          Students ({searchResults.students.length})
                        </h4>
                        <div className="border rounded-lg divide-y">
                          {searchResults.students.map((student) => (
                            <div
                              key={student.id}
                              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                              data-testid={`search-result-student-${student.id}`}
                            >
                              <div className="flex-1">
                                <div className="font-medium">{student.firstName} {student.lastName}</div>
                                <div className="text-sm text-muted-foreground">
                                  <span>{student.admissionNo}</span>
                                  {student.email && <span className="mx-2">•</span>}
                                  {student.email && <span>{student.email}</span>}
                                  {student.phone && <span className="mx-2">•</span>}
                                  {student.phone && <span>{student.phone}</span>}
                                </div>
                              </div>
                              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                                <Badge variant="secondary" className="flex items-center gap-1">
                                  <SchoolIcon className="h-3 w-3" />
                                  {student.schoolName}
                                </Badge>
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => {
                                    if (student.schoolId) {
                                      enterSchool(student.schoolId);
                                    }
                                    setLocation(`/student-360?id=${student.id}`);
                                  }}
                                  data-testid={`button-profile-student-${student.id}`}
                                >
                                  360 Profile
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (student.schoolId) {
                                      enterSchool(student.schoolId);
                                      setLocation("/students");
                                    }
                                  }}
                                  data-testid={`button-visit-student-${student.id}`}
                                >
                                  <ExternalLink className="h-4 w-4 mr-1" />
                                  Visit
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResults.parents.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          <UserCircle className="h-4 w-4" />
                          Parents ({searchResults.parents.length})
                        </h4>
                        <div className="border rounded-lg divide-y">
                          {searchResults.parents.map((parent) => (
                            <div
                              key={parent.id}
                              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                              data-testid={`search-result-parent-${parent.id}`}
                            >
                              <div className="flex-1">
                                <div className="font-medium">{parent.firstName} {parent.lastName}</div>
                                <div className="text-sm text-muted-foreground">
                                  {parent.email && <span>{parent.email}</span>}
                                  {parent.email && parent.phone && <span className="mx-2">•</span>}
                                  {parent.phone && <span>{parent.phone}</span>}
                                </div>
                              </div>
                              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                                <Badge variant="outline">Organization-wide</Badge>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setLocation("/parents");
                                  }}
                                  data-testid={`button-visit-parent-${parent.id}`}
                                >
                                  <ExternalLink className="h-4 w-4 mr-1" />
                                  Visit
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {searchQuery.length > 0 && searchQuery.length < 2 && (
              <div className="text-center py-2 text-muted-foreground text-sm">
                Enter at least 2 characters to search
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="hq-staff" className="scroll-mt-6">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              HQ Staff
            </CardTitle>
            <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full sm:w-auto" data-testid="button-add-user">
                  <Plus className="h-4 w-4 mr-2" />
                  Add User
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add HQ Staff Member</DialogTitle>
                  <DialogDescription>Add a new HQ staff member</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddUser} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input id="firstName" name="firstName" required data-testid="input-user-first-name" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input id="lastName" name="lastName" required data-testid="input-user-last-name" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="userEmail">Email</Label>
                    <Input id="userEmail" name="email" type="email" required data-testid="input-user-email" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" name="password" type="password" required data-testid="input-user-password" />
                  </div>
                  <Button type="submit" className="w-full" disabled={createOrgUser.isPending}>
                    Add User
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="space-y-3">
            {orgUsers.filter(u => u.role === "org_admin").length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No HQ staff members yet.</p>
              </div>
            ) : (
              orgUsers.filter(u => u.role === "org_admin").map((orgUser) => (
                <div
                  key={orgUser.id}
                  className="flex flex-col gap-3 py-3 border-b last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`user-row-${orgUser.id}`}
                >
                  <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
                    <RecordPhotoActions
                      entity="users"
                      recordId={orgUser.id}
                      firstName={orgUser.firstName}
                      lastName={orgUser.lastName}
                      recordNumber={`HQ-${orgUser.id}`}
                      photo={orgUser.photo}
                      initials={`${orgUser.firstName?.[0] || orgUser.username[0] || "H"}${orgUser.lastName?.[0] || ""}`.toUpperCase()}
                      canManage={hasPermission("users.edit") || hasPermission("users.manage_photo")}
                      onPhotoUpdated={(photo) => queryClient.setQueryData<OrgUser[]>(["/api/users?role=org_admin"], (rows = []) => rows.map((row) => row.id === orgUser.id ? { ...row, photo } : row))}
                      className="h-10 w-10"
                    />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {orgUser.firstName && orgUser.lastName 
                          ? `${orgUser.firstName} ${orgUser.lastName}` 
                          : orgUser.username}
                      </p>
                      <p className="text-sm text-muted-foreground break-all">{orgUser.email || orgUser.username}</p>
                    </div>
                  </div>
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
                    <Button 
                      variant="ghost"
                      size="sm"
                      className="justify-start sm:justify-center"
                      onClick={() => handleOpenEdit(orgUser)}
                      data-testid={`button-edit-user-${orgUser.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                    <Button 
                      variant="ghost"
                      size="sm"
                      className="justify-start sm:justify-center"
                      onClick={() => handleOpenPermissions(orgUser)}
                      data-testid={`button-permissions-user-${orgUser.id}`}
                    >
                      <Shield className="h-3.5 w-3.5 mr-1" />
                      Permissions
                    </Button>
                    <Button 
                      variant="ghost"
                      size="sm"
                      className="justify-start sm:justify-center"
                      onClick={() => handleOpenManageAccount(orgUser)}
                      data-testid={`button-manage-account-${orgUser.id}`}
                    >
                      <UserCog className="h-3.5 w-3.5 mr-1" />
                      Account
                    </Button>
                    <Button 
                      variant="ghost"
                      size="sm"
                      className="justify-start text-destructive sm:justify-center"
                      onClick={() => handleOpenDelete(orgUser)}
                      data-testid={`button-delete-user-${orgUser.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </main>
      </div>

      <Dialog open={isEditUserOpen} onOpenChange={setIsEditUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user information</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditUser} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="editFirstName">First Name</Label>
                <Input 
                  id="editFirstName" 
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  required 
                  data-testid="input-edit-first-name" 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editLastName">Last Name</Label>
                <Input 
                  id="editLastName" 
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  required 
                  data-testid="input-edit-last-name" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editEmail">Email</Label>
              <Input 
                id="editEmail" 
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                required 
                data-testid="input-edit-email" 
              />
            </div>
            <DialogFooter className="pr-4">
              <Button type="button" variant="outline" onClick={() => setIsEditUserOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateUser.isPending}>
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isPermissionsOpen} onOpenChange={(open) => {
        setIsPermissionsOpen(open);
        if (!open) {
          setIsEditingPermissions(false);
          permissionDraftInitializedForUserRef.current = null;
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Access Rights for {selectedUser?.firstName || selectedUser?.username}
            </DialogTitle>
            <DialogDescription>
              Configure school access scope and permission overrides for this Org HQ user
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  School Access Scope
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Org HQ users normally have access to all schools. Deselect schools here only when you want to restrict this specific user.
                </p>
                <div className="space-y-2 border rounded-lg p-3">
                  <div className="mb-3 flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    <span>{allSchoolsEnabled ? "All current schools enabled" : `${selectedSchools.length} of ${schools.length} schools enabled`}</span>
                    {allSchoolsEnabled && <Badge variant="secondary">All Enabled</Badge>}
                  </div>
                  {schools.map((school) => (
                    <div key={school.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`school-${school.id}`}
                        checked={selectedSchools.includes(school.id)}
                        onCheckedChange={() => toggleSchool(school.id)}
                        disabled={!isEditingPermissions}
                        data-testid={`checkbox-school-${school.id}`}
                      />
                      <label 
                        htmlFor={`school-${school.id}`}
                        className={`text-sm ${isEditingPermissions ? 'cursor-pointer' : 'cursor-default text-muted-foreground'}`}
                      >
                        {school.name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Access Rights
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleResetPermissionOverrides}
                    disabled={!isEditingPermissions || permissionsModalLoading}
                    data-testid="button-reset-hq-permissions"
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Reset to Group Default
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  This checklist shows the Org HQ access-group defaults plus any per-user overrides. Uncheck to create a denied override, or check to create a granted override where needed.
                </p>
                {permissionsModalLoading ? (
                  <div className="space-y-2 border rounded-lg p-6 text-sm text-muted-foreground">
                    Loading access rights...
                  </div>
                ) : (
                <div className="space-y-2 border rounded-lg p-3">
                  {Object.entries(permissionsByCategory).map(([category, perms]) => (
                    <div key={category} className="border-b last:border-b-0 pb-2 last:pb-0">
                      <div 
                        className="flex items-center gap-2 py-1 cursor-pointer"
                        onClick={() => toggleCategory(category)}
                      >
                        {expandedCategories.includes(category) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <Checkbox
                          checked={isCategoryFullySelected(category)}
                          ref={(el) => {
                            if (el) {
                              (el as any).indeterminate = isCategoryPartiallySelected(category);
                            }
                          }}
                          onCheckedChange={(checked) => toggleAllInCategory(category, !!checked)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={!isEditingPermissions}
                          data-testid={`checkbox-category-${category}`}
                        />
                        <span className="text-sm font-medium capitalize">
                          {category.replace(/_/g, " ")}
                        </span>
                        <Badge variant="secondary" className="ml-auto">
                          {perms.filter(p => selectedPermissions.includes(p.id)).length}/{perms.length}
                        </Badge>
                      </div>
                      {expandedCategories.includes(category) && (
                        <div className="ml-8 mt-2 space-y-1">
                          {perms.map((perm) => (
                            <div key={perm.id} className="flex items-center gap-2">
                              <Checkbox
                                id={`perm-${perm.id}`}
                                checked={selectedPermissions.includes(perm.id)}
                                onCheckedChange={() => togglePermission(perm.id)}
                                disabled={!isEditingPermissions}
                                data-testid={`checkbox-permission-${perm.id}`}
                              />
                              <label 
                                htmlFor={`perm-${perm.id}`}
                                className={`text-sm ${isEditingPermissions ? 'cursor-pointer' : 'cursor-default text-muted-foreground'}`}
                              >
                                {perm.name}
                              </label>
                              {getPermissionDisplayState(perm.id).label && (
                                <Badge className={getPermissionDisplayState(perm.id).className}>
                                  {getPermissionDisplayState(perm.id).label}
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="pr-4">
            {isEditingPermissions ? (
              <>
                <Button type="button" variant="outline" onClick={() => setIsEditingPermissions(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleSavePermissions}
                  disabled={updateUserPermissions.isPending || permissionsModalLoading}
                  data-testid="button-save-permissions"
                >
                  Save Changes
                </Button>
              </>
            ) : (
              <Button 
                onClick={() => setIsEditingPermissions(true)}
                data-testid="button-edit-permissions"
                disabled={permissionsModalLoading}
              >
                {permissionsModalLoading ? "Loading..." : "Edit Permissions"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedUser?.firstName || selectedUser?.username}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => selectedUser && deleteUser.mutate(selectedUser.id)}
              disabled={deleteUser.isPending}
              data-testid="button-confirm-delete"
            >
              Delete User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isManageAccountOpen} onOpenChange={(open) => { if (!open) { setIsManageAccountOpen(false); setSelectedUser(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              Manage Account
            </DialogTitle>
            <DialogDescription>
              Manage the user account for {selectedUser?.firstName || selectedUser?.username}
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-lg font-medium">
                  {(selectedUser.firstName?.[0] || selectedUser.username[0]).toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-lg">
                    {selectedUser.firstName && selectedUser.lastName
                      ? `${selectedUser.firstName} ${selectedUser.lastName}`
                      : selectedUser.username}
                  </p>
                  <p className="text-sm text-muted-foreground">{selectedUser.email || selectedUser.username}</p>
                </div>
                <Badge variant={selectedUser.isActive !== false ? "default" : "secondary"} className={selectedUser.isActive !== false ? "bg-green-600" : ""}>
                  {selectedUser.isActive !== false ? "Active" : "Inactive"}
                </Badge>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Username</p>
                <p className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded-md">{selectedUser.username}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="account-new-password" className="text-sm font-medium">Reset Password</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="account-new-password"
                      type={showAccountPassword ? "text" : "password"}
                      placeholder="Enter new password"
                      value={accountNewPassword}
                      onChange={(e) => setAccountNewPassword(e.target.value)}
                      data-testid="input-account-password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0"
                      onClick={() => setShowAccountPassword(!showAccountPassword)}
                      data-testid="button-toggle-account-password"
                    >
                      {showAccountPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <Button
                    onClick={() => selectedUser && accountNewPassword && resetUserPassword.mutate({ userId: selectedUser.id, password: accountNewPassword })}
                    disabled={!accountNewPassword || accountNewPassword.length < 6 || resetUserPassword.isPending}
                    data-testid="button-reset-password"
                  >
                    <KeyRound className="h-4 w-4 mr-1" />
                    Reset
                  </Button>
                </div>
                {accountNewPassword && accountNewPassword.length < 6 && (
                  <p className="text-xs text-destructive">Password must be at least 6 characters</p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <div>
                  <p className="text-sm font-medium">Account Status</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedUser.isActive !== false ? "Account is currently active" : "Account is currently deactivated"}
                  </p>
                </div>
                <Button
                  variant={selectedUser.isActive !== false ? "destructive" : "default"}
                  size="sm"
                  onClick={() => selectedUser && toggleUserStatus.mutate({ userId: selectedUser.id, isActive: selectedUser.isActive === false })}
                  disabled={toggleUserStatus.isPending || selectedUser.id === user?.id}
                  data-testid="button-toggle-status"
                >
                  <Power className="h-3.5 w-3.5 mr-1" />
                  {selectedUser.isActive !== false ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <DialogContent className="w-[calc(100dvw-2rem)] max-w-[calc(100dvw-2rem)] max-h-[calc(100dvh-2rem)] p-0 flex flex-col">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Calendar
            </DialogTitle>
            <DialogDescription>
              View and manage organization calendar events without leaving HQ.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
            <CalendarPage />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isRecruitmentOpen} onOpenChange={setIsRecruitmentOpen}>
        <DialogContent className="flex h-[96dvh] w-[99vw] max-w-[99vw] flex-col gap-0 p-0">
          <DialogHeader className="border-b px-6 pb-4 pt-6">
            <DialogTitle className="flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5" />Recruitment</DialogTitle>
            <DialogDescription>Organization recruitment workspace with school-by-school separation.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RecruitmentPage />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isInternalTransfersOpen} onOpenChange={setIsInternalTransfersOpen}>
        <DialogContent className="w-[98vw] max-w-7xl h-[92vh] overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              Internal Transfers
            </DialogTitle>
            <DialogDescription>
              Transfer students and staff between schools in the organisation.
            </DialogDescription>
          </DialogHeader>
          <div className="px-2 pb-6">
            <InternalTransfersPage />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isTransportOversightOpen} onOpenChange={setIsTransportOversightOpen}>
        <DialogContent className="flex h-[94dvh] w-[98vw] max-w-[98vw] flex-col p-0">
          <DialogHeader className="border-b px-6 pb-4 pt-6">
            <DialogTitle className="flex items-center gap-2"><BusFront className="h-5 w-5" />Transport Oversight</DialogTitle>
            <DialogDescription>Read-only organisation monitoring of outsourced school transport services.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-6"><OrgTransportOversightPage /></div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAssetsInventoryOpen} onOpenChange={setIsAssetsInventoryOpen}>
        <DialogContent className="flex h-[96dvh] w-[99vw] max-w-[99vw] flex-col p-0">
          <DialogHeader className="border-b px-6 pb-4 pt-6">
            <DialogTitle className="flex items-center gap-2"><PackageSearch className="h-5 w-5" />Assets & Inventory</DialogTitle>
            <DialogDescription>Operate HQ stores and assets or switch to organisation-wide and centre views.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto"><AssetsInventoryPage /></div>
        </DialogContent>
      </Dialog>

      <Dialog open={isFleetManagementOpen} onOpenChange={setIsFleetManagementOpen}>
        <DialogContent className="flex h-[96dvh] w-[99vw] max-w-[99vw] flex-col p-0">
          <DialogHeader className="border-b px-6 pb-4 pt-6">
            <DialogTitle className="flex items-center gap-2"><CarFront className="h-5 w-5" />Fleet Management</DialogTitle>
            <DialogDescription>Organisation-wide Fleet operations connected to Assets & Inventory and school transport.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto"><FleetManagementPage /></div>
        </DialogContent>
      </Dialog>

      <Dialog open={isOrgSettingsOpen} onOpenChange={(open) => {
        setIsOrgSettingsOpen(open);
        if (!open) {
          setIsEditingAcademic(false);
          setIsEditingHqInfo(false);
          setIsEditingHqBranding(false);
        }
      }}>
        <DialogContent className="max-w-5xl max-h-[calc(100dvh-2rem)] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {orgSettingsTab === "activity-logs" ? "Activity Logs" : orgSettingsTab === "access-rights" ? "Access Groups & Permissions" : "Global Settings"}
            </DialogTitle>
            <DialogDescription>
              {orgSettingsTab === "activity-logs" ? "Review organisation activity and audit history." : orgSettingsTab === "access-rights" ? "Manage HQ and school access groups, roles and permission assignments." : "Configure global settings for your organization. These apply to all schools."}
            </DialogDescription>
          </DialogHeader>
          <Tabs value={orgSettingsTab} onValueChange={setOrgSettingsTab} className="flex-1 overflow-hidden flex flex-col">
            <TabsList data-testid="tabs-org-settings">
              <TabsTrigger value="hq-info" data-testid="tab-org-hq-info">
                <Building2 className="h-4 w-4 mr-1" />
                HQ Information
              </TabsTrigger>
              <TabsTrigger value="academic" data-testid="tab-org-academic">
                <Calendar className="h-4 w-4 mr-1" />
                Academic Settings
              </TabsTrigger>
              <TabsTrigger value="features" data-testid="tab-org-features">
                <SlidersHorizontal className="h-4 w-4 mr-1" />
                Features
              </TabsTrigger>
              <TabsTrigger value="language-tools" data-testid="tab-org-language-tools">
                <Languages className="h-4 w-4 mr-1" />
                Language Tools
              </TabsTrigger>
              <TabsTrigger value="attendance-day" data-testid="tab-org-attendance-day">
                <Clock className="h-4 w-4 mr-1" />
                Attendance & School Day
              </TabsTrigger>
              <TabsTrigger value="access-rights" data-testid="tab-org-access-rights">
                <Shield className="h-4 w-4 mr-1" />
                Access Rights
              </TabsTrigger>
              <TabsTrigger value="activity-logs" data-testid="tab-org-activity-logs">
                <ClipboardList className="h-4 w-4 mr-1" />
                Activity Logs
              </TabsTrigger>
            </TabsList>
            <TabsContent value="hq-info" className="flex-1 overflow-y-auto mt-4 space-y-6">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold">HQ Branding</h3>
                    <p className="text-sm text-muted-foreground">Logo, stamp, and motto used on the login page and HQ dashboard</p>
                  </div>
                  {!isEditingHqBranding && (
                    <Button variant="outline" onClick={() => {
                      if (orgData) {
                        setHqBrandingValues({
                          logo: orgData.logo || "",
                          stamp: orgData.stamp || "",
                          motto: orgData.motto || "",
                        });
                      }
                      setIsEditingHqBranding(true);
                    }} data-testid="button-edit-hq-branding">
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  )}
                </div>
                <div className="grid gap-6 md:grid-cols-2">
                  <HqImageUpload
                    label="Organization Logo"
                    description="Appears on the login page and HQ dashboard"
                    currentImage={isEditingHqBranding ? hqBrandingValues.logo : (orgData?.logo || null)}
                    onUploadComplete={(url) => setHqBrandingValues(prev => ({ ...prev, logo: url }))}
                    icon={<ImageIcon className="h-8 w-8 text-muted-foreground" />}
                    testIdPrefix="hq-logo"
                    disabled={!isEditingHqBranding}
                  />
                  <HqImageUpload
                    label="Organization Stamp"
                    description="Official organization stamp image"
                    currentImage={isEditingHqBranding ? hqBrandingValues.stamp : (orgData?.stamp || null)}
                    onUploadComplete={(url) => setHqBrandingValues(prev => ({ ...prev, stamp: url }))}
                    icon={<Stamp className="h-8 w-8 text-muted-foreground" />}
                    testIdPrefix="hq-stamp"
                    disabled={!isEditingHqBranding}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hq-motto">Organization Motto</Label>
                  <Input
                    id="hq-motto"
                    placeholder="Enter organization motto"
                    value={isEditingHqBranding ? hqBrandingValues.motto : (orgData?.motto || "")}
                    disabled={!isEditingHqBranding}
                    onChange={(e) => setHqBrandingValues(prev => ({ ...prev, motto: e.target.value }))}
                    data-testid="input-hq-motto"
                  />
                  <p className="text-xs text-muted-foreground">Displayed on the login page and HQ dashboard</p>
                </div>
                {isEditingHqBranding && (
                  <div className="flex gap-2 pt-4 border-t">
                    <Button
                      onClick={() => {
                        updateOrgSettings.mutate({
                          logo: hqBrandingValues.logo || null,
                          stamp: hqBrandingValues.stamp || null,
                          motto: hqBrandingValues.motto || null,
                        }, {
                          onSuccess: () => setIsEditingHqBranding(false),
                        });
                      }}
                      disabled={updateOrgSettings.isPending}
                      data-testid="button-save-hq-branding"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save Branding
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (orgData) {
                          setHqBrandingValues({
                            logo: orgData.logo || "",
                            stamp: orgData.stamp || "",
                            motto: orgData.motto || "",
                          });
                        }
                        setIsEditingHqBranding(false);
                      }}
                      disabled={updateOrgSettings.isPending}
                      data-testid="button-cancel-hq-branding"
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                <div className="border-t pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold">HQ Contact Details</h3>
                      <p className="text-sm text-muted-foreground">Organization name, email, phone, and address</p>
                    </div>
                    {!isEditingHqInfo && (
                      <Button variant="outline" onClick={() => {
                        if (orgData) {
                          setHqInfoValues({
                            name: orgData.name || "",
                            email: orgData.email || "",
                            phone: orgData.phone || "",
                            address: orgData.address || "",
                            systemUrl: orgData.systemUrl || "",
                          });
                        }
                        setIsEditingHqInfo(true);
                      }} data-testid="button-edit-hq-info">
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="hq-name">Organization Name</Label>
                      <Input
                        id="hq-name"
                        value={isEditingHqInfo ? hqInfoValues.name : (orgData?.name || "")}
                        onChange={(e) => setHqInfoValues(prev => ({ ...prev, name: e.target.value }))}
                        disabled={!isEditingHqInfo}
                        data-testid="input-hq-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hq-email">Email</Label>
                      <Input
                        id="hq-email"
                        type="email"
                        value={isEditingHqInfo ? hqInfoValues.email : (orgData?.email || "")}
                        onChange={(e) => setHqInfoValues(prev => ({ ...prev, email: e.target.value }))}
                        disabled={!isEditingHqInfo}
                        data-testid="input-hq-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hq-phone">Phone</Label>
                      <Input
                        id="hq-phone"
                        value={isEditingHqInfo ? hqInfoValues.phone : (orgData?.phone || "")}
                        onChange={(e) => setHqInfoValues(prev => ({ ...prev, phone: e.target.value }))}
                        disabled={!isEditingHqInfo}
                        data-testid="input-hq-phone"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hq-address">Address</Label>
                      <Input
                        id="hq-address"
                        value={isEditingHqInfo ? hqInfoValues.address : (orgData?.address || "")}
                        onChange={(e) => setHqInfoValues(prev => ({ ...prev, address: e.target.value }))}
                        disabled={!isEditingHqInfo}
                        data-testid="input-hq-address"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="hq-system-url">System URL</Label>
                      <Input
                        id="hq-system-url"
                        type="url"
                        placeholder="https://your-school-system.example.com"
                        value={isEditingHqInfo ? hqInfoValues.systemUrl : (orgData?.systemUrl || "")}
                        onChange={(e) => setHqInfoValues(prev => ({ ...prev, systemUrl: e.target.value }))}
                        disabled={!isEditingHqInfo}
                        data-testid="input-hq-system-url"
                      />
                      <p className="text-xs text-muted-foreground">
                        This link is included in account creation messages sent to staff, students, and parents.
                      </p>
                    </div>
                  </div>
                  {isEditingHqInfo && (
                    <div className="flex gap-2 pt-4 border-t mt-4">
                      <Button
                        onClick={() => {
                          updateOrgSettings.mutate({
                            name: hqInfoValues.name,
                            email: hqInfoValues.email || null,
                            phone: hqInfoValues.phone || null,
                            address: hqInfoValues.address || null,
                            systemUrl: hqInfoValues.systemUrl || null,
                          }, {
                            onSuccess: () => setIsEditingHqInfo(false),
                          });
                        }}
                        disabled={updateOrgSettings.isPending}
                        data-testid="button-save-hq-info"
                      >
                        <Save className="h-4 w-4 mr-2" />
                        Save Details
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (orgData) {
                            setHqInfoValues({
                              name: orgData.name || "",
                              email: orgData.email || "",
                              phone: orgData.phone || "",
                              address: orgData.address || "",
                              systemUrl: orgData.systemUrl || "",
                            });
                          }
                          setIsEditingHqInfo(false);
                        }}
                        disabled={updateOrgSettings.isPending}
                        data-testid="button-cancel-hq-info"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="academic" className="flex-1 overflow-y-auto mt-4 space-y-6">
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Button className="bg-primary text-primary-foreground" onClick={() => setIsAssessmentTypesDialogOpen(true)} data-testid="button-open-assessment-types">
                  <Tag className="w-4 h-4 mr-2" />
                  Assessment Types
                </Button>
                <Button className="bg-primary text-primary-foreground" onClick={() => setIsExamsDialogOpen(true)} data-testid="button-open-exams">
                  <FileText className="w-4 h-4 mr-2" />
                  Exercises/Exams
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold">Academic Year & Terms</h3>
                  <p className="text-sm text-muted-foreground">Configure the current academic year, term, and term date ranges</p>
                </div>
                {!isEditingAcademic && (
                  <Button variant="outline" onClick={() => setIsEditingAcademic(true)} data-testid="button-edit-org-academic">
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Current Academic Year</Label>
                  <InfiniteYearPicker
                    value={orgAcademicYear.toString()}
                    onValueChange={(v) => setOrgAcademicYear(parseInt(v))}
                    placeholder="Select year"
                    disabled={!isEditingAcademic}
                    dataTestId="select-org-academic-year"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Current Term</Label>
                  <Select
                    value={orgTerm}
                    onValueChange={(v) => setOrgTerm(v)}
                    disabled={!isEditingAcademic}
                  >
                    <SelectTrigger data-testid="select-org-term">
                      <SelectValue placeholder="Select term" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="term1">Term 1</SelectItem>
                      <SelectItem value="vac1">Vacation 1</SelectItem>
                      <SelectItem value="term2">Term 2</SelectItem>
                      <SelectItem value="vac2">Vacation 2</SelectItem>
                      <SelectItem value="term3">Term 3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-semibold">Term Dates</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Leave blank to use default dates (mid-month transitions)
                  </p>
                </div>

                {[
                  { key: "term1", label: "Term 1", startField: "term1Start" as const, endField: "term1End" as const },
                  { key: "vac1", label: "Vacation 1", startField: "vac1Start" as const, endField: "vac1End" as const, isVacation: true },
                  { key: "term2", label: "Term 2", startField: "term2Start" as const, endField: "term2End" as const },
                  { key: "vac2", label: "Vacation 2", startField: "vac2Start" as const, endField: "vac2End" as const, isVacation: true },
                  { key: "term3", label: "Term 3", startField: "term3Start" as const, endField: "term3End" as const },
                ].map((period) => (
                  <div key={period.key} className="space-y-4 border rounded-md p-4">
                    <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                      <Badge variant={orgTerm === period.key ? "default" : "secondary"}>{period.label}</Badge>
                      {period.isVacation && (
                        <span className="text-muted-foreground text-xs">(auto-derived if blank)</span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Start Date</Label>
                        <Input
                          type="date"
                          value={orgTermDates[period.startField]}
                          onChange={(e) => setOrgTermDates({ ...orgTermDates, [period.startField]: e.target.value })}
                          disabled={!isEditingAcademic}
                          data-testid={`input-org-${period.key}-start`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">End Date</Label>
                        <Input
                          type="date"
                          value={orgTermDates[period.endField]}
                          onChange={(e) => setOrgTermDates({ ...orgTermDates, [period.endField]: e.target.value })}
                          disabled={!isEditingAcademic}
                          data-testid={`input-org-${period.key}-end`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {isEditingAcademic && (
                <div className="pt-4 border-t flex gap-2">
                  <Button onClick={handleSaveOrgAcademic} disabled={updateOrgSettings.isPending} data-testid="button-save-org-academic">
                    <Save className="h-4 w-4 mr-2" />
                    Save Academic Settings
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelOrgAcademic}
                    disabled={updateOrgSettings.isPending}
                    data-testid="button-cancel-org-academic"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </TabsContent>
            <TabsContent value="features" className="flex-1 overflow-y-auto mt-4 space-y-6">
              <div className="space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-base font-semibold">Upload Settings</h3>
                    <p className="text-sm text-muted-foreground">Configure file upload limits that apply across all schools</p>
                  </div>
                  {!isEditingFeatures && (
                    <Button variant="outline" onClick={() => {
                      setFeaturesValues({ photoUploadLimitMB: orgData?.photoUploadLimitMB ?? 5 });
                      setIsEditingFeatures(true);
                    }} data-testid="button-edit-features">
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  )}
                </div>
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">Photo Upload Size Limit</p>
                          <p className="text-xs text-muted-foreground">Maximum file size for student and staff profile photos</p>
                        </div>
                        {isEditingFeatures ? (
                          <Select
                            value={String(featuresValues.photoUploadLimitMB)}
                            onValueChange={(val) => setFeaturesValues({ ...featuresValues, photoUploadLimitMB: parseInt(val) })}
                          >
                            <SelectTrigger className="w-full sm:w-[120px]" data-testid="select-photo-limit">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="2">2 MB</SelectItem>
                              <SelectItem value="5">5 MB</SelectItem>
                              <SelectItem value="10">10 MB</SelectItem>
                              <SelectItem value="15">15 MB</SelectItem>
                              <SelectItem value="20">20 MB</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="secondary" data-testid="badge-photo-limit">{orgData?.photoUploadLimitMB ?? 5} MB</Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {isEditingFeatures && (
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => setIsEditingFeatures(false)} data-testid="button-cancel-features">Cancel</Button>
                    <Button
                      onClick={() => {
                        updateOrgSettings.mutate(featuresValues);
                        setIsEditingFeatures(false);
                      }}
                      disabled={updateOrgSettings.isPending}
                      data-testid="button-save-features"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="attendance-day" className="flex-1 overflow-y-auto mt-4">
              <ParentAttendanceNotifications />
            </TabsContent>

            <TabsContent value="language-tools" className="flex-1 overflow-y-auto mt-4">
              <LanguageToolsGlobalSettings />
            </TabsContent>
            <TabsContent value="access-rights" className="flex-1 overflow-y-auto mt-4">
              <AccessRightsSection />
            </TabsContent>
            <TabsContent value="activity-logs" className="flex-1 overflow-y-auto mt-4">
              <OrgActivityLogsSection schools={schools} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={isAssessmentTypesDialogOpen} onOpenChange={setIsAssessmentTypesDialogOpen}>
        <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Assessment Types</DialogTitle>
            <DialogDescription>Manage global assessment types used across all schools</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(!assessmentTypes || assessmentTypes.length === 0) ? (
              <div className="text-center py-6 text-muted-foreground">
                <Tag className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No assessment types created yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {assessmentTypes.map((type) => (
                  <div key={type.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`row-assessment-type-${type.id}`}>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm" data-testid={`text-type-name-${type.id}`}>{type.name}</p>
                      {type.description && (
                        <p className="text-xs text-muted-foreground">{type.description}</p>
                      )}
                      <Badge variant="outline" className="mt-1 text-[10px]">
                        {type.assessmentCardinality === "single_per_exam"
                          ? "One assessment per subject/exam"
                          : "Multiple assessments allowed"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingAssessmentType(type);
                          setAssessmentTypeName(type.name);
                          setAssessmentTypeDesc(type.description || "");
                          setAssessmentTypeCardinality(
                            type.assessmentCardinality === "single_per_exam"
                              ? "single_per_exam"
                              : "multiple_per_exam",
                          );
                        }}
                        data-testid={`button-edit-type-${type.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteAssessmentTypeMutation.mutate(type.id)}
                        data-testid={`button-delete-type-${type.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  placeholder="Type name"
                  value={assessmentTypeName}
                  onChange={(e) => setAssessmentTypeName(e.target.value)}
                  className="w-full min-w-0 sm:flex-1 sm:min-w-[150px]"
                  data-testid="input-assessment-type-name"
                />
                <Input
                  placeholder="Description (optional)"
                  value={assessmentTypeDesc}
                  onChange={(e) => setAssessmentTypeDesc(e.target.value)}
                  className="w-full min-w-0 sm:flex-1 sm:min-w-[150px]"
                  data-testid="input-assessment-type-desc"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assessment-type-cardinality">Assessment creation rule</Label>
                <Select
                  value={assessmentTypeCardinality}
                  onValueChange={(value) => setAssessmentTypeCardinality(
                    value === "single_per_exam" ? "single_per_exam" : "multiple_per_exam",
                  )}
                >
                  <SelectTrigger id="assessment-type-cardinality" data-testid="select-assessment-type-cardinality">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single_per_exam">One assessment per subject and exercise/exam</SelectItem>
                    <SelectItem value="multiple_per_exam">Allow multiple assessments under the same exercise/exam</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Formal exam and test types should use the one-assessment rule. Other continuous assessment types can allow multiple records.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={handleAssessmentTypeSubmit}
                  disabled={createAssessmentTypeMutation.isPending || updateAssessmentTypeMutation.isPending}
                  data-testid="button-submit-assessment-type"
                >
                  {createAssessmentTypeMutation.isPending || updateAssessmentTypeMutation.isPending
                    ? "Saving..."
                    : editingAssessmentType ? "Update" : "Add Type"}
                </Button>
                {editingAssessmentType && (
                  <Button variant="outline" onClick={() => {
                    setEditingAssessmentType(null);
                    setAssessmentTypeName("");
                    setAssessmentTypeDesc("");
                    setAssessmentTypeCardinality("multiple_per_exam");
                  }} data-testid="button-cancel-edit-assessment-type">
                    Cancel Edit
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isExamsDialogOpen} onOpenChange={setIsExamsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Exercises/Exams</DialogTitle>
            <DialogDescription>Manage global exercises/exams used across all schools</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {globalExamList.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No exercises/exams created yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {globalExamList.map((exam) => {
                  const linkedType = assessmentTypes?.find(t => t.id === exam.assessmentTypeId);
                  return (
                    <div key={exam.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`row-exam-${exam.id}`}>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm" data-testid={`text-exam-name-${exam.id}`}>{exam.examName}</p>
                        {linkedType && (
                          <p className="text-xs text-muted-foreground">{linkedType.name}</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteExamMutation.mutate(exam.id)}
                        data-testid={`button-delete-exam-${exam.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="border-t pt-3 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  placeholder="Exercise/Exam name"
                  value={examName}
                  onChange={(e) => setExamName(e.target.value)}
                  className="w-full min-w-0 sm:flex-1 sm:min-w-[180px]"
                  data-testid="input-exam-name"
                />
              </div>
              <Select value={examAssessmentTypeId} onValueChange={setExamAssessmentTypeId}>
                <SelectTrigger data-testid="select-exam-assessment-type">
                  <SelectValue placeholder="Select assessment type" />
                </SelectTrigger>
                <SelectContent>
                  {assessmentTypes?.map((type) => (
                    <SelectItem key={type.id} value={String(type.id)} data-testid={`option-type-${type.id}`}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleExamSubmit}
                disabled={createExamMutation.isPending}
                className="w-full"
                data-testid="button-submit-exam"
              >
                {createExamMutation.isPending ? "Saving..." : "Add Exercise/Exam"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!schoolToDelete} onOpenChange={(open) => !open && setSchoolToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule School Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to schedule <strong>{schoolToDelete?.name}</strong> for deletion? The school will be suspended immediately and permanently deleted after <strong>72 hours</strong>. During this period, no one will be able to log into the school. You can restore it before the countdown expires. All Org HQ users will be notified.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSchoolToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => schoolToDelete && deleteSchool.mutate(schoolToDelete.id)}
              disabled={deleteSchool.isPending}
              data-testid="button-confirm-delete-school"
            >
              Schedule Deletion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ORG_CATEGORY_LABELS: Record<string, string> = {
  authentication: "Authentication",
  staff: "Staff Management",
  students: "Student Management",
  schools: "School Management",
  classes: "Classes",
  subjects: "Subjects",
  attendance: "Attendance",
  fees: "Fees & Payments",
  settings: "Settings",
  assessments: "Assessments",
  reports: "Reports",
};

const ORG_CATEGORY_COLORS: Record<string, string> = {
  authentication: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  staff: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  students: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  schools: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  settings: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  assessments: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  reports: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
};

function OrgActivityLogsSection({ schools }: { schools: SchoolType[] }) {
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState<string>("all");
  const [schoolFilter, setSchoolFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const pageSize = 25;

  const queryParams = new URLSearchParams();
  if (category && category !== "all") queryParams.set("category", category);
  if (schoolFilter && schoolFilter !== "all") queryParams.set("schoolId", schoolFilter);
  if (fromDate) queryParams.set("fromDate", fromDate);
  if (toDate) queryParams.set("toDate", toDate);
  queryParams.set("limit", String(pageSize));
  queryParams.set("offset", String(page * pageSize));

  const queryString = queryParams.toString();
  const { data, isLoading } = useQuery<{ logs: ActivityLog[]; total: number }>({
    queryKey: ["/api/activity-logs", "org", schoolFilter, category, fromDate, toDate, page],
    queryFn: async () => {
      const res = await schoolFetch(`/api/activity-logs?${queryString}`);
      if (!res.ok) throw new Error("Failed to fetch logs");
      return res.json();
    },
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const handleExport = (format: "txt" | "csv") => {
    const exportParams = new URLSearchParams();
    if (category && category !== "all") exportParams.set("category", category);
    if (schoolFilter && schoolFilter !== "all") exportParams.set("schoolId", schoolFilter);
    if (fromDate) exportParams.set("fromDate", fromDate);
    if (toDate) exportParams.set("toDate", toDate);
    exportParams.set("format", format);
    window.open(`/api/activity-logs/export?${exportParams.toString()}`, "_blank");
  };

  const formatTimestamp = (ts: string | Date | null) => {
    if (!ts) return "N/A";
    return new Date(ts).toLocaleString("en-US", {
      timeZone: "Africa/Harare",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  };

  const getRelativeTime = (ts: string | Date | null) => {
    if (!ts) return "";
    const now = Date.now();
    const diff = now - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return "";
  };

  const getSchoolName = (schoolId: number | null) => {
    if (!schoolId) return "HQ / Organization";
    const school = schools.find(s => s.id === schoolId);
    return school?.name || `School #${schoolId}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Activity Logs
          </h3>
          <p className="text-sm text-muted-foreground">Track all system activities across all schools</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" data-testid="button-org-export-logs">
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleExport("txt")} data-testid="button-org-export-txt">
              <FileText className="h-4 w-4 mr-2" />
              Download (.txt)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("csv")} data-testid="button-org-export-csv">
              <Download className="h-4 w-4 mr-2" />
              Download (.csv)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">School</Label>
          <Select value={schoolFilter} onValueChange={(v) => { setSchoolFilter(v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-org-log-school">
              <SelectValue placeholder="All Schools" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Schools</SelectItem>
              {schools.map((school) => (
                <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-org-log-category">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {Object.entries(ORG_CATEGORY_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From Date</Label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(0); }}
            className="w-full sm:w-[160px]"
            data-testid="input-org-from-date"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To Date</Label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(0); }}
            className="w-full sm:w-[160px]"
            data-testid="input-org-to-date"
          />
        </div>
        {(category !== "all" || schoolFilter !== "all" || fromDate || toDate) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setCategory("all"); setSchoolFilter("all"); setFromDate(""); setToDate(""); setPage(0); }}
            data-testid="button-org-clear-filters"
          >
            Clear Filters
          </Button>
        )}
      </div>

      <div className="text-sm text-muted-foreground">
        {total} {total === 1 ? "record" : "records"} found
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse flex items-start gap-3 p-3 rounded-lg border">
              <div className="w-10 h-10 rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded w-2/3" />
                <div className="h-3 bg-muted rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No activity logs found</p>
          <p className="text-sm">Activity will appear here as users interact with the system</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-3 p-3 rounded-lg border"
              data-testid={`org-log-entry-${log.id}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                  log.action === "login" || log.action === "logout" ? "bg-blue-100 dark:bg-blue-900" :
                  log.action === "create" ? "bg-green-100 dark:bg-green-900" :
                  log.action === "delete" || log.action === "schedule_termination" ? "bg-red-100 dark:bg-red-900" :
                  log.action === "restore" ? "bg-emerald-100 dark:bg-emerald-900" :
                  "bg-amber-100 dark:bg-amber-900"
                }`}>
                  {log.action === "login" || log.action === "logout" ? (
                    <UserIcon className={`h-4 w-4 ${log.action === "login" ? "text-blue-600 dark:text-blue-300" : "text-blue-500 dark:text-blue-400"}`} />
                  ) : log.action === "create" ? (
                    <Plus className="h-4 w-4 text-green-600 dark:text-green-300" />
                  ) : log.action === "delete" || log.action === "schedule_termination" ? (
                    <Trash2 className="h-4 w-4 text-red-600 dark:text-red-300" />
                  ) : log.action === "update" ? (
                    <Pencil className="h-4 w-4 text-amber-600 dark:text-amber-300" />
                  ) : (
                    <Settings className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm" data-testid={`org-log-description-${log.id}`}>{log.description}</span>
                  <Badge variant="secondary" className={`text-xs ${ORG_CATEGORY_COLORS[log.category] || ""}`}>
                    {ORG_CATEGORY_LABELS[log.category] || log.category}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <UserIcon className="h-3 w-3" />
                    {log.userName || "System"}
                  </span>
                  {log.userRole && (
                    <span className="capitalize">{log.userRole.replace("_", " ")}</span>
                  )}
                  <span className="flex items-center gap-1">
                    <SchoolIcon className="h-3 w-3" />
                    {getSchoolName(log.schoolId)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTimestamp(log.createdAt)}
                  </span>
                  {getRelativeTime(log.createdAt) && (
                    <span className="text-muted-foreground/70">({getRelativeTime(log.createdAt)})</span>
                  )}
                  {log.targetType && log.targetName && (
                    <span>
                      Target: {log.targetType} &mdash; {log.targetName}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <div className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              data-testid="button-org-prev-page"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              data-testid="button-org-next-page"
            >
              Next
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AccessRightsSection() {
  const { toast } = useToast();
  const [selectedGroup, setSelectedGroup] = useState<AccessGroup | null>(null);
  const [isManageGroupsOpen, setIsManageGroupsOpen] = useState(false);
  const [isManageRolesOpen, setIsManageRolesOpen] = useState(false);
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [isAddingRole, setIsAddingRole] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editRoleLabel, setEditRoleLabel] = useState("");
  const [newGroup, setNewGroup] = useState({ name: "", description: "" });
  const [newRole, setNewRole] = useState({ name: "", label: "", description: "" });
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedPermissions, setSelectedPermissions] = useState<Set<number>>(new Set());
  const [isEditingPermissions, setIsEditingPermissions] = useState(false);

  const { data: accessGroups = [], isLoading: groupsLoading } = useQuery<AccessGroup[]>({
    queryKey: ["/api/access-groups"],
  });

  const { data: permissions = [], isLoading: permissionsLoading } = useQuery<Permission[]>({
    queryKey: ["/api/permissions"],
  });

  const { data: groupPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/access-groups", selectedGroup?.id, "permissions"],
    enabled: !!selectedGroup,
  });

  const { data: staffRolesList = [], isLoading: rolesLoading } = useQuery<StaffRole[]>({
    queryKey: ["/api/staff-roles"],
  });

  const createGroup = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      return apiRequest("POST", "/api/access-groups", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/access-groups"] });
      setIsAddingGroup(false);
      setNewGroup({ name: "", description: "" });
      toast({ title: "Access group created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create access group", variant: "destructive" });
    },
  });

  const updateGroup = useMutation({
    mutationFn: async (data: { id: number; name: string }) => {
      return apiRequest("PUT", `/api/access-groups/${data.id}`, { name: data.name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/access-groups"] });
      setEditingGroupId(null);
      toast({ title: "Access group updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update access group", variant: "destructive" });
    },
  });

  const createRole = useMutation({
    mutationFn: async (data: { name: string; label: string; description: string }) => {
      return apiRequest("POST", "/api/staff-roles", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff-roles"] });
      setIsAddingRole(false);
      setNewRole({ name: "", label: "", description: "" });
      toast({ title: "Role created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create role", variant: "destructive" });
    },
  });

  const updateRole = useMutation({
    mutationFn: async (data: { id: number; label: string }) => {
      return apiRequest("PUT", `/api/staff-roles/${data.id}`, { label: data.label });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff-roles"] });
      setEditingRoleId(null);
      toast({ title: "Role updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update role", variant: "destructive" });
    },
  });

  const deleteRole = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/staff-roles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff-roles"] });
      toast({ title: "Role deleted successfully" });
    },
    onError: async (error: any) => {
      let message = "Failed to delete role";
      try {
        const body = await error?.response?.json?.();
        if (body?.message) message = body.message;
      } catch {}
      toast({ title: message, variant: "destructive" });
    },
  });

  const updatePermissions = useMutation({
    mutationFn: async (permissionIds: number[]) => {
      return apiRequest("PUT", `/api/access-groups/${selectedGroup?.id}/permissions`, { permissionIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/access-groups", selectedGroup?.id, "permissions"] });
      setIsEditingPermissions(false);
      toast({ title: "Permissions updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update permissions", variant: "destructive" });
    },
  });

  const handleCancelEditPermissions = () => {
    setIsEditingPermissions(false);
    setSelectedPermissions(new Set(groupPermissions.map(p => p.id)));
    setExpandedCategories(new Set());
  };

  const deleteGroup = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/access-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/access-groups"] });
      setSelectedGroup(null);
      toast({ title: "Access group deleted successfully" });
    },
    onError: async (error: any) => {
      let message = "Failed to delete access group";
      try {
        const body = await error?.response?.json?.();
        if (body?.message) message = body.message;
      } catch {}
      toast({ title: message, variant: "destructive" });
    },
  });

  const handleSelectGroup = (group: AccessGroup) => {
    setSelectedGroup(group);
    setIsEditingPermissions(false);
  };

  const handleTogglePermission = (permissionId: number) => {
    const newSelected = new Set(selectedPermissions);
    if (newSelected.has(permissionId)) {
      newSelected.delete(permissionId);
    } else {
      newSelected.add(permissionId);
    }
    setSelectedPermissions(newSelected);
  };

  const handleSavePermissions = () => {
    updatePermissions.mutate(Array.from(selectedPermissions));
  };

  const handleToggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const handleSelectAllInCategory = (category: string, checked: boolean) => {
    const categoryPermissions = permissions.filter(p => p.category === category);
    const newSelected = new Set(selectedPermissions);
    categoryPermissions.forEach(p => {
      if (checked) {
        newSelected.add(p.id);
      } else {
        newSelected.delete(p.id);
      }
    });
    setSelectedPermissions(newSelected);
  };

  const groupPermissionIds = groupPermissions.map(p => p.id).sort().join(",");
  useEffect(() => {
    setExpandedCategories(new Set());
    if (groupPermissions.length > 0) {
      setSelectedPermissions(new Set(groupPermissions.map(p => p.id)));
    } else if (selectedGroup) {
      setSelectedPermissions(new Set());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupPermissionIds, selectedGroup?.id]);

  const { isLoading: groupPermissionsLoading } = useQuery<Permission[]>({
    queryKey: ["/api/access-groups", selectedGroup?.id, "permissions"],
    enabled: !!selectedGroup,
  });

  const permissionsByCategory = permissions.reduce((acc, perm) => {
    if (!acc[perm.category]) {
      acc[perm.category] = [];
    }
    acc[perm.category].push(perm);
    return acc;
  }, {} as Record<string, Permission[]>);

  if (groupsLoading || permissionsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Access Groups
            </CardTitle>
            <CardDescription>Manage access groups and permissions across all schools</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setIsManageGroupsOpen(true)} data-testid="button-manage-groups">
              <Settings className="h-4 w-4 mr-1" />
              Manage Access Groups
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIsManageRolesOpen(true)} data-testid="button-manage-roles">
              <UserCog className="h-4 w-4 mr-1" />
              Manage Roles
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {accessGroups.map((group) => (
              <div
                key={group.id}
                className={`flex items-center justify-between p-3 rounded-md border cursor-pointer hover-elevate ${
                  selectedGroup?.id === group.id ? "border-primary bg-primary/5" : ""
                }`}
                onClick={() => handleSelectGroup(group)}
                data-testid={`group-item-${group.id}`}
              >
                <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {group.name}
                      {group.isSystemDefault && ["School Admin", "Org HQ"].includes(group.name) && (
                        <Badge variant="secondary" className="text-xs">
                          <Lock className="h-3 w-3 mr-1" />
                          System
                        </Badge>
                      )}
                    </div>
                    {group.description && (
                      <p className="text-sm text-muted-foreground">{group.description}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {accessGroups.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No access groups found</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Manage Access Groups Dialog */}
      <Dialog open={isManageGroupsOpen} onOpenChange={(open) => { setIsManageGroupsOpen(open); if (!open) { setIsAddingGroup(false); setEditingGroupId(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Access Groups</DialogTitle>
            <DialogDescription>Add, rename, or remove custom access groups</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {accessGroups.map((group) => (
              <div key={group.id} className="flex items-center justify-between p-3 rounded-md border gap-2">
                {editingGroupId === group.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={editGroupName}
                      onChange={(e) => setEditGroupName(e.target.value)}
                      className="flex-1"
                      data-testid="input-edit-group-name"
                    />
                    <Button size="icon" variant="ghost" onClick={() => { updateGroup.mutate({ id: group.id, name: editGroupName }); }} disabled={!editGroupName || updateGroup.isPending} data-testid="button-save-edit-group">
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setEditingGroupId(null)} data-testid="button-cancel-edit-group">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{group.name}</span>
                      {group.isSystemDefault && ["School Admin", "Org HQ"].includes(group.name) && (
                        <Badge variant="secondary" className="text-xs">
                          <Lock className="h-3 w-3 mr-1" />
                          System
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditingGroupId(group.id); setEditGroupName(group.name); }} data-testid={`button-edit-group-${group.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("Are you sure you want to delete this access group?")) { deleteGroup.mutate(group.id); } }} data-testid={`button-delete-group-${group.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {isAddingGroup ? (
              <div className="space-y-2 p-3 rounded-md border">
                <Input
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                  placeholder="Group name"
                  data-testid="input-new-group-name"
                />
                <Input
                  value={newGroup.description}
                  onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                  placeholder="Description (optional)"
                  data-testid="input-new-group-description"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setIsAddingGroup(false); setNewGroup({ name: "", description: "" }); }}>Cancel</Button>
                  <Button size="sm" onClick={() => createGroup.mutate(newGroup)} disabled={!newGroup.name || createGroup.isPending} data-testid="button-save-new-group">
                    Add Group
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" className="w-full" onClick={() => setIsAddingGroup(true)} data-testid="button-add-group">
                <Plus className="h-4 w-4 mr-1" />
                Add New Group
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Roles Dialog */}
      <Dialog open={isManageRolesOpen} onOpenChange={(open) => { setIsManageRolesOpen(open); if (!open) { setIsAddingRole(false); setEditingRoleId(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Staff Roles</DialogTitle>
            <DialogDescription>Add, rename, or remove staff roles used across all schools</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {staffRolesList.map((role) => (
              <div key={role.id} className="flex items-center justify-between p-3 rounded-md border gap-2">
                {editingRoleId === role.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={editRoleLabel}
                      onChange={(e) => setEditRoleLabel(e.target.value)}
                      className="flex-1"
                      data-testid="input-edit-role-label"
                    />
                    <Button size="icon" variant="ghost" onClick={() => { updateRole.mutate({ id: role.id, label: editRoleLabel }); }} disabled={!editRoleLabel || updateRole.isPending} data-testid="button-save-edit-role">
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setEditingRoleId(null)} data-testid="button-cancel-edit-role">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <UserCog className="h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0">
                        <span className="font-medium">{role.label}</span>
                        {role.description && <p className="text-xs text-muted-foreground">{role.description}</p>}
                      </div>
                      {role.isSystemDefault && ["School Admin", "Org HQ"].includes(role.label) && (
                        <Badge variant="secondary" className="text-xs">
                          <Lock className="h-3 w-3 mr-1" />
                          System
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditingRoleId(role.id); setEditRoleLabel(role.label); }} data-testid={`button-edit-role-${role.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("Are you sure you want to delete this role?")) { deleteRole.mutate(role.id); } }} data-testid={`button-delete-role-${role.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {isAddingRole ? (
              <div className="space-y-2 p-3 rounded-md border">
                <Input
                  value={newRole.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    const name = label.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
                    setNewRole({ ...newRole, label, name });
                  }}
                  placeholder="Role name (e.g., Head of Department)"
                  data-testid="input-new-role-label"
                />
                <Input
                  value={newRole.description}
                  onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                  placeholder="Description (optional)"
                  data-testid="input-new-role-description"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setIsAddingRole(false); setNewRole({ name: "", label: "", description: "" }); }}>Cancel</Button>
                  <Button size="sm" onClick={() => createRole.mutate(newRole)} disabled={!newRole.label || !newRole.name || createRole.isPending} data-testid="button-save-new-role">
                    Add Role
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" className="w-full" onClick={() => setIsAddingRole(true)} data-testid="button-add-role">
                <Plus className="h-4 w-4 mr-1" />
                Add New Role
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              {selectedGroup ? `${selectedGroup.name} Permissions` : "Permissions"}
            </CardTitle>
            <CardDescription>
              {selectedGroup
                ? (isEditingPermissions ? "Select which permissions this group should have" : "View the permissions assigned to this group")
                : "Select an access group to view its permissions"}
            </CardDescription>
          </div>
          {selectedGroup && !isEditingPermissions && !groupPermissionsLoading && (
            <Button
              size="sm"
              onClick={() => setIsEditingPermissions(true)}
              data-testid="button-edit-permissions"
            >
              <Pencil className="h-4 w-4 mr-1" />
              Edit Permissions
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {selectedGroup ? (
            <div className="space-y-4">
              <div className="max-h-[400px] overflow-y-auto space-y-2">
                {Object.entries(permissionsByCategory).map(([category, perms]) => {
                  const categorySelected = perms.filter(p => selectedPermissions.has(p.id)).length;
                  const allSelected = categorySelected === perms.length;
                  const someSelected = categorySelected > 0 && categorySelected < perms.length;

                  return (
                    <div key={category} className="border rounded-md">
                      <div
                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleToggleCategory(category);
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {expandedCategories.has(category) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <span className="font-medium capitalize">{category.replace(/_/g, " ")}</span>
                          <Badge variant="secondary" className="text-xs">
                            {categorySelected}/{perms.length}
                          </Badge>
                        </div>
                        {isEditingPermissions ? (
                          <Checkbox
                            checked={allSelected}
                            ref={(el) => {
                              if (el) (el as HTMLButtonElement).dataset.indeterminate = String(someSelected);
                            }}
                            onCheckedChange={(checked) => handleSelectAllInCategory(category, checked === true)}
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`checkbox-category-${category}`}
                          />
                        ) : (
                          <Checkbox
                            checked={allSelected}
                            disabled
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`checkbox-category-${category}`}
                          />
                        )}
                      </div>
                      {expandedCategories.has(category) && (
                        <div className="px-3 pb-3 space-y-2 border-t pt-2">
                          {perms.map((perm) => (
                            <div key={perm.id} className="flex items-center justify-between py-1">
                              <div className="min-w-0">
                                <p className="text-sm font-medium">{perm.name}</p>
                                {perm.description && (
                                  <p className="text-xs text-muted-foreground">{perm.description}</p>
                                )}
                              </div>
                              <Checkbox
                                checked={selectedPermissions.has(perm.id)}
                                disabled={!isEditingPermissions}
                                onCheckedChange={() => isEditingPermissions && handleTogglePermission(perm.id)}
                                data-testid={`checkbox-permission-${perm.id}`}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {isEditingPermissions && (
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={handleCancelEditPermissions}
                    disabled={updatePermissions.isPending}
                    data-testid="button-cancel-permissions"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSavePermissions}
                    disabled={updatePermissions.isPending || groupPermissionsLoading}
                    data-testid="button-save-permissions"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select an access group from the left to view its permissions</p>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
