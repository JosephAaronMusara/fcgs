import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, CalendarClock, CheckCircle2, FileText, Plus, Search, Settings2, ShieldAlert, Users } from "lucide-react";
import { apiRequest, queryClient, schoolFetch } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type DialogState = { type: "vacancy" | "requirement" | "category" | "application" | "interview"; record?: any } | null;

const titleCase = (value: unknown) => String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const toLocalInput = (value: unknown) => value ? new Date(String(value)).toISOString().slice(0, 16) : "";

export default function RecruitmentPage() {
  const { hasAnyPermission } = useAuth();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [search, setSearch] = useState("");
  const [applicationStatus, setApplicationStatus] = useState("all");

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/recruitment/bootstrap"],
    queryFn: async () => {
      const response = await schoolFetch("/api/recruitment/bootstrap");
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || "Unable to load recruitment workspace");
      return body;
    },
  });

  const save = useMutation({
    mutationFn: async ({ method, url, body }: { method: string; url: string; body: unknown }) => {
      const response = await apiRequest(method, url, body);
      return response.status === 204 ? null : response.json();
    },
    onSuccess: async () => {
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/recruitment/bootstrap"] });
      toast({ title: "Recruitment record saved" });
    },
    onError: (mutationError: any) => toast({ title: "Recruitment action failed", description: mutationError?.message || "Unable to save record", variant: "destructive" }),
  });

  const applications = useMemo(() => (data?.applications || []).filter((application: any) => {
    const matchesStatus = applicationStatus === "all" || application.status === applicationStatus;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${application.firstName} ${application.lastName} ${application.email} ${application.phone} ${application.nationalId} ${application.vacancy?.title || ""}`.toLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  }), [applicationStatus, data?.applications, search]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading recruitment workspace…</div>;
  if (error || !data) return <div className="p-8 text-destructive">{error instanceof Error ? error.message : "Unable to load recruitment workspace."}</div>;

  const canVacancies = hasAnyPermission("recruitment.vacancies.manage");
  const canRequirements = hasAnyPermission("recruitment.requirements.manage");
  const canProcess = hasAnyPermission("recruitment.applications.process");
  const canInterviews = hasAnyPermission("recruitment.interviews.manage");
  const canSettings = hasAnyPermission("recruitment.settings.manage");

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div><h1 className="flex items-center gap-2 text-2xl font-bold"><BriefcaseBusiness className="h-6 w-6" />Recruitment</h1><p className="text-muted-foreground">Vacancies, general applications, screening, interviews and hiring workflow.</p></div>
        <Button variant="outline" onClick={() => window.open("/careers", "_blank", "noopener")}>Open public Careers page</Button>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-5">
        <div className="overflow-x-auto"><TabsList className="w-max"><TabsTrigger value="dashboard">Dashboard</TabsTrigger><TabsTrigger value="vacancies">Vacancies</TabsTrigger><TabsTrigger value="applications">Applications</TabsTrigger><TabsTrigger value="requirements">Requirements</TabsTrigger><TabsTrigger value="rejected">Rejected Attempts</TabsTrigger><TabsTrigger value="settings">Settings</TabsTrigger></TabsList></div>

        <TabsContent value="dashboard"><DashboardCards dashboard={data.dashboard} /></TabsContent>

        <TabsContent value="vacancies"><Card><CardHeader className="gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle>Vacancies</CardTitle><CardDescription>Publish, close and archive organization or school vacancies.</CardDescription></div>{canVacancies && <Button onClick={() => setDialog({ type: "vacancy" })}><Plus className="mr-2 h-4 w-4" />Add vacancy</Button>}</CardHeader><CardContent><DataTable heads={["Code", "Vacancy", "Category", "School", "Status", "Dates", "Actions"]}>{data.vacancies.map((vacancy: any) => <TableRow key={vacancy.id}><TableCell className="font-medium">{vacancy.code}</TableCell><TableCell><div className="font-medium">{vacancy.title}</div><div className="max-w-xs truncate text-xs text-muted-foreground">{vacancy.description}</div></TableCell><TableCell>{vacancy.employmentCategory}</TableCell><TableCell>{data.schools.find((school: any) => school.id === vacancy.schoolId)?.name || "Any school / HQ"}</TableCell><TableCell><StatusBadge value={vacancy.status} /></TableCell><TableCell className="text-xs">{vacancy.opensAt ? new Date(vacancy.opensAt).toLocaleDateString() : "Immediately"} – {vacancy.closesAt ? new Date(vacancy.closesAt).toLocaleDateString() : "Open-ended"}</TableCell><TableCell>{canVacancies && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "vacancy", record: vacancy })}>Edit</Button>}</TableCell></TableRow>)}</DataTable></CardContent></Card></TabsContent>

        <TabsContent value="applications" className="space-y-4">
          <Card><CardHeader><CardTitle>Applications</CardTitle><CardDescription>Normal submitted applications only. Duplicate and failed-criteria attempts are kept separately.</CardDescription></CardHeader><CardContent><div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px]"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search applicant, vacancy, email or National ID" /></div><Select value={applicationStatus} onValueChange={setApplicationStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["all", "submitted", "under_review", "shortlisted", "interview", "rejected", "hired", "withdrawn"].map((status) => <SelectItem key={status} value={status}>{titleCase(status)}</SelectItem>)}</SelectContent></Select></div><DataTable heads={["Applicant", "Application", "Contact", "Submitted", "Status", "Documents", "Actions"]}>{applications.map((application: any) => <TableRow key={application.id}><TableCell><div className="font-medium">{application.firstName} {application.lastName}</div><div className="text-xs text-muted-foreground">{application.nationalId}</div></TableCell><TableCell><div>{application.vacancy?.title || "General application"}</div><Badge variant="outline">{application.employmentCategory}</Badge></TableCell><TableCell className="text-sm"><div>{application.email}</div><div>{application.phone}</div></TableCell><TableCell>{new Date(application.submittedAt).toLocaleString()}</TableCell><TableCell><StatusBadge value={application.status} /></TableCell><TableCell>{application.documents?.length || 0}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setDialog({ type: "application", record: application })}>View details</Button></TableCell></TableRow>)}</DataTable></CardContent></Card>
        </TabsContent>

        <TabsContent value="requirements" className="space-y-5">
          <Card><CardHeader className="gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle>Screening requirements</CardTitle><CardDescription>Mandatory auto-reject rules stop failed applications before they enter the submitted list.</CardDescription></div>{canRequirements && <Button onClick={() => setDialog({ type: "requirement" })}><Plus className="mr-2 h-4 w-4" />Add requirement</Button>}</CardHeader><CardContent><DataTable heads={["Scope", "Requirement", "Input", "Mandatory", "Auto reject", "Alternative rule", "Status", "Actions"]}>{data.requirements.map((requirement: any) => <TableRow key={requirement.id}><TableCell>{requirement.vacancyId ? data.vacancies.find((vacancy: any) => vacancy.id === requirement.vacancyId)?.title : requirement.employmentCategory || "All applications"}</TableCell><TableCell><div className="font-medium">{requirement.label}</div><code className="text-xs">{requirement.code}</code></TableCell><TableCell>{titleCase(requirement.inputType)}</TableCell><TableCell>{requirement.isMandatory ? "Yes" : "No"}</TableCell><TableCell>{requirement.autoRejectOnFail ? "Yes" : "No"}</TableCell><TableCell>{Array.isArray(requirement.alternativePassKeywords) && requirement.alternativePassKeywords.length > 0 ? "Configured" : "None"}</TableCell><TableCell><StatusBadge value={requirement.isActive ? "active" : "inactive"} /></TableCell><TableCell>{canRequirements && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "requirement", record: requirement })}>Edit</Button>}</TableCell></TableRow>)}</DataTable></CardContent></Card>
          <Card><CardHeader className="gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle>Applicant document categories</CardTitle><CardDescription>Specific categories make missing documents visible during application and review.</CardDescription></div>{canRequirements && <Button onClick={() => setDialog({ type: "category" })}><Plus className="mr-2 h-4 w-4" />Add category</Button>}</CardHeader><CardContent><DataTable heads={["Scope", "Category", "Required", "Multiple", "Status", "Actions"]}>{data.documentCategories.map((category: any) => <TableRow key={category.id}><TableCell>{category.vacancyId ? data.vacancies.find((vacancy: any) => vacancy.id === category.vacancyId)?.title : category.employmentCategory || "All applications"}</TableCell><TableCell><div className="font-medium">{category.label}</div><code className="text-xs">{category.code}</code></TableCell><TableCell>{category.isRequired ? "Yes" : "No"}</TableCell><TableCell>{category.allowsMultiple ? "Yes" : "No"}</TableCell><TableCell><StatusBadge value={category.isActive ? "active" : "inactive"} /></TableCell><TableCell>{canRequirements && <Button size="sm" variant="outline" onClick={() => setDialog({ type: "category", record: category })}>Edit</Button>}</TableCell></TableRow>)}</DataTable></CardContent></Card>
        </TabsContent>

        <TabsContent value="rejected"><Card><CardHeader><CardTitle>Rejected attempts</CardTitle><CardDescription>Internal audit of duplicate attempts and failed mandatory criteria. These are not normal submitted applications.</CardDescription></CardHeader><CardContent><DataTable heads={["Applicant", "Category", "Reason", "Failed checks", "Attempted"]}>{data.rejectionAttempts.map((attempt: any) => <TableRow key={attempt.id}><TableCell><div className="font-medium">{attempt.firstName || "—"} {attempt.lastName || ""}</div><div className="text-xs text-muted-foreground">{attempt.normalizedEmail || attempt.normalizedPhone || attempt.normalizedNationalId || "Identifiers unavailable"}</div></TableCell><TableCell>{attempt.employmentCategory}</TableCell><TableCell><StatusBadge value={attempt.reasonCode} /></TableCell><TableCell className="max-w-sm text-xs">{Array.isArray(attempt.failedRequirementCodes) ? attempt.failedRequirementCodes.join(", ") || "—" : "—"}</TableCell><TableCell>{new Date(attempt.attemptedAt).toLocaleString()}</TableCell></TableRow>)}</DataTable></CardContent></Card></TabsContent>

        <TabsContent value="settings"><RecruitmentSettings settings={data.settings} canEdit={canSettings} onSave={(body) => save.mutate({ method: "PUT", url: "/api/recruitment/settings", body })} saving={save.isPending} /></TabsContent>
      </Tabs>

      {dialog && <RecruitmentDialog state={dialog} data={data} canProcess={canProcess} canInterviews={canInterviews} saving={save.isPending} onClose={() => setDialog(null)} onSave={(method, url, body) => save.mutate({ method, url, body })} onInterview={(application) => setDialog({ type: "interview", record: application })} />}
    </div>
  );
}

function DashboardCards({ dashboard }: { dashboard: any }) {
  const cards = [
    ["Open vacancies", dashboard.openVacancies, BriefcaseBusiness],
    ["Submitted", dashboard.submitted, FileText],
    ["Under review", dashboard.underReview, Search],
    ["Shortlisted", dashboard.shortlisted, Users],
    ["Upcoming interviews", dashboard.interviews, CalendarClock],
    ["Hired", dashboard.hired, CheckCircle2],
    ["Rejected attempts", dashboard.rejectedAttempts, ShieldAlert],
  ] as const;
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon]) => <Card key={label}><CardContent className="flex items-center justify-between p-5"><div><div className="text-sm text-muted-foreground">{label}</div><div className="text-3xl font-bold">{value}</div></div><Icon className="h-8 w-8 text-muted-foreground" /></CardContent></Card>)}</div>;
}

function RecruitmentDialog({ state, data, canProcess, canInterviews, saving, onClose, onSave, onInterview }: any) {
  const record = state.record || {};
  const [form, setForm] = useState<any>(() => {
    if (state.type === "vacancy") return { schoolId: record.schoolId ? String(record.schoolId) : "none", code: record.code || "", title: record.title || "", employmentCategory: record.employmentCategory || "", description: record.description || "", locationText: record.locationText || "", positionsAvailable: record.positionsAvailable || 1, status: record.status || "draft", opensAt: toLocalInput(record.opensAt), closesAt: toLocalInput(record.closesAt) };
    if (state.type === "requirement") return { vacancyId: record.vacancyId ? String(record.vacancyId) : "none", employmentCategory: record.employmentCategory || "", code: record.code || "", label: record.label || "", helpText: record.helpText || "", inputType: record.inputType || "boolean", acceptedValuesText: Array.isArray(record.acceptedValues) ? record.acceptedValues.join(", ") : "", minimumNumber: record.minimumNumber ?? "", maximumNumber: record.maximumNumber ?? "", isMandatory: Boolean(record.isMandatory), autoRejectOnFail: Boolean(record.autoRejectOnFail), alternativePassKeywordsText: Array.isArray(record.alternativePassKeywords) ? record.alternativePassKeywords.join(", ") : "", alternativePassNote: record.alternativePassNote || "", displayOrder: record.displayOrder || 100, isActive: record.isActive ?? true };
    if (state.type === "category") return { vacancyId: record.vacancyId ? String(record.vacancyId) : "none", employmentCategory: record.employmentCategory || "", code: record.code || "", label: record.label || "", isRequired: Boolean(record.isRequired), allowsMultiple: Boolean(record.allowsMultiple), displayOrder: record.displayOrder || 100, isActive: record.isActive ?? true };
    if (state.type === "application") return { status: record.status || "submitted", recruiterNotes: record.recruiterNotes || "" };
    return { scheduledAt: "", location: "", interviewType: "in_person", notes: "" };
  });
  const set = (key: string, value: unknown) => setForm((current: any) => ({ ...current, [key]: value }));
  const submit = () => {
    if (state.type === "vacancy") onSave(record.id ? "PUT" : "POST", record.id ? `/api/recruitment/vacancies/${record.id}` : "/api/recruitment/vacancies", { ...form, schoolId: form.schoolId === "none" ? null : Number(form.schoolId), positionsAvailable: Number(form.positionsAvailable), opensAt: form.opensAt ? new Date(form.opensAt).toISOString() : null, closesAt: form.closesAt ? new Date(form.closesAt).toISOString() : null });
    if (state.type === "requirement") onSave(record.id ? "PUT" : "POST", record.id ? `/api/recruitment/requirements/${record.id}` : "/api/recruitment/requirements", { ...form, vacancyId: form.vacancyId === "none" ? null : Number(form.vacancyId), employmentCategory: form.vacancyId === "none" ? form.employmentCategory || null : null, acceptedValues: form.acceptedValuesText.split(",").map((item: string) => item.trim()).filter(Boolean), alternativePassKeywords: form.alternativePassKeywordsText.split(",").map((item: string) => item.trim()).filter(Boolean), alternativePassNote: form.alternativePassNote || null, minimumNumber: form.minimumNumber === "" ? null : Number(form.minimumNumber), maximumNumber: form.maximumNumber === "" ? null : Number(form.maximumNumber) });
    if (state.type === "category") onSave(record.id ? "PUT" : "POST", record.id ? `/api/recruitment/document-categories/${record.id}` : "/api/recruitment/document-categories", { ...form, vacancyId: form.vacancyId === "none" ? null : Number(form.vacancyId), employmentCategory: form.vacancyId === "none" ? form.employmentCategory || null : null });
    if (state.type === "application") onSave("PUT", `/api/recruitment/applications/${record.id}`, form);
    if (state.type === "interview") onSave("POST", `/api/recruitment/applications/${record.id}/interviews`, { ...form, scheduledAt: new Date(form.scheduledAt).toISOString(), panelUserIds: [] });
  };
  const title = state.type === "vacancy" ? `${record.id ? "Edit" : "Add"} vacancy` : state.type === "requirement" ? `${record.id ? "Edit" : "Add"} requirement` : state.type === "category" ? `${record.id ? "Edit" : "Add"} document category` : state.type === "application" ? `${record.firstName} ${record.lastName}` : `Schedule interview: ${record.firstName} ${record.lastName}`;
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{state.type === "application" ? "Review the complete application, screening result, documents and history." : "Recruitment settings are organization-scoped and audited through status history."}</DialogDescription></DialogHeader>
    {state.type === "vacancy" && <div className="grid gap-4 md:grid-cols-2"><Field label="Vacancy code"><Input value={form.code} onChange={(event) => set("code", event.target.value.toUpperCase())} /></Field><Field label="Title"><Input value={form.title} onChange={(event) => set("title", event.target.value)} /></Field><Field label="Employment category"><Input value={form.employmentCategory} onChange={(event) => set("employmentCategory", event.target.value)} /></Field><Field label="School"><Select value={form.schoolId} onValueChange={(value) => set("schoolId", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Any school / HQ</SelectItem>{data.schools.map((school: any) => <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Positions available"><Input type="number" min="1" value={form.positionsAvailable} onChange={(event) => set("positionsAvailable", event.target.value)} /></Field><Field label="Location"><Input value={form.locationText} onChange={(event) => set("locationText", event.target.value)} /></Field><Field label="Opens at"><Input type="datetime-local" value={form.opensAt} onChange={(event) => set("opensAt", event.target.value)} /></Field><Field label="Closes at"><Input type="datetime-local" value={form.closesAt} onChange={(event) => set("closesAt", event.target.value)} /></Field><Field label="Status"><Select value={form.status} onValueChange={(value) => set("status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["draft", "published", "closed", "archived"].map((status) => <SelectItem key={status} value={status}>{titleCase(status)}</SelectItem>)}</SelectContent></Select></Field><div className="md:col-span-2"><Field label="Description"><Textarea className="min-h-36" value={form.description} onChange={(event) => set("description", event.target.value)} /></Field></div></div>}
    {state.type === "requirement" && <div className="grid gap-4 md:grid-cols-2"><ScopeFields form={form} set={set} data={data} /><Field label="Code"><Input value={form.code} onChange={(event) => set("code", event.target.value)} /></Field><Field label="Label"><Input value={form.label} onChange={(event) => set("label", event.target.value)} /></Field><Field label="Input type"><Select value={form.inputType} onValueChange={(value) => set("inputType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["boolean", "text", "number", "select"].map((type) => <SelectItem key={type} value={type}>{titleCase(type)}</SelectItem>)}</SelectContent></Select></Field><Field label="Accepted values (comma separated)"><Input value={form.acceptedValuesText} onChange={(event) => set("acceptedValuesText", event.target.value)} /></Field><Field label="Minimum number"><Input type="number" value={form.minimumNumber} onChange={(event) => set("minimumNumber", event.target.value)} /></Field><Field label="Maximum number"><Input type="number" value={form.maximumNumber} onChange={(event) => set("maximumNumber", event.target.value)} /></Field><div className="md:col-span-2"><Field label="Alternative qualification keywords (comma separated)"><Input value={form.alternativePassKeywordsText} onChange={(event) => set("alternativePassKeywordsText", event.target.value)} placeholder="Example: Bachelor of Education, B.Ed" /></Field><p className="mt-1 text-xs text-muted-foreground">Hidden from applicants. When the normal rule fails, a match in the applicant's qualifications can satisfy this requirement.</p></div><div className="md:col-span-2"><Field label="Internal alternative-pass note"><Input value={form.alternativePassNote} onChange={(event) => set("alternativePassNote", event.target.value)} placeholder="Example: Equivalent teaching qualification accepted." /></Field></div><div className="md:col-span-2"><Field label="Help text"><Textarea value={form.helpText} onChange={(event) => set("helpText", event.target.value)} /></Field></div><Toggle label="Mandatory" checked={form.isMandatory} onChange={(value) => set("isMandatory", value)} /><Toggle label="Automatically reject when failed" checked={form.autoRejectOnFail} onChange={(value) => set("autoRejectOnFail", value)} /><Toggle label="Active" checked={form.isActive} onChange={(value) => set("isActive", value)} /></div>}
    {state.type === "category" && <div className="grid gap-4 md:grid-cols-2"><ScopeFields form={form} set={set} data={data} /><Field label="Code"><Input value={form.code} onChange={(event) => set("code", event.target.value)} /></Field><Field label="Label"><Input value={form.label} onChange={(event) => set("label", event.target.value)} /></Field><Toggle label="Required" checked={form.isRequired} onChange={(value) => set("isRequired", value)} /><Toggle label="Allow multiple files" checked={form.allowsMultiple} onChange={(value) => set("allowsMultiple", value)} /><Toggle label="Active" checked={form.isActive} onChange={(value) => set("isActive", value)} /></div>}
    {state.type === "application" && <ApplicationDetail application={record} data={data} form={form} set={set} canProcess={canProcess} canInterviews={canInterviews} onInterview={() => onInterview(record)} />}
    {state.type === "interview" && <div className="grid gap-4 md:grid-cols-2"><Field label="Scheduled date/time"><Input type="datetime-local" value={form.scheduledAt} onChange={(event) => set("scheduledAt", event.target.value)} /></Field><Field label="Interview type"><Select value={form.interviewType} onValueChange={(value) => set("interviewType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="in_person">In person</SelectItem><SelectItem value="online">Online</SelectItem><SelectItem value="phone">Phone</SelectItem></SelectContent></Select></Field><Field label="Location / meeting link"><Input value={form.location} onChange={(event) => set("location", event.target.value)} /></Field><div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes} onChange={(event) => set("notes", event.target.value)} /></Field></div></div>}
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>{state.type !== "application" || canProcess ? <Button disabled={saving || (state.type === "interview" && !form.scheduledAt)} onClick={submit}>{saving ? "Saving…" : state.type === "application" ? "Save review" : "Save"}</Button> : null}</DialogFooter>
  </DialogContent></Dialog>;
}

function ScopeFields({ form, set, data }: any) { return <><Field label="Vacancy scope"><Select value={form.vacancyId} onValueChange={(value) => set("vacancyId", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">General/category rule</SelectItem>{data.vacancies.map((vacancy: any) => <SelectItem key={vacancy.id} value={String(vacancy.id)}>{vacancy.code} · {vacancy.title}</SelectItem>)}</SelectContent></Select></Field>{form.vacancyId === "none" && <Field label="Employment category (blank = all)"><Input value={form.employmentCategory} onChange={(event) => set("employmentCategory", event.target.value)} /></Field>}</>; }

function ApplicationDetail({ application, data, form, set, canProcess, canInterviews, onInterview }: any) {
  return <div className="space-y-5"><div className="grid gap-3 rounded-md border p-4 md:grid-cols-3"><Info label="Application" value={application.vacancy?.title || "General application"} /><Info label="Category" value={application.employmentCategory} /><Info label="Status" value={titleCase(application.status)} /><Info label="Email" value={application.email} /><Info label="Phone" value={application.phone} /><Info label="National ID" value={application.nationalId} /><Info label="Experience" value={`${Number(application.yearsExperience || 0)} year(s)`} /><Info label="Current employer" value={application.currentEmployer || "—"} /><Info label="Preferred schools" value={(application.preferredSchoolIds || []).map((id: number) => data.schools.find((school: any) => school.id === id)?.name).filter(Boolean).join(", ") || "Any / not specified"} /></div><section><h3 className="mb-2 font-semibold">Qualifications</h3><div className="whitespace-pre-wrap rounded-md border p-3 text-sm">{application.qualifications || "—"}</div></section><section><h3 className="mb-2 font-semibold">Cover letter</h3><div className="whitespace-pre-wrap rounded-md border p-3 text-sm">{application.coverLetter || "—"}</div></section><section><h3 className="mb-2 font-semibold">Screening answers</h3><DataTable heads={["Requirement", "Answer", "Result"]}>{application.answers.map((answer: any) => { const requirement = data.requirements.find((row: any) => row.id === answer.requirementId); return <TableRow key={answer.id}><TableCell>{requirement?.label || `Requirement ${answer.requirementId}`}</TableCell><TableCell>{JSON.stringify(answer.answerValue)}</TableCell><TableCell><div className="space-y-1"><StatusBadge value={answer.alternativeAccepted ? "alternative_accepted" : answer.passed ? "passed" : "failed"} />{answer.evaluationNote && <div className="max-w-xs text-xs text-muted-foreground">{answer.evaluationNote}</div>}</div></TableCell></TableRow>; })}</DataTable></section><section><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Documents</h3></div><div className="grid gap-2 sm:grid-cols-2">{application.documents.length ? application.documents.map((document: any) => <a key={document.id} className="rounded-md border p-3 text-sm hover:bg-muted" href={`/api/recruitment/documents/${document.id}`} target="_blank" rel="noreferrer"><div className="font-medium">{data.documentCategories.find((category: any) => category.code === document.categoryCode)?.label || titleCase(document.categoryCode)}</div><div className="truncate text-muted-foreground">{document.originalName}</div></a>) : <p className="text-sm text-muted-foreground">No documents uploaded.</p>}</div></section><section><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Interviews</h3>{canInterviews && <Button size="sm" variant="outline" onClick={onInterview}><CalendarClock className="mr-2 h-4 w-4" />Schedule interview</Button>}</div><div className="space-y-2">{application.interviews.length ? application.interviews.map((interview: any) => <div key={interview.id} className="rounded-md border p-3 text-sm"><div className="font-medium">{new Date(interview.scheduledAt).toLocaleString()} · {titleCase(interview.interviewType)}</div><div className="text-muted-foreground">{interview.location || "Location not specified"}</div></div>) : <p className="text-sm text-muted-foreground">No interviews scheduled.</p>}</div></section>{canProcess && <section className="grid gap-4 md:grid-cols-2"><Field label="Application status"><Select value={form.status} onValueChange={(value) => set("status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["submitted", "under_review", "shortlisted", "interview", "rejected", "hired", "withdrawn"].map((status) => <SelectItem key={status} value={status}>{titleCase(status)}</SelectItem>)}</SelectContent></Select></Field><div className="md:col-span-2"><Field label="Recruiter notes"><Textarea className="min-h-28" value={form.recruiterNotes} onChange={(event) => set("recruiterNotes", event.target.value)} /></Field></div></section>}</div>;
}

function RecruitmentSettings({ settings, canEdit, onSave, saving }: any) {
  const toCategoryText = (values: unknown) => Array.isArray(values) ? values.map(String).join("\n") : "";
  const [form, setForm] = useState({
    publicApplicationsOpen: settings.publicApplicationsOpen,
    generalApplicationsOpen: settings.generalApplicationsOpen,
    attachmentSizeLimitMB: settings.attachmentSizeLimitMB,
    careersPageTitle: settings.careersPageTitle,
    careersPageMessage: settings.careersPageMessage,
    generalApplicationCategoriesText: toCategoryText(settings.generalApplicationCategories),
  });

  useEffect(() => {
    setForm({
      publicApplicationsOpen: settings.publicApplicationsOpen,
      generalApplicationsOpen: settings.generalApplicationsOpen,
      attachmentSizeLimitMB: settings.attachmentSizeLimitMB,
      careersPageTitle: settings.careersPageTitle,
      careersPageMessage: settings.careersPageMessage,
      generalApplicationCategoriesText: toCategoryText(settings.generalApplicationCategories),
    });
  }, [settings]);

  const saveSettings = () => {
    const generalApplicationCategories = Array.from(new Set(
      form.generalApplicationCategoriesText
        .split(/\r?\n|,/)
        .map((value: string) => value.trim())
        .filter(Boolean),
    ));
    onSave({ ...form, generalApplicationCategories, generalApplicationCategoriesText: undefined });
  };

  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5" />Recruitment settings</CardTitle><CardDescription>Organization-wide public application, category and attachment controls.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><Toggle label="Public applications open" checked={form.publicApplicationsOpen} onChange={(value) => setForm((current) => ({ ...current, publicApplicationsOpen: value }))} /><Toggle label="General applications open" checked={form.generalApplicationsOpen} onChange={(value) => setForm((current) => ({ ...current, generalApplicationsOpen: value }))} /><Field label="Attachment limit per file (MB)"><Select value={String(form.attachmentSizeLimitMB)} onValueChange={(value) => setForm((current) => ({ ...current, attachmentSizeLimitMB: Number(value) }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[5, 10, 15, 20, 25, 50].map((value) => <SelectItem key={value} value={String(value)}>{value} MB</SelectItem>)}</SelectContent></Select></Field><div className="md:col-span-2"><Field label="General application employment categories"><Textarea className="min-h-40" value={form.generalApplicationCategoriesText} onChange={(event) => setForm((current) => ({ ...current, generalApplicationCategoriesText: event.target.value }))} placeholder="One category per line" /></Field><p className="mt-1 text-xs text-muted-foreground">These categories remain available even when there are no advertised vacancies.</p></div><div className="md:col-span-2"><Field label="Careers page title"><Input value={form.careersPageTitle} onChange={(event) => setForm((current) => ({ ...current, careersPageTitle: event.target.value }))} /></Field></div><div className="md:col-span-2"><Field label="Careers page message"><Textarea value={form.careersPageMessage} onChange={(event) => setForm((current) => ({ ...current, careersPageMessage: event.target.value }))} /></Field></div>{canEdit && <div className="md:col-span-2"><Button disabled={saving || !form.generalApplicationCategoriesText.trim()} onClick={saveSettings}>{saving ? "Saving…" : "Save recruitment settings"}</Button></div>}</CardContent></Card>;
}

function DataTable({ heads, children }: { heads: string[]; children: React.ReactNode }) { return <div className="overflow-x-auto"><Table><TableHeader><TableRow>{heads.map((head) => <TableHead key={head} className="whitespace-nowrap">{head}</TableHead>)}</TableRow></TableHeader><TableBody>{children}</TableBody></Table></div>; }
function StatusBadge({ value }: { value: unknown }) { const status = String(value || "unknown"); const variant = ["rejected", "failed", "duplicate", "criteria_failed", "closed", "archived"].includes(status) ? "destructive" : ["published", "hired", "passed", "active", "alternative_accepted"].includes(status) ? "default" : "secondary"; return <Badge variant={variant as "default" | "secondary" | "destructive"}>{titleCase(status)}</Badge>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex items-center gap-3 rounded-md border p-3"><Checkbox checked={checked} onCheckedChange={(value) => onChange(Boolean(value))} /><span>{label}</span></label>; }
function Info({ label, value }: { label: string; value: React.ReactNode }) { return <div><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>; }
