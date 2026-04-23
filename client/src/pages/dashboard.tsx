import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Search, Phone, Clock, ArrowUp, ArrowDown, CheckCircle, XCircle, BookOpen, BookCopy, AlertTriangle, DollarSign, CheckCircle2, X, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

interface DashboardStats {
  totalStudents: number;
  totalStaff: number;
  totalClasses: number;
  totalSubjects: number;
  attendanceToday: { present: number; absent: number; unmarked: number; total: number; fromDate: string; toDate: string; page: number; pageSize: number; totalPages: number; totalRows: number };
  recentPayments: Array<{ id: number; amount: string; paymentDate: string; paymentMethod: string }>;
  studentsGender: { male: number; female: number };
  studentsDailyStats: { approved: number; pending: number; transferred: number };
  classroomPopulation: Array<{ className: string; count: number }>;
  feesToday: { cash: number; mobileMoney: number; bank: number; total: number };
  termFeesCollected: number;
  staffMonitoring: { present: number; absent: number; late: number; earlyExits: number };
  absentStaff: Array<{ name: string; phone: string }>;
  lateComers: Array<{ name: string; inVariance: string; outVariance: string }>;
  studentsAttendanceByClass: Array<{ classId: number; className: string; teacher: string; absent: number; present: number; unmarked: number; total: number; attendancePercent: number }>;
  enrollmentTrend: Array<{ month: string; count: number }>;
  transferReasons: Array<{ name: string; value: number }>;
  libraryStats: { totalBooks: number; availableCopies: number; currentlyBorrowed: number; overdueBooks: number; unpaidFines: number; unpaidFinesAmount: number; paidFines: number; paidFinesAmount: number };
}

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const getTodayDateValue = () => new Date().toISOString().slice(0, 10);

interface StudentSearchResult {
  id: number;
  firstName: string;
  lastName: string;
  admissionNo: string;
  photo: string | null;
  className: string;
  status: string;
}

interface StaffSearchResult {
  id: number;
  firstName: string;
  lastName: string;
  staffNo: string;
  photo: string | null;
  role: string;
  status: string;
}

export default function Dashboard() {
  const { currentSchoolId } = useAuth();
  const [, setLocation] = useLocation();

  const [studentSearch, setStudentSearch] = useState("");
  const [debouncedStudentSearch, setDebouncedStudentSearch] = useState("");
  const [studentSearchOpen, setStudentSearchOpen] = useState(false);
  const studentSearchRef = useRef<HTMLDivElement>(null);

  const [staffSearch, setStaffSearch] = useState("");
  const [debouncedStaffSearch, setDebouncedStaffSearch] = useState("");
  const [staffSearchOpen, setStaffSearchOpen] = useState(false);
  const staffSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedStudentSearch(studentSearch), 300);
    return () => clearTimeout(t);
  }, [studentSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedStaffSearch(staffSearch), 300);
    return () => clearTimeout(t);
  }, [staffSearch]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (studentSearchRef.current && !studentSearchRef.current.contains(e.target as Node)) {
        setStudentSearchOpen(false);
      }
      if (staffSearchRef.current && !staffSearchRef.current.contains(e.target as Node)) {
        setStaffSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const { data: studentResults, isLoading: studentSearchLoading } = useQuery<StudentSearchResult[]>({
    queryKey: [`/api/students/search?q=${encodeURIComponent(debouncedStudentSearch)}`],
    enabled: debouncedStudentSearch.length >= 2,
  });

  const { data: staffResults, isLoading: staffSearchLoading } = useQuery<StaffSearchResult[]>({
    queryKey: [`/api/staff/search?q=${encodeURIComponent(debouncedStaffSearch)}`],
    enabled: debouncedStaffSearch.length >= 2,
  });

  const todayDate = getTodayDateValue();
  const [attendanceFromDate, setAttendanceFromDate] = useState(todayDate);
  const [attendanceToDate, setAttendanceToDate] = useState(todayDate);
  const [attendancePage, setAttendancePage] = useState(1);
  const attendancePageSize = 10;
  const normalizedAttendanceToDate = attendanceToDate < attendanceFromDate ? attendanceFromDate : attendanceToDate;
  const dashboardStatsQueryKey = `/api/dashboard/stats?fromDate=${attendanceFromDate}&toDate=${normalizedAttendanceToDate}&attendancePage=${attendancePage}&attendancePageSize=${attendancePageSize}`;

  useEffect(() => {
    setAttendancePage(1);
  }, [attendanceFromDate, normalizedAttendanceToDate]);

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: [dashboardStatsQueryKey],
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });

  const { data: commStats } = useQuery<{ email: { sent: number; failed: number; pending: number }; sms: { sent: number; failed: number; pending: number } }>({
    queryKey: ["/api/communication/stats"],
  });

  const { data: school } = useQuery<any>({
    queryKey: ["/api/schools/current"],
    enabled: !!currentSchoolId,
  });

  const { data: boardingHostels = [] } = useQuery<any[]>({
    queryKey: ["/api/hostels"],
    enabled: !!school?.enableHostel,
  });

  const { data: boardingStudents = [] } = useQuery<any[]>({
    queryKey: ["/api/students"],
    enabled: !!school?.enableHostel,
  });

  const todayIso = new Date().toISOString().split('T')[0];
  const { data: hostelRollCallToday = [] } = useQuery<any[]>({
    queryKey: ["/api/hostel/rollcall", todayIso],
    enabled: !!school?.enableHostel,
  });

  const studentAttendanceRate = stats?.attendanceToday.total
    ? Math.round((stats.attendanceToday.present / stats.attendanceToday.total) * 100)
    : 0;
  const attendanceDateLabel = stats
    ? stats.attendanceToday.fromDate === stats.attendanceToday.toDate
      ? stats.attendanceToday.fromDate
      : `${stats.attendanceToday.fromDate} to ${stats.attendanceToday.toDate}`
    : attendanceFromDate === normalizedAttendanceToDate
      ? attendanceFromDate
      : `${attendanceFromDate} to ${normalizedAttendanceToDate}`;

  const staffTotal = stats?.staffMonitoring 
    ? stats.staffMonitoring.present + stats.staffMonitoring.absent + stats.staffMonitoring.late
    : 0;
  const staffPresentRate = staffTotal > 0 
    ? Math.round((stats!.staffMonitoring.present / staffTotal) * 100) 
    : 0;

  const isBoardingSchool = !!school?.enableHostel;
  const boarders = boardingStudents.filter((student) => student.isBoarding && !student.isDayScholar);
  const assignedBoarders = boarders.filter((student) => !!student.hostelId);
  const unassignedBoarders = boarders.length - assignedBoarders.length;
  const occupiedBeds = assignedBoarders.length;
  const hostelAttendancePresent = hostelRollCallToday.filter((row) => row.status === 'present').length;
  const hostelAttendanceAbsent = hostelRollCallToday.filter((row) => row.status !== 'present').length;

  const activeStudents = stats ? stats.studentsDailyStats.approved : 0;
  const unspecifiedGender = stats ? Math.max(0, activeStudents - stats.studentsGender.male - stats.studentsGender.female) : 0;
  const genderData = stats ? [
    { name: 'Boys', value: stats.studentsGender.male, color: '#3b82f6' },
    { name: 'Girls', value: stats.studentsGender.female, color: '#ec4899' },
    ...(unspecifiedGender > 0 ? [{ name: 'Unspecified', value: unspecifiedGender, color: '#a1a1aa' }] : []),
  ] : [];

  // Use real enrollment trend data from API
  const enrollmentTrend = stats?.enrollmentTrend || [];

  // Use real transfer reasons data from API with colors
  const transferReasonColors = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];
  const transferReasons = (stats?.transferReasons || []).map((reason, index) => ({
    ...reason,
    color: transferReasonColors[index % transferReasonColors.length]
  }));

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });

  return (
    <div className="space-y-4 bg-background sm:space-y-6">
      {isBoardingSchool && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Boarding Hostels</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{boardingHostels.length}</div>
              <p className="text-sm text-muted-foreground">Active hostel cards</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Assigned Boarders</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{assignedBoarders.length}</div>
              <p className="text-sm text-muted-foreground">{unassignedBoarders} unassigned boarder(s)</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Occupied Beds</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{occupiedBeds}</div>
              <p className="text-sm text-muted-foreground">Across all hostels</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Hostel Attendance Today</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{hostelAttendancePresent}</div>
              <p className="text-sm text-muted-foreground">{hostelAttendanceAbsent} absent / flagged</p>
            </CardContent>
          </Card>
        </div>
      )}
      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* Left Column - Students Section */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* Students Overview Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Students</span>
                <Badge variant="secondary" className="bg-green-100 text-green-700">
                  {activeStudents} Active
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2" data-testid="stat-total-students">
                      <div>
                        <span className="text-xs text-muted-foreground">Girls</span>
                        <div className="text-xl font-bold">{stats?.studentsGender.female || 0}</div>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Boys</span>
                        <div className="text-xl font-bold">{stats?.studentsGender.male || 0}</div>
                      </div>
                      {unspecifiedGender > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground">N/A</span>
                          <div className="text-xl font-bold text-muted-foreground">{unspecifiedGender}</div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mx-auto h-28 w-28 sm:h-32 sm:w-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={genderData}
                          cx="50%"
                          cy="50%"
                          innerRadius={30}
                          outerRadius={50}
                          dataKey="value"
                        >
                          {genderData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Student 360 Search */}
              <div className="mt-4 relative" ref={studentSearchRef}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search student by name or reg number..."
                    className="pl-10 pr-9"
                    value={studentSearch}
                    onChange={(e) => { setStudentSearch(e.target.value); setStudentSearchOpen(true); }}
                    onFocus={() => setStudentSearchOpen(true)}
                    data-testid="input-student-search"
                  />
                  {studentSearch && (
                    <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => { setStudentSearch(""); setStudentSearchOpen(false); }}
                      data-testid="button-clear-student-search">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {studentSearchOpen && debouncedStudentSearch.length >= 2 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-64 overflow-y-auto">
                    {studentSearchLoading ? (
                      <div className="flex items-center justify-center gap-2 p-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Searching...
                      </div>
                    ) : studentResults && studentResults.length > 0 ? (
                      studentResults.map(s => (
                        <div key={s.id}
                          className="flex items-center gap-3 p-2 hover-elevate cursor-pointer"
                          onClick={() => { setStudentSearch(""); setStudentSearchOpen(false); setLocation(`/student-360?id=${s.id}`); }}
                          data-testid={`search-result-student-${s.id}`}>
                          <Avatar className="h-8 w-8">
                            {s.photo && <AvatarImage src={s.photo} />}
                            <AvatarFallback className="text-xs">{s.firstName?.[0]}{s.lastName?.[0]}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{s.firstName} {s.lastName}</div>
                            <div className="text-xs text-muted-foreground truncate">{s.admissionNo}{s.className ? ` — ${s.className}` : ""}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-sm text-muted-foreground text-center">No students found</div>
                    )}
                  </div>
                )}
              </div>

              {/* Students Daily Statistics */}
              <div className="mt-4 pt-4 border-t">
                <h4 className="text-sm font-medium mb-3">Students Daily Statistics</h4>
                <div className="grid grid-cols-1 gap-3 text-center sm:grid-cols-3 sm:gap-4">
                  <div>
                    <div className="flex items-center justify-center gap-1 text-green-600">
                      <ArrowUp className="w-4 h-4" />
                      <span className="font-bold" data-testid="stat-approved">{stats?.studentsDailyStats.approved || 0}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Approved</span>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1 text-yellow-600">
                      <Clock className="w-4 h-4" />
                      <span className="font-bold" data-testid="stat-pending">{stats?.studentsDailyStats.pending || 0}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Pending</span>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1 text-blue-600">
                      <ArrowDown className="w-4 h-4" />
                      <span className="font-bold" data-testid="stat-transferred">{stats?.studentsDailyStats.transferred || 0}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Transferred</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Student Enrolment Trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Student Enrolment</CardTitle>
              <CardDescription>Shows enrolment numbers for the last 24 months</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={enrollmentTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Middle Column - Transfer & Staff */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* Transfer Trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Student Transfer Trend</CardTitle>
              <CardDescription>Shows student transfer trends over 2 years</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={enrollmentTrend.slice(0, 6)}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Transfer Reasons */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Transfer Reasons</CardTitle>
              <CardDescription>Shows student transfer trends over 2 years</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={transferReasons}
                      cx="50%"
                      cy="50%"
                      outerRadius={60}
                      dataKey="value"
                      label={({ name }) => name}
                    >
                      {transferReasons.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Staff Monitoring */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Staff Monitoring</CardTitle>
                <Badge variant="secondary" className={staffPresentRate > 50 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
                  {staffPresentRate}% Present
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <>
                  <div className="flex items-center gap-4 text-sm mb-4">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-green-500"></span>
                      {stats?.staffMonitoring.present || 0} Present
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-red-500"></span>
                      {stats?.staffMonitoring.absent || 0} Absent
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
                      {stats?.staffMonitoring.late || 0} Late
                    </span>
                  </div>

                  {/* Staff 360 Search */}
                  <div className="relative mb-4" ref={staffSearchRef}>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Search staff by name or staff number..."
                        className="pl-10 pr-9"
                        value={staffSearch}
                        onChange={(e) => { setStaffSearch(e.target.value); setStaffSearchOpen(true); }}
                        onFocus={() => setStaffSearchOpen(true)}
                        data-testid="input-staff-search"
                      />
                      {staffSearch && (
                        <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => { setStaffSearch(""); setStaffSearchOpen(false); }}
                          data-testid="button-clear-staff-search">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {staffSearchOpen && debouncedStaffSearch.length >= 2 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-64 overflow-y-auto">
                        {staffSearchLoading ? (
                          <div className="flex items-center justify-center gap-2 p-3 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Searching...
                          </div>
                        ) : staffResults && staffResults.length > 0 ? (
                          staffResults.map(s => (
                            <div key={s.id}
                              className="flex items-center gap-3 p-2 hover-elevate cursor-pointer"
                              onClick={() => { setStaffSearch(""); setStaffSearchOpen(false); setLocation(`/staff-360?id=${s.id}`); }}
                              data-testid={`search-result-staff-${s.id}`}>
                              <Avatar className="h-8 w-8">
                                {s.photo && <AvatarImage src={s.photo} />}
                                <AvatarFallback className="text-xs">{s.firstName?.[0]}{s.lastName?.[0]}</AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{s.firstName} {s.lastName}</div>
                                <div className="text-xs text-muted-foreground truncate">{s.staffNo}{s.role ? ` — ${s.role}` : ""}</div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="p-3 text-sm text-muted-foreground text-center">No staff found</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Absent Staff Table */}
                  <div className="mb-4">
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-red-500" />
                      Absent Staff
                    </h4>
                    <p className="text-xs text-muted-foreground mb-2">Staff who did not come to school</p>
                    {stats?.absentStaff && stats.absentStaff.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Teacher</TableHead>
                            <TableHead className="text-xs">Phone</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {stats.absentStaff.slice(0, 5).map((s, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs py-2">{s.name}</TableCell>
                              <TableCell className="text-xs py-2">{s.phone}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Staff attendance data from clock-in app
                      </p>
                    )}
                  </div>

                  {/* Late Comers Table */}
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-yellow-500" />
                      Late Comers and Early Leavers
                    </h4>
                    <p className="text-xs text-muted-foreground mb-2">Staff who clocked in after school start time</p>
                    {stats?.lateComers && stats.lateComers.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Teacher</TableHead>
                            <TableHead className="text-xs">In Variance</TableHead>
                            <TableHead className="text-xs">Out Variance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {stats.lateComers.slice(0, 5).map((s, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs py-2">{s.name}</TableCell>
                              <TableCell className="text-xs py-2">{s.inVariance}</TableCell>
                              <TableCell className="text-xs py-2">{s.outVariance}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Staff timing data from clock-in app
                      </p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Attendance */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* Students Attendance */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-lg">Students Attendance</CardTitle>
                  <Badge
                    variant="secondary"
                    className={
                      studentAttendanceRate >= 80
                        ? "bg-green-100 text-green-700"
                        : studentAttendanceRate < 50
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                    }
                  >
                    {studentAttendanceRate}% Present
                  </Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
                  <div>
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input
                      type="date"
                      value={attendanceFromDate}
                      onChange={(event) => setAttendanceFromDate(event.target.value || todayDate)}
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input
                      type="date"
                      value={normalizedAttendanceToDate}
                      min={attendanceFromDate}
                      onChange={(event) => setAttendanceToDate(event.target.value || attendanceFromDate)}
                      className="mt-1 h-9"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    onClick={() => {
                      const todayValue = getTodayDateValue();
                      setAttendanceFromDate(todayValue);
                      setAttendanceToDate(todayValue);
                      setAttendancePage(1);
                    }}
                  >
                    Today
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <>
                  <div className="mb-4">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div className="rounded bg-green-50 p-2 text-center">
                        <div className="text-muted-foreground">Present</div>
                        <div className="text-lg font-bold text-green-600">{stats?.attendanceToday.present || 0}</div>
                      </div>
                      <div className="rounded bg-red-50 p-2 text-center">
                        <div className="text-muted-foreground">Absent</div>
                        <div className="text-lg font-bold text-red-600">{stats?.attendanceToday.absent || 0}</div>
                      </div>
                      <div className="rounded bg-amber-50 p-2 text-center">
                        <div className="text-muted-foreground">Unmarked</div>
                        <div className="text-lg font-bold text-amber-600">{stats?.attendanceToday.unmarked || 0}</div>
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground mb-4">
                    {attendanceDateLabel}
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-xs">Class</TableHead>
                          <TableHead className="text-xs">Teacher(s)</TableHead>
                          <TableHead className="text-xs text-right">Absent</TableHead>
                          <TableHead className="text-xs text-right">Present</TableHead>
                          <TableHead className="text-xs text-right">Unmarked</TableHead>
                          <TableHead className="text-xs text-right">Total (%)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stats?.studentsAttendanceByClass && stats.studentsAttendanceByClass.length > 0 ? (
                          stats.studentsAttendanceByClass.map((row) => (
                            <TableRow key={row.classId}>
                              <TableCell className="text-xs py-2">{row.className}</TableCell>
                              <TableCell className="text-xs py-2">{row.teacher}</TableCell>
                              <TableCell className="text-xs py-2 text-right">{row.absent}</TableCell>
                              <TableCell className="text-xs py-2 text-right">{row.present}</TableCell>
                              <TableCell className="text-xs py-2 text-right">{row.unmarked}</TableCell>
                              <TableCell className="text-xs py-2 text-right">{row.total} ({Math.round(row.attendancePercent)}%)</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-4">
                              No attendance data for the selected date range
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                    <div className="text-muted-foreground">
                      {stats?.attendanceToday.totalRows ? (
                        <>Showing page {stats.attendanceToday.page} of {stats.attendanceToday.totalPages} ({stats.attendanceToday.totalRows} classes)</>
                      ) : (
                        <>No classes found for the selected date range</>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAttendancePage((current) => Math.max(1, current - 1))}
                        disabled={!stats || stats.attendanceToday.page <= 1}
                      >
                        Previous
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAttendancePage((current) => Math.min(stats?.attendanceToday.totalPages || current, current + 1))}
                        disabled={!stats || stats.attendanceToday.page >= stats.attendanceToday.totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom Row - Classroom Population & Fees */}
      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* Classroom Population */}
        <div className="col-span-12 lg:col-span-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Classroom Population</CardTitle>
              <CardDescription>Shows students (approved only) numbers in a given class</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats?.classroomPopulation || []}>
                      <XAxis dataKey="className" tick={{ fontSize: 8 }} angle={-45} textAnchor="end" height={60} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Class List */}
              {stats?.classroomPopulation && stats.classroomPopulation.length > 0 && (
                <div className="mt-4 border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs">Class</TableHead>
                        <TableHead className="text-xs text-right">Number of Students</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.classroomPopulation.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs py-2">{row.className}</TableCell>
                          <TableCell className="text-xs py-2 text-right">{row.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Today's Fees Collections */}
        <div className="col-span-12 lg:col-span-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Today Fees Collections</CardTitle>
                <Badge variant="secondary" className="bg-green-100 text-green-700">
                  USD{stats?.feesToday.total.toFixed(2) || '0.00'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm">Cash</span>
                  <span className="font-medium">USD{stats?.feesToday.cash.toFixed(2) || '0.00'}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm">Mobile Money</span>
                  <span className="font-medium">USD{stats?.feesToday.mobileMoney.toFixed(2) || '0.00'}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="text-sm">Bank</span>
                  <span className="font-medium">USD{stats?.feesToday.bank.toFixed(2) || '0.00'}</span>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Term Fees Collections</CardTitle>
                  <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                    USD{stats?.termFeesCollected.toFixed(2) || '0.00'}
                  </Badge>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Cash</span>
                    <span>USD0</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Mobile Money</span>
                    <span>USD0</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Bank</span>
                    <span>USD0</span>
                  </div>
                </div>
              </div>

              {/* Monthly Fees Chart */}
              <div className="mt-6">
                <h4 className="text-sm font-medium mb-2">Term Monthly Fees Collections</h4>
                <p className="text-xs text-muted-foreground mb-4">Show total received payments from students</p>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={[
                      { month: 'Feb', amount: 0.2 },
                      { month: 'May', amount: 0.4 },
                      { month: 'Aug', amount: 0.6 },
                      { month: 'Nov', amount: 0.8 },
                      { month: 'Feb', amount: 0.3 }
                    ]}>
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="amount" stroke="#22c55e" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Library Stats */}
        <div className="col-span-12 lg:col-span-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Library</CardTitle>
                <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                  {stats?.libraryStats?.totalBooks || 0} Books
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center gap-2 text-sm">
                      <BookOpen className="w-4 h-4 text-blue-600" />
                      Total Books
                    </span>
                    <span className="font-medium" data-testid="dashboard-lib-total">{stats?.libraryStats?.totalBooks || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center gap-2 text-sm">
                      <BookCopy className="w-4 h-4 text-green-600" />
                      Available Copies
                    </span>
                    <span className="font-medium" data-testid="dashboard-lib-available">{stats?.libraryStats?.availableCopies || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center gap-2 text-sm">
                      <Users className="w-4 h-4 text-yellow-600" />
                      Currently Borrowed
                    </span>
                    <span className="font-medium" data-testid="dashboard-lib-borrowed">{stats?.libraryStats?.currentlyBorrowed || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      Overdue Books
                    </span>
                    <span className="font-medium" data-testid="dashboard-lib-overdue">{stats?.libraryStats?.overdueBooks || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center gap-2 text-sm">
                      <DollarSign className="w-4 h-4 text-orange-600" />
                      Unpaid Fines
                    </span>
                    <span className="font-medium" data-testid="dashboard-lib-unpaid">
                      {stats?.libraryStats?.unpaidFines || 0} (${(stats?.libraryStats?.unpaidFinesAmount || 0).toFixed(2)})
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Paid Fines
                    </span>
                    <span className="font-medium" data-testid="dashboard-lib-paid">
                      {stats?.libraryStats?.paidFines || 0} (${(stats?.libraryStats?.paidFinesAmount || 0).toFixed(2)})
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* SMS Usage */}
        <div className="col-span-12 lg:col-span-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Communication Usage</CardTitle>
                {commStats && (commStats.sms.sent + commStats.email.sent) > 0 && (
                  <Badge variant="secondary" className="bg-green-100 text-green-700">
                    {Math.round(((commStats.sms.sent + commStats.email.sent) / 
                      (commStats.sms.sent + commStats.sms.failed + commStats.email.sent + commStats.email.failed || 1)) * 100)}% Delivered
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!commStats || (commStats.sms.sent + commStats.sms.failed + commStats.email.sent + commStats.email.failed) === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">No communication data yet</p>
                  <p className="text-xs mt-2">Start sending emails or SMS to see stats here</p>
                </div>
              ) : (
                <>
                  <div className="space-y-4 mb-6">
                    <div>
                      <h4 className="text-sm font-medium mb-2">Email</h4>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-green-500"></span>
                          <span className="text-sm">{commStats.email.sent} Sent</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-red-500"></span>
                          <span className="text-sm">{commStats.email.failed} Failed</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium mb-2">SMS</h4>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-green-500"></span>
                          <span className="text-sm">{commStats.sms.sent} Sent</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-red-500"></span>
                          <span className="text-sm">{commStats.sms.failed} Failed</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
