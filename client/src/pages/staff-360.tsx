import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { schoolFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ArrowLeft, Mail, Phone, Calendar, Clock, BookOpen, Users, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";

interface StaffSearchResult {
  id: number;
  firstName: string;
  lastName: string;
  staffNo: string;
  photo: string | null;
  role: string;
  status: string;
}

interface StaffProfileData {
  staff: any;
  username: string | null;
  teachingAssignments: any[];
  timetable: any[];
  todayLessons: any[];
  upcomingLessons: any[];
  subjectsTaught: any[];
  attendanceCalendar: any[];
  attendanceSummary: any;
}

const STAFF_ATTENDANCE_COLORS: Record<string, string> = {
  on_time: "bg-emerald-500",
  present: "bg-emerald-500",
  late: "bg-amber-500",
  absent: "bg-red-500",
  excused: "bg-sky-500",
  leave: "bg-sky-500",
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export default function Staff360Page() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlStaffId = urlParams.get("id") ? parseInt(urlParams.get("id")!) : null;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(urlStaffId);
  const [showSearch, setShowSearch] = useState(!urlStaffId);
  const [subjectPage, setSubjectPage] = useState(0);
  const subjectsPerPage = 2;

  const { data: searchResults = [] } = useQuery<StaffSearchResult[]>({
    queryKey: ["/api/staff/search", searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      const res = await schoolFetch(`/api/staff/search?q=${encodeURIComponent(searchQuery)}`);
      return res.json();
    },
    enabled: searchQuery.length >= 2,
  });

  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery<StaffProfileData>({
    queryKey: ["/api/staff-profile", selectedStaffId],
    queryFn: async () => {
      const res = await schoolFetch(`/api/staff-profile/${selectedStaffId}`);
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
    enabled: !!selectedStaffId,
  });

  const selectStaff = (id: number) => {
    setSelectedStaffId(id);
    setShowSearch(false);
    setSearchQuery("");
    setSubjectPage(0);
    window.history.replaceState(null, "", `/staff-360?id=${id}`);
  };

  const goBack = () => {
    setSelectedStaffId(null);
    setShowSearch(true);
    setSearchQuery("");
    setSubjectPage(0);
    window.history.replaceState(null, "", "/staff-360");
  };

  const staffMember = profile?.staff;
  const timetable = profile?.timetable || [];
  const todayLessons = profile?.todayLessons || [];
  const upcomingLessons = profile?.upcomingLessons || [];
  const subjectsTaught = profile?.subjectsTaught || [];
  const attendanceCalendar = profile?.attendanceCalendar || [];
  const attendanceSummary = profile?.attendanceSummary;
  const teachingAssignments = profile?.teachingAssignments || [];

  const attendanceByDate = useMemo(() => new Map((attendanceCalendar || []).map((a: any) => [a.date, a.status])), [attendanceCalendar]);

  const attendanceMonths = useMemo(() => {
    if (!attendanceCalendar || attendanceCalendar.length === 0) return [];
    const dates = attendanceCalendar.map((a: any) => new Date(a.date));
    const minDate = new Date(Math.min(...dates.map((d: Date) => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map((d: Date) => d.getTime())));
    const months: { year: number; month: number; name: string }[] = [];
    const current = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    while (current <= maxDate) {
      months.push({
        year: current.getFullYear(),
        month: current.getMonth(),
        name: current.toLocaleString("default", { month: "long" }),
      });
      current.setMonth(current.getMonth() + 1);
    }
    return months;
  }, [attendanceCalendar]);

  const attendanceRate = useMemo(() => {
    if (!attendanceSummary || attendanceSummary.total === 0) return null;
    return Math.round(((attendanceSummary.present + (attendanceSummary.late || 0)) / attendanceSummary.total) * 100);
  }, [attendanceSummary]);

  const uniqueSubjects = useMemo(() => {
    const seen = new Set<number>();
    return teachingAssignments.filter(a => {
      if (seen.has(a.subjectId)) return false;
      seen.add(a.subjectId);
      return true;
    });
  }, [teachingAssignments]);

  const uniqueClasses = useMemo(() => {
    const seen = new Set<number>();
    return teachingAssignments.filter(a => {
      if (!a.classId || seen.has(a.classId)) return false;
      seen.add(a.classId);
      return true;
    });
  }, [teachingAssignments]);

  const timetableByDay = useMemo(() => {
    const byDay: Record<number, any[]> = {};
    for (let d = 1; d <= 5; d++) byDay[d] = [];
    timetable.forEach(slot => {
      if (byDay[slot.dayOfWeek]) {
        byDay[slot.dayOfWeek].push(slot);
      }
    });
    for (const d of Object.keys(byDay)) {
      byDay[Number(d)].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
    }
    return byDay;
  }, [timetable]);

  const totalSubjectPages = Math.ceil(subjectsTaught.length / subjectsPerPage);
  const paginatedSubjects = subjectsTaught.slice(subjectPage * subjectsPerPage, (subjectPage + 1) * subjectsPerPage);

  if (showSearch || !selectedStaffId) {
    return (
      <div className="p-6 space-y-4 bg-background min-h-screen">
        <h1 className="text-2xl font-bold" data-testid="text-360-staff-title">360 Staff Profile</h1>
        <p className="text-muted-foreground">Search for a staff member to view their comprehensive profile</p>
        <div className="relative max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-staff-search"
            placeholder="Search by name or staff number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        {searchQuery.length >= 2 && searchResults.length > 0 && (
          <Card>
            <CardContent className="p-2">
              {searchResults.map((s) => (
                <button
                  key={s.id}
                  data-testid={`staff-search-result-${s.id}`}
                  className="w-full flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer text-left"
                  onClick={() => selectStaff(s.id)}
                >
                  <Avatar className="h-10 w-10">
                    {s.photo && <AvatarImage src={s.photo} />}
                    <AvatarFallback>{s.firstName[0]}{s.lastName[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{s.firstName} {s.lastName}</p>
                    <p className="text-sm text-muted-foreground">{s.staffNo} - {s.role}</p>
                  </div>
                  <Badge variant={s.status === "active" ? "default" : "secondary"}>
                    {s.status}
                  </Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        )}
        {searchQuery.length >= 2 && searchResults.length === 0 && (
          <p className="text-muted-foreground">No staff found matching "{searchQuery}"</p>
        )}
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="p-6 space-y-4 bg-background min-h-screen">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-7 w-64" />
        </div>
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-24 w-24 rounded-full" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="p-6 space-y-4 bg-background min-h-screen">
        <Button variant="outline" size="sm" onClick={goBack} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-1">Unable to load profile</h2>
            <p className="text-sm text-muted-foreground mb-4">Something went wrong while loading the staff profile. Please try again.</p>
            <Button variant="outline" onClick={() => setSelectedStaffId(selectedStaffId)} data-testid="button-retry">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!profile || !staffMember) return null;

  const joinedDate = staffMember.createdAt ? new Date(staffMember.createdAt) : null;
  const yearsAgo = joinedDate ? Math.floor((Date.now() - joinedDate.getTime()) / (1000 * 60 * 60 * 24 * 365)) : null;
  const joinedText = yearsAgo !== null ? (yearsAgo === 0 ? "Joined this year" : `Joined ${yearsAgo} year(s) ago`) : "";

  return (
    <div className="p-6 space-y-6 bg-background min-h-screen">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={goBack} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-xl font-bold" data-testid="text-staff-name">
          {staffMember.firstName} {staffMember.lastName} - 360 Profile
        </h1>
      </div>

      <div className="flex flex-col items-center text-center space-y-2">
        <Avatar className="h-24 w-24">
          {staffMember.photo && <AvatarImage src={staffMember.photo} />}
          <AvatarFallback className="text-2xl">{staffMember.firstName[0]}{staffMember.lastName[0]}</AvatarFallback>
        </Avatar>
        <h2 className="text-xl font-semibold">
          {staffMember.firstName} {staffMember.lastName}
          {joinedText && <span className="text-sm font-normal text-muted-foreground ml-2">({joinedText})</span>}
        </h2>
        <div className="flex items-center gap-4 flex-wrap justify-center text-sm text-muted-foreground">
          {staffMember.email && (
            <span className="flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" /> {staffMember.email}
            </span>
          )}
          {staffMember.phone && (
            <span className="flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" /> {staffMember.phone}
            </span>
          )}
          <Badge variant="secondary">{staffMember.role}</Badge>
          <Badge variant={staffMember.status === "active" ? "default" : "secondary"}>{staffMember.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Staff No: {staffMember.staffNo}</p>

        <div className="flex items-center gap-4 flex-wrap justify-center pt-1">
          <div className="flex items-center gap-1.5 text-sm" data-testid="stat-subjects-count">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">{uniqueSubjects.length}</span>
            <span className="text-muted-foreground">Subject{uniqueSubjects.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm" data-testid="stat-classes-count">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">{uniqueClasses.length}</span>
            <span className="text-muted-foreground">Class{uniqueClasses.length !== 1 ? "es" : ""}</span>
          </div>
          {attendanceRate !== null && (
            <div className="flex items-center gap-1.5 text-sm" data-testid="stat-attendance-rate">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className={`font-semibold ${attendanceRate >= 90 ? "text-emerald-600" : attendanceRate >= 75 ? "text-amber-600" : "text-red-600"}`}>
                {attendanceRate}%
              </span>
              <span className="text-muted-foreground">Attendance</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-lg">Timetable</CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              {todayLessons.length} lesson{todayLessons.length !== 1 ? "s" : ""} today
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <h4 className="font-medium text-sm mb-2">Today's Lessons</h4>
                {todayLessons.length === 0 ? (
                  <div className="flex flex-col items-center py-4 text-muted-foreground text-sm">
                    <Calendar className="h-10 w-10 mb-2 opacity-50" />
                    <p>Free today</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todayLessons.map((lesson: any, i: number) => (
                      <div key={i} className="p-2 rounded-md border text-sm">
                        <p className="font-medium">{lesson.subjectName}</p>
                        <p className="text-muted-foreground">{lesson.className}</p>
                        <p className="text-muted-foreground">{lesson.startTime} - {lesson.endTime}</p>
                        {lesson.room && <p className="text-muted-foreground">Room: {lesson.room}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4 className="font-medium text-sm mb-2">Upcoming Lessons</h4>
                {upcomingLessons.length === 0 ? (
                  <div className="flex flex-col items-center py-4 text-muted-foreground text-sm">
                    <Calendar className="h-10 w-10 mb-2 opacity-50" />
                    <p>No upcoming lessons</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {upcomingLessons.map((lesson: any, i: number) => (
                      <div key={i} className="p-2 rounded-md border text-sm">
                        <p className="font-medium">{lesson.subjectName}</p>
                        <p className="text-muted-foreground">{lesson.className}</p>
                        <p className="text-muted-foreground">{lesson.startTime} - {lesson.endTime}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {timetable.length > 0 && (
              <div>
                <h4 className="font-medium text-sm mb-2">Full Weekly Schedule</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse" data-testid="table-weekly-timetable">
                    <thead>
                      <tr className="border-b">
                        {[1, 2, 3, 4, 5].map(d => (
                          <th key={d} className="text-center py-1.5 px-1 font-semibold">{DAY_NAMES[d]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {[1, 2, 3, 4, 5].map(d => (
                          <td key={d} className="align-top p-1 border-r last:border-r-0">
                            {(timetableByDay[d] || []).length === 0 ? (
                              <div className="text-muted-foreground text-center py-2">--</div>
                            ) : (
                              <div className="space-y-1">
                                {(timetableByDay[d] || []).map((slot: any, i: number) => (
                                  <div key={i} className="rounded-md border p-1.5 text-[11px]">
                                    <div className="font-medium truncate">{slot.subjectName}</div>
                                    <div className="text-muted-foreground">{slot.className}</div>
                                    <div className="text-muted-foreground">{slot.startTime}-{slot.endTime}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-lg">Subjects Taught</CardTitle>
            {subjectsTaught.length > 0 && (
              <span className="text-xs text-muted-foreground">{subjectsTaught.length} subject-class pair{subjectsTaught.length !== 1 ? "s" : ""}</span>
            )}
          </CardHeader>
          <CardContent>
            {subjectsTaught.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-muted-foreground text-sm">
                <BookOpen className="h-10 w-10 mb-2 opacity-50" />
                <p>No subjects assigned</p>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  {paginatedSubjects.map((st: any, idx: number) => (
                    <Card key={idx} className="border">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">{st.label}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <h5 className="text-xs font-semibold mb-1">Report on Work Given</h5>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs" data-testid={`table-work-given-${idx}`}>
                              <thead>
                                <tr className="border-b">
                                  <th className="text-left py-1 pr-2">Assessment Type</th>
                                  <th className="text-center py-1 px-2">Given</th>
                                  <th className="text-center py-1 px-2">Avg Performance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(st.workGivenByType || {}).length === 0 && (
                                  <tr>
                                    <td colSpan={3} className="py-2 text-muted-foreground text-center">No work given yet</td>
                                  </tr>
                                )}
                                {Object.entries(st.workGivenByType || {}).map(([typeName, data]: [string, any]) => (
                                  <tr key={typeName} className="border-b last:border-0">
                                    <td className="py-1 pr-2">{typeName}</td>
                                    <td className="text-center py-1 px-2">{data.given}</td>
                                    <td className="text-center py-1 px-2">
                                      {data.avgPerformance !== null ? (
                                        <span className={Math.round(data.avgPerformance) >= 50 ? "text-emerald-600" : "text-red-600"}>
                                          {Math.round(data.avgPerformance)}%
                                        </span>
                                      ) : "--%"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {st.studentPerformanceByExam && st.studentPerformanceByExam.length > 0 && (
                          <div>
                            <h5 className="text-xs font-semibold mb-1">Student Performance by Exam</h5>
                            <div className="h-32">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={st.studentPerformanceByExam}>
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis dataKey="examName" tick={{ fontSize: 9 }} />
                                  <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                                  <Tooltip />
                                  <Line type="monotone" dataKey="avgPercentage" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Avg %" />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
                {totalSubjectPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSubjectPage(p => Math.max(0, p - 1))}
                      disabled={subjectPage === 0}
                      data-testid="button-subjects-prev"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {subjectPage + 1} / {totalSubjectPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSubjectPage(p => Math.min(totalSubjectPages - 1, p + 1))}
                      disabled={subjectPage === totalSubjectPages - 1}
                      data-testid="button-subjects-next"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg">Staff Attendance</CardTitle>
          {attendanceRate !== null && (
            <Badge variant={attendanceRate >= 90 ? "default" : "secondary"} data-testid="badge-attendance-rate">
              {attendanceRate}% Attendance Rate
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {attendanceSummary && (
            <div className="flex items-center gap-4 flex-wrap mb-4">
              <div className="flex items-center gap-1.5 text-sm">
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                <span>Present ({attendanceSummary.present})</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <div className="w-3 h-3 rounded-full bg-amber-500" />
                <span>Late ({attendanceSummary.late})</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span>Absent ({attendanceSummary.absent})</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <div className="w-3 h-3 rounded-full bg-sky-500" />
                <span>Excused/Leave ({attendanceSummary.excused})</span>
              </div>
              <div className="text-sm text-muted-foreground ml-auto">
                Total: {attendanceSummary.total} day{attendanceSummary.total !== 1 ? "s" : ""}
              </div>
            </div>
          )}
          {attendanceMonths.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-muted-foreground text-sm">
              <Calendar className="h-10 w-10 mb-2 opacity-50" />
              <p>No attendance data available</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {attendanceMonths.map((m) => {
                const firstDay = new Date(m.year, m.month, 1).getDay();
                const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();
                const cells: (string | null)[] = Array(firstDay).fill(null);
                for (let d = 1; d <= daysInMonth; d++) {
                  const dateStr = `${m.year}-${String(m.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                  cells.push(dateStr);
                }
                return (
                  <div key={`${m.year}-${m.month}`}>
                    <h4 className="font-semibold text-center mb-2">{m.name} {m.year}</h4>
                    <div className="grid grid-cols-7 gap-1 text-center text-xs">
                      {DAY_SHORT.map(d => (
                        <div key={d} className="font-medium text-muted-foreground py-1">{d}</div>
                      ))}
                      {cells.map((dateStr, i) => {
                        if (!dateStr) return <div key={`empty-${i}`} />;
                        const day = parseInt(dateStr.split("-")[2]);
                        const status = attendanceByDate.get(dateStr);
                        const colorClass = status ? (STAFF_ATTENDANCE_COLORS[status] || "bg-muted") : "";
                        return (
                          <div
                            key={dateStr}
                            className={`w-7 h-7 mx-auto flex items-center justify-center rounded-full text-xs ${colorClass} ${status ? "text-white" : "text-muted-foreground"}`}
                            title={status ? `${dateStr}: ${status}` : dateStr}
                            data-testid={`attendance-day-${dateStr}`}
                          >
                            {day}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
