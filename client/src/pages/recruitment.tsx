import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  BellRing,
  BriefcaseBusiness,
  CalendarClock,
  ChevronsDown,
  ChevronsUp,
  FileText,
  GripVertical,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Trophy,
  UserPlus,
  UserRoundCheck,
  Users,
  X,
} from "lucide-react";
import { apiRequest, queryClient, schoolFetch } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  RECRUITMENT_CATEGORIES,
  RECRUITMENT_EXAM_BOARDS,
  O_LEVEL_GRADES,
  examBoardMatches,
  formatExamBoards,
  normalizeExamBoardList,
  normalizeRecruitmentDepartment,
  normalizeSubjectList,
  recruitmentCategoryCode,
} from "@shared/recruitment";

type ModalState =
  | { type: "vacancy"; record?: any }
  | { type: "application"; record: any }
  | { type: "interview"; application: any; record?: any }
  | { type: "department"; record?: any }
  | { type: "examination-board"; record?: any }
  | { type: "notification"; record: any }
  | { type: "requirement"; record?: any }
  | { type: "document-category"; record?: any }
  | null;

const titleCase = (value: unknown) =>
  String(value || "—")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const toLocalInput = (value: unknown) =>
  value ? new Date(String(value)).toISOString().slice(0, 16) : "";

const splitSubjects = (value: string) =>
  normalizeSubjectList(value.split(",").map((item) => item.trim()));

const categoryLabelForCode = (code: string) =>
  RECRUITMENT_CATEGORIES.find((row) => row.code === code)?.label || code;

function applicationBoardList(application: any): string[] {
  const structured = normalizeExamBoardList(application?.examinationBoards);
  return structured.length ? structured : normalizeExamBoardList(application?.examinationBoard);
}

function matchesBoard(candidateBoards: unknown, boardFilter: string) {
  if (boardFilter === "all") return true;
  return examBoardMatches(candidateBoards, boardFilter);
}

function statusClass(status: string) {
  const value = String(status || "").toLowerCase();
  if (["hired", "published", "active", "passed", "verified", "sent", "available"].includes(value)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (["rejected", "failed", "criteria_failed", "needs_attention"].includes(value)) {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
  }
  if (["shortlisted", "final", "interview"].includes(value)) {
    return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300";
  }
  if (["under_review", "contacted", "scheduled"].includes(value)) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
  }
  if (["withdrawn", "archived", "closed", "cancelled", "not_available"].includes(value)) {
    return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300";
  }
  return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300";
}

function StatusBadge({ value }: { value: unknown }) {
  const status = String(value || "unknown");
  return <Badge variant="outline" className={statusClass(status)}>{titleCase(status)}</Badge>;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  description?: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-md border p-3">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(Boolean(value))} />
      <span>
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value || "—"}</div>
    </div>
  );
}

function DataTable({ heads, children }: { heads: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>{heads.map((head) => <TableHead key={head} className="whitespace-nowrap">{head}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

function CandidateSummary({
  application,
  vacancy,
  relation,
  schoolName,
  onView,
  primaryAction,
  secondaryAction,
}: {
  application: any;
  vacancy?: any;
  relation?: any;
  schoolName?: string;
  onView: () => void;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
}) {
  const declared = normalizeSubjectList(application.declaredSubjects);
  const assigned = normalizeSubjectList(application.recruiterAssignedSubjects);
  const reasons = Array.isArray(relation?.matchReasons) ? relation.matchReasons : [];
  const minYears = Number(vacancy?.minimumYearsExperience || 0);
  const years = Number(application.yearsExperience || 0);
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-semibold text-base">{application.firstName} {application.lastName}</div>
          <div className="text-sm text-muted-foreground">
            {application.employmentCategory}
            {application.department ? ` · ${normalizeRecruitmentDepartment(application.department)}` : ""}
            {applicationBoardList(application).length ? ` · ${formatExamBoards(applicationBoardList(application))}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge value={application.status} />
          <StatusBadge value={application.availabilityStatus || "available"} />
        </div>
      </div>

      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((reason: string) => <Badge key={reason} variant="secondary">✓ {reason}</Badge>)}
        </div>
      )}

      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Teaching qualification" value={application.holdsTeachingQualification ? "Yes" : "No"} />
        <Info label="Experience" value={`${years} year(s)${minYears ? ` · vacancy minimum ${minYears}` : ""}`} />
        <Info label="Declared subjects" value={declared.join(", ") || "—"} />
        <Info label="HOD-assigned subjects" value={assigned.join(", ") || "—"} />
      </div>

      {application.qualifications && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Qualifications</div>
          <div className="line-clamp-2 whitespace-pre-wrap text-sm">{application.qualifications}</div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{application.applicationType === "vacancy" ? `Vacancy application${schoolName ? ` · ${schoolName}` : ""}` : "General application"}</span>
        {application.lastContactedAt && <span>· Last contacted {new Date(application.lastContactedAt).toLocaleDateString()}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onView}>View candidate</Button>
        {primaryAction}
        {secondaryAction}
      </div>
    </div>
  );
}

export default function RecruitmentPage() {
  const { user, isInSchoolContext, hasAnyPermission } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("dashboard");
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedVacancyId, setSelectedVacancyId] = useState<number | null>(null);

  const [applicationCategory, setApplicationCategory] = useState("High School Teaching");
  const [boardFilter, setBoardFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [applicationStatus, setApplicationStatus] = useState("all");
  const [genderFilter, setGenderFilter] = useState("all");
  const [applicationSource, setApplicationSource] = useState("all");
  const [applicationVacancy, setApplicationVacancy] = useState("all");
  const [applicationSubject, setApplicationSubject] = useState("all");
  const [applicationSubmittedFrom, setApplicationSubmittedFrom] = useState("");
  const [applicationSubmittedTo, setApplicationSubmittedTo] = useState("");
  const [minimumALevelPoints, setMinimumALevelPoints] = useState("");
  const [teachingQualificationFilter, setTeachingQualificationFilter] = useState("all");
  const [documentCompletenessFilter, setDocumentCompletenessFilter] = useState("all");
  const [groupApplicationsByDepartment, setGroupApplicationsByDepartment] = useState(false);
  const [applicationSearch, setApplicationSearch] = useState("");

  const [talentSearch, setTalentSearch] = useState("");
  const [talentDepartment, setTalentDepartment] = useState("all");
  const [talentSubject, setTalentSubject] = useState("all");
  const [talentBoard, setTalentBoard] = useState("all");
  const [talentAvailability, setTalentAvailability] = useState("all");
  const [talentDraggedId, setTalentDraggedId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/recruitment/bootstrap"],
    queryFn: async () => {
      const response = await schoolFetch("/api/recruitment/bootstrap");
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || "Unable to load recruitment workspace");
      return body;
    },
  });

  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["/api/recruitment/bootstrap"] });

  const actionMutation = useMutation({
    mutationFn: async ({ method, url, body }: { method: string; url: string; body?: unknown }) => {
      const response = await apiRequest(method, url, body);
      return response.status === 204 ? null : response.json();
    },
    onSuccess: async () => {
      await refresh();
    },
    onError: (mutationError: any) => {
      toast({
        title: "Recruitment action failed",
        description: mutationError?.message || "Unable to complete the action.",
        variant: "destructive",
      });
    },
  });

  const canVacancies = hasAnyPermission("recruitment.vacancies.manage");
  const canRequirements = hasAnyPermission("recruitment.requirements.manage");
  const canProcess = hasAnyPermission("recruitment.applications.process");
  const canInterviews = hasAnyPermission("recruitment.interviews.manage");
  const canSettings = hasAnyPermission("recruitment.settings.manage");

  const applications = data?.applications || [];
  const vacancies = data?.vacancies || [];
  const vacancyCandidates = data?.vacancyCandidates || [];
  const departments = data?.departments || [];
  const activeExaminationBoards = data?.examinationBoards || RECRUITMENT_EXAM_BOARDS;
  const subjectCatalog = normalizeSubjectList(data?.subjectCatalog || []);

  const selectedVacancy = useMemo(
    () => vacancies.find((vacancy: any) => Number(vacancy.id) === Number(selectedVacancyId)) || null,
    [selectedVacancyId, vacancies],
  );

  const applicationMatchesActiveFilters = (application: any, skipDepartment = false) => {
    const query = applicationSearch.trim().toLowerCase();
    const categoryCode = recruitmentCategoryCode(applicationCategory);
    if (application.employmentCategory !== applicationCategory) return false;
    if (categoryCode !== "non_teaching" && !matchesBoard(applicationBoardList(application), boardFilter)) return false;
    if (!skipDepartment && departmentFilter !== "all" && (normalizeRecruitmentDepartment(application.department) || "Unassigned / Legacy") !== departmentFilter) return false;
    if (applicationStatus !== "all" && application.status !== applicationStatus) return false;
    if (genderFilter !== "all" && String(application.gender || "").toLowerCase() !== genderFilter) return false;
    if (applicationSource !== "all" && application.applicationType !== applicationSource) return false;
    if (applicationVacancy !== "all" && String(application.vacancyId || "") !== applicationVacancy) return false;
    if (applicationSubject !== "all" && !normalizeSubjectList([...(application.declaredSubjects || []), ...(application.recruiterAssignedSubjects || [])]).some((subject) => subject.toLowerCase() === applicationSubject.toLowerCase())) return false;
    const submittedDate = application.submittedAt ? String(application.submittedAt).slice(0, 10) : "";
    if (applicationSubmittedFrom && submittedDate < applicationSubmittedFrom) return false;
    if (applicationSubmittedTo && submittedDate > applicationSubmittedTo) return false;
    if (minimumALevelPoints !== "" && Number(application.aLevelPoints ?? -1) < Number(minimumALevelPoints)) return false;
    if (teachingQualificationFilter === "yes" && !application.holdsTeachingQualification) return false;
    if (teachingQualificationFilter === "no" && application.holdsTeachingQualification) return false;
    if (documentCompletenessFilter === "complete" && !application.documentCompleteness?.isComplete) return false;
    if (documentCompletenessFilter === "incomplete" && application.documentCompleteness?.isComplete) return false;
    if (documentCompletenessFilter === "none" && Number(application.documentCompleteness?.submitted || 0) > 0) return false;
    if (!query) return true;
    return [
      application.firstName,
      application.lastName,
      application.email,
      application.phone,
      application.nationalId,
      application.vacancy?.title,
      application.department,
      ...applicationBoardList(application),
      ...(Array.isArray(application.declaredSubjects) ? application.declaredSubjects : []),
      ...(Array.isArray(application.recruiterAssignedSubjects) ? application.recruiterAssignedSubjects : []),
    ].join(" ").toLowerCase().includes(query);
  };

  const applicationsBeforeDepartmentFilter = useMemo(
    () => applications.filter((application: any) => applicationMatchesActiveFilters(application, true)),
    [
      applicationCategory, applicationSearch, applicationStatus, applications, boardFilter, genderFilter,
      applicationSource, applicationVacancy, applicationSubject, applicationSubmittedFrom, applicationSubmittedTo,
      minimumALevelPoints, teachingQualificationFilter, documentCompletenessFilter,
    ],
  );

  const filteredApplications = useMemo(
    () => applicationsBeforeDepartmentFilter.filter((application: any) => applicationMatchesActiveFilters(application, false)),
    [applicationsBeforeDepartmentFilter, departmentFilter],
  );

  const departmentCounts = useMemo(() => {
    const counts: Record<string, number> = { all: applicationsBeforeDepartmentFilter.length };
    for (const application of applicationsBeforeDepartmentFilter) {
      const department = normalizeRecruitmentDepartment(application.department) || "Unassigned / Legacy";
      counts[department] = (counts[department] || 0) + 1;
    }
    return counts;
  }, [applicationsBeforeDepartmentFilter]);

  const talentPool = useMemo(() => {
    const talentApplicationIds = new Set<number>();
    for (const relation of vacancyCandidates) {
      if (["shortlisted", "final"].includes(relation.stage)) talentApplicationIds.add(Number(relation.applicationId));
    }
    for (const application of applications) {
      if (["shortlisted", "interview"].includes(application.status)) talentApplicationIds.add(Number(application.id));
    }
    const query = talentSearch.trim().toLowerCase();
    return applications.filter((application: any) => {
      if (!talentApplicationIds.has(Number(application.id))) return false;
      if (["rejected", "hired", "withdrawn"].includes(application.status)) return false;
      if (["not_available", "hired", "withdrawn", "archived"].includes(application.availabilityStatus || "available")) return false;
      if (talentDepartment !== "all" && normalizeRecruitmentDepartment(application.department) !== talentDepartment) return false;
      if (talentSubject !== "all" && !normalizeSubjectList(application.recruiterAssignedSubjects).some((subject) => subject.toLowerCase() === talentSubject.toLowerCase())) return false;
      if (!matchesBoard(applicationBoardList(application), talentBoard)) return false;
      if (talentAvailability !== "all" && (application.availabilityStatus || "available") !== talentAvailability) return false;
      if (!query) return true;
      return [
        application.firstName,
        application.lastName,
        application.department,
        ...applicationBoardList(application),
        ...(Array.isArray(application.declaredSubjects) ? application.declaredSubjects : []),
        ...(Array.isArray(application.recruiterAssignedSubjects) ? application.recruiterAssignedSubjects : []),
      ].join(" ").toLowerCase().includes(query);
    });
  }, [applications, talentAvailability, talentBoard, talentDepartment, talentSubject, talentSearch, vacancyCandidates]);

  useEffect(() => {
    if (selectedVacancyId && !selectedVacancy) setSelectedVacancyId(null);
  }, [selectedVacancy, selectedVacancyId]);

  const applicationGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const application of filteredApplications) {
      const key = normalizeRecruitmentDepartment(application.department) || "Unassigned / Legacy";
      groups.set(key, [...(groups.get(key) || []), application]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredApplications]);

  const rankingSubject = talentDepartment === "Primary School"
    ? "Primary School"
    : talentDepartment !== "all" && talentSubject !== "all"
      ? talentSubject
      : null;
  const activeTalentRankingRows = useMemo(() => {
    if (talentDepartment === "all" || !rankingSubject) return [];
    const applicationMap = new Map(applications.map((application: any) => [Number(application.id), application]));
    return (data?.talentRankings || [])
      .filter((row: any) => row.isActive
        && normalizeRecruitmentDepartment(row.department) === talentDepartment
        && String(row.subject || "").toLowerCase() === rankingSubject.toLowerCase())
      .sort((a: any, b: any) => Number(a.position) - Number(b.position))
      .map((row: any) => ({ ...row, application: applicationMap.get(Number(row.applicationId)) }))
      .filter((row: any) => row.application);
  }, [applications, data?.talentRankings, rankingSubject, talentDepartment]);
  const activeTalentRankingList = useMemo(() => {
    if (talentDepartment === "all" || !rankingSubject) return null;
    return (data?.talentRankingLists || []).find((row: any) =>
      normalizeRecruitmentDepartment(row.department) === talentDepartment
      && String(row.subject || "").toLowerCase() === rankingSubject.toLowerCase(),
    ) || null;
  }, [data?.talentRankingLists, rankingSubject, talentDepartment]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading recruitment workspace…</div>;
  if (error || !data) return <div className="p-8 text-destructive">{error instanceof Error ? error.message : "Unable to load recruitment workspace."}</div>;

  if (user?.role !== "org_admin" && user?.schoolId) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Recruitment is managed from HQ</CardTitle>
            <CardDescription>This module is no longer available from school-level navigation.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const saveTalentRankingOrder = (applicationIds: number[]) => {
    if (talentDepartment === "all" || !rankingSubject) return;
    actionMutation.mutate(
      {
        method: "PUT",
        url: "/api/recruitment/talent-rankings/order",
        body: {
          department: talentDepartment,
          subject: rankingSubject,
          applicationIds,
          expectedVersion: Number(activeTalentRankingList?.version || 0),
        },
      },
      { onSuccess: () => toast({ title: `${rankingSubject} ranking updated` }) },
    );
  };

  const moveTalentRanking = (applicationId: number, mode: "up" | "down" | "top" | "bottom") => {
    const ids = activeTalentRankingRows.map((row: any) => Number(row.applicationId));
    const index = ids.indexOf(applicationId);
    if (index < 0) return;
    const next = [...ids];
    const [item] = next.splice(index, 1);
    let target = index;
    if (mode === "up") target = Math.max(0, index - 1);
    if (mode === "down") target = Math.min(next.length, index + 1);
    if (mode === "top") target = 0;
    if (mode === "bottom") target = next.length;
    next.splice(target, 0, item);
    if (next.join(",") !== ids.join(",")) saveTalentRankingOrder(next);
  };

  const dropTalentRanking = (targetId: number) => {
    if (!talentDraggedId || talentDraggedId === targetId) return;
    const ids = activeTalentRankingRows.map((row: any) => Number(row.applicationId));
    const from = ids.indexOf(talentDraggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setTalentDraggedId(null);
    saveTalentRankingOrder(next);
  };

  const applicationDepartmentOptions = recruitmentCategoryCode(applicationCategory) === "high_school_teaching"
    ? departments.filter((department: any) => department.applicationCategory === "High School Teaching" && department.isActive).map((department: any) => normalizeRecruitmentDepartment(department.name))
    : recruitmentCategoryCode(applicationCategory) === "primary_teaching"
      ? ["Primary School"]
      : [];

  const clearApplicationFilters = () => {
    setBoardFilter("all");
    setDepartmentFilter("all");
    setApplicationStatus("all");
    setGenderFilter("all");
    setApplicationSource("all");
    setApplicationVacancy("all");
    setApplicationSubject("all");
    setApplicationSubmittedFrom("");
    setApplicationSubmittedTo("");
    setMinimumALevelPoints("");
    setTeachingQualificationFilter("all");
    setDocumentCompletenessFilter("all");
    setApplicationSearch("");
  };

  const renderApplicationRow = (application: any) => (
    <TableRow key={application.id}>
      <TableCell>
        <div className="font-medium">{application.firstName} {application.lastName}</div>
        <div className="text-xs text-muted-foreground">{application.email}</div>
      </TableCell>
      <TableCell>
        <div>{application.vacancy?.title || "General application"}</div>
        <div className="text-xs text-muted-foreground">{application.applicationType === "vacancy" ? "Advertised vacancy" : "General candidate pool"}</div>
      </TableCell>
      <TableCell>{normalizeRecruitmentDepartment(application.department) || "—"}</TableCell>
      <TableCell>{formatExamBoards(applicationBoardList(application)) || "—"}</TableCell>
      <TableCell>{normalizeSubjectList([...(application.declaredSubjects || []), ...(application.recruiterAssignedSubjects || [])]).join(", ") || "—"}</TableCell>
      <TableCell>{Number(application.yearsExperience || 0)} year(s)</TableCell>
      <TableCell>
        <div className="font-medium">{Number(application.documentCompleteness?.submitted || 0)}/{Number(application.documentCompleteness?.expected || 0)}</div>
        <div className="text-xs text-muted-foreground">{application.documentCompleteness?.isComplete ? "Complete" : `${Number(application.documentCompleteness?.missingCodes?.length || 0)} missing`}</div>
      </TableCell>
      <TableCell><StatusBadge value={application.status} /></TableCell>
      <TableCell><Button size="sm" variant="outline" onClick={() => setModal({ type: "application", record: application })}>View candidate</Button></TableCell>
    </TableRow>
  );

  const dashboard = data.dashboard || {};
  const categoryCounts = Object.fromEntries(
    RECRUITMENT_CATEGORIES.map((category) => [
      category.label,
      applications.filter((application: any) => application.employmentCategory === category.label).length,
    ]),
  );

  const handleOpenVacancy = (vacancy: any) => {
    setSelectedVacancyId(vacancy.id);
    setActiveTab("vacancies");
  };

  const handleViewVacancyApplications = (vacancy: any) => {
    setApplicationCategory(vacancy.employmentCategory);
    setBoardFilter("all");
    setDepartmentFilter("all");
    setApplicationSource("vacancy");
    setApplicationVacancy(String(vacancy.id));
    setApplicationStatus("all");
    setActiveTab("applications");
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BriefcaseBusiness className="h-6 w-6" />
            Recruitment
          </h1>
          <p className="text-muted-foreground">HQ recruitment workspace for vacancies, candidate matching, interviews, talent pool and hiring.</p>
        </div>
        <Button variant="outline" onClick={() => window.open("/careers", "_blank")}>
          Open public Careers page
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="vacancies">Vacancies</TabsTrigger>
            <TabsTrigger value="applications">Applications</TabsTrigger>
            <TabsTrigger value="talent">Talent Pool</TabsTrigger>
            <TabsTrigger value="requirements">Requirements</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="dashboard" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-7">
            <Metric title="Open vacancies" value={dashboard.openVacancies || 0} icon={<BriefcaseBusiness className="h-5 w-5" />} />
            <Metric title="Submitted" value={dashboard.submitted || 0} icon={<FileText className="h-5 w-5" />} />
            <Metric title="Under review" value={dashboard.underReview || 0} icon={<Search className="h-5 w-5" />} />
            <Metric title="Shortlisted" value={dashboard.shortlisted || 0} icon={<UserRoundCheck className="h-5 w-5" />} />
            <Metric title="Interviews" value={dashboard.interviews || 0} icon={<CalendarClock className="h-5 w-5" />} />
            <Metric title="Hired" value={dashboard.hired || 0} icon={<Trophy className="h-5 w-5" />} />
            <Metric title="Rejected" value={dashboard.rejectedAttempts || 0} icon={<X className="h-5 w-5" />} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Applications by category</CardTitle>
              <CardDescription>Application Category is the first-level Recruitment view.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {RECRUITMENT_CATEGORIES.map((category) => (
                <button
                  key={category.code}
                  type="button"
                  className="rounded-lg border p-4 text-left hover:bg-muted"
                  onClick={() => {
                    setApplicationCategory(category.label);
                    setBoardFilter("all");
                    setDepartmentFilter("all");
                    setActiveTab("applications");
                  }}
                >
                  <div className="font-semibold">{category.label}</div>
                  <div className="mt-1 text-2xl font-bold">{categoryCounts[category.label] || 0}</div>
                </button>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent Recruitment activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(data.activity || []).slice(0, 12).map((item: any) => (
                <div key={item.id} className="flex items-start justify-between gap-4 rounded-md border p-3 text-sm">
                  <div>
                    <div className="font-medium">{item.summary}</div>
                    <div className="text-xs text-muted-foreground">{titleCase(item.activityType)}</div>
                  </div>
                  <div className="whitespace-nowrap text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</div>
                </div>
              ))}
              {!(data.activity || []).length && <p className="text-sm text-muted-foreground">No Recruitment activity yet.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vacancies" className="space-y-5">
          <Card>
            <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Vacancies</CardTitle>
                <CardDescription>Teaching vacancies carry structured category, department, examination board and subject metadata so matching is reliable.</CardDescription>
              </div>
              {canVacancies && <Button onClick={() => setModal({ type: "vacancy" })}><Plus className="mr-2 h-4 w-4" />Create vacancy</Button>}
            </CardHeader>
            <CardContent>
              <DataTable heads={["Code", "Vacancy", "Category", "Department", "Exam Board", "Subjects", "School", "Status", "Actions"]}>
                {vacancies.map((vacancy: any) => {
                  const suggestionCount = vacancyCandidates.filter((row: any) => row.vacancyId === vacancy.id && row.stage === "suggested").length;
                  const directApplicationCount = applications.filter((application: any) => Number(application.vacancyId) === Number(vacancy.id)).length;
                  return (
                    <TableRow key={vacancy.id}>
                      <TableCell className="font-medium">{vacancy.code}</TableCell>
                      <TableCell>
                        <div className="font-medium">{vacancy.title}</div>
                        <div className="text-xs text-muted-foreground">{suggestionCount} suggested existing candidate(s)</div>
                      </TableCell>
                      <TableCell>{vacancy.employmentCategory}</TableCell>
                      <TableCell>{normalizeRecruitmentDepartment(vacancy.department) || "—"}</TableCell>
                      <TableCell>{vacancy.examinationBoard || "—"}</TableCell>
                      <TableCell>{normalizeSubjectList(vacancy.subjects).join(", ") || "—"}</TableCell>
                      <TableCell>{data.schools.find((school: any) => school.id === vacancy.schoolId)?.name || "Any school / HQ"}</TableCell>
                      <TableCell><StatusBadge value={vacancy.status} /></TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleViewVacancyApplications(vacancy)}>View Applications ({directApplicationCount})</Button>
                          <Button size="sm" variant="outline" onClick={() => handleOpenVacancy(vacancy)}>Workspace</Button>
                          {canVacancies && <Button size="sm" variant="outline" onClick={() => setModal({ type: "vacancy", record: vacancy })}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </DataTable>
            </CardContent>
          </Card>

          {selectedVacancy && (
            <VacancyWorkspace
              vacancy={selectedVacancy}
              data={data}
              canProcess={canProcess}
              onViewApplication={(application: any) => setModal({ type: "application", record: application })}
              onEditVacancy={canVacancies ? () => setModal({ type: "vacancy", record: selectedVacancy }) : undefined}
              actionMutation={actionMutation}
              toast={toast}
            />
          )}
        </TabsContent>

        <TabsContent value="applications" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Applications</CardTitle>
              <CardDescription>Application Category remains the first-level view. Use Department shortcuts and advanced filters to narrow the recruiter workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Tabs
                value={applicationCategory}
                onValueChange={(value) => {
                  setApplicationCategory(value);
                  clearApplicationFilters();
                }}
              >
                <div className="overflow-x-auto">
                  <TabsList className="w-max">
                    {RECRUITMENT_CATEGORIES.map((category) => (
                      <TabsTrigger key={category.code} value={category.label}>
                        {category.label} ({categoryCounts[category.label] || 0})
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              </Tabs>

              {applicationVacancy !== "all" && (() => {
                const scopedVacancy = vacancies.find((vacancy: any) => String(vacancy.id) === applicationVacancy);
                return scopedVacancy ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                    <span>Viewing applications for <strong>{scopedVacancy.code} · {scopedVacancy.title}</strong>.</span>
                    <Button size="sm" variant="outline" onClick={() => handleOpenVacancy(scopedVacancy)}>Back to Vacancy Workspace</Button>
                  </div>
                ) : null;
              })()}

              {recruitmentCategoryCode(applicationCategory) !== "non_teaching" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={boardFilter === "all" ? "default" : "outline"} onClick={() => setBoardFilter("all")}>All boards</Button>
                  {activeExaminationBoards.map((board: string) => (
                    <Button key={board} size="sm" variant={boardFilter === board ? "default" : "outline"} onClick={() => setBoardFilter(board)}>{board}</Button>
                  ))}
                  <span className="self-center text-xs text-muted-foreground">Applicants who selected multiple boards appear under each matching board filter.</span>
                </div>
              )}

              {applicationDepartmentOptions.length > 0 && (
                <div className="flex flex-wrap gap-2 rounded-md border p-3">
                  <Button size="sm" variant={departmentFilter === "all" ? "default" : "outline"} onClick={() => setDepartmentFilter("all")}>
                    All ({departmentCounts.all || 0})
                  </Button>
                  {applicationDepartmentOptions.map((department: string) => (
                    <Button key={department} size="sm" variant={departmentFilter === department ? "default" : "outline"} onClick={() => setDepartmentFilter(department)}>
                      {department} ({departmentCounts[department] || 0})
                    </Button>
                  ))}
                  {departmentCounts["Unassigned / Legacy"] > 0 && (
                    <Button size="sm" variant={departmentFilter === "Unassigned / Legacy" ? "default" : "outline"} onClick={() => setDepartmentFilter("Unassigned / Legacy")}>
                      Unassigned / Legacy ({departmentCounts["Unassigned / Legacy"]})
                    </Button>
                  )}
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-4">
                <div className="relative lg:col-span-2">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" value={applicationSearch} onChange={(event) => setApplicationSearch(event.target.value)} placeholder="Search applicant, vacancy, subject, email or National ID" />
                </div>
                <Select value={applicationStatus} onValueChange={setApplicationStatus}>
                  <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>{["all", "submitted", "under_review", "shortlisted", "interview", "rejected", "hired", "withdrawn"].map((status) => <SelectItem key={status} value={status}>{status === "all" ? "All statuses" : titleCase(status)}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={genderFilter} onValueChange={setGenderFilter}>
                  <SelectTrigger><SelectValue placeholder="Gender" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All genders</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="male">Male</SelectItem></SelectContent>
                </Select>

                <Select value={applicationSource} onValueChange={(value) => { setApplicationSource(value); if (value !== "vacancy") setApplicationVacancy("all"); }}>
                  <SelectTrigger><SelectValue placeholder="Application source" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All sources</SelectItem><SelectItem value="general">General applications</SelectItem><SelectItem value="vacancy">Advertised vacancies</SelectItem></SelectContent>
                </Select>
                <Select value={applicationVacancy} onValueChange={setApplicationVacancy}>
                  <SelectTrigger><SelectValue placeholder="Specific vacancy" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All vacancies</SelectItem>
                    {vacancies.filter((vacancy: any) => vacancy.employmentCategory === applicationCategory).map((vacancy: any) => <SelectItem key={vacancy.id} value={String(vacancy.id)}>{vacancy.code} · {vacancy.title}</SelectItem>)}
                  </SelectContent>
                </Select>
                {recruitmentCategoryCode(applicationCategory) !== "non_teaching" ? (
                  <Select value={applicationSubject} onValueChange={setApplicationSubject}>
                    <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All subjects</SelectItem>{subjectCatalog.map((subject: string) => <SelectItem key={subject} value={subject}>{subject}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <div />}
                <Select value={documentCompletenessFilter} onValueChange={setDocumentCompletenessFilter}>
                  <SelectTrigger><SelectValue placeholder="Documents" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All document states</SelectItem><SelectItem value="complete">Complete</SelectItem><SelectItem value="incomplete">Incomplete</SelectItem><SelectItem value="none">No requested/core documents submitted</SelectItem></SelectContent>
                </Select>

                <Field label="Submitted from"><Input type="date" value={applicationSubmittedFrom} onChange={(event) => setApplicationSubmittedFrom(event.target.value)} /></Field>
                <Field label="Submitted to"><Input type="date" value={applicationSubmittedTo} onChange={(event) => setApplicationSubmittedTo(event.target.value)} /></Field>
                {recruitmentCategoryCode(applicationCategory) === "high_school_teaching" ? (
                  <Field label="Minimum A-Level points"><Input type="number" min="0" value={minimumALevelPoints} onChange={(event) => setMinimumALevelPoints(event.target.value)} placeholder="Any" /></Field>
                ) : <div />}
                {recruitmentCategoryCode(applicationCategory) !== "non_teaching" ? (
                  <Select value={teachingQualificationFilter} onValueChange={setTeachingQualificationFilter}>
                    <SelectTrigger className="mt-auto"><SelectValue placeholder="Teaching qualification" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">Any teaching qualification</SelectItem><SelectItem value="yes">Has teaching qualification</SelectItem><SelectItem value="no">No teaching qualification declared</SelectItem></SelectContent>
                  </Select>
                ) : <div />}
              </div>

              <div className="flex flex-wrap gap-2">
                {boardFilter !== "all" && <Badge variant="secondary" className="gap-1">Board: {boardFilter}<button type="button" onClick={() => setBoardFilter("all")}><X className="h-3 w-3" /></button></Badge>}
                {departmentFilter !== "all" && <Badge variant="secondary" className="gap-1">Department: {departmentFilter}<button type="button" onClick={() => setDepartmentFilter("all")}><X className="h-3 w-3" /></button></Badge>}
                {applicationStatus !== "all" && <Badge variant="secondary" className="gap-1">Status: {titleCase(applicationStatus)}<button type="button" onClick={() => setApplicationStatus("all")}><X className="h-3 w-3" /></button></Badge>}
                {genderFilter !== "all" && <Badge variant="secondary" className="gap-1">Gender: {titleCase(genderFilter)}<button type="button" onClick={() => setGenderFilter("all")}><X className="h-3 w-3" /></button></Badge>}
                {applicationSource !== "all" && <Badge variant="secondary" className="gap-1">Source: {titleCase(applicationSource)}<button type="button" onClick={() => { setApplicationSource("all"); setApplicationVacancy("all"); }}><X className="h-3 w-3" /></button></Badge>}
                {applicationVacancy !== "all" && <Badge variant="secondary" className="gap-1">Vacancy: {vacancies.find((vacancy: any) => String(vacancy.id) === applicationVacancy)?.title || applicationVacancy}<button type="button" onClick={() => setApplicationVacancy("all")}><X className="h-3 w-3" /></button></Badge>}
                {applicationSubject !== "all" && <Badge variant="secondary" className="gap-1">Subject: {applicationSubject}<button type="button" onClick={() => setApplicationSubject("all")}><X className="h-3 w-3" /></button></Badge>}
                {minimumALevelPoints !== "" && <Badge variant="secondary" className="gap-1">A-Level: {minimumALevelPoints}+<button type="button" onClick={() => setMinimumALevelPoints("")}><X className="h-3 w-3" /></button></Badge>}
                {teachingQualificationFilter !== "all" && <Badge variant="secondary" className="gap-1">Teaching qualification: {teachingQualificationFilter === "yes" ? "Yes" : "No"}<button type="button" onClick={() => setTeachingQualificationFilter("all")}><X className="h-3 w-3" /></button></Badge>}
                {documentCompletenessFilter !== "all" && <Badge variant="secondary" className="gap-1">Documents: {titleCase(documentCompletenessFilter)}<button type="button" onClick={() => setDocumentCompletenessFilter("all")}><X className="h-3 w-3" /></button></Badge>}
                {(applicationSubmittedFrom || applicationSubmittedTo) && <Badge variant="secondary" className="gap-1">Date: {applicationSubmittedFrom || "…"} → {applicationSubmittedTo || "…"}<button type="button" onClick={() => { setApplicationSubmittedFrom(""); setApplicationSubmittedTo(""); }}><X className="h-3 w-3" /></button></Badge>}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 p-3 text-sm">
                <div><strong>{filteredApplications.length}</strong> application(s) match the current filters.</div>
                <div className="flex flex-wrap gap-2">
                  {applicationDepartmentOptions.length > 1 && <Button size="sm" variant={groupApplicationsByDepartment ? "default" : "outline"} onClick={() => setGroupApplicationsByDepartment((value) => !value)}>{groupApplicationsByDepartment ? "Grouped by Department" : "Group by Department"}</Button>}
                  <Button size="sm" variant="outline" onClick={clearApplicationFilters}>Clear filters</Button>
                </div>
              </div>

              {groupApplicationsByDepartment && applicationDepartmentOptions.length > 1 ? (
                <div className="space-y-5">
                  {applicationGroups.map(([department, rows]) => (
                    <section key={department} className="space-y-2">
                      <div className="flex items-center justify-between"><h3 className="font-semibold">{department}</h3><Badge variant="secondary">{rows.length}</Badge></div>
                      <DataTable heads={["Applicant", "Application", "Department", "Exam Board", "Subjects", "Experience", "Documents", "Status", "Actions"]}>
                        {rows.map(renderApplicationRow)}
                      </DataTable>
                    </section>
                  ))}
                </div>
              ) : (
                <DataTable heads={["Applicant", "Application", "Department", "Exam Board", "Subjects", "Experience", "Documents", "Status", "Actions"]}>
                  {filteredApplications.map(renderApplicationRow)}
                </DataTable>
              )}
              {!filteredApplications.length && <p className="py-4 text-center text-sm text-muted-foreground">No applications match this view.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="talent" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Talent Pool / Shortlisted Candidates</CardTitle>
              <CardDescription>Department groups candidates. High School rankings are maintained manually per Subject; Primary School uses one general manual ranking.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px_180px_200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" value={talentSearch} onChange={(event) => setTalentSearch(event.target.value)} placeholder="Search name, department or subject" />
                </div>
                <Select value={talentDepartment} onValueChange={(value) => { setTalentDepartment(value); setTalentSubject("all"); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.filter((department: any) => department.isActive).map((department: any) => (
                      <SelectItem key={department.id} value={normalizeRecruitmentDepartment(department.name)}>{normalizeRecruitmentDepartment(department.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {talentDepartment === "Primary School" ? (
                  <div className="flex h-10 items-center rounded-md border px-3 text-sm">Primary School ranking</div>
                ) : (
                  <Select value={talentSubject} onValueChange={setTalentSubject}>
                    <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All subjects</SelectItem>{subjectCatalog.map((subject: string) => <SelectItem key={subject} value={subject}>{subject}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                <Select value={talentBoard} onValueChange={setTalentBoard}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All exam boards</SelectItem>
                    {activeExaminationBoards.map((board: string) => <SelectItem key={board} value={board}>{board}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={talentAvailability} onValueChange={setTalentAvailability}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All active availability states</SelectItem>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {talentDepartment !== "all" && rankingSubject ? (
                <div className="space-y-3">
                  <div className="rounded-md bg-muted p-3 text-sm">
                    <strong>{talentDepartment} → {rankingSubject}</strong>. New eligible shortlisted candidates are appended at the bottom. Ordering is entirely manual; drag candidates or use the movement controls.
                  </div>
                  {activeTalentRankingRows.map((row: any, index: number) => (
                    <div
                      key={row.id}
                      draggable={canProcess}
                      onDragStart={() => setTalentDraggedId(Number(row.applicationId))}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => dropTalentRanking(Number(row.applicationId))}
                      className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"
                    >
                      <div className="flex items-center gap-3">
                        <GripVertical className="h-5 w-5 text-muted-foreground" />
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">#{index + 1}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{row.application.firstName} {row.application.lastName}</div>
                        <div className="text-sm text-muted-foreground">
                          {formatExamBoards(applicationBoardList(row.application)) || "No exam board"} · {normalizeSubjectList(row.application.recruiterAssignedSubjects).join(", ") || "No HOD-assigned subjects"}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setModal({ type: "application", record: row.application })}>View</Button>
                        {canProcess && <>
                          <Button size="icon" variant="outline" title="Move up" disabled={index === 0 || actionMutation.isPending} onClick={() => moveTalentRanking(row.applicationId, "up")}><ArrowUp className="h-4 w-4" /></Button>
                          <Button size="icon" variant="outline" title="Move down" disabled={index === activeTalentRankingRows.length - 1 || actionMutation.isPending} onClick={() => moveTalentRanking(row.applicationId, "down")}><ArrowDown className="h-4 w-4" /></Button>
                          <Button size="icon" variant="outline" title="Move to top" disabled={index === 0 || actionMutation.isPending} onClick={() => moveTalentRanking(row.applicationId, "top")}><ChevronsUp className="h-4 w-4" /></Button>
                          <Button size="icon" variant="outline" title="Move to bottom" disabled={index === activeTalentRankingRows.length - 1 || actionMutation.isPending} onClick={() => moveTalentRanking(row.applicationId, "bottom")}><ChevronsDown className="h-4 w-4" /></Button>
                        </>}
                      </div>
                    </div>
                  ))}
                  {!activeTalentRankingRows.length && <p className="py-5 text-center text-sm text-muted-foreground">No active shortlisted candidates are ranked for this Department and Subject yet. Assign the Subject on a shortlisted candidate to add them at the bottom automatically.</p>}
                </div>
              ) : (
                <>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {talentPool.map((application: any) => (
                      <CandidateSummary key={application.id} application={application} onView={() => setModal({ type: "application", record: application })} />
                    ))}
                  </div>
                  {!talentPool.length && <p className="py-4 text-center text-sm text-muted-foreground">No candidates match the current Talent Pool filters.</p>}
                  {talentDepartment !== "all" && talentDepartment !== "Primary School" && talentSubject === "all" && <p className="text-center text-xs text-muted-foreground">Choose a Subject to open its manual ranked shortlist.</p>}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requirements" className="space-y-5">
          <Card>
            <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Application Requirements</CardTitle>
                <CardDescription>Additional screening rules remain available. Requested documents remain non-blocking.</CardDescription>
              </div>
              {canRequirements && <Button onClick={() => setModal({ type: "requirement" })}><Plus className="mr-2 h-4 w-4" />Add requirement</Button>}
            </CardHeader>
            <CardContent>
              <DataTable heads={["Scope", "Requirement", "Type", "Mandatory", "Auto reject", "Status", "Actions"]}>
                {(data.requirements || []).map((requirement: any) => (
                  <TableRow key={requirement.id}>
                    <TableCell>{requirement.vacancyId ? vacancies.find((row: any) => row.id === requirement.vacancyId)?.title || `Vacancy ${requirement.vacancyId}` : requirement.employmentCategory || "All applications"}</TableCell>
                    <TableCell><div className="font-medium">{requirement.label}</div><div className="text-xs text-muted-foreground">{requirement.code}</div></TableCell>
                    <TableCell>{titleCase(requirement.inputType)}</TableCell>
                    <TableCell>{requirement.isMandatory ? "Yes" : "No"}</TableCell>
                    <TableCell>{requirement.autoRejectOnFail ? "Yes" : "No"}</TableCell>
                    <TableCell><StatusBadge value={requirement.isActive ? "active" : "archived"} /></TableCell>
                    <TableCell>{canRequirements && <Button size="sm" variant="outline" onClick={() => setModal({ type: "requirement", record: requirement })}>Edit</Button>}</TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Requested Document Categories</CardTitle>
                <CardDescription>Applicants may submit even when requested documents are missing.</CardDescription>
              </div>
              {canRequirements && <Button onClick={() => setModal({ type: "document-category" })}><Plus className="mr-2 h-4 w-4" />Add document category</Button>}
            </CardHeader>
            <CardContent>
              <DataTable heads={["Scope", "Document", "Requested", "Multiple", "Status", "Actions"]}>
                {(data.documentCategories || []).map((category: any) => (
                  <TableRow key={category.id}>
                    <TableCell>{category.vacancyId ? vacancies.find((row: any) => row.id === category.vacancyId)?.title || `Vacancy ${category.vacancyId}` : category.employmentCategory || "All applications"}</TableCell>
                    <TableCell>{category.label}</TableCell>
                    <TableCell>{category.isRequired ? "Yes" : "No"}</TableCell>
                    <TableCell>{category.allowsMultiple ? "Yes" : "No"}</TableCell>
                    <TableCell><StatusBadge value={category.isActive ? "active" : "archived"} /></TableCell>
                    <TableCell>{canRequirements && <Button size="sm" variant="outline" onClick={() => setModal({ type: "document-category", record: category })}>Edit</Button>}</TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rejected">
          <Card>
            <CardHeader>
              <CardTitle>Rejected</CardTitle>
              <CardDescription>Includes automatic screening rejections and applications rejected later by a recruiter. Rejected candidates are excluded from vacancy suggestions and Final Ranking.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable heads={["Applicant", "Opportunity", "Source", "Reason", "Failed Criteria", "Rejected"]}>
                {(data.rejectedEntries || []).map((entry: any) => (
                  <TableRow key={entry.id}>
                    <TableCell>{`${entry.firstName || ""} ${entry.lastName || ""}`.trim() || "Unknown"}</TableCell>
                    <TableCell>{entry.vacancyId ? vacancies.find((row: any) => row.id === entry.vacancyId)?.title || `Vacancy ${entry.vacancyId}` : entry.employmentCategory}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant={entry.source === "recruiter" ? "default" : "secondary"}>{entry.source === "recruiter" ? "Recruiter rejection" : "Automatic screening"}</Badge>
                        {entry.source === "recruiter" && entry.rejectedByLabel && <div className="text-xs text-muted-foreground">{entry.rejectedByLabel}</div>}
                      </div>
                    </TableCell>
                    <TableCell>{entry.source === "recruiter" ? (entry.reason || "No recruiter rejection reason recorded") : <StatusBadge value={entry.reasonCode} />}</TableCell>
                    <TableCell>{Array.isArray(entry.failedRequirementCodes) ? entry.failedRequirementCodes.join(", ") || "—" : "—"}</TableCell>
                    <TableCell>{entry.rejectedAt ? new Date(entry.rejectedAt).toLocaleString() : "—"}</TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <RecruitmentSettings
            data={data}
            canEdit={canSettings}
            saving={actionMutation.isPending}
            onSaveGeneral={(body) => actionMutation.mutate(
              { method: "PUT", url: "/api/recruitment/settings", body },
              { onSuccess: () => toast({ title: "Recruitment settings saved" }) },
            )}
            onAddDepartment={() => setModal({ type: "department" })}
            onEditDepartment={(record) => setModal({ type: "department", record })}
            onAddExaminationBoard={() => setModal({ type: "examination-board" })}
            onEditExaminationBoard={(record) => setModal({ type: "examination-board", record })}
            onEditNotification={(record) => setModal({ type: "notification", record })}
            onResend={(log) => actionMutation.mutate(
              { method: "POST", url: `/api/recruitment/notification-logs/${log.id}/resend` },
              { onSuccess: () => toast({ title: "Notification resent" }) },
            )}
          />
        </TabsContent>
      </Tabs>

      {modal?.type === "vacancy" && (
        <VacancyDialog
          open
          record={modal.record}
          data={data}
          saving={actionMutation.isPending}
          onClose={() => setModal(null)}
          onSave={(body) => {
            const isEdit = Boolean(modal.record?.id);
            actionMutation.mutate(
              {
                method: isEdit ? "PUT" : "POST",
                url: isEdit ? `/api/recruitment/vacancies/${modal.record.id}` : "/api/recruitment/vacancies",
                body,
              },
              {
                onSuccess: (result: any) => {
                  setModal(null);
                  if (result?.id) {
                    setSelectedVacancyId(result.id);
                    setActiveTab("vacancies");
                  }
                  toast({
                    title: isEdit ? "Vacancy updated" : "Vacancy created",
                    description: `${Number(result?.suggestionCount || 0)} existing candidate(s) currently match.`,
                  });
                },
              },
            );
          }}
        />
      )}

      {modal?.type === "application" && (
        <ApplicationDialog
          open
          application={applications.find((row: any) => row.id === modal.record.id) || modal.record}
          data={data}
          canProcess={canProcess}
          canInterviews={canInterviews}
          saving={actionMutation.isPending}
          onClose={() => setModal(null)}
          onSave={(body) => actionMutation.mutate(
            { method: "PUT", url: `/api/recruitment/applications/${modal.record.id}`, body },
            {
              onSuccess: () => {
                setModal(null);
                toast({ title: "Candidate updated" });
              },
            },
          )}
          onInterview={(application, record) => setModal({ type: "interview", application, record })}
          onAddNote={async (note) => {
            await actionMutation.mutateAsync({ method: "POST", url: `/api/recruitment/applications/${modal.record.id}/notes`, body: { note } });
            toast({ title: "Recruitment note added" });
          }}
        />
      )}

      {modal?.type === "interview" && (
        <InterviewDialog
          open
          application={modal.application}
          record={modal.record}
          saving={actionMutation.isPending}
          onClose={() => setModal({ type: "application", record: modal.application })}
          onSave={(body) => {
            const isEdit = Boolean(modal.record?.id);
            actionMutation.mutate(
              {
                method: isEdit ? "PUT" : "POST",
                url: isEdit ? `/api/recruitment/interviews/${modal.record.id}` : `/api/recruitment/applications/${modal.application.id}/interviews`,
                body,
              },
              {
                onSuccess: () => {
                  setModal({ type: "application", record: modal.application });
                  toast({ title: isEdit ? "Interview updated" : "Interview scheduled" });
                },
              },
            );
          }}
        />
      )}

      {modal?.type === "department" && (
        <DepartmentDialog
          open
          record={modal.record}
          recruiters={data.recruiters || []}
          saving={actionMutation.isPending}
          onClose={() => setModal(null)}
          onSave={(body) => {
            const isEdit = Boolean(modal.record?.id);
            actionMutation.mutate(
              {
                method: isEdit ? "PUT" : "POST",
                url: isEdit ? `/api/recruitment/departments/${modal.record.id}` : "/api/recruitment/departments",
                body,
              },
              {
                onSuccess: () => {
                  setModal(null);
                  toast({ title: "Department saved" });
                },
              },
            );
          }}
        />
      )}

      {modal?.type === "examination-board" && (
        <ExaminationBoardDialog
          open
          record={modal.record}
          saving={actionMutation.isPending}
          onClose={() => setModal(null)}
          onSave={(body) => {
            const isEdit = Boolean(modal.record?.id);
            actionMutation.mutate(
              {
                method: isEdit ? "PUT" : "POST",
                url: isEdit ? `/api/recruitment/examination-boards/${modal.record.id}` : "/api/recruitment/examination-boards",
                body,
              },
              { onSuccess: () => { setModal(null); toast({ title: "Examination board saved" }); } },
            );
          }}
        />
      )}

      {modal?.type === "notification" && (
        <NotificationConfigDialog
          open
          record={modal.record}
          saving={actionMutation.isPending}
          onClose={() => setModal(null)}
          onSave={(body) => actionMutation.mutate(
            { method: "PUT", url: `/api/recruitment/notification-configs/${modal.record.id}`, body },
            {
              onSuccess: () => {
                setModal(null);
                toast({ title: "Notification template saved" });
              },
            },
          )}
        />
      )}

      {modal?.type === "requirement" && (
        <RequirementDialog
          open
          record={modal.record}
          data={data}
          saving={actionMutation.isPending}
          onClose={() => setModal(null)}
          onSave={(body) => {
            const isEdit = Boolean(modal.record?.id);
            actionMutation.mutate(
              {
                method: isEdit ? "PUT" : "POST",
                url: isEdit ? `/api/recruitment/requirements/${modal.record.id}` : "/api/recruitment/requirements",
                body,
              },
              { onSuccess: () => { setModal(null); toast({ title: "Requirement saved" }); } },
            );
          }}
        />
      )}

      {modal?.type === "document-category" && (
        <DocumentCategoryDialog
          open
          record={modal.record}
          data={data}
          saving={actionMutation.isPending}
          onClose={() => setModal(null)}
          onSave={(body) => {
            const isEdit = Boolean(modal.record?.id);
            actionMutation.mutate(
              {
                method: isEdit ? "PUT" : "POST",
                url: isEdit ? `/api/recruitment/document-categories/${modal.record.id}` : "/api/recruitment/document-categories",
                body,
              },
              { onSuccess: () => { setModal(null); toast({ title: "Document category saved" }); } },
            );
          }}
        />
      )}
    </div>
  );
}

function Metric({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className="mt-1 text-2xl font-bold">{value}</div>
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}

function VacancyWorkspace({
  vacancy,
  data,
  canProcess,
  onViewApplication,
  onEditVacancy,
  actionMutation,
  toast,
}: {
  vacancy: any;
  data: any;
  canProcess: boolean;
  onViewApplication: (application: any) => void;
  onEditVacancy?: () => void;
  actionMutation: any;
  toast: any;
}) {
  const [workspaceTab, setWorkspaceTab] = useState("overview");
  const [draggedId, setDraggedId] = useState<number | null>(null);

  const relations = (data.vacancyCandidates || []).filter((row: any) => Number(row.vacancyId) === Number(vacancy.id));
  const applicationMap = new Map((data.applications || []).map((application: any) => [Number(application.id), application]));
  const suggested = relations
    .filter((row: any) => row.stage === "suggested")
    .map((row: any) => ({ relation: row, application: applicationMap.get(Number(row.applicationId)) }))
    .filter((row: any) => row.application && row.application.status !== "rejected");
  const directApplications = (data.applications || []).filter((application: any) => Number(application.vacancyId) === Number(vacancy.id) && application.status !== "rejected");
  const shortlist = relations
    .filter((row: any) => ["shortlisted", "final"].includes(row.stage))
    .map((row: any) => ({ relation: row, application: applicationMap.get(Number(row.applicationId)) }))
    .filter((row: any) => row.application && row.application.status !== "rejected");
  const finalRows = shortlist
    .filter((row: any) => row.relation.stage === "final")
    .sort((a: any, b: any) => Number(a.relation.finalRank || 999999) - Number(b.relation.finalRank || 999999));
  const activity = (data.activity || []).filter((row: any) => Number(row.vacancyId) === Number(vacancy.id));
  const school = data.schools.find((row: any) => row.id === vacancy.schoolId);
  const vacancyStatusCounts = {
    submitted: directApplications.filter((application: any) => application.status === "submitted").length,
    underReview: directApplications.filter((application: any) => application.status === "under_review").length,
    shortlisted: directApplications.filter((application: any) => application.status === "shortlisted").length,
    interview: directApplications.filter((application: any) => application.status === "interview").length,
    hired: directApplications.filter((application: any) => application.status === "hired").length,
  };
  const vacancySubjects = normalizeSubjectList(vacancy.subjects);
  const vacancyDepartment = normalizeRecruitmentDepartment(vacancy.department);
  const vacancyCategoryCode = recruitmentCategoryCode(vacancy.employmentCategory);
  const rankedTalentMatches = (data.talentRankings || [])
    .filter((row: any) => row.isActive
      && vacancyDepartment
      && normalizeRecruitmentDepartment(row.department) === vacancyDepartment
      && (vacancyCategoryCode === "primary_teaching"
        ? String(row.subject || "").toLowerCase() === "primary school"
        : vacancySubjects.some((subject: string) => subject.toLowerCase() === String(row.subject || "").toLowerCase())))
    .map((row: any) => ({ ...row, application: applicationMap.get(Number(row.applicationId)) }))
    .filter((row: any) => row.application
      && !["rejected", "hired", "withdrawn"].includes(row.application.status)
      && examBoardMatches(applicationBoardList(row.application), vacancy.examinationBoard))
    .sort((a: any, b: any) => String(a.subject).localeCompare(String(b.subject)) || Number(a.position) - Number(b.position));

  const shortlistCandidate = (applicationId: number) => {
    actionMutation.mutate(
      { method: "PUT", url: `/api/recruitment/vacancies/${vacancy.id}/candidates/${applicationId}`, body: { stage: "shortlisted" } },
      { onSuccess: () => toast({ title: "Candidate added to shortlist" }) },
    );
  };

  const addToFinal = (applicationId: number) => {
    actionMutation.mutate(
      { method: "PUT", url: `/api/recruitment/vacancies/${vacancy.id}/candidates/${applicationId}`, body: { stage: "final" } },
      { onSuccess: () => toast({ title: "Candidate added to Final Ranking" }) },
    );
  };

  const removeCandidate = (applicationId: number) => {
    actionMutation.mutate(
      { method: "DELETE", url: `/api/recruitment/vacancies/${vacancy.id}/candidates/${applicationId}` },
      { onSuccess: () => toast({ title: "Candidate removed from this vacancy stage" }) },
    );
  };

  const saveOrder = (ids: number[]) => {
    actionMutation.mutate(
      { method: "PUT", url: `/api/recruitment/vacancies/${vacancy.id}/final-ranking`, body: { applicationIds: ids } },
      { onSuccess: () => toast({ title: "Final Ranking updated" }) },
    );
  };

  const move = (applicationId: number, mode: "up" | "down" | "top" | "bottom") => {
    const ids = finalRows.map((row: any) => Number(row.application.id));
    const index = ids.indexOf(applicationId);
    if (index < 0) return;
    const next = [...ids];
    const [item] = next.splice(index, 1);
    let target = index;
    if (mode === "up") target = Math.max(0, index - 1);
    if (mode === "down") target = Math.min(next.length, index + 1);
    if (mode === "top") target = 0;
    if (mode === "bottom") target = next.length;
    next.splice(target, 0, item);
    if (next.join(",") !== ids.join(",")) saveOrder(next);
  };

  const dropOn = (targetId: number) => {
    if (!draggedId || draggedId === targetId) return;
    const ids = finalRows.map((row: any) => Number(row.application.id));
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setDraggedId(null);
    saveOrder(next);
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{vacancy.title}</CardTitle>
            <StatusBadge value={vacancy.status} />
          </div>
          <CardDescription>
            {vacancy.code} · {vacancy.employmentCategory}
            {vacancy.department ? ` · ${normalizeRecruitmentDepartment(vacancy.department)}` : ""}
            {vacancy.examinationBoard ? ` · ${vacancy.examinationBoard}` : ""}
            {normalizeSubjectList(vacancy.subjects).length ? ` · ${normalizeSubjectList(vacancy.subjects).join(", ")}` : ""}
            {school?.name ? ` · ${school.name}` : ""}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          {canProcess && (
            <Button
              variant="outline"
              onClick={() => actionMutation.mutate(
                { method: "POST", url: `/api/recruitment/vacancies/${vacancy.id}/refresh-suggestions` },
                { onSuccess: (result: any) => toast({ title: "Suggestions refreshed", description: `${result?.suggestionCount || 0} candidate(s) match.` }) },
              )}
            >
              <RefreshCw className="mr-2 h-4 w-4" />Refresh matches
            </Button>
          )}
          {onEditVacancy && <Button variant="outline" onClick={onEditVacancy}><Pencil className="mr-2 h-4 w-4" />Edit vacancy</Button>}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={workspaceTab} onValueChange={setWorkspaceTab}>
          <div className="overflow-x-auto">
            <TabsList className="w-max">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="suggested">Suggested Candidates ({suggested.length})</TabsTrigger>
              <TabsTrigger value="applications">Applications ({directApplications.length})</TabsTrigger>
              <TabsTrigger value="shortlist">Shortlist ({shortlist.length})</TabsTrigger>
              <TabsTrigger value="ranking">Final Ranking ({finalRows.length})</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="space-y-4 pt-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Application Category" value={vacancy.employmentCategory} />
              <Info label="Department" value={normalizeRecruitmentDepartment(vacancy.department) || "—"} />
              <Info label="Examination Board" value={vacancy.examinationBoard || "—"} />
              <Info label="Subjects" value={normalizeSubjectList(vacancy.subjects).join(", ") || "—"} />
              <Info label="School / Campus" value={school?.name || "Any school / HQ"} />
              <Info label="Minimum experience" value={vacancy.minimumYearsExperience ? `${Number(vacancy.minimumYearsExperience)} years` : "No minimum"} />
              <Info label="Teaching qualification" value={vacancy.teachingQualificationRequired ? "Required" : "Not required"} />
              <Info label="Positions" value={vacancy.positionsAvailable} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-md border p-3 text-sm"><div className="text-xs text-muted-foreground">Applications</div><div className="text-xl font-bold">{directApplications.length}</div></div>
              <div className="rounded-md border p-3 text-sm"><div className="text-xs text-muted-foreground">New</div><div className="text-xl font-bold">{vacancyStatusCounts.submitted}</div></div>
              <div className="rounded-md border p-3 text-sm"><div className="text-xs text-muted-foreground">Under Review</div><div className="text-xl font-bold">{vacancyStatusCounts.underReview}</div></div>
              <div className="rounded-md border p-3 text-sm"><div className="text-xs text-muted-foreground">Shortlisted</div><div className="text-xl font-bold">{vacancyStatusCounts.shortlisted}</div></div>
              <div className="rounded-md border p-3 text-sm"><div className="text-xs text-muted-foreground">Interview</div><div className="text-xl font-bold">{vacancyStatusCounts.interview}</div></div>
              <div className="rounded-md border p-3 text-sm"><div className="text-xs text-muted-foreground">Hired</div><div className="text-xl font-bold">{vacancyStatusCounts.hired}</div></div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Description</div>
              <div className="mt-1 whitespace-pre-wrap rounded-md border p-3 text-sm">{vacancy.description}</div>
            </div>
            <div className="rounded-md bg-muted p-4 text-sm">
              <strong>{suggested.length} existing candidate(s)</strong> currently satisfy the vacancy matching criteria. {rankedTalentMatches.length > 0 ? `${rankedTalentMatches.length} active subject-ranked Talent Pool placement(s) also match this vacancy.` : "No active subject-ranked Talent Pool placements currently match."} Matching is system-assisted; ordering in Final Ranking is manual.
            </div>
          </TabsContent>

          <TabsContent value="suggested" className="space-y-3 pt-4">
            <div className="rounded-md bg-muted p-3 text-sm">
              Suggested Candidates must match Application Category, Department where applicable, Examination Board, Subject, any explicit Teaching Qualification requirement and Minimum Experience. Rejected applications never qualify.
            </div>
            {rankedTalentMatches.length > 0 && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="font-semibold">Matching ranked Talent Pool candidates</div>
                <div className="text-xs text-muted-foreground">These candidates are shown in the HOD-maintained Subject order. They are not automatically attached or contacted.</div>
                {rankedTalentMatches.map((row: any) => (
                  <div key={`${row.id}-${row.applicationId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 p-2 text-sm">
                    <div><strong>#{row.position} {row.subject}</strong> · {row.application.firstName} {row.application.lastName}</div>
                    <Button size="sm" variant="outline" onClick={() => onViewApplication(row.application)}>View candidate</Button>
                  </div>
                ))}
              </div>
            )}
            {suggested.map(({ relation, application }: any) => (
              <CandidateSummary
                key={application.id}
                application={application}
                vacancy={vacancy}
                relation={relation}
                schoolName={school?.name}
                onView={() => onViewApplication(application)}
                primaryAction={canProcess ? <Button size="sm" onClick={() => shortlistCandidate(application.id)}><UserPlus className="mr-1 h-3.5 w-3.5" />Add to Shortlist</Button> : undefined}
              />
            ))}
            {!suggested.length && <p className="py-6 text-center text-sm text-muted-foreground">No unmatched existing candidates currently qualify.</p>}
          </TabsContent>

          <TabsContent value="applications" className="space-y-3 pt-4">
            {directApplications.map((application: any) => {
              const relation = relations.find((row: any) => Number(row.applicationId) === Number(application.id));
              return (
                <CandidateSummary
                  key={application.id}
                  application={application}
                  vacancy={vacancy}
                  relation={relation}
                  schoolName={school?.name}
                  onView={() => onViewApplication(application)}
                  primaryAction={canProcess && !relation ? <Button size="sm" onClick={() => shortlistCandidate(application.id)}><UserPlus className="mr-1 h-3.5 w-3.5" />Add to Shortlist</Button> : undefined}
                />
              );
            })}
            {!directApplications.length && <p className="py-6 text-center text-sm text-muted-foreground">No applicant has applied directly to this vacancy yet.</p>}
          </TabsContent>

          <TabsContent value="shortlist" className="space-y-3 pt-4">
            {shortlist.map(({ relation, application }: any) => (
              <CandidateSummary
                key={application.id}
                application={application}
                vacancy={vacancy}
                relation={relation}
                schoolName={school?.name}
                onView={() => onViewApplication(application)}
                primaryAction={canProcess && relation.stage !== "final" ? <Button size="sm" onClick={() => addToFinal(application.id)}><Trophy className="mr-1 h-3.5 w-3.5" />Add to Final Ranking</Button> : undefined}
                secondaryAction={canProcess ? <Button size="sm" variant="outline" onClick={() => removeCandidate(application.id)}>Remove</Button> : undefined}
              />
            ))}
            {!shortlist.length && <p className="py-6 text-center text-sm text-muted-foreground">No candidates have been shortlisted for this vacancy.</p>}
          </TabsContent>

          <TabsContent value="ranking" className="space-y-3 pt-4">
            <div className="rounded-md bg-muted p-3 text-sm">
              Final Ranking is entirely manual. Drag candidates into order, or use Move Up/Down/Top/Bottom. The system does not calculate a “best candidate” score.
            </div>
            {finalRows.map(({ application, relation }: any, index: number) => (
              <div
                key={application.id}
                draggable={canProcess}
                onDragStart={() => setDraggedId(Number(application.id))}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropOn(Number(application.id))}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="h-5 w-5 text-muted-foreground" />
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">#{index + 1}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{application.firstName} {application.lastName}</div>
                  <div className="text-sm text-muted-foreground">
                    {normalizeSubjectList([...(application.recruiterAssignedSubjects || []), ...(application.declaredSubjects || [])]).join(", ") || "No subjects recorded"}
                    {application.interviews?.length ? ` · ${application.interviews.length} interview(s)` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => onViewApplication(application)}>View</Button>
                  {canProcess && <>
                    <Button size="icon" variant="outline" title="Move up" disabled={index === 0 || actionMutation.isPending} onClick={() => move(application.id, "up")}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="outline" title="Move down" disabled={index === finalRows.length - 1 || actionMutation.isPending} onClick={() => move(application.id, "down")}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="outline" title="Move to top" disabled={index === 0 || actionMutation.isPending} onClick={() => move(application.id, "top")}><ChevronsUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="outline" title="Move to bottom" disabled={index === finalRows.length - 1 || actionMutation.isPending} onClick={() => move(application.id, "bottom")}><ChevronsDown className="h-4 w-4" /></Button>
                    <Button size="sm" variant="outline" onClick={() => removeCandidate(application.id)}>Remove</Button>
                  </>}
                </div>
              </div>
            ))}
            {!finalRows.length && <p className="py-6 text-center text-sm text-muted-foreground">Add shortlisted candidates to Final Ranking when Recruitment is ready to order the finalists.</p>}
          </TabsContent>

          <TabsContent value="activity" className="space-y-2 pt-4">
            {activity.map((item: any) => (
              <div key={item.id} className="rounded-md border p-3 text-sm">
                <div className="flex justify-between gap-4">
                  <div className="font-medium">{item.summary}</div>
                  <div className="whitespace-nowrap text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</div>
                </div>
                <div className="text-xs text-muted-foreground">{titleCase(item.activityType)}</div>
              </div>
            ))}
            {!activity.length && <p className="text-sm text-muted-foreground">No vacancy activity yet.</p>}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function VacancyDialog({
  open,
  record,
  data,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  record?: any;
  data: any;
  saving: boolean;
  onClose: () => void;
  onSave: (body: any) => void;
}) {
  const initialCategory = record?.employmentCategory || "High School Teaching";
  const [form, setForm] = useState<any>({
    schoolId: record?.schoolId ? String(record.schoolId) : "none",
    code: record?.code || "",
    title: record?.title || "",
    employmentCategory: initialCategory,
    department: normalizeRecruitmentDepartment(record?.department) || "",
    examinationBoard: record?.examinationBoard || "",
    subjects: normalizeSubjectList(record?.subjects),
    minimumYearsExperience: record?.minimumYearsExperience ?? "",
    teachingQualificationRequired: Boolean(record?.teachingQualificationRequired),
    description: record?.description || "",
    locationText: record?.locationText || "",
    positionsAvailable: record?.positionsAvailable || 1,
    status: record?.status || "draft",
    opensAt: toLocalInput(record?.opensAt),
    closesAt: toLocalInput(record?.closesAt),
  });

  const [subjectToAdd, setSubjectToAdd] = useState("");
  const code = recruitmentCategoryCode(form.employmentCategory);
  const highSchoolDepartments = (data.departments || []).filter((department: any) =>
    department.applicationCategory === "High School Teaching" && department.isActive,
  );

  const set = (key: string, value: unknown) => setForm((current: any) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (code === "primary_teaching") set("department", "Primary School");
    if (code === "non_teaching") {
      setForm((current: any) => ({
        ...current,
        department: "",
        examinationBoard: "",
        subjects: [],
        teachingQualificationRequired: false,
      }));
    }
  }, [code]);

  const submit = () => {
    onSave({
      schoolId: form.schoolId === "none" ? null : Number(form.schoolId),
      code: form.code,
      title: form.title,
      employmentCategory: form.employmentCategory,
      department: code === "high_school_teaching" ? form.department : code === "primary_teaching" ? "Primary School" : null,
      examinationBoard: code === "non_teaching" ? null : form.examinationBoard || null,
      subjects: code === "high_school_teaching" || code === "primary_teaching" ? normalizeSubjectList(form.subjects) : [],
      minimumYearsExperience: form.minimumYearsExperience === "" ? null : Number(form.minimumYearsExperience),
      teachingQualificationRequired: code === "non_teaching" ? false : Boolean(form.teachingQualificationRequired),
      description: form.description,
      locationText: form.locationText || null,
      positionsAvailable: Number(form.positionsAvailable || 1),
      status: form.status,
      opensAt: form.opensAt ? new Date(form.opensAt).toISOString() : null,
      closesAt: form.closesAt ? new Date(form.closesAt).toISOString() : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{record ? "Edit vacancy" : "Create vacancy"}</DialogTitle>
          <DialogDescription>Application Category controls which structured recruitment fields are required.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Vacancy code"><Input value={form.code} onChange={(event) => set("code", event.target.value.toUpperCase())} /></Field>
          <Field label="Title"><Input value={form.title} onChange={(event) => set("title", event.target.value)} /></Field>

          <Field label="Application Category *">
            <Select value={form.employmentCategory} onValueChange={(value) => set("employmentCategory", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{RECRUITMENT_CATEGORIES.map((category) => <SelectItem key={category.code} value={category.label}>{category.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>

          {code === "high_school_teaching" && (
            <Field label="Department *">
              <Select value={form.department} onValueChange={(value) => set("department", value)}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>{highSchoolDepartments.map((department: any) => <SelectItem key={department.id} value={normalizeRecruitmentDepartment(department.name)}>{normalizeRecruitmentDepartment(department.name)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}

          {code !== "non_teaching" && (
            <Field label="Examination Board *">
              <Select value={form.examinationBoard} onValueChange={(value) => set("examinationBoard", value)}>
                <SelectTrigger><SelectValue placeholder="Select examination board" /></SelectTrigger>
                <SelectContent>{(data.examinationBoards || RECRUITMENT_EXAM_BOARDS).map((board: string) => <SelectItem key={board} value={board}>{board}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}

          {code === "high_school_teaching" && (
            <div className="md:col-span-2 space-y-2">
              <Label>Subject(s) *</Label>
              <div className="flex flex-wrap gap-2">
                {(form.subjects || []).map((subject: string) => (
                  <Badge key={subject} variant="secondary" className="gap-1">{subject}<button type="button" aria-label={`Remove ${subject}`} onClick={() => set("subjects", (form.subjects || []).filter((value: string) => value !== subject))}><X className="h-3 w-3" /></button></Badge>
                ))}
                {!(form.subjects || []).length && <span className="text-sm text-muted-foreground">No subjects selected.</span>}
              </div>
              <div className="flex gap-2">
                <Select value={subjectToAdd || undefined} onValueChange={setSubjectToAdd}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Select subject from academic catalogue" /></SelectTrigger>
                  <SelectContent>{normalizeSubjectList(data.subjectCatalog || []).filter((subject: string) => !(form.subjects || []).includes(subject)).map((subject: string) => <SelectItem key={subject} value={subject}>{subject}</SelectItem>)}</SelectContent>
                </Select>
                <Button type="button" variant="outline" disabled={!subjectToAdd} onClick={() => { set("subjects", normalizeSubjectList([...(form.subjects || []), subjectToAdd])); setSubjectToAdd(""); }}>Add</Button>
              </div>
              <p className="text-xs text-muted-foreground">Uses the existing academic Subject catalogue to avoid duplicate or inconsistent subject names.</p>
            </div>
          )}

          <Field label="School / Campus *">
            <Select value={form.schoolId} onValueChange={(value) => set("schoolId", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any school / HQ</SelectItem>
                {data.schools.map((school: any) => <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Minimum Years of Experience" hint="Optional. If set, candidates below this value are not suggested for the vacancy.">
            <Input type="number" min="0" step="0.5" value={form.minimumYearsExperience} onChange={(event) => set("minimumYearsExperience", event.target.value)} />
          </Field>

          {code !== "non_teaching" && (
            <div className="md:col-span-2">
              <Toggle
                label="Teaching Qualification Required"
                checked={form.teachingQualificationRequired}
                onChange={(value) => set("teachingQualificationRequired", value)}
                description="Uses the applicant's existing Yes/No declaration. The system does not attempt to interpret qualification names automatically."
              />
            </div>
          )}

          <Field label="Positions available"><Input type="number" min="1" value={form.positionsAvailable} onChange={(event) => set("positionsAvailable", event.target.value)} /></Field>
          <Field label="Location"><Input value={form.locationText} onChange={(event) => set("locationText", event.target.value)} /></Field>
          <Field label="Opening date/time"><Input type="datetime-local" value={form.opensAt} onChange={(event) => set("opensAt", event.target.value)} /></Field>
          <Field label="Closing date/time"><Input type="datetime-local" value={form.closesAt} onChange={(event) => set("closesAt", event.target.value)} /></Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(value) => set("status", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["draft", "published", "closed", "archived"].map((status) => <SelectItem key={status} value={status}>{titleCase(status)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2"><Field label="Description"><Textarea className="min-h-36" value={form.description} onChange={(event) => set("description", event.target.value)} /></Field></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !form.code.trim() || !form.title.trim() || !form.description.trim()} onClick={submit}>{saving ? "Saving…" : record ? "Save vacancy" : "Create vacancy"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplicationDialog({
  open,
  application,
  data,
  canProcess,
  canInterviews,
  saving,
  onClose,
  onSave,
  onInterview,
  onAddNote,
}: {
  open: boolean;
  application: any;
  data: any;
  canProcess: boolean;
  canInterviews: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (body: any) => void;
  onInterview: (application: any, interview?: any) => void;
  onAddNote: (note: string) => Promise<void>;
}) {
  const latestRejectionHistory = (application.history || []).find((item: any) => item.newStatus === "rejected");
  const [form, setForm] = useState<any>({
    status: application.status,
    rejectionReason: latestRejectionHistory?.notes || "",
    recruiterAssignedSubjects: normalizeSubjectList(application.recruiterAssignedSubjects),
    availabilityStatus: application.availabilityStatus || "available",
    availabilityNotes: application.availabilityNotes || "",
    markContacted: false,
  });
  const [subjectToAdd, setSubjectToAdd] = useState("");
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  useEffect(() => {
    const rejectionHistory = (application.history || []).find((item: any) => item.newStatus === "rejected");
    setForm({
      status: application.status,
      rejectionReason: rejectionHistory?.notes || "",
      recruiterAssignedSubjects: normalizeSubjectList(application.recruiterAssignedSubjects),
      availabilityStatus: application.availabilityStatus || "available",
      availabilityNotes: application.availabilityNotes || "",
      markContacted: false,
    });
    setSubjectToAdd("");
    setNewNote("");
  }, [application.id, application.updatedAt]);

  const vacancy = application.vacancy;
  const school = vacancy?.schoolId ? data.schools.find((row: any) => row.id === vacancy.schoolId) : null;
  const candidateIdentity = application.normalizedNationalId || application.normalizedEmail || application.normalizedPhone;
  const relatedApplications = (data.applications || []).filter((row: any) => {
    if (!candidateIdentity) return Number(row.id) === Number(application.id);
    return row.normalizedNationalId === candidateIdentity || row.normalizedEmail === candidateIdentity || row.normalizedPhone === candidateIdentity;
  });
  const relatedApplicationIds = new Set(relatedApplications.map((row: any) => Number(row.id)));
  const notificationLogs = (data.notificationLogs || []).filter((row: any) => row.applicationId && relatedApplicationIds.has(Number(row.applicationId)));
  const activity = (data.activity || []).filter((row: any) => row.applicationId && relatedApplicationIds.has(Number(row.applicationId)))
    .slice().sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const relatedDocuments = relatedApplications.flatMap((row: any) => (row.documents || []).map((document: any) => ({ document, application: row })));
  const relatedInterviews = relatedApplications.flatMap((row: any) => (row.interviews || []).map((interview: any) => ({ interview, application: row })));
  const relatedNotes = relatedApplications.flatMap((row: any) => (row.notes || []).map((note: any) => ({ note, application: row })))
    .sort((a: any, b: any) => new Date(b.note.createdAt).getTime() - new Date(a.note.createdAt).getTime());
  const relatedStatusHistory = relatedApplications.flatMap((row: any) => (row.history || []).map((history: any) => ({ history, application: row })))
    .sort((a: any, b: any) => new Date(b.history.changedAt).getTime() - new Date(a.history.changedAt).getTime());
  const currentTalentRankings = (data.talentRankings || [])
    .filter((row: any) => row.isActive && relatedApplicationIds.has(Number(row.applicationId)))
    .slice()
    .sort((a: any, b: any) => String(a.subject || "").localeCompare(String(b.subject || "")));
  const subjectOptions = normalizeSubjectList(data.subjectCatalog || []).filter((subject: string) => !form.recruiterAssignedSubjects.includes(subject));
  const addSubject = () => {
    if (!subjectToAdd) return;
    setForm((current: any) => ({ ...current, recruiterAssignedSubjects: normalizeSubjectList([...(current.recruiterAssignedSubjects || []), subjectToAdd]) }));
    setSubjectToAdd("");
  };
  const removeSubject = (subject: string) => setForm((current: any) => ({ ...current, recruiterAssignedSubjects: (current.recruiterAssignedSubjects || []).filter((value: string) => value !== subject) }));
  const submitNote = async () => {
    const note = newNote.trim();
    if (!note || addingNote) return;
    setAddingNote(true);
    try {
      await onAddNote(note);
      setNewNote("");
    } finally {
      setAddingNote(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{application.firstName} {application.lastName}</DialogTitle>
          <DialogDescription>
            Consolidated candidate profile and Recruitment history.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="profile">
          <div className="overflow-x-auto">
            <TabsList className="w-max">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="applications">Applications ({relatedApplications.length})</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="interviews">Interviews</TabsTrigger>
              <TabsTrigger value="activity">Notes & Activity</TabsTrigger>
              <TabsTrigger value="communications">Communications</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="profile" className="space-y-5 pt-4">
            <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Application" value={vacancy?.title || "General application"} />
              <Info label="Category" value={application.employmentCategory} />
              <Info label="Department" value={normalizeRecruitmentDepartment(application.department) || "—"} />
              <Info label="Examination Boards" value={formatExamBoards(applicationBoardList(application)) || "—"} />
              <Info label="Email" value={application.email} />
              <Info label="Phone" value={application.phone} />
              <Info label="National ID" value={application.nationalId} />
              <Info label="Gender" value={titleCase(application.gender)} />
              <Info label="Experience" value={`${Number(application.yearsExperience || 0)} year(s)`} />
              <Info label="Teaching qualification" value={application.holdsTeachingQualification ? "Yes" : "No"} />
              <Info label="School / Campus" value={school?.name || "—"} />
              <Info label="Submitted" value={application.submittedAt ? new Date(application.submittedAt).toLocaleString() : "—"} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section>
                <h3 className="mb-2 font-semibold">Qualifications</h3>
                <div className="min-h-24 whitespace-pre-wrap rounded-md border p-3 text-sm">{application.qualifications || "—"}</div>
              </section>
              <section>
                <h3 className="mb-2 font-semibold">Cover letter / motivation</h3>
                <div className="min-h-24 whitespace-pre-wrap rounded-md border p-3 text-sm">{application.coverLetter || "—"}</div>
              </section>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Info label="Applicant-declared subjects" value={normalizeSubjectList(application.declaredSubjects).join(", ") || "—"} />
              <Info label="HOD / recruiter-assigned subjects" value={normalizeSubjectList(application.recruiterAssignedSubjects).join(", ") || "—"} />
            </div>

            {recruitmentCategoryCode(application.employmentCategory) === "primary_teaching" && (
              <section className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">O-Level results</h3>
                    <p className="text-xs text-muted-foreground">Structured results used by the Primary School Teaching eligibility policy.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{Number(application.oLevelSittingCount || 0)} sitting(s)</Badge>
                    <Badge variant="outline">{Number(application.oLevelQualifyingSubjectCount || 0)} qualifying subject(s)</Badge>
                  </div>
                </div>
                <DataTable heads={["Subject", "Grade", "Sitting"]}>
                  {(Array.isArray(application.oLevelResults) ? application.oLevelResults : []).map((result: any, index: number) => (
                    <TableRow key={`${result.subject}-${result.sitting}-${index}`}>
                      <TableCell>{result.subject}</TableCell>
                      <TableCell>{result.grade}</TableCell>
                      <TableCell>Sitting {result.sitting}</TableCell>
                    </TableRow>
                  ))}
                </DataTable>
                {!(Array.isArray(application.oLevelResults) && application.oLevelResults.length) && <p className="text-sm text-muted-foreground">No structured O-Level results were captured for this application.</p>}
              </section>
            )}

            {canProcess && (
              <div className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
                <Field label="Application status">
                  <Select value={form.status} onValueChange={(value) => setForm((current: any) => ({ ...current, status: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["submitted", "under_review", "shortlisted", "interview", "rejected", "hired", "withdrawn"].map((status) => <SelectItem key={status} value={status}>{titleCase(status)}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                {form.status === "rejected" && (
                  <div className="md:col-span-2">
                    <Field label="Rejection reason" hint="Required when a recruiter rejects an application. This reason is shown in the Rejected list and recorded in status history.">
                      <Textarea value={form.rejectionReason || ""} onChange={(event) => setForm((current: any) => ({ ...current, rejectionReason: event.target.value }))} placeholder="Enter the recruiter rejection reason…" />
                    </Field>
                  </div>
                )}
                <Field label="Availability">
                  <Select value={form.availabilityStatus} onValueChange={(value) => setForm((current: any) => ({ ...current, availabilityStatus: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["available", "contacted", "not_available", "hired", "withdrawn", "archived"].map((status) => <SelectItem key={status} value={status}>{titleCase(status)}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                {recruitmentCategoryCode(application.employmentCategory) === "high_school_teaching" && (
                  <div className="md:col-span-2 space-y-2">
                    <Label>Recruiter-assigned subjects</Label>
                    <div className="flex flex-wrap gap-2">
                      {(form.recruiterAssignedSubjects || []).map((subject: string) => (
                        <Badge key={subject} variant="secondary" className="gap-1">
                          {subject}
                          <button type="button" aria-label={`Remove ${subject}`} onClick={() => removeSubject(subject)}><X className="h-3 w-3" /></button>
                        </Badge>
                      ))}
                      {!(form.recruiterAssignedSubjects || []).length && <span className="text-sm text-muted-foreground">No subjects assigned yet.</span>}
                    </div>
                    <div className="flex gap-2">
                      <Select value={subjectToAdd || undefined} onValueChange={setSubjectToAdd}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Select subject from academic catalogue" /></SelectTrigger>
                        <SelectContent>{subjectOptions.map((subject: string) => <SelectItem key={subject} value={subject}>{subject}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button type="button" variant="outline" disabled={!subjectToAdd} onClick={addSubject}>Add</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Internal Recruitment classification only; the applicant's original declaration remains unchanged. Adding a Subject places an active shortlisted candidate at the bottom of that Subject ranking.</p>
                  </div>
                )}
                {currentTalentRankings.length > 0 && (
                  <div className="md:col-span-2 rounded-md bg-muted/50 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Current active shortlist rankings</div>
                    <div className="mt-2 flex flex-wrap gap-2">{currentTalentRankings.map((row: any) => <Badge key={row.id} variant="outline">{row.department} · {row.subject} #{row.position}</Badge>)}</div>
                  </div>
                )}
                <div className="md:col-span-2"><Field label="Availability notes"><Textarea value={form.availabilityNotes} onChange={(event) => setForm((current: any) => ({ ...current, availabilityNotes: event.target.value }))} /></Field></div>
                <label className="md:col-span-2 flex items-center gap-3 rounded-md border p-3">
                  <Checkbox checked={form.markContacted} onCheckedChange={(value) => setForm((current: any) => ({ ...current, markContacted: Boolean(value) }))} />
                  <span>Mark candidate as contacted now</span>
                </label>
              </div>
            )}
          </TabsContent>

          <TabsContent value="applications" className="space-y-3 pt-4">
            {relatedApplications
              .slice()
              .sort((a: any, b: any) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
              .map((row: any) => (
                <div key={row.id} className="rounded-md border p-4 text-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="font-medium">{row.vacancy?.title || "General application"}</div>
                      <div className="text-muted-foreground">
                        {row.employmentCategory}
                        {row.department ? ` · ${normalizeRecruitmentDepartment(row.department)}` : ""}
                        {applicationBoardList(row).length ? ` · ${formatExamBoards(applicationBoardList(row))}` : ""}
                      </div>
                    </div>
                    <StatusBadge value={row.status} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">Submitted {row.submittedAt ? new Date(row.submittedAt).toLocaleString() : "—"} · Reference application #{row.id}</div>
                </div>
              ))}
          </TabsContent>

          <TabsContent value="documents" className="space-y-3 pt-4">
            {relatedDocuments.map(({ document, application: sourceApplication }: any) => (
              <a
                key={`${sourceApplication.id}-${document.id}`}
                className="block rounded-md border p-3 text-sm hover:bg-muted"
                href={`/api/recruitment/documents/${document.id}?inline=1`}
                target="_blank"
                rel="noreferrer"
              >
                <div className="font-medium">{data.documentCategories.find((row: any) => row.code === document.categoryCode)?.label || titleCase(document.categoryCode)}</div>
                <div className="text-muted-foreground">{document.originalName}</div>
                <div className="mt-1 text-xs text-muted-foreground">From: {sourceApplication.vacancy?.title || "General application"}</div>
                {document.reviewStatus && <div className="mt-1"><StatusBadge value={document.reviewStatus} /></div>}
              </a>
            ))}
            {!relatedDocuments.length && <p className="text-sm text-muted-foreground">No documents uploaded.</p>}
          </TabsContent>

          <TabsContent value="interviews" className="space-y-3 pt-4">
            <div className="flex justify-end">
              {canInterviews && <Button size="sm" onClick={() => onInterview(application)}><CalendarClock className="mr-2 h-4 w-4" />Schedule interview</Button>}
            </div>
            {relatedInterviews.map(({ interview, application: interviewApplication }: any) => (
              <div key={`${interviewApplication.id}-${interview.id}`} className="rounded-md border p-4 text-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-medium">{new Date(interview.scheduledAt).toLocaleString()} · {titleCase(interview.interviewType)}</div>
                    <div className="text-muted-foreground">{interview.location || "Location not specified"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">For: {interviewApplication.vacancy?.title || "General application"}</div>
                  </div>
                  <div className="flex gap-2"><StatusBadge value={interview.status || "scheduled"} />{canInterviews && <Button size="sm" variant="outline" onClick={() => onInterview(interviewApplication, interview)}>Edit</Button>}</div>
                </div>
                {interview.applicantInstructions && <div className="mt-3"><strong>Applicant instructions:</strong> {interview.applicantInstructions}</div>}
                {interview.internalNotes && <div className="mt-2 rounded-md bg-muted p-2"><strong>Internal notes:</strong> {interview.internalNotes}</div>}
                {interview.interviewLink && <div className="mt-2"><strong>Interview link:</strong> {interview.interviewLink}</div>}
                {interview.outcome && <div className="mt-2"><strong>Outcome:</strong> {interview.outcome}</div>}
              </div>
            ))}
            {!relatedInterviews.length && <p className="text-sm text-muted-foreground">No interviews scheduled.</p>}
          </TabsContent>

          <TabsContent value="activity" className="space-y-3 pt-4">
            {canProcess && (
              <div className="rounded-md border p-4 space-y-3">
                <Field label="Add Recruitment note" hint="Notes are append-only and retain their author and timestamp.">
                  <Textarea className="min-h-24" value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Add context for future recruiters/HODs…" />
                </Field>
                <div className="flex justify-end"><Button size="sm" disabled={!newNote.trim() || addingNote} onClick={submitNote}>{addingNote ? "Adding…" : "Add note"}</Button></div>
              </div>
            )}
            {relatedNotes.map(({ note, application: noteApplication }: any) => {
              const author = (data.recruiters || []).find((row: any) => Number(row.userId) === Number(note.authorUserId));
              return (
                <div key={`note-${note.id}`} className="rounded-md border p-3 text-sm">
                  <div className="whitespace-pre-wrap">{note.note}</div>
                  <div className="mt-2 text-xs text-muted-foreground">{author ? `${author.firstName} ${author.lastName}` : "Recruitment user"} · {new Date(note.createdAt).toLocaleString()} · {noteApplication.vacancy?.title || "General application"}</div>
                </div>
              );
            })}
            {application.recruiterNotes && (
              <div className="rounded-md border border-dashed p-3 text-sm">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Legacy recruiter notes</div>
                <div className="mt-1 whitespace-pre-wrap">{application.recruiterNotes}</div>
              </div>
            )}
            {activity.map((item: any) => (
              <div key={item.id} className="rounded-md border p-3 text-sm">
                <div className="flex justify-between gap-4">
                  <div className="font-medium">{item.summary}</div>
                  <div className="whitespace-nowrap text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</div>
                </div>
                <div className="text-xs text-muted-foreground">{titleCase(item.activityType)}</div>
              </div>
            ))}
            {relatedStatusHistory.map(({ history: item, application: historyApplication }: any) => (
              <div key={`status-${item.id}`} className="rounded-md border p-3 text-sm">
                <div className="font-medium">Status: {titleCase(item.previousStatus)} → {titleCase(item.newStatus)}</div>
                {item.notes && <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{item.notes}</div>}
                <div className="mt-1 text-xs text-muted-foreground">{new Date(item.changedAt).toLocaleString()} · {historyApplication.vacancy?.title || "General application"}</div>
              </div>
            ))}
            {!activity.length && !relatedStatusHistory.length && !relatedNotes.length && !application.recruiterNotes && <p className="text-sm text-muted-foreground">No notes or activity recorded.</p>}
          </TabsContent>

          <TabsContent value="communications" className="space-y-2 pt-4">
            {notificationLogs.map((log: any) => (
              <div key={log.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><strong>{titleCase(log.eventKey)}</strong> · {log.channel.toUpperCase()}</div>
                  <StatusBadge value={log.status} />
                </div>
                <div className="text-muted-foreground">{log.destination || "No destination"}</div>
                {log.errorMessage && <div className="mt-1 text-destructive">{log.errorMessage}</div>}
                <div className="mt-1 text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</div>
              </div>
            ))}
            {!notificationLogs.length && <p className="text-sm text-muted-foreground">No Recruitment communication attempts recorded.</p>}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canProcess && (
            <Button
              disabled={saving || (form.status === "rejected" && !(form.rejectionReason || "").trim())}
              onClick={() => onSave({
                status: form.status,
                rejectionReason: form.status === "rejected" ? (form.rejectionReason || "").trim() : null,
                recruiterAssignedSubjects: form.recruiterAssignedSubjects,
                availabilityStatus: form.availabilityStatus,
                availabilityNotes: form.availabilityNotes || null,
                markContacted: form.markContacted,
              })}
            >
              {saving ? "Saving…" : "Save Candidate"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InterviewDialog({
  open,
  application,
  record,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  application: any;
  record?: any;
  saving: boolean;
  onClose: () => void;
  onSave: (body: any) => void;
}) {
  const [form, setForm] = useState<any>({
    scheduledAt: toLocalInput(record?.scheduledAt) || toLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    location: record?.location || "",
    interviewType: record?.interviewType || "in_person",
    applicantInstructions: record?.applicantInstructions || "",
    internalNotes: record?.internalNotes || "",
    interviewLink: record?.interviewLink || "",
    status: record?.status || "scheduled",
    outcome: record?.outcome || "",
  });
  const set = (key: string, value: unknown) => setForm((current: any) => ({ ...current, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{record ? "Edit interview" : "Schedule interview"}</DialogTitle>
          <DialogDescription>{application.firstName} {application.lastName}. Applicant Instructions may be sent to the candidate; Internal Notes are Recruitment-only.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Date and time"><Input type="datetime-local" value={form.scheduledAt} onChange={(event) => set("scheduledAt", event.target.value)} /></Field>
          <Field label="Interview mode">
            <Select value={form.interviewType} onValueChange={(value) => set("interviewType", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="in_person">In person</SelectItem><SelectItem value="online">Online</SelectItem><SelectItem value="phone">Phone</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Venue / location"><Input value={form.location} onChange={(event) => set("location", event.target.value)} /></Field>
          <Field label="Interview link"><Input value={form.interviewLink} onChange={(event) => set("interviewLink", event.target.value)} /></Field>
          {record && (
            <Field label="Interview status">
              <Select value={form.status} onValueChange={(value) => set("status", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent>
              </Select>
            </Field>
          )}
          <div className="md:col-span-2"><Field label="Applicant Instructions"><Textarea value={form.applicantInstructions} onChange={(event) => set("applicantInstructions", event.target.value)} placeholder="Safe to send to the candidate." /></Field></div>
          <div className="md:col-span-2"><Field label="Internal Notes"><Textarea value={form.internalNotes} onChange={(event) => set("internalNotes", event.target.value)} placeholder="Recruitment only. Never inserted into applicant notifications." /></Field></div>
          <div className="md:col-span-2"><Field label="Outcome"><Textarea value={form.outcome} onChange={(event) => set("outcome", event.target.value)} /></Field></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || !form.scheduledAt}
            onClick={() => onSave({
              scheduledAt: new Date(form.scheduledAt).toISOString(),
              location: form.location || null,
              interviewType: form.interviewType,
              applicantInstructions: form.applicantInstructions || null,
              internalNotes: form.internalNotes || null,
              interviewLink: form.interviewLink || null,
              ...(record ? { status: form.status } : {}),
              outcome: form.outcome || null,
            })}
          >
            {saving ? "Saving…" : record ? "Save interview" : "Schedule interview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentDialog({
  open,
  record,
  recruiters,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  record?: any;
  recruiters: any[];
  saving: boolean;
  onClose: () => void;
  onSave: (body: any) => void;
}) {
  const [form, setForm] = useState<any>({
    name: normalizeRecruitmentDepartment(record?.name) || "",
    applicationCategory: record?.applicationCategory || "High School Teaching",
    isActive: record?.isActive ?? true,
    displayOrder: record?.displayOrder ?? 100,
    responsibleUserId: record?.responsibleUserId ? String(record.responsibleUserId) : "none",
    applicantContactPhone: record?.applicantContactPhone || "",
    applicantContactEmail: record?.applicantContactEmail || "",
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{record ? "Edit Department" : "Add Department"}</DialogTitle>
          <DialogDescription>Departments are Recruitment configuration. Inactive departments remain valid for historical records but are unavailable for new applications.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name"><Input value={form.name} onChange={(event) => setForm((current: any) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label="Application Category">
            <Select value={form.applicationCategory} onValueChange={(value) => setForm((current: any) => ({ ...current, applicationCategory: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{RECRUITMENT_CATEGORIES.filter((row) => row.code !== "non_teaching").map((category) => <SelectItem key={category.code} value={category.label}>{category.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Display Order"><Input type="number" min="0" value={form.displayOrder} onChange={(event) => setForm((current: any) => ({ ...current, displayOrder: event.target.value }))} /></Field>
          <Field label="Responsible Group HOD / Recruiter">
            <Select value={form.responsibleUserId} onValueChange={(value) => setForm((current: any) => ({ ...current, responsibleUserId: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not assigned</SelectItem>
                {recruiters.map((row: any) => <SelectItem key={row.userId} value={String(row.userId)}>{row.firstName} {row.lastName}{row.email ? ` · ${row.email}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Applicant Contact Phone"><Input value={form.applicantContactPhone} onChange={(event) => setForm((current: any) => ({ ...current, applicantContactPhone: event.target.value }))} /></Field>
          <Field label="Applicant Contact Email"><Input type="email" value={form.applicantContactEmail} onChange={(event) => setForm((current: any) => ({ ...current, applicantContactEmail: event.target.value }))} /></Field>
          <div className="md:col-span-2"><Toggle label="Active" checked={form.isActive} onChange={(value) => setForm((current: any) => ({ ...current, isActive: value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || !form.name.trim()}
            onClick={() => onSave({
              name: form.name.trim(),
              applicationCategory: form.applicationCategory,
              isActive: form.isActive,
              displayOrder: Number(form.displayOrder || 100),
              responsibleUserId: form.responsibleUserId === "none" ? null : Number(form.responsibleUserId),
              applicantContactPhone: form.applicantContactPhone || null,
              applicantContactEmail: form.applicantContactEmail || null,
            })}
          >
            {saving ? "Saving…" : "Save Department"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExaminationBoardDialog({ open, record, saving, onClose, onSave }: { open: boolean; record?: any; saving: boolean; onClose: () => void; onSave: (body: any) => void }) {
  const [form, setForm] = useState<any>({
    name: record?.name || "",
    isActive: record?.isActive ?? true,
    displayOrder: record?.displayOrder ?? 100,
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{record ? "Edit Examination Board" : "Add Examination Board"}</DialogTitle>
          <DialogDescription>Active boards are available to applicants and vacancies. Historical applications retain their recorded board if a board is later deactivated.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Board / Curriculum name"><Input value={form.name} onChange={(event) => setForm((current: any) => ({ ...current, name: event.target.value }))} placeholder="ZIMSEC" /></Field>
          <Field label="Display Order"><Input type="number" min="0" value={form.displayOrder} onChange={(event) => setForm((current: any) => ({ ...current, displayOrder: event.target.value }))} /></Field>
          <Toggle label="Active" checked={form.isActive} onChange={(value) => setForm((current: any) => ({ ...current, isActive: value }))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !form.name.trim() || form.name.trim().toLowerCase() === "both"} onClick={() => onSave({ name: form.name.trim(), isActive: form.isActive, displayOrder: Number(form.displayOrder || 100) })}>{saving ? "Saving…" : "Save Examination Board"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotificationConfigDialog({
  open,
  record,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  record: any;
  saving: boolean;
  onClose: () => void;
  onSave: (body: any) => void;
}) {
  const [form, setForm] = useState<any>({
    enabled: Boolean(record.enabled),
    channel: record.channel || "none",
    emailSubject: record.emailSubject || "",
    emailTemplate: record.emailTemplate || "",
    smsTemplate: record.smsTemplate || "",
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Application Notification</DialogTitle>
          <DialogDescription>{titleCase(record.eventKey)} · {titleCase(record.applicationVariant)} application</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Toggle label="Notification enabled" checked={form.enabled} onChange={(value) => setForm((current: any) => ({ ...current, enabled: value }))} />
          <Field label="Channel">
            <Select value={form.channel} onValueChange={(value) => setForm((current: any) => ({ ...current, channel: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="sms">SMS</SelectItem><SelectItem value="both">Both</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Email subject"><Input value={form.emailSubject} onChange={(event) => setForm((current: any) => ({ ...current, emailSubject: event.target.value }))} /></Field>
          <Field label="Email template" hint="Available variables include {applicantName}, {applicationCategory}, {departmentName}, {vacancyTitle}, {schoolName}, {status}, {recruiterName}, {recruiterPhone}, {recruiterEmail}, and interview fields where applicable.">
            <Textarea className="min-h-32" value={form.emailTemplate} onChange={(event) => setForm((current: any) => ({ ...current, emailTemplate: event.target.value }))} />
          </Field>
          <Field label="SMS template"><Textarea value={form.smsTemplate} onChange={(event) => setForm((current: any) => ({ ...current, smsTemplate: event.target.value }))} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={() => onSave({
              eventKey: record.eventKey,
              applicationVariant: record.applicationVariant,
              enabled: form.enabled,
              channel: form.channel,
              emailSubject: form.emailSubject || null,
              emailTemplate: form.emailTemplate || null,
              smsTemplate: form.smsTemplate || null,
            })}
          >
            {saving ? "Saving…" : "Save Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecruitmentSettings({
  data,
  canEdit,
  saving,
  onSaveGeneral,
  onAddDepartment,
  onEditDepartment,
  onAddExaminationBoard,
  onEditExaminationBoard,
  onEditNotification,
  onResend,
}: {
  data: any;
  canEdit: boolean;
  saving: boolean;
  onSaveGeneral: (body: any) => void;
  onAddDepartment: () => void;
  onEditDepartment: (record: any) => void;
  onAddExaminationBoard: () => void;
  onEditExaminationBoard: (record: any) => void;
  onEditNotification: (record: any) => void;
  onResend: (log: any) => void;
}) {
  const settings = data.settings;
  const [form, setForm] = useState<any>({
    publicApplicationsOpen: settings.publicApplicationsOpen,
    generalApplicationsOpen: settings.generalApplicationsOpen,
    attachmentSizeLimitMB: settings.attachmentSizeLimitMB,
    careersPageTitle: settings.careersPageTitle,
    careersPageMessage: settings.careersPageMessage,
    highSchoolMaxAge: settings.highSchoolMaxAge ?? 35,
    highSchoolMinimumALevelPoints: settings.highSchoolMinimumALevelPoints ?? 13,
    highSchoolTeachingQualifiedMinimumALevelPoints: settings.highSchoolTeachingQualifiedMinimumALevelPoints ?? 10,
    highSchoolTeachingQualificationExceptionEnabled: settings.highSchoolTeachingQualificationExceptionEnabled ?? true,
    primaryTeachingQualificationRequired: settings.primaryTeachingQualificationRequired ?? true,
    primaryMaximumOLevelSittings: settings.primaryMaximumOLevelSittings ?? 2,
    primaryMinimumOLevelSubjects: settings.primaryMinimumOLevelSubjects ?? 5,
    primaryMinimumOLevelGrade: settings.primaryMinimumOLevelGrade ?? "C",
    primaryMandatoryOLevelSubjects: normalizeSubjectList(settings.primaryMandatoryOLevelSubjects || ["Mathematics", "Science", "English"]),
    primaryMandatoryOLevelGrade: settings.primaryMandatoryOLevelGrade ?? "C",
  });
  const [primaryMandatorySubjectToAdd, setPrimaryMandatorySubjectToAdd] = useState("");

  useEffect(() => {
    setForm({
      publicApplicationsOpen: settings.publicApplicationsOpen,
      generalApplicationsOpen: settings.generalApplicationsOpen,
      attachmentSizeLimitMB: settings.attachmentSizeLimitMB,
      careersPageTitle: settings.careersPageTitle,
      careersPageMessage: settings.careersPageMessage,
      highSchoolMaxAge: settings.highSchoolMaxAge ?? 35,
      highSchoolMinimumALevelPoints: settings.highSchoolMinimumALevelPoints ?? 13,
      highSchoolTeachingQualifiedMinimumALevelPoints: settings.highSchoolTeachingQualifiedMinimumALevelPoints ?? 10,
      highSchoolTeachingQualificationExceptionEnabled: settings.highSchoolTeachingQualificationExceptionEnabled ?? true,
      primaryTeachingQualificationRequired: settings.primaryTeachingQualificationRequired ?? true,
      primaryMaximumOLevelSittings: settings.primaryMaximumOLevelSittings ?? 2,
      primaryMinimumOLevelSubjects: settings.primaryMinimumOLevelSubjects ?? 5,
      primaryMinimumOLevelGrade: settings.primaryMinimumOLevelGrade ?? "C",
      primaryMandatoryOLevelSubjects: normalizeSubjectList(settings.primaryMandatoryOLevelSubjects || ["Mathematics", "Science", "English"]),
      primaryMandatoryOLevelGrade: settings.primaryMandatoryOLevelGrade ?? "C",
    });
  }, [settings]);

  return (
    <Tabs defaultValue="general">
      <div className="overflow-x-auto">
        <TabsList className="w-max">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="examination-boards">Examination Boards</TabsTrigger>
          <TabsTrigger value="notifications">Application Notifications</TabsTrigger>
          <TabsTrigger value="delivery">Delivery Log</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="general" className="space-y-5">
        <Card>
          <CardHeader><CardTitle>Recruitment settings</CardTitle><CardDescription>Organization-wide public application controls.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Toggle label="Public applications open" checked={form.publicApplicationsOpen} onChange={(value) => setForm((current: any) => ({ ...current, publicApplicationsOpen: value }))} />
            <Toggle label="General applications open" checked={form.generalApplicationsOpen} onChange={(value) => setForm((current: any) => ({ ...current, generalApplicationsOpen: value }))} />
            <Field label="Attachment limit per file (MB)">
              <Select value={String(form.attachmentSizeLimitMB)} onValueChange={(value) => setForm((current: any) => ({ ...current, attachmentSizeLimitMB: Number(value) }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[5, 10, 15, 20, 25, 50].map((value) => <SelectItem key={value} value={String(value)}>{value} MB</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="md:col-span-2"><Field label="Careers page title"><Input value={form.careersPageTitle} onChange={(event) => setForm((current: any) => ({ ...current, careersPageTitle: event.target.value }))} /></Field></div>
            <div className="md:col-span-2"><Field label="Careers page message"><Textarea value={form.careersPageMessage} onChange={(event) => setForm((current: any) => ({ ...current, careersPageMessage: event.target.value }))} /></Field></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>High School Teaching eligibility policy</CardTitle><CardDescription>Existing screening policy remains authoritative.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Field label="Maximum age"><Input type="number" min="18" max="80" value={form.highSchoolMaxAge} onChange={(event) => setForm((current: any) => ({ ...current, highSchoolMaxAge: Number(event.target.value) }))} /></Field>
            <Field label="Standard minimum A-Level points"><Input type="number" min="0" max="30" value={form.highSchoolMinimumALevelPoints} onChange={(event) => setForm((current: any) => ({ ...current, highSchoolMinimumALevelPoints: Number(event.target.value) }))} /></Field>
            <Field label="Teaching-qualified minimum A-Level points"><Input type="number" min="0" max="30" value={form.highSchoolTeachingQualifiedMinimumALevelPoints} onChange={(event) => setForm((current: any) => ({ ...current, highSchoolTeachingQualifiedMinimumALevelPoints: Number(event.target.value) }))} /></Field>
            <div className="md:col-span-3">
              <Toggle label="Enable the teaching-qualification exception" checked={form.highSchoolTeachingQualificationExceptionEnabled} onChange={(value) => setForm((current: any) => ({ ...current, highSchoolTeachingQualificationExceptionEnabled: value }))} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Primary School Teaching eligibility policy</CardTitle>
            <CardDescription>Primary applications are screened automatically against these configurable O-Level and teaching-qualification requirements.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="md:col-span-2 lg:col-span-4">
              <Toggle
                label="Teaching qualification required"
                checked={form.primaryTeachingQualificationRequired}
                onChange={(value) => setForm((current: any) => ({ ...current, primaryTeachingQualificationRequired: value }))}
                description="When enabled, a Primary School Teaching applicant who does not declare a recognised teaching qualification is rejected."
              />
            </div>
            <Field label="Maximum O-Level sittings">
              <Input type="number" min="1" max="10" value={form.primaryMaximumOLevelSittings} onChange={(event) => setForm((current: any) => ({ ...current, primaryMaximumOLevelSittings: Number(event.target.value) }))} />
            </Field>
            <Field label="Minimum qualifying O-Level subjects">
              <Input type="number" min="1" max="20" value={form.primaryMinimumOLevelSubjects} onChange={(event) => setForm((current: any) => ({ ...current, primaryMinimumOLevelSubjects: Number(event.target.value) }))} />
            </Field>
            <Field label="Minimum grade for qualifying subjects">
              <Select value={form.primaryMinimumOLevelGrade} onValueChange={(value) => setForm((current: any) => ({ ...current, primaryMinimumOLevelGrade: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{O_LEVEL_GRADES.map((grade) => <SelectItem key={grade} value={grade}>{grade}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Minimum grade for mandatory subjects">
              <Select value={form.primaryMandatoryOLevelGrade} onValueChange={(value) => setForm((current: any) => ({ ...current, primaryMandatoryOLevelGrade: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{O_LEVEL_GRADES.map((grade) => <SelectItem key={grade} value={grade}>{grade}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="space-y-2 md:col-span-2 lg:col-span-4">
              <Label>Mandatory O-Level subjects</Label>
              <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border p-2">
                {(form.primaryMandatoryOLevelSubjects || []).map((subject: string) => (
                  <Badge key={subject} variant="secondary" className="gap-1">
                    {subject}
                    <button
                      type="button"
                      aria-label={`Remove ${subject}`}
                      onClick={() => setForm((current: any) => ({ ...current, primaryMandatoryOLevelSubjects: current.primaryMandatoryOLevelSubjects.filter((value: string) => value !== subject) }))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {!(form.primaryMandatoryOLevelSubjects || []).length && <span className="text-sm text-muted-foreground">Add at least one mandatory subject.</span>}
              </div>
              <div className="flex gap-2">
                <Input value={primaryMandatorySubjectToAdd} onChange={(event) => setPrimaryMandatorySubjectToAdd(event.target.value)} placeholder="e.g. Mathematics" />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!primaryMandatorySubjectToAdd.trim()}
                  onClick={() => {
                    setForm((current: any) => ({ ...current, primaryMandatoryOLevelSubjects: normalizeSubjectList([...(current.primaryMandatoryOLevelSubjects || []), primaryMandatorySubjectToAdd]) }));
                    setPrimaryMandatorySubjectToAdd("");
                  }}
                >
                  Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Defaults are Mathematics, Science and English. Applicants must meet the configured mandatory-subject grade in each.</p>
            </div>
            {canEdit && (
              <div className="md:col-span-2 lg:col-span-4">
                <Button
                  disabled={saving || !(form.primaryMandatoryOLevelSubjects || []).length}
                  onClick={() => onSaveGeneral({ ...form, primaryMandatoryOLevelSubjects: normalizeSubjectList(form.primaryMandatoryOLevelSubjects), generalApplicationCategories: RECRUITMENT_CATEGORIES.map((category) => category.label) })}
                >
                  Save Recruitment Settings
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="departments">
        <Card>
          <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
            <div><CardTitle>Departments</CardTitle><CardDescription>Recruitment Department configuration. Historical values remain intact when a department is deactivated.</CardDescription></div>
            {canEdit && <Button onClick={onAddDepartment}><Plus className="mr-2 h-4 w-4" />Add Department</Button>}
          </CardHeader>
          <CardContent>
            <DataTable heads={["Department", "Application Category", "Status", "Order", "Responsible HOD / Recruiter", "Applicant Contact", "Actions"]}>
              {(data.departments || []).map((department: any) => {
                const recruiter = (data.recruiters || []).find((row: any) => Number(row.userId) === Number(department.responsibleUserId));
                return (
                  <TableRow key={department.id}>
                    <TableCell className="font-medium">{normalizeRecruitmentDepartment(department.name)}</TableCell>
                    <TableCell>{department.applicationCategory}</TableCell>
                    <TableCell><StatusBadge value={department.isActive ? "active" : "archived"} /></TableCell>
                    <TableCell>{department.displayOrder}</TableCell>
                    <TableCell>{recruiter ? `${recruiter.firstName} ${recruiter.lastName}` : "—"}</TableCell>
                    <TableCell><div>{department.applicantContactPhone || "—"}</div><div className="text-xs text-muted-foreground">{department.applicantContactEmail || ""}</div></TableCell>
                    <TableCell>{canEdit && <Button size="sm" variant="outline" onClick={() => onEditDepartment(department)}>Edit</Button>}</TableCell>
                  </TableRow>
                );
              })}
            </DataTable>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="examination-boards">
        <Card>
          <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
            <div><CardTitle>Examination Boards / Curricula</CardTitle><CardDescription>Controls the teaching curricula available on new applications and vacancies. Applicants may select multiple active boards individually.</CardDescription></div>
            {canEdit && <Button onClick={onAddExaminationBoard}><Plus className="mr-2 h-4 w-4" />Add Examination Board</Button>}
          </CardHeader>
          <CardContent>
            <DataTable heads={["Board / Curriculum", "Status", "Order", "Actions"]}>
              {(data.examinationBoardConfigs || []).map((board: any) => (
                <TableRow key={board.id}>
                  <TableCell className="font-medium">{board.name}</TableCell>
                  <TableCell><StatusBadge value={board.isActive ? "active" : "archived"} /></TableCell>
                  <TableCell>{board.displayOrder}</TableCell>
                  <TableCell>{canEdit && <Button size="sm" variant="outline" onClick={() => onEditExaminationBoard(board)}>Edit</Button>}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="notifications">
        <Card>
          <CardHeader>
            <CardTitle>Application Notifications</CardTitle>
            <CardDescription>Configure Email, SMS or Both per applicant-facing status and interview event. General and vacancy application wording are separated.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable heads={["Event", "Application Type", "Enabled", "Channel", "Actions"]}>
              {(data.notificationConfigs || []).map((config: any) => (
                <TableRow key={config.id}>
                  <TableCell>{titleCase(config.eventKey)}</TableCell>
                  <TableCell>{titleCase(config.applicationVariant)}</TableCell>
                  <TableCell>{config.enabled ? "Yes" : "No"}</TableCell>
                  <TableCell>{titleCase(config.channel)}</TableCell>
                  <TableCell>{canEdit && <Button size="sm" variant="outline" onClick={() => onEditNotification(config)}>Edit template</Button>}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="delivery">
        <Card>
          <CardHeader><CardTitle>Notification Delivery Log</CardTitle><CardDescription>Failed delivery never reverses the Recruitment action. Failed attempts can be resent.</CardDescription></CardHeader>
          <CardContent>
            <DataTable heads={["When", "Event", "Channel", "Destination", "Status", "Error", "Action"]}>
              {(data.notificationLogs || []).map((log: any) => (
                <TableRow key={log.id}>
                  <TableCell>{new Date(log.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{titleCase(log.eventKey)}</TableCell>
                  <TableCell>{log.channel.toUpperCase()}</TableCell>
                  <TableCell>{log.destination || "—"}</TableCell>
                  <TableCell><StatusBadge value={log.status} /></TableCell>
                  <TableCell className="max-w-xs text-xs">{log.errorMessage || "—"}</TableCell>
                  <TableCell>{canEdit && log.status === "failed" && <Button size="sm" variant="outline" onClick={() => onResend(log)}>Resend</Button>}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function RequirementDialog({ open, record, data, saving, onClose, onSave }: any) {
  const [form, setForm] = useState<any>({
    vacancyId: record?.vacancyId ? String(record.vacancyId) : "none",
    employmentCategory: record?.employmentCategory || "all",
    code: record?.code || "",
    label: record?.label || "",
    helpText: record?.helpText || "",
    inputType: record?.inputType || "boolean",
    acceptedValuesText: Array.isArray(record?.acceptedValues) ? record.acceptedValues.join(", ") : "",
    minimumNumber: record?.minimumNumber ?? "",
    maximumNumber: record?.maximumNumber ?? "",
    isMandatory: Boolean(record?.isMandatory),
    autoRejectOnFail: Boolean(record?.autoRejectOnFail),
    displayOrder: record?.displayOrder ?? 100,
    isActive: record?.isActive ?? true,
  });
  const scopedToVacancy = form.vacancyId !== "none";
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{record ? "Edit Requirement" : "Add Requirement"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Vacancy scope">
            <Select value={form.vacancyId} onValueChange={(value) => setForm((current: any) => ({ ...current, vacancyId: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">General/category rule</SelectItem>{data.vacancies.map((vacancy: any) => <SelectItem key={vacancy.id} value={String(vacancy.id)}>{vacancy.code} · {vacancy.title}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {!scopedToVacancy && <Field label="Application Category">
            <Select value={form.employmentCategory} onValueChange={(value) => setForm((current: any) => ({ ...current, employmentCategory: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All applications</SelectItem>{RECRUITMENT_CATEGORIES.map((category) => <SelectItem key={category.code} value={category.label}>{category.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>}
          <Field label="Code"><Input value={form.code} onChange={(event) => setForm((current: any) => ({ ...current, code: event.target.value }))} /></Field>
          <Field label="Label"><Input value={form.label} onChange={(event) => setForm((current: any) => ({ ...current, label: event.target.value }))} /></Field>
          <Field label="Input Type"><Select value={form.inputType} onValueChange={(value) => setForm((current: any) => ({ ...current, inputType: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["boolean", "text", "number", "select"].map((value) => <SelectItem key={value} value={value}>{titleCase(value)}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Display Order"><Input type="number" min="0" value={form.displayOrder} onChange={(event) => setForm((current: any) => ({ ...current, displayOrder: event.target.value }))} /></Field>
          {form.inputType === "select" && <div className="md:col-span-2"><Field label="Accepted Values"><Input value={form.acceptedValuesText} onChange={(event) => setForm((current: any) => ({ ...current, acceptedValuesText: event.target.value }))} placeholder="Yes, No, Maybe" /></Field></div>}
          {form.inputType === "number" && <><Field label="Minimum"><Input type="number" value={form.minimumNumber} onChange={(event) => setForm((current: any) => ({ ...current, minimumNumber: event.target.value }))} /></Field><Field label="Maximum"><Input type="number" value={form.maximumNumber} onChange={(event) => setForm((current: any) => ({ ...current, maximumNumber: event.target.value }))} /></Field></>}
          <div className="md:col-span-2"><Field label="Help Text"><Textarea value={form.helpText} onChange={(event) => setForm((current: any) => ({ ...current, helpText: event.target.value }))} /></Field></div>
          <Toggle label="Mandatory" checked={form.isMandatory} onChange={(value) => setForm((current: any) => ({ ...current, isMandatory: value }))} />
          <Toggle label="Auto reject on fail" checked={form.autoRejectOnFail} onChange={(value) => setForm((current: any) => ({ ...current, autoRejectOnFail: value }))} />
          <div className="md:col-span-2"><Toggle label="Active" checked={form.isActive} onChange={(value) => setForm((current: any) => ({ ...current, isActive: value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !form.code.trim() || !form.label.trim()} onClick={() => onSave({
            vacancyId: form.vacancyId === "none" ? null : Number(form.vacancyId),
            employmentCategory: form.vacancyId === "none" && form.employmentCategory !== "all" ? form.employmentCategory : null,
            code: form.code,
            label: form.label,
            helpText: form.helpText || null,
            inputType: form.inputType,
            acceptedValues: form.inputType === "select" ? splitSubjects(form.acceptedValuesText) : [],
            minimumNumber: form.minimumNumber === "" ? null : Number(form.minimumNumber),
            maximumNumber: form.maximumNumber === "" ? null : Number(form.maximumNumber),
            isMandatory: form.isMandatory,
            autoRejectOnFail: form.autoRejectOnFail,
            alternativePassKeywords: [],
            alternativePassNote: null,
            displayOrder: Number(form.displayOrder || 100),
            isActive: form.isActive,
          })}>Save Requirement</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentCategoryDialog({ open, record, data, saving, onClose, onSave }: any) {
  const [form, setForm] = useState<any>({
    vacancyId: record?.vacancyId ? String(record.vacancyId) : "none",
    employmentCategory: record?.employmentCategory || "all",
    code: record?.code || "",
    label: record?.label || "",
    isRequired: Boolean(record?.isRequired),
    allowsMultiple: Boolean(record?.allowsMultiple),
    displayOrder: record?.displayOrder ?? 100,
    isActive: record?.isActive ?? true,
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{record ? "Edit Document Category" : "Add Document Category"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Vacancy scope">
            <Select value={form.vacancyId} onValueChange={(value) => setForm((current: any) => ({ ...current, vacancyId: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">General/category rule</SelectItem>{data.vacancies.map((vacancy: any) => <SelectItem key={vacancy.id} value={String(vacancy.id)}>{vacancy.code} · {vacancy.title}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {form.vacancyId === "none" && <Field label="Application Category">
            <Select value={form.employmentCategory} onValueChange={(value) => setForm((current: any) => ({ ...current, employmentCategory: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All applications</SelectItem>{RECRUITMENT_CATEGORIES.map((category) => <SelectItem key={category.code} value={category.label}>{category.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>}
          <Field label="Code"><Input value={form.code} onChange={(event) => setForm((current: any) => ({ ...current, code: event.target.value }))} /></Field>
          <Field label="Label"><Input value={form.label} onChange={(event) => setForm((current: any) => ({ ...current, label: event.target.value }))} /></Field>
          <Field label="Display Order"><Input type="number" min="0" value={form.displayOrder} onChange={(event) => setForm((current: any) => ({ ...current, displayOrder: event.target.value }))} /></Field>
          <Toggle label="Requested" checked={form.isRequired} onChange={(value) => setForm((current: any) => ({ ...current, isRequired: value }))} description="Requested documents do not block submission." />
          <Toggle label="Allow multiple files" checked={form.allowsMultiple} onChange={(value) => setForm((current: any) => ({ ...current, allowsMultiple: value }))} />
          <Toggle label="Active" checked={form.isActive} onChange={(value) => setForm((current: any) => ({ ...current, isActive: value }))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !form.code.trim() || !form.label.trim()} onClick={() => onSave({
            vacancyId: form.vacancyId === "none" ? null : Number(form.vacancyId),
            employmentCategory: form.vacancyId === "none" && form.employmentCategory !== "all" ? form.employmentCategory : null,
            code: form.code,
            label: form.label,
            isRequired: form.isRequired,
            allowsMultiple: form.allowsMultiple,
            displayOrder: Number(form.displayOrder || 100),
            isActive: form.isActive,
          })}>Save Document Category</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
