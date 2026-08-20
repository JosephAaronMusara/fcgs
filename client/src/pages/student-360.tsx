import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, schoolFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ArrowLeft, Mail, Phone, MapPin, Calendar, User, BookOpen, AlertTriangle, DollarSign, FileText, AlertCircle, Clock, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocation } from "wouter";

interface SearchResult {
  id: number;
  firstName: string;
  lastName: string;
  admissionNo: string;
  photo: string | null;
  className: string;
  status: string;
}

interface ProfileData {
  student: any;
  parent: any;
  subjects: any[];
  exams: any[];
  results: any[];
  summaryStats: any;
  workWritten: any[];
  performanceBySubject: any[];
  performanceOverTime: any[];
  attendanceSummary: any;
  attendanceCalendar: any[];
  libraryBorrowings: any[];
  disciplineRecords: any[];
  feesPayments: any[];
  feesBalance: string;
  feesTotalTerm: string;
  feesPaidSoFar: string;
}

const STATUS_COLORS: Record<string, string> = {
  present: "bg-emerald-500",
  absent: "bg-red-500",
  sick: "bg-amber-500",
  excused: "bg-sky-500",
  late: "bg-orange-800",
  fees: "bg-purple-500",
  sent_home_fees: "bg-purple-500",
  suspended: "bg-rose-700",
  absconding: "bg-gray-700",
};

const STATUS_LETTERS: Record<string, string> = {
  present: "P",
  absent: "A",
  sick: "S",
  excused: "E",
  late: "L",
  fees: "F",
  sent_home_fees: "F",
  suspended: "S",
  absconding: "A",
};

const CHART_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

function dateInputValue(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function nullableText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export default function Student360Page() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlStudentId = urlParams.get("id") ? parseInt(urlParams.get("id")!) : null;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(urlStudentId);
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [showSearch, setShowSearch] = useState(!urlStudentId);
  const [libraryPage, setLibraryPage] = useState(1);
  const [studentEditOpen, setStudentEditOpen] = useState(false);
  const [parentEditOpen, setParentEditOpen] = useState(false);
  const [studentDraft, setStudentDraft] = useState<Record<string, any>>({});
  const [parentDraft, setParentDraft] = useState<Record<string, any>>({});
  const libraryPerPage = 5;
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: searchResults = [] } = useQuery<SearchResult[]>({
    queryKey: ["/api/students/search", searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      const res = await schoolFetch(`/api/students/search?q=${encodeURIComponent(searchQuery)}`);
      return res.json();
    },
    enabled: searchQuery.length >= 2,
  });

  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery<ProfileData>({
    queryKey: ["/api/student-profile", selectedStudentId, selectedExamId],
    queryFn: async () => {
      const params = selectedExamId ? `?examId=${selectedExamId}` : "";
      const res = await schoolFetch(`/api/student-profile/${selectedStudentId}${params}`);
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
    enabled: !!selectedStudentId,
  });

  const selectStudent = (id: number) => {
    setSelectedStudentId(id);
    setShowSearch(false);
    setSearchQuery("");
    setSelectedExamId("");
    setLibraryPage(1);
    window.history.replaceState(null, "", `/student-360?id=${id}`);
  };

  const goBack = () => {
    setLocation("/dashboard");
  };

  const student = profile?.student;
  const parent = profile?.parent;
  const subjects = profile?.subjects || [];
  const exams = profile?.exams || [];
  const results = profile?.results || [];
  const summaryStats = profile?.summaryStats;
  const workWritten = profile?.workWritten || [];
  const performanceBySubject = profile?.performanceBySubject || [];
  const performanceOverTime = profile?.performanceOverTime || [];
  const attendanceSummary = profile?.attendanceSummary;
  const attendanceCalendar = profile?.attendanceCalendar || [];
  const libraryBorrowings = profile?.libraryBorrowings || [];
  const disciplineRecords = profile?.disciplineRecords || [];

  const updateStudentMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      if (!selectedStudentId) throw new Error("No student selected");
      const res = await apiRequest("PUT", `/api/students/${selectedStudentId}`, payload);
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/student-profile", selectedStudentId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/students"] }),
      ]);
      setStudentEditOpen(false);
      toast({ title: "Student updated", description: "Student information was updated successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to update student", description: error.message, variant: "destructive" });
    },
  });

  const updateParentMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      if (!parent?.id) throw new Error("No parent selected");
      const res = await apiRequest("PUT", `/api/parents/${parent.id}`, payload);
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/student-profile", selectedStudentId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/parents"] }),
      ]);
      setParentEditOpen(false);
      toast({ title: "Parent updated", description: "Parent information was updated successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to update parent", description: error.message, variant: "destructive" });
    },
  });

  const openStudentEditor = () => {
    if (!student) return;
    setStudentDraft({
      firstName: student.firstName || "",
      lastName: student.lastName || "",
      gender: student.gender || "",
      dateOfBirth: dateInputValue(student.dateOfBirth),
      phone: student.phone || "",
      email: student.email || "",
      nationalIdNumber: student.nationalIdNumber || "",
      passportNumber: student.passportNumber || "",
      streetAddress: student.streetAddress || "",
      residentialArea: student.residentialArea || "",
      address: student.address || "",
    });
    setStudentEditOpen(true);
  };

  const openParentEditor = () => {
    if (!parent) return;
    setParentDraft({
      firstName: parent.firstName || "",
      lastName: parent.lastName || "",
      phone: parent.phone || "",
      email: parent.email || "",
      relationship: parent.relationship || "parent",
      occupation: parent.occupation || "",
      streetAddress: parent.streetAddress || "",
      residentialArea: parent.residentialArea || "",
      address: parent.address || "",
    });
    setParentEditOpen(true);
  };

  const saveStudent = () => {
    if (!String(studentDraft.firstName || "").trim() || !String(studentDraft.lastName || "").trim()) {
      toast({ title: "Name required", description: "First name and last name are required.", variant: "destructive" });
      return;
    }
    updateStudentMutation.mutate({
      firstName: String(studentDraft.firstName).trim(),
      lastName: String(studentDraft.lastName).trim(),
      gender: studentDraft.gender || null,
      dateOfBirth: studentDraft.dateOfBirth || null,
      phone: nullableText(studentDraft.phone),
      email: nullableText(studentDraft.email),
      nationalIdNumber: nullableText(studentDraft.nationalIdNumber),
      passportNumber: nullableText(studentDraft.passportNumber),
      streetAddress: nullableText(studentDraft.streetAddress),
      residentialArea: nullableText(studentDraft.residentialArea),
      address: nullableText(studentDraft.address),
    });
  };

  const saveParent = () => {
    if (!String(parentDraft.firstName || "").trim() || !String(parentDraft.lastName || "").trim() || !String(parentDraft.phone || "").trim()) {
      toast({ title: "Required details missing", description: "Parent first name, last name and phone number are required.", variant: "destructive" });
      return;
    }
    updateParentMutation.mutate({
      firstName: String(parentDraft.firstName).trim(),
      lastName: String(parentDraft.lastName).trim(),
      phone: String(parentDraft.phone).trim(),
      email: nullableText(parentDraft.email),
      relationship: nullableText(parentDraft.relationship) || "parent",
      occupation: nullableText(parentDraft.occupation),
      streetAddress: nullableText(parentDraft.streetAddress),
      residentialArea: nullableText(parentDraft.residentialArea),
      address: nullableText(parentDraft.address),
    });
  };

  const attendanceRate = useMemo(() => {
    if (!attendanceSummary || attendanceSummary.total === 0) return null;
    return Math.round((attendanceSummary.present / attendanceSummary.total) * 100);
  }, [attendanceSummary]);

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
        name: current.toLocaleString("default", { month: "short" }),
      });
      current.setMonth(current.getMonth() + 1);
    }
    return months;
  }, [attendanceCalendar]);

  const paginatedLoans = libraryBorrowings.slice((libraryPage - 1) * libraryPerPage, libraryPage * libraryPerPage);
  const totalLibraryPages = Math.ceil(libraryBorrowings.length / libraryPerPage);

  const chartTypes = useMemo(() => {
    const types = new Set<string>();
    (performanceBySubject || []).forEach((p: any) => {
      Object.keys(p.avgByType).forEach(t => types.add(t));
    });
    return Array.from(types);
  }, [performanceBySubject]);

  if (showSearch || !selectedStudentId) {
    return (
      <div className="p-3 sm:p-4 lg:p-6 space-y-4 bg-background min-h-screen">
        <h1 className="text-2xl font-bold" data-testid="text-360-title">360 Student Profile</h1>
        <p className="text-muted-foreground">Search for a student to view their comprehensive profile</p>
        <div className="relative max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-student-search"
            placeholder="Search by name or registration number..."
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
                  data-testid={`search-result-${s.id}`}
                  className="w-full flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer text-left"
                  onClick={() => selectStudent(s.id)}
                >
                  <Avatar className="h-10 w-10">
                    {s.photo && <AvatarImage src={s.photo} />}
                    <AvatarFallback>{s.firstName[0]}{s.lastName[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{s.firstName} {s.lastName}</p>
                    <p className="text-sm text-muted-foreground">{s.admissionNo} {s.className && `- ${s.className}`}</p>
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
          <p className="text-muted-foreground">No students found matching "{searchQuery}"</p>
        )}
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="p-3 sm:p-4 lg:p-6 space-y-4 bg-background min-h-screen">
        <Skeleton className="h-8 w-32" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="p-3 sm:p-4 lg:p-6 space-y-4 bg-background min-h-screen">
        <Button variant="outline" size="sm" onClick={goBack} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-1">Unable to load profile</h2>
            <p className="text-sm text-muted-foreground mb-4">Something went wrong while loading the student profile. Please try again.</p>
            <Button variant="outline" onClick={() => setSelectedStudentId(selectedStudentId)} data-testid="button-retry">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!profile || !student) return null;

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-6 bg-background min-h-screen">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={goBack} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-xl font-bold" data-testid="text-student-name">
          {student.firstName} {student.lastName} - 360 Profile
        </h1>
        {attendanceRate !== null && (
          <Badge variant={attendanceRate >= 90 ? "default" : "secondary"} data-testid="badge-attendance-rate">
            <Clock className="h-3 w-3 mr-1" />
            {attendanceRate}% Attendance
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">Student Information</CardTitle>
              {hasPermission("students.edit") && (
                <Button variant="outline" size="sm" onClick={openStudentEditor} data-testid="button-edit-student-360">
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="flex flex-col items-center gap-3">
                <Avatar className="h-24 w-24">
                  {student.photo && <AvatarImage src={student.photo} />}
                  <AvatarFallback className="text-2xl">{student.firstName[0]}{student.lastName[0]}</AvatarFallback>
                </Avatar>
                <div className="text-center">
                  <h2 className="text-lg font-bold" data-testid="text-profile-name">{student.firstName} {student.lastName}</h2>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">Class:</span>
                  <span className="font-medium" data-testid="text-class">{student.className || "N/A"}</span>
                  {student.streamName && <span className="text-muted-foreground">({student.streamName})</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">Registration No:</span>
                  <span className="font-medium" data-testid="text-reg-no">{student.admissionNo}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Enrolled On:</span>
                  <span className="font-medium">{student.enrollmentDate ? new Date(student.enrollmentDate).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "N/A"}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant={student.status === "active" ? "default" : "secondary"} data-testid="badge-status">
                    {(student.status || "").toUpperCase()}
                  </Badge>
                </div>
                {student.address && (
                  <div className="flex items-start gap-2">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                    <span>{student.address}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Gender:</span>
                  <span className="font-medium">{student.gender ? student.gender.charAt(0).toUpperCase() + student.gender.slice(1) : "N/A"}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">D.O.B:</span>
                  <span className="font-medium">{student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString("en-GB") : "N/A"}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Account Statement:</span>
                  <span className={`font-medium ${parseFloat(profile.feesBalance || "0") > 0 ? "text-red-500" : "text-emerald-600"}`} data-testid="text-fees-balance">
                    {parseFloat(profile.feesBalance || "0") > 0 ? `Owing USD ${parseFloat(profile.feesBalance).toFixed(2)}` : "Cleared"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {parent && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold">Parent Information</CardTitle>
                {hasPermission("parents.edit") && (
                  <Button variant="outline" size="sm" onClick={openParentEditor} data-testid="button-edit-parent-360">
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Name:</span>{" "}
                  <span className="font-medium" data-testid="text-parent-name">{parent.firstName} {parent.lastName}</span>
                </div>
                {parent.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{parent.phone}</span>
                  </div>
                )}
                {parent.email ? (
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{parent.email}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <span>No email</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Subjects</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="flex flex-wrap gap-1.5">
                {subjects.map((s: any) => (
                  <Badge key={s.id} variant="secondary" className="text-xs" data-testid={`badge-subject-${s.id}`}>
                    {s.name}{s.syllabusCode ? ` - ${s.syllabusCode}` : ""}
                  </Badge>
                ))}
                {subjects.length === 0 && <p className="text-sm text-muted-foreground">No subjects enrolled</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* MIDDLE COLUMN - Results */}
        <div className="lg:col-span-5 space-y-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-lg font-bold">Results</CardTitle>
              <Select value={selectedExamId} onValueChange={(val) => setSelectedExamId(val)}>
                <SelectTrigger className="w-52" data-testid="select-exam">
                  <SelectValue placeholder="Select Exam" />
                </SelectTrigger>
                <SelectContent>
                  {exams.map((e: any) => (
                    <SelectItem key={e.id} value={String(e.id)} data-testid={`exam-option-${e.id}`}>
                      {e.examName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {!selectedExamId && (
                <p className="text-sm text-muted-foreground py-8 text-center">Select an exam to view results</p>
              )}
              {selectedExamId && summaryStats && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center text-xs border-b pb-3">
                    <div>
                      <div className="text-muted-foreground">Total Marks</div>
                      <div className="font-bold text-sm" data-testid="text-total-marks">{summaryStats.totalMarks}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Average Mark</div>
                      <div className="font-bold text-sm" data-testid="text-avg-mark">{summaryStats.averageMark}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Subject Passed</div>
                      <div className="font-bold text-sm" data-testid="text-subjects-passed">{summaryStats.subjectsPassed}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Points</div>
                      <div className="font-bold text-sm">{summaryStats.points}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Class Position</div>
                      <div className="font-bold text-sm" data-testid="text-class-position">
                        {summaryStats.classPosition || "N/A"}
                        {summaryStats.totalInClass ? `/${summaryStats.totalInClass}` : ""}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Stream Position</div>
                      <div className="font-bold text-sm" data-testid="text-stream-position">
                        {summaryStats.streamPosition || "N/A"}
                        {summaryStats.totalInStream ? `/${summaryStats.totalInStream}` : ""}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {results.map((r: any, i: number) => (
                      <div key={i} className="border-b pb-2 last:border-b-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm" data-testid={`text-result-subject-${r.subjectId}`}>
                              {r.subjectName}{r.syllabusCode ? ` - ${r.syllabusCode}` : ""}
                            </div>
                            {r.comment && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.comment}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-right shrink-0">
                            <span className="text-sm font-semibold" data-testid={`text-result-pct-${r.subjectId}`}>
                              {r.percentage != null ? `${Math.round(r.percentage)}%` : "-"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {r.classPosition ? `${r.classPosition}` : ""}
                            </span>
                            <Badge variant="secondary" className="text-xs min-w-[1.5rem] justify-center" data-testid={`badge-grade-${r.subjectId}`}>
                              {r.gradeName || "-"}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                    {results.length === 0 && selectedExamId && (
                      <p className="text-sm text-muted-foreground text-center py-4">No results found for this exam</p>
                    )}
                  {Number(summaryStats.subjectsUnresolved || 0) > 0 && (
                    <div className="col-span-3 sm:col-span-6 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-xs text-amber-800">
                      {summaryStats.subjectsUnresolved} subject result{Number(summaryStats.subjectsUnresolved) === 1 ? " is" : "s are"} unresolved. Pass counts and positions remain provisional until the exact grading configuration is complete.
                    </div>
                  )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {performanceOverTime.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  {student.firstName} {student.lastName} - Performance over time
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="flex items-center gap-4 mb-2 text-xs">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-0.5 bg-blue-500" />
                    <span>{student.firstName}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-0.5 bg-emerald-500" />
                    <span>Class Average</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={performanceOverTime}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="examName" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="studentAvg" stroke="#3b82f6" strokeWidth={2} name={student.firstName} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="classAvg" stroke="#22c55e" strokeWidth={2} name="Class Average" dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {performanceBySubject.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Subject Performance vs Class</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={performanceBySubject.map(p => {
                    const firstType = Object.keys(p.avgByType)[0];
                    return { name: p.shortCode, avg: firstType ? p.avgByType[firstType] : 0 };
                  })}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip />
                    <Bar dataKey="avg" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT COLUMN - Work Written & Subject Performance */}
        <div className="lg:col-span-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-bold">Work Written</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 gap-2">
                {workWritten.map((w: any) => (
                  <div key={w.subjectId} className="border rounded-md p-2 text-xs" data-testid={`work-written-${w.subjectId}`}>
                    <div className="font-medium truncate mb-1">
                      {w.subjectName}{w.syllabusCode ? ` - ${w.syllabusCode}` : ""}
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-center text-muted-foreground">
                      <div>
                        <div className="text-[10px]">Test(s)</div>
                        <div className="font-semibold text-foreground">{w.tests.done}/{w.tests.total}</div>
                      </div>
                      <div>
                        <div className="text-[10px]">Exercises</div>
                        <div className="font-semibold text-foreground">{w.exercises.done}/{w.exercises.total}</div>
                      </div>
                      <div>
                        <div className="text-[10px]">Fortnight</div>
                        <div className="font-semibold text-foreground">{w.fortnights.done}/{w.fortnights.total}</div>
                      </div>
                    </div>
                  </div>
                ))}
                {workWritten.length === 0 && (
                  <p className="text-sm text-muted-foreground col-span-2 text-center py-4">No work written data</p>
                )}
              </div>
            </CardContent>
          </Card>

          {performanceBySubject.length > 0 && chartTypes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Subject Performance</CardTitle>
                <div className="flex flex-wrap gap-3 mt-1">
                  {chartTypes.map((t, i) => (
                    <div key={t} className="flex items-center gap-1 text-xs">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span>{t}</span>
                    </div>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={performanceBySubject.map(p => ({
                    name: p.shortCode,
                    ...p.avgByType,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} label={{ value: "Marks(%)", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                    <Tooltip />
                    {chartTypes.map((t, i) => (
                      <Bar key={t} dataKey={t} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[2, 2, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* BOTTOM SECTIONS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
        {/* Fees Payment History */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Fees Payment History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {(profile.feesPayments || []).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No payment records</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs border-b pb-2 mb-2">
                  <div>
                    <span className="text-muted-foreground">Total Fees:</span>
                    <div className="font-semibold">USD {parseFloat(profile.feesTotalTerm || "0").toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Paid So Far:</span>
                    <div className="font-semibold text-emerald-600">USD {parseFloat(profile.feesPaidSoFar || "0").toFixed(2)}</div>
                  </div>
                </div>
                {(profile.feesPayments || []).slice(0, 8).map((p: any, i: number) => (
                  <div key={p.id || i} className="border rounded-md p-2 text-xs" data-testid={`payment-${p.id || i}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">USD {parseFloat(p.amount || "0").toFixed(2)}</span>
                      <Badge variant="secondary" className="text-[10px]">{p.paymentMethod || "N/A"}</Badge>
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      {p.paymentDate ? new Date(p.paymentDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "N/A"}
                      {p.receiptNumber && ` - #${p.receiptNumber}`}
                    </div>
                    {p.description && <div className="text-muted-foreground truncate">{p.description}</div>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Library Book Borrowings */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Library Book Borrowings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {libraryBorrowings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No data</p>
              </div>
            ) : (
              <div className="space-y-3">
                {paginatedLoans.map((loan: any) => (
                  <div key={loan.id} className="border rounded-md p-3 text-sm" data-testid={`loan-${loan.id}`}>
                    <div className="font-medium">{loan.bookTitle}</div>
                    {loan.author && <div className="text-xs text-muted-foreground">{loan.author}</div>}
                    <div className="text-xs text-muted-foreground mt-1">
                      Borrowed: {loan.issuedAt ? new Date(loan.issuedAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "N/A"}
                      {loan.returnedAt && (
                        <> Returned: {new Date(loan.returnedAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</>
                      )}
                    </div>
                    <div className="flex justify-end mt-1">
                      <span className="text-xs font-medium">USD {loan.fineAmount || "0"}</span>
                    </div>
                  </div>
                ))}
                {totalLibraryPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={libraryPage <= 1}
                      onClick={() => setLibraryPage(p => p - 1)}
                      data-testid="button-lib-prev"
                    >
                      &lt;
                    </Button>
                    <span className="text-xs">{libraryPage}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={libraryPage >= totalLibraryPages}
                      onClick={() => setLibraryPage(p => p + 1)}
                      data-testid="button-lib-next"
                    >
                      &gt;
                    </Button>
                    <span className="text-xs text-muted-foreground">{libraryPerPage} / page</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Disciplinary Records */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Disciplinary Records
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {disciplineRecords.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No data</p>
              </div>
            ) : (
              <div className="space-y-2">
                {disciplineRecords.slice(0, 10).map((d: any) => (
                  <div key={d.id} className="border rounded-md p-2 text-sm" data-testid={`discipline-${d.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{d.incidentType}</span>
                      <Badge variant={d.severity === "major" ? "destructive" : "secondary"} className="text-xs">
                        {d.severity}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{d.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.incidentDate ? new Date(d.incidentDate).toLocaleDateString("en-GB") : ""}
                      {d.actionTaken && ` - ${d.actionTaken}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attendance Register */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Attendance Register
            </CardTitle>
            {attendanceRate !== null && (
              <Badge variant={attendanceRate >= 90 ? "default" : "secondary"} className="text-xs" data-testid="badge-section-attendance-rate">
                {attendanceRate}%
              </Badge>
            )}
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-sm mb-2" data-testid="text-attendance-summary">
              Attended <span className="font-bold">{attendanceSummary.present}</span> out of <span className="font-bold">{attendanceSummary.total}</span> school days
            </div>
            <div className="flex flex-wrap gap-2 mb-3 text-xs">
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold">P</span>
                Present({attendanceSummary.present})
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold">A</span>
                Absent({attendanceSummary.absent})
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold">S</span>
                Sick({attendanceSummary.sick})
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-purple-500 text-white text-[10px] font-bold">F</span>
                Fees({attendanceSummary.fees})
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-sky-500 text-white text-[10px] font-bold">E</span>
                Excused({attendanceSummary.excused})
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-800 text-white text-[10px] font-bold">L</span>
                Late({attendanceSummary.late})
              </div>
            </div>

            <div className="space-y-3">
              {attendanceMonths.map((m) => {
                const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();
                const firstDay = new Date(m.year, m.month, 1).getDay();
                const cells: (string | null)[] = [];
                for (let i = 0; i < firstDay; i++) cells.push(null);
                for (let d = 1; d <= daysInMonth; d++) {
                  const dateStr = `${m.year}-${String(m.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                  cells.push(dateStr);
                }

                return (
                  <div key={`${m.year}-${m.month}`}>
                    <div className="text-xs font-semibold mb-1">{m.name}</div>
                    <div className="grid grid-cols-7 gap-0.5 text-[10px]">
                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
                        <div key={d} className="text-center text-muted-foreground font-medium">{d}</div>
                      ))}
                      {cells.map((dateStr, i) => {
                        if (!dateStr) return <div key={`empty-${i}`} />;
                        const dayNum = parseInt(dateStr.split("-")[2]);
                        const status = attendanceByDate.get(dateStr);
                        const bgColor = status ? STATUS_COLORS[status] || "bg-gray-300" : "";
                        const letter = status ? STATUS_LETTERS[status] || "" : "";

                        return (
                          <div
                            key={dateStr}
                            className={`text-center rounded-full w-6 h-6 flex items-center justify-center mx-auto text-[10px] ${bgColor ? `${bgColor} text-white font-bold` : "text-muted-foreground"}`}
                            title={status ? `${dateStr}: ${status}` : dateStr}
                          >
                            {status ? letter : dayNum}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {attendanceMonths.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No attendance records</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      <Dialog open={studentEditOpen} onOpenChange={setStudentEditOpen}>
        <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Edit Student Information</DialogTitle>
            <DialogDescription>Update the student's personal and contact details. Registration number is intentionally not editable here.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5"><Label htmlFor="student360-first-name">First Name</Label><Input id="student360-first-name" value={studentDraft.firstName || ""} onChange={(e) => setStudentDraft((d) => ({ ...d, firstName: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="student360-last-name">Last Name</Label><Input id="student360-last-name" value={studentDraft.lastName || ""} onChange={(e) => setStudentDraft((d) => ({ ...d, lastName: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Gender</Label><Select value={studentDraft.gender || ""} onValueChange={(value) => setStudentDraft((d) => ({ ...d, gender: value }))}><SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger><SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="student360-dob">Date of Birth</Label><Input id="student360-dob" type="date" value={studentDraft.dateOfBirth || ""} onChange={(e) => setStudentDraft((d) => ({ ...d, dateOfBirth: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="student360-phone">Phone</Label><Input id="student360-phone" value={studentDraft.phone || ""} onChange={(e) => setStudentDraft((d) => ({ ...d, phone: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="student360-email">Email</Label><Input id="student360-email" type="email" value={studentDraft.email || ""} onChange={(e) => setStudentDraft((d) => ({ ...d, email: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="student360-national-id">National ID</Label><Input id="student360-national-id" value={studentDraft.nationalIdNumber || ""} onChange={(e) => setStudentDraft((d) => ({ ...d, nationalIdNumber: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="student360-passport">Passport Number</Label><Input id="student360-passport" value={studentDraft.passportNumber || ""} onChange={(e) => setStudentDraft((d) => ({ ...d, passportNumber: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="student360-street">Street Address</Label><Input id="student360-street" value={studentDraft.streetAddress || ""} onChange={(e) => setStudentDraft((d) => ({ ...d, streetAddress: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="student360-area">Residential Area</Label><Input id="student360-area" value={studentDraft.residentialArea || ""} onChange={(e) => setStudentDraft((d) => ({ ...d, residentialArea: e.target.value }))} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="student360-address">City / Address</Label><Textarea id="student360-address" value={studentDraft.address || ""} onChange={(e) => setStudentDraft((d) => ({ ...d, address: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStudentEditOpen(false)} disabled={updateStudentMutation.isPending}>Cancel</Button>
            <Button onClick={saveStudent} disabled={updateStudentMutation.isPending}>{updateStudentMutation.isPending ? "Saving..." : "Save Student"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={parentEditOpen} onOpenChange={setParentEditOpen}>
        <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Edit Parent Information</DialogTitle>
            <DialogDescription>Update the linked parent's contact and address details.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5"><Label htmlFor="parent360-first-name">First Name</Label><Input id="parent360-first-name" value={parentDraft.firstName || ""} onChange={(e) => setParentDraft((d) => ({ ...d, firstName: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="parent360-last-name">Last Name</Label><Input id="parent360-last-name" value={parentDraft.lastName || ""} onChange={(e) => setParentDraft((d) => ({ ...d, lastName: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="parent360-phone">Phone</Label><Input id="parent360-phone" value={parentDraft.phone || ""} onChange={(e) => setParentDraft((d) => ({ ...d, phone: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="parent360-email">Email</Label><Input id="parent360-email" type="email" value={parentDraft.email || ""} onChange={(e) => setParentDraft((d) => ({ ...d, email: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="parent360-relationship">Relationship</Label><Input id="parent360-relationship" value={parentDraft.relationship || ""} onChange={(e) => setParentDraft((d) => ({ ...d, relationship: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="parent360-occupation">Occupation</Label><Input id="parent360-occupation" value={parentDraft.occupation || ""} onChange={(e) => setParentDraft((d) => ({ ...d, occupation: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="parent360-street">Street Address</Label><Input id="parent360-street" value={parentDraft.streetAddress || ""} onChange={(e) => setParentDraft((d) => ({ ...d, streetAddress: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="parent360-area">Residential Area</Label><Input id="parent360-area" value={parentDraft.residentialArea || ""} onChange={(e) => setParentDraft((d) => ({ ...d, residentialArea: e.target.value }))} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="parent360-address">City / Address</Label><Textarea id="parent360-address" value={parentDraft.address || ""} onChange={(e) => setParentDraft((d) => ({ ...d, address: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setParentEditOpen(false)} disabled={updateParentMutation.isPending}>Cancel</Button>
            <Button onClick={saveParent} disabled={updateParentMutation.isPending}>{updateParentMutation.isPending ? "Saving..." : "Save Parent"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}