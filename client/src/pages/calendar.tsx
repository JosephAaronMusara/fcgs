import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  List,
  X,
  School,
  Users,
  Pencil,
  Trash2,
  MapPin,
  Clock3,
  Layers3,
  UserRound,
  CheckCircle2,
  Eye,
  ArrowRight,
  Building2,
  CalendarRange,
} from "lucide-react";

type CalendarScope = "personal" | "class" | "school" | "org";

type SchoolRow = {
  id: number;
  name: string;
  shortCode?: string | null;
};

type ClassRow = {
  id: number;
  className?: string;
  shortCode?: string | null;
  schoolId?: number | null;
};

type StaffRow = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  staffNo?: string | null;
  role?: string | null;
  status?: string | null;
  schoolId?: number | null;
};

const SCOPE_STYLES: Record<
  string,
  {
    label: string;
    chipClass: string;
    badgeClass: string;
    borderClass: string;
    dotClass: string;
  }
> = {
  org: {
    label: "HQ",
    chipClass: "bg-[#082058]/12 text-[#082058] border border-[#082058]/25",
    badgeClass: "bg-[#082058] text-white border-transparent",
    borderClass: "border-l-[#082058]",
    dotClass: "bg-[#082058]",
  },
  school: {
    label: "School",
    chipClass: "bg-[#A82028]/12 text-[#A82028] border border-[#A82028]/25",
    badgeClass: "bg-[#A82028] text-white border-transparent",
    borderClass: "border-l-[#A82028]",
    dotClass: "bg-[#A82028]",
  },
  class: {
    label: "Class",
    chipClass: "bg-[#788080]/16 text-[#4f5858] border border-[#788080]/30",
    badgeClass: "bg-[#788080] text-white border-transparent",
    borderClass: "border-l-[#788080]",
    dotClass: "bg-[#788080]",
  },
  personal: {
    label: "Personal",
    chipClass: "bg-[#00B8F0]/14 text-[#087da3] border border-[#00B8F0]/28",
    badgeClass: "bg-[#00B8F0] text-white border-transparent",
    borderClass: "border-l-[#00B8F0]",
    dotClass: "bg-[#00B8F0]",
  },
};

function getScopeMeta(scope: unknown) {
  const key = String(scope || "personal");
  return SCOPE_STYLES[key] || SCOPE_STYLES.personal;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfWeek(date: Date) {
  const copy = startOfWeek(date);
  copy.setDate(copy.getDate() + 6);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function parseEventDate(event: any): Date | null {
  const rawDate =
    event?.start_at ??
    event?.startAt ??
    event?.startDate ??
    event?.start ??
    event?.date ??
    event?.eventDate;

  if (!rawDate) return null;

  const parsed = new Date(rawDate);
  return isValidDate(parsed) ? parsed : null;
}

function parseEventEndDate(event: any): Date | null {
  const rawDate =
    event?.end_at ??
    event?.endAt ??
    event?.endDate ??
    event?.end;

  if (!rawDate) return null;

  const parsed = new Date(rawDate);
  return isValidDate(parsed) ? parsed : null;
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function buildCalendarDays(viewDate: Date) {
  if (!isValidDate(viewDate)) return [];

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);

  const days: Date[] = [];
  const current = new Date(gridStart);

  while (current <= gridEnd) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return days;
}

function toIsoString(date: Date | undefined | null) {
  if (!date || !isValidDate(date)) return new Date().toISOString();
  return date.toISOString();
}

function formatEventDate(dateValue: string | Date | null | undefined) {
  if (!dateValue) return "Date unavailable";

  const date = new Date(dateValue);
  if (!isValidDate(date)) return "Date unavailable";

  return date.toLocaleString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatEventDateOnly(dateValue: string | Date | null | undefined) {
  if (!dateValue) return "Date unavailable";

  const date = new Date(dateValue);
  if (!isValidDate(date)) return "Date unavailable";

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function toLocalDateTimeInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function classLabel(item: ClassRow) {
  return item.shortCode
    ? `${item.className || "Unnamed Class"} (${item.shortCode})`
    : item.className || `Class #${item.id}`;
}

function staffLabel(item: StaffRow) {
  const fullName =
    `${item.firstName || ""} ${item.lastName || ""}`.trim() || `Staff #${item.id}`;
  return item.staffNo ? `${fullName} (${item.staffNo})` : fullName;
}

function schoolLabel(item: SchoolRow) {
  return item.shortCode ? `${item.name} (${item.shortCode})` : item.name;
}

function formatAudienceText(event: any) {
  const scope = String(event?.scope || "personal");

  if (scope === "personal") return "Private to you";

  if (scope === "class") {
    const parts: string[] = [];
    if (event?.include_students ?? event?.includeStudents ?? false) parts.push("Students");
    if (event?.include_parents ?? event?.includeParents ?? false) parts.push("Parents");
    return parts.length > 0 ? `Visible to ${parts.join(" + ")}` : "Class staff only";
  }

  if (scope === "school" || scope === "org") {
    const parts: string[] = ["Staff"];
    if (event?.include_students ?? event?.includeStudents ?? false) parts.push("Students");
    if (event?.include_parents ?? event?.includeParents ?? false) parts.push("Parents");
    return `Visible to ${parts.join(" + ")}`;
  }

  return "Audience not specified";
}

function getEventLocation(event: any) {
  return event?.location || null;
}

function getEventAllDay(event: any) {
  return Boolean(event?.all_day ?? event?.allDay ?? false);
}

function getEventClassIds(event: any) {
  return normalizeNumberArray(event?.class_ids ?? event?.classIds ?? []);
}

function getEventSchoolId(event: any): number | null {
  const value = event?.school_id ?? event?.schoolId ?? null;
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getEventTimezone(event: any) {
  return String(event?.timezone || "Africa/Harare");
}

function formatEventRange(event: any) {
  const start =
    event?.start_at ??
    event?.startAt ??
    event?.startDate ??
    event?.start ??
    event?.date ??
    event?.eventDate;

  const end =
    event?.end_at ??
    event?.endAt ??
    event?.endDate ??
    event?.end;

  if (getEventAllDay(event)) {
    return formatEventDateOnly(start);
  }

  if (!end) return formatEventDate(start);

  return `${formatEventDate(start)} → ${formatEventDate(end)}`;
}

function EventListCard({
  event,
  onOpen,
  onEdit,
  onDelete,
}: {
  event: any;
  onOpen: (event: any) => void;
  onEdit: (event: any) => void;
  onDelete: (event: any) => void;
}) {
  const eventDate = parseEventDate(event);
  const meta = getScopeMeta(event.scope);

  return (
    <div
      className={`rounded-xl border-l-4 p-3 transition hover:bg-muted/30 ${meta.borderClass}`}
      data-testid={`calendar-event-list-item-${event.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onOpen(event)}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`h-2.5 w-2.5 rounded-full ${meta.dotClass}`} />
            <p className="text-sm font-medium truncate">
              {event.title || "Untitled event"}
            </p>
            <Badge className={meta.badgeClass}>{meta.label}</Badge>
            {getEventAllDay(event) && <Badge variant="secondary">All day</Badge>}
          </div>

          <p className="text-xs text-muted-foreground mt-1">
            {eventDate ? formatEventRange(event) : "Date unavailable"}
          </p>

          {getEventLocation(event) && (
            <p className="text-xs text-muted-foreground mt-1">
              Location: {getEventLocation(event)}
            </p>
          )}

          <p className="text-xs text-muted-foreground mt-1">
            {formatAudienceText(event)}
          </p>

          {event.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {event.description}
            </p>
          )}
        </button>

        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpen(event)}
            data-testid={`button-view-event-list-${event.id}`}
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(event)}
            data-testid={`button-edit-event-list-${event.id}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(event)}
            data-testid={`button-delete-event-list-${event.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEventListOpen, setIsEventListOpen] = useState(false);
  const [viewingEvent, setViewingEvent] = useState<any | null>(null);

  const [scope, setScope] = useState<CalendarScope>("personal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startAt, setStartAt] = useState(
    toLocalDateTimeInputValue(new Date())
  );
  const [endAt, setEndAt] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 60 * 60 * 1000))
  );
  const [allDay, setAllDay] = useState(false);
  const [includeStudents, setIncludeStudents] = useState(true);
  const [includeParents, setIncludeParents] = useState(false);
  const [attendanceExpectation, setAttendanceExpectation] = useState<"normal" | "no_regular_attendance">("normal");

  const [selectedSchoolId, setSelectedSchoolId] = useState<number | null>(null);
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>([]);
  const [selectedStaffViewerIds, setSelectedStaffViewerIds] = useState<number[]>([]);
  const [classFilter, setClassFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");

  const [selectedOrgSchoolIds, setSelectedOrgSchoolIds] = useState<number[]>([]);
  const [orgSchoolFilter, setOrgSchoolFilter] = useState("");
  const [orgStaffFilter, setOrgStaffFilter] = useState("");
  const [previewOrgStaffIds, setPreviewOrgStaffIds] = useState<number[]>([]);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [eventBeingEdited, setEventBeingEdited] = useState<any | null>(null);
  const [editScope, setEditScope] = useState<CalendarScope>("personal");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStartAt, setEditStartAt] = useState("");
  const [editEndAt, setEditEndAt] = useState("");
  const [editAllDay, setEditAllDay] = useState(false);
  const [editIncludeStudents, setEditIncludeStudents] = useState(true);
  const [editIncludeParents, setEditIncludeParents] = useState(false);
  const [editAttendanceExpectation, setEditAttendanceExpectation] = useState<"normal" | "no_regular_attendance">("normal");
  const [editClassIds, setEditClassIds] = useState<number[]>([]);
  const [editStaffViewerIds, setEditStaffViewerIds] = useState<number[]>([]);

  const [eventToDelete, setEventToDelete] = useState<any | null>(null);

  const calendarDays = useMemo(() => buildCalendarDays(viewDate), [viewDate]);

  const preloadRangeStart = useMemo(() => {
    const firstVisible = calendarDays[0] ?? startOfWeek(startOfMonth(new Date()));
    const copy = new Date(firstVisible);
    copy.setDate(copy.getDate() - 35);
    return copy;
  }, [calendarDays]);

  const preloadRangeEnd = useMemo(() => {
    const lastVisible =
      calendarDays[calendarDays.length - 1] ?? endOfWeek(endOfMonth(new Date()));
    const copy = new Date(lastVisible);
    copy.setDate(copy.getDate() + 35);
    return copy;
  }, [calendarDays]);

  const {
    data: events = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["/api/calendar/events", toIsoString(preloadRangeStart), toIsoString(preloadRangeEnd)],
    queryFn: async () => {
      const from = encodeURIComponent(toIsoString(preloadRangeStart));
      const to = encodeURIComponent(toIsoString(preloadRangeEnd));

      const response = await fetch(`/api/calendar/events?from=${from}&to=${to}`, {
        credentials: "include",
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.message || "Failed to load calendar events");
      }

      return Array.isArray(body?.events) ? body.events : [];
    },
    refetchOnMount: "always",
  });

  const { data: schools = [], isLoading: schoolsLoading } = useQuery<SchoolRow[]>({
    queryKey: ["/api/schools"],
    queryFn: async () => {
      const response = await fetch("/api/schools", {
        credentials: "include",
      });
      const body = await response.json().catch(() => []);

      if (!response.ok) {
        throw new Error(body?.message || "Failed to load schools");
      }

      return Array.isArray(body) ? body : [];
    },
    enabled: isCreateOpen || !!viewingEvent || scope === "class" || scope === "org",
  });

  const { data: classes = [], isLoading: classesLoading } = useQuery<ClassRow[]>({
    queryKey: ["/api/classes", selectedSchoolId],
    queryFn: async () => {
      const response = await fetch("/api/classes", {
        credentials: "include",
        headers: selectedSchoolId
          ? { "X-School-Id": String(selectedSchoolId) }
          : {},
      });
      const body = await response.json().catch(() => []);

      if (!response.ok) {
        throw new Error(
          body?.message || "Failed to load classes for event selector"
        );
      }

      return Array.isArray(body) ? body : [];
    },
    enabled: isCreateOpen && scope === "class" && !!selectedSchoolId,
  });

  const { data: viewingSchoolClasses = [] } = useQuery<ClassRow[]>({
    queryKey: ["/api/classes", "viewing-school", getEventSchoolId(viewingEvent)],
    queryFn: async () => {
      const schoolId = getEventSchoolId(viewingEvent);
      const response = await fetch("/api/classes", {
        credentials: "include",
        headers: schoolId ? { "X-School-Id": String(schoolId) } : {},
      });
      const body = await response.json().catch(() => []);

      if (!response.ok) {
        throw new Error(body?.message || "Failed to load event classes");
      }

      return Array.isArray(body) ? body : [];
    },
    enabled: !!viewingEvent && getEventClassIds(viewingEvent).length > 0 && !!getEventSchoolId(viewingEvent),
  });

  const { data: staff = [], isLoading: staffLoading } = useQuery<StaffRow[]>({
    queryKey: ["/api/staff", scope === "class" ? selectedSchoolId : "org"],
    queryFn: async () => {
      const headers: Record<string, string> = {};

      if (scope === "class" && selectedSchoolId) {
        headers["X-School-Id"] = String(selectedSchoolId);
      }

      const response = await fetch("/api/staff", {
        credentials: "include",
        headers,
      });
      const body = await response.json().catch(() => []);

      if (!response.ok) {
        throw new Error(
          body?.message || "Failed to load staff for event selector"
        );
      }

      return Array.isArray(body) ? body : [];
    },
    enabled: isCreateOpen && ((scope === "class" && !!selectedSchoolId) || scope === "org"),
  });

  const createEventMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) {
        throw new Error("Title is required.");
      }

      if (!startAt || !endAt) {
        throw new Error("Start and end date/time are required.");
      }

      const startDate = new Date(startAt);
      const endDate = new Date(endAt);

      if (!isValidDate(startDate) || !isValidDate(endDate)) {
        throw new Error("Enter valid start and end date/time values.");
      }

      if (endDate.getTime() < startDate.getTime()) {
        throw new Error("End time cannot be before start time.");
      }

      const payload: Record<string, unknown> = {
        scope,
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
        allDay,
        timezone: "Africa/Harare",
      };

      if (scope === "class") {
        if (!selectedSchoolId) {
          throw new Error("Select a school first for class events.");
        }
        if (selectedClassIds.length === 0) {
          throw new Error("For class events, select at least one class.");
        }

        payload.classIds = selectedClassIds;
        payload.includeStudents = includeStudents;
        payload.includeParents = includeParents;
        payload.staffViewerIds = selectedStaffViewerIds;
      }

      if (scope === "school" || scope === "org") {
        payload.includeStudents = includeStudents;
        payload.includeParents = includeParents;
      }

      if (scope === "school") {
        payload.attendanceExpectation = attendanceExpectation;
      }

      const response = await fetch("/api/calendar/events", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.message || "Failed to create event");
      }

      return body;
    },
    onSuccess: async () => {
      toast({
        title: "Event created",
        description: "The calendar event was created successfully.",
      });

      setIsCreateOpen(false);
      resetCreateForm();

      await queryClient.invalidateQueries({
        queryKey: ["/api/calendar/events"],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Create failed",
        description: err?.message || "Failed to create event.",
        variant: "destructive",
      });
    },
  });

  const updateEventMutation = useMutation({
    mutationFn: async () => {
      if (!eventBeingEdited?.id) {
        throw new Error("No event selected.");
      }

      if (!editTitle.trim()) {
        throw new Error("Title is required.");
      }

      if (!editStartAt || !editEndAt) {
        throw new Error("Start and end date/time are required.");
      }

      const startDate = new Date(editStartAt);
      const endDate = new Date(editEndAt);

      if (!isValidDate(startDate) || !isValidDate(endDate)) {
        throw new Error("Enter valid start and end date/time values.");
      }

      if (endDate.getTime() < startDate.getTime()) {
        throw new Error("End time cannot be before start time.");
      }

      const payload: Record<string, unknown> = {
        scope: editScope,
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        location: editLocation.trim() || null,
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
        allDay: editAllDay,
        timezone: "Africa/Harare",
      };

      if (editScope === "class") {
        payload.classIds = editClassIds;
        payload.staffViewerIds = editStaffViewerIds;
        payload.includeStudents = editIncludeStudents;
        payload.includeParents = editIncludeParents;
      }

      if (editScope === "school" || editScope === "org") {
        payload.includeStudents = editIncludeStudents;
        payload.includeParents = editIncludeParents;
      }

      if (editScope === "school") {
        payload.attendanceExpectation = editAttendanceExpectation;
      }

      const response = await fetch(`/api/calendar/events/${eventBeingEdited.id}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.message || "Failed to update event");
      }

      return body;
    },
    onSuccess: async () => {
      toast({
        title: "Event updated",
        description: "The calendar event was updated successfully.",
      });

      setIsEditOpen(false);
      setEventBeingEdited(null);

      await queryClient.invalidateQueries({
        queryKey: ["/api/calendar/events"],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Update failed",
        description: err?.message || "Failed to update event.",
        variant: "destructive",
      });
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: async () => {
      if (!eventToDelete?.id) {
        throw new Error("No event selected.");
      }

      const response = await fetch(`/api/calendar/events/${eventToDelete.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.message || "Failed to delete event");
      }

      return body;
    },
    onSuccess: async () => {
      toast({
        title: "Event deleted",
        description: "The calendar event was deleted successfully.",
      });

      setEventToDelete(null);
      setViewingEvent(null);

      await queryClient.invalidateQueries({
        queryKey: ["/api/calendar/events"],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Delete failed",
        description: err?.message || "Failed to delete event.",
        variant: "destructive",
      });
    },
  });

  const allEvents = Array.isArray(events) ? events : [];

  const filteredEvents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    const sorted = [...allEvents].sort((a: any, b: any) => {
      const aDate = parseEventDate(a);
      const bDate = parseEventDate(b);

      const aTime = aDate ? aDate.getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = bDate ? bDate.getTime() : Number.MAX_SAFE_INTEGER;

      return aTime - bTime;
    });

    if (!query) return sorted;

    return sorted.filter((event: any) => {
      const eventTitle = String(event?.title || "").toLowerCase();
      const eventDescription = String(event?.description || "").toLowerCase();
      const eventScope = String(event?.scope || "").toLowerCase();
      const eventLocation = String(event?.location || "").toLowerCase();

      return (
        eventTitle.includes(query) ||
        eventDescription.includes(query) ||
        eventScope.includes(query) ||
        eventLocation.includes(query)
      );
    });
  }, [allEvents, searchTerm]);

  const now = Date.now();

  const upcomingEvents = useMemo(
    () =>
      filteredEvents.filter((event: any) => {
        const endDate = parseEventEndDate(event) ?? parseEventDate(event);
        return endDate ? endDate.getTime() >= now : false;
      }),
    [filteredEvents, now]
  );

  const passedEvents = useMemo(
    () =>
      filteredEvents.filter((event: any) => {
        const endDate = parseEventEndDate(event) ?? parseEventDate(event);
        return endDate ? endDate.getTime() < now : false;
      }),
    [filteredEvents, now]
  );

  const selectedSchool = useMemo(
    () => schools.find((s) => s.id === selectedSchoolId) || null,
    [schools, selectedSchoolId]
  );

  const selectedOrgSchoolObjects = useMemo(
    () => schools.filter((item) => selectedOrgSchoolIds.includes(item.id)),
    [schools, selectedOrgSchoolIds]
  );

  const viewingEventClassObjects = useMemo(() => {
    if (!viewingEvent) return [];

    const classIds = getEventClassIds(viewingEvent);
    if (classIds.length === 0) return [];

    const sourceClasses = viewingSchoolClasses.length > 0 ? viewingSchoolClasses : classes;
    return sourceClasses.filter((item) => classIds.includes(item.id));
  }, [viewingEvent, viewingSchoolClasses, classes]);

  useEffect(() => {
    setSelectedClassIds([]);
    setSelectedStaffViewerIds([]);
    setClassFilter("");
    setStaffFilter("");
  }, [selectedSchoolId]);

  useEffect(() => {
    setPreviewOrgStaffIds([]);
    setOrgStaffFilter("");
  }, [selectedOrgSchoolIds]);

  function resetCreateForm() {
    const start = new Date();
    const end = new Date(Date.now() + 60 * 60 * 1000);

    setScope("personal");
    setTitle("");
    setDescription("");
    setLocation("");
    setStartAt(toLocalDateTimeInputValue(start));
    setEndAt(toLocalDateTimeInputValue(end));
    setAllDay(false);
    setIncludeStudents(true);
    setIncludeParents(false);
    setAttendanceExpectation("normal");
    setSelectedSchoolId(null);
    setSelectedClassIds([]);
    setSelectedStaffViewerIds([]);
    setClassFilter("");
    setStaffFilter("");
    setSelectedOrgSchoolIds([]);
    setOrgSchoolFilter("");
    setOrgStaffFilter("");
    setPreviewOrgStaffIds([]);
  }

  function openCreateDialog() {
    const base = new Date(selectedDate);
    base.setHours(8, 0, 0, 0);

    const finish = new Date(base);
    finish.setHours(9, 0, 0, 0);

    setStartAt(toLocalDateTimeInputValue(base));
    setEndAt(toLocalDateTimeInputValue(finish));
    setIsCreateOpen(true);
  }

  function jumpToEvent(event: any) {
    const eventDate = parseEventDate(event);
    if (!eventDate) return;
    setSelectedDate(eventDate);
    setViewDate(new Date(eventDate.getFullYear(), eventDate.getMonth(), 1));
    setIsEventListOpen(false);
    setViewingEvent(null);
  }

  function openViewDialog(event: any) {
    setViewingEvent(event);
  }

  function openEditDialog(event: any) {
    const start = parseEventDate(event) ?? new Date();
    const end = parseEventEndDate(event) ?? new Date(start.getTime() + 60 * 60 * 1000);
    const scopeValue = String(event?.scope || "personal") as CalendarScope;

    setEventBeingEdited(event);
    setEditScope(scopeValue);
    setEditTitle(String(event?.title || ""));
    setEditDescription(String(event?.description || ""));
    setEditLocation(String(event?.location || ""));
    setEditStartAt(toLocalDateTimeInputValue(start));
    setEditEndAt(toLocalDateTimeInputValue(end));
    setEditAllDay(Boolean(event?.all_day ?? event?.allDay ?? false));
    setEditIncludeStudents(Boolean(event?.include_students ?? event?.includeStudents ?? true));
    setEditIncludeParents(Boolean(event?.include_parents ?? event?.includeParents ?? false));
    setEditAttendanceExpectation((event?.attendance_expectation ?? event?.attendanceExpectation) === "no_regular_attendance" ? "no_regular_attendance" : "normal");
    setEditClassIds(normalizeNumberArray(event?.class_ids ?? event?.classIds ?? []));
    setEditStaffViewerIds(
      normalizeNumberArray(event?.staff_viewer_ids ?? event?.staffViewerIds ?? [])
    );
    setIsEditOpen(true);
    setViewingEvent(null);
  }

  function toggleClass(id: number) {
    setSelectedClassIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  function toggleStaffViewer(id: number) {
    setSelectedStaffViewerIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  function removeClass(id: number) {
    setSelectedClassIds((prev) => prev.filter((v) => v !== id));
  }

  function removeStaffViewer(id: number) {
    setSelectedStaffViewerIds((prev) => prev.filter((v) => v !== id));
  }

  function toggleOrgSchool(id: number) {
    setSelectedOrgSchoolIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  function removeOrgSchool(id: number) {
    setSelectedOrgSchoolIds((prev) => prev.filter((v) => v !== id));
  }

  function togglePreviewOrgStaff(id: number) {
    setPreviewOrgStaffIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  function removePreviewOrgStaff(id: number) {
    setPreviewOrgStaffIds((prev) => prev.filter((v) => v !== id));
  }

  function eventsForDate(date: Date) {
    return allEvents.filter((e: any) => {
      const eventDate = parseEventDate(e);
      if (!eventDate) return false;
      return isSameDay(eventDate, date);
    });
  }

  function resolveSchoolText(event: any) {
    const schoolId = getEventSchoolId(event);
    if (schoolId == null) return null;
    const school = schools.find((s) => s.id === schoolId);
    return school ? schoolLabel(school) : `School ID: ${schoolId}`;
  }

  function resolveAgendaClassText(event: any) {
    const classIds = getEventClassIds(event);
    if (classIds.length === 0) return null;

    if (viewingEvent?.id === event.id && viewingEventClassObjects.length > 0) {
      return `Classes: ${viewingEventClassObjects.map(classLabel).join(", ")}`;
    }

    return `Class IDs: ${classIds.join(", ")}`;
  }

  const visibleClasses = useMemo(() => {
    const q = classFilter.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((item) =>
      classLabel(item).toLowerCase().includes(q)
    );
  }, [classes, classFilter]);

  const visibleStaff = useMemo(() => {
    const q = staffFilter.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((item) => {
      const roleText = String(item.role || "").toLowerCase();
      return (
        staffLabel(item).toLowerCase().includes(q) ||
        roleText.includes(q)
      );
    });
  }, [staff, staffFilter]);

  const selectedClassObjects = useMemo(
    () => classes.filter((item) => selectedClassIds.includes(item.id)),
    [classes, selectedClassIds]
  );

  const selectedStaffObjects = useMemo(
    () => staff.filter((item) => selectedStaffViewerIds.includes(item.id)),
    [staff, selectedStaffViewerIds]
  );

  const visibleOrgSchools = useMemo(() => {
    const q = orgSchoolFilter.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter((item) => schoolLabel(item).toLowerCase().includes(q));
  }, [schools, orgSchoolFilter]);

  const orgScopedStaff = useMemo(() => {
    if (selectedOrgSchoolIds.length === 0) return [];
    return staff.filter(
      (item) => item.schoolId != null && selectedOrgSchoolIds.includes(item.schoolId)
    );
  }, [staff, selectedOrgSchoolIds]);

  const visibleOrgStaff = useMemo(() => {
    const q = orgStaffFilter.trim().toLowerCase();
    if (!q) return orgScopedStaff;
    return orgScopedStaff.filter((item) => {
      const roleText = String(item.role || "").toLowerCase();
      return (
        staffLabel(item).toLowerCase().includes(q) ||
        roleText.includes(q)
      );
    });
  }, [orgScopedStaff, orgStaffFilter]);

  const selectedPreviewOrgStaffObjects = useMemo(
    () => staff.filter((item) => previewOrgStaffIds.includes(item.id)),
    [staff, previewOrgStaffIds]
  );

  const monthLabel = isValidDate(viewDate)
    ? viewDate.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "Calendar";

  const selectedLabel = isValidDate(selectedDate)
    ? selectedDate.toLocaleDateString("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Selected Date";

  const viewingMeta = getScopeMeta(viewingEvent?.scope);
  const viewingSchoolId = getEventSchoolId(viewingEvent);
  const viewingSchool =
    viewingSchoolId != null
      ? schools.find((s) => s.id === viewingSchoolId) || null
      : null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Calendar</h1>
          <p className="text-muted-foreground">
            Manage and view calendar events across your scope.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button className="w-full sm:w-auto"
            variant="outline"
            onClick={() => setIsEventListOpen(true)}
            data-testid="button-open-event-list"
          >
            <List className="h-4 w-4 mr-2" />
            Event List
          </Button>

          <Button
            className="w-full sm:w-auto"
            data-testid="button-create-calendar-event"
            onClick={openCreateDialog}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Event
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full flex-1 min-w-0 sm:min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search events by title, description, location, or scope..."
                className="pl-10"
                data-testid="input-calendar-search"
              />
            </div>

            <div className="text-xs text-muted-foreground sm:text-sm">
              {filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              {monthLabel}
            </CardTitle>

            <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setViewDate(
                    new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1)
                  )
                }
                data-testid="button-calendar-prev-month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setViewDate(new Date());
                  setSelectedDate(new Date());
                }}
                data-testid="button-calendar-today"
              >
                Today
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setViewDate(
                    new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)
                  )
                }
                data-testid="button-calendar-next-month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="px-2 pb-3 sm:px-6 sm:pb-6">
            <div className="w-full min-w-0 overflow-hidden">
              <div className="w-full min-w-0">
                <div className="mb-1 grid grid-cols-7 gap-1 sm:mb-2 sm:gap-2">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                    <div
                      key={day}
                      className="py-1 text-center text-[10px] font-medium text-muted-foreground sm:py-2 sm:text-xs"
                    >
                      {day}
                    </div>
                  ))}
                </div>

                {isLoading ? (
                  <div className="rounded-lg border p-4 text-sm text-muted-foreground sm:p-6">
                    Loading calendar events...
                  </div>
                ) : error ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive sm:p-6">
                    {(error as Error).message || "Failed to load calendar events."}
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-1 sm:gap-2">
                    {calendarDays.map((date) => {
                      const inCurrentMonth = date.getMonth() === viewDate.getMonth();
                      const isToday = isSameDay(date, today);
                      const isSelected = isSameDay(date, selectedDate);
                      const dateEvents = eventsForDate(date);
                      const visibleDateEvents = dateEvents.slice(0, 2);
                      const hiddenCount = Math.max(0, dateEvents.length - 2);

                      return (
                        <button
                          key={date.toISOString()}
                          type="button"
                          onClick={() => setSelectedDate(date)}
                          className={[
                            "min-h-[46px] min-w-0 overflow-hidden rounded-lg border p-1 text-left transition hover:border-primary hover:bg-muted/40 sm:min-h-[118px] sm:rounded-2xl sm:p-2",
                            !inCurrentMonth ? "opacity-45" : "",
                            isSelected ? "border-primary ring-1 ring-primary" : "",
                          ].join(" ")}
                          data-testid={`calendar-day-${date.toISOString().slice(0, 10)}`}
                        >
                          <div className="flex min-w-0 items-center justify-between gap-0.5 sm:gap-1">
                            <span
                              className={[
                                "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] sm:h-7 sm:w-7 sm:text-sm",
                                isToday ? "bg-primary text-primary-foreground" : "",
                              ].join(" ")}
                            >
                              {date.getDate()}
                            </span>
                            {dateEvents.length > 0 && (
                              <span className="shrink-0 text-[9px] leading-none text-muted-foreground sm:text-[10px]">
                                {dateEvents.length}
                              </span>
                            )}
                          </div>

                          <div className="mt-1 space-y-0.5 sm:mt-2 sm:space-y-1">
                            {visibleDateEvents.map((event: any) => {
                              const meta = getScopeMeta(event.scope);
                              return (
                                <button
                                  key={event.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openViewDialog(event);
                                  }}
                                  className={`hidden w-full min-w-0 truncate rounded-md px-1.5 py-0.5 text-left text-[9px] leading-tight sm:block sm:px-2 sm:py-1 sm:text-[11px] ${meta.chipClass}`}
                                  data-testid={`button-day-event-${event.id}`}
                                >
                                  {event.title || "Untitled event"}
                                </button>
                              );
                            })}

                            {hiddenCount > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDate(date);
                                }}
                                className="hidden w-full min-w-0 truncate rounded-md bg-muted px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/80 sm:block"
                                data-testid={`button-more-events-${date.toISOString().slice(0, 10)}`}
                              >
                                +{hiddenCount} more
                              </button>
                            )}

                            {dateEvents.length === 0 && (
                              <div className="hidden rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground sm:block">
                                No events
                              </div>
                            )}

                            {dateEvents.length > 0 && (
                              <div className="flex flex-wrap gap-0.5 sm:hidden">
                                {visibleDateEvents.map((event: any) => {
                                  const meta = getScopeMeta(event.scope);
                                  return (
                                    <span
                                      key={`mobile-dot-${event.id}`}
                                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.chipClass}`}
                                      aria-hidden="true"
                                    />
                                  );
                                })}
                                {hiddenCount > 0 && (
                                  <span className="text-[8px] leading-none text-muted-foreground">
                                    +{hiddenCount}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{selectedLabel}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Agenda</p>

              {eventsForDate(selectedDate).length === 0 ? (
                <p className="text-sm text-muted-foreground mt-1">
                  No events for this day yet.
                </p>
              ) : (
                <div className="space-y-3 mt-3">
                  {eventsForDate(selectedDate).map((event: any) => {
                    const meta = getScopeMeta(event.scope);
                    const schoolText = resolveSchoolText(event);
                    const classText = resolveAgendaClassText(event);

                    return (
                      <div
                        key={event.id}
                        className={`rounded-xl border-l-4 border bg-card p-3 ${meta.borderClass}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => openViewDialog(event)}
                            data-testid={`button-open-agenda-event-${event.id}`}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold">
                                {event.title || "Untitled event"}
                              </p>
                              <Badge className={meta.badgeClass}>
                                {meta.label}
                              </Badge>
                              {getEventAllDay(event) && (
                                <Badge variant="secondary">All day</Badge>
                              )}
                            </div>

                            <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <Clock3 className="h-3.5 w-3.5" />
                                <span>{formatEventRange(event)}</span>
                              </div>

                              {getEventLocation(event) && (
                                <div className="flex items-center gap-2">
                                  <MapPin className="h-3.5 w-3.5" />
                                  <span>{getEventLocation(event)}</span>
                                </div>
                              )}

                              <div className="flex items-center gap-2">
                                <UserRound className="h-3.5 w-3.5" />
                                <span>{formatAudienceText(event)}</span>
                              </div>

                              {schoolText && (
                                <div className="flex items-center gap-2">
                                  <Building2 className="h-3.5 w-3.5" />
                                  <span>{schoolText}</span>
                                </div>
                              )}

                              {classText && (
                                <div className="flex items-center gap-2">
                                  <Layers3 className="h-3.5 w-3.5" />
                                  <span>{classText}</span>
                                </div>
                              )}
                            </div>

                            {event.description && (
                              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                                {event.description}
                              </p>
                            )}
                          </button>

                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openViewDialog(event)}
                              data-testid={`button-view-event-agenda-${event.id}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(event)}
                              data-testid={`button-edit-event-agenda-${event.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEventToDelete(event)}
                              data-testid={`button-delete-event-agenda-${event.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Selected Scope</p>
              <p className="text-sm text-muted-foreground mt-1">
                Events are color-coded by scope for faster scanning.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isEventListOpen} onOpenChange={setIsEventListOpen}>
        <DialogContent className="max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <List className="h-5 w-5" />
              Event List
            </DialogTitle>
            <DialogDescription>
              View all loaded events grouped into upcoming and passed events.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="upcoming" className="w-full">
            <TabsList className="grid w-full grid-cols-2" data-testid="tabs-event-list">
              <TabsTrigger value="upcoming" data-testid="tab-upcoming-events">
                Upcoming Events ({upcomingEvents.length})
              </TabsTrigger>
              <TabsTrigger value="passed" data-testid="tab-passed-events">
                Passed Events ({passedEvents.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upcoming" className="mt-4">
              {upcomingEvents.length === 0 ? (
                <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                  No upcoming events found.
                </div>
              ) : (
                <div className="space-y-2">
                  {upcomingEvents.map((event: any) => (
                    <EventListCard
                      key={event.id}
                      event={event}
                      onOpen={openViewDialog}
                      onEdit={openEditDialog}
                      onDelete={setEventToDelete}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="passed" className="mt-4">
              {passedEvents.length === 0 ? (
                <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                  No passed events found.
                </div>
              ) : (
                <div className="space-y-2">
                  {passedEvents.map((event: any) => (
                    <EventListCard
                      key={event.id}
                      event={event}
                      onOpen={openViewDialog}
                      onEdit={openEditDialog}
                      onDelete={setEventToDelete}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingEvent} onOpenChange={(open) => !open && setViewingEvent(null)}>
        <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span>{viewingEvent?.title || "Event Details"}</span>
              <Badge className={viewingMeta.badgeClass}>{viewingMeta.label}</Badge>
              {getEventAllDay(viewingEvent) && <Badge variant="secondary">All day</Badge>}
            </DialogTitle>
            <DialogDescription>
              Review the full event details and take quick actions.
            </DialogDescription>
          </DialogHeader>

          {viewingEvent && (
            <div className="space-y-5">
              <div className={`rounded-xl border-l-4 border p-4 ${viewingMeta.borderClass}`}>
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-3">
                    <CalendarRange className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Date & Time</p>
                      <p className="text-muted-foreground">{formatEventRange(viewingEvent)}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Clock3 className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Timezone</p>
                      <p className="text-muted-foreground">{getEventTimezone(viewingEvent)}</p>
                    </div>
                  </div>

                  {getEventLocation(viewingEvent) && (
                    <div className="flex items-start gap-3">
                      <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">Location</p>
                        <p className="text-muted-foreground">{getEventLocation(viewingEvent)}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3">
                    <UserRound className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Audience</p>
                      <p className="text-muted-foreground">{formatAudienceText(viewingEvent)}</p>
                    </div>
                  </div>

                  {viewingSchoolId != null && (
                    <div className="flex items-start gap-3">
                      <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">School Context</p>
                        <p className="text-muted-foreground">
                          {viewingSchool ? schoolLabel(viewingSchool) : `School ID: ${viewingSchoolId}`}
                        </p>
                      </div>
                    </div>
                  )}

                  {getEventClassIds(viewingEvent).length > 0 && (
                    <div className="flex items-start gap-3">
                      <Layers3 className="h-4 w-4 mt-0.5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">Class Links</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {viewingEventClassObjects.length > 0 ? (
                            viewingEventClassObjects.map((item) => (
                              <Badge key={item.id} variant="secondary">
                                {classLabel(item)}
                              </Badge>
                            ))
                          ) : (
                            getEventClassIds(viewingEvent).map((id) => (
                              <Badge key={id} variant="secondary">
                                Class ID: {id}
                              </Badge>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium mb-2">Description</p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {viewingEvent.description || "No description provided."}
                </p>
              </div>

              <div className="flex justify-between gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => jumpToEvent(viewingEvent)}
                  data-testid="button-view-event-go-to-date"
                >
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Go to Date
                </Button>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => openEditDialog(viewingEvent)}
                    data-testid="button-view-event-edit"
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setEventToDelete(viewingEvent);
                      setViewingEvent(null);
                    }}
                    data-testid="button-view-event-delete"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open) resetCreateForm();
        }}
      >
        <DialogContent className="max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Create Calendar Event</DialogTitle>
            <DialogDescription>
              Create a personal, class, school, or organization event.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select
                value={scope}
                onValueChange={(value: CalendarScope) => setScope(value)}
              >
                <SelectTrigger data-testid="select-calendar-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="class">Class</SelectItem>
                  <SelectItem value="school">School</SelectItem>
                  <SelectItem value="org">Organization / HQ</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="calendar-title">Title</Label>
              <Input
                id="calendar-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter event title"
                data-testid="input-calendar-title"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="calendar-description">Description</Label>
              <Textarea
                id="calendar-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                data-testid="textarea-calendar-description"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="calendar-location">Location</Label>
              <Input
                id="calendar-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Optional location"
                data-testid="input-calendar-location"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="calendar-start">Start</Label>
                <Input
                  id="calendar-start"
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  data-testid="input-calendar-start"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="calendar-end">End</Label>
                <Input
                  id="calendar-end"
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  data-testid="input-calendar-end"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="calendar-all-day"
                checked={allDay}
                onCheckedChange={(checked) => setAllDay(checked === true)}
                data-testid="checkbox-calendar-all-day"
              />
              <Label htmlFor="calendar-all-day">All day</Label>
            </div>

            {(scope === "class" || scope === "school" || scope === "org") && (
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="calendar-include-students"
                    checked={includeStudents}
                    onCheckedChange={(checked) =>
                      setIncludeStudents(checked === true)
                    }
                    data-testid="checkbox-calendar-include-students"
                  />
                  <Label htmlFor="calendar-include-students">
                    Visible to students
                  </Label>
                </div>

                <div className="flex items-center gap-3">
                  <Checkbox
                    id="calendar-include-parents"
                    checked={includeParents}
                    onCheckedChange={(checked) =>
                      setIncludeParents(checked === true)
                    }
                    data-testid="checkbox-calendar-include-parents"
                  />
                  <Label htmlFor="calendar-include-parents">
                    Visible to parents
                  </Label>
                </div>
              </div>
            )}

            {scope === "school" && (
              <div className="rounded-lg border p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold">School Operations</p>
                  <p className="text-xs text-muted-foreground">Choose whether this calendar event changes the normal attendance expectation for its date(s).</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="calendar-attendance-expectation">Attendance expectation</Label>
                  <Select value={attendanceExpectation} onValueChange={(value) => setAttendanceExpectation(value as "normal" | "no_regular_attendance")}>
                    <SelectTrigger id="calendar-attendance-expectation" data-testid="select-calendar-attendance-expectation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal schedule</SelectItem>
                      <SelectItem value="no_regular_attendance">No regular attendance expected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {attendanceExpectation === "no_regular_attendance" && (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Students and staff will not be treated as expected for normal attendance on these event date(s). Lateness, absence reconciliation and related attendance alerts will not run. Existing gate access permissions are not affected; authorised people may still enter and their gate activity will still be recorded.
                  </div>
                )}
              </div>
            )}

            {scope === "org" && (
              <div className="space-y-4">
                <div className="rounded-lg border p-4 space-y-3">
                  <div>
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <School className="h-4 w-4" />
                      Included Schools
                    </Label>
                  </div>

                  <Input
                    value={orgSchoolFilter}
                    onChange={(e) => setOrgSchoolFilter(e.target.value)}
                    placeholder="Filter schools..."
                    data-testid="input-calendar-org-school-filter"
                  />

                  {selectedOrgSchoolObjects.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedOrgSchoolObjects.map((item) => (
                        <Badge
                          key={item.id}
                          variant="secondary"
                          className="flex items-center gap-1"
                        >
                          <span>{schoolLabel(item)}</span>
                          <button
                            type="button"
                            onClick={() => removeOrgSchool(item.id)}
                            className="ml-1"
                            data-testid={`button-remove-selected-org-school-${item.id}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}

                  <ScrollArea className="h-48 rounded-md border p-2">
                    {schoolsLoading ? (
                      <p className="text-sm text-muted-foreground px-2 py-1">
                        Loading schools...
                      </p>
                    ) : visibleOrgSchools.length === 0 ? (
                      <p className="text-sm text-muted-foreground px-2 py-1">
                        No schools found.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {visibleOrgSchools.map((item) => {
                          const checked = selectedOrgSchoolIds.includes(item.id);
                          return (
                            <label
                              key={item.id}
                              className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleOrgSchool(item.id)}
                                data-testid={`checkbox-calendar-org-school-${item.id}`}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium">{item.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {item.shortCode || `ID: ${item.id}`}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </div>

                {selectedOrgSchoolIds.length > 0 && (
                  <div className="rounded-lg border p-4 space-y-3">
                    <div>
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Staff From Selected Schools
                      </Label>
                    </div>

                    <Input
                      value={orgStaffFilter}
                      onChange={(e) => setOrgStaffFilter(e.target.value)}
                      placeholder="Filter staff..."
                      data-testid="input-calendar-org-staff-filter"
                    />

                    {selectedPreviewOrgStaffObjects.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedPreviewOrgStaffObjects.map((item) => (
                          <Badge
                            key={item.id}
                            variant="secondary"
                            className="flex items-center gap-1"
                          >
                            <span>{staffLabel(item)}</span>
                            <button
                              type="button"
                              onClick={() => removePreviewOrgStaff(item.id)}
                              className="ml-1"
                              data-testid={`button-remove-preview-org-staff-${item.id}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}

                    <ScrollArea className="h-56 rounded-md border p-2">
                      {staffLoading ? (
                        <p className="text-sm text-muted-foreground px-2 py-1">
                          Loading staff...
                        </p>
                      ) : visibleOrgStaff.length === 0 ? (
                        <p className="text-sm text-muted-foreground px-2 py-1">
                          No staff found for the selected schools.
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {visibleOrgStaff.map((item) => {
                            const checked = previewOrgStaffIds.includes(item.id);
                            const schoolName =
                              schools.find((s) => s.id === item.schoolId)?.name || "Unknown school";

                            return (
                              <label
                                key={item.id}
                                className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => togglePreviewOrgStaff(item.id)}
                                  data-testid={`checkbox-calendar-org-staff-${item.id}`}
                                />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">{staffLabel(item)}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {schoolName}
                                    {item.role ? ` • ${item.role}` : ""}
                                    {item.status ? ` • ${item.status}` : ""}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                )}
              </div>
            )}

            {scope === "class" && (
              <div className="space-y-4">
                <div className="rounded-lg border p-4 space-y-3">
                  <div>
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <School className="h-4 w-4" />
                      School
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Select a school first to filter classes and staff correctly.
                    </p>
                  </div>

                  <Select
                    value={selectedSchoolId ? String(selectedSchoolId) : ""}
                    onValueChange={(value) =>
                      setSelectedSchoolId(value ? Number(value) : null)
                    }
                  >
                    <SelectTrigger data-testid="select-calendar-school">
                      <SelectValue placeholder="Select a school" />
                    </SelectTrigger>
                    <SelectContent>
                      {schoolsLoading ? (
                        <SelectItem value="loading" disabled>
                          Loading schools...
                        </SelectItem>
                      ) : schools.length === 0 ? (
                        <SelectItem value="none" disabled>
                          No schools found
                        </SelectItem>
                      ) : (
                        schools.map((item) => (
                          <SelectItem key={item.id} value={String(item.id)}>
                            {schoolLabel(item)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>

                  {selectedSchool && (
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">
                        School: {schoolLabel(selectedSchool)}
                      </Badge>
                    </div>
                  )}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border p-4 space-y-3">
                    <div>
                      <Label className="text-sm font-medium">Classes</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Select one or more classes for this event.
                      </p>
                    </div>

                    {!selectedSchoolId ? (
                      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        Select a school first to load classes.
                      </div>
                    ) : (
                      <>
                        <Input
                          value={classFilter}
                          onChange={(e) => setClassFilter(e.target.value)}
                          placeholder="Filter classes..."
                          data-testid="input-calendar-class-filter"
                        />

                        {selectedClassObjects.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {selectedClassObjects.map((item) => (
                              <Badge
                                key={item.id}
                                variant="secondary"
                                className="flex items-center gap-1"
                              >
                                <span>{classLabel(item)}</span>
                                <button
                                  type="button"
                                  onClick={() => removeClass(item.id)}
                                  className="ml-1"
                                  data-testid={`button-remove-selected-class-${item.id}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}

                        <ScrollArea className="h-56 rounded-md border p-2">
                          {classesLoading ? (
                            <p className="text-sm text-muted-foreground px-2 py-1">
                              Loading classes...
                            </p>
                          ) : visibleClasses.length === 0 ? (
                            <p className="text-sm text-muted-foreground px-2 py-1">
                              No classes found for this school.
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {visibleClasses.map((item) => {
                                const checked = selectedClassIds.includes(item.id);
                                return (
                                  <label
                                    key={item.id}
                                    className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer"
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => toggleClass(item.id)}
                                      data-testid={`checkbox-calendar-class-${item.id}`}
                                    />
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium">
                                        {item.className || `Class #${item.id}`}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {item.shortCode || `ID: ${item.id}`}
                                      </p>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </ScrollArea>
                      </>
                    )}
                  </div>

                  <div className="rounded-lg border p-4 space-y-3">
                    <div>
                      <Label className="text-sm font-medium">Extra Staff Viewers</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Optional staff who can view this class event.
                      </p>
                    </div>

                    {!selectedSchoolId ? (
                      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        Select a school first to load staff.
                      </div>
                    ) : (
                      <>
                        <Input
                          value={staffFilter}
                          onChange={(e) => setStaffFilter(e.target.value)}
                          placeholder="Filter staff..."
                          data-testid="input-calendar-staff-filter"
                        />

                        {selectedStaffObjects.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {selectedStaffObjects.map((item) => (
                              <Badge
                                key={item.id}
                                variant="secondary"
                                className="flex items-center gap-1"
                              >
                                <span>{staffLabel(item)}</span>
                                <button
                                  type="button"
                                  onClick={() => removeStaffViewer(item.id)}
                                  className="ml-1"
                                  data-testid={`button-remove-selected-staff-${item.id}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}

                        <ScrollArea className="h-56 rounded-md border p-2">
                          {staffLoading ? (
                            <p className="text-sm text-muted-foreground px-2 py-1">
                              Loading staff...
                            </p>
                          ) : visibleStaff.length === 0 ? (
                            <p className="text-sm text-muted-foreground px-2 py-1">
                              No staff found for this school.
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {visibleStaff.map((item) => {
                                const checked = selectedStaffViewerIds.includes(item.id);
                                return (
                                  <label
                                    key={item.id}
                                    className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer"
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => toggleStaffViewer(item.id)}
                                      data-testid={`checkbox-calendar-staff-${item.id}`}
                                    />
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium">
                                        {staffLabel(item)}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {item.role || "Staff"}
                                        {item.status ? ` • ${item.status}` : ""}
                                      </p>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </ScrollArea>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                disabled={createEventMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => createEventMutation.mutate()}
                disabled={createEventMutation.isPending}
                data-testid="button-submit-calendar-event"
              >
                {createEventMutation.isPending ? "Creating..." : "Create Event"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isEditOpen}
        onOpenChange={(open) => {
          setIsEditOpen(open);
          if (!open) setEventBeingEdited(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Edit Calendar Event</DialogTitle>
            <DialogDescription>
              Update the event details below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select
                value={editScope}
                onValueChange={(value: CalendarScope) => setEditScope(value)}
                disabled
              >
                <SelectTrigger data-testid="select-edit-calendar-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="class">Class</SelectItem>
                  <SelectItem value="school">School</SelectItem>
                  <SelectItem value="org">Organization / HQ</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-calendar-title">Title</Label>
              <Input
                id="edit-calendar-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                data-testid="input-edit-calendar-title"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-calendar-description">Description</Label>
              <Textarea
                id="edit-calendar-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                data-testid="textarea-edit-calendar-description"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-calendar-location">Location</Label>
              <Input
                id="edit-calendar-location"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                data-testid="input-edit-calendar-location"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-calendar-start">Start</Label>
                <Input
                  id="edit-calendar-start"
                  type="datetime-local"
                  value={editStartAt}
                  onChange={(e) => setEditStartAt(e.target.value)}
                  data-testid="input-edit-calendar-start"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-calendar-end">End</Label>
                <Input
                  id="edit-calendar-end"
                  type="datetime-local"
                  value={editEndAt}
                  onChange={(e) => setEditEndAt(e.target.value)}
                  data-testid="input-edit-calendar-end"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="edit-calendar-all-day"
                checked={editAllDay}
                onCheckedChange={(checked) => setEditAllDay(checked === true)}
                data-testid="checkbox-edit-calendar-all-day"
              />
              <Label htmlFor="edit-calendar-all-day">All day</Label>
            </div>

            {(editScope === "class" || editScope === "school" || editScope === "org") && (
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="edit-calendar-include-students"
                    checked={editIncludeStudents}
                    onCheckedChange={(checked) =>
                      setEditIncludeStudents(checked === true)
                    }
                    data-testid="checkbox-edit-calendar-include-students"
                  />
                  <Label htmlFor="edit-calendar-include-students">
                    Visible to students
                  </Label>
                </div>

                <div className="flex items-center gap-3">
                  <Checkbox
                    id="edit-calendar-include-parents"
                    checked={editIncludeParents}
                    onCheckedChange={(checked) =>
                      setEditIncludeParents(checked === true)
                    }
                    data-testid="checkbox-edit-calendar-include-parents"
                  />
                  <Label htmlFor="edit-calendar-include-parents">
                    Visible to parents
                  </Label>
                </div>

                {editScope === "class" && (
                  <div className="space-y-1 pt-1">
                    <p className="text-sm font-medium">Class-linked Event</p>
                    <p className="text-xs text-muted-foreground">
                      Class IDs: {editClassIds.length > 0 ? editClassIds.join(", ") : "None"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Extra staff viewers:{" "}
                      {editStaffViewerIds.length > 0
                        ? editStaffViewerIds.join(", ")
                        : "None"}
                    </p>
                  </div>
                )}
              </div>
            )}

            {editScope === "school" && (
              <div className="rounded-lg border p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold">School Operations</p>
                  <p className="text-xs text-muted-foreground">Choose whether this calendar event changes the normal attendance expectation for its date(s).</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-calendar-attendance-expectation">Attendance expectation</Label>
                  <Select value={editAttendanceExpectation} onValueChange={(value) => setEditAttendanceExpectation(value as "normal" | "no_regular_attendance")}>
                    <SelectTrigger id="edit-calendar-attendance-expectation" data-testid="select-edit-calendar-attendance-expectation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal schedule</SelectItem>
                      <SelectItem value="no_regular_attendance">No regular attendance expected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editAttendanceExpectation === "no_regular_attendance" && (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Students and staff will not be treated as expected for normal attendance on these event date(s). Lateness, absence reconciliation and related attendance alerts will not run. Existing gate access permissions are not affected; authorised people may still enter and their gate activity will still be recorded.
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setIsEditOpen(false)}
                disabled={updateEventMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => updateEventMutation.mutate()}
                disabled={updateEventMutation.isPending}
                data-testid="button-submit-edit-calendar-event"
              >
                {updateEventMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!eventToDelete}
        onOpenChange={(open) => {
          if (!open) setEventToDelete(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Event</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{eventToDelete?.title || "this event"}</strong>?
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border p-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>This action cannot be undone.</span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setEventToDelete(null)}
              disabled={deleteEventMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteEventMutation.mutate()}
              disabled={deleteEventMutation.isPending}
              data-testid="button-confirm-delete-calendar-event"
            >
              {deleteEventMutation.isPending ? "Deleting..." : "Delete Event"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}