import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, BriefcaseBusiness, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const emptyForm = {
  applicationType: "vacancy",
  vacancyId: "",
  employmentCategory: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  nationalId: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  qualifications: "",
  yearsExperience: "0",
  currentEmployer: "",
  coverLetter: "",
  preferredSchoolIds: [] as number[],
  answers: {} as Record<string, unknown>,
};

export default function CareersPage() {
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [result, setResult] = useState<{ message: string; reference?: string } | null>(null);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/public/recruitment/context"],
    queryFn: async () => {
      const response = await fetch("/api/public/recruitment/context", { credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || "Unable to load careers information");
      return body;
    },
  });

  const selectedVacancy = useMemo(() => data?.vacancies?.find((vacancy: any) => vacancy.id === Number(form.vacancyId)) || null, [data?.vacancies, form.vacancyId]);
  const categories = useMemo(() => {
    const values = new Set<string>();
    for (const category of data?.settings?.generalApplicationCategories || []) if (String(category).trim()) values.add(String(category).trim());
    for (const vacancy of data?.vacancies || []) values.add(vacancy.employmentCategory);
    for (const requirement of data?.requirements || []) if (requirement.employmentCategory) values.add(requirement.employmentCategory);
    if (values.size === 0) values.add("Other");
    return Array.from(values).sort();
  }, [data]);
  const applicableRequirements = useMemo(() => (data?.requirements || []).filter((requirement: any) => (
    requirement.vacancyId === (form.vacancyId ? Number(form.vacancyId) : null)
    || (!requirement.vacancyId && requirement.employmentCategory === form.employmentCategory)
    || (!requirement.vacancyId && !requirement.employmentCategory)
  )), [data?.requirements, form.employmentCategory, form.vacancyId]);
  const applicableDocumentCategories = useMemo(() => (data?.documentCategories || []).filter((category: any) => (
    category.vacancyId === (form.vacancyId ? Number(form.vacancyId) : null)
    || (!category.vacancyId && category.employmentCategory === form.employmentCategory)
    || (!category.vacancyId && !category.employmentCategory)
  )), [data?.documentCategories, form.employmentCategory, form.vacancyId]);

  useEffect(() => {
    if (!data) return;
    setForm((current) => {
      if (data.vacancies.length === 0 && data.settings.generalApplicationsOpen && current.applicationType === "vacancy") {
        return { ...current, applicationType: "general", vacancyId: "" };
      }
      if (!data.settings.generalApplicationsOpen && current.applicationType === "general") {
        return { ...current, applicationType: "vacancy", vacancyId: "", employmentCategory: "" };
      }
      return current;
    });
  }, [data]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!data?.organization?.id) throw new Error("Recruitment organization is unavailable.");
      const payload = {
        ...form,
        organizationId: data.organization.id,
        vacancyId: form.applicationType === "vacancy" ? Number(form.vacancyId) || null : null,
        yearsExperience: Number(form.yearsExperience || 0),
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
      };
      const body = new FormData();
      const categoryCodes: string[] = [];
      for (const [categoryCode, categoryFiles] of Object.entries(files)) {
        for (const file of categoryFiles) {
          body.append("documents", file, file.name);
          categoryCodes.push(categoryCode);
        }
      }
      body.append("application", JSON.stringify({ ...payload, documentCategories: categoryCodes }));
      const response = await fetch("/api/public/recruitment/applications", { method: "POST", body, credentials: "include" });
      const responseBody = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseBody?.message || "Unable to submit application");
      return responseBody;
    },
    onSuccess: (response) => {
      setResult(response);
      setForm(emptyForm);
      setFiles({});
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  const set = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }));

  if (isLoading) return <div className="min-h-screen grid place-items-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (error || !data) return <div className="min-h-screen grid place-items-center p-6"><Alert variant="destructive" className="max-w-xl"><AlertTitle>Careers unavailable</AlertTitle><AlertDescription>{error instanceof Error ? error.message : "Unable to load careers information."}</AlertDescription></Alert></div>;

  if (!data.settings.publicApplicationsOpen) {
    return (
      <main className="min-h-screen bg-muted/30 py-8 px-4">
        <div className="mx-auto max-w-3xl space-y-6">
          <header className="rounded-2xl border bg-background p-6 shadow-sm">
            <div className="flex items-center gap-3"><BriefcaseBusiness className="h-8 w-8 text-primary" /><div><h1 className="text-2xl font-bold">{data.settings.careersPageTitle}</h1><p className="text-muted-foreground">{data.settings.careersPageMessage}</p></div></div>
          </header>
          <Card>
            <CardHeader><CardTitle>Recruitment applications are currently closed</CardTitle><CardDescription>The application form will become available again when the recruitment office reopens public applications.</CardDescription></CardHeader>
            <CardContent><Button variant="outline" onClick={() => window.location.assign("/")}><ArrowLeft className="mr-2 h-4 w-4" />Return to login</Button></CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (data.vacancies.length === 0 && !data.settings.generalApplicationsOpen) {
    return (
      <main className="min-h-screen bg-muted/30 py-8 px-4">
        <div className="mx-auto max-w-3xl space-y-6">
          <header className="rounded-2xl border bg-background p-6 shadow-sm">
            <div className="flex items-center gap-3"><BriefcaseBusiness className="h-8 w-8 text-primary" /><div><h1 className="text-2xl font-bold">{data.settings.careersPageTitle}</h1><p className="text-muted-foreground">{data.settings.careersPageMessage}</p></div></div>
          </header>
          <Card>
            <CardHeader><CardTitle>No applications are open at present</CardTitle><CardDescription>There are no advertised vacancies, and general applications are currently closed. Please check the Careers page again later.</CardDescription></CardHeader>
            <CardContent><Button variant="outline" onClick={() => window.location.assign("/")}><ArrowLeft className="mr-2 h-4 w-4" />Return to login</Button></CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-2xl border bg-background p-6 shadow-sm">
          <div className="flex items-center gap-3"><BriefcaseBusiness className="h-8 w-8 text-primary" /><div><h1 className="text-2xl font-bold">{data.settings.careersPageTitle}</h1><p className="text-muted-foreground">{data.settings.careersPageMessage}</p></div></div>
        </header>

        {result && <Alert><CheckCircle2 className="h-4 w-4" /><AlertTitle>Application submitted</AlertTitle><AlertDescription>{result.message}{result.reference ? ` Reference: ${result.reference}` : ""}</AlertDescription></Alert>}

        <Card>
          <CardHeader><CardTitle>Application type</CardTitle><CardDescription>Choose an advertised vacancy or submit a general application for future consideration.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <button type="button" disabled={data.vacancies.length === 0} className={`rounded-lg border p-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${form.applicationType === "vacancy" ? "border-primary ring-1 ring-primary" : ""}`} onClick={() => set("applicationType", "vacancy")}>
              <div className="font-semibold">Advertised vacancy</div><div className="text-sm text-muted-foreground">{data.vacancies.length > 0 ? "Apply against a currently open position." : "There are no advertised vacancies at present."}</div>
            </button>
            <button type="button" disabled={!data.settings.generalApplicationsOpen} className={`rounded-lg border p-4 text-left disabled:opacity-50 ${form.applicationType === "general" ? "border-primary ring-1 ring-primary" : ""}`} onClick={() => setForm((current) => ({ ...current, applicationType: "general", vacancyId: "", employmentCategory: "" }))}>
              <div className="font-semibold">General application</div><div className="text-sm text-muted-foreground">Submit your profile even when no suitable vacancy is advertised.</div>
            </button>
          </CardContent>
        </Card>

        <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}>
          <Card>
            <CardHeader><CardTitle>Opportunity</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {form.applicationType === "vacancy" && <Field label="Vacancy"><Select value={form.vacancyId} onValueChange={(value) => { const vacancy = data.vacancies.find((row: any) => row.id === Number(value)); setForm((current) => ({ ...current, vacancyId: value, employmentCategory: vacancy?.employmentCategory || "" })); }}><SelectTrigger><SelectValue placeholder="Select vacancy" /></SelectTrigger><SelectContent>{data.vacancies.map((vacancy: any) => <SelectItem key={vacancy.id} value={String(vacancy.id)}>{vacancy.code} · {vacancy.title}</SelectItem>)}</SelectContent></Select></Field>}
              <Field label="Employment category"><Select value={form.employmentCategory} disabled={Boolean(selectedVacancy)} onValueChange={(value) => set("employmentCategory", value)}><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></Field>
              {selectedVacancy && <div className="md:col-span-2 rounded-md bg-muted p-4"><div className="flex items-center gap-2"><Badge>{selectedVacancy.code}</Badge><span className="font-medium">{selectedVacancy.title}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{selectedVacancy.description}</p></div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Personal details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="First name"><Input required value={form.firstName} onChange={(event) => set("firstName", event.target.value)} /></Field>
              <Field label="Last name"><Input required value={form.lastName} onChange={(event) => set("lastName", event.target.value)} /></Field>
              <Field label="Email"><Input required type="email" value={form.email} onChange={(event) => set("email", event.target.value)} /></Field>
              <Field label="Phone"><Input required value={form.phone} onChange={(event) => set("phone", event.target.value)} /></Field>
              <Field label="National ID"><Input required value={form.nationalId} onChange={(event) => set("nationalId", event.target.value.toUpperCase())} /></Field>
              <Field label="Date of birth"><Input type="date" value={form.dateOfBirth} onChange={(event) => set("dateOfBirth", event.target.value)} /></Field>
              <Field label="Gender"><Select value={form.gender || "none"} onValueChange={(value) => set("gender", value === "none" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Prefer not to say</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="male">Male</SelectItem></SelectContent></Select></Field>
              <Field label="Home address"><Input value={form.address} onChange={(event) => set("address", event.target.value)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Qualifications and experience</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><Field label="Qualifications"><Textarea value={form.qualifications} onChange={(event) => set("qualifications", event.target.value)} placeholder="List your teaching certificates, degrees, licences and other relevant qualifications." /></Field></div>
              <Field label="Years of experience"><Input type="number" min="0" step="0.5" value={form.yearsExperience} onChange={(event) => set("yearsExperience", event.target.value)} /></Field>
              <Field label="Current employer"><Input value={form.currentEmployer} onChange={(event) => set("currentEmployer", event.target.value)} /></Field>
              <div className="md:col-span-2"><Field label="Cover letter / motivation"><Textarea className="min-h-32" value={form.coverLetter} onChange={(event) => set("coverLetter", event.target.value)} /></Field></div>
              {form.applicationType === "general" && <div className="md:col-span-2 space-y-2"><Label>Preferred schools</Label><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.schools.map((school: any) => <label key={school.id} className="flex items-center gap-2 rounded-md border p-3"><Checkbox checked={form.preferredSchoolIds.includes(school.id)} onCheckedChange={(checked) => set("preferredSchoolIds", checked ? [...form.preferredSchoolIds, school.id] : form.preferredSchoolIds.filter((id) => id !== school.id))} /><span>{school.name}</span></label>)}</div></div>}
            </CardContent>
          </Card>

          {applicableRequirements.length > 0 && <Card><CardHeader><CardTitle>Eligibility questions</CardTitle><CardDescription>Required answers are checked against the criteria configured for this opportunity.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">{applicableRequirements.map((requirement: any) => <RequirementField key={requirement.id} requirement={requirement} value={form.answers[requirement.code]} onChange={(value) => set("answers", { ...form.answers, [requirement.code]: value })} />)}</CardContent></Card>}

          <Card>
            <CardHeader><CardTitle>Supporting documents</CardTitle><CardDescription>Maximum {data.settings.attachmentSizeLimitMB} MB per file. Executable and active web files are not accepted.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {applicableDocumentCategories.map((category: any) => <Field key={category.id} label={`${category.label}${category.isRequired ? " *" : ""}`}><Input type="file" required={category.isRequired && !(files[category.code]?.length)} multiple={category.allowsMultiple} onChange={(event) => setFiles((current) => ({ ...current, [category.code]: Array.from(event.target.files || []) }))} /></Field>)}
              <Field label="Other documents"><Input type="file" multiple onChange={(event) => setFiles((current) => ({ ...current, other: Array.from(event.target.files || []) }))} /></Field>
              <div className="md:col-span-2 flex items-center gap-2 text-sm text-muted-foreground"><FileUp className="h-4 w-4" />Uploaded files are stored privately and are visible only to authorized recruitment staff.</div>
            </CardContent>
          </Card>

          {submit.error && <Alert variant="destructive"><AlertTitle>Application not submitted</AlertTitle><AlertDescription>{submit.error instanceof Error ? submit.error.message : "Unable to submit application."}</AlertDescription></Alert>}
          <Button className="w-full" size="lg" type="submit" disabled={submit.isPending || !form.employmentCategory || (form.applicationType === "vacancy" && !form.vacancyId)}>{submit.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : "Submit application"}</Button>
        </form>
      </div>
    </main>
  );
}

function RequirementField({ requirement, value, onChange }: { requirement: any; value: unknown; onChange: (value: unknown) => void }) {
  const label = `${requirement.label}${requirement.isMandatory ? " *" : ""}`;
  if (requirement.inputType === "boolean") return <div className="flex min-h-12 items-center gap-3 rounded-md border p-3"><Checkbox checked={value === true} onCheckedChange={(checked) => onChange(Boolean(checked))} /><div><Label>{label}</Label>{requirement.helpText && <p className="text-xs text-muted-foreground">{requirement.helpText}</p>}</div></div>;
  if (requirement.inputType === "number") return <Field label={label}><Input required={requirement.isMandatory} type="number" min={requirement.minimumNumber ?? undefined} max={requirement.maximumNumber ?? undefined} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} /></Field>;
  if (requirement.inputType === "select") return <Field label={label}><Select value={String(value ?? "")} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Select answer" /></SelectTrigger><SelectContent>{(requirement.acceptedValues || []).map((option: any) => <SelectItem key={String(option)} value={String(option)}>{String(option)}</SelectItem>)}</SelectContent></Select></Field>;
  return <Field label={label}><Input required={requirement.isMandatory} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}
