import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, schoolFetch } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableMultiSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { Mail, MessageSquare, MessageCircle, Bell, AlertCircle, CheckCircle } from "lucide-react";
import type { Class, School, Staff, Stream, Student } from "@shared/schema";
import { LanguageCheckButton } from "@/features/language-tools";

interface NotifyRecipient {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
}

interface NotifyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientType: "staff" | "student" | "parent";
  recipients: NotifyRecipient[];
  schoolId?: number | null;
  selectedIds?: number[];
  search?: string;
  classFilter?: string;
  statusFilter?: string;
}

type CommunicationStatus = { email: boolean; sms: boolean; whatsapp: boolean; in_app: boolean };
type ChannelType = "email" | "sms" | "in_app" | "whatsapp";
type TargetAudience = "selected" | "all" | "streams" | "classes" | "individuals";
type PaginatedResponse<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };
type RecipientPreview = { total: number; email: number; sms: number; inApp: number };

function fullName(item: { firstName?: string | null; lastName?: string | null }) {
  return `${item.firstName || ""} ${item.lastName || ""}`.trim();
}

function getClassLabel(cls: Class) {
  return cls.shortCode?.trim() || cls.className;
}

export function NotifyModal({
  open,
  onOpenChange,
  recipientType,
  recipients,
  schoolId,
  selectedIds = [],
  search = "",
  classFilter = "all",
  statusFilter = "all",
}: NotifyModalProps) {
  const { toast } = useToast();
  const [selectedChannels, setSelectedChannels] = useState<Set<ChannelType>>(() => new Set<ChannelType>(["email"]));
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [targetAudience, setTargetAudience] = useState<TargetAudience>(selectedIds.length > 0 ? "selected" : "all");
  const [selectedStreamIds, setSelectedStreamIds] = useState<string[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [selectedIndividualStudentIds, setSelectedIndividualStudentIds] = useState<string[]>([]);
  const [selectedIndividualStaffIds, setSelectedIndividualStaffIds] = useState<string[]>([]);

  const supportsStudentAudience = recipientType === "student" || recipientType === "parent";

  useEffect(() => {
    if (!open) return;
    setTargetAudience(selectedIds.length > 0 ? "selected" : "all");
    setSelectedStreamIds([]);
    setSelectedClassIds([]);
    setSelectedIndividualStudentIds([]);
    setSelectedIndividualStaffIds([]);
  }, [open, selectedIds.length]);

  const { data: status } = useQuery<CommunicationStatus>({ queryKey: ["/api/communication/status"], enabled: open });

  const { data: school } = useQuery<School>({
    queryKey: ["/api/schools/current"],
    queryFn: async () => {
      const res = await schoolFetch("/api/schools/current");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: open && supportsStudentAudience,
  });

  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes", schoolId, "notify"],
    queryFn: async () => {
      const res = await schoolFetch("/api/classes");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: open && supportsStudentAudience,
  });

  const { data: streams = [] } = useQuery<Stream[]>({
    queryKey: ["/api/streams", school?.schoolType || "all", schoolId, "notify"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (school?.schoolType) params.set("schoolType", school.schoolType);
      const res = await schoolFetch(`/api/streams${params.toString() ? `?${params.toString()}` : ""}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: open && supportsStudentAudience,
  });

  const shouldLoadStudentDirectory = open && supportsStudentAudience && targetAudience === "individuals";
  const { data: studentDirectory = [] } = useQuery<Student[]>({
    queryKey: ["/api/students", "notify-directory", schoolId],
    queryFn: async () => {
      const params = new URLSearchParams({ paginated: "true", page: "1", pageSize: "100000", status: "active" });
      const res = await schoolFetch(`/api/students?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const page = (await res.json()) as PaginatedResponse<Student>;
      return page.items || [];
    },
    enabled: shouldLoadStudentDirectory,
  });

  const shouldLoadStaffDirectory = open && recipientType === "staff" && targetAudience === "individuals";
  const { data: staffDirectory = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", "notify-directory", schoolId],
    queryFn: async () => {
      const params = new URLSearchParams({ paginated: "true", page: "1", pageSize: "100000" });
      const res = await schoolFetch(`/api/staff?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const page = (await res.json()) as PaginatedResponse<Staff>;
      return page.items || [];
    },
    enabled: shouldLoadStaffDirectory,
  });

  const classOptions: SearchableSelectOption[] = useMemo(() => classes.map((cls) => ({
    value: String(cls.id),
    label: getClassLabel(cls),
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

  const studentOptions: SearchableSelectOption[] = useMemo(() => studentDirectory.map((student) => ({
    value: String(student.id),
    label: `${fullName(student)}${student.admissionNo ? ` (${student.admissionNo})` : ""}`,
    searchText: `${student.admissionNo || ""} ${student.phone || ""} ${student.email || ""}`,
  })), [studentDirectory]);

  const staffOptions: SearchableSelectOption[] = useMemo(() => staffDirectory.map((staff) => ({
    value: String(staff.id),
    label: fullName(staff),
    searchText: `${staff.staffNo || ""} ${staff.role || ""} ${staff.phone || ""} ${staff.email || ""}`,
  })), [staffDirectory]);

  const selectedIndividualIds = recipientType === "staff" ? selectedIndividualStaffIds : selectedIndividualStudentIds;
  const hasValidTarget = targetAudience === "selected" ? recipients.length > 0
    : targetAudience === "streams" ? selectedStreamIds.length > 0
    : targetAudience === "classes" ? selectedClassIds.length > 0
    : targetAudience === "individuals" ? selectedIndividualIds.length > 0
    : true;

  const previewPayload = useMemo(() => ({
    recipientType,
    recipientIds: targetAudience === "selected" ? recipients.map(r => r.id) : [],
    targetAudience,
    streamIds: selectedStreamIds.map(Number),
    classIds: selectedClassIds.map(Number),
    studentIds: selectedIndividualStudentIds.map(Number),
    staffIds: selectedIndividualStaffIds.map(Number),
    search,
    classFilter,
    statusFilter,
    schoolId: schoolId || undefined,
  }), [recipientType, recipients, targetAudience, selectedStreamIds, selectedClassIds, selectedIndividualStudentIds, selectedIndividualStaffIds, search, classFilter, statusFilter, schoolId]);

  const { data: preview, isFetching: isPreviewLoading } = useQuery<RecipientPreview>({
    queryKey: ["/api/communication/preview-recipients", previewPayload],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/communication/preview-recipients", previewPayload);
      return res.json();
    },
    enabled: open && hasValidTarget,
  });

  const sendNotification = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/communication/send", data),
    onSuccess: async (response) => {
      const result = await response.json();
      toast({ title: result.queued ? "Notification queued" : "Notification sent", description: result.message || `Sent: ${result.sent}, Failed: ${result.failed}` });
      onOpenChange(false);
      setSubject("");
      setMessage("");
    },
    onError: (error: Error) => toast({ title: "Failed to send", description: error.message, variant: "destructive" }),
  });

  const toggleChannel = (channel: ChannelType) => {
    const newChannels = new Set<ChannelType>(selectedChannels);
    newChannels.has(channel) ? newChannels.delete(channel) : newChannels.add(channel);
    setSelectedChannels(newChannels);
  };

  const handleSend = () => {
    if (!message.trim()) return toast({ title: "Please enter a message", variant: "destructive" });
    if (selectedChannels.has("email") && !subject.trim()) return toast({ title: "Please enter a subject for email", variant: "destructive" });
    if (selectedChannels.size === 0) return toast({ title: "Please select at least one channel", variant: "destructive" });
    if (targetAudience === "streams" && selectedStreamIds.length === 0) return toast({ title: "Please select at least one stream", variant: "destructive" });
    if (targetAudience === "classes" && selectedClassIds.length === 0) return toast({ title: "Please select at least one class", variant: "destructive" });
    if (targetAudience === "individuals" && selectedIndividualIds.length === 0) return toast({ title: recipientType === "staff" ? "Please select at least one staff member" : "Please select at least one student", variant: "destructive" });
    const channels = Array.from(selectedChannels).filter(ch => ch !== "whatsapp");
    if (channels.length === 0) return toast({ title: "No available channels selected", variant: "destructive" });

    sendNotification.mutate({ ...previewPayload, channels, subject: selectedChannels.has("email") ? subject : undefined, message });
  };

  const canSend = () => {
    if (selectedChannels.size === 0 || !hasValidTarget || !preview || preview.total === 0) return false;
    const activeChannels = Array.from(selectedChannels).filter(ch => ch !== "whatsapp");
    if (activeChannels.length === 0) return false;
    if (selectedChannels.has("email") && (!status?.email || preview.email === 0)) return false;
    if (selectedChannels.has("sms") && (!status?.sms || preview.sms === 0)) return false;
    return true;
  };

  const getButtonText = () => {
    const channels = Array.from(selectedChannels).filter(ch => ch !== "whatsapp");
    if (channels.length === 1) return channels[0] === "email" ? "Send Email" : channels[0] === "sms" ? "Send SMS" : "Send In-App";
    return channels.length > 1 ? "Send All" : "Send";
  };

  const recipientDescription = isPreviewLoading
    ? `Checking matching ${recipientType}s...`
    : `Send a message to ${preview?.total || 0} ${recipientType}${(preview?.total || 0) === 1 ? "" : "s"}`;

  const countText = (count?: number) => isPreviewLoading ? "checking..." : `${count || 0} recipients`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Send Notification</DialogTitle>
          <DialogDescription>{recipientDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-2">
              <Label>Target Audience</Label>
              <Select value={targetAudience} onValueChange={(value) => setTargetAudience(value as TargetAudience)}>
                <SelectTrigger data-testid="select-target-audience"><SelectValue placeholder="Select target audience" /></SelectTrigger>
                <SelectContent>
                  {selectedIds.length > 0 && <SelectItem value="selected">Selected Records ({selectedIds.length})</SelectItem>}
                  <SelectItem value="all">All</SelectItem>
                  {supportsStudentAudience && <SelectItem value="streams">Streams</SelectItem>}
                  {supportsStudentAudience && <SelectItem value="classes">Classes</SelectItem>}
                  <SelectItem value="individuals">Individuals</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {targetAudience === "streams" && supportsStudentAudience && <div className="space-y-2"><Label>Select Streams</Label><SearchableMultiSelect values={selectedStreamIds} onValuesChange={setSelectedStreamIds} options={streamOptions} placeholder="Search and select streams" emptyText="No streams found for this school" data-testid="multiselect-notify-streams" /></div>}
            {targetAudience === "classes" && supportsStudentAudience && <div className="space-y-2"><Label>Select Classes</Label><SearchableMultiSelect values={selectedClassIds} onValuesChange={setSelectedClassIds} options={classOptions} placeholder="Search and select classes" emptyText="No classes found for this school" data-testid="multiselect-notify-classes" /></div>}
            {targetAudience === "individuals" && recipientType === "staff" && <div className="space-y-2"><Label>Select Staff Members</Label><SearchableMultiSelect values={selectedIndividualStaffIds} onValuesChange={setSelectedIndividualStaffIds} options={staffOptions} placeholder="Search by staff name, staff number, role, phone, or email" emptyText="No staff found for this school" data-testid="multiselect-notify-staff-individuals" /></div>}
            {targetAudience === "individuals" && supportsStudentAudience && <div className="space-y-2"><Label>{recipientType === "parent" ? "Search Students Linked to Parents" : "Select Students"}</Label><SearchableMultiSelect values={selectedIndividualStudentIds} onValuesChange={setSelectedIndividualStudentIds} options={studentOptions} placeholder="Search by student name or admission number" emptyText="No students found for this school" data-testid="multiselect-notify-individuals" />{recipientType === "parent" && <p className="text-xs text-muted-foreground">Parents linked to the selected students will receive the message.</p>}</div>}
          </div>
          <div className="space-y-3">
            <Label>Select Channels</Label>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 p-3 rounded-lg border"><Checkbox id="channel-email" checked={selectedChannels.has("email")} onCheckedChange={() => toggleChannel("email")} disabled={!status?.email} data-testid="checkbox-email" /><Label htmlFor="channel-email" className="flex items-center gap-2 flex-1 cursor-pointer"><Mail className="h-4 w-4" />Email<span className="text-xs text-muted-foreground">({countText(preview?.email)})</span></Label>{status?.email ? <CheckCircle className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-yellow-500" />}</div>
              <div className="flex items-center gap-3 p-3 rounded-lg border"><Checkbox id="channel-sms" checked={selectedChannels.has("sms")} onCheckedChange={() => toggleChannel("sms")} disabled={!status?.sms} data-testid="checkbox-sms" /><Label htmlFor="channel-sms" className="flex items-center gap-2 flex-1 cursor-pointer"><MessageSquare className="h-4 w-4" />SMS<span className="text-xs text-muted-foreground">({countText(preview?.sms)})</span></Label>{status?.sms ? <CheckCircle className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-yellow-500" />}</div>
              <div className="flex items-center gap-3 p-3 rounded-lg border"><Checkbox id="channel-in-app" checked={selectedChannels.has("in_app")} onCheckedChange={() => toggleChannel("in_app")} data-testid="checkbox-in-app" /><Label htmlFor="channel-in-app" className="flex items-center gap-2 flex-1 cursor-pointer"><Bell className="h-4 w-4" />In-App<span className="text-xs text-muted-foreground">({countText(preview?.inApp)})</span></Label><CheckCircle className="h-4 w-4 text-green-500" /></div>
              <div className="flex items-center gap-3 p-3 rounded-lg border opacity-60"><Checkbox id="channel-whatsapp" checked={false} disabled data-testid="checkbox-whatsapp" /><Label htmlFor="channel-whatsapp" className="flex items-center gap-2 flex-1 cursor-not-allowed"><MessageCircle className="h-4 w-4" />WhatsApp</Label><div className="flex items-center gap-1.5"><div className="flex items-center justify-center w-4 h-4 rounded-full bg-yellow-500 text-white text-xs font-bold">!</div><span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">Coming Soon</span></div></div>
            </div>
          </div>
          {selectedChannels.has("email") && <div className="space-y-2"><Label htmlFor="subject">Subject</Label><Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Enter email subject" data-testid="input-email-subject" /></div>}
          <div className="space-y-2"><Label htmlFor="message">Message</Label><Textarea id="message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Enter your message..." rows={5} data-testid="input-message" />{selectedChannels.has("sms") && !selectedChannels.has("email") && <div className="text-xs text-muted-foreground text-right">{message.length} / 160 characters (standard SMS)</div>}</div>
          <LanguageCheckButton
            fields={[
              ...(selectedChannels.has("email") ? [{ id: "notify-subject", label: "Subject", text: subject, onChange: setSubject }] : []),
              { id: "notify-message", label: "Message", text: message, onChange: setMessage },
            ]}
            className="w-full"
          />
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={handleSend} disabled={sendNotification.isPending || !canSend()} data-testid="button-send-notification">{sendNotification.isPending ? "Sending..." : getButtonText()}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
