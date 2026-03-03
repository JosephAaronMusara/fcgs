import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mail,
  MessageSquare,
  Search,
  ChevronLeft,
  ChevronRight,
  Phone,
  AtSign,
  Bell,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
} from "lucide-react";

interface CommunicationLog {
  id: number;
  schoolId: number | null;
  channel: "email" | "sms" | "in_app" | "whatsapp";
  recipientType: string;
  recipientId: number | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
  recipientName: string | null;
  subject: string | null;
  message: string;
  category: string | null;
  status: "pending" | "sent" | "failed" | "delivered" | null;
  errorMessage: string | null;
  sentAt: string | null;
  sentBy: number | null;
  createdAt: string | null;
}

interface LogsResponse {
  logs: CommunicationLog[];
  total: number;
  page: number;
  totalPages: number;
}

const RECIPIENT_TYPES = [
  { value: "all", label: "All Recipients" },
  { value: "staff", label: "Staff" },
  { value: "parent", label: "Parents" },
  { value: "student", label: "Students" },
  { value: "org_admin", label: "Org HQ" },
];

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "attendance", label: "Attendance" },
  { value: "academic_reports", label: "Academic Reports" },
  { value: "account", label: "Account" },
  { value: "notices", label: "Notices" },
  { value: "general", label: "General" },
];

const CHANNELS = [
  { value: "all", label: "All Platforms" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "in_app", label: "In-App" },
];

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Harare",
  });
}

function getStatusVariant(status: string | null): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "sent":
    case "delivered":
      return "default";
    case "failed":
      return "destructive";
    case "pending":
      return "secondary";
    default:
      return "outline";
  }
}

function getStatusIcon(status: string | null) {
  switch (status) {
    case "sent":
    case "delivered":
      return CheckCircle2;
    case "failed":
      return XCircle;
    case "pending":
      return Clock;
    default:
      return Clock;
  }
}

function getCategoryLabel(cat: string | null): string {
  if (!cat) return "General";
  const found = CATEGORIES.find(c => c.value === cat);
  return found ? found.label : cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, " ");
}

function getChannelIcon(channel: string) {
  switch (channel) {
    case "email":
      return AtSign;
    case "sms":
      return Phone;
    case "in_app":
      return Bell;
    default:
      return MessageSquare;
  }
}

export default function MessagesPage() {
  const { currentSchoolId } = useAuth();
  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [recipientType, setRecipientType] = useState("all");
  const [category, setCategory] = useState("all");
  const [channel, setChannel] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);

  const queryParams = new URLSearchParams();
  if (startDate) queryParams.set("startDate", startDate);
  if (endDate) queryParams.set("endDate", endDate);
  if (recipientType !== "all") queryParams.set("recipientType", recipientType);
  if (category !== "all") queryParams.set("category", category);
  if (channel !== "all") queryParams.set("channel", channel);
  if (search) queryParams.set("search", search);
  queryParams.set("page", String(page));

  const { data, isLoading } = useQuery<LogsResponse>({
    queryKey: ["/api/communication/logs", startDate, endDate, recipientType, category, channel, search, page],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/communication/logs?${queryParams.toString()}`);
      return res.json();
    },
  });

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleFilterChange = (setter: (val: string) => void) => (val: string) => {
    setter(val);
    setPage(1);
  };

  const logs = data?.logs || [];
  const totalPages = data?.totalPages || 1;
  const total = data?.total || 0;

  return (
    <div className="space-y-6" data-testid="messages-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between flex-wrap">
        <div className="flex items-center gap-3">
          <Mail className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }} data-testid="text-page-title">Messages History</h1>
            <p className="text-muted-foreground">Communication log of all messages sent to recipients</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs" data-testid="badge-total-messages">
            {total} message{total !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search messages..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
            <Button variant="outline" size="icon" onClick={handleSearch} data-testid="button-search">
              <Search className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="w-[150px]"
                data-testid="input-start-date"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="w-[150px]"
                data-testid="input-end-date"
              />
            </div>
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <Select value={recipientType} onValueChange={handleFilterChange(setRecipientType)}>
              <SelectTrigger className="w-[150px]" data-testid="select-recipient-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECIPIENT_TYPES.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={handleFilterChange(setCategory)}>
              <SelectTrigger className="w-[170px]" data-testid="select-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={channel} onValueChange={handleFilterChange(setChannel)}>
              <SelectTrigger className="w-[140px]" data-testid="select-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground" data-testid="text-no-messages">
          <Mail className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No messages found</p>
          <p className="text-sm mt-1">Try adjusting your filters or date range</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const ChannelIcon = getChannelIcon(log.channel);
            const StatusIcon = getStatusIcon(log.status);
            const recipient = log.recipientName || log.recipientPhone || log.recipientEmail || "Unknown";
            const charCount = log.message.length;
            const smsCount = log.channel === "sms" ? Math.ceil(charCount / 160) : null;

            return (
              <Card key={log.id} className="p-4" data-testid={`message-card-${log.id}`}>
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-sm" data-testid={`text-message-date-${log.id}`}>
                        {formatDateTime(log.createdAt)}
                      </span>
                      <span className="text-muted-foreground text-sm">-</span>
                      <span className="text-sm font-medium truncate" data-testid={`text-message-recipient-${log.id}`}>
                        {recipient}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <Badge variant="secondary" className="text-[10px] gap-1">
                        <ChannelIcon className="w-3 h-3" />
                        {log.channel === "in_app" ? "IN-APP" : log.channel.toUpperCase()}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {log.recipientType}
                      </Badge>
                      {log.category && (
                        <Badge variant="outline" className="text-[10px]">
                          {getCategoryLabel(log.category)}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed" data-testid={`text-message-body-${log.id}`}>
                    {log.message.length > 300 ? log.message.substring(0, 300) + "..." : log.message}
                  </p>

                  <div className="flex items-center gap-4 flex-wrap text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge variant={getStatusVariant(log.status)} className="text-[10px] gap-1">
                        <StatusIcon className="w-3 h-3" />
                        {(log.status || "unknown").toUpperCase()}
                      </Badge>
                    </div>
                    <span className="text-muted-foreground">
                      Characters: {charCount}
                    </span>
                    {smsCount !== null && (
                      <span className="text-muted-foreground">
                        SMS Count: {smsCount}
                      </span>
                    )}
                    {log.channel === "email" && log.recipientEmail && (
                      <span className="text-muted-foreground flex items-center gap-1">
                        <AtSign className="w-3 h-3" />
                        {log.recipientEmail}
                      </span>
                    )}
                    {log.channel === "sms" && log.recipientPhone && (
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {log.recipientPhone}
                      </span>
                    )}
                    {log.errorMessage && (
                      <span className="text-destructive text-xs truncate max-w-[300px]" data-testid={`text-error-${log.id}`}>
                        Error: {log.errorMessage}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages} ({total} total)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  data-testid="button-next-page"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
