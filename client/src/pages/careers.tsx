import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, BriefcaseBusiness, CheckCircle2, FileUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  RECRUITMENT_EXAM_BOARDS,
  coreRecruitmentDocumentRequirements,
  examBoardMatches,
  isHighSchoolCoreRequirementDefinition,
  isPrimarySchoolCoreRequirementDefinition,
  normalizeRecruitmentDepartment,
  normalizeSubjectList,
  recruitmentCategoryCode,
} from "@shared/recruitment";

const emptyForm = {
  applicationType: "vacancy",
  vacancyId: "",
  employmentCategory: "",
  department: "",
  examinationBoards: [] as string[],
  declaredSubjectsText: "",
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
  holdsTeachingQualification: false,
  aLevelResults: [] as Array<{ subject: string; grade: string }>,
  oLevelResults: [] as Array<{ subject: string; grade: string; sitting: number }>,
  answers: {} as Record<string, unknown>,
};

export default function CareersPage() {
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [examBoardToAdd, setExamBoardToAdd] = useState("");
  const [result, setResult] = useState<{ message: string; reference?: string } | null>(null);
  const [missingRequiredCodes, setMissingRequiredCodes] = useState<string[]>([]);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/public/recruitment/context"],
    queryFn: async () => {
      const response = await fetch("/api/public/recruitment/context", { credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || "Unable to load careers information");
      return body;
    },
  });

  const categories = useMemo(() => (data?.applicationCategories || []).map((category: any) => String(category.label)), [data?.applicationCategories]);
  const categoryCode = recruitmentCategoryCode(form.employmentCategory);
  const isHighSchool = categoryCode === "high_school_teaching";
  const isPrimary = categoryCode === "primary_teaching";
  const isTeaching = isHighSchool || isPrimary;

  const activeHighSchoolDepartments = useMemo(
    () => (data?.departments || []).filter((department: any) =>
      department.isActive && department.applicationCategory === "High School Teaching",
    ),
    [data?.departments],
  );

  const matchingVacancies = useMemo(() => {
    if (!data || form.applicationType !== "vacancy" || !form.employmentCategory) return [];
    return (data.vacancies || []).filter((vacancy: any) => {
      if (vacancy.employmentCategory !== form.employmentCategory) return false;
      if (isHighSchool && normalizeRecruitmentDepartment(vacancy.department) !== normalizeRecruitmentDepartment(form.department)) return false;
      if (isTeaching) {
        if (!form.examinationBoards.length) return false;
        if (!examBoardMatches(form.examinationBoards, vacancy.examinationBoard)) return false;
      }
      return true;
    });
  }, [data, form.applicationType, form.department, form.employmentCategory, form.examinationBoards, isHighSchool, isTeaching]);

  const selectedVacancy = useMemo(
    () => matchingVacancies.find((vacancy: any) => vacancy.id === Number(form.vacancyId)) || null,
    [form.vacancyId, matchingVacancies],
  );

  const applicableRequirements = useMemo(() => (data?.requirements || []).filter((requirement: any) => {
    const inScope = requirement.vacancyId === (form.vacancyId ? Number(form.vacancyId) : null)
      || (!requirement.vacancyId && requirement.employmentCategory === form.employmentCategory)
      || (!requirement.vacancyId && !requirement.employmentCategory);
    if (!inScope) return false;
    if (isHighSchool && isHighSchoolCoreRequirementDefinition(requirement)) return false;
    if (isPrimary && isPrimarySchoolCoreRequirementDefinition(requirement)) return false;
    return true;
  }), [data?.requirements, form.employmentCategory, form.vacancyId, isHighSchool, isPrimary]);

  const applicableConfiguredDocumentCategories = useMemo(() => (data?.documentCategories || []).filter((category: any) => (
    category.vacancyId === (form.vacancyId ? Number(form.vacancyId) : null)
    || (!category.vacancyId && category.employmentCategory === form.employmentCategory)
    || (!category.vacancyId && !category.employmentCategory)
  )), [data?.documentCategories, form.employmentCategory, form.vacancyId]);

  const applicableDocumentCategories = useMemo(() => {
    const merged = new Map<string, any>();
    for (const category of applicableConfiguredDocumentCategories) merged.set(category.code, category);
    for (const core of coreRecruitmentDocumentRequirements(
      categoryCode,
      form.holdsTeachingQualification,
      data?.primarySchoolEligibility?.teachingQualificationRequired ?? true,
    )) {
      const existing = merged.get(core.code);
      merged.set(core.code, existing
        ? { ...existing, isRequired: Boolean(existing.isRequired || core.isRequired) }
        : { id: `core:${core.code}`, code: core.code, label: core.label, isRequired: core.isRequired, allowsMultiple: core.allowsMultiple, core: true });
    }
    return Array.from(merged.values());
  }, [applicableConfiguredDocumentCategories, categoryCode, data?.primarySchoolEligibility?.teachingQualificationRequired, form.holdsTeachingQualification]);

  useEffect(() => {
    if (!data) return;
    setForm((current) => {
      if (data.vacancies.length === 0 && data.settings.generalApplicationsOpen && current.applicationType === "vacancy") {
        return { ...current, applicationType: "general", vacancyId: "" };
      }
      if (!data.settings.generalApplicationsOpen && current.applicationType === "general") {
        return { ...current, applicationType: "vacancy", vacancyId: "" };
      }
      return current;
    });
  }, [data]);

  useEffect(() => {
    if (isHighSchool && form.aLevelResults.length === 0) {
      setForm((current) => ({ ...current, aLevelResults: [{ subject: "", grade: "" }] }));
    }
    if (!isHighSchool && form.aLevelResults.length > 0) {
      setForm((current) => ({ ...current, aLevelResults: [] }));
    }
    if (isPrimary && form.oLevelResults.length === 0) {
      setForm((current) => ({ ...current, oLevelResults: [{ subject: "", grade: "", sitting: 1 }] }));
    }
    if (!isPrimary && form.oLevelResults.length > 0) {
      setForm((current) => ({ ...current, oLevelResults: [] }));
    }
    if (!isTeaching && form.holdsTeachingQualification) {
      setForm((current) => ({ ...current, holdsTeachingQualification: false }));
    }
  }, [isHighSchool, isPrimary, isTeaching]);

  useEffect(() => {
    if (form.vacancyId && !matchingVacancies.some((vacancy: any) => String(vacancy.id) === String(form.vacancyId))) {
      setForm((current) => ({ ...current, vacancyId: "" }));
      setFiles({});
    }
  }, [form.vacancyId, matchingVacancies]);

  const set = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }));

  const setEmploymentCategory = (value: string) => {
    const nextCode = recruitmentCategoryCode(value);
    setForm((current) => ({
      ...current,
      employmentCategory: value,
      department: nextCode === "primary_teaching" ? "Primary School" : "",
      examinationBoards: [],
      declaredSubjectsText: "",
      vacancyId: "",
      answers: {},
      aLevelResults: nextCode === "high_school_teaching" ? [{ subject: "", grade: "" }] : [],
      oLevelResults: nextCode === "primary_teaching" ? [{ subject: "", grade: "", sitting: 1 }] : [],
      holdsTeachingQualification: false,
    }));
    setExamBoardToAdd("");
    setFiles({});
  };

  const updateALevelResult = (index: number, key: "subject" | "grade", value: string) => {
    setForm((current) => ({
      ...current,
      aLevelResults: current.aLevelResults.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row),
    }));
  };

  const updateOLevelResult = (index: number, key: "subject" | "grade" | "sitting", value: string | number) => {
    setForm((current) => ({
      ...current,
      oLevelResults: current.oLevelResults.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row),
    }));
  };

  const addExamBoard = (board: string) => {
    if (!board) return;
    setForm((current) => ({
      ...current,
      examinationBoards: current.examinationBoards.some((value) => value.toLowerCase() === board.toLowerCase())
        ? current.examinationBoards
        : [...current.examinationBoards, board],
      vacancyId: "",
    }));
    setExamBoardToAdd("");
    setFiles({});
  };

  const removeExamBoard = (board: string) => {
    setForm((current) => ({
      ...current,
      examinationBoards: current.examinationBoards.filter((value) => value.toLowerCase() !== board.toLowerCase()),
      vacancyId: "",
    }));
    setFiles({});
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!data?.organization?.id) throw new Error("Recruitment organization is unavailable.");
      if (!form.employmentCategory) throw new Error("Select an Application Category.");
      if (isHighSchool && !form.department) throw new Error("Select a High School department.");
      if (isTeaching && form.examinationBoards.length === 0) throw new Error("Select at least one examination board you are able to teach.");
      if (isHighSchool && normalizeSubjectList(form.declaredSubjectsText.split(",")).length === 0) {
        throw new Error("Enter at least one subject you are able to teach.");
      }
      if (form.applicationType === "vacancy" && !form.vacancyId) throw new Error("Select an advertised vacancy.");
      if (form.dateOfBirth) {
        const dob = new Date(`${form.dateOfBirth}T00:00:00`);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (!Number.isNaN(dob.getTime()) && dob > today) throw new Error("Date of birth cannot be in the future.");
      }

      const enteredALevelResults = form.aLevelResults.filter((row) => row.subject.trim() || row.grade.trim());
      if (isHighSchool) {
        if (!form.dateOfBirth) throw new Error("Date of birth is required for High School Teaching applications.");
        if (enteredALevelResults.length === 0) throw new Error("Enter your A-Level subjects and grades.");
        if (enteredALevelResults.some((row) => !row.subject.trim() || !row.grade.trim())) {
          throw new Error("Complete both the subject and grade for every A-Level result entered.");
        }
      }
      const enteredOLevelResults = form.oLevelResults.filter((row) => row.subject.trim() || row.grade.trim());
      if (isPrimary) {
        if (!form.dateOfBirth) throw new Error("Date of birth is required for Primary School Teaching applications.");
        if (enteredOLevelResults.length === 0) throw new Error("Enter your O-Level subjects, grades and sittings.");
        if (enteredOLevelResults.some((row) => !row.subject.trim() || !row.grade.trim() || !Number.isInteger(Number(row.sitting)) || Number(row.sitting) < 1)) {
          throw new Error("Complete the subject, grade and sitting for every O-Level result entered.");
        }
      }

      const missingRequired = applicableDocumentCategories.filter((category: any) => category.isRequired && !(files[category.code]?.length));
      if (missingRequired.length) {
        const codes = missingRequired.map((category: any) => category.code);
        setMissingRequiredCodes(codes);
        window.setTimeout(() => document.getElementById(`required-document-${codes[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
        throw new Error(`Your application is incomplete. Please upload: ${missingRequired.map((category: any) => category.label).join(", ")}.`);
      }
      setMissingRequiredCodes([]);

      const payload = {
        ...form,
        organizationId: data.organization.id,
        vacancyId: form.applicationType === "vacancy" ? Number(form.vacancyId) || null : null,
        department: isHighSchool ? form.department : isPrimary ? "Primary School" : null,
        examinationBoards: isTeaching ? form.examinationBoards : [],
        declaredSubjects: isHighSchool ? normalizeSubjectList(form.declaredSubjectsText.split(",")) : [],
        preferredSchoolIds: [],
        yearsExperience: Number(form.yearsExperience || 0),
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        aLevelResults: isHighSchool ? enteredALevelResults : [],
        oLevelResults: isPrimary ? enteredOLevelResults.map((row) => ({ ...row, sitting: Number(row.sitting) })) : [],
        holdsTeachingQualification: isTeaching ? form.holdsTeachingQualification : false,
      };
      delete (payload as any).declaredSubjectsText;

      const body = new FormData();
      const categoryCodes: string[] = [];
      for (const [documentCategoryCode, categoryFiles] of Object.entries(files)) {
        for (const file of categoryFiles) {
          body.append("documents", file, file.name);
          categoryCodes.push(documentCategoryCode);
        }
      }
      body.append("application", JSON.stringify({ ...payload, documentCategories: categoryCodes }));

      const response = await fetch("/api/public/recruitment/applications", { method: "POST", body, credentials: "include" });
      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        if (Array.isArray(responseBody?.missingDocuments)) {
          const codes = responseBody.missingDocuments.map((item: any) => String(item.code));
          setMissingRequiredCodes(codes);
          if (codes[0]) window.setTimeout(() => document.getElementById(`required-document-${codes[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
        }
        throw new Error(responseBody?.message || "Unable to submit application");
      }
      return responseBody;
    },
    onSuccess: (response) => {
      setResult(response);
      setForm(emptyForm);
      setFiles({});
      setExamBoardToAdd("");
      setMissingRequiredCodes([]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  if (isLoading) return <div className="min-h-screen grid place-items-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (error || !data) return <div className="min-h-screen grid place-items-center p-6"><Alert variant="destructive" className="max-w-xl"><AlertTitle>Careers unavailable</AlertTitle><AlertDescription>{error instanceof Error ? error.message : "Unable to load careers information."}</AlertDescription></Alert></div>;
  if (!data.settings.publicApplicationsOpen) return <ClosedPage title={data.settings.careersPageTitle} message={data.settings.careersPageMessage} heading="Applications are currently closed" description="Please check back later for future opportunities." />;

  if (result) {
    return (
      <main className="min-h-screen bg-muted/30 px-4 py-8">
        <Card className="mx-auto max-w-2xl">
          <CardHeader className="text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <CardTitle>Application submitted</CardTitle>
            <CardDescription>{result.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            {result.reference && <div className="rounded-md bg-muted p-4 text-lg font-semibold">{result.reference}</div>}
            <Button onClick={() => setResult(null)}>Submit another application</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const vacancyDiscoveryReady =
    Boolean(form.employmentCategory)
    && (!isHighSchool || Boolean(form.department))
    && (!isTeaching || form.examinationBoards.length > 0);

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-2xl border bg-background p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <BriefcaseBusiness className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">{data.settings.careersPageTitle}</h1>
              <p className="text-muted-foreground">{data.settings.careersPageMessage}</p>
            </div>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>How would you like to apply?</CardTitle>
            <CardDescription>You can apply for a current vacancy or enter the FCGS general candidate pool.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              className={`rounded-lg border p-4 text-left ${form.applicationType === "vacancy" ? "border-primary ring-1 ring-primary" : ""}`}
              onClick={() => {
                setForm((current) => ({ ...current, applicationType: "vacancy", vacancyId: "" }));
                setFiles({});
              }}
            >
              <div className="font-semibold">Advertised vacancy</div>
              <div className="text-sm text-muted-foreground">Choose your Application Category first, then see matching vacancies only.</div>
            </button>
            <button
              type="button"
              disabled={!data.settings.generalApplicationsOpen}
              className={`rounded-lg border p-4 text-left disabled:opacity-50 ${form.applicationType === "general" ? "border-primary ring-1 ring-primary" : ""}`}
              onClick={() => {
                setForm((current) => ({ ...current, applicationType: "general", vacancyId: "" }));
                setFiles({});
              }}
            >
              <div className="font-semibold">General application</div>
              <div className="text-sm text-muted-foreground">Join the candidate pool even when no suitable vacancy is advertised.</div>
            </button>
          </CardContent>
        </Card>

        <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}>
          <Card>
            <CardHeader>
              <CardTitle>Opportunity</CardTitle>
              <CardDescription>Application Category is the first step. Teaching applications then use Department and Examination Board as applicable.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Application Category *">
                <Select value={form.employmentCategory} onValueChange={setEmploymentCategory}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>{categories.map((category: string) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
                </Select>
              </Field>

              {isHighSchool && (
                <Field label="Department *">
                  <Select value={form.department} onValueChange={(value) => {
                    setForm((current) => ({ ...current, department: value, vacancyId: "" }));
                    setFiles({});
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select one department" /></SelectTrigger>
                    <SelectContent>{activeHighSchoolDepartments.map((department: any) => <SelectItem key={department.id} value={normalizeRecruitmentDepartment(department.name)}>{normalizeRecruitmentDepartment(department.name)}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              )}

              {isTeaching && (
                <Field label="Which examination board(s) are you able to teach? *" hint="Select every board you can teach. Each selected board is treated independently when matching and filtering applications.">
                  <div className="space-y-2">
                    <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border p-2">
                      {form.examinationBoards.map((board) => (
                        <Badge key={board} variant="secondary" className="gap-1">
                          {board}
                          <button type="button" aria-label={`Remove ${board}`} onClick={() => removeExamBoard(board)}><X className="h-3 w-3" /></button>
                        </Badge>
                      ))}
                      {!form.examinationBoards.length && <span className="text-sm text-muted-foreground">No examination boards selected.</span>}
                    </div>
                    <Select value={examBoardToAdd} onValueChange={addExamBoard}>
                      <SelectTrigger><SelectValue placeholder="Add examination board" /></SelectTrigger>
                      <SelectContent>
                        {(data.examinationBoards || RECRUITMENT_EXAM_BOARDS)
                          .filter((board: string) => !form.examinationBoards.some((selected) => selected.toLowerCase() === board.toLowerCase()))
                          .map((board: string) => <SelectItem key={board} value={board}>{board}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </Field>
              )}

              {form.applicationType === "vacancy" && vacancyDiscoveryReady && (
                <div className="md:col-span-2">
                  <Field label="Matching advertised vacancy *">
                    <Select value={form.vacancyId} onValueChange={(value) => { set("vacancyId", value); setFiles({}); }}>
                      <SelectTrigger><SelectValue placeholder={matchingVacancies.length ? "Select vacancy" : "No matching advertised vacancies"} /></SelectTrigger>
                      <SelectContent>
                        {matchingVacancies.map((vacancy: any) => {
                          const school = data.schools.find((row: any) => row.id === vacancy.schoolId);
                          const details = [
                            vacancy.examinationBoard,
                            normalizeSubjectList(vacancy.subjects).join(", "),
                            school?.name,
                          ].filter(Boolean).join(" · ");
                          return <SelectItem key={vacancy.id} value={String(vacancy.id)}>{vacancy.code} · {vacancy.title}{details ? ` — ${details}` : ""}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}

              {form.applicationType === "vacancy" && vacancyDiscoveryReady && matchingVacancies.length === 0 && (
                <div className="md:col-span-2 rounded-md border border-dashed p-4">
                  <div className="font-medium">No matching advertised vacancies are currently available.</div>
                  <div className="mt-1 text-sm text-muted-foreground">You can still submit your details to the general candidate pool using the category, department and examination-board capability you already selected.</div>
                  {data.settings.generalApplicationsOpen && (
                    <Button type="button" variant="outline" className="mt-3" onClick={() => setForm((current) => ({ ...current, applicationType: "general", vacancyId: "" }))}>
                      Continue with General Application
                    </Button>
                  )}
                </div>
              )}

              {selectedVacancy && (
                <div className="md:col-span-2 rounded-md bg-muted p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{selectedVacancy.code}</Badge>
                    <span className="font-medium">{selectedVacancy.title}</span>
                    {selectedVacancy.examinationBoard && <Badge variant="outline">{selectedVacancy.examinationBoard}</Badge>}
                    {data.schools.find((row: any) => row.id === selectedVacancy.schoolId)?.name && <Badge variant="outline">{data.schools.find((row: any) => row.id === selectedVacancy.schoolId)?.name}</Badge>}
                  </div>
                  {normalizeSubjectList(selectedVacancy.subjects).length > 0 && <p className="mt-2 text-sm"><strong>Subject(s):</strong> {normalizeSubjectList(selectedVacancy.subjects).join(", ")}</p>}
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{selectedVacancy.description}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {isHighSchool && (
            <Card className="border-primary/40">
              <CardHeader>
                <CardTitle>High School Teaching minimum requirements</CardTitle>
                <CardDescription>Applications are checked automatically before submission.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-2 pl-5 text-sm">
                  <li>At least <strong>{data.highSchoolEligibility.minimumALevelPoints} A-Level points</strong>.</li>
                  <li><strong>{data.highSchoolEligibility.maxAge} years old or below</strong> on the date of application.</li>
                  <li>A recognised teaching qualification may use the configured teaching-qualified route.</li>
                </ul>
              </CardContent>
            </Card>
          )}

          {isPrimary && (
            <Card className="border-primary/40">
              <CardHeader>
                <CardTitle>Primary School Teaching minimum requirements</CardTitle>
                <CardDescription>Applications are checked automatically before submission using the current Recruitment policy.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-2 pl-5 text-sm">
                  <li><strong>{data.primarySchoolEligibility.maxAge} years old or below</strong> on the date of application.</li>
                  {data.primarySchoolEligibility.teachingQualificationRequired && <li>A <strong>recognised teaching qualification</strong> is required.</li>}
                  <li>A maximum of <strong>{data.primarySchoolEligibility.maximumOLevelSittings} O-Level sitting(s)</strong>.</li>
                  <li>At least <strong>{data.primarySchoolEligibility.minimumOLevelSubjects} O-Level subjects at {data.primarySchoolEligibility.minimumOLevelGrade} or better</strong>.</li>
                  <li>Mandatory subjects: <strong>{data.primarySchoolEligibility.mandatoryOLevelSubjects.join(", ")}</strong>, each at <strong>{data.primarySchoolEligibility.mandatoryOLevelGrade} or better</strong>.</li>
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Personal details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="First name *"><Input required value={form.firstName} onChange={(event) => set("firstName", event.target.value)} /></Field>
              <Field label="Last name *"><Input required value={form.lastName} onChange={(event) => set("lastName", event.target.value)} /></Field>
              <Field label="Email *"><Input required type="email" value={form.email} onChange={(event) => set("email", event.target.value)} /></Field>
              <Field label="Phone *"><Input required value={form.phone} onChange={(event) => set("phone", event.target.value)} /></Field>
              <Field label="National ID *"><Input required value={form.nationalId} onChange={(event) => set("nationalId", event.target.value.toUpperCase())} /></Field>
              <Field label={`Date of birth${isTeaching ? " *" : ""}`}>
                <Input required={isTeaching} type="date" max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth} onChange={(event) => set("dateOfBirth", event.target.value)} />
              </Field>
              <Field label="Gender">
                <Select value={form.gender || "none"} onValueChange={(value) => set("gender", value === "none" ? "" : value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Prefer not to say</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="male">Male</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Home address"><Input value={form.address} onChange={(event) => set("address", event.target.value)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Qualifications and experience</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><Field label="Qualifications"><Textarea value={form.qualifications} onChange={(event) => set("qualifications", event.target.value)} placeholder="List degrees, diplomas, teaching certificates and other relevant qualifications." /></Field></div>

              {isHighSchool && (
                <div className="md:col-span-2">
                  <Field label="Subjects you are able to teach *" hint="Comma-separated, for example: Physics, Mathematics">
                    <Input value={form.declaredSubjectsText} onChange={(event) => set("declaredSubjectsText", event.target.value)} placeholder="Physics, Mathematics" />
                  </Field>
                </div>
              )}

              {isHighSchool && (
                <div className="md:col-span-2 space-y-3 rounded-md border p-4">
                  <div><Label>A-Level subjects and grades *</Label><p className="text-xs text-muted-foreground">Enter each subject once. The server calculates your A-Level points from these grades.</p></div>
                  {form.aLevelResults.map((row, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
                      <Input required placeholder="Subject" value={row.subject} onChange={(event) => updateALevelResult(index, "subject", event.target.value)} />
                      <Select value={row.grade} onValueChange={(value) => updateALevelResult(index, "grade", value)}>
                        <SelectTrigger><SelectValue placeholder="Grade" /></SelectTrigger>
                        <SelectContent>{(data.highSchoolEligibility.gradeOptions || []).map((grade: string) => <SelectItem key={grade} value={grade}>{grade}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button type="button" variant="outline" size="icon" disabled={form.aLevelResults.length === 1} onClick={() => set("aLevelResults", form.aLevelResults.filter((_, rowIndex) => rowIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => set("aLevelResults", [...form.aLevelResults, { subject: "", grade: "" }])}><Plus className="mr-2 h-4 w-4" />Add A-Level subject</Button>
                </div>
              )}

              {isPrimary && (
                <div className="md:col-span-2 space-y-3 rounded-md border p-4">
                  <div>
                    <Label>O-Level subjects, grades and sittings *</Label>
                    <p className="text-xs text-muted-foreground">Enter each result and identify the sitting. The server applies the current Primary School Teaching eligibility policy.</p>
                  </div>
                  {form.oLevelResults.map((row, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-[1fr_160px_150px_auto]">
                      <Input required placeholder="Subject" value={row.subject} onChange={(event) => updateOLevelResult(index, "subject", event.target.value)} />
                      <Select value={row.grade} onValueChange={(value) => updateOLevelResult(index, "grade", value)}>
                        <SelectTrigger><SelectValue placeholder="Grade" /></SelectTrigger>
                        <SelectContent>{(data.primarySchoolEligibility.gradeOptions || []).map((grade: string) => <SelectItem key={grade} value={grade}>{grade}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={String(row.sitting)} onValueChange={(value) => updateOLevelResult(index, "sitting", Number(value))}>
                        <SelectTrigger><SelectValue placeholder="Sitting" /></SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: Number(data.primarySchoolEligibility.maximumOLevelSittings || 2) }, (_, sittingIndex) => sittingIndex + 1)
                            .map((sitting) => <SelectItem key={sitting} value={String(sitting)}>Sitting {sitting}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="outline" size="icon" disabled={form.oLevelResults.length === 1} onClick={() => set("oLevelResults", form.oLevelResults.filter((_, rowIndex) => rowIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => set("oLevelResults", [...form.oLevelResults, { subject: "", grade: "", sitting: 1 }])}><Plus className="mr-2 h-4 w-4" />Add O-Level subject</Button>
                </div>
              )}

              {isTeaching && (
                <label className="md:col-span-2 flex items-start gap-3 rounded-md border p-4">
                  <Checkbox checked={form.holdsTeachingQualification} onCheckedChange={(checked) => set("holdsTeachingQualification", Boolean(checked))} />
                  <div>
                    <Label>I hold a recognised teaching qualification</Label>
                    <p className="text-xs text-muted-foreground">This simple Yes/No declaration is used where a vacancy requires a teaching qualification. Supporting documents may be reviewed separately.</p>
                  </div>
                </label>
              )}

              <Field label="Years of experience"><Input type="number" min="0" step="0.5" value={form.yearsExperience} onChange={(event) => set("yearsExperience", event.target.value)} /></Field>
              <Field label="Current employer"><Input value={form.currentEmployer} onChange={(event) => set("currentEmployer", event.target.value)} /></Field>
              <div className="md:col-span-2"><Field label="Cover letter / motivation"><Textarea className="min-h-32" value={form.coverLetter} onChange={(event) => set("coverLetter", event.target.value)} /></Field></div>
            </CardContent>
          </Card>

          {applicableRequirements.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Additional eligibility questions</CardTitle><CardDescription>These additional requirements are configured by the Recruitment team for this opportunity.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {applicableRequirements.map((requirement: any) => (
                  <RequirementField key={requirement.id} requirement={requirement} value={form.answers[requirement.code]} onChange={(value) => set("answers", { ...form.answers, [requirement.code]: value })} />
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Supporting documents</CardTitle>
              <CardDescription>Required documents must be uploaded before the application can be submitted. Maximum {data.settings.attachmentSizeLimitMB} MB per file.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 rounded-md border bg-muted/40 p-4 text-sm">
                  <div className="font-semibold">Required-document check</div>
                  <div className="mt-1 text-muted-foreground">Required documents: {applicableDocumentCategories.filter((category: any) => category.isRequired && files[category.code]?.length).length} of {applicableDocumentCategories.filter((category: any) => category.isRequired).length} uploaded. Optional documents may be supplied where relevant.</div>
                </div>
              {applicableDocumentCategories.map((category: any) => {
                const missing = missingRequiredCodes.includes(category.code);
                return (
                  <div key={category.id} id={`required-document-${category.code}`} className={missing ? "rounded-md border border-destructive p-3" : ""}>
                    <Field label={`${category.label}${category.isRequired ? " * · Required" : " · Optional"}`}>
                      <Input type="file" multiple={category.allowsMultiple} aria-invalid={missing} onChange={(event) => {
                        const nextFiles = Array.from(event.target.files || []);
                        setFiles((current) => ({ ...current, [category.code]: nextFiles }));
                        if (nextFiles.length) setMissingRequiredCodes((current) => current.filter((code) => code !== category.code));
                      }} />
                      {missing && <p className="text-xs font-medium text-destructive">This document is required before you can submit your application.</p>}
                    </Field>
                  </div>
                );
              })}
              {!applicableDocumentCategories.some((category: any) => category.code === "other") && (
                <Field label="Other documents"><Input type="file" multiple onChange={(event) => setFiles((current) => ({ ...current, other: Array.from(event.target.files || []) }))} /></Field>
              )}
              <div className="md:col-span-2 flex items-center gap-2 text-sm text-muted-foreground"><FileUp className="h-4 w-4" />Uploaded files are stored privately and visible only to authorized Recruitment staff.</div>
            </CardContent>
          </Card>

          {submit.error && <Alert variant="destructive"><AlertTitle>Application not submitted</AlertTitle><AlertDescription>{submit.error instanceof Error ? submit.error.message : "Unable to submit application."}</AlertDescription></Alert>}

          <Button
            className="w-full"
            size="lg"
            type="submit"
            disabled={
              submit.isPending
              || !form.employmentCategory
              || (isHighSchool && !form.department)
              || (isTeaching && form.examinationBoards.length === 0)
              || (form.applicationType === "vacancy" && !form.vacancyId)
            }
          >
            {submit.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : "Submit application"}
          </Button>
        </form>
      </div>
    </main>
  );
}

function ClosedPage({ title, message, heading, description }: { title: string; message: string; heading: string; description: string }) {
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="rounded-2xl border bg-background p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <BriefcaseBusiness className="h-8 w-8 text-primary" />
            <div><h1 className="text-2xl font-bold">{title}</h1><p className="text-muted-foreground">{message}</p></div>
          </div>
        </header>
        <Card>
          <CardHeader><CardTitle>{heading}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
          <CardContent><Button variant="outline" onClick={() => window.location.assign("/")}><ArrowLeft className="mr-2 h-4 w-4" />Return to login</Button></CardContent>
        </Card>
      </div>
    </main>
  );
}

function RequirementField({ requirement, value, onChange }: { requirement: any; value: unknown; onChange: (value: unknown) => void }) {
  const label = `${requirement.label}${requirement.isMandatory ? " *" : ""}`;
  if (requirement.inputType === "boolean") {
    return <div className="flex min-h-12 items-center gap-3 rounded-md border p-3"><Checkbox checked={value === true} onCheckedChange={(checked) => onChange(Boolean(checked))} /><div><Label>{label}</Label>{requirement.helpText && <p className="text-xs text-muted-foreground">{requirement.helpText}</p>}</div></div>;
  }
  if (requirement.inputType === "number") {
    return <Field label={label}><Input required={requirement.isMandatory} type="number" min={requirement.minimumNumber ?? undefined} max={requirement.maximumNumber ?? undefined} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} /></Field>;
  }
  if (requirement.inputType === "select") {
    return <Field label={label}><Select value={String(value ?? "")} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Select answer" /></SelectTrigger><SelectContent>{(requirement.acceptedValues || []).map((option: any) => <SelectItem key={String(option)} value={String(option)}>{String(option)}</SelectItem>)}</SelectContent></Select></Field>;
  }
  return <Field label={label}><Input required={requirement.isMandatory} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}
