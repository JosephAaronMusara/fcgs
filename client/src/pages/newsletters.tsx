import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, schoolFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableMultiSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { Newspaper, Plus, Calendar, Send, Eye, Trash2, Mail, MessageSquare, Bell, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import type { Class, Newsletter, School, Staff, Stream, Student } from "@shared/schema";
import { LanguageCheckButton } from "@/features/language-tools";
import { newsletterSmsText, estimateSmsSegments } from "@shared/sms-segments";

type NewsletterAudience = "all" | "parents" | "students" | "staff";
type NewsletterScope = "all" | "streams" | "classes" | "individuals";
type RecipientPreview = { total: number; email: number; sms: number; inApp: number };
type PaginatedResponse<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };

function fullName(item: { firstName?: string | null; lastName?: string | null }) {
  return `${item.firstName || ""} ${item.lastName || ""}`.trim();
}

function classLabel(cls: Class) {
  return cls.shortCode?.trim() || cls.className;
}

function audienceLabel(audience?: string | null) {
  if (audience === "parents") return "Parents Only";
  if (audience === "students") return "Students Only";
  if (audience === "staff") return "Staff Only";
  return "Everyone";
}

function scopeLabel(newsletter: Newsletter) {
  const scope = newsletter.targetScope || "all";
  if (scope === "streams") return `${newsletter.targetStreamIds?.length || 0} stream(s)`;
  if (scope === "classes") return `${newsletter.targetClassIds?.length || 0} class(es)`;
  if (scope === "individuals") {
    const count = newsletter.targetAudience === "staff"
      ? newsletter.targetStaffIds?.length || 0
      : newsletter.targetStudentIds?.length || 0;
    return `${count} selected individual(s)`;
  }
  return "All";
}

export default function NewslettersPage() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [viewNewsletter, setViewNewsletter] = useState<Newsletter | null>(null);
  const [publishCandidate, setPublishCandidate] = useState<Newsletter | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["email"]);
  const [selectedAudience, setSelectedAudience] = useState<NewsletterAudience>("all");
  const [selectedScope, setSelectedScope] = useState<NewsletterScope>("all");
  const [selectedStreamIds, setSelectedStreamIds] = useState<string[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [newsletterTitle, setNewsletterTitle] = useState("");
  const [newsletterContent, setNewsletterContent] = useState("");

  const resetTargeting = () => {
    setSelectedChannels(["email"]);
    setSelectedAudience("all");
    setSelectedScope("all");
    setSelectedStreamIds([]);
    setSelectedClassIds([]);
    setSelectedStudentIds([]);
    setSelectedStaffIds([]);
    setNewsletterTitle("");
    setNewsletterContent("");
  };

  const { data: newsletters = [], isLoading } = useQuery<Newsletter[]>({
    queryKey: ["/api/newsletters"],
  });

  const { data: school } = useQuery<School>({
    queryKey: ["/api/schools/current", "newsletter-targeting"],
    queryFn: async () => {
      const res = await schoolFetch("/api/schools/current");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: isAddOpen,
  });

  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes", "newsletter-targeting"],
    queryFn: async () => {
      const res = await schoolFetch("/api/classes");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: isAddOpen,
  });

  const { data: streams = [] } = useQuery<Stream[]>({
    queryKey: ["/api/streams", school?.schoolType || "all", "newsletter-targeting"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (school?.schoolType) params.set("schoolType", school.schoolType);
      const res = await schoolFetch(`/api/streams${params.toString() ? `?${params.toString()}` : ""}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: isAddOpen,
  });

  const shouldLoadStudents = isAddOpen
    && selectedScope === "individuals"
    && (selectedAudience === "parents" || selectedAudience === "students");
  const { data: students = [] } = useQuery<Student[]>({
    queryKey: ["/api/students", "newsletter-targeting"],
    queryFn: async () => {
      const params = new URLSearchParams({ paginated: "true", page: "1", pageSize: "100000", status: "active" });
      const res = await schoolFetch(`/api/students?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const page = (await res.json()) as PaginatedResponse<Student>;
      return page.items || [];
    },
    enabled: shouldLoadStudents,
  });

  const shouldLoadStaff = isAddOpen && selectedAudience === "staff" && selectedScope === "individuals";
  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", "newsletter-targeting"],
    queryFn: async () => {
      const params = new URLSearchParams({ paginated: "true", page: "1", pageSize: "100000" });
      const res = await schoolFetch(`/api/staff?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const page = (await res.json()) as PaginatedResponse<Staff>;
      return page.items || [];
    },
    enabled: shouldLoadStaff,
  });

  const classOptions: SearchableSelectOption[] = useMemo(() => classes.map((cls) => ({
    value: String(cls.id),
    label: classLabel(cls),
    searchText: cls.className,
  })), [classes]);

  const streamOptions: SearchableSelectOption[] = useMemo(() => {
    const usedStreamIds = new Set(classes.map((cls) => cls.streamId).filter((id): id is number => typeof id === "number"));
    return streams.filter((stream) => usedStreamIds.has(stream.id)).map((stream) => ({
      value: String(stream.id),
      label: stream.name,
      searchText: stream.description || "",
    }));
  }, [classes, streams]);

  const studentOptions: SearchableSelectOption[] = useMemo(() => students.map((student) => ({
    value: String(student.id),
    label: `${fullName(student)}${student.admissionNo ? ` (${student.admissionNo})` : ""}`,
    searchText: `${student.admissionNo || ""} ${student.phone || ""} ${student.email || ""}`,
  })), [students]);

  const staffOptions: SearchableSelectOption[] = useMemo(() => staff.map((member) => ({
    value: String(member.id),
    label: fullName(member),
    searchText: `${member.staffNo || ""} ${member.role || ""} ${member.phone || ""} ${member.email || ""}`,
  })), [staff]);

  const targetPayload = useMemo(() => ({
    targetAudience: selectedAudience,
    targetScope: selectedAudience === "all" ? "all" : selectedScope,
    targetStreamIds: selectedStreamIds.map(Number),
    targetClassIds: selectedClassIds.map(Number),
    targetStudentIds: selectedStudentIds.map(Number),
    targetStaffIds: selectedStaffIds.map(Number),
  }), [selectedAudience, selectedScope, selectedStreamIds, selectedClassIds, selectedStudentIds, selectedStaffIds]);

  const hasValidTarget = selectedAudience === "all"
    || selectedScope === "all"
    || (selectedScope === "streams" && selectedStreamIds.length > 0)
    || (selectedScope === "classes" && selectedClassIds.length > 0)
    || (selectedScope === "individuals" && (selectedAudience === "staff" ? selectedStaffIds.length > 0 : selectedStudentIds.length > 0));

  const {
    data: recipientCounts,
    isFetching: isPreviewLoading,
    isError: isPreviewError,
    error: recipientPreviewError,
  } = useQuery<RecipientPreview>({
    queryKey: ["/api/newsletters/recipient-preview", targetPayload],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/newsletters/recipient-preview", targetPayload);
      return res.json();
    },
    enabled: isAddOpen && hasValidTarget,
    retry: false,
  });

  // Use the same saved targeting as the publishing endpoint, not the draft editor selection.
  const publishTarget = publishCandidate ? {
    targetAudience: publishCandidate.targetAudience || "all",
    targetScope: publishCandidate.targetScope || "all",
    targetStreamIds: publishCandidate.targetStreamIds || [],
    targetClassIds: publishCandidate.targetClassIds || [],
    targetStudentIds: publishCandidate.targetStudentIds || [],
    targetStaffIds: publishCandidate.targetStaffIds || [],
  } : null;
  const publishPreview = useQuery<RecipientPreview>({
    queryKey: ["/api/newsletters/recipient-preview", "publish", publishCandidate?.id],
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/newsletters/recipient-preview", publishTarget);
      return response.json();
    },
    enabled: !!publishCandidate,
    staleTime: 0,
    retry: false,
  });
  const publishSms = publishCandidate ? estimateSmsSegments(newsletterSmsText(publishCandidate.content || "")) : null;
  const draftSms = estimateSmsSegments(newsletterSmsText(newsletterContent));

  const createNewsletter = useMutation({
    mutationFn: async (data: Partial<Newsletter>) => apiRequest("POST", "/api/newsletters", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      setIsAddOpen(false);
      resetTargeting();
      toast({ title: "Newsletter created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create newsletter", description: error.message, variant: "destructive" });
    },
  });

  const updateNewsletter = useMutation({
    mutationFn: async ({ id, isPublished }: { id: number; isPublished: boolean }) => apiRequest("PUT", `/api/newsletters/${id}`, { isPublished }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      setPublishCandidate(null);
      toast({ title: "Newsletter updated" });
    },
    onError: (error: Error) => toast({ title: "Failed to publish newsletter", description: error.message, variant: "destructive" }),
  });

  const deleteNewsletter = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/newsletters/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      toast({ title: "Newsletter deleted" });
    },
  });

  const toggleChannel = (channel: string) => {
    setSelectedChannels((previous) => previous.includes(channel)
      ? previous.filter((item) => item !== channel)
      : [...previous, channel]);
  };

  const handleAudienceChange = (value: NewsletterAudience) => {
    setSelectedAudience(value);
    setSelectedScope("all");
    setSelectedStreamIds([]);
    setSelectedClassIds([]);
    setSelectedStudentIds([]);
    setSelectedStaffIds([]);
  };

  const handleScopeChange = (value: NewsletterScope) => {
    setSelectedScope(value);
    setSelectedStreamIds([]);
    setSelectedClassIds([]);
    setSelectedStudentIds([]);
    setSelectedStaffIds([]);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedChannels.length === 0) return toast({ title: "Please select at least one channel", variant: "destructive" });
    if (!hasValidTarget) return toast({ title: "Please complete the target audience selection", variant: "destructive" });
    if (isPreviewError) return toast({ title: "Unable to verify recipients", description: recipientPreviewError instanceof Error ? recipientPreviewError.message : "Recipient preview failed", variant: "destructive" });
    if (!recipientCounts || recipientCounts.total === 0) return toast({ title: "The selected audience has no recipients", variant: "destructive" });
    createNewsletter.mutate({
      title: newsletterTitle,
      content: newsletterContent,
      ...targetPayload,
      channels: selectedChannels,
      isPublished: false,
      publishDate: null,
    });
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "Not published";
    return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  const previewText = isPreviewLoading
    ? "Checking recipients..."
    : isPreviewError
      ? "Unable to calculate recipients"
      : `${recipientCounts?.total ?? 0} matching recipients`;
  const previewErrorText = isPreviewError
    ? (recipientPreviewError instanceof Error ? recipientPreviewError.message : "Recipient preview failed")
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-page-title">Newsletters</h1>
            <p className="text-muted-foreground">School announcements and communications</p>
          </div>
        </div>
        <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) resetTargeting(); }}>
          <DialogTrigger asChild><Button data-testid="button-create-newsletter"><Plus className="h-4 w-4 mr-2" />New Newsletter</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
            <DialogHeader>
              <DialogTitle>Create Newsletter</DialogTitle>
              <DialogDescription>Compose a newsletter and select its exact audience.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="title">Title</Label><Input id="title" name="title" required value={newsletterTitle} onChange={(event) => setNewsletterTitle(event.target.value)} data-testid="input-newsletter-title" /></div>

              <div className="space-y-3 rounded-lg border p-3">
                <div className="space-y-2">
                  <Label>Recipient Group</Label>
                  <Select value={selectedAudience} onValueChange={(value) => handleAudienceChange(value as NewsletterAudience)}>
                    <SelectTrigger data-testid="select-audience"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Everyone</SelectItem>
                      <SelectItem value="parents">Parents Only</SelectItem>
                      <SelectItem value="students">Students Only</SelectItem>
                      <SelectItem value="staff">Staff Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {selectedAudience === "all" ? (
                  <p className="text-sm text-muted-foreground">All parents, students and staff in this school will be included.</p>
                ) : (
                  <div className="space-y-2">
                    <Label>Target Scope</Label>
                    <Select value={selectedScope} onValueChange={(value) => handleScopeChange(value as NewsletterScope)}>
                      <SelectTrigger data-testid="select-newsletter-target-scope"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All {selectedAudience === "parents" ? "Parents" : selectedAudience === "students" ? "Students" : "Staff"}</SelectItem>
                        {selectedAudience !== "staff" && <SelectItem value="streams">Streams</SelectItem>}
                        {selectedAudience !== "staff" && <SelectItem value="classes">Classes</SelectItem>}
                        <SelectItem value="individuals">Individuals</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {selectedScope === "streams" && selectedAudience !== "all" && selectedAudience !== "staff" && (
                  <div className="space-y-2"><Label>Select Streams</Label><SearchableMultiSelect values={selectedStreamIds} onValuesChange={setSelectedStreamIds} options={streamOptions} placeholder="Search and select streams" emptyText="No streams found for this school" data-testid="multiselect-newsletter-streams" /></div>
                )}
                {selectedScope === "classes" && selectedAudience !== "all" && selectedAudience !== "staff" && (
                  <div className="space-y-2"><Label>Select Classes</Label><SearchableMultiSelect values={selectedClassIds} onValuesChange={setSelectedClassIds} options={classOptions} placeholder="Search and select classes" emptyText="No classes found for this school" data-testid="multiselect-newsletter-classes" /></div>
                )}
                {selectedScope === "individuals" && selectedAudience === "staff" && (
                  <div className="space-y-2"><Label>Select Staff Members</Label><SearchableMultiSelect values={selectedStaffIds} onValuesChange={setSelectedStaffIds} options={staffOptions} placeholder="Search by staff name, number, role, phone or email" emptyText="No staff found for this school" data-testid="multiselect-newsletter-staff" /></div>
                )}
                {selectedScope === "individuals" && (selectedAudience === "parents" || selectedAudience === "students") && (
                  <div className="space-y-2">
                    <Label>{selectedAudience === "parents" ? "Search Students Linked to Parents" : "Select Students"}</Label>
                    <SearchableMultiSelect values={selectedStudentIds} onValuesChange={setSelectedStudentIds} options={studentOptions} placeholder="Search by student name or admission number" emptyText="No students found for this school" data-testid="multiselect-newsletter-students" />
                    {selectedAudience === "parents" && <p className="text-xs text-muted-foreground">Parents linked to the selected students will receive the newsletter.</p>}
                  </div>
                )}

                <div className={`rounded-md px-3 py-2 text-sm ${isPreviewError ? "border border-destructive/40 bg-destructive/5 text-destructive" : "bg-muted/50"}`} aria-live="polite">
                  <span className="font-medium">Recipient Preview:</span> {previewText}
                  {previewErrorText && <p className="mt-1 text-xs break-words">{previewErrorText}</p>}
                </div>
              </div>

              <div className="space-y-2"><Label htmlFor="content">Content</Label><Textarea id="content" name="content" rows={8} required value={newsletterContent} onChange={(event) => setNewsletterContent(event.target.value)} placeholder="Write your newsletter content here..." data-testid="input-newsletter-content" />
                {selectedChannels.includes("sms") && <p className="text-xs text-muted-foreground" data-testid="text-newsletter-sms-segments">SMS: {draftSms.characters} characters · {draftSms.encoding} · approximately {draftSms.segments} segment(s) per recipient. The full message will be sent without shortening.</p>}
              </div>
              <LanguageCheckButton fields={[
                { id: "newsletter-title", label: "Newsletter title", text: newsletterTitle, onChange: setNewsletterTitle },
                { id: "newsletter-content", label: "Newsletter content", text: newsletterContent, onChange: setNewsletterContent },
              ]} />

              <div className="space-y-3">
                <Label>Select Channels</Label>
                <div className="space-y-2">
                  {[
                    { key: "email", label: "Email", icon: Mail, count: recipientCounts?.email || 0 },
                    { key: "sms", label: "SMS", icon: MessageSquare, count: recipientCounts?.sms || 0 },
                    { key: "in_app", label: "In-App", icon: Bell, count: recipientCounts?.inApp || 0 },
                  ].map(({ key, label, icon: Icon, count }) => (
                    <Card key={key} className={`cursor-pointer transition-colors ${selectedChannels.includes(key) ? "border-primary/50 bg-primary/5" : ""}`} onClick={() => toggleChannel(key)} data-testid={`channel-${key}`}>
                      <CardContent className="flex items-center gap-3 p-3">
                        <Checkbox checked={selectedChannels.includes(key)} onClick={(e) => e.stopPropagation()} onCheckedChange={() => toggleChannel(key)} data-testid={`checkbox-${key}`} />
                        <Icon className="h-5 w-5 text-muted-foreground" /><span className="font-medium flex-1">{label}</span><span className="text-sm text-muted-foreground">({isPreviewLoading ? "checking..." : isPreviewError ? "unavailable" : `${count} recipients`})</span><CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      </CardContent>
                    </Card>
                  ))}
                  <Card className="opacity-60 cursor-not-allowed" data-testid="channel-whatsapp"><CardContent className="flex items-center gap-3 p-3"><Checkbox disabled data-testid="checkbox-whatsapp" /><MessageSquare className="h-5 w-5 text-muted-foreground" /><span className="font-medium flex-1">WhatsApp</span><div className="flex items-center gap-1.5 text-amber-500"><AlertCircle className="h-4 w-4" /><span className="text-sm font-medium">Coming Soon</span></div></CardContent></Card>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={createNewsletter.isPending || isPreviewLoading || isPreviewError || selectedChannels.length === 0 || !hasValidTarget || !recipientCounts?.total} data-testid="button-submit-newsletter">Save as Draft</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {newsletters.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-12"><Newspaper className="h-12 w-12 text-muted-foreground mb-4" /><h3 className="text-lg font-semibold mb-2">No Newsletters Yet</h3><p className="text-muted-foreground">Create your first newsletter to communicate with the school community</p></CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {newsletters.map((newsletter) => (
            <Card key={newsletter.id} className="hover-elevate" data-testid={`card-newsletter-${newsletter.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2"><Badge variant={newsletter.isPublished ? "default" : "outline"}>{newsletter.isPublished ? "Published" : "Draft"}</Badge><Button variant="ghost" size="icon" onClick={() => deleteNewsletter.mutate(newsletter.id)} data-testid={`button-delete-newsletter-${newsletter.id}`}><Trash2 className="h-4 w-4" /></Button></div>
                <CardTitle className="text-lg mt-2">{newsletter.title}</CardTitle>
                <CardDescription className="flex items-center gap-1"><Calendar className="h-4 w-4" />{formatDate(newsletter.publishDate)}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3 mb-4">{newsletter.content}</p>
                <div className="flex items-center gap-2 flex-wrap"><Badge variant="outline">{audienceLabel(newsletter.targetAudience)}</Badge><Badge variant="outline">{scopeLabel(newsletter)}</Badge>{newsletter.channels?.map((channel) => <Badge key={channel} variant="secondary">{channel === "in_app" ? "In-App" : channel.toUpperCase()}</Badge>)}</div>
                <div className="flex gap-2 mt-4"><Button variant="outline" size="sm" onClick={() => setViewNewsletter(newsletter)} data-testid={`button-view-${newsletter.id}`}><Eye className="h-4 w-4 mr-1" />View</Button>{!newsletter.isPublished && <Button size="sm" onClick={() => setPublishCandidate(newsletter)} data-testid={`button-publish-${newsletter.id}`}><Send className="h-4 w-4 mr-1" />Publish</Button>}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!publishCandidate} onOpenChange={(open) => { if (!open && !updateNewsletter.isPending) setPublishCandidate(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Newsletter Publication</DialogTitle>
            <DialogDescription>Publishing sends to the selected recipients. Verify SMS usage before continuing; this operation cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p><span className="font-medium">Newsletter:</span> {publishCandidate?.title}</p>
            {publishCandidate?.channels?.includes("sms") && <>
              <p data-testid="publish-newsletter-segments"><span className="font-medium">SMS:</span> {publishSms?.characters} characters · {publishSms?.encoding} · {publishSms?.segments} estimated segment(s) per recipient</p>
              <p><span className="font-medium">SMS recipients:</span> {publishPreview.isLoading ? "Calculating…" : publishPreview.data?.sms ?? "Unavailable"}</p>
              <p><span className="font-medium">Estimated total SMS segments:</span> {publishPreview.data && publishSms ? publishPreview.data.sms * publishSms.segments : "Unavailable"}</p>
              <p className="text-xs text-muted-foreground">Estimates depend on provider encoding and delivery; no newsletter text will be truncated.</p>
            </>}
            {publishPreview.isError && <p role="alert" className="text-destructive">Unable to verify recipients. Publication is blocked until the preview succeeds.</p>}
            {publishPreview.data && <p>{publishPreview.data.total} matching recipients across selected audience.</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPublishCandidate(null)} disabled={updateNewsletter.isPending}>Cancel</Button>
            <Button
              data-testid="button-confirm-publish-newsletter"
              disabled={updateNewsletter.isPending || !publishCandidate || !publishPreview.data?.total || publishPreview.isFetching || (publishCandidate.channels?.includes("sms") && (!publishPreview.data?.sms || !publishSms?.segments))}
              onClick={() => publishCandidate && updateNewsletter.mutate({ id: publishCandidate.id, isPublished: true })}
            >{updateNewsletter.isPending ? "Publishing…" : "Confirm & Publish"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewNewsletter} onOpenChange={() => setViewNewsletter(null)}>
        <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader><DialogTitle>{viewNewsletter?.title}</DialogTitle><DialogDescription>Published: {formatDate(viewNewsletter?.publishDate ?? null)} · {viewNewsletter ? audienceLabel(viewNewsletter.targetAudience) : ""} · {viewNewsletter ? scopeLabel(viewNewsletter) : ""}</DialogDescription></DialogHeader>
          <div className="prose prose-sm max-w-none"><p className="whitespace-pre-wrap">{viewNewsletter?.content}</p></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
